# 文档索引

> 所有架构 / 方案 / 改动汇总 / 测试 / Bug 修复文档的统一索引。按主题分类。

---

## 0. 项目入口

| 文档 | 用途 |
|---|---|
| [`../README.md`](../README.md) | 项目总览、模块清单、启动 / 部署 / 测试命令 |
| [`../ONBOARDING.md`](../ONBOARDING.md) | 新成员上手指南（Git / 代理 / IDE / 启动顺序） |

---

## 1. 架构与方案

### 1.1 系统架构

| 文档 | 内容 |
|---|---|
| [知识库增强产品架构方案](AI电商主图_详情页生成管理系统%20-%20知识库增强产品架构方案.md) | 知识库从「文件柜」演进为「可被 AI 调用的语义资产」的整体设计 |
| [project_prompt-](project_prompt-.md) | 项目原始需求 prompt 归档 |

### 1.2 千川接入方案

| 文档 | 内容 |
|---|---|
| [千川 API 实时数据接入方案](千川API实时数据接入方案.md) | OceanEngine OAuth + 实时 API（广告主 / 素材 / 直播间 / 素材详情）的整体接入设计 |
| [千川数据快照-实施计划](千川数据快照-实施计划.md) | 历史 2025 数据 + 2026 增量快照方案（DB 优先 + 实时尾巴） |

### 1.3 技能 / 检索方案

| 文档 | 内容 |
|---|---|
| [技能管理实施方案](技能管理实施方案.md) | skills 注册表、`executeMode = search_kb \| get_detail \| no_op`、prompt 注入策略 |
| [skills-改动汇总](skills-改动汇总.md) | **本次新增**：skills v1→v2 演进——AI 对话创建 + `exec_function` 沙箱执行 + 创建入口收口 + 字段名/4 模式对齐 |

---

## 2. 改动汇总

| 文档 | 内容 | 日期 |
|---|---|---|
| [skills-改动汇总](skills-改动汇总.md) | **本次新增**：skills 从「Dashboard 手动表单」→「AI 对话 skillCreator」+ 新增 `exec_function` 沙箱执行 + departmentId/字段名/4 模式 3 处对齐 | 2026-07-03 |
| [千川-改动汇总](qianchuan-改动汇总.md) | 从「千川方案选型」到「导入闭环」+ 「数据快照」的整条链路改动索引 | 2026-06-27 |
| [bug-fix-2026-06-29](bug-fix-2026-06-29.md) | **本次审计修复**：8 个 bug（2 critical / 3 high / 3 medium）+ Bug 9（KB E2E 顺带抓出的 safeFileName CJK 长度截断） | 2026-06-29 |
| [minimax-m3 迁移说明](minimax-m3-迁移说明.md) | MiniMax M3 模型迁移与 cache profile 适配 | 2026-06-26 |
| [user-advertiser-binding 改动汇总](user-advertiser-binding-改动汇总.md) | 用户-广告主多绑定 + 主绑定切换的事务化重构 | 2026-06-24 |
| [知识库增强重构提示词](知识库增强重构提示词.md) | 知识库增强重构的设计 prompt 留档 | 2026-06-12 |

---

## 3. 测试

### 3.1 知识库端到端测试（**本次新增**）

| 文档 | 内容 |
|---|---|
| [knowledge-base-test-plan-2026-06-29](knowledge-base-test-plan-2026-06-29.md) | 知识库测试方案：8 种 assetType × 多尺寸 × 全链路（上传 → 解析 → 检索 → AI 应用）。8 个 AC 验收项 + 5.5 工作日排期 |
| [kb-e2e-test-report-2026-06-30](kb-e2e-test-report-2026-06-30.md) | **本次跑测报告**：29/29 全量通过 + 跑测过程发现并修复的 6 个问题（含 1 个产品 bug） |
| [`../scripts/gen_kb_fixtures.py`](../scripts/gen_kb_fixtures.py) | 测试样本生成器（18 个 fixture 文件，53MB） |
| [`../scripts/run_kb_e2e.sh`](../scripts/run_kb_e2e.sh) | 端到端编排脚本（5 阶段约 30 用例） |

### 3.2 快速运行

