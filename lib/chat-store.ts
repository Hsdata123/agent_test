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
};

export type ChatMessageRow = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
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
