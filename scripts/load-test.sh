#!/usr/bin/env bash
#
# [artifact:自动化测试] — BE-P2-015 核心 API 压测脚本
#
# 前置依赖：wrk (brew install wrk)
# 使用方式：
#   chmod +x scripts/load-test.sh
#   ./scripts/load-test.sh                          # 默认 50 并发 30 秒
#   ./scripts/load-test.sh -c 100 -d 60             # 100 并发 60 秒
#   JWT_TOKEN="eyJ..." ./scripts/load-test.sh       # 指定 Token
#
# 目标接口：
#   1. GET  /api/analytics/dashboard-kpi  — 驾驶舱 KPI
#   2. GET  /api/inventory?page=1&pageSize=20  — 库存列表
#   3. GET  /api/production/orders?status=in_progress  — 生产工单
#   4. POST /api/ai/chat  — AI 对话（SSE 流式）
#
# 输出：每个接口的 QPS、Latency P50/P95/P99、错误率
#

set -euo pipefail

# ─── 默认配置 ──────────────────────────────────
BASE_URL="${BASE_URL:-http://localhost:3000}"
CONCURRENCY="${CONCURRENCY:-50}"
DURATION="${DURATION:-30}"
JWT_TOKEN="${JWT_TOKEN:-REPLACE_WITH_YOUR_JWT_TOKEN}"

# ─── 参数解析 ──────────────────────────────────
while getopts "c:d:u:t:" opt; do
  case $opt in
    c) CONCURRENCY="$OPTARG" ;;
    d) DURATION="$OPTARG" ;;
    u) BASE_URL="$OPTARG" ;;
    t) JWT_TOKEN="$OPTARG" ;;
    *) echo "Usage: $0 [-c concurrency] [-d duration_sec] [-u base_url] [-t jwt_token]"; exit 1 ;;
  esac
done

# ─── 检查 wrk ──────────────────────────────────
if ! command -v wrk &>/dev/null; then
  echo "❌ wrk 未安装。请先安装："
  echo "   macOS:  brew install wrk"
  echo "   Linux:  sudo apt install wrk"
  exit 1
fi

echo "============================================"
echo "  智造管家 API 压测"
echo "============================================"
echo "  目标:     ${BASE_URL}"
echo "  并发数:   ${CONCURRENCY}"
echo "  持续时间: ${DURATION}s"
echo "============================================"
echo ""

# ─── 创建 POST body 临时文件 ──────────────────
AI_BODY=$(mktemp)
echo '{"message":"今天的库存情况怎么样？"}' > "$AI_BODY"

# 清理函数
cleanup() { rm -f "$AI_BODY"; }
trap cleanup EXIT

# ─── wrk Lua 脚本（注入 Header） ──────────────
WRK_SCRIPT=$(mktemp)
cat > "$WRK_SCRIPT" <<'LUA'
wrk.method = "GET"
wrk.headers["Authorization"] = "Bearer __TOKEN__"
wrk.headers["Content-Type"] = "application/json"
LUA
sed -i.bak "s|__TOKEN__|${JWT_TOKEN}|g" "$WRK_SCRIPT" 2>/dev/null || \
  sed -i '' "s|__TOKEN__|${JWT_TOKEN}|g" "$WRK_SCRIPT"
rm -f "${WRK_SCRIPT}.bak"

WRK_POST_SCRIPT=$(mktemp)
cat > "$WRK_POST_SCRIPT" <<LUA
wrk.method = "POST"
wrk.headers["Authorization"] = "Bearer ${JWT_TOKEN}"
wrk.headers["Content-Type"] = "application/json"
wrk.body = '{"message":"今天的库存情况怎么样？"}'
LUA

# ─── 执行压测 ──────────────────────────────────
run_test() {
  local name="$1"
  local url="$2"
  local script="$3"

  echo "────────────────────────────────────────"
  echo "▶ ${name}"
  echo "  URL: ${url}"
  echo ""

  wrk -t4 -c"${CONCURRENCY}" -d"${DURATION}s" \
      --latency \
      -s "$script" \
      "${url}" 2>&1

  echo ""
}

# 1. 驾驶舱 KPI
run_test "驾驶舱 KPI (GET)" \
  "${BASE_URL}/api/analytics/dashboard-kpi" \
  "$WRK_SCRIPT"

# 2. 库存列表
run_test "库存列表 (GET)" \
  "${BASE_URL}/api/inventory?page=1&pageSize=20" \
  "$WRK_SCRIPT"

# 3. 生产工单
run_test "生产工单 (GET)" \
  "${BASE_URL}/api/production/orders?status=in_progress" \
  "$WRK_SCRIPT"

# 4. AI 对话（POST）
run_test "AI 对话 (POST)" \
  "${BASE_URL}/api/ai/chat" \
  "$WRK_POST_SCRIPT"

# ─── 清理临时脚本 ─────────────────────────────
rm -f "$WRK_SCRIPT" "$WRK_POST_SCRIPT"

echo "============================================"
echo "  压测完成！请关注 P95 Latency < 2000ms"
echo "============================================"
