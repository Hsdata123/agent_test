import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { extractDocumentText } from "./document-extract";
import { prisma } from "./prisma";

export function needsReextract(text: string | null | undefined) {
  if (!text) return true;
  return text.includes("暂不解析二进制全文") || text.includes("当前本地测试版已把该文件作为对话资料保存");
}

export async function refreshAssetText<T extends { id: string; originalName: string; storagePath: string; mimeType: string | null; extractedText: string | null }>(
  asset: T
): Promise<T> {
  if (!needsReextract(asset.extractedText)) return asset;
  try {
    const buffer = await readFile(asset.storagePath);
    const originalName = asset.originalName || basename(asset.storagePath);
    const file = new File([buffer], originalName, { type: asset.mimeType || "" });
    const extractedText = await extractDocumentText(file, originalName);
    if (!extractedText || extractedText === asset.extractedText) return asset;
    await prisma.knowledgeAsset.update({ where: { id: asset.id }, data: { extractedText } });
    return { ...asset, extractedText };
  } catch {
    return asset;
  }
}

export async function refreshAssetsText<T extends { id: string; originalName: string; storagePath: string; mimeType: string | null; extractedText: string | null }>(
  assets: T[]
): Promise<T[]> {
  return Promise.all(assets.map((asset) => refreshAssetText(asset)));
}
