import type { IThinkClient, ChatMessage, ToolCallAccumulator, ToolDefinition } from "./ithink";
import { getSkill } from "./skills/registry";
import type { SkillContext } from "./skills/types";

export type ChatRunnerChunk =
  | { type: "text"; text: string }
  | { type: "skill"; calls: Array<SkillCallRecord>; contextChars: number }
  | { type: "usage"; usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number; cachedTokens?: number } };

export type SkillCallRecord = {
  id: string;
  name: string;
  arguments: unknown;
  result: string;
  ok: boolean;
  error?: string;
  meta?: Record<string, unknown>;
  matchedIds?: string[];
  matchedAssets?: Array<{ id: string; assetName: string; assetType: string }>;
};

export type ChatRunnerInput = {
  client: IThinkClient;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  context?: string;
  tools?: ToolDefinition[];
  ctx: SkillContext;
  isSkillPath: boolean;
  useQianchuan?: boolean;
};

export type ChatRunnerUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
};

export type ChatRunnerResult = {
  answer: string;
  usage: ChatRunnerUsage;
  skillCalls: SkillCallRecord[];
  skillContext: string;
  usedAssetIds: string[];
  error?: { error: string; details?: Record<string, unknown> };
};

const THINKING_INSTRUCTION =
  "\n\n【输出格式 - 必须严格遵守,缺一不可】\n" +
  "每次回答必须按下面的两段式输出,中间用一个空行隔开。**无论问题是简单事实查询、多步骤推理、工具调用成功、工具调用失败、单一时间词,都必须严格按此格式输出,不可省略任何一段。**\n\n" +
  "<think>\n" +
  "(这里只写你的内部思考:用户问的是什么、检索到哪些关键事实、推理步骤。不要写给用户看的结论。注意:思考内容里包含的日期归属判断、字段归属判断、过滤逻辑,都必须 100% 正确——例如「26 年 6 月 1 号」= stat_time_day=2026-06-01,绝不是素材名称前缀,API 返回的行已经按 startDate/endDate 过滤过了,不需要二次过滤。)\n" +
  "</think>\n\n" +
  "(这里写给用户的最终答案,用 markdown 格式,**答案正文的第一行必须是 ## 二级标题**——这是前端区分思考与答案的唯一硬切分点。只展示结论与必要数据,不复述思考过程。)\n\n" +
  "完整示例(请严格模仿结构):\n" +
  "<think>\n" +
  "用户问2026年6月鱼子酱抖音直播间的成交概况。知识库返回了月/周/日三档数据。\n" +
  "月数据给出全月总览,周数据展示3周趋势,日数据(16天)可估算日均。\n" +
  "</think>\n\n" +
  "## 2026年6月 鱼子酱抖音直播间核心数据\n\n" +
  "| 指标 | 数值 |\n" +
  "| --- | --- |\n" +
  "| 整体成交金额 | ¥3,251,993.74 |\n" +
  "| 整体消耗 | ¥1,374,717.29 |\n\n" +
  "【严禁】在 <think> 之外写任何思考性、过渡性的话,例如「我找到了」「现在我可以」「从搜索结果中」「让我尝试」「我先看看」「让我梳理关键洞察」「我直接整理成结构化分析报告」「按要求用##二级标题输出」等。所有这类内容必须放在 <think> 块内,绝不能出现在 <think> 之前或答案之前。\n" +
  "【严禁】答案区用 # 一级标题、### 三级标题或纯文字开头——必须用 ## 二级标题,否则会被前端判定为思考内容而隐藏。\n" +
  "【严禁】跳过 <think> 块直接写答案——无论工具调用是否成功、都必须先 <think> 再答案。\n" +
  "【严禁】把工具执行失败的 error 字符串直接抄给用户——必须把错误转成自然语言 + 下一步建议。\n" +
  "【严禁】根据素材名称、material_id 等任何非 stat_time_day 字段做日期归属判断——日期归属只能看 stat_time_day。\n" +
  "【最重要 - 强约束】你的完整回复的字符流必须是:① <think> 块 ② 一个空行 ③ ## 二级标题开头的答案正文。**严禁在 <think> 之前输出任何字符**(包括「用户问的是」「我直接」「让我」「按要求」等任何一句过渡话)。如果做不到 <think> 块,那就让 <think> 块里只放一个空字符串,然后紧跟空行 + ## 标题——绝不允许 <think> 之前有任何前置内容。";

