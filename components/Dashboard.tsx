"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type Key, useEffect, useMemo, useState } from "react";
import type { ExcelPreview } from "@/lib/excel-preview";
import { Markdown } from "@/components/Markdown";
import { resolveCacheProfile, DEFAULT_RETENTION, DEFAULT_CACHE_KEY } from "@/lib/model-cache-profiles";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
  Legend
} from "recharts";
import { Tooltip as RechartsTooltip } from "recharts";
import {
  App,
  Alert,
  Avatar,
  Button,
  Card,
  Collapse,
  Col,
  ConfigProvider,
  Descriptions,
  Divider,
  Drawer,
  Dropdown,
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
  Tooltip,
  Typography,
  Upload
} from "antd";
import type { ColumnsType } from "antd/es/table";

type User = { id: string; username: string; nickname: string; role: string; status: string; departmentId?: string | null; advertiserId?: string | null; permissions?: string[] };
type AdvertiserBinding = { advertiserId: string; isPrimary: boolean; createdAt: string };
type AdvertiserList = { activeAdvertiserId: string | null; bindings: AdvertiserBinding[] };
type RoleDefinition = { key: string; name: string; permissions: string[]; system: boolean };
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  processLog?: ProcessLogEntry[];
  finalDebug?: ChatDebug;
  finalAssets?: Array<{ id: string; assetName: string; assetType: string }>;
  streaming?: boolean;
};
type ProcessLogEntry =
  | { type: "intent"; scenes: Array<{ sceneKey: string; sceneName: string; score: number }>; text: string }
  | { type: "manual_mode"; count: number; text: string }
  | { type: "retrieve"; assets: Array<{ id: string; assetName: string; assetType: string; score: number }>; contextChars: number; text: string }
  | {
      type: "skill";
      calls: Array<{ id: string; name: string; arguments: unknown; result: string; ok: boolean; error?: string }>;
      contextChars: number;
      text: string;
    }
  | { type: "context"; chars: number; preview: string; fullContext: string; text: string }
  | { type: "usage"; promptTokens?: number; completionTokens?: number; totalTokens?: number; text: string }
  | { type: "error"; error: string; details?: ChatErrorDetails; text: string }
  | { type: "done"; text: string };
