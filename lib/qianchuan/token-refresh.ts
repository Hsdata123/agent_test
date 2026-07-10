import { getTokenByAppId, upsertToken, recordError } from "./token-store";
import { qianchuanCache } from "./cache";

const REFRESH_TOKEN_URL = "https://ad.oceanengine.com/open_api/oauth2/refresh_token/";
const REFRESH_BUFFER_SECONDS = 300;

const refreshLocks = new Map<string, Promise<string>>();

export class TokenRefreshError extends Error {
  readonly appId: string;
  readonly cause?: string;
  constructor(appId: string, message: string, cause?: string) {
    super(message);
    this.name = "TokenRefreshError";
    this.appId = appId;
    this.cause = cause;
  }
}

export async function getValidAccessToken(appId: string): Promise<string> {
  const existing = refreshLocks.get(appId);
  if (existing) return existing;

  // IIFE 包裹, 保证 refreshLocks.set 在第一个 await 之前同步执行,
  // 避免两个并发调用都看到 existing===undefined 后各自跑 doRefresh。
  const promise = (async () => {
    try {
      return await doRefresh(appId);
    } finally {
      refreshLocks.delete(appId);
    }
  })();
  refreshLocks.set(appId, promise);
  return promise;
}

async function doRefresh(appId: string): Promise<string> {
  const token = await getTokenByAppId(appId);
  if (!token) {
    throw new TokenRefreshError(appId, `no qianchuan token for appId=${appId}`);
  }

  const now = Date.now();
  const expiresAt = token.accessTokenExpireAt.getTime();
  if (now < expiresAt - REFRESH_BUFFER_SECONDS * 1000) {
    return token.accessToken;
  }

  let resp: Response;
  try {
    resp = await fetch(REFRESH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appid: token.appId,
        secret: token.appSecret,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken
      })
    });
  } catch (e) {
    const msg = `refresh network error: ${(e as Error).message}`;
    await recordError(appId, msg);
    throw new TokenRefreshError(appId, msg, "network");
  }

  if (!resp.ok) {
    const text = await safeReadText(resp);
    const msg = `refresh failed: HTTP ${resp.status} ${text}`;
    await recordError(appId, msg);
    throw new TokenRefreshError(appId, msg, `http_${resp.status}`);
  }

  const json = (await resp.json()) as {
    code?: number;
    message?: string;
    data?: {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_token_expires_in?: number;
      scope?: string;
    };
  };

  if (json.code !== 0) {
    const msg = `refresh failed: ${json.message ?? "unknown"}`;
    await recordError(appId, msg);
    throw new TokenRefreshError(appId, msg, "api_error");
  }

  const data = json.data;
  if (!data?.access_token || !data.expires_in) {
    const msg = "refresh response missing access_token/expires_in";
    await recordError(appId, msg);
    throw new TokenRefreshError(appId, msg, "malformed_response");
  }

  const refreshed = await upsertToken({
    appId: token.appId,
    appSecret: token.appSecret,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? token.refreshToken,
    accessTokenExpireAt: new Date(Date.now() + data.expires_in * 1000),
    refreshTokenExpireAt: data.refresh_token_expires_in
      ? new Date(Date.now() + data.refresh_token_expires_in * 1000)
      : token.refreshTokenExpireAt,
    scope: data.scope ?? token.scope ?? null
  });

  qianchuanCache.invalidatePrefix(`app:${appId}:`);

  return refreshed.accessToken;
}

async function safeReadText(resp: Response): Promise<string> {
  try {
    const t = await resp.text();
    return t.slice(0, 200);
  } catch {
    return "";
  }
}
