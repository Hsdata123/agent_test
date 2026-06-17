import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageScene, getEffectiveDepartmentId, isAdmin } from "@/lib/dept-scope";
import { buildUserSkill } from "@/lib/skills/user-skill";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const row = await prisma.skill.findUnique({ where: { id } });
    if (!row || row.deletedAt) {
      throw Object.assign(new Error("技能不存在"), { status: 404 });
    }
    if (!isAdmin(user) && row.departmentId !== getEffectiveDepartmentId(user)) {
      throw Object.assign(new Error("无权测试该技能"), { status: 403 });
    }
    if (!row.departmentId || !(await canManageScene(user, row.departmentId))) {
      throw Object.assign(new Error("无权限测试该技能"), { status: 403 });
    }
    const skill = buildUserSkill(row);
    if (!skill) {
      throw Object.assign(new Error("技能配置不合法,无法执行"), { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    const args = body && typeof body === "object" && body.args && typeof body.args === "object"
      ? (body.args as Record<string, unknown>)
      : (body as Record<string, unknown>) || {};

    const result = await skill.execute(args, { user });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return jsonError(error);
  }
}
