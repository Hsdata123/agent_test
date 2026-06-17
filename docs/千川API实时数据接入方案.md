# 千川 API 实时数据接入方案

> 适用项目：电商视觉与内容助手（`ai-commerce-image-mvp`）
> 配套项目：`D:\python project\qianchuan_api`（**仅作 API 字段映射参考，不复用服务进程**）
> 状态：方案稿（未实施）
> 选定方案：**B. Next.js 直连 OceanEngine**（单体内嵌 token 管理 + 进程内缓存）
> 作者产出日期：2026-06-17

## 0. 方案变更说明

**从方案 A 改为方案 B 的取舍**：

| 维度 | 方案 A（已弃用） | 方案 B（当前选定） |
|---|---|---|
| 进程数 | 2（Next.js + Python FastAPI） | **1（仅 Next.js）** |
| Token 存储 | MySQL `oauth_token_management` | **SQLite `QianchuanToken` 表** |
| 数据缓存 | Python 进程内 + MySQL 落库 | **Next.js 进程内 5min TTL** |
| 部署 | systemd / PM2 双进程 | **Next.js 单进程** |
| 与 qianchuan_api 关系 | 进程级复用 | **仅复用字段映射**（读 Python 项目源码抄字段名） |
| 实施工时 | 2 ~ 2.5 天 | **1.5 ~ 2 天**（少了 Python server 那一层） |
| 风险 | Python 进程挂了 web 端也能 fallback | token 刷新逻辑需要自己重写、保证幂等 |

**选 B 的核心理由**：不想额外维护一个 Python 进程；token 管理逻辑不算复杂，重写成本可控；单进程部署更简单。

## 一、现状盘点

| 项目 | 已有能力 | 缺什么 |
|---|---|---|
| **qianchuan_api** (Python) | 7 域×14 action、OAuth2 自动刷新、MySQL 落库 | **本方案不再依赖其服务进程**；仅作字段映射参考 |
| **当前 web** (Next.js) | skills 体系（registry/knowledge-base/asset-detail）、两轮 LLM 调用、`SKILL_SYSTEM_PROMPT` 路由、用户/部门/场景 | 没有"实时数据"概念，所有数据走 Excel 知识库 |
| **数据库** | SQLite via Prisma | 缺 token 表、缺 User 字段 |

## 二、目标架构（方案 B）

```
┌────────────────────────────────────────────────┐
│  Next.js (单进程)                              │
│                                                │
│  ┌──────────────────────────────────────┐     │
│  │ lib/chat-runner.ts                   │     │
│  │  SKILL_SYSTEM_PROMPT                 │     │
│  │  + "查实时数据" → qianchuan_*        │     │
│  └──────────────────────────────────────┘     │
│  ┌──────────────────────────────────────┐     │
│  │ lib/skills/                          │     │
│  │  qianchuan-account.ts   ◀─ 新增       │     │
│  │  qianchuan-live.ts      ◀─ 新增       │     │
│  │  qianchuan-author.ts    ◀─ 新增       │     │
│  └──────────────────────────────────────┘     │
│  ┌──────────────────────────────────────┐     │
│  │ lib/qianchuan/                       │     │
│  │  format.ts              ◀─ 新增       │     │  千川字段 → LLM 文本
│  │  cache.ts               ◀─ 新增       │     │  5min TTL 内存缓存
│  │  oceanengine-client.ts  ◀─ 新增       │     │  fetch + 自动刷 token
│  │  token-refresh.ts       ◀─ 新增       │     │  OAuth2 refresh_token
│  │  token-store.ts         ◀─ 新增       │     │  Prisma CRUD
│  └──────────────────────────────────────┘     │
│  ┌──────────────────────────────────────┐     │
│  │ Prisma (SQLite)                      │     │
│  │  + QianchuanToken  ◀─ 新表           │     │
│  │  + User.advertiserId ◀─ 新列         │     │
│  └──────────────────────────────────────┘     │
└────────────────────────────────────────────────┘
                  │ HTTPS
                  ▼
        ┌──────────────────┐
        │  OceanEngine API  │
        └──────────────────┘
```

