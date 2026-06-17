# 项目还原提示词(可直接复制使用)

你要从零重建一个 Next.js 单体 Web 项目「AI 电商主图 / 详情页生成管理系统 MVP」,按下面规格 1:1 还原,代码、目录、依赖、字段、默认账号全部保持一致。完成后必须能 `npm install && npm run db:push && npm run db:seed && npm run dev` 直接跑起来,登录 `admin / admin123` 看到完整工作台。

===========================
一、技术栈与版本(严格一致)
===========================
- Next.js 15.1.6(App Router, Server Actions + Route Handlers),React 19,TypeScript 5.7 严格模式
- UI:Ant Design 5.23.2 + @ant-design/icons;在 `app/layout.tsx` 引入 `antd/dist/reset.css` 和 `app/globals.css`
- ORM:Prisma 6.2.1 + @prisma/client;DB 为 SQLite,文件 `prisma/dev.db`
- 其它依赖:archiver 7(zip 打包)、clsx、tsx(运行 seed)
- 工具脚本:Prisma 表结构由 `prisma/init.mjs` 用 node:sqlite 同步创建,运行命令为 `node prisma/init.mjs && prisma generate`
- Node 模块解析:tsconfig 里 `paths: { "@/*": ["./*"] }`;next.config.ts 里只设 `reactStrictMode: true, devIndicators: false`;ESLint 用 `eslint-config-next`

===========================
二、package.json scripts(完全照抄)
===========================
{
  "dev": "next dev",
  "build": "prisma generate && next build",
  "typecheck": "tsc --noEmit",
  "db:push": "node prisma/init.mjs && prisma generate",
  "db:seed": "tsx prisma/seed.ts",
  "postinstall": "prisma generate"
}

===========================
三、目录结构(必须 1:1)
===========================
app/
  layout.tsx, page.tsx(redirect → /chat-projects), globals.css
  login/page.tsx
  projects/page.tsx(渲染 <DashboardProvider view="projects" />)
  projects/[id]/page.tsx(渲染 <DashboardProvider view="project" projectId={id} />)
  knowledge/page.tsx, records/page.tsx, settings/page.tsx, chat-projects/page.tsx
  api/auth/{login,logout,me}/route.ts
  api/users/route.ts, api/users/[id]/route.ts
  api/projects/route.ts, api/projects/[id]/route.ts, api/projects/[id]/share/route.ts
  api/mechanisms/parse/route.ts, api/mechanisms/match/route.ts
  api/knowledge/upload/route.ts, api/knowledge/text/route.ts, api/knowledge/assets/route.ts, api/knowledge/assets/[id]/route.ts
  api/generation/tasks/route.ts, api/generation/tasks/[id]/route.ts, api/generation/batch/route.ts, api/generation/custom/route.ts
  api/results/route.ts, api/results/download-batch/route.ts, api/results/[id]/download/route.ts
  api/settings/api-config/route.ts, api/settings/api-config/test/route.ts, api/settings/roles/route.ts, api/settings/roles/[key]/route.ts, api/settings/usage/route.ts
  api/chat/route.ts
  api/chat-projects/route.ts, api/chat-projects/[id]/route.ts
  api/chat-conversations/route.ts, api/chat-conversations/[id]/route.ts, api/chat-conversations/[id]/download/route.ts
  api/files/[encoded]/route.ts
components/Dashboard.tsx(单文件 ~2k 行,承担整个工作台所有视图)
lib/
  auth.ts, prisma.ts, password.ts, roles.ts, server-exports.ts
  matching.ts, mechanism.ts, storage.ts, prompts.ts
  ithink.ts(封装 IThinkAPI chat + images,含 SSE/responses 切换、超时、重试)
  generation.ts(任务执行), create-batch.ts(批量任务创建)
  document-extract.ts(txt/md/csv/json/xml/pdf/docx/xlsx/pptx 解析,zlib + 手写 zip reader)
  chat-store.ts(ChatProject/ChatConversation/ChatMessage 三张表的 CREATE/SELECT 助手)
prisma/{schema.prisma, init.mjs, seed.ts, dev.db}
storage/{uploads,results}/(运行后自动创建,.gitkeep 占位)
ONBOARDING.md, README.md, docs/knowledge-base-upgrade.md(保留)

