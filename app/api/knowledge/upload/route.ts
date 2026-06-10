import { NextResponse } from "next/server";
import { extractDocumentText } from "@/lib/document-extract";
import { prisma } from "@/lib/prisma";
import { canEdit, jsonError, nameWithoutExt, publicFileUrl, requireUser, saveUpload } from "@/lib/server-exports";

const imageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
type AssetType = "product_white_image" | "main_template" | "portrait_white_image" | "pdf" | "ppt" | "document" | "prompt";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!(await canEdit(user.role))) throw Object.assign(new Error("当前权限仅支持查看，不能上传资料"), { status: 403 });

    const formData = await request.formData();
    const files = formData.getAll("files").filter((value): value is File => value instanceof File);
    const requestedType = String(formData.get("assetType") || "") as AssetType | "";
    if (!files.length) throw Object.assign(new Error("请选择上传文件"), { status: 400 });

    const assets = [];
    for (const file of files) {
      const saved = await saveUpload(file);
      const fallbackType = guessAssetType(file, saved.originalName);
      const assetType = requestedType || fallbackType;
      const assetName = nameWithoutExt(saved.originalName);
      const extractedText = await extractDocumentText(file, saved.originalName);
      const asset = await prisma.knowledgeAsset.create({
        data: {
          assetName,
          originalName: saved.originalName,
          assetType,
          productName: assetType === "product_white_image" ? assetName : null,
          storagePath: saved.storagePath,
          mimeType: file.type,
          extractedText,
          createdById: user.id
        }
      });
      assets.push(asset);
    }

    return NextResponse.json({
      success: true,
      assets: assets.map((asset) => ({ ...asset, fileUrl: publicFileUrl(asset.storagePath) }))
    });
  } catch (error) {
    return jsonError(error);
  }
}

function guessAssetType(file: File, originalName: string): AssetType {
  const lowerName = originalName.toLowerCase();
  if (imageTypes.has(file.type)) return "product_white_image";
  if (file.type.includes("pdf") || lowerName.endsWith(".pdf")) return "pdf";
  if (lowerName.endsWith(".ppt") || lowerName.endsWith(".pptx")) return "ppt";
  return "document";
}
