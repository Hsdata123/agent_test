import { callOceanEngine } from "../qianchuan/oceanengine-client";
import { formatMaterialDetail } from "../qianchuan/format";
import { getTokenByAdvertiser } from "../qianchuan/token-store";
import { resolveAnchor } from "../qianchuan/anchor-resolver";
import { fetchMaterialDetailRowsWithDbFirst } from "../qianchuan/snapshot-helpers";
import type { ApiCompatRow } from "../qianchuan/snapshot-store";
import type { Skill, SkillResult } from "./types";

const DETAIL_DIMENSIONS = [
  "stat_time_day",
  "roi2_material_video_name",
  "roi2_material_video_type",
  "material_id"
];

const DETAIL_METRICS = [
  "stat_cost_for_roi2",
  "total_pay_order_gmv_for_roi2",
  "total_pay_order_count_for_roi2",
  "total_prepay_and_pay_order_roi2"
];

export const qianchuanMaterialDetailSkill: Skill = {
  definition: {
    name: "qianchuanMaterialDetail",
    description:
      "查询某具体素材在指定时段的逐日明细（按 stat_time_day 展开），返回每天的消耗/支付 GMV/订单数/ROI。" +
      "【用途】作为 qianchuanMaterialData 的下钻工具：当用户追问「Top X 素材每天数据」「某素材哪天跑得好」「某素材 6/3 的 ROI」时调用本工具。" +
      "materialId 必须从 qianchuanMaterialData 工具返回的【素材 ID 索引】取（19 位长串），不要让用户重述。" +
      "如果用户问的素材不在 Top 30 索引里（长尾素材）→ 告知用户「该素材未在 Top 30 列表中，无法定位到 material_id，请提供 19 位 ID 或调小日期范围重查」。",
    parameters: {
      type: "object",
      properties: {
        materialId: {
          type: "string",
          description: "素材 19 位 material_id（从 qianchuanMaterialData 工具返回的【素材 ID 索引】取）"
        },
        startDate: { type: "string", description: "开始时间 YYYY-MM-DD HH:MM:SS" },
        endDate: { type: "string", description: "结束时间 YYYY-MM-DD HH:MM:SS" },
        anchorId: {
          type: "string",
          description: "抖音号 ID（19 位长串）或抖音号名称（模糊匹配）"
        },
        smartBidType: {
          type: "string",
          enum: ["0", "7"],
          description: "投放类型：0=控成本投放，7=放量投放；不传默认 0"
        },
        advertiserId: { type: "string", description: "可选：广告主 ID；不传则用当前用户绑定的" }
      },
      required: ["materialId", "startDate", "endDate", "anchorId"]
    }
  },
  async execute(args, ctx): Promise<SkillResult> {
    const startDate = typeof args.startDate === "string" ? args.startDate.trim() : "";
    const endDate = typeof args.endDate === "string" ? args.endDate.trim() : "";
    const anchorId = typeof args.anchorId === "string" ? args.anchorId.trim() : "";
    const materialId = typeof args.materialId === "string" ? args.materialId.trim() : "";
    if (!startDate || !endDate) {
      return { callId: "", name: "qianchuanMaterialDetail", ok: false, content: "", error: "missing_date_range" };
    }
    if (!anchorId) {
      return { callId: "", name: "qianchuanMaterialDetail", ok: false, content: "", error: "missing_anchor_id" };
    }
    if (!materialId) {
      return { callId: "", name: "qianchuanMaterialDetail", ok: false, content: "", error: "missing_material_id" };
    }
    const overrideId = args.advertiserId != null ? String(args.advertiserId).trim() : "";
    const advertiserId = overrideId || (ctx.user.advertiserId ? String(ctx.user.advertiserId) : "");
    if (!advertiserId) {
      return { callId: "", name: "qianchuanMaterialDetail", ok: false, content: "", error: "no_advertiser_id_for_user" };
    }
    const token = await getTokenByAdvertiser(advertiserId);
    if (!token) {
      return { callId: "", name: "qianchuanMaterialDetail", ok: false, content: "", error: "no_token_for_advertiser" };
    }
    const resolved = await resolveAnchor(advertiserId, anchorId);
    if (!resolved.ok) {
      if (resolved.reason === "ambiguous") {
        return {
          callId: "",
          name: "qianchuanMaterialDetail",
          ok: false,
          content: "",
          error: `ambiguous_anchor_name: 多个抖音号匹配「${anchorId}」，请提供更精确的名称或直接传 ID：${resolved.candidates?.map((c) => `${c.anchorName}(${c.anchorId})`).join("、")}`
        };
      }
      if (resolved.reason === "not_found") {
        return {
          callId: "",
          name: "qianchuanMaterialDetail",
          ok: false,
          content: "",
          error: `unknown_anchor_name: 找不到匹配「${anchorId}」的抖音号。请直接提供 19 位 anchor_id，或联系管理员通过「设置 → 千川 → 抖音号名册导入」Excel 批量预填映射表`
        };
      }
      return { callId: "", name: "qianchuanMaterialDetail", ok: false, content: "", error: "invalid_anchor" };
    }
    const resolvedAnchorId = resolved.anchorId;
    const resolvedAnchorName = resolved.anchorName;
    const smartBidType = typeof args.smartBidType === "string" && args.smartBidType.trim() ? args.smartBidType.trim() : "0";
    const filters: Array<{ field: string; operator: number; values: string[] }> = [
      { field: "ecp_app_id", operator: 7, values: ["1"] },
      { field: "aggregate_smart_bid_type", operator: 7, values: [smartBidType] },
      { field: "anchor_id", operator: 7, values: [resolvedAnchorId] },
      { field: "material_id", operator: 7, values: [materialId] }
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
            dimensions: JSON.stringify(DETAIL_DIMENSIONS),
            metrics: JSON.stringify(DETAIL_METRICS),
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
      const { rows: allRows, meta: dbMeta } = await fetchMaterialDetailRowsWithDbFirst({
        advertiserId,
        anchorId: resolvedAnchorId,
        materialId,
        smartBidType,
        startDate,
        endDate,
        apiFetcher
      });
      return {
        callId: "",
        name: "qianchuanMaterialDetail",
        ok: true,
        content: formatMaterialDetail(allRows as never, {
          startDate,
          endDate,
          anchorName: resolvedAnchorName || `id=${resolvedAnchorId}`,
          smartBidType
        }),
        meta: {
          advertiserId,
          startDate,
          endDate,
          anchorId: resolvedAnchorId,
          anchorName: resolvedAnchorName,
          materialId,
          smartBidType,
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
      return { callId: "", name: "qianchuanMaterialDetail", ok: false, content: "", error: (e as Error).message };
    }
  }
};
