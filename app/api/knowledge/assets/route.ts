import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, requireUser } from "@/lib/auth";
import { publicFileUrl } from "@/lib/storage";
import { isAdmin, scopedKnowledgeWhere } from "@/lib/dept-scope";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const assetType = searchParams.get("assetType");
    const query = (searchParams.get("q") || "").trim();
    const departmentParam = searchParams.get("departmentId");

    const typeWhere = assetType && assetType !== "all" ? { assetType } : {};
    let where: Record<string, unknown> = scopedKnowledgeWhere(user, typeWhere);
    if (isAdmin(user) && departmentParam && departmentParam !== "all") {
      where = { ...where, departmentId: departmentParam };
    }
    if (query) {
      where = {
        ...where,
        OR: [
          { assetName: { contains: query } },
          { productName: { contains: query } },
          { description: { contains: query } },
          { extractedText: { contains: query } }
        ]
      };
    }
    const assets = await prisma.knowledgeAsset.findMany({
      where,
      orderBy: { updatedAt: "desc" }
    });
    return NextResponse.json({
      success: true,
      assets: assets.map((asset) => ({ ...asset, fileUrl: publicFileUrl(asset.storagePath) }))
    });
  } catch (error) {
    return jsonError(error);
  }
}
