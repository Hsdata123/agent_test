import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { ensureChatWorkspaceTables, getChatProjectForUser } from "@/lib/chat-store";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    await ensureChatWorkspaceTables();
    const { id } = await context.params;
    const project = await getChatProjectForUser(id, user.id);
    if (!project) throw Object.assign(new Error("项目不存在或无权限访问"), { status: 404 });
    const body = await request.json();
    const name = String(body.name || "").trim();
    if (!name) throw Object.assign(new Error("请输入项目名称"), { status: 400 });
    const now = new Date().toISOString();
    await prisma.$executeRawUnsafe(`UPDATE ChatProject SET name = ?, updatedAt = ? WHERE id = ?`, name, now, id);
    return NextResponse.json({ success: true, project: { ...project, name, updatedAt: now } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    await ensureChatWorkspaceTables();
    const { id } = await context.params;
    const project = await getChatProjectForUser(id, user.id);
    if (!project) throw Object.assign(new Error("项目不存在或无权限访问"), { status: 404 });
    await prisma.$executeRawUnsafe(`DELETE FROM ChatProject WHERE id = ?`, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
