import { prisma } from "@/lib/prisma";
import type { QianchuanAdvertiser, QianchuanToken } from "@prisma/client";

export type TokenCreateInput = {
  appId: string;
  appSecret: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpireAt: Date;
  refreshTokenExpireAt: Date;
  scope?: string | null;
};

export type AccessTokenPatch = {
  accessToken: string;
  accessTokenExpireAt: Date;
  refreshToken?: string;
  refreshTokenExpireAt?: Date;
  scope?: string | null;
};

export type TokenWithAdvertisers = QianchuanToken & {
  advertisers: QianchuanAdvertiser[];
};

export async function getTokenByAppId(appId: string): Promise<TokenWithAdvertisers | null> {
  return prisma.qianchuanToken.findUnique({
    where: { appId },
    include: { advertisers: { orderBy: { createdAt: "asc" } } }
  });
}

export async function getTokenByAdvertiser(advertiserId: string): Promise<TokenWithAdvertisers | null> {
  const binding = await prisma.qianchuanAdvertiser.findFirst({
    where: { advertiserId },
    include: { token: { include: { advertisers: { orderBy: { createdAt: "asc" } } } } }
  });
  return binding?.token ?? null;
}

export async function listTokens(): Promise<TokenWithAdvertisers[]> {
  return prisma.qianchuanToken.findMany({
    orderBy: { updatedAt: "desc" },
    include: { advertisers: { orderBy: { createdAt: "asc" } } }
  });
}

export async function upsertToken(input: TokenCreateInput & { lastRefreshAt?: Date | null }): Promise<TokenWithAdvertisers> {
  const now = new Date();
  return prisma.qianchuanToken.upsert({
    where: { appId: input.appId },
    update: {
      appSecret: input.appSecret,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      accessTokenExpireAt: input.accessTokenExpireAt,
      refreshTokenExpireAt: input.refreshTokenExpireAt,
      scope: input.scope ?? null,
      lastRefreshAt: input.lastRefreshAt ?? now,
      lastError: null
    },
    create: {
      appId: input.appId,
      appSecret: input.appSecret,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      accessTokenExpireAt: input.accessTokenExpireAt,
      refreshTokenExpireAt: input.refreshTokenExpireAt,
      scope: input.scope ?? null,
      lastRefreshAt: input.lastRefreshAt ?? now
    },
    include: { advertisers: { orderBy: { createdAt: "asc" } } }
  });
}

export async function updateAccessToken(appId: string, patch: AccessTokenPatch): Promise<TokenWithAdvertisers> {
  return prisma.qianchuanToken.update({
    where: { appId },
    data: {
      accessToken: patch.accessToken,
      accessTokenExpireAt: patch.accessTokenExpireAt,
      refreshToken: patch.refreshToken,
      refreshTokenExpireAt: patch.refreshTokenExpireAt,
      scope: patch.scope,
      lastRefreshAt: new Date(),
      lastError: null
    },
    include: { advertisers: { orderBy: { createdAt: "asc" } } }
  });
}

export async function recordError(appId: string, err: string): Promise<void> {
  await prisma.qianchuanToken.update({
    where: { appId },
    data: { lastError: err }
  });
}

export async function clearError(appId: string): Promise<void> {
  await prisma.qianchuanToken.update({
    where: { appId },
    data: { lastError: null }
  });
}

export async function bindAdvertiser(input: {
  tokenId: string;
  advertiserId: string;
  nickname?: string | null;
}): Promise<QianchuanAdvertiser> {
  return prisma.qianchuanAdvertiser.create({
    data: {
      tokenId: input.tokenId,
      advertiserId: input.advertiserId,
      nickname: input.nickname ?? null
    }
  });
}

export async function unbindAdvertiser(input: { tokenId: string; advertiserId: string }): Promise<void> {
  await prisma.qianchuanAdvertiser.delete({
    where: { tokenId_advertiserId: { tokenId: input.tokenId, advertiserId: input.advertiserId } }
  });
}

export async function deleteToken(appId: string): Promise<void> {
  await prisma.qianchuanToken.delete({ where: { appId } });
}

export type QianchuanAnchor = {
  id: string;
  advertiserId: string;
  anchorId: string;
  anchorName: string;
  nickname: string | null;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export async function upsertAnchors(
  advertiserId: string,
  anchors: Array<{ anchorId: string; anchorName: string; nickname?: string | null }>
): Promise<number> {
  if (anchors.length === 0) return 0;
  const now = new Date();
  const ops = anchors
    .filter((a) => a.anchorId && a.anchorName)
    .map((a) =>
      prisma.qianchuanAnchor.upsert({
        where: { advertiserId_anchorId: { advertiserId, anchorId: a.anchorId } },
        update: { anchorName: a.anchorName, nickname: a.nickname ?? null, lastSeenAt: now },
        create: {
          advertiserId,
          anchorId: a.anchorId,
          anchorName: a.anchorName,
          nickname: a.nickname ?? null,
          lastSeenAt: now
        }
      })
    );
  await Promise.all(ops);
  return anchors.length;
}

export async function findAnchorsByName(
  advertiserId: string,
  keyword: string
): Promise<QianchuanAnchor[]> {
  const trimmed = keyword.trim();
  if (!trimmed) return [];
  return prisma.qianchuanAnchor.findMany({
    where: {
      advertiserId,
      anchorName: { contains: trimmed }
    },
    orderBy: { lastSeenAt: "desc" },
    take: 10
  });
}

export async function findAnchorByExactName(
  advertiserId: string,
  name: string
): Promise<QianchuanAnchor | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return prisma.qianchuanAnchor.findFirst({
    where: { advertiserId, anchorName: trimmed }
  });
}

export async function findAnchorById(
  advertiserId: string,
  anchorId: string
): Promise<QianchuanAnchor | null> {
  return prisma.qianchuanAnchor.findUnique({
    where: { advertiserId_anchorId: { advertiserId, anchorId } }
  });
}