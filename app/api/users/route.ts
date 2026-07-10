import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { jsonError, requireAdmin } from "@/lib/auth";
import { getRole } from "@/lib/roles";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const shareScope = url.searchParams.get("scope") === "share";
    if (!shareScope) {
      await requireAdmin();
    }
    const users = await prisma.user.findMany({
      where: shareScope ? { status: "active" } : undefined,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        username: true,
        nickname: true,
        role: true,
        status: true,
        departmentId: true,
        advertiserId: true,
        createdAt: true,
        lastLoginAt: true
      }
    });
    return NextResponse.json({ success: true, users });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const { username, nickname, password, role, departmentId } = await request.json();
    if (!username || !password) throw Object.assign(new Error("账号和密码必填"), { status: 400 });
    const roleKey = role || "creator";
    if (!(await getRole(roleKey))) throw Object.assign(new Error("角色不存在，请先在角色设定中创建"), { status: 400 });
    const user = await prisma.user.create({
      data: {
        username,
        nickname: nickname || username,
        passwordHash: hashPassword(password),
        role: roleKey,
        departmentId: departmentId ? String(departmentId) : null
      },
      select: { id: true, username: true, nickname: true, role: true, status: true, departmentId: true }
    });
    return NextResponse.json({ success: true, user });
  } catch (error) {
    return jsonError(error);
  }
}
