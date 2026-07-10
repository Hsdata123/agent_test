// snapshot-sync.ts: 从 OceanEngine API 拉数据 upsert 到 QianchuanDailySnapshot
// - 复用现有 callOceanEngine + qianchuan-material.ts 的分页循环
// - 限流: 令牌桶 (default 10 QPS), 见 rate-limiter.ts
// - 退避: 遇 OceanEngineError(apiCode 在 {429,5xx}) 指数退避 1s/2s/4s,最多 3 次
// - 时间边界: endDate 自动截到昨天, 永远不写"今天" (T-0)

import { callOceanEngine, OceanEngineError } from "./oceanengine-client";
import { getTokenByAdvertiser } from "./token-store";
import { getOceanEngineLimiter } from "./rate-limiter";
import { getMysqlPool } from "./snapshot-store";

export type SyncSource = "api" | "backfill" | "import";

export type SyncRangeParams = {
  advertiserId: string;
  anchorId?: string;
  smartBidType: string;
  startDate: string;
  endDate: string;
  source?: SyncSource;
};

type ApiRow = {
  dimensions: Record<string, unknown>;
  metrics: Record<string, unknown>;
};

type PageInfo = { total_number?: number; total_page?: number };

type ApiResponse = { rows?: ApiRow[]; page_info?: PageInfo };

const ACCOUNT_SENTINEL = "_ACCOUNT_";
const MAX_RETRIES = 3;

