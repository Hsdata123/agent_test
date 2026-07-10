import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// 缓存命中率统计 + 趋势 (按天)
// - daily: 最近 N 天的 promptTokens / cachedTokens / cacheHitRate / savedCost
// - totals: 累计
// - alert: 当 promptTokens 足够多但命中率低于阈值, 触发警告 (管理员可据此判断 cache 是否生效)

const DEFAULT_DAYS = 30;
const ALERT_MIN_PROMPT_TOKENS = 10_000;
const ALERT_HIT_RATE_THRESHOLD = 0.1;
const INPUT_PRICE_PER_THOUSAND = 0.002;

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (user.role !== "admin") throw Object.assign(new Error("仅管理员可查看缓存统计"), { status: 403 });
    await ensureChatUsageTable();

    const url = new URL(request.url);
    const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days")) || DEFAULT_DAYS));
    const userId = url.searchParams.get("userId") || "all";

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));

    const rows = await prisma.$queryRawUnsafe<
      Array<{ day: string; promptTokens: number | null; cachedTokens: number | null }>
    >(
      `SELECT strftime('%Y-%m-%d', createdAt) as day,
              COALESCE(SUM(promptTokens), 0) as promptTokens,
              COALESCE(SUM(cachedTokens), 0) as cachedTokens
       FROM ChatUsage
       WHERE createdAt >= ? ${userId === "all" ? "" : "AND userId = ?"}
       GROUP BY day
       ORDER BY day ASC`,
      ...(userId === "all"
        ? [start.toISOString()]
        : [start.toISOString(), userId])
    );

    // 补全缺失日期 (前端图表要连续)
    const byDay = new Map(rows.map((row) => [row.day, row]));
    const daily: Array<{ date: string; promptTokens: number; cachedTokens: number; cacheHitRate: number; savedCost: number }> = [];
    for (let i = 0; i < days; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const row = byDay.get(key);
      const promptTokens = Number(row?.promptTokens || 0);
      const cachedTokens = Number(row?.cachedTokens || 0);
      const cacheHitRate = promptTokens > 0 ? cachedTokens / promptTokens : 0;
      const savedCost = Number(((cachedTokens / 1000) * INPUT_PRICE_PER_THOUSAND).toFixed(6));
      daily.push({ date: key, promptTokens, cachedTokens, cacheHitRate, savedCost });
    }

    const totalPrompt = daily.reduce((sum, day) => sum + day.promptTokens, 0);
    const totalCached = daily.reduce((sum, day) => sum + day.cachedTokens, 0);
    const totalSaved = Number(((totalCached / 1000) * INPUT_PRICE_PER_THOUSAND).toFixed(6));
    const totalHitRate = totalPrompt > 0 ? totalCached / totalPrompt : 0;

    // 按 cacheKey 分桶
    const byKey = await prisma.$queryRawUnsafe<Array<{ cacheKey: string | null; promptTokens: number | null; cachedTokens: number | null }>>(
      `SELECT cacheKey, COALESCE(SUM(promptTokens), 0) as promptTokens, COALESCE(SUM(cachedTokens), 0) as cachedTokens
       FROM ChatUsage
       WHERE createdAt >= ? ${userId === "all" ? "" : "AND userId = ?"}
       GROUP BY cacheKey
       ORDER BY promptTokens DESC`,
      ...(userId === "all" ? [start.toISOString()] : [start.toISOString(), userId])
    );

    let alert: { level: "warning" | "critical"; message: string } | undefined;
    if (totalPrompt >= ALERT_MIN_PROMPT_TOKENS && totalHitRate < ALERT_HIT_RATE_THRESHOLD) {
      const pct = (totalHitRate * 100).toFixed(1);
      alert = {
        level: totalHitRate < 0.02 ? "critical" : "warning",
        message: `近 ${days} 天对话 prompt tokens 共 ${totalPrompt.toLocaleString()}，缓存命中率仅 ${pct}%，低于 ${(ALERT_HIT_RATE_THRESHOLD * 100).toFixed(0)}%。` +
          "请检查：① API 配置「启用提示词缓存」是否打开；② 当前 baseUrl / chatModel 是否与上游缓存兼容（Anthropic 协议最长 1h，" +
          "OpenAI Responses 才支持 prompt_cache_retention）；③ 系统提示词 / 工具定义是否每次都变化（影响前缀命中）。"
      };
    }

    return NextResponse.json({
      success: true,
      days,
      daily,
      totals: {
        promptTokens: totalPrompt,
        cachedTokens: totalCached,
        cacheHitRate: totalHitRate,
        savedCost: totalSaved
      },
      byKey: byKey.map((row) => ({
        cacheKey: row.cacheKey || "(无)",
        promptTokens: Number(row.promptTokens || 0),
        cachedTokens: Number(row.cachedTokens || 0),
        cacheHitRate: Number(row.promptTokens || 0) > 0 ? Number(row.cachedTokens || 0) / Number(row.promptTokens || 0) : 0
      })),
      alert
    });
  } catch (error) {
    return jsonError(error);
  }
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
      cacheKey TEXT,
      estimatedCost REAL NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL,
      CONSTRAINT ChatUsage_userId_fkey FOREIGN KEY (userId) REFERENCES User (id) ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE ChatUsage ADD COLUMN cacheKey TEXT`);
  } catch {
    // 已存在
  }
}