// 一次性脚本: 首次全量回填 2026 千川数据
// 遍历 QianchuanAdvertiser × QianchuanAnchor × smartBidType, 拉 sinceDays 天数据入库
// 耗时估算: 1 个 anchor × 30 天 × 1 字段组合 ≈ 30 次 API 调用, 10QPS 下 ~3 秒

import { prisma } from "../lib/prisma";
import { closeMysqlPool } from "../lib/qianchuan/snapshot-store";
import { syncRange } from "../lib/qianchuan/snapshot-sync";
import { syncAdvertiserAndAnchors, listAdvertiserIds } from "../lib/qianchuan/snapshot-sync-iter";

const SINCE_DAYS = Number(process.env.QIANCHUAN_BACKFILL_DAYS) || 30;

function yesterdayStr(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function backfillOne(advertiserId: string): Promise<void> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - SINCE_DAYS);
  const startDate = since.toISOString().slice(0, 10);
  const endDate = yesterdayStr();
  console.log(`[backfill] advertiser=${advertiserId} range=${startDate}~${endDate}`);
  const summary = await syncAdvertiserAndAnchors(advertiserId, (anchorId) =>
    syncRange({
      advertiserId,
      anchorId,
      smartBidType: "0",
      startDate,
      endDate,
      source: "backfill"
    })
  );
  console.log(
    `[backfill] advertiser=${advertiserId} upserted=${summary.totalUpserted} rate-limit=${summary.totalRateLimited} skip=${summary.totalSkipped}`
  );
}

async function main(): Promise<void> {
  const advertiserIds = await listAdvertiserIds();
  console.log(`[backfill] ${advertiserIds.length} advertisers to process`);
  if (advertiserIds.length === 0) {
    console.log("[backfill] no advertisers in QianchuanAdvertiser, nothing to do");
    return;
  }
  for (const id of advertiserIds) {
    try {
      await backfillOne(id);
    } catch (e) {
      console.error(`[backfill] advertiser=${id} failed:`, (e as Error).message);
    }
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
    await closeMysqlPool();
  })
  .catch(async (error) => {
    console.error("[backfill] failed", error);
    await prisma.$disconnect();
    await closeMysqlPool();
    process.exit(1);
  });
