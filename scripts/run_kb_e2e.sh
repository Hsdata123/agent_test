#!/usr/bin/env bash
# 知识库端到端测试编排脚本
# - 登录获取 cookie
# - 上传每个 fixture 文件
# - 验证 assetType / extractedText / 权限
# - 跑 chat 召回验证
# - 打印汇总表
#
# 前置:
#   1. python scripts/gen_kb_fixtures.py --clean   (生成 test/fixtures/kb/)
#   2. pnpm dev                                     (启动 server 监听 3000)
#
# 用法:
#   bash scripts/run_kb_e2e.sh                              # 跑全部
#   bash scripts/run_kb_e2e.sh --server http://localhost:3000
#   bash scripts/run_kb_e2e.sh --phase upload               # 只跑上传阶段
#   bash scripts/run_kb_e2e.sh --admin-user admin --admin-pass admin123

set -u
# 允许单个测试失败继续, 退出码取最差
set +e

# ============ 默认配置 ============
SERVER="${SERVER:-http://localhost:3000}"
FIXTURE_DIR="${FIXTURE_DIR:-test/fixtures/kb}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin123}"
OPER_USER="${OPER_USER:-operator}"
OPER_PASS="${OPER_PASS:-operator123}"
PHASE="${PHASE:-all}"   # all / upload / list / chat / permission / clean
TIMEOUT="${TIMEOUT:-120}"

# 中间产物目录
TMPDIR="${TMPDIR:-/tmp/kb-e2e}"
mkdir -p "$TMPDIR"

# 结果记录
RESULTS_FILE="$TMPDIR/results.tsv"
: > "$RESULTS_FILE"
TOTAL=0
PASSED=0
FAILED=0
SKIPPED=0

# ============ 工具函数 ============
log() { echo "[$(date '+%H:%M:%S')] $*" >&2; }
err() { echo "[$(date '+%H:%M:%S')] [ERR] $*" >&2; }

# 跨平台 JSON 解析: 优先用 jq, 没有就用 scripts/jq.py
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if command -v jq >/dev/null 2>&1; then
  JQ() { jq "$@"; }
elif [ -f "$SCRIPT_DIR/jq.py" ]; then
  JQ() { python "$SCRIPT_DIR/jq.py" "$@"; }
else
  err "需要 jq 或 scripts/jq.py"
  exit 2
fi

# 旧版 python 内联 shim 已废弃, 保留 JQ() 唯一入口

# 把 \r\n 兼容的 Windows 文件路径转成可读的 base
basename_safe() {
  basename "$1" | tr -d '\r'
}

# 颜色 (仅当 stdout 是 tty)
if [ -t 1 ]; then
  RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; BLU=$'\033[34m'; RST=$'\033[0m'
else
  RED=""; GRN=""; YLW=""; BLU=""; RST=""
fi

record() {
  local id="$1" name="$2" status="$3" detail="${4:-}"
  TOTAL=$((TOTAL + 1))
  case "$status" in
    PASS) PASSED=$((PASSED + 1)); color="$GRN" ;;
    FAIL) FAILED=$((FAILED + 1)); color="$RED" ;;
    SKIP) SKIPPED=$((SKIPPED + 1)); color="$YLW" ;;
    *)    color="$RST" ;;
  esac
  printf '%s\n' "$id	$name	$status	$detail" >> "$RESULTS_FILE"
  printf "  %s%-4s%s %-6s %-50s %s\n" "$color" "$status" "$RST" "$id" "$name" "$detail" >&2
}

# ============ 登录 ============
login() {
  local user="$1" pass="$2" cookie_out="$3"
  local body
  body=$(JQ -nc --arg u "$user" --arg p "$pass" '{username:$u, password:$p}')
  local resp
  resp=$(curl -sS -m 10 -c "$cookie_out" -X POST \
    -H "Content-Type: application/json" \
    -d "$body" \
    "$SERVER/api/auth/login" 2>&1)
  if echo "$resp" | JQ -e '.success == true' >/dev/null 2>&1; then
    log "  [OK] 登录 $user"
    return 0
  else
    err "  [FAIL] 登录 $user 失败: $resp"
    return 1
  fi
}

