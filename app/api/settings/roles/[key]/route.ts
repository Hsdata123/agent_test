import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { deleteRole, listRoles } from "@/lib/roles";

export async function DELETE(_request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    await requireAdmin();
    const { key } = await context.params;
    await deleteRole(key);
    const roles = await listRoles();
    return NextResponse.json({ success: true, roles });
  } catch (error) {
    return jsonError(error);
  }
}
