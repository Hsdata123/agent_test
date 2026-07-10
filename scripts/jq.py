#!/usr/bin/env python3
"""KB E2E 脚本专用 jq 替代.

支持本脚本中实际用到的语法:
    jq -nc --arg k v '{...}'                       # 构造 JSON
    jq -r '.path.subpath'                          # 字符串路径取值
    jq -r '.a // "fallback"'                       # 空值兜底
    jq -r '.assets[0].assetType // empty'          # 数组索引 + 兜底
    jq -r '.assets | length'                       # 数组长度
    jq -r '.assets[0].extractedText | length // 0' # 字段长度 + 兜底
    jq -r '[.assets[] | select(.assetType=="pdf")] | length'  # 过滤计数
    jq -e '.success == true'                       # 真值退出码 0

不实现完整 jq 语法, 只够本测试用.
"""
import json
import os
import re
import sys


def get_path(data, tokens):
    """按 tokens 路径取值. None token 表示迭代数组取全部."""
    for t in tokens:
        if data is None:
            return None
        if t is None:
            # 迭代: 应在外层循环, 这里仅返回原值
            continue
        if isinstance(t, int):
            if isinstance(data, list) and 0 <= t < len(data):
                data = data[t]
            else:
                return None
        else:
            if isinstance(data, dict):
                data = data.get(t)
            else:
                return None
    return data


def parse_path(path: str):
    """'foo.bar[0].baz' -> ['foo', 'bar', 0, 'baz']; 'a[]' -> ['a', None] (iterate)."""
    tokens = []
    # 先把 'a[]' 切成 'a', '[]'  (空 [] 表示迭代)
    parts = re.split(r'\.|(?=\[\]|\[\d+\]|$)', path)
    for part in parts:
        if part == '':
            continue
        m = re.match(r'^\[(\d+)\]$', part)
        if m:
            tokens.append(int(m.group(1)))
            continue
        m = re.match(r'^\[\]$', part)
        if m:
            tokens.append(None)  # 迭代所有
            continue
        # 普通字段名, 剥除可能残留的 []
        part = re.sub(r'\[\]', '', part)
        tokens.append(part)
    return tokens


def eval_path(data, path: str):
    """'.a.b' 或 '.a // .b' 或 '.a | length'."""
    if path == '.':
        return data
    # 处理 '//' fallback: 优先左, 左空取右
    if ' // ' in path:
        left, right = path.split(' // ', 1)
        lv = eval_path(data, left.strip())
        if lv is not None and lv != "" and lv != [] and lv != {}:
            return lv
        return eval_path(data, right.strip())
    # 处理 '| length' 结尾
    m = re.match(r'^(.+?)\s*\|\s*length\s*(?://\s*(.+))?$', path)
    if m:
        v = eval_path(data, m.group(1).strip())
        if v is None:
            return None
        return len(v)
    return get_path(data, parse_path(path))


def emit(data):
    if data is None:
        return
    if isinstance(data, bool):
        print('true' if data else 'false')
    elif isinstance(data, (str, int, float)):
        if isinstance(data, str):
            print(data)
        else:
            print(data)
    elif isinstance(data, (list, dict)):
        print(json.dumps(data, ensure_ascii=False))
    else:
        print(str(data))


def _is_file(path):
    """跨平台路径探测: 直接路径 / PATH 环境 / /tmp -> $TMP 映射."""
    if os.path.isfile(path):
        return True
    # Git Bash 下 /tmp 实际是 Windows %TEMP%, 但 Python 不认. 显式查环境变量.
    if path.startswith('/tmp/') or path.startswith('/tmp\\'):
        candidates = []
        tmp = os.environ.get('TMP') or os.environ.get('TEMP') or r'C:\tmp'
        candidates.append(os.path.join(tmp, path[len('/tmp'):].lstrip('/\\')))
        # Git for Windows 经常挂在 C:/Program Files/Git/tmp
        candidates.append(os.path.join(r'C:\Program Files\Git\tmp', path[len('/tmp'):].lstrip('/\\')))
        for c in candidates:
            if os.path.isfile(c):
                globals()['_resolved_path'] = c
                return True
    # Cygwin / Git Bash 下有时挂 /c/tmp
    if path.startswith('/c/'):
        c = r'C:\\' + path[len('/c/'):].replace('/', '\\')
        if os.path.isfile(c):
            globals()['_resolved_path'] = c
            return True
    return False