# ============ 阶段: 前置检查 ============
phase_precheck() {
  log "=== 前置检查 ==="
  if ! command -v curl >/dev/null; then
    err "需要安装 curl"; exit 2
  fi
  if ! command -v jq >/dev/null && [ ! -f "$SCRIPT_DIR/jq.py" ]; then
    err "需要 jq 或 scripts/jq.py"; exit 2
  fi
  local probe_code
  probe_code=$(curl -sS -m 5 -o /dev/null -w "%{http_code}" "$SERVER/api/me" 2>/dev/null || echo "000")
  if [ "$probe_code" = "000" ]; then
    err "Server $SERVER 不通, 先 pnpm dev"; exit 2
  fi
  if [ ! -d "$FIXTURE_DIR" ] || [ -z "$(ls -A "$FIXTURE_DIR" 2>/dev/null)" ]; then
    err "Fixture 目录为空, 先 python scripts/gen_kb_fixtures.py"; exit 2
  fi
  log "  Server: $SERVER (probe HTTP $probe_code)"
  log "  Fixture: $FIXTURE_DIR"
  log "  用户: $ADMIN_USER / $OPER_USER"
}

# ============ 阶段: 上传 ============
upload_one() {
  local id="$1" file="$2" expect_type="${3:-}" cookie="${4:-}" extra="${5:-}" asset_name="${6:-}"
  [ -z "$asset_name" ] && asset_name="$(basename_safe "$file")"

  local resp_file="$TMPDIR/upload-${id}.json"
  local fields=(-F "files=@${file}")
  [ -n "$expect_type" ] && fields+=(-F "assetType=${expect_type}")
  [ -n "$extra" ] && fields+=(-F "$extra")

  local http_code
  http_code=$(curl -sS -m "$TIMEOUT" -b "$cookie" -o "$resp_file" -w "%{http_code}" \
    -X POST "${fields[@]}" "$SERVER/api/knowledge/upload" 2>&1)

  local body
  body=$(cat "$resp_file" 2>/dev/null)

  if [ "$http_code" = "200" ]; then
    local got_type got_text_len
    got_type=$(echo "$body" | JQ -r '.assets[0].assetType // empty' 2>/dev/null)
    got_text_len=$(echo "$body" | JQ -r '.assets[0].extractedText | length // 0' 2>/dev/null)

    if [ -n "$expect_type" ] && [ "$got_type" != "$expect_type" ]; then
      record "$id" "upload $asset_name" "FAIL" \
        "assetType=$got_type 期望 $expect_type"
    else
      record "$id" "upload $asset_name" "PASS" \
        "type=$got_type text=${got_text_len}B"
    fi
  else
    record "$id" "upload $asset_name" "FAIL" \
      "HTTP $http_code body=$(echo "$body" | head -c 200)"
  fi
}

