import { prisma } from "./prisma";

export type SceneInput = {
  departmentId: string;
  sceneKey: string;
  sceneName: string;
  description?: string | null;
};

export function parseScenesString(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function serializeScenes(arr: string[] | null | undefined): string {
  if (!Array.isArray(arr)) return "[]";
  const cleaned = Array.from(new Set(arr.map((s) => String(s).trim()).filter(Boolean)));
  return JSON.stringify(cleaned);
}

export async function listScenes(params: { departmentId?: string } = {}) {
  return prisma.businessScene.findMany({
    where: params.departmentId ? { departmentId: params.departmentId } : undefined,
    orderBy: [{ departmentId: "asc" }, { createdAt: "asc" }]
  });
}

export async function getScene(id: string) {
  return prisma.businessScene.findUnique({ where: { id } });
}

export async function createScene(input: SceneInput) {
  if (!input.departmentId) throw Object.assign(new Error("缺少部门 ID"), { status: 400 });
  if (!/^[\p{L}][\p{L}\p{N}_-]{0,31}$/u.test(input.sceneKey)) {
    throw Object.assign(new Error("场景标识需为 1-32 位字母/数字/下划线/短横线，且以字母开头（支持中文）"), { status: 400 });
  }
  if (!input.sceneName?.trim()) {
    throw Object.assign(new Error("场景名称不能为空"), { status: 400 });
  }
  return prisma.businessScene.create({
    data: {
      departmentId: input.departmentId,
      sceneKey: input.sceneKey.trim(),
      sceneName: input.sceneName.trim(),
      description: input.description?.trim() || null
    }
  });
}

export async function updateScene(id: string, patch: Partial<SceneInput>) {
  const data: Record<string, unknown> = {};
  if (patch.sceneKey !== undefined) {
    if (!/^[\p{L}][\p{L}\p{N}_-]{0,31}$/u.test(patch.sceneKey)) {
      throw Object.assign(new Error("场景标识格式不正确（1-32 位字母/数字/下划线/短横线，以字母开头，支持中文）"), { status: 400 });
    }
    data.sceneKey = patch.sceneKey.trim();
  }
  if (patch.sceneName !== undefined) data.sceneName = patch.sceneName.trim();
  if (patch.description !== undefined) data.description = patch.description?.trim() || null;
  return prisma.businessScene.update({ where: { id }, data });
}

export async function deleteScene(id: string) {
  return prisma.businessScene.delete({ where: { id } });
}

export async function getAllowedScenesForUser(user: { role: string; departmentId: string | null }) {
  if (user.role === "admin") {
    const all = await prisma.businessScene.findMany();
    return all.map((s) => s.sceneKey);
  }
  if (!user.departmentId) return [];
  const scenes = await prisma.businessScene.findMany({ where: { departmentId: user.departmentId } });
  return scenes.map((s) => s.sceneKey);
}
