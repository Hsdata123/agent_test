import type { KnowledgeAsset } from "@prisma/client";
import { prisma } from "./prisma";
import { parseScenesString } from "./scenes";

export type RankedAsset = {
  asset: KnowledgeAsset;
  score: number;
  truncatedContent: string;
};

export type RetrieveOptions = {
  limit?: number;
  charCap?: number;
  candidateCap?: number;
};

const LIMIT_DEFAULT = 5;
const CANDIDATE_CAP_DEFAULT = 200;
const STOP_TOKENS = new Set(["的", "了", "是", "在", "和", "或", "与", "及", "的", "a", "an", "the", "to", "and", "or", "of"]);

function normalize(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function tokenize(value: string): string[] {
  const cleaned = String(value || "").toLowerCase();
  const parts = cleaned
    .split(/[\s,，。.;；:：!?！？、\/\\(){}\[\]"'<>]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !STOP_TOKENS.has(t));
  return Array.from(new Set(parts));
}

function tryParseList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function retrieveKnowledge(input: {
  userDepartmentId: string | null;
  isAdmin: boolean;
  allowedScenes: string[];
  query: string;
  options?: RetrieveOptions;
}): Promise<RankedAsset[]> {
  const { userDepartmentId, isAdmin, allowedScenes, query, options } = input;
  const limit = options?.limit ?? LIMIT_DEFAULT;
  const charCap = options?.charCap;
  const candidateCap = options?.candidateCap ?? CANDIDATE_CAP_DEFAULT;

  try {
    const where: Record<string, unknown> = { enabled: true };
    if (!isAdmin) {
      if (!userDepartmentId) return [];
      where.departmentId = userDepartmentId;
    }

    const candidates = await prisma.knowledgeAsset.findMany({
      where,
      orderBy: [{ preferred: "desc" }, { updatedAt: "desc" }],
      take: candidateCap
    });

    const normalizedQuery = normalize(query);
    const tokens = tokenize(query);
    const allowedSceneSet = new Set(allowedScenes);

    const ranked: RankedAsset[] = candidates.map((asset) => {
      const nameNorm = normalize(asset.assetName);
      const productNorm = normalize(asset.productName);
      const aliasList = tryParseList(asset.aliases).map(normalize);
      const tagList = tryParseList(asset.tags).map(normalize);
      const scenes = parseScenesString(asset.scenes);
      const content = normalize(asset.extractedText);

      let score = 0;

      if (normalizedQuery && normalizedQuery === nameNorm) score += 100;
      if (aliasList.some((a) => a === normalizedQuery)) score += 80;

      if (tokens.length) {
        for (const token of tokens) {
          if (nameNorm.includes(token)) score += 20;
          if (productNorm.includes(token)) score += 18;
          if (tagList.some((t) => t.includes(token))) score += 12;
        }
      }

      if (aliasList.some((a) => a && (a.includes(normalizedQuery) || normalizedQuery.includes(a)))) {
        score += 30;
      }

      if (scenes.length && allowedSceneSet.size) {
        const overlap = scenes.some((s) => allowedSceneSet.has(s));
        if (overlap) score += 10;
      }

      if (normalizedQuery && content.includes(normalizedQuery)) score += 5;
      if (tokens.length && content) {
        for (const token of tokens) {
          if (content.includes(token)) score += 1;
        }
      }

      if (asset.preferred) score += 50;

      const truncatedContent = charCap ? (asset.extractedText || "").slice(0, charCap) : (asset.extractedText || "");
      return { asset, score, truncatedContent };
    });

    let positive = ranked.filter((r) => r.score > 0).sort((a, b) => b.score - a.score);

    if (positive.length === 0) {
      const fallback = candidates
        .filter((a) => a.preferred)
        .slice(0, limit)
        .map<RankedAsset>((asset) => ({
          asset,
          score: 1,
          truncatedContent: charCap ? (asset.extractedText || "").slice(0, charCap) : (asset.extractedText || "")
        }));
      positive = fallback;
    }

    return positive.slice(0, limit);
  } catch (error) {
    console.warn("[knowledge-retrieval] retrieve failed, falling back to empty", error);
    return [];
  }
}
