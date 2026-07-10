# 知识库模块端到端测试方案

> 范围：上传 → 解析 → AI 应用，覆盖不同文件类型与不同文件大小的兼容性、性能、检索正确性。
> 当前项目无任何测试基础设施（无 vitest / jest / `__tests__/`、`package.json` 无 `test` 脚本），本方案假定先引入 vitest + supertest 完成单测，E2E 用脚本 + curl/Postman 手动跑。

---

## 1. 测试目标

| 目标 | 验证内容 |
|---|---|
| G1 上传兼容 | 8 种 `assetType` × 多尺寸（1KB / 1MB / 10MB / 100MB）下文件成功落盘 + DB 记录 |
| G2 解析正确 | 各类型 extractor 抽取的 `extractedText` 可被 AI 检索到 |
| G3 检索排序 | 关键词/别名/场景/优先标记四种召回路径都按预期打分 |
| G4 AI 应用 | chat 路由 manual / skill 两条路径都能引用并出现在答案里 |
| G5 权限 | admin / creator / 普通用户 / 跨部门场景下的可见性与可编辑性 |
| G6 健壮性 | 空文件、损坏文件、超大文件名、并发上传、不支持的扩展名都能合理报错 |

---

## 2. 准备清单

### 2.1 测试账号
| 账号 | 角色 | 部门 | 用途 |
|---|---|---|---|
| admin1 | admin | dept_a | 跨部门可见性 / 跨部门迁移 |
| admin2 | admin | dept_b | 跨部门互不可见 |
| creator1 | creator | dept_a | 编辑本部门资料 |
| viewer1 | viewer | dept_a | 只读 |
| creator_x | creator | dept_default | 默认部门 |

### 2.2 测试数据
提前用脚本生成如下样本文件，存到 `test/fixtures/kb/`：

| ID | 类型 | 扩展名 | 大小 | 内容特征 |
|---|---|---|---|---|
| F-TXT-1 | prompt | .txt | 1 KB | "请帮我写一条小红书种草文案，针对鱼子酱抗老面膜" |
| F-TXT-2 | document | .txt | 1 KB | 通用品牌话术（中文 + emoji） |
| F-DOC-1 | document | .docx | 100 KB | 含 5 张图、2 表格、混合中英文 |
| F-DOC-2 | document | .docx | 5 MB | 大量重复段落，用于性能基准 |
| F-PDF-1 | pdf | .pdf | 500 KB | 单页纯文字 |
| F-PDF-2 | pdf | .pdf | 8 MB | 50 页含图片（FlateDecode 压缩） |
| F-PDF-3 | pdf | .pdf | 200 KB | 损坏文件（截断字节） |
| F-PPT-1 | ppt | .pptx | 2 MB | 20 页含图表 |
| F-PPT-2 | ppt | .ppt | 5 MB | 旧二进制 .ppt |
| F-EXCEL-1 | excel | .xlsx | 50 KB | 3 sheet / 100 行 / 中文表头 |
| F-EXCEL-2 | excel | .xlsx | 10 MB | 10 sheet / 10 万行 / 公式 + 图表 |
| F-EXCEL-3 | excel | .xls | 1 MB | 旧 .xls（二进制） |
| F-IMG-1 | product_white_image | .png | 2 MB | 1080p 白底图 |
| F-IMG-2 | portrait_white_image | .jpg | 8 MB | 4K 人像白底 |
| F-IMG-3 | main_template | .psd | 50 MB | PSD 多图层 |
| F-EMPTY | document | .txt | 0 B | 空文件 |
| F-LONG-NAME | document | .txt | 1 KB | 文件名 200 字符含 emoji + 中日韩 |
| F-BAD-EXT | document | .xyz | 1 KB | 不支持的扩展名 |

### 2.3 环境依赖
- Node 20+ / pnpm
- Python 3.10+ 并安装：`pip install openpyxl xlrd==1.2.0`（Excel 解析走 Python 脚本）
- 内存 ≥ 16 GB（要跑 F-PDF-2 8MB、F-EXCEL-2 10MB、F-IMG-3 50MB）
- 启动 dev server：`pnpm dev`，监听 3000

### 2.4 工具链
| 工具 | 用途 | 安装 |
|---|---|---|
| vitest | 单元测试 | `pnpm add -D vitest` |
| supertest | HTTP 测试 | `pnpm add -D supertest @types/supertest` |
| prisma test helpers | DB mock | 内置 `prisma` |
| curl | 手工冒烟 | 系统自带 |
| `scripts/gen_kb_fixtures.py` | 测试样本生成器 | `pip install fpdf2 python-docx python-pptx openpyxl "xlrd==1.2.0" xlwt Pillow` |
| `scripts/run_kb_e2e.sh` | 端到端编排 | 见 §6 |

