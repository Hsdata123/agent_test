import type { User } from "@prisma/client";
import { prisma } from "../prisma";
import { canManageScene } from "../dept-scope";
import { getBuiltinSkillNames, invalidateSkillCache } from "./registry";
import { FORBIDDEN_MODULE_HINTS, MAX_HANDLER_BYTES } from "./sandbox/policy";

const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const VALID_MODES = new Set(["search_kb", "get_detail", "no_op", "exec_function"]);

// ============ 校验器 ============

export function validateSkillName(name: string): void {
  if (!name) throw Object.assign(new Error("技能名称 (name) 不能为空"), { status: 400 });
  if (!NAME_RE.test(name)) {
    throw Object.assign(new Error("name 需以字母开头,只能包含字母、数字、下划线"), { status: 400 });
  }
  if (getBuiltinSkillNames().includes(name)) {
    throw Object.assign(new Error(`名称 ${name} 与内置技能冲突`), { status: 400 });
  }
}

export function validateParametersSchema(value: unknown): asserts value is { type: "object"; properties?: Record<string, unknown>; required?: string[] } {
  if (!value || typeof value !== "object") {
    throw Object.assign(new Error("parameters 必须是对象"), { status: 400 });
  }
  const obj = value as { type?: string; properties?: Record<string, unknown>; required?: unknown };
  if (obj.type !== "object") {
    throw Object.assign(new Error('parameters.type 必须为 "object"'), { status: 400 });
  }
  if (obj.properties && typeof obj.properties !== "object") {
    throw Object.assign(new Error("parameters.properties 必须为对象"), { status: 400 });
  }
  if (obj.required && !Array.isArray(obj.required)) {
    throw Object.assign(new Error("parameters.required 必须为字符串数组"), { status: 400 });
  }
}

export function validateConfigForMode(mode: string, config: unknown): void {
  if (!VALID_MODES.has(mode)) {
    throw Object.assign(new Error(`不支持的 executeMode: ${mode}`), { status: 400 });
  }
  if (!config || typeof config !== "object") {
    throw Object.assign(new Error("executeConfig 必须是对象"), { status: 400 });
  }
  const cfg = config as Record<string, unknown>;
  if (mode === "search_kb") {
    if (typeof cfg.queryParam !== "string" || cfg.queryParam.length === 0) {
      throw Object.assign(new Error("search_kb 模式需要 queryParam"), { status: 400 });
    }
  } else if (mode === "get_detail") {
    if (typeof cfg.assetIdParam !== "string" || cfg.assetIdParam.length === 0) {
      throw Object.assign(new Error("get_detail 模式需要 assetIdParam"), { status: 400 });
    }
  } else if (mode === "no_op") {
    if (typeof cfg.template !== "string") {
      throw Object.assign(new Error("no_op 模式需要 template"), { status: 400 });
    }
  } else if (mode === "exec_function") {
    if (typeof cfg.handler !== "string" || cfg.handler.trim().length === 0) {
      throw Object.assign(new Error("exec_function 模式需要 handler (Python 源码字符串)"), { status: 400 });
    }
    if (cfg.handler.length > MAX_HANDLER_BYTES) {
      throw Object.assign(new Error(`handler 过长 (上限 ${MAX_HANDLER_BYTES / 1024}KB)`), { status: 400 });
    }
    const lower = cfg.handler.toLowerCase();
    for (const hint of FORBIDDEN_MODULE_HINTS) {
      if (lower.includes(hint)) {
        throw Object.assign(new Error(`handler 包含禁用模块/调用: ${hint}`), { status: 400 });
      }
    }
  }
}

function safeParseJson(raw: string, field: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error(`${field} 不是合法 JSON`), { status: 400 });
  }
}

// ============ Parsed input shape ============

export type ParsedCreateInput = {
  name: string;
  displayName: string;
  description: string;
  parameters: unknown;
  executeMode: string;
  executeConfig: unknown;
  systemPrompt: string | null;
  enabled: boolean;
  departmentId: string;
};

export function parseCreateInput(body: Record<string, unknown>): ParsedCreateInput {
  const name = String(body.name || "").trim();
  const displayName = String(body.displayName || "").trim();
  const description = String(body.description || "").trim();
  const executeMode = String(body.executeMode || "search_kb");
  const systemPrompt = body.systemPrompt ? String(body.systemPrompt) : null;
  const enabled = body.enabled === false ? false : true;
  const departmentId = body.departmentId ? String(body.departmentId) : "";
  // 注意: 字段名必须与 skill-creator.ts 暴露给 LLM 的 schema 一致 (parametersJson / executeConfigJson),
  // 也与 updateUserSkillServer 接受 updatesJson 的键一致。早期版本误用短名,导致 LLM 按文档传参被静默丢弃。
  const parameters = body.parametersJson !== undefined
    ? safeParseJson(String(body.parametersJson), "parametersJson")
    : { type: "object", properties: {}, required: [] };
  const executeConfig = body.executeConfigJson !== undefined
    ? safeParseJson(String(body.executeConfigJson), "executeConfigJson")
    : {};
  return { name, displayName, description, parameters, executeMode, executeConfig, systemPrompt, enabled, departmentId };
}

// ============ 服务端 helper ============

export type CreatedSkillSummary = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  executeMode: string;
  departmentId: string;
};

