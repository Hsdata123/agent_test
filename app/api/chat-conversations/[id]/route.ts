import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { ensureChatWorkspaceTables, getChatConversationForUser, type ChatMessageRow } from "@/lib/chat-store";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    await ensureChatWorkspaceTables();
    const { id } = await context.params;
    const conversation = await getChatConversationForUser(id, user.id);
    if (!conversation) throw Object.assign(new Error("对话不存在或无权限访问"), { status: 404 });
    const messages = await prisma.$queryRawUnsafe<ChatMessageRow[]>(
      `SELECT id, conversationId, role, content, createdAt
       FROM ChatMessage
       WHERE conversationId = ?
       ORDER BY createdAt ASC`,
      id
    );
    return NextResponse.json({ success: true, conversation, messages });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    await ensureChatWorkspaceTables();
    const { id } = await context.params;
    const conversation = await getChatConversationForUser(id, user.id);
    if (!conversation) throw Object.assign(new Error("对话不存在或无权限访问"), { status: 404 });
    const body = await request.json();
    const title = String(body.title || "").trim();
    if (!title) throw Object.assign(new Error("请输入对话名称"), { status: 400 });
    const now = new Date().toISOString();
    await prisma.$executeRawUnsafe(`UPDATE ChatConversation SET title = ?, updatedAt = ? WHERE id = ?`, title, now, id);
    await prisma.$executeRawUnsafe(`UPDATE ChatProject SET updatedAt = ? WHERE id = ?`, now, conversation.projectId);
    return NextResponse.json({ success: true, conversation: { ...conversation, title, updatedAt: now } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    await ensureChatWorkspaceTables();
    const { id } = await context.params;
    const conversation = await getChatConversationForUser(id, user.id);
    if (!conversation) throw Object.assign(new Error("对话不存在或无权限访问"), { status: 404 });
    const now = new Date().toISOString();
    await prisma.$executeRawUnsafe(`DELETE FROM ChatConversation WHERE id = ?`, id);
    await prisma.$executeRawUnsafe(`UPDATE ChatProject SET updatedAt = ? WHERE id = ?`, now, conversation.projectId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
