# 千川 (Qianchuan) 接入链路改动汇总

> 本文档汇总从「千川方案选型」到「导入流程闭环」的整条链路设计与迭代过程，作为后续维护与新成员上手的索引。
> 范围：所有 `lib/qianchuan/`、`lib/skills/qianchuan-*.ts`、`app/api/settings/qianchuan/`、`scripts/qianchuan_excel.py`、`lib/chat-runner.ts` 中 QIANCHUAN_RULE 相关改动。

---

## 0. TL;DR

| 阶段 | 关键决策 | 落点 |
|---|---|---|
| 方案选型 | **方案 B**：Next.js 直连 OceanEngine，本地 SQLite 存 access_token/refresh_token，不走中转服务 | `lib/qianchuan/auth.ts`、`lib/qianchuan/token-refresh.ts` |
| 技能层 | 4 个技能最终收敛为 **2 个**（account + material）；`live` / `author` 已弃用 | `lib/skills/registry.ts`、`lib/skills/qianchuan-account.ts`、`lib/skills/qianchuan-material.ts` |
| 抖音号映射 | 用户输入抖音号**名称**时，从 `QianchuanAnchor` 表模糊匹配到 `anchorId`；未命中走 KB 兜底 | `lib/qianchuan/anchor-resolver.ts`、`lib/chat-runner.ts:84-86` |
| 名册导入 | **两步流程**：先预览（diff: add/update/delete）→ 用户确认 → 后端落库；仅超级管理员可操作；scoped delete（只删 xlsx 触及的广告主范围） | `app/api/settings/qianchuan/import/{preview,apply}/`、`scripts/qianchuan_excel.py` |
| 系统提示 | 6 条路由规则 + 1 条「unknown_anchor_name 兜底」规则，引导模型在名字解析失败时先 KB 搜索再告知用户 | `lib/chat-runner.ts:69-86` |
| 上下文瘦身 | 3 层摘要（总览/Top N/按日）+ 1 个下钻 skill，Round 1 从 ~30K 字压到 ~5K 字 | `lib/chat-runner.ts`、`lib/qianchuan/format.ts:formatMaterialSummary` |
| **数据快照** | **DB 优先 + 实时尾巴**：历史 2025 数据 + 2026 增量沉淀到本地 MySQL `QianchuanDailySnapshot`，实时 API 只补最近 2 天 | `lib/qianchuan/snapshot-{store,sync,helpers}.ts`、`scripts/{import-2025-history,qianchuan-backfill,qianchuan-daily-sync}.ts` |

---

## 1. 方案选型

### 候选方案
- **方案 A**：中间层服务（独立 Python/Node 服务转发千川请求，token 集中管理）
- **方案 B**：Next.js 直连 OceanEngine + 本地 SQLite 存 token

### 选择 B 的原因
- 单体项目规模，单独起一个服务会增加部署/调试成本
- token 数量少（广告主级别，几个到几十个），不构成"集中管理"价值
- Next.js Route Handler 已经能完成 HTTP 转发 + 鉴权刷新
- token 存 SQLite 可与 Prisma 共用同一套迁移与备份链路

### 关键文件
- `lib/qianchuan/oceanengine-client.ts`：统一的 OceanEngine HTTP 调用层（签名、错误归一、access_token 自动刷新）
- `lib/qianchuan/auth.ts`：OAuth 授权跳转 + 回调处理
- `lib/qianchuan/token-refresh.ts`：access_token 临近过期时用 refresh_token 续期
- `lib/qianchuan/cache.ts`：内存级 token 缓存，减少 Prisma 读次数

---

## 2. 技能（Skill）层

### 最终保留的 3 个技能

#### 2.1 `qianchuanAccountData`
- **数据主题**：`SITE_PROMOTION_POST_DATA_ACCOUNT`（直播全域推广-账户）
- **维度**：`stat_time_day`（按日聚合）
- **指标**：消耗、支付 GMV、订单数、ROI2、券金额、平台补贴、展现/点击量等
- **典型问题**：「6 月整体消耗」「账户汇总」「某月概况」

