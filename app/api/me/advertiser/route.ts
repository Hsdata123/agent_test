import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  jsonError,
  requireUser,
  setCurrentAdvertiserCookie,
  clearCurrentAdvertiserCookie
} from "@/lib/auth";
import { getUserAdvertiserList, listUserAdvertisers } from "@/lib/qianchuan/current";

export async function GET() {
  try {
    const user = await requireUser();
    const data = await getUserAdvertiserList(user.id);
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const advertiserId = typeof body?.advertiserId === "string" ? body.advertiserId.trim() : "";
    if (!advertiserId) {
      throw Object.assign(new Error("missing_advertiser_id"), { status: 400 });
    }
    const bindings = await listUserAdvertisers(user.id);
    const valid = new Set(bindings.map((b) => b.advertiserId));
    if (!valid.has(advertiserId)) {
      throw Object.assign(new Error("advertiser_not_authorized"), { status: 403 });
    }

    await prisma.$transaction([
      prisma.userAdvertiserBinding.updateMany({
        where: { userId: user.id, isPrimary: true },
        data: { isPrimary: false }
      }),
      prisma.userAdvertiserBinding.update({
        where: { userId_advertiserId: { userId: user.id, advertiserId } },
        data: { isPrimary: true }
      }),
      prisma.user.update({ where: { id: user.id }, data: { advertiserId } })
    ]);

    const response = NextResponse.json({ success: true, ...(await getUserAdvertiserList(user.id)) });
    setCurrentAdvertiserCookie(response, advertiserId);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({}));
    const advertiserId = typeof body?.advertiserId === "string" ? body.advertiserId.trim() : "";
    if (!advertiserId) {
      throw Object.assign(new Error("missing_advertiser_id"), { status: 400 });
    }
    const result = await prisma.$transaction(async (tx) => {
      const binding = await tx.userAdvertiserBinding.findUnique({
        where: { userId_advertiserId: { userId: user.id, advertiserId } }
      });
      if (!binding) {
        throw Object.assign(new Error("binding_not_found"), { status: 404 });
      }
      if (binding.isPrimary) {
        throw Object.assign(new Error("cannot_delete_primary_binding"), { status: 400 });
      }
      await tx.userAdvertiserBinding.delete({
        where: { userId_advertiserId: { userId: user.id, advertiserId } }
      });
      let next: string | null = null;
      if (user.advertiserId === advertiserId) {
        const remaining = await tx.userAdvertiserBinding.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "asc" }
        });
        next = remaining[0]?.advertiserId ?? null;
        await tx.user.update({ where: { id: user.id }, data: { advertiserId: next } });
        if (next) {
          await tx.userAdvertiserBinding.update({
            where: { userId_advertiserId: { userId: user.id, advertiserId: next } },
            data: { isPrimary: true }
          });
        }
      }
      return { next };
    });

    const response = NextResponse.json({ success: true, ...(await getUserAdvertiserList(user.id)) });
    if (user.advertiserId === advertiserId) {
      if (result.next) setCurrentAdvertiserCookie(response, result.next);
      else clearCurrentAdvertiserCookie(response);
    }
    return response;
  } catch (error) {
    return jsonError(error);
  }
}