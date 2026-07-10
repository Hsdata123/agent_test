# 多广告主绑定 (UserAdvertiserBinding) — 改动汇总

> 本文档记录 admin 用户从「单 advertiserId」升级到「多 binding + 当前生效」的实现方案。
> 触发问题：admin 账号绑定 `1859801208261002`，无法查询同 token 下的 `1757724572785671` 名册下的「弹动官方旗舰店」—— 因为 `User.advertiserId` 是单值字段，resolveAnchor 只在当前 advertiser 范围搜。

---

## 1. 已确认的设计决策

1. **Schema**：新增 `UserAdvertiserBinding` join 表，**保留** `User.advertiserId` 作为"影子"字段（写穿缓存），不删除。代码读 binding 表为准，shadow 仅为向后兼容。
2. **传输**：`commerce_current_advertiser` cookie + chat 请求体 `advertiserId` 覆写。优先级 Body > Cookie > Shadow。
3. **resolveAnchor 不变**：上游用 `lib/qianchuan/current.ts` 的 `resolveCurrentAdvertiser()` 解析为单个 advertiserId 后传入。原有的"不跨广告主兜底"逻辑保持。
4. **UI**：Dashboard 顶部下拉（切换当前广告主）+ 设置页新 Tab「广告主绑定」（admin 管理 user↔advertiser）。

---

## 2. 复用清单

| 复用对象 | 路径 | 用途 |
|---|---|---|
| `setSessionCookie` 模式 | `lib/auth.ts:97-104` | 镜像 `setCurrentAdvertiserCookie`：`httpOnly:true, sameSite:"lax", path:"/"`，`expires: undefined` 走 session 模式 |
| `cookies().get()` 读取 | `lib/auth.ts:24` | 单行 inline 读取，无独立 helper |
| `requireUser()` 错误形态 | `lib/auth.ts:34-40` | `throw Object.assign(new Error(msg), { status: 400\|403 })` —— 已被 `jsonError` 正确处理 |
| `scripts/backfill-asset-aliases.ts` 入口 | `scripts/backfill-asset-aliases.ts:57-65` | 一次性迁移脚本的 `main().finally().catch()` 模板 |
| `ProjectMember` 复合 unique | `prisma/schema.prisma:60-71` | 仿造 `@@unique([userId, advertiserId])` + `onDelete: Cascade` |
| Dashboard Tabs 数组 | `components/Dashboard.tsx:3270+` | 在 `api \| departments \| skills \| qianchuan` 后加 `advertiserBindings` |
| Top bar 用户区 | `components/Dashboard.tsx:290-313` | 把当前 `<Tag>` 改成 `<Dropdown>` |
| 鉴权 + body 解析顺序 | `app/api/chat/route.ts:30-31` | 先 `requireUser()` 再 `request.json()`，body 可读出后再 resolve advertiser |

---

## 3. 实施步骤（按顺序执行，每步可独立运行 typecheck）

### 3.1 `prisma/schema.prisma`
- 在 `User` 末尾添加反向关系：`advertiserBindings UserAdvertiserBinding[]`
- 新增 model：
  ```prisma
  model UserAdvertiserBinding {
    id          String   @id @default(cuid())
    userId      String
    advertiserId String
    isPrimary   Boolean  @default(false)
    createdAt   DateTime @default(now())
    user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
    @@unique([userId, advertiserId])
    @@index([userId])
    @@index([advertiserId])
  }
  ```
- `User.advertiserId` 字段保持现状（shadow）

### 3.2 `prisma/init.mjs`
- 在 `User` 表 DDL 之后插入新表的 `CREATE TABLE IF NOT EXISTS UserAdvertiserBinding` + 索引 + 外键 `ON DELETE CASCADE`
- 字段顺序、类型、index、unique 跟 schema.prisma 完全对齐
- `prisma` 项目不用 `migrate` —— 所有 schema 改动必须同步进 `init.mjs` 的 raw DDL

### 3.3 `scripts/migrate-bindings.ts`（新）
- 套用 `scripts/backfill-asset-aliases.ts:57-65` 入口模板
- 读取所有 `User.advertiserId != null` 的行
- `prisma.userAdvertiserBinding.upsert` 每条 `isPrimary: true`
- 幂等可重跑

### 3.4 `lib/qianchuan/current.ts`（新）
- `listUserAdvertisers(userId)` → `[{ advertiserId, isPrimary, createdAt }]`
- `resolveCurrentAdvertiser(user, request, bodyAdvertiserId?)`：
  1. 拉 `bindings = await listUserAdvertisers(user.id)`；空 → throw `{ status: 400, message: "no_advertiser_bound" }`
  2. 构造 `validSet = new Set(bindings.map(b => b.advertiserId))`
  3. `bodyAdvertiserId` 优先：不在 validSet → throw 403 `advertiser_not_authorized`；在 → 返回
  4. `cookies().get(CURRENT_ADVERTISER_COOKIE)?.value`：在 validSet → 返回
  5. `user.advertiserId` 兜底：在 validSet → 返回
  6. 仍无 → 取 `bindings` 第一条（按 `isPrimary desc, createdAt asc`）

