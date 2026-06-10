import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseMechanisms } from "@/lib/mechanism";
import { canEdit, getProjectRole, jsonError, requireUser } from "@/lib/auth";
import { findAssetMatch } from "@/lib/matching";
import { publicFileUrl } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const { projectId, rawText } = await request.json();
    const role = await getProjectRole(projectId, user.id, user.role);
    if (!role || !(await canEdit(role))) throw Object.assign(new Error("当前权限仅支持查看"), { status: 403 });
    const { parsed, issues } = parseMechanisms(rawText || "");
    const items = [];

    for (const parsedItem of parsed) {
      const record = await prisma.mechanismParse.create({
        data: {
          projectId,
          rawMechanism: parsedItem.raw,
          price: parsedItem.price,
          productSummary: parsedItem.productSummary,
          createdById: user.id,
          items: {
            create: parsedItem.products.map((product) => ({
              productName: product.productName,
              quantity: product.quantity
            }))
          }
        },
        include: { items: { include: { matchedAsset: true } } }
      });
      for (const productItem of record.items) {
        const match = await findAssetMatch(productItem.productName);
        if (match.asset) {
          await prisma.mechanismItem.update({
            where: { id: productItem.id },
            data: { matchedAssetId: match.asset.id, matchType: match.matchType, matchScore: match.score }
          });
        }
      }
      const hydrated = await prisma.mechanismParse.findUnique({
        where: { id: record.id },
        include: { items: { include: { matchedAsset: true } } }
      });
      if (hydrated) items.push(withFileUrls(hydrated));
    }

    return NextResponse.json({ success: true, items, issues });
  } catch (error) {
    return jsonError(error);
  }
}

function withFileUrls(parse: any) {
  return {
    ...parse,
    items: parse.items.map((item: any) => ({
      ...item,
      matchedAsset: item.matchedAsset ? { ...item.matchedAsset, fileUrl: publicFileUrl(item.matchedAsset.storagePath) } : null
    }))
  };
}