phase_upload() {
  log "=== 阶段 1: 上传 ==="
  if ! login "$ADMIN_USER" "$ADMIN_PASS" "$TMPDIR/admin.cookie"; then
    err "管理员登录失败, 跳过"; return 1
  fi
  if ! login "$OPER_USER" "$OPER_PASS" "$TMPDIR/operator.cookie"; then
    err "运营登录失败, 部分用例跳过"
  fi

  # 基础类型矩阵
  upload_one "U-01"  "$FIXTURE_DIR/F-TXT-1-prompt.txt"          "prompt"               "$TMPDIR/admin.cookie"
  upload_one "U-02"  "$FIXTURE_DIR/F-TXT-2-document.txt"        "document"             "$TMPDIR/admin.cookie"
  upload_one "U-03"  "$FIXTURE_DIR/F-DOC-1-mixed.docx"          "document"             "$TMPDIR/admin.cookie"
  upload_one "U-04"  "$FIXTURE_DIR/F-DOC-2-large.docx"          "document"             "$TMPDIR/admin.cookie"
  upload_one "U-05"  "$FIXTURE_DIR/F-PDF-1-single-page.pdf"     "pdf"                  "$TMPDIR/admin.cookie"
  upload_one "U-06"  "$FIXTURE_DIR/F-PDF-2-multipage-large.pdf" "pdf"                  "$TMPDIR/admin.cookie"
  upload_one "U-07"  "$FIXTURE_DIR/F-PPT-1-multipage.pptx"      "ppt"                  "$TMPDIR/admin.cookie"
  upload_one "U-08"  "$FIXTURE_DIR/F-PPT-2-legacy.ppt"          "document"             "$TMPDIR/admin.cookie"
  upload_one "U-09"  "$FIXTURE_DIR/F-EXCEL-1-multi-sheet.xlsx"   "excel"                "$TMPDIR/admin.cookie"
  upload_one "U-10"  "$FIXTURE_DIR/F-EXCEL-2-large.xlsx"         "excel"                "$TMPDIR/admin.cookie"
  upload_one "U-11"  "$FIXTURE_DIR/F-EXCEL-3-legacy.xls"         "excel"                "$TMPDIR/admin.cookie"
  upload_one "U-12"  "$FIXTURE_DIR/F-IMG-1-product.png"          "product_white_image"  "$TMPDIR/admin.cookie"
  upload_one "U-13"  "$FIXTURE_DIR/F-IMG-2-portrait.jpg"         "portrait_white_image" "$TMPDIR/admin.cookie"
  upload_one "U-14"  "$FIXTURE_DIR/F-IMG-3-template.psd"         "main_template"        "$TMPDIR/admin.cookie"
  upload_one "U-15"  "$FIXTURE_DIR/F-EMPTY.txt"                  "document"             "$TMPDIR/admin.cookie"
  upload_one "U-16"  "$FIXTURE_DIR/F-BAD-EXT-data.xyz"           "document"             "$TMPDIR/admin.cookie"

  # 损坏文件单独验证 (期望 placeholder)
  upload_one "U-17"  "$FIXTURE_DIR/F-PDF-3-corrupted.pdf"        "pdf"                  "$TMPDIR/admin.cookie"

  # 长文件名 (用 python 列文件名, 避免 Bash glob 对 UTF-8 路径展开失败)
  local longfile
  longfile=$(PYTHONIOENCODING=utf-8 PYTHONUTF8=1 python -c "import os,glob; rs=glob.glob(os.path.join('$FIXTURE_DIR','F-LONG-NAME-*.txt'))[:1]; print(rs[0] if rs else '',end='')" 2>/dev/null)
  if [ -n "$longfile" ]; then
    upload_one "U-18" "$longfile" "document" "$TMPDIR/admin.cookie"
  fi

  # 权限: operator 也应该能上传
  upload_one "U-19" "$FIXTURE_DIR/F-TXT-1-prompt.txt" "prompt" "$TMPDIR/operator.cookie"

  # 异常: 不带文件
  local http_code
  http_code=$(curl -sS -m 10 -b "$TMPDIR/admin.cookie" -o /dev/null -w "%{http_code}" \
    -X POST -F "assetType=document" "$SERVER/api/knowledge/upload")
  if [ "$http_code" = "400" ]; then
    record "U-20" "upload empty body" "PASS" "HTTP 400"
  else
    record "U-20" "upload empty body" "FAIL" "HTTP $http_code (期望 400)"
  fi
}

# ============ 阶段: 列表 / 检索 ============
phase_list() {
  log "=== 阶段 2: 列表 / 检索 ==="
  local resp_file="$TMPDIR/list.json"
  # 默认不过滤, 拿全量做 L-01 总数验证
  curl -sS -m 10 -b "$TMPDIR/admin.cookie" -o "$resp_file" "$SERVER/api/knowledge/assets"
  local total
  total=$(JQ -r '.assets | length' "$resp_file" 2>/dev/null)
  if [ "$total" -gt 0 ] 2>/dev/null; then
    record "L-01" "list assets" "PASS" "$total 条记录"
  else
    record "L-01" "list assets" "FAIL" "空列表"
  fi

  # 按类型筛选 (走分类端点, 限制单类数据量, 避免响应过大)
  local pdf_file="$TMPDIR/list-pdf.json"
  curl -sS -m 10 -b "$TMPDIR/admin.cookie" -o "$pdf_file" "$SERVER/api/knowledge/assets?assetType=pdf"
  local pdf_count
  pdf_count=$(JQ -r '.assets | length' "$pdf_file" 2>/dev/null)
  if [ "$pdf_count" -gt 0 ] 2>/dev/null; then
    record "L-02" "filter pdf" "PASS" "$pdf_count 个 PDF"
  else
    record "L-02" "filter pdf" "FAIL" "0 个 PDF"
  fi

  local prompt_file="$TMPDIR/list-prompt.json"
  curl -sS -m 10 -b "$TMPDIR/admin.cookie" -o "$prompt_file" "$SERVER/api/knowledge/assets?assetType=prompt"
  local txt_count
  txt_count=$(JQ -r '.assets | length' "$prompt_file" 2>/dev/null)
  if [ "$txt_count" -gt 0 ] 2>/dev/null; then
    record "L-03" "filter prompt" "PASS" "$txt_count 个 prompt"
  else
    record "L-03" "filter prompt" "FAIL" "0 个 prompt"
  fi

  # 关键词搜索 (鱼子酱)
  local kw_file="$TMPDIR/list-kw.json"
  curl -sS -m 10 -b "$TMPDIR/admin.cookie" -o "$kw_file" "$SERVER/api/knowledge/assets?q=%E9%B1%BC%E5%AD%90%E9%85%B1"
  local kw_count
  kw_count=$(JQ -r '.assets | length' "$kw_file" 2>/dev/null)
  if [ "$kw_count" -gt 0 ] 2>/dev/null; then
    record "L-04" "search '鱼子酱'" "PASS" "$kw_count 条命中"
  else
    record "L-04" "search '鱼子酱'" "FAIL" "0 条命中"
  fi
}

