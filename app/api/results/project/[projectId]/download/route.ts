import fs from "node:fs";
import archiver from "archiver";
import { prisma } from "@/lib/prisma";
import { getProjectRole, jsonError, requireUser } from "@/lib/auth";

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireUser();
    const { projectId } = await context.params;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");
    const role = await getProjectRole(projectId, user.id, user.role);
    if (!role) throw Object.assign(new Error("你没有下载该项目结果的权限"), { status: 403 });

    const results = await prisma.generationResult.findMany({
      where: type === "main_image" ? { projectId, task: { outputType: "main_image" } } : { projectId },
      include: { task: true },
      orderBy: { createdAt: "desc" }
    });

    const archive = archiver("zip");
    let index = 1;
    for (const result of results) {
      if (!fs.existsSync(result.imagePath)) continue;
      const prefix = result.task.outputType === "main_image" ? "main" : result.pageIndex ? `detail-${result.pageIndex}` : "result";
      archive.file(result.imagePath, { name: `${String(index).padStart(2, "0")}-${prefix}-${result.id}.png` });
      index += 1;
    }
    archive.finalize();

    const suffix = type === "main_image" ? "main-images" : "results";
    return new Response(archive as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${projectId}-${suffix}.zip"`
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
