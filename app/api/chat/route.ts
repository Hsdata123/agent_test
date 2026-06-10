import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { jsonError, requireUser } from "@/lib/auth";
import { ensureChatWorkspaceTables, getChatConversationForUser } from "@/lib/chat-store";
import { extractDocumentText } from "@/lib/document-extract";
import { IThinkClient } from "@/lib/ithink";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const message = String(body.message || "").trim();
    const useAll = Boolean(body.useAll);
    const assetIds = Array.isArray(body.assetIds) ? body.assetIds.map(String) : [];
    const assetType = String(body.assetType || "all");
    const conversationId = String(body.conversationId || "");
    if (!message) throw Object.assign(new Error("请输入对话内容"), { status: 400 });
    const conversation = conversationId ? await getChatConversationForUser(conversationId, user.id) : null;
    if (conversationId && !conversation) throw Object.assign(new Error("对话不存在或无权限访问"), { status: 404 });

    const selectedKnowledge = assetIds.length > 0;
    const messageWantsKnowledge = shouldUseKnowledgeFromMessage(message);
    const shouldUseKnowledge = useAll || selectedKnowledge || messageWantsKnowledge;
    const typeWhere = assetType && assetType !== "all" ? { assetType } : {};
    const assets = shouldUseKnowledge
      ? await prisma.knowledgeAsset.findMany({
          where: useAll || messageWantsKnowledge ? { enabled: true, ...typeWhere } : { id: { in: assetIds }, enabled: true, ...typeWhere },
          orderBy: { updatedAt: "desc" },
          take: useAll || messageWantsKnowledge ? 80 : 20
        })
      : [];
    const refreshedAssets = shouldUseKnowledge ? await refreshExtractedText(assets) : assets;
    const context = refreshedAssets
      .map((asset, index) =>
        [
          `资料${index + 1}：${asset.assetName}`,
          `类型：${asset.assetType}`,
          asset.productName ? `产品：${asset.productName}` : "",
          asset.description ? `说明：${asset.description}` : "",
          asset.extractedText ? `正文：${asset.extractedText.slice(0, 8000)}` : ""
        ]
          .filter(Boolean)
          .join("\n")
      )
      .join("\n\n");

    const config = await prisma.apiConfig.findUnique({ where: { id: "singleton" } });
    const client = new IThinkClient({
      apiKey: process.env.ITHINK_TEXT_API_KEY,
      baseUrl: config?.textBaseUrl || config?.imageBaseUrl,
      imageModel: config?.imageModel,
      chatModel: config?.textModel,
      timeoutSeconds: config?.timeoutSeconds,
      textWireApi: config?.textWireApi,
      textPromptCacheEnabled: config?.textPromptCacheEnabled,
      textPromptCacheRetention: config?.textPromptCacheRetention,
      textPromptCacheKey: config?.textPromptCacheKey,
      disableResponseStorage: config?.disableResponseStorage
    });
    const history = conversation ? await loadConversationHistory(conversation.id) : [];
    const chatResult = await client.chatDetailed(message, shouldUseKnowledge ? context : undefined, history);
    const answer = chatResult.content;
    if (conversation) {
      await appendConversationMessages(conversation.id, conversation.projectId, message, answer);
    }
    await recordChatUsage({
      userId: user.id,
      message,
      answer,
      promptTokens: chatResult.usage?.prompt_tokens,
      completionTokens: chatResult.usage?.completion_tokens,
      totalTokens: chatResult.usage?.total_tokens,
      cachedTokens: chatResult.usage?.cached_tokens
    });
    return NextResponse.json({
      success: true,
      answer,
      usedAssets: refreshedAssets.map((asset) => ({ id: asset.id, assetName: asset.assetName, assetType: asset.assetType }))
    });
  } catch (error) {
    return jsonError(error);
  }
}

async function refreshExtractedText<T extends { id: string; originalName: string; storagePath: string; mimeType: string | null; extractedText: string | null }>(
  assets: T[]
) {
  return Promise.all(
    assets.map(async (asset) => {
      if (!needsReextract(asset.extractedText)) return asset;
      try {
        const buffer = await readFile(asset.storagePath);
        const originalName = asset.originalName || basename(asset.storagePath);
        const file = new File([buffer], originalName, { type: asset.mimeType || "" });
        const extractedText = await extractDocumentText(file, originalName);
        if (!extractedText || extractedText === asset.extractedText) return asset;
        await prisma.knowledgeAsset.update({ where: { id: asset.id }, data: { extractedText } });
        return { ...asset, extractedText };
      } catch {
        return asset;
      }
    })
  );
}

