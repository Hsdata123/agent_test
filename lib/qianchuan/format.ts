type Dim = { Value?: string | number; ValueStr?: string };
type DimValue = Dim | string | number | null | undefined;

export function formatYuan(v: number): string {
  if (!Number.isFinite(v)) return "¥-";
  return "¥" + v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatInt(v: number): string {
  if (!Number.isFinite(v)) return "-";
  return Math.round(v).toLocaleString("zh-CN");
}

export function formatPercent(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "-";
  return (v * 100).toFixed(digits) + "%";
}

type AccountRow = {
  stat_cost?: number | string | null;
  total_prepay_and_pay_order_roi2?: number | string | null;
  total_pay_order_gmv_for_roi2?: number | string | null;
  total_pay_order_count_for_roi2?: number | string | null;
  total_pay_order_coupon_amount_for_roi2?: number | string | null;
  total_ecom_platform_subsidy_amount_for_roi2?: number | string | null;
};

export function formatAccountData(
  data: AccountRow,
  opts: { startDate?: string; endDate?: string; marketingGoal?: string } = {}
): string {
  const cost = num(data.stat_cost);
  const gmv = num(data.total_pay_order_gmv_for_roi2);
  const roi = num(data.total_prepay_and_pay_order_roi2);
  const orderCount = num(data.total_pay_order_count_for_roi2);
  const coupon = num(data.total_pay_order_coupon_amount_for_roi2);
  const subsidy = num(data.total_ecom_platform_subsidy_amount_for_roi2);

  const lines: string[] = ["【巨量千川账户数据】"];
  if (opts.startDate || opts.endDate) {
    const start = opts.startDate ?? "?";
    const end = opts.endDate ?? "?";
    lines.push(`时间范围：${start} ~ ${end}`);
  }
  if (opts.marketingGoal && opts.marketingGoal !== "ALL") {
    lines.push(`营销目标：${labelMarketingGoal(opts.marketingGoal)}`);
  }
  if (cost != null) lines.push(`- 整体消耗：${formatYuan(cost)}`);
  if (gmv != null) lines.push(`- 整体支付 GMV：${formatYuan(gmv)}`);
  if (roi != null) lines.push(`- 整体 ROI2：${roi.toFixed(2)}`);
  if (orderCount != null) lines.push(`- 整体支付订单数：${formatInt(orderCount)}`);
  if (coupon != null) lines.push(`- 整体支付券金额：${formatYuan(coupon)}`);
  if (subsidy != null) lines.push(`- 整体平台补贴：${formatYuan(subsidy)}`);
  if (cost != null && gmv != null && cost > 0 && orderCount && orderCount > 0) {
    lines.push(`- 整体客单价：${formatYuan(gmv / orderCount)}`);
  }
  if (lines.length === 1) {
    lines.push("- 该时段无返回数据");
  }
  return lines.join("\n");
}

type LiveRow = {
  dimensions: Record<string, DimValue>;
  metrics: Record<string, DimValue>;
};

type LiveAggregate = {
  cost: number;
  gmv: number;
  orders: number;
  show: number;
  click: number;
  convert: number;
};

export type LiveFormatOptions = {
  startDate?: string;
  endDate?: string;
  groupBy?: "date" | "anchor";
};

export function formatLiveData(
  rows: LiveRow[],
  opts: LiveFormatOptions = {}
): string {
  const groupBy = opts.groupBy ?? "date";
  const groups = new Map<string, LiveAggregate & { anchors: Set<string> }>();

  for (const row of rows) {
    const date = pickStr(row.dimensions.stat_time_day) || "未知日期";
    const anchor =
      pickStr(row.dimensions.roi2_material_anchor_name) ||
      pickStr(row.dimensions.live_anchor_name) ||
      pickStr(row.dimensions.anchor_name) ||
      "未识别抖音号";
    const key = groupBy === "anchor" ? anchor : date;

    const cost = pickNum(row.metrics.stat_cost_for_overall_roi2);
    const gmv = pickNum(row.metrics.total_pay_order_gmv_for_roi2_fork);
    const orders = pickNum(row.metrics.total_pay_order_count_for_roi2_fork);
    const show = pickNum(row.metrics.live_show_count_exclude_video_for_roi2);
    const click = pickNum(row.metrics.click_count_for_roi2);
    const convert = pickNum(row.metrics.convert_count_for_roi2);

    const cur = groups.get(key) ?? {
      cost: 0,
      gmv: 0,
      orders: 0,
      show: 0,
      click: 0,
      convert: 0,
      anchors: new Set<string>()
    };
    cur.cost += cost;
    cur.gmv += gmv;
    cur.orders += orders;
    cur.show += show;
    cur.click += click;
    cur.convert += convert;
    cur.anchors.add(anchor);
    groups.set(key, cur);
  }

  const lines: string[] = [`【巨量千川直播间画面数据（按${groupBy === "anchor" ? "抖音号" : "日期"}汇总）】`];
  if (opts.startDate || opts.endDate) {
    lines.push(`时间范围：${opts.startDate ?? "?"} ~ ${opts.endDate ?? "?"}`);
  }
  if (groups.size === 0) {
    lines.push("- 该时段无返回数据");
    return lines.join("\n");
  }

  const sorted = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [key, agg] of sorted) {
    const label = groupBy === "anchor" ? `抖音号：${key}` : `日期：${key}`;
    lines.push(`\n${label}`);
    lines.push(`- 消耗：${formatYuan(agg.cost)}`);
    lines.push(`- 支付 GMV：${formatYuan(agg.gmv)}`);
    lines.push(`- 支付订单数：${formatInt(agg.orders)}`);
    lines.push(`- 直播间展示次数：${formatInt(agg.show)}`);
    if (agg.click) lines.push(`- 点击数：${formatInt(agg.click)}`);
    if (agg.convert) lines.push(`- 转化数：${formatInt(agg.convert)}`);
    if (agg.anchors.size > 1) {
      lines.push(`- 涉及抖音号：${[...agg.anchors].join("、")}`);
    }
  }
  return lines.join("\n");
}

