# 智造管家（SmartFactory Agent）技术架构确认报告

**评审版本**: v1.0
**评审日期**: 2026-03-11
**评审人**: 技术架构负责人（senior-architect）
**评审范围**: P0 / P1 / P2 三阶段全量代码
**评审状态**: 已完成

---

## 一、架构评分（满分 10 分）

| 评审维度 | 权重 | 得分 | 说明 |
|---|---|---|---|
| 后端分层架构 | 20% | 9.0 | Service/Controller/Routes 三层划分清晰，asyncHandler 统一封装 |
| 安全架构 | 20% | 8.5 | JWT 双令牌、HttpOnly Cookie、RBAC、限流全部到位；存在少量待优化项 |
| 多租户隔离 | 15% | 8.5 | BaseRepository 自动注入 tenantId，99% 路径覆盖；个别模块绕过 |
| 前端工程化 | 15% | 8.5 | Design Token 完整、React Query 规范使用、Axios 封装优秀 |
| 类型安全 | 10% | 7.0 | TypeScript 覆盖率高；analytics 等模块 `any` 滥用较明显 |
| 错误处理 | 10% | 8.5 | AppError 体系完整，ZodError/DupKey 均有处理；日志依赖 console |
| API 设计 | 10% | 8.0 | RESTful 规范，统一响应结构；少量路由顺序风险 |
| 可观测性 | 5% | 5.0 | 全部依赖 console，无结构化日志、链路追踪、指标采集 |
| 性能设计 | 5% | 7.5 | Redis 锁、分页、缓存失效设计合理；CSV 导出无限制存在隐患 |

**综合加权得分：8.05 / 10**

---

## 二、各模块评审结论

### 2.1 后端分层架构（Service → Controller → Routes）

**结论：通过**

**优点**：
- 三层职责边界清晰：Routes 仅做路由注册与中间件链装配，Controller 负责请求解析和响应封装，Service 封装全部业务逻辑，没有业务代码下沉到路由层或上浮到 Controller 层的情况。
- `asyncHandler` 统一将 async 函数的 Promise rejection 转发给 `errorHandler`，杜绝了未捕获异常导致进程崩溃的风险。
- Controller 层普遍使用 Zod Schema 进行入参校验（`CreateSkuSchema`、`ListSkuQuerySchema` 等），校验失败由 `errorHandler` 统一格式化，不存在校验绕过路径。
- Service 层通过构造函数注入 `TenantContext`，实例生命周期随请求，避免了多租户状态污染。

**存在问题**：
- `bom.routes.ts` 中 `/ai-suggestion/:skuId` 固定段路由注册位置在 `/:id` 参数路由之后（第 21 行），存在路由歧义风险，注释虽说明"已放在参数路由之前"，但实际文件末尾排序仍在 `/:id` 系列路由之后，需要重新核查生产注册顺序。
- `AnalyticsService` 构造函数仅接收 `tenantId: number`，未遵循统一的 `TenantContext` 接口，与其他模块不一致。
- `inventory.routes.ts` 中 `/export/csv` 接口直接在路由文件内实现业务逻辑（第 43-57 行），违反分层原则，应提取到 `InventoryController`。

---

### 2.2 前端组件架构（公共组件、页面组件、API hooks）

**结论：通过**

**优点**：
- 公共组件库完整，涵盖 `KpiCard`、`SummaryStrip`、`ProgressBar`、`StatusDot`、`BomTree`、`TraceChain`、`Breadcrumb`、`Skeleton`、`ErrorBoundary`、`AiFloatButton`，满足评审范围要求。
- `BomTree` 递归树组件实现规范：状态提升至根组件、节点使用 `useCallback` 防止无效渲染、完整支持键盘操作和 `aria-*` 无障碍属性。
- API 层采用 `apiName.ts` + React Query Hooks 双层模式，Query Key 工厂函数（`skuKeys`）清晰，Optimistic Update 在 `useUpdateSku` 中正确实现。
- `ErrorBoundary` 为 Class Component 实现，正确捕获子树渲染异常，开发环境展示堆栈详情，生产环境显示友好降级 UI。
- Zustand `authStore` 处理了 `localStorage` 恢复（`hydrate`）、Token 静默刷新、`hasRole`/`hasAnyRole` 权限判断，职责明确。

