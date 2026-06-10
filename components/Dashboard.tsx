"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type Key, useEffect, useMemo, useState } from "react";
import {
  App,
  Avatar,
  Button,
  Card,
  Col,
  ConfigProvider,
  Descriptions,
  Drawer,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload
} from "antd";
import type { ColumnsType } from "antd/es/table";

type User = { id: string; username: string; nickname: string; role: string; status: string; permissions?: string[] };
type RoleDefinition = { key: string; name: string; permissions: string[]; system: boolean };
type ChatMessage = { id: string; role: "user" | "assistant"; content: string; createdAt?: string };
type ChatConversationSummary = { id: string; projectId: string; title: string; createdAt: string; updatedAt: string };
type ChatProjectSummary = { id: string; name: string; createdAt: string; updatedAt: string; conversations: ChatConversationSummary[] };
type Project = {
  id: string;
  name: string;
  description?: string;
  status: string;
  creator?: { nickname: string };
  tasks?: { status: string }[];
  members?: Array<{ id: string; role: string; user: { id: string; nickname: string; username: string } }>;
};
type Asset = {
  id: string;
  assetName: string;
  originalName: string;
  assetType: string;
  productName?: string;
  description?: string;
  enabled: boolean;
  preferred: boolean;
  vectorStatus: string;
  fileUrl?: string;
  aliases?: string;
  tags?: string;
};
type MechanismParse = {
  id: string;
  rawMechanism: string;
  price: number;
  productSummary: string;
  items: Array<{ id: string; productName: string; quantity: number; matchType: string; matchScore: number; matchedAsset?: Asset }>;
};
type GenerationTask = {
  id: string;
  outputType: string;
  aspectRatio: string;
  imageSize?: string;
  imageQuality?: string;
  imageCount?: number;
  detailPageCount?: number;
  status: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
  parse?: { rawMechanism: string; productSummary: string };
  project?: Project;
  creator?: { id: string; username: string; nickname: string };
  results: Array<{ id: string; imageUrl: string; pageIndex?: number; createdAt?: string; width?: number; height?: number }>;
};
type RecordUser = Pick<User, "id" | "username" | "nickname" | "role" | "status">;
type RecordProjectOption = { id: string; name: string };
type RecordConversationOption = { id: string; projectId: string; projectName: string; userId: string; title: string; createdAt: string; updatedAt: string };
type ChatRecord = {
  id: string;
  projectId: string;
  projectName: string;
  conversationId?: string;
  userId: string;
  username: string;
  nickname: string;
  title: string;
  messageCount: number;
  lastMessage?: string | null;
  messages?: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};
type DownloadableResult = GenerationTask["results"][number] & {
  taskId: string;
  projectId?: string;
  outputType: string;
  rawMechanism?: string;
  status?: string;
  failureReason?: string;
  retryTaskId?: string;
  startedAt: string;
  completedAt?: string;
  updatedAt?: string;
  expectedIndex?: number;
};
type UsageRow = {
  id: string;
  userId: string;
  username: string;
  nickname: string;
  period: string;
  periodSort?: string;
  imageCount: number;
  estimatedCost: number;
  chatCount: number;
  chatEstimatedCost: number;
  chatCachedTokens: number;
  totalEstimatedCost: number;
};

const navItems = [
  { href: "/chat-projects", label: "对话项目" },
  { href: "/projects", label: "生图项目" },
  { href: "/knowledge", label: "知识库" },
  { href: "/records", label: "生成记录" },
  { href: "/settings", label: "设置" }
];

const permissionLabels: Record<string, string> = {
  manage_settings: "管理设置",
  manage_users: "管理用户",
  create_project: "创建项目",
  manage_project: "管理项目",
  share_project: "共享项目",
  generate_image: "生成图片",
  manage_knowledge: "管理知识库",
  download_results: "下载结果"
};

const permissionSelectOptions = Object.entries(permissionLabels).map(([value, label]) => ({ value, label }));

const DEFAULT_MAIN_PROMPT_TEMPLATE = [
  "任务类型：生成 1:1 电商主图",
  "价格机制：{{price}}={{productSummary}}",
  "禁止：不要把白底图文件名、边框、白底背景或参考说明文字放进画面；不要改变瓶身或包装关键特征，不添加未提供的达人肖像图，不虚构医疗化功效。"
].join("\n");

const DEFAULT_DETAIL_PROMPT_TEMPLATE = [
  "任务类型：生成 9:16 电商详情页分镜",
  "价格机制：{{price}}={{productSummary}}",
  "分镜页码：第 {{pageIndex}}/{{pageCount}} 页",
  "当前页面主题：{{sceneTitle}}",
  "当前页面目标：{{sceneGoal}}",
  "产品组合：{{products}}",
  "匹配到的白底图参考：{{whiteImages}}",
  "卖点文案：{{sellingPoints}}",
  "生成要求：竖版 9:16，明亮精致，风格统一，中文排版清晰，每页只表达一个核心主题。",
  "产品还原要求：详情页里的产品包装必须沿用匹配白底图的真实外观，包括瓶型、颜色、标签、盖子和数量，不要换包装。",
  "禁止：不要把白底图文件名、边框、白底背景或参考说明文字放进画面；不要添加资料中没有的核心功效，不改变产品包装关键特征。"
].join("\n");

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json();
  if (!payload.success) throw new Error(payload.message || "请求失败");
  return payload;
}

export function Dashboard({ view, projectId }: { view: "chatProjects" | "projects" | "project" | "knowledge" | "records" | "settings"; projectId?: string }) {
  const [user, setUser] = useState<User | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { message } = App.useApp();

  useEffect(() => {
    api<{ user: User | null }>("/api/auth/me")
      .then((payload) => {
        if (!payload.user) router.push("/login");
        setUser(payload.user);
      })
      .catch(() => router.push("/login"));
  }, [router]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  if (!user) return null;

  return (
    <main className="page-shell">
      <header className="topbar">
        <Link className="brand" href="/projects">
          <span className="brand-mark">AI</span>
          <span>电商视觉生成工作台</span>
        </Link>
        <Space wrap>
          {navItems
            .filter((item) => user.role === "admin" || user.permissions?.includes("manage_settings") || item.href !== "/settings")
            .map((item) => (
              <Link key={item.href} href={item.href}>
                <Button type={pathname.startsWith(item.href) ? "primary" : "text"}>
                  {item.label}
                </Button>
              </Link>
            ))}
          <Avatar>{user.nickname.slice(0, 1)}</Avatar>
          <span>{user.nickname}</span>
          <Tag color={user.role === "admin" ? "purple" : "blue"}>{roleLabel(user.role)}</Tag>
          <Button onClick={logout}>
            退出
          </Button>
        </Space>
      </header>
      <section className="content">
        <div className="hero-band">
          <div>
            <h1>AI 电商主图 / 详情页生成管理系统</h1>
            <p>输入多个价格机制，系统解析产品与数量、匹配知识库白底图，再生成主图和详情页分镜。</p>
          </div>
          <Space>
            <Tag color="gold">MVP</Tag>
            <Tag color="blue">Next 单体</Tag>
            <Tag color="purple">iThinkAPI</Tag>
          </Space>
        </div>
        {view === "chatProjects" && <ChatProjectsView />}
        {view === "projects" && <ProjectsView />}
        {view === "project" && projectId && <ProjectWorkspace projectId={projectId} />}
        {view === "knowledge" && <KnowledgeView />}
        {view === "records" && <RecordsView user={user} />}
        {view === "settings" && <SettingsView user={user} />}
      </section>
    </main>
  );
}

export function DashboardProvider(props: Parameters<typeof Dashboard>[0]) {
  return (
    <ConfigProvider wave={{ disabled: true }}>
      <App>
        <Dashboard {...props} />
      </App>
    </ConfigProvider>
  );
}

function ProjectsView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const { message } = App.useApp();

  async function load() {
    const payload = await api<{ projects: Project[] }>("/api/projects");
    setProjects(payload.projects);
  }

  useEffect(() => {
    load().catch((error) => message.error(error.message));
  }, []);

  async function createProject(values: { name: string; description?: string }) {
    await api("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    message.success("项目已创建");
    setOpen(false);
    form.resetFields();
    load();
  }

  const todayCount = projects.flatMap((project) => project.tasks || []).filter((task) => task.status === "completed").length;

  return (
    <Space direction="vertical" size={18} style={{ width: "100%" }}>
      <Row gutter={16}>
        <Col xs={24} md={8}>
          <Card className="soft-card">
            <Statistic title="今日生成数" value={todayCount} suffix="张" />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="soft-card">
            <Statistic title="待处理任务" value={projects.flatMap((p) => p.tasks || []).filter((t) => t.status === "queued").length} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="soft-card">
            <Statistic title="项目总数" value={projects.length} />
          </Card>
        </Col>
      </Row>
      <Card
        className="soft-card"
        title="项目列表"
        extra={
          <Button type="primary" onClick={() => setOpen(true)}>
            创建项目
          </Button>
        }
      >
        <div className="grid-3">
          {projects.map((project) => (
            <Card
              key={project.id}
              className="soft-card"
              cover={
                <img
                  alt={project.name}
                  src="https://images.unsplash.com/photo-1612817288484-6f916006741a?auto=format&fit=crop&w=800&q=80"
                  style={{ height: 180, objectFit: "cover" }}
                />
              }
              actions={[
                <Link key="enter" href={`/projects/${project.id}`}>
                  进入生图
                </Link>
              ]}
            >
              <Card.Meta title={project.name} description={project.description || "暂无描述"} />
              <Space style={{ marginTop: 14 }}>
                <Tag color={project.status === "active" ? "green" : "red"}>{project.status === "active" ? "启用" : "停用"}</Tag>
                <Tag>{project.creator?.nickname || "创建者"}</Tag>
              </Space>
            </Card>
          ))}
        </div>
      </Card>
      <Modal open={open} title="创建项目" onCancel={() => setOpen(false)} onOk={() => form.submit()} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={createProject}>
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: "请输入项目名称" }]}>
            <Input placeholder="例如：618 鱼子酱洗护套装" />
          </Form.Item>
          <Form.Item name="description" label="项目描述">
            <Input.TextArea placeholder="项目用途、活动平台或投放说明" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

