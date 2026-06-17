import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, "dev.db");
mkdirSync(here, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS User (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  passwordHash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'creator',
  status TEXT NOT NULL DEFAULT 'active',
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  lastLoginAt DATETIME
);

CREATE TABLE IF NOT EXISTS Session (
  id TEXT PRIMARY KEY NOT NULL,
  tokenHash TEXT NOT NULL UNIQUE,
  userId TEXT NOT NULL,
  expiresAt DATETIME NOT NULL,
  createdAt DATETIME NOT NULL,
  CONSTRAINT Session_userId_fkey FOREIGN KEY (userId) REFERENCES User (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS Project (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  coverUrl TEXT,
  creatorId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  CONSTRAINT Project_creatorId_fkey FOREIGN KEY (creatorId) REFERENCES User (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS ProjectMember (
  id TEXT PRIMARY KEY NOT NULL,
  projectId TEXT NOT NULL,
  userId TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  createdAt DATETIME NOT NULL,
  CONSTRAINT ProjectMember_projectId_fkey FOREIGN KEY (projectId) REFERENCES Project (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ProjectMember_userId_fkey FOREIGN KEY (userId) REFERENCES User (id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS ProjectMember_projectId_userId_key ON ProjectMember(projectId, userId);

CREATE TABLE IF NOT EXISTS KnowledgeAsset (
  id TEXT PRIMARY KEY NOT NULL,
  assetName TEXT NOT NULL,
  originalName TEXT NOT NULL,
  assetType TEXT NOT NULL,
  productName TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  aliases TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  storagePath TEXT NOT NULL,
  mimeType TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  preferred BOOLEAN NOT NULL DEFAULT false,
  vectorStatus TEXT NOT NULL DEFAULT 'pending',
  extractedText TEXT,
  createdById TEXT NOT NULL,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  CONSTRAINT KnowledgeAsset_createdById_fkey FOREIGN KEY (createdById) REFERENCES User (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS ProductAlias (
  id TEXT PRIMARY KEY NOT NULL,
  alias TEXT NOT NULL,
  assetId TEXT NOT NULL,
  createdAt DATETIME NOT NULL,
  CONSTRAINT ProductAlias_assetId_fkey FOREIGN KEY (assetId) REFERENCES KnowledgeAsset (id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS ProductAlias_alias_assetId_key ON ProductAlias(alias, assetId);

CREATE TABLE IF NOT EXISTS MechanismParse (
  id TEXT PRIMARY KEY NOT NULL,
  projectId TEXT NOT NULL,
  rawMechanism TEXT NOT NULL,
  price REAL NOT NULL,
  productSummary TEXT NOT NULL,
  parseStatus TEXT NOT NULL DEFAULT 'success',
  errorMessage TEXT,
  createdById TEXT NOT NULL,
  createdAt DATETIME NOT NULL,
  CONSTRAINT MechanismParse_projectId_fkey FOREIGN KEY (projectId) REFERENCES Project (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT MechanismParse_createdById_fkey FOREIGN KEY (createdById) REFERENCES User (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS MechanismItem (
  id TEXT PRIMARY KEY NOT NULL,
  parseId TEXT NOT NULL,
  productName TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  matchedAssetId TEXT,
  matchType TEXT NOT NULL DEFAULT 'none',
  matchScore REAL NOT NULL DEFAULT 0,
  CONSTRAINT MechanismItem_parseId_fkey FOREIGN KEY (parseId) REFERENCES MechanismParse (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT MechanismItem_matchedAssetId_fkey FOREIGN KEY (matchedAssetId) REFERENCES KnowledgeAsset (id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS GenerationTask (
  id TEXT PRIMARY KEY NOT NULL,
  projectId TEXT NOT NULL,
  parseId TEXT NOT NULL,
  createdById TEXT NOT NULL,
  outputType TEXT NOT NULL,
  aspectRatio TEXT NOT NULL,
  detailPageCount INTEGER,
  imageCount INTEGER NOT NULL DEFAULT 1,
  templateAssetId TEXT,
  imageSize TEXT,
  imageQuality TEXT,
  prompt TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  failureReason TEXT,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  CONSTRAINT GenerationTask_projectId_fkey FOREIGN KEY (projectId) REFERENCES Project (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT GenerationTask_parseId_fkey FOREIGN KEY (parseId) REFERENCES MechanismParse (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT GenerationTask_createdById_fkey FOREIGN KEY (createdById) REFERENCES User (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS GenerationResult (
  id TEXT PRIMARY KEY NOT NULL,
  taskId TEXT NOT NULL,
  projectId TEXT NOT NULL,
  imagePath TEXT NOT NULL,
  pageIndex INTEGER,
  width INTEGER,
  height INTEGER,
  prompt TEXT,
  createdAt DATETIME NOT NULL,
  CONSTRAINT GenerationResult_taskId_fkey FOREIGN KEY (taskId) REFERENCES GenerationTask (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT GenerationResult_projectId_fkey FOREIGN KEY (projectId) REFERENCES Project (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS ApiConfig (
  id TEXT PRIMARY KEY NOT NULL DEFAULT 'singleton',
  textBaseUrl TEXT NOT NULL DEFAULT 'https://token.ithinkai.cn/v1',
  textModel TEXT NOT NULL DEFAULT 'gpt-5.5-token',
  textWireApi TEXT NOT NULL DEFAULT 'responses',
  textPromptCacheEnabled BOOLEAN NOT NULL DEFAULT 1,
  textPromptCacheRetention TEXT NOT NULL DEFAULT '24h',
  textPromptCacheKey TEXT NOT NULL DEFAULT 'commerce-chat',
  disableResponseStorage BOOLEAN NOT NULL DEFAULT 1,
  imageBaseUrl TEXT NOT NULL DEFAULT 'https://token.ithinkai.cn/v1',
  imageModel TEXT NOT NULL DEFAULT 'gpt-image-2',
  embeddingModel TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  maxConcurrency INTEGER NOT NULL DEFAULT 1,
  retryCount INTEGER NOT NULL DEFAULT 2,
  timeoutSeconds INTEGER NOT NULL DEFAULT 240,
  updatedAt DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS ChatUsage (
  id TEXT PRIMARY KEY NOT NULL,
  userId TEXT NOT NULL,
  promptTokens INTEGER NOT NULL DEFAULT 0,
  completionTokens INTEGER NOT NULL DEFAULT 0,
  totalTokens INTEGER NOT NULL DEFAULT 0,
  cachedTokens INTEGER NOT NULL DEFAULT 0,
  estimatedCost REAL NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL,
  CONSTRAINT ChatUsage_userId_fkey FOREIGN KEY (userId) REFERENCES User (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS ChatProject (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  createdById TEXT NOT NULL,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  CONSTRAINT ChatProject_createdById_fkey FOREIGN KEY (createdById) REFERENCES User (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS ChatConversation (
  id TEXT PRIMARY KEY NOT NULL,
  projectId TEXT NOT NULL,
  title TEXT NOT NULL,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  CONSTRAINT ChatConversation_projectId_fkey FOREIGN KEY (projectId) REFERENCES ChatProject (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS ChatMessage (
  id TEXT PRIMARY KEY NOT NULL,
  conversationId TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  createdAt DATETIME NOT NULL,
  CONSTRAINT ChatMessage_conversationId_fkey FOREIGN KEY (conversationId) REFERENCES ChatConversation (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS Department (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  code TEXT UNIQUE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS BusinessScene (
  id TEXT PRIMARY KEY NOT NULL,
  departmentId TEXT NOT NULL,
  sceneKey TEXT NOT NULL,
  sceneName TEXT NOT NULL,
  description TEXT,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  CONSTRAINT BusinessScene_departmentId_fkey FOREIGN KEY (departmentId) REFERENCES Department (id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS BusinessScene_departmentId_sceneKey_key ON BusinessScene(departmentId, sceneKey);

CREATE TABLE IF NOT EXISTS Skill (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  displayName TEXT NOT NULL,
  description TEXT NOT NULL,
  parameters TEXT NOT NULL DEFAULT '{"type":"object","properties":{},"required":[]}',
  executeMode TEXT NOT NULL DEFAULT 'search_kb',
  executeConfig TEXT NOT NULL DEFAULT '{}',
  systemPrompt TEXT,
  enabled BOOLEAN NOT NULL DEFAULT 1,
  departmentId TEXT,
  createdById TEXT,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  deletedAt DATETIME,
  CONSTRAINT Skill_departmentId_fkey FOREIGN KEY (departmentId) REFERENCES Department (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT Skill_createdById_fkey FOREIGN KEY (createdById) REFERENCES User (id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS Skill_departmentId_idx ON Skill(departmentId);
CREATE INDEX IF NOT EXISTS Skill_deletedAt_idx ON Skill(deletedAt);
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("GenerationTask", "templateAssetId", "TEXT");
ensureColumn("GenerationTask", "imageSize", "TEXT");
ensureColumn("GenerationTask", "imageQuality", "TEXT");
ensureColumn("GenerationTask", "knowledgeEnhanced", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("ApiConfig", "textWireApi", "TEXT NOT NULL DEFAULT 'responses'");
ensureColumn("ApiConfig", "textPromptCacheEnabled", "BOOLEAN NOT NULL DEFAULT 1");
ensureColumn("ApiConfig", "textPromptCacheRetention", "TEXT NOT NULL DEFAULT '24h'");
ensureColumn("ApiConfig", "textPromptCacheKey", "TEXT NOT NULL DEFAULT 'commerce-chat'");
ensureColumn("ApiConfig", "disableResponseStorage", "BOOLEAN NOT NULL DEFAULT 1");
ensureColumn("ChatUsage", "cachedTokens", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("User", "departmentId", "TEXT");
ensureColumn("KnowledgeAsset", "departmentId", "TEXT");
ensureColumn("KnowledgeAsset", "scenes", "TEXT NOT NULL DEFAULT '[]'");

const defaultDeptRow = db.prepare("SELECT id FROM Department WHERE id = ?").get("dept_default");
if (!defaultDeptRow) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO Department (id, name, code, description, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("dept_default", "默认部门", "default", "系统初始部门，可重命名或新增其他部门", "active", now, now);
}

db.exec("UPDATE User SET departmentId = 'dept_default' WHERE departmentId IS NULL");
db.exec("UPDATE KnowledgeAsset SET departmentId = 'dept_default' WHERE departmentId IS NULL");
db.exec("UPDATE KnowledgeAsset SET scenes = '[]' WHERE scenes IS NULL OR scenes = ''");

db.close();
console.log(`SQLite database is ready: ${dbPath}`);