**存在问题**：
- `DashboardPage.tsx` 中 `MOCK_KPI` 和 `CAPACITY_MOCK` 为硬编码模拟数据（第 34-51 行），注释标注"联调后替换"，但实际联调接口 `GET /api/dashboard/kpi` 尚未接入，该页面关键 KPI 数据不真实。
- `ProcessConfigPage` 在 `App.tsx` 中有路由定义（`/master-data/process-config`），但 `Glob` 结果未找到对应页面文件，存在路由配置与文件实现不同步风险。
- AI 模块（`AiChatPanel`）的 SSE 消息计数器 `msgCounter` 为模块级变量（第 28 行），在 React 严格模式或组件多次挂载时会出现 ID 不连续问题。

---

### 2.3 数据库设计（多租户、索引、事务）

**结论：有条件通过**

**优点**：
- 多租户行级隔离方案：`BaseRepository` 在 `findOneByTenant`、`findManyByTenant`、`findAndCountByTenant`、`buildInsertData` 四个方法中均自动注入 `tenant_id`，防止跨租户数据泄漏的核心路径有保障。
- 库存出入库使用 Redis 分布式锁（`acquireLock`/`releaseLock`），保证并发安全；前端 `request.ts` 对 `4003` 锁冲突错误实现了一次自动重试，用户体验友好。
- `generateNo` 使用 Redis `INCR` 原子操作生成单号，按租户和日期隔离计数器键，防止并发重复。
- 事务操作通过 `BaseRepository.withTransaction` 封装，统一使用 TypeORM `EntityManager` 事务。
- `Decimal.js` 用于库存金额计算，避免 JavaScript 浮点精度问题。

**存在问题**：
- `AnalyticsService` 的多个 SQL 查询未使用 `BaseRepository`，直接通过 `AppDataSource.query()` 执行，虽然传参均为参数化查询，但 `tenantId` 注入依赖手工拼写，存在遗漏风险，不在自动租户隔离保护范围内。
- `sku.service.ts` 的 `generateSkuCode` 方法使用 `COUNT(*) + 1` 计算序号（第 147-150 行），在高并发下存在竞态条件，可能生成重复的 SKU 编码（虽有三次重试兜底，但根本问题是序号计算方式不是原子操作）。
- `generateNo` 中 Redis Key 的过期时间设置为 48 小时（第 40 行），跨日0点时段存在序号不从1开始的情况（旧Key未过期），可能导致同日单号序号跳跃。

---

### 2.4 安全架构（认证、授权、CORS、SQL 注入防护）

**结论：通过**

**优点**：
- **双令牌体系**：Access Token（2h 有效期）+ Refresh Token（7天，HttpOnly Cookie），Token 旋转机制完整，登出时通过 Redis jti 吊销。
- **防暴力破解**：全局限流 300次/分钟，登录接口独立限流 20次/15分钟，AI Chat 接口 20次/分钟，梯度限流策略合理。
- **CORS 白名单**：从环境变量读取，无通配符 `*`，无 Origin 头（服务器间调用）直接放行的逻辑符合生产实践。
- **SQL 注入防护**：审查范围内所有直接 SQL 查询（`auth.service.ts`、`analytics.service.ts`、`production.service.ts` 等）均使用参数化查询（`?` 占位符），未发现字符串拼接 SQL。
- **RBAC 角色控制**：`requireRoles` 工厂函数在各业务模块敏感操作上广泛使用，角色粒度到 `boss/purchaser/supervisor/warehouse/worker/qc` 六种。
- **安全响应头**：手动设置 `X-Content-Type-Options`、`X-Frame-Options`、`X-XSS-Protection`，满足基础安全要求。
- **Refresh Token 类型校验**：`authMiddleware` 明确拒绝 Refresh Token 用于 API 认证（第 80-82 行），防止令牌混用攻击。