#### 2.2 `qianchuanMaterialData`
- **数据主题**：`SITE_PROMOTION_POST_DATA_VIDEO`（直播全域推广-素材-视频）
- **维度**：`stat_time_day` + `material_id` + 视频名 + 视频类型
- **指标**：消耗、支付 GMV、订单数、ROI2、券金额、平台补贴、展示/点击次数、千次展现/点击单价
- **必传**：`anchorId`（抖音号 ID 或名称）
- **可选**：`smartBidType`（0=控成本投放，7=放量投放，默认 0）、`topN`（Top 素材数量，默认 30，范围 1-200）、`includeIndex`（是否追加素材 ID 索引，默认 true）
- **输出格式**：3 层摘要（见 §11），单次返回 ~5K 字，不会爆 LLM context
- **典型问题**：「某抖音号 X 月素材消耗」「哪个素材跑得最好」「素材 ROI 对比」
- **下钻**：用户追问「Top X 素材的逐日明细」「某素材 6/3 的 ROI」时，改调 `qianchuanMaterialDetail(materialId, ...)`，`materialId` 取本工具返回的【素材 ID 索引】

### 已弃用的技能

| 技能 | 文件 | 弃用原因 |
|---|---|---|
| `qianchuanLiveData` | ~~`lib/skills/qianchuan-live.ts`~~ | 抖音号汇总数据已由 `material` 接口覆盖（material 包含抖音号维度），功能重复 |
| `qianchuanAuthorData` | ~~`lib/skills/qianchuan-author.ts`~~ | 同上，且本意是名称→ID 映射的前置查询，**改用 `QianchuanAnchor` 映射表方案更合理** |

> **教训**：早期为了"每个 API 端点对应一个技能"做了一对一映射，忽略了端点之间的数据维度重叠。最终的判断标准是**用户问题问的是什么维度**，而不是**调用了哪个端点**。

---

## 3. 抖音号名称解析

### 核心数据结构

```prisma
model QianchuanAnchor {
  id          String   @id @default(cuid())
  advertiserId String
  anchorId    String   // 19 位抖音号 ID
  anchorName  String   // 抖音号名称（如「弹动官方旗舰店」）
  nickname    String?
  lastSeenAt  DateTime
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([advertiserId, anchorId])
}
```

### 解析流程（`lib/qianchuan/anchor-resolver.ts`）

```
输入: anchorId 参数（用户传的字符串）
  │
  ├─ 空 → { ok: false, reason: "empty" }
  │
  ├─ 是 19 位长串数字（len 8-24）→ 视为 anchor_id
  │     ├─ 映射表里有 → 返回 { ok, anchorId, anchorName }
  │     └─ 映射表里没有 → 仍返回 ok，anchorName 留空（让接口裸跑；失败由 OceanEngine 报错）
  │
  ├─ 否则视为名称 → 精确匹配
  │     ├─ 命中一条 → 返回
  │     └─ 未命中 → 模糊匹配（contains）
  │           ├─ 命中一条 → 返回
  │           ├─ 命中多条 → { ok: false, reason: "ambiguous", candidates }
  │           └─ 一条都没有 → { ok: false, reason: "not_found" }
```

> **范围约束**：只查 `ctx.user.advertiserId` 下的映射，**不做跨广告主兜底**——当前账户已绑定到具体广告主，不应让其他广告主的抖音号"混进来"。

### 失败后的系统提示兜底（`lib/chat-runner.ts:84-86`）

```text
7. 【千川技能报错后的兜底】如果千川技能返回错误且错误码以 `unknown_anchor_name:` 开头：
   - 第一步：先调用 searchKnowledgeBase，用抖音号名称作为 query 关键词搜索知识库
   - 第二步：在最终答案里向用户说明：①该抖音号当前未在「抖音号名册」中；
     ②本次回答来自知识库历史资料，可能非最新；
     ③要让用户直接提供 19 位 anchor_id（数字长串）以走实时接口；
     ④管理员可通过「设置 → 千川 → 抖音号名册导入」Excel 批量预填该映射。
```

### 失败后的系统提示兜底（`lib/chat-runner.ts:84-91`）

```text
7. 【anchorId 解析策略 —— 调千川技能前自行判断】
   - 如果用户用的是 19 位 anchor_id（纯数字长串）：直接调用千川技能，anchorId 原样传入。
   - 如果用户用的是抖音号名称：原样传给千川技能，系统在「抖音号名册」自动匹配。
     - 匹配到 → 正常返回
     - 匹配不到 → 技能返回 unknown_anchor_name: ... 错误，此时：
       a) 先调用 searchKnowledgeBase，用名称当 query 关键词搜知识库，基于历史资料回答
       b) 在最终答案里向用户说明四件事（见下方）
   - 不要在调千川技能前自行编造 anchorId；不要用名称做模糊匹配后私自拼 ID。
```

