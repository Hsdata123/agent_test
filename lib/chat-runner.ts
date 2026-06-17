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
  "每次回答必须按下面的两段式输出,中间用一个空行隔开:\n\n" +
  "<think>\n" +
  "(这里只写你的内部思考:用户问的是什么、检索到哪些关键事实、推理步骤。不要写给用户看的结论。)\n" +
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
  "【严禁】在 <think> 之外写任何思考性、过渡性的话,例如「我找到了」「现在我可以」「从搜索结果中」等。所有这类内容必须放在 <think> 块内。\n" +
  "【严禁】答案区用 # 一级标题、### 三级标题或纯文字开头——必须用 ## 二级标题,否则会被前端判定为思考内容而隐藏。";

const SKILL_SYSTEM_PROMPT =
  "你是电商视觉与内容助手，可以使用以下技能来检索知识库资料，然后基于检索结果回答用户问题。\n" +
  "请先思考用户问题，再决定调用哪些技能；如果不需要参考知识库（例如闲聊、问模型能力本身），请直接回答。\n" +
  "技能调用原则：\n" +
  "1. 优先用 searchKnowledgeBase 检索候选资料（query 用中文关键词或原问题，且**必须保留原文里的产品名/品牌名/数据专有名词**，如「鱼子酱」「抖音」「直播间」「鱼子酱洗发露」）；\n" +
  "2. 若 searchKnowledgeBase 返回的【资料】片段不够用，调用 getAssetDetail 拉取完整正文（assetId 取自 matchedIds）；\n" +
  "3. 工具返回的 content 已经是格式化好的资料片段，可以直接引用其中的事实。\n" +
  "4. 回答时不要重复整段资料原文；只用其中与用户问题相关的关键事实。\n" +
  "5. 【必看】按问题类型选 assetType 过滤——这是避免被不相关类目挤出 top 5 的关键：\n" +
  "   - 涉及金额/消耗/数据/统计/概况/汇总/成交/报表/销量/订单/同比/环比 → 传 assetType:\"excel\"\n" +
  "   - 涉及产品外观/包装/材质/尺寸/颜色/白底图/主图 → 传 assetType:\"product_white_image\"\n" +
  "   - 涉及合同/条款/规范/制度/说明书 → 传 assetType:\"pdf\" 或 \"document\"\n" +
  "   - 涉及演示/培训/介绍/方案/PPT → 传 assetType:\"ppt\"\n" +
  "   - 涉及提示词/prompt → 传 assetType:\"prompt\"\n" +
  "   - 拿不准就**不要传** assetType，让 searchKnowledgeBase 综合打分。" +
  THINKING_INSTRUCTION;

const ANSWER_SYSTEM_PROMPT = (context: string) =>
  context
    ? `你是电商视觉与内容助手，请严格依据下方知识库资料回答用户问题；如果资料不足，请明确说明。${THINKING_INSTRUCTION}\n\n知识库资料：\n${context}`
    : `你是电商视觉与内容助手。请直接回答用户问题；只有用户明确要求参考知识库时，才说明需要选择或调用知识库资料。${THINKING_INSTRUCTION}`;

export async function runChatWithSkills(
  input: ChatRunnerInput,
  emit: (chunk: ChatRunnerChunk) => void
): Promise<ChatRunnerResult> {
  const { client, message, history, context, tools, ctx, isSkillPath } = input;
  const skillCalls: SkillCallRecord[] = [];
  const usedAssetIds = new Set<string>();
  let skillContext = "";
  const usage: ChatRunnerUsage = {};

  const recordUsage = (u: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cached_tokens?: number }) => {
    if (u.prompt_tokens !== undefined) usage.promptTokens = u.prompt_tokens;
    if (u.completion_tokens !== undefined) usage.completionTokens = u.completion_tokens;
    if (u.total_tokens !== undefined) usage.totalTokens = u.total_tokens;
    if (u.cached_tokens !== undefined) usage.cachedTokens = u.cached_tokens;
  };

  if (!isSkillPath) {
    let legacyBuffer = "";
    for await (const chunk of client.chatStream(message, context, history)) {
      if (chunk.type === "text") {
        legacyBuffer += chunk.text;
        emit({ type: "text", text: chunk.text });
      } else if (chunk.type === "usage") {
        recordUsage(chunk.usage);
      } else if (chunk.type === "error") {
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
    { role: "system", content: SKILL_SYSTEM_PROMPT },
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
    }))
  ];

  let secondBuffer = "";
  for await (const chunk of client.chatStream(message, undefined, [], {
    tools,
    toolChoice: "auto",
    messages: roundTwoMessages
  })) {
    if (chunk.type === "text") {
      secondBuffer += chunk.text;
      emit({ type: "text", text: chunk.text });
    } else if (chunk.type === "usage") {
      recordUsage(chunk.usage);
    } else if (chunk.type === "error") {
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