type MaterialRow = {
  dimensions: Record<string, DimValue>;
  metrics: Record<string, DimValue>;
};

type MaterialAggregate = {
  cost: number;
  gmv: number;
  orders: number;
  coupon: number;
  subsidy: number;
  show: number;
  click: number;
  ctr: number;
  cvr: number;
  ecpm: number;
  cpc: number;
  roi: number;
  videoTypes: Set<string>;
};

export type MaterialFormatOptions = {
  startDate?: string;
  endDate?: string;
  groupBy?: "date" | "material";
  anchorName?: string | null;
  smartBidType?: string | null;
};

export function formatMaterialData(rows: MaterialRow[], opts: MaterialFormatOptions = {}): string {
  const groupBy = opts.groupBy ?? "material";
  const groups = new Map<string, MaterialAggregate & { name: string }>();

  for (const row of rows) {
    const date = pickStr(row.dimensions.stat_time_day) || "未知日期";
    const materialId = pickStr(row.dimensions.material_id) || "未识别素材";
    const materialName = pickStr(row.dimensions.roi2_material_video_name) || materialId;
    const videoType = pickStr(row.dimensions.roi2_material_video_type);
    const key = groupBy === "date" ? date : materialId;
    const label = groupBy === "date" ? date : materialName;

    const cur = groups.get(key) ?? {
      cost: 0,
      gmv: 0,
      orders: 0,
      coupon: 0,
      subsidy: 0,
      show: 0,
      click: 0,
      ctr: 0,
      cvr: 0,
      ecpm: 0,
      cpc: 0,
      roi: 0,
      videoTypes: new Set<string>(),
      name: label
    };
    cur.cost += pickNum(row.metrics.stat_cost_for_roi2);
    cur.gmv += pickNum(row.metrics.total_pay_order_gmv_for_roi2);
    cur.orders += pickNum(row.metrics.total_pay_order_count_for_roi2);
    cur.coupon += pickNum(row.metrics.total_pay_order_coupon_amount_for_roi2);
    cur.subsidy += pickNum(row.metrics.total_ecom_platform_subsidy_amount_for_roi2);
    cur.show += pickNum(row.metrics.live_show_count_for_roi2_v2);
    cur.click += pickNum(row.metrics.live_watch_count_for_roi2_v2);
    cur.ctr = pickNum(row.metrics.live_cvr_rate_for_roi2_v2) / 100;
    cur.cvr = pickNum(row.metrics.live_convert_rate_for_roi2_v2) / 100;
    cur.ecpm += pickNum(row.metrics.total_ecpm_for_roi2);
    cur.cpc += pickNum(row.metrics.total_cpc_for_roi2);
    cur.roi = pickNum(row.metrics.total_prepay_and_pay_order_roi2);
    if (videoType) cur.videoTypes.add(videoType);
    groups.set(key, cur);
  }

  const lines: string[] = [`【巨量千川素材-视频数据（按${groupBy === "date" ? "日期" : "素材"}汇总）】`];
  if (opts.anchorName) lines.push(`抖音号：${opts.anchorName}`);
  if (opts.smartBidType) lines.push(`投放类型：${labelSmartBidType(opts.smartBidType)}`);
  if (opts.startDate || opts.endDate) {
    lines.push(`时间范围：${opts.startDate ?? "?"} ~ ${opts.endDate ?? "?"}`);
  }
  if (groups.size === 0) {
    lines.push("- 该时段无返回数据");
    return lines.join("\n");
  }

  const sorted = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [key, agg] of sorted) {
    const label = groupBy === "date" ? `日期：${key}` : `素材：${agg.name}（id=${key}）`;
    lines.push(`\n${label}`);
    lines.push(`- 消耗：${formatYuan(agg.cost)}`);
    lines.push(`- 支付 GMV：${formatYuan(agg.gmv)}`);
    lines.push(`- 支付订单数：${formatInt(agg.orders)}`);
    lines.push(`- ROI2：${agg.roi > 0 ? agg.roi.toFixed(2) : "-"}`);
    lines.push(`- 展示次数：${formatInt(agg.show)}`);
    lines.push(`- 点击数：${formatInt(agg.click)}`);
    if (agg.cost > 0 && agg.orders > 0) {
      lines.push(`- 成交订单成本：${formatYuan(agg.cost / agg.orders)}`);
    }
    if (agg.coupon) lines.push(`- 券金额：${formatYuan(agg.coupon)}`);
    if (agg.subsidy) lines.push(`- 平台补贴：${formatYuan(agg.subsidy)}`);
    if (agg.videoTypes.size > 0) {
      lines.push(`- 素材类型：${[...agg.videoTypes].join("、")}`);
    }
  }
  return lines.join("\n");
}