**用户需要被告知的四件事**：
1. 该抖音号当前未在「抖音号名册」中，无法走实时千川 API
2. 本次回答来自知识库历史资料，可能非最新
3. 要让用户直接提供 19 位 anchor_id（数字长串）以走实时接口
4. 管理员可通过「设置 → 千川 → 抖音号名册导入」Excel 批量预填该映射

> 设计意图：把"用什么 ID"这件事的决定权交给模型，**不要**在千川技能里硬猜。模型根据用户输入形态（19 位数字 vs 文字名称）走两条路：纯 ID 直调；名称先让系统映射，失败时回退 KB + 告知限制。

---

## 4. 路由规则（`lib/chat-runner.ts:69-86`）

按优先级判断，**命中后只调该技能，不要并调其他千川技能**：

| 规则 | 触发条件 | 调用的技能 |
|---|---|---|
| a | 问句包含「**素材**」二字 | `qianchuanMaterialData`（必传 anchorId） |
| b | 不含「素材」+ 明确指向某个具体抖音号（名称或 19 位 ID） | `qianchuanMaterialData`（live 接口已弃用，material 是唯一按抖音号聚合的接口） |
| c | 不含「素材」+ 不指向具体抖音号 + 整体/账户汇总 | `qianchuanAccountData` |
| d | 多个子问句分别命中不同维度 | 分别调用对应技能 |

**硬约束**：
- 提到「素材」时**禁止**调用 `qianchuanAccountData`（account 是账户总览不含素材维度）
- 涉及具体抖音号的非素材问题也走 `qianchuanMaterialData`
- `anchorId` 接受名称或 19 位 ID
- `advertiserId` 由系统从当前用户自动注入，**不要**在 query 里重复传
- `startDate` / `endDate` 从时间词推断（"26 年 6 月" → "2026-06-01 00:00:00" ~ "2026-06-30 23:59:59"）
- 提到"鱼子酱"等具体品牌/品类直播带货时，**必须**传 `marketingGoal="LIVE_PROM_GOODS"`
- `smartBidType`：用户说"控成本"→ 0，"放量"→ 7，不确定 → 0
- 用户明确问"历史/上月/去年"快照可退一步用 `searchKnowledgeBase`；否则一律走实时

> **历史 bug**：早期模型在收到「查询并分析弹动官方旗舰店的 26 年 6 月素材消耗情况」时，会**同时**调 account / material / live / author 4 个技能。原因：模型把"按抖音号聚合"和"按素材聚合"理解成两个独立问题。修复方式：在 `QIANCHUAN_RULE` 里加"命中后只调该技能，不要并调"硬约束 + 在 `app/api/chat/route.ts` 把工具过滤收紧到 `["qianchuanAccountData"]`（再由模型按规则决定是否调 material）。

---

## 5. 名册导入（两步流程）

### 5.1 旧流程（一键覆盖）的问题

- 第一次导入后发现"应该是增量更新而不是覆盖"，但代码已经是覆盖逻辑
- 缺少预览，用户无法看到"将要新增/更新/删除哪些行"就要点确认
- 权限边界不清：哪个角色能导入？

### 5.2 新流程

```
┌─────────────────────────────────────────────────────┐
│  1. 上传 xlsx                                        │
│     POST /api/settings/qianchuan/import/preview       │
│     → spawn python scripts/qianchuan_excel.py preview│
│     → 返回 { anchorDiff:{add,update,delete},         │
│              advertiserDiff:{add,update,delete},     │
│              errors: [] }                            │
└─────────────────────────────────────────────────────┘
                       │
                       ▼ 用户查看 diff Modal
                       │
┌─────────────────────────────────────────────────────┐
│  2. 确认覆盖                                         │
│     POST /api/settings/qianchuan/import/apply         │
│     → spawn python scripts/qianchuan_excel.py apply  │
│     → 执行 add/update/delete 后返回 { ok, summary }  │
└─────────────────────────────────────────────────────┘
```

### 5.3 关键设计

#### Scoped delete（最重要的安全约束）
- 解析 xlsx → 得到该 xlsx 涉及的 `advertiserId` 集合 S
- delete 阶段**只删** `QianchuanAnchor` / `QianchuanAdvertiser` 里 `advertiserId ∈ S` 的行
- 目的：避免"导入一个广告主的 Excel 把所有其他广告主的映射都删了"
- 实际验证：导入 1757 涉及的 xlsx 后，1859 的 7 条数据完全不受影响

#### 权限
- `requireSuperAdmin()` 包裹两个路由
- 当前 `requireSuperAdmin` 是 `requireAdmin` 的 alias（待后续细分角色时再拆分）

