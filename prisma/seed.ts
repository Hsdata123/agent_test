import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/password";

const prisma = new PrismaClient();

async function main() {
  const defaultDepartment = await prisma.department.upsert({
    where: { id: "dept_default" },
    update: {},
    create: {
      id: "dept_default",
      name: "默认部门",
      code: "default",
      description: "系统初始部门，可重命名或新增其他部门"
    }
  });

  const adminHash = hashPassword("admin123");

  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: { passwordHash: adminHash, status: "active", role: "admin", departmentId: defaultDepartment.id },
    create: {
      username: "admin",
      nickname: "管理员",
      passwordHash: adminHash,
      role: "admin",
      departmentId: defaultDepartment.id
    }
  });

  const creator = await prisma.user.upsert({
    where: { username: "operator" },
    update: { departmentId: defaultDepartment.id },
    create: {
      username: "operator",
      nickname: "运营示例",
      passwordHash: hashPassword("operator123"),
      role: "creator",
      departmentId: defaultDepartment.id
    }
  });

  await prisma.apiConfig.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      textBaseUrl: process.env.ITHINK_BASE_URL || "https://token.ithinkai.cn/v1",
      imageBaseUrl: process.env.ITHINK_BASE_URL || "https://token.ithinkai.cn/v1",
      textModel: process.env.ITHINK_CHAT_MODEL || "gpt-5.5-token",
      textWireApi: "responses",
      textPromptCacheEnabled: true,
      textPromptCacheRetention: "24h",
      textPromptCacheKey: "commerce-chat",
      disableResponseStorage: true,
      imageModel: process.env.ITHINK_IMAGE_MODEL || "gpt-image-2",
      timeoutSeconds: 240
    }
  });

  const project = await prisma.project.upsert({
    where: { id: "demo-project" },
    update: {},
    create: {
      id: "demo-project",
      name: "鱼子酱洗护主图测试",
      description: "用于验证机制解析、白底图匹配和批量生图的示例项目",
      creatorId: admin.id
    }
  });

  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: project.id, userId: creator.id } },
    update: { role: "editor" },
    create: { projectId: project.id, userId: creator.id, role: "editor" }
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
