import fs from "node:fs/promises";
import path from "node:path";
import { saveResultFromBuffer } from "./storage";

type ImageResponse = {
  data?: Array<{ url?: string; b64_json?: string }>;
};

export type ImageQuality = "low" | "medium" | "high" | "auto";
export type ChatUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cached_tokens?: number };
type TextWireApi = "auto" | "chat" | "responses";
type ChatHistoryMessage = { role: "user" | "assistant"; content: string };
type ChatParseResult = { content: string; usage?: ChatUsage; missingContent?: boolean; cachedTokens?: number };

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolCallAccumulator = {
  id: string;
  name: string;
  arguments: string;
};

export type ChatStreamChunk =
  | { type: "text"; text: string }
  | { type: "tool_calls"; calls: ToolCallAccumulator[] }
  | { type: "usage"; usage: ChatUsage }
  | { type: "error"; error: string; details?: ApiErrorDetails };

export type ChatStreamOptions = {
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  messages?: Array<Record<string, unknown>>;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export type ApiErrorDetails = {
  message: string;
  status: number;
  url?: string;
  type?: string;
  code?: string;
  param?: string;
  requestId?: string;
  bodySnippet?: string;
};

export class IThinkApiError extends Error {
  status: number;
  url?: string;
  type?: string;
  code?: string;
  param?: string;
  requestId?: string;
  bodySnippet?: string;
  constructor(details: ApiErrorDetails) {
    super(details.message);
    this.name = "IThinkApiError";
    this.status = details.status;
    this.url = details.url;
    this.type = details.type;
    this.code = details.code;
    this.param = details.param;
    this.requestId = details.requestId;
    this.bodySnippet = details.bodySnippet;
  }
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      url: this.url,
      type: this.type,
      code: this.code,
      param: this.param,
      requestId: this.requestId,
      bodySnippet: this.bodySnippet
    };
  }
}

