import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PYTHON_SCRIPT = path.join(process.cwd(), "scripts", "extract_excel.py");
const PYTHON_CANDIDATES = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];

export async function extractExcelWithPython(buffer: Buffer, originalName: string): Promise<string> {
  const safeName = path.basename(originalName).replace(/[^A-Za-z0-9._-]/g, "_");
  const tempPath = path.join(os.tmpdir(), `excel-${randomUUID()}-${safeName}`);
  await fs.writeFile(tempPath, buffer);
  try {
    return await runPython(tempPath);
  } finally {
    fs.unlink(tempPath).catch(() => undefined);
  }
}

async function runPython(filePath: string): Promise<string> {
  const errors: string[] = [];
  for (const cmd of PYTHON_CANDIDATES) {
    try {
      return await spawnPython(cmd, filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${cmd}: ${message}`);
      if (error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === "ENOENT") {
        continue;
      }
      break;
    }
  }
  throw new Error(
    `调用 Python 解析 Excel 失败。请确认已安装 Python 并在 PATH 中，且 ` +
      `执行了 pip install openpyxl 'xlrd==1.2.0'。尝试的命令：${errors.join("; ")}`
  );
}

function spawnPython(cmd: string, filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, [PYTHON_SCRIPT, filePath], { windowsHide: true });
    let output = "";
    let error = "";
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (data: string) => {
      output += data;
    });
    proc.stderr.on("data", (data: string) => {
      error += data;
      const trimmed = data.trimEnd();
      if (trimmed) console.warn(`[extract_excel.py] ${trimmed}`);
    });
    proc.on("error", (err) => {
      reject(err);
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`exit ${code}: ${error.trim() || "(no stderr)"}`));
      }
    });
  });
}
