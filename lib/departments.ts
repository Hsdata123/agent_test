import { prisma } from "./prisma";
import { DEFAULT_DEPARTMENT_ID } from "./dept-scope";

export type DepartmentInput = {
  name: string;
  code?: string | null;
  description?: string | null;
  status?: string;
};

export async function ensureDefaultDepartment() {
  await prisma.department.upsert({
    where: { id: DEFAULT_DEPARTMENT_ID },
    update: {},
    create: {
      id: DEFAULT_DEPARTMENT_ID,
      name: "默认部门",
      code: "default",
      description: "系统初始部门，可重命名或新增其他部门"
    }
  });
}

export async function listDepartments() {
  return prisma.department.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "asc" }]
  });
}

export async function getDepartment(id: string) {
  return prisma.department.findUnique({ where: { id } });
}

export async function createDepartment(input: DepartmentInput) {
  if (!input.name?.trim()) {
    throw Object.assign(new Error("部门名称不能为空"), { status: 400 });
  }
  return prisma.department.create({
    data: {
      name: input.name.trim(),
      code: input.code?.trim() || null,
      description: input.description?.trim() || null,
      status: input.status || "active"
    }
  });
}

export async function updateDepartment(id: string, patch: Partial<DepartmentInput>) {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.code !== undefined) data.code = patch.code?.trim() || null;
  if (patch.description !== undefined) data.description = patch.description?.trim() || null;
  if (patch.status !== undefined) data.status = patch.status;
  return prisma.department.update({ where: { id }, data });
}

export async function deleteDepartment(id: string) {
  if (id === DEFAULT_DEPARTMENT_ID) {
    throw Object.assign(new Error("默认部门不能删除"), { status: 400 });
  }
  const count = await prisma.department.count();
  if (count <= 1) {
    throw Object.assign(new Error("至少保留一个部门"), { status: 400 });
  }
  const userCount = await prisma.user.count({ where: { departmentId: id } });
  if (userCount > 0) {
    throw Object.assign(new Error(`部门下仍有 ${userCount} 个用户，请先迁移`), { status: 400 });
  }
  const assetCount = await prisma.knowledgeAsset.count({ where: { departmentId: id } });
  if (assetCount > 0) {
    throw Object.assign(new Error(`部门下仍有 ${assetCount} 条知识库资料，请先迁移`), { status: 400 });
  }
  return prisma.department.delete({ where: { id } });
}