export class IThinkClient {
  private apiKey: string;
  private baseUrl: string;
  private imageModel: string;
  private chatModel: string;
  private timeoutMs: number;
  private textWireApi: TextWireApi;
  private textPromptCacheEnabled: boolean;
  private textPromptCacheRetention: string;
  private textPromptCacheKey: string;
  private disableResponseStorage: boolean;

  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    imageModel?: string;
    chatModel?: string;
    timeoutSeconds?: number;
    textWireApi?: string;
    textPromptCacheEnabled?: boolean;
    textPromptCacheRetention?: string;
    textPromptCacheKey?: string;
    disableResponseStorage?: boolean;
  }) {
    this.apiKey = options?.apiKey || process.env.ITHINK_API_KEY || "";
    this.baseUrl = (options?.baseUrl || process.env.ITHINK_BASE_URL || "https://token.ithinkai.cn/v1").replace(/\/$/, "");
    this.imageModel = options?.imageModel || process.env.ITHINK_IMAGE_MODEL || "gpt-image-2";
    this.chatModel = options?.chatModel || process.env.ITHINK_CHAT_MODEL || "gpt-5.5-token";
    this.timeoutMs = (options?.timeoutSeconds || 240) * 1000;
    this.textWireApi = normalizeWireApi(options?.textWireApi);
    this.textPromptCacheEnabled = options?.textPromptCacheEnabled ?? true;
    this.textPromptCacheRetention = options?.textPromptCacheRetention || "24h";
    this.textPromptCacheKey = options?.textPromptCacheKey || "commerce-chat";
    this.disableResponseStorage = options?.disableResponseStorage ?? true;
  }

  private authHeaders() {
    if (!this.apiKey) {
      throw Object.assign(new Error("请管理员先完成 API 配置"), { status: 400 });
    }
    return {
      Authorization: `Bearer ${this.apiKey}`
    };
  }

  private jsonHeaders() {
    return {
      ...this.authHeaders(),
      "Content-Type": "application/json; charset=utf-8"
    };
  }

  async testChat() {
    const result = await this.chatDetailed("请只回复：连接成功");
    if (!result.content || looksLikeMissingChatContent(result.content)) {
      throw new Error("文本 API 已连接，但模型没有返回可展示正文。请检查模型、wire api 或缓存配置。");
    }
    return true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      if (this.prefersResponses()) {
        const result = await this.chatDetailedViaResponses("请回复：连接成功", "你是 API 连通性测试助手，请只回复连接成功。");
        if (!result.content || looksLikeMissingChatContent(result.content)) throw new Error("文本模型未返回内容，请检查后台文本模型名称是否正确。");
        return true;
      }
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.jsonHeaders(),
        signal: controller.signal,
        body: JSON.stringify({
          model: this.chatModel,
          messages: [{ role: "user", content: "请回复：连接成功" }],
          stream: false,
          max_completion_tokens: 80,
          ...this.cacheOptions()
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const result = parseChatCompletionPayload(await response.text());
      if (!result.content || result.content === "模型未返回内容") throw new Error("文本模型未返回内容，请检查后台文本模型名称是否正确。");
      return true;
    } finally {
      clearTimeout(timer);
    }
  }

  async chatWithKnowledge(message: string, knowledgeContext: string) {
    return (await this.chatDetailed(message, knowledgeContext)).content;
  }

  async *chatStream(
    message: string,
    knowledgeContext?: string,
    history: ChatHistoryMessage[] = [],
    options?: ChatStreamOptions
  ): AsyncGenerator<ChatStreamChunk> {
    const systemPrompt = knowledgeContext
      ? `你是电商视觉与内容助手。请优先依据用户选中的知识库资料回答；如果资料不足，请明确说明缺少哪些信息。\n\n知识库资料：\n${knowledgeContext}`
      : "你是电商视觉与内容助手。请直接回答用户问题；只有用户明确要求参考知识库时，才说明需要选择或调用知识库资料。";
    const messages = options?.messages
      ? options.messages
      : [
          { role: "system" as const, content: systemPrompt },
          ...history.map((item) => ({ role: item.role, content: item.content })),
          { role: "user" as const, content: message }
        ];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      if (this.prefersResponses()) {
        const response = await fetch(this.responsesUrl(), {
          method: "POST",
          headers: this.jsonHeaders(),
          signal: controller.signal,
          body: JSON.stringify({
            model: this.chatModel,
            ...(this.disableResponseStorage ? { store: false } : {}),
            instructions: systemPrompt,
            input: responsesInput(history, message),
            max_output_tokens: 2048,
            stream: true,
            ...this.cacheOptions()
          })
        });
        if (!response.ok) {
          const err = normalizeApiError(await response.text(), response.status, this.responsesUrl());
          yield yieldApiError(err);
          return;
        }
        const reader = response.body?.getReader();
        if (!reader) {
          yield { type: "error", error: "上游未返回流", details: { message: "上游未返回流", status: 502, url: this.responsesUrl() } };
          return;
        }
        const decoder = new TextDecoder();
        let buffer = "";
        let finalUsage: ChatUsage | undefined;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const payload = JSON.parse(data);
              const text = extractChatText(payload);
              if (text) yield { type: "text", text };
              const usage = extractChatUsage(payload);
              if (usage) finalUsage = usage;
            } catch {
              // ignore parse errors
            }
          }
        }
        if (finalUsage) yield { type: "usage", usage: finalUsage };
        return;
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.jsonHeaders(),
        signal: controller.signal,
        body: JSON.stringify({
          model: this.chatModel,
          messages,
          ...(options?.tools && options.tools.length
            ? { tools: options.tools, tool_choice: options.toolChoice || "auto" }
            : {}),
          stream: true,
          max_completion_tokens: 2048,
          ...this.cacheOptions()
        })
      });
      if (!response.ok) {
        const err = normalizeApiError(await response.text(), response.status, `${this.baseUrl}/chat/completions`);
        yield yieldApiError(err);
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) {
        yield { type: "error", error: "上游未返回流", details: { message: "上游未返回流", status: 502, url: `${this.baseUrl}/chat/completions` } };
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let finalUsage: ChatUsage | undefined;
      const toolCallMap = new Map<number, ToolCallAccumulator>();
      let sawToolFinish = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const payload = JSON.parse(data);
            const choice = payload?.choices?.[0];
            const finishReason = choice?.finish_reason;
            if (finishReason === "tool_calls") sawToolFinish = true;
            const delta = choice?.delta || {};
            const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
            for (const call of toolCalls) {
              const index = typeof call.index === "number" ? call.index : 0;
              const existing = toolCallMap.get(index) || { id: "", name: "", arguments: "" };
              if (call.id) existing.id = call.id;
              if (call.function?.name) existing.name = call.function.name;
              if (typeof call.function?.arguments === "string") existing.arguments += call.function.arguments;
              toolCallMap.set(index, existing);
            }
            const text = extractChatText({ delta });
            if (text) yield { type: "text", text };
            const usage = extractChatUsage(payload);
            if (usage) finalUsage = usage;
          } catch {
            // ignore parse errors
          }
        }
      }
      if (toolCallMap.size) {
        yield {
          type: "tool_calls",
          calls: Array.from(toolCallMap.values()).map((call) => ({
            id: call.id,
            name: call.name,
            arguments: call.arguments
          }))
        };
      } else if (sawToolFinish) {
        // 极少数流：上游只发了 finish_reason 但没把 tool_calls 增量带回来，尝试从尾部 buffer 再补一次解析
        const tail = collectToolCallsFromTail(buffer);
        if (tail.length) yield { type: "tool_calls", calls: tail };
      }
      if (finalUsage) yield { type: "usage", usage: finalUsage };
    } catch (error) {
      if (error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"))) {
        yield { type: "error", error: `聊天 API 请求超时：超过 ${Math.round(this.timeoutMs / 1000)} 秒未返回。`, details: { message: `聊天 API 请求超时：超过 ${Math.round(this.timeoutMs / 1000)} 秒未返回。`, status: 408 } };
        return;
      }
      if (error instanceof IThinkApiError) {
        yield yieldApiError(error);
        return;
      }
      const networkDetails = extractNetworkErrorDetails(error);
      yield { type: "error", error: error instanceof Error ? error.message : String(error), details: networkDetails };
    } finally {
      clearTimeout(timer);
    }
  }

  async chat(message: string) {
    return (await this.chatDetailed(message)).content;
  }

  async chatDetailed(message: string, knowledgeContext?: string, history: ChatHistoryMessage[] = []) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const systemPrompt = knowledgeContext
      ? `你是电商视觉与内容助手。请优先依据用户选中的知识库资料回答；如果资料不足，请明确说明缺少哪些信息。\n\n知识库资料：\n${knowledgeContext}`
      : "你是电商视觉与内容助手。请直接回答用户问题；只有用户明确要求参考知识库时，才说明需要选择或调用知识库资料。";
    try {
      if (this.prefersResponses()) {
        return await this.chatDetailedViaResponses(message, systemPrompt, history);
      }
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.jsonHeaders(),
        signal: controller.signal,
        body: JSON.stringify({
          model: this.chatModel,
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            ...history.map((item) => ({ role: item.role, content: item.content })),
            { role: "user", content: message }
          ],
          stream: false,
          max_completion_tokens: 2048,
          ...this.cacheOptions()
        })
      });
      if (!response.ok) throw normalizeApiError(await response.text(), response.status, `${this.baseUrl}/chat/completions`);
      const result = parseChatCompletionPayload(await response.text());
      if (!looksLikeMissingChatContent(result.content)) return result;
      return await this.chatDetailedViaResponses(message, systemPrompt, history);
    } catch (error) {
      if (error instanceof IThinkApiError) throw error;
      if (error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"))) {
        throw new Error(`聊天 API 请求超时：超过 ${Math.round(this.timeoutMs / 1000)} 秒未返回。`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async chatDetailedViaResponses(message: string, systemPrompt: string, history: ChatHistoryMessage[] = []) {
    const response = await fetch(this.responsesUrl(), {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({
        model: this.chatModel,
        ...(this.disableResponseStorage ? { store: false } : {}),
        instructions: systemPrompt,
        input: responsesInput(history, message),
        max_output_tokens: 2048,
        ...this.cacheOptions()
      })
    });
    if (!response.ok) throw normalizeApiError(await response.text(), response.status, this.responsesUrl());
    const raw = await response.text();
    const result = parseChatCompletionPayload(raw);
    if (!looksLikeMissingChatContent(result.content)) return result;
    const payload = safeJson(raw);
    if (payload?.error?.message) throw new Error(String(payload.error.message));
    if (payload?.incomplete_details?.reason) throw new Error(`文本模型输出不完整：${payload.incomplete_details.reason}`);
    if (!payload?.id || payload.status === "failed") throw new Error("上游文本 API 未返回可展示正文。");
    const polled = await this.pollResponse(payload.id, result);
    if (looksLikeMissingChatContent(polled.content)) throw new Error("上游文本 API 未返回可展示正文。");
    return polled;
  }

  private async pollResponse(responseId: string, fallback: ChatParseResult) {
    for (let attempt = 0; attempt < 12; attempt++) {
      await sleep(1000);
      const response = await fetch(`${this.responsesUrl()}/${responseId}`, {
        method: "GET",
        headers: this.authHeaders()
      });
      if (!response.ok) break;
      const raw = await response.text();
      const payload = safeJson(raw);
      if (payload?.error?.message) throw new Error(String(payload.error.message));
      if (payload?.incomplete_details?.reason) throw new Error(`文本模型输出不完整：${payload.incomplete_details.reason}`);
      const result = parseChatCompletionPayload(raw);
      if (!looksLikeMissingChatContent(result.content)) return result;
    }
    return fallback;
  }

  private cacheOptions() {
    if (!this.textPromptCacheEnabled) return {};
    return {
      prompt_cache_retention: this.textPromptCacheRetention,
      prompt_cache_key: this.textPromptCacheKey
    };
  }

  private prefersResponses() {
    if (this.textWireApi === "responses") return true;
    if (this.textWireApi === "chat") return false;
    return this.baseUrl.includes("ai-pixel.online") || this.chatModel.includes("token");
  }

  private responsesUrl() {
    return this.baseUrl.endsWith("/v1") ? `${this.baseUrl}/responses` : `${this.baseUrl}/v1/responses`;
  }

  async generateImage(prompt: string, size: string, quality: ImageQuality = "auto") {
    return this.withImageRetries(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
      const response = await fetch(`${this.baseUrl}/images/generations`, {
        method: "POST",
        headers: this.jsonHeaders(),
        signal: controller.signal,
        body: JSON.stringify({
          model: this.imageModel,
          prompt,
          size,
          quality
        })
      });
      if (!response.ok) {
        throw normalizeApiError(await response.text(), response.status, `${this.baseUrl}/images/generations`);
      }
      return saveImageResponse(await response.json());
      } catch (error) {
        if (error instanceof IThinkApiError) throw error;
        if (error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"))) {
          throw new Error(`图片 API 请求超时：单张图片超过 ${Math.round(this.timeoutMs / 1000)} 秒未返回。可在设置页调大超时时间后重试。`);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    });
  }

  async editImage(prompt: string, size: string, imagePaths: string[], quality: ImageQuality = "auto") {
    const references = uniqueExistingPaths(imagePaths);
    if (!references.length) return this.generateImage(prompt, size, quality);

    return this.withImageRetries(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
      const form = new FormData();
      for (const imagePath of references) {
        const bytes = await fs.readFile(imagePath);
        const fileName = path.basename(imagePath);
        form.append("image", new Blob([bytes], { type: mimeFromPath(imagePath) }), fileName);
      }
      form.append("prompt", prompt);
      form.append("model", this.imageModel);
      form.append("size", size);
      form.append("quality", quality);

      const response = await fetch(`${this.baseUrl}/images/edits`, {
        method: "POST",
        headers: {
          ...this.authHeaders(),
          Accept: "application/json"
        },
        signal: controller.signal,
        body: form
      });
      if (!response.ok) {
        throw normalizeApiError(await response.text(), response.status, `${this.baseUrl}/images/edits`);
      }
      return saveImageResponse(await response.json());
      } catch (error) {
        if (error instanceof IThinkApiError) throw error;
        if (error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"))) {
          throw new Error(`图片编辑 API 请求超时：单张图片超过 ${Math.round(this.timeoutMs / 1000)} 秒未返回。可在设置页调大超时时间后重试。`);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    });
  }

  private async withImageRetries<T>(operation: () => Promise<T>) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!isRetryableImageError(error) || attempt === 3) break;
        await sleep(attempt * 1500);
      }
    }
    throw lastError;
  }
}

