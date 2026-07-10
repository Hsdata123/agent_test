import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, requireAdmin } from "@/lib/auth";
import { listUserAdvertisers } from "@/lib/qianchuan/current";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId") || "";
    if (!userId) {
      throw Object.assign(new Error("missing_user_id"), { status: 400 });
    }
    const bindings = await listUserAdvertisers(userId);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, nickname: true, advertiserId: true }
    });
    return NextResponse.json({ success: true, user, bindings });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json();
    const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
    const advertiserId = typeof body?.advertiserId === "string" ? body.advertiserId.trim() : "";
    const isPrimary = body?.isPrimary === true;
    if (!userId || !advertiserId) {
      throw Object.assign(new Error("missing_user_id_or_advertiser_id"), { status: 400 });
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw Object.assign(new Error("user_not_found"), { status: 404 });
    }

    const ops: Array<ReturnType<typeof prisma.userAdvertiserBinding.create> | ReturnType<typeof prisma.userAdvertiserBinding.updateMany> | ReturnType<typeof prisma.userAdvertiserBinding.update> | ReturnType<typeof prisma.user.update>> = [];

    if (isPrimary) {
      ops.push(
        prisma.userAdvertiserBinding.updateMany({
          where: { userId, isPrimary: true },
          data: { isPrimary: false }
        })
      );
    }

    ops.push(
      prisma.userAdvertiserBinding.upsert({
        where: { userId_advertiserId: { userId, advertiserId } },
        update: { isPrimary: isPrimary || undefined },
        create: { userId, advertiserId, isPrimary }
      })
    );

    if (isPrimary || !user.advertiserId) {
      ops.push(prisma.user.update({ where: { id: userId }, data: { advertiserId } }));
    }

    await prisma.$transaction(ops);
    return NextResponse.json({ success: true, bindings: await listUserAdvertisers(userId) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
    const advertiserId = typeof body?.advertiserId === "string" ? body.advertiserId.trim() : "";
    if (!userId || !advertiserId) {
      throw Object.assign(new Error("missing_user_id_or_advertiser_id"), { status: 400 });
    }
    const binding = await prisma.userAdvertiserBinding.findUnique({
      where: { userId_advertiserId: { userId, advertiserId } }
    });
    if (!binding) {
      throw Object.assign(new Error("binding_not_found"), { status: 404 });
    }
    if (binding.isPrimary) {
      throw Object.assign(new Error("cannot_delete_primary_binding"), { status: 400 });
    }

    const ops: Array<ReturnType<typeof prisma.userAdvertiserBinding.delete> | ReturnType<typeof prisma.user.update>> = [];
    ops.push(
      prisma.userAdvertiserBinding.delete({
        where: { userId_advertiserId: { userId, advertiserId } }
      })
    );
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.advertiserId === advertiserId) {
      const remaining = await listUserAdvertisers(userId);
      const next = remaining[0]?.advertiserId ?? null;
      ops.push(prisma.user.update({ where: { id: userId }, data: { advertiserId: next } }));
    }
    await prisma.$transaction(ops);
    return NextResponse.json({ success: true, bindings: await listUserAdvertisers(userId) });
  } catch (error) {
    return jsonError(error);
  }
}