// 共享迭代器: 遍历 advertiser × anchor 组合执行同步任务
// 被 backfill / daily-sync 脚本使用,避免循环逻辑重复

import { prisma } from "../prisma";

export async function syncAdvertiserAndAnchors(
  advertiserId: string,
  perAnchor: (anchorId: string | undefined) => Promise<{ upserted: number; rateLimited: number; skipped: number }>
): Promise<{ totalUpserted: number; totalRateLimited: number; totalSkipped: number }> {
  let totalUpserted = 0;
  let totalRateLimited = 0;
  let totalSkipped = 0;
  const anchors = await prisma.qianchuanAnchor.findMany({
    where: { advertiserId },
    select: { anchorId: true }
  });
  const anchorIds = anchors.map((a) => a.anchorId);
  console.log(`[iter] advertiser=${advertiserId} anchors=${anchorIds.length}`);
  await perAnchor(undefined);
  for (const anchorId of anchorIds) {
    try {
      const r = await perAnchor(anchorId);
      totalUpserted += r.upserted;
      totalRateLimited += r.rateLimited;
      totalSkipped += r.skipped;
    } catch (e) {
      console.error(`[iter] anchor=${anchorId} failed:`, (e as Error).message);
      totalSkipped += 1;
    }
  }
  return { totalUpserted, totalRateLimited, totalSkipped };
}

export async function listAdvertiserIds(): Promise<string[]> {
  const rows = await prisma.qianchuanAdvertiser.findMany({ select: { advertiserId: true } });
  return Array.from(new Set(rows.map((r) => r.advertiserId)));
}
