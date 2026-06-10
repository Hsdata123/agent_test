import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { listRoles, upsertRole } from "@/lib/roles";

export async function GET() {
  try {
    await requireAdmin();
    const roles = await listRoles();
    return NextResponse.json({ success: true, roles });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json();
    if (!body.key || !body.name) throw Object.assign(new Error("角色标识和角色名称必填"), { status: 400 });
    await upsertRole({
      key: String(body.key).trim(),
      name: String(body.name).trim(),
      permissions: Array.isArray(body.permissions) ? body.permissions.map(String) : []
    });
    const roles = await listRoles();
    return NextResponse.json({ success: true, roles });
  } catch (error) {
    return jsonError(error);
  }
}
