import type { BusinessScene } from "@prisma/client";
import { prisma } from "./prisma";
import { parseScenesString } from "./scenes";

export type DetectedScene = {
  id: string;
  sceneKey: string;
  sceneName: string;
  score: number;
};

const STOP_WORDS = new Set(["的", "了", "是", "在", "和", "或", "与", "及", "我", "你", "他", "她", "它", "把", "把", "给", "从", "到", "用", "做", "什么", "怎么", "如何", "为什么", "哪", "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "at", "by", "is", "are", "was", "were"]);

function normalize(value: string) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function tokenize(value: string): string[] {
  const cleaned = String(value || "").toLowerCase();
  const parts = cleaned
    .split(/[\s,，。.;；:：!?！？、\/\\(){}\[\]"'<>]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !STOP_WORDS.has(t));
  return Array.from(new Set(parts));
}

export async function detectSceneIntent(input: {
  userDepartmentId: string | null;
  isAdmin: boolean;
  query: string;
}): Promise<{ scenes: DetectedScene[]; departmentId: string | null }> {
  const { isAdmin, query, userDepartmentId } = input;
  if (!query || !query.trim()) return { scenes: [], departmentId: userDepartmentId };

  const where = isAdmin ? {} : userDepartmentId ? { departmentId: userDepartmentId } : { id: "__none__" };
  const candidates = await prisma.businessScene.findMany({ where });
  if (!candidates.length) return { scenes: [], departmentId: userDepartmentId };

  const normalizedQuery = normalize(query);
  const tokens = tokenize(query);

  const scored: DetectedScene[] = candidates.map((scene) => {
    const nameNorm = normalize(scene.sceneName);
    const keyNorm = normalize(scene.sceneKey);
    let score = 0;
    if (normalizedQuery && (normalizedQuery.includes(nameNorm) || nameNorm.includes(normalizedQuery))) score += 50;
    if (normalizedQuery && (normalizedQuery.includes(keyNorm) || keyNorm.includes(normalizedQuery))) score += 40;
    for (const token of tokens) {
      if (nameNorm.includes(token)) score += 18;
      if (keyNorm.includes(token)) score += 15;
    }
    return {
      id: scene.id,
      sceneKey: scene.sceneKey,
      sceneName: scene.sceneName,
      score
    };
  });

  const positive = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  return { scenes: positive.slice(0, 5), departmentId: userDepartmentId };
}

export function filterAssetsByScenes<T>(assets: T[], detected: DetectedScene[], getScenes: (item: T) => string | null | undefined): T[] {
  if (!detected.length) return assets;
  const allowedKeys = new Set(detected.map((d) => d.sceneKey));
  return assets.filter((asset) => {
    const raw = getScenes(asset);
    const keys = Array.isArray(raw) ? raw.map(String) : parseScenesString(raw);
    if (!keys.length) return true;
    return keys.some((k) => allowedKeys.has(k));
  });
}
