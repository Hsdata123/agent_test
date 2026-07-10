import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { ensureChatWorkspaceTables, getChatConversationForUser } from "@/lib/chat-store";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    await ensureChatWorkspaceTables();
    const { id } = await context.params;
    const conversation = await getChatConversationForUser(id, user.id);
    if (!conversation) throw Object.assign(new Error("对话不存在或无权限访问"), { status: 404 });
    const body = await request.json();
    const useKnowledge = body.useKnowledge === true;
    const useQianchuan = body.useQianchuan !== false;
    const prefs = { useKnowledge, useQianchuan };
    const now = new Date().toISOString();
    await prisma.$executeRawUnsafe(
      `UPDATE ChatConversation SET prefsJson = ?, updatedAt = ? WHERE id = ?`,
      JSON.stringify(prefs),
      now,
      id
    );
    return NextResponse.json({ success: true, prefs });
  } catch (error) {
    return jsonError(error);
  }
}