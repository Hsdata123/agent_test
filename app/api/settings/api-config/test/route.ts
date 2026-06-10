import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, requireAdmin } from "@/lib/auth";
import { IThinkClient } from "@/lib/ithink";

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const { type } = await request.json();
    const config = await prisma.apiConfig.findUnique({ where: { id: "singleton" } });
    const client = new IThinkClient({
      apiKey: type === "text" ? process.env.ITHINK_TEXT_API_KEY : undefined,
      baseUrl: type === "text" ? config?.textBaseUrl : config?.imageBaseUrl,
      chatModel: config?.textModel,
      imageModel: config?.imageModel,
      timeoutSeconds: Math.min(config?.timeoutSeconds || 30, 30),
      textWireApi: config?.textWireApi,
      textPromptCacheEnabled: config?.textPromptCacheEnabled,
      textPromptCacheRetention: config?.textPromptCacheRetention,
      textPromptCacheKey: config?.textPromptCacheKey,
      disableResponseStorage: config?.disableResponseStorage
    });
    if (type === "image") {
      await client.generateImage("生成一张极简的蓝紫渐变测试图，画面包含文字：连接成功", "1024x1024");
    } else {
      await client.testChat();
    }
    return NextResponse.json({ success: true, message: "API 连接成功" });
  } catch (error) {
    return jsonError(error);
  }
}