async function saveImageResponse(payload: unknown) {
  const first = (payload as ImageResponse).data?.[0];
  if (!first) throw new Error("图像接口未返回图片数据");

  if (first.b64_json) {
    return saveResultFromBuffer(Buffer.from(first.b64_json, "base64"), "png");
  }
  if (first.url) {
    const image = await fetch(first.url);
    if (!image.ok) throw new Error("图片下载失败");
    return saveResultFromBuffer(Buffer.from(await image.arrayBuffer()), "png");
  }
  throw new Error("图片结果格式不支持");
}

function parseChatCompletionPayload(raw: string) {
  if (raw.trimStart().startsWith("data:")) {
    return parseSseChatCompletion(raw);
  }
  const payload = JSON.parse(raw);
  const content = extractChatText(payload);
  return { content: content || `模型未返回内容（返回字段：${describePayloadShape(payload)}）`, usage: extractChatUsage(payload) };
}

function parseSseChatCompletion(raw: string) {
  let content = "";
  let usage: ChatUsage | undefined;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    const payload = JSON.parse(data);
    content += extractChatText(payload);
    usage = extractChatUsage(payload) || usage;
  }
  return { content: content || `模型未返回内容（返回字段：${describeSseShape(raw)}）`, usage };
}

function extractChatText(payload: any): string {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  if (Array.isArray(payload)) return payload.map(extractChatText).join("");
  if (typeof payload.output_text === "string") return payload.output_text;
  if (payload.output) return extractChatText(payload.output);
  if (payload.choices) return extractChatText(payload.choices);
  if (typeof payload.content === "string") return payload.content;
  if (Array.isArray(payload.content)) return payload.content.map(extractChatText).join("");
  if (payload.content) return extractChatText(payload.content);
  if (typeof payload.text === "string") return payload.text;
  if (payload.text) return extractChatText(payload.text);
  if (typeof payload.value === "string") return payload.value;
  if (typeof payload.summary_text === "string") return payload.summary_text;
  if (typeof payload.reasoning_content === "string") return payload.reasoning_content;
  if (typeof payload.answer === "string") return payload.answer;
  if (typeof payload.result === "string") return payload.result;
  if (typeof payload.response === "string") return payload.response;
  if (payload.message) return extractChatText(payload.message);
  if (payload.delta) return extractChatText(payload.delta);
  if (payload.data) return extractChatText(payload.data);
  if (payload.summary) return extractChatText(payload.summary);
  if (payload.result) return extractChatText(payload.result);
  if (payload.response) return extractChatText(payload.response);
  return "";
}

