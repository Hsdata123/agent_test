import { NextResponse } from "next/server";
import { jsonError, requireUser, requireDeptAdmin } from "@/lib/auth";
import { createDepartment, listDepartments } from "@/lib/departments";
import { isAdmin } from "@/lib/dept-scope";

export async function GET() {
  try {
    await requireUser();
    const departments = await listDepartments();
    return NextResponse.json({ success: true, departments });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      await requireDeptAdmin();
      throw Object.assign(new Error("仅超级管理员可创建部门"), { status: 403 });
    }
    const body = await request.json();
    const department = await createDepartment({
      name: String(body.name || ""),
      code: body.code ? String(body.code) : null,
      description: body.description ? String(body.description) : null,
      status: body.status ? String(body.status) : undefined
    });
    return NextResponse.json({ success: true, department });
  } catch (error) {
    return jsonError(error);
  }
}