===========================
四、Prisma 数据模型(全部字段、关系、默认值一致)
===========================
datasource: sqlite, url = env("DATABASE_URL")
- User(id cuid, username unique, nickname, passwordHash, role default "creator", status default "active", createdAt, updatedAt, lastLoginAt?)
- Session(id, tokenHash unique, userId→User, expiresAt, createdAt)
- Project(id, name, description?, coverUrl?, creatorId→User, status default "active", createdAt, updatedAt)
- ProjectMember(id, projectId, userId, role default "viewer", createdAt;@@unique[projectId,userId])
- KnowledgeAsset(id, assetName, originalName, assetType, productName?, tags="[]", aliases="[]", description?, storagePath, mimeType?, enabled=true, preferred=false, vectorStatus="pending", extractedText?, createdById→User, createdAt, updatedAt)
- ProductAlias(id, alias, assetId→KnowledgeAsset;@@unique[alias,assetId])
- MechanismParse(id, projectId, rawMechanism, price Float, productSummary, parseStatus default "success", errorMessage?, createdById, createdAt)
- MechanismItem(id, parseId, productName, quantity default 1, matchedAssetId?, matchType default "none", matchScore default 0)
- GenerationTask(id, projectId, parseId, createdById, outputType, aspectRatio, detailPageCount?, imageCount default 1, templateAssetId?, imageSize?, imageQuality?, prompt?, status default "queued", failureReason?, createdAt, updatedAt)
- GenerationResult(id, taskId, projectId, imagePath, pageIndex?, width?, height?, prompt?, createdAt)
- ApiConfig(id PK default "singleton", textBaseUrl default "https://token.ithinkai.cn/v1", textModel default "gpt-5.5-token", textWireApi default "responses", textPromptCacheEnabled default true, textPromptCacheRetention default "24h", textPromptCacheKey default "commerce-chat", disableResponseStorage default true, imageBaseUrl default "https://token.ithinkai.cn/v1", imageModel default "gpt-image-2", embeddingModel default "text-embedding-3-small", maxConcurrency default 1, retryCount default 2, timeoutSeconds default 240, updatedAt)
* 注:ChatProject / ChatConversation / ChatMessage / ChatUsage 不进 schema,改由 `lib/chat-store.ts` 的 `prisma.$executeRawUnsafe` 用 SQL 自行建表(SQL 文本完整写在 `prisma/init.mjs` 末尾的 db.exec 块中,必须 1:1 复制)

===========================
五、环境变量(.env.local 内容)
===========================
DATABASE_URL="file:./dev.db"
ITHINK_API_KEY="sk-...图片生图用"
ITHINK_TEXT_API_KEY="sk-...对话/机制用(可与上面不同)"
ITHINK_BASE_URL="https://token.ithinkai.cn/v1"
ITHINK_IMAGE_MODEL="gpt-image-2"
ITHINK_CHAT_MODEL="gpt-5.5-token"
APP_SECRET="replace-this-local-secret-before-production"

===========================
六、Seed 数据(seed.ts)
===========================
- admin / admin123 → role=admin, nickname=管理员
- operator / operator123 → role=creator, nickname=运营示例
- ApiConfig.upsert(id="singleton"),从环境变量读取
- Project.upsert(id="demo-project", name="鱼子酱洗护主图测试", description="用于验证机制解析、白底图匹配和批量生图的示例项目", creatorId=admin.id)
- ProjectMember.upsert(operator 为 demo-project 的 editor)

