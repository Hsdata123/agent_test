import { prisma } from "../prisma";
import { getAssetDetailSkill } from "./asset-detail";
import { searchKnowledgeBaseSkill } from "./knowledge-base";
import type { Skill, SkillDefinition } from "./types";
import { toOpenAITool } from "./types";
import { buildUserSkill } from "./user-skill";

const BUILTIN: Record<string, Skill> = {
  [searchKnowledgeBaseSkill.definition.name]: searchKnowledgeBaseSkill,
  [getAssetDetailSkill.definition.name]: getAssetDetailSkill
};

const BUILTIN_NAMES = new Set(Object.keys(BUILTIN));

let cache: { skills: Map<string, Skill>; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5_000;

async function loadUserSkills(): Promise<Map<string, Skill>> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.skills;
  const rows = await prisma.skill.findMany({
    where: { deletedAt: null, enabled: true }
  });
  const map = new Map<string, Skill>();
  for (const row of rows) {
    if (BUILTIN_NAMES.has(row.name)) continue;
    const skill = buildUserSkill(row);
    if (skill) map.set(row.name, skill);
  }
  cache = { skills: map, expiresAt: now + CACHE_TTL_MS };
  return map;
}

export async function getSkill(name: string): Promise<Skill | undefined> {
  if (BUILTIN_NAMES.has(name)) return BUILTIN[name];
  const userSkills = await loadUserSkills();
  return userSkills.get(name);
}

export async function getSkillSync(name: string): Promise<Skill | undefined> {
  return getSkill(name);
}

export async function listSkills(): Promise<Skill[]> {
  const userSkills = await loadUserSkills();
  return [...Object.values(BUILTIN), ...userSkills.values()];
}

export async function listSkillDefinitions(): Promise<SkillDefinition[]> {
  const all = await listSkills();
  return all.map((skill) => skill.definition);
}

export async function listOpenAITools() {
  const all = await listSkills();
  return all.map(toOpenAITool);
}

export function invalidateSkillCache() {
  cache = null;
}

export function getBuiltinSkillNames() {
  return Array.from(BUILTIN_NAMES);
}
