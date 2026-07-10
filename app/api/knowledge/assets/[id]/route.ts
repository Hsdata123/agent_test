import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { canEdit, jsonError, publicFileUrl, requireUser } from "@/lib/server-exports";
import { prisma } from "@/lib/prisma";
import { roleHasPermission } from "@/lib/roles";
import { canEditAsset, isAdmin } from "@/lib/dept-scope";
import { serializeScenes } from "@/lib/scenes";
import { parseExcelPreview } from "@/lib/excel-preview";

function listToJson(value: unknown) {
  if (Array.isArray(value)) return JSON.stringify(value.map(String).filter(Boolean));
  if (typeof value === "string") {
    return JSON.stringify(value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean));
  }
  return undefined;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const asset = await prisma.knowledgeAsset.findUnique({ where: { id } });
    if (!asset) throw Object.assign(new Error("资料不存在"), { status: 404 });
    if (!isAdmin(user) && asset.departmentId && asset.departmentId !== user.departmentId) {
      throw Object.assign(new Error("无权访问其他部门资料"), { status: 403 });
    }
    // Excel 类资料附带预览 (从 extractedText 解析, 与上传时一致), 前端「查看预览」按钮可直接渲染
    const preview = asset.assetType === "excel" && asset.extractedText ? parseExcelPreview(asset.extractedText) : null;
    return NextResponse.json({
      success: true,
      asset: { ...asset, fileUrl: publicFileUrl(asset.storagePath), preview }
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    if (!(await canEdit(user.role))) throw Object.assign(new Error("当前权限仅支持查看"), { status: 403 });
    const { id } = await context.params;
    const existing = await prisma.knowledgeAsset.findUnique({ where: { id } });
    if (!existing) throw Object.assign(new Error("资料不存在"), { status: 404 });
    if (!canEditAsset(user, existing)) throw Object.assign(new Error("无权编辑其他部门资料"), { status: 403 });
    const body = await request.json();
    const aliases = listToJson(body.aliases);
    const tags = listToJson(body.tags);
    const data: Record<string, unknown> = {
      assetName: body.assetName,
      assetType: body.assetType,
      productName: body.productName,
      tags,
      aliases,
      description: body.description,
      enabled: body.enabled,
      preferred: body.preferred
    };
    if (body.scenes !== undefined) {
      data.scenes = serializeScenes(Array.isArray(body.scenes) ? body.scenes : []);
    }
    if (body.departmentId !== undefined) {
      if (!isAdmin(user)) {
        if (body.departmentId !== user.departmentId) {
          throw Object.assign(new Error("仅超级管理员可跨部门迁移资料"), { status: 403 });
        }
      }
      data.departmentId = body.departmentId || null;
    }
    const asset = await prisma.knowledgeAsset.update({ where: { id }, data });
    if (aliases) {
      let aliasList: string[] = [];
      try {
        const parsed = JSON.parse(aliases);
        aliasList = Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : [];
      } catch {
        throw Object.assign(new Error("aliases 格式错误，必须为 JSON 数组"), { status: 400 });
      }
      await prisma.$transaction([
        prisma.productAlias.deleteMany({ where: { assetId: id } }),
        ...aliasList.map((alias) =>
          prisma.productAlias.create({ data: { alias, assetId: id } })
        )
      ]);
    }
    return NextResponse.json({ success: true, asset });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    if (user.role !== "admin" && user.role !== "creator" && !(await roleHasPermission(user.role, "manage_knowledge"))) {
      throw Object.assign(new Error("当前权限不能删除资料"), { status: 403 });
    }
    const { id } = await context.params;
    const existing = await prisma.knowledgeAsset.findUnique({ where: { id } });
    if (!existing) throw Object.assign(new Error("资料不存在"), { status: 404 });
    if (!canEditAsset(user, existing)) throw Object.assign(new Error("无权删除其他部门资料"), { status: 403 });
    await prisma.knowledgeAsset.delete({ where: { id } });
    await prisma.productAlias.deleteMany({ where: { assetId: id } });
    try {
      if (existing.storagePath) await fs.unlink(existing.storagePath);
    } catch {
      // 文件可能已不存在，忽略错误避免影响主流程
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