function yesterdayStr(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function clampEndDate(endDate: string): string {
  const y = yesterdayStr();
  return endDate > y ? y : endDate;
}

function pickNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function pickStr(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return fallback;
}

export async function syncRange(params: SyncRangeParams): Promise<{ upserted: number; rateLimited: number; skipped: number }> {
  const {
    advertiserId,
    anchorId = "",
    smartBidType,
    startDate,
    endDate,
    source = "api"
  } = params;
  const safeEnd = clampEndDate(endDate);
  if (startDate > safeEnd) {
    return { upserted: 0, rateLimited: 0, skipped: 0 };
  }
  const token = await getTokenByAdvertiser(advertiserId);
  if (!token) {
    console.warn(`[sync] no token for advertiserId=${advertiserId}, skip`);
    return { upserted: 0, rateLimited: 0, skipped: 0 };
  }
  const limiter = getOceanEngineLimiter();
  const allRows: ApiRow[] = [];
  const pageSize = 200;
  let page = 1;
  let totalNumber = Infinity;
  let rateLimited = 0;
  let skipped = 0;

  const filters: Array<{ field: string; operator: number; values: string[] }> = [
    { field: "ecp_app_id", operator: 7, values: ["1"] },
    { field: "aggregate_smart_bid_type", operator: 7, values: [smartBidType] }
  ];
  if (anchorId) filters.push({ field: "anchor_id", operator: 7, values: [anchorId] });

  const dimensions = ["stat_time_day", "roi2_material_video_name", "roi2_material_video_type", "material_id"];
  const metrics = [
    "stat_cost_for_roi2",
    "total_pay_order_gmv_for_roi2",
    "total_pay_order_count_for_roi2",
    "total_prepay_and_pay_order_roi2",
    "total_pay_order_coupon_amount_for_roi2",
    "total_ecom_platform_subsidy_amount_for_roi2",
    "live_show_count_for_roi2_v2",
    "live_watch_count_for_roi2_v2",
    "total_ecpm_for_roi2",
    "total_cpc_for_roi2"
  ];

  while (allRows.length < totalNumber) {
    let attempt = 0;
    let data: ApiResponse | null = null;
    while (attempt < MAX_RETRIES) {
      attempt += 1;
      try {
        await limiter.acquire();
        data = await callOceanEngine<ApiResponse>({
          appId: token.appId,
          endpoint: "v1.0/qianchuan/report/uni_promotion/data/get/",
          params: {
            advertiser_id: advertiserId,
            data_topic: "SITE_PROMOTION_POST_DATA_VIDEO",
            dimensions: JSON.stringify(dimensions),
            metrics: JSON.stringify(metrics),
            filters: JSON.stringify(filters),
            start_time: `${startDate} 00:00:00`,
            end_time: `${safeEnd} 23:59:59`,
            page,
            page_size: pageSize,
            order_by: JSON.stringify([{ type: 1, field: "stat_time_day" }])
          },
          skipCache: true
        });
        break;
      } catch (e) {
        const err = e as OceanEngineError;
        const code = err.apiCode;
        const status = err.status;
        const transient = code === 429 || code === 40001 || code === 40002 || (status !== undefined && status >= 500);
        if (!transient || attempt >= MAX_RETRIES) {
          console.error(`[sync] page=${page} failed (code=${code} status=${status}): ${err.message}`);
          skipped += 1;
          data = null;
          break;
        }
        rateLimited += 1;
        const backoffMs = 1000 * Math.pow(2, attempt - 1);
        console.warn(`[sync] rate-limited (code=${code}) attempt=${attempt}, backoff=${backoffMs}ms`);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
    if (!data) break;
    const rows = Array.isArray(data.rows) ? data.rows : [];
    allRows.push(...rows);
    const totalPages = data.page_info?.total_page ?? 1;
    totalNumber = data.page_info?.total_number ?? allRows.length;
    if (rows.length < pageSize || page >= totalPages) break;
    page += 1;
  }

  if (allRows.length === 0) {
    console.log(`[sync] ${advertiserId} ${anchorId || "(account)"} ${startDate}~${safeEnd} no rows`);
    return { upserted: 0, rateLimited, skipped };
  }

  const upserted = await upsertRows(allRows, {
    advertiserId,
    anchorId,
    anchorName: "",
    smartBidType,
    source
  });
  console.log(`[sync] ${advertiserId} ${anchorId || "(account)"} ${startDate}~${safeEnd} +${upserted} rows (rate-limit=${rateLimited} skip=${skipped})`);
  return { upserted, rateLimited, skipped };
}

async function upsertRows(
  rows: ApiRow[],
  meta: { advertiserId: string; anchorId: string; anchorName: string; smartBidType: string; source: SyncSource }
): Promise<number> {
  const pool = getMysqlPool();
  const conn = await pool.getConnection();
  let upserted = 0;
  try {
    await conn.beginTransaction();
    for (const row of rows) {
      const dim = row.dimensions || {};
      const met = row.metrics || {};
      const materialId = pickStr(dim.material_id, ACCOUNT_SENTINEL);
      const statDate = pickStr(dim.stat_time_day);
      if (!statDate) continue;
      const materialName = pickStr(dim.roi2_material_video_name);
      const videoType = pickStr(dim.roi2_material_video_type);
      await conn.query(
        `INSERT INTO QianchuanDailySnapshot
          (advertiserId, anchorId, anchorName, materialId, materialName, videoType,
           statDate, smartBidType, cost, gmv, orderCount, roi2,
           couponAmount, subsidyAmount, showCount, clickCount, ecpm, cpc, source, syncedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           anchorName = VALUES(anchorName),
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
        [
          meta.advertiserId,
          meta.anchorId,
          meta.anchorName,
          materialId,
          materialName,
          videoType,
          statDate,
          meta.smartBidType,
          pickNum(met.stat_cost_for_roi2),
          pickNum(met.total_pay_order_gmv_for_roi2),
          pickNum(met.total_pay_order_count_for_roi2),
          pickNum(met.total_prepay_and_pay_order_roi2),
          pickNum(met.total_pay_order_coupon_amount_for_roi2),
          pickNum(met.total_ecom_platform_subsidy_amount_for_roi2),
          pickNum(met.live_show_count_for_roi2_v2),
          pickNum(met.live_watch_count_for_roi2_v2),
          pickNum(met.total_ecpm_for_roi2),
          pickNum(met.total_cpc_for_roi2),
          meta.source
        ]
      );
      upserted += 1;
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return upserted;
}

export async function syncBackfill(advertiserId: string, sinceDays = 30): Promise<void> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - sinceDays);
  const startDate = since.toISOString().slice(0, 10);
  const endDate = yesterdayStr();
  console.log(`[backfill] advertiser=${advertiserId} range=${startDate}~${endDate}`);
  const { syncAdvertiserAndAnchors } = await import("./snapshot-sync-iter");
  await syncAdvertiserAndAnchors(advertiserId, (anchorId) =>
    syncRange({
      advertiserId,
      anchorId,
      smartBidType: "0",
      startDate,
      endDate,
      source: "backfill"
    })
  );
}

export async function syncDailyIncrement(advertiserId: string): Promise<void> {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 7);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  console.log(`[daily] advertiser=${advertiserId} range=${startDate}~${endDate}`);
  const { syncAdvertiserAndAnchors } = await import("./snapshot-sync-iter");
  await syncAdvertiserAndAnchors(advertiserId, (anchorId) =>
    syncRange({
      advertiserId,
      anchorId,
      smartBidType: "0",
      startDate,
      endDate,
      source: "api"
    })
  );
}