### 3.5 `lib/auth.ts`
- `export const CURRENT_ADVERTISER_COOKIE = "commerce_current_advertiser"`
- `setCurrentAdvertiserCookie(response, advertiserId)` + `clearCurrentAdvertiserCookie(response)`：镜像 `setSessionCookie` (line 97-104)，`expires: undefined`
- `requireUserWithAdvertiser(request, bodyAdvertiserId?)`：先 `requireUser()`，再 `resolveCurrentAdvertiser(user, request, bodyAdvertiserId)`，返回 `{ user, activeAdvertiserId }`
- 现有 `requireUser()` / `getCurrentUser()` 不动（向后兼容）

### 3.6 `app/api/chat/route.ts`
- 第 30-31 行：把 `requireUser()` + `request.json()` 顺序调整为「先解析 body 再 `requireUserWithAdvertiser(request, body.advertiserId)`」
- 在 line 143 附近 `ctx` 构造处：`ctx: { user: { ...user, advertiserId: activeAdvertiserId } }` —— spread override
- 3 个 qianchuan 技能 (`qianchuan-account.ts:53`, `qianchuan-material.ts:70`, `qianchuan-live.ts:61`) 全部**不需要改**：它们读 `ctx.user.advertiserId`，override 后正确

### 3.7 `app/api/me/advertiser/route.ts`（新）
- `GET`：requireUser → listUserAdvertisers → `{ activeAdvertiserId, bindings }`
- `POST { advertiserId }`：校验在 binding 集合内 → `prisma.$transaction`：
  1. `userAdvertiserBinding.updateMany({ where: { userId, isPrimary: true }, data: { isPrimary: false } })`
  2. `userAdvertiserBinding.update({ where: { userId_advertiserId }, data: { isPrimary: true } })`
  3. `prisma.user.update({ where: { id: userId }, data: { advertiserId } })`（写穿 shadow）
  4. `setCurrentAdvertiserCookie(response, advertiserId)`
- `DELETE { advertiserId }`：拒绝删 primary；删后若 shadow 指向被删 binding，指到第一条剩余 binding

### 3.8 `app/api/admin/bindings/route.ts`（新）
- requireAdmin
- `GET ?userId=`：listUserAdvertisers
- `POST { userId, advertiserId, isPrimary? }`：事务中 upsert + 写穿 shadow（如果 isPrimary 或 shadow 为空）
- `DELETE { userId, advertiserId }`：同 step 3.7 的 DELETE 规则

### 3.9 `components/Dashboard.tsx`
- **Top bar (line 290-313)**：把当前 `<Tag>` 改成 `<Dropdown menu={items: bindings.map(...)}>`；点击项 → `await api("/api/me/advertiser", { method: "POST", body: { advertiserId } })` → `window.location.reload()`
- **Settings Tabs (line 3270+)**：keys 数组加 `advertiserBindings`；新增 tab panel `AdvertiserBindingsPanel`：Table 列出 users × bindings，含添加 / 设为主 / 删除按钮；admin-only
- `/api/auth/me` 返回值里塞 `activeAdvertiserId` 字段（top bar 直接展示）

### 3.10 `prisma/seed.ts`
- admin upsert 之后加：
  ```ts
  await prisma.userAdvertiserBinding.upsert({
    where: { userId_advertiserId: { userId: admin.id, advertiserId: "1859801208261002" } },
    update: { isPrimary: true },
    create: { userId: admin.id, advertiserId: "1859801208261002", isPrimary: true }
  });
  await prisma.userAdvertiserBinding.upsert({
    where: { userId_advertiserId: { userId: admin.id, advertiserId: "1757724572785671" } },
    update: {},
    create: { userId: admin.id, advertiserId: "1757724572785671", isPrimary: false }
  });
  await prisma.user.update({ where: { id: admin.id }, data: { advertiserId: "1859801208261002" } });
  ```

---

## 4. 数据流图

```
用户打开聊天页
  │
  ▼
Dashboard.tsx 调用 /api/auth/me
  │ → 返回 { user, activeAdvertiserId }
  │
  ▼
用户在 top-bar 下拉切换广告主
  │ → POST /api/me/advertiser { advertiserId }
  │ → 写事务（binding primary + user.advertiserId shadow）
  │ → setCurrentAdvertiserCookie
  │ → window.location.reload()
  │
  ▼
用户输入「查询弹动官方旗舰店 6 月素材消耗」
  │
  ▼
POST /api/chat { message, useQianchuan, advertiserId? }
  │
  ▼
requireUserWithAdvertiser(request, body.advertiserId)
  │ → resolveCurrentAdvertiser(user, request, body.advertiserId)
  │   ├─ 0 binding → 400 no_advertiser_bound
  │   ├─ body.advertiserId 不在 binding 集合 → 403 advertiser_not_authorized
  │   ├─ cookie 值在 binding 集合 → 用 cookie
  │   ├─ user.advertiserId shadow 在 binding 集合 → 用 shadow
  │   └─ 兜底取 binding 第一条
  │ → 返回 { user, activeAdvertiserId }
  │
  ▼
ctx = { user: { ...user, advertiserId: activeAdvertiserId } }
  │ → 3 个 qianchuan skill 读 ctx.user.advertiserId 拿到正确 advertiser
  │
  ▼
qianchuanMaterialData(anchorId="弹动官方旗舰店")
  │ → resolveAnchor("1757724572785671", "弹动官方旗舰店")
  │   → 命中 QianchuanAnchor → 拉到数据
```

