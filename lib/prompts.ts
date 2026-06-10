import type { KnowledgeAsset, MechanismParse, MechanismItem } from "@prisma/client";

export const detailScenes = [
  { title: "套装主视觉", goal: "展示产品组合、价格机制和核心卖点" },
  { title: "核心卖点解释", goal: "放大说明主要功效和使用场景" },
  { title: "资料支撑页", goal: "用资料型内容支撑卖点可信度" },
  { title: "使用场景页", goal: "展示适用人群和使用体验" },
  { title: "套装价值总结", goal: "强化价格机制、赠品和购买理由" }
];

type PromptItem = MechanismItem & { matchedAsset?: KnowledgeAsset | null };
type ParseWithItems = MechanismParse & { items: PromptItem[] };

export const DEFAULT_MAIN_PROMPT_TEMPLATE = [
  "任务类型：生成 1:1 电商主图",
  "价格机制：{{price}}={{productSummary}}",
  "禁止：不要把白底图文件名、边框、白底背景或参考说明文字放进画面；不要改变瓶身或包装关键特征，不添加未提供的达人肖像图，不虚构医疗化功效。"
].join("\n");

export const DEFAULT_DETAIL_PROMPT_TEMPLATE = [
  "任务类型：生成 9:16 电商详情页分镜",
  "价格机制：{{price}}={{productSummary}}",
  "分镜页码：第 {{pageIndex}}/{{pageCount}} 页",
  "当前页面主题：{{sceneTitle}}",
  "当前页面目标：{{sceneGoal}}",
  "产品组合：{{products}}",
  "匹配到的白底图参考：{{whiteImages}}",
  "卖点文案：{{sellingPoints}}",
  "生成要求：竖版 9:16，明亮精致，风格统一，中文排版清晰，每页只表达一个核心主题。",
  "产品还原要求：详情页里的产品包装必须沿用匹配白底图的真实外观，包括瓶型、颜色、标签、盖子和数量，不要换包装。",
  "禁止：不要把白底图文件名、边框、白底背景或参考说明文字放进画面；不要添加资料中没有的核心功效，不改变产品包装关键特征。"
].join("\n");

function renderTemplate(template: string, parse: ParseWithItems, pageIndex = 1, pageCount = 1, sellingPoints: string[] = []) {
  const products = parse.items.map((item) => `${item.productName} x ${item.quantity}`).join("、");
  const whiteImages = parse.items
    .map((item) => {
      const asset = item.matchedAsset;
      if (!asset) {
        return `${item.productName} x ${item.quantity}：未匹配白底图，请保持简洁陈列，不要编造复杂包装`;
      }
      const details = [
        `资料名「${asset.assetName}」`,
        asset.productName ? `产品字段「${asset.productName}」` : "",
        asset.description ? `外观描述「${asset.description}」` : "",
        `原文件「${asset.originalName}」`,
        item.matchType && item.matchType !== "none" ? `匹配方式「${item.matchType}」` : ""
      ].filter(Boolean);
      return `${item.productName} x ${item.quantity}：参考${details.join("，")}，生成时按该白底图还原包装外观`;
    })
    .join("；");
  const scene = detailScenes[Math.min(pageIndex - 1, detailScenes.length - 1)];
  const values: Record<string, string> = {
    price: String(parse.price),
    productSummary: parse.productSummary,
    products,
    whiteImages,
    referenceImages: whiteImages,
    sellingPoints: sellingPoints.join("、") || "柔顺蓬松、香味持久、密集修护",
    pageIndex: String(pageIndex),
    pageCount: String(pageCount),
    sceneTitle: scene.title,
    sceneGoal: scene.goal
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

export function buildMainImagePrompt(parse: ParseWithItems, sellingPoints: string[] = [], template = DEFAULT_MAIN_PROMPT_TEMPLATE) {
  return renderTemplate(template, parse, 1, 1, sellingPoints);
}

export function buildDetailPrompt(
  parse: ParseWithItems,
  pageIndex: number,
  pageCount: number,
  sellingPoints: string[] = [],
  template = DEFAULT_DETAIL_PROMPT_TEMPLATE
) {
  return renderTemplate(template, parse, pageIndex, pageCount, sellingPoints);
}
