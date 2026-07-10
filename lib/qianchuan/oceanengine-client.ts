import { getValidAccessToken } from "./token-refresh";
import { qianchuanCache } from "./cache";

const API_BASE = "https://api.oceanengine.com/open_api/";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TTL_MS = 5 * 60 * 1000;

export type OceanEngineCallOptions = {
  appId: string;
  endpoint: string;
  method?: "GET" | "POST";
  params?: Record<string, string | number | boolean | undefined | null>;
  body?: Record<string, unknown>;
  ttlMs?: number;
  skipCache?: boolean;
};

export class OceanEngineError extends Error {
  readonly appId: string;
  readonly endpoint: string;
  readonly status?: number;
  readonly apiCode?: number;
  readonly apiMessage?: string;
  constructor(
    appId: string,
    endpoint: string,
    message: string,
    extra: { status?: number; apiCode?: number; apiMessage?: string } = {}
  ) {
    super(message);
    this.name = "OceanEngineError";
    this.appId = appId;
    this.endpoint = endpoint;
    this.status = extra.status;
    this.apiCode = extra.apiCode;
    this.apiMessage = extra.apiMessage;
  }
}

export async function callOceanEngine<T = unknown>(opts: OceanEngineCallOptions): Promise<T> {
  const {
    appId,
    endpoint,
    method = "GET",
    params,
    body,
    ttlMs = DEFAULT_TTL_MS,
    skipCache = false
  } = opts;

  const cacheKey = buildCacheKey(appId, endpoint, method, params, body);

  if (!skipCache) {
    const cached = qianchuanCache.get<T>(cacheKey);
    if (cached !== undefined) return cached;
  }

  const accessToken = await getValidAccessToken(appId);

  const url = new URL(endpoint, API_BASE);
  if (method === "GET" && params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method,
      headers: {
        "Access-Token": accessToken,
        "Content-Type": "application/json"
      },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    throw new OceanEngineError(appId, endpoint, `OceanEngine request failed: ${msg}`, {
      apiMessage: msg
    });
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const text = await safeText(resp);
    throw new OceanEngineError(
      appId,
      endpoint,
      `OceanEngine HTTP ${resp.status}: ${text}`,
      { status: resp.status, apiMessage: text }
    );
  }

  const json = (await resp.json()) as {
    code?: number;
    message?: string;
    data?: T;
  };

  if (json.code !== 0) {
    throw new OceanEngineError(
      appId,
      endpoint,
      `OceanEngine error [${json.code}]: ${json.message ?? "unknown"}`,
      { apiCode: json.code, apiMessage: json.message }
    );
  }

  const data = json.data as T;
  qianchuanCache.set(cacheKey, data, ttlMs);
  return data;
}

function buildCacheKey(
  appId: string,
  endpoint: string,
  method: string,
  params?: Record<string, unknown>,
  body?: Record<string, unknown>
): string {
  return `app:${appId}:${method}:${endpoint}:` + JSON.stringify({ params, body });
}

async function safeText(resp: Response): Promise<string> {
  try {
    return (await resp.text()).slice(0, 500);
  } catch {
    return "";
  }
}
