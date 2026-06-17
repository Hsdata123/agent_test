import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { jsonError, requireAdmin } from "@/lib/auth";
import { getRole } from "@/lib/roles";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const admin = await requireAdmin();
    const body = await request.json();
    const data: { nickname?: string; role?: string; status?: string; passwordHash?: string; departmentId?: string | null } = {};
    if (id === admin.id && body.status === "disabled") throw Object.assign(new Error("不能停用当前登录的管理员"), { status: 400 });
    if (body.role && !(await getRole(body.role))) throw Object.assign(new Error("角色不存在，请先在角色设定中创建"), { status: 400 });
    for (const key of ["nickname", "role", "status"] as const) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    if (body.password) data.passwordHash = hashPassword(body.password);
    if (body.departmentId !== undefined) {
      data.departmentId = body.departmentId ? String(body.departmentId) : null;
    }
    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, username: true, nickname: true, role: true, status: true, departmentId: true }
    });
    return NextResponse.json({ success: true, user });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    if (id === admin.id) throw Object.assign(new Error("不能删除当前登录的管理员"), { status: 400 });
    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
