// 每日增量同步: 拉 T-7 ~ T-2 数据 (7 天窗口应对 OceanEngine 数据回传延迟)
// 计划: cron 每日 04:00 跑一次; 数据永远写到 T-2, 实时 API 兜 T-1/T-0
// 幂等: INSERT ... ON DUPLICATE KEY UPDATE, 重复跑无副作用

import { prisma } from "../lib/prisma";
import { closeMysqlPool } from "../lib/qianchuan/snapshot-store";
import { syncRange } from "../lib/qianchuan/snapshot-sync";
import { syncAdvertiserAndAnchors, listAdvertiserIds } from "../lib/qianchuan/snapshot-sync-iter";

async function syncOne(advertiserId: string): Promise<void> {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 7);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  console.log(`[daily] advertiser=${advertiserId} range=${startDate}~${endDate}`);
  const summary = await syncAdvertiserAndAnchors(advertiserId, (anchorId) =>
    syncRange({
      advertiserId,
      anchorId,
      smartBidType: "0",
      startDate,
      endDate,
      source: "api"
    })
  );
  console.log(
    `[daily] advertiser=${advertiserId} upserted=${summary.totalUpserted} rate-limit=${summary.totalRateLimited} skip=${summary.totalSkipped}`
  );
}

async function main(): Promise<void> {
  const advertiserIds = await listAdvertiserIds();
  console.log(`[daily] ${advertiserIds.length} advertisers to process`);
  if (advertiserIds.length === 0) {
    console.log("[daily] no advertisers in QianchuanAdvertiser, nothing to do");
    return;
  }
  for (const id of advertiserIds) {
    try {
      await syncOne(id);
    } catch (e) {
      console.error(`[daily] advertiser=${id} failed:`, (e as Error).message);
    }
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
    await closeMysqlPool();
  })
  .catch(async (error) => {
    console.error("[daily] failed", error);
    await prisma.$disconnect();
    await closeMysqlPool();
    process.exit(1);
  });
