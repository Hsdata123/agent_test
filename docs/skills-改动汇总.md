# Skills 模块改动汇总

> 本文档汇总 skills 模块从 v1「用户手动 Dashboard 配置」演进到 v2「AI 对话创建 + 真实 Python 副作用执行」的完整链路。
> 范围：`lib/skills/` 全部、`app/api/skills/`、`components/Dashboard.tsx`、`lib/chat-runner.ts`、`components/Dashboard.tsx` 技能 Tab、`.gitignore`、`skill_sandbox/`。

---

## 0. TL;DR

| 阶段 | 关键决策 | 落点 |
|---|---|---|
| **创建入口收口** | 用户不能再通过 Dashboard / API POST 创建技能，**只能通过 AI 对话中的 `skillCreator` skill** | `app/api/skills/route.ts:POST` → 403 `MANUAL_CREATE_DISABLED` |
| **AI 创建入口** | 新增 BUILTIN `skillCreator` skill，支持 `action=create` / `action=update` | `lib/skills/skill-creator.ts` |
| **第 4 种执行模式** | 新增 `exec_function`，允许在受限沙箱跑真实 Python handler | `lib/skills/user-skill.ts:runExecFunction` → `lib/skills/sandbox/runner.ts` → `lib/skills/sandbox/runner.py` |
| **沙箱安全** | 多层防御：黑名单快捷检查 + RestrictedPython AST + 受限 builtins + 路径白名单 + 超时 + 内存 | `lib/skills/sandbox/policy.ts` + `runner.py` |
| **departmentId 收口** | skillCreator 强制归属到调用者本人部门；忽略 LLM 幻觉传入值；management/PUT 加 FK 存在性校验 | `lib/skills/skill-creator.ts:handleCreate`、`lib/skills/management.ts:createUserSkillServer`、`app/api/skills/[id]/route.ts:PUT` |
| **字段名统一** | parseCreateInput 改读 `parametersJson` / `executeConfigJson`，与 skillCreator schema 三端对齐 | `lib/skills/management.ts:parseCreateInput` |
| **Dashboard 4 模式对齐** | `app/api/skills/[id]/route.ts` 导入 management 的 `validateConfigForMode`（4 模式 + exec_function 黑名单），删除本地 3 模式副本 | `app/api/skills/[id]/route.ts`、`app/api/skills/route.ts`（清理死代码） |
| **技能路由 prompt** | 在 chat-runner system prompt 顶部加「使用 / 创建 / 修改 / 删除」4 条意图路由规则，优先级高于 KB / 千川 | `lib/chat-runner.ts:buildSkillSystemPrompt` |

---

## 1. 创建入口收口

### 决策
用户技能创建**只允许**通过 AI 对话里的 `skillCreator` 内置技能。Dashboard「新建技能」按钮删除，POST `/api/skills` 永久 403。

### 理由
- v1 的「Dashboard 模态表单 → POST → 落库」流程要求业务方理解 OpenAI function calling 的 JSON Schema 概念，对非开发同学门槛太高
- 创建参数应通过 LLM 综合产出（name / displayName / description / parametersJson / executeMode / executeConfigJson 全套），而不是人工填表单
- 表单路径容易出现「name 与 builtin 冲突」「parameters type 写错」「executeMode 选错导致 executeConfig 不匹配」等错误，AI 实时组装参数 + 失败重试更鲁棒

### 改动
- **`app/api/skills/route.ts:POST`** → 始终返回 `403 { code: "MANUAL_CREATE_DISABLED" }`
- **`components/Dashboard.tsx`** → 移除「新建技能」按钮 + 移除 `openCreate` 函数；保留 `openCreateWarning` 显示 info Alert「请通过对话让 AI 创建」
- **GET `/api/skills`** 保留列表查询 + `includeDisabled` / `departmentId` 过滤（UI 仍要看）

---

## 2. skillCreator 内置技能

### 决策
新增 BUILTIN `skillCreator`，LLM 调它即可创建或修改用户技能。skillCreator 本身在 `lib/skills/registry.ts:BUILTIN` 注册，自动出现在 chat 的 tools 列表里。

