// 模型变更自适应的 cache 策略解析器
// 同一份纯函数, 服务端 (ithink.ts) + 客户端 (Dashboard.tsx ApiConfigCachePreview) 共用
// 输入: 当前 baseUrl / chatModel / wireApi / userEnabled / retention / cacheKey
// 输出: CacheProfile 描述实际生效的 cache 模式 + Anthropic 协议断点位置

export type CacheMode = "anthropic_ephemeral" | "openai_responses" | "openai_chat" | "disabled";

export type AnthropicBreakpoint = "system" | "tools" | "messages_prefix";

export type CacheProfile = {
  mode: CacheMode;
  /** Anthropic ephemeral TTL: "5m" | "1h" (24h 等会被映射到 1h) */
  retention?: string;
  /** Anthropic 协议的 cache_control 断点位置 */
  breakpoints?: AnthropicBreakpoint[];
  /** OpenAI Responses / Chat Completions 的 prompt_cache_key (顶层 body 字段) */
  promptCacheKey?: string;
  /** 给 UI 显示的中文说明 */
  label: string;
  /** 给 UI 显示的备注, 例如「Anthropic 最长 1h, 24h 已自动降级」 */
  note?: string;
};

export type ResolveCacheProfileInput = {
  baseUrl: string;
  chatModel: string;
  wireApi: string;
  userEnabled: boolean;
  retention: string;
  cacheKey: string;
};

export const DEFAULT_CACHE_KEY = "commerce-chat";
export const DEFAULT_RETENTION = "24h";
/** Anthropic ephemeral 只支持 5m / 1h, 其他值 (包括 24h) 一律映射到 1h */
export const ANTHROPIC_SUPPORTED_RETENTIONS = new Set(["5m", "1h"]);
/** 默认在 system + tools 上各放一个断点 (Anthropic 最多 4 个, 2 个够用) */
export const DEFAULT_ANTHROPIC_BREAKPOINTS: AnthropicBreakpoint[] = ["system", "tools"];

export function isAnthropicBaseUrl(baseUrl: string): boolean {
  return baseUrl.includes("anthropic") || baseUrl.includes("minimaxi.com");
}

export function isResponsesBaseUrl(baseUrl: string): boolean {
  return baseUrl.includes("ai-pixel.online");
}

export function normalizeAnthropicRetention(retention: string): { value: string; downgraded: boolean } {
  if (ANTHROPIC_SUPPORTED_RETENTIONS.has(retention)) return { value: retention, downgraded: false };
  return { value: "1h", downgraded: true };
}

export function resolveCacheProfile(input: ResolveCacheProfileInput): CacheProfile {
  const baseUrl = input.baseUrl || "";
  const chatModel = input.chatModel || "";
  const wireApi = (input.wireApi || "auto").toLowerCase();
  const retention = input.retention || DEFAULT_RETENTION;
  const cacheKey = input.cacheKey || DEFAULT_CACHE_KEY;

  if (!input.userEnabled) {
    return {
      mode: "disabled",
      label: "已关闭 (管理员手动禁用)",
      note: "所有分支不传 cache, 不会命中任何 prompt cache."
    };
  }

  // 优先级: wireApi 显式 > baseUrl 自动推断
  // wireApi=anthropic 或 baseUrl 是 anthropic 系列 → anthropic_ephemeral
  if (wireApi === "anthropic" || (wireApi !== "chat" && wireApi !== "responses" && isAnthropicBaseUrl(baseUrl))) {
    const { value, downgraded } = normalizeAnthropicRetention(retention);
    return {
      mode: "anthropic_ephemeral",
      retention: value,
      breakpoints: DEFAULT_ANTHROPIC_BREAKPOINTS,
      promptCacheKey: cacheKey,
      label: `Anthropic ephemeral · ${value} · ${DEFAULT_ANTHROPIC_BREAKPOINTS.length} breakpoints`,
      note: downgraded ? `原配置 ${retention} 已自动降级到 ${value} (Anthropic 最长 1h).` : undefined
    };
  }

  // wireApi=responses 或 baseUrl 是 ai-pixel.online → openai_responses
  if (wireApi === "responses" || isResponsesBaseUrl(baseUrl)) {
    return {
      mode: "openai_responses",
      retention,
      promptCacheKey: cacheKey,
      label: `OpenAI Responses · retention=${retention}`
    };
  }

  // 默认 → openai_chat
  return {
    mode: "openai_chat",
    promptCacheKey: cacheKey,
    label: `OpenAI Chat Completions · prompt_cache_key only`
  };
}