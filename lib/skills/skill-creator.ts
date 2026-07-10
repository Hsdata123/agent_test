import { getEffectiveDepartmentId } from "../dept-scope";
import {
  createUserSkillServer,
  parseCreateInput,
  updateUserSkillServer
} from "./management";
import type { Skill, SkillContext, SkillResult } from "./types";

const DESCRIPTION = [
  "创建或修改一个用户自定义技能。",
  "入口 A: 用户口述需求 (例如「帮我做一个产品白底图检索的技能,参数是 query,模式 search_kb, 配置 queryParam 映射到 query」),你综合出 name/displayName/description/parameters/executeMode/executeConfig 后调用 action=create;",
  "入口 B: 用户粘贴了一份完整 JSON 配置,你解析后组装成 parametersJson/executeConfigJson 再调用 action=create;",
  "action=update 用于修改现有技能,需要 skillId + updatesJson。",
  "权限继承调用者本人 (admin 全局, creator 仅本部门, 其他角色会被拒绝并返 403)。",
  "支持的 executeMode: search_kb / get_detail / no_op / exec_function。",
  "exec_function 用于跑真实 Python 副作用逻辑 (写文件、查系统时间等), executeConfig 必须是 {\"handler\": \"<Python 源码, 必须定义 def handler(**kwargs) -> dict>\"}。",
  "handler 受限沙箱: 5s 超时 / 256MB 内存 / 文件操作仅限 ./skill_sandbox/ / 无网络 / 禁用 socket subprocess ctypes 等。",
  "只有用户明确要求「创建/修改/新增/调整一个技能」时才应调用本技能。"
].join(" ");

export const skillCreatorSkill: Skill = {
  definition: {
    name: "skillCreator",
    description: DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "update"],
          description: "create=新建技能; update=修改现有技能 (需提供 skillId + updatesJson)"
        },
        // ---- create 字段 ----
        name: {
          type: "string",
          description: "create 必填。英文标识,字母开头,只含字母/数字/下划线;不能与内置技能同名"
        },
        displayName: {
          type: "string",
          description: "create 必填。中式显示名,如「产品白底图检索」"
        },
        description: {
          type: "string",
          description: "create 必填。技能功能描述 (用于告诉大模型何时调用本技能)"
        },
        parametersJson: {
          type: "string",
          description: 'create 必填。完整的 OpenAI function parameters JSON 字符串,例如 {"type":"object","properties":{"query":{"type":"string","description":"检索关键词"}},"required":["query"]}'
        },
        executeMode: {
          type: "string",
          enum: ["search_kb", "get_detail", "no_op", "exec_function"],
          description: "create 必填。执行模式"
        },
        executeConfigJson: {
          type: "string",
          description: 'create 必填。执行配置 JSON 字符串。search_kb→{queryParam}; get_detail→{assetIdParam}; no_op→{template} (template 内可用 {{args.x}} 占位符); exec_function→{handler: "<Python 源码, 必须定义 def handler(**kwargs) -> dict>"}'
        },
        systemPrompt: {
          type: "string",
          description: "可选,技能输出前的包装 prompt"
        },
        departmentId: {
          type: "string",
          description: "【系统忽略此字段】技能强制归属到当前用户所属部门 (creator 角色: 本部门; admin: 全局可见但仍归属本人 dept)。LLM 不要传值,传了也会被覆盖——避免幻觉出 'echo-team' 这类不存在的部门 id 导致数据库外键冲突。"
        },
        // ---- update 字段 ----
        skillId: {
          type: "string",
          description: "action=update 必填,目标技能 id"
        },
        updatesJson: {
          type: "string",
          description: 'action=update 必填。JSON 对象 (字符串形式),允许的键: name / displayName / description / executeMode / executeConfigJson / parametersJson / systemPrompt / enabled / departmentId'
        },
        // ---- 审计 ----
        intent: {
          type: "string",
          description: "用户原始意图描述,会回显在 result.content 中便于审计"
        }
      },
      required: ["action"]
    }
  },
  async execute(args, ctx): Promise<SkillResult> {
    const action = String(args.action || "");
    try {
      if (action === "create") return await handleCreate(args, ctx);
      if (action === "update") return await handleUpdate(args, ctx);
      return errResult(`未知 action: ${action}`, "invalid_action");
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      const message = error instanceof Error ? error.message : String(error);
      return {
        callId: "",
        name: "skillCreator",
        ok: false,
        content: "",
        error: message,
        meta: { action, httpStatus: status || 500 }
      };
    }
  }
};

async function handleCreate(args: Record<string, unknown>, ctx: SkillContext): Promise<SkillResult> {
  const params = parseCreateInput(args as Record<string, unknown>);
  // 强制归属到当前用户部门,无视 LLM 传入的 departmentId (避免幻觉部门名触发 FK 违反)
  params.departmentId = getEffectiveDepartmentId(ctx.user);
  const summary = await createUserSkillServer(params, ctx.user as never);
  const intentSuffix = stringOrEmpty(args.intent) ? `。用户原始意图: ${stringOrEmpty(args.intent)}` : "";
  return {
    callId: "",
    name: "skillCreator",
    ok: true,
    content: `已创建技能「${summary.displayName}」(name=${summary.name}, id=${summary.id}, mode=${summary.executeMode})${intentSuffix}`,
    meta: {
      action: "create",
      skillId: summary.id,
      skillName: summary.name,
      displayName: summary.displayName,
      executeMode: summary.executeMode,
      departmentId: summary.departmentId
    }
  };
}

async function handleUpdate(args: Record<string, unknown>, ctx: SkillContext): Promise<SkillResult> {
  const skillId = String(args.skillId || "").trim();
  if (!skillId) {
    return errResult("skillId 必填", "missing_skill_id");
  }
  const rawUpdates = args.updatesJson;
  let parsed: Record<string, unknown>;
  if (typeof rawUpdates === "string") {
    try {
      parsed = JSON.parse(rawUpdates);
    } catch (error) {
      return errResult(`updatesJson 不是合法 JSON: ${(error as Error).message}`, "invalid_json");
    }
  } else if (rawUpdates && typeof rawUpdates === "object") {
    parsed = rawUpdates as Record<string, unknown>;
  } else {
    return errResult("updatesJson 必填且必须是 JSON 字符串或对象", "missing_updates");
  }
  const summary = await updateUserSkillServer(skillId, parsed, ctx.user as never);
  const intentSuffix = stringOrEmpty(args.intent) ? `。用户原始意图: ${stringOrEmpty(args.intent)}` : "";
  return {
    callId: "",
    name: "skillCreator",
    ok: true,
    content: `已更新技能 ${summary.id}, 改动字段: ${summary.updatedFields.join(", ")}${intentSuffix}`,
    meta: {
      action: "update",
      skillId: summary.id,
      updatedFields: summary.updatedFields
    }
  };
}

function errResult(message: string, code: string = "skill_creator_error"): SkillResult {
  return {
    callId: "",
    name: "skillCreator",
    ok: false,
    content: "",
    error: message,
    meta: { code }
  };
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