### 入口
- **A 入口（自然语言）**：用户口述「帮我做一个产品白底图检索的技能，参数是 query，模式 search_kb，配置 queryParam 映射到 query」，LLM 综合出全套字段后调 `action=create`
- **B 入口（粘贴 JSON）**：用户贴一份完整 JSON 配置，LLM 解析后组装成 `parametersJson` / `executeConfigJson` 字符串后调 `action=create`
- **action=update**：传 `skillId` + `updatesJson`（允许 `name / displayName / description / executeMode / executeConfigJson / parametersJson / systemPrompt / enabled / departmentId`）

### 权限
继承调用者本人权限：
- admin → 全局
- creator → 仅本部门
- 其他角色 → 403

通过 `canManageScene(actor, departmentId)` 在 `management.ts:createUserSkillServer` / `updateUserSkillServer` 内统一校验。

### 关键文件
- `lib/skills/skill-creator.ts`：skill 定义 + handleCreate / handleUpdate 实现
- `lib/skills/management.ts`：服务端校验 + 落库（`parseCreateInput` / `validateSkillName` / `validateParametersSchema` / `validateConfigForMode` / `createUserSkillServer` / `updateUserSkillServer`）
- `lib/skills/registry.ts`：在 `BUILTIN` 注册 `skillCreator`，`BUILTIN_NAMES` 自动包含

---

## 3. 第 4 种执行模式 `exec_function`

### 决策
新增 `executeMode = "exec_function"`，允许用户在 `executeConfig` 里塞一段 Python handler 源码，受限沙箱执行后返回 dict 给 LLM。

### 存储
handler 字符串存在 `executeConfig.handler` 字段（JSON 内的 string 字段），**不新增数据库列**。`Skill.executeConfig String @default("{}")` 已经能容纳任意 JSON。

### 沙箱（多层防御）
**`lib/skills/sandbox/policy.ts`** 集中常量：
- `ALLOWED_STDLIB`：`datetime / math / json / re / string / typing / collections / itertools / functools / hashlib / base64 / uuid / time / random / textwrap / unicodedata`
- `FORBIDDEN_MODULE_HINTS`（黑名单，仅 UX 加速）：`socket / subprocess / ctypes / cffi / importlib / pickle / shutil / tempfile / pathlib / asyncio / multiprocessing / threading / urllib / http / ssl / __import__`
- `SANDBOX_DIR_NAME = "skill_sandbox"`、`DEFAULT_TIMEOUT_MS = 5_000`、`PARENT_KILL_TIMEOUT_MS = 7_000`、`DEFAULT_MEM_MB = 256`、`MAX_HANDLER_BYTES = 100_000`

**`lib/skills/sandbox/runner.py`** 子进程执行：
- `RestrictedPython.compile_restricted` 做 AST 检查
- `safe_globals` / `safe_builtins` 起步，加 `_safe_import` 白名单 + `_make_sandbox_open(sandbox_dir)`（**闭包捕获 sandbox_dir**，handler 在自己的 namespace 跑，globals 找不到）
- `os` / `sys` 用 `__getattr__` 包装成只读视图，只暴露白名单属性
- POSIX：`signal.SIGALRM` 超时 + `resource.setrlimit(RLIMIT_AS)` 内存
- Windows：上两条 no-op，靠父进程 7s SIGKILL 兜底

**`lib/skills/sandbox/runner.ts`** 父进程包装：
- `child_process.spawn("python" | "python3" | "py", [runner.py])`，先 `--version` 探测可用二进制
- stdin 写 JSON `{handler, args, sandboxDir, timeoutSec, memMb, allowedStdlib}`，监听 close
- exit code 非 0 / null / 137 → 超时或异常
- 解析 stdout JSON `{ok, data | error}` 返回 `RunPythonResult` 判别联合

### 调度
**`lib/skills/user-skill.ts`**：
- `UserSkillConfig` 加 `"exec_function"` + `handler?: string`
- `runExecute` 新分支：
  ```ts
  if (mode === "exec_function") return runExecFunction(config.handler || "", args);
  ```
