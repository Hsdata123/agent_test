# AI 电商主图 / 详情页生成管理系统

Next.js 15 + TypeScript + Ant Design + Prisma + SQLite 的电商视觉内容工作台，覆盖知识库管理、AI 对话辅助、千川实时数据接入、主图/详情页生图。

> 📚 完整文档索引见 [`docs/INDEX.md`](docs/INDEX.md)。新成员请先看 [`ONBOARDING.md`](ONBOARDING.md)。

---

## 已实现模块

### 1. 基础能力
- 账号密码登录，会话 Cookie，部门隔离，跨部门资料可见性受管理员控制
- 项目列表 / 项目创建 / 项目生图工作台
- 机制批量解析：`价格=产品*数量+产品*数量`
- 产品白底图匹配：完全同名 / 产品名 / 别名 / 模糊匹配 / 手动匹配
- 生成任务队列，调用 iThinkAPI `gpt-image-2` 生成 1:1 主图和 9:16 详情页分镜
- 生成结果本地保存、预览、单张下载、项目 ZIP 下载
- 管理员 API 配置、API 测试、用户创建和用户列表

### 2. 知识库（KB）
- 8 种 `assetType` 支持：`prompt / document / pdf / ppt / excel / product_white_image / portrait_white_image / main_template`
- 多 extractor：PDF（FlateDecode）、DOCX/PPTX/XLSX（ZIP + OOXML）、Excel 走 Python `openpyxl / xlrd 1.2.0`、图片直接落盘
- 同步解析在请求 handler 内（最大 `MAX_EXTRACTED_TEXT = 10_000_000` 字符截断）
- 关键词打分召回：`exact 100 / alias 80 / token 20 / productName 18 / preferred 50 / scene 10`
- 场景意图检测（`detectSceneIntent`）+ Top 5 排序
- 部门隔离的 `scopedKnowledgeWhere`（非 admin 仅看本部门）

### 3. AI 对话系统
- 手工路径（manual）：显式选资产 / useAll / 消息关键词触发
- 技能路径（skill）：scene 命中后由 LLM 调用 `searchKnowledgeBase` / `getAssetDetail`
- 工具调用：`qianchuanAccountData` / `qianchuanMaterialData` / `qianchuanMaterialDetail`（千川开关关掉时过滤）
- 对话偏好持久化：`useKnowledge / useQianchuan` 存到 `ChatConversation.prefsJson`，首次新建后沿用
- 刷新恢复：`processLog / finalDebug / finalAssets` 写入 `ChatMessage`，刷新页面可恢复引用与调用详情
- SSE 流式输出：`text / skill / context / intent / manual_mode / done / error / usage`

### 4. 千川（Qianchuan）实时数据
- **方案 B**：Next.js 直连 OceanEngine，本地 SQLite 存 `access_token / refresh_token`
- 单飞行 token 刷新（`token-refresh.ts` IIFE 保证并发安全）
- 名册两步导入：先 `preview` 算 diff → 用户确认 → `apply` 落库
- 历史 2025 数据 + 2026 增量沉淀到 `QianchuanDailySnapshot`，实时 API 只补最近 2 天
- 系统提示 6 条路由规则 + 1 条「unknown_anchor_name 兜底」
- 上下文瘦身 3 层摘要 + 1 个下钻 skill（Round 1 从 30K 字压到 5K 字）

### 5. 提示词缓存
- 按 `(baseUrl, model, wireApi)` 自动解析 cache profile：
  - `anthropic_ephemeral`：Anthropic 协议，`cache_control: ephemeral` 注入 system + last tools
  - `openai_responses`：OpenAI Responses API，`prompt_cache_retention / prompt_cache_key`
  - `openai_chat`：OpenAI Chat Completions，`prompt_cache_key`
- 切换 baseUrl / 模型后下次请求自动重算
- `textPromptCacheRetention=24h` 自动降级到 Anthropic 上限 `1h`
- 命中率统计 + 趋势图 + 报警 banner（`/api/settings/usage/cache-stats`）
- 管理员实时预览当前生效 profile（`<ApiConfigCachePreview>`）

---

## 本地启动

```bash
npm install
npm run db:push
npm run db:seed
npm run dev
```

打开 `http://localhost:3000`。

默认账号：

- 管理员：`admin` / `admin123`
- 示例运营：`operator` / `operator123`

## 环境变量

`.env.local` 中服务端变量：

| 变量 | 说明 |
|---|---|
| `ITHINK_API_KEY` | iThink API Key（前后端共用，前端页面不会显示） |
| `ITHINK_BASE_URL` | 文本 API base，默认 `https://api.minimaxi.com/anthropic`（Anthropic 协议） |
| `ITHINK_CHAT_MODEL` | 对话模型，默认 `MiniMax-M3` |
| `ITHINK_IMAGE_MODEL` | 生图模型，默认 `gpt-image-2` |
| `OCEANENGINE_QPS` | 千川 API 限流 QPS，默认 10 |

> 由于密钥曾出现在对话里，建议上线前到平台轮换一次。

## 数据库

```bash
npm run db:push          # 跑 prisma/init.mjs 建表 + 增量迁移
npm run db:seed          # 写入默认账号 / 部门 / 资产 / 千川测试数据
npm run typecheck        # tsc --noEmit
```

主要表：`User / Session / Department / Project / ProjectMember / KnowledgeAsset / ProductAlias / MechanismParse / MechanismItem / GenerationTask / GenerationResult / ApiConfig / ChatUsage / ChatProject / ChatConversation / ChatMessage / BusinessScene / Skill / QianchuanToken / QianchuanAdvertiser / QianchuanAnchor / QianchuanDailySnapshot / UserAdvertiserBinding`

## 测试

```bash
# 1. 生成测试样本 (一次性)
pip install fpdf2 python-docx python-pptx openpyxl "xlrd==1.2.0" xlwt Pillow
python scripts/gen_kb_fixtures.py --clean

# 2. 起 server (另一个终端)
pnpm dev

# 3. 跑端到端
bash scripts/run_kb_e2e.sh --phase all
```

完整测试方案：[`docs/knowledge-base-test-plan-2026-06-29.md`](docs/knowledge-base-test-plan-2026-06-29.md)

## 目录结构

- `app/`：Next.js 页面 + API 路由
- `components/Dashboard.tsx`：主工作台（Antd）
- `lib/`：核心库
  - `auth.ts` 认证
  - `prisma.ts` Prisma 单例
  - `ithink.ts` LLM 客户端（Anthropic / OpenAI Responses / Chat Completions 三分支 + cache profile）
  - `chat-runner.ts` 技能路径编排
  - `chat-store.ts` 对话 / 项目 / 消息持久化
  - `scene-intent.ts` 场景意图检测
  - `knowledge-retrieval.ts` 关键词打分召回
  - `document-extract.ts` 多 extractor 路由
  - `excel-preview.ts` Excel 预览解析
  - `model-cache-profiles.ts` cache profile 解析
  - `qianchuan/` 千川子模块（auth / token-refresh / current / snapshot / format / rate-limiter）
  - `skills/` 技能注册（registry / user-skill / qianchuan-*）
- `prisma/schema.prisma` + `init.mjs`：SQLite schema + 增量迁移
- `scripts/`：运维 / 数据 / 测试脚本
- `storage/uploads`：知识库上传文件
- `storage/results`：生成结果图片
- `docs/`：所有架构 / 方案 / 改动 / 测试文档（详见 [`docs/INDEX.md`](docs/INDEX.md)）
- `test/fixtures/kb/`：KB 测试样本（由 `gen_kb_fixtures.py` 生成，已 git ignore）