export type MaterialSummaryOptions = {
  startDate?: string;
  endDate?: string;
  anchorName?: string | null;
  smartBidType?: string | null;
  topN?: number;
  includeIndex?: boolean;
};

export function formatMaterialSummary(rows: MaterialRow[], opts: MaterialSummaryOptions = {}): string {
  const topN = Math.max(1, Math.min(opts.topN ?? 30, 200));
  const includeIndex = opts.includeIndex !== false;
  const materialAggs = new Map<string, MaterialAggregate & { name: string }>();
  const dayAggs = new Map<string, MaterialAggregate>();
  let totalCost = 0;
  let totalGmv = 0;
  let totalOrders = 0;
  let totalShow = 0;
  let totalClick = 0;

  for (const row of rows) {
    const date = pickStr(row.dimensions.stat_time_day) || "未知日期";
    const materialId = pickStr(row.dimensions.material_id) || "未识别素材";
    const materialName = pickStr(row.dimensions.roi2_material_video_name) || materialId;
    const videoType = pickStr(row.dimensions.roi2_material_video_type);

    const cost = pickNum(row.metrics.stat_cost_for_roi2);
    const gmv = pickNum(row.metrics.total_pay_order_gmv_for_roi2);
    const orders = pickNum(row.metrics.total_pay_order_count_for_roi2);
    const coupon = pickNum(row.metrics.total_pay_order_coupon_amount_for_roi2);
    const subsidy = pickNum(row.metrics.total_ecom_platform_subsidy_amount_for_roi2);
    const show = pickNum(row.metrics.live_show_count_for_roi2_v2);
    const click = pickNum(row.metrics.live_watch_count_for_roi2_v2);
    const ecpm = pickNum(row.metrics.total_ecpm_for_roi2);
    const cpc = pickNum(row.metrics.total_cpc_for_roi2);
    const roi = pickNum(row.metrics.total_prepay_and_pay_order_roi2);

    totalCost += cost;
    totalGmv += gmv;
    totalOrders += orders;
    totalShow += show;
    totalClick += click;

    const m = materialAggs.get(materialId) ?? {
      cost: 0, gmv: 0, orders: 0, coupon: 0, subsidy: 0, show: 0, click: 0,
      ctr: 0, cvr: 0, ecpm: 0, cpc: 0, roi: 0, videoTypes: new Set<string>(), name: materialName
    };
    m.cost += cost;
    m.gmv += gmv;
    m.orders += orders;
    m.coupon += coupon;
    m.subsidy += subsidy;
    m.show += show;
    m.click += click;
    m.ecpm += ecpm;
    m.cpc += cpc;
    m.roi = roi;
    if (videoType) m.videoTypes.add(videoType);
    materialAggs.set(materialId, m);

    const d = dayAggs.get(date) ?? {
      cost: 0, gmv: 0, orders: 0, coupon: 0, subsidy: 0, show: 0, click: 0,
      ctr: 0, cvr: 0, ecpm: 0, cpc: 0, roi: 0, videoTypes: new Set<string>()
    };
    d.cost += cost;
    d.gmv += gmv;
    d.orders += orders;
    dayAggs.set(date, d);
  }

  const lines: string[] = ["【巨量千川素材-视频数据（分层摘要）】"];
  if (opts.anchorName) lines.push(`抖音号：${opts.anchorName}`);
  if (opts.smartBidType) lines.push(`投放类型：${labelSmartBidType(opts.smartBidType)}`);
  if (opts.startDate || opts.endDate) {
    lines.push(`时间范围：${opts.startDate ?? "?"} ~ ${opts.endDate ?? "?"}`);
  }

  if (materialAggs.size === 0) {
    lines.push("- 该时段无返回数据");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("【总览】");
  lines.push(`- 素材数：${materialAggs.size}`);
  lines.push(`- 总消耗：${formatYuan(totalCost)}`);
  lines.push(`- 总支付 GMV：${formatYuan(totalGmv)}`);
  lines.push(`- 总订单数：${formatInt(totalOrders)}`);
  if (totalCost > 0) {
    const avgRoi = totalGmv / totalCost;
    lines.push(`- 整体 ROI2：${avgRoi.toFixed(2)}`);
    if (totalOrders > 0) {
      lines.push(`- 成交订单成本：${formatYuan(totalCost / totalOrders)}`);
      lines.push(`- 平均客单价：${formatYuan(totalGmv / totalOrders)}`);
    }
  }
  if (totalShow > 0) lines.push(`- 总展示次数：${formatInt(totalShow)}`);
  if (totalClick > 0) lines.push(`- 总点击数：${formatInt(totalClick)}`);

  const sortedMaterials = [...materialAggs.entries()].sort((a, b) => b[1].cost - a[1].cost);
  const topMaterials = sortedMaterials.slice(0, topN);
  const hiddenCount = Math.max(0, sortedMaterials.length - topMaterials.length);

  lines.push("");
  lines.push(`【按素材 Top ${topMaterials.length}】${hiddenCount > 0 ? `（另有 ${hiddenCount} 个素材未列出，已折叠；如需查具体素材请调 qianchuanMaterialDetail）` : ""}`);
  lines.push("| 排名 | 素材名 | material_id | 总消耗 | 总 GMV | 订单数 | ROI |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  topMaterials.forEach(([id, agg], idx) => {
    const truncatedName = agg.name.length > 24 ? `${agg.name.slice(0, 22)}…` : agg.name;
    const roi = agg.gmv > 0 && agg.cost > 0 ? (agg.gmv / agg.cost).toFixed(2) : "-";
    lines.push(`| ${idx + 1} | ${truncatedName} | ${id} | ${formatYuan(agg.cost)} | ${formatYuan(agg.gmv)} | ${formatInt(agg.orders)} | ${roi} |`);
  });

  const sortedDays = [...dayAggs.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  lines.push("");
  lines.push(`【按日维度 共 ${sortedDays.length} 天】`);
  lines.push("| 日期 | 消耗 | GMV | 订单数 | ROI |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const [date, agg] of sortedDays) {
    const roi = agg.gmv > 0 && agg.cost > 0 ? (agg.gmv / agg.cost).toFixed(2) : "-";
    lines.push(`| ${date} | ${formatYuan(agg.cost)} | ${formatYuan(agg.gmv)} | ${formatInt(agg.orders)} | ${roi} |`);
  }

  if (includeIndex) {
    const indexLimit = Math.min(topMaterials.length, topN);
    const indexedMaterials = topMaterials.slice(0, indexLimit);
    lines.push("");
    lines.push(`【素材 ID 索引】（仅 Top ${indexedMaterials.length} 可下钻；其余 ${Math.max(0, sortedMaterials.length - indexedMaterials.length)} 条长尾素材未列入索引，如需查请提供 19 位 material_id）`);
    for (const [id, agg] of indexedMaterials) {
      const truncatedName = agg.name.length > 20 ? `${agg.name.slice(0, 18)}…` : agg.name;
      lines.push(`- ${truncatedName} = ${id}`);
    }
  }

  return lines.join("\n");
}

export type MaterialDetailOptions = {
  startDate?: string;
  endDate?: string;
  anchorName?: string | null;
  smartBidType?: string | null;
};

export function formatMaterialDetail(
  rows: MaterialRow[],
  opts: MaterialDetailOptions = {}
): string {
  if (rows.length === 0) {
    const empty: string[] = ["【素材逐日明细】"];
    if (opts.startDate || opts.endDate) {
      empty.push(`时间范围：${opts.startDate ?? "?"} ~ ${opts.endDate ?? "?"}`);
    }
    empty.push("- 该素材在指定时段无返回数据");
    return empty.join("\n");
  }

  const first = rows[0];
  const materialId = pickStr(first.dimensions.material_id) || "未识别素材";
  const materialName = pickStr(first.dimensions.roi2_material_video_name) || materialId;

  const lines: string[] = [
    "【素材逐日明细】",
    `素材：${materialName}（id=${materialId}）`
  ];
  if (opts.anchorName) lines.push(`抖音号：${opts.anchorName}`);
  if (opts.smartBidType) lines.push(`投放类型：${labelSmartBidType(opts.smartBidType)}`);
  if (opts.startDate || opts.endDate) {
    lines.push(`时间范围：${opts.startDate ?? "?"} ~ ${opts.endDate ?? "?"}`);
  }

  const sorted = [...rows].sort((a, b) => {
    const da = pickStr(a.dimensions.stat_time_day);
    const db = pickStr(b.dimensions.stat_time_day);
    return da.localeCompare(db);
  });

  let totalCost = 0;
  let totalGmv = 0;
  let totalOrders = 0;
  lines.push("");
  lines.push("| 日期 | 消耗 | 支付 GMV | 订单数 | ROI |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of sorted) {
    const date = pickStr(row.dimensions.stat_time_day);
    const cost = pickNum(row.metrics.stat_cost_for_roi2);
    const gmv = pickNum(row.metrics.total_pay_order_gmv_for_roi2);
    const orders = pickNum(row.metrics.total_pay_order_count_for_roi2);
    totalCost += cost;
    totalGmv += gmv;
    totalOrders += orders;
    const roi = gmv > 0 && cost > 0 ? (gmv / cost).toFixed(2) : "-";
    lines.push(`| ${date || "?"} | ${formatYuan(cost)} | ${formatYuan(gmv)} | ${formatInt(orders)} | ${roi} |`);
  }

  lines.push("");
  lines.push(`【汇总】消耗 ${formatYuan(totalCost)} / GMV ${formatYuan(totalGmv)} / 订单数 ${formatInt(totalOrders)}`);
  if (totalCost > 0) {
    const avgRoi = totalGmv / totalCost;
    lines.push(`整体 ROI2：${avgRoi.toFixed(2)}`);
    if (totalOrders > 0) {
      lines.push(`成交订单成本：${formatYuan(totalCost / totalOrders)}`);
    }
  }

  return lines.join("\n");
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickNum(v: DimValue): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  const dim = v as Dim;
  const raw = dim.Value;
  if (raw === undefined) return 0;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function pickStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const obj = v as Dim;
    return obj.ValueStr ?? (obj.Value !== undefined ? String(obj.Value) : "");
  }
  return "";
}

function labelMarketingGoal(g: string): string {
  switch (g) {
    case "LIVE_PROM_GOODS":
      return "直播带货";
    case "VIDEO_PROM_GOODS":
      return "短视频带货";
    case "ALL":
      return "全部";
    default:
      return g;
  }
}

function labelSmartBidType(t: string): string {
  switch (t) {
    case "0":
      return "控成本投放";
    case "7":
      return "放量投放";
    default:
      return t;
  }
}
