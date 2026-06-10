import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canCreateProject, jsonError, requireUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await requireUser();
    const where =
      user.role === "admin"
        ? {}
        : {
            OR: [{ creatorId: user.id }, { members: { some: { userId: user.id } } }]
          };
    const projects = await prisma.project.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        creator: { select: { nickname: true, username: true } },
        tasks: { select: { status: true, createdAt: true } }
      }
    });
    return NextResponse.json({ success: true, projects });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!(await canCreateProject(user.role))) {
      throw Object.assign(new Error("当前权限不能创建项目"), { status: 403 });
    }
    const { name, description } = await request.json();
    if (!name) throw Object.assign(new Error("项目名称必填"), { status: 400 });
    const project = await prisma.project.create({
      data: { name, description, creatorId: user.id }
    });
    return NextResponse.json({ success: true, project });
  } catch (error) {
    return jsonError(error);
  }
}