## 三、落地步骤

### 阶段 1：数据模型 + token 持久化（0.5 天）

#### 1.1 Prisma schema 扩展

```prisma
// prisma/schema.prisma 新增

model QianchuanToken {
  id                      String   @id @default(cuid())
  appId                    Int      @unique   // 千川开放平台 app_id
  appSecret                String              // 私密，不返回前端
  advertiserId             Int      // 绑定的广告主 ID
  accessToken              String
  refreshToken             String
  accessTokenExpireAt      DateTime
  refreshTokenExpireAt     DateTime
  scope                    String?             // 千川返回的权限范围
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt
  lastRefreshAt            DateTime?
  lastError                String?

  @@index([advertiserId])
}

model User {
  // ... 已有字段
  advertiserId   Int?    // 该用户绑定的千川广告主 ID（用于自动注入到 skill 参数）
}
```

#### 1.2 `prisma/init.mjs` 自动建表

参考 `prisma/init.mjs` 已有 `ensureColumn` 模式，新增：

```js
ensureColumn("User", "advertiserId", "INTEGER");
db.exec(`
  CREATE TABLE IF NOT EXISTS QianchuanToken (
    id TEXT PRIMARY KEY NOT NULL,
    appId INTEGER NOT NULL UNIQUE,
    appSecret TEXT NOT NULL,
    advertiserId INTEGER NOT NULL,
    accessToken TEXT NOT NULL,
    refreshToken TEXT NOT NULL,
    accessTokenExpireAt DATETIME NOT NULL,
    refreshTokenExpireAt DATETIME NOT NULL,
    scope TEXT,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL,
    lastRefreshAt DATETIME,
    lastError TEXT
  );
  CREATE INDEX IF NOT EXISTS QianchuanToken_advertiserId_idx ON QianchuanToken(advertiserId);
`);
```

#### 1.3 `lib/qianchuan/token-store.ts`（~80 行）

```ts
import { prisma } from "@/lib/prisma";
import type { QianchuanToken } from "@prisma/client";

export async function getTokenByAppId(appId: number): Promise<QianchuanToken | null> {
  return prisma.qianchuanToken.findUnique({ where: { appId } });
}

export async function getTokenByAdvertiser(advertiserId: number): Promise<QianchuanToken | null> {
  return prisma.qianchuanToken.findFirst({ where: { advertiserId } });
}

export async function upsertToken(input: {
  appId: number;
  appSecret: string;
  advertiserId: number;
  accessToken: string;
  refreshToken: string;
  accessTokenExpireAt: Date;
  refreshTokenExpireAt: Date;
  scope?: string;
}): Promise<QianchuanToken> {
  return prisma.qianchuanToken.upsert({
    where: { appId: input.appId },
    update: { ...input, lastRefreshAt: new Date(), lastError: null },
    create: { ...input, lastRefreshAt: new Date() }
  });
}

export async function recordError(appId: number, err: string): Promise<void> {
  await prisma.qianchuanToken.update({
    where: { appId },
    data: { lastError: err }
  }).catch(() => undefined);
}
```

### 阶段 2：token 刷新 + HTTP 客户端（0.5 天）

#### 2.1 `lib/qianchuan/token-refresh.ts`（~70 行）

