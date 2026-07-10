// 一次性脚本: 把现有 qianchuan_uni_promotion_video_data 表(170,687 行 / 2025-07~12)
// 的数据导入到新建的 QianchuanDailySnapshot 表
// anchorId 留空(现有表没抖音号字段),source='import' 标记来源
// 幂等: 用 INSERT ... ON DUPLICATE KEY UPDATE, 重复跑不会重复

import type { RowDataPacket } from "mysql2";
import { closeMysqlPool, getMysqlPool } from "../lib/qianchuan/snapshot-store";

const SOURCE = "import";

async function importHistory(): Promise<void> {
  const pool = getMysqlPool();
  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM qianchuan_uni_promotion_video_data`
  );
  const total = Number(countRows[0]?.total) || 0;
  console.log(`[import-history] source rows: ${total}`);
  if (total === 0) {
    console.log("[import-history] source table empty, nothing to do");
    return;
  }

  const [rangeRows] = await pool.query<RowDataPacket[]>(
    `SELECT MIN(stat_time_day) AS first_date, MAX(stat_time_day) AS last_date
     FROM qianchuan_uni_promotion_video_data WHERE stat_time_day IS NOT NULL`
  );
  console.log(`[import-history] date range: ${rangeRows[0]?.first_date} ~ ${rangeRows[0]?.last_date}`);

  console.log("[import-history] starting INSERT ... ON DUPLICATE KEY UPDATE ...");
  const start = Date.now();
  const [result] = await pool.query(
    `INSERT INTO QianchuanDailySnapshot
       (advertiserId, anchorId, anchorName, materialId, materialName, videoType,
        statDate, smartBidType, cost, gmv, orderCount, roi2,
        couponAmount, subsidyAmount, showCount, clickCount, ecpm, cpc, source, syncedAt)
     SELECT
       CAST(advertiser_id AS CHAR), '', '', material_id, video_name, video_type,
       stat_time_day, '0',
       COALESCE(stat_cost, 0), COALESCE(pay_order_gmv, 0), COALESCE(pay_order_cnt, 0),
       COALESCE(prepay_pay_roi2, 0),
       COALESCE(pay_order_coupon_amount, 0), COALESCE(ecom_subsidy_amount, 0),
       COALESCE(live_show_cnt, 0), COALESCE(live_watch_cnt, 0),
       COALESCE(total_ecpm, 0), COALESCE(total_cpc, 0),
       ?, NOW()
     FROM qianchuan_uni_promotion_video_data
     WHERE stat_time_day IS NOT NULL
     ON DUPLICATE KEY UPDATE
       materialName = VALUES(materialName),
       videoType = VALUES(videoType),
       cost = VALUES(cost),
       gmv = VALUES(gmv),
       orderCount = VALUES(orderCount),
       roi2 = VALUES(roi2),
       couponAmount = VALUES(couponAmount),
       subsidyAmount = VALUES(subsidyAmount),
       showCount = VALUES(showCount),
       clickCount = VALUES(clickCount),
       ecpm = VALUES(ecpm),
       cpc = VALUES(cpc),
       source = VALUES(source),
       syncedAt = NOW()`,
    [SOURCE]
  );
  const r = result as { affectedRows?: number };
  console.log(
    `[import-history] done in ${((Date.now() - start) / 1000).toFixed(1)}s, affected=${r.affectedRows ?? "?"}`
  );

  const [snapRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM QianchuanDailySnapshot WHERE source = ?`,
    [SOURCE]
  );
  console.log(`[import-history] snapshot rows with source='${SOURCE}': ${snapRows[0]?.total}`);
}

async function main(): Promise<void> {
  await importHistory();
}

main()
  .finally(async () => {
    await closeMysqlPool();
  })
  .catch(async (error) => {
    console.error("[import-history] failed", error);
    await closeMysqlPool();
    process.exit(1);
  });
