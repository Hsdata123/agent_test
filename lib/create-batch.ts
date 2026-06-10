import type { User } from "@prisma/client";
import { canEdit, getProjectRole } from "./auth";
import { runTask } from "./generation";
import { prisma } from "./prisma";
import { DEFAULT_DETAIL_PROMPT_TEMPLATE, DEFAULT_MAIN_PROMPT_TEMPLATE } from "./prompts";
import { publicFileUrl } from "./storage";

export async function createBatchGeneration(user: User, body: Record<string, any>) {
  const tasks = await createGenerationTasks(user, body);
  void runTasksInOrder(tasks.map((task) => task.id));
  return serializeGenerationTasks(await hydrateGenerationTasks(tasks.map((task) => task.id)));
}

export async function createGenerationTasks(user: User, body: Record<string, any>) {
  const { projectId, parseIds, generationConfig } = body;
  const role = await getProjectRole(projectId, user.id, user.role);
  if (!role || !(await canEdit(role))) throw Object.assign(new Error("当前权限仅支持查看"), { status: 403 });

  const config = generationConfig || {};
  const mode = config.mode || "main_image";
  const includeMain = mode === "main_image" || mode === "main_image_and_detail_pages";
  const includeDetail = mode === "detail_pages" || mode === "main_image_and_detail_pages";
  const mainImageCount = Number(config.mainImageCount || config.main_image_count || 1);
  const detailPageCount = Number(config.detailPageCount || config.detail_page_count || 5);
  const mainImageSize = String(config.mainImageSize || config.imageSize || "2048x2048");
  const detailImageSize = String(config.detailImageSize || "1024x1792");
  const imageQuality = String(config.imageQuality || "high");
  const mainPromptTemplate = config.mainPromptTemplate || config.promptTemplates?.main;
  const detailPromptTemplate = config.detailPromptTemplate || config.promptTemplates?.detail;
  const fullPromptOverrides = typeof config.fullPromptOverrides === "object" && config.fullPromptOverrides ? config.fullPromptOverrides : {};
  const mainTemplateAssetId = typeof config.mainTemplateAssetId === "string" ? config.mainTemplateAssetId : undefined;
  const portraitAssetId = typeof config.portraitAssetId === "string" ? config.portraitAssetId : undefined;
  const mainTemplateAsset = mainTemplateAssetId
    ? await prisma.knowledgeAsset.findFirst({
        where: { id: mainTemplateAssetId, assetType: "main_template", enabled: true }
      })
    : null;
  const portraitAsset = portraitAssetId
    ? await prisma.knowledgeAsset.findFirst({
        where: { id: portraitAssetId, assetType: "portrait_white_image", enabled: true }
      })
    : null;

  const parses = await prisma.mechanismParse.findMany({
    where: { id: { in: parseIds || [] }, projectId },
    include: { items: true }
  });
  const tasks = [];
  for (const parse of parses) {
    const mainPromptOverride = promptOverride(fullPromptOverrides, `${parse.id}:main`);
    const mainPrompt = mainPromptOverride || mainPromptTemplate || DEFAULT_MAIN_PROMPT_TEMPLATE;
    if (includeMain) {
      tasks.push(
        await prisma.generationTask.create({
          data: {
            projectId,
            parseId: parse.id,
            createdById: user.id,
            outputType: "main_image",
            aspectRatio: "1:1",
            imageCount: mainImageCount,
            templateAssetId: mainTemplateAsset?.id,
            imageSize: mainImageSize,
            imageQuality,
            prompt: portraitAsset ? mainPromptPayload(mainPrompt, portraitAsset.id) : mainPrompt
          }
        })
      );
    }
    if (includeDetail) {
      const detailPromptConfig = detailPromptPayload(fullPromptOverrides, parse.id, detailPageCount, detailPromptTemplate || DEFAULT_DETAIL_PROMPT_TEMPLATE);
      tasks.push(
        await prisma.generationTask.create({
          data: {
            projectId,
            parseId: parse.id,
            createdById: user.id,
            outputType: "detail_pages",
            aspectRatio: "9:16",
            detailPageCount,
            imageCount: detailPageCount,
            imageSize: detailImageSize,
            imageQuality,
            prompt: detailPromptConfig || detailPromptTemplate || DEFAULT_DETAIL_PROMPT_TEMPLATE
          }
        })
      );
    }
  }

  return tasks;
}

export async function hydrateGenerationTasks(ids: string[]) {
  if (!ids.length) return [];
  const tasks = await prisma.generationTask.findMany({
    where: { id: { in: ids } },
    orderBy: { createdAt: "desc" },
    include: { parse: true, results: true, project: true }
  });
  return tasks;
}

export function serializeGenerationTasks<T extends Array<{ results: Array<{ imagePath: string }> }>>(tasks: T) {
  return tasks.map((task) => ({
    ...task,
    results: task.results.map((result) => ({ ...result, imageUrl: publicFileUrl(result.imagePath) }))
  }));
}

async function runTasksInOrder(ids: string[]) {
  for (const id of ids) {
    try {
      await runTask(id);
    } catch (error) {
      console.error(`Generation task ${id} failed`, error);
    }
  }
}

function promptOverride(overrides: Record<string, unknown>, key: string) {
  const value = overrides[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function detailPromptPayload(overrides: Record<string, unknown>, parseId: string, pageCount: number, template: string) {
  const prompts: Record<string, string> = {};
  for (let page = 1; page <= pageCount; page++) {
    const value = promptOverride(overrides, `${parseId}:detail:${page}`);
    if (value) prompts[String(page)] = value;
  }
  if (!Object.keys(prompts).length) return undefined;
  return JSON.stringify({ kind: "detail_full_prompts", template, prompts });
}

function mainPromptPayload(template: string, portraitAssetId: string) {
  return JSON.stringify({ kind: "main_prompt_config", template, portraitAssetId });
}
