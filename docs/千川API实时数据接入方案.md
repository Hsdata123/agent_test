# 千川 API 实时数据接入方案

> 适用项目：电商视觉与内容助手（`ai-commerce-image-mvp`）
> 配套项目：`D:\python project\qianchuan_api`（巨量千川 API 封装，Python + MySQL）
> 状态：方案稿（未实施）
> 作者产出日期：2026-06-17

## 背景

当前助手的数据源全部来自"知识库里上传的 Excel 文件"。但运营人员每天问的"鱼子酱抖音直播间成交金额和消耗"本质上就是千川账户的实时数据，**走 Excel 上传路径既延迟又繁琐**——一次性提问应该能直接拿到千川实时数据。

`qianchuan_api` 项目已经实现了完整的千川 API 调用链（OAuth2 自动刷新、14 个 action、MySQL 落库），但它只有 CLI 入口。本方案的目标是**把它包成 HTTP 服务，让 web 端通过 skill 体系调用，把"实时数据"纳入助手的分析能力**。

## 一、现状盘点

| 项目 | 已有能力 | 缺什么 |
|---|---|---|
| **qianchuan_api** (Python) | 7 域×14 action、OAuth2 自动刷新、MySQL 落库、CLI 入口 | 只有命令行，无 HTTP server；token/app_id 写在 `oauth_token_management` 单表，没按用户/部门区分 |
| **当前 web** (Next.js) | skills 体系（registry/knowledge-base/asset-detail）、两轮 LLM 调用、`SKILL_SYSTEM_PROMPT` 路由、用户/部门/场景 | 没有"实时数据"概念，所有数据走 Excel 知识库 |
| **MySQL 数据库** | `qianchuan_uni_promotion_account_data` 等表已存在（数据已存过的） | Web 端用 SQLite，没连 MySQL |

## 二、架构选型

| 方案 | 描述 | 优 | 劣 |
|---|---|---|---|
| **A. 复用 qianchuan_api** ⭐ 推荐 | 在 Python 项目里加一个 FastAPI/Flask server，暴露 REST；Next.js 用 fetch 调用 | token/MySQL 全部复用，零迁移 | 多维护一个 Python 进程 |
| B. Next.js 直连 OceanEngine | web 里直接 fetch `api.oceanengine.com`，自己管 token 持久化（存 SQLite） | 单体，无跨进程 | 要把 token 刷新/数据库设计重写一遍，重复造轮子 |
| C. 落库后 SQL 查询 | 跑 Python 脚本把数据全量落 MySQL，web 起一个 MySQL 连接读 | 历史数据快、SQL 灵活 | 实时性差（需定时跑）；web 端需连 MySQL |

**选 A 的理由**：Python 项目的 token 管理、字段映射、异常重试都成熟了，重复造不如包一层。MySQL 连接本来就跑在另一台机器，加个 HTTP 出口对运维几乎零成本。

## 三、目标架构

```
┌────────────────────────────────────────┐
│  Next.js (web)                         │
│  ┌─────────────────────────────────┐   │
│  │ SKILL_SYSTEM_PROMPT             │   │  LLM 看到新工具
│  │ + "查实时数据" → qianchuan_*    │   │
│  └─────────────────────────────────┘   │
│  ┌─────────────────────────────────┐   │
│  │ lib/skills/qianchuan-account.ts │◀──┼─── 新增技能
│  │ lib/skills/qianchuan-live.ts    │   │
│  │ lib/skills/qianchuan-author.ts  │   │
│  └─────────────────────────────────┘   │
│  ┌─────────────────────────────────┐   │
│  │ lib/qianchuan-client.ts         │◀──┼─── 新增：HTTP 客户端
│  │  - fetch http://qianchuan-api:80 │   │    + per-user app_id 映射
│  │  - 5xx 重试 / 超时 / 错误归一化 │   │
│  └─────────────────────────────────┘   │
└────────────────────────────────────────┘
                  │ HTTP/JSON
                  ▼
┌────────────────────────────────────────┐
│  qianchuan_api (Python)  ← 新增        │
│  ┌─────────────────────────────────┐   │
│  │ api_server.py (FastAPI)         │◀──┼─── 新增 HTTP 入口
│  │  /api/qianchuan/account_data    │   │    透传参数 + 调 api_service
│  │  /api/qianchuan/live_data       │   │    + 按 advertiser_id 鉴权
│  │  /api/qianchuan/author_data     │   │    + 5min 内存缓存
│  │  /healthz                       │   │
│  └─────────────────────────────────┘   │
│  ┌─────────────────────────────────┐   │
│  │ services/api_service.py（不动） │   │  已有：14 个 action
│  │ services/token_service.py（不动）│  │  已有：OAuth2 自动刷新
│  └─────────────────────────────────┘   │
└────────────────────────────────────────┘
                  │
                  ▼
        ┌──────────────────┐
        │  OceanEngine API  │
        │  + MySQL (落库)   │
        └──────────────────┘
```

