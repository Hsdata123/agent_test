import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { jsonError, requireSuperAdmin } from "@/lib/auth";

const PYTHON_SCRIPT = path.join(process.cwd(), "scripts", "qianchuan_excel.py");
const PYTHON_CANDIDATES = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];

export async function POST(request: Request) {
  try {
    await requireSuperAdmin();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw Object.assign(new Error("未提供文件"), { status: 400 });
    }
    const originalName = (file.name || "preview.xlsx").replace(/[^A-Za-z0-9._-]/g, "_");
    if (!/\.(xlsx|xls|xlsm)$/i.test(originalName)) {
      throw Object.assign(new Error("仅支持 .xlsx / .xls / .xlsm 文件"), { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const tempPath = path.join(os.tmpdir(), `qianchuan-preview-${randomUUID()}-${originalName}`);
    await fs.writeFile(tempPath, buffer);
    try {
      const stdout = await runPython(["preview", tempPath]);
      const result = parseStdout(stdout);
      return new NextResponse(JSON.stringify({ success: true, ...result }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    } finally {
      fs.unlink(tempPath).catch(() => undefined);
    }
  } catch (error) {
    return jsonError(error);
  }
}

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const tried: string[] = [];
    const tryNext = (i: number) => {
      if (i >= PYTHON_CANDIDATES.length) {
        reject(new Error(`python 子进程不可用: ${tried.join(" | ")}`));
        return;
      }
      const cmd = PYTHON_CANDIDATES[i];
      tried.push(cmd);
      const child = spawn(cmd, [PYTHON_SCRIPT, ...args], {
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" }
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", (e) => {
        if (e && typeof e === "object" && "code" in e && (e as { code: unknown }).code === "ENOENT") {
          tryNext(i + 1);
        } else {
          reject(e);
        }
      });
      child.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`python exit ${code}: ${stderr.slice(0, 500)}`));
      });
    };
    tryNext(0);
  });
}

function parseStdout(stdout: string): Record<string, unknown> {
  const line = stdout.split(/\r?\n/).reverse().find((l) => l.trim().startsWith("{"));
  if (!line) throw new Error("python 输出无 JSON 摘要");
  return JSON.parse(line);
}
