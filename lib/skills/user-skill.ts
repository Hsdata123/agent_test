import type { Skill as PrismaSkill } from "@prisma/client";
import { runPythonHandler } from "./sandbox/runner";
import { getSkill } from "./registry";
import type { JsonSchema, Skill, SkillContext, SkillDefinition, SkillResult } from "./types";

export type UserSkillConfig = {
  executeMode?: "search_kb" | "get_detail" | "no_op" | "exec_function";
  queryParam?: string;
  limitParam?: string;
  assetTypeParam?: string;
  assetIdParam?: string;
  template?: string;
  /** exec_function 模式专用: Python 源码, 必须定义 def handler(**kwargs) -> dict */
  handler?: string;
};

export type UserSkillRow = Pick<
  PrismaSkill,
  "id" | "name" | "displayName" | "description" | "parameters" | "executeMode" | "executeConfig" | "systemPrompt"
>;

export function buildUserSkill(row: UserSkillRow): Skill | null {
  const parameters = parseParameters(row.parameters);
  if (!parameters) return null;
  const config = parseConfig(row.executeConfig);
  if (!config) return null;
  if (!validateConfig(row.executeMode, config)) return null;

  const definition: SkillDefinition = {
    name: row.name,
    description: row.description,
    parameters
  };

  return {
    definition,
    async execute(args, ctx): Promise<SkillResult> {
      const content = await runExecute(row.executeMode, config, args, ctx);
      const ok = content.ok;
      const finalContent = ok && row.systemPrompt
        ? `${row.systemPrompt.trim()}\n\n${content.content}`
        : content.content;
      return {
        callId: "",
        name: row.name,
        ok,
        content: finalContent,
        meta: content.meta,
        error: content.error
      };
    }
  };
}

function parseParameters(raw: string): SkillDefinition["parameters"] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || (parsed as JsonSchema).type !== "object") return null;
  const obj = parsed as { properties?: Record<string, JsonSchema>; required?: string[] };
  const properties = obj.properties || {};
  const required = Array.isArray(obj.required) ? obj.required.filter((k) => typeof k === "string") : [];
  return { type: "object", properties, required };
}

function parseConfig(raw: string): UserSkillConfig | null {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as UserSkillConfig;
  } catch {
    return null;
  }
}

function validateConfig(mode: string, config: UserSkillConfig) {
  if (mode === "search_kb") {
    return typeof config.queryParam === "string" && config.queryParam.length > 0;
  }
  if (mode === "get_detail") {
    return typeof config.assetIdParam === "string" && config.assetIdParam.length > 0;
  }
  if (mode === "no_op") {
    return typeof config.template === "string";
  }
  return false;
}

type ExecuteResult = { ok: boolean; content: string; meta?: Record<string, unknown>; error?: string };

async function runExecute(
  mode: string,
  config: UserSkillConfig,
  args: Record<string, unknown>,
  ctx: SkillContext
): Promise<ExecuteResult> {
  if (mode === "search_kb") {
    const skill = await getSkill("searchKnowledgeBase");
    if (!skill) return { ok: false, content: "", error: "内置 searchKnowledgeBase 不可用" };
    const mapped: Record<string, unknown> = {};
    if (config.queryParam) mapped.query = readArg(args, config.queryParam);
    if (config.limitParam) mapped.limit = readArg(args, config.limitParam);
    if (config.assetTypeParam) mapped.assetType = readArg(args, config.assetTypeParam);
    if (mapped.query === undefined || mapped.query === "") {
      return { ok: false, content: "", error: `缺少必填参数 ${config.queryParam}` };
    }
    return invoke(skill, mapped, ctx);
  }
  if (mode === "get_detail") {
    const skill = await getSkill("getAssetDetail");
    if (!skill) return { ok: false, content: "", error: "内置 getAssetDetail 不可用" };
    const assetId = config.assetIdParam ? readArg(args, config.assetIdParam) : undefined;
    if (!assetId) {
      return { ok: false, content: "", error: `缺少必填参数 ${config.assetIdParam}` };
    }
    return invoke(skill, { assetId }, ctx);
  }
  if (mode === "no_op") {
    const template = config.template || "";
    return { ok: true, content: renderTemplate(template, args) };
  }
  if (mode === "exec_function") {
    return runExecFunction(config.handler || "", args);
  }
  return { ok: false, content: "", error: `不支持的 executeMode: ${mode}` };
}

async function runExecFunction(handler: string, args: Record<string, unknown>): Promise<ExecuteResult> {
  if (!handler.trim()) {
    return { ok: false, content: "", error: "缺少 handler 字段" };
  }
  const result = await runPythonHandler(handler, args);
  if (result.ok) {
    return {
      ok: true,
      content: JSON.stringify(result.data, null, 2),
      meta: { data: result.data, durationMs: result.durationMs }
    };
  }
  return { ok: false, content: "", error: `exec_function: ${result.error}` };
}

async function invoke(skill: Skill, mapped: Record<string, unknown>, ctx: SkillContext): Promise<ExecuteResult> {
  try {
    const result = await skill.execute(mapped, ctx);
    return { ok: result.ok, content: result.content, meta: result.meta, error: result.error };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, content: "", error: message };
  }
}

function readArg(args: Record<string, unknown>, key: string): unknown {
  if (!key) return undefined;
  return args[key];
}

const PLACEHOLDER_RE = /\{\{\s*args\.([a-zA-Z0-9_]+)\s*\}\}/g;

function renderTemplate(template: string, args: Record<string, unknown>) {
  return template.replace(PLACEHOLDER_RE, (_, key) => {
    const value = args[key];
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  });
}