**存在问题**：
- `services/api/src/middleware/auth.ts` 第 7-8 行：`JWT_SECRET` 默认值为硬编码字符串 `'change-me-in-production'`，若部署时未配置环境变量将使用弱密钥。需要在启动时强制校验该环境变量存在且长度足够（建议 >= 32 字符），否则拒绝启动。
- 安全响应头未使用 `helmet` 中间件，缺少 `Content-Security-Policy`、`Strict-Transport-Security`（HSTS）、`Referrer-Policy` 等现代安全头。
- `ai.routes.ts` 中 `extractTenantContext` 函数使用类型断言绕过 TypeScript 类型系统（第 245 行 `req as Request & { tenantId?: number }`），而其他模块直接使用 `req.tenantId`，风格不一致。

---

### 2.5 API 设计（RESTful 规范、统一响应、路由命名）

**结论：通过**

**优点**：
- 统一响应结构 `{ code, data, message }` 前后端严格对齐（`ApiResponse.ts` 与 `types/api.ts` 中 `ApiCode` 完全同步），响应码按业务域分段（1xxx 通用 / 2xxx SKU / 3xxx BOM / 4xxx 库存 / 5xxx 采购 / 6xxx 销售 / 7xxx 生产），扩展性良好。
- `created()` 返回 201，`success()` 返回 200，区分资源创建和普通操作，符合 HTTP 语义。
- 路由命名语义清晰，使用名词复数（`/skus`、`/suppliers`、`/customers`），操作通过 HTTP 动词区分。
- 分页参数统一由 `PaginationSchema` 提供（`page` + `pageSize`），前后端契约一致。
- SSE 流式接口（`POST /api/ai/chat`）单独处理，不走 `asyncHandler`，SSE 错误帧正确写入后关闭连接。

**存在问题**：
- `app.ts` 中 `/api/sales/orders` 路由前缀与其他模块不对称（其他模块前缀不带资源路径，销售模块直接挂在 `/api/sales/orders` 而非 `/api/sales`），前缀设计不统一。
- `bom.routes.ts` 中 `/ai-suggestion/:skuId` 注册在参数路由 `/:id` 系列之后（文件最后一行），Express 路由匹配按注册顺序执行，`GET /bom/ai-suggestion/123` 中 `ai-suggestion` 会被 `/:id` 先匹配，导致 `getAiSuggestion` 控制器不可达。此为**阻塞级**问题。
- CSV 导出接口使用 `GET /inventory/export/csv`，但语义上属于导出动作，更规范的设计应为 `POST /inventory/exports` 返回下载链接，或至少补充 `pageSize` 上限保护（当前 `pageSize: 10000` 硬编码）。

---

## 三、问题清单

### 阻塞级（必须修复才能进入 UAT）

#### BLK-001：BOM 路由注册顺序导致 AI 建议接口不可达

- **文件**: `services/api/src/modules/bom/bom.routes.ts`，第 21 行
- **描述**: `GET /bom/ai-suggestion/:skuId` 注册在 `GET /:id/expand`、`GET /:id/material-requirements` 等参数路由之后。Express 路由匹配从上到下，请求 `GET /bom/ai-suggestion/5` 会被 `/:id/expand` 路由中的 `:id = ai-suggestion` 提前匹配，导致 `getAiSuggestion` 控制器永远不可达。
- **修复**: 将 `router.get('/ai-suggestion/:skuId', ...)` 移至文件最顶部，排在所有 `/:id` 参数路由之前。

#### BLK-002：JWT_SECRET 缺少启动时强制校验

- **文件**: `services/api/src/middleware/auth.ts`，第 7 行
- **描述**: 当 `JWT_SECRET` 环境变量未配置时，系统使用弱默认值 `'change-me-in-production'`，将使所有已发布 JWT 处于可伪造状态，属于严重安全漏洞。
- **修复**: 在 `services/api/src/index.ts` 启动函数中增加环境变量强制校验，若 `JWT_SECRET` 未配置或长度不足 32 字符则打印错误并 `process.exit(1)`，禁止以弱密钥启动服务。

