import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canEdit, getProjectRole, jsonError, requireUser } from "@/lib/auth";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const task = await prisma.generationTask.findUnique({ where: { id } });
    if (!task) throw Object.assign(new Error("任务不存在"), { status: 404 });
    const role = await getProjectRole(task.projectId, user.id, user.role);
    if (!role || !(await canEdit(role))) throw Object.assign(new Error("当前权限仅支持查看"), { status: 403 });
    const updated = await prisma.generationTask.update({ where: { id }, data: { status: "canceled" } });
    return NextResponse.json({ success: true, task: updated });
  } catch (error) {
    return jsonError(error);
  }
}