```ts
import { getTokenByAppId, upsertToken, recordError } from "./token-store";

const REFRESH_TOKEN_URL = "https://ad.oceanengine.com/open_api/oauth2/refresh_token/";
const REFRESH_BUFFER_SECONDS = 300;  // 提前 5 分钟刷新

// 单进程内简单的内存锁，避免并发刷新
const refreshLocks = new Map<number, Promise<string>>();

export async function getValidAccessToken(appId: number): Promise<string> {
  const existing = refreshLocks.get(appId);
  if (existing) return existing;

  const promise = doRefresh(appId);
  refreshLocks.set(appId, promise);
  try {
    return await promise;
  } finally {
    refreshLocks.delete(appId);
  }
}

async function doRefresh(appId: number): Promise<string> {
  const token = await getTokenByAppId(appId);
  if (!token) throw new Error(`No qianchuan token for appId=${appId}`);

  const now = Date.now();
  const expiresAt = token.accessTokenExpireAt.getTime();
  if (now < expiresAt - REFRESH_BUFFER_SECONDS * 1000) {
    return token.accessToken;  // 仍然有效
  }

  // 调用 refresh_token 端点
  const resp = await fetch(REFRESH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appid: token.appId,
      secret: token.appSecret,
      grant_type: "refresh_token",
      refresh_token: token.refreshToken
    })
  });
  if (!resp.ok) {
    const msg = `refresh failed: HTTP ${resp.status}`;
    await recordError(appId, msg);
    throw new Error(msg);
  }
  const json = await resp.json();
  if (json.code !== 0) {
    const msg = `refresh failed: ${json.message}`;
    await recordError(appId, msg);
    throw new Error(msg);
  }

  const data = json.data;
  const refreshed = await upsertToken({
    appId: token.appId,
    appSecret: token.appSecret,
    advertiserId: token.advertiserId,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || token.refreshToken,  // 千川可能不返回新 refresh_token
    accessTokenExpireAt: new Date(Date.now() + data.expires_in * 1000),
    refreshTokenExpireAt: data.refresh_token_expires_in
      ? new Date(Date.now() + data.refresh_token_expires_in * 1000)
      : token.refreshTokenExpireAt,
    scope: data.scope || token.scope || undefined
  });

  return refreshed.accessToken;
}
```

#### 2.2 `lib/qianchuan/cache.ts`（~50 行）

```ts
type Entry<T> = { data: T; expiresAt: number };

class TtlCache {
  private store = new Map<string, Entry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key) as Entry<T> | undefined;
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  // 清空某个 app 的所有缓存（token 刷新后调用，避免继续用 stale token）
  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }
}

export const qianchuanCache = new TtlCache();
```

#### 2.3 `lib/qianchuan/oceanengine-client.ts`（~120 行）

```ts
import { getValidAccessToken } from "./token-refresh";
import { qianchuanCache } from "./cache";

const API_BASE = "https://api.oceanengine.com/open_api/";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TTL_MS = 5 * 60 * 1000;  // 5 分钟

export type OceanEngineCallOptions = {
  appId: number;
  endpoint: string;          // 例如 "v1.0/qianchuan/report/uni_promotion/get/"
  method?: "GET" | "POST";
  params?: Record<string, string | number | undefined>;
  body?: Record<string, unknown>;
  ttlMs?: number;            // 缓存 TTL，默认 5 分钟
  skipCache?: boolean;       // 强制实时（如强制刷新场景）
};

export async function callOceanEngine<T = unknown>(opts: OceanEngineCallOptions): Promise<T> {
  const { appId, endpoint, method = "GET", params, body, ttlMs = DEFAULT_TTL_MS, skipCache = false } = opts;

  // 1. 缓存查找
  const cacheKey = buildCacheKey(appId, endpoint, method, params, body);
  if (!skipCache) {
    const cached = qianchuanCache.get<T>(cacheKey);
    if (cached) return cached;
  }

  // 2. 获取有效 access_token（自动刷新）
  const accessToken = await getValidAccessToken(appId);

  // 3. 构建 URL
  const url = new URL(endpoint, API_BASE);
  if (method === "GET" && params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  // 4. 发起请求（带超时）
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
      body: method === "POST" ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new Error(`OceanEngine HTTP ${resp.status}: ${await resp.text()}`);
  }

  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(`OceanEngine error [${json.code}]: ${json.message || "unknown"}`);
  }

  // 5. 写缓存
  qianchuanCache.set(cacheKey, json.data as T, ttlMs);
  return json.data as T;
}

function buildCacheKey(appId: number, endpoint: string, method: string, params?: Record<string, unknown>, body?: Record<string, unknown>): string {
  return JSON.stringify({ appId, endpoint, method, params, body });
}
```

