import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { jsonError, requireUser } from "@/lib/auth";

const PYTHON_SCRIPT = path.join(process.cwd(), "scripts", "qianchuan_excel.py");
const PYTHON_CANDIDATES = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];

export async function GET() {
  try {
    await requireUser();
    const tempPath = path.join(os.tmpdir(), `qianchuan-template-${Date.now()}.xlsx`);
    await runPython(["template", tempPath]);
    const buffer = await fs.readFile(tempPath);
    fs.unlink(tempPath).catch(() => undefined);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="qianchuan-template.xlsx"`
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
      let stderr = "";
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
        else reject(new Error(`python exit ${code}: ${stderr.slice(0, 500)}`));
      });
    };
    tryNext(0);
  });
}