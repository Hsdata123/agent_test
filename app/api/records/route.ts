import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, requireUser } from "@/lib/auth";
import { publicFileUrl } from "@/lib/storage";
import { ensureChatWorkspaceTables } from "@/lib/chat-store";

type ChatProjectRecord = {
  id: string;
  name: string;
  createdById: string;
  username: string;
  nickname: string;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type ChatConversationRecord = {
  id: string;
  projectId: string;
  projectName: string;
  userId: string;
  username: string;
  nickname: string;
  title: string;
  messageCount: number | bigint;
  lastMessage: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type ChatMessageRecord = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string | Date;
};

function asIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    await ensureChatWorkspaceTables();

    const url = new URL(request.url);
    const isAdmin = user.role === "admin";
    const type = url.searchParams.get("type") || "all";
    const requestedUserId = url.searchParams.get("userId") || "all";
    const effectiveUserId = isAdmin ? requestedUserId : user.id;
    const projectId = url.searchParams.get("projectId") || "all";
    const chatProjectId = url.searchParams.get("chatProjectId") || "all";
    const conversationId = url.searchParams.get("conversationId") || "all";

    const users = isAdmin
      ? await prisma.user.findMany({
          orderBy: { createdAt: "desc" },
          select: { id: true, username: true, nickname: true, role: true, status: true }
        })
      : [{ id: user.id, username: user.username, nickname: user.nickname, role: user.role, status: user.status }];

    const imageProjects = await prisma.project.findMany({
      where: isAdmin ? undefined : { tasks: { some: { createdById: user.id } } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true }
    });

    const chatProjectWhere: string[] = [];
    const chatProjectParams: unknown[] = [];
    if (effectiveUserId !== "all") {
      chatProjectWhere.push("cp.createdById = ?");
      chatProjectParams.push(effectiveUserId);
    }
    const chatProjectRows = await prisma.$queryRawUnsafe<ChatProjectRecord[]>(
      `
        SELECT cp.id, cp.name, cp.createdById, cp.createdAt, cp.updatedAt, u.username, u.nickname
        FROM ChatProject cp
        JOIN User u ON u.id = cp.createdById
        ${chatProjectWhere.length ? `WHERE ${chatProjectWhere.join(" AND ")}` : ""}
        ORDER BY cp.updatedAt DESC
      `,
      ...chatProjectParams
    );

    const conversationWhere: string[] = [];
    const conversationParams: unknown[] = [];
    if (effectiveUserId !== "all") {
      conversationWhere.push("cp.createdById = ?");
      conversationParams.push(effectiveUserId);
    }
    if (chatProjectId !== "all") {
      conversationWhere.push("cc.projectId = ?");
      conversationParams.push(chatProjectId);
    }
    const conversationRows = await prisma.$queryRawUnsafe<ChatConversationRecord[]>(
      `
        SELECT
          cc.id,
          cc.projectId,
          cp.name AS projectName,
          cp.createdById AS userId,
          u.username,
          u.nickname,
          cc.title,
          cc.createdAt,
          cc.updatedAt,
          COUNT(cm.id) AS messageCount,
          (
            SELECT m2.content
            FROM ChatMessage m2
            WHERE m2.conversationId = cc.id
            ORDER BY m2.createdAt DESC
            LIMIT 1
          ) AS lastMessage
        FROM ChatConversation cc
        JOIN ChatProject cp ON cp.id = cc.projectId
        JOIN User u ON u.id = cp.createdById
        LEFT JOIN ChatMessage cm ON cm.conversationId = cc.id
        ${conversationWhere.length ? `WHERE ${conversationWhere.join(" AND ")}` : ""}
        GROUP BY cc.id
        ORDER BY cc.updatedAt DESC
      `,
      ...conversationParams
    );

    const tasks =
      type === "chat"
        ? []
        : await prisma.generationTask.findMany({
            where: {
              ...(effectiveUserId !== "all" ? { createdById: effectiveUserId } : {}),
              ...(projectId !== "all" ? { projectId } : {})
            },
            orderBy: { createdAt: "desc" },
            include: {
              parse: true,
              results: true,
              project: true,
              creator: { select: { id: true, username: true, nickname: true } }
            }
          });

    const filteredConversationRows = conversationRows.filter((row) => conversationId === "all" || row.id === conversationId);
    const filteredConversationIds = filteredConversationRows.map((row) => row.id);
    const messageRows = filteredConversationIds.length
      ? await prisma.$queryRawUnsafe<ChatMessageRecord[]>(
          `
            SELECT id, conversationId, role, content, createdAt
            FROM ChatMessage
            WHERE conversationId IN (${filteredConversationIds.map(() => "?").join(",")})
            ORDER BY createdAt ASC
          `,
          ...filteredConversationIds
        )
      : [];
    const messagesByConversation = new Map<string, ChatMessageRecord[]>();
    for (const message of messageRows) {
      const existing = messagesByConversation.get(message.conversationId) || [];
      existing.push(message);
      messagesByConversation.set(message.conversationId, existing);
    }

    const chatRecords =
      type === "image"
        ? []
        : filteredConversationRows
            .map((row) => ({
              ...row,
              messageCount: Number(row.messageCount),
              createdAt: asIso(row.createdAt),
              updatedAt: asIso(row.updatedAt),
              messages: (messagesByConversation.get(row.id) || []).map((item) => ({
                ...item,
                createdAt: asIso(item.createdAt)
              }))
            }));

    return NextResponse.json({
      success: true,
      users,
      imageProjects,
      chatProjects: chatProjectRows.map((row) => ({ ...row, createdAt: asIso(row.createdAt), updatedAt: asIso(row.updatedAt) })),
      conversations: conversationRows.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        title: row.title,
        userId: row.userId,
        projectName: row.projectName,
        createdAt: asIso(row.createdAt),
        updatedAt: asIso(row.updatedAt)
      })),
      tasks: tasks.map((task) => ({
        ...task,
        results: task.results.map((result) => ({ ...result, imageUrl: publicFileUrl(result.imagePath) }))
      })),
      chatRecords
    });
  } catch (error) {
    return jsonError(error);
  }
}