function extractChatUsage(payload: any): ChatUsage | undefined {
  const usage = payload?.usage || payload?.data?.usage;
  if (!usage) return undefined;
  const computedTotalTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
  return {
    prompt_tokens: usage.prompt_tokens ?? usage.input_tokens,
    completion_tokens: usage.completion_tokens ?? usage.output_tokens,
    total_tokens: usage.total_tokens ?? (computedTotalTokens || undefined),
    cached_tokens: usage.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens
  };
}

function looksLikeMissingChatContent(content: string) {
  if (!content) return true;
  return (
    (content.includes("choices[]") && content.includes("usage") && (content.includes("prompt_tokens") || content.includes("output_tokens"))) ||
    (content.includes("返回字段") && content.includes("status") && content.includes("max_tool_calls")) ||
    (content.includes("返回字段") && content.includes("instructions") && content.includes("max_output_tokens"))
  );
}

function collectToolCallsFromTail(buffer: string): ToolCallAccumulator[] {
  if (!buffer) return [];
  const map = new Map<number, ToolCallAccumulator>();
  for (const line of buffer.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    let payload: any;
    try {
      payload = JSON.parse(data);
    } catch {
      continue;
    }
    const choice = payload?.choices?.[0];
    const toolCalls = Array.isArray(choice?.delta?.tool_calls) ? choice.delta.tool_calls : [];
    for (const call of toolCalls) {
      const index = typeof call.index === "number" ? call.index : 0;
      const existing = map.get(index) || { id: "", name: "", arguments: "" };
      if (call.id) existing.id = call.id;
      if (call.function?.name) existing.name = call.function.name;
      if (typeof call.function?.arguments === "string") existing.arguments += call.function.arguments;
      map.set(index, existing);
    }
  }
  return Array.from(map.values());
}