---

## 5. 关键文件清单

| 路径 | 改动类型 |
|---|---|
| `prisma/schema.prisma` | 新增 UserAdvertiserBinding + User 反向关系 |
| `prisma/init.mjs` | 新增 UserAdvertiserBinding DDL |
| `prisma/seed.ts` | admin 两条 binding + shadow |
| `scripts/migrate-bindings.ts` | **新** — 老数据写 binding |
| `lib/qianchuan/current.ts` | **新** — resolveCurrentAdvertiser + listUserAdvertisers |
| `lib/auth.ts` | 新增 cookie 常量 + setter + requireUserWithAdvertiser |
| `app/api/chat/route.ts` | 改造 requireUser + body 解析顺序 + ctx 注入 |
| `app/api/me/advertiser/route.ts` | **新** — GET/POST/DELETE |
| `app/api/admin/bindings/route.ts` | **新** — CRUD |
| `components/Dashboard.tsx` | top-bar Dropdown + 新 Tab |
| `docs/qianchuan-改动汇总.md` | 同步添加引用本文档的链接 |

---

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `prisma` 没装 `migrate`（用 `init.mjs` 手写 DDL） | 必须在 `init.mjs` 同步加新表 DDL，且 `npm run seed` 触发 `seed.ts` 时 `prisma.userAdvertiserBinding.upsert` 才能正常工作 |
| 写穿 shadow 漏写一处导致不一致 | 所有写 binding 的路径都走 `prisma.$transaction`，shadow update 跟 binding update 在同一事务 |
| 切换后 SSE 流不刷新 | 客户端切换后 `window.location.reload()`（不是 SPA navigate），让 React tree 重建 |
| Cookie 被篡改 | `resolveCurrentAdvertiser` 每次拿 cookie 值都跟 DB 里的 binding set 对比，篡改值自动 fallthrough 到 shadow |
| 当前用户 0 binding | 第 3.4 步的 `resolveCurrentAdvertiser` 在空时直接 throw 400，UI 提示「请联系管理员绑定广告主」 |
| Primary 重复（多 binding 都 isPrimary=true） | `POST /api/me/advertiser` 事务中先把所有 `isPrimary: true` 改成 `false`，再把目标设成 true（`updateMany` + `update` 顺序） |
| `qianchuan-live.ts` 文件存在但 BUILTIN 不引用 | 本次不需要 import 该文件，但 3 个 qianchuan skill 的 `ctx.user.advertiserId` 读取模式统一，无需动 live 文件 |

---

## 7. 端到端验证清单

- **AC-1** `npx tsc --noEmit` 0 错
- **AC-2** `node scripts/migrate-bindings.ts` 跑完，DB 里 `UserAdvertiserBinding` 有 admin 的 2 条（1859801208261002 primary, 1757724572785671 secondary），`User.advertiserId === "1859801208261002"`
- **AC-3** 重启 dev server。用 admin 登录 → top-bar 下拉显示两个广告主
- **AC-4** 切到「弹动官方旗舰店」(1757724572785671) → cookie 设置成功，shadow 更新
- **AC-5** 发 prompt「查询弹动官方旗舰店 6 月素材消耗」 → 千川实时数据返回 200+ 素材条目
- **AC-6** 切回「弹动个人护理旗舰店」 → 「查询弹动个人护理旗舰店 6 月素材消耗」仍正常
- **AC-7** 在请求体里 `advertiserId: "1757724572785671"` 覆写 → 行为同 AC-5
- **AC-8** 把 1757724572785671 的 binding 删掉，再发同样 prompt → 403 `advertiser_not_authorized`
- **AC-9** 把所有 binding 删掉 → 发 chat → 400 `no_advertiser_bound`
- **AC-10** antd Dropdown 切换不报错，无 antd deprecation warning
- **AC-11** `User.advertiserId` shadow 在每次 binding 变更后保持 = primaryBinding.advertiserId

---

## 8. 后续可选增强（不在本次范围）

- 在 `User` 详情页直接绑定广告主（admin UI 快捷入口）
- 切换广告主时 SSE 流的"软切换"（不停流、改后续 tool_calls 上下文）—— 当前需要 reload
- 把 `User.advertiserId` 字段彻底删除（v2 移除后向兼容）
- 在 `api/auth/me` 返回值里塞 `activeAdvertiserId`，前端展示更直接
