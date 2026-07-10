import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageScene, getEffectiveDepartmentId, isAdmin } from "@/lib/dept-scope";
import { invalidateSkillCache, getBuiltinSkillNames } from "@/lib/skills/registry";
import { validateConfigForMode, validateParametersSchema } from "@/lib/skills/management";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const skill = await prisma.skill.findUnique({ where: { id } });
    if (!skill || skill.deletedAt) {
      throw Object.assign(new Error("技能不存在"), { status: 404 });
    }
    if (!isAdmin(user) && skill.departmentId !== getEffectiveDepartmentId(user)) {
      throw Object.assign(new Error("无权访问该技能"), { status: 403 });
    }
    return NextResponse.json({ success: true, skill });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const existing = await prisma.skill.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw Object.assign(new Error("技能不存在"), { status: 404 });
    }
    if (!existing.departmentId || !(await canManageScene(user, existing.departmentId))) {
      throw Object.assign(new Error("无权限修改该技能"), { status: 403 });
    }
    const body = await request.json();
    const data: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw Object.assign(new Error("name 不能为空"), { status: 400 });
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) {
        throw Object.assign(new Error("name 需以字母开头,只能包含字母、数字、下划线"), { status: 400 });
      }
      if (getBuiltinSkillNames().includes(name)) {
        throw Object.assign(new Error(`名称 ${name} 与内置技能冲突`), { status: 400 });
      }
      if (name !== existing.name) {
        const conflict = await prisma.skill.findFirst({
          where: { name, deletedAt: null, id: { not: id } }
        });
        if (conflict) {
          throw Object.assign(new Error(`技能 ${name} 已存在`), { status: 409 });
        }
        data.name = name;
      }
    }
    if (body.displayName !== undefined) {
      const displayName = String(body.displayName).trim();
      if (!displayName) throw Object.assign(new Error("displayName 不能为空"), { status: 400 });
      data.displayName = displayName;
    }
    if (body.description !== undefined) {
      const description = String(body.description).trim();
      if (!description) throw Object.assign(new Error("description 不能为空"), { status: 400 });
      data.description = description;
    }
    if (body.systemPrompt !== undefined) {
      data.systemPrompt = body.systemPrompt ? String(body.systemPrompt) : null;
    }
    if (body.enabled !== undefined) {
      data.enabled = Boolean(body.enabled);
    }
    if (body.departmentId !== undefined) {
      const departmentId = String(body.departmentId);
      // 防御: departmentId 必须存在,否则 Prisma 抛 FK 违反转 500
      const dept = await prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } });
      if (!dept) {
        throw Object.assign(new Error(`部门 ${departmentId} 不存在,无法移动技能`), { status: 400 });
      }
      if (!(await canManageScene(user, departmentId))) {
        throw Object.assign(new Error("无权限移动到该部门"), { status: 403 });
      }
      data.departmentId = departmentId;
    }
    if (body.parameters !== undefined) {
      const parameters = parseJson(String(body.parameters), "parameters");
      validateParametersSchema(parameters);
      data.parameters = JSON.stringify(parameters);
    }
    if (body.executeMode !== undefined || body.executeConfig !== undefined) {
      const executeMode = body.executeMode !== undefined ? String(body.executeMode) : existing.executeMode;
      const executeConfig = body.executeConfig !== undefined
        ? parseJson(String(body.executeConfig), "executeConfig")
        : JSON.parse(existing.executeConfig);
      // validateConfigForMode 内部已校验 mode ∈ {search_kb, get_detail, no_op, exec_function}
      validateConfigForMode(executeMode, executeConfig);
      data.executeMode = executeMode;
      data.executeConfig = JSON.stringify(executeConfig);
    }

    data.updatedAt = new Date();
    const updated = await prisma.skill.update({ where: { id }, data });
    invalidateSkillCache();
    return NextResponse.json({ success: true, skill: updated });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const existing = await prisma.skill.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw Object.assign(new Error("技能不存在"), { status: 404 });
    }
    if (!existing.departmentId || !(await canManageScene(user, existing.departmentId))) {
      throw Object.assign(new Error("无权限删除该技能"), { status: 403 });
    }
    const now = new Date();
    await prisma.skill.update({ where: { id }, data: { deletedAt: now, updatedAt: now, enabled: false } });
    invalidateSkillCache();
    return NextResponse.json({ success: true });
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