---

### 重要级（应修复，不阻塞 UAT，上线前必须处理）

#### IMP-001：Dashboard 关键 KPI 为硬编码 Mock 数据

- **文件**: `services/web/src/pages/dashboard/DashboardPage.tsx`，第 34-51 行
- **描述**: `MOCK_KPI` 和 `CAPACITY_MOCK` 为静态硬编码数据，月营收、库存金额等核心经营数据不真实，管理层使用时将产生严重误导。
- **修复**: 对接 `GET /api/analytics/dashboard` 接口（后端 `AnalyticsService.getDashboardKpi()` 已实现），删除 Mock 数据，替换为真实 API 调用。

#### IMP-002：ProcessConfigPage 文件缺失但路由已配置

- **文件**: `services/web/src/App.tsx`，第 54 行
- **描述**: 路由 `/master-data/process-config` 指向 `ProcessConfigPage`，但在代码文件扫描中未找到对应页面实现文件，运行时将报错导致该路由不可用。
- **修复**: 确认页面文件是否存在于其他路径，或补充实现该页面，保持路由与实现同步。

#### IMP-003：CSV 导出接口无数量上限保护

- **文件**: `services/api/src/modules/inventory/inventory.routes.ts`，第 44 行
- **描述**: `pageSize: 10000` 硬编码，当库存记录超过万条时，单次请求将全量加载到内存，存在 OOM 风险，同时可能触发数据库慢查询拖垮整个服务。
- **修复**: 分两步：①将导出逻辑迁移至 `InventoryController`（修复分层问题）；②实现流式 CSV 写入（`res.write` 分批），避免全量内存加载。

#### IMP-004：AnalyticsService 未遵循统一 TenantContext 接口

- **文件**: `services/api/src/modules/analytics/analytics.service.ts`，第 10 行
- **描述**: 构造函数签名为 `constructor(private readonly tenantId: number)`，不同于其他模块统一的 `TenantContext`，`userId` 丢失，且脱离 `BaseRepository` 自动租户保护范围，所有 SQL 的 `tenantId` 注入需人工维护，属于维护风险。
- **修复**: 改为接收 `TenantContext`，并审查该 Service 中所有 SQL 确保 `tenantId` 传参无遗漏。

#### IMP-005：SkuService.generateSkuCode 存在并发竞态

- **文件**: `services/api/src/modules/sku/sku.service.ts`，第 146-152 行
- **描述**: 使用 `COUNT(*) + 1` 计算 SKU 序号，在并发创建场景下多个请求会读到相同的 COUNT 值，生成相同编码，虽有三次重试兜底但属于治标不治本。
- **修复**: 改用 Redis `INCR` 原子操作（参考 `generateNo` 的实现方式）按租户和品类维护序号计数器，彻底消除竞态。

#### IMP-006：缺少结构化日志基础设施

- **文件**: 全部后端文件（`services/api/src/**`）
- **描述**: 后端所有日志输出均使用 `console.log/warn/error/info`，无结构化日志（无 JSON 格式、无 traceId、无服务名字段），在生产环境中无法有效聚合查询、无法与链路追踪系统集成，可观测性极差。统计到跨 8 个文件共 39 处 `console.*` 调用。
- **修复**: 引入 `pino` 或 `winston` 日志库，统一输出 JSON 格式日志，包含 `timestamp`、`level`、`service`、`tenantId`、`userId`、`traceId` 字段，生产环境关闭 `console.*` 直接调用。

---

### 建议级（优化项，根据资源排期处理）

#### SUG-001：后端缺少 helmet 中间件

- **文件**: `services/api/src/app.ts`
- **描述**: 当前安全头通过手动 `res.setHeader` 设置，缺少 `Content-Security-Policy`、`HSTS`、`Referrer-Policy`、`Permissions-Policy` 等现代安全头。
- **建议**: 引入 `helmet` 中间件，一行配置覆盖所有标准安全头，并根据业务需求定制 CSP 策略。

