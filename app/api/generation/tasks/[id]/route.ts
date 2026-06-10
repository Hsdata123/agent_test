import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getProjectRole, jsonError, requireUser } from "@/lib/auth";
import { publicFileUrl } from "@/lib/storage";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const task = await prisma.generationTask.findUnique({
      where: { id },
      include: { parse: { include: { items: { include: { matchedAsset: true } } } }, results: true, project: true }
    });
    if (!task) throw Object.assign(new Error("任务不存在"), { status: 404 });
    const role = await getProjectRole(task.projectId, user.id, user.role);
    if (!role) throw Object.assign(new Error("你没有该项目的访问权限"), { status: 403 });
    return NextResponse.json({
      success: true,
      task: {
        ...task,
        results: task.results.map((result) => ({ ...result, imageUrl: publicFileUrl(result.imagePath) }))
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
