// Skill 集成 helper: 把 snapshot-store 接入 skills, 处理 DB/API 分界逻辑
// DB 覆盖 [startDate, T-2], API 覆盖 [T-1, T-0]
// 失败优雅降级: DB 抛错 → 整个 skill 回退到原 API 模式 (caller 决定)

import { getFreshness, queryMaterialSnapshots, queryAccountSnapshots, queryMaterialDetailSnapshots } from "./snapshot-store";
import type { ApiCompatRow } from "./snapshot-store";

export type SplitDateRange = {
  dbStart: string | null; // YYYY-MM-DD 或 null (无 DB 段)
  dbEnd: string | null;
  apiStart: string | null; // YYYY-MM-DD HH:MM:SS 或 null (无 API 段)
  apiEnd: string | null;
  apiBoundary: string; // T-2
  dbMissRange: [string, string]; // 用户视角的 DB 未覆盖范围 (默认 [T-1, T-0])
};

export function getApiBoundary(): { today: string; apiBoundary: string; yesterday: string } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const y = new Date(now);
  y.setUTCDate(y.getUTCDate() - 1);
  const yesterday = y.toISOString().slice(0, 10);
  const b = new Date(now);
  b.setUTCDate(b.getUTCDate() - 2);
  const apiBoundary = b.toISOString().slice(0, 10);
  return { today, apiBoundary, yesterday };
}

export function splitDateRange(startDate: string, endDate: string): SplitDateRange {
  const { apiBoundary, today, yesterday } = getApiBoundary();
  const sDate = startDate.slice(0, 10);
  const eDate = endDate.slice(0, 10);

  let dbStart: string | null = null;
  let dbEnd: string | null = null;
  let apiStart: string | null = null;
  let apiEnd: string | null = null;

  if (eDate <= apiBoundary) {
    dbStart = sDate;
    dbEnd = eDate;
  } else if (sDate > apiBoundary) {
    apiStart = startDate;
    apiEnd = endDate;
  } else {
    dbStart = sDate;
    dbEnd = apiBoundary;
    apiStart = `${yesterday} 00:00:00`;
    apiEnd = endDate;
  }

  return {
    dbStart,
    dbEnd,
    apiStart,
    apiEnd,
    apiBoundary,
    dbMissRange: [yesterday, today]
  };
}

export type MaterialDbMeta = {
  dbHit: boolean;
  dbMissRange: [string, string];
  dataAsOf: string;
  snapshotFreshness: string | null;
  snapshotAgeDays: number | null;
  dbRowCount: number;
  apiRowCount: number;
};

export async function fetchMaterialRowsWithDbFirst(params: {
  advertiserId: string;
  anchorId: string;
  smartBidType: string;
  startDate: string;
  endDate: string;
  apiFetcher: (startDate: string, endDate: string) => Promise<ApiCompatRow[]>;
}): Promise<{ rows: ApiCompatRow[]; meta: MaterialDbMeta; usedApiFallback: boolean }> {
  const split = splitDateRange(params.startDate, params.endDate);
  let dbRows: ApiCompatRow[] = [];
  let apiRows: ApiCompatRow[] = [];
  let usedApiFallback = false;
  const dataAsOf = new Date().toISOString();

  if (split.dbStart && split.dbEnd) {
    try {
      dbRows = await queryMaterialSnapshots({
        advertiserId: params.advertiserId,
        anchorId: params.anchorId,
        smartBidType: params.smartBidType,
        startDate: split.dbStart,
        endDate: split.dbEnd
      });
    } catch (e) {
      console.error("[snapshot] db query failed, falling back to full API:", (e as Error).message);
      usedApiFallback = true;
      const all = await params.apiFetcher(params.startDate, params.endDate);
      return {
        rows: all,
        usedApiFallback: true,
        meta: {
          dbHit: false,
          dbMissRange: [split.dbStart, split.dbEnd],
          dataAsOf,
          snapshotFreshness: null,
          snapshotAgeDays: null,
          dbRowCount: 0,
          apiRowCount: all.length
        }
      };
    }
  }

  if (split.apiStart && split.apiEnd) {
    apiRows = await params.apiFetcher(split.apiStart, split.apiEnd);
  }

  let freshness: { latestDate: string | null; ageDays: number | null } = { latestDate: null, ageDays: null };
  if (dbRows.length > 0 || (!split.apiStart && split.dbStart)) {
    try {
      const f = await getFreshness(params.advertiserId);
      freshness = { latestDate: f.latestDate, ageDays: f.ageDays };
    } catch {
      // 忽略
    }
  }

  const rows = [...dbRows, ...apiRows];
  return {
    rows,
    usedApiFallback,
    meta: {
      dbHit: dbRows.length > 0,
      dbMissRange: split.dbMissRange,
      dataAsOf,
      snapshotFreshness: freshness.latestDate,
      snapshotAgeDays: freshness.ageDays,
      dbRowCount: dbRows.length,
      apiRowCount: apiRows.length
    }
  };
}

