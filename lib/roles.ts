import { prisma } from "./prisma";

export type RoleDefinition = {
  key: string;
  name: string;
  permissions: string[];
  system: boolean;
};

export const permissionOptions = [
  "manage_settings",
  "manage_users",
  "create_project",
  "manage_project",
  "share_project",
  "generate_image",
  "manage_knowledge",
  "download_results"
];

const defaultRoles: RoleDefinition[] = [
  {
    key: "admin",
    name: "管理员",
    system: true,
    permissions: permissionOptions
  },
  {
    key: "creator",
    name: "项目创建者",
    system: true,
    permissions: ["create_project", "manage_project", "share_project", "generate_image", "manage_knowledge", "download_results"]
  },
  {
    key: "editor",
    name: "编辑成员",
    system: true,
    permissions: ["generate_image", "manage_knowledge", "download_results"]
  },
  {
    key: "viewer",
    name: "查看成员",
    system: true,
    permissions: ["download_results"]
  }
];

export async function ensureRoleTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS RoleDefinition (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      permissions TEXT NOT NULL DEFAULT '[]',
      system INTEGER NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  for (const role of defaultRoles) {
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO RoleDefinition (key, name, permissions, system) VALUES (?, ?, ?, ?)`,
      role.key,
      role.name,
      JSON.stringify(role.permissions),
      role.system ? 1 : 0
    );
  }
}

export async function listRoles() {
  await ensureRoleTable();
  const rows = await prisma.$queryRawUnsafe<Array<{ key: string; name: string; permissions: string; system: number }>>(
    `SELECT key, name, permissions, system FROM RoleDefinition ORDER BY system DESC, createdAt ASC`
  );
  return rows.map((row) => ({
    key: row.key,
    name: row.name,
    permissions: jsonPermissions(row.permissions),
    system: Boolean(row.system)
  }));
}

export async function upsertRole(role: Omit<RoleDefinition, "system">) {
  await ensureRoleTable();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{1,31}$/.test(role.key)) {
    throw Object.assign(new Error("角色标识需为 2-32 位英文、数字、下划线或短横线，且以英文字母开头"), { status: 400 });
  }
  const permissions = role.permissions.filter((permission) => permissionOptions.includes(permission));
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO RoleDefinition (key, name, permissions, system, updatedAt)
      VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        name = excluded.name,
        permissions = excluded.permissions,
        updatedAt = CURRENT_TIMESTAMP
    `,
    role.key,
    role.name,
    JSON.stringify(permissions)
  );
}

export async function deleteRole(key: string) {
  await ensureRoleTable();
  const role = await getRole(key);
  if (!role) throw Object.assign(new Error("角色不存在"), { status: 404 });
  if (role.system) throw Object.assign(new Error("系统角色不能删除"), { status: 400 });
  await prisma.$executeRawUnsafe(`UPDATE User SET role = 'viewer' WHERE role = ?`, key);
  await prisma.$executeRawUnsafe(`DELETE FROM RoleDefinition WHERE key = ?`, key);
}

export async function getRole(key: string) {
  await ensureRoleTable();
  const rows = await prisma.$queryRawUnsafe<Array<{ key: string; name: string; permissions: string; system: number }>>(
    `SELECT key, name, permissions, system FROM RoleDefinition WHERE key = ? LIMIT 1`,
    key
  );
  const row = rows[0];
  return row
    ? {
        key: row.key,
        name: row.name,
        permissions: jsonPermissions(row.permissions),
        system: Boolean(row.system)
      }
    : null;
}

export async function roleHasPermission(roleKey: string, permission: string) {
  const role = await getRole(roleKey);
  return Boolean(role?.permissions.includes(permission));
}

export function defaultRoleLabel(role: string) {
  return defaultRoles.find((item) => item.key === role)?.name || role;
}

function jsonPermissions(value: string) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
