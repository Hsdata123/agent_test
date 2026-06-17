import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageScene, getEffectiveDepartmentId, isAdmin } from "@/lib/dept-scope";
import { invalidateSkillCache } from "@/lib/skills/registry";
import { getBuiltinSkillNames } from "@/lib/skills/registry";

const VALID_MODES = new Set(["search_kb", "get_detail", "no_op"]);

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const departmentIdFilter = searchParams.get("departmentId") || undefined;
    const includeDisabled = searchParams.get("includeDisabled") === "true";

    const where: Record<string, unknown> = { deletedAt: null };
    if (!includeDisabled) where.enabled = true;
    if (departmentIdFilter) {
      where.departmentId = departmentIdFilter;
    } else if (!isAdmin(user)) {
      where.departmentId = getEffectiveDepartmentId(user);
    }

    const rows = await prisma.skill.findMany({
      where,
      orderBy: { updatedAt: "desc" }
    });
    return NextResponse.json({ success: true, skills: rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const name = String(body.name || "").trim();
    const displayName = String(body.displayName || "").trim();
    const description = String(body.description || "").trim();
    const executeMode = String(body.executeMode || "search_kb");
    const parametersRaw = body.parameters !== undefined ? String(body.parameters) : '{"type":"object","properties":{},"required":[]}';
    const executeConfigRaw = body.executeConfig !== undefined ? String(body.executeConfig) : "{}";
    const systemPrompt = body.systemPrompt ? String(body.systemPrompt) : null;
    const enabled = body.enabled === false ? false : true;
    const departmentId = body.departmentId ? String(body.departmentId) : getEffectiveDepartmentId(user);

    if (!name) throw Object.assign(new Error("技能名称 (name) 不能为空"), { status: 400 });
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) {
      throw Object.assign(new Error("name 需以字母开头,只能包含字母、数字、下划线"), { status: 400 });
    }
    if (getBuiltinSkillNames().includes(name)) {
      throw Object.assign(new Error(`名称 ${name} 与内置技能冲突`), { status: 400 });
    }
    if (!displayName) throw Object.assign(new Error("显示名称 (displayName) 不能为空"), { status: 400 });
    if (!description) throw Object.assign(new Error("描述 (description) 不能为空"), { status: 400 });
    if (!VALID_MODES.has(executeMode)) {
      throw Object.assign(new Error(`不支持的 executeMode: ${executeMode}`), { status: 400 });
    }
    if (!(await canManageScene(user, departmentId))) {
      throw Object.assign(new Error("无权限在该部门下创建技能"), { status: 403 });
    }

    const parameters = parseJson(parametersRaw, "parameters");
    validateParametersSchema(parameters);
    const executeConfig = parseJson(executeConfigRaw, "executeConfig");
    validateConfigForMode(executeMode, executeConfig);

    const existing = await prisma.skill.findFirst({ where: { name, deletedAt: null } });
    if (existing) {
      throw Object.assign(new Error(`技能 ${name} 已存在`), { status: 409 });
    }
    const softDeleted = await prisma.skill.findFirst({ where: { name, deletedAt: { not: null } } });
    if (softDeleted) {
      throw Object.assign(new Error(`技能 ${name} 已存在(已软删),如需恢复请改名`), { status: 409 });
    }

    const now = new Date();
    const skill = await prisma.skill.create({
      data: {
        name,
        displayName,
        description,
        parameters: JSON.stringify(parameters),
        executeMode,
        executeConfig: JSON.stringify(executeConfig),
        systemPrompt,
        enabled,
        departmentId,
        createdById: user.id,
        createdAt: now,
        updatedAt: now
      }
    });
    invalidateSkillCache();
    return NextResponse.json({ success: true, skill });
  } catch (error) {
    return jsonError(error);
  }
}

function parseJson(raw: string, field: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error(`${field} 不是合法 JSON`), { status: 400 });
  }
}

function validateParametersSchema(value: unknown) {
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

function validateConfigForMode(mode: string, config: unknown) {
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
  }
}
