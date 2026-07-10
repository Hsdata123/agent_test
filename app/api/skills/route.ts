import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageScene, getEffectiveDepartmentId, isAdmin } from "@/lib/dept-scope";

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

export async function POST() {
  return NextResponse.json({
    success: false,
    code: "MANUAL_CREATE_DISABLED",
    error: "技能手动创建入口已关闭,请通过对话中的 skillCreator 技能创建(对 AI 说『帮我创建一个新技能: ...』)"
  }, { status: 403 });
}