const QIANCHUAN_RULE =
  "6. 【实时千川数据】涉及千川投放数据（金额/消耗/ROI/订单/抖音号/直播间/素材）的查询，**优先调用实时千川技能**（数据比知识库 Excel 更新鲜）。\n" +
  "   路由匹配规则（按优先级判断，**命中后只调该技能，不要并调其他千川技能**）：\n" +
  "   a) 问句包含「素材」二字（无论搭配消耗/投放/跑量/分析/情况/数据等任何词）→ **只调 qianchuanMaterialData**（按 material_id 聚合，**必传 anchorId**）。触发词样例：「素材消耗情况」「素材投放数据」「素材跑量」「素材分析」「哪个素材好」\n" +
  "   b) 问句不包含「素材」+ 明确指向某个具体抖音号/某抖音号某时段数据（包含抖音号名称或 19 位 ID）→ **qianchuanMaterialData**（必传 anchorId，按素材维度聚合——这是当前唯一保留的「按抖音号+日期」粒度接口）\n" +
  "   c) 问句不包含「素材」+ 不指向具体抖音号 + 是「整个广告主/月度整体概况/账户汇总」→ qianchuanAccountData（account 维度，整个广告主聚合）\n" +
  "   d) 多个子问句且分别命中不同维度（例如「6 月整体消耗 + 弹动官方旗舰店素材情况」）→ 分别调用对应技能，但**单条素材类问题绝不并调 account**。\n" +
  "   硬约束：\n" +
  "   - 提到「素材」时**禁止**调用 qianchuanAccountData——account 是账户总览不含素材维度\n" +
  "   - 涉及具体抖音号（提到名称或 19 位 ID）的非素材问题也走 qianchuanMaterialData（live 接口已弃用）\n" +
  "   - **anchorId 接受抖音号名称（如「弹动官方旗舰店」）或抖音号 ID（19 位长串）**——系统会用「抖音号名称 → ID 映射表」自动解析。**首次使用某个新名字**时，映射表里没有，必须让用户直接提供 19 位 ID（一次性，存进映射表后下次就能用名字）。管理员也可通过「设置 → 千川 → 抖音号名册导入」Excel 批量预填。\n" +
  "   - advertiserId 由系统从当前用户自动注入，query 里**不要**重复传；startDate / endDate 从问题时间词推断：「26 年 6 月」 → \"2026-06-01 00:00:00\" ~ \"2026-06-30 23:59:59\"，单日 → 当天 00:00:00 ~ 23:59:59\n" +
  "   - 用户提到「鱼子酱」等具体品牌/品类直播带货时，**必须**传 marketingGoal=\"LIVE_PROM_GOODS\" 过滤直播全域数据；不确定传 ALL\n" +
  "   - qianchuanMaterialData 必须传 smartBidType：用户问「控成本」→ 0，「放量」→ 7，不确定 → 0（默认）\n" +
  "   - 如果用户明确问的是「历史/上月/去年」的历史快照，可以退一步用 searchKnowledgeBase；否则一律走实时技能。\n" +
  "7. 【anchorId 解析策略 —— 调千川技能前自行判断】\n" +
  "   - **如果用户用的是 19 位 anchor_id（纯数字长串）**：直接调用千川技能（account / material），anchorId 原样传入即可，不要做名称匹配。\n" +
  "   - **如果用户用的是抖音号名称（如「弹动官方旗舰店」）**：先把名称原样传给千川技能（系统会在「抖音号名册」= `QianchuanAnchor` 表里自动模糊匹配）。**匹配到**：正常返回；**匹配不到**：技能会返回 `unknown_anchor_name: ...` 错误，**不要把错误原样甩给用户**，按下面的兜底处理：\n" +
  "     a) 先调用 **searchKnowledgeBase**，把抖音号名称当 query 关键词搜索知识库，看是否有关联的历史投放文档/广告主资料/Excel 摘要。如果有则基于知识库内容给出尽可能贴近的回答。\n" +
  "     b) 在最终答案里向用户说明四件事：①该抖音号当前未在「抖音号名册」中，无法走实时千川 API；②本次回答来自知识库历史资料，可能非最新；③要让用户直接提供 19 位 anchor_id（数字长串）以走实时接口；④管理员可通过「设置 → 千川 → 抖音号名册导入」Excel 批量预填该映射。\n" +
  "   - **不要**在调千川技能前自行编造 anchorId；**不要**用名称做模糊匹配后私自拼 ID；**不要**让用户传 advertiserId。\n" +
  "8. 【日期筛选 —— 严禁用素材名称做日期过滤】\n" +
  "   - 用户问「X 月 X 日素材消耗」里的「X 月 X 日」**永远是 stat_time_day 字段（投放消耗日期 / 数据发生日期）**，不是素材创建/上传日期、不是素材名称前缀、不是任何其他字段。\n" +
  "   - 千川实时接口（material / account / live）的 API 已经按你传入的 startDate / endDate 做了日期范围筛选，返回的每一行的 stat_time_day 都属于该日期范围。**直接使用全部返回行即可，不要二次过滤**。\n" +
  "   - **严禁**根据素材名称中是否包含「0601」「0602」等数字前缀来「再过滤」一遍——这是典型错误：素材名称里的数字通常是素材上传/创建日期，把它当成投放日期会把「6 月 1 号投放的素材」误筛成「6 月 1 号创建的素材」，结果是空集或错误清单。\n" +
  "   - **严禁**根据 material_id、material_name 等任何非 stat_time_day 字段做日期归属判断。\n" +
  "   - 时间词解析规则：「26 年 6 月」 → startDate=\"2026-06-01 00:00:00\"，endDate=\"2026-06-30 23:59:59\"；「6 月 1 号」/「26 年 6 月 1 日」/「6 月 1 日」 → 单日 startDate=\"2026-06-01 00:00:00\"，endDate=\"2026-06-01 23:59:59\"；「最近 7 天」 → 当前日期前推 7 天（含当天）。\n" +
  "9. 【素材下钻 —— qianchuanMaterialData + qianchuanMaterialDetail】\n" +
  "   - `qianchuanMaterialData` 返回**分层摘要**（总览 + Top 30 素材 + 按日简表 + 素材 ID 索引），单次返回控制在 ~7K 字，**不会**爆 LLM context。\n" +
  "   - **下钻触发**：当用户追问以下内容，**必须**调 `qianchuanMaterialDetail(materialId, startDate, endDate, anchorId)`：\n" +
  "     a) 「Top X 素材的逐日明细」「X 素材每天数据」「X 素材哪天跑得好」\n" +
  "     b) 「X 素材 6/3 的 ROI/消耗」「X 素材 6/5 - 6/10 的趋势」\n" +
  "     c) 「Top 3 素材分别哪天开始放量」\n" +
  "   - **materialId 取自 Round 1 工具结果末尾的【素材 ID 索引】**——不要让用户重述 ID，工具结果里已包含 19 位长串。\n" +
  "   - **anchorId 取自上一轮 qianchuanMaterialData 调用时用的值**（同一抖音号），**不要**让用户重述。\n" +
  "   - **长尾素材**：如果用户问的素材不在 Round 1 工具结果的【素材 ID 索引】里（消耗 < Top 30 的素材），直接告知「该素材未在 Top 30 列表中，无法定位到 material_id，请提供 19 位 ID 或调小日期范围重查」，**不要**编造 ID。\n" +
  "   - **追问日期/总览类问题不需要再调工具**：如「6/5 总消耗」「Top 5 排序」「整体 ROI」等都能从 Round 1 的【按日维度】/【按素材 Top 30】/【总览】直接读出。";

