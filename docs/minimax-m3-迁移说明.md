# MiniMax M3 迁移说明（DeepSeek / iThink → MiniMax）

## Context

把文本对话模型从 **DeepSeek (走 iThink `token.ithinkai.cn/v1` OpenAI 兼容接口)** 切到 **MiniMax M3 (走 MiniMax `api.minimaxi.com/anthropic` Anthropic Messages API)**。

为什么改：
- DeepSeek 走 iThink 时余额不足（HTTP 402 Insufficient Balance），且部分 SSE 流在 1M token 上限附近炸掉
- MiniMax Token Plan 提供订阅 key，对 `MiniMax-M3` 模型有稳定的 token 配额
- MiniMax M3 在 Anthropic SDK 协议下提供思考块（`thinking` content block），对长 prompt 推理更稳

接口差异：

| 维度 | 原 DeepSeek/iThink | 新 MiniMax M3 |
|---|---|---|
| Base URL | `https://token.ithinkai.cn/v1` | `https://api.minimaxi.com/anthropic` |
| 协议 | OpenAI Chat Completions / Responses | Anthropic Messages |
| 端点 | `/chat/completions` / `/responses` | `/v1/messages` |
| 模型名 | `gpt-5.5-token` / `deepseek-v4-pro` | `MiniMax-M3` |
| 鉴权头 | `Authorization: Bearer <key>` | `x-api-key: <key>` + `anthropic-version: 2023-06-01` |
| 必填参数 | `max_completion_tokens` | `max_tokens`（默认 8192） |
| System 角色 | 放在 `messages[0]` | 顶层 `system` 字段 |
| 工具定义 | `{type:"function", function:{name, description, parameters}}` | `{name, description, input_schema}` |
| 流式事件 | `data: {choices:[{delta:{content, tool_calls}}]}` | `event: message_start` / `content_block_start` / `content_block_delta` / `content_block_stop` / `message_delta` / `message_stop` |
| 工具调用增量 | `delta.tool_calls[].function.arguments` | `content_block_delta.delta.partial_json` |
| Thinking | 不支持 | 支持 `thinking` content block（前端忽略，只 yield text） |

图片生成接口**没改**：MiniMax 文档没有图，先继续走 iThink / OpenAI 兼容的 `/images/generations`。

---

## 代码改动

### 1. `lib/ithink.ts` —— IThinkClient 新增 Anthropic 分支

- `TextWireApi` 类型增加 `"anthropic"`
- 新增 `anthropicHeaders()`：返回 `x-api-key` + `anthropic-version: 2023-06-01`
- 新增 `prefersAnthropic()`、`anthropicMessagesUrl()`：`{baseUrl}/v1/messages`
- 新增 `streamAnthropic(messages, options, signal)`：
  - `toAnthropicMessages(messages)` 把 OpenAI 风格的 `messages`（含 `tool_calls` / `tool` role）转成 Anthropic 风格（`tool_use` / `tool_result` content blocks）
  - `toAnthropicTools(tools)` 把 OpenAI 风格 `tools` 转成 Anthropic 风格（去掉外层 `type:"function"`、把 `parameters` 改名为 `input_schema`）
  - 解析 SSE：按 `event:` 字段分发（`message_start` / `content_block_start` / `content_block_delta` / `message_delta`），累计 `input_json_delta` 到 `toolCallsByIndex`，最后 yield `tool_calls`
  - thinking / tool_use content block 不 yield text 给前端（只 yield text 类型），避免 thinking 漏到用户答案区
- 新增 `chatDetailedViaAnthropic(...)`：非流式回退路径（test 接口用）
- `testChat()` 增加 anthropic 分支
- `chatStream` 入口顺序：`prefersAnthropic()` → `prefersResponses()` → chat/completions

### 2. `prisma/schema.prisma` / `prisma/seed.ts` / `prisma/init.mjs`

`ApiConfig` 表的默认值全部切到 MiniMax：
- `textBaseUrl` default: `https://api.minimaxi.com/anthropic`
- `textModel` default: `MiniMax-M3`
- `textWireApi` default: `anthropic`
- `imageBaseUrl` **保留** `https://token.ithinkai.cn/v1`（图片继续用 iThink）

### 3. `lib/ithink.ts` 构造函数默认

- `ITHINK_BASE_URL` 未设时默认 `https://api.minimaxi.com/anthropic`
- `ITHINK_CHAT_MODEL` 未设时默认 `MiniMax-M3`
- 新增 `ITHINK_ANTHROPIC_VERSION`（默认 `2023-06-01`）、`ITHINK_ANTHROPIC_MAX_TOKENS`（默认 `8192`）

### 4. `components/Dashboard.tsx`

`ApiConfigPanel` 里 `textWireApi` Select 新增 `"anthropic" → "Anthropic Messages（MiniMax M3 / Claude）"` 选项。

### 5. `.env` / `.env.local`

