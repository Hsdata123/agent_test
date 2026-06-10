import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageProject, getProjectRole, jsonError, requireUser } from "@/lib/auth";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const role = await getProjectRole(id, user.id, user.role);
    if (!role) throw Object.assign(new Error("你没有该项目的访问权限"), { status: 403 });
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, nickname: true, username: true } },
        members: { include: { user: { select: { id: true, nickname: true, username: true } } } }
      }
    });
    return NextResponse.json({ success: true, project, role });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const role = await getProjectRole(id, user.id, user.role);
    if (!role || !(await canManageProject(role)) || role === "editor") throw Object.assign(new Error("当前权限不能修改项目"), { status: 403 });
    const { name, description, status } = await request.json();
    const project = await prisma.project.update({
      where: { id },
      data: { name, description, status }
    });
    return NextResponse.json({ success: true, project });
  } catch (error) {
    return jsonError(error);
  }
}