export async function fetchMaterialDetailRowsWithDbFirst(params: {
  advertiserId: string;
  anchorId: string;
  materialId: string;
  smartBidType: string;
  startDate: string;
  endDate: string;
  apiFetcher: (startDate: string, endDate: string) => Promise<ApiCompatRow[]>;
}): Promise<{ rows: ApiCompatRow[]; meta: MaterialDbMeta; usedApiFallback: boolean }> {
  const split = splitDateRange(params.startDate, params.endDate);
  let dbRows: ApiCompatRow[] = [];
  let apiRows: ApiCompatRow[] = [];
  let usedApiFallback = false;
  const dataAsOf = new Date().toISOString();

  if (split.dbStart && split.dbEnd) {
    try {
      dbRows = await queryMaterialDetailSnapshots({
        advertiserId: params.advertiserId,
        anchorId: params.anchorId,
        materialId: params.materialId,
        smartBidType: params.smartBidType,
        startDate: split.dbStart,
        endDate: split.dbEnd
      });
    } catch (e) {
      console.error("[snapshot] db query failed, falling back to full API:", (e as Error).message);
      usedApiFallback = true;
      const all = await params.apiFetcher(params.startDate, params.endDate);
      return {
        rows: all,
        usedApiFallback: true,
        meta: {
          dbHit: false,
          dbMissRange: [split.dbStart, split.dbEnd],
          dataAsOf,
          snapshotFreshness: null,
          snapshotAgeDays: null,
          dbRowCount: 0,
          apiRowCount: all.length
        }
      };
    }
  }

  if (split.apiStart && split.apiEnd) {
    apiRows = await params.apiFetcher(split.apiStart, split.apiEnd);
  }

  let freshness: { latestDate: string | null; ageDays: number | null } = { latestDate: null, ageDays: null };
  if (dbRows.length > 0 || (!split.apiStart && split.dbStart)) {
    try {
      const f = await getFreshness(params.advertiserId);
      freshness = { latestDate: f.latestDate, ageDays: f.ageDays };
    } catch {
      // 忽略
    }
  }

  const rows = [...dbRows, ...apiRows];
  return {
    rows,
    usedApiFallback,
    meta: {
      dbHit: dbRows.length > 0,
      dbMissRange: split.dbMissRange,
      dataAsOf,
      snapshotFreshness: freshness.latestDate,
      snapshotAgeDays: freshness.ageDays,
      dbRowCount: dbRows.length,
      apiRowCount: apiRows.length
    }
  };
}

export type AccountAggregateRow = {
  stat_cost: number;
  total_prepay_and_pay_order_roi2: number;
  total_pay_order_gmv_for_roi2: number;
  total_pay_order_count_for_roi2: number;
  total_pay_order_coupon_amount_for_roi2: number;
  total_ecom_platform_subsidy_amount_for_roi2: number;
};