保留两个独立的 key（避免一个失效拖累另一个）：
```bash
# 文本对话：MiniMax Token Plan Subscription Key
ITHINK_TEXT_API_KEY="<你的 MiniMax Subscription Key>"

# 图片生成：继续用 iThink 或 OpenAI 兼容的图床
ITHINK_IMAGE_BASE_URL="https://token.ithinkai.cn/v1"

# 可选：Anthropic 版本 / max_tokens
# ITHINK_ANTHROPIC_VERSION="2023-06-01"
# ITHINK_ANTHROPIC_MAX_TOKENS="8192"
```

> 注：`ITHINK_API_KEY`（不带 `_TEXT_` 后缀）也是构造函数兜底读取的环境变量，建议把 `ITHINK_TEXT_API_KEY` 配到 MiniMax 的订阅 key。

---

## 上线步骤（管理员视角）

1. 拿到 MiniMax Token Plan Subscription Key（订阅管理页面）
2. 后台 `设置 → 系统接入 → API 配置` 页面：
   - 文本 API 地址：`https://api.minimaxi.com/anthropic`
   - 文本模型名称：`MiniMax-M3`
   - 文本调用方式：`Anthropic Messages（MiniMax M3 / Claude）`
   - 点「测试文本连接」，看到 `连接成功` 即生效
3. （可选）图片生成维持现状不动
4. 用一个对话轮跑一遍完整链路：
   - 触发 KB 检索 → 用 `getAssetDetail` → 工具调用 SSE 正常
   - 触发千川实时数据 → `qianchuanMaterialData` → 工具调用正常
   - 触发 `<think>` + `## 标题` 段落格式 → 前端正确折叠/展开

---

## SSE 事件映射（Anthropic → 内部 ChatStreamChunk）

| Anthropic event | 内部 yield |
|---|---|
| `message_start` | `usage`（提前给 `input_tokens`） |
| `content_block_start` (type=text) | （无 yield，等 delta） |
| `content_block_start` (type=tool_use) | 记录 `tool_use.id/name` + 初始 `input` JSON |
| `content_block_start` (type=thinking) | （忽略，thinking 不外泄） |
| `content_block_delta` (text_delta) | `text` |
| `content_block_delta` (input_json_delta) | 累加到 `toolCallsByIndex[i].arguments` |
| `content_block_delta` (thinking_delta) | （忽略） |
| `message_delta` | 更新 `usage`（`output_tokens` / `cache_read_input_tokens`） |
| `message_stop` | 收尾 yield `tool_calls`（若有）+ 最终 `usage` |

---

## 已知坑

- **baseUrl 末尾斜杠**：构造函数已 `.replace(/\/$/, "")`，所以填 `https://api.minimaxi.com/anthropic` 或 `https://api.minimaxi.com/anthropic/` 都能拼出正确的 `/v1/messages`。
- **Anthropic `messages` 必须 user/assistant 交替**：从 OpenAI tool 风格过来的多轮对话可能出现连续 `assistant` 工具结果 → Anthropic 要求合并；`toAnthropicMessages` 会把 `tool` 角色转成 `user` 角色包一层 `tool_result` block，通常能解决；连续多个 `tool_result` 时仍要保证 user/assistant 交替，遇到 400 时 Anthropic 会返回具体哪个 role 出错。
- **`max_tokens`**：M3 长 prompt 推理需要 ≥ 4096；默认 8192 够用；若 `INCOMPLETE` 错误码频繁出现，调大 `ITHINK_ANTHROPIC_MAX_TOKENS`。
- **`disableResponseStorage` / `prompt_cache_*` 选项**：Anthropic 不支持，跳过即可（在 Anthropic 分支不发送）。
- **图片接口未迁移**：MiniMax 文档未列图片端点，继续走 iThink。

---

## 验证清单

- [ ] `npx tsc --noEmit` 通过
- [ ] 设置页「测试文本连接」返回 `连接成功`
- [ ] `/api/me` 正常返回；cookie 仍有效
- [ ] 普通问答：「你好，请自我介绍」 → 返回 markdown，**第一行是 `##` 二级标题**，无 `<think>` 块外漏
- [ ] 工具调用：问一个需要 KB 检索的问题 → SSE 流出现 `tool_calls` 事件，模型正确调用 `searchKnowledgeBase` / `getAssetDetail`
- [ ] 千川：问「查询并分析弹动个人护理旗舰店 26 年 6 月 1 号素材消耗情况」 → 返回正确的素材列表（不走素材名称过滤）
- [ ] Thinking：M3 返回的 thinking content block 不出现在用户答案区（前端 Markdown 组件 `splitThinking` 自动按 `<think>` 切分，且我们的 Anthropic parser 本来就不 yield thinking）
- [ ] 图片生成：「用极简的蓝紫渐变生成一张测试图」 → 走 iThink `/images/generations` 返回图片