function buildSkillSystemPrompt(includeQianchuan: boolean): string {
  const base =
    "你是电商视觉与内容助手，可以使用以下技能来检索知识库资料或执行业务逻辑，然后基于结果回答用户问题。\n" +
    "请先思考用户问题，再决定调用哪些技能；如果不需要任何技能（例如闲聊、问模型能力本身），请直接回答。\n" +
    "【技能路由 —— 最高优先级,在所有 KB / 千川规则之前判断】\n" +
    "0. 用户消息里如果点名要「使用 / 调用 / 跑一下 X 技能」（X 是具体技能名,如「使用回声技能」「调用 echo」「跑一下 query_skill」):\n" +
    "   a) 先看本系统消息下方【可用工具 (functions)】列表里,function.name 是否有「X」或「X_skill」等匹配 (大小写不敏感、可去下划线比对):\n" +
    "      - 有 → 直接调用它,按其 parameters schema 传参;**不要**先调 searchKnowledgeBase / 千川技能\n" +
    "      - 没有 → 告诉用户「当前没有名为 X 的技能,是否要我用 skillCreator 帮你创建一个?」,**必须等用户确认后**才调 skillCreator\n" +
    "   b) 「使用 / 调用 / 跑一下」是**调用**意图,不是**创建**意图,即使工具列表里没有也不能擅自调 skillCreator 创建\n" +
    "   c) 技能名识别小技巧:用户口语里的「回声」可能对应工具名 echo / Echo / 回声;「检索资料」可能对应 searchKnowledgeBase;先做意图归一再查工具\n" +
    "0b. 用户消息里明确说「创建 / 新建 / 添加一个叫 X 的技能」「帮我做一个技能」「新增 skill」「再加一个回声技能」→ 才调 skillCreator(action=\"create\")\n" +
    "0c. 用户消息里说「修改 / 改一下 / 调整 / 更新 X 技能」→ 调 skillCreator(action=\"update\", skillId=..., updatesJson=...)\n" +
    "0d. 用户消息里说「删除 / 移除 X 技能」→ 提示用户走 Dashboard「设置 → 技能管理」手动删除,AI 端不直接调删除工具\n" +
    "0e. 用户消息与技能管理无关(闲聊 / 业务咨询 / 千川数据 / 知识库查询 / 报表分析等)→ 跳过本节,进入下方 KB / 千川路由\n\n" +
    "技能调用原则 (仅当上面 0e 命中,即用户问的是知识/数据类问题时才适用):\n" +
    "1. 优先用 searchKnowledgeBase 检索候选资料(query 用中文关键词或原问题,且**必须保留原文里的产品名/品牌名/数据专有名词**,如「鱼子酱」「抖音」「直播间」「鱼子酱洗发露」);\n" +
    "2. 若 searchKnowledgeBase 返回的【资料】片段不够用,调用 getAssetDetail 拉取完整正文(assetId 取自 matchedIds);\n" +
    "3. 工具返回的 content 已经是格式化好的资料片段,可以直接引用其中的事实。\n" +
    "4. 回答时不要重复整段资料原文;只用其中与用户问题相关的关键事实。\n" +
    "5. 【必看】按问题类型选 assetType 过滤——这是避免被不相关类目挤出 top 5 的关键:\n" +
    "   - 涉及金额/消耗/数据/统计/概况/汇总/成交/报表/销量/订单/同比/环比 → 传 assetType:\"excel\"\n" +
    "   - 涉及产品外观/包装/材质/尺寸/颜色/白底图/主图 → 传 assetType:\"product_white_image\"\n" +
    "   - 涉及合同/条款/规范/制度/说明书 → 传 assetType:\"pdf\" 或 \"document\"\n" +
    "   - 涉及演示/培训/介绍/方案/PPT → 传 assetType:\"ppt\"\n" +
    "   - 涉及提示词/prompt → 传 assetType:\"prompt\"\n" +
    "   - 拿不准就**不要传** assetType,让 searchKnowledgeBase 综合打分。";
  return base + (includeQianchuan ? "\n" + QIANCHUAN_RULE : "") + THINKING_INSTRUCTION;
}

