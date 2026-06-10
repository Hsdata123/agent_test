import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getProjectRole, jsonError, requireUser } from "@/lib/auth";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const result = await prisma.generationResult.findUnique({ where: { id } });
    if (!result) throw Object.assign(new Error("图片文件不存在"), { status: 404 });
    const role = await getProjectRole(result.projectId, user.id, user.role);
    if (!role) throw Object.assign(new Error("你没有下载该项目结果的权限"), { status: 403 });
    if (!fs.existsSync(result.imagePath)) throw Object.assign(new Error("文件不存在或已被删除"), { status: 404 });
    const stream = fs.createReadStream(result.imagePath);
    return new Response(stream as unknown as BodyInit, {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="${path.basename(result.imagePath)}"`
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
