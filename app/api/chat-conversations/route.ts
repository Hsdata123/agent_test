import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { ensureChatWorkspaceTables, getChatProjectForUser } from "@/lib/chat-store";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await ensureChatWorkspaceTables();
    const body = await request.json();
    const projectId = String(body.projectId || "");
    const project = await getChatProjectForUser(projectId, user.id);
    if (!project) throw Object.assign(new Error("请选择有效的对话项目"), { status: 404 });

    const now = new Date().toISOString();
    const id = randomUUID();
    const title = String(body.title || "新对话").trim() || "新对话";
    // 新对话的默认偏好: useKnowledge=false, useQianchuan=true. 用户切换后 PATCH 到 prefsJson.
    const defaultPrefs = { useKnowledge: false, useQianchuan: true };
    await prisma.$executeRawUnsafe(
      `INSERT INTO ChatConversation (id, projectId, title, prefsJson, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      projectId,
      title,
      JSON.stringify(defaultPrefs),
      now,
      now
    );
    await prisma.$executeRawUnsafe(`UPDATE ChatProject SET updatedAt = ? WHERE id = ?`, now, projectId);
    return NextResponse.json({ success: true, conversation: { id, projectId, title, prefsJson: JSON.stringify(defaultPrefs), createdAt: now, updatedAt: now } });
  } catch (error) {
    return jsonError(error);
  }
}
