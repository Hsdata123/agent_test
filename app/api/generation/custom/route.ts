import { NextResponse } from "next/server";
import { canEdit, getProjectRole, jsonError, requireUser } from "@/lib/auth";
import { IThinkClient } from "@/lib/ithink";
import { prisma } from "@/lib/prisma";
import { getImageDimensions, publicFileUrl, saveUpload } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const formData = await request.formData();
    const projectId = String(formData.get("projectId") || "");
    const prompt = String(formData.get("prompt") || "").trim();
    const size = String(formData.get("size") || "1024x1024");
    const quality = String(formData.get("quality") || "high") as "low" | "medium" | "high" | "auto";
    if (!projectId) throw Object.assign(new Error("缺少项目"), { status: 400 });
    if (!prompt) throw Object.assign(new Error("请填写自定义生图描述"), { status: 400 });

    const role = await getProjectRole(projectId, user.id, user.role);
    if (!role || !(await canEdit(role))) throw Object.assign(new Error("当前权限仅支持查看"), { status: 403 });

    const parse = await prisma.mechanismParse.create({
      data: {
        projectId,
        rawMechanism: `自定义生图：${prompt.slice(0, 80)}`,
        price: 0,
        productSummary: "自定义生图",
        createdById: user.id
      }
    });
    const task = await prisma.generationTask.create({
      data: {
        projectId,
        parseId: parse.id,
        createdById: user.id,
        outputType: "main_image",
        aspectRatio: "custom",
        imageCount: 1,
        imageSize: size,
        imageQuality: quality,
        prompt
      },
      include: { parse: true, results: true, project: true }
    });

    const files = formData.getAll("references").filter((value): value is File => value instanceof File);
    const referencePaths = [];
    for (const file of files) {
      const saved = await saveUpload(file);
      referencePaths.push(saved.storagePath);
    }

    void runCustomTask(task.id, prompt, size, quality, referencePaths).catch((error) => console.error(`Custom generation ${task.id} failed`, error));

    return NextResponse.json({
      success: true,
      tasks: [
        {
          ...task,
          results: task.results.map((result) => ({ ...result, imageUrl: publicFileUrl(result.imagePath) }))
        }
      ]
    });
  } catch (error) {
    return jsonError(error);
  }
}

async function runCustomTask(taskId: string, prompt: string, size: string, quality: "low" | "medium" | "high" | "auto", referencePaths: string[]) {
  const task = await prisma.generationTask.update({ where: { id: taskId }, data: { status: "generating", failureReason: null } });
  const config = await prisma.apiConfig.findUnique({ where: { id: "singleton" } });
  const client = new IThinkClient({
    baseUrl: config?.imageBaseUrl,
    imageModel: config?.imageModel,
    chatModel: config?.textModel,
    timeoutSeconds: config?.timeoutSeconds
  });
  try {
    const editSize = referencePaths.length ? stableCustomEditSize(size) : size;
    const imagePath = referencePaths.length
      ? await client.editImage(prompt, editSize, referencePaths, quality)
      : await client.generateImage(prompt, size, quality);
    const expectedDimensions = dimensionsFromSize(editSize);
    const dimensions = await getImageDimensions(imagePath);
    const warning = sizeMismatchWarning(expectedDimensions, dimensions);
    await prisma.generationResult.create({
      data: { taskId: task.id, projectId: task.projectId, imagePath, prompt, width: dimensions.width, height: dimensions.height }
    });
    await prisma.generationTask.update({ where: { id: task.id }, data: { status: "completed", failureReason: warning || null } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "自定义生图失败";
    await prisma.generationTask.update({ where: { id: task.id }, data: { status: "failed", failureReason: message } });
  }
}

function stableCustomEditSize(size: string) {
  const dimensions = dimensionsFromSize(size);
  return dimensions.width && dimensions.height ? size : "1024x1024";
}

function dimensionsFromSize(size: string) {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return { width: undefined, height: undefined };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function sizeMismatchWarning(expected: { width?: number; height?: number }, actual: { width?: number; height?: number }) {
  if (!expected.width || !expected.height || !actual.width || !actual.height) return "";
  if (expected.width === actual.width && expected.height === actual.height) return "";
  return `上游返回尺寸与请求不一致：请求 ${expected.width}x${expected.height}，实际 ${actual.width}x${actual.height}`;
}