#### Excel 编码修复
- Windows Python 默认 stdout 是 GBK，前端拿到的是乱码
- 修复：spawn 时强制 `env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" }`
- 响应头加 `Content-Type: application/json; charset=utf-8`

#### antd `rowKey` 警告修复
- 旧代码：`rowKey={(r, i) => \`a-${i}\`}` 触发了 deprecation warning
- 修复：用数据本身的稳定字段拼 key
  ```ts
  function rowKeyOf(r: QianchuanDiffRow): string {
    return r.anchorId
      ? `${r.advertiserId}::${r.anchorId}`
      : `${r.advertiserId}::${r.tokenAppId ?? ""}`;
  }
  ```

### 5.4 关键文件

- `app/api/settings/qianchuan/import/preview/route.ts`：上传 + diff
- `app/api/settings/qianchuan/import/apply/route.ts`：确认 + 落库
- `app/api/settings/qianchuan/template/route.ts`：下载模板（管理员可下载，导入时使用）
- `app/api/settings/qianchuan/export/route.ts`：导出当前数据库内容
- `scripts/qianchuan_excel.py`：核心解析 + diff 逻辑（subcommand: `preview` / `apply`）
- `components/Dashboard.tsx`：两步 Modal UI（`DiffSection` 组件用 antd Table 展示 add/update/delete 三段）

---

## 6. 数据流总览

```
用户问题（自然语言）
   │
   ▼
ChatProjectsView（前端）
   │
   │ POST /api/chat { message, history, useQianchuan, ... }
   ▼
app/api/chat/route.ts
   │
   │ 构造 IThinkClient（textWireApi, textModel, ...）
   │ 用 buildSkillSystemPrompt(useQianchuan) 拼 system prompt
   │ 注入工具（BUILTIN: searchKnowledgeBase / getAssetDetail / qianchuanAccountData / qianchuanMaterialData）
   ▼
lib/chat-runner.ts ──→ QIANCHUAN_RULE 路由决策
   │
   │ 模型返回 tool_calls
   ▼
lib/skills/registry.ts ──→ 查找 skill
   │
   ├─ qianchuanAccountData
   │     │
   │     ▼ lib/skills/qianchuan-account.ts
   │           │
   │           ▼ getTokenByAdvertiser() ──→ Prisma → QianchuanToken
   │           │
   │           ▼ callOceanEngine() ──→ HTTP → OceanEngine
   │           │
   │           ▼ formatAccountData() → 格式化表格
   │
   └─ qianchuanMaterialData
         │
         ▼ lib/skills/qianchuan-material.ts
               │
               ▼ resolveAnchor(advertiserId, input) ──→ QianchuanAnchor 映射表
               │     ├─ 命中 → 拿 anchorId
               │     └─ 未命中 → 返回 unknown_anchor_name
               │              │
               │              ▼ 系统提示规则 #7：模型先 KB 搜索再告知用户
               │
               ▼ callOceanEngine(SITE_PROMOTION_POST_DATA_VIDEO)
               │
               ▼ formatMaterialData() → 格式化表格
```

---

## 7. 待办 / 后续

| 编号 | 状态 | 描述 |
|---|---|---|
| #107 | ✅ done | 系统提示：名字解析失败时引导 KB 搜索 + 提示 19 位 ID |
| #108 | ✅ done | 撤回跨广告主 fallback 代码（按用户反馈 "当前账户已绑定广告主，不存在跨账户兜底"） |
| #109 | ⏳ pending | 端到端验证名字解析失败兜底：上传新名字的 xlsx → 用户用名称问 → 走 KB 搜索路径 → 验证 SSE 流中"过程日志"是否清晰展示 fallback 步骤 |
| future | – | `requireSuperAdmin` 拆分为独立角色（目前是 `requireAdmin` 的 alias） |
| future | – | 名册导入支持 dry-run 模式（不下库仅校验） |
| future | – | `qianchuanAccountData` 增加「按抖音号汇总」维度（目前是 account 维度聚合，跨多个抖音号时无法直接看哪个抖音号花得多） |

---

## 8. 改动文件索引

