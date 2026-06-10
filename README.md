# AI 电商主图 / 详情页生成管理系统 MVP

这是一个 Next.js + TypeScript + Ant Design + Prisma + SQLite 的 Web 测试版 MVP。

## 已实现

- 账号密码登录，会话 Cookie，默认管理员账号。
- 项目列表、项目创建、项目生图工作台。
- 知识库文件上传，自动按文件名去后缀命名，资料编辑、启用、优先匹配、别名。
- 机制批量解析：`价格=产品*数量+产品*数量`。
- 产品白底图匹配：完全同名、产品名、别名、模糊匹配、手动匹配接口。
- 生图任务队列，调用 iThinkAPI `gpt-image-2` 生成 1:1 主图和 9:16 详情页分镜。
- 生成结果本地保存、预览、单张下载、项目 ZIP 下载。
- 管理员 API 配置、API 测试、用户创建和用户列表。

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

`.env.local` 中已按本次要求写入服务端变量：

- `ITHINK_API_KEY`
- `ITHINK_BASE_URL=https://token.ithinkai.cn/v1`
- `ITHINK_IMAGE_MODEL=gpt-image-2`
- `ITHINK_CHAT_MODEL=gpt-image-2`

API Key 不会进入前端页面。由于密钥曾出现在对话里，建议上线前到平台轮换一次。

## 目录

- `app/`：Next.js 页面和 API 路由
- `components/Dashboard.tsx`：主工作台界面
- `lib/`：认证、Prisma、机制解析、匹配、生图、存储
- `prisma/schema.prisma`：SQLite 数据模型
- `storage/uploads`：知识库上传文件
- `storage/results`：生成结果图片