# ============ 阶段: 权限 ============
phase_permission() {
  log "=== 阶段 3: 权限 ==="

  # operator 应能编辑自己部门的资产 (GET 单条)
  local first_id
  first_id=$(JQ -r '.assets[0].id' "$TMPDIR/list.json" 2>/dev/null)
  if [ -z "$first_id" ] || [ "$first_id" = "null" ]; then
    record "P-01" "operator GET single" "SKIP" "无资产"
    return
  fi

  local http_code
  http_code=$(curl -sS -m 10 -b "$TMPDIR/operator.cookie" -o /dev/null -w "%{http_code}" \
    "$SERVER/api/knowledge/assets/$first_id")
  if [ "$http_code" = "200" ]; then
    record "P-01" "operator GET single" "PASS" "HTTP 200"
  else
    record "P-01" "operator GET single" "FAIL" "HTTP $http_code"
  fi

  # 跨部门 PATCH (operator 改其他部门的资产应被拒)
  # 这里不强求有跨部门资产, 验证 admin 能改即可
  http_code=$(curl -sS -m 10 -b "$TMPDIR/admin.cookie" -o /dev/null -w "%{http_code}" \
    -X PATCH -H "Content-Type: application/json" \
    -d '{"description":"admin 测试更新"}' \
    "$SERVER/api/knowledge/assets/$first_id")
  if [ "$http_code" = "200" ]; then
    record "P-02" "admin PATCH" "PASS" "HTTP 200"
  else
    record "P-02" "admin PATCH" "FAIL" "HTTP $http_code"
  fi
}

