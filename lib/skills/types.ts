import type { User } from "@prisma/client";

export type JsonSchemaType = "string" | "number" | "integer" | "boolean" | "array" | "object";

export type JsonSchema = {
  type: JsonSchemaType;
  description?: string;
  enum?: string[];
  items?: { type: JsonSchemaType };
  default?: unknown;
};

export type SkillDefinition = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, JsonSchema>;
    required: string[];
  };
};

export type SkillCall = {
  id: string;
  name: string;
  arguments: string;
};

export type SkillResult = {
  callId: string;
  name: string;
  ok: boolean;
  content: string;
  meta?: Record<string, unknown>;
  error?: string;
};

export type SkillContext = {
  user: Pick<User, "id" | "role" | "departmentId">;
};

export type Skill = {
  definition: SkillDefinition;
  execute(args: Record<string, unknown>, ctx: SkillContext): Promise<SkillResult>;
};

export function toOpenAITool(skill: Skill) {
  return {
    type: "function" as const,
    function: {
      name: skill.definition.name,
      description: skill.definition.description,
      parameters: skill.definition.parameters
    }
  };
}
