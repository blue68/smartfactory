#!/usr/bin/env bash
# =============================================================================
# 智造管家（SmartFactory Agent）生产环境冒烟测试脚本
#
# 用途：部署或升级完成后，快速验证核心服务链路是否正常。
#
# 用法：
#   ./scripts/smoke-test.sh                          # 默认访问 http://localhost
#   ./scripts/smoke-test.sh http://192.168.1.100     # 指定目标地址
#   ./scripts/smoke-test.sh http://prod.example.com --verbose
#   BASE_URL=http://prod.example.com ./scripts/smoke-test.sh --verbose
#
# 参数：
#   BASE_URL    第一个位置参数，或同名环境变量（默认 http://localhost）
#   --verbose   显示每个请求的完整响应体（调试用）
#
# 退出码：
#   0  所有检查项全部通过
#   1  存在任意失败项
# =============================================================================

set -euo pipefail

# ── 参数解析 ─────────────────────────────────────────────────────────────────

VERBOSE=false
BASE_URL="${BASE_URL:-http://localhost}"

for arg in "$@"; do
  case "$arg" in
    --verbose|-v)
      VERBOSE=true
      ;;
    http://*|https://*)
      BASE_URL="$arg"
      ;;
  esac
done

# 去掉末尾斜杠
BASE_URL="${BASE_URL%/}"

# ── 测试账号（应与 infra/db/init.sql 种子数据一致）────────────────────────
# 如需覆盖，可在执行前设置同名环境变量
SMOKE_USERNAME="${SMOKE_USERNAME:-smoke_tester}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-SmokeTest@2026}"
SMOKE_TENANT="${SMOKE_TENANT:-FACTORY001}"

# ── 颜色与格式 ───────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'  # No Color

# ── 计数器 ───────────────────────────────────────────────────────────────────

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
ACCESS_TOKEN=""

# ── 工具函数 ─────────────────────────────────────────────────────────────────

