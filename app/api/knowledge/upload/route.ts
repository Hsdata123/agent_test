import path from "node:path";
import { NextResponse } from "next/server";
import { extractDocumentText } from "@/lib/document-extract";
import { isExcelAssetType, isExcelFileName, parseExcelPreview, type ExcelPreview } from "@/lib/excel-preview";
import { prisma } from "@/lib/prisma";
import { canEdit, jsonError, nameWithoutExt, publicFileUrl, requireUser, saveUpload } from "@/lib/server-exports";
import { getEffectiveDepartmentId, isAdmin } from "@/lib/dept-scope";
import { serializeScenes } from "@/lib/scenes";

const imageMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/x-bmp",
  "image/tiff",
  "image/heic",
  "image/heif",
  "image/avif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/svg+xml",
  "image/vnd.adobe.photoshop",
  "image/x-adobe-illustrator",
  "application/postscript"
]);
const imageExtensions = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
  ".tif", ".tiff", ".heic", ".heif", ".avif",
  ".ico", ".svg", ".psd", ".ai"
]);
type AssetType = "product_white_image" | "main_template" | "portrait_white_image" | "pdf" | "ppt" | "excel" | "document" | "prompt";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!(await canEdit(user.role))) throw Object.assign(new Error("当前权限仅支持查看，不能上传资料"), { status: 403 });

    const formData = await request.formData();
    const files = formData.getAll("files").filter((value): value is File => value instanceof File);
    const requestedType = String(formData.get("assetType") || "") as AssetType | "";
    const requestedDept = String(formData.get("departmentId") || "");
    const departmentId = isAdmin(user) && requestedDept ? requestedDept : getEffectiveDepartmentId(user);
    const scenesRaw = formData.get("scenes");
    const scenes = serializeScenes(parseScenesField(scenesRaw));
    if (!files.length) throw Object.assign(new Error("请选择上传文件"), { status: 400 });

    const assets = [];
    for (const file of files) {
      const saved = await saveUpload(file);
      const fallbackType = guessAssetType(file, saved.originalName);
      const assetType = requestedType || fallbackType;
      const assetName = nameWithoutExt(saved.originalName);
      const extractedText = await extractDocumentText(file, saved.originalName);
      const autoAliases = assetType === "product_white_image" ? [] : extractNameTokens(assetName);
      const asset = await prisma.knowledgeAsset.create({
        data: {
          assetName,
          originalName: saved.originalName,
          assetType,
          productName: assetType === "product_white_image" ? assetName : null,
          aliases: JSON.stringify(autoAliases),
          storagePath: saved.storagePath,
          mimeType: file.type,
          extractedText,
          departmentId,
          scenes,
          createdById: user.id
        }
      });
      const preview = buildPreview(assetType, saved.originalName, extractedText);
      assets.push({ ...asset, preview });
    }

    return NextResponse.json({
      success: true,
      assets: assets.map((asset) => ({ ...asset, fileUrl: publicFileUrl(asset.storagePath) }))
    });
  } catch (error) {
    return jsonError(error);
  }
}

function parseScenesField(value: FormDataEntryValue | null): string[] {
  if (!value) return [];
  const raw = String(value).trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.map(String) : [];
    } catch {
      return [];
    }
  }
  return raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
}

function guessAssetType(file: File, originalName: string): AssetType {
  const lowerName = originalName.toLowerCase();
  if (imageMimeTypes.has(file.type) || imageExtensions.has(path.extname(lowerName))) return "product_white_image";
  if (file.type.includes("pdf") || lowerName.endsWith(".pdf")) return "pdf";
  if (lowerName.endsWith(".ppt") || lowerName.endsWith(".pptx")) return "ppt";
  if (lowerName.endsWith(".xls") || lowerName.endsWith(".xlsx") || lowerName.endsWith(".xlsm")) return "excel";
  return "document";
}

function buildPreview(assetType: string, originalName: string, extractedText: string): ExcelPreview | null {
  if (!isExcelAssetType(assetType) && !isExcelFileName(originalName)) return null;
  return parseExcelPreview(extractedText);
}

function extractNameTokens(assetName: string): string[] {
  const cleaned = String(assetName || "").replace(/[_\-\s]+/g, " ");
  const parts: string[] = [];
  const chineseMatches = cleaned.match(/[一-鿿]{2,}/g) || [];
  parts.push(...chineseMatches);
  const alnumMatches = cleaned.match(/[A-Za-z]{2,}[A-Za-z0-9]*|[0-9]{4,}/g) || [];
  parts.push(...alnumMatches);
  return Array.from(new Set(parts)).filter(Boolean).slice(0, 5);
}
