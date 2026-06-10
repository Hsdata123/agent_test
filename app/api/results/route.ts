import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, requireUser } from "@/lib/auth";
import { publicFileUrl } from "@/lib/storage";

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
              { project: { creatorId: user.id } },
              { project: { members: { some: { userId: user.id } } } }
            ]
          };
    const results = await prisma.generationResult.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { pageIndex: "asc" }],
      include: { task: { include: { parse: true } }, project: true }
    });
    return NextResponse.json({
      success: true,
      results: results.map((result) => ({ ...result, imageUrl: publicFileUrl(result.imagePath) }))
    });
  } catch (error) {
    return jsonError(error);
  }
}