---

## 3. 阶段一：上传（POST `/api/knowledge/upload`）

### 3.1 类型 × 大小矩阵

| 用例 | 文件 | 期望 |
|---|---|---|
| U-01 | F-TXT-1 (1KB prompt) | 200, assetType=prompt, extractedText 含原文 |
| U-02 | F-DOC-1 (100KB DOCX) | 200, assetType=document, extractedText 非空 |
| U-03 | F-DOC-2 (5MB DOCX) | 200, 解析耗时 < 10s |
| U-04 | F-PDF-1 (500KB) | 200, extractedText 含正文 |
| U-05 | F-PDF-2 (8MB) | 200, 解析耗时 < 30s |
| U-06 | F-PPT-1 (2MB PPTX) | 200, extractedText 含文本框 |
| U-07 | F-PPT-2 (5MB PPT) | 200, extractedText 为占位（不支持二进制 .ppt） |
| U-08 | F-EXCEL-1 (50KB XLSX) | 200, 调 Python, extractedText 含表头与数据 |
| U-09 | F-EXCEL-2 (10MB XLSX) | 200, 解析耗时 < 60s |
| U-10 | F-EXCEL-3 (1MB XLS) | 200, Python 走 xlrd, 解析成功 |
| U-11 | F-IMG-1 (2MB PNG) | 200, assetType=product_white_image, extractedText 为空 |
| U-12 | F-IMG-3 (50MB PSD) | 200, 落盘成功, 不做图像解析 |
| U-13 | F-EMPTY (0B) | 200, extractedText 为 "（空文件）" 占位 |
| U-14 | F-LONG-NAME | 200, 文件名清理后保留 CJK, storagePath 唯一 |
| U-15 | F-BAD-EXT (.xyz) | 200, 落入 document, 不报错 |
| U-16 | 不带 files 字段 | 400 |
| U-17 | viewer1 上传 | 403 (canEdit 返回 false) |
| U-18 | 跨部门上传 dept_b | 403 (非 admin) |
| U-19 | 同名文件重复上传 | 200, 两条记录, 不同 storagePath |
| U-20 | 一次性上传 5 个文件 | 200, DB 5 条记录 |

### 3.2 上传关键指标
- **成功率** ≥ 95%（F-EMPTY / F-PPT-2 占位不算失败）
- **耗时** 1KB 文件 < 200ms；10MB 文件 < 60s
- **内存峰值** 单次请求 < 200MB（验证无整文件缓存）

### 3.3 单元测试（vitest）
- `safeFileName`：CJK / emoji / 路径分隔符 / 控制字符
- `extractNameTokens`：中文 2 字以上提取，英文停用词过滤
- `serializeScenes` / `parseScenesString`：JSON ↔ 数组往返
- `extractDocumentText`：mock 各类型 buffer，验证分支覆盖

---

## 4. 阶段二：解析（extractor 单元测试）

### 4.1 extractor 分支覆盖

| 函数 | 分支 | 验证 |
|---|---|---|
| `extractDocumentText` | ext=`.pdf` FlateDecode | 正向 + 反向（损坏 → 占位） |
| 同上 | ext=`.docx` ZIP `word/document.xml` | 段落 + 表格 |
| 同上 | ext=`.pptx` ZIP `ppt/slides/*.xml` | 文本框抽取 |
| 同上 | ext=`.xlsx` Python `extract_excel.py` | 调通 + JS fallback |
| 同上 | ext=`.doc` / `.ppt` (旧二进制) | 占位 |
| 同上 | ext=图片 | 直接返回空字符串 |
| `refreshAssetText` | 占位命中 → 重新解析 | 行为正确 |
| `needsReextract` | 各种 placeholder 字符串 | boolean 表 |

### 4.2 解析质量
- **PDF 文字保真度**：F-PDF-1 中所有中文段落都能在 extractedText 找到（用 grep）
- **DOCX 段落顺序**：F-DOC-1 的 5 张图前后文本顺序正确
- **XLSX 表头抽取**：F-EXCEL-1 的 sheet1 表头字符串完整
- **大文件性能**：F-EXCEL-2 解析 < 60s, 内存 < 300MB

### 4.3 占位与降级
| 场景 | 期望 |
|---|---|
| 上传损坏 PDF (F-PDF-3) | 200, extractedText="（该 PDF 文件解析失败，请检查文件是否损坏）" |
| 上传 .doc 二进制 | 200, 占位文案 |
| Python 不可用时上传 XLSX | 200, JS fallback, extractedText 有内容 |

