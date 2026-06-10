import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canEdit, getProjectRole, jsonError, requireUser } from "@/lib/auth";
import { runTask } from "@/lib/generation";
import { publicFileUrl } from "@/lib/storage";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const task = await prisma.generationTask.findUnique({ where: { id } });
    if (!task) throw Object.assign(new Error("任务不存在"), { status: 404 });
    const role = await getProjectRole(task.projectId, user.id, user.role);
    if (!role || !(await canEdit(role))) throw Object.assign(new Error("当前权限仅支持查看"), { status: 403 });
    const updated = await prisma.generationTask.update({
      where: { id },
      data: { status: "queued", failureReason: null },
      include: { parse: true, results: true, project: true }
    });
    void runTask(id).catch((error) => console.error(`Retry task ${id} failed`, error));
    return NextResponse.json({
      success: true,
      task: {
        ...updated,
        results: updated.results.map((result) => ({ ...result, imageUrl: publicFileUrl(result.imagePath) }))
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
