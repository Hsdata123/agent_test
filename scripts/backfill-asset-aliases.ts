import { prisma } from "../lib/prisma";

function extractNameTokens(assetName: string): string[] {
  const cleaned = String(assetName || "").replace(/[_\-\s]+/g, " ");
  const parts: string[] = [];
  const chineseMatches = cleaned.match(/[一-鿿]{2,}/g) || [];
  parts.push(...chineseMatches);
  const alnumMatches = cleaned.match(/[A-Za-z]{2,}[A-Za-z0-9]*|[0-9]{4,}/g) || [];
  parts.push(...alnumMatches);
  return Array.from(new Set(parts)).filter(Boolean).slice(0, 5);
}

function parseAliases(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function main() {
  const candidates = await prisma.knowledgeAsset.findMany({
    where: { assetType: { not: "product_white_image" } },
    select: { id: true, assetName: true, aliases: true, assetType: true }
  });

  let updated = 0;
  let skippedNonEmpty = 0;
  let skippedNoTokens = 0;

  for (const asset of candidates) {
    const existing = parseAliases(asset.aliases);
    if (existing.length > 0) {
      skippedNonEmpty++;
      continue;
    }
    const tokens = extractNameTokens(asset.assetName);
    if (!tokens.length) {
      skippedNoTokens++;
      continue;
    }
    await prisma.knowledgeAsset.update({
      where: { id: asset.id },
      data: { aliases: JSON.stringify(tokens) }
    });
    updated++;
    console.log(`[backfill] (${asset.assetType}) ${asset.assetName} → ${JSON.stringify(tokens)}`);
  }

  console.log(
    `[backfill] done: candidates=${candidates.length}, updated=${updated}, skippedNonEmpty=${skippedNonEmpty}, skippedNoTokens=${skippedNoTokens}`
  );
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("[backfill] failed", error);
    await prisma.$disconnect();
    process.exit(1);
  });
