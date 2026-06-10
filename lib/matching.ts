import type { KnowledgeAsset } from "@prisma/client";
import { prisma } from "./prisma";

function normalize(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function parseJsonList(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function pickPreferred(candidates: KnowledgeAsset[]) {
  return candidates.sort((a, b) => Number(b.preferred) - Number(a.preferred) || Number(b.enabled) - Number(a.enabled))[0];
}

export async function findAssetMatch(productName: string) {
  const target = normalize(productName);
  const assets = await prisma.knowledgeAsset.findMany({
    where: { assetType: "product_white_image", enabled: true }
  });

  const exactByAsset = assets.filter((asset) => normalize(asset.assetName) === target);
  if (exactByAsset.length) return { asset: pickPreferred(exactByAsset), matchType: "exact_name" as const, score: 1 };

  const exactByProduct = assets.filter((asset) => normalize(asset.productName) === target);
  if (exactByProduct.length) return { asset: pickPreferred(exactByProduct), matchType: "product_name" as const, score: 1 };

  const aliasHit = assets.find((asset) => parseJsonList(asset.aliases).some((alias) => normalize(alias) === target));
  if (aliasHit) return { asset: aliasHit, matchType: "alias" as const, score: 0.92 };

  const fuzzyHit = assets.find((asset) => {
    const fields = [asset.assetName, asset.productName, ...parseJsonList(asset.aliases)].map(normalize);
    return fields.some((field) => field.includes(target) || target.includes(field));
  });
  if (fuzzyHit) return { asset: fuzzyHit, matchType: "fuzzy" as const, score: 0.72 };

  return { asset: null, matchType: "none" as const, score: 0 };
}