#### 2.4 `lib/qianchuan/format.ts`（~150 行）

千川字段名又长又晦涩，必须格式化成"可读文本"喂给 LLM：

```ts
export function formatAccountData(data: Record<string, number | string | null | undefined>): string {
  const cost = data.stat_cost;
  const gmv = data.total_pay_order_gmv_for_roi2;
  const roi = data.total_prepay_and_pay_order_roi2;
  const orderCount = data.total_pay_order_count_for_roi2;
  const coupon = data.total_pay_order_coupon_amount_for_roi2;
  const subsidy = data.total_ecom_platform_subsidy_amount_for_roi2;

  const lines: string[] = [];
  lines.push("【巨量千川账户数据】");
  if (cost != null) lines.push(`- 整体消耗：${formatYuan(cost)}`);
  if (gmv != null) lines.push(`- 整体支付 GMV：${formatYuan(gmv)}`);
  if (roi != null) lines.push(`- 整体 ROI2：${roi.toFixed(2)}`);
  if (orderCount != null) lines.push(`- 整体支付订单数：${formatInt(orderCount)}`);
  if (coupon != null) lines.push(`- 整体支付券金额：${formatYuan(coupon)}`);
  if (subsidy != null) lines.push(`- 整体平台补贴：${formatYuan(subsidy)}`);
  if (cost != null && gmv != null && cost > 0) {
    lines.push(`- 整体客单价：${formatYuan(gmv / orderCount!)}`);
  }
  return lines.join("\n");
}

export function formatLiveData(rows: Array<{ dimensions: Record<string, any>; metrics: Record<string, any> }>): string {
  // 直播间画面数据按日期分组聚合
  const byDate = new Map<string, { cost: number; gmv: number; orders: number; show: number }>();
  for (const row of rows) {
    const date = row.dimensions.stat_time_day?.ValueStr || row.dimensions.stat_time_day?.Value;
    const anchorName = row.dimensions.roi2_material_anchor_name?.ValueStr || "未知抖音号";
    const cost = Number(row.metrics.stat_cost_for_overall_roi2?.Value || row.metrics.stat_cost_for_overall_roi2 || 0);
    const gmv = Number(row.metrics.total_pay_order_gmv_for_roi2_fork?.Value || row.metrics.total_pay_order_gmv_for_roi2_fork || 0);
    const orders = Number(row.metrics.total_pay_order_count_for_roi2_fork?.Value || row.metrics.total_pay_order_count_for_roi2_fork || 0);
    const show = Number(row.metrics.live_show_count_exclude_video_for_roi2?.Value || row.metrics.live_show_count_exclude_video_for_roi2 || 0);

    const key = `${date}`;
    const cur = byDate.get(key) || { cost: 0, gmv: 0, orders: 0, show: 0 };
    cur.cost += cost; cur.gmv += gmv; cur.orders += orders; cur.show += show;
    byDate.set(key, cur);
  }

  const lines = ["【巨量千川直播间画面数据（按日期汇总）】"];
  for (const [date, agg] of byDate) {
    lines.push(`\n日期：${date}`);
    lines.push(`- 消耗：${formatYuan(agg.cost)}`);
    lines.push(`- 支付 GMV：${formatYuan(agg.gmv)}`);
    lines.push(`- 支付订单数：${formatInt(agg.orders)}`);
    lines.push(`- 直播间展示次数：${formatInt(agg.show)}`);
  }
  return lines.join("\n");
}

function formatYuan(v: number): string {
  return "¥" + v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatInt(v: number): string {
  return Math.round(v).toLocaleString("zh-CN");
}
```

### 阶段 3：3 个 skill + system prompt（0.5 天）

#### 3.1 `lib/skills/qianchuan-account.ts`

