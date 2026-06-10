import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, requireAdmin } from "@/lib/auth";

function maskKey() {
  const key = process.env.ITHINK_API_KEY || "";
  if (!key) return "";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

export async function GET() {
  try {
    await requireAdmin();
    const config = await prisma.apiConfig.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton" }
    });
    return NextResponse.json({ success: true, config: { ...config, apiKeyMasked: maskKey() } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json();
    const config = await prisma.apiConfig.upsert({
      where: { id: "singleton" },
      update: {
        textBaseUrl: body.textBaseUrl,
        textModel: body.textModel,
        textWireApi: body.textWireApi,
        textPromptCacheEnabled: body.textPromptCacheEnabled,
        textPromptCacheRetention: body.textPromptCacheRetention,
        textPromptCacheKey: body.textPromptCacheKey,
        disableResponseStorage: body.disableResponseStorage,
        imageBaseUrl: body.imageBaseUrl,
        imageModel: body.imageModel,
        embeddingModel: body.embeddingModel,
        maxConcurrency: body.maxConcurrency,
        retryCount: body.retryCount,
      timeoutSeconds: body.timeoutSeconds
      },
      create: {
        id: "singleton",
        textBaseUrl: body.textBaseUrl,
        textModel: body.textModel,
        textWireApi: body.textWireApi,
        textPromptCacheEnabled: body.textPromptCacheEnabled,
        textPromptCacheRetention: body.textPromptCacheRetention,
        textPromptCacheKey: body.textPromptCacheKey,
        disableResponseStorage: body.disableResponseStorage,
        imageBaseUrl: body.imageBaseUrl,
        imageModel: body.imageModel,
        embeddingModel: body.embeddingModel,
        maxConcurrency: body.maxConcurrency,
        retryCount: body.retryCount,
        timeoutSeconds: body.timeoutSeconds
      }
    });
    return NextResponse.json({ success: true, config: { ...config, apiKeyMasked: maskKey() } });
  } catch (error) {
    return jsonError(error);
  }
}