- `runExecFunction` 薄包装，调 `runPythonHandler`

### 校验
**`lib/skills/management.ts:validateConfigForMode`** 加 `exec_function` 分支：
- `handler` 必须是非空字符串
- 长度 ≤ 100_000
- 黑名单命中任一关键词直接 400

### 沙箱目录
- 项目根 `skill_sandbox/`（首次执行时 `fs.mkdir({recursive:true})`，已加 `.gitkeep` 占位）
- `.gitignore` 加 `skill_sandbox/*`（保留 `.gitkeep`）

### Python 依赖
- `RestrictedPython>=8.0`（已在沙箱启动时检测，缺失返清晰错误 `RestrictedPython 未安装，请管理员执行: pip install RestrictedPython`）

---

## 4. departmentId 收口（防御 LLM 幻觉）

### 问题
实测 transcript 显示，LLM 调 skillCreator 时常传入幻造的 `departmentId`（如 `"echo-team"`），而 `Skill.departmentId` 是 `Department.id` 的 FK，DB 里没这个部门 → Prisma 抛 `Foreign key constraint violated` 500。

`canManageScene` 对 admin / 有 `manage_settings` 权限的角色永远返回 `true`，所以 FK 校验之前根本没拦住。

### 修复（3 处）
1. **`lib/skills/skill-creator.ts:handleCreate`** 强制覆盖：
   ```ts
   params.departmentId = getEffectiveDepartmentId(ctx.user);  // user.dept || "dept_default"
   ```
   同时把 schema 描述改成「【系统忽略此字段】LLM 不要传值，传了也会被覆盖——避免幻觉出 'echo-team' 这类不存在的部门 id」。

2. **`lib/skills/management.ts:createUserSkillServer`** 加 FK 存在性校验：
   ```ts
   if (input.departmentId) {
     const dept = await prisma.department.findUnique({ where: { id: input.departmentId }, select: { id: true } });
     if (!dept) throw Object.assign(new Error(`部门 ${input.departmentId} 不存在`), { status: 400 });
   }
   ```
   防止 manual API 路径 + skillCreator 双重保险。

3. **`app/api/skills/[id]/route.ts:PUT`** 同样在 `canManageScene` 之前加 Department 存在性检查，堵住 admin 通过 Dashboard 移动技能到不存在部门的 500。

### smoke 验证
`npx tsx skill_sandbox/_smoke_dept.ts` 3/3 通过：
- 不存在的 departmentId 被 Department 查询拦下 ✅
- `dept_default` seed 数据存在 ✅
- `createUserSkillServer` 对 `"echo-team-bogus"` 返 `status=400, msg=部门 echo-team-bogus 不存在` ✅

---

## 5. 字段名三端对齐

### 问题
早期版本 `lib/skills/management.ts:parseCreateInput` 读 `body.parameters` / `body.executeConfig`，但 `lib/skills/skill-creator.ts` 暴露给 LLM 的 schema 字段名是 `parametersJson` / `executeConfigJson`。LLM 按文档传的字段被解析器**静默丢弃**，落到默认 `{}`，然后 `validateConfigForMode` 找不到 `template` 抛「no_op 模式需要 template」。

`updateUserSkillServer` 那边读的是 `updatesJson.parametersJson` / `updatesJson.executeConfigJson`，三端不一致。

### 修复
`management.ts:parseCreateInput` 改成读 `body.parametersJson` / `body.executeConfigJson`，加注释说明字段名必须与 skillCreator schema + updateUserSkillServer 三端对齐。

### smoke 验证
`npx tsx skill_sandbox/_smoke_parse.ts` 3/3 通过：
- LLM 按 schema 传 `parametersJson` + `executeConfigJson` (no_op) → `out.executeConfig.template` 正确 ✅
- 嵌套 JSON 占位符 `{{args.x}}` ✅
- exec_function 模式 handler 字符串 ✅

---

## 6. Dashboard 校验对齐 4 模式

