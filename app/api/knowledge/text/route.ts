import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { canEdit, jsonError, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { publicFileUrl, safeFileName, uploadDir, ensureStorage } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!(await canEdit(user.role))) throw Object.assign(new Error("当前权限仅支持查看"), { status: 403 });
    const body = await request.json();
    const assetType = String(body.assetType || "document");
    const assetName = String(body.assetName || "").trim();
    const text = String(body.text || "").trim();
    if (!assetName) throw Object.assign(new Error("请输入资料名称"), { status: 400 });
    if (!text) throw Object.assign(new Error("请输入要保存的文字内容"), { status: 400 });
    if (assetType !== "document" && assetType !== "prompt") throw Object.assign(new Error("文字资料类型仅支持文档或提示词"), { status: 400 });

    await ensureStorage();
    const fileName = `${Date.now()}-${safeFileName(assetName)}.txt`;
    const storagePath = path.join(uploadDir, fileName);
    await fs.writeFile(storagePath, text, "utf8");
    const asset = await prisma.knowledgeAsset.create({
      data: {
        assetName,
        originalName: `${assetName}.txt`,
        assetType,
        storagePath,
        mimeType: "text/plain",
        extractedText: text,
        description: body.description ? String(body.description) : null,
        createdById: user.id
      }
    });
    return NextResponse.json({ success: true, asset: { ...asset, fileUrl: publicFileUrl(asset.storagePath) } });
  } catch (error) {
    return jsonError(error);
  }
}