function ChatProjectsView() {
  const [chatProjects, setChatProjects] = useState<ChatProjectSummary[]>([]);
  const [activeChatProjectId, setActiveChatProjectId] = useState<string>();
  const [activeConversationId, setActiveConversationId] = useState<string>();
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [renamingProject, setRenamingProject] = useState<ChatProjectSummary | null>(null);
  const [renamingConversation, setRenamingConversation] = useState<ChatConversationSummary | null>(null);
  const [chatProjectForm] = Form.useForm();
  const [renameForm] = Form.useForm();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [keyword, setKeyword] = useState("");
  const [chatAssetType, setChatAssetType] = useState("all");
  const [selectedAssetIds, setSelectedAssetIds] = useState<Key[]>([]);
  const [useAll, setUseAll] = useState(false);
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [chatUploadLoading, setChatUploadLoading] = useState(false);
  const { message, modal } = App.useApp();

  async function loadChatProjects(preferredConversationId = activeConversationId) {
    const payload = await api<{ projects: ChatProjectSummary[] }>("/api/chat-projects");
    setChatProjects(payload.projects);
    const preferredProject = payload.projects.find((project) => project.conversations.some((conversation) => conversation.id === preferredConversationId));
    const nextProject = preferredProject || payload.projects.find((project) => project.id === activeChatProjectId) || payload.projects[0];
    setActiveChatProjectId(nextProject?.id);
    const nextConversation =
      nextProject?.conversations.find((conversation) => conversation.id === preferredConversationId) || nextProject?.conversations[0];
    setActiveConversationId(nextConversation?.id);
    if (nextConversation) {
      await loadConversation(nextConversation.id);
    } else {
      setChatMessages([]);
    }
  }

  async function loadConversation(conversationId: string) {
    const payload = await api<{ messages: ChatMessage[] }>(`/api/chat-conversations/${conversationId}`);
    setChatMessages(payload.messages.map((item) => ({ id: item.id, role: item.role, content: item.content })));
  }

  async function loadAssets(nextKeyword = keyword, nextAssetType = chatAssetType) {
    const params = new URLSearchParams();
    if (nextKeyword.trim()) params.set("q", nextKeyword.trim());
    if (nextAssetType !== "all") params.set("assetType", nextAssetType);
    const payload = await api<{ assets: Asset[] }>(`/api/knowledge/assets?${params.toString()}`);
    setAssets(payload.assets);
  }

  useEffect(() => {
    loadAssets().catch((error) => message.error(error.message));
    loadChatProjects().catch((error) => message.error(error.message));
  }, []);

  async function sendChat() {
    const currentQuestion = question.trim();
    if (!currentQuestion) {
      message.warning("请先输入对话内容");
      return;
    }
    if (!activeConversationId) {
      message.warning("请先新建或选择一个对话");
      return;
    }
    setQuestion("");
    setChatMessages((current) => [...current, { id: `user-${Date.now()}`, role: "user", content: currentQuestion }]);
    setLoading(true);
    try {
      const payload = await api<{ answer: string }>("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: currentQuestion, useAll, assetIds: selectedAssetIds, assetType: chatAssetType, conversationId: activeConversationId })
      });
      setChatMessages((current) => [...current, { id: `assistant-${Date.now()}`, role: "assistant", content: payload.answer }]);
      loadChatProjects(activeConversationId).catch((error) => message.error(error.message));
    } catch (error) {
      const errorMessage = (error as Error).message;
      setChatMessages((current) => [...current, { id: `assistant-error-${Date.now()}`, role: "assistant", content: `对话失败：${errorMessage}` }]);
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  async function uploadChatMaterials(options: any) {
    const files = Array.isArray(options.file) ? options.file : [options.file];
    const realFiles = files.map((item: any) => item?.originFileObj || item).filter(Boolean);
    if (!realFiles.length) {
      options.onError?.(new Error("请选择上传文件"));
      return;
    }
    setChatUploadLoading(true);
    try {
      const formData = new FormData();
      formData.append("assetType", "document");
      for (const file of realFiles) {
        formData.append("files", file);
      }
      const payload = await api<{ assets: Asset[] }>("/api/knowledge/upload", {
        method: "POST",
        body: formData
      });
      setChatAssetType("all");
      setUseAll(false);
      setAssets((current) => mergeAssets(payload.assets, current));
      setSelectedAssetIds((current) => Array.from(new Set([...current.map(String), ...payload.assets.map((asset) => asset.id)])));
      options.onSuccess?.(payload);
      message.success(`已上传并选中 ${payload.assets.length} 份资料`);
    } catch (error) {
      const errorMessage = (error as Error).message;
      options.onError?.(error);
      message.error(errorMessage);
    } finally {
      setChatUploadLoading(false);
    }
  }

  async function createChatProject(values: { name: string }) {
    const payload = await api<{ project: ChatProjectSummary }>("/api/chat-projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    setProjectModalOpen(false);
    chatProjectForm.resetFields();
    setActiveChatProjectId(payload.project.id);
    setActiveConversationId(payload.project.conversations[0]?.id);
    setChatMessages([]);
    await loadChatProjects(payload.project.conversations[0]?.id);
    message.success("对话项目已创建");
  }

  async function createConversation(projectId = activeChatProjectId) {
    if (!projectId) {
      message.warning("请先新建或选择一个项目");
      return;
    }
    const payload = await api<{ conversation: ChatConversationSummary }>("/api/chat-conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId })
    });
    setActiveChatProjectId(projectId);
    setActiveConversationId(payload.conversation.id);
    setChatMessages([]);
    await loadChatProjects(payload.conversation.id);
  }

  async function selectConversation(projectId: string, conversationId: string) {
    setActiveChatProjectId(projectId);
    setActiveConversationId(conversationId);
    await loadConversation(conversationId);
  }

  async function selectChatProject(project: ChatProjectSummary) {
    setActiveChatProjectId(project.id);
    const conversation = project.conversations[0];
    if (conversation) {
      setActiveConversationId(conversation.id);
      await loadConversation(conversation.id);
    } else {
      setActiveConversationId(undefined);
      setChatMessages([]);
    }
  }

  function openRenameProject(project: ChatProjectSummary) {
    setRenamingProject(project);
    setRenamingConversation(null);
    renameForm.setFieldsValue({ name: project.name });
  }

  function openRenameConversation(conversation: ChatConversationSummary) {
    setRenamingConversation(conversation);
    setRenamingProject(null);
    renameForm.setFieldsValue({ name: conversation.title });
  }

  async function saveRename(values: { name: string }) {
    if (renamingProject) {
      await api(`/api/chat-projects/${renamingProject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: values.name })
      });
      message.success("项目已重命名");
    }
    if (renamingConversation) {
      await api(`/api/chat-conversations/${renamingConversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: values.name })
      });
      message.success("对话已重命名");
    }
    setRenamingProject(null);
    setRenamingConversation(null);
    renameForm.resetFields();
    await loadChatProjects(activeConversationId);
  }

  function deleteProject(project: ChatProjectSummary) {
    modal.confirm({
      title: "删除项目",
      content: `确定删除“${project.name}”吗？项目下的对话也会一起删除。`,
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        await api(`/api/chat-projects/${project.id}`, { method: "DELETE" });
        message.success("项目已删除");
        await loadChatProjects(project.id === activeChatProjectId ? undefined : activeConversationId);
      }
    });
  }

  function deleteConversation(conversation: ChatConversationSummary) {
    modal.confirm({
      title: "删除对话",
      content: `确定删除“${conversation.title}”吗？`,
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        await api(`/api/chat-conversations/${conversation.id}`, { method: "DELETE" });
        message.success("对话已删除");
        await loadChatProjects(conversation.id === activeConversationId ? undefined : activeConversationId);
      }
    });
  }

  const activeChatProject = chatProjects.find((project) => project.id === activeChatProjectId);
  const activeConversation = activeChatProject?.conversations.find((conversation) => conversation.id === activeConversationId);

  return (
    <Space direction="vertical" size={18} style={{ width: "100%" }}>
      <div className="chat-workbench">
        <aside className="chat-sidebar">
          <Button type="primary" block onClick={() => createConversation()}>
            新对话
          </Button>
          <Button block onClick={() => setProjectModalOpen(true)}>
            新建项目
          </Button>
          <div className="chat-sidebar-section">项目</div>
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            {chatProjects.map((project) => (
              <div className={`chat-project-group ${project.id === activeChatProjectId ? "active" : ""}`} key={project.id}>
                <div className="chat-list-row">
                  <button className="chat-project-name" type="button" onClick={() => selectChatProject(project).catch((error) => message.error(error.message))}>
                    {project.name}
                  </button>
                  <Space size={4} className="chat-row-tools">
                    <Button size="small" onClick={() => openRenameProject(project)}>
                      改名
                    </Button>
                    <Button size="small" danger onClick={() => deleteProject(project)}>
                      删除
                    </Button>
                  </Space>
                </div>
                <Space direction="vertical" size={4} style={{ width: "100%" }}>
                  {project.conversations.slice(0, 8).map((conversation) => (
                    <div className={`chat-conversation-item ${conversation.id === activeConversationId ? "active" : ""}`} key={conversation.id}>
                      <button type="button" onClick={() => selectConversation(project.id, conversation.id)}>
                        <span>{conversation.title}</span>
                        <small>{formatRelativeDay(conversation.updatedAt)}</small>
                      </button>
                      <Space size={4} className="chat-row-tools">
                        <Button size="small" onClick={() => openRenameConversation(conversation)}>
                          改名
                        </Button>
                        <Button size="small" danger onClick={() => deleteConversation(conversation)}>
                          删除
                        </Button>
                      </Space>
                    </div>
                  ))}
                </Space>
              </div>
            ))}
            {!chatProjects.length && <Typography.Text type="secondary">暂无项目，先新建一个对话项目。</Typography.Text>}
          </Space>
        </aside>
        <Card
          className="soft-card chat-shell"
          title={activeConversation ? activeConversation.title : "对话"}
          extra={
            <Space>
              {activeChatProject && <Typography.Text type="secondary">{activeChatProject.name}</Typography.Text>}
              {!!chatMessages.length && (
                <Button size="small" onClick={() => setChatMessages([])}>
                  清空本次显示
                </Button>
              )}
            </Space>
          }
        >
          <div className="chat-thread">
            {chatMessages.length ? (
              chatMessages.map((item) => (
                <div className={`chat-row ${item.role}`} key={item.id}>
                  {item.role === "assistant" && <Avatar className="chat-avatar">AI</Avatar>}
                  <div className="chat-bubble">
                    <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{item.content}</Typography.Paragraph>
                  </div>
                  {item.role === "user" && <Avatar className="chat-avatar user-avatar">我</Avatar>}
                </div>
              ))
            ) : (
              <div className="chat-empty">
                <Typography.Title level={4}>{activeConversation ? "开始对话" : "请选择或新建对话"}</Typography.Title>
                <Typography.Text type="secondary">直接输入问题即可；需要参考资料时，再选择知识库资料或在问题里说明调用知识库。</Typography.Text>
              </div>
            )}
            {loading && (
              <div className="chat-row assistant">
                <Avatar className="chat-avatar">AI</Avatar>
                <div className="chat-bubble">
                  <Typography.Text type="secondary">{useAll || selectedAssetIds.length ? "正在查找知识库并组织回答..." : "正在组织回答..."}</Typography.Text>
                </div>
              </div>
            )}
          </div>
          <div className="chat-composer">
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 6 }}
              value={question}
              disabled={!activeConversationId}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendChat();
                }
              }}
              placeholder={activeConversationId ? "输入问题，例如：根据选中的资料，帮我整理一个主图卖点方向" : "请先在左侧新建或选择一个对话"}
            />
            <div className="chat-actions">
              <Space wrap>
                <Button onClick={() => setAssetDrawerOpen(true)}>知识库资料选择</Button>
                <Upload
                  multiple
                  showUploadList={false}
                  customRequest={uploadChatMaterials}
                  accept=".txt,.md,.csv,.json,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/png,image/jpeg,image/webp"
                >
                  <Button loading={chatUploadLoading}>上传资料</Button>
                </Upload>
                <Typography.Text type="secondary">
                  {useAll
                    ? `调用${chatAssetType === "all" ? "全部" : assetTypeLabel(chatAssetType)}资料`
                    : selectedAssetIds.length
                      ? `已选择 ${selectedAssetIds.length} 条资料`
                      : "未调用知识库"}
                </Typography.Text>
              </Space>
              <Button type="primary" loading={loading} onClick={sendChat} disabled={!activeConversationId}>
                发送对话
              </Button>
            </div>
          </div>
        </Card>
      </div>
      <Modal open={projectModalOpen} title="新建对话项目" onCancel={() => setProjectModalOpen(false)} onOk={() => chatProjectForm.submit()} destroyOnHidden>
        <Form form={chatProjectForm} layout="vertical" onFinish={createChatProject}>
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: "请输入项目名称" }]}>
            <Input placeholder="例如：运营、洗发水活动、618 文案" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={!!renamingProject || !!renamingConversation}
        title={renamingProject ? "重命名项目" : "重命名对话"}
        onCancel={() => {
          setRenamingProject(null);
          setRenamingConversation(null);
        }}
        onOk={() => renameForm.submit()}
        destroyOnHidden
      >
        <Form form={renameForm} layout="vertical" onFinish={saveRename}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
      <Drawer title="知识库资料选择" open={assetDrawerOpen} width={760} onClose={() => setAssetDrawerOpen(false)}>
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Input.Search
            placeholder="搜索知识库资料、提示词或文档"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={(value) => loadAssets(value).catch((error) => message.error(error.message))}
            enterButton="搜索"
          />
          <Space wrap>
            <span>资料分类</span>
            <Select
              value={chatAssetType}
              style={{ width: 180 }}
              onChange={(value) => {
                setChatAssetType(value);
                setSelectedAssetIds([]);
                loadAssets(keyword, value).catch((error) => message.error(error.message));
              }}
              options={[
                { value: "all", label: "全部资料" },
                { value: "product_white_image", label: "产品白底图" },
                { value: "main_template", label: "主图模板" },
                { value: "portrait_white_image", label: "达人肖像白底图" },
                { value: "prompt", label: "提示词" },
                { value: "pdf", label: "PDF" },
                { value: "ppt", label: "PPT" },
                { value: "document", label: "文档" }
              ]}
            />
            <Switch checked={useAll} onChange={setUseAll} checkedChildren="调用全部知识库" unCheckedChildren="选择资料调用" />
          </Space>
          <Table
            size="small"
            rowKey="id"
            dataSource={assets}
            pagination={{ pageSize: 6 }}
            rowSelection={
              useAll
                ? undefined
                : {
                    selectedRowKeys: selectedAssetIds,
                    onChange: setSelectedAssetIds
                  }
            }
            columns={[
              { title: "资料名称", dataIndex: "assetName" },
              { title: "类型", render: (_, row) => assetTypeLabel(row.assetType) },
              { title: "说明", render: (_, row) => row.description || row.productName || "-" }
            ]}
          />
          <Typography.Text type="secondary">{useAll ? "本次对话会调用当前分类下全部启用的知识库资料。" : `已选择 ${selectedAssetIds.length} 条资料。`}</Typography.Text>
        </Space>
      </Drawer>
    </Space>
  );
}

