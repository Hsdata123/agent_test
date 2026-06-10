import { jsonError, requireUser } from "@/lib/auth";
import { ensureChatWorkspaceTables, type ChatMessageRow } from "@/lib/chat-store";
import { prisma } from "@/lib/prisma";

type ConversationDownloadRow = {
  id: string;
  projectId: string;
  title: string;
  projectName: string;
  createdById: string;
  username: string;
  nickname: string;
  createdAt: string | Date;
  updatedAt: string | Date;
};

function asIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function safeDownloadName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "conversation";
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    await ensureChatWorkspaceTables();
    const { id } = await context.params;
    const rows = await prisma.$queryRawUnsafe<ConversationDownloadRow[]>(
      `
        SELECT
          cc.id,
          cc.projectId,
          cc.title,
          cc.createdAt,
          cc.updatedAt,
          cp.name AS projectName,
          cp.createdById,
          u.username,
          u.nickname
        FROM ChatConversation cc
        JOIN ChatProject cp ON cp.id = cc.projectId
        JOIN User u ON u.id = cp.createdById
        WHERE cc.id = ?
        LIMIT 1
      `,
      id
    );
    const conversation = rows[0];
    if (!conversation) throw Object.assign(new Error("对话不存在"), { status: 404 });
    if (user.role !== "admin" && conversation.createdById !== user.id) {
      throw Object.assign(new Error("无权限下载该对话"), { status: 403 });
    }
    const messages = await prisma.$queryRawUnsafe<ChatMessageRow[]>(
      `SELECT id, conversationId, role, content, createdAt
       FROM ChatMessage
       WHERE conversationId = ?
       ORDER BY createdAt ASC`,
      id
    );
    const content = [
      `对话项目：${conversation.projectName}`,
      `对话名称：${conversation.title}`,
      `用户：${conversation.nickname || conversation.username}（${conversation.username}）`,
      `创建时间：${asIso(conversation.createdAt)}`,
      `更新时间：${asIso(conversation.updatedAt)}`,
      `消息数：${messages.length}`,
      "",
      "================ 对话内容 ================",
      "",
      ...messages.map((message, index) =>
        [
          `#${index + 1} ${message.role === "user" ? "用户" : "AI"} ${asIso(message.createdAt as string | Date)}`,
          message.content,
          ""
        ].join("\n")
      )
    ].join("\n");
    const fileName = `${safeDownloadName(conversation.projectName)}-${safeDownloadName(conversation.title)}.txt`;
    return new Response(content, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