def _open_file(path):
    """打开文件时使用解析后的 Windows 路径."""
    actual = globals().get('_resolved_path') or path
    # 清除一次性缓存
    if '_resolved_path' in globals():
        del globals()['_resolved_path']
    return open(actual, 'r', encoding='utf-8')


def build_json_from_args(args):
    """解析 --arg k v ... '{...}' 部分."""
    args = list(args)
    variables = {}
    body_parts = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == '--arg':
            variables[args[i + 1]] = args[i + 2]
            i += 3
        elif a == '-n':
            i += 1
        else:
            body_parts.append(a)
            i += 1
    body_str = ' '.join(body_parts).strip()
    # 简化: 把 {key:$var} 替换为 {"key": "value"}
    # 只支持 {key1:$v1, key2:$v2} 形式
    body_str = body_str.strip('{}').strip()
    out = {}
    # 按逗号切分 (不嵌套)
    depth = 0
    cur = ''
    items = []
    for ch in body_str:
        if ch == '{':
            depth += 1
            cur += ch
        elif ch == '}':
            depth -= 1
            cur += ch
        elif ch == ',' and depth == 0:
            items.append(cur.strip())
            cur = ''
        else:
            cur += ch
    if cur.strip():
        items.append(cur.strip())
    for item in items:
        k, _, v = item.partition(':')
        k = k.strip()
        v = v.strip()
        if v.startswith('$'):
            out[k] = variables.get(v[1:], '')
        elif v.startswith('"') and v.endswith('"'):
            out[k] = v[1:-1]
        else:
            out[k] = v
    return out


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(2)

    # -nc: 构造 JSON 输出
    if '-nc' in args:
        out = build_json_from_args([a for a in args if a != '-nc'])
        print(json.dumps(out, ensure_ascii=False))
        return

    # -e / -r 标志
    expr_mode = False
    raw_mode = False
    if args[0] == '-e':
        expr_mode = True
        args = args[1:]
    if args[0] == '-r':
        raw_mode = True
        args = args[1:]

    expr = args[0] if args else '.'

    # 可选最后一个位置参数: JSON 文件路径 (避免 Windows 大文件管道缓冲区问题)
    json_file = None
    if len(args) >= 2 and _is_file(args[-1]):
        json_file = args[-1]
        args = args[:-1]
        expr = args[0] if args else '.'

    def read_json():
        if json_file:
            with _open_file(json_file) as f:
                return f.read().strip()
        return sys.stdin.read().strip()

    # 处理 select 计数: '[.x[] | select(.y=="z")] | length'
    m = re.match(r'^\[(.+?)\s*\|\s*select\(\.(\w+)\s*==\s*"([^"]+)"\)\]\s*\|\s*length$', expr)
    if m:
        list_path = m.group(1).strip()
        key = m.group(2)
        expected = m.group(3)
        raw = read_json()
        if not raw:
            print(0)
            return
        data = json.loads(raw)
        v = eval_path(data, list_path)
        if not isinstance(v, list):
            print(0)
            return
        count = sum(1 for x in v if isinstance(x, dict) and str(x.get(key)) == expected)
        print(count)
        return

    raw = read_json()
    if not raw:
        if expr_mode:
            sys.exit(1)
        return
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        if expr_mode:
            sys.exit(1)
        return

    # 真值判断
    if expr_mode:
        # '.success == true' 之类
        m = re.match(r'^(.+?)\s*(==|!=)\s*(.+)$', expr)
        if m:
            left = eval_path(data, m.group(1).strip())
            op = m.group(2)
            right_raw = m.group(3).strip()
            if right_raw == 'true':
                right = True
            elif right_raw == 'false':
                right = False
            elif right_raw.startswith('"'):
                right = right_raw.strip('"')
            else:
                try:
                    right = int(right_raw)
                except ValueError:
                    try:
                        right = float(right_raw)
                    except ValueError:
                        right = right_raw
            if op == '==':
                sys.exit(0 if left == right else 1)
            else:
                sys.exit(0 if left != right else 1)
        v = eval_path(data, expr)
        sys.exit(0 if v else 1)

    v = eval_path(data, expr)
    # '// empty' → 空值不输出
    if '// empty' in expr and v in (None, '', [], {}):
        return
    # '// 0' 等数字兜底
    m = re.search(r'//\s*(\d+)', expr)
    if m and v in (None, '', [], {}):
        print(m.group(1))
        return
    emit(v)


if __name__ == '__main__':
    main()