function needsReextract(text: string | null) {
  if (!text) return true;
  return text.includes("暂不解析二进制全文") || text.includes("当前本地测试版已把该文件作为对话资料保存");
}

function shouldUseKnowledgeFromMessage(message: string) {
  return /(调用|使用|参考|查询|搜索|根据|从).{0,8}知识库|知识库.{0,8}(资料|内容|文档|提示词)/.test(message);
}

async function loadConversationHistory(conversationId: string) {
  await ensureChatWorkspaceTables();
  const rows = await prisma.$queryRawUnsafe<Array<{ role: "user" | "assistant"; content: string; createdAt: string }>>(
    `SELECT role, content, createdAt
     FROM ChatMessage
     WHERE conversationId = ?
     ORDER BY createdAt DESC
     LIMIT 16`,
    conversationId
  );
  return rows.reverse().map((row) => ({ role: row.role, content: row.content }));
}

async function appendConversationMessages(conversationId: string, projectId: string, message: string, answer: string) {
  await ensureChatWorkspaceTables();
  const now = new Date().toISOString();
  await prisma.$executeRawUnsafe(
    `INSERT INTO ChatMessage (id, conversationId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)`,
    randomUUID(),
    conversationId,
    "user",
    message,
    now
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO ChatMessage (id, conversationId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)`,
    randomUUID(),
    conversationId,
    "assistant",
    answer,
    new Date().toISOString()
  );
  const titleRows = await prisma.$queryRawUnsafe<Array<{ title: string; messageCount: bigint | number }>>(
    `SELECT c.title as title, COUNT(m.id) as messageCount
     FROM ChatConversation c
     LEFT JOIN ChatMessage m ON m.conversationId = c.id
     WHERE c.id = ?
     GROUP BY c.id`,
    conversationId
  );
  const title = titleRows[0]?.title;
  const messageCount = Number(titleRows[0]?.messageCount || 0);
  const nextTitle = title === "新对话" && messageCount <= 2 ? message.slice(0, 32) || "新对话" : title;
  await prisma.$executeRawUnsafe(`UPDATE ChatConversation SET title = ?, updatedAt = ? WHERE id = ?`, nextTitle, now, conversationId);
  await prisma.$executeRawUnsafe(`UPDATE ChatProject SET updatedAt = ? WHERE id = ?`, now, projectId);
}

async function recordChatUsage(input: {
  userId: string;
  message: string;
  answer: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
}) {
  await ensureChatUsageTable();
  const promptTokens = input.promptTokens ?? estimateTokens(input.message);
  const completionTokens = input.completionTokens ?? estimateTokens(input.answer);
  const totalTokens = input.totalTokens ?? promptTokens + completionTokens;
  const cachedTokens = input.cachedTokens ?? 0;
  const estimatedCost = estimateChatCost(promptTokens, completionTokens);
  await prisma.$executeRawUnsafe(
    `INSERT INTO ChatUsage (id, userId, promptTokens, completionTokens, totalTokens, cachedTokens, estimatedCost, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    input.userId,
    promptTokens,
    completionTokens,
    totalTokens,
    cachedTokens,
    estimatedCost,
    new Date().toISOString()
  );
}

async function ensureChatUsageTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ChatUsage (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      promptTokens INTEGER NOT NULL DEFAULT 0,
      completionTokens INTEGER NOT NULL DEFAULT 0,
      totalTokens INTEGER NOT NULL DEFAULT 0,
      cachedTokens INTEGER NOT NULL DEFAULT 0,
      estimatedCost REAL NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL,
      CONSTRAINT ChatUsage_userId_fkey FOREIGN KEY (userId) REFERENCES User (id) ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE ChatUsage ADD COLUMN cachedTokens INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists.
  }
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 2));
}

function estimateChatCost(promptTokens: number, completionTokens: number) {
  const inputCostPerThousand = 0.002;
  const outputCostPerThousand = 0.008;
  return Number(((promptTokens / 1000) * inputCostPerThousand + (completionTokens / 1000) * outputCostPerThousand).toFixed(6));
}