# 打印分节标题
section() {
  echo ""
  echo -e "${CYAN}${BOLD}━━━ $1 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# 断言 HTTP 状态码
# 用法：assert_status <描述> <预期状态码> <实际状态码> [响应体]
assert_status() {
  local desc="$1"
  local expected="$2"
  local actual="$3"
  local body="${4:-}"

  actual="${actual:-0}"
  if [ "$actual" -eq "$expected" ] 2>/dev/null; then
    echo -e "  ${GREEN}PASS${NC} $desc (HTTP $actual)"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo -e "  ${RED}FAIL${NC} $desc (期望 HTTP $expected，实际 HTTP $actual)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    if [ -n "$body" ]; then
      echo -e "       ${YELLOW}响应详情：${NC}$body"
    fi
  fi

  if $VERBOSE && [ -n "$body" ]; then
    echo -e "       ${YELLOW}[verbose] 响应体：${NC}$body"
  fi
}

# 断言响应头存在指定字段
# 用法：assert_header <描述> <响应头字符串> <期望包含的头名>
assert_header() {
  local desc="$1"
  local headers="$2"
  local header_name="$3"

  if echo "$headers" | grep -qi "^${header_name}:"; then
    echo -e "  ${GREEN}PASS${NC} $desc"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo -e "  ${RED}FAIL${NC} $desc（响应头中未找到 ${header_name}）"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    if $VERBOSE; then
      echo -e "       ${YELLOW}[verbose] 实际响应头：${NC}"
      echo "$headers" | sed 's/^/         /'
    fi
  fi
}

# 断言 SSE 流式响应：检查 Content-Type 含 text/event-stream
assert_sse() {
  local desc="$1"
  local content_type="$2"
  local http_code="$3"
  local body="${4:-}"

  if echo "$content_type" | grep -qi "text/event-stream"; then
    echo -e "  ${GREEN}PASS${NC} $desc (SSE Content-Type 正确)"
    PASS_COUNT=$((PASS_COUNT + 1))
  elif [ "$http_code" -eq 200 ]; then
    echo -e "  ${YELLOW}WARN${NC} $desc (HTTP 200 但 Content-Type 非 SSE: $content_type)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  else
    echo -e "  ${RED}FAIL${NC} $desc (HTTP $http_code)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    if [ -n "$body" ]; then
      echo -e "       ${YELLOW}响应详情：${NC}$body"
    fi
  fi
}

# 带 token 的 GET 请求，返回状态码
get_with_token() {
  local url="$1"
  local token="${2:-$ACCESS_TOKEN}"
  curl -s -o /tmp/sf_smoke_body.txt -w "%{http_code}" \
    -H "Authorization: Bearer $token" \
    --max-time 15 \
    "$url" 2>/dev/null
}

# ── 前置检查 ─────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}================================================================${NC}"
echo -e "${BOLD}  智造管家 生产环境冒烟测试${NC}"
echo -e "${BOLD}================================================================${NC}"
echo -e "  目标地址  : ${CYAN}$BASE_URL${NC}"
echo -e "  测试账号  : $SMOKE_USERNAME (租户: $SMOKE_TENANT)"
echo -e "  开始时间  : $(date '+%Y-%m-%d %H:%M:%S')"
echo -e "  Verbose   : $VERBOSE"
echo ""

# 检查 curl 是否可用
if ! command -v curl &>/dev/null; then
  echo -e "${RED}错误：curl 未安装，无法执行冒烟测试。${NC}"
  exit 1
fi

# ═════════════════════════════════════════════════════════════════════════════
# 1. 基础设施检查
# ═════════════════════════════════════════════════════════════════════════════
section "1. 基础设施检查"

# 1.1 API 健康检查端点
echo ""
echo "  [1.1] GET /health — API 健康检查"
BODY=$(curl -s --max-time 10 "$BASE_URL/health" 2>/dev/null)
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE_URL/health" 2>/dev/null)
assert_status "/health 应返回 200" 200 "$HTTP_CODE" "$BODY"
if $VERBOSE; then
  echo -e "       [verbose] 响应体: $BODY"
fi

# 1.2 Nginx 前端静态页面
echo ""
echo "  [1.2] GET / — Nginx 前端页面"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE_URL/" 2>/dev/null)
assert_status "/ 前端页面应返回 200" 200 "$HTTP_CODE"

# ═════════════════════════════════════════════════════════════════════════════
# 2. 认证流程检查
# ═════════════════════════════════════════════════════════════════════════════
section "2. 认证流程检查"

# 2.1 正常登录，获取 Access Token
echo ""
echo "  [2.1] POST /api/auth/login — 账号密码登录"
LOGIN_RESP=$(curl -s --max-time 15 \
  -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$SMOKE_USERNAME\",\"password\":\"$SMOKE_PASSWORD\",\"tenantCode\":\"$SMOKE_TENANT\"}" \
  2>/dev/null)
LOGIN_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
  -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$SMOKE_USERNAME\",\"password\":\"$SMOKE_PASSWORD\",\"tenantCode\":\"$SMOKE_TENANT\"}" \
  2>/dev/null)
assert_status "POST /api/auth/login 应返回 200" 200 "$LOGIN_CODE" "$LOGIN_RESP"

# 从响应中提取 token（兼容 .data.token 或 .data.accessToken）
if command -v python3 &>/dev/null; then
  ACCESS_TOKEN=$(python3 -c "
import sys, json
try:
    d = json.loads('''$LOGIN_RESP''')
    data = d.get('data', {})
    print(data.get('token') or data.get('accessToken') or '')
except:
    print('')
" 2>/dev/null)
elif command -v jq &>/dev/null; then
  ACCESS_TOKEN=$(echo "$LOGIN_RESP" | jq -r '.data.token // .data.accessToken // ""' 2>/dev/null)
fi

if $VERBOSE; then
  echo -e "       [verbose] 登录响应: $LOGIN_RESP"
fi

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "null" ]; then
  echo -e "       ${YELLOW}警告：无法提取 Access Token，后续需鉴权的接口测试将跳过${NC}"
  echo -e "       ${YELLOW}请确认测试账号 '$SMOKE_USERNAME' 已在数据库中创建${NC}"
  ACCESS_TOKEN=""
