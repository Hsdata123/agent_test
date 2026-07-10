import { upsertToken } from "./token-store";

const ACCESS_TOKEN_URL = "https://ad.oceanengine.com/open_api/oauth2/access_token/";

export type ExchangeAuthCodeInput = {
  appId: string;
  appSecret: string;
  authCode: string;
};

export type ExchangeAuthCodeResult = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpireAt: Date;
  refreshTokenExpireAt: Date;
  scope: string | null;
};

export async function exchangeAuthCode(input: ExchangeAuthCodeInput): Promise<ExchangeAuthCodeResult> {
  let resp: Response;
  try {
    resp = await fetch(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appid: input.appId,
        secret: input.appSecret,
        grant_type: "authorization_code",
        code: input.authCode
      })
    });
  } catch (e) {
    throw new Error(`exchange network error: ${(e as Error).message}`);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`exchange failed: HTTP ${resp.status} ${text.slice(0, 200)}`);
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
    throw new Error(`exchange failed: ${json.message ?? "unknown"}`);
  }
  const data = json.data;
  if (!data?.access_token || !data.refresh_token || !data.expires_in || !data.refresh_token_expires_in) {
    throw new Error("exchange response missing required fields");
  }

  const accessTokenExpireAt = new Date(Date.now() + data.expires_in * 1000);
  const refreshTokenExpireAt = new Date(Date.now() + data.refresh_token_expires_in * 1000);

  await upsertToken({
    appId: input.appId,
    appSecret: input.appSecret,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessTokenExpireAt,
    refreshTokenExpireAt,
    scope: data.scope ?? null
  });

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessTokenExpireAt,
    refreshTokenExpireAt,
    scope: data.scope ?? null
  };
}

export async function seedTokenDirect(input: {
  appId: string;
  appSecret: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpireAt: Date;
  refreshTokenExpireAt: Date;
  scope?: string | null;
}): Promise<void> {
  await upsertToken({
    appId: input.appId,
    appSecret: input.appSecret,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    accessTokenExpireAt: input.accessTokenExpireAt,
    refreshTokenExpireAt: input.refreshTokenExpireAt,
    scope: input.scope ?? null
  });
}