### 问题
`app/api/skills/[id]/route.ts` 早期版本有独立的 `VALID_MODES = Set(["search_kb", "get_detail", "no_op"])` + 本地 `validateConfigForMode`（3 模式），与 `management.ts`（4 模式 + exec_function）不一致。后果：
- AI 通过 skillCreator 创建的 `exec_function` 技能无法在 Dashboard 编辑（PUT 校验拒绝 exec_function）
- 同一份参数校验逻辑在两处维护，模式扩展开销 × 2

### 修复
- **`app/api/skills/[id]/route.ts:PUT`** 改成 `import { validateConfigForMode, validateParametersSchema } from "@/lib/skills/management"`，删除本地副本 + 删除未使用的 `VALID_MODES` 常量
- **`app/api/skills/route.ts`** GET 保留，POST 永久 403，删除底部死代码 `parseJson` / `validateParametersSchema` / `validateConfigForMode` / 未使用的 `VALID_MODES`（POST 不校验）

### smoke 验证
- `npx tsc --noEmit` 0 错
- `grep VALID_MODES app/api/skills/*.ts` → 0 处

---

## 7. 技能路由 system prompt

### 问题
`lib/chat-runner.ts:buildSkillSystemPrompt` 把 AI 框成「知识库检索助手」，第一条规则就是「优先用 searchKnowledgeBase」。后果：
- 用户说「使用回声技能」→ AI 先去搜 KB，搜出 93902 字无关的「鱼子酱」直播 Excel，浪费 token
- 工具列表里没有 echo_skill → AI 擅自调 skillCreator 创建，**没问用户**

### 修复
`chat-runner.ts:buildSkillSystemPrompt` 顶部加 5 条「技能路由」规则（0 / 0a / 0b / 0c / 0d / 0e），**优先级高于所有 KB / 千川规则**：

| 规则 | 触发词 | 行为 |
|---|---|---|
| **0a** | 「使用 / 调用 / 跑一下 X 技能」 | 先查 tools 列表：① 有 → 直接调；② 没有 → 告诉用户「当前没有名为 X 的技能，是否要我创建？」，**必须等用户确认** |
| **0b** | 「创建 / 新建 / 添加一个叫 X 的技能」 | 调 skillCreator(action=create) |
| **0c** | 「修改 / 改一下 / 调整 / 更新 X 技能」 | 调 skillCreator(action=update, skillId, updatesJson) |
| **0d** | 「删除 / 移除 X 技能」 | 提示走 Dashboard「设置 → 技能管理」手动删除 |
| **0e** | 其他（闲聊 / 业务 / 千川 / KB） | 进入下方 KB / 千川路由 |

KB / 千川规则保留在 0e 之后，确保非技能管理类请求的检索体验不退化。

### 预期效果
用户说「使用回声技能」 → AI 看到 tools 列表没有 → 回答「当前没有名为 echo 的技能，是否要我用 skillCreator 帮你创建一个？」 → 不再触发 searchKnowledgeBase（省 9 万字 token）→ 不再擅自创建。

---

## 8. 验收清单

