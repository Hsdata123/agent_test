import { callOceanEngine } from "../qianchuan/oceanengine-client";
import { formatLiveData } from "../qianchuan/format";
import { getTokenByAdvertiser, upsertAnchors } from "../qianchuan/token-store";
import { resolveAnchor } from "../qianchuan/anchor-resolver";
import type { Skill, SkillResult } from "./types";

const LIVE_DIMENSIONS = ["stat_time_day", "roi2_material_anchor_name", "anchor_id"];

const LIVE_METRICS = [
  "stat_cost_for_overall_roi2",
  "total_pay_order_gmv_for_roi2_fork",
  "total_pay_order_count_for_roi2_fork",
  "live_show_count_exclude_video_for_roi2",
  "total_prepay_and_pay_order_roi2_fork"
];

function pickStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const obj = v as { ValueStr?: string; Value?: string | number };
    return obj.ValueStr ?? (obj.Value !== undefined ? String(obj.Value) : "");
  }
  return "";
}

export const qianchuanLiveSkill: Skill = {
  definition: {
    name: "qianchuanLiveData",
    description:
      "查询巨量千川「直播全域推广-直播间画面」实时数据（按抖音号+日期聚合），指标包含消耗、支付 GMV、订单数、直播间展示次数、ROI2。" +
      "适用于回答「某抖音号/直播间在某时段的成交与消耗」类问题。" +
      "anchorId 可传抖音号 ID（19 位长串）或抖音号名称（模糊匹配如「弹动官方旗舰店」），留空则汇总该广告主下所有抖音号。",
    parameters: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "开始时间 YYYY-MM-DD HH:MM:SS" },
        endDate: { type: "string", description: "结束时间 YYYY-MM-DD HH:MM:SS" },
        anchorId: {
          type: "string",
          description: "可选：抖音号 ID（19 位长串）或抖音号名称（模糊匹配如「弹动官方旗舰店」）。不传则聚合所有抖音号"
        },
        smartBidType: {
          type: "string",
          enum: ["0", "7"],
          description: "投放类型：0=控成本投放，7=放量投放；不传默认 0"
        },
        advertiserId: { type: "string", description: "可选：广告主 ID；不传则用当前用户绑定的" }
      },
      required: ["startDate", "endDate"]
    }
  },
  async execute(args, ctx): Promise<SkillResult> {
    const startDate = typeof args.startDate === "string" ? args.startDate.trim() : "";
    const endDate = typeof args.endDate === "string" ? args.endDate.trim() : "";
    if (!startDate || !endDate) {
      return { callId: "", name: "qianchuanLiveData", ok: false, content: "", error: "missing_date_range" };
    }
    const overrideId = args.advertiserId != null ? String(args.advertiserId).trim() : "";
    const advertiserId = overrideId || (ctx.user.advertiserId ? String(ctx.user.advertiserId) : "");
    if (!advertiserId) {
      return { callId: "", name: "qianchuanLiveData", ok: false, content: "", error: "no_advertiser_id_for_user" };
    }
    const token = await getTokenByAdvertiser(advertiserId);
    if (!token) {
      return { callId: "", name: "qianchuanLiveData", ok: false, content: "", error: "no_token_for_advertiser" };
    }
    const anchorInput = typeof args.anchorId === "string" && args.anchorId.trim() ? args.anchorId.trim() : null;
    let resolvedAnchorId: string | null = null;
    let resolvedAnchorName: string | null = null;
    if (anchorInput) {
      const r = await resolveAnchor(advertiserId, anchorInput);
      if (!r.ok) {
        if (r.reason === "ambiguous") {
          return {
            callId: "",
            name: "qianchuanLiveData",
            ok: false,
            content: "",
            error: `ambiguous_anchor_name: 多个抖音号匹配「${anchorInput}」，请提供更精确的名称或直接传 ID：${r.candidates?.map((c) => `${c.anchorName}(${c.anchorId})`).join("、")}`
          };
        }
        if (r.reason === "not_found") {
          return {
            callId: "",
            name: "qianchuanLiveData",
            ok: false,
            content: "",
            error: `unknown_anchor_name: 找不到匹配「${anchorInput}」的抖音号。可能是该抖音号在所选时段没有投放数据，请换个时段拉一次 live 数据以回填映射表，或直接传 anchor_id`
          };
        }
        return { callId: "", name: "qianchuanLiveData", ok: false, content: "", error: "invalid_anchor" };
      }
      resolvedAnchorId = r.anchorId;
      resolvedAnchorName = r.anchorName || anchorInput;
    }
    const smartBidType = typeof args.smartBidType === "string" && args.smartBidType.trim() ? args.smartBidType.trim() : "0";
    const filters: Array<{ field: string; operator: number; values: string[] }> = [
      { field: "ecp_app_id", operator: 7, values: ["1"] },
      { field: "aggregate_smart_bid_type", operator: 7, values: [smartBidType] }
    ];
    if (resolvedAnchorId) {
      filters.push({ field: "anchor_id", operator: 7, values: [resolvedAnchorId] });
    }
    try {
      const data = await callOceanEngine<{ rows?: Array<{ dimensions: Record<string, unknown>; metrics: Record<string, unknown> }> }>({
        appId: token.appId,
        endpoint: "v1.0/qianchuan/report/uni_promotion/data/get/",
        params: {
          advertiser_id: advertiserId,
          data_topic: "SITE_PROMOTION_POST_DATA_LIVE",
          dimensions: JSON.stringify(LIVE_DIMENSIONS),
          metrics: JSON.stringify(LIVE_METRICS),
          filters: JSON.stringify(filters),
          start_time: startDate,
          end_time: endDate,
          page: 1,
          page_size: 200,
          order_by: JSON.stringify([{ type: 1, field: "stat_time_day" }])
        }
      });
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const seen = new Map<string, string>();
      for (const row of rows) {
        const aid = pickStr((row.dimensions as Record<string, unknown>)?.anchor_id);
        const aname = pickStr((row.dimensions as Record<string, unknown>)?.roi2_material_anchor_name);
        if (aid && aname) seen.set(aid, aname);
      }
      if (seen.size > 0) {
        await upsertAnchors(
          advertiserId,
          [...seen.entries()].map(([anchorId, anchorName]) => ({ anchorId, anchorName }))
        );
      }
      return {
        callId: "",
        name: "qianchuanLiveData",
        ok: true,
        content: formatLiveData(rows as never, { startDate, endDate, groupBy: "date" }),
        meta: { advertiserId, startDate, endDate, anchorId: resolvedAnchorId, anchorName: resolvedAnchorName, smartBidType, rowCount: rows.length }
      };
    } catch (e) {
      return { callId: "", name: "qianchuanLiveData", ok: false, content: "", error: (e as Error).message };
    }
  }
};