```bash
# 1. 装 Python 依赖 (一次性)
pip install fpdf2 python-docx python-pptx openpyxl "xlrd==1.2.0" xlwt Pillow

# 2. 生成样本 (一次性)
python scripts/gen_kb_fixtures.py --clean

# 3. 起 server (另一个终端)
pnpm dev

# 4. 跑测试
bash scripts/run_kb_e2e.sh --phase all      # 全量
bash scripts/run_kb_e2e.sh --phase upload   # 只跑上传
```

---

## 4. Bug 修复

### 4.1 最新一批（2026-06-29）

详见 [bug-fix-2026-06-29](bug-fix-2026-06-29.md)。共 8 个真实 bug 修复：

| # | 文件 | 严重 | 性质 |
|---|---|---|---|
| 1 | `app/api/chat/route.ts:343` | critical | UPDATE id 错位 |
| 2 | `lib/qianchuan/token-refresh.ts` | critical | token 刷新并发竞态 |
| 3 | `lib/qianchuan/auth.ts` | high | OAuth 字段名错（`auth_code` → `code`） |
| 4 | `app/api/chat/route.ts` | high | SSE controller 泄漏 |
| 5 | `lib/ithink.ts:streamAnthropic` | high | 流读取异常未捕获 |
| 6 | `app/api/me/advertiser/route.ts` | medium | DELETE 事务不完整 |
| 7 | `lib/qianchuan/rate-limiter.ts` | medium | 双重唤醒重复扣 token |
| 8 | `app/api/knowledge/assets/[id]/route.ts` | medium | aliases 非原子写 |
| 9 | `lib/storage.ts:safeFileName` | medium | 200 字符 CJK 文件名让 storagePath 损坏（KB E2E U-18 发现） |

修复完成后 `tsc --noEmit` 全程 0 错，并通过 re-audit 确认未引入新 critical/high bug。详见 [kb-e2e-test-report-2026-06-30](kb-e2e-test-report-2026-06-30.md) §4。

---

## 5. 按角色推荐的阅读顺序

### 5.1 新成员（入职第一周）
1. [`../ONBOARDING.md`](../ONBOARDING.md) — 拉代码、配环境
2. [`../README.md`](../README.md) — 项目全貌
3. [知识库增强产品架构方案](AI电商主图_详情页生成管理系统%20-%20知识库增强产品架构方案.md) — 核心架构
4. [技能管理实施方案](技能管理实施方案.md) — skills 工作机制
5. [skills-改动汇总](skills-改动汇总.md) — 当前 skills 模块的状态（含 exec_function 沙箱 / skillCreator）

### 5.2 想了解千川的人
1. [千川 API 实时数据接入方案](千川API实时数据接入方案.md) — 整体设计
2. [千川-改动汇总](qianchuan-改动汇总.md) — 落地索引（最新）
3. [千川数据快照-实施计划](千川数据快照-实施计划.md) — 历史/实时混跑

### 5.3 想跑测试 / 排查 bug 的人
1. [knowledge-base-test-plan-2026-06-29](knowledge-base-test-plan-2026-06-29.md) — 测试矩阵
2. [kb-e2e-test-report-2026-06-30](kb-e2e-test-report-2026-06-30.md) — **本次跑测报告（29/29 通过）**
3. [`../scripts/run_kb_e2e.sh`](../scripts/run_kb_e2e.sh) — 编排脚本
4. [bug-fix-2026-06-29](bug-fix-2026-06-29.md) — 已知坑位（含 Bug 9）

### 5.4 模型 / 缓存相关
1. [minimax-m3 迁移说明](minimax-m3-迁移说明.md) — M3 模型特性 + cache profile
2. `lib/model-cache-profiles.ts` — cache profile 解析源码

---

## 6. 文档维护约定

| 操作 | 命名规范 | 位置 |
|---|---|---|
| 新增架构方案 | `<主题>-方案.md` 或 `<主题>-实施计划.md` | `docs/` |
| 改动汇总 | `<主题>-改动汇总.md` | `docs/` |
| Bug 修复 | `bug-fix-YYYY-MM-DD.md` | `docs/` |
| 测试方案 | `<模块>-test-plan-YYYY-MM-DD.md` | `docs/` |
| 测试报告 | `<模块>-test-report-YYYY-MM-DD.md` | `docs/` |
| 测试脚本 | `scripts/gen_<fixture>.py` / `scripts/run_<scope>.sh` | `scripts/` |
| 上手指南 | `ONBOARDING.md` | 根目录 |
| 项目总览 | `README.md` | 根目录 |

每次新增 doc 后，请同步更新本 INDEX。