---

## 5. 阶段三：检索（`retrieveKnowledge` / `detectSceneIntent`）

### 5.1 召回矩阵

| 查询 | 应召回到的资产 | 期望打分 |
|---|---|---|
| "鱼子酱面膜种草文案" | F-TXT-1 (assetName=鱼子酱种草) | exact-name 100 |
| "鱼子酱" | F-TXT-1 + 任何别名含"鱼子酱"的 | alias 80 |
| "618 主图" | F-IMG-1 (preferred=true) + F-DOC-1 (preferred=true) | preferred 50 boost |
| "场景：抗老" | scenes 含 "抗老" 的 + 普通词命中 | scene overlap 10 |
| 完全无关词 "python tutorial" | 走兜底：返回前 3 条 preferred | fallback |
| 空字符串 | 不调用 / 返回 [] | 短路 |

### 5.2 排序优先级
1. `preferred desc`
2. 关键词命中分（exact 100 > alias 80 > token 20 > productName 18 > tags 12 > content 1-5）
3. `updatedAt desc`

### 5.3 单元测试
- `scoreAsset`：每个分支构造一个 case，覆盖分数边界
- `retrieveKnowledge`：mock Prisma，传入候选列表，验证排序与 fallback
- `detectSceneIntent`：mock BusinessScene，验证 top 5 与空场景兜底

### 5.4 场景意图
- 已知场景关键词 → 返回正确 sceneKey
- 多场景并行 → top 5 排序
- 无匹配 → 返回空数组（不阻塞后续 skill 调用）

---

## 6. 阶段四：AI 应用（chat 路径端到端）

### 6.1 手动路径
| 用例 | 操作 | 期望 |
|---|---|---|
| AI-01 | 切换 useAll=on, 发"鱼子酱面膜文案" | SSE 流 manual_mode 事件，usedAssets 含 F-TXT-1 |
| AI-02 | 显式选 F-DOC-1, 发"618 主图建议" | usedAssets 含 F-DOC-1, 答案引用文档内容 |
| AI-03 | useAll=on 但本部门无匹配 | 走 fallback（top preferred）或 context 为空 |
| AI-04 | 跨部门选择资产 | 资产列表中可见, 但 chat 引用受 `scopedKnowledgeWhere` 过滤 |

### 6.2 技能路径
| 用例 | 操作 | 期望 |
|---|---|---|
| AI-05 | 开启 useKnowledge + useQianchuan, 发"鱼子酱面膜种草文案" | intent 事件 → 命中 "种草" 场景 → 调用 searchKnowledgeBase skill → usedAssets 含 F-TXT-1 |
| AI-06 | 同上, 但本部门无匹配 | 技能返回 "未命中", 答案明确说明 |
| AI-07 | 关闭 useQianchuan | 工具列表中无 qianchuan* 工具（验证正则过滤） |
| AI-08 | 关闭 useKnowledge | 跳过 scene 检测与工具注入, 走纯对话 |
| AI-09 | 复杂问题："鱼子酱面膜 618 主图 文案" | 至少触发 search + getAssetDetail 两个 skill |

### 6.3 缓存路径
| 用例 | 操作 | 期望 |
|---|---|---|
| AI-10 | 同一对话连续问 3 次相似问题 | 第二次起 SSE usage 事件含 `cachedTokens > 0`（Anthropic）或 `cached_tokens` |
| AI-11 | dashboard 设置面板切 baseUrl 到 OpenAI | cache profile 切到 openai_responses，body 含 `prompt_cache_key` |
| AI-12 | 设置 textPromptCacheEnabled=false | 所有分支不传 cache_control / prompt_cache_key |

### 6.4 持久化
| 用例 | 操作 | 期望 |
|---|---|---|
| AI-13 | 正常对话 | done 后 processLog/finalDebug/finalAssets 写入 ChatMessage |
| AI-14 | 刷新页面 | 历史对话能恢复 processLog 渲染 |
| AI-15 | 偏好开关 useKnowledge/useQianchuan 改动 | PATCH `/api/chat-conversations/[id]/prefs` 持久化，下次进对话沿用 |

---

## 7. 阶段五：权限

