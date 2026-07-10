import { prisma } from "./prisma";

export type ChatProjectRow = {
  id: string;
  name: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatConversationRow = {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  prefsJson?: string | null;
};

export type ChatMessageRow = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  processLog?: string | null;
  finalDebug?: string | null;
  finalAssets?: string | null;
};

export async function ensureChatWorkspaceTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ChatProject (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      createdById TEXT NOT NULL,
      createdAt DATETIME NOT NULL,
      updatedAt DATETIME NOT NULL,
      CONSTRAINT ChatProject_createdById_fkey FOREIGN KEY (createdById) REFERENCES User (id) ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ChatConversation (
      id TEXT PRIMARY KEY NOT NULL,
      projectId TEXT NOT NULL,
      title TEXT NOT NULL,
      prefsJson TEXT,
      createdAt DATETIME NOT NULL,
      updatedAt DATETIME NOT NULL,
      CONSTRAINT ChatConversation_projectId_fkey FOREIGN KEY (projectId) REFERENCES ChatProject (id) ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ChatMessage (
      id TEXT PRIMARY KEY NOT NULL,
      conversationId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt DATETIME NOT NULL,
      CONSTRAINT ChatMessage_conversationId_fkey FOREIGN KEY (conversationId) REFERENCES ChatConversation (id) ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  // 增量迁移: 旧表无 processLog/finalDebug/finalAssets/prefsJson, 加上去 (SQLite JSON 列 = TEXT)
  await addColumnIfMissing("ChatMessage", "processLog", "TEXT");
  await addColumnIfMissing("ChatMessage", "finalDebug", "TEXT");
  await addColumnIfMissing("ChatMessage", "finalAssets", "TEXT");
  await addColumnIfMissing("ChatConversation", "prefsJson", "TEXT");
}

async function addColumnIfMissing(table: string, column: string, type: string) {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch {
    // 列已存在, 忽略
  }
}

export async function getChatProjectForUser(projectId: string, userId: string) {
  await ensureChatWorkspaceTables();
  const rows = await prisma.$queryRawUnsafe<ChatProjectRow[]>(
    `SELECT * FROM ChatProject WHERE id = ? AND createdById = ? LIMIT 1`,
    projectId,
    userId
  );
  return rows[0] || null;
}

export async function getChatConversationForUser(conversationId: string, userId: string) {
  await ensureChatWorkspaceTables();
  const rows = await prisma.$queryRawUnsafe<Array<ChatConversationRow & { createdById: string }>>(
    `SELECT c.*, p.createdById
     FROM ChatConversation c
     JOIN ChatProject p ON p.id = c.projectId
     WHERE c.id = ? AND p.createdById = ?
     LIMIT 1`,
    conversationId,
    userId
  );
  return rows[0] || null;
}
