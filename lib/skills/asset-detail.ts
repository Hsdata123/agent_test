import { refreshAssetText } from "../asset-extract";
import { prisma } from "../prisma";
import type { Skill, SkillContext, SkillResult } from "./types";

export const getAssetDetailSkill: Skill = {
  definition: {
    name: "getAssetDetail",
    description:
      "按 id 拉取单条知识库资料的完整正文（不截断）。适合在 searchKnowledgeBase 命中候选、但需要看全文细节时调用。注意：本技能会返回资料完整文本，请勿对未启用或跨部门资料调用。",
    parameters: {
      type: "object",
      properties: {
        assetId: {
          type: "string",
          description: "知识库资料 id，可从 searchKnowledgeBase 返回的 matchedIds 中选取"
        }
      },
      required: ["assetId"]
    }
  },
  async execute(args, ctx): Promise<SkillResult> {
    const assetId = typeof args.assetId === "string" ? args.assetId.trim() : "";
    if (!assetId) {
      return { callId: "", name: "getAssetDetail", ok: false, content: "", error: "missing_assetId" };
    }
    try {
      const asset = await prisma.knowledgeAsset.findUnique({ where: { id: assetId } });
      if (!asset) {
        return { callId: "", name: "getAssetDetail", ok: false, content: "", error: "not_found" };
      }
      const isAdmin = ctx.user.role === "admin";
      if (!isAdmin && asset.departmentId !== ctx.user.departmentId) {
        return { callId: "", name: "getAssetDetail", ok: false, content: "", error: "forbidden" };
      }
      if (!asset.enabled) {
        return { callId: "", name: "getAssetDetail", ok: false, content: "", error: "disabled" };
      }
      const refreshed = await refreshAssetText(asset);
      const text = refreshed.extractedText || "";
      return {
        callId: "",
        name: "getAssetDetail",
        ok: true,
        content: text || "（本条无正文）",
        meta: {
          assetId,
          assetName: asset.assetName,
          assetType: asset.assetType,
          departmentId: asset.departmentId
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { callId: "", name: "getAssetDetail", ok: false, content: "", error: message };
    }
  }
};