## 四、落地步骤

### 阶段 1：Python 端暴露 HTTP（最小化，~150 行）

**新增 `qianchuan_api/api_server.py`**：

```python
from fastapi import FastAPI, HTTPException
from services.api_service import QIANCHUANAPIService

app = FastAPI()

# 简单内存缓存：同 (app_id, advertiser_id, start_date, end_date, action) 5 分钟内复用
_cache = {}
def cached_call(key, fn, ttl=300):
    import time
    now = time.time()
    if key in _cache and now - _cache[key]['ts'] < ttl:
        return _cache[key]['data']
    data = fn()
    _cache[key] = {'ts': now, 'data': data}
    return data

@app.get("/api/qianchuan/account_data")
def account_data(advertiser_id: int, start_date: str, end_date: str,
                 app_id: int = 1848382042072555,
                 marketing_goal: str = "LIVE_PROM_GOODS",
                 order_platform: str = "QIANCHUAN"):
    key = ("account_data", app_id, advertiser_id, start_date, end_date, marketing_goal, order_platform)
    def call():
        svc = QIANCHUANAPIService(app_id)
        return svc.get_uni_promotion_account_data(
            advertiser_id, start_date, end_date, marketing_goal, order_platform)
    result = cached_call(key, call)
    if not result.get('success'):
        raise HTTPException(502, result.get('message', 'qianchuan call failed'))
    return result['data']

# 同样模式暴露 /live_data, /author_data, /list, /ad_detail, /video_data

@app.get("/healthz")
def health(): return {"ok": True}
```

**关键设计**：

- **不动** `services/api_service.py`、`token_service.py`——`QIANCHUANAPIService` 直接复用
- **5 分钟内存缓存**：相同查询 5 分钟内复用结果，避开千川 QPS 限制
- 启动方式：`uvicorn api_server:app --host 0.0.0.0 --port 8080`
- 部署：跟 web 进程并跑，systemd / PM2 拉起

### 阶段 2：Next.js 加 qianchuan HTTP 客户端（~80 行）

**新增 `lib/qianchuan-client.ts`**：

```ts
const QIANCHUAN_API_BASE = process.env.QIANCHUAN_API_BASE || "http://localhost:8080";

export type QianchuanClientOptions = {
  advertiserId: number;
  startDate: string;  // "2026-06-01 00:00:00"
  endDate: string;
  anchorId?: string;
  awemeId?: number;
  marketingGoal?: "ALL" | "LIVE_PROM_GOODS" | "VIDEO_PROM_GOODS";
};

export async function fetchQianchuanAccountData(opts: QianchuanClientOptions) {
  const url = new URL("/api/qianchuan/account_data", QIANCHUAN_API_BASE);
  url.searchParams.set("advertiser_id", String(opts.advertiserId));
  url.searchParams.set("start_date", opts.startDate);
  url.searchParams.set("end_date", opts.endDate);
  if (opts.marketingGoal) url.searchParams.set("marketing_goal", opts.marketingGoal);

  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) throw new Error(`qianchuan api error: ${resp.status}`);
  return resp.json();
}
// 同模式实现 fetchQianchuanLiveData, fetchQianchuanAuthorData
```

**`.env.local` 加一行**：

```
QIANCHUAN_API_BASE=http://localhost:8080
```

### 阶段 3：把 3 个高频接口封装成 skill（~250 行）

**新增 3 个 skill 文件**：

- `lib/skills/qianchuan-account.ts` —— 账户维度（**直接回答"成交金额和消耗"问题**）
- `lib/skills/qianchuan-live.ts` —— 直播间画面（按抖音号+日期）
- `lib/skills/qianchuan-author.ts` —— 抖音号维度（按时段）

