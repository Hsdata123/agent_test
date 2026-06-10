import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, requireUser } from "@/lib/auth";
import { publicFileUrl } from "@/lib/storage";
import { createBatchGeneration } from "@/lib/create-batch";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const tasks = await createBatchGeneration(user, await request.json());
    return NextResponse.json({ success: true, tasks });
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") || undefined;
    const where =
      user.role === "admin"
        ? { projectId }
        : {
            projectId,
            OR: [
              { createdById: user.id },
              { project: { creatorId: user.id } },
              { project: { members: { some: { userId: user.id } } } }
            ]
          };
    const tasks = await prisma.generationTask.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { parse: true, results: true, project: true }
    });
    return NextResponse.json({
      success: true,
      tasks: tasks.map((task) => ({
        ...task,
        results: task.results.map((result) => ({ ...result, imageUrl: publicFileUrl(result.imagePath) }))
      }))
    });
  } catch (error) {
    return jsonError(error);
  }
}
