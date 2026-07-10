// skill exec_function 沙箱共享常量
// 同时被 Node 端 (runner.ts) 和 Python 端 (runner.py) 引用, 改值要同步

import path from "node:path";

export const SANDBOX_DIR_NAME = "skill_sandbox";

/** 项目根下的沙箱绝对路径, handler 内文件操作只能落在这里 */
export function sandboxDir(projectRoot: string = process.cwd()): string {
  return path.join(projectRoot, SANDBOX_DIR_NAME);
}

export const DEFAULT_TIMEOUT_MS = 5_000;
/** 父进程兜底超时, 略大于子进程 5s, 给子进程先退出机会 */
export const PARENT_KILL_TIMEOUT_MS = 7_000;

export const DEFAULT_MEM_MB = 256;
export const MAX_HANDLER_BYTES = 100_000; // 100KB, 注册时硬上限

/** 允许出现在 handler 里的 stdlib 模块名 (白名单); Python 端会按这个表 import */
export const ALLOWED_STDLIB = new Set([
  "datetime",
  "math",
  "json",
  "re",
  "string",
  "typing",
  "collections",
  "itertools",
  "functools",
  "hashlib",
  "base64",
  "uuid",
  "time",
  "random",
  "textwrap",
  "unicodedata"
]);

/** 黑名单模块 — 包含即拒, 用于 UX 快速反馈 (不是安全边界) */
export const FORBIDDEN_MODULE_HINTS = [
  "subprocess",
  "os.system",
  "os.popen",
  "os.exec",
  "os.spawn",
  "os.fork",
  "os.kill",
  "os.remove",
  "os.unlink",
  "os.rmdir",
  "os.removedirs",
  "shutil.",
  "socket.",
  "urllib.",
  "http.",
  "ssl.",
  "ctypes",
  "cffi",
  "importlib",
  "pickle",
  "marshal",
  "tempfile",
  "pathlib",
  "asyncio",
  "multiprocessing",
  "threading",
  "requests",
  "httpx",
  "aiohttp"
];

/** 沙箱 open() 接受的文件 mode 白名单 (r/w/a/x/rb/wb/ab/r+/w+/a+) */
export const ALLOWED_FILE_MODES = new Set([
  "r", "w", "a", "x",
  "rb", "wb", "ab", "xb",
  "r+", "w+", "a+", "x+"
]);
