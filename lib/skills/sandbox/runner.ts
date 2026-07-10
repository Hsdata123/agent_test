// Node 端 spawn 包装, 调用 lib/skills/sandbox/runner.py
// 负责超时 / 父进程兜底 kill / 错误信息组装 / 返回 SkillResult

import { spawn } from "node:child_process";
import path from "node:path";
import {
  ALLOWED_STDLIB,
  DEFAULT_MEM_MB,
  DEFAULT_TIMEOUT_MS,
  PARENT_KILL_TIMEOUT_MS,
  sandboxDir
} from "./policy";

const RUNNER_SCRIPT = path.join(__dirname, "runner.py");

export type RunPythonResult =
  | { ok: true; data: Record<string, unknown>; rawJson: string; durationMs: number }
  | { ok: false; error: string; rawJson?: string; stderr?: string; durationMs: number };

/**
 * 调用 Python sandbox runner 执行 handler
 * @param handler Python 源码, 必须定义 def handler(**kwargs) -> dict
 * @param args 传给 handler 的关键字参数
 */
export async function runPythonHandler(
  handler: string,
  args: Record<string, unknown>
): Promise<RunPythonResult> {
  const start = Date.now();
  const sandbox = sandboxDir();
  const payload = JSON.stringify({
    handler,
    args,
    sandboxDir: sandbox,
    timeoutSec: Math.max(1, Math.ceil(DEFAULT_TIMEOUT_MS / 1000)),
    memMb: DEFAULT_MEM_MB,
    allowedStdlib: Array.from(ALLOWED_STDLIB)
  });

  // Windows 上 "python3" 不一定有, 优先用 python (3.13 安装器注册的别名)
  const candidates =
    process.platform === "win32" ? ["python", "python3", "py"] : ["python3", "python"];
  const { binary, spawnErr } = await pickBinary(candidates);
  if (!binary) {
    return {
      ok: false,
      error: `找不到可用的 Python 解释器 (尝试了 ${candidates.join(", ")}): ${spawnErr || "ENOENT"}`,
      durationMs: Date.now() - start
    };
  }

  return new Promise<RunPythonResult>((resolve) => {
    let child;
    try {
      child = spawn(binary, [RUNNER_SCRIPT], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
    } catch (err) {
      resolve({
        ok: false,
        error: `spawn 失败: ${(err as Error).message}`,
        durationMs: Date.now() - start
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (result: RunPythonResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(parentKillTimer);
      resolve(result);
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      settle({
        ok: false,
        error: `子进程启动失败: ${err.message}`,
        stderr,
        durationMs: Date.now() - start
      });
    });
    child.on("close", (code, signal) => {
      if (signal === "SIGKILL" || code === 137 || code === null) {
        settle({
          ok: false,
          error: `执行超时 (上限 ${DEFAULT_TIMEOUT_MS / 1000}s), 被父进程 kill`,
          stderr: stderr.slice(0, 500),
          rawJson: stdout,
          durationMs: Date.now() - start
        });
        return;
      }
      if (code !== 0) {
        settle({
          ok: false,
          error: `子进程异常退出 (code=${code}): ${stderr.slice(0, 500) || stdout.slice(0, 200)}`,
          stderr: stderr.slice(0, 500),
          rawJson: stdout,
          durationMs: Date.now() - start
        });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch (err) {
        settle({
          ok: false,
          error: `结果 JSON 解析失败: ${(err as Error).message}; raw=${stdout.slice(0, 200)}`,
          stderr: stderr.slice(0, 500),
          rawJson: stdout,
          durationMs: Date.now() - start
        });
        return;
      }
      if (!parsed || typeof parsed !== "object") {
        settle({
          ok: false,
          error: "结果不是 JSON object",
          rawJson: stdout,
          durationMs: Date.now() - start
        });
        return;
      }
      const obj = parsed as { ok?: boolean; data?: unknown; error?: string };
      if (obj.ok && obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)) {
        settle({
          ok: true,
          data: obj.data as Record<string, unknown>,
          rawJson: stdout,
          durationMs: Date.now() - start
        });
        return;
      }
      settle({
        ok: false,
        error: obj.error || "子进程未返回 ok=true/data",
        rawJson: stdout,
        durationMs: Date.now() - start
      });
    });

    const parentKillTimer = setTimeout(() => {
      if (settled) return;
      try {
        child.kill("SIGKILL");
      } catch {
        // 进程已退
      }
      settle({
        ok: false,
        error: `执行超时 (父进程兜底 kill, 上限 ${PARENT_KILL_TIMEOUT_MS / 1000}s)`,
        stderr: stderr.slice(0, 500),
        rawJson: stdout,
        durationMs: Date.now() - start
      });
    }, PARENT_KILL_TIMEOUT_MS);

    // 写 stdin 后立即关闭, 触发子进程开始读
    try {
      child.stdin.write(payload);
      child.stdin.end();
    } catch (err) {
      settle({
        ok: false,
        error: `stdin 写入失败: ${(err as Error).message}`,
        durationMs: Date.now() - start
      });
    }
  });
}

async function pickBinary(candidates: string[]): Promise<{ binary: string | null; spawnErr?: string }> {
  // 直接挨个 spawn 试; 第一个 ENOENT 跳过, 其他错误也跳过
  for (const cmd of candidates) {
    const ok = await new Promise<boolean>((resolve) => {
      const probe = spawn(cmd, ["--version"], { stdio: "ignore", windowsHide: true });
      probe.on("error", () => resolve(false));
      probe.on("close", (code) => resolve(code === 0));
    });
    if (ok) return { binary: cmd };
  }
  return { binary: null, spawnErr: "no python interpreter found" };
}
