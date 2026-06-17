import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { roleHasPermission } from "./roles";

export const SESSION_COOKIE = "commerce_session";
export type UserRole = "admin" | "creator" | "editor" | "viewer";

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt }
  });
  return { token, expiresAt };
}

export async function getCurrentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true }
  });
  if (!session || session.expiresAt < new Date() || session.user.status !== "active") return null;
  return session.user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw Object.assign(new Error("未登录或登录已过期"), { status: 401 });
  }
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin" && !(await roleHasPermission(user.role, "manage_settings"))) {
    throw Object.assign(new Error("无权限访问 API 配置"), { status: 403 });
  }
  return user;
}

export async function requireDeptAdmin(targetDepartmentId?: string | null) {
  const user = await requireUser();
  if (user.role === "admin") return user;
  if (await roleHasPermission(user.role, "manage_settings")) return user;
  if (user.role === "creator" && user.departmentId && (!targetDepartmentId || targetDepartmentId === user.departmentId)) {
    return user;
  }
  throw Object.assign(new Error("无权限管理部门/场景配置"), { status: 403 });
}

export async function canEdit(role: string) {
  return role === "admin" || role === "creator" || role === "editor" || (await roleHasPermission(role, "generate_image"));
}

export async function canManageProject(role: string) {
  return role === "admin" || role === "creator" || (await roleHasPermission(role, "manage_project"));
}

export async function canShareProject(role: string) {
  return role === "admin" || role === "creator" || (await roleHasPermission(role, "share_project"));
}

export async function canCreateProject(role: string) {
  return role === "admin" || role === "creator" || (await roleHasPermission(role, "create_project"));
}

export async function getProjectRole(projectId: string, userId: string, fallbackRole: string) {
  if (fallbackRole === "admin") return "admin" as UserRole;
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return null;
  if (project.creatorId === userId) return "creator" as UserRole;
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } }
  });
  return (member?.role as UserRole | undefined) ?? null;
}

export function jsonError(error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
  const message = error instanceof Error ? error.message : "服务异常";
  return NextResponse.json({ success: false, message }, { status: status || 500 });
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    expires: expiresAt,
    path: "/"
  });
}