fi

# 2.2 携带有效 token 访问受保护接口
echo ""
echo "  [2.2] GET /api/skus — 携带有效 Token 访问受保护接口"
if [ -n "$ACCESS_TOKEN" ]; then
  HTTP_CODE=$(get_with_token "$BASE_URL/api/skus")
  BODY=$(cat /tmp/sf_smoke_body.txt 2>/dev/null)
  assert_status "有效 Token 应获得 200" 200 "$HTTP_CODE" "$BODY"
else
  echo -e "       ${YELLOW}SKIP${NC} — 无有效 Token，跳过"
  SKIP_COUNT=$((SKIP_COUNT + 1))
fi

# 2.3 不携带 token 访问受保护接口（期望 401）
echo ""
echo "  [2.3] GET /api/skus — 不携带 Token 访问受保护接口（期望 401）"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  "$BASE_URL/api/skus" 2>/dev/null)
assert_status "无 Token 应返回 401" 401 "$HTTP_CODE"

# 2.4 使用非法 token 访问受保护接口（期望 401）
echo ""
echo "  [2.4] GET /api/skus — 使用伪造 Token（期望 401）"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  -H "Authorization: Bearer this-is-a-fake-token" \
  "$BASE_URL/api/skus" 2>/dev/null)
assert_status "伪造 Token 应返回 401" 401 "$HTTP_CODE"

# ═════════════════════════════════════════════════════════════════════════════
# 3. 核心业务模块冒烟
# ═════════════════════════════════════════════════════════════════════════════
section "3. 核心业务模块冒烟"

if [ -z "$ACCESS_TOKEN" ]; then
  echo ""
  echo -e "  ${YELLOW}无有效 Token，跳过所有业务接口测试（共 8 项）${NC}"
  SKIP_COUNT=$((SKIP_COUNT + 8))
else

  # 3.1 SKU 列表
  echo ""
  echo "  [3.1] GET /api/skus — SKU 列表"
  HTTP_CODE=$(get_with_token "$BASE_URL/api/skus")
  BODY=$(cat /tmp/sf_smoke_body.txt 2>/dev/null)
  assert_status "GET /api/skus 应返回 200" 200 "$HTTP_CODE" "$BODY"

  # 3.2 SKU 分类
  echo ""
  echo "  [3.2] GET /api/skus/categories — SKU 分类"
  HTTP_CODE=$(get_with_token "$BASE_URL/api/skus/categories")
  BODY=$(cat /tmp/sf_smoke_body.txt 2>/dev/null)
  assert_status "GET /api/skus/categories 应返回 200" 200 "$HTTP_CODE" "$BODY"

  # 3.3 库存列表
  echo ""
  echo "  [3.3] GET /api/inventory — 库存列表"
  HTTP_CODE=$(get_with_token "$BASE_URL/api/inventory")
  BODY=$(cat /tmp/sf_smoke_body.txt 2>/dev/null)
  assert_status "GET /api/inventory 应返回 200" 200 "$HTTP_CODE" "$BODY"

  # 3.4 销售订单列表
  echo ""
  echo "  [3.4] GET /api/sales/orders — 销售订单列表"
  HTTP_CODE=$(get_with_token "$BASE_URL/api/sales/orders")
  BODY=$(cat /tmp/sf_smoke_body.txt 2>/dev/null)
  assert_status "GET /api/sales/orders 应返回 200" 200 "$HTTP_CODE" "$BODY"

  # 3.5 生产工单列表
  echo ""
  echo "  [3.5] GET /api/production/orders — 生产工单列表"
  HTTP_CODE=$(get_with_token "$BASE_URL/api/production/orders")
  BODY=$(cat /tmp/sf_smoke_body.txt 2>/dev/null)
  assert_status "GET /api/production/orders 应返回 200" 200 "$HTTP_CODE" "$BODY"

  # 3.6 采购建议列表
  echo ""
  echo "  [3.6] GET /api/purchase/suggestions — 采购建议列表"
  HTTP_CODE=$(get_with_token "$BASE_URL/api/purchase/suggestions")
  BODY=$(cat /tmp/sf_smoke_body.txt 2>/dev/null)
  assert_status "GET /api/purchase/suggestions 应返回 200" 200 "$HTTP_CODE" "$BODY"

  # 3.7 采购订单列表
  echo ""
  echo "  [3.7] GET /api/purchase/orders — 采购订单列表"
  HTTP_CODE=$(get_with_token "$BASE_URL/api/purchase/orders")
  BODY=$(cat /tmp/sf_smoke_body.txt 2>/dev/null)
  assert_status "GET /api/purchase/orders 应返回 200" 200 "$HTTP_CODE" "$BODY"

  # 3.8 质检记录列表
  echo ""
  echo "  [3.8] GET /api/quality/inspections — 质检记录列表"
  HTTP_CODE=$(get_with_token "$BASE_URL/api/quality/inspections")
  BODY=$(cat /tmp/sf_smoke_body.txt 2>/dev/null)
  assert_status "GET /api/quality/inspections 应返回 200" 200 "$HTTP_CODE" "$BODY"