### 新增
- `lib/qianchuan/anchor-resolver.ts`
- `lib/qianchuan/format.ts`
- `lib/qianchuan/oceanengine-client.ts`
- `lib/qianchuan/token-refresh.ts`
- `lib/qianchuan/token-store.ts`
- `lib/qianchuan/auth.ts`
- `lib/qianchuan/cache.ts`
- `lib/skills/qianchuan-account.ts`
- `lib/skills/qianchuan-material.ts`
- `lib/skills/qianchuan-material-detail.ts`
- ~~`lib/skills/qianchuan-live.ts`~~（已弃用但未删除文件）
- ~~`lib/skills/qianchuan-author.ts`~~（已删除）
- `app/api/settings/qianchuan/route.ts`
- `app/api/settings/qianchuan/import/preview/route.ts`
- `app/api/settings/qianchuan/import/apply/route.ts`
- `app/api/settings/qianchuan/template/route.ts`
- `app/api/settings/qianchuan/export/route.ts`
- `scripts/qianchuan_excel.py`

### 修改
- `lib/chat-runner.ts`：新增 `QIANCHUAN_RULE`（69-86 行，6+1 条规则）
- `lib/skills/registry.ts`：`BUILTIN` 收敛为 5 个（searchKnowledgeBase / getAssetDetail / qianchuanAccountData / qianchuanMaterialData / qianchuanMaterialDetail）
- `app/api/chat/route.ts`：工具过滤收紧
- `lib/auth.ts`：新增 `requireSuperAdmin`（当前为 `requireAdmin` alias）
- `components/Dashboard.tsx`：新增两步导入 Modal + `DiffSection` 组件
- `prisma/schema.prisma` / `prisma/init.mjs`：新增 `QianchuanToken` / `QianchuanAdvertiser` / `QianchuanAnchor` 表

### 相关文档
- `docs/千川API实时数据接入方案.md`：原始方案设计
- `docs/技能管理实施方案.md`：技能系统整体设计
- `docs/user-advertiser-binding-改动汇总.md`：多广告主绑定（UserAdvertiserBinding）方案与实施步骤

---

## 9. 千川 Skill 失败的兜底机制（多轮 fallback）

### 9.1 问题
千川 skill 返回失败时（`unknown_anchor_name`、`40000` 下游依赖、频率超限等），原版 Round 2 是无工具直接生成答案，模型容易把 error 字符串原样回吐、漏走 KB 兜底、`<think>` 块格式也常常被破坏。

### 9.2 修复（`lib/chat-runner.ts`）

| 改动 | 说明 |
|---|---|
| `QIANCHUAN_FALLBACK_INSTRUCTION` | 拼到 `ANSWER_SYSTEM_PROMPT`，明示"千川失败时答案必须用 `## ⚠️ 千川实时数据接口暂时无法获取` 二级标题开头 + 失败原因 + KB 兜底结果 + 下一步建议"四段式 |
| Round 1.5 自动 KB 兜底 | 检测 `toolResults` 中有 `qianchuan*` 失败时，自动发起第三轮 LLM 调用，system prompt 仍是 `buildSkillSystemPrompt(useQianchuan)`（带工具），user message 追加"立即调用 searchKnowledgeBase"。KB 结果合并到 `skillContext` |
| THINKING_INSTRUCTION 加强 | 增加"严禁跳过 <think> 块直接写答案""严禁把 error 字符串直接抄给用户""严禁说『让我尝试/让我先看看/我需要/从搜索结果中』" |

### 9.3 仍存在的问题
- **DeepSeek 上下文超限**：弹动官方旗舰店 6 月素材返回 47993 行，Round 1 tool_result 文本已经接近 1M tokens → Round 2 拼 messages 时超限 400。需要在 `formatMaterialData` 中对素材结果做截断或聚合（按素材类型/日期聚合，只保留 Top N）。
- **DeepSeek 余额**：开发环境 API key 余额不足 402（HTTP 402 Insufficient Balance）；生产环境需要监控 token 余额。

### 9.4 用户问题的"事实校对"
用户原始 prompt：「千川 API **再次** 返回**频率超限**错误。这已经是连续第四次了。」
- 实际只发生 1 次失败：错误码 `40000 下游依赖服务相关错误`，**不是频率超限**（频率超限码通常是 40100/40300/429）。
- 第二次重试（短时间窗口）就成功了——不存在"连续四次"。
- 用户描述与 SSE 全量日志不符，但用户对 AI 思考过程的担忧是合理的（暴露内部思考、漏走 KB 兜底），本次修复正是针对这两个问题。

---

## 10. 日期归属规则修正（QIANCHUAN_RULE #8）