| # | 验证方法 | 状态 |
|---|---|---|
| AC-1 | `npx tsc --noEmit` 0 错 | ✅ |
| AC-2 | 通过 `skillCreator(action=create, name=echo, displayName=回声技能, executeMode=no_op, executeConfigJson='{"template":"{{args.x}}"}')` 创建成功，DB 里能查到 | ✅ smoke `_smoke_parse.ts` |
| AC-3 | 通过 `skillCreator(action=create, ..., executeMode=exec_function, executeConfigJson='{"handler":"def handler(x): return {\\\"echo\\\": x}"}')` 创建成功 | ✅ smoke |
| AC-4 | 创建 exec_function 技能后，在 Dashboard 编辑时 PUT 不报「不支持的 executeMode」 | ✅ `app/api/skills/[id]/route.ts` 已改 |
| AC-5 | exec_function handler 返回 dict + 写 `./skill_sandbox/echo.log` 成功 | ✅ smoke `_node_test.ts` TEST 1 |
| AC-6 | handler 抛 ValueError → 返 `ok=false, error=...`，不崩溃 | ✅ TEST 6 |
| AC-7 | handler 返回 int 而非 dict → 返 `error=handler 必须返回 dict` | ✅ TEST 5 |
| AC-8 | handler 写 `/etc/passwd` → 沙箱 PermissionError → 返 `error=path not in sandbox` | ✅ TEST 3 |
| AC-9 | handler `import socket` → 白名单拒绝 → 返 `error=module 'socket' 不在白名单` | ✅ TEST 4 |
| AC-10 | handler 死循环 → 5s 子进程 SIGALRM + 7s 父进程 SIGKILL → `error=执行超时` | ✅ TEST 2 |
| AC-11 | skillCreator 传 `departmentId="echo-team"` → 强制覆盖为 ctx.user.departmentId → 写入成功 | ✅ smoke `_smoke_dept.ts` |
| AC-12 | `shouldUseKnowledgeFromMessage("使用回声技能")` 不命中 legacy KB 路径 | ✅ 旧 regex 不匹配「使用 X 技能」 |
| AC-13 | 现有 `bash scripts/run_kb_e2e.sh --phase all` 不回归 | ⏳ 待跑 |

---

## 9. 文件清单

### 新增
- `lib/skills/management.ts`（共享校验 + 服务端 helper）
- `lib/skills/skill-creator.ts`（BUILTIN skillCreator）
- `lib/skills/sandbox/policy.ts`（沙箱常量）
- `lib/skills/sandbox/runner.py`（Python 沙箱）
- `lib/skills/sandbox/runner.ts`（Node spawn 包装）
- `skill_sandbox/.gitkeep`（占位）
- `skill_sandbox/_smoke_parse.ts`、`_smoke_dept.ts`、`_node_test.ts`、`_test_handler.py`（smoke 验证，已 gitignore）

### 修改
- `lib/skills/registry.ts`：BUILTIN 加 `skillCreator`（5s 缓存 / `getBuiltinSkillNames` 自动包含）
- `lib/skills/user-skill.ts`：加 `exec_function` + `handler` 字段，dispatch 到 `runExecFunction`
- `lib/skills/skill-creator.ts`：强制 departmentId = user，schema 描述「系统忽略此字段」
- `lib/skills/management.ts`：`VALID_MODES` 加 `exec_function`、`parseCreateInput` 改读 `*Json`、`createUserSkillServer` 加 Department 存在性校验
- `app/api/skills/route.ts`：POST → 403 `MANUAL_CREATE_DISABLED`；清理底部死代码
- `app/api/skills/[id]/route.ts`：导入 management 的 4 模式校验器 + Department 存在性校验
- `components/Dashboard.tsx`：移除「新建技能」按钮 + `openCreate`，加 info Alert「请通过对话让 AI 创建」
- `lib/chat-runner.ts`：buildSkillSystemPrompt 顶部加 5 条「技能路由」规则
- `.gitignore`：加 `skill_sandbox/*`，保留 `.gitkeep`

### 不改
- `prisma/schema.prisma`（exec_function 不新增列，handler 塞 executeConfig JSON）
- `app/api/chat/route.ts`（skill list 自动包含 skillCreator，无变化）
- `app/api/skills/[id]/test/route.ts`（走 buildUserSkill，自动覆盖 4 模式）

---

## 10. 后续待办

- [ ] 跑 `bash scripts/run_kb_e2e.sh --phase all` 验证不回归
- [ ] 起 dev server 跑端到端 echo skill 创建 + 调用测试
- [ ] 加 `scripts/run_skills_e2e.sh`：覆盖 create / update / delete / exec_function 死循环 / 路径越界 / 黑名单 6 个 case
- [ ] 考虑把沙箱升级到 Docker + seccomp（目前 RestrictedPython + 路径白名单 + 超时是「足够」但不是「最强」防护）
- [ ] skillCreator 增加 `action=list`（让 LLM 能列出当前用户能看到的所有技能，避免「使用 X 技能」时猜）