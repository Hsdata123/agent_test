import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findAssetMatch } from "@/lib/matching";
import { canEdit, getProjectRole, jsonError, requireUser } from "@/lib/auth";
import { publicFileUrl } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const { projectId, parseIds } = await request.json();
    const role = await getProjectRole(projectId, user.id, user.role);
    if (!role || !(await canEdit(role))) throw Object.assign(new Error("当前权限仅支持查看"), { status: 403 });
    const parses = await prisma.mechanismParse.findMany({
      where: { id: { in: parseIds || [] }, projectId },
      include: { items: true }
    });
    const matches = [];
    for (const parse of parses) {
      for (const item of parse.items) {
        const match = await findAssetMatch(item.productName);
        const updated = await prisma.mechanismItem.update({
          where: { id: item.id },
          data: {
            matchedAssetId: match.asset?.id,
            matchType: match.matchType,
            matchScore: match.score
          },
          include: { matchedAsset: true, parse: true }
        });
        matches.push({
          parseId: parse.id,
          itemId: item.id,
          productName: item.productName,
          quantity: item.quantity,
          matchedAsset: updated.matchedAsset
            ? {
                ...updated.matchedAsset,
                imageUrl: publicFileUrl(updated.matchedAsset.storagePath),
                fileUrl: publicFileUrl(updated.matchedAsset.storagePath)
              }
            : null,
          matchType: match.matchType,
          matchScore: match.score
        });
      }
    }
    return NextResponse.json({ success: true, matches });
  } catch (error) {
    return jsonError(error);
  }
}
