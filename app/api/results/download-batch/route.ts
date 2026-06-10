import fs from "node:fs";
import archiver from "archiver";
import { prisma } from "@/lib/prisma";
import { getProjectRole, jsonError, requireUser } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const { resultIds, projectId } = await request.json();
    const role = await getProjectRole(projectId, user.id, user.role);
    if (!role) throw Object.assign(new Error("你没有下载该项目结果的权限"), { status: 403 });
    const results = await prisma.generationResult.findMany({
      where: { id: { in: resultIds || [] }, projectId }
    });
    const archive = archiver("zip");
    for (const result of results) {
      if (fs.existsSync(result.imagePath)) archive.file(result.imagePath, { name: `${result.id}.png` });
    }
    archive.finalize();
    return new Response(archive as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=\"results.zip\""
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