```ts
import { callOceanEngine } from "../qianchuan/oceanengine-client";
import { formatAccountData } from "../qianchuan/format";
import { getTokenByAdvertiser } from "../qianchuan/token-store";
import type { Skill, SkillContext } from "./types";

export const qianchuanAccountSkill: Skill = {
  definition: {
    name: "qianchuanAccountData",
    description:
      "查询巨量千川账户维度数据（整体消耗、成交 GMV、ROI、订单数等）。" +
      "用于回答'某时段整体投放效果'类问题。如果用户问的是单个抖音号或直播间的数据，请用 qianchuanLiveData 或 qianchuanAuthorData。",
    parameters: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "开始时间 YYYY-MM-DD HH:MM:SS" },
        endDate: { type: "string", description: "结束时间 YYYY-MM-DD HH:MM:SS" },
        marketingGoal: {
          type: "string",
          enum: ["ALL", "LIVE_PROM_GOODS", "VIDEO_PROM_GOODS"],
          description: "营销目标过滤；直播相关问题用 LIVE_PROM_GOODS；不确定传 ALL"
        }
      },
      required: ["startDate", "endDate"]
    }
  },
  async execute(args, ctx: SkillContext) {
    const advertiserId = Number(args.advertiserId) || ctx.user.advertiserId;
    if (!advertiserId) {
      return { callId: "", name: "qianchuanAccountData", ok: false, content: "", error: "no_advertiser_id_for_user" };
    }
    const token = await getTokenByAdvertiser(advertiserId);
    if (!token) {
      return { callId: "", name: "qianchuanAccountData", ok: false, content: "", error: "no_token_for_advertiser" };
    }
    try {
      const data = await callOceanEngine<Record<string, any>>({
        appId: token.appId,
        endpoint: "v1.0/qianchuan/report/uni_promotion/get/",
        params: {
          advertiser_id: advertiserId,
          start_date: String(args.startDate),
          end_date: String(args.endDate),
          marketing_goal: String(args.marketingGoal || "ALL"),
          order_platform: "QIANCHUAN",
          fields: JSON.stringify([
            "stat_cost",
            "total_prepay_and_pay_order_roi2",
            "total_pay_order_gmv_for_roi2",
            "total_pay_order_count_for_roi2",
            "total_pay_order_coupon_amount_for_roi2",
            "total_ecom_platform_subsidy_amount_for_roi2"
          ])
        }
      });
      return {
        callId: "",
        name: "qianchuanAccountData",
        ok: true,
        content: formatAccountData(data),
        meta: { advertiserId, startDate: args.startDate, endDate: args.endDate }
      };
    } catch (e) {
      return { callId: "", name: "qianchuanAccountData", ok: false, content: "", error: (e as Error).message };
    }
  }
};
```

#### 3.2 `lib/skills/qianchuan-live.ts` 与 `qianchuan-author.ts`

参考 Python 项目 `services/api_service.py:896-1100`（live_data）和 `:1836-2000`（author_data）的 dimensions/metrics/filters 参数构造，封装成同样模式的 skill。

`anchor_id` 参数（live）和 `aweme_id`（author）由 LLM 从用户问题中推断；如果用户没指定抖音号，则不传，让接口返回所有抖音号的聚合。

#### 3.3 注册到 registry

修改 `lib/skills/registry.ts` 的 `listOpenAITools()`：

```ts
import { qianchuanAccountSkill } from "./qianchuan-account";
import { qianchuanLiveSkill } from "./qianchuan-live";
import { qianchuanAuthorSkill } from "./qianchuan-author";

export const BUILTIN_SKILLS = [
  searchKnowledgeBaseSkill,
  getAssetDetailSkill,
  qianchuanAccountSkill,
  qianchuanLiveSkill,
  qianchuanAuthorSkill
];
```

#### 3.4 更新 system prompt

`lib/chat-runner.ts` 的 `SKILL_SYSTEM_PROMPT` 追加规则 6：