### 10.1 问题
用户提问「查询并分析弹动官方旗舰店的 **26 年 6 月 1 号** 素材消耗情况」时，AI 思考过程出现错误：
- 把"6 月 1 号"理解为素材名称前缀「0601」（即素材创建/上传日期），尝试"筛选掉非 0601 开头的素材"；
- 实际上千川实时接口的 `stat_time_day` 字段才是"投放消耗日期"，且 API 已经按 `startDate/endDate` 做了日期范围过滤——返回的每一行 `stat_time_day` 都属于用户指定日期范围，**不需要二次过滤**；
- AI 错误地按素材名称前缀再过滤一遍，导致返回结果为空或错配。

### 10.2 修复（`lib/chat-runner.ts`）

新增 `QIANCHUAN_RULE` 第 8 条：

```
8. 【日期筛选 —— 严禁用素材名称做日期过滤】
   - 用户问「X 月 X 日素材消耗」里的「X 月 X 日」永远是 stat_time_day 字段（投放消耗日期 / 数据发生日期），
     不是素材创建/上传日期、不是素材名称前缀、不是任何其他字段。
   - 千川实时接口的 API 已经按 startDate / endDate 做了日期范围筛选，返回的每一行 stat_time_day 都属于该日期范围。
     直接使用全部返回行即可，不要二次过滤。
   - 严禁根据素材名称中是否包含「0601」「0602」等数字前缀来「再过滤」一遍。
   - 严禁根据 material_id、material_name 等任何非 stat_time_day 字段做日期归属判断。
   - 时间词解析规则：
     「26 年 6 月」 → startDate="2026-06-01 00:00:00"，endDate="2026-06-30 23:59:59"
     「6 月 1 号」/「26 年 6 月 1 日」/「6 月 1 日」 → 单日 startDate="2026-06-01 00:00:00"，endDate="2026-06-01 23:59:59"
     「最近 7 天」 → 当前日期前推 7 天（含当天）
```

`THINKING_INSTRUCTION` 同步加固：
- 在 <think> 块说明里追加「日期归属判断、字段归属判断、过滤逻辑必须 100% 正确——『26 年 6 月 1 号』= stat_time_day=2026-06-01，绝不是素材名称前缀」。
- 增加【严禁】：「根据素材名称、material_id 等任何非 stat_time_day 字段做日期归属判断——日期归属只能看 stat_time_day」。

### 10.3 为什么这是 prompt 层的问题而不是 skill 层的问题
`qianchuanMaterialData` 技能本身实现是对的：
- `start_time` / `end_time` 作为参数传给 `callOceanEngine(...)`，API 服务端按这个范围过滤返回行；
- 每条返回的 row 在 `dimensions.stat_time_day` 里带具体的投放日期；
- `formatMaterialData` 按 `material_id` 或 `stat_time_day`（`groupBy` 参数）聚合。

也就是说 **API 已经做完了正确的日期筛选**。模型在 Round 2 收到 `tool_result` 后不应该再做任何日期过滤——但模型在思考中仍然会"自作聪明"地尝试按素材名称前缀再过滤一遍，所以必须在 prompt 里硬性禁止。

### 10.4 验证（待）
- 复测问题：「查询并分析弹动官方旗舰店的 26 年 6 月 1 号素材消耗情况」 → AI 直接使用 API 返回的全部行，按 `stat_cost_for_roi2` 倒序展示 Top N，不再按素材名称"0601"前缀过滤
- 复测问题：「查询并分析弹动个人护理旗舰店的 26 年 6 月 1 号素材消耗情况」 → 同上
- `<think>` 块严格闭合，思考过程不外泄到用户答案区

---

## 11. 上下文超限修复：3 层摘要 + 下钻 Skill

### 11.1 问题

6/1-6/15 「弹动官方旗舰店」素材维度查询 → API 返回 47,993 行（≈ 5,352 个素材 × 15 天 × 4 个素材类型），`formatMaterialData` 拼出的 tool_result 文本接近 80 万字符 → Round 2 拼 messages 时直接超 LLM context 上限（400 错误）。

源头是「按 material_id 聚合后仍逐日展开 + 包含所有素材」，没有做信息密度控制。

### 11.2 方案：3 层摘要（Round 1）+ 下钻 Skill（Round 2）

`qianchuanMaterialData` 不再返回原始行，改为返回 3 层摘要，单次 ~5K 字：

```
【总览】           整体消耗 / GMV / 订单数 / ROI2 / 展现 / 点击 / eCPM / CPC
【Top N 素材】     按 stat_cost_for_roi2 倒序，Top 30 条（material_id + 视频名 + 类型 + 各指标）
【按日维度简表】   15 天 × 6 个指标（总消耗 / GMV / 订单 / ROI / 展现 / 点击）
【素材 ID 索引】   仅 Top N 的 material_id 索引（用于下钻；长尾素材不列）
```