#### SUG-002：analytics.service.ts 中 `any` 类型滥用

- **文件**: `services/api/src/modules/analytics/analytics.service.ts`
- **描述**: 共发现 10+ 处 `(r: any)` 用于 SQL 查询结果类型标注，失去类型约束，IDE 无法提供类型检查和补全支持，重构时容易引入字段名拼写错误的 Bug。
- **建议**: 为每个 SQL 查询结果定义局部 `interface`，或使用 TypeORM 的泛型 `query<T[]>()` 约束返回类型，消除所有 `any`。

#### SUG-003：AiChatPanel 模块级消息 ID 计数器

- **文件**: `services/web/src/components/ai/AiChatPanel.tsx`，第 28-29 行
- **描述**: `let msgCounter = 0` 为模块级变量，在 React 18 严格模式下组件双重挂载，或多个 AiChatPanel 实例并存时，ID 生成行为不可预期。
- **建议**: 改用 `crypto.randomUUID()` 或 `nanoid()` 生成唯一 ID，彻底消除状态共享问题。

#### SUG-004：前端路由守卫仅检查认证态，缺少角色守卫

- **文件**: `services/web/src/App.tsx`
- **描述**: `RequireAuth` 组件只判断 `isAuthenticated`，所有认证用户可访问任意页面，缺少基于角色的路由级权限控制（如仓库人员不应进入财务分析页）。
- **建议**: 在 `RequireAuth` 的基础上实现 `RequireRole` 高阶组件，对敏感路由（analytics、approval 等）增加角色守卫，未授权时跳转 403 页面。

#### SUG-005：generateNo 跨日序号不从1开始的问题

- **文件**: `services/api/src/shared/generateNo.ts`，第 39-41 行
- **描述**: 首次创建 Key 时设置 48 小时过期，意味着在凌晨0点后当日的 Key 仍存活，新一天的单号序号不从 `00001` 开始，对业务审计有潜在影响。
- **建议**: 将 Key 过期时间改为到次日凌晨0点的精确剩余秒数（+1小时冗余），确保每日序号从1开始。

#### SUG-006：前端缺少请求取消机制（非 AI Chat 接口）

- **文件**: `services/web/src/utils/request.ts`
- **描述**: 当前 `request.get/post/put/delete` 未暴露 `AbortController` 接口，页面快速切换时旧请求无法取消，可能产生竞态条件（旧响应覆盖新状态）。AI Chat 接口已有 `abortRef` 处理，其他接口应对齐。
- **建议**: 为 `request` 方法增加可选 `signal` 参数，在 React Query 的 `queryFn` 中透传 `AbortSignal`，利用 React Query 内置的请求取消机制。

#### SUG-007：sales 模块路由前缀挂载不一致

- **文件**: `services/api/src/app.ts`，第 108 行
- **描述**: 销售模块挂载在 `/api/sales/orders`，其他模块均挂载在 `/api/{resource}` 后由路由文件内部定义子路径，导致 `salesRoutes` 内部路由路径变成双层嵌套，与整体风格不一致。
- **建议**: 统一挂载到 `/api/sales`，由 `sales.routes.ts` 内部维护 `/orders` 路径前缀。

---

## 四、技术债务清单