type ChatErrorDetails = {
  message?: string;
  status?: number;
  url?: string;
  type?: string;
  code?: string;
  param?: string;
  requestId?: string;
  bodySnippet?: string;
};
type ChatDebug = {
  useKnowledgeSwitch: boolean;
  useQianchuanSwitch?: boolean;
  usedPath: "manual" | "auto" | "skill" | "none";
  intentScenes: Array<{ sceneKey: string; sceneName: string; score: number }>;
  ranked: Array<{ id: string; assetName: string; assetType: string; score: number; scenes: string[] }>;
  baseAssetCount: number;
  contextCharCount: number;
  contextPreview?: string;
  skillCalls?: Array<{ id?: string; name?: string; ok?: boolean; matchedAssets?: Array<{ id: string }> }>;
};
type ChatConversationSummary = {
  id: string;
  projectId: string;
  title: string;
  prefsJson?: string;
  createdAt: string;
  updatedAt: string;
};
type ChatProjectSummary = { id: string; name: string; createdAt: string; updatedAt: string; conversations: ChatConversationSummary[] };
type ChatConversationPrefs = {
  keyword: string;
  chatAssetType: string;
  selectedAssetIds: Key[];
  useAll: boolean;
  useKnowledge: boolean;
  useQianchuan: boolean;
  question: string;
};
// 从 prefsJson 解析出来的持久化字段 (DB 存的就是这两个开关, 其它字段是会话级临时)
type ChatConversationPersistedPrefs = Pick<ChatConversationPrefs, "useKnowledge" | "useQianchuan">;
const DEFAULT_CHAT_PREFS: ChatConversationPrefs = {
  keyword: "",
  chatAssetType: "all",
  selectedAssetIds: [],
  useAll: false,
  useKnowledge: false,
  useQianchuan: true,
  question: ""
};
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
  departmentId?: string | null;
  scenes?: string | string[];
  preview?: ExcelPreview | null;
};
type Department = { id: string; name: string; code?: string | null; description?: string | null; status: string };
type BusinessScene = { id: string; departmentId: string; sceneKey: string; sceneName: string; description?: string | null };
type SkillRow = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  parameters: string;
  executeMode: "search_kb" | "get_detail" | "no_op";
  executeConfig: string;
  systemPrompt: string | null;
  enabled: boolean;
  departmentId: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
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
  const [advertiserList, setAdvertiserList] = useState<AdvertiserList>({
    activeAdvertiserId: null,
    bindings: []
  });
  const router = useRouter();
  const pathname = usePathname();
  const { message, modal } = App.useApp();

  useEffect(() => {
    api<{ user: User | null }>("/api/auth/me")
      .then(async (payload) => {
        if (!payload.user) {
          router.push("/login");
          return;
        }
        setUser(payload.user);
        try {
          const adv = await api<AdvertiserList>("/api/me/advertiser");
          setAdvertiserList(adv);
        } catch {
          setAdvertiserList({ activeAdvertiserId: null, bindings: [] });
        }
      })
      .catch(() => router.push("/login"));
  }, [router]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function switchAdvertiser(advertiserId: string) {
    try {
      await api("/api/me/advertiser", {
        method: "POST",
        body: JSON.stringify({ advertiserId })
      });
      message.success(`已切换到广告主 ${advertiserId}`);
      window.location.reload();
    } catch (e) {
      message.error((e as Error).message || "切换失败");
    }
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
          {advertiserList.bindings.length > 0 ? (
            <Dropdown
              menu={{
                items: advertiserList.bindings.map((b) => ({
                  key: b.advertiserId,
                  label: (
                    <span>
                      {b.advertiserId}
                      {b.isPrimary ? " ⭐" : ""}
                      {b.advertiserId === advertiserList.activeAdvertiserId ? " ✓" : ""}
                    </span>
                  )
                })),
                onClick: ({ key }) => {
                  if (key !== advertiserList.activeAdvertiserId) switchAdvertiser(String(key));
                }
              }}
            >
              <Tag color="cyan" style={{ cursor: "pointer" }}>
                广告主：{advertiserList.activeAdvertiserId || "未绑定"} ▾
              </Tag>
            </Dropdown>
          ) : (
            <Tag color="default">广告主：未绑定</Tag>
          )}
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
        {view === "project" && projectId && <ProjectWorkspace projectId={projectId} user={user} />}
        {view === "knowledge" && <KnowledgeView user={user} />}
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
  const { message, modal } = App.useApp();

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

function ChatProcessLog({ entries }: { entries: ProcessLogEntry[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { message, modal } = App.useApp();
  if (!entries.length) return null;
  return (
    <div className="chat-process-log">
      {entries.map((entry, index) => {
        const isContext = entry.type === "context";
        const isSkill = entry.type === "skill";
        const isOpen = (isContext || isSkill) && openIndex === index;
        return (
          <div key={index} className={`chat-process-log-row chat-process-log-${entry.type}`}>
            <span className="chat-process-log-icon">{logIcon(entry.type)}</span>
            <span className="chat-process-log-text" style={{ flex: 1 }}>
              {entry.text}
              {isContext && entry.fullContext && (
                <span style={{ marginLeft: 8 }}>
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, height: "auto", fontSize: 12 }}
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                  >
                    {isOpen ? "收起完整 context" : "查看完整 context"}
                  </Button>
                </span>
              )}
              {entry.type === "skill" && (
                <span style={{ marginLeft: 8 }}>
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, height: "auto", fontSize: 12 }}
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                  >
                    {isOpen ? "收起技能详情" : "查看技能详情"}
                  </Button>
                </span>
              )}
            </span>
            {isContext && isOpen && (
              <div className="chat-process-log-context" style={{ width: "100%" }}>
                <pre className="chat-process-log-context-pre">{entry.fullContext}</pre>
                <Space size={8} style={{ marginTop: 6 }}>
                  <Tag color="default">共 {entry.chars} 字</Tag>
                  <Button
                    size="small"
                    onClick={() => {
                      if (typeof navigator !== "undefined" && navigator.clipboard) {
                        navigator.clipboard
                          .writeText(entry.fullContext)
                          .then(() => message.success("已复制完整 context"))
                          .catch(() => message.error("复制失败"));
                      }
                    }}
                  >
                    复制
                  </Button>
                </Space>
              </div>
            )}
            {entry.type === "skill" && isOpen && (
              <div className="chat-process-log-skill" style={{ width: "100%" }}>
                {entry.calls.map((call) => (
                  <div key={call.id} style={{ marginBottom: 8 }}>
                    <Space size={6} wrap>
                      <Tag color={call.ok ? "blue" : "red"}>{call.name}</Tag>
                      {!call.ok && <Tag color="red">{call.error}</Tag>}
                    </Space>
                    <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
                      参数：{formatSkillArgs(call.arguments)}
                    </div>
                    <pre className="chat-process-log-context-pre" style={{ maxHeight: 220 }}>
                      {call.result || "（无返回内容）"}
                    </pre>
                  </div>
                ))}
                <Tag color="default">拼接 context：{entry.contextChars} 字</Tag>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatErrorDetails(details?: ChatErrorDetails) {
  if (!details) return "";
  const parts: string[] = [];
  if (typeof details.status === "number" && details.status > 0) {
    parts.push(`status=${details.status}`);
  }
  if (details.code) parts.push(`code=${details.code}`);
  if (details.type && details.type !== details.code) parts.push(`type=${details.type}`);
  if (details.requestId) parts.push(`requestId=${details.requestId}`);
  if (details.url) parts.push(`url=${details.url}`);
  if (!parts.length) return "";
  return `\n详情：${parts.join(" · ")}`;
}

function formatSkillArgs(args: unknown) {
  if (!args || typeof args !== "object") return String(args ?? "");
  const entries = Object.entries(args as Record<string, unknown>);
  if (!entries.length) return "";
  return entries
    .map(([key, value]) => {
      if (value === undefined || value === null) return `${key}=`;
      if (typeof value === "string") {
        const trimmed = value.length > 40 ? `${value.slice(0, 40)}…` : value;
        return `${key}="${trimmed}"`;
      }
      return `${key}=${JSON.stringify(value)}`;
    })
    .join(", ");
}

function logIcon(type: ProcessLogEntry["type"]) {
  switch (type) {
    case "intent":
      return "🔍";
    case "manual_mode":
      return "📚";
    case "retrieve":
      return "✅";
    case "skill":
      return "🛠";
    case "context":
      return "🧠";
    case "usage":
      return "📊";
    case "error":
      return "❌";
    case "done":
      return "✨";
    default:
      return "•";
  }
}

function ChatDebugPanel({ debug }: { debug: ChatDebug }) {
  const [mode, setMode] = useState<"refs" | "debug">("refs");
  const [collapsed, setCollapsed] = useState(false);
  const ranked = debug.ranked || [];
  const hasRefs = ranked.length > 0;
  const manualRefs = debug.baseAssetCount || 0;
  const usedKB = debug.usedPath !== "none" && (hasRefs || manualRefs > 0);
  const intentNames = debug.intentScenes?.map((s) => s.sceneName).filter(Boolean).join("、") || "无";
  return (
    <div className={`chat-debug-panel ${usedKB ? "kb-used" : "kb-empty"}`}>
      <div className="chat-debug-status">
        {usedKB ? (
          <Tag color="green" style={{ fontSize: 13, padding: "2px 10px" }}>
            ✅ 已调用知识库
            {debug.usedPath === "auto" && hasRefs ? ` · 命中 ${ranked.length} 条` : ""}
            {debug.usedPath === "manual" ? ` · 手动路径 ${manualRefs} 条` : ""}
            {debug.usedPath === "auto" && !hasRefs ? " · 本部门无匹配资料" : ""}
          </Tag>
        ) : (
          <Tag color="default" style={{ fontSize: 13, padding: "2px 10px" }}>
            ❌ 未调用知识库
            {!debug.useKnowledgeSwitch
              ? "（未打开「使用知识库」开关）"
              : debug.usedPath === "skill" && !(debug.skillCalls?.length ?? 0)
                ? "（本轮未触发知识库检索）"
                : "（已开启开关但本部门无匹配资料）"}
          </Tag>
        )}
        {usedKB ? (
          <Button size="small" type="link" onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? `展开引用（${hasRefs || manualRefs}）` : "收起"}
          </Button>
        ) : null}
      </div>
      {usedKB && !collapsed ? (
        <>
          <div className="chat-debug-tabs">
            <Button
              size="small"
              type={mode === "refs" ? "primary" : "default"}
              onClick={() => setMode("refs")}
            >
              📎 引用 {hasRefs || manualRefs} 条资料
            </Button>
            <Button
              size="small"
              type={mode === "debug" ? "primary" : "default"}
              onClick={() => setMode("debug")}
            >
              🔍 调用详情
            </Button>
          </div>
          {mode === "refs" ? (
            <div className="chat-debug-refs">
              {hasRefs ? (
                <Space direction="vertical" size={6} style={{ width: "100%" }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    路径：{debug.usedPath === "auto" ? "部门 KB 检索" : "手动选用"}
                    {debug.intentScenes?.length ? ` · 场景：${intentNames}` : ""}
                  </Typography.Text>
                  {ranked.map((entry, index) => (
                    <div key={entry.id} className="chat-debug-ref-item">
                      <Tag color="cyan">资料{index + 1}</Tag>
                      <Typography.Text strong>{entry.assetName}</Typography.Text>
                      <Tag>{assetTypeLabel(entry.assetType)}</Tag>
                      {entry.score > 0 ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>score {entry.score}</Typography.Text>
                      ) : null}
                      {entry.scenes.length ? (
                        <Space size={4}>
                          {entry.scenes.map((scene) => (
                            <Tag key={scene} color="blue">{scene}</Tag>
                          ))}
                        </Space>
                      ) : null}
                    </div>
                  ))}
                </Space>
              ) : manualRefs > 0 ? (
                <Typography.Text type="secondary">
                  {debug.usedPath === "manual" ? "手动" : "技能"}路径拉取了 {manualRefs} 条资料。
                </Typography.Text>
              ) : null}
            </div>
          ) : (
            <div className="chat-debug-detail">
              <Descriptions size="small" column={2} style={{ marginTop: 8 }}>
                <Descriptions.Item label="KB 开关">{debug.useKnowledgeSwitch ? "开" : "关"}</Descriptions.Item>
                <Descriptions.Item label="调用路径">
                  {debug.usedPath === "auto" ? "部门 KB 检索" : debug.usedPath === "manual" ? "手动选用" : debug.usedPath === "skill" ? "技能检索 KB" : "未调用"}
                </Descriptions.Item>
                <Descriptions.Item label="命中场景" span={2}>{intentNames}</Descriptions.Item>
                <Descriptions.Item label="命中条数">{hasRefs || manualRefs}</Descriptions.Item>
                <Descriptions.Item label="Context 字符">{debug.contextCharCount}</Descriptions.Item>
              </Descriptions>
              {hasRefs ? (
                <div className="chat-debug-ranked">
                  <Typography.Text strong style={{ fontSize: 12 }}>命中列表：</Typography.Text>
                  {ranked.map((entry) => (
                    <div key={entry.id} className="chat-debug-ranked-row">
                      <Tag color="purple">score {entry.score}</Tag>
                      <span>{entry.assetName}</span>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {entry.scenes.length ? `场景：${entry.scenes.join("、")}` : "通用"}
                      </Typography.Text>
                    </div>
                  ))}
                </div>
              ) : null}
              {debug.contextPreview ? (
                <div className="chat-debug-context">
                  <Typography.Text strong style={{ fontSize: 12 }}>Context 预览（前 1500 字）：</Typography.Text>
                  <pre>{debug.contextPreview}</pre>
                </div>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </div>
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
  const [chatPrefs, setChatPrefs] = useState<Record<string, ChatConversationPrefs>>({});
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [chatUploadLoading, setChatUploadLoading] = useState(false);
  const { message, modal } = App.useApp();

  const activePrefs: ChatConversationPrefs = activeConversationId
    ? chatPrefs[activeConversationId] || DEFAULT_CHAT_PREFS
    : DEFAULT_CHAT_PREFS;
  function patchActivePrefs(patch: Partial<ChatConversationPrefs>) {
    if (!activeConversationId) return;
    setChatPrefs((current) => ({
      ...current,
      [activeConversationId]: { ...(current[activeConversationId] || DEFAULT_CHAT_PREFS), ...patch }
    }));
    // useKnowledge/useQianchuan 是持久化字段, 改动后立刻 PATCH 到 DB,
    // 这样切换/新建对话后该对话仍沿用本次设置.
    if (typeof patch.useKnowledge === "boolean" || typeof patch.useQianchuan === "boolean") {
      const next = { ...(activePrefs), ...patch };
      api(`/api/chat-conversations/${activeConversationId}/prefs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useKnowledge: next.useKnowledge, useQianchuan: next.useQianchuan })
      }).catch((error) => message.error(`保存偏好失败：${error.message}`));
    }
  }

  async function loadChatProjects(preferredConversationId = activeConversationId) {
    const payload = await api<{ projects: ChatProjectSummary[] }>("/api/chat-projects");
    setChatProjects(payload.projects);
    // 把每个对话的持久化 prefs (useKnowledge/useQianchuan) 灌入 chatPrefs, 后续访问该对话直接沿用.
    setChatPrefs((current) => {
      const next = { ...current };
      for (const project of payload.projects) {
        for (const conversation of project.conversations) {
          const persisted = parsePersistedPrefs(conversation.prefsJson);
          next[conversation.id] = { ...DEFAULT_CHAT_PREFS, ...next[conversation.id], ...persisted };
        }
      }
      return next;
    });
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
    setChatMessages(
      payload.messages.map((item) => {
        const dbItem = item as ChatMessage & {
          processLog?: string | null;
          finalDebug?: string | null;
          finalAssets?: string | null;
        };
        return {
          id: dbItem.id,
          role: dbItem.role,
          content: dbItem.content,
          createdAt: dbItem.createdAt,
          processLog: parseJsonField<ProcessLogEntry[]>(dbItem.processLog, []),
          finalDebug: parseJsonField<ChatDebug>(dbItem.finalDebug),
          finalAssets: parseJsonField<Array<{ id: string; assetName: string; assetType: string }>>(dbItem.finalAssets)
        };
      })
    );
  }

  function parseJsonField<T>(value: string | null | undefined, fallback?: T): T | undefined {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  function parsePersistedPrefs(raw: string | null | undefined): ChatConversationPersistedPrefs {
    const parsed = parseJsonField<Partial<ChatConversationPersistedPrefs>>(raw, {}) || {};
    return {
      useKnowledge: typeof parsed.useKnowledge === "boolean" ? parsed.useKnowledge : DEFAULT_CHAT_PREFS.useKnowledge,
      useQianchuan: typeof parsed.useQianchuan === "boolean" ? parsed.useQianchuan : DEFAULT_CHAT_PREFS.useQianchuan
    };
  }

  async function loadAssets(nextKeyword = activePrefs.keyword, nextAssetType = activePrefs.chatAssetType) {
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
    const currentQuestion = activePrefs.question.trim();
    if (!currentQuestion) {
      message.warning("请先输入对话内容");
      return;
    }
    if (!activeConversationId) {
      message.warning("请先新建或选择一个对话");
      return;
    }
    patchActivePrefs({ question: "" });
    const userMsgId = `user-${Date.now()}`;
    const assistantId = `assistant-${Date.now()}`;
    setChatMessages((current) => [
      ...current,
      { id: userMsgId, role: "user", content: currentQuestion },
      { id: assistantId, role: "assistant", content: "", processLog: [], streaming: true }
    ]);
    setLoading(true);
    let aborted = false;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: currentQuestion,
          useAll: activePrefs.useAll,
          useKnowledge: activePrefs.useKnowledge,
          useQianchuan: activePrefs.useQianchuan,
          assetIds: activePrefs.selectedAssetIds,
          assetType: activePrefs.chatAssetType,
          conversationId: activeConversationId
        })
      });
      if (!response.ok || !response.body) {
        const errText = await response.text();
        throw new Error(errText || `HTTP ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalAnswer = "";
      let finalDebug: ChatDebug | undefined;
      let finalAssets: Array<{ id: string; assetName: string; assetType: string }> = [];
      const updateMessage = (updater: (msg: ChatMessage) => ChatMessage) => {
        setChatMessages((current) => current.map((msg) => (msg.id === assistantId ? updater(msg) : msg)));
      };
      const appendLog = (entry: ProcessLogEntry) => {
        updateMessage((msg) => ({ ...msg, processLog: [...(msg.processLog || []), entry] }));
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          let event: any;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }
          if (event.type === "manual_mode") {
            appendLog({ type: "manual_mode", count: event.count, text: `📚 手动选用 ${event.count} 条资料，跳过自动检索` });
          } else if (event.type === "intent") {
            if (event.scenes?.length) {
              const scenes = event.scenes as Array<{ sceneKey: string; sceneName: string; score: number }>;
              const top = scenes.slice(0, 3).map((s) => s.sceneName).join("、");
              appendLog({ type: "intent", scenes, text: `🔍 识别问题场景：${top}` });
            } else {
              appendLog({ type: "intent", scenes: [], text: "🔍 未识别到具体场景，将按本部门全部启用资料检索" });
            }
          } else if (event.type === "retrieve") {
            const names = event.assets?.map((a: any) => a.assetName).slice(0, 3).join("、") || "（无）";
            appendLog({
              type: "retrieve",
              assets: event.assets || [],
              contextChars: event.contextChars || 0,
              text: `✅ 命中 ${event.assets?.length || 0} 条资料：${names}${event.assets?.length > 3 ? "…" : ""}`
            });
          } else if (event.type === "skill") {
            const calls = (event.calls || []) as Array<{ id: string; name: string; arguments: unknown; result: string; ok: boolean; error?: string }>;
            const summary = calls
              .map((call) => {
                const argsText = formatSkillArgs(call.arguments);
                return `${call.name}(${argsText})`;
              })
              .join("；");
            const okCount = calls.filter((c) => c.ok).length;
            const text = `🛠 调用 ${calls.length} 个技能：${summary || "（无）"}${okCount < calls.length ? `（失败 ${calls.length - okCount}）` : ""}`;
            appendLog({ type: "skill", calls, contextChars: event.contextChars || 0, text });
          } else if (event.type === "context") {
            appendLog({ type: "context", chars: event.chars, preview: event.preview, fullContext: event.fullContext, text: `🧠 已拼接 context（${event.chars} 字）` });
          } else if (event.type === "text") {
            finalAnswer += event.text;
            updateMessage((msg) => ({ ...msg, content: msg.content + event.text }));
          } else if (event.type === "usage") {
            const tokens = event.totalTokens || (event.promptTokens || 0) + (event.completionTokens || 0);
            appendLog({ type: "usage", ...event, text: `📊 Token：${tokens}（输入 ${event.promptTokens || 0} / 输出 ${event.completionTokens || 0}）` });
          } else if (event.type === "error") {
            aborted = true;
            const details: ChatErrorDetails | undefined = event.details && typeof event.details === "object" ? event.details : undefined;
            appendLog({
              type: "error",
              error: event.error,
              details,
              text: `❌ ${event.error}${formatErrorDetails(details)}`
            });
            updateMessage((msg) => ({ ...msg, content: msg.content || "（对话失败）" }));
          } else if (event.type === "done") {
            finalAnswer = event.answer || finalAnswer;
            finalDebug = event.debug;
            finalAssets = event.usedAssets || [];
            appendLog({ type: "done", text: `✨ 对话完成` });
          }
        }
      }
      updateMessage((msg) => ({
        ...msg,
        content: finalAnswer || msg.content,
        streaming: false,
        finalDebug,
        finalAssets
      }));
      if (!aborted) {
        // 只刷新侧边栏项目列表(标题/时间),不重载当前对话消息 —— 会冲掉 processLog
        api<{ projects: ChatProjectSummary[] }>("/api/chat-projects")
          .then((payload) => setChatProjects(payload.projects))
          .catch((error) => message.error(error.message));
      }
    } catch (error) {
      const errorMessage = (error as Error).message;
      updateMessageSafe(assistantId, (msg) => ({
        ...msg,
        content: msg.content || `对话失败：${errorMessage}`,
        streaming: false,
        processLog: [...(msg.processLog || []), { type: "error", error: errorMessage, text: `❌ ${errorMessage}` }]
      }));
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  function updateMessageSafe(id: string, updater: (msg: ChatMessage) => ChatMessage) {
    setChatMessages((current) => current.map((msg) => (msg.id === id ? updater(msg) : msg)));
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
      formData.append("assetType", "");
      for (const file of realFiles) {
        formData.append("files", file);
      }
      const payload = await api<{ assets: Asset[] }>("/api/knowledge/upload", {
        method: "POST",
        body: formData
      });
      patchActivePrefs({ chatAssetType: "all", useAll: false });
      setAssets((current) => mergeAssets(payload.assets, current));
      patchActivePrefs({
        selectedAssetIds: Array.from(
          new Set([
            ...(activePrefs.selectedAssetIds || []).map(String),
            ...payload.assets.map((asset) => asset.id)
          ])
        )
      });
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
                    {item.role === "assistant" && (item.processLog?.length || 0) > 0 ? (
                      <ChatProcessLog entries={item.processLog || []} />
                    ) : null}
                    {item.role === "assistant" ? (
                      item.content ? (
                        <Markdown content={item.content} />
                      ) : item.streaming ? (
                        <Typography.Text type="secondary">▍</Typography.Text>
                      ) : null
                    ) : (
                      <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                        {item.content || (item.streaming ? " " : "")}
                      </Typography.Paragraph>
                    )}
                    {item.role === "assistant" && !item.streaming && item.finalDebug ? (
                      <ChatDebugPanel debug={item.finalDebug} />
                    ) : null}
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
            {loading && !chatMessages.some((item) => item.streaming) && (
              <div className="chat-row assistant">
                <Avatar className="chat-avatar">AI</Avatar>
                <div className="chat-bubble">
                  <Typography.Text type="secondary">{activePrefs.useKnowledge ? "正在按部门场景检索知识库..." : "正在组织回答..."}</Typography.Text>
                </div>
              </div>
            )}
          </div>
          <div className="chat-composer">
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 6 }}
              value={activePrefs.question}
              disabled={!activeConversationId}
              onChange={(event) => patchActivePrefs({ question: event.target.value })}
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
                  accept=".txt,.md,.csv,.json,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff,image/heic,image/heif,image/avif,image/x-icon,image/svg+xml,image/vnd.adobe.photoshop"
                >
                  <Button loading={chatUploadLoading}>上传资料</Button>
                </Upload>
                <Tooltip title="开启后，对话会按本部门 + 业务场景智能检索知识库并增强上下文">
                  <Switch
                    checked={activePrefs.useKnowledge}
                    onChange={(value) => patchActivePrefs({ useKnowledge: value })}
                    checkedChildren="使用知识库"
                    unCheckedChildren="不使用知识库"
                  />
                </Tooltip>
                <Tooltip title="开启后，对话可调用巨量千川实时数据技能（账户/抖音号/直播间数据）。需管理员先在「设置 → 千川接入」绑定账号">
                  <Switch
                    checked={activePrefs.useQianchuan}
                    onChange={(value) => patchActivePrefs({ useQianchuan: value })}
                    checkedChildren="实时千川数据"
                    unCheckedChildren="仅知识库"
                  />
                </Tooltip>
                <Typography.Text type="secondary">
                  {activePrefs.useAll
                    ? `调用${activePrefs.chatAssetType === "all" ? "全部" : assetTypeLabel(activePrefs.chatAssetType)}资料`
                    : activePrefs.selectedAssetIds.length
                      ? `已选择 ${activePrefs.selectedAssetIds.length} 条资料`
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
            value={activePrefs.keyword}
            onChange={(event) => patchActivePrefs({ keyword: event.target.value })}
            onSearch={(value) => loadAssets(value).catch((error) => message.error(error.message))}
            enterButton="搜索"
          />
          <Space wrap>
            <span>资料分类</span>
            <Select
              value={activePrefs.chatAssetType}
              style={{ width: 180 }}
              onChange={(value) => {
                patchActivePrefs({ chatAssetType: value, selectedAssetIds: [] });
                loadAssets(activePrefs.keyword, value).catch((error) => message.error(error.message));
              }}
              options={[
                { value: "all", label: "全部资料" },
                { value: "product_white_image", label: "产品白底图" },
                { value: "main_template", label: "主图模板" },
                { value: "portrait_white_image", label: "达人肖像白底图" },
                { value: "prompt", label: "提示词" },
                { value: "pdf", label: "PDF" },
                { value: "ppt", label: "PPT" },
                { value: "excel", label: "Excel 文件" },
                { value: "document", label: "文档" }
              ]}
            />
            <Switch
              checked={activePrefs.useAll}
              onChange={(value) => patchActivePrefs({ useAll: value })}
              checkedChildren="调用全部知识库"
              unCheckedChildren="选择资料调用"
            />
          </Space>
          <Table
            size="small"
            rowKey="id"
            dataSource={assets}
            pagination={{ pageSize: 6 }}
            rowSelection={
              activePrefs.useAll
                ? undefined
                : {
                    selectedRowKeys: activePrefs.selectedAssetIds,
                    onChange: (keys) => patchActivePrefs({ selectedAssetIds: keys })
                  }
            }
            columns={[
              { title: "资料名称", dataIndex: "assetName" },
              { title: "类型", render: (_, row) => assetTypeLabel(row.assetType) },
              { title: "说明", render: (_, row) => row.description || row.productName || "-" }
            ]}
          />
          <Typography.Text type="secondary">
            {activePrefs.useAll
              ? "本次对话会调用当前分类下全部启用的知识库资料。"
              : `已选择 ${activePrefs.selectedAssetIds.length} 条资料。`}
          </Typography.Text>
        </Space>
      </Drawer>
    </Space>
  );
}

function ProjectWorkspace({ projectId, user }: { projectId: string; user: User }) {
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
  const [knowledgeEnhanced, setKnowledgeEnhanced] = useState(false);
  const [sceneCount, setSceneCount] = useState(0);
  const { message, modal } = App.useApp();

  async function load() {
    const [projectPayload, taskPayload, templatePayload, portraitPayload, scenePayload] = await Promise.all([
      api<{ project: Project }>(`/api/projects/${projectId}`),
      api<{ tasks: GenerationTask[] }>(`/api/generation/tasks?projectId=${projectId}`),
      api<{ assets: Asset[] }>("/api/knowledge/assets?assetType=main_template"),
      api<{ assets: Asset[] }>("/api/knowledge/assets?assetType=portrait_white_image"),
      api<{ scenes: BusinessScene[] }>("/api/settings/scenes")
    ]);
    setProject(projectPayload.project);
    setTasks(taskPayload.tasks);
    setMainTemplates(templatePayload.assets.filter((asset) => asset.enabled));
    setPortraitAssets(portraitPayload.assets.filter((asset) => asset.enabled));
    const ownDeptId = user.departmentId || "dept_default";
    setSceneCount(scenePayload.scenes.filter((scene) => scene.departmentId === ownDeptId).length);
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
            portraitAssetId,
            knowledgeEnhanced
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
              <Tooltip
                title={
                  sceneCount === 0
                    ? "请先在「设置 → 部门与场景」中为本部门配置业务场景后再开启"
                    : "开启后，会按本部门 + 业务场景动态检索知识库并增强本次提示词"
                }
              >
                <Space>
                  <Switch
                    checked={knowledgeEnhanced}
                    onChange={setKnowledgeEnhanced}
                    disabled={sceneCount === 0}
                    checkedChildren="知识库增强：开"
                    unCheckedChildren="知识库增强：关"
                  />
                </Space>
              </Tooltip>
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
  const { message, modal } = App.useApp();
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

function KnowledgeView({ user }: { user: User }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [viewAssetType, setViewAssetType] = useState("all");
  const [editing, setEditing] = useState<Asset | null>(null);
  const [form] = Form.useForm();
  const [textForm] = Form.useForm();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [allScenes, setAllScenes] = useState<BusinessScene[]>([]);
  const [filterDepartmentId, setFilterDepartmentId] = useState<string | "all">("all");
  const watchedDepartmentId = Form.useWatch("departmentId", form);
  const [excelPreview, setExcelPreview] = useState<Asset | null>(null);
  async function openAssetPreview(row: Asset) {
    // 列表接口不带 preview, 调详情接口拿 (含 Excel 预览)
    try {
      const payload = await api<{ asset: Asset }>(`/api/knowledge/assets/${row.id}`);
      setExcelPreview(payload.asset);
    } catch (error) {
      message.error(`加载预览失败：${(error as Error).message}`);
    }
  }
  const { message, modal } = App.useApp();
  const isAdmin = user.role === "admin";

  function canDeleteAsset(asset: Asset) {
    if (isAdmin) return true;
    if (!user.departmentId) return false;
    return asset.departmentId === user.departmentId;
  }

  function confirmDeleteAsset(asset: Asset) {
    modal.confirm({
      title: "删除知识库资料",
      content: `确定删除“${asset.assetName}”吗？该操作不可恢复，相关产品别名和历史引用都会一并清理。`,
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api(`/api/knowledge/assets/${asset.id}`, { method: "DELETE" });
          message.success("资料已删除");
          if (editing?.id === asset.id) setEditing(null);
          await load();
        } catch (error) {
          message.error((error as Error).message);
        }
      }
    });
  }

  async function load(nextType = viewAssetType, nextDept = filterDepartmentId) {
    const params = new URLSearchParams();
    if (nextType !== "all") params.set("assetType", nextType);
    if (isAdmin && nextDept !== "all") params.set("departmentId", nextDept);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const payload = await api<{ assets: Asset[] }>(`/api/knowledge/assets${suffix}`);
    setAssets(payload.assets);
  }

  async function loadMeta() {
    try {
      const [deptPayload, scenePayload] = await Promise.all([
        api<{ departments: Department[] }>("/api/settings/departments"),
        api<{ scenes: BusinessScene[] }>("/api/settings/scenes")
      ]);
      setDepartments(deptPayload.departments);
      setAllScenes(scenePayload.scenes);
    } catch (error) {
      message.error((error as Error).message);
    }
  }

  useEffect(() => {
    load().catch((error) => message.error(error.message));
    loadMeta();
  }, []);

  async function save(values: Record<string, unknown>) {
    if (!editing) return;
    const payload = {
      ...values,
      aliases: (values.aliases ? String(values.aliases) : "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      tags: (values.tags ? String(values.tags) : "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      scenes: Array.isArray(values.scenes) ? values.scenes : []
    };
    await api(`/api/knowledge/assets/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    message.success("资料已保存");
    setEditing(null);
    load();
  }

  async function saveTextAsset(values: { assetType: string; assetName: string; description?: string; text: string; departmentId?: string; scenes?: string[] }) {
    await api("/api/knowledge/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    message.success(values.assetType === "prompt" ? "提示词已保存" : "文档已保存");
    textForm.resetFields();
    load();
  }

  const effectiveDeptId = user.departmentId || "dept_default";
  const departmentOptions = useMemo(
    () => [
      { value: "all", label: "全部部门" },
      ...departments.map((dept) => ({ value: dept.id, label: dept.name }))
    ],
    [departments]
  );
  const sceneOptionsForDept = useMemo(() => {
    const deptId = watchedDepartmentId || effectiveDeptId;
    return allScenes
      .filter((scene) => scene.departmentId === deptId)
      .map((scene) => ({ value: scene.sceneKey, label: `${scene.sceneName}（${scene.sceneKey}）` }));
  }, [allScenes, watchedDepartmentId, effectiveDeptId]);
  const departmentFormOptions = useMemo(
    () => departments.map((dept) => ({ value: dept.id, label: dept.name })),
    [departments]
  );

  return (
    <Space direction="vertical" size={18} style={{ width: "100%" }}>
      <Card className="soft-card" title="提示词 / 文档">
        <Form
          form={textForm}
          layout="vertical"
          onFinish={saveTextAsset}
          initialValues={{ assetType: "prompt", departmentId: isAdmin ? undefined : effectiveDeptId }}
        >
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
          <Typography.Text type="secondary">
            支持图片（产品白底图 / 主图模板 / 达人肖像）、PDF、PPT、Excel、文档等混合批量上传，类型按文件扩展名自动识别。
          </Typography.Text>
          <Upload
            multiple
            showUploadList={false}
            customRequest={async ({ file, onSuccess, onError }) => {
              try {
                const formData = new FormData();
                formData.append("files", file as File);
                if (isAdmin && user.departmentId) {
                  formData.append("departmentId", user.departmentId);
                }
                const payload = await api<{ assets: Asset[] }>("/api/knowledge/upload", { method: "POST", body: formData });
                onSuccess?.("ok");
                message.success("上传成功");
                const excelAsset = payload.assets.find((asset) => asset.assetType === "excel" && asset.preview);
                if (excelAsset) setExcelPreview(excelAsset);
                await load();
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
            style={{ minWidth: 160 }}
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
              { value: "excel", label: "Excel 文件" },
              { value: "document", label: "文档" }
            ]}
          />
          {isAdmin && (
            <>
              <span>部门</span>
              <Select
                value={filterDepartmentId}
                style={{ minWidth: 180 }}
                onChange={(value) => {
                  setFilterDepartmentId(value);
                  load(viewAssetType, value).catch((error) => message.error(error.message));
                }}
                options={departmentOptions}
              />
            </>
          )}
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
            {
              title: "部门",
              render: (_, row) => {
                const dept = departments.find((item) => item.id === row.departmentId);
                return dept ? <Tag color="blue">{dept.name}</Tag> : <Tag>未分配</Tag>;
              }
            },
            {
              title: "场景",
              render: (_, row) => {
                const keys = Array.isArray(row.scenes) ? row.scenes : parseSceneKeys(row.scenes);
                if (!keys.length) return <Tag color="default">通用</Tag>;
                return (
                  <Space size={4} wrap>
                    {keys.map((key) => (
                      <Tag key={key} color="cyan">
                        {sceneLabel(allScenes, row.departmentId, key)}
                      </Tag>
                    ))}
                  </Space>
                );
              }
            },
            { title: "向量化", render: (_, row) => <Tag>{row.vectorStatus}</Tag> },
            { title: "启用", render: (_, row) => <Tag color={row.enabled ? "green" : "red"}>{row.enabled ? "启用" : "停用"}</Tag> },
            {
              title: "操作",
              render: (_, row) => {
                const deletable = canDeleteAsset(row);
                return (
                  <Space size={4}>
                    {row.assetType === "excel" && (
                      <Button size="small" onClick={() => openAssetPreview(row)}>
                        查看预览
                      </Button>
                    )}
                    <Button
                      size="small"
                      onClick={() => {
                        setEditing(row);
                        form.setFieldsValue({
                          ...row,
                          aliases: jsonList(row.aliases).join("\n"),
                          tags: jsonList(row.tags).join("\n"),
                          scenes: Array.isArray(row.scenes) ? row.scenes : parseSceneKeys(row.scenes)
                        });
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      size="small"
                      danger
                      disabled={!deletable}
                      title={deletable ? "删除本部门资料" : "仅本部门管理员可删除"}
                      onClick={() => confirmDeleteAsset(row)}
                    >
                      删除
                    </Button>
                  </Space>
                );
              }
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
                { value: "excel", label: "Excel 文件" },
                { value: "document", label: "文档" }
              ]}
            />
          </Form.Item>
          <Form.Item name="departmentId" label="部门" rules={[{ required: true, message: "请选择部门" }]}>
            <Select options={departmentFormOptions} disabled={!isAdmin} placeholder="选择部门" />
          </Form.Item>
          <Form.Item name="scenes" label="业务场景">
            <Select
              mode="multiple"
              allowClear
              placeholder="按使用场景打标，便于精准检索"
              options={sceneOptionsForDept}
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
      <ExcelPreviewModal asset={excelPreview} onClose={() => setExcelPreview(null)} />
    </Space>
  );
}

function ApiConfigCachePreview({ form }: { form: ReturnType<typeof Form.useForm>[0] }) {
  const baseUrl = Form.useWatch("textBaseUrl", form) as string | undefined;
  const model = Form.useWatch("textModel", form) as string | undefined;
  const wireApi = Form.useWatch("textWireApi", form) as string | undefined;
  const enabled = Form.useWatch("textPromptCacheEnabled", form) as boolean | undefined;
  const retention = Form.useWatch("textPromptCacheRetention", form) as string | undefined;
  const cacheKey = Form.useWatch("textPromptCacheKey", form) as string | undefined;
  const profile = resolveCacheProfile({
    baseUrl: baseUrl || "",
    chatModel: model || "",
    wireApi: wireApi || "auto",
    userEnabled: enabled !== false,
    retention: retention || DEFAULT_RETENTION,
    cacheKey: cacheKey || DEFAULT_CACHE_KEY
  });
  const color =
    profile.mode === "disabled" ? "default" :
    profile.mode === "anthropic_ephemeral" ? "purple" :
    profile.mode === "openai_responses" ? "blue" : "cyan";
  return (
    <Alert
      style={{ marginBottom: 16 }}
      type={profile.mode === "disabled" ? "warning" : "info"}
      showIcon
      message={
        <Space wrap>
          <Typography.Text strong>当前生效的 Prompt Cache 配置：</Typography.Text>
          <Tag color={color}>{profile.label}</Tag>
          {profile.note ? <Typography.Text type="secondary">· {profile.note}</Typography.Text> : null}
        </Space>
      }
      description={
        profile.mode === "disabled"
          ? "管理员已禁用缓存。所有分支不会传 cache, 任何 prompt cache 都不会命中."
          : profile.mode === "anthropic_ephemeral"
            ? `服务端会在 system 提示词 + 工具定义上各放一个 ephemeral cache 断点, TTL=${profile.retention}. 切换 baseUrl 或 chatModel 后这里会自动重新计算.`
            : profile.mode === "openai_responses"
              ? `OpenAI Responses 协议: 透传 prompt_cache_retention=${profile.retention} + prompt_cache_key=${profile.promptCacheKey}.`
              : `OpenAI Chat Completions: 透传 prompt_cache_key=${profile.promptCacheKey} (本协议 retention 字段不一定生效).`
      }
    />
  );
}

function ExcelPreviewModal({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const preview = asset?.preview;
  const open = !!asset;

  return (
    <Modal
      title={asset ? `Excel 解析预览：${asset.assetName}` : "Excel 解析预览"}
      open={open}
      onCancel={onClose}
      width={920}
      footer={null}
      destroyOnClose
    >
      {!preview ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          暂未解析到可用的工作表数据。可能是空文件、扫描件，或解析过程中出现异常。
        </Typography.Paragraph>
      ) : (
        <>
          <Space size={16} wrap style={{ marginBottom: 12 }}>
            <Tag color="blue">工作表 {preview.totalSheets}</Tag>
            <Tag color="cyan">总行数 {preview.totalRows}</Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              每个工作表最多展示前 20 行；如需查看完整数据请使用 Excel 客户端打开源文件。
            </Typography.Text>
          </Space>
          <Tabs
            items={preview.sheets.map((sheet) => ({
              key: sheet.name,
              label: (
                <Space size={6}>
                  <span>{sheet.name}</span>
                  <Tag color="default" style={{ marginInlineEnd: 0 }}>
                    {sheet.totalRows} 行
                  </Tag>
                </Space>
              ),
              children: <SheetPreviewTable sheet={sheet} />
            }))}
          />
        </>
      )}
    </Modal>
  );
}

function SheetPreviewTable({ sheet }: { sheet: NonNullable<NonNullable<Asset["preview"]>["sheets"][number]> }) {
  const dataSource = useMemo(() => {
    return sheet.previewRows.map((row, rowIndex) => {
      const record: Record<string, string> & { __key: string } = { __key: `row-${rowIndex}` };
      row.forEach((cell, cellIndex) => {
        record[cellIndex.toString()] = cell;
      });
      return record;
    });
  }, [sheet.previewRows]);

  const columns = useMemo(() => {
    const maxCols = sheet.previewRows.reduce((max, row) => Math.max(max, row.length), 0);
    const cols: ColumnsType<Record<string, string>> = [];
    for (let i = 0; i < maxCols; i += 1) {
      cols.push({
        title: `第 ${i + 1} 列`,
        dataIndex: i.toString(),
        key: `col-${i}`,
        width: 160,
        render: (value: unknown) => {
          const text = typeof value === "string" ? value : "";
          if (text === "") return <Typography.Text type="secondary">-</Typography.Text>;
          return (
            <Typography.Paragraph
              style={{ marginBottom: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
              ellipsis={{ rows: 3, expandable: true, symbol: "展开" }}
            >
              {text}
            </Typography.Paragraph>
          );
        }
      });
    }
    return cols;
  }, [sheet.previewRows]);

  return (
    <>
      {sheet.truncated && (
        <Typography.Paragraph type="warning" style={{ marginBottom: 8 }}>
          当前工作表行数较多，已截断展示前 20 行。
        </Typography.Paragraph>
      )}
      <Table
        size="small"
        rowKey="__key"
        dataSource={dataSource}
        columns={columns}
        pagination={false}
        scroll={{ x: "max-content", y: 360 }}
      />
    </>
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
  const { message, modal } = App.useApp();

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
  const [qianchuanForm] = Form.useForm();
  const [users, setUsers] = useState<User[]>([]);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [qianchuanTokens, setQianchuanTokens] = useState<Array<{
    id: string;
    appId: string;
    scope: string | null;
    lastRefreshAt: string | null;
    lastError: string | null;
    accessTokenExpireAt: string;
    refreshTokenExpireAt: string;
    createdAt: string;
    updatedAt: string;
    accessTokenMasked: string | null;
    refreshTokenMasked: string | null;
    accessTokenStatus: "valid" | "expired";
    refreshTokenStatus: "valid" | "expired";
    advertisers: Array<{ id: string; advertiserId: string; nickname: string | null; createdAt: string }>;
  }>>([]);
  const [bindAdvertiserForm] = Form.useForm();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [usageRows, setUsageRows] = useState<UsageRow[]>([]);
  const [usageUserId, setUsageUserId] = useState("all");
  const [usagePeriod, setUsagePeriod] = useState("day");
  const [usageAnchorDate, setUsageAnchorDate] = useState(todayDate());
  const [cacheStats, setCacheStats] = useState<{
    days: number;
    daily: Array<{ date: string; promptTokens: number; cachedTokens: number; cacheHitRate: number; savedCost: number }>;
    totals: { promptTokens: number; cachedTokens: number; cacheHitRate: number; savedCost: number };
    byKey: Array<{ cacheKey: string; promptTokens: number; cachedTokens: number; cacheHitRate: number }>;
    alert?: { level: "warning" | "critical"; message: string };
  } | null>(null);
  const { message, modal } = App.useApp();

  async function load() {
    if (user.role !== "admin") return;
    const [config, list] = await Promise.all([
      api<{ config: Record<string, unknown> }>("/api/settings/api-config"),
      api<{ users: User[] }>("/api/users")
    ]);
    const rolePayload = await api<{ roles: RoleDefinition[] }>("/api/settings/roles");
    const deptPayload = await api<{ departments: Department[] }>("/api/settings/departments");
    configForm.setFieldsValue(config.config);
    setUsers(list.users);
    setRoles(rolePayload.roles);
    setDepartments(deptPayload.departments);
    await loadUsage();
  }

  async function loadQianchuan() {
    if (user.role !== "admin" && !user.permissions?.includes("manage_settings")) return;
    const payload = await api<{ tokens: typeof qianchuanTokens }>("/api/settings/qianchuan");
    setQianchuanTokens(payload.tokens);
  }

  async function loadUsage(nextUserId = usageUserId, nextPeriod = usagePeriod, nextAnchorDate = usageAnchorDate) {
    if (user.role !== "admin") return;
    const payload = await api<{ rows: UsageRow[] }>(
      `/api/settings/usage?userId=${encodeURIComponent(nextUserId)}&period=${encodeURIComponent(nextPeriod)}&anchorDate=${encodeURIComponent(nextAnchorDate)}`
    );
    setUsageRows(payload.rows);
  }

  async function loadCacheStats(nextUserId = usageUserId) {
    if (user.role !== "admin") return;
    try {
      const payload = await api<typeof cacheStats>(
        `/api/settings/usage/cache-stats?userId=${encodeURIComponent(nextUserId)}&days=30`
      );
      setCacheStats(payload);
    } catch (error) {
      setCacheStats(null);
      console.warn("[usage] cache-stats load failed", (error as Error).message);
    }
  }

  useEffect(() => {
    load().catch((error) => message.error(error.message));
    loadQianchuan().catch(() => undefined);
  }, []);

  useEffect(() => {
    loadUsage().catch((error) => message.error(error.message));
    loadCacheStats().catch(() => undefined);
  }, [usageUserId, usagePeriod, usageAnchorDate]);

  async function bindQianchuanToken(values: {
    appId: number | string;
    appSecret: string;
    authCode?: string;
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpireAt?: string;
    refreshTokenExpireAt?: string;
  }) {
    const body: Record<string, unknown> = {
      appId: String(values.appId),
      appSecret: values.appSecret
    };
    if (values.authCode) body.authCode = values.authCode;
    if (values.accessToken) body.accessToken = values.accessToken;
    if (values.refreshToken) body.refreshToken = values.refreshToken;
    if (values.accessTokenExpireAt) body.accessTokenExpireAt = new Date(values.accessTokenExpireAt).toISOString();
    if (values.refreshTokenExpireAt) body.refreshTokenExpireAt = new Date(values.refreshTokenExpireAt).toISOString();
    await api("/api/settings/qianchuan", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    message.success("千川 token 已写入");
    qianchuanForm.resetFields();
    await loadQianchuan();
  }

  async function bindAdvertiserToToken(values: {
    tokenId: string;
    advertiserId: string;
    nickname?: string;
    bindUserIds?: string[];
  }) {
    const body: Record<string, unknown> = {
      tokenId: values.tokenId,
      advertiserId: String(values.advertiserId).trim()
    };
    if (values.nickname) body.nickname = values.nickname;
    if (values.bindUserIds && values.bindUserIds.length) body.bindUserIds = values.bindUserIds;
    await api("/api/settings/qianchuan?action=bind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    message.success("广告主已绑定");
    bindAdvertiserForm.resetFields();
    await loadQianchuan();
  }

  async function unbindAdvertiserFromToken(tokenId: string, advertiserId: string) {
    modal.confirm({
      title: "确认解绑该广告主？",
      content: `解绑后用户「${advertiserId}」的实时数据查询会失败。token 本身不受影响。`,
      okText: "解绑",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await api("/api/settings/qianchuan?action=unbind", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tokenId, advertiserId })
          });
          message.success("已解绑");
          await loadQianchuan();
        } catch (error) {
          message.error((error as Error).message);
        }
      }
    });
  }

  async function downloadQianchuanTemplate() {
    const r = await fetch("/api/settings/qianchuan/template", { credentials: "include" });
    if (!r.ok) {
      const t = await r.text();
      message.error(t || "模板下载失败");
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "qianchuan-template.xlsx";
    a.click();
    URL.revokeObjectURL(url);
    message.success("模板已下载");
  }

  async function exportQianchuanExcel() {
    const r = await fetch("/api/settings/qianchuan/export", { credentials: "include" });
    if (!r.ok) {
      const t = await r.text();
      message.error(t || "导出失败");
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qianchuan-anchor-list-${Date.now()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    message.success("已导出");
  }

  type QianchuanPreview = {
    success: boolean;
    anchorDiff: { add: QianchuanDiffRow[]; update: QianchuanDiffRow[]; delete: QianchuanDiffRow[] };
    advertiserDiff: { add: QianchuanDiffRow[]; update: QianchuanDiffRow[]; delete: QianchuanDiffRow[] };
    errors: Array<{ row: number; error: string }>;
  };
  const [importPreview, setImportPreview] = useState<{
    file: File;
    preview: QianchuanPreview;
  } | null>(null);
  const [importing, setImporting] = useState(false);

  async function previewQianchuanImport(file: File) {
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/settings/qianchuan/import/preview", {
        method: "POST",
        body: fd,
        credentials: "include"
      });
      if (!r.ok) {
        const t = await r.text();
        message.error(t || "预览失败");
        return;
      }
      const preview = (await r.json()) as QianchuanPreview;
      setImportPreview({ file, preview });
    } finally {
      setImporting(false);
    }
  }

  async function confirmQianchuanImport() {
    if (!importPreview) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", importPreview.file);
      const r = await fetch("/api/settings/qianchuan/import/apply", {
        method: "POST",
        body: fd,
        credentials: "include"
      });
      if (!r.ok) {
        const t = await r.text();
        message.error(t || "应用失败");
        return;
      }
      const data = (await r.json()) as {
        insertedAnchors: number;
        updatedAnchors: number;
        deletedAnchors: number;
        insertedAdvertisers: number;
        updatedAdvertisers: number;
        deletedAdvertisers: number;
        errors: Array<{ row: number; error: string }>;
      };
      const lines = [
        `覆盖完成：anchor 新增 ${data.insertedAnchors} / 更新 ${data.updatedAnchors} / 删除 ${data.deletedAnchors}；advertiser 新增 ${data.insertedAdvertisers} / 更新 ${data.updatedAdvertisers} / 删除 ${data.deletedAdvertisers}`
      ];
      if (data.errors?.length) {
        lines.push(`错误明细（前 5 条）：`);
        for (const e of data.errors.slice(0, 5)) lines.push(`  第 ${e.row} 行：${e.error}`);
        if (data.errors.length > 5) lines.push(`  ...共 ${data.errors.length} 条错误`);
      }
      message.success(lines.join("\n"), 6);
      setImportPreview(null);
      await loadQianchuan();
    } finally {
      setImporting(false);
    }
  }

  function cancelQianchuanImport() {
    setImportPreview(null);
  }

  async function refreshQianchuanToken(appId: string) {
    const hide = message.loading("正在刷新 token...", 0);
    try {
      await api("/api/settings/qianchuan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId, action: "refresh" })
      });
      message.success("token 刷新成功");
      await loadQianchuan();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      hide();
    }
  }

  async function unbindQianchuanToken(appId: string) {
    modal.confirm({
      title: "确认删除整个 token？",
      content: `删除后该 appId=${appId} 下所有广告主绑定都会被清除，用户实时数据查询会失败。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await api("/api/settings/qianchuan", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ appId })
          });
          message.success("已删除");
          await loadQianchuan();
        } catch (error) {
          message.error((error as Error).message);
        }
      }
    });
  }

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

  async function createUser(values: { username: string; nickname?: string; password: string; role: string; departmentId?: string }) {
    await api("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    message.success("用户已创建");
    userForm.resetFields();
    load();
  }

  async function updateUser(values: { nickname?: string; role?: string; status?: string; password?: string; departmentId?: string | null }) {
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
                <ApiConfigCachePreview form={configForm} />
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
                          { value: "anthropic", label: "Anthropic Messages（MiniMax M3 / Claude）" },
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
          key: "departments",
          label: "部门与场景",
          children: <DepartmentAdminView user={user} />
        },
        {
          key: "skills",
          label: "技能管理",
          children: <SkillAdminView user={user} />
        },
        {
          key: "advertiserBindings",
          label: "广告主绑定",
          children: <AdvertiserBindingsPanel user={user} />
        },
        {
          key: "qianchuan",
          label: "千川接入",
          children: (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Card className="soft-card" title="绑定千川账号">
                <Form
                  form={qianchuanForm}
                  layout="vertical"
                  onFinish={bindQianchuanToken}
                  initialValues={{}}
                >
                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item name="appId" label="App ID" rules={[{ required: true, message: "App ID 必填" }]}>
                        <Input placeholder="千川开放平台 app_id" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="appSecret" label="App Secret" rules={[{ required: true, message: "App Secret 必填" }]}>
                        <Input.Password placeholder="私密，不会回显到前端" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col xs={24}>
                      <Form.Item name="authCode" label="授权码（auth_code，可选；提供则自动兑换 token）" tooltip="从千川开放平台 OAuth 授权后回跳拿到；不填则手动填 access/refresh token">
                        <Input placeholder="例如：70b080d0f9d810140bf7b283cc5e620601c837bd" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Typography.Text type="secondary">不填 authCode 时，手动填写 access/refresh token：</Typography.Text>
                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item name="accessToken" label="Access Token">
                        <Input.Password placeholder="首次注入的 access_token" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="refreshToken" label="Refresh Token">
                        <Input.Password placeholder="首次注入的 refresh_token" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="accessTokenExpireAt" label="Access Token 过期时间">
                        <Input type="datetime-local" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="refreshTokenExpireAt" label="Refresh Token 过期时间">
                        <Input type="datetime-local" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Space>
                    <Button type="primary" htmlType="submit">保存 token</Button>
                    <Button onClick={() => qianchuanForm.resetFields()}>重置</Button>
                  </Space>
                </Form>
              </Card>
              <Card
                className="soft-card"
                title="抖音号名册（导入/导出）"
                extra={
                  <Space>
                    <Button onClick={downloadQianchuanTemplate}>下载模板</Button>
                    <Upload
                      accept=".xlsx,.xls,.xlsm"
                      showUploadList={false}
                      beforeUpload={(file) => {
                        previewQianchuanImport(file);
                        return false;
                      }}
                    >
                      <Button type="primary" loading={importing}>导入 Excel</Button>
                    </Upload>
                    <Button onClick={exportQianchuanExcel}>导出当前</Button>
                  </Space>
                }
              >
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  用于把「抖音号 ID ↔ 抖音号名称」批量录入。导入采用<strong>两段式确认</strong>：先选文件预览差异（新增 / 更新 / 删除），核对无误后再点确认才会真正覆盖系统数据。本操作仅超级管理员可执行。
                </Typography.Paragraph>
                <Typography.Text type="secondary">
                  模板字段：advertiserId / anchorId / anchorName / nickname。Excel 必须先下载模板，填写后再导入；广告主 ID 必须已在系统中绑定，否则该行会在预览时报错。
                </Typography.Text>
              </Card>
              <Modal
                open={!!importPreview}
                title="确认导入差异"
                width={760}
                onCancel={cancelQianchuanImport}
                footer={[
                  <Button key="cancel" onClick={cancelQianchuanImport} disabled={importing}>
                    取消
                  </Button>,
                  <Button
                    key="confirm"
                    type="primary"
                    danger
                    loading={importing}
                    disabled={
                      importing ||
                      !importPreview ||
                      (importPreview.preview.anchorDiff.add.length +
                        importPreview.preview.anchorDiff.update.length +
                        importPreview.preview.anchorDiff.delete.length +
                        importPreview.preview.advertiserDiff.add.length +
                        importPreview.preview.advertiserDiff.update.length +
                        importPreview.preview.advertiserDiff.delete.length ===
                        0)
                    }
                    onClick={confirmQianchuanImport}
                  >
                    确认覆盖
                  </Button>
                ]}
                destroyOnHidden
              >
                {importPreview ? (
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Typography.Text type="secondary">
                      即将对系统执行以下变更。未在 Excel 中出现且存在于系统的记录将被删除，请仔细核对。
                    </Typography.Text>
                    {importPreview.preview.errors.length > 0 && (
                      <Alert
                        type="warning"
                        showIcon
                        message={`${importPreview.preview.errors.length} 行无法识别`}
                        description={
                          <ul style={{ marginBottom: 0, paddingLeft: 18 }}>
                            {importPreview.preview.errors.slice(0, 10).map((e, i) => (
                              <li key={i}>第 {e.row} 行：{e.error}</li>
                            ))}
                            {importPreview.preview.errors.length > 10 && (
                              <li>...共 {importPreview.preview.errors.length} 条</li>
                            )}
                          </ul>
                        }
                      />
                    )}
                    <DiffSection title="抖音号名册（anchor）" diff={importPreview.preview.anchorDiff} kind="anchor" />
                    <DiffSection title="广告主绑定（advertiser）" diff={importPreview.preview.advertiserDiff} kind="advertiser" />
                  </Space>
                ) : null}
              </Modal>
              <Card className="soft-card" title="已绑定账号">
                {qianchuanTokens.length === 0 ? (
                  <Typography.Text type="secondary">尚未绑定任何千川账号</Typography.Text>
                ) : (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    {qianchuanTokens.map((row) => (
                      <Card key={row.id} type="inner" title={`App ${row.appId}`}>
                        <Row gutter={[16, 8]}>
                          <Col xs={24} md={8}>
                            <Typography.Text type="secondary">Access Token：</Typography.Text>
                            <Tooltip title={row.lastError || "无错误"}>
                              <Tag color={row.accessTokenStatus === "valid" ? "green" : "red"} style={{ marginLeft: 4 }}>
                                {row.accessTokenStatus === "valid" ? "有效" : "已过期"}
                              </Tag>
                            </Tooltip>
                            <Typography.Text type="secondary" style={{ marginLeft: 8 }}>{row.accessTokenMasked || "-"}</Typography.Text>
                          </Col>
                          <Col xs={24} md={8}>
                            <Typography.Text type="secondary">Refresh Token：</Typography.Text>
                            <Tag color={row.refreshTokenStatus === "valid" ? "green" : "red"} style={{ marginLeft: 4 }}>
                              {row.refreshTokenStatus === "valid" ? "有效" : "已过期"}
                            </Tag>
                          </Col>
                          <Col xs={24} md={8}>
                            <Typography.Text type="secondary">最近刷新：</Typography.Text>
                            {row.lastRefreshAt ? formatDateTime(row.lastRefreshAt) : <Typography.Text type="secondary">未刷新</Typography.Text>}
                          </Col>
                          <Col xs={24} md={12}>
                            <Typography.Text type="secondary">access 过期：{formatDateTime(row.accessTokenExpireAt)}</Typography.Text>
                          </Col>
                          <Col xs={24} md={12}>
                            <Typography.Text type="secondary">refresh 过期：{formatDateTime(row.refreshTokenExpireAt)}</Typography.Text>
                          </Col>
                          <Col xs={24}>
                            <Space>
                              <Button size="small" onClick={() => refreshQianchuanToken(row.appId)}>刷新 token</Button>
                              <Button size="small" danger onClick={() => unbindQianchuanToken(row.appId)}>删除 token</Button>
                            </Space>
                          </Col>
                        </Row>
                        <Divider style={{ margin: "12px 0" }} />
                        <Typography.Text strong>已绑定广告主</Typography.Text>
                        {row.advertisers.length === 0 ? (
                          <Typography.Text type="secondary" style={{ marginLeft: 8 }}>暂未绑定广告主</Typography.Text>
                        ) : (
                          <Space wrap style={{ marginTop: 8 }}>
                            {row.advertisers.map((adv) => (
                              <Tag
                                key={adv.id}
                                closable
                                onClose={(e) => {
                                  e.preventDefault();
                                  unbindAdvertiserFromToken(row.id, adv.advertiserId);
                                }}
                              >
                                {adv.advertiserId}{adv.nickname ? `（${adv.nickname}）` : ""}
                              </Tag>
                            ))}
                          </Space>
                        )}
                        <Form
                          form={bindAdvertiserForm}
                          layout="inline"
                          style={{ marginTop: 12 }}
                          onFinish={(values: { advertiserId: string; nickname?: string; bindUserIds?: string[] }) =>
                            bindAdvertiserToToken({ tokenId: row.id, ...values })
                          }
                        >
                          <Form.Item name="advertiserId" rules={[{ required: true, message: "广告主 ID 必填" }]}>
                            <Input placeholder="新广告主 ID" style={{ width: 200 }} />
                          </Form.Item>
                          <Form.Item name="nickname">
                            <Input placeholder="备注（可选）" style={{ width: 160 }} />
                          </Form.Item>
                          <Form.Item name="bindUserIds">
                            <Select
                              mode="multiple"
                              allowClear
                              placeholder="同时绑定到以下用户"
                              style={{ minWidth: 220 }}
                              options={users.map((u) => ({ value: u.id, label: `${u.nickname}（${u.username}）` }))}
                            />
                          </Form.Item>
                          <Form.Item>
                            <Button type="primary" htmlType="submit" size="small">添加广告主</Button>
                          </Form.Item>
                        </Form>
                      </Card>
                    ))}
                  </Space>
                )}
              </Card>
            </Space>
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
                  <Form.Item name="departmentId">
                    <Select
                      allowClear
                      placeholder="部门"
                      style={{ width: 180 }}
                      options={departments.map((dept) => ({ value: dept.id, label: dept.name }))}
                    />
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
                        {
                          title: "部门",
                          render: (_, row) => {
                            const dept = departments.find((item) => item.id === row.departmentId);
                            return dept ? <Tag color="blue">{dept.name}</Tag> : <Tag>未分配</Tag>;
                          }
                        },
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
                                  editUserForm.setFieldsValue({ nickname: row.nickname, role: row.role, status: row.status, departmentId: row.departmentId || undefined, password: "" });
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
                        <Statistic title="缓存节省金额" value={cacheStats?.totals.savedCost ?? 0} prefix="¥" precision={4} />
                        <Statistic title="缓存命中率" value={cacheStats ? cacheStats.totals.cacheHitRate : 0} suffix={cacheStats ? "" : ""} precision={2} formatter={(v) => `${((Number(v) || 0) * 100).toFixed(1)}%`} />
                        <Statistic title="总估算消耗" value={usageRows.reduce((sum, row) => sum + row.totalEstimatedCost, 0)} prefix="¥" precision={4} />
                      </Space>
                      {cacheStats?.alert ? (
                        <Alert
                          type={cacheStats.alert.level === "critical" ? "error" : "warning"}
                          showIcon
                          message={`Prompt Cache 命中率异常（${cacheStats.alert.level === "critical" ? "严重" : "警告"}）`}
                          description={cacheStats.alert.message}
                        />
                      ) : null}
                      {cacheStats && cacheStats.daily.some((day) => day.promptTokens > 0) ? (
                        <Card size="small" title="缓存命中趋势（最近 30 天）" className="soft-card">
                          <ResponsiveContainer width="100%" height={220}>
                            <ComposedChart data={cacheStats.daily.map((day) => ({ ...day, hitRatePct: Number((day.cacheHitRate * 100).toFixed(2)) }))}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} fontSize={11} />
                              <YAxis yAxisId="left" tickFormatter={(value: number) => `${value}%`} fontSize={11} />
                              <YAxis yAxisId="right" orientation="right" tickFormatter={(value: number) => `¥${value.toFixed(2)}`} fontSize={11} />
                              <RechartsTooltip
                                formatter={(value, name) => {
                                  if (name === "命中率(%)") return [`${value}%`, String(name)];
                                  if (name === "节省金额(¥)") return [`¥${Number(value).toFixed(4)}`, String(name)];
                                  return [value as React.ReactNode, String(name)];
                                }}
                              />
                              <Legend />
                              <Bar yAxisId="right" dataKey="savedCost" name="节省金额(¥)" fill="#52c41a" />
                              <Line yAxisId="left" type="monotone" dataKey="hitRatePct" name="命中率(%)" stroke="#1677ff" strokeWidth={2} dot={false} />
                            </ComposedChart>
                          </ResponsiveContainer>
                          {cacheStats.byKey.length > 0 ? (
                            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                              按 cacheKey 分桶：
                              {cacheStats.byKey.map((k) => `${k.cacheKey} → ${k.promptTokens.toLocaleString()} tokens / 命中率 ${(k.cacheHitRate * 100).toFixed(1)}%`).join("；")}
                            </Typography.Paragraph>
                          ) : null}
                        </Card>
                      ) : null}
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
        <Form.Item name="departmentId" label="部门">
          <Select
            allowClear
            placeholder="选择部门"
            options={departments.map((dept) => ({ value: dept.id, label: dept.name }))}
          />
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

type QianchuanDiffRow = {
  row?: number;
  advertiserId: string;
  anchorId?: string;
  anchorName?: string;
  nickname?: string | null;
  tokenAppId?: string;
  before?: Record<string, unknown>;
};

type DiffSectionProps = {
  title: string;
  diff: { add: QianchuanDiffRow[]; update: QianchuanDiffRow[]; delete: QianchuanDiffRow[] };
  kind: "anchor" | "advertiser";
};
function rowKeyOf(r: QianchuanDiffRow): string {
  return r.anchorId
    ? `${r.advertiserId}::${r.anchorId}`
    : `${r.advertiserId}::${r.tokenAppId ?? ""}`;
}
function DiffSection({ title, diff, kind }: DiffSectionProps) {
  const total = diff.add.length + diff.update.length + diff.delete.length;
  if (total === 0) {
    return (
      <Card size="small" type="inner" title={title}>
        <Typography.Text type="secondary">无变更</Typography.Text>
      </Card>
    );
  }
  const columns = kind === "anchor"
    ? [
        { title: "advertiserId", dataIndex: "advertiserId" },
        { title: "anchorId", dataIndex: "anchorId" },
        { title: "anchorName", dataIndex: "anchorName" },
        { title: "nickname", dataIndex: "nickname" }
      ]
    : [
        { title: "advertiserId", dataIndex: "advertiserId" },
        { title: "tokenAppId", dataIndex: "tokenAppId" },
        { title: "nickname", dataIndex: "nickname" }
      ];
  return (
    <Card size="small" type="inner" title={`${title}（新增 ${diff.add.length} · 更新 ${diff.update.length} · 删除 ${diff.delete.length}）`}>
      {diff.add.length > 0 && (
        <>
          <Typography.Text strong style={{ color: "#389e0d" }}>新增</Typography.Text>
          <Table size="small" pagination={false} rowKey={rowKeyOf} dataSource={diff.add} columns={columns} />
        </>
      )}
      {diff.update.length > 0 && (
        <>
          <Typography.Text strong style={{ color: "#d48806", marginTop: 8, display: "inline-block" }}>更新</Typography.Text>
          <Table
            size="small"
            pagination={false}
            rowKey={rowKeyOf}
            dataSource={diff.update}
            columns={[
              ...columns,
              {
                title: "变更前",
                dataIndex: "before",
                render: (b: Record<string, unknown> | undefined) =>
                  b ? Object.entries(b).map(([k, v]) => `${k}=${v ?? "空"}`).join("；") : "—"
              }
            ]}
          />
        </>
      )}
      {diff.delete.length > 0 && (
        <>
          <Typography.Text strong type="danger" style={{ marginTop: 8, display: "inline-block" }}>删除（系统中将不再保留）</Typography.Text>
          <Table size="small" pagination={false} rowKey={rowKeyOf} dataSource={diff.delete} columns={columns} />
        </>
      )}
    </Card>
  );
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
      excel: "Excel 文件",
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

function parseSceneKeys(value?: string | string[] | null) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function sceneLabel(scenes: BusinessScene[], departmentId: string | null | undefined, key: string) {
  const match = scenes.find((scene) => scene.departmentId === departmentId && scene.sceneKey === key);
  return match ? match.sceneName : key;
}

function DepartmentAdminView({ user }: { user: User }) {
  const isAdmin = user.role === "admin";
  const canManage = isAdmin || !!user.permissions?.includes("manage_settings");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [scenes, setScenes] = useState<BusinessScene[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>("");
  const [deptForm] = Form.useForm();
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [sceneForm] = Form.useForm();
  const [editingScene, setEditingScene] = useState<BusinessScene | null>(null);
  const { message, modal } = App.useApp();

  async function load() {
    const [deptPayload, scenePayload] = await Promise.all([
      api<{ departments: Department[] }>("/api/settings/departments"),
      api<{ scenes: BusinessScene[] }>("/api/settings/scenes")
    ]);
    setDepartments(deptPayload.departments);
    setScenes(scenePayload.scenes);
    if (!selectedDepartmentId) {
      const fallback = isAdmin ? deptPayload.departments[0]?.id : user.departmentId || deptPayload.departments[0]?.id;
      if (fallback) setSelectedDepartmentId(fallback);
    }
  }

  useEffect(() => {
    load().catch((error) => message.error(error.message));
  }, []);

  async function saveDepartment(values: { name: string; code?: string; description?: string }) {
    if (!isAdmin) return;
    if (editingDept) {
      await api(`/api/settings/departments/${editingDept.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values)
      });
      message.success("部门已更新");
    } else {
      await api("/api/settings/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values)
      });
      message.success("部门已创建");
    }
    setEditingDept(null);
    deptForm.resetFields();
    load();
  }

  function confirmDeleteDept(dept: Department) {
    modal.confirm({
      title: `删除部门「${dept.name}」？`,
      content: "若该部门下仍有用户或资料，将无法删除。",
      okType: "danger",
      onOk: async () => {
        await api(`/api/settings/departments/${dept.id}`, { method: "DELETE" });
        message.success("部门已删除");
        if (selectedDepartmentId === dept.id) setSelectedDepartmentId("");
        load();
      }
    });
  }

  async function saveScene(values: { sceneKey: string; sceneName: string; description?: string }) {
    if (!selectedDepartmentId) {
      message.warning("请先选择部门");
      return;
    }
    if (editingScene) {
      await api(`/api/settings/scenes/${editingScene.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values)
      });
      message.success("场景已更新");
    } else {
      await api("/api/settings/scenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, departmentId: selectedDepartmentId })
      });
      message.success("场景已创建");
    }
    setEditingScene(null);
    sceneForm.resetFields();
    load();
  }

  function confirmDeleteScene(scene: BusinessScene) {
    modal.confirm({
      title: `删除场景「${scene.sceneName}」？`,
      okType: "danger",
      onOk: async () => {
        await api(`/api/settings/scenes/${scene.id}`, { method: "DELETE" });
        message.success("场景已删除");
        load();
      }
    });
  }

  if (!canManage) {
    return <Card className="soft-card">当前账号无权限管理部门与场景。</Card>;
  }

  const filteredScenes = selectedDepartmentId ? scenes.filter((scene) => scene.departmentId === selectedDepartmentId) : scenes;
  const departmentOptions = departments.map((dept) => ({ value: dept.id, label: dept.name }));

  return (
    <Space direction="vertical" size={18} style={{ width: "100%" }}>
      {isAdmin && (
        <Card className="soft-card" title="部门列表">
          <Form
            form={deptForm}
            layout="inline"
            onFinish={saveDepartment}
            style={{ marginBottom: 16, rowGap: 12 }}
            initialValues={{ name: "", code: "" }}
          >
            <Form.Item name="name" rules={[{ required: true, message: "部门名称必填" }]}>
              <Input placeholder="部门名称，例如 美妆一组" style={{ width: 200 }} />
            </Form.Item>
            <Form.Item name="code">
              <Input placeholder="部门编码（可选）" style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="description">
              <Input placeholder="说明（可选）" style={{ width: 240 }} />
            </Form.Item>
            <Form.Item>
              <Space>
                <Button type="primary" htmlType="submit">
                  {editingDept ? "保存" : "新增部门"}
                </Button>
                {editingDept && (
                  <Button
                    onClick={() => {
                      setEditingDept(null);
                      deptForm.resetFields();
                    }}
                  >
                    取消
                  </Button>
                )}
              </Space>
            </Form.Item>
          </Form>
          <Table
            rowKey="id"
            dataSource={departments}
            pagination={{ pageSize: 6 }}
            columns={[
              { title: "部门名称", dataIndex: "name" },
              { title: "编码", dataIndex: "code" },
              { title: "说明", dataIndex: "description" },
              { title: "状态", render: (_, row) => <Tag color={row.status === "active" ? "green" : "red"}>{row.status === "active" ? "启用" : "停用"}</Tag> },
              {
                title: "操作",
                render: (_, row) => (
                  <Space>
                    <Button
                      size="small"
                      onClick={() => {
                        setEditingDept(row);
                        deptForm.setFieldsValue({ name: row.name, code: row.code || "", description: row.description || "" });
                      }}
                    >
                      编辑
                    </Button>
                    <Button size="small" danger onClick={() => confirmDeleteDept(row)}>
                      删除
                    </Button>
                  </Space>
                )
              }
            ]}
          />
        </Card>
      )}
      <Card
        className="soft-card"
        title="业务场景"
        extra={
          isAdmin ? (
            <Select
              value={selectedDepartmentId || undefined}
              onChange={setSelectedDepartmentId}
              placeholder="选择部门"
              style={{ minWidth: 200 }}
              options={departmentOptions}
            />
          ) : (
            <Tag color="blue">{departments.find((dept) => dept.id === (user.departmentId || selectedDepartmentId))?.name || "本部门"}</Tag>
          )
        }
      >
        <Form form={sceneForm} layout="inline" onFinish={saveScene} style={{ marginBottom: 16, rowGap: 12 }} initialValues={{ sceneKey: "", sceneName: "" }}>
          <Form.Item name="sceneKey" rules={[{ required: true, message: "场景标识必填" }]}>
            <Input placeholder="场景标识，例如 面膜 / mask" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="sceneName" rules={[{ required: true, message: "场景名称必填" }]}>
            <Input placeholder="场景名称，例如 面膜主图" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="description">
            <Input placeholder="说明（可选）" style={{ width: 240 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" disabled={!selectedDepartmentId}>
                {editingScene ? "保存" : "新增场景"}
              </Button>
              {editingScene && (
                <Button
                  onClick={() => {
                    setEditingScene(null);
                    sceneForm.resetFields();
                  }}
                >
                  取消
                </Button>
              )}
            </Space>
          </Form.Item>
        </Form>
        <Table
          rowKey="id"
          dataSource={filteredScenes}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "场景标识", dataIndex: "sceneKey" },
            { title: "场景名称", dataIndex: "sceneName" },
            { title: "说明", dataIndex: "description" },
            {
              title: "操作",
              render: (_, row) => (
                <Space>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditingScene(row);
                      sceneForm.setFieldsValue({ sceneKey: row.sceneKey, sceneName: row.sceneName, description: row.description || "" });
                    }}
                  >
                    编辑
                  </Button>
                  <Button size="small" danger onClick={() => confirmDeleteScene(row)}>
                    删除
                  </Button>
                </Space>
              )
            }
          ]}
        />
      </Card>
    </Space>
  );
}

function AdvertiserBindingsPanel({ user }: { user: User }) {
  const { message, modal } = App.useApp();
  const canManage = user.role === "admin" || !!user.permissions?.includes("manage_settings");
  const [users, setUsers] = useState<
    Array<{ id: string; username: string; nickname: string; advertiserId: string | null }>
  >([]);
  const [selectedUserId, setSelectedUserId] = useState<string>(user.id);
  const [bindings, setBindings] = useState<AdvertiserBinding[]>([]);
  const [newAdvertiserId, setNewAdvertiserId] = useState("");
  const [loading, setLoading] = useState(false);

  async function refreshUsers() {
    if (!canManage) return;
    const r = await api<{ users: Array<{ id: string; username: string; nickname: string; advertiserId: string | null }> }>(
      "/api/users"
    );
    setUsers(r.users || []);
  }

  async function refreshBindings(uid: string) {
    if (!uid) {
      setBindings([]);
      return;
    }
    setLoading(true);
    try {
      const r = await api<{ bindings: AdvertiserBinding[] }>(
        `/api/admin/bindings?userId=${encodeURIComponent(uid)}`
      );
      setBindings(r.bindings || []);
    } catch (e) {
      message.error((e as Error).message || "加载失败");
      setBindings([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (canManage) refreshUsers();
  }, [canManage]);

  useEffect(() => {
    refreshBindings(selectedUserId);
  }, [selectedUserId]);

  async function addBinding() {
    if (!newAdvertiserId.trim()) {
      message.warning("请输入广告主 ID");
      return;
    }
    try {
      await api("/api/admin/bindings", {
        method: "POST",
        body: JSON.stringify({
          userId: selectedUserId,
          advertiserId: newAdvertiserId.trim(),
          isPrimary: bindings.length === 0
        })
      });
      setNewAdvertiserId("");
      await refreshBindings(selectedUserId);
      message.success("已添加绑定");
    } catch (e) {
      message.error((e as Error).message || "添加失败");
    }
  }

  async function setPrimary(advertiserId: string) {
    try {
      await api("/api/admin/bindings", {
        method: "POST",
        body: JSON.stringify({ userId: selectedUserId, advertiserId, isPrimary: true })
      });
      await refreshBindings(selectedUserId);
      message.success(`已将 ${advertiserId} 设为主绑定`);
    } catch (e) {
      message.error((e as Error).message || "操作失败");
    }
  }

  async function removeBinding(advertiserId: string) {
    modal.confirm({
      title: `确认解绑 ${advertiserId}？`,
      content: "解绑后该用户无法用此广告主查询千川数据。",
      onOk: async () => {
        try {
          await api("/api/admin/bindings", {
            method: "DELETE",
            body: JSON.stringify({ userId: selectedUserId, advertiserId })
          });
          await refreshBindings(selectedUserId);
          message.success("已解绑");
        } catch (e) {
          message.error((e as Error).message || "解绑失败");
        }
      }
    });
  }

  return (
    <Card className="soft-card" title="广告主绑定（user ↔ advertiser）">
      {canManage ? (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space wrap>
            <span>选择用户：</span>
            <Select
              style={{ minWidth: 240 }}
              value={selectedUserId}
              onChange={setSelectedUserId}
              options={users.map((u) => ({ value: u.id, label: `${u.nickname}（${u.username}）` }))}
            />
          </Space>
          <Table<AdvertiserBinding>
            rowKey={(r) => r.advertiserId}
            loading={loading}
            dataSource={bindings}
            pagination={false}
            columns={[
              { title: "广告主 ID", dataIndex: "advertiserId" },
              {
                title: "是否主绑定",
                dataIndex: "isPrimary",
                render: (v: boolean) => (v ? <Tag color="green">是</Tag> : <Tag>否</Tag>)
              },
              {
                title: "操作",
                render: (_: unknown, r: AdvertiserBinding) => (
                  <Space>
                    <Button
                      size="small"
                      disabled={r.isPrimary}
                      onClick={() => setPrimary(r.advertiserId)}
                    >
                      设为主
                    </Button>
                    <Button
                      size="small"
                      danger
                      disabled={r.isPrimary}
                      onClick={() => removeBinding(r.advertiserId)}
                    >
                      解绑
                    </Button>
                  </Space>
                )
              }
            ]}
          />
          <Space wrap>
            <Input
              placeholder="新广告主 ID"
              style={{ width: 280 }}
              value={newAdvertiserId}
              onChange={(e) => setNewAdvertiserId(e.target.value)}
            />
            <Button type="primary" onClick={addBinding}>
              添加绑定
            </Button>
          </Space>
          <Alert
            type="info"
            showIcon
            message="说明：每个用户可绑定多个广告主 ID；主绑定决定登录后的默认当前广告主，可在顶部下拉切换。"
          />
        </Space>
      ) : (
        <Alert
          type="warning"
          showIcon
          message="仅管理员可管理用户广告主绑定。"
        />
      )}
    </Card>
  );
}

function SkillAdminView({ user }: { user: User }) {
  const isAdminUser = user.role === "admin";
  const canManage = isAdminUser || !!user.permissions?.includes("manage_settings");
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [editingSkill, setEditingSkill] = useState<SkillRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [skillForm] = Form.useForm();
  const [paramRows, setParamRows] = useState<Array<{ uid: string; name: string; description: string; required: boolean }>>([]);
  const [testArgs, setTestArgs] = useState("{}");
  const [testResult, setTestResult] = useState<{ ok: boolean; content: string; error?: string; meta?: Record<string, unknown> } | null>(null);
  const { message, modal } = App.useApp();

  const executeMode = Form.useWatch("executeMode", skillForm) as string | undefined;
  const queryParam = Form.useWatch("queryParam", skillForm) as string | undefined;
  const limitParam = Form.useWatch("limitParam", skillForm) as string | undefined;
  const assetTypeParam = Form.useWatch("assetTypeParam", skillForm) as string | undefined;
  const assetIdParam = Form.useWatch("assetIdParam", skillForm) as string | undefined;
  const templateValue = Form.useWatch("template", skillForm) as string | undefined;
  const systemPrompt = Form.useWatch("systemPrompt", skillForm) as string | undefined;

  function buildParametersJson(): string {
    const properties: Record<string, { type: string; description?: string }> = {};
    const required: string[] = [];
    for (const row of paramRows) {
      if (!row.name) continue;
      properties[row.name] = { type: "string", description: row.description || undefined };
      if (row.required) required.push(row.name);
    }
    return JSON.stringify({ type: "object", properties, required });
  }

  function buildExecuteConfigJson(): string {
    if (executeMode === "search_kb") {
      const cfg: Record<string, string> = {};
      if (queryParam) cfg.queryParam = queryParam;
      if (limitParam) cfg.limitParam = limitParam;
      if (assetTypeParam) cfg.assetTypeParam = assetTypeParam;
      return JSON.stringify(cfg);
    }
    if (executeMode === "get_detail") {
      return JSON.stringify(assetIdParam ? { assetIdParam } : {});
    }
    if (executeMode === "no_op") {
      return JSON.stringify({ template: templateValue || "" });
    }
    return "{}";
  }

  async function load() {
    const [skillPayload, deptPayload] = await Promise.all([
      api<{ skills: SkillRow[] }>("/api/skills"),
      api<{ departments: Department[] }>("/api/settings/departments")
    ]);
    setSkills(skillPayload.skills);
    setDepartments(deptPayload.departments);
  }

  useEffect(() => {
    if (!canManage) return;
    load().catch((error) => message.error(error.message));
  }, []);

  function resetParamConfigForMode(mode: string) {
    if (mode === "search_kb") {
      const first = paramRows[0]?.name || "query";
      skillForm.setFieldsValue({ queryParam: first, limitParam: undefined, assetTypeParam: undefined });
    } else if (mode === "get_detail") {
      const first = paramRows[0]?.name || "assetId";
      skillForm.setFieldsValue({ assetIdParam: first });
    } else if (mode === "no_op") {
      skillForm.setFieldsValue({ template: "" });
    }
  }

  function openCreateWarning() {
    message.info("新建技能请到聊天对话中对 AI 说『帮我创建一个新技能: ...』,或粘贴 JSON 让 AI 解析后调用 skillCreator 技能。");
  }

  function openEdit(row: SkillRow) {
    setEditingSkill(row);
    setModalOpen(true);
    setTestArgs("{}");
    setTestResult(null);
    let paramsObj: { type: string; properties?: Record<string, { type: string; description?: string }>; required?: string[] } = {
      type: "object",
      properties: {},
      required: []
    };
    try {
      const parsed = JSON.parse(row.parameters);
      if (parsed && typeof parsed === "object" && parsed.type === "object") {
        paramsObj = parsed;
      }
    } catch {
      // keep default
    }
    const props = paramsObj.properties || {};
    const required = Array.isArray(paramsObj.required) ? paramsObj.required : [];
    const rows = Object.entries(props).map(([key, value], index) => ({
      uid: `seed-${index}-${key}`,
      name: key,
      description: value?.description || "",
      required: required.includes(key)
    }));
    if (!rows.length) rows.push({ uid: `seed-empty-${Date.now()}`, name: "query", description: "", required: true });
    setParamRows(rows);

    let configObj: Record<string, string> = {};
    try {
      const parsed = JSON.parse(row.executeConfig || "{}");
      if (parsed && typeof parsed === "object") configObj = parsed as Record<string, string>;
    } catch {
      // ignore
    }

    skillForm.resetFields();
    skillForm.setFieldsValue({
      name: row.name,
      displayName: row.displayName,
      description: row.description,
      executeMode: row.executeMode,
      enabled: row.enabled,
      departmentId: row.departmentId || undefined,
      queryParam: configObj.queryParam || undefined,
      limitParam: configObj.limitParam || undefined,
      assetTypeParam: configObj.assetTypeParam || undefined,
      assetIdParam: configObj.assetIdParam || undefined,
      template: configObj.template || "",
      systemPrompt: row.systemPrompt || ""
    });
  }

  function closeModal() {
    setModalOpen(false);
    setEditingSkill(null);
    setTestResult(null);
  }

  function addParamRow() {
    const uid = `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const next = [...paramRows, { uid, name: "", description: "", required: false }];
    setParamRows(next);
    resetParamConfigForMode(executeMode || "search_kb");
  }

  function removeParamRow(uid: string) {
    const next = paramRows.filter((row) => row.uid !== uid);
    setParamRows(next);
    resetParamConfigForMode(executeMode || "search_kb");
  }

  function changeParamRow(uid: string, patch: Partial<{ name: string; description: string; required: boolean }>) {
    const next = paramRows.map((row) => (row.uid === uid ? { ...row, ...patch } : row));
    setParamRows(next);
    resetParamConfigForMode(executeMode || "search_kb");
  }

  async function saveSkill() {
    let values: {
      name: string;
      displayName: string;
      description: string;
      executeMode: string;
      enabled: boolean;
      departmentId?: string;
      systemPrompt?: string;
    };
    try {
      values = await skillForm.validateFields();
    } catch {
      return;
    }
    const mode = values.executeMode;
    const paramNames = paramRows.map((r) => r.name).filter(Boolean);
    if (!paramNames.length) {
      message.error("请至少添加一个参数");
      return;
    }
    if (mode === "search_kb") {
      const qp = skillForm.getFieldValue("queryParam") as string;
      if (!qp || !paramNames.includes(qp)) {
        message.error("queryParam 必须选择已定义的参数");
        return;
      }
    } else if (mode === "get_detail") {
      const ap = skillForm.getFieldValue("assetIdParam") as string;
      if (!ap || !paramNames.includes(ap)) {
        message.error("assetIdParam 必须选择已定义的参数");
        return;
      }
    } else if (mode === "no_op") {
      const tpl = skillForm.getFieldValue("template") as string;
      if (!tpl) {
        message.error("no_op 模式需要填写 template");
        return;
      }
    }
    const payload: Record<string, unknown> = {
      name: values.name,
      displayName: values.displayName,
      description: values.description,
      parameters: buildParametersJson(),
      executeMode: mode,
      executeConfig: buildExecuteConfigJson(),
      enabled: values.enabled,
      systemPrompt: values.systemPrompt || null
    };
    if (isAdminUser || values.departmentId) {
      payload.departmentId = values.departmentId || user.departmentId;
    }
    if (editingSkill) {
      await api(`/api/skills/${editingSkill.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      message.success("技能已更新");
      closeModal();
      load();
      return;
    }
    // 防御性分支: 手动创建入口已关闭, UI 不应让用户走到这里
    message.warning("手动创建入口已关闭,请通过对话中的 skillCreator 创建");
  }

  async function runTest() {
    if (!editingSkill) {
      message.warning("请先保存技能后再测试");
      return;
    }
    let parsedArgs: Record<string, unknown> = {};
    try {
      const raw = JSON.parse(testArgs || "{}");
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        parsedArgs = raw as Record<string, unknown>;
      }
    } catch (error) {
      message.error(`测试参数 JSON 解析失败：${(error as Error).message}`);
      return;
    }
    try {
      const payload = await api<{ result: { ok: boolean; content: string; error?: string; meta?: Record<string, unknown> } }>(
        `/api/skills/${editingSkill.id}/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ args: parsedArgs })
        }
      );
      setTestResult(payload.result);
      message.success("测试完成");
    } catch (error) {
      message.error((error as Error).message);
    }
  }

  function confirmDelete(row: SkillRow) {
    modal.confirm({
      title: `删除技能「${row.displayName}」？`,
      content: "删除后该技能将从可用列表移除(软删,可在 5 秒后重建同名)。",
      okType: "danger",
      onOk: async () => {
        await api(`/api/skills/${row.id}`, { method: "DELETE" });
        message.success("技能已删除");
        if (editingSkill?.id === row.id) closeModal();
        load();
      }
    });
  }

  if (!canManage) {
    return <Card className="soft-card">当前账号无权限管理技能。</Card>;
  }

  const departmentOptions = departments.map((dept) => ({ value: dept.id, label: dept.name }));
  const deptName = (id: string | null) => (id ? departments.find((dept) => dept.id === id)?.name || id : "未分配");
  const modeLabel: Record<string, string> = {
    search_kb: "搜索知识库",
    get_detail: "读取资料详情",
    no_op: "模板输出"
  };
  const paramNameOptions = paramRows.filter((row) => row.name).map((row) => ({ value: row.name, label: row.name }));
  const currentMode = executeMode || "search_kb";

  return (
    <Space direction="vertical" size={18} style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message="技能创建入口已迁移至对话"
        description={
          <Space direction="vertical" size={4} style={{ width: "100%" }}>
            <span>
              在聊天窗口对 AI 说『帮我创建一个新技能: [需求]』(例如「做一个产品白底图检索的技能,参数 query,模式 search_kb, 配置 queryParam 映射到 query」)。
              AI 会调用 <Typography.Text code>skillCreator</Typography.Text> 自动写入数据库。
            </span>
            <span>
              也可以把现有 JSON 配置直接粘贴给 AI,它会解析后调用 <Typography.Text code>skillCreator</Typography.Text> 写入。
            </span>
            <Typography.Text type="secondary">
              仅显示本部门或可见的技能;内置技能不可编辑;查看 / 编辑 / 删除 入口保留。
            </Typography.Text>
          </Space>
        }
        action={
          <Button size="small" type="link" onClick={openCreateWarning}>查看示例</Button>
        }
      />
      <Card
        className="soft-card"
        title="技能列表"
        extra={
          <Typography.Text type="secondary">仅显示本部门或可见的技能;内置技能不可编辑。</Typography.Text>
        }
      >
        <Table
          rowKey="id"
          dataSource={skills}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "名称", dataIndex: "name" },
            { title: "显示名", dataIndex: "displayName" },
            { title: "执行方式", render: (_, row) => <Tag color="blue">{modeLabel[row.executeMode] || row.executeMode}</Tag> },
            { title: "状态", render: (_, row) => <Tag color={row.enabled ? "green" : "red"}>{row.enabled ? "启用" : "停用"}</Tag> },
            { title: "部门", render: (_, row) => deptName(row.departmentId) },
            { title: "更新", render: (_, row) => formatDateTime(row.updatedAt) },
            {
              title: "操作",
              width: 200,
              render: (_, row) => (
                <Space>
                  <Button size="small" onClick={() => openEdit(row)}>编辑</Button>
                  <Button size="small" danger onClick={() => confirmDelete(row)}>删除</Button>
                </Space>
              )
            }
          ]}
        />
      </Card>
      <Modal
        open={modalOpen}
        title={editingSkill ? `编辑技能：${editingSkill.displayName}` : "编辑技能"}
        width={720}
        destroyOnHidden
        onCancel={closeModal}
        onOk={saveSkill}
        okText="保存"
        cancelText="取消"
      >
        <Form
          form={skillForm}
          layout="vertical"
          onValuesChange={(changed) => {
            if (changed.executeMode) resetParamConfigForMode(changed.executeMode);
          }}
        >
          <Card size="small" title="① 选类型" style={{ marginBottom: 16, background: "#fafbfc" }}>
            <Form.Item name="executeMode" rules={[{ required: true, message: "请选择类型" }]} style={{ marginBottom: 0 }}>
              <Radio.Group buttonStyle="solid" size="large" style={{ width: "100%" }}>
                <Radio.Button value="search_kb" style={{ width: "33.3%", textAlign: "center", height: "auto", padding: "12px 8px" }}>
                  <Space direction="vertical" size={2} align="center">
                    <span style={{ fontSize: 16 }}>📚 知识库搜索</span>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>拿用户问题搜资料</Typography.Text>
                  </Space>
                </Radio.Button>
                <Radio.Button value="get_detail" style={{ width: "33.3%", textAlign: "center", height: "auto", padding: "12px 8px" }}>
                  <Space direction="vertical" size={2} align="center">
                    <span style={{ fontSize: 16 }}>📄 读取资料详情</span>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>拉某条资料全文</Typography.Text>
                  </Space>
                </Radio.Button>
                <Radio.Button value="no_op" style={{ width: "33.4%", textAlign: "center", height: "auto", padding: "12px 8px" }}>
                  <Space direction="vertical" size={2} align="center">
                    <span style={{ fontSize: 16 }}>✏️ 模板输出</span>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>不查资料,直接拼</Typography.Text>
                  </Space>
                </Radio.Button>
              </Radio.Group>
            </Form.Item>
          </Card>
          <Card size="small" title="② 基础信息" style={{ marginBottom: 16 }}>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item name="name" label="技能名称" rules={[{ required: true, message: "请输入名称" }, { pattern: /^[a-zA-Z][a-zA-Z0-9_]*$/, message: "字母开头,只含字母数字下划线" }]}>
                  <Input placeholder="例如 competitor_analysis" disabled={!!editingSkill} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="displayName" label="显示名" rules={[{ required: true, message: "请输入显示名" }]}>
                  <Input placeholder="例如 竞品分析" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="description" label="一句话告诉模型,啥时候该用这个技能" rules={[{ required: true, message: "请填写描述" }]}>
              <Input placeholder="例如:用户问竞品对比、价格段位时调用" />
            </Form.Item>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item name="departmentId" label="归属部门">
                  <Select allowClear options={departmentOptions} placeholder="默认本部门" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="enabled" label="启用" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
            </Row>
          </Card>
          <Card size="small" title="③ 参数(模型调用时传进来的字段)" style={{ marginBottom: 16 }}>
            <Table
              rowKey="uid"
              dataSource={paramRows}
              pagination={false}
              size="small"
              columns={[
                {
                  title: "参数名",
                  width: 160,
                  render: (_, row) => (
                    <Input
                      value={row.name}
                      placeholder="例如 query"
                      onChange={(e) => changeParamRow(row.uid, { name: e.target.value })}
                    />
                  )
                },
                {
                  title: "说明(给模型看)",
                  render: (_, row) => (
                    <Input
                      value={row.description}
                      placeholder="例如 用户的问题原文"
                      onChange={(e) => changeParamRow(row.uid, { description: e.target.value })}
                    />
                  )
                },
                {
                  title: "必填",
                  width: 80,
                  render: (_, row) => (
                    <Switch
                      checked={row.required}
                      onChange={(checked) => changeParamRow(row.uid, { required: checked })}
                    />
                  )
                },
                {
                  title: "操作",
                  width: 70,
                  render: (_, row) => (
                    <Button size="small" danger onClick={() => removeParamRow(row.uid)} disabled={paramRows.length <= 1}>
                      删除
                    </Button>
                  )
                }
              ]}
            />
            <Button onClick={addParamRow} style={{ marginTop: 8 }}>+ 新增参数</Button>
          </Card>
          <Card size="small" title="④ 模式配置" style={{ marginBottom: 16 }}>
            {currentMode === "search_kb" && (
              <Row gutter={16}>
                <Col xs={24} md={8}>
                  <Form.Item label="把哪个参数当查询词" required>
                    <Select
                      value={queryParam}
                      onChange={(value) => skillForm.setFieldValue("queryParam", value)}
                      options={paramNameOptions}
                      placeholder="选择参数"
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item label="返回条数(可选)">
                    <Select
                      value={limitParam}
                      onChange={(value) => skillForm.setFieldValue("limitParam", value)}
                      options={[{ value: "", label: "(不指定)" }, ...paramNameOptions]}
                      placeholder="(不指定)"
                      allowClear
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item label="资料类型筛选(可选)">
                    <Select
                      value={assetTypeParam}
                      onChange={(value) => skillForm.setFieldValue("assetTypeParam", value)}
                      options={[{ value: "", label: "(不指定)" }, ...paramNameOptions]}
                      placeholder="(不指定)"
                      allowClear
                    />
                  </Form.Item>
                </Col>
              </Row>
            )}
            {currentMode === "get_detail" && (
              <Form.Item label="把哪个参数当资料 ID" required>
                <Select
                  value={assetIdParam}
                  onChange={(value) => skillForm.setFieldValue("assetIdParam", value)}
                  options={paramNameOptions}
                  placeholder="选择参数"
                />
              </Form.Item>
            )}
            {currentMode === "no_op" && (
              <Form.Item label="输出模板" required extra="支持 {{args.x}} 占位符,运行时用真实参数替换">
                <Input.TextArea
                  rows={6}
                  value={templateValue}
                  onChange={(e) => skillForm.setFieldValue("template", e.target.value)}
                  placeholder="例如:你正在分析 {{args.brand}},请用 3 点说明其卖点。"
                />
              </Form.Item>
            )}
          </Card>
          <Collapse
            ghost
            items={[
              {
                key: "advanced",
                label: <Typography.Text type="secondary">高级设置(系统提示词 / 测试)</Typography.Text>,
                children: (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Form.Item name="systemPrompt" label="系统提示词(可选)" extra="拼接在返回内容开头,约束输出风格">
                      <Input.TextArea rows={4} placeholder="例如:请基于资料,使用中文分点总结。" />
                    </Form.Item>
                    <Card size="small" title="测试" type="inner">
                      <Form.Item label="测试参数 (JSON 对象)">
                        <Input.TextArea rows={3} value={testArgs} onChange={(e) => setTestArgs(e.target.value)} spellCheck={false} />
                      </Form.Item>
                      <Button type="primary" onClick={runTest} disabled={!editingSkill}>
                        立即执行
                      </Button>
                      {testResult && (
                        <Card size="small" style={{ marginTop: 12 }} title={testResult.ok ? "✅ 执行成功" : "❌ 执行失败"}>
                          <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                            {testResult.content || testResult.error || "(无返回内容)"}
                          </Typography.Paragraph>
                          {testResult.meta && Object.keys(testResult.meta).length > 0 && (
                            <details style={{ marginTop: 12 }}>
                              <summary>查看 meta</summary>
                              <pre style={{ background: "#f5f5f5", padding: 8, borderRadius: 4, marginTop: 8 }}>
                                {JSON.stringify(testResult.meta, null, 2)}
                              </pre>
                            </details>
                          )}
                        </Card>
                      )}
                    </Card>
                    <Card size="small" title="当前完整 JSON(给开发/管理员核对)" type="inner">
                      <pre style={{ background: "#f5f5f5", padding: 8, borderRadius: 4, marginBottom: 8, fontSize: 12 }}>
{`parameters: ${buildParametersJson()}\n\nexecuteConfig: ${buildExecuteConfigJson()}\n\nsystemPrompt: ${JSON.stringify(systemPrompt || "")}`}
                      </pre>
                    </Card>
                  </Space>
                )
              }
            ]}
          />
        </Form>
      </Modal>
    </Space>
  );
}
