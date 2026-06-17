import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { createScene, listScenes } from "@/lib/scenes";
import { canManageScene, isAdmin } from "@/lib/dept-scope";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const departmentIdFilter = searchParams.get("departmentId") || undefined;
    let scenes: Awaited<ReturnType<typeof listScenes>>;
    if (isAdmin(user)) {
      scenes = await listScenes({ departmentId: departmentIdFilter });
    } else {
      const dept = user.departmentId || "dept_default";
      if (departmentIdFilter && departmentIdFilter !== dept) {
        scenes = [];
      } else {
        scenes = await listScenes({ departmentId: dept });
      }
    }
    return NextResponse.json({ success: true, scenes });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const departmentId = String(body.departmentId || user.departmentId || "");
    if (!departmentId) throw Object.assign(new Error("缺少部门 ID"), { status: 400 });
    if (!(await canManageScene(user, departmentId))) {
      throw Object.assign(new Error("无权限在该部门下创建场景"), { status: 403 });
    }
    const scene = await createScene({
      departmentId,
      sceneKey: String(body.sceneKey || ""),
      sceneName: String(body.sceneName || ""),
      description: body.description ? String(body.description) : null
    });
    return NextResponse.json({ success: true, scene });
  } catch (error) {
    return jsonError(error);
  }
}
