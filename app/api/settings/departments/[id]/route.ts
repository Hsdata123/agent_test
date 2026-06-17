import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { deleteDepartment, getDepartment, updateDepartment } from "@/lib/departments";
import { isAdmin } from "@/lib/dept-scope";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    const department = await getDepartment(id);
    if (!department) throw Object.assign(new Error("部门不存在"), { status: 404 });
    return NextResponse.json({ success: true, department });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) throw Object.assign(new Error("仅超级管理员可修改部门信息"), { status: 403 });
    const { id } = await context.params;
    const body = await request.json();
    const department = await updateDepartment(id, {
      name: body.name !== undefined ? String(body.name) : undefined,
      code: body.code !== undefined ? (body.code ? String(body.code) : null) : undefined,
      description: body.description !== undefined ? (body.description ? String(body.description) : null) : undefined,
      status: body.status !== undefined ? String(body.status) : undefined
    });
    return NextResponse.json({ success: true, department });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) throw Object.assign(new Error("仅超级管理员可删除部门"), { status: 403 });
    const { id } = await context.params;
    await deleteDepartment(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
