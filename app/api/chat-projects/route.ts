import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { ensureChatWorkspaceTables } from "@/lib/chat-store";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await requireUser();
    await ensureChatWorkspaceTables();
    const projects = await prisma.$queryRawUnsafe<
      Array<{ id: string; name: string; createdAt: string; updatedAt: string }>
    >(
      `SELECT id, name, createdAt, updatedAt
       FROM ChatProject
       WHERE createdById = ?
       ORDER BY updatedAt DESC`,
      user.id
    );
    const conversations = await prisma.$queryRawUnsafe<
      Array<{ id: string; projectId: string; title: string; createdAt: string; updatedAt: string }>
    >(
      `SELECT c.id, c.projectId, c.title, c.createdAt, c.updatedAt
       FROM ChatConversation c
       JOIN ChatProject p ON p.id = c.projectId
       WHERE p.createdById = ?
       ORDER BY c.updatedAt DESC`,
      user.id
    );
    return NextResponse.json({
      success: true,
      projects: projects.map((project) => ({
        ...project,
        conversations: conversations.filter((conversation) => conversation.projectId === project.id)
      }))
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await ensureChatWorkspaceTables();
    const body = await request.json();
    const name = String(body.name || "").trim();
    if (!name) throw Object.assign(new Error("请输入项目名称"), { status: 400 });
    const now = new Date().toISOString();
    const id = randomUUID();
    const conversationId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO ChatProject (id, name, createdById, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`,
      id,
      name,
      user.id,
      now,
      now
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO ChatConversation (id, projectId, title, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`,
      conversationId,
      id,
      "新对话",
      now,
      now
    );
    return NextResponse.json({
      success: true,
      project: {
        id,
        name,
        createdById: user.id,
        createdAt: now,
        updatedAt: now,
        conversations: [{ id: conversationId, projectId: id, title: "新对话", createdAt: now, updatedAt: now }]
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
