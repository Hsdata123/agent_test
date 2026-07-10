#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
skill exec_function 模式的 Python runner
- 从 stdin 读 JSON: {handler, args, sandboxDir, timeoutSec, memMb, allowedStdlib}
- RestrictedPython 编译 + 受限 builtins + 路径白名单
- 调 handler(**args), 把 dict 结果写 stdout
- 任何异常 → {"ok": false, "error": "..."}
"""

import json
import os
import signal
import sys
import traceback

try:
    from RestrictedPython import compile_restricted
    from RestrictedPython.Guards import (
        safe_globals,
        safe_builtins,
        full_write_guard,
    )
except ImportError:
    sys.stdout.write(json.dumps({
        "ok": False,
        "error": "RestrictedPython 未安装, 请管理员执行: pip install RestrictedPython"
    }, ensure_ascii=False))
    sys.stdout.flush()
    sys.exit(0)


ALLOWED_FILE_MODES = {
    "r", "w", "a", "x",
    "rb", "wb", "ab", "xb",
    "r+", "w+", "a+", "x+",
}

# os 模块上可访问的属性 (子集), 严格限定, 不暴露 system / popen / exec 等
ALLOWED_OS_ATTRS = {
    "getpid", "getcwd", "getenv", "getlogin",
    "cpu_count", "sep", "linesep", "name",
    "path", "environ",
    "urandom", "fspath",
}
# os.environ 只读化, 防止 handler 改环境变量
OS_ENVIRON = {k: v for k, v in os.environ.items()}

# sys 模块上可访问的属性
ALLOWED_SYS_ATTRS = {
    "version", "version_info", "platform", "executable", "argv",
    "maxsize", "float_info", "int_info",
    "getdefaultencoding", "getfilesystemencoding",
}


def _make_sandbox_open(sandbox_root):
    """闭包捕获 sandbox_root, handler 调用时无需走 globals"""
    def sandbox_open(file, mode="r", *args, **kwargs):
        if mode not in ALLOWED_FILE_MODES:
            raise PermissionError(f"file mode 禁用: {mode!r}")
        abs_path = os.path.realpath(str(file))
        if not (abs_path == sandbox_root or abs_path.startswith(sandbox_root + os.sep)):
            raise PermissionError(
                f"path not in sandbox: {file!r} resolved to {abs_path!r}, "
                f"sandbox root is {sandbox_root!r}"
            )
        return open(abs_path, mode, *args, **kwargs)
    sandbox_open.__name__ = "open"
    return sandbox_open


def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    """只允许白名单内的 stdlib 模块"""
    allowed = globals.get("__ALLOWED_STDLIB__", set()) if globals else set()
    if name in allowed:
        return __import__(name, globals, locals, fromlist, level)
    raise ImportError(f"module {name!r} 不在白名单, 仅允许: {sorted(allowed)}")


def _read_handler_input():
    raw = sys.stdin.read()
    return json.loads(raw)


def _install_timeout(timeout_sec):
    if not timeout_sec or timeout_sec <= 0:
        return
    if not hasattr(signal, "SIGALRM"):
        return  # Windows 不支持
    def _on_timeout(signum, frame):
        raise TimeoutError(f"handler 执行超过 {timeout_sec}s")
    signal.signal(signal.SIGALRM, _on_timeout)
    signal.alarm(int(timeout_sec))


def _install_memlimit(mem_mb):
    if not mem_mb or mem_mb <= 0:
        return
    try:
        import resource  # POSIX only
        limit_bytes = int(mem_mb) * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (limit_bytes, limit_bytes))
    except (ImportError, ValueError, OSError):
        pass  # Windows / 非 POSIX 静默跳过


def _build_safe_globals(handler_src, sandbox_dir, allowed_stdlib):
    """组装 RestrictedPython 执行 globals: 受限 builtins + 白名单模块 + sandbox_open"""
    # safe_builtins 已经把 open / eval / exec / __import__ 等删了
    # 我们再加一层保险 + 自定义 sandbox_open (闭包捕获 sandbox_dir, 避免依赖 globals)
    builtin_map = dict(safe_builtins)
    builtin_map["open"] = _make_sandbox_open(sandbox_dir)
    # 恢复 _import_ 入口, 但只走我们的 _safe_import 白名单
    builtin_map["__import__"] = _safe_import

    g = dict(safe_globals)
    g["__builtins__"] = builtin_map
    g["__name__"] = "__skill_sandbox__"
    g["__ALLOWED_STDLIB__"] = set(allowed_stdlib or [])

    # os 模块: 包装成只读视图, 只暴露白名单属性
    class SafeOsModule:
        def __getattr__(self, name):
            if name in ALLOWED_OS_ATTRS:
                value = getattr(os, name, None)
                if name == "environ":
                    return dict(OS_ENVIRON)  # 拷贝, handler 改不影响
                return value
            raise AttributeError(f"os.{name} 在沙箱中禁用")

    # sys 模块: 同理
    class SafeSysModule:
        def __getattr__(self, name):
            if name in ALLOWED_SYS_ATTRS:
                return getattr(sys, name)
            raise AttributeError(f"sys.{name} 在沙箱中禁用")

    g["os"] = SafeOsModule()
    g["sys"] = SafeSysModule()

    # 预 import 白名单 stdlib
    for mod_name in (allowed_stdlib or []):
        try:
            g[mod_name] = __import__(mod_name)
        except Exception:
            pass

    return g


def main():
    try:
        payload = _read_handler_input()
    except Exception as e:
        sys.stdout.write(json.dumps({
            "ok": False,
            "error": f"stdin JSON 解析失败: {e}",
        }, ensure_ascii=False))
        sys.stdout.flush()
        return

    handler_src = payload.get("handler", "")
    args = payload.get("args", {}) or {}
    sandbox_dir = payload.get("sandboxDir", "")
    timeout_sec = int(payload.get("timeoutSec", 5))
    mem_mb = int(payload.get("memMb", 256))
    allowed_stdlib = payload.get("allowedStdlib", [])

    if not isinstance(handler_src, str) or not handler_src.strip():
        sys.stdout.write(json.dumps({"ok": False, "error": "handler 为空"}, ensure_ascii=False))
        sys.stdout.flush()
        return
    if not sandbox_dir:
        sys.stdout.write(json.dumps({"ok": False, "error": "sandboxDir 为空"}, ensure_ascii=False))
        sys.stdout.flush()
        return
    sandbox_dir = os.path.realpath(sandbox_dir)
    if not os.path.isdir(sandbox_dir):
        try:
            os.makedirs(sandbox_dir, exist_ok=True)
        except Exception as e:
            sys.stdout.write(json.dumps({"ok": False, "error": f"无法创建沙箱目录: {e}"}, ensure_ascii=False))
            sys.stdout.flush()
            return

    # 超时 + 内存 (POSIX only, Windows 静默)
    _install_memlimit(mem_mb)
    _install_timeout(timeout_sec)

    # RestrictedPython 编译
    try:
        code = compile_restricted(handler_src, "<skill_handler>", "exec")
    except SyntaxError as e:
        sys.stdout.write(json.dumps({
            "ok": False,
            "error": f"handler 语法错误: {e}",
        }, ensure_ascii=False))
        sys.stdout.flush()
        return
    except Exception as e:
        sys.stdout.write(json.dumps({
            "ok": False,
            "error": f"handler 编译失败: {e}",
        }, ensure_ascii=False))
        sys.stdout.flush()
        return

    g = _build_safe_globals(handler_src, sandbox_dir, allowed_stdlib)

    # 执行 handler 源码 (在受限 globals 中)
    try:
        exec(code, g)
    except Exception:
        sys.stdout.write(json.dumps({
            "ok": False,
            "error": "handler 执行异常: " + traceback.format_exc(limit=4),
        }, ensure_ascii=False))
        sys.stdout.flush()
        return

    handler_fn = g.get("handler")
    if handler_fn is None or not callable(handler_fn):
        sys.stdout.write(json.dumps({
            "ok": False,
            "error": "handler 未定义 callable 的 handler(...) 函数",
        }, ensure_ascii=False))
        sys.stdout.flush()
        return

    # 调用 handler(**args)
    if not isinstance(args, dict):
        sys.stdout.write(json.dumps({"ok": False, "error": "args 必须是 dict"}, ensure_ascii=False))
        sys.stdout.flush()
        return

    try:
        result = handler_fn(**args)
    except TimeoutError as e:
        sys.stdout.write(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.stdout.flush()
        return
    except Exception:
        sys.stdout.write(json.dumps({
            "ok": False,
            "error": "handler 运行时异常: " + traceback.format_exc(limit=4),
        }, ensure_ascii=False))
        sys.stdout.flush()
        return

    if not isinstance(result, dict):
        sys.stdout.write(json.dumps({
            "ok": False,
            "error": f"handler 必须返回 dict, 实际 {type(result).__name__}",
        }, ensure_ascii=False))
        sys.stdout.flush()
        return

    # 写入安全检查: dict 里的 value 必须是基本类型, 避免反序列化炸弹
    def _sanitize(value, depth=0):
        if depth > 6:
            return None
        if isinstance(value, dict):
            return {str(k)[:64]: _sanitize(v, depth + 1) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [_sanitize(v, depth + 1) for v in value]
        if isinstance(value, (str, int, float, bool)) or value is None:
            return value
        return str(value)

    sys.stdout.write(json.dumps({
        "ok": True,
        "data": _sanitize(result),
    }, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.stdout.write(json.dumps({
            "ok": False,
            "error": "runner 内部错误: " + traceback.format_exc(limit=4),
        }, ensure_ascii=False))
        sys.stdout.flush()
