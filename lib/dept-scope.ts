import type { User, KnowledgeAsset } from "@prisma/client";
import { roleHasPermission } from "./roles";

export const DEFAULT_DEPARTMENT_ID = "dept_default";

export function isAdmin(user: Pick<User, "role">) {
  return user.role === "admin";
}

export function getEffectiveDepartmentId(user: Pick<User, "departmentId">) {
  return user.departmentId || DEFAULT_DEPARTMENT_ID;
}

export function canEditAsset(
  user: Pick<User, "role" | "departmentId">,
  asset: Pick<KnowledgeAsset, "departmentId">
) {
  if (isAdmin(user)) return true;
  if (!user.departmentId) return false;
  return asset.departmentId === user.departmentId;
}

export async function canManageScene(
  user: Pick<User, "role" | "departmentId">,
  targetDepartmentId: string
) {
  if (isAdmin(user)) return true;
  if (await roleHasPermission(user.role, "manage_settings")) return true;
  if (user.role === "creator" && user.departmentId === targetDepartmentId) return true;
  return false;
}

export function requireDeptAccess(
  user: Pick<User, "role" | "departmentId">,
  targetDepartmentId: string | null | undefined
) {
  if (isAdmin(user)) return;
  if (!targetDepartmentId) return;
  if (user.departmentId !== targetDepartmentId) {
    throw Object.assign(new Error("无权访问其他部门资源"), { status: 403 });
  }
}

export function scopedKnowledgeWhere<T extends Record<string, unknown>>(
  user: Pick<User, "role" | "departmentId">,
  baseWhere: T
): T & { departmentId?: string } {
  if (isAdmin(user)) return baseWhere;
  return { ...baseWhere, departmentId: getEffectiveDepartmentId(user) };
}
