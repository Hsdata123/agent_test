import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { deleteScene, getScene, updateScene } from "@/lib/scenes";
import { canManageScene } from "@/lib/dept-scope";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const scene = await getScene(id);
    if (!scene) throw Object.assign(new Error("场景不存在"), { status: 404 });
    if (!(await canManageScene(user, scene.departmentId))) {
      if (user.departmentId !== scene.departmentId && user.role !== "admin") {
        throw Object.assign(new Error("无权访问该场景"), { status: 403 });
      }
    }
    return NextResponse.json({ success: true, scene });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const scene = await getScene(id);
    if (!scene) throw Object.assign(new Error("场景不存在"), { status: 404 });
    if (!(await canManageScene(user, scene.departmentId))) {
      throw Object.assign(new Error("无权限修改此场景"), { status: 403 });
    }
    const body = await request.json();
    const updated = await updateScene(id, {
      sceneKey: body.sceneKey !== undefined ? String(body.sceneKey) : undefined,
      sceneName: body.sceneName !== undefined ? String(body.sceneName) : undefined,
      description: body.description !== undefined ? (body.description ? String(body.description) : null) : undefined
    });
    return NextResponse.json({ success: true, scene: updated });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const scene = await getScene(id);
    if (!scene) throw Object.assign(new Error("场景不存在"), { status: 404 });
    if (!(await canManageScene(user, scene.departmentId))) {
      throw Object.assign(new Error("无权限删除此场景"), { status: 403 });
    }
    await deleteScene(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
