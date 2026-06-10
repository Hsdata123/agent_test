import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { createSession, jsonError, setSessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();
    if (!username) return NextResponse.json({ success: false, message: "请输入账号" }, { status: 400 });
    if (!password) return NextResponse.json({ success: false, message: "请输入密码" }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ success: false, message: "账号或密码不正确" }, { status: 401 });
    }
    if (user.status !== "active") {
      return NextResponse.json({ success: false, message: "当前账号已停用，请联系管理员" }, { status: 403 });
    }

    const session = await createSession(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        role: user.role,
        status: user.status
      }
    });
    setSessionCookie(response, session.token, session.expiresAt);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