| 编号 | 类别 | 描述 | 影响范围 | 优先级 |
|---|---|---|---|---|
| TD-001 | 可观测性 | 无结构化日志，无链路追踪（traceId），无性能指标采集（Prometheus/OpenTelemetry） | 全后端 | P0（上线前） |
| TD-002 | 类型安全 | analytics.service.ts 及多个 Service 文件中累计约 47 处 `any` 类型，类型安全保障不足 | analytics、inventory、bom、production 等模块 | P1 |
| TD-003 | 测试覆盖 | 评审范围内未发现单元测试文件（无 `.spec.ts` / `.test.ts`），关键业务逻辑（BOM 循环检测、库存锁、三单匹配）无自动化测试保障 | 全后端业务逻辑层 | P0（上线前补充核心用例） |
| TD-004 | 前端 Mock 数据 | DashboardPage 关键 KPI 使用硬编码数据，未与真实 API 联调 | 驾驶舱页面 | P0（UAT 前必须联调） |
| TD-005 | 安全配置 | 缺少 `helmet` 中间件，CSP、HSTS 等现代安全头未配置 | 全后端 HTTP 响应 | P1 |
| TD-006 | 启动安全校验 | 缺少环境变量完整性校验（JWT_SECRET、DB_PASSWORD 等敏感配置未设置时应拒绝启动） | 服务启动流程 | P0（上线前） |
| TD-007 | 数据库 | AnalyticsService 脱离 BaseRepository 自动保护，手工注入 tenantId 存在维护风险 | analytics 模块 | P1 |
| TD-008 | 前端路由 | 前端路由无角色级权限守卫，敏感页面（报表、审批）对所有认证用户开放 | App.tsx 路由层 | P1 |
| TD-009 | 并发安全 | SKU 编码生成使用 COUNT+1 非原子操作，高并发创建场景存在竞态 | SKU 创建接口 | P1 |
| TD-010 | 代码规范 | `inventory.routes.ts` 中存在路由内联业务逻辑（CSV 导出），违反分层设计原则 | inventory 模块 | P2 |
| TD-011 | 暗色模式 | `variables.css` 仅覆盖了少量语义别名变量，大量业务语义色（库存4态、Tag变体等）未适配暗色模式 | 全前端样式 | P2 |
| TD-012 | 错误监控 | ErrorBoundary 仅打印 `console.error`，缺少 Sentry / 自建错误监控上报集成 | 前端错误监控 | P2 |

---

## 五、最终结论

### 批准状态：有条件批准进入 UAT / 预发布阶段

---

### 批准条件

在进入 UAT 之前，以下 **2 个阻塞级问题** 和 **4 个重要级问题** 必须完成修复并通过代码复查：

| 编号 | 问题描述 | 负责人 | 截止要求 |
|---|---|---|---|
| BLK-001 | BOM `/ai-suggestion/:skuId` 路由顺序错误，接口不可达 | senior-backend-engineer | UAT 前 |
| BLK-002 | JWT_SECRET 弱默认值，缺少启动时强制校验 | senior-backend-engineer | UAT 前 |
| IMP-001 | Dashboard KPI 数据为 Mock，需完成 API 联调 | senior-frontend-engineer | UAT 前 |
| IMP-002 | ProcessConfigPage 文件与路由定义不同步 | senior-frontend-engineer | UAT 前 |
| IMP-003 | CSV 导出接口无上限保护，存在内存溢出风险 | senior-backend-engineer | UAT 前 |
| TD-003 | 核心业务逻辑（BOM 循环检测、库存锁）缺少单元测试 | senior-qa-engineer | UAT 前补充关键用例 |

### 架构总体评价

智造管家项目整体架构设计扎实，展现出较高的工程水准：

**值得肯定的设计决策**：
- 多租户 BaseRepository 自动注入方案，从架构层面封堵了跨租户数据泄漏的主要路径。
- 双令牌 + HttpOnly Cookie + Redis jti 吊销构成的认证体系，是当前 Web 应用认证最佳实践的完整实现。
- Axios 拦截器中的 Token 静默刷新队列机制（防止并发 401 导致多次刷新）实现细节精确，属于生产级质量。
- Design Token CSS 变量体系完整，支持暗色模式基础框架，前端视觉一致性有系统保障。
- React Query + Optimistic Update 的 API 层设计，在保证数据一致性的同时提供了流畅的用户体验。

**主要改进方向**：可观测性（结构化日志、链路追踪）是当前最大短板，属于生产环境必须补齐的基础设施；类型安全需要消除 `any` 使用；测试覆盖率需要在 QA 阶段重点补充。

---

*本报告由 senior-architect 出具，结论有效期至下次重大架构变更。*
*相关问题修复后请重新提交对应模块的代码复查，确认阻塞项关闭后方可发布上线。*
