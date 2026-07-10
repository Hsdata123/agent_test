// QianchuanDailySnapshot 读 API
// 用 mysql2 直连 oceanengine_api 库,与应用主库 (SQLite) 分离 (Phase 2 会统一)
// 行格式: 把 MySQL snake_case 行映射成现有 format.ts 期望的 API 兼容格式
//   { dimensions: { stat_time_day, anchor_id, material_id, material_name, video_type },
//     metrics: { stat_cost_for_roi2, total_pay_order_gmv_for_roi2, ... } }

import mysql, { Pool, RowDataPacket } from "mysql2/promise";

type SnapshotRow = RowDataPacket & {
  advertiserId: string;
  anchorId: string;
  anchorName: string | null;
  materialId: string;
  materialName: string | null;
  videoType: string | null;
  statDate: string;
  smartBidType: string;
  cost: string | number;
  gmv: string | number;
  orderCount: string | number;
  roi2: string | number;
  couponAmount: string | number;
  subsidyAmount: string | number;
  showCount: string | number;
  clickCount: string | number;
  ecpm: string | number;
  cpc: string | number;
  source: string;
};

export type ApiCompatRow = {
  dimensions: {
    stat_time_day: string;
    anchor_id: string;
    material_id: string;
    roi2_material_video_name: string;
    roi2_material_video_type: string;
  };
  metrics: Record<string, number>;
};

let _pool: Pool | null = null;

export function getMysqlPool(): Pool {
  if (_pool) return _pool;
  _pool = mysql.createPool({
    host: process.env.MYSQL_HOST || "localhost",
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "123456",
    database: process.env.MYSQL_DATABASE || "oceanengine_api",
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0,
    dateStrings: true
  });
  return _pool;
}

function asNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function rowToApi(row: SnapshotRow): ApiCompatRow {
  const cost = asNum(row.cost);
  const gmv = asNum(row.gmv);
  const orderCount = asNum(row.orderCount);
  const couponAmount = asNum(row.couponAmount);
  const subsidyAmount = asNum(row.subsidyAmount);
  const showCount = asNum(row.showCount);
  const clickCount = asNum(row.clickCount);
  const ecpm = asNum(row.ecpm);
  const cpc = asNum(row.cpc);
  return {
    dimensions: {
      stat_time_day: row.statDate,
      anchor_id: row.anchorId || "",
      material_id: row.materialId,
      roi2_material_video_name: row.materialName || "",
      roi2_material_video_type: row.videoType || ""
    },
    metrics: {
      stat_cost_for_roi2: cost,
      total_pay_order_gmv_for_roi2: gmv,
      total_pay_order_count_for_roi2: orderCount,
      total_prepay_and_pay_order_roi2: asNum(row.roi2),
      total_pay_order_coupon_amount_for_roi2: couponAmount,
      total_ecom_platform_subsidy_amount_for_roi2: subsidyAmount,
      live_show_count_for_roi2_v2: showCount,
      live_watch_count_for_roi2_v2: clickCount,
      total_ecpm_for_roi2: ecpm,
      total_cpc_for_roi2: cpc
    }
  };
}

export type SnapshotQueryParams = {
  advertiserId: string;
  smartBidType: string;
  startDate: string;
  endDate: string;
};

export type MaterialSnapshotQuery = SnapshotQueryParams & {
  anchorId: string;
};

export type MaterialDetailSnapshotQuery = MaterialSnapshotQuery & {
  materialId: string;
};

export type FreshnessResult = {
  latestDate: string | null;
  rowCount: number;
  ageDays: number | null;
};

const ACCOUNT_SENTINEL = "_ACCOUNT_";

export async function queryMaterialSnapshots(params: MaterialSnapshotQuery): Promise<ApiCompatRow[]> {
  const pool = getMysqlPool();
  const [rows] = await pool.query<SnapshotRow[]>(
    `SELECT * FROM QianchuanDailySnapshot
     WHERE advertiserId = ? AND anchorId = ?
       AND smartBidType = ?
       AND statDate BETWEEN ? AND ?
       AND materialId <> ?
     ORDER BY statDate ASC, materialId ASC`,
    [params.advertiserId, params.anchorId, params.smartBidType, params.startDate, params.endDate, ACCOUNT_SENTINEL]
  );
  return rows.map(rowToApi);
}

export async function queryAccountSnapshots(params: SnapshotQueryParams): Promise<ApiCompatRow[]> {
  const pool = getMysqlPool();
  const [rows] = await pool.query<SnapshotRow[]>(
    `SELECT * FROM QianchuanDailySnapshot
     WHERE advertiserId = ?
       AND smartBidType = ?
       AND statDate BETWEEN ? AND ?
       AND materialId = ?
     ORDER BY statDate ASC`,
    [params.advertiserId, params.smartBidType, params.startDate, params.endDate, ACCOUNT_SENTINEL]
  );
  return rows.map(rowToApi);
}

export async function queryMaterialDetailSnapshots(params: MaterialDetailSnapshotQuery): Promise<ApiCompatRow[]> {
  const pool = getMysqlPool();
  const [rows] = await pool.query<SnapshotRow[]>(
    `SELECT * FROM QianchuanDailySnapshot
     WHERE advertiserId = ? AND anchorId = ?
       AND materialId = ?
       AND smartBidType = ?
       AND statDate BETWEEN ? AND ?
     ORDER BY statDate ASC`,
    [
      params.advertiserId,
      params.anchorId,
      params.materialId,
      params.smartBidType,
      params.startDate,
      params.endDate
    ]
  );
  return rows.map(rowToApi);
}

export async function getFreshness(advertiserId: string): Promise<FreshnessResult> {
  const pool = getMysqlPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT MAX(statDate) AS latestDate, COUNT(*) AS rowCount
     FROM QianchuanDailySnapshot WHERE advertiserId = ?`,
    [advertiserId]
  );
  const latestDate = rows[0]?.latestDate ? String(rows[0].latestDate) : null;
  const rowCount = Number(rows[0]?.rowCount) || 0;
  let ageDays: number | null = null;
  if (latestDate) {
    const latest = new Date(latestDate + "T00:00:00Z");
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    ageDays = Math.round((today.getTime() - latest.getTime()) / 86_400_000);
  }
  return { latestDate, rowCount, ageDays };
}

export async function closeMysqlPool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
