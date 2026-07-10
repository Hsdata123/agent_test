import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { CURRENT_ADVERTISER_COOKIE } from "@/lib/auth";
import type { User } from "@prisma/client";

export type UserAdvertiserBindingRow = {
  advertiserId: string;
  isPrimary: boolean;
  createdAt: Date;
};

export type UserAdvertiserList = {
  activeAdvertiserId: string | null;
  bindings: UserAdvertiserBindingRow[];
};

export class AdvertiserResolveError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "AdvertiserResolveError";
  }
}

export async function listUserAdvertisers(
  userId: string
): Promise<UserAdvertiserBindingRow[]> {
  const rows = await prisma.userAdvertiserBinding.findMany({
    where: { userId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { advertiserId: true, isPrimary: true, createdAt: true }
  });
  return rows;
}

export async function getUserAdvertiserList(
  userId: string
): Promise<UserAdvertiserList> {
  const bindings = await listUserAdvertisers(userId);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { advertiserId: true }
  });
  const active =
    bindings.find((b) => b.advertiserId === user?.advertiserId)?.advertiserId ??
    bindings.find((b) => b.isPrimary)?.advertiserId ??
    bindings[0]?.advertiserId ??
    null;
  return { activeAdvertiserId: active, bindings };
}

function isValid(value: string | null | undefined, valid: Set<string>): value is string {
  return typeof value === "string" && value.length > 0 && valid.has(value);
}

export async function resolveCurrentAdvertiser(
  user: Pick<User, "id" | "advertiserId">,
  request: Request,
  bodyAdvertiserId?: string | null
): Promise<string> {
  const bindings = await listUserAdvertisers(user.id);
  if (bindings.length === 0) {
    throw new AdvertiserResolveError("no_advertiser_bound", 400);
  }
  const valid = new Set(bindings.map((b) => b.advertiserId));

  if (isValid(bodyAdvertiserId ?? null, valid)) {
    return bodyAdvertiserId as string;
  } else if (bodyAdvertiserId && bodyAdvertiserId.length > 0) {
    throw new AdvertiserResolveError("advertiser_not_authorized", 403);
  }

  let cookieValue: string | null = null;
  try {
    const jar = await cookies();
    cookieValue = jar.get(CURRENT_ADVERTISER_COOKIE)?.value ?? null;
  } catch {
    cookieValue = null;
  }
  if (!cookieValue && request) {
    const header = request.headers.get("cookie");
    if (header) {
      const match = header
        .split(/;\s*/)
        .map((kv) => kv.split("=", 2))
        .find((kv) => kv[0] === CURRENT_ADVERTISER_COOKIE);
      if (match && match[1]) cookieValue = decodeURIComponent(match[1]);
    }
  }
  if (isValid(cookieValue, valid)) {
    return cookieValue;
  }

  if (isValid(user.advertiserId ?? null, valid)) {
    return user.advertiserId as string;
  }

  const primary = bindings.find((b) => b.isPrimary);
  if (primary) return primary.advertiserId;
  return bindings[0].advertiserId;
}