export function aggregateRowsToAccountData(rows: ApiCompatRow[]): AccountAggregateRow {
  const out: AccountAggregateRow = {
    stat_cost: 0,
    total_prepay_and_pay_order_roi2: 0,
    total_pay_order_gmv_for_roi2: 0,
    total_pay_order_count_for_roi2: 0,
    total_pay_order_coupon_amount_for_roi2: 0,
    total_ecom_platform_subsidy_amount_for_roi2: 0
  };
  for (const row of rows) {
    out.stat_cost += Number(row.metrics.stat_cost_for_roi2) || 0;
    out.total_pay_order_gmv_for_roi2 += Number(row.metrics.total_pay_order_gmv_for_roi2) || 0;
    out.total_pay_order_count_for_roi2 += Number(row.metrics.total_pay_order_count_for_roi2) || 0;
    out.total_pay_order_coupon_amount_for_roi2 += Number(row.metrics.total_pay_order_coupon_amount_for_roi2) || 0;
    out.total_ecom_platform_subsidy_amount_for_roi2 += Number(row.metrics.total_ecom_platform_subsidy_amount_for_roi2) || 0;
  }
  if (out.stat_cost > 0) {
    out.total_prepay_and_pay_order_roi2 = out.total_pay_order_gmv_for_roi2 / out.stat_cost;
  }
  return out;
}

export async function fetchAccountDataWithDbFirst(params: {
  advertiserId: string;
  smartBidType: string;
  startDate: string;
  endDate: string;
  apiFetcher: (startDate: string, endDate: string) => Promise<AccountAggregateRow>;
}): Promise<{ data: AccountAggregateRow; meta: MaterialDbMeta; usedApiFallback: boolean }> {
  const split = splitDateRange(params.startDate, params.endDate);
  let dbRows: ApiCompatRow[] = [];
  let apiData: AccountAggregateRow | null = null;
  let usedApiFallback = false;
  const dataAsOf = new Date().toISOString();

  if (split.dbStart && split.dbEnd) {
    try {
      dbRows = await queryAccountSnapshots({
        advertiserId: params.advertiserId,
        smartBidType: params.smartBidType,
        startDate: split.dbStart,
        endDate: split.dbEnd
      });
    } catch (e) {
      console.error("[snapshot] account db query failed, falling back to full API:", (e as Error).message);
      usedApiFallback = true;
      const all = await params.apiFetcher(params.startDate, params.endDate);
      return {
        data: all,
        usedApiFallback: true,
        meta: {
          dbHit: false,
          dbMissRange: [split.dbStart, split.dbEnd],
          dataAsOf,
          snapshotFreshness: null,
          snapshotAgeDays: null,
          dbRowCount: 0,
          apiRowCount: -1
        }
      };
    }
  }

  if (split.apiStart && split.apiEnd) {
    apiData = await params.apiFetcher(split.apiStart, split.apiEnd);
  }

  let freshness: { latestDate: string | null; ageDays: number | null } = { latestDate: null, ageDays: null };
  if (dbRows.length > 0 || (!split.apiStart && split.dbStart)) {
    try {
      const f = await getFreshness(params.advertiserId);
      freshness = { latestDate: f.latestDate, ageDays: f.ageDays };
    } catch {
      // 忽略
    }
  }

  const dbAgg = aggregateRowsToAccountData(dbRows);
  const combined: AccountAggregateRow = {
    stat_cost: dbAgg.stat_cost + (apiData?.stat_cost ?? 0),
    total_prepay_and_pay_order_roi2: 0,
    total_pay_order_gmv_for_roi2: dbAgg.total_pay_order_gmv_for_roi2 + (apiData?.total_pay_order_gmv_for_roi2 ?? 0),
    total_pay_order_count_for_roi2: dbAgg.total_pay_order_count_for_roi2 + (apiData?.total_pay_order_count_for_roi2 ?? 0),
    total_pay_order_coupon_amount_for_roi2: dbAgg.total_pay_order_coupon_amount_for_roi2 + (apiData?.total_pay_order_coupon_amount_for_roi2 ?? 0),
    total_ecom_platform_subsidy_amount_for_roi2: dbAgg.total_ecom_platform_subsidy_amount_for_roi2 + (apiData?.total_ecom_platform_subsidy_amount_for_roi2 ?? 0)
  };
  if (combined.stat_cost > 0) {
    combined.total_prepay_and_pay_order_roi2 = combined.total_pay_order_gmv_for_roi2 / combined.stat_cost;
  }

  return {
    data: combined,
    usedApiFallback,
    meta: {
      dbHit: dbRows.length > 0,
      dbMissRange: split.dbMissRange,
      dataAsOf,
      snapshotFreshness: freshness.latestDate,
      snapshotAgeDays: freshness.ageDays,
      dbRowCount: dbRows.length,
      apiRowCount: apiData ? 1 : 0
    }
  };
}