export async function createUserSkillServer(input: ParsedCreateInput, actor: User): Promise<CreatedSkillSummary> {
  validateSkillName(input.name);
  if (!input.displayName) throw Object.assign(new Error("显示名称 (displayName) 不能为空"), { status: 400 });
  if (!input.description) throw Object.assign(new Error("描述 (description) 不能为空"), { status: 400 });
  validateParametersSchema(input.parameters);
  validateConfigForMode(input.executeMode, input.executeConfig);
  // 防御: departmentId 必须是已存在的 Department 行,否则直接 400 而不是让 Prisma 抛 FK 违反 500
  if (input.departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: input.departmentId }, select: { id: true } });
    if (!dept) {
      throw Object.assign(new Error(`部门 ${input.departmentId} 不存在,无法创建技能`), { status: 400 });
    }
  }
  if (!(await canManageScene(actor, input.departmentId))) {
    throw Object.assign(new Error("无权限在该部门下创建技能"), { status: 403 });
  }
  const existing = await prisma.skill.findFirst({ where: { name: input.name, deletedAt: null } });
  if (existing) {
    throw Object.assign(new Error(`技能 ${input.name} 已存在`), { status: 409 });
  }
  const softDeleted = await prisma.skill.findFirst({ where: { name: input.name, deletedAt: { not: null } } });
  if (softDeleted) {
    throw Object.assign(new Error(`技能 ${input.name} 已存在(已软删),如需恢复请改名`), { status: 409 });
  }
  const now = new Date();
  const skill = await prisma.skill.create({
    data: {
      name: input.name,
      displayName: input.displayName,
      description: input.description,
      parameters: JSON.stringify(input.parameters),
      executeMode: input.executeMode,
      executeConfig: JSON.stringify(input.executeConfig),
      systemPrompt: input.systemPrompt,
      enabled: input.enabled,
      departmentId: input.departmentId,
      createdById: actor.id,
      createdAt: now,
      updatedAt: now
    }
  });
  invalidateSkillCache();
  return {
    id: skill.id,
    name: skill.name,
    displayName: skill.displayName,
    description: skill.description,
    executeMode: skill.executeMode,
    departmentId: skill.departmentId || ""
  };
}

export type UpdatedSkillSummary = {
  id: string;
  updatedFields: string[];
};

const ALLOWED_UPDATE_FIELDS = new Set([
  "displayName",
  "description",
  "executeMode",
  "executeConfigJson",
  "parametersJson",
  "systemPrompt",
  "enabled",
  "departmentId",
  "name"
]);

export async function updateUserSkillServer(
  skillId: string,
  updates: Record<string, unknown>,
  actor: User
): Promise<UpdatedSkillSummary> {
  const existing = await prisma.skill.findUnique({ where: { id: skillId } });
  if (!existing || existing.deletedAt) {
    throw Object.assign(new Error("技能不存在"), { status: 404 });
  }
  if (!(await canManageScene(actor, existing.departmentId || ""))) {
    throw Object.assign(new Error("无权限修改该技能"), { status: 403 });
  }
  const data: Record<string, unknown> = {};
  const updatedFields: string[] = [];

  for (const key of Object.keys(updates)) {
    if (!ALLOWED_UPDATE_FIELDS.has(key)) {
      throw Object.assign(new Error(`updatesJson 不允许字段: ${key}`), { status: 400 });
    }
  }

  if (updates.name !== undefined) {
    const name = String(updates.name).trim();
    validateSkillName(name);
    if (name !== existing.name) {
      const conflict = await prisma.skill.findFirst({ where: { name, deletedAt: null, id: { not: skillId } } });
      if (conflict) throw Object.assign(new Error(`技能 ${name} 已存在`), { status: 409 });
    }
    data.name = name;
    updatedFields.push("name");
  }
  if (updates.displayName !== undefined) {
    const displayName = String(updates.displayName).trim();
    if (!displayName) throw Object.assign(new Error("displayName 不能为空"), { status: 400 });
    data.displayName = displayName;
    updatedFields.push("displayName");
  }
  if (updates.description !== undefined) {
    const description = String(updates.description).trim();
    if (!description) throw Object.assign(new Error("description 不能为空"), { status: 400 });
    data.description = description;
    updatedFields.push("description");
  }
  if (updates.systemPrompt !== undefined) {
    data.systemPrompt = updates.systemPrompt ? String(updates.systemPrompt) : null;
    updatedFields.push("systemPrompt");
  }
  if (updates.enabled !== undefined) {
    data.enabled = Boolean(updates.enabled);
    updatedFields.push("enabled");
  }
  if (updates.departmentId !== undefined) {
    const departmentId = String(updates.departmentId);
    if (!(await canManageScene(actor, departmentId))) {
      throw Object.assign(new Error("无权限移动到该部门"), { status: 403 });
    }
    data.departmentId = departmentId;
    updatedFields.push("departmentId");
  }
  if (updates.parametersJson !== undefined) {
    const parameters = safeParseJson(String(updates.parametersJson), "parameters");
    validateParametersSchema(parameters);
    data.parameters = JSON.stringify(parameters);
    updatedFields.push("parameters");
  }
  if (updates.executeMode !== undefined || updates.executeConfigJson !== undefined) {
    const executeMode = updates.executeMode !== undefined ? String(updates.executeMode) : existing.executeMode;
    const executeConfig = updates.executeConfigJson !== undefined
      ? safeParseJson(String(updates.executeConfigJson), "executeConfig")
      : JSON.parse(existing.executeConfig);
    validateConfigForMode(executeMode, executeConfig);
    data.executeMode = executeMode;
    data.executeConfig = JSON.stringify(executeConfig);
    if (updates.executeMode !== undefined) updatedFields.push("executeMode");
    if (updates.executeConfigJson !== undefined) updatedFields.push("executeConfig");
  }

  if (updatedFields.length === 0) {
    throw Object.assign(new Error("updatesJson 为空,无可更新字段"), { status: 400 });
  }
  data.updatedAt = new Date();
  await prisma.skill.update({ where: { id: skillId }, data });
  invalidateSkillCache();
  return { id: skillId, updatedFields };
}