function responsesInput(history: ChatHistoryMessage[], message: string) {
  return [
    ...history
      .filter((item) => item.content.trim())
      .map((item) => ({
        role: item.role,
        content: [{ type: item.role === "assistant" ? "output_text" : "input_text", text: item.content }]
      })),
    {
      role: "user" as const,
      content: [{ type: "input_text", text: message }]
    }
  ];
}

function normalizeWireApi(value?: string): TextWireApi {
  if (value === "chat" || value === "responses" || value === "auto") return value;
  return "responses";
}

function safeJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function describePayloadShape(payload: any) {
  const paths: string[] = [];
  collectShape(payload, "", paths, 24);
  return paths.join(", ") || "空响应";
}

function describeSseShape(raw: string) {
  const paths = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      collectShape(JSON.parse(data), "", paths, 24);
    } catch {
      paths.add("无法解析的 data 行");
    }
  }
  return Array.from(paths).join(", ") || "空流式响应";
}

function collectShape(value: any, prefix: string, output: string[] | Set<string>, limit: number) {
  if (shapeCount(output) >= limit) return;
  if (!value || typeof value !== "object") {
    addShape(output, prefix || typeof value);
    return;
  }
  if (Array.isArray(value)) {
    addShape(output, `${prefix || "root"}[]`);
    if (value[0]) collectShape(value[0], `${prefix || "root"}[0]`, output, limit);
    return;
  }
  for (const key of Object.keys(value).slice(0, 12)) {
    const path = prefix ? `${prefix}.${key}` : key;
    addShape(output, path);
    collectShape(value[key], path, output, limit);
  }
}

