import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canShareProject, getProjectRole, jsonError, requireUser } from "@/lib/auth";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const role = await getProjectRole(id, user.id, user.role);
    if (!role || !(await canShareProject(role))) {
      throw Object.assign(new Error("当前权限不能共享项目"), { status: 403 });
    }
    const { userId, memberRole } = await request.json();
    const member = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: id, userId } },
      update: { role: memberRole || "viewer" },
      create: { projectId: id, userId, role: memberRole || "viewer" }
    });
    return NextResponse.json({ success: true, member });
  } catch (error) {
    return jsonError(error);
  }
}
