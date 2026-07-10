import { callOceanEngine } from "../qianchuan/oceanengine-client";
import { formatAccountData } from "../qianchuan/format";
import { getTokenByAdvertiser } from "../qianchuan/token-store";
import { fetchAccountDataWithDbFirst, type AccountAggregateRow } from "../qianchuan/snapshot-helpers";
import type { Skill, SkillResult } from "./types";

const ACCOUNT_FIELDS = [
  "stat_cost",
  "total_prepay_and_pay_order_roi2",
  "total_pay_order_gmv_for_roi2",
  "total_pay_order_count_for_roi2",
  "total_pay_order_coupon_amount_for_roi2",
  "total_ecom_platform_subsidy_amount_for_roi2"
];

export const qianchuanAccountSkill: Skill = {
  definition: {
    name: "qianchuanAccountData",
    description:
      "查询巨量千川「账户维度」实时投放数据（整体消耗、整体支付 GMV、ROI2、订单数、券金额、平台补贴、客单价）。" +
      "适用于回答「某时段整体投放概况」类问题，例如「6 月鱼子酱整体成交金额和消耗」。" +
      "如果是问单个抖音号/直播间/素材的明细，请改用 qianchuanMaterialData。",
    parameters: {
      type: "object",
      properties: {
        startDate: {
          type: "string",
          description: "开始时间，格式 YYYY-MM-DD HH:MM:SS，如 '2026-06-01 00:00:00'"
        },
        endDate: {
          type: "string",
          description: "结束时间，格式 YYYY-MM-DD HH:MM:SS，如 '2026-06-30 23:59:59'"
        },
        marketingGoal: {
          type: "string",
          enum: ["ALL", "LIVE_PROM_GOODS", "VIDEO_PROM_GOODS"],
          description: "营销目标过滤。涉及直播带货/直播间 → LIVE_PROM_GOODS；涉及短视频/视频带货 → VIDEO_PROM_GOODS；不确定 → ALL"
        },
        advertiserId: {
          type: "string",
          description: "可选：千川广告主 ID；不传则用当前用户绑定的 advertiserId"
        }
      },
      required: ["startDate", "endDate"]
    }
  },
  async execute(args, ctx): Promise<SkillResult> {
    const startDate = typeof args.startDate === "string" ? args.startDate.trim() : "";
    const endDate = typeof args.endDate === "string" ? args.endDate.trim() : "";
    if (!startDate || !endDate) {
      return { callId: "", name: "qianchuanAccountData", ok: false, content: "", error: "missing_date_range" };
    }
    const overrideId = args.advertiserId != null ? String(args.advertiserId).trim() : "";
    const advertiserId = overrideId || (ctx.user.advertiserId ? String(ctx.user.advertiserId) : "");
    if (!advertiserId) {
      return {
        callId: "",
        name: "qianchuanAccountData",
        ok: false,
        content: "",
        error: "no_advertiser_id_for_user"
      };
    }
    const token = await getTokenByAdvertiser(advertiserId);
    if (!token) {
      return {
        callId: "",
        name: "qianchuanAccountData",
        ok: false,
        content: "",
        error: "no_token_for_advertiser"
      };
    }
    const marketingGoal = typeof args.marketingGoal === "string" ? args.marketingGoal : "ALL";
    const smartBidType = "0";
    const apiFetcher = async (apiStart: string, apiEnd: string): Promise<AccountAggregateRow> => {
      const data = await callOceanEngine<Record<string, number | string | null>>({
        appId: token.appId,
        endpoint: "v1.0/qianchuan/report/uni_promotion/get/",
        params: {
          advertiser_id: advertiserId,
          start_date: apiStart,
          end_date: apiEnd,
          marketing_goal: marketingGoal,
          order_platform: "QIANCHUAN",
          fields: JSON.stringify(ACCOUNT_FIELDS)
        }
      });
      const toNum = (v: unknown): number => {
        if (v === null || v === undefined) return 0;
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? n : 0;
      };
      const out: AccountAggregateRow = {
        stat_cost: toNum(data?.stat_cost),
        total_prepay_and_pay_order_roi2: toNum(data?.total_prepay_and_pay_order_roi2),
        total_pay_order_gmv_for_roi2: toNum(data?.total_pay_order_gmv_for_roi2),
        total_pay_order_count_for_roi2: toNum(data?.total_pay_order_count_for_roi2),
        total_pay_order_coupon_amount_for_roi2: toNum(data?.total_pay_order_coupon_amount_for_roi2),
        total_ecom_platform_subsidy_amount_for_roi2: toNum(data?.total_ecom_platform_subsidy_amount_for_roi2)
      };
      return out;
    };
    try {
      const { data: combined, meta: dbMeta } = await fetchAccountDataWithDbFirst({
        advertiserId,
        smartBidType,
        startDate,
        endDate,
        apiFetcher
      });
      return {
        callId: "",
        name: "qianchuanAccountData",
        ok: true,
        content: formatAccountData(combined, { startDate, endDate, marketingGoal }),
        meta: {
          advertiserId,
          startDate,
          endDate,
          marketingGoal,
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
      return { callId: "", name: "qianchuanAccountData", ok: false, content: "", error: (e as Error).message };
    }
  }
};