```
6. 【实时千川数据】涉及千川投放数据（金额/消耗/ROI/订单/抖音号/直播间）的查询，
   优先调用实时千川技能（数据比知识库 Excel 更新鲜）：
   - 问"X 月整体成交/消耗/ROI/订单概况" → qianchuanAccountData
   - 问"X 抖音号/直播间某时段数据" → qianchuanLiveData（需 anchor_id）或 qianchuanAuthorData（需 aweme_id）
   - advertiserId 由系统从当前用户自动注入，query 里不需要重复
   - startDate / endDate 从问题时间词推断："26 年 6 月" → "2026-06-01 00:00:00" ~ "2026-06-30 23:59:59"
   - 用户问"鱼子酱"等品牌名时，记得传 marketingGoal="LIVE_PROM_GOODS" 过滤直播全域数据
```

### 阶段 4：UI 配置入口（0.5 天，可选）

#### 4.1 `app/api/settings/qianchuan/route.ts`

```ts
// GET：返回 token 配置（不返回 appSecret）
// PUT：管理员更新 appId/appSecret/advertiserId（首次绑定）
// POST /refresh：手动触发一次 token 刷新（用于测试）
```

#### 4.2 `components/Dashboard.tsx` 加一个"实时数据"开关

`useQianchuan: boolean` 默认 `true`，与 `useKnowledge` 并列。关闭时不调用 qianchuan 技能，仅走知识库。

#### 4.3 ChatConversationPrefs 扩展

`components/Dashboard.tsx:90` 的 `ChatConversationPrefs` 加 `useQianchuan: boolean`，默认 `true`。

## 四、关键技术点

### 1. advertiser_id 自动绑定

- User 表加 `advertiserId: Int?`
- `requireUser()` 时把 `advertiserId` 注入 `ctx.user`
- skill 里直接 `ctx.user.advertiserId`，LLM 不需要在 query 里传

### 2. token 刷新的并发安全

- 单进程内用 `Map<appId, Promise<string>>` 锁：同一 appId 多个并发请求只触发一次 refresh_token
- DB 写入用 Prisma `upsert`，原子操作

### 3. 缓存策略

- **5min TTL 内存缓存**（`lib/qianchuan/cache.ts`）：避免重复调用千川
- **token 刷新后清空缓存**：在 `token-refresh.ts` 的 `doRefresh` 成功路径里调 `qianchuanCache.invalidatePrefix(...)`，避免继续用旧 token
- **未来增强**：可以把 TTL 拆成"实时数据 5min"和"历史月数据 24h"两档

### 4. 错误处理

- 千川 4xx → 直接抛错，skill 返回 `ok:false`，LLM 在 round 2 能看到错误并决定是否 fallback 到知识库
- 千川 5xx / 网络错误 → 指数退避重试 3 次
- token 刷新失败 → `recordError` 写库 + 抛错，UI 端可以从 `QianchuanToken.lastError` 看到诊断信息
- 用户无 advertiser_id → skill 返回 `no_advertiser_id_for_user` 错误，提示用户去设置页绑定

### 5. 安全 & 配置

- `appSecret` 不返回前端（API route 过滤字段）
- `accessToken` / `refreshToken` 仅服务端持有，不暴露
- 首次部署：管理员通过 SQL 或管理后台填入 `appId` + `appSecret` + 初始 `authorizationCode`（用于一次性换取 token）
- **OAuth 首次授权**（拿 authorization_code）：不在本方案范围内，需要人工在千川开放平台完成；之后 token 自动刷新

### 6. 字段映射参考

实施时直接读 `D:\python project\qianchuan_api\services\api_service.py`：
- `get_uni_promotion_account_data` — line 312 起（**直接对应 qianchuanAccountSkill**）
- `get_uni_promotion_live_data` — line 896 起（dimensions/metrics/filters 完整定义）
- `get_uni_promotion_author_data` — line 1836 起
- 字段定义（`fields` JSON 数组）是千川 API 必传，否则只返回空数据

## 五、测试清单

