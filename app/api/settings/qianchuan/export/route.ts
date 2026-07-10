import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { jsonError, requireUser } from "@/lib/auth";

const PYTHON_SCRIPT = path.join(process.cwd(), "scripts", "qianchuan_excel.py");
const PYTHON_CANDIDATES = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];

export async function GET(request: Request) {
  try {
    await requireUser();
    const url = new URL(request.url);
    const advertiserId = url.searchParams.get("advertiserId") || undefined;
    const filename = `qianchuan-${advertiserId ?? "all"}-${randomUUID().slice(0, 8)}.xlsx`;
    const tempPath = path.join(os.tmpdir(), filename);
    const args = ["export", tempPath];
    if (advertiserId) args.push("--advertiser-id", advertiserId);
    await runPython(args);
    const buffer = await fs.readFile(tempPath);
    fs.unlink(tempPath).catch(() => undefined);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}

function runPython(args: string[]): Promise<void> {
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
        if (code === 0) resolve();
        else reject(new Error(`python exit ${code}: ${stderr.slice(0, 500)} | stdout=${stdout.slice(0, 200)}`));
      });
    };
    tryNext(0);
  });
}