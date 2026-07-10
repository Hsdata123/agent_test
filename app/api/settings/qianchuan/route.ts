import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, requireAdmin, requireUser } from "@/lib/auth";
import {
  bindAdvertiser,
  getTokenByAppId,
  listTokens,
  unbindAdvertiser
} from "@/lib/qianchuan/token-store";
import { getValidAccessToken } from "@/lib/qianchuan/token-refresh";
import { exchangeAuthCode, seedTokenDirect } from "@/lib/qianchuan/auth";

function maskToken(token: string | null | undefined): string | null {
  if (!token) return null;
  if (token.length <= 12) return "****";
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function serializeTokenRow(row: {
  id: string;
  appId: string;
  scope: string | null;
  lastRefreshAt: Date | null;
  lastError: string | null;
  accessTokenExpireAt: Date;
  refreshTokenExpireAt: Date;
  createdAt: Date;
  updatedAt: Date;
  accessToken: string;
  refreshToken: string;
  advertisers: Array<{
    id: string;
    advertiserId: string;
    nickname: string | null;
    createdAt: Date;
  }>;
}) {
  return {
    id: row.id,
    appId: row.appId,
    scope: row.scope,
    lastRefreshAt: row.lastRefreshAt,
    lastError: row.lastError,
    accessTokenExpireAt: row.accessTokenExpireAt,
    refreshTokenExpireAt: row.refreshTokenExpireAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    accessTokenMasked: maskToken(row.accessToken),
    refreshTokenMasked: maskToken(row.refreshToken),
    accessTokenStatus: row.accessTokenExpireAt.getTime() > Date.now() ? "valid" : "expired",
    refreshTokenStatus: row.refreshTokenExpireAt.getTime() > Date.now() ? "valid" : "expired",
    advertisers: row.advertisers.map((a) => ({
      id: a.id,
      advertiserId: a.advertiserId,
      nickname: a.nickname,
      createdAt: a.createdAt
    }))
  };
}

function validateAppId(appId: string): void {
  if (!appId || !/^\d{6,30}$/.test(appId)) {
    throw Object.assign(new Error("appId 必须为 6~30 位数字"), { status: 400 });
  }
}

function validateAdvertiserId(advertiserId: string): void {
  if (!advertiserId || !/^\d{6,30}$/.test(advertiserId)) {
    throw Object.assign(new Error("advertiserId 必须为 6~30 位数字"), { status: 400 });
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    const tokens = await listTokens();
    const myAdvertiserId = user.advertiserId ?? null;
    return NextResponse.json({
      success: true,
      tokens: tokens.map(serializeTokenRow),
      myAdvertiserId,
      canManage: user.role === "admin"
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireAdmin();
    const body = (await request.json()) as {
      appId?: number | string;
      appSecret?: string;
      authCode?: string;
      accessToken?: string;
      refreshToken?: string;
      accessTokenExpireAt?: string;
      refreshTokenExpireAt?: string;
    };

    const appId = String(body.appId ?? "").trim();
    validateAppId(appId);
    const appSecret = String(body.appSecret || "").trim();
    if (!appSecret) {
      throw Object.assign(new Error("appSecret 不能为空"), { status: 400 });
    }

    const authCode = body.authCode?.trim();
    if (authCode) {
      await exchangeAuthCode({ appId, appSecret, authCode });
    } else {
      const accessToken = String(body.accessToken || "").trim();
      const refreshToken = String(body.refreshToken || "").trim();
      if (!accessToken || !refreshToken) {
        throw Object.assign(new Error("未提供 authCode 时，必须同时提供 accessToken 和 refreshToken"), { status: 400 });
      }
      const accessTokenExpireAt = body.accessTokenExpireAt ? new Date(body.accessTokenExpireAt) : new Date(Date.now() + 23 * 3600 * 1000);
      const refreshTokenExpireAt = body.refreshTokenExpireAt ? new Date(body.refreshTokenExpireAt) : new Date(Date.now() + 14 * 24 * 3600 * 1000);
      if (Number.isNaN(accessTokenExpireAt.getTime()) || Number.isNaN(refreshTokenExpireAt.getTime())) {
        throw Object.assign(new Error("过期时间格式错误"), { status: 400 });
      }
      await seedTokenDirect({
        appId,
        appSecret,
        accessToken,
        refreshToken,
        accessTokenExpireAt,
        refreshTokenExpireAt
      });
    }

    const row = await getTokenByAppId(appId);
    return NextResponse.json({ success: true, token: row ? serializeTokenRow(row) : null });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    if (action === "bind") {
      const body = (await request.json()) as {
        tokenId?: string;
        advertiserId?: number | string;
        nickname?: string;
        bindUserIds?: string[];
      };
      const tokenId = String(body.tokenId ?? "").trim();
      const advertiserId = String(body.advertiserId ?? "").trim();
      if (!tokenId) {
        throw Object.assign(new Error("tokenId 必填"), { status: 400 });
      }
      validateAdvertiserId(advertiserId);
      const token = await prisma.qianchuanToken.findUnique({ where: { id: tokenId } });
      if (!token) {
        throw Object.assign(new Error("token 不存在"), { status: 404 });
      }
      try {
        await bindAdvertiser({ tokenId, advertiserId, nickname: body.nickname?.trim() || null });
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("Unique constraint")) {
          throw Object.assign(new Error("该广告主已绑定到该 token"), { status: 409 });
        }
        throw e;
      }

      if (Array.isArray(body.bindUserIds) && body.bindUserIds.length) {
        await prisma.user.updateMany({
          where: { id: { in: body.bindUserIds.map(String) } },
          data: { advertiserId }
        });
      }

      const row = await getTokenByAppId(token.appId);
      return NextResponse.json({ success: true, token: row ? serializeTokenRow(row) : null });
    }

    if (action === "unbind") {
      const body = (await request.json()) as {
        tokenId?: string;
        advertiserId?: number | string;
      };
      const tokenId = String(body.tokenId ?? "").trim();
      const advertiserId = String(body.advertiserId ?? "").trim();
      if (!tokenId) {
        throw Object.assign(new Error("tokenId 必填"), { status: 400 });
      }
      validateAdvertiserId(advertiserId);
      await unbindAdvertiser({ tokenId, advertiserId });
      const token = await prisma.qianchuanToken.findUnique({ where: { id: tokenId } });
      const row = token ? await getTokenByAppId(token.appId) : null;
      return NextResponse.json({ success: true, token: row ? serializeTokenRow(row) : null });
    }

    const body = (await request.json()) as { appId?: number | string; action?: "refresh" };
    const appId = String(body.appId ?? "").trim();
    validateAppId(appId);
    await getValidAccessToken(appId);
    const row = await getTokenByAppId(appId);
    return NextResponse.json({
      success: true,
      action: body.action ?? "refresh",
      accessTokenMasked: maskToken(row?.accessToken ?? null),
      token: row ? serializeTokenRow(row) : null
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
    const body = (await request.json()) as { appId?: number | string };
    const appId = String(body.appId ?? "").trim();
    validateAppId(appId);
    await prisma.qianchuanToken.delete({ where: { appId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}