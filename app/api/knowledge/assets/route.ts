import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, requireUser } from "@/lib/auth";
import { publicFileUrl } from "@/lib/storage";

export async function GET(request: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(request.url);
    const assetType = searchParams.get("assetType");
    const query = (searchParams.get("q") || "").trim();
    const typeWhere = assetType && assetType !== "all" ? { assetType } : {};
    const assets = await prisma.knowledgeAsset.findMany({
      where: query
        ? {
            ...typeWhere,
            OR: [
              { assetName: { contains: query } },
              { productName: { contains: query } },
              { description: { contains: query } },
              { extractedText: { contains: query } }
            ]
          }
        : typeWhere,
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
