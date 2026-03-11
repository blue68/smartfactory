# 智造管家 生产环境冒烟测试指南

版本：v1.0 | 更新日期：2026-03-11

---

## 目录

1. [什么是冒烟测试](#1-什么是冒烟测试)
2. [何时执行](#2-何时执行)
3. [前置条件](#3-前置条件)
4. [测试账号配置](#4-测试账号配置)
5. [如何运行](#5-如何运行)
6. [检查项说明](#6-检查项说明)
7. [预期结果](#7-预期结果)
8. [失败排查指南](#8-失败排查指南)
9. [CI/CD 集成](#9-cicd-集成)

---

## 1. 什么是冒烟测试

冒烟测试（Smoke Test）是部署或升级后执行的快速验证测试，目标是在最短时间内确认系统核心链路可用，而非验证全部业务逻辑。

本脚本覆盖以下五个维度：

| 维度 | 检查项数 | 说明 |
|------|----------|------|
| 基础设施 | 2 | 健康检查端点、前端页面可访问 |
| 认证流程 | 4 | 登录、有效 Token、无 Token、伪造 Token |
| 核心业务 | 8 | SKU / 库存 / 销售 / 生产 / 采购 / 质检列表接口 |
| AI 模块 | 2 | SSE 流式对话、主动建议列表 |
| 安全响应头 | 5 | CSP / HSTS / X-Content-Type / X-Frame / Referrer |

**总计：21 个检查项，正常完成约需 30–60 秒。**

---

## 2. 何时执行

以下场景必须在上线前执行冒烟测试并确认全部通过：

| 触发场景 | 执行时机 | 负责人 |
|----------|----------|--------|
| 首次部署 | `docker compose up -d` 完成，容器全部 healthy 后 | 运维 |
| 版本升级 | `docker compose up -d` 完成，容器重启后 | 运维 + QA |
| 配置变更 | 修改 `.env` 并重启相关容器后 | 运维 |
| 数据库恢复 | 备份恢复完成后 | DBA + QA |
| 定期巡检 | 每天 08:00（可配置为定时任务） | 运维 |
| 灾难恢复演练 | 演练流程结束后 | SRE |

---

## 3. 前置条件

### 3.1 系统环境

- 所有 Docker 容器状态均为 `healthy`：

```bash
docker compose ps
# 期望输出：mysql、redis、api、web 全部显示 (healthy)
```

- 服务器网络可正常访问目标 `BASE_URL`
- 执行机器上已安装 `curl`（版本 7.58+）

### 3.2 可选依赖（用于 Token 解析）

脚本会优先使用 `python3` 或 `jq` 解析登录响应中的 Access Token。建议至少安装其中之一：

```bash
# 检查
python3 --version
jq --version
```

若两者均未安装，认证流程会打印警告，后续需要鉴权的接口测试项将被跳过（计为 SKIP，不影响退出码）。

---

## 4. 测试账号配置

脚本使用专用冒烟测试账号，默认为：

| 项目 | 默认值 |
|------|--------|
| 用户名 | `smoke_tester` |
| 密码 | `SmokeTest@2026` |

**重要：该账号必须在数据库中预先创建，角色建议设为 `boss`（拥有最广权限，确保各模块列表接口可访问）。**

### 创建账号示例（执行一次即可）

```bash
# 进入 MySQL 容器
docker exec -it sf_mysql mysql -u root -p"${DB_ROOT_PASSWORD}" smart_factory

# 在 MySQL 中执行（密码哈希请替换为实际 bcrypt 值）
INSERT INTO users (username, password_hash, role, tenant_id, is_active)
VALUES (
  'smoke_tester',
  '$2b$10$xxxYourBcryptHashHerexxx',   -- 对 SmokeTest@2026 执行 bcrypt hash
  'boss',
  1,
  1
);
```

使用 Node.js 生成密码哈希：

```bash
docker exec sf_api node -e "
const bcrypt = require('bcryptjs');
bcrypt.hash('SmokeTest@2026', 10).then(h => console.log(h));
"
```

### 覆盖默认账号（生产环境推荐）

通过环境变量覆盖，避免明文密码出现在命令行历史：

```bash
export SMOKE_USERNAME=my_smoke_user
export SMOKE_PASSWORD=MySecurePassword@123
./scripts/smoke-test.sh http://prod.example.com
```

---

## 5. 如何运行

### 5.1 首次设置

```bash
# 授予执行权限（仅需一次）
chmod +x scripts/smoke-test.sh
```

### 5.2 基础用法

```bash
# 测试本地部署（默认 http://localhost）
./scripts/smoke-test.sh

# 指定目标地址
./scripts/smoke-test.sh http://192.168.1.100

# 指定 HTTPS 地址
./scripts/smoke-test.sh https://factory.example.com

# 显示详细输出（含响应体，适合排查问题）
./scripts/smoke-test.sh http://192.168.1.100 --verbose

# 通过环境变量设置地址
BASE_URL=http://192.168.1.100 ./scripts/smoke-test.sh
```

### 5.3 典型输出示例

正常通过时：

```
================================================================
  智造管家 生产环境冒烟测试
================================================================
  目标地址  : http://localhost
  测试账号  : smoke_tester
  开始时间  : 2026-03-11 10:00:00
  Verbose   : false

━━━ 1. 基础设施检查 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [1.1] GET /health — API 健康检查
  PASS /health 应返回 200 (HTTP 200)

  [1.2] GET / — Nginx 前端页面
  PASS / 前端页面应返回 200 (HTTP 200)

━━━ 2. 认证流程检查 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [2.1] POST /api/auth/login — 账号密码登录
  PASS POST /api/auth/login 应返回 200 (HTTP 200)
  ...

================================================================
  测试汇总
================================================================
  结束时间  : 2026-03-11 10:00:45
  目标地址  : http://localhost
  总检查项  : 21
  PASS      : 21
  FAIL      : 0
  SKIP      : 0

  结论：所有检查项通过，系统基础链路正常。
```

### 5.4 退出码

| 退出码 | 含义 |
|--------|------|
| `0` | 全部通过（或有 SKIP 但无 FAIL） |
| `1` | 存在 FAIL 项，禁止上线 |

---

## 6. 检查项说明

### 6.1 基础设施检查

| 编号 | 接口 | 方法 | 预期 | 说明 |
|------|------|------|------|------|
| 1.1 | `/health` | GET | 200 | API 容器健康，数据库连接正常 |
| 1.2 | `/` | GET | 200 | Nginx 正常提供前端静态文件 |

### 6.2 认证流程检查

| 编号 | 接口 | 方法 | 预期 | 说明 |
|------|------|------|------|------|
| 2.1 | `/api/auth/login` | POST | 200 | 正常账号密码登录，应返回 Token |
| 2.2 | `/api/skus` | GET | 200 | 携带有效 Token，应正常访问 |
| 2.3 | `/api/skus` | GET | 401 | 不携带 Token，应被鉴权中间件拦截 |
| 2.4 | `/api/skus` | GET | 401 | 携带伪造 Token，应验证失败 |

### 6.3 核心业务冒烟

所有接口均需携带有效 Token，仅验证返回 200，不验证数据内容。

| 编号 | 接口 | 方法 | 预期 | 业务模块 |
|------|------|------|------|----------|
| 3.1 | `/api/skus` | GET | 200 | SKU 商品列表 |
| 3.2 | `/api/skus/categories` | GET | 200 | SKU 分类 |
| 3.3 | `/api/inventory` | GET | 200 | 库存列表 |
| 3.4 | `/api/sales` | GET | 200 | 销售订单列表 |
| 3.5 | `/api/production/orders` | GET | 200 | 生产工单列表 |
| 3.6 | `/api/purchase/suggestions` | GET | 200 | 采购建议列表 |
| 3.7 | `/api/purchase/orders` | GET | 200 | 采购订单列表 |
| 3.8 | `/api/quality/inspections` | GET | 200 | 质检记录列表 |

### 6.4 AI 模块冒烟

| 编号 | 接口 | 方法 | 预期 | 说明 |
|------|------|------|------|------|
| 4.1 | `/api/ai/chat` | POST | SSE | Content-Type 应为 `text/event-stream`，脚本等待 5 秒后主动断开 |
| 4.2 | `/api/ai/suggestions` | GET | 200 | AI 主动建议列表 |

### 6.5 安全响应头检查

| 编号 | 响应头 | 必要原因 |
|------|--------|----------|
| 5.1 | `Content-Security-Policy` | 防 XSS 内容注入 |
| 5.2 | `Strict-Transport-Security` | 强制 HTTPS，防降级攻击 |
| 5.3 | `X-Content-Type-Options` | 防 MIME 嗅探 |
| 5.4 | `X-Frame-Options` | 防点击劫持 |
| 5.5 | `Referrer-Policy` | 控制 Referer 信息泄露 |

---

## 7. 预期结果

### 正常状态

- 所有 21 项检查均显示 `PASS`
- 退出码为 `0`
- 总耗时在 30–60 秒内

### 可接受的 SKIP

若测试账号尚未创建，认证后的 13 项测试会显示 `SKIP`。
此时需创建账号后重新执行，上线前不允许存在 SKIP。

### 不可接受的 FAIL

任何 `FAIL` 项均代表生产环境存在问题，**禁止发布，必须排查修复后重新执行**。

---

## 8. 失败排查指南

### FAIL 1.1 — GET /health 返回非 200

**可能原因及处理方式：**

```bash
# 检查所有容器状态
docker compose ps

# 查看 API 容器日志
docker compose logs --tail=50 api

# 常见原因 1：MySQL 未就绪，API 启动失败
docker compose logs --tail=30 mysql

# 常见原因 2：端口冲突，健康检查 URL 不可达
curl -v http://localhost/health
```

### FAIL 1.2 — GET / 返回非 200

```bash
# 查看 Nginx 日志
docker compose logs --tail=50 web
docker exec sf_web cat /var/log/nginx/error.log

# 检查 80 端口占用
# （macOS）
lsof -i :80
# （Linux）
ss -tlnp | grep :80
```

### FAIL 2.1 — 登录返回非 200

```bash
# 手动测试登录接口
curl -v -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"smoke_tester","password":"SmokeTest@2026"}'

# 检查 API 日志中是否有认证错误
docker compose logs --tail=50 api | grep -i "auth\|login\|error"

# 确认测试账号存在
docker exec -it sf_mysql mysql -u root -p"${DB_ROOT_PASSWORD}" smart_factory \
  -e "SELECT id, username, role, is_active FROM users WHERE username='smoke_tester';"
```

### FAIL 2.2 — 有效 Token 返回非 200

```bash
# 先手动获取 Token
TOKEN=$(curl -s -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"smoke_tester","password":"SmokeTest@2026"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data'].get('token',''))")

# 带 Token 访问接口并查看详情
curl -v -H "Authorization: Bearer $TOKEN" http://localhost/api/skus
```

### FAIL 2.3 / 2.4 — 无 Token / 伪造 Token 未返回 401

此情况意味着鉴权中间件失效，是严重安全问题：

```bash
# 检查 authMiddleware 是否正确挂载
docker compose logs --tail=100 api | grep -i middleware

# 查看 API 构建版本
docker exec sf_api node -e "const p = require('./package.json'); console.log(p.version)"
```

立即通知 @senior-backend-engineer 和安全团队。

### FAIL 3.x — 业务接口返回非 200

```bash
# 以 /api/inventory 为例，手动排查
curl -v -H "Authorization: Bearer $TOKEN" http://localhost/api/inventory

# 常见原因 1：数据库查询失败
docker compose logs --tail=50 api | grep -i "error\|database\|mysql"

# 常见原因 2：Redis 会话丢失
docker exec sf_redis redis-cli -a "${REDIS_PASSWORD}" ping

# 常见原因 3：接口路由未注册（升级后代码未生效）
docker compose restart api
```

### FAIL 4.1 — AI Chat 非 SSE 响应

```bash
# 手动测试 SSE 接口（观察流式输出）
curl -v -N \
  -X POST http://localhost/api/ai/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"message":"测试"}' \
  --max-time 10

# 检查 AI 引擎是否可达
docker exec sf_api env | grep AI_ENGINE_URL
docker compose logs --tail=50 api | grep -i "ai\|openai\|stream"
```

### FAIL 5.x — 安全响应头缺失

安全响应头由 Nginx 配置注入，缺失说明 Nginx 配置未正确应用：

```bash
# 查看当前响应头
curl -I http://localhost/

# 检查 Nginx 配置
docker exec sf_web cat /etc/nginx/conf.d/default.conf | grep -A5 "add_header"

# 重新加载 Nginx 配置
docker exec sf_web nginx -t          # 测试配置语法
docker exec sf_web nginx -s reload   # 热重载（不中断服务）
```

联系 @senior-frontend-engineer 确认 `services/web/nginx.conf` 中安全头配置是否完整。

---

## 9. CI/CD 集成

### GitHub Actions 示例

在部署 Job 后追加冒烟测试步骤：

```yaml
- name: Run smoke tests
  env:
    BASE_URL: ${{ secrets.PROD_BASE_URL }}
    SMOKE_USERNAME: ${{ secrets.SMOKE_USERNAME }}
    SMOKE_PASSWORD: ${{ secrets.SMOKE_PASSWORD }}
  run: |
    chmod +x scripts/smoke-test.sh
    ./scripts/smoke-test.sh "$BASE_URL"
```

### 定时巡检（crontab）

每天 08:00 自动执行冒烟测试，结果写入日志：

```bash
crontab -e
# 添加以下行：
0 8 * * * cd /path/to/smart-factory-agent && \
  SMOKE_USERNAME=smoke_tester SMOKE_PASSWORD=SmokeTest@2026 \
  ./scripts/smoke-test.sh http://localhost \
  >> logs/smoke-test-$(date +\%Y\%m\%d).log 2>&1
```

### 告警集成

脚本退出码为 `1` 时触发告警通知：

```bash
#!/bin/bash
./scripts/smoke-test.sh http://prod.example.com
if [ $? -ne 0 ]; then
  # 发送钉钉 / 企业微信 / Slack 通知
  curl -s -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d '{"text": "[警告] 生产环境冒烟测试失败，请立即排查！"}'
fi
```

---

如有疑问请联系：
- 测试相关：@senior-qa-engineer
- 接口问题：@senior-backend-engineer
- 部署问题：运维团队
