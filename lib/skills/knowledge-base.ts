import { retrieveKnowledge } from "../knowledge-retrieval";
import { detectSceneIntent, filterAssetsByScenes } from "../scene-intent";
import { getAllowedScenesForUser } from "../scenes";
import type { Skill, SkillContext, SkillResult } from "./types";

const ASSET_TYPE_VALUES = [
  "product_white_image",
  "main_template",
  "portrait_white_image",
  "pdf",
  "ppt",
  "excel",
  "document",
  "prompt"
] as const;

export const searchKnowledgeBaseSkill: Skill = {
  definition: {
    name: "searchKnowledgeBase",
    description:
      "在当前用户可访问的知识库资料中按关键词检索最相关的内容。会先做场景意图识别、再用关键词打分排序。返回的 content 已经是格式化好的资料正文片段；之后若需要某条资料的完整正文，请用 getAssetDetail 二次拉取。提示：若问题涉及金额/数据/统计/概况/总结/成交，强烈建议传 assetType:\"excel\"，可避免被不相关类目（如产品白底图）挤掉；涉及产品外观则传 assetType:\"product_white_image\"。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "检索关键词或自然语言问题，必须与资料中的产品名、卖点、场景等关键词相关"
        },
        limit: {
          type: "integer",
          description: "返回条数上限，默认 5，最大 10"
        },
        assetType: {
          type: "string",
          enum: [...ASSET_TYPE_VALUES],
          description: "可选：按资料类型过滤。例如「金额/数据/概况」类问题传 \"excel\"，「产品外观」类问题传 \"product_white_image\"，不传则按综合得分排序"
        }
      },
      required: ["query"]
    }
  },
  async execute(args, ctx): Promise<SkillResult> {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      return { callId: "", name: "searchKnowledgeBase", ok: false, content: "", error: "missing_query" };
    }
    const rawLimit = Number(args.limit);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 10)) : 5;
    const assetType = typeof args.assetType === "string" && ASSET_TYPE_VALUES.includes(args.assetType as (typeof ASSET_TYPE_VALUES)[number])
      ? args.assetType
      : undefined;

    try {
      const { scenes } = await detectSceneIntent({
        userDepartmentId: ctx.user.departmentId,
        isAdmin: ctx.user.role === "admin",
        query
      });
      const allowedScenes = await getAllowedScenesForUser(ctx.user);
      const ranked = await retrieveKnowledge({
        userDepartmentId: ctx.user.departmentId,
        isAdmin: ctx.user.role === "admin",
        allowedScenes,
        query
      });
      const filtered = scenes.length ? filterAssetsByScenes(ranked, scenes, (entry) => entry.asset.scenes) : ranked;
      const top = (filtered.length ? filtered : ranked)
        .filter((entry) => (assetType ? entry.asset.assetType === assetType : true))
        .slice(0, limit);

      const sections: string[] = [];
      const matchedIds: string[] = [];
      const matchedAssets: Array<{ id: string; assetName: string; assetType: string }> = [];
      top.forEach((entry, index) => {
        matchedIds.push(entry.asset.id);
        matchedAssets.push({ id: entry.asset.id, assetName: entry.asset.assetName, assetType: entry.asset.assetType });
        const header = `【资料${index + 1}】${entry.asset.assetName}（类型：${entry.asset.assetType}，id：${entry.asset.id}）`;
        const body = entry.truncatedContent.trim() ? entry.truncatedContent : "（本条无正文）";
        sections.push(`${header}\n${body}`);
      });

      const content = sections.length ? sections.join("\n\n") : "（未命中任何资料）";
      return {
        callId: "",
        name: "searchKnowledgeBase",
        ok: true,
        content,
        meta: {
          matched: top.length,
          matchedIds,
          matchedAssets,
          limit,
          assetType: assetType || null,
          scenes: scenes.map((s) => s.sceneKey)
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { callId: "", name: "searchKnowledgeBase", ok: false, content: "", error: message };
    }
  }
};