| 场景 | 操作 | 期望 |
|---|---|---|
| P-01 | viewer1 GET `/api/knowledge/assets` | 仅看到本部门 |
| P-02 | viewer1 POST upload | 403 |
| P-03 | creator1 PATCH dept_b 资产 | 403 |
| P-04 | admin1 PATCH dept_b 资产 | 200 |
| P-05 | creator1 DELETE 资产 | 200, 文件从磁盘删除 |
| P-06 | creator1 DELETE 他人上传的资产 | 视 manage_knowledge 权限而定 |

---

## 8. 阶段六：健壮性 / 异常

| 用例 | 输入 | 期望 |
|---|---|---|
| R-01 | F-EMPTY 0 字节 | 200, 占位文案 |
| R-02 | F-PDF-3 损坏 | 200, 占位文案 |
| R-03 | F-LONG-NAME 200 字符 | 200, 文件名清理后保留 |
| R-04 | 100 MB 单文件 | 验证不被 Next.js body 限制中断；或预期 413 |
| R-05 | 并发上传 5 个不同文件 | 5 条全部成功, 顺序无关 |
| R-06 | 上传同名同大小文件 | 两条记录, storagePath 不同 |
| R-07 | PATCH 时 body 含非法 scenes (非数组) | 400 |
| R-08 | PATCH 时 body 含未授权 departmentId | 403 |
| R-09 | GET 不存在的 assetId | 404 |
| R-10 | DELETE 不存在的 assetId | 404 |
| R-11 | 解析过程 DB 抛错 | catch 后不挂起, 客户端看到 error 事件 |
| R-12 | F-EXCEL-2 解析超时 | 不让 HTTP 请求超时（当前实现同步解析, 需注意实际耗时） |

---

## 9. 阶段七：性能基准

| 指标 | 目标 | 测量方式 |
|---|---|---|
| 单文件上传 P50 | < 1s (1MB) | curl + time |
| 单文件上传 P99 | < 30s (10MB) | curl + time |
| 检索 P95 | < 200ms (200 候选资产) | unit test benchmark |
| AI 引用 P50 | < 1.5s | chat SSE 首字延迟 |
| 大 Excel 解析 | < 60s (10MB) | 单元测试 |
| 大 PDF 解析 | < 30s (8MB) | 单元测试 |

---

## 10. 验收

| # | 验收项 | 通过标准 |
|---|---|---|
| AC-1 | 所有 8 种 assetType 至少 1 个样本成功上传+解析 | 20/20 用例通过 §3.1 |
| AC-2 | 4 种召回路径打分正确 | §5.1 6 个用例全通过 |
| AC-3 | chat 手动 + 技能路径都能引用 KB | §6.1 + §6.2 全通过 |
| AC-4 | prompt cache 命中率 > 0 (重复对话) | §6.3 AI-10 通过 |
| AC-5 | 权限矩阵符合 canEdit / canEditAsset | §7 全通过 |
| AC-6 | 异常输入全部不挂起 | §8 全通过 |
| AC-7 | 性能指标达标 | §9 全通过 |
| AC-8 | vitest 套件 100% 通过 | `pnpm test` exit 0 |

---

## 11. 实施顺序

1. **基建** (1d)
   - 装 vitest + supertest
   - `package.json` 加 `test` 脚本
   - 跑 `python scripts/gen_kb_fixtures.py --clean` 生成 §2.2 测试样本
2. **单测** (1d)
   - §3.3、§4.1、§5.3 三个模块的纯函数单元测试
3. **接口冒烟** (1d)
   - §3.1 / §7 / §8 用 curl 跑完
4. **端到端** (2d)
   - `bash scripts/run_kb_e2e.sh --phase all`，串起登录 → 上传 → 发对话 → 验证 SSE
   - 复现 §5.1 检索排序
5. **回归 & 文档** (0.5d)
   - 把失败用例登记到 docs/bug-fix-2026-06-29.md
   - 把通过的检查点沉淀成 CI 脚本

总预算约 5.5 工作日。

---

## 12. 已知风险

| 风险 | 缓解 |
|---|---|
| `extractDocumentText` PDF 分支用裸 `inflateSync` + 正则，对带复杂编码（CID、嵌入字体）的 PDF 可能漏字 | 用 F-PDF-2 验证, 若失败登记为已知限制 |
| 同步解析 50MB PSD 会让 HTTP 请求挂 30s+ | 加进度日志, 必要时改为异步任务 |
| Excel 解析依赖 Python 3.10 + openpyxl/xlrd, CI 镜像需预装 | Dockerfile 加 `pip install` |
| 当前无任何测试, 引入 vitest 后单测覆盖率可能 < 30% | 第一轮只覆盖 §3.3 / §4.1 / §5.3 关键纯函数, 不强求全局覆盖率 |