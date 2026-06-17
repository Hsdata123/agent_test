import type { RankedAsset } from "./knowledge-retrieval";
import { parseScenesString } from "./scenes";

const IMAGE_SECTION_HEADER = "\n\n以下是从知识库检索到的参考资料（按相关度排序，仅供画面创作参考）：";
const IMAGE_SECTION_FOOTER = "\n\n请在遵守上述产品还原要求与禁止条款的前提下，参考上述资料丰富画面表达。";
const CHAT_HEADER = "以下是相关知识库资料（按相关度排序）：";

function describeAsset(asset: RankedAsset["asset"], scenesLabel: string) {
  const lines: string[] = [];
  lines.push(`名称：${asset.assetName}`);
  if (asset.productName) lines.push(`产品：${asset.productName}`);
  lines.push(`类型：${asset.assetType}`);
  if (scenesLabel) lines.push(`场景：${scenesLabel}`);
  return lines.join(" / ");
}

export function enhanceImagePrompt(basePrompt: string, ranked: RankedAsset[]): string {
  if (!ranked.length) return basePrompt;
  const blocks: string[] = [IMAGE_SECTION_HEADER];
  ranked.forEach((entry, index) => {
    const scenes = parseScenesString(entry.asset.scenes).join("、");
    blocks.push(`\n[资料${index + 1}] ${describeAsset(entry.asset, scenes)}`);
    if (entry.truncatedContent.trim()) {
      const excerpt = entry.truncatedContent.slice(0, 1500);
      blocks.push(`摘要：${excerpt}`);
    }
  });
  blocks.push(IMAGE_SECTION_FOOTER);
  return `${basePrompt}${blocks.join("\n")}`;
}

export function enhanceChatContext(baseContext: string | undefined, ranked: RankedAsset[]): string | undefined {
  if (!ranked.length) return baseContext;
  const blocks: string[] = [];
  if (baseContext && baseContext.trim()) {
    blocks.push(baseContext.trim());
    blocks.push("");
  }
  blocks.push(CHAT_HEADER);
  ranked.forEach((entry, index) => {
    const scenes = parseScenesString(entry.asset.scenes).join("、");
    blocks.push("");
    blocks.push(`【资料${index + 1}】${describeAsset(entry.asset, scenes)}`);
    if (entry.truncatedContent.trim()) {
      blocks.push(entry.truncatedContent);
    }
  });
  return blocks.join("\n");
}
