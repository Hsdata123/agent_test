import { prisma } from "./prisma";
import { IThinkClient } from "./ithink";
import { DEFAULT_DETAIL_PROMPT_TEMPLATE, DEFAULT_MAIN_PROMPT_TEMPLATE, buildDetailPrompt, buildMainImagePrompt } from "./prompts";
import { getImageDimensions, publicFileUrl } from "./storage";
import { getAllowedScenesForUser } from "./scenes";
import { retrieveKnowledge } from "./knowledge-retrieval";
import { enhanceImagePrompt } from "./prompt-enhancement";
import { getEffectiveDepartmentId, isAdmin } from "./dept-scope";

export async function runTask(taskId: string) {
  const task = await prisma.generationTask.update({
    where: { id: taskId },
    data: { status: "generating", failureReason: null },
    include: { parse: { include: { items: { include: { matchedAsset: true } } } } }
  });

  const taskUser = task.createdById
    ? await prisma.user.findUnique({ where: { id: task.createdById } })
    : null;
  const knowledgeEnhancement = task.knowledgeEnhanced && taskUser
    ? await loadKnowledgeEnhancement(taskUser, task.parse?.productSummary || task.parse?.rawMechanism || "")
    : null;

  const config = await prisma.apiConfig.findUnique({ where: { id: "singleton" } });
  const client = new IThinkClient({
    baseUrl: config?.imageBaseUrl,
    imageModel: config?.imageModel,
    chatModel: config?.textModel,
    timeoutSeconds: config?.timeoutSeconds
  });

  try {
    if (task.outputType === "main_image") {
      const size = task.imageSize || "2048x2048";
      const quality = imageQuality(task.imageQuality);
      const mainPromptConfig = parseMainPromptConfig(task.prompt);
      const mainTemplateAsset = task.templateAssetId
        ? await prisma.knowledgeAsset.findFirst({
            where: {
              id: task.templateAssetId,
              assetType: "main_template",
              enabled: true,
              ...(taskUser && !isAdmin(taskUser) ? { departmentId: getEffectiveDepartmentId(taskUser) } : {})
            }
          })
        : null;
      const portraitAsset = mainPromptConfig?.portraitAssetId
        ? await prisma.knowledgeAsset.findFirst({
            where: {
              id: mainPromptConfig.portraitAssetId,
              assetType: "portrait_white_image",
              enabled: true,
              ...(taskUser && !isAdmin(taskUser) ? { departmentId: getEffectiveDepartmentId(taskUser) } : {})
            }
          })
        : null;
      const references = referenceImagesForMainTask(task.parse, mainTemplateAsset, portraitAsset);
      const referenceImagePaths = references.map((reference) => reference.storagePath);
      const requestSize = referenceImagePaths.length ? referenceEditSize(size) : size;
      const expectedDimensions = dimensionsFromSize(requestSize);
      const sizeWarnings: string[] = [];
      for (let index = 0; index < task.imageCount; index++) {
        const basePrompt = resolveMainPrompt(mainPromptConfig?.template ?? task.prompt, task.parse, references);
        const prompt = knowledgeEnhancement ? enhanceImagePrompt(basePrompt, knowledgeEnhancement) : basePrompt;
        const imagePath = referenceImagePaths.length
          ? await client.editImage(prompt, requestSize, referenceImagePaths, quality)
          : await client.generateImage(prompt, size, quality);
        const dimensions = await getImageDimensions(imagePath);
        const warning = sizeMismatchWarning(expectedDimensions, dimensions);
        if (warning) sizeWarnings.push(warning);
        await prisma.generationResult.create({
          data: { taskId: task.id, projectId: task.projectId, imagePath, prompt, width: dimensions.width, height: dimensions.height }
        });
      }
      if (sizeWarnings.length) {
        await prisma.generationTask.update({ where: { id: task.id }, data: { failureReason: Array.from(new Set(sizeWarnings)).join("；") } });
      }
    } else {
      const count = task.detailPageCount || 5;
      const size = task.imageSize || "1024x1792";
      const quality = imageQuality(task.imageQuality);
      const expectedDimensions = dimensionsFromSize(size);
      const sizeWarnings: string[] = [];
      const references = referenceImagesForProductTask(task.parse);
      const referenceImagePaths = references.map((reference) => reference.storagePath);
      const existing = await prisma.generationResult.findMany({ where: { taskId: task.id } });
      const existingPages = new Set(existing.map((result) => result.pageIndex).filter((page): page is number => Boolean(page)));
      for (let page = 1; page <= count; page++) {
        if (existingPages.has(page)) continue;
        const basePrompt = resolveDetailPrompt(task.prompt, task.parse, page, count, references);
        const prompt = knowledgeEnhancement ? enhanceImagePrompt(basePrompt, knowledgeEnhancement) : basePrompt;
        const imagePath = referenceImagePaths.length
          ? await client.editImage(prompt, size, referenceImagePaths, quality)
          : await client.generateImage(prompt, size, quality);
        const dimensions = await getImageDimensions(imagePath);
        const warning = sizeMismatchWarning(expectedDimensions, dimensions);
        if (warning) sizeWarnings.push(warning);
        await prisma.generationResult.create({
          data: { taskId: task.id, projectId: task.projectId, imagePath, prompt, pageIndex: page, width: dimensions.width, height: dimensions.height }
        });
      }
      if (sizeWarnings.length) {
        await prisma.generationTask.update({ where: { id: task.id }, data: { failureReason: Array.from(new Set(sizeWarnings)).join("；") } });
      }
    }

    const updated = await prisma.generationTask.update({
      where: { id: task.id },
      data: { status: "completed" },
      include: { results: true, parse: true, project: true }
    });
    return {
      ...updated,
      results: updated.results.map((result) => ({ ...result, imageUrl: publicFileUrl(result.imagePath) }))
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务生成失败";
    const results = await prisma.generationResult.findMany({ where: { taskId: task.id } });
    const partialMessage = results.length
      ? `${message}。已保存 ${results.length} 张图片，可展开任务查看；补齐失败页请充值/提高超时时间后重试。`
      : message;
    const updated = await prisma.generationTask.update({
      where: { id: task.id },
      data: { status: "failed", failureReason: partialMessage },
      include: { results: true, parse: true, project: true }
    });
    return {
      ...updated,
      results: updated.results.map((result) => ({ ...result, imageUrl: publicFileUrl(result.imagePath) }))
    };
  }
}

type ParseWithReferenceAssets = {
  items: Array<{
    productName: string;
    quantity: number;
    matchedAsset?: { assetName: string; originalName: string; description?: string | null; storagePath: string } | null;
  }>;
};
type MainTemplateAsset = { assetName: string; originalName: string; description?: string | null; storagePath: string } | null;
type PortraitAsset = { assetName: string; originalName: string; description?: string | null; storagePath: string } | null;
type ReferenceImage = {
  storagePath: string;
  role: "product" | "template" | "portrait";
  name: string;
  description?: string | null;
};

function referenceImagesForProductTask(parse: ParseWithReferenceAssets) {
  const seen = new Set<string>();
  const references: ReferenceImage[] = [];
  for (const item of parse.items) {
    const asset = item.matchedAsset;
    if (!asset || seen.has(asset.storagePath)) continue;
    seen.add(asset.storagePath);
    references.push({
      storagePath: asset.storagePath,
      role: "product",
      name: item.productName,
      description: asset.description
    });
  }
  return references;
}

function referenceImagesForMainTask(parse: ParseWithReferenceAssets, template: MainTemplateAsset, portrait: PortraitAsset) {
  const references = referenceImagesForProductTask(parse);
  if (template && !references.some((reference) => reference.storagePath === template.storagePath)) {
    references.push({
      storagePath: template.storagePath,
      role: "template",
      name: template.assetName,
      description: template.description
    });
  }
  if (portrait && !references.some((reference) => reference.storagePath === portrait.storagePath)) {
    references.push({
      storagePath: portrait.storagePath,
      role: "portrait",
      name: portrait.assetName,
      description: portrait.description
    });
  }
  return references;
}

function appendReferenceRolePrompt(prompt: string, references: ReferenceImage[]) {
  if (!references.length) return prompt;
  const productRefs = references
    .map((reference, index) => ({ ...reference, number: index + 1 }))
    .filter((reference) => reference.role === "product");
  const templateRef = references
    .map((reference, index) => ({ ...reference, number: index + 1 }))
    .find((reference) => reference.role === "template");
  const portraitRef = references
    .map((reference, index) => ({ ...reference, number: index + 1 }))
    .find((reference) => reference.role === "portrait");
  const productLine = productRefs.length
    ? `${productRefs.map((reference) => `参考图${reference.number} 是${reference.name}产品白底图`).join("，")}，请严格还原产品包装。`
    : "";
  const productDescriptions = productRefs
    .filter((reference) => reference.description)
    .map((reference) => `参考图${reference.number} 外观补充：${reference.description}`);
  const templateLine = templateRef
    ? `参考图${templateRef.number} 是主图模板，只参考构图和背景和卖点，不要照搬其中的产品。`
    : "";
  const templateDescription = templateRef?.description ? `参考图${templateRef.number} 模板补充：${templateRef.description}` : "";
  const portraitLine = portraitRef
    ? `参考图${portraitRef.number} 是达人肖像白底图，达人肖像图放在主图最右边，只参考人物形象、姿态和服装，不要改变产品包装。`
    : "";
  const portraitDescription = portraitRef?.description ? `参考图${portraitRef.number} 达人肖像补充：${portraitRef.description}` : "";
  return [
    prompt,
    "",
    "参考图编号说明：",
    productLine,
    ...productDescriptions,
    templateLine,
    templateDescription,
    portraitLine,
    portraitDescription,
    "总规则：产品包装外观必须以产品白底图为准；主图模板只决定版式和视觉氛围；不要混淆产品白底图和主图模板的作用。"
  ].filter(Boolean).join("\n");
}

function resolveMainPrompt(rawPrompt: string | null, parse: Parameters<typeof buildMainImagePrompt>[0], references: ReferenceImage[]) {
  const rawPromptText = rawPrompt || DEFAULT_MAIN_PROMPT_TEMPLATE;
  if (!hasTemplateVariables(rawPromptText)) return appendReferenceRolePromptIfMissing(rawPromptText, references);
  return appendReferenceRolePrompt(buildMainImagePrompt(parse, [], rawPromptText), references);
}

function resolveDetailPrompt(
  rawPrompt: string | null,
  parse: Parameters<typeof buildDetailPrompt>[0],
  page: number,
  pageCount: number,
  references: ReferenceImage[]
) {
  const rawPromptText = rawPrompt || DEFAULT_DETAIL_PROMPT_TEMPLATE;
  const detailConfig = parseDetailPromptConfig(rawPromptText);
  const pagePrompt = detailConfig?.prompts[String(page)] || detailConfig?.template || rawPromptText;
  if (!hasTemplateVariables(pagePrompt)) return appendReferenceRolePromptIfMissing(pagePrompt, references);
  return appendReferenceRolePrompt(buildDetailPrompt(parse, page, pageCount, [], pagePrompt), references);
}

function hasTemplateVariables(prompt: string) {
  return /\{\{\w+\}\}/.test(prompt);
}

function appendReferenceRolePromptIfMissing(prompt: string, references: ReferenceImage[]) {
  if (prompt.includes("参考图编号说明") || prompt.includes("参考图1")) return prompt;
  return appendReferenceRolePrompt(prompt, references);
}

function referenceEditSize(size: string) {
  const dimensions = dimensionsFromSize(size);
  if (!dimensions.width || !dimensions.height) return "1024x1024";
  if (size === "2048x2048") return size;
  if (dimensions.width === dimensions.height && dimensions.width > 2048) return "1024x1024";
  return size;
}

function parseDetailPromptConfig(prompt: string) {
  try {
    const payload = JSON.parse(prompt) as unknown;
    if (
      payload &&
      typeof payload === "object" &&
      (payload as { kind?: unknown }).kind === "detail_full_prompts" &&
      typeof (payload as { template?: unknown }).template === "string" &&
      typeof (payload as { prompts?: unknown }).prompts === "object"
    ) {
      return payload as { template: string; prompts: Record<string, string> };
    }
  } catch {
    return null;
  }
  return null;
}

function parseMainPromptConfig(prompt: string | null) {
  if (!prompt) return null;
  try {
    const payload = JSON.parse(prompt) as unknown;
    if (
      payload &&
      typeof payload === "object" &&
      (payload as { kind?: unknown }).kind === "main_prompt_config" &&
      typeof (payload as { template?: unknown }).template === "string"
    ) {
      return payload as { template: string; portraitAssetId?: string };
    }
  } catch {
    return null;
  }
  return null;
}

function imageQuality(value?: string | null) {
  if (value === "low" || value === "medium" || value === "high" || value === "auto") return value;
  return "high";
}

function dimensionsFromSize(size: string) {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return { width: undefined, height: undefined };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function sizeMismatchWarning(expected: { width?: number; height?: number }, actual: { width?: number; height?: number }) {
  if (!expected.width || !expected.height || !actual.width || !actual.height) return "";
  if (expected.width === actual.width && expected.height === actual.height) return "";
  return `上游返回尺寸与请求不一致：请求 ${expected.width}x${expected.height}，实际 ${actual.width}x${actual.height}`;
}

async function loadKnowledgeEnhancement(
  user: { id: string; role: string; departmentId: string | null },
  query: string
) {
  try {
    if (!query || !query.trim()) return null;
    const allowedScenes = await getAllowedScenesForUser(user);
    const ranked = await retrieveKnowledge({
      userDepartmentId: getEffectiveDepartmentId(user),
      isAdmin: isAdmin(user),
      allowedScenes,
      query
    });
    return ranked.length ? ranked : null;
  } catch (error) {
    console.warn("[generation] knowledge enhancement failed, falling back to base prompt", error);
    return null;
  }
}