function ProjectWorkspace({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [parses, setParses] = useState<MechanismParse[]>([]);
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [shareUsers, setShareUsers] = useState<User[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUserId, setShareUserId] = useState<string>();
  const [shareRole, setShareRole] = useState("editor");
  const [rawText, setRawText] = useState("");
  const [mode, setMode] = useState("main_image");
  const [detailPageCount, setDetailPageCount] = useState(5);
  const [mainImageCount, setMainImageCount] = useState(1);
  const [mainImageSize, setMainImageSize] = useState("1024x1024");
  const [imageQuality, setImageQuality] = useState("high");
  const [mainPromptTemplate, setMainPromptTemplate] = useState(DEFAULT_MAIN_PROMPT_TEMPLATE);
  const [detailPromptTemplate, setDetailPromptTemplate] = useState(DEFAULT_DETAIL_PROMPT_TEMPLATE);
  const [promptOverrides, setPromptOverrides] = useState<Record<string, string>>({});
  const [promptParseId, setPromptParseId] = useState<string>();
  const [promptType, setPromptType] = useState<"main" | "detail">("main");
  const [promptPage, setPromptPage] = useState(1);
  const [mainTemplates, setMainTemplates] = useState<Asset[]>([]);
  const [mainTemplateAssetId, setMainTemplateAssetId] = useState<string>();
  const [portraitAssets, setPortraitAssets] = useState<Asset[]>([]);
  const [portraitAssetId, setPortraitAssetId] = useState<string>();
  const [customPrompt, setCustomPrompt] = useState("");
  const [customFiles, setCustomFiles] = useState<File[]>([]);
  const [customAspectRatio, setCustomAspectRatio] = useState("1:1");
  const [customResolution, setCustomResolution] = useState("1024");
  const [customLoading, setCustomLoading] = useState(false);
  const [generationPanel, setGenerationPanel] = useState<"standard" | "custom">("standard");
  const [loading, setLoading] = useState(false);
  const { message, modal } = App.useApp();

  async function load() {
    const [projectPayload, taskPayload, templatePayload, portraitPayload] = await Promise.all([
      api<{ project: Project }>(`/api/projects/${projectId}`),
      api<{ tasks: GenerationTask[] }>(`/api/generation/tasks?projectId=${projectId}`),
      api<{ assets: Asset[] }>("/api/knowledge/assets?assetType=main_template"),
      api<{ assets: Asset[] }>("/api/knowledge/assets?assetType=portrait_white_image")
    ]);
    setProject(projectPayload.project);
    setTasks(taskPayload.tasks);
    setMainTemplates(templatePayload.assets.filter((asset) => asset.enabled));
    setPortraitAssets(portraitPayload.assets.filter((asset) => asset.enabled));
  }

  useEffect(() => {
    load().catch((error) => message.error(error.message));
  }, [projectId]);

  useEffect(() => {
    if (!tasks.some((task) => task.status === "queued" || task.status === "generating")) return;
    const timer = window.setInterval(() => {
      load().catch((error) => message.error(error.message));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [tasks, projectId]);

  async function parse() {
    setLoading(true);
    try {
      const payload = await api<{ items: MechanismParse[]; issues: Array<{ message: string }> }>("/api/mechanisms/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, rawText })
      });
      if (payload.issues.length) {
        modal.warning({ title: "解析提示", content: payload.issues.map((issue) => issue.message).join("\n") });
      }
      setParses(payload.items);
      setPromptOverrides({});
      setPromptParseId(payload.items[0]?.id);
      setPromptPage(1);
      const matchedCount = payload.items.flatMap((item) => item.items).filter((item) => item.matchedAsset).length;
      message.success(`已解析 ${payload.items.length} 条机制，并自动匹配 ${matchedCount} 个白底图`);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function match() {
    const payload = await api<{
      matches: Array<{ itemId: string; matchedAsset: Asset | null; matchType: string; matchScore: number }>;
    }>("/api/mechanisms/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, parseIds: parses.map((item) => item.id) })
    });
    setParses((current) =>
      current.map((parseItem) => ({
        ...parseItem,
        items: parseItem.items.map((item) => {
          const found = payload.matches.find((matchItem) => matchItem.itemId === item.id);
          return found
            ? {
                ...item,
                matchedAsset: found.matchedAsset || undefined,
                matchType: found.matchType,
                matchScore: found.matchScore
              }
            : item;
        })
      }))
    );
    setPromptOverrides({});
    message.success(`完成 ${payload.matches.length} 个产品匹配`);
  }

  async function generate() {
    if (!parses.length) {
      message.warning("请先解析机制");
      return;
    }
    setLoading(true);
    try {
      const payload = await api<{ tasks: GenerationTask[] }>("/api/generation/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          parseIds: parses.map((item) => item.id),
          generationConfig: {
            mode,
            detailPageCount,
            mainImageCount,
            mainImageSize,
            imageQuality,
            mainPromptTemplate,
            detailPromptTemplate,
            fullPromptOverrides: promptOverrides,
            mainTemplateAssetId,
            portraitAssetId
          }
        })
      });
      setTasks((current) => mergeTasks(payload.tasks, current));
      message.success("任务已加入生成队列，可在下方查看进度");
    } catch (error) {
      message.error((error as Error).message);
      load();
    } finally {
      setLoading(false);
    }
  }

  async function uploadMainTemplate(file: File) {
    const formData = new FormData();
    formData.append("assetType", "main_template");
    formData.append("files", file);
    const payload = await api<{ assets: Asset[] }>("/api/knowledge/upload", { method: "POST", body: formData });
    const uploaded = payload.assets[0];
    if (uploaded) {
      setMainTemplates((current) => [uploaded, ...current.filter((asset) => asset.id !== uploaded.id)]);
      setMainTemplateAssetId(uploaded.id);
    }
    message.success("主图模板已保存到知识库");
  }

  async function uploadPortraitImage(file: File) {
    const formData = new FormData();
    formData.append("assetType", "portrait_white_image");
    formData.append("files", file);
    const payload = await api<{ assets: Asset[] }>("/api/knowledge/upload", { method: "POST", body: formData });
    const uploaded = payload.assets[0];
    if (uploaded) {
      setPortraitAssets((current) => [uploaded, ...current.filter((asset) => asset.id !== uploaded.id)]);
      setPortraitAssetId(uploaded.id);
    }
    message.success("达人肖像白底图已保存到知识库");
  }

  async function generateCustomImage() {
    if (!customPrompt.trim()) {
      message.warning("请先填写自定义生图描述");
      return;
    }
    setCustomLoading(true);
    try {
      const formData = new FormData();
      formData.append("projectId", projectId);
      formData.append("prompt", customPrompt);
      formData.append("size", customImageSize(customAspectRatio, customResolution));
      formData.append("quality", imageQuality);
      customFiles.forEach((file) => formData.append("references", file));
      const payload = await api<{ tasks: GenerationTask[] }>("/api/generation/custom", { method: "POST", body: formData });
      setTasks((current) => mergeTasks(payload.tasks, current));
      message.success("自定义生图已加入队列");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setCustomLoading(false);
    }
  }

  async function openShareDrawer() {
    try {
      const payload = await api<{ users: User[] }>("/api/users?scope=share");
      setShareUsers(payload.users);
      setShareOpen(true);
    } catch (error) {
      message.error((error as Error).message);
    }
  }

  async function shareProject() {
    if (!shareUserId) {
      message.warning("请选择成员");
      return;
    }
    await api(`/api/projects/${projectId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: shareUserId, memberRole: shareRole })
    });
    message.success("项目已开放给成员");
    setShareOpen(false);
    load();
  }

  const parseColumns: ColumnsType<MechanismParse> = [
    { title: "原始机制", dataIndex: "rawMechanism" },
    { title: "价格", dataIndex: "price", width: 90 },
    { title: "产品组合", dataIndex: "productSummary" },
    {
      title: "产品明细",
      render: (_, row) => row.items.map((item) => `${item.productName} x${item.quantity}`).join("、")
    },
    {
      title: "匹配状态",
      render: (_, row) => {
        const matched = row.items.filter((item) => item.matchedAsset).length;
        const allMatched = row.items.length > 0 && matched === row.items.length;
        return <Tag color={allMatched ? "green" : "red"}>{allMatched ? "已匹配" : "未匹配"}</Tag>;
      }
    }
  ];
  const selectedMainTemplate = mainTemplates.find((asset) => asset.id === mainTemplateAssetId);
  const selectedPortraitAsset = portraitAssets.find((asset) => asset.id === portraitAssetId);
  const selectedPromptParse = parses.find((item) => item.id === promptParseId) || parses[0];
  const currentPromptKey = selectedPromptParse ? promptKey(selectedPromptParse.id, promptType, promptType === "detail" ? promptPage : undefined) : "";
  const currentGeneratedPrompt = selectedPromptParse
    ? buildFullPromptPreview(
        selectedPromptParse,
        promptType,
        promptType === "detail" ? promptPage : 1,
        detailPageCount,
        selectedMainTemplate,
        selectedPortraitAsset,
        promptType === "main" ? mainPromptTemplate : detailPromptTemplate
      )
    : "";
  const currentPromptValue = currentPromptKey ? promptOverrides[currentPromptKey] ?? currentGeneratedPrompt : "";

  function updateCurrentPrompt(value: string) {
    if (!currentPromptKey) return;
    setPromptOverrides((current) => ({ ...current, [currentPromptKey]: value }));
  }

  function resetCurrentPrompt() {
    if (!currentPromptKey) return;
    setPromptOverrides((current) => {
      const next = { ...current };
      delete next[currentPromptKey];
      return next;
    });
  }

  return (
    <Space direction="vertical" size={18} style={{ width: "100%" }}>
      <Card className="soft-card">
        <Descriptions
          title={project?.name || "项目生图"}
          column={2}
          extra={
            <Button type="primary" onClick={openShareDrawer}>
              共享成员
            </Button>
          }
        >
          <Descriptions.Item label="项目描述">{project?.description || "暂无描述"}</Descriptions.Item>
          <Descriptions.Item label="项目状态">{project?.status === "active" ? "启用" : "停用"}</Descriptions.Item>
          <Descriptions.Item label="管理员权限">管理员默认可访问全部项目</Descriptions.Item>
          <Descriptions.Item label="已开放成员">
            {project?.members?.length
              ? project.members.map((member) => `${member.user.nickname}（${roleLabel(member.role)}）`).join("、")
              : "暂未单独开放"}
          </Descriptions.Item>
        </Descriptions>
      </Card>
      <div className={generationPanel === "standard" ? "grid-2" : undefined}>
        <Card className="soft-card" title="生成图片">
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Radio.Group value={generationPanel} onChange={(event) => setGenerationPanel(event.target.value as "standard" | "custom")}>
              <Radio.Button value="standard">生成图片</Radio.Button>
              <Radio.Button value="custom">自定义生图</Radio.Button>
            </Radio.Group>
            {generationPanel === "standard" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Radio.Group value={mode} onChange={(event) => setMode(event.target.value)}>
                <Radio.Button value="main_image">1:1 主图</Radio.Button>
                <Radio.Button value="detail_pages">9:16 详情页</Radio.Button>
              </Radio.Group>
              <Input.TextArea rows={8} value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder="请输入价格机制，一行一条" />
              <Space wrap>
                <span>主图数量</span>
                <InputNumber min={1} max={9} value={mainImageCount} onChange={(value) => setMainImageCount(Number(value || 1))} />
                <span>主图分辨率</span>
                <Select
                  style={{ width: 140 }}
                  value={mainImageSize}
                  onChange={setMainImageSize}
                  options={[
                    { value: "1024x1024", label: "1K 稳定" },
                    { value: "2048x2048", label: "2K 高清" },
                    { value: "4096x4096", label: "4K 无参考图" }
                  ]}
                />
                <span>图片质量</span>
                <Select
                  style={{ width: 120 }}
                  value={imageQuality}
                  onChange={setImageQuality}
                  options={[
                    { value: "high", label: "高" },
                    { value: "medium", label: "中" },
                    { value: "low", label: "低" },
                    { value: "auto", label: "自动" }
                  ]}
                />
                <span>详情页分镜</span>
                <InputNumber min={3} max={12} value={detailPageCount} onChange={(value) => setDetailPageCount(Number(value || 5))} />
              </Space>
              <Space wrap align="start">
              <span style={{ lineHeight: "32px" }}>主图模板</span>
              <Select
                allowClear
                optionLabelProp="label"
                popupMatchSelectWidth={360}
                style={{ width: 260 }}
                placeholder="从知识库选择主图模板"
                value={mainTemplateAssetId}
                onChange={setMainTemplateAssetId}
                options={mainTemplates.map((asset) => ({
                  value: asset.id,
                  label: asset.assetName,
                  asset
                }))}
                optionRender={(option) => {
                  const asset = option.data.asset as Asset | undefined;
                  return asset ? (
                    <Space direction="vertical" size={6} className="template-option">
                      {asset.fileUrl && <Image preview={false} width={200} height={140} src={asset.fileUrl} alt={asset.assetName} style={{ objectFit: "contain" }} />}
                      <Typography.Text ellipsis>{asset.assetName}</Typography.Text>
                    </Space>
                  ) : (
                    option.label
                  );
                }}
              />
              <Upload
                accept="image/png,image/jpeg,image/webp"
                showUploadList={false}
                customRequest={async ({ file, onSuccess, onError }) => {
                  try {
                    await uploadMainTemplate(file as File);
                    onSuccess?.("ok");
                  } catch (error) {
                    onError?.(error as Error);
                    message.error((error as Error).message);
                  }
                }}
              >
                <Button>上传并使用模板</Button>
              </Upload>
              {selectedMainTemplate?.fileUrl && (
                <Space direction="vertical" size={4} className="selected-template-preview">
                  <Image width={200} height={140} src={selectedMainTemplate.fileUrl} alt={selectedMainTemplate.assetName} style={{ objectFit: "contain" }} />
                  <Typography.Text ellipsis style={{ maxWidth: 200 }}>
                    {selectedMainTemplate.assetName}
                  </Typography.Text>
                </Space>
              )}
              </Space>
              <Space wrap align="start">
              <span style={{ lineHeight: "32px" }}>达人肖像白底图</span>
              <Select
                allowClear
                optionLabelProp="label"
                popupMatchSelectWidth={320}
                style={{ width: 260 }}
                placeholder="从知识库选择达人肖像"
                value={portraitAssetId}
                onChange={setPortraitAssetId}
                options={portraitAssets.map((asset) => ({
                  value: asset.id,
                  label: asset.assetName,
                  asset
                }))}
                optionRender={(option) => {
                  const asset = option.data.asset as Asset | undefined;
                  return asset ? (
                    <Space direction="vertical" size={6} className="template-option">
                      {asset.fileUrl && <Image preview={false} width={120} height={120} src={asset.fileUrl} alt={asset.assetName} style={{ objectFit: "contain" }} />}
                      <Typography.Text ellipsis>{asset.assetName}</Typography.Text>
                    </Space>
                  ) : (
                    option.label
                  );
                }}
              />
              <Upload
                accept="image/png,image/jpeg,image/webp"
                showUploadList={false}
                customRequest={async ({ file, onSuccess, onError }) => {
                  try {
                    await uploadPortraitImage(file as File);
                    onSuccess?.("ok");
                  } catch (error) {
                    onError?.(error as Error);
                    message.error((error as Error).message);
                  }
                }}
              >
                <Button>上传并使用达人肖像</Button>
              </Upload>
              {selectedPortraitAsset?.fileUrl && (
                <Space direction="vertical" size={4} className="selected-template-preview">
                  <Image width={120} height={120} src={selectedPortraitAsset.fileUrl} alt={selectedPortraitAsset.assetName} style={{ objectFit: "contain" }} />
                  <Typography.Text ellipsis style={{ maxWidth: 160 }}>
                    {selectedPortraitAsset.assetName}
                  </Typography.Text>
                </Space>
              )}
              </Space>
              <Space wrap>
                <Button onClick={parse} loading={loading}>
                  解析机制
                </Button>
                <Button onClick={match} disabled={!parses.length}>
                  重新匹配白底图
                </Button>
                <Button type="primary" onClick={generate} loading={loading}>
                  立即批量生成
                </Button>
              </Space>
            </Space>
            ) : (
            <Space direction="vertical" style={{ width: "100%" }} className="custom-generate-box">
              <Input.TextArea rows={8} value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} placeholder="描述你想生成的图片，可上传参考图辅助生成" />
              <Space wrap>
                <span>尺寸</span>
                <Select
                  style={{ width: 130 }}
                  value={customAspectRatio}
                  onChange={setCustomAspectRatio}
                  options={[
                    { value: "1:1", label: "1:1 方图" },
                    { value: "9:16", label: "9:16 竖图" }
                  ]}
                />
                <span>主图分辨率</span>
                <Select
                  style={{ width: 140 }}
                  value={customResolution}
                  onChange={setCustomResolution}
                  options={[
                    { value: "1024", label: "1K 稳定" },
                    { value: "2048", label: "2K 高清" },
                    { value: "4096", label: "4K 高清" }
                  ]}
                />
                <span>图片质量</span>
                <Select
                  style={{ width: 120 }}
                  value={imageQuality}
                  onChange={setImageQuality}
                  options={[
                    { value: "high", label: "高" },
                    { value: "medium", label: "中" },
                    { value: "low", label: "低" },
                    { value: "auto", label: "自动" }
                  ]}
                />
              </Space>
              <Upload
                multiple
                accept="image/png,image/jpeg,image/webp"
                beforeUpload={(file) => {
                  setCustomFiles((current) => [...current, file]);
                  return false;
                }}
                fileList={customFiles.map((file, index) => ({ uid: `${file.name}-${index}`, name: file.name, status: "done" }))}
                onRemove={(file) => {
                  setCustomFiles((current) => current.filter((item) => item.name !== file.name));
                }}
              >
                <Button>上传参考图片</Button>
              </Upload>
              <Button type="primary" onClick={generateCustomImage} loading={customLoading}>
                生成自定义图片
              </Button>
            </Space>
            )}
          </Space>
        </Card>
        {generationPanel === "standard" && (
        <Card className="soft-card" title="产品白底图匹配">
          <Space direction="vertical" className="match-list">
            {parses.flatMap((parseItem) =>
              parseItem.items.map((item) => (
                <div className="match-item" key={item.id}>
                  <div className="match-thumb">
                    {item.matchedAsset?.fileUrl ? (
                      <Image width={180} height={180} src={item.matchedAsset.fileUrl} alt={item.productName} style={{ objectFit: "contain" }} />
                    ) : (
                      "无图"
                    )}
                  </div>
                  <div className="match-info">
                    <strong>{item.productName}</strong>
                    <span>x{item.quantity}</span>
                    <Tag color={item.matchedAsset ? "green" : "red"}>{item.matchedAsset ? item.matchType : "未匹配"}</Tag>
                  </div>
                </div>
              ))
            )}
            {!parses.length && <Typography.Text type="secondary">解析后会展示自动匹配结果。</Typography.Text>}
          </Space>
        </Card>
        )}
      </div>
      {generationPanel === "standard" && (
      <>
      <Card className="soft-card" title="自动解析结果">
        <Table rowKey="id" columns={parseColumns} dataSource={parses} pagination={false} />
      </Card>
      <Card className="soft-card" title="完整提示词（可修改）">
        {selectedPromptParse ? (
          <Space direction="vertical" style={{ width: "100%" }} size={12}>
            <Space wrap>
              <span>机制</span>
              <Select
                style={{ minWidth: 360 }}
                value={selectedPromptParse.id}
                onChange={setPromptParseId}
                options={parses.map((item) => ({ value: item.id, label: item.rawMechanism }))}
              />
              <Radio.Group value={promptType} onChange={(event) => setPromptType(event.target.value)}>
                <Radio.Button value="main">主图提示词</Radio.Button>
                <Radio.Button value="detail">详情页提示词</Radio.Button>
              </Radio.Group>
              {promptType === "detail" && (
                <Select
                  style={{ width: 120 }}
                  value={promptPage}
                  onChange={setPromptPage}
                  options={Array.from({ length: detailPageCount }, (_, index) => ({ value: index + 1, label: `第 ${index + 1} 屏` }))}
                />
              )}
              <Button onClick={resetCurrentPrompt}>恢复自动生成</Button>
            </Space>
            <Input.TextArea rows={14} value={currentPromptValue} onChange={(event) => updateCurrentPrompt(event.target.value)} />
          </Space>
        ) : (
          <Typography.Text type="secondary">解析机制后，这里会自动生成完整提示词，可直接修改后再生成图片。</Typography.Text>
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          这里展示的是已经替换机制、产品、白底图和参考图编号说明后的完整提示词。修改后点击生成，会按你修改后的版本发送给图片 API。
        </Typography.Paragraph>
      </Card>
      </>
      )}
      <TaskResults tasks={tasks} onRefresh={load} />
      <Drawer title="共享项目给成员" open={shareOpen} width={420} onClose={() => setShareOpen(false)}>
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Typography.Paragraph type="secondary">
            管理员默认能访问全部项目；这里用于把项目开放给指定运营、编辑或查看成员。
          </Typography.Paragraph>
          <Select
            style={{ width: "100%" }}
            placeholder="选择成员"
            value={shareUserId}
            onChange={setShareUserId}
            options={shareUsers.map((user) => ({
              value: user.id,
              label: `${user.nickname}（${user.username}）`
            }))}
          />
          <Select
            style={{ width: "100%" }}
            value={shareRole}
            onChange={setShareRole}
            options={[
              { value: "editor", label: "编辑成员：可编辑和生图" },
              { value: "viewer", label: "查看成员：只查看和下载" },
              { value: "creator", label: "项目创建者：可管理项目" }
            ]}
          />
          <Button type="primary" block onClick={shareProject}>
            保存共享
          </Button>
        </Space>
      </Drawer>
    </Space>
  );
}

const DETAIL_SCENES = [
  { title: "套装主视觉", goal: "展示产品组合、价格机制和核心卖点" },
  { title: "核心卖点解释", goal: "放大说明主要功效和使用场景" },
  { title: "资料支撑页", goal: "用资料型内容支撑卖点可信度" },
  { title: "使用场景页", goal: "展示适用人群和使用体验" },
  { title: "套装价值总结", goal: "强化价格机制、赠品和购买理由" }
];

function promptKey(parseId: string, type: "main" | "detail", page?: number) {
  return type === "main" ? `${parseId}:main` : `${parseId}:detail:${page || 1}`;
}

function buildFullPromptPreview(
  parseItem: MechanismParse,
  type: "main" | "detail",
  page: number,
  pageCount: number,
  mainTemplate: Asset | undefined,
  portraitAsset: Asset | undefined,
  template: string
) {
  const basePrompt = renderPromptTemplate(template, parseItem, page, pageCount);
  return appendReferencePromptPreview(basePrompt, buildReferencePreview(parseItem, type === "main" ? mainTemplate : undefined, type === "main" ? portraitAsset : undefined));
}

function renderPromptTemplate(template: string, parseItem: MechanismParse, page: number, pageCount: number) {
  const products = parseItem.items.map((item) => `${item.productName} x ${item.quantity}`).join("、");
  const whiteImages = parseItem.items
    .map((item) =>
      item.matchedAsset
        ? `${item.productName} x ${item.quantity}：参考资料名「${item.matchedAsset.assetName}」还原包装外观`
        : `${item.productName} x ${item.quantity}：未匹配白底图，请保持简洁陈列，不要编造复杂包装`
    )
    .join("；");
  const scene = DETAIL_SCENES[Math.min(page - 1, DETAIL_SCENES.length - 1)];
  const values: Record<string, string> = {
    price: String(parseItem.price),
    productSummary: parseItem.productSummary,
    products,
    whiteImages,
    referenceImages: whiteImages,
    sellingPoints: "柔顺蓬松、香味持久、密集修护",
    pageIndex: String(page),
    pageCount: String(pageCount),
    sceneTitle: scene.title,
    sceneGoal: scene.goal
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

function buildReferencePreview(parseItem: MechanismParse, mainTemplate?: Asset, portraitAsset?: Asset) {
  const seen = new Set<string>();
  const references: Array<{ role: "product" | "template" | "portrait"; name: string; description?: string }> = [];
  for (const item of parseItem.items) {
    const asset = item.matchedAsset;
    if (!asset?.fileUrl || seen.has(asset.fileUrl)) continue;
    seen.add(asset.fileUrl);
    references.push({ role: "product", name: item.productName, description: asset.description });
  }
  if (mainTemplate?.fileUrl && !seen.has(mainTemplate.fileUrl)) {
    references.push({ role: "template", name: mainTemplate.assetName, description: mainTemplate.description });
  }
  if (portraitAsset?.fileUrl && !seen.has(portraitAsset.fileUrl)) {
    references.push({ role: "portrait", name: portraitAsset.assetName, description: portraitAsset.description });
  }
  return references;
}

function appendReferencePromptPreview(prompt: string, references: Array<{ role: "product" | "template" | "portrait"; name: string; description?: string }>) {
  if (!references.length) return prompt;
  const numbered = references.map((reference, index) => ({ ...reference, number: index + 1 }));
  const productRefs = numbered.filter((reference) => reference.role === "product");
  const templateRef = numbered.find((reference) => reference.role === "template");
  const portraitRef = numbered.find((reference) => reference.role === "portrait");
  const productLine = productRefs.length
    ? `${productRefs.map((reference) => `参考图${reference.number} 是${reference.name}产品白底图`).join("，")}，请严格还原产品包装。`
    : "";
  const productDescriptions = productRefs
    .filter((reference) => reference.description)
    .map((reference) => `参考图${reference.number} 外观补充：${reference.description}`);
  const templateLine = templateRef
    ? `参考图${templateRef.number} 是主图模板，只参考构图和背景和卖点，不要照搬其中的产品。`
    : "";
  const templateDescription = templateRef?.description ? `参考图${templateRef.number} 模板补充：${templateRef.description}` : "";
  const portraitLine = portraitRef
    ? `参考图${portraitRef.number} 是达人肖像白底图，达人肖像图放在主图最右边，只参考人物形象、姿态和服装，不要改变产品包装。`
    : "";
  const portraitDescription = portraitRef?.description ? `参考图${portraitRef.number} 达人肖像补充：${portraitRef.description}` : "";
  return [
    prompt,
    "",
    "参考图编号说明：",
    productLine,
    ...productDescriptions,
    templateLine,
    templateDescription,
    portraitLine,
    portraitDescription,
    "总规则：产品包装外观必须以产品白底图为准；主图模板只决定版式和视觉氛围；不要混淆产品白底图和主图模板的作用。"
  ].filter(Boolean).join("\n");
}

function TaskResults({ tasks, onRefresh }: { tasks: GenerationTask[]; onRefresh: () => void }) {
  const { message } = App.useApp();
  const [selectedResultIds, setSelectedResultIds] = useState<Key[]>([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!tasks.some((task) => task.status === "queued" || task.status === "generating")) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [tasks]);
  const downloadableResults = useMemo<DownloadableResult[]>(
    () =>
      tasks.flatMap((task) => taskRows(task)),
    [tasks]
  );
  const downloadableImageResults = downloadableResults.filter((result) => result.imageUrl);
  const firstProjectId = downloadableImageResults.find((result) => result.projectId)?.projectId;
  const hasMainImageResults = downloadableImageResults.some((result) => result.outputType === "main_image");

  async function retry(id: string) {
    try {
      await api(`/api/generation/tasks/${id}/retry`, { method: "POST" });
      message.success("任务已重试");
      onRefresh();
    } catch (error) {
      message.error((error as Error).message);
    }
  }

  async function downloadSelected() {
    const selectedResults = downloadableImageResults.filter((result) => selectedResultIds.includes(result.id));
    const selectedProjectIds = Array.from(new Set(selectedResults.map((result) => result.projectId).filter(Boolean)));
    const selectedProjectId = selectedProjectIds[0];
    if (!selectedResultIds.length || !selectedProjectId) {
      message.warning("请先勾选要下载的图片");
      return;
    }
    if (selectedProjectIds.length > 1) {
      message.warning("一次只能下载同一个项目里的图片");
      return;
    }
    try {
      const response = await fetch("/api/results/download-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId, resultIds: selectedResultIds })
      });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "selected-results.zip";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      message.error((error as Error).message || "下载失败");
    }
  }

  return (
    <Card className="soft-card" title="按图片勾选下载">
      <Space wrap style={{ marginBottom: 14 }}>
        <Button onClick={downloadSelected} disabled={!selectedResultIds.length}>
          下载勾选图片
        </Button>
        <Button href={firstProjectId ? `/api/results/project/${firstProjectId}/download?type=main_image` : undefined} disabled={!hasMainImageResults}>
          下载全部主图
        </Button>
        <Typography.Text type="secondary">已选择 {selectedResultIds.length} 张</Typography.Text>
      </Space>
      {!!downloadableResults.length && (
        <Table
          size="small"
          rowKey="id"
          dataSource={downloadableResults}
          pagination={{ pageSize: 6 }}
          rowSelection={{
            selectedRowKeys: selectedResultIds,
            onChange: setSelectedResultIds,
            getCheckboxProps: (row) => ({ disabled: !row.imageUrl })
          }}
          columns={[
            {
              title: "预览",
              width: 180,
              render: (_, row) =>
                row.imageUrl ? (
                  <Image width={150} src={row.imageUrl} alt={row.id} />
                ) : (
                  <Tag color={statusColor(row.status || "queued")}>{row.status === "failed" ? "生成失败" : "等待出图"}</Tag>
                )
            },
            {
              title: "下载",
              width: 100,
              render: (_, row) => (
                row.imageUrl ? (
                  <Button size="small" href={`/api/results/${row.id}/download`}>
                    下载此图
                  </Button>
                ) : (
                  <Button size="small" onClick={() => row.retryTaskId && retry(row.retryTaskId)}>
                    重试
                  </Button>
                )
              )
            },
            { title: "类型", width: 90, render: (_, row) => (row.outputType === "main_image" ? "主图" : `详情页${row.pageIndex ? ` 第 ${row.pageIndex} 屏` : ""}`) },
            {
              title: "机制",
              render: (_, row) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{row.rawMechanism || "-"}</Typography.Text>
                  {row.expectedIndex && !row.imageUrl && <Typography.Text type="secondary">第 {row.expectedIndex} 张图片</Typography.Text>}
                </Space>
              )
            },
            { title: "图片开始生成时间", width: 170, render: (_, row) => formatDateTime(row.startedAt) },
            {
              title: "图片制作时间",
              width: 130,
              render: (_, row) => formatDuration(row.startedAt, row.completedAt || (row.status === "failed" ? row.updatedAt : String(now)))
            },
            {
              title: "状态情况",
              width: 260,
              render: (_, row) => (
                <Space direction="vertical" size={2}>
                  <Tag color={statusColor(row.status || "queued")}>{statusLabel(row.status || "queued")}</Tag>
                  {row.width && row.height && <Typography.Text type="secondary">实际尺寸：{row.width}x{row.height}</Typography.Text>}
                  {row.failureReason && <Typography.Text type="secondary">{row.failureReason}</Typography.Text>}
                </Space>
              )
            }
          ]}
        />
      )}
      {!downloadableResults.length && <Typography.Text type="secondary">暂无可下载图片，生成完成后会显示在这里。</Typography.Text>}
    </Card>
  );
}

function KnowledgeView() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetType, setAssetType] = useState("product_white_image");
  const [viewAssetType, setViewAssetType] = useState("all");
  const [editing, setEditing] = useState<Asset | null>(null);
  const [form] = Form.useForm();
  const [textForm] = Form.useForm();
  const { message } = App.useApp();

  async function load(nextType = viewAssetType) {
    const suffix = nextType === "all" ? "" : `?assetType=${encodeURIComponent(nextType)}`;
    const payload = await api<{ assets: Asset[] }>(`/api/knowledge/assets${suffix}`);
    setAssets(payload.assets);
  }

  useEffect(() => {
    load().catch((error) => message.error(error.message));
  }, [viewAssetType]);

  async function save(values: Asset) {
    if (!editing) return;
    await api(`/api/knowledge/assets/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    message.success("资料已保存");
    setEditing(null);
    load();
  }

  async function saveTextAsset(values: { assetType: string; assetName: string; description?: string; text: string }) {
    await api("/api/knowledge/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    message.success(values.assetType === "prompt" ? "提示词已保存" : "文档已保存");
    textForm.resetFields();
    load();
  }

  return (
    <Space direction="vertical" size={18} style={{ width: "100%" }}>
      <Card className="soft-card" title="提示词 / 文档">
        <Form form={textForm} layout="vertical" onFinish={saveTextAsset} initialValues={{ assetType: "prompt" }}>
          <Row gutter={16}>
            <Col xs={24} md={6}>
              <Form.Item name="assetType" label="类型">
                <Select
                  options={[
                    { value: "prompt", label: "提示词" },
                    { value: "document", label: "文档" }
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={9}>
              <Form.Item name="assetName" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
                <Input placeholder="例如：主图卖点提示词" />
              </Form.Item>
            </Col>
            <Col xs={24} md={9}>
              <Form.Item name="description" label="说明">
                <Input placeholder="用途、适用产品或备注" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="text" label="文字内容" rules={[{ required: true, message: "请输入文字内容" }]}>
            <Input.TextArea rows={6} placeholder="可以输入提示词、文档正文、卖点资料等，保存后进入知识库" />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            保存为知识库文档
          </Button>
        </Form>
      </Card>
      <Card className="soft-card" title="上传知识库资料">
        <Space wrap>
          <Select
            value={assetType}
            onChange={setAssetType}
            options={[
              { value: "product_white_image", label: "产品白底图" },
              { value: "main_template", label: "主图模板" },
              { value: "portrait_white_image", label: "达人肖像白底图" },
              { value: "prompt", label: "提示词" },
              { value: "pdf", label: "PDF" },
              { value: "ppt", label: "PPT" },
              { value: "document", label: "文档" }
            ]}
          />
          <Upload
            multiple
            showUploadList={false}
            customRequest={async ({ file, onSuccess, onError }) => {
              try {
                const formData = new FormData();
                formData.append("assetType", assetType);
                formData.append("files", file as File);
                await api("/api/knowledge/upload", { method: "POST", body: formData });
                onSuccess?.("ok");
                message.success("上传成功");
                load();
              } catch (error) {
                onError?.(error as Error);
                message.error((error as Error).message);
              }
            }}
          >
            <Button type="primary">
              上传文件
            </Button>
          </Upload>
        </Space>
      </Card>
      <Card className="soft-card" title="资料列表">
        <Space wrap style={{ marginBottom: 16 }}>
          <span>查看类型</span>
          <Select
            value={viewAssetType}
            onChange={(value) => {
              setViewAssetType(value);
              load(value).catch((error) => message.error(error.message));
            }}
            options={[
              { value: "all", label: "全部资料" },
              { value: "product_white_image", label: "产品白底图" },
              { value: "main_template", label: "主图模板" },
              { value: "portrait_white_image", label: "达人肖像白底图" },
              { value: "prompt", label: "提示词" },
              { value: "pdf", label: "PDF" },
              { value: "ppt", label: "PPT" },
              { value: "document", label: "文档" }
            ]}
          />
        </Space>
        <Table
          rowKey="id"
          dataSource={assets}
          columns={[
            {
              title: "缩略图",
              width: 110,
              render: (_, row) =>
                row.assetType === "product_white_image" || row.assetType === "main_template" || row.assetType === "portrait_white_image" ? (
                  <Image width={72} src={row.fileUrl} alt={row.assetName} />
                ) : (
                  "-"
                )
            },
            { title: "资料名称", dataIndex: "assetName" },
            { title: "产品名称", dataIndex: "productName" },
            { title: "类型", render: (_, row) => assetTypeLabel(row.assetType) },
            { title: "向量化", render: (_, row) => <Tag>{row.vectorStatus}</Tag> },
            { title: "启用", render: (_, row) => <Tag color={row.enabled ? "green" : "red"}>{row.enabled ? "启用" : "停用"}</Tag> },
            {
              title: "操作",
              render: (_, row) => (
                <Button
                  onClick={() => {
                    setEditing(row);
                    form.setFieldsValue({ ...row, aliases: jsonList(row.aliases).join("\n"), tags: jsonList(row.tags).join("\n") });
                  }}
                >
                  编辑
                </Button>
              )
            }
          ]}
        />
      </Card>
      <Drawer title="编辑资料" open={!!editing} width={460} onClose={() => setEditing(null)}>
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item name="assetName" label="资料名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="productName" label="产品名称">
            <Input />
          </Form.Item>
          <Form.Item name="assetType" label="资料类型">
            <Select
              options={[
                { value: "product_white_image", label: "产品白底图" },
                { value: "main_template", label: "主图模板" },
                { value: "portrait_white_image", label: "达人肖像白底图" },
                { value: "prompt", label: "提示词" },
                { value: "pdf", label: "PDF" },
                { value: "ppt", label: "PPT" },
                { value: "document", label: "文档" }
              ]}
            />
          </Form.Item>
          <Form.Item name="aliases" label="产品别名">
            <Input.TextArea rows={3} placeholder="一行一个别名" />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Input.TextArea rows={2} placeholder="一行一个标签" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="enabled" label="是否启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="preferred" label="优先匹配" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            保存
          </Button>
        </Form>
      </Drawer>
    </Space>
  );
}

function RecordsView({ user }: { user: User }) {
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [chatRecords, setChatRecords] = useState<ChatRecord[]>([]);
  const [recordUsers, setRecordUsers] = useState<RecordUser[]>([]);
  const [imageProjects, setImageProjects] = useState<RecordProjectOption[]>([]);
  const [chatProjects, setChatProjects] = useState<Array<RecordProjectOption & { createdById: string; nickname: string }>>([]);
  const [conversations, setConversations] = useState<RecordConversationOption[]>([]);
  const [recordType, setRecordType] = useState("all");
  const [recordUserId, setRecordUserId] = useState("all");
  const [recordProjectId, setRecordProjectId] = useState("all");
  const [recordChatProjectId, setRecordChatProjectId] = useState("all");
  const [recordConversationId, setRecordConversationId] = useState("all");
  const [selectedChatRecord, setSelectedChatRecord] = useState<ChatRecord | null>(null);
  const { message } = App.useApp();

  async function loadRecords() {
    const params = new URLSearchParams({
      type: recordType,
      userId: recordUserId,
      projectId: recordProjectId,
      chatProjectId: recordChatProjectId,
      conversationId: recordConversationId
    });
    const payload = await api<{
      users: RecordUser[];
      imageProjects: RecordProjectOption[];
      chatProjects: Array<RecordProjectOption & { createdById: string; nickname: string }>;
      conversations: RecordConversationOption[];
      tasks: GenerationTask[];
      chatRecords: ChatRecord[];
    }>(`/api/records?${params.toString()}`);
    setRecordUsers(payload.users);
    setImageProjects(payload.imageProjects);
    setChatProjects(payload.chatProjects);
    setConversations(payload.conversations);
    setTasks(payload.tasks);
    setChatRecords(payload.chatRecords);
  }

  useEffect(() => {
    loadRecords().catch((error) => message.error(error.message));
  }, [recordType, recordUserId, recordProjectId, recordChatProjectId, recordConversationId]);

  const isAdmin = user.role === "admin";
  function downloadChatRecord(record: ChatRecord) {
    window.open(`/api/chat-conversations/${record.id}/download`, "_blank");
  }

  const chatColumns: ColumnsType<ChatRecord> = [
    ...(isAdmin
      ? [
          {
            title: "用户",
            width: 140,
            render: (_: unknown, row: ChatRecord) => row.nickname || row.username
          }
        ]
      : []),
    { title: "对话项目", dataIndex: "projectName", width: 180 },
    { title: "对话", dataIndex: "title", width: 220 },
    { title: "消息数", dataIndex: "messageCount", width: 90 },
    {
      title: "最近内容",
      render: (_, row) => (
        <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>
          {row.lastMessage || "-"}
        </Typography.Paragraph>
      )
    },
    { title: "创建时间", width: 170, render: (_, row) => formatDateTime(row.createdAt) },
    { title: "更新时间", width: 170, render: (_, row) => formatDateTime(row.updatedAt) },
    {
      title: "操作",
      width: 180,
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => setSelectedChatRecord(row)}>
            查看全部
          </Button>
          <Button size="small" onClick={() => downloadChatRecord(row)}>
            下载文档
          </Button>
        </Space>
      )
    }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card className="soft-card" title="生成记录筛选">
        <Space wrap>
          <Select
            value={recordType}
            style={{ width: 140 }}
            onChange={(value) => setRecordType(value)}
            options={[
              { value: "all", label: "全部记录" },
              { value: "image", label: "只看生图" },
              { value: "chat", label: "只看对话" }
            ]}
          />
          {isAdmin && (
            <Select
              value={recordUserId}
              style={{ width: 180 }}
              onChange={(value) => {
                setRecordUserId(value);
                setRecordChatProjectId("all");
                setRecordConversationId("all");
              }}
              options={[
                { value: "all", label: "全部用户" },
                ...recordUsers.map((recordUser) => ({ value: recordUser.id, label: recordUser.nickname || recordUser.username }))
              ]}
            />
          )}
          {recordType !== "chat" && (
            <Select
              value={recordProjectId}
              style={{ width: 220 }}
              onChange={setRecordProjectId}
              options={[
                { value: "all", label: "全部生图项目" },
                ...imageProjects.map((project) => ({ value: project.id, label: project.name }))
              ]}
            />
          )}
          {recordType !== "image" && (
            <>
              <Select
                value={recordChatProjectId}
                style={{ width: 220 }}
                onChange={(value) => {
                  setRecordChatProjectId(value);
                  setRecordConversationId("all");
                }}
                options={[
                  { value: "all", label: "全部对话项目" },
                  ...chatProjects.map((project) => ({
                    value: project.id,
                    label: isAdmin ? `${project.name} / ${project.nickname}` : project.name
                  }))
                ]}
              />
              <Select
                value={recordConversationId}
                style={{ width: 220 }}
                onChange={setRecordConversationId}
                options={[
                  { value: "all", label: "全部对话" },
                  ...conversations.map((conversation) => ({ value: conversation.id, label: conversation.title }))
                ]}
              />
            </>
          )}
          <Button onClick={() => loadRecords().catch((error) => message.error(error.message))}>刷新</Button>
        </Space>
        {!isAdmin && (
          <Typography.Text type="secondary" style={{ display: "block", marginTop: 12 }}>
            当前账号只能查看自己的生图和对话记录。
          </Typography.Text>
        )}
      </Card>

      {recordType !== "chat" && <TaskResults tasks={tasks} onRefresh={() => loadRecords().catch((error) => message.error(error.message))} />}

      {recordType !== "image" && (
        <Card className="soft-card" title="对话记录">
          <Table rowKey="id" dataSource={chatRecords} columns={chatColumns} pagination={{ pageSize: 8 }} />
        </Card>
      )}
      <Drawer
        width={760}
        open={Boolean(selectedChatRecord)}
        title={selectedChatRecord ? `${selectedChatRecord.nickname || selectedChatRecord.username} / ${selectedChatRecord.projectName} / ${selectedChatRecord.title}` : "对话详情"}
        onClose={() => setSelectedChatRecord(null)}
        extra={
          selectedChatRecord ? (
            <Button onClick={() => downloadChatRecord(selectedChatRecord)}>
              下载本次对话
            </Button>
          ) : null
        }
      >
        {selectedChatRecord && (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="用户">{selectedChatRecord.nickname || selectedChatRecord.username}</Descriptions.Item>
              <Descriptions.Item label="账号">{selectedChatRecord.username}</Descriptions.Item>
              <Descriptions.Item label="对话项目">{selectedChatRecord.projectName}</Descriptions.Item>
              <Descriptions.Item label="对话">{selectedChatRecord.title}</Descriptions.Item>
              <Descriptions.Item label="消息数">{selectedChatRecord.messageCount}</Descriptions.Item>
              <Descriptions.Item label="更新时间">{formatDateTime(selectedChatRecord.updatedAt)}</Descriptions.Item>
            </Descriptions>
            <div className="record-chat-detail">
              {(selectedChatRecord.messages || []).map((item) => (
                <div className={`record-chat-message ${item.role}`} key={item.id}>
                  <div className="record-chat-message-head">
                    <Tag color={item.role === "user" ? "blue" : "purple"}>{item.role === "user" ? "用户" : "AI"}</Tag>
                    <Typography.Text type="secondary">{item.createdAt ? formatDateTime(item.createdAt) : ""}</Typography.Text>
                  </div>
                  <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{item.content}</Typography.Paragraph>
                </div>
              ))}
              {!(selectedChatRecord.messages || []).length && <Typography.Text type="secondary">这个对话还没有消息。</Typography.Text>}
            </div>
          </Space>
        )}
      </Drawer>
    </Space>
  );
}

function SettingsView({ user }: { user: User }) {
  const [configForm] = Form.useForm();
  const [userForm] = Form.useForm();
  const [editUserForm] = Form.useForm();
  const [roleForm] = Form.useForm();
  const [users, setUsers] = useState<User[]>([]);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [usageRows, setUsageRows] = useState<UsageRow[]>([]);
  const [usageUserId, setUsageUserId] = useState("all");
  const [usagePeriod, setUsagePeriod] = useState("day");
  const [usageAnchorDate, setUsageAnchorDate] = useState(todayDate());
  const { message } = App.useApp();

  async function load() {
    if (user.role !== "admin") return;
    const [config, list] = await Promise.all([
      api<{ config: Record<string, unknown> }>("/api/settings/api-config"),
      api<{ users: User[] }>("/api/users")
    ]);
    const rolePayload = await api<{ roles: RoleDefinition[] }>("/api/settings/roles");
    configForm.setFieldsValue(config.config);
    setUsers(list.users);
    setRoles(rolePayload.roles);
    await loadUsage();
  }

  async function loadUsage(nextUserId = usageUserId, nextPeriod = usagePeriod, nextAnchorDate = usageAnchorDate) {
    if (user.role !== "admin") return;
    const payload = await api<{ rows: UsageRow[] }>(
      `/api/settings/usage?userId=${encodeURIComponent(nextUserId)}&period=${encodeURIComponent(nextPeriod)}&anchorDate=${encodeURIComponent(nextAnchorDate)}`
    );
    setUsageRows(payload.rows);
  }

  useEffect(() => {
    load().catch((error) => message.error(error.message));
  }, []);

  useEffect(() => {
    loadUsage().catch((error) => message.error(error.message));
  }, [usageUserId, usagePeriod, usageAnchorDate]);

  function changeUsagePeriod(nextPeriod: string) {
    setUsagePeriod(nextPeriod);
    setUsageAnchorDate(todayDate());
  }

  if (user.role !== "admin" && !user.permissions?.includes("manage_settings")) {
    return <Card className="soft-card">当前账号无权限访问 API 配置。</Card>;
  }

  async function saveConfig(values: unknown) {
    await api("/api/settings/api-config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    message.success("配置已保存");
  }

  async function testApi(type: string) {
    const hide = message.loading("正在测试连接...", 0);
    try {
      await api("/api/settings/api-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type })
      });
      message.success("API 连接成功");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      hide();
    }
  }

  async function createUser(values: { username: string; nickname?: string; password: string; role: string }) {
    await api("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    message.success("用户已创建");
    userForm.resetFields();
    load();
  }

  async function updateUser(values: { nickname?: string; role?: string; status?: string; password?: string }) {
    if (!editingUser) return;
    await api(`/api/users/${editingUser.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    message.success("用户已更新");
    setEditingUser(null);
    editUserForm.resetFields();
    load();
  }

  async function toggleUserStatus(row: User) {
    await api(`/api/users/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: row.status === "active" ? "disabled" : "active" })
    });
    message.success(row.status === "active" ? "用户已停用" : "用户已启用");
    load();
  }

  async function deleteUser(row: User) {
    await api(`/api/users/${row.id}`, { method: "DELETE" });
    message.success("用户已删除");
    load();
  }

  async function saveRole(values: { key: string; name: string; permissions: string[] }) {
    const payload = await api<{ roles: RoleDefinition[] }>("/api/settings/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    setRoles(payload.roles);
    roleForm.resetFields();
    message.success("角色已保存");
  }

  async function deleteCustomRole(role: RoleDefinition) {
    const payload = await api<{ roles: RoleDefinition[] }>(`/api/settings/roles/${encodeURIComponent(role.key)}`, { method: "DELETE" });
    setRoles(payload.roles);
    load();
    message.success("角色已删除，原角色用户已转为查看成员");
  }

  return (
    <>
      <Tabs
      items={[
        {
          key: "api",
          label: (
            <span>
              API 配置
            </span>
          ),
          children: (
            <Card className="soft-card">
              <Form form={configForm} layout="vertical" onFinish={saveConfig}>
                <Row gutter={16}>
                  <Col xs={24} md={12}>
                    <Form.Item name="textBaseUrl" label="文本 API Base URL">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="textModel" label="文本模型名称">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="textWireApi" label="文本调用方式">
                      <Select
                        options={[
                          { value: "responses", label: "Responses API" },
                          { value: "chat", label: "Chat Completions" },
                          { value: "auto", label: "自动判断" }
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="disableResponseStorage" label="禁用响应存储" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="textPromptCacheEnabled" label="启用提示词缓存" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="textPromptCacheRetention" label="缓存保留时间">
                      <Input placeholder="例如 24h" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="textPromptCacheKey" label="缓存 Key">
                      <Input placeholder="commerce-chat" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="imageBaseUrl" label="图像 API Base URL">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="imageModel" label="图像模型名称">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="embeddingModel" label="Embedding 模型名称">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="maxConcurrency" label="最大并发任务数">
                      <InputNumber min={1} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="timeoutSeconds" label="请求超时时间（秒）">
                      <InputNumber min={10} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                </Row>
                <Space wrap>
                  <Button type="primary" htmlType="submit">
                    保存配置
                  </Button>
                  <Button onClick={() => testApi("text")}>测试文本 API</Button>
                  <Button onClick={() => testApi("image")}>测试图像 API</Button>
                </Space>
              </Form>
            </Card>
          )
        },
        {
          key: "users",
          label: "用户列表",
          children: (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Card className="soft-card" title="创建用户">
                <Form form={userForm} layout="inline" onFinish={createUser} initialValues={{ role: "creator" }}>
                  <Form.Item name="username" rules={[{ required: true, message: "账号必填" }]}>
                    <Input placeholder="账号" />
                  </Form.Item>
                  <Form.Item name="nickname">
                    <Input placeholder="昵称" />
                  </Form.Item>
                  <Form.Item name="password" rules={[{ required: true, message: "密码必填" }]}>
                    <Input.Password placeholder="初始密码" />
                  </Form.Item>
                  <Form.Item name="role">
                    <Select style={{ width: 150 }} options={roleSelectOptions(roles)} />
                  </Form.Item>
                  <Button type="primary" htmlType="submit">
                    创建
                  </Button>
                </Form>
              </Card>
              <Card className="soft-card" title="角色设定 / 权限设定">
                <Space direction="vertical" size={14} style={{ width: "100%" }}>
                  <Form form={roleForm} layout="inline" onFinish={saveRole}>
                    <Form.Item name="key" rules={[{ required: true, message: "角色标识必填" }]}>
                      <Input placeholder="角色标识，例如 operator" />
                    </Form.Item>
                    <Form.Item name="name" rules={[{ required: true, message: "角色名称必填" }]}>
                      <Input placeholder="角色名称，例如 运营" />
                    </Form.Item>
                    <Form.Item name="permissions" rules={[{ required: true, message: "请选择权限" }]}>
                      <Select mode="multiple" style={{ minWidth: 360 }} placeholder="选择权限" options={permissionSelectOptions} />
                    </Form.Item>
                    <Button type="primary" htmlType="submit">
                      保存角色
                    </Button>
                  </Form>
                  <Table
                    rowKey="key"
                    size="small"
                    dataSource={roles}
                    pagination={false}
                    columns={[
                      { title: "角色名称", render: (_, row) => `${row.name}（${row.key}）` },
                      {
                        title: "权限",
                        render: (_, row) => (
                          <Space wrap>
                            {row.permissions.map((permission) => (
                              <Tag key={permission}>{permissionLabels[permission] || permission}</Tag>
                            ))}
                          </Space>
                        )
                      },
                      {
                        title: "操作",
                        width: 190,
                        render: (_, row) => (
                          <Space>
                            <Button
                              size="small"
                              onClick={() =>
                                roleForm.setFieldsValue({
                                  key: row.key,
                                  name: row.name,
                                  permissions: row.permissions
                                })
                              }
                            >
                              编辑
                            </Button>
                            <Button size="small" danger disabled={row.system} onClick={() => deleteCustomRole(row)}>
                              删除
                            </Button>
                          </Space>
                        )
                      }
                    ]}
                  />
                  <Typography.Text type="secondary">管理员、项目创建者、编辑成员、查看成员为系统角色，不能删除；自定义角色删除后，对应用户会自动转为查看成员。</Typography.Text>
                </Space>
              </Card>
              <Row gutter={16}>
                <Col xs={24} xl={12}>
                  <Card className="soft-card" title="用户列表">
                    <Table
                      rowKey="id"
                      dataSource={users}
                      pagination={{ pageSize: 8 }}
                      columns={[
                        { title: "账号", dataIndex: "username" },
                        { title: "昵称", dataIndex: "nickname" },
                        { title: "角色", render: (_, row) => roleLabel(row.role, roles) },
                        { title: "状态", render: (_, row) => <Tag color={row.status === "active" ? "green" : "red"}>{row.status === "active" ? "启用" : "停用"}</Tag> },
                        {
                          title: "操作",
                          width: 210,
                          render: (_, row) => (
                            <Space wrap>
                              <Button
                                size="small"
                                onClick={() => {
                                  setEditingUser(row);
                                  editUserForm.setFieldsValue({ nickname: row.nickname, role: row.role, status: row.status, password: "" });
                                }}
                              >
                                编辑
                              </Button>
                              <Button size="small" onClick={() => toggleUserStatus(row)} disabled={row.id === user.id}>
                                {row.status === "active" ? "停用" : "启用"}
                              </Button>
                              <Button size="small" danger onClick={() => deleteUser(row)} disabled={row.id === user.id}>
                                删除
                              </Button>
                            </Space>
                          )
                        }
                      ]}
                    />
                  </Card>
                </Col>
                <Col xs={24} xl={12}>
                  <Card
                    className="soft-card"
                    title="消耗列表"
                    extra={
                      <Space wrap>
                        <Select
                          style={{ width: 160 }}
                          value={usageUserId}
                          onChange={setUsageUserId}
                          options={[
                            { value: "all", label: "全部用户" },
                            ...users.map((item) => ({ value: item.id, label: item.nickname || item.username }))
                          ]}
                        />
                        <Radio.Group
                          value={usagePeriod}
                          onChange={(event) => changeUsagePeriod(event.target.value)}
                          options={[
                            { value: "day", label: "每天" },
                            { value: "week", label: "每周" },
                            { value: "month", label: "每月" }
                          ]}
                          optionType="button"
                        />
                        {usagePeriod === "month" ? (
                          <Input
                            type="month"
                            style={{ width: 150 }}
                            value={usageAnchorDate.slice(0, 7)}
                            onChange={(event) => event.target.value && setUsageAnchorDate(`${event.target.value}-01`)}
                          />
                        ) : (
                          <Input
                            type="date"
                            style={{ width: 170 }}
                            value={usageAnchorDate}
                            title={usagePeriod === "week" ? "选择周内任意一天" : "选择日期"}
                            onChange={(event) => event.target.value && setUsageAnchorDate(event.target.value)}
                          />
                        )}
                      </Space>
                    }
                  >
                    <Space direction="vertical" size={12} style={{ width: "100%" }}>
                      <Space wrap>
                        <Statistic title="生图数量" value={usageRows.reduce((sum, row) => sum + row.imageCount, 0)} suffix="张" />
                        <Statistic title="生图消耗金额" value={usageRows.reduce((sum, row) => sum + row.estimatedCost, 0)} prefix="¥" precision={4} />
                        <Statistic title="对话次数" value={usageRows.reduce((sum, row) => sum + row.chatCount, 0)} suffix="次" />
                        <Statistic title="对话消耗金额" value={usageRows.reduce((sum, row) => sum + row.chatEstimatedCost, 0)} prefix="¥" precision={4} />
                        <Statistic title="缓存命中 Token" value={usageRows.reduce((sum, row) => sum + row.chatCachedTokens, 0)} />
                        <Statistic title="总估算消耗" value={usageRows.reduce((sum, row) => sum + row.totalEstimatedCost, 0)} prefix="¥" precision={4} />
                      </Space>
                      <Table
                        rowKey="id"
                        size="small"
                        dataSource={usageRows}
                        pagination={{ pageSize: 8 }}
                        columns={[
                          { title: "用户", render: (_, row) => row.nickname || row.username },
                          { title: "周期", dataIndex: "period" },
                          { title: "生图数量", dataIndex: "imageCount" },
                          { title: "生图金额", render: (_, row) => `¥${row.estimatedCost.toFixed(4)}` },
                          { title: "对话次数", dataIndex: "chatCount" },
                          { title: "缓存 Token", dataIndex: "chatCachedTokens" },
                          { title: "对话金额", render: (_, row) => `¥${row.chatEstimatedCost.toFixed(4)}` },
                          { title: "合计金额", render: (_, row) => `¥${row.totalEstimatedCost.toFixed(4)}` }
                        ]}
                      />
                      <Typography.Text type="secondary">金额按已完成图片和聊天 token 估算；如平台后续提供账单接口，可切换为真实扣费。</Typography.Text>
                    </Space>
                  </Card>
                </Col>
              </Row>
            </Space>
          )
        }
      ]}
      />
      <Modal open={!!editingUser} title="编辑用户" onCancel={() => setEditingUser(null)} onOk={() => editUserForm.submit()} destroyOnHidden>
      <Form form={editUserForm} layout="vertical" onFinish={updateUser}>
        <Form.Item label="账号">
          <Input value={editingUser?.username} disabled />
        </Form.Item>
        <Form.Item name="nickname" label="昵称" rules={[{ required: true, message: "请输入昵称" }]}>
          <Input />
        </Form.Item>
        <Form.Item name="role" label="角色" rules={[{ required: true, message: "请选择角色" }]}>
          <Select options={roleSelectOptions(roles)} />
        </Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true, message: "请选择状态" }]}>
          <Select
            options={[
              { value: "active", label: "启用" },
              { value: "disabled", label: "停用" }
            ]}
            disabled={editingUser?.id === user.id}
          />
        </Form.Item>
        <Form.Item name="password" label="重置密码">
          <Input.Password placeholder="不填写则不修改密码" />
        </Form.Item>
      </Form>
      </Modal>
    </>
  );
}

function roleOptions() {
  return [
    { value: "admin", label: "管理员" },
    { value: "creator", label: "项目创建者" },
    { value: "editor", label: "编辑成员" },
    { value: "viewer", label: "查看成员" }
  ];
}

function roleSelectOptions(roles: RoleDefinition[]) {
  return roles.length ? roles.map((role) => ({ value: role.key, label: role.name })) : roleOptions();
}

function roleLabel(role: string, roles?: RoleDefinition[]) {
  return roles?.find((item) => item.key === role)?.name || roleOptions().find((item) => item.value === role)?.label || role;
}

function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function mergeTasks(incoming: GenerationTask[], current: GenerationTask[]) {
  const map = new Map<string, GenerationTask>();
  for (const task of incoming) map.set(task.id, task);
  for (const task of current) if (!map.has(task.id)) map.set(task.id, task);
  return Array.from(map.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function mergeAssets(incoming: Asset[], current: Asset[]) {
  const map = new Map<string, Asset>();
  for (const asset of incoming) map.set(asset.id, asset);
  for (const asset of current) if (!map.has(asset.id)) map.set(asset.id, asset);
  return Array.from(map.values());
}

function customImageSize(aspectRatio: string, resolution: string) {
  const sizeMap: Record<string, Record<string, string>> = {
    "1:1": {
      "1024": "1024x1024",
      "2048": "2048x2048",
      "4096": "4096x4096"
    },
    "9:16": {
      "1024": "1024x1792",
      "2048": "2048x3584",
      "4096": "4096x7168"
    }
  };
  return sizeMap[aspectRatio]?.[resolution] || "1024x1024";
}

function taskRows(task: GenerationTask): DownloadableResult[] {
  const base = {
    taskId: task.id,
    projectId: task.project?.id,
    outputType: task.outputType,
    rawMechanism: task.parse?.rawMechanism,
    failureReason: task.failureReason,
    startedAt: task.createdAt,
    updatedAt: task.updatedAt,
    retryTaskId: task.id
  };
  const resultRows = task.results.map((result, index) => ({
    ...result,
    ...base,
    status: "completed",
    completedAt: result.createdAt || task.updatedAt,
    expectedIndex: result.pageIndex || index + 1
  }));
  const expectedCount = task.outputType === "detail_pages" ? task.detailPageCount || task.imageCount || 1 : task.imageCount || 1;
  const remainingCount = Math.max(0, expectedCount - resultRows.length);
  if (!remainingCount || task.status === "completed") return resultRows;
  const placeholders = Array.from({ length: remainingCount }, (_, index) => {
    const expectedIndex = resultRows.length + index + 1;
    return {
      id: `${task.status}-${task.id}-${expectedIndex}`,
      imageUrl: "",
      pageIndex: task.outputType === "detail_pages" ? expectedIndex : undefined,
      ...base,
      status: task.status,
      failureReason: task.status === "failed" ? task.failureReason : undefined,
      expectedIndex
    };
  });
  return [...resultRows, ...placeholders];
}

function statusLabel(status: string) {
  return { queued: "排队中", generating: "进行中", completed: "已完成", failed: "失败", canceled: "已取消" }[status] || status;
}

function statusColor(status: string) {
  return { queued: "blue", generating: "gold", completed: "green", failed: "red", canceled: "default" }[status] || "default";
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "-";
  return time.toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(start?: string, end?: string) {
  if (!start) return "-";
  const startMs = new Date(start).getTime();
  const endMs = end && /^\d+$/.test(end) ? Number(end) : new Date(end || Date.now()).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return "-";
  const seconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  return minutes ? `${minutes}分${restSeconds}秒` : `${restSeconds}秒`;
}

function formatRelativeDay(value?: string) {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "";
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days <= 0) return "今天";
  return `${days}天`;
}

function assetTypeLabel(type: string) {
  return (
    {
      product_white_image: "产品白底图",
      main_template: "主图模板",
      portrait_white_image: "达人肖像白底图",
      prompt: "提示词",
      pdf: "PDF",
      ppt: "PPT",
      document: "文档"
    }[type] || type
  );
}

function jsonList(value?: string) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