用户追问「Top X 素材的逐日明细」「某素材 6/3 的 ROI」时，AI 在 Round 2 调 `qianchuanMaterialDetail(materialId, startDate, endDate, anchorId, smartBidType)`，单素材 × 单日 = 15 行明细 + 汇总，~1K 字。

### 11.3 关键改动

| 文件 | 变更 |
|---|---|
| `lib/qianchuan/format.ts` | 新增 `formatMaterialSummary(rows, opts)` 和 `formatMaterialDetail(rows, opts)`；旧的 `formatMaterialData` 替换为 summary 版（3 层 + 索引） |
| `lib/skills/qianchuan-material.ts` | 删 `groupBy` 参数，新增 `topN`（默认 30）和 `includeIndex`（默认 true）；调用 `formatMaterialSummary` |
| `lib/skills/qianchuan-material-detail.ts` | **新增 skill** `qianchuanMaterialDetail`，必传 `materialId` + `startDate` + `endDate` + `anchorId` + `smartBidType` |
| `lib/skills/registry.ts` | `BUILTIN` 增 `qianchuanMaterialDetail` |
| `lib/chat-runner.ts` | `QIANCHUAN_RULE` 增第 9 条「素材下钻」规则，明确下钻触发场景 + materialId / anchorId 取值来源（不重述） |

### 11.4 `qianchuanMaterialDetail` 设计要点

- **维度必须包含 `roi2_material_video_type`**：早期漏掉这个维度，OceanEngine 返回 40000 `未传入必填的维度(roi2_material_video_type)`
- **`materialId` 取自上一轮 `qianchuanMaterialData` 返回的【素材 ID 索引】**，不要让用户重述 19 位长串
- **`anchorId` 沿用上一轮调用值**（同一抖音号），不重述
- **长尾素材**（不在 Top 30 索引里、消耗 < Top 30 的素材）→ 告知用户「该素材未在 Top 30 列表中，无法定位到 material_id，请提供 19 位 ID 或调小日期范围重查」，**不编造 ID**
- **追问日期/总览类问题不需要再调工具**（如「6/5 总消耗」「Top 5 排序」「整体 ROI」），直接从 Round 1 的【按日维度】/【Top 30】/【总览】读出

### 11.5 验证

| 测试用例 | 预期 | 实测 |
|---|---|---|
| 弹动官方旗舰店 6/1-6/15 素材消耗 | Round 1 tool_result 5K 字内，AI 给出总览 + Top 30 + 按日简表 | ✅ `contextCharCount: 5337` |
| 追问「Top 1 素材（小雪麻麻-包）6/1-6/15 逐日明细」 | Round 2 调 `qianchuanMaterialDetail`，~1K 字 | ✅ `contextCharCount: 1042` |
| 弹动个人护理旗舰店 同上 | 同上 | ✅ |
| `npx tsc --noEmit` | 0 错 | ✅ |

---

## 12. 数据快照（DB 优先 + 实时尾巴）

### 12.1 背景

§11 的 3 层摘要解决了**单次调用**的上下文膨胀，但用户每问一个抖音号/时段就要再调一次千川实时 API：30 天 × 1 anchor ≈ 30 次 API 调用 + 5K 字回传。**多用户共用 100 人**（部署目标）下，token 消耗 QPS 成本与 API 限流都是瓶颈。

**核心思路**：历史数据沉淀到本地 MySQL，技能调用时优先查 DB，实时 API 只补最近 2 天（T-1 / T）。T 是 OceanEngine 字段延迟的最小窗口（平台 T+0 不全，需 T-1 起）。

### 12.2 数据边界

| 时间段 | 数据源 | 写入 |
|---|---|---|
| `T-2` 及更早 | 本地 MySQL `QianchuanDailySnapshot` | 一次回填 + 每日增量 |
| `T-1` / `T-0` | OceanEngine 实时 API | 只读，不写库 |

**为何是 T-2 而不是 T-0？**：OceanEngine 数据回传有 ~24h 延迟，`stat_time_day` 取 T-0 容易漏数。

### 12.3 表结构

数据库：`mysql://root:123456@localhost:3306/oceanengine_api`（**临时仓**，Phase 2 用 Docker Compose 重做）

