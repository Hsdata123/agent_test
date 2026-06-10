import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canEdit, getProjectRole, jsonError, requireUser } from "@/lib/auth";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const { assetId, saveAlias } = await request.json();
    const item = await prisma.mechanismItem.findUnique({
      where: { id },
      include: { parse: true }
    });
    if (!item) throw Object.assign(new Error("机制明细不存在"), { status: 404 });
    const role = await getProjectRole(item.parse.projectId, user.id, user.role);
    if (!role || !(await canEdit(role))) throw Object.assign(new Error("当前权限仅支持查看"), { status: 403 });
    const updated = await prisma.mechanismItem.update({
      where: { id },
      data: { matchedAssetId: assetId, matchType: "manual", matchScore: 1 },
      include: { matchedAsset: true }
    });
    if (saveAlias && assetId) {
      await prisma.productAlias.upsert({
        where: { alias_assetId: { alias: item.productName, assetId } },
        update: {},
        create: { alias: item.productName, assetId }
      });
      const asset = await prisma.knowledgeAsset.findUnique({ where: { id: assetId } });
      const aliases = new Set<string>(asset ? safeJsonList(asset.aliases) : []);
      aliases.add(item.productName);
      await prisma.knowledgeAsset.update({
        where: { id: assetId },
        data: { aliases: JSON.stringify(Array.from(aliases)) }
      });
    }
    return NextResponse.json({ success: true, item: updated });
  } catch (error) {
    return jsonError(error);
  }
}

function safeJsonList(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