fi

# ═════════════════════════════════════════════════════════════════════════════
# 4. AI 模块冒烟
# ═════════════════════════════════════════════════════════════════════════════
section "4. AI 模块冒烟"

if [ -z "$ACCESS_TOKEN" ]; then
  echo ""
  echo -e "  ${YELLOW}无有效 Token，跳过 AI 接口测试（共 2 项）${NC}"
  SKIP_COUNT=$((SKIP_COUNT + 2))
else

  # 4.1 SSE 流式对话（只验证连接建立和响应头，最多等 5 秒后断开）
  echo ""
  echo "  [4.1] POST /api/ai/chat — SSE 流式对话"
  AI_RESP=$(curl -s --max-time 5 \
    -X POST "$BASE_URL/api/ai/chat" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Accept: text/event-stream" \
    -d '{"message":"当前库存水位如何？"}' \
    -D /tmp/sf_smoke_sse_headers.txt \
    2>/dev/null || true)  # 超时断开属于预期行为，不算失败
  AI_HTTP=$(grep -oE 'HTTP/[0-9.]+ [0-9]+' /tmp/sf_smoke_sse_headers.txt 2>/dev/null | head -1 | grep -oE '[0-9]+$' || echo "000")
  AI_CT=$(grep -i "content-type:" /tmp/sf_smoke_sse_headers.txt 2>/dev/null | head -1 || echo "")
  assert_sse "POST /api/ai/chat 应返回 SSE 流" "$AI_CT" "$AI_HTTP" "$AI_RESP"
  if $VERBOSE; then
    echo -e "       [verbose] 响应头:"
    cat /tmp/sf_smoke_sse_headers.txt 2>/dev/null | sed 's/^/         /'
    echo -e "       [verbose] 流内容片段: ${AI_RESP:0:200}"
  fi

  # 4.2 AI 主动建议列表
  echo ""
  echo "  [4.2] GET /api/ai/suggestions — AI 主动建议列表"
  HTTP_CODE=$(get_with_token "$BASE_URL/api/ai/suggestions")
  BODY=$(cat /tmp/sf_smoke_body.txt 2>/dev/null)
  assert_status "GET /api/ai/suggestions 应返回 200" 200 "$HTTP_CODE" "$BODY"

fi

# ═════════════════════════════════════════════════════════════════════════════
# 5. 安全响应头检查
# ═════════════════════════════════════════════════════════════════════════════
section "5. 安全响应头检查"

echo ""
echo "  获取 / 响应头..."
curl -s -I --max-time 10 "$BASE_URL/" -o /dev/null \
  -D /tmp/sf_smoke_security_headers.txt 2>/dev/null || true
SECURITY_HEADERS=$(cat /tmp/sf_smoke_security_headers.txt 2>/dev/null)

if $VERBOSE; then
  echo -e "  [verbose] 完整响应头:"
  echo "$SECURITY_HEADERS" | sed 's/^/    /'
fi

echo ""
echo "  [5.1] Content-Security-Policy"
assert_header "响应头应包含 Content-Security-Policy" "$SECURITY_HEADERS" "Content-Security-Policy"

echo ""
echo "  [5.2] Strict-Transport-Security"
assert_header "响应头应包含 Strict-Transport-Security" "$SECURITY_HEADERS" "Strict-Transport-Security"

echo ""
echo "  [5.3] X-Content-Type-Options"
assert_header "响应头应包含 X-Content-Type-Options" "$SECURITY_HEADERS" "X-Content-Type-Options"

echo ""
echo "  [5.4] X-Frame-Options"
assert_header "响应头应包含 X-Frame-Options" "$SECURITY_HEADERS" "X-Frame-Options"

echo ""
echo "  [5.5] Referrer-Policy"
assert_header "响应头应包含 Referrer-Policy" "$SECURITY_HEADERS" "Referrer-Policy"

# ── 清理临时文件 ─────────────────────────────────────────────────────────────

rm -f /tmp/sf_smoke_body.txt \
      /tmp/sf_smoke_sse_headers.txt \
      /tmp/sf_smoke_security_headers.txt 2>/dev/null || true

# ═════════════════════════════════════════════════════════════════════════════
# 最终汇总
# ═════════════════════════════════════════════════════════════════════════════

TOTAL=$((PASS_COUNT + FAIL_COUNT + SKIP_COUNT))
END_TIME=$(date '+%Y-%m-%d %H:%M:%S')

echo ""
echo -e "${BOLD}================================================================${NC}"
echo -e "${BOLD}  测试汇总${NC}"
echo -e "${BOLD}================================================================${NC}"
echo -e "  结束时间  : $END_TIME"
echo -e "  目标地址  : $BASE_URL"
echo -e "  总检查项  : $TOTAL"
echo -e "  ${GREEN}PASS${NC}      : $PASS_COUNT"
echo -e "  ${RED}FAIL${NC}      : $FAIL_COUNT"
echo -e "  ${YELLOW}SKIP${NC}      : $SKIP_COUNT"
echo ""

if [ "$FAIL_COUNT" -eq 0 ] && [ "$SKIP_COUNT" -eq 0 ]; then
  echo -e "  ${GREEN}${BOLD}结论：所有检查项通过，系统基础链路正常。${NC}"
  echo ""
  exit 0
elif [ "$FAIL_COUNT" -eq 0 ] && [ "$SKIP_COUNT" -gt 0 ]; then
  echo -e "  ${YELLOW}${BOLD}结论：已执行项均通过，但有 $SKIP_COUNT 项因缺少 Token 被跳过。${NC}"
  echo -e "  ${YELLOW}请确认测试账号已创建，重新执行以获得完整结果。${NC}"
  echo ""
  exit 0
else
  echo -e "  ${RED}${BOLD}结论：存在 $FAIL_COUNT 项失败，请在上线前排查。${NC}"
  if $VERBOSE; then
    echo -e "  排查建议："
    echo -e "    1. 检查容器状态  : docker compose ps"
    echo -e "    2. 查看 API 日志 : docker compose logs --tail=50 api"
    echo -e "    3. 查看 Web 日志 : docker compose logs --tail=50 web"
    echo -e "    4. 参考排查指南 : docs/smoke-test-guide.md"
  else
    echo -e "  提示：使用 --verbose 参数可查看详细响应信息"
  fi
  echo ""
  exit 1
fi