每个 skill 模板：

```ts
import { fetchQianchuanAccountData } from "../qianchuan-client";
import type { Skill, SkillContext } from "./types";

export const qianchuanAccountSkill: Skill = {
  definition: {
    name: "qianchuanAccountData",
    description: "查询巨量千川账户维度数据：消耗、成交 GMV、ROI、订单数等。",
    parameters: {
      type: "object",
      properties: {
        advertiserId: { type: "number", description: "广告主 ID（可选，默认取当前用户绑定）" },
        startDate: { type: "string", description: "开始时间 YYYY-MM-DD HH:MM:SS" },
        endDate: { type: "string", description: "结束时间 YYYY-MM-DD HH:MM:SS" },
        marketingGoal: { type: "string", enum: ["ALL", "LIVE_PROM_GOODS", "VIDEO_PROM_GOODS"] }
      },
      required: ["startDate", "endDate"]
    }
  },
  async execute(args, ctx: SkillContext) {
    const advertiserId = Number(args.advertiserId) || ctx.user.advertiserId;
    if (!advertiserId) {
      return { callId: "", name: "qianchuanAccountData", ok: false, content: "", error: "no_advertiser_id" };
    }
    try {
      const data = await fetchQianchuanAccountData({
        advertiserId, startDate: String(args.startDate), endDate: String(args.endDate),
        marketingGoal: args.marketingGoal as any
      });
      return {
        callId: "", name: "qianchuanAccountData", ok: true,
        content: formatAccountData(data),  // 把 stat_cost、total_pay_order_gmv_for_roi2 等格式化输出
        meta: { advertiserId, ... }
      };
    } catch (e) {
      return { callId: "", name: "qianchuanAccountData", ok: false, content: "", error: (e as Error).message };
    }
  }
};
```

**注册到 `lib/skills/registry.ts` 的 `listOpenAITools()`**。

**更新 `lib/chat-runner.ts` 的 `SKILL_SYSTEM_PROMPT`** 加规则 6：

```
6. 【实时数据】涉及千川投放数据（金额/消耗/ROI/订单/抖音号/直播间）的查询，
   优先调用 qianchuanAccountData / qianchuanLiveData / qianchuanAuthorData 这三个技能：
   - 问"X 月成交/消耗/ROI/订单概况" → qianchuanAccountData
   - 问"X 抖音号/直播间某时段数据" → qianchuanLiveData 或 qianchuanAuthorData
   - advertiserId 由系统从当前用户自动注入，query 里不需要重复
   - startDate / endDate 从问题时间词里推断（"26 年 6 月" → "2026-06-01 00:00:00" ~ "2026-06-30 23:59:59"）
```

### 阶段 4：用户↔advertiser_id 映射 + UI 开关（可选）

**`prisma/schema.prisma` 给 User 加一列**：

```prisma
model User {
  ...
  advertiserId Int?     // 绑定的巨量千川广告主 ID
  qianchuanAppId Int?   // 绑定的巨量千川 app_id（多账号场景）
}
```

**新建 `app/api/settings/qianchuan/route.ts`**：管理后台加一个"千川账号绑定"页面。

**前端 `components/Dashboard.tsx` 加一个"实时数据"开关**（与"使用知识库"并列）。`useQianchuan: boolean` 默认 `true`（运营视角下实时数据是默认能力）。

## 五、关键技术点

### 1. `advertiser_id` 自动绑定

最省事的做法：

- User 表加一列 `advertiserId`
- `requireUser()` 时把 `advertiserId` 注入 `ctx.user`
- skill 里直接 `ctx.user.advertiserId`，LLM 不需要在 query 里传

权限粒度（多账号/多部门）：

- User 表加 `qianchuanAppId`，按部门绑定不同 app_id
- SkillContext 加 `allowedAdvertiserIds`，skill 执行时校验 `advertiserId in allowedAdvertiserIds`

### 2. 数据格式优化

千川返回的是 `{stat_cost, total_pay_order_gmv_for_roi2, ...}` 平铺字典。skill 端要把它格式化成"可读文本"塞进 LLM context，例如：

```
【巨量千川账户数据】(advertiserId=1757724572785671, 2026-06-01 ~ 2026-06-30)
- 整体消耗：¥1,374,717.29
- 整体支付 GMV (含券)：¥3,251,993.74
- 整体 ROI2：2.37
- 整体支付订单数：3,892
- 整体客单价：¥835.50
```