const SKILL_SYSTEM_PROMPT = buildSkillSystemPrompt(true);

const QIANCHUAN_FALLBACK_INSTRUCTION =
  "【千川技能失败的最终答案规则】当前上下文的工具结果如果包含 [qianchuan...] 执行失败 的内容（无论失败原因是 unknown_anchor_name、OceanEngine 错误码、频率超限、下游服务异常等），请直接面向用户输出下面的最终答案结构：\n\n" +
  "## ⚠️ 千川实时数据接口暂时无法获取\n\n" +
  "**失败原因**：<把 error 用一句话转成人话，比如「抖音号名册里没有『<名称>』」「巨量千川接口返回『<原文>』错误」>\n\n" +
  "**知识库兜底结果**：<一句话告诉用户本次是否从知识库找到相关资料；如有就列 1-3 条最相关的事实；如无就说「知识库里也未找到与『<关键词>』相关的资料」>\n\n" +
  "**建议下一步**：\n" +
  "1. <具体下一步建议，比如「请稍后 1-2 分钟重试」「让管理员到 设置 → 千川接入 检查 token 是否过期」「提供该抖音号的 19 位 anchor_id 以走实时接口」「管理员在 设置 → 千川接入 → 抖音号名册导入 上传映射」>\n" +
  "2. <另一条建议>\n\n" +
  "【严禁】在答案区出现以下表达：\n" +
  "  - 「按照【...】规则」「按规则要求」「按下面三段」之类的元说明——规则不需要向用户复述\n" +
  "  - 「让我尝试」「让我先看看」「我需要」「从搜索结果中」之类的过程性描述\n" +
  "  - 把 error 字符串原封不动抄到答案里——必须用人话转述\n" +
  "  - 没有 ## 标题直接开头——必须用上面给的二级标题开头";