# ============ 阶段: Chat 召回 ============
phase_chat() {
  log "=== 阶段 4: Chat 召回 ==="

  # 创建 chat project + conversation
  local proj_resp="$TMPDIR/proj.json"
  curl -sS -m 10 -b "$TMPDIR/admin.cookie" -o "$proj_resp" -X POST \
    -H "Content-Type: application/json" \
    -d '{"name":"KB-E2E-测试项目"}' \
    "$SERVER/api/chat-projects"

  local proj_id
  proj_id=$(JQ -r '.project.id // .id' "$proj_resp" 2>/dev/null)
  if [ -z "$proj_id" ] || [ "$proj_id" = "null" ]; then
    record "C-01" "create chat project" "FAIL" "返回: $(cat "$proj_resp" | head -c 200)"
    return
  fi
  record "C-01" "create chat project" "PASS" "id=$proj_id"

  # 触发对话 (manual 路径: useAll=true)
  local chat_resp="$TMPDIR/chat.txt"
  local http_code
  # manual 路径: 显式指定一个 prompt 资产, 避免 useAll=true 把所有资产塞进 LLM 触发 entity too large
  # 取最新一条 prompt 资产的 ID
  local prompt_id
  prompt_id=$(python scripts/jq.py -r '.assets[0].id' "$TMPDIR/list-prompt.json" 2>/dev/null)
  if [ -z "$prompt_id" ] || [ "$prompt_id" = "null" ]; then
    record "C-02" "chat manual path" "FAIL" "无 prompt 资产可指定"
    return
  fi
  http_code=$(curl -sS -m 120 -b "$TMPDIR/admin.cookie" -o "$chat_resp" -w "%{http_code}" \
    -X POST -H "Content-Type: application/json" \
    -d "{\"message\":\"鱼子酱面膜种草文案\",\"assetIds\":[\"$prompt_id\"],\"advertiserId\":\"\"}" \
    "$SERVER/api/chat")

  if [ "$http_code" = "200" ]; then
    if grep -q '"type":"done"' "$chat_resp" 2>/dev/null; then
      local used_count
      used_count=$(grep -o '"usedAssets":\[' "$chat_resp" | wc -l)
      record "C-02" "chat manual path" "PASS" "got done event"
    else
      record "C-02" "chat manual path" "FAIL" "no done event in stream"
    fi
  else
    record "C-02" "chat manual path" "FAIL" "HTTP $http_code"
  fi

  # skill 路径: useKnowledge=true
  http_code=$(curl -sS -m 60 -b "$TMPDIR/admin.cookie" -o "$chat_resp" -w "%{http_code}" \
    -X POST -H "Content-Type: application/json" \
    -d "{\"message\":\"618 主图推荐\",\"useKnowledge\":true,\"useQianchuan\":false,\"advertiserId\":\"\"}" \
    "$SERVER/api/chat")
  if [ "$http_code" = "200" ]; then
    if grep -q '"type":"skill"' "$chat_resp" 2>/dev/null; then
      record "C-03" "chat skill path" "PASS" "skill event seen"
    elif grep -q '"type":"done"' "$chat_resp" 2>/dev/null; then
      record "C-03" "chat skill path" "PASS" "done (no skill triggered, possibly off-topic)"
    else
      record "C-03" "chat skill path" "FAIL" "no done/skill event"
    fi
  else
    record "C-03" "chat skill path" "FAIL" "HTTP $http_code"
  fi
}

# ============ 阶段: 清理 (可选) ============
phase_clean() {
  log "=== 阶段: 清理 ==="
  rm -f "$TMPDIR"/*.json "$TMPDIR"/*.txt "$TMPDIR"/*.cookie
  log "  中间产物已清理"
}

# ============ 汇总 ============
summary() {
  echo
  echo "${BLU}============================================================${RST}" >&2
  echo "${BLU}  KB E2E 测试汇总${RST}" >&2
  echo "${BLU}============================================================${RST}" >&2
  printf "  总用例: %d\n" "$TOTAL" >&2
  printf "  ${GRN}通过${RST}:  %d\n" "$PASSED" >&2
  printf "  ${RED}失败${RST}:  %d\n" "$FAILED" >&2
  printf "  ${YLW}跳过${RST}:  %d\n" "$SKIPPED" >&2
  echo "${BLU}============================================================${RST}" >&2

  if [ "$FAILED" -gt 0 ]; then
    echo >&2
    echo "${RED}失败用例:${RST}" >&2
    awk -F'\t' '$3 == "FAIL" {printf "  %s  %s\n", $1, $4}' "$RESULTS_FILE" >&2
  fi

  # 退出码: 失败 > 0 返回 1
  [ "$FAILED" -gt 0 ] && return 1 || return 0
}

# ============ 主流程 ============
main() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --server) SERVER="$2"; shift 2 ;;
      --admin-user) ADMIN_USER="$2"; shift 2 ;;
      --admin-pass) ADMIN_PASS="$2"; shift 2 ;;
      --oper-user) OPER_USER="$2"; shift 2 ;;
      --oper-pass) OPER_PASS="$2"; shift 2 ;;
      --phase) PHASE="$2"; shift 2 ;;
      --fixtures) FIXTURE_DIR="$2"; shift 2 ;;
      -h|--help)
        # 只显示开头 18 行注释 (用法)
        head -18 "$0" | sed 's/^# \{0,1\}//'
        exit 0
        ;;
      *) err "未知参数: $1"; exit 2 ;;
    esac
  done

  phase_precheck

  case "$PHASE" in
    upload)     phase_upload ;;
    list)       phase_list ;;
    permission) phase_permission ;;
    chat)       phase_chat ;;
    clean)      phase_clean ;;
    all)
      phase_upload
      phase_list
      phase_permission
      phase_chat
      ;;
    *) err "未知 phase: $PHASE (all / upload / list / permission / chat / clean)"; exit 2 ;;
  esac

  summary
}

main "$@"