- **AC-1** 数据库迁移：跑 `npm run db:push` 后，SQLite 里出现 `QianchuanToken` 表，`User` 表有 `advertiserId` 列
- **AC-2** 管理员通过设置页填入 `appId=1848382042072555` / `appSecret=xxx` / `advertiserId=1757724572785671` / 初始 `accessToken` / `refreshToken` / 过期时间
- **AC-3** 后台手动把 `accessTokenExpireAt` 改为 1 分钟前 → 浏览器发问 → 千川 token 自动刷新成功，新 token 落库
- **AC-4** 新会话发："26 年 6 月抖音鱼子酱成交金额和消耗概况" → SSE 流返回 `qianchuanAccountData` 技能被调用，advertiserId 自动从 user 注入
- **AC-5** 返回数据格式化：内容是"【巨量千川账户数据】\n- 整体消耗：¥xxx\n- 整体支付 GMV：¥xxx\n- ..." 形式
- **AC-6** 5 分钟内重复问同一问题，`lib/qianchuan/cache.ts` 命中，Python 千川端无调用（可通过 access log 验证）
- **AC-7** 故意改 `accessToken` 为无效值 → 自动 refresh 路径触发 → 千川端用 refresh_token 换新 access_token → 业务请求成功
- **AC-8** 不绑定 advertiserId 的用户问问题 → skill 返回 `no_advertiser_id_for_user` 错误，UI 提示"请先在设置页绑定千川账号"
- **AC-9** `useQianchuan=false` 时问问题 → system prompt 第 6 条规则被屏蔽，LLM 不调用 qianchuan 技能

## 六、实施顺序

| 顺序 | 阶段 | 工时 | 阻塞 |
|---|---|---|---|
| 1 | 阶段 1：Schema + token-store | 0.5 天 | 无 |
| 2 | 阶段 2：token-refresh + client + cache + format | 0.5 天 | 阶段 1 |
| 3 | 阶段 3：3 个 skill + system prompt | 0.5 天 | 阶段 2 |
| 4 | 阶段 4：UI 配置 + 绑定 | 0.5 天（可选） | 阶段 3 |

总计 **1.5 ~ 2 天**即可跑通"实时数据 + AI 分析"的核心闭环。

## 七、可扩展方向（不在本次范围）

- **多账号切换**：管理员可给同一部门绑定多个 advertiser_id，LLM 询问"看哪个账号的"
- **写入方向**：把 AI 分析结果写回 SQLite，作为日报/周报归档
- **趋势分析**：实时数据 + 知识库历史数据 → 同比/环比/异常点检测
- **定时任务**：每日 8 点自动查昨日数据并缓存到 SQLite（避免每次都打千川）
- **Redis 缓存**：多实例部署时把 `TtlCache` 换成 Redis

## 八、相关文件位置

| 类型 | 路径 |
|---|---|
| 千川 API 项目（**仅参考**） | `D:\python project\qianchuan_api` |
| 千川主入口 | `D:\python project\qianchuan_api\run_api.py` |
| 千川服务层（字段映射） | `D:\python project\qianchuan_api\services\api_service.py` |
| Web 项目 | `E:\files-mentioned-by-the-user-web` |
| skills 注册 | `lib/skills/registry.ts` |
| skill 协议 | `lib/skills/types.ts` |
| LLM 调度 | `lib/chat-runner.ts` |
| 现有检索 | `lib/knowledge-retrieval.ts` |
| **新增** token 存储 | `lib/qianchuan/token-store.ts` |
| **新增** token 刷新 | `lib/qianchuan/token-refresh.ts` |
| **新增** HTTP 客户端 | `lib/qianchuan/oceanengine-client.ts` |
| **新增** TTL 缓存 | `lib/qianchuan/cache.ts` |
| **新增** 格式化 | `lib/qianchuan/format.ts` |
| **新增** account skill | `lib/skills/qianchuan-account.ts` |
| **新增** live skill | `lib/skills/qianchuan-live.ts` |
| **新增** author skill | `lib/skills/qianchuan-author.ts` |
| **新增** 设置路由 | `app/api/settings/qianchuan/route.ts` |
| **修改** Prisma schema | `prisma/schema.prisma` |
| **修改** Prisma init | `prisma/init.mjs` |
