import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (user.role !== "admin") throw Object.assign(new Error("仅管理员可查看消耗统计"), { status: 403 });

    const url = new URL(request.url);
    const userId = url.searchParams.get("userId") || "all";
    const period = url.searchParams.get("period") || "day";
    const range = periodRange(url.searchParams.get("anchorDate") || undefined, period);
    await ensureChatUsageTable();
    const results = await prisma.generationResult.findMany({
      where:
        userId === "all"
          ? { createdAt: { gte: range.start, lt: range.end } }
          : { createdAt: { gte: range.start, lt: range.end }, task: { createdById: userId } },
      include: { task: { include: { creator: true } } },
      orderBy: { createdAt: "desc" }
    });

    const grouped = new Map<
      string,
      {
        id: string;
        userId: string;
        username: string;
        nickname: string;
        period: string;
        periodSort: string;
        imageCount: number;
        estimatedCost: number;
        chatCount: number;
        chatEstimatedCost: number;
        chatCachedTokens: number;
      }
    >();
    for (const result of results) {
      const creator = result.task.creator;
      const periodInfo = range.periodInfo;
      const key = `${creator.id}-${periodInfo.sortKey}`;
      const current =
        grouped.get(key) ||
        {
          id: key,
          userId: creator.id,
          username: creator.username,
          nickname: creator.nickname,
          period: periodInfo.label,
          periodSort: periodInfo.sortKey,
          imageCount: 0,
          estimatedCost: 0,
          chatCount: 0,
          chatEstimatedCost: 0,
          chatCachedTokens: 0
        };
      current.imageCount += 1;
      current.estimatedCost += estimateImageCost(result.task.imageQuality, result.task.imageSize);
      grouped.set(key, current);
    }

    const chatRows = await prisma.$queryRawUnsafe<
      Array<{ userId: string; username: string; nickname: string; chatCount: bigint | number; chatEstimatedCost: number | null; chatCachedTokens: bigint | number | null }>
    >(
      `SELECT u.id as userId, u.username as username, u.nickname as nickname, COUNT(c.id) as chatCount, COALESCE(SUM(c.estimatedCost), 0) as chatEstimatedCost, COALESCE(SUM(c.cachedTokens), 0) as chatCachedTokens
       FROM ChatUsage c
       JOIN User u ON u.id = c.userId
       WHERE c.createdAt >= ? AND c.createdAt < ? ${userId === "all" ? "" : "AND c.userId = ?"}
       GROUP BY u.id, u.username, u.nickname`,
      ...(userId === "all" ? [range.start.toISOString(), range.end.toISOString()] : [range.start.toISOString(), range.end.toISOString(), userId])
    );
    for (const row of chatRows) {
      const periodInfo = range.periodInfo;
      const key = `${row.userId}-${periodInfo.sortKey}`;
      const current =
        grouped.get(key) ||
        {
          id: key,
          userId: row.userId,
          username: row.username,
          nickname: row.nickname,
          period: periodInfo.label,
          periodSort: periodInfo.sortKey,
          imageCount: 0,
          estimatedCost: 0,
          chatCount: 0,
          chatEstimatedCost: 0,
          chatCachedTokens: 0
        };
      current.chatCount += Number(row.chatCount || 0);
      current.chatEstimatedCost += Number(row.chatEstimatedCost || 0);
      current.chatCachedTokens += Number(row.chatCachedTokens || 0);
      grouped.set(key, current);
    }

    const rows = Array.from(grouped.values()).sort(
      (a, b) => b.periodSort.localeCompare(a.periodSort) || b.imageCount + b.chatCount - (a.imageCount + a.chatCount)
    );
    return NextResponse.json({
      success: true,
      rows: rows.map((row) => ({
        ...row,
        estimatedCost: Number(row.estimatedCost.toFixed(4)),
        chatEstimatedCost: Number(row.chatEstimatedCost.toFixed(4)),
        chatCachedTokens: row.chatCachedTokens,
        totalEstimatedCost: Number((row.estimatedCost + row.chatEstimatedCost).toFixed(4))
      }))
    });
  } catch (error) {
    return jsonError(error);
  }
}

function periodRange(anchorValue: string | undefined, period: string) {
  const anchor = parseAnchorDate(anchorValue);
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);

  if (period === "month") {
    const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const nextMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    const monthEnd = new Date(nextMonth);
    monthEnd.setDate(monthEnd.getDate() - 1);
    const month = `${anchor.getFullYear()}-${pad(anchor.getMonth() + 1)}`;
    return {
      start: monthStart,
      end: nextMonth,
      periodInfo: { sortKey: month, label: `${month}（${formatDate(monthStart)} 至 ${formatDate(monthEnd)}）` }
    };
  }

  if (period === "week") {
    const weekStart = new Date(start);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const nextWeek = new Date(weekStart);
    nextWeek.setDate(weekStart.getDate() + 7);
    return {
      start: weekStart,
      end: nextWeek,
      periodInfo: { sortKey: formatDate(weekStart), label: `${formatDate(weekStart)} 至 ${formatDate(weekEnd)}` }
    };
  }

  const nextDay = new Date(start);
  nextDay.setDate(start.getDate() + 1);
  const day = formatDate(start);
  return { start, end: nextDay, periodInfo: { sortKey: day, label: day } };
}

function parseAnchorDate(value: string | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function periodKey(date: Date, period: string) {
  if (period === "month") {
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const month = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    return { sortKey: month, label: `${month}（${formatDate(monthStart)} 至 ${formatDate(monthEnd)}）` };
  }
  if (period === "week") {
    const weekStart = new Date(date);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    return { sortKey: formatDate(weekStart), label: `${formatDate(weekStart)} 至 ${formatDate(weekEnd)}` };
  }
  const day = formatDate(date);
  return { sortKey: day, label: day };
}

function formatDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function estimateImageCost(quality?: string | null, size?: string | null) {
  const qualityCost = quality === "low" ? 0.02 : quality === "medium" || quality === "auto" ? 0.04 : 0.08;
  if (size?.startsWith("4096x")) return qualityCost * 2;
  return qualityCost;
}

async function ensureChatUsageTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ChatUsage (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      promptTokens INTEGER NOT NULL DEFAULT 0,
      completionTokens INTEGER NOT NULL DEFAULT 0,
      totalTokens INTEGER NOT NULL DEFAULT 0,
      cachedTokens INTEGER NOT NULL DEFAULT 0,
      estimatedCost REAL NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL,
      CONSTRAINT ChatUsage_userId_fkey FOREIGN KEY (userId) REFERENCES User (id) ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE ChatUsage ADD COLUMN cachedTokens INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists.
  }
}