const ANSWER_SYSTEM_PROMPT = (context: string) =>
  context
    ? `你是电商视觉与内容助手，请严格依据下方知识库资料回答用户问题；如果资料不足，请明确说明。${THINKING_INSTRUCTION}\n${QIANCHUAN_FALLBACK_INSTRUCTION}\n\n知识库资料：\n${context}`
    : `你是电商视觉与内容助手。请直接回答用户问题；只有用户明确要求参考知识库时，才说明需要选择或调用知识库资料。${THINKING_INSTRUCTION}\n${QIANCHUAN_FALLBACK_INSTRUCTION}`;

export async function runChatWithSkills(
  input: ChatRunnerInput,
  emit: (chunk: ChatRunnerChunk) => void
): Promise<ChatRunnerResult> {
  const { client, message, history, context, tools, ctx, isSkillPath, useQianchuan = true } = input;
  const skillCalls: SkillCallRecord[] = [];
  const usedAssetIds = new Set<string>();
  let skillContext = "";
  const usage: ChatRunnerUsage = {};
  // 兜底轮 (千川失败后自动 searchKnowledgeBase) 的工具调用与结果,
  // 需要在 Round 2 messages 里复用, 所以提到函数级作用域.
  let fallbackCalls: ToolCallAccumulator[] = [];
  let fallbackToolResults: ToolResultWithCall[] = [];

  const recordUsage = (u: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cached_tokens?: number }) => {
    if (u.prompt_tokens !== undefined) usage.promptTokens = u.prompt_tokens;
    if (u.completion_tokens !== undefined) usage.completionTokens = u.completion_tokens;
    if (u.total_tokens !== undefined) usage.totalTokens = u.total_tokens;
    if (u.cached_tokens !== undefined) usage.cachedTokens = u.cached_tokens;
  };

  if (!isSkillPath) {
    let legacyBuffer = "";
    const stripper = createHeadingStripper();
    for await (const chunk of client.chatStream(message, context, history)) {
      if (chunk.type === "text") {
        const out = stripper.feed(chunk.text);
        if (out != null) {
          legacyBuffer += out;
          emit({ type: "text", text: out });
        }
      } else if (chunk.type === "usage") {
        recordUsage(chunk.usage);
      } else if (chunk.type === "error") {
        const flushed = stripper.flush();
        if (flushed) {
          legacyBuffer += flushed;
          emit({ type: "text", text: flushed });
        }
        return {
          answer: legacyBuffer,
          usage,
          skillCalls,
          skillContext,
          usedAssetIds: Array.from(usedAssetIds),
          error: { error: chunk.error, details: chunk.details as Record<string, unknown> | undefined }
        };
      }
    }
    return { answer: legacyBuffer, usage, skillCalls, skillContext, usedAssetIds: Array.from(usedAssetIds) };
  }

  // 路径 B：先让模型自由决定是否调用技能
  const roundOneMessages: ChatMessage[] = [
    { role: "system", content: buildSkillSystemPrompt(useQianchuan) },
    ...history.map((item) => ({ role: item.role as "user" | "assistant", content: item.content })),
    { role: "user", content: message }
  ];

  let firstBuffer = "";
  const firstCalls: ToolCallAccumulator[] = [];
  for await (const chunk of client.chatStream(message, undefined, history, {
    tools,
    toolChoice: "auto",
    messages: roundOneMessages
  })) {
    if (chunk.type === "text") {
      firstBuffer += chunk.text;
    } else if (chunk.type === "tool_calls") {
      firstCalls.push(...chunk.calls);
    } else if (chunk.type === "usage") {
      recordUsage(chunk.usage);
    } else if (chunk.type === "error") {
      return {
        answer: "",
        usage,
        skillCalls,
        skillContext,
        usedAssetIds: Array.from(usedAssetIds),
        error: { error: chunk.error, details: chunk.details as Record<string, unknown> | undefined }
      };
    }
  }

  if (!firstCalls.length) {
    if (firstBuffer) emit({ type: "text", text: firstBuffer });
    return { answer: firstBuffer, usage, skillCalls, skillContext, usedAssetIds: Array.from(usedAssetIds) };
  }

  // 执行技能
  type ToolResultWithCall = {
    callId: string;
    name: string;
    ok: boolean;
    content: string;
    error?: string;
    meta?: Record<string, unknown>;
    call: ToolCallAccumulator;
  };
  const toolResults: ToolResultWithCall[] = [];
  for (const call of firstCalls) {
    let args: Record<string, unknown> = {};
    try {
      args = call.arguments ? JSON.parse(call.arguments) : {};
    } catch {
      args = {};
    }
    const skill = await getSkill(call.name);
    if (!skill) {
      toolResults.push({
        callId: call.id,
        name: call.name,
        ok: false,
        content: `未知技能：${call.name}`,
        error: "unknown_skill",
        call
      });
      continue;
    }
    try {
      const result = await skill.execute(args, ctx);
      toolResults.push({ ...result, callId: call.id, call });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toolResults.push({ callId: call.id, name: call.name, ok: false, content: "", error: message, call });
    }
  }

  // 收集 used asset ids
  for (const result of toolResults) {
    const ids = (result.meta?.matchedIds as string[] | undefined) || [];
    for (const id of ids) usedAssetIds.add(id);
  }

  // 拼接 skill context
  const contextSections: string[] = [];
  for (const result of toolResults) {
    if (result.ok && result.content) {
      contextSections.push(`[${result.name}]\n${result.content}`);
    } else if (result.error) {
      contextSections.push(`[${result.name}] 执行失败：${result.error}`);
    }
  }
  skillContext = contextSections.join("\n\n");

  // 记录 skill calls
  for (const result of toolResults) {
    const matchedIds = (result.meta?.matchedIds as string[] | undefined) || undefined;
    const matchedAssets = (result.meta?.matchedAssets as Array<{ id: string; assetName: string; assetType: string }> | undefined) || undefined;
    skillCalls.push({
      id: result.callId,
      name: result.name,
      arguments: safeParseArgs(result.call.arguments),
      result: result.content,
      ok: result.ok,
      error: result.error,
      meta: result.meta,
      matchedIds,
      matchedAssets
    });
  }
  emit({ type: "skill", calls: skillCalls, contextChars: skillContext.length });

  // 兜底：如果千川 skill 失败，自动加一轮让模型主动 KB 检索
  const qianchuanFailed = toolResults.some(
    (r) => !r.ok && /^qianchuan/i.test(r.name)
  );
  if (qianchuanFailed) {
    const fallbackMessages: ChatMessage[] = [
      { role: "system", content: buildSkillSystemPrompt(useQianchuan) },
      ...history.map((item) => ({ role: item.role as "user" | "assistant", content: item.content })),
      { role: "user", content: message },
      {
        role: "assistant",
        content: null,
        tool_calls: firstCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: call.arguments }
        }))
      },
      ...toolResults.map((result) => ({
        role: "tool" as const,
        tool_call_id: result.callId,
        content: result.ok ? result.content : `执行失败：${result.error || "unknown"}`
      })),
      {
        role: "user",
        content:
          "上一步千川实时数据接口调用失败。请你**立即调用 searchKnowledgeBase 工具**，" +
          "用用户问题里的关键词（抖音号名称、品牌、品类、时间范围）作为 query 检索知识库，" +
          "看是否有相关历史资料。然后基于检索结果给出最终答案。"
      }
    ];
    fallbackCalls = [];
    fallbackToolResults = [];
    let fallbackBuffer = "";
    for await (const chunk of client.chatStream(message, undefined, [], {
      tools,
      toolChoice: "auto",
      messages: fallbackMessages
    })) {
      if (chunk.type === "text") {
        fallbackBuffer += chunk.text;
      } else if (chunk.type === "tool_calls") {
        fallbackCalls.push(...chunk.calls);
      } else if (chunk.type === "usage") {
        recordUsage(chunk.usage);
      } else if (chunk.type === "error") {
        break;
      }
    }
    // 执行兜底工具调用（一般是 searchKnowledgeBase）
    for (const call of fallbackCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = call.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        args = {};
      }
      const skill = await getSkill(call.name);
      if (!skill) continue;
      try {
        const result = await skill.execute(args, ctx);
        const matchedIds = (result.meta?.matchedIds as string[] | undefined) || [];
        for (const id of matchedIds) usedAssetIds.add(id);
        const matchedAssets = (result.meta?.matchedAssets as Array<{ id: string; assetName: string; assetType: string }> | undefined) || undefined;
        skillCalls.push({
          id: call.id,
          name: result.name,
          arguments: args,
          result: result.content,
          ok: result.ok,
          error: result.error,
          meta: result.meta,
          matchedIds: matchedIds.length ? matchedIds : undefined,
          matchedAssets
        });
        if (result.ok && result.content) {
          contextSections.push(`[${result.name}]\n${result.content}`);
        }
        // 用 LLM 生成的 call.id 作 tool_call_id (assistant.tool_calls[].id 必须与 tool.tool_call_id 一致)
        fallbackToolResults.push({ ...result, callId: call.id, call });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        skillCalls.push({
          id: call.id,
          name: call.name,
          arguments: args,
          result: "",
          ok: false,
          error: msg
        });
        fallbackToolResults.push({
          callId: call.id,
          name: call.name,
          ok: false,
          content: "",
          error: msg,
          call
        });
      }
    }
    skillContext = contextSections.join("\n\n");
    if (fallbackCalls.length) {
      emit({ type: "skill", calls: skillCalls.slice(-fallbackCalls.length), contextChars: skillContext.length });
    }
    if (fallbackBuffer) emit({ type: "text", text: fallbackBuffer });
  }

  // 第二次 LLM 调用
  const roundTwoMessages: ChatMessage[] = [
    { role: "system", content: ANSWER_SYSTEM_PROMPT(skillContext) },
    ...history.map((item) => ({ role: item.role as "user" | "assistant", content: item.content })),
    { role: "user", content: message },
    {
      role: "assistant",
      content: null,
      tool_calls: firstCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments }
      }))
    },
    ...toolResults.map((result) => ({
      role: "tool" as const,
      tool_call_id: result.callId,
      content: result.ok ? result.content : `执行失败：${result.error || "unknown"}`
    })),
    // 兜底轮 (千川失败后让模型主动 KB 检索): 把 searchKnowledgeBase 的结果作为 tool 消息注入 Round 2,
    // 否则 LLM 看不到 KB 数据, 会再次空答.
    ...(fallbackToolResults.length
      ? [
          {
            role: "assistant" as const,
            content: null,
            tool_calls: fallbackCalls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: call.arguments }
            }))
          },
          ...fallbackToolResults.map((result) => ({
            role: "tool" as const,
            tool_call_id: result.callId,
            content: result.ok ? result.content : `执行失败：${result.error || "unknown"}`
          })),
          {
            role: "user" as const,
            content:
              "上面是 searchKnowledgeBase 工具的检索结果 (兜底轮, 在千川实时接口失败后调用)." +
              "请你**严格基于这份知识库资料 + 上一轮失败原因**给出最终答案." +
              "如果知识库资料能回答用户问题, 直接给完整答案 (包含数据);" +
              "如果知识库资料不足, 按【千川技能失败的最终答案规则】说明 + 给下一步建议." +
              "无论哪种情况都必须输出 ## 二级标题开头的答案正文, 不能空."
          }
        ]
      : [])
  ];

  let secondBuffer = "";
  const answerStripper = createHeadingStripper();
  for await (const chunk of client.chatStream(message, undefined, [], {
    tools,
    toolChoice: "auto",
    messages: roundTwoMessages
  })) {
    if (chunk.type === "text") {
      const out = answerStripper.feed(chunk.text);
      if (out != null) {
        secondBuffer += out;
        emit({ type: "text", text: out });
      }
    } else if (chunk.type === "usage") {
      recordUsage(chunk.usage);
    } else if (chunk.type === "error") {
      const flushed = answerStripper.flush();
      if (flushed) {
        secondBuffer += flushed;
        emit({ type: "text", text: flushed });
      }
      return {
        answer: secondBuffer,
        usage,
        skillCalls,
        skillContext,
        usedAssetIds: Array.from(usedAssetIds),
        error: { error: chunk.error, details: chunk.details as Record<string, unknown> | undefined }
      };
    }
  }
  const finalFlushed = answerStripper.flush();
  if (finalFlushed) {
    secondBuffer += finalFlushed;
    emit({ type: "text", text: finalFlushed });
  }
  return { answer: secondBuffer, usage, skillCalls, skillContext, usedAssetIds: Array.from(usedAssetIds) };
}

function safeParseArgs(raw: string) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

// 兜底裁剪：模型（MiniMax M3）经常不输出 <think> 标签，直接把"让我梳理一下…""按要求用##输出"等
// 思考性内容铺在 ## 之前，会被前端的 extractByMarkdownHeading 包成"思考过程"折叠块。
// 服务端按首个 ## 标题行裁掉前置内容，保证 emit 出去的第一个文本就是答案。
// 正则用 (?<!#)##\s 匹配任何位置的 "## "（避免行中"让我整理成报告。## 标题"漏掉），
// 用 (?<!#) 负向回顾排除 ###（子标题）的第一个 ## 被误吃。
const HEADING_RE = /(?<!#)##\s/;
function createHeadingStripper() {
  let seenHeading = false;
  let pending = "";
  return {
    feed(text: string): string | null {
      if (seenHeading) return text;
      pending += text;
      const match = pending.match(HEADING_RE);
      if (!match) return null;
      seenHeading = true;
      const after = pending.slice(match.index);
      pending = "";
      return after || null;
    },
    flush(): string | null {
      if (seenHeading) return null;
      const rest = pending;
      pending = "";
      seenHeading = true;
      return rest || null;
    },
    reset() {
      seenHeading = false;
      pending = "";
    }
  };
}
