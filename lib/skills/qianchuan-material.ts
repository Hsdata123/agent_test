import { callOceanEngine } from "../qianchuan/oceanengine-client";
import { formatMaterialSummary } from "../qianchuan/format";
import { getTokenByAdvertiser } from "../qianchuan/token-store";
import { resolveAnchor } from "../qianchuan/anchor-resolver";
import { fetchMaterialRowsWithDbFirst } from "../qianchuan/snapshot-helpers";
import type { ApiCompatRow } from "../qianchuan/snapshot-store";
import type { Skill, SkillResult } from "./types";

const MATERIAL_DIMENSIONS = [
  "stat_time_day",
  "roi2_material_video_name",
  "roi2_material_video_type",
  "material_id"
];

const MATERIAL_METRICS = [
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

export const qianchuanMaterialSkill: Skill = {
  definition: {
    name: "qianchuanMaterialData",
    description:
      "查询巨量千川「直播全域推广-素材-视频」实时数据（按 material_id + 日期聚合），返回分层摘要：①总览（总消耗/总 GMV/总订单数/整体 ROI）②Top 30 素材（按消耗倒序，含 material_id）③按日维度简表 ④完整素材 ID 索引（用于下钻）。" +
      "【强触发词】只要问题里出现「素材」二字（搭配消耗/投放/跑量/分析/情况/数据/对比/明细等任何词），都应调用本技能而不是 account 或 live——account 给的是账户总览不含素材维度，live 给的是抖音号汇总不含素材维度。" +
      "典型问题：「某抖音号 X 月素材消耗情况」「某抖音号 X 月素材投放数据」「哪个素材跑得最好」「素材 ROI 对比」。" +
      "anchorId 必填，可传抖音号 ID（19 位长串）或抖音号名称（模糊匹配如「弹动官方旗舰店」）。" +
      "如果用户追问「Top X 素材的逐日明细」「某素材每天数据」→ 调 qianchuanMaterialDetail(materialId, startDate, endDate)，materialId 取本工具返回的【素材 ID 索引】。",
    parameters: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "开始时间 YYYY-MM-DD HH:MM:SS" },
        endDate: { type: "string", description: "结束时间 YYYY-MM-DD HH:MM:SS" },
        anchorId: {
          type: "string",
          description: "抖音号 ID（19 位长串）或抖音号名称（模糊匹配，如「弹动官方旗舰店」）"
        },
        smartBidType: {
          type: "string",
          enum: ["0", "7"],
          description: "投放类型：0=控成本投放，7=放量投放；不传默认 0"
        },
        topN: {
          type: "number",
          description: "Top 素材数量，默认 30；范围 1-200"
        },
        includeIndex: {
          type: "boolean",
          description: "是否在结果末尾追加素材 ID 索引（下钻用），默认 true"
        },
        advertiserId: { type: "string", description: "可选：广告主 ID；不传则用当前用户绑定的" }
      },
      required: ["startDate", "endDate", "anchorId"]
    }
  },
  async execute(args, ctx): Promise<SkillResult> {
    const startDate = typeof args.startDate === "string" ? args.startDate.trim() : "";
    const endDate = typeof args.endDate === "string" ? args.endDate.trim() : "";
    const anchorId = typeof args.anchorId === "string" ? args.anchorId.trim() : "";
    if (!startDate || !endDate) {
      return { callId: "", name: "qianchuanMaterialData", ok: false, content: "", error: "missing_date_range" };
    }
    if (!anchorId) {
      return { callId: "", name: "qianchuanMaterialData", ok: false, content: "", error: "missing_anchor_id" };
    }
    const overrideId = args.advertiserId != null ? String(args.advertiserId).trim() : "";
    const advertiserId = overrideId || (ctx.user.advertiserId ? String(ctx.user.advertiserId) : "");
    if (!advertiserId) {
      return { callId: "", name: "qianchuanMaterialData", ok: false, content: "", error: "no_advertiser_id_for_user" };
    }
    const token = await getTokenByAdvertiser(advertiserId);
    if (!token) {
      return { callId: "", name: "qianchuanMaterialData", ok: false, content: "", error: "no_token_for_advertiser" };
    }
    const resolved = await resolveAnchor(advertiserId, anchorId);
    if (!resolved.ok) {
      if (resolved.reason === "ambiguous") {
        return {
          callId: "",
          name: "qianchuanMaterialData",
          ok: false,
          content: "",
          error: `ambiguous_anchor_name: 多个抖音号匹配「${anchorId}」，请提供更精确的名称或直接传 ID：${resolved.candidates?.map((c) => `${c.anchorName}(${c.anchorId})`).join("、")}`
        };
      }
      if (resolved.reason === "not_found") {
        return {
          callId: "",
          name: "qianchuanMaterialData",
          ok: false,
          content: "",
          error: `unknown_anchor_name: 找不到匹配「${anchorId}」的抖音号。请直接提供 19 位 anchor_id，或联系管理员通过「设置 → 千川 → 抖音号名册导入」Excel 批量预填映射表`
        };
      }
      return { callId: "", name: "qianchuanMaterialData", ok: false, content: "", error: "invalid_anchor" };
    }
    const resolvedAnchorId = resolved.anchorId;
    const resolvedAnchorName = resolved.anchorName;
    const smartBidType = typeof args.smartBidType === "string" && args.smartBidType.trim() ? args.smartBidType.trim() : "0";
    const topN = typeof args.topN === "number" && Number.isFinite(args.topN) ? Math.floor(args.topN) : 30;
    const includeIndex = args.includeIndex !== false;
    const filters: Array<{ field: string; operator: number; values: string[] }> = [
      { field: "ecp_app_id", operator: 7, values: ["1"] },
      { field: "aggregate_smart_bid_type", operator: 7, values: [smartBidType] },
      { field: "anchor_id", operator: 7, values: [resolvedAnchorId] }
    ];
    const apiFetcher = async (apiStart: string, apiEnd: string): Promise<ApiCompatRow[]> => {
      const out: ApiCompatRow[] = [];
      const pageSize = 200;
      let page = 1;
      let totalNumber = Infinity;
      while (out.length < totalNumber) {
        const data = await callOceanEngine<{ rows?: ApiCompatRow[]; page_info?: { total_number?: number; total_page?: number } }>({
          appId: token.appId,
          endpoint: "v1.0/qianchuan/report/uni_promotion/data/get/",
          params: {
            advertiser_id: advertiserId,
            data_topic: "SITE_PROMOTION_POST_DATA_VIDEO",
            dimensions: JSON.stringify(MATERIAL_DIMENSIONS),
            metrics: JSON.stringify(MATERIAL_METRICS),
            filters: JSON.stringify(filters),
            start_time: apiStart,
            end_time: apiEnd,
            page,
            page_size: pageSize,
            order_by: JSON.stringify([{ type: 1, field: "stat_time_day" }])
          }
        });
        const rows = Array.isArray(data?.rows) ? data.rows : [];
        out.push(...rows);
        const totalPages = data?.page_info?.total_page ?? 1;
        totalNumber = data?.page_info?.total_number ?? out.length;
        if (rows.length < pageSize || page >= totalPages) break;
        page += 1;
      }
      return out;
    };
    try {
      const { rows: allRows, meta: dbMeta } = await fetchMaterialRowsWithDbFirst({
        advertiserId,
        anchorId: resolvedAnchorId,
        smartBidType,
        startDate,
        endDate,
        apiFetcher
      });
      return {
        callId: "",
        name: "qianchuanMaterialData",
        ok: true,
        content: formatMaterialSummary(allRows as never, {
          startDate,
          endDate,
          anchorName: resolvedAnchorName || `id=${resolvedAnchorId}`,
          smartBidType,
          topN,
          includeIndex
        }),
        meta: {
          advertiserId,
          startDate,
          endDate,
          anchorId: resolvedAnchorId,
          anchorName: resolvedAnchorName,
          smartBidType,
          topN,
          includeIndex,
          rowCount: allRows.length,
          dbHit: dbMeta.dbHit,
          dbMissRange: dbMeta.dbMissRange,
          dataAsOf: dbMeta.dataAsOf,
          snapshotFreshness: dbMeta.snapshotFreshness,
          snapshotAgeDays: dbMeta.snapshotAgeDays,
          dbRowCount: dbMeta.dbRowCount,
          apiRowCount: dbMeta.apiRowCount
        }
      };
    } catch (e) {
      return { callId: "", name: "qianchuanMaterialData", ok: false, content: "", error: (e as Error).message };
    }
  }
};