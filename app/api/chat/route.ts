import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { jsonError, requireUser } from "@/lib/auth";
import { ensureChatWorkspaceTables, getChatConversationForUser } from "@/lib/chat-store";
import { IThinkClient } from "@/lib/ithink";
import { prisma } from "@/lib/prisma";
import { detectSceneIntent } from "@/lib/scene-intent";
import { getEffectiveDepartmentId, isAdmin } from "@/lib/dept-scope";
import { listOpenAITools } from "@/lib/skills/registry";
import type { ToolDefinition } from "@/lib/ithink";
import { refreshAssetsText } from "@/lib/asset-extract";
import { runChatWithSkills } from "@/lib/chat-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ProcessEvent =
  | { type: "manual_mode"; count: number }
  | { type: "intent"; scenes: Array<{ sceneKey: string; sceneName: string; score: number }> }
  | { type: "retrieve"; assets: Array<{ id: string; assetName: string; assetType: string; score: number }>; contextChars: number; contextPreview: string }
  | { type: "skill"; calls: Array<{ id: string; name: string; arguments: unknown; result: string; ok: boolean; error?: string; meta?: Record<string, unknown> }>; contextChars: number }
  | { type: "context"; chars: number; preview: string; fullContext: string }
  | { type: "text"; text: string }
  | { type: "usage"; promptTokens?: number; completionTokens?: number; totalTokens?: number; cachedTokens?: number }
  | { type: "done"; answer: string; usedAssets: Array<{ id: string; assetName: string; assetType: string }>; debug: Record<string, unknown> }
  | { type: "error"; error: string; details?: Record<string, unknown> };

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const message = String(body.message || "").trim();
    const useAll = Boolean(body.useAll);
    const useKnowledge = body.useKnowledge === true;
    const assetIds = Array.isArray(body.assetIds) ? body.assetIds.map(String) : [];
    const assetType = String(body.assetType || "all");
    const conversationId = String(body.conversationId || "");
    if (!message) throw Object.assign(new Error("请输入对话内容"), { status: 400 });
    const conversation = conversationId ? await getChatConversationForUser(conversationId, user.id) : null;
    if (conversationId && !conversation) throw Object.assign(new Error("对话不存在或无权限访问"), { status: 404 });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: ProcessEvent) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            // stream closed
          }
        };

        try {
          const selectedKnowledge = assetIds.length > 0;
          const messageWantsKnowledge = shouldUseKnowledgeFromMessage(message);
          const shouldUseLegacy = useAll || selectedKnowledge || messageWantsKnowledge;
          const typeWhere = assetType && assetType !== "all" ? { assetType } : {};

          let context: string | undefined;
          const usedAssetSummaries: Array<{ id: string; assetName: string; assetType: string }> = [];
          const seen = new Set<string>();
          const pushAsset = (asset: { id: string; assetName: string; assetType: string }) => {
            if (seen.has(asset.id)) return;
            seen.add(asset.id);
            usedAssetSummaries.push(asset);
          };

          let usedPath: "manual" | "auto" | "skill" | "none" = "none";
          let intentScenes: Array<{ sceneKey: string; sceneName: string; score: number }> = [];
          let retrievedDebug: Array<{ id: string; assetName: string; assetType: string; score: number; scenes: string[] }> = [];

          // 路径 A：手动选择（useAll 或 显式 assetIds 或 消息关键词）
          if (shouldUseLegacy) {
            const assets = await prisma.knowledgeAsset.findMany({
              where: useAll || messageWantsKnowledge ? { enabled: true, ...typeWhere } : { id: { in: assetIds }, enabled: true, ...typeWhere },
              orderBy: { updatedAt: "desc" },
              take: useAll || messageWantsKnowledge ? 80 : 20
            });
            const refreshed = await refreshAssetsText(assets);
            for (const asset of refreshed) {
              pushAsset({ id: asset.id, assetName: asset.assetName, assetType: asset.assetType });
            }
            const baseContext = refreshed
              .map((asset, index) =>
                [
                  `资料${index + 1}：${asset.assetName}`,
                  `类型：${asset.assetType}`,
                  asset.productName ? `产品：${asset.productName}` : "",
                  asset.description ? `说明：${asset.description}` : "",
                  asset.extractedText ? `正文：${asset.extractedText}` : ""
                ]
                  .filter(Boolean)
                  .join("\n")
              )
              .join("\n\n");
            context = baseContext;
            usedPath = "manual";
            send({ type: "manual_mode", count: refreshed.length });
            send({ type: "context", chars: context.length, preview: context.slice(0, 1500), fullContext: context });
          }

          // 路径 B：技能调用（useKnowledge 开 + 没手动选）
          let toolDefinitions: ToolDefinition[] = [];
          if (useKnowledge && !shouldUseLegacy) {
            const { scenes } = await detectSceneIntent({
              userDepartmentId: getEffectiveDepartmentId(user),
              isAdmin: isAdmin(user),
              query: message
            });
            intentScenes = scenes.map((s) => ({ sceneKey: s.sceneKey, sceneName: s.sceneName, score: s.score }));
            if (scenes.length) {
              send({ type: "intent", scenes: intentScenes });
            }
            toolDefinitions = await listOpenAITools();
            usedPath = "skill";
          }

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
          const runnerResult = await runChatWithSkills(
            {
              client,
              message,
              history,
              context,
              tools: toolDefinitions.length ? toolDefinitions : undefined,
              ctx: { user },
              isSkillPath: usedPath === "skill"
            },
            (chunk) => {
              if (chunk.type === "text") {
                send({ type: "text", text: chunk.text });
              } else if (chunk.type === "skill") {
                const skillEvents = chunk.calls.map((call) => ({
                  id: call.id,
                  name: call.name,
                  arguments: call.arguments,
                  result: call.ok ? call.result : `执行失败：${call.error}`,
                  ok: call.ok,
                  error: call.error,
                  meta: call.meta
                }));
                send({ type: "skill", calls: skillEvents, contextChars: chunk.contextChars });
                for (const call of chunk.calls) {
                  const assets = call.matchedAssets || [];
                  for (const asset of assets) {
                    pushAsset({ id: asset.id, assetName: asset.assetName, assetType: asset.assetType });
                  }
                }
              } else if (chunk.type === "usage") {
                send({
                  type: "usage",
                  promptTokens: chunk.usage.promptTokens,
                  completionTokens: chunk.usage.completionTokens,
                  totalTokens: chunk.usage.totalTokens,
                  cachedTokens: chunk.usage.cachedTokens
                });
              }
            }
          );

          if (runnerResult.error) {
            send({ type: "error", error: runnerResult.error.error, details: runnerResult.error.details });
            controller.close();
            return;
          }

          const answer = runnerResult.answer || "（模型未返回内容）";
          if (runnerResult.skillContext) {
            send({
              type: "context",
              chars: runnerResult.skillContext.length,
              preview: runnerResult.skillContext.slice(0, 1500),
              fullContext: runnerResult.skillContext
            });
          }
          if (conversation) {
            await appendConversationMessages(conversation.id, conversation.projectId, message, answer);
          }
          await recordChatUsage({
            userId: user.id,
            message,
            answer,
            promptTokens: runnerResult.usage.promptTokens,
            completionTokens: runnerResult.usage.completionTokens,
            totalTokens: runnerResult.usage.totalTokens,
            cachedTokens: runnerResult.usage.cachedTokens
          });
          if (runnerResult.usage.promptTokens !== undefined || runnerResult.usage.completionTokens !== undefined) {
            send({
              type: "usage",
              promptTokens: runnerResult.usage.promptTokens,
              completionTokens: runnerResult.usage.completionTokens,
              totalTokens: runnerResult.usage.totalTokens,
              cachedTokens: runnerResult.usage.cachedTokens
            });
          }
          const contextPreview = (runnerResult.skillContext || context || "").slice(0, 1500);
          send({
            type: "done",
            answer,
            usedAssets: usedAssetSummaries,
            debug: {
              useKnowledgeSwitch: useKnowledge,
              usedPath,
              intentScenes,
              ranked: retrievedDebug,
              baseAssetCount: usedPath === "manual" ? usedAssetSummaries.length : 0,
              contextCharCount: runnerResult.skillContext.length || context?.length || 0,
              contextPreview,
              skillCalls: runnerResult.skillCalls
            }
          });
          controller.close();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const details =
            error && typeof error === "object" && "toJSON" in error
              ? ((error as { toJSON(): unknown }).toJSON() as Record<string, unknown>)
              : undefined;
          console.error("[chat] request failed", { message, details, stack: error instanceof Error ? error.stack : undefined });
          send({ type: "error", error: message, details });
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      }
    });
  } catch (error) {
    return jsonError(error);
  }
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
  await prisma.$executeRawUnsafe(`UPDATE ChatConversation SET title = ?, updatedAt = ? WHERE id = ?`, nextTitle, now, projectId);
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

function parseScenesForDebug(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}