function addShape(output: string[] | Set<string>, value: string) {
  if ("add" in output) output.add(value);
  else output.push(value);
}

function shapeCount(output: string[] | Set<string>) {
  return Array.isArray(output) ? output.length : output.size;
}

function uniqueExistingPaths(paths: string[]) {
  return Array.from(new Set(paths.filter(Boolean)));
}

function mimeFromPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

function normalizeApiError(raw: string, status: number, url: string): IThinkApiError {
  const snippet = raw ? raw.slice(0, 2000) : "";
  let payload: any = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    // not JSON
  }
  const error = payload?.error;
  const message = String(
    error?.message ||
      payload?.message ||
      (raw ? raw.slice(0, 500) : "") ||
      "上游 API 调用失败"
  );
  const code = error?.code ? String(error.code) : undefined;
  const type = error?.type ? String(error.type) : undefined;
  const param = error?.param ? String(error.param) : undefined;
  const requestId = payload?.request_id || payload?.requestId || error?.request_id || error?.requestId || error?.trace_id
    ? String(payload?.request_id || payload?.requestId || error?.request_id || error?.requestId || error?.trace_id)
    : undefined;
  let finalMessage = message;
  if (code === "insufficient_user_quota" || message.includes("额度")) {
    finalMessage = `图片 API 额度不足：${message}`;
  }
  return new IThinkApiError({
    message: finalMessage,
    status,
    url,
    type,
    code,
    param,
    requestId,
    bodySnippet: snippet
  });
}

function isRetryableImageError(error: unknown) {
  if (error instanceof IThinkApiError) {
    if (error.status >= 500 && error.status < 600) return true;
    const message = error.message;
    return (
      message.includes("系统繁忙") ||
      message.includes("稍后再试") ||
      message.includes("traceid") ||
      message.includes("timeout") ||
      message.includes("ETIMEDOUT") ||
      message.includes("ECONNRESET")
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("系统繁忙") ||
    message.includes("稍后再试") ||
    message.includes("traceid") ||
    message.includes("timeout") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ECONNRESET") ||
    /^5\d\d\b/.test(message)
  );
}

function yieldApiError(err: IThinkApiError) {
  console.error("[ithink] upstream error", err.toJSON());
  return { type: "error" as const, error: err.message, details: err.toJSON() };
}

function extractNetworkErrorDetails(error: unknown): ApiErrorDetails {
  if (!(error instanceof Error)) return { message: String(error), status: 0 };
  const anyErr = error as Error & { cause?: any; code?: string };
  const causeCode = anyErr.cause?.code || anyErr.code;
  const causeAddr = anyErr.cause?.address || anyErr.cause?.hostname;
  return {
    message: error.message,
    status: 0,
    code: causeCode ? String(causeCode) : undefined,
    type: causeCode ? "NetworkError" : undefined,
    param: causeAddr ? String(causeAddr) : undefined
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