===========================
七、核心业务规则(必须照实现)
===========================
1. 密码:lib/password.ts 用 pbkdf2Sync(120000 次, sha256, 32 字节) + 16 字节 salt,格式 `iterations:salt:hash`
2. 登录:cookie 名 `commerce_session`,httpOnly + sameSite lax,7 天过期,token 随机 32 字节,DB 存 sha256
3. 角色权限:admin / creator / editor / viewer 四个系统角色,8 个权限(manage_settings/manage_users/create_project/manage_project/share_project/generate_image/manage_knowledge/download_results),自定义角色通过 `RoleDefinition` 原始 SQL 表存储,删除自定义角色时把引用用户的 role 改回 viewer
4. 机制解析(每行 `价格=产品名*数量+产品名*数量`,支持重复检测、价格/产品名校验、空产品名报错)
5. 白底图匹配四级兜底(exact_name → product_name → alias → fuzzy 包含),preferred + enabled 优先
6. 生图任务:主图 1:1 默认 2048x2048,详情页 9:16 默认 1024x1792;详情页用 5 个固定分镜(套装主视觉/核心卖点/资料支撑/使用场景/价值总结)
7. 提示词模板:DEFAULT_MAIN_PROMPT_TEMPLATE / DEFAULT_DETAIL_PROMPT_TEMPLATE 占位符 {{price}} {{productSummary}} {{products}} {{whiteImages}} {{sellingPoints}} {{pageIndex}} {{pageCount}} {{sceneTitle}} {{sceneGoal}},生成时会把白底图/主图模板/达人肖像编号说明附加在 prompt 末尾
8. 参考图规则:有 referenceImage 时调 images/edits(2048x2048 在有参考图时降为 1024x1024 避免上游拒绝),无 reference 时调 images/generations;3 次重试只对可重试错误(5xx/系统繁忙/timeout)生效
9. 对话 API:POST /api/chat,带 conversationId 时加载最近 16 条历史,响应写回 ChatMessage 并把 `新对话` 自动用首条 user 消息前 32 字做标题,同时记录 ChatUsage
10. 知识库:上传时按 MIME 推断类型(image/* → product_white_image, pdf → pdf, pptx → ppt, 其它 → document),文件名去后缀做 assetName,同时跑 `extractDocumentText` 写入 extractedText
11. 文件读取:存盘路径 base64url 编码后通过 /api/files/[encoded] 访问,只允许 storage/uploads 和 storage/results 根目录
12. 完整提示词编辑:ProjectWorkspace 渲染 prompt 预览,可针对 `${parseId}:main` 或 `${parseId}:detail:${page}` 改写,改后通过 `fullPromptOverrides` 传给 createBatchGeneration,序列化时分别打成 `main_prompt_config` 和 `detail_full_prompts` 的 JSON
13. 设置:API 配置 API_KEY 不回显到前端,只回显 `apiKeyMasked = ${key.slice(0,6)}...${key.slice(-4)}`
14. 统计:消耗统计 GET /api/settings/usage 按 day/week/month 聚合 GenerationResult + ChatUsage,管理员专属

===========================
八、前端 features(components/Dashboard.tsx 必须实现的视图)
===========================
- 顶栏:品牌 + 导航(对话项目/生图项目/知识库/生成记录/设置,设置仅 admin 或有 manage_settings 可见) + 头像/昵称/角色 tag/退出
- ProjectsView:统计卡(今日生成/待处理/项目数)+ 项目卡片网格 + 创建项目 Modal
- ProjectWorkspace:
  · 项目信息 Descriptions + 共享成员 Drawer
  · 标准生图卡(Radio 切换 1:1 主图 / 9:16 详情页,主图数量/分辨率/质量/详情页分镜数,主图模板 + 达人肖像白底图下拉,支持本地上传立刻入知识库)
  · 解析机制 TextArea → 调 /api/mechanisms/parse → 解析结果 Table + 匹配状态 + 产品白底图匹配卡片
  · 自定义生图(任意 prompt + 多参考图 + 1:1/9:16 + 1K/2K/4K 分辨率)
  · 完整提示词(可编辑,按机制/主图/详情页/页码切换,改完覆盖,提供"恢复自动生成")
  · TaskResults 表格:勾选下载 zip、下载全部主图、单图下载、重试,每行展示预览/类型/机制/开始时间/制作耗时/状态/实际尺寸/失败原因
- KnowledgeView:分类切换(全部/产品白底图/主图模板/达人肖像/PDF/PPT/文档/提示词)+ 资产列表 + 编辑 Modal + 文字资料新建
- RecordsView:生图 + 对话双 Tab,管理员可按用户/项目/对话筛选
- SettingsView:API 配置(实时测连通:文本走 testChat、图像走 generateImage 渐变图)+ 角色管理 + 用户管理(管理员)
- ChatProjectsView:左侧项目/对话树(新建/重命名/删除),右侧消息流(支持选/全部知识库、上传资料、Enter 发送)

===========================
九、UI 主题
===========================
- 主色 #6757ff,辅助 #2f48c8 / #d7ab5c
- 顶栏 sticky + 毛玻璃,hero-band 蓝紫渐变 + Unsplash 背景图
- .soft-card 圆角 10px + 阴影 0 12px 34px rgba(49,61,121,0.08)
- 全站禁用 antd wave(在 ConfigProvider 里 wave={{ disabled: true }})
- layout 顶部 inline script 把 console 里的 `[antd: compatible]` 警告静默

===========================
十、验收清单(逐条勾选)
===========================
- [ ] 1. `npm install` 成功,postinstall 自动 prisma generate
- [ ] 2. `npm run db:push` 成功,生成 prisma/dev.db 且包含所有表 + 字段(包含 ChatProject/ChatConversation/ChatMessage/ChatUsage/RoleDefinition/ApiConfig/GenerationResult 等)
- [ ] 3. `npm run db:seed` 后,User 表里有 admin/operator,Project 表里有 demo-project,ApiConfig 里有 singleton
- [ ] 4. `npm run dev` 启动后 http://localhost:3000/login 可见登录页,admin/admin123 登录后落到 /projects
- [ ] 5. /api/auth/me 返回当前用户和 permissions 数组
- [ ] 6. 进入 demo-project 后能解析机制、看到白底图匹配、提交生图任务(若 API Key 有效就真实出图,无效就 failureReason 报错)
- [ ] 7. 知识库能上传图片/PDF/Word,自动识别类型并抽取文本
- [ ] 8. /chat-projects 路径能创建项目 + 对话 + 调 /api/chat 收到回答
- [ ] 9. 设置页 API 测试按钮会真实调用上游(成功/失败都要在 UI 提示)
- [ ] 10. 生成记录能按用户/项目/对话筛选
- [ ] 11. 下载勾选图片可生成 zip;单图下载返回 attachment
- [ ] 12. `npm run typecheck` 0 错误

实现过程中如发现需要决策:决策已在上面给出,直接照做即可;遇到文档未覆盖的细节(比如 UI 文案、颜色微调),按"尽量贴近当前截图/源码"原则处理。