LLM 拿到这种结构化文本，能直接套用 `THINKING_INSTRUCTION` 里的 H2 模板。

### 3. 缓存策略

- **内存缓存（5min）**：阶段 1 的 `cached_call` 解决同一查询的重复打
- **MySQL 落库**：千川数据 T+1 更新，"历史月"数据可以走 MySQL 而非实时 API
- **未来增强**：在 skill 里加 `useCached` 参数，由 LLM 决定"实时"还是"历史"

### 4. 错误处理

- 千川 token 过期 → `token_service` 自动刷，调用方无感
- 频率限制 → 5min 缓存 + 重试（指数退避 3 次）
- API 端 4xx/5xx → 走 `IThinkApiError` 同款归一化，把 status/message 透出到 SSE error 事件
- Python server 挂了 → Next.js 端 `fetchQianchuanAccountData` 抛错，skill 返回 `ok:false`，LLM 自动 fallback 到知识库（如果知识库里有上次导出的数据）

### 5. 安全 & 部署

- Python server 不对外暴露，绑 127.0.0.1 或内网
- 千川 app_secret 只在 Python 端持有，Next.js 不接触
- 千川 token 走 MySQL 持久化，进程重启不丢
- 监控：Python server 加 `/healthz`、Sentry/日志告警

## 六、测试清单

- **AC-1** Python server 起来后，`curl http://localhost:8080/healthz` 返回 `{"ok":true}`
- **AC-2** 浏览器新会话发："26 年 6 月抖音鱼子酱成交金额和消耗概况" → SSE 流返回 `qianchuanAccountData` 技能被调用，advertiserId 自动取当前用户绑定值
- **AC-3** 返回数据含 `stat_cost`、`total_pay_order_gmv_for_roi2`，被格式化进 skill result.content
- **AC-4** 5 分钟内重复问同一问题，Python 端日志显示缓存命中（无 OceanEngine 调用）
- **AC-5** 同一用户连续问 3 个不同月份数据，三次都返回正确数字，Python 端无 token 错误
- **AC-6** 千川 token 故意失效（手动改 `oauth_token_management.access_token_expire_time`），问一次后 Python 端日志显示自动刷新成功，Web 端正常返回
- **AC-7** Python server 停掉时问问题，Web 端 SSE 返回 error 事件，错误归一化展示 `status=502`

## 七、实施顺序

| 顺序 | 阶段 | 工时 | 阻塞 |
|---|---|---|---|
| 1 | 阶段 1：Python FastAPI server | 0.5 天 | 无 |
| 2 | 阶段 2：Next.js qianchuan-client | 0.5 天 | 阶段 1 起来 |
| 3 | 阶段 3：3 个 skill + system prompt | 1 天 | 阶段 2 |
| 4 | 阶段 4：用户绑定 + UI 开关 | 0.5 天（可选） | 阶段 3 |

总计 **2 ~ 2.5 天**即可跑通"实时数据 + AI 分析"的核心闭环。

## 八、可扩展方向（不在本次范围）

- **写入方向**：把 AI 分析结果写回 MySQL，作为日报/周报归档
- **多账号切换**：管理员可给同一部门绑定多个 advertiser_id，LLM 询问"看哪个账号的"
- **趋势分析**：实时数据 + 知识库历史数据 → 同比/环比/异常点检测
- **定时任务**：每日 8 点自动调 `save_uni_promotion_account_data_to_db` 落库，省去人工

## 九、相关文件位置

| 类型 | 路径 |
|---|---|
| 千川 API 项目 | `D:\python project\qianchuan_api` |
| 主入口 | `D:\python project\qianchuan_api\run_api.py` |
| 服务层 | `D:\python project\qianchuan_api\services\api_service.py` |
| Token 管理 | `D:\python project\qianchuan_api\services\token_service.py` |
| 数据模型 | `D:\python project\qianchuan_api\database\models.py` |
| Web 项目 | `E:\files-mentioned-by-the-user-web` |
| skills 注册 | `lib/skills/registry.ts` |
| skill 协议 | `lib/skills/types.ts` |
| LLM 调度 | `lib/chat-runner.ts` |
| 现有检索 | `lib/knowledge-retrieval.ts` |
