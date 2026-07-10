import { findAnchorByExactName, findAnchorById, findAnchorsByName, type QianchuanAnchor } from "./token-store";

export type AnchorResolveResult =
  | { ok: true; anchorId: string; anchorName: string; ambiguous?: false }
  | { ok: false; reason: "empty" | "ambiguous" | "not_found"; candidates?: QianchuanAnchor[] };

export function isLikelyAnchorId(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (!/^\d+$/.test(v)) return false;
  return v.length >= 8 && v.length <= 24;
}

export async function resolveAnchor(
  advertiserId: string,
  input: string
): Promise<AnchorResolveResult> {
  const value = input.trim();
  if (!value) return { ok: false, reason: "empty" };

  if (isLikelyAnchorId(value)) {
    const known = await findAnchorById(advertiserId, value);
    return {
      ok: true,
      anchorId: value,
      anchorName: known?.anchorName ?? ""
    };
  }

  const exact = await findAnchorByExactName(advertiserId, value);
  if (exact) {
    return { ok: true, anchorId: exact.anchorId, anchorName: exact.anchorName };
  }

  const candidates = await findAnchorsByName(advertiserId, value);
  if (candidates.length === 1) {
    return {
      ok: true,
      anchorId: candidates[0].anchorId,
      anchorName: candidates[0].anchorName
    };
  }
  if (candidates.length > 1) {
    return { ok: false, reason: "ambiguous", candidates };
  }
  return { ok: false, reason: "not_found" };
}