```sql
CREATE TABLE QianchuanDailySnapshot (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  advertiserId    VARCHAR(32) NOT NULL,
  anchorId        VARCHAR(32) NOT NULL DEFAULT '',
  anchorName      VARCHAR(255) DEFAULT '',
  materialId      VARCHAR(64) NOT NULL,            -- 抖音号汇总 = '_ACCOUNT_'
  materialName    VARCHAR(500) DEFAULT '',
  videoType       VARCHAR(64) DEFAULT '',
  statDate        VARCHAR(20) NOT NULL,             -- 'YYYY-MM-DD'
  smartBidType    VARCHAR(8) NOT NULL DEFAULT '0',  -- '0' 控成本 | '7' 放量
  cost / gmv / orderCount / roi2 / couponAmount / subsidyAmount
  / showCount / clickCount / ecpm / cpc            DECIMAL(20,4) DEFAULT 0,
  source          VARCHAR(16) NOT NULL DEFAULT 'api',  -- api | import | backfill
  syncedAt / createdAt / updatedAt                 DATETIME,
  UNIQUE KEY uq_snapshot (advertiserId, anchorId, materialId, statDate, smartBidType)
)
```

**字段命名**：snake_case（与现有 `qianchuan_uni_promotion_video_data` 表对齐），不是 camelCase——这样 SQL 查询复用现有 2025 数据无摩擦。

### 12.4 数据来源 & 同步策略

| 来源 | 触发 | 脚本 |
|---|---|---|
| **2025 已有数据**（`qianchuan_uni_promotion_video_data`，170,687 行） | 一次性导入 | `scripts/import-2025-history.ts` (`npm run db:import-qianchuan-history`) |
| **2026 首次全量**（30 天回填） | 项目首次启动 | `scripts/qianchuan-backfill.ts` (`npm run db:backfill-qianchuan`) |
| **每日增量**（T-7 ~ T-2 窗口） | 计划：cron 04:00 每日 | `scripts/qianchuan-daily-sync.ts` (`npm run db:sync-qianchuan`) |

**幂等**：所有写入走 `INSERT ... ON DUPLICATE KEY UPDATE`，重复跑不重复入库。

**API 限流**：
- 令牌桶（默认 10 QPS，`OCEANENGINE_QPS` 可调）
- 指数退避：遇 429/5xx → 1s → 2s → 4s，最多 3 次后跳过本批次不阻塞后续

### 12.5 Skill 改造

`qianchuanAccountData` / `qianchuanMaterialData` / `qianchuanMaterialDetail` 都改为 **DB 优先 + 实时尾巴**：

1. `splitDateRange(startDate, endDate)` 把范围切成 `[dbStart, dbEnd]` + `[apiStart, apiEnd]`
2. DB 段查 `QianchuanDailySnapshot`（应用 mysql2 直连，绕过 Prisma）
3. API 段保持原 OceanEngine 调用（必传 `skipCache: true`，避免与脚本共用 5min 内存缓存）
4. 两段 concat 喂给 `formatMaterialSummary` / `formatMaterialDetail` / `formatAccountData`
5. `meta` 字段新增透明度标记（见下）

**关键文件**：
- `lib/qianchuan/snapshot-store.ts` — mysql2 直连读 API
- `lib/qianchuan/snapshot-helpers.ts` — 分段 + 降级 + 聚合
- `lib/qianchuan/rate-limiter.ts` — 令牌桶
- `lib/qianchuan/snapshot-sync.ts` — 拉取 + upsert
- `lib/skills/qianchuan-{material,material-detail,account}.ts` — 改造

### 12.6 Meta 透明度字段

每个 skill 返回的 `meta` 多带 6 个字段（前端 `finalDebug` 可直接展示）：

```ts
meta: {
  dbHit: boolean,            // 这次是否命中 DB (>=1 行)
  dbMissRange: [T-1, T-0],   // DB 没覆盖的尾巴
  dataAsOf: ISO8601,         // 调用时刻
  snapshotFreshness: '2025-12-31' | null,  // DB 最新日期
  snapshotAgeDays: number | null,
  dbRowCount: number,        // DB 返回行数
  apiRowCount: number        // API 返回行数
}
```

**降级**：DB 查询失败 → 自动回退到全 API 模式（`usedApiFallback: true`），不阻塞用户。

### 12.7 Phase 2 衔接

`QianchuanDailySnapshot` 表 schema 已在 MySQL 落地，Phase 2 主库切 MySQL 后直接 `prisma migrate` 接管即可：
- 不需重建表
- 旧 `mysql2` 直连代码可直接删
- 数据零迁移成本

详见 `docs/千川数据快照-实施计划.md`。

