# 智造管家 SmartFactory

智造管家是面向中小型制造企业的多租户生产经营系统，覆盖从销售接单、主数据、BOM、采购、来料质检、仓储库存、生产排程、工单执行、质量追溯、报表分析、结算到 AI 辅助决策的端到端业务链路。工程采用 Web 管理端、Node.js API 服务、MySQL、Redis、微信小程序端的组合形态，既支持私有化单工厂部署，也保留 SaaS 多租户与平台级管理能力。

本文档用于让新人快速理解工程、完成本地启动、部署、登录和模块操作。

## 目录

- [业务定位](#业务定位)
- [工程结构](#工程结构)
- [系统架构](#系统架构)
- [数据流向](#数据流向)
- [核心模块分析](#核心模块分析)
- [角色权限拆解](#角色权限拆解)
- [快速启动](#快速启动)
- [环境变量](#环境变量)
- [数据库与初始化数据](#数据库与初始化数据)
- [Web 端操作说明](#web-端操作说明)
- [小程序操作说明](#小程序操作说明)
- [测试与质量检查](#测试与质量检查)
- [部署与运维](#部署与运维)
- [开发规范](#开发规范)
- [常见问题](#常见问题)

## 业务定位

系统围绕“家具/软体制造工厂”的实际管理场景设计，核心目标是把订单、物料、库存、生产、质检、结算和经营分析统一到一套数据闭环中。

典型业务闭环：

1. 销售录入客户和销售订单。
2. 系统基于 SKU、BOM、库存、采购周期和产能进行约束检查。
3. 主管或老板审批订单，生成生产订单或联合生产批次。
4. 生产计划模块生成排程和工单。
5. 仓库根据工单领料、投料、库存扣减；采购根据缺料建议创建采购订单。
6. 采购到货后进行来料检验、入库、三单匹配和结算。
7. 工人通过 Web 移动页或微信小程序执行开工、投料、报工、异常上报。
8. QC 记录质检结果和质量问题，形成追溯链。
9. 老板和主管通过驾驶舱、分析报表、库存报表、工资报表查看经营状态。
10. AI 模块提供采购建议、排产建议、问答分析和异常辅助判断。

系统支持多租户，核心业务表均带 `tenant_id`，登录时使用租户编码隔离数据。默认演示租户为 `FACTORY001`。

## 工程结构

```text
.
├── services/
│   ├── api/                 # Node.js + Express + TypeScript API 服务
│   ├── web/                 # React + Vite Web 管理端
│   └── mini/                # 原生微信小程序端
├── infra/
│   ├── db/                  # MySQL 初始化 SQL、局部修复 SQL、迁移辅助脚本
│   └── nginx/               # Web 容器 Nginx 配置，含 SPA fallback 与 /api 反代
├── docs/                    # PRD、架构、测试、部署、UI 原型等过程文档
├── scripts/                 # 部署、冒烟、数据修复、权限引导脚本
├── tests/                   # Playwright UI/E2E 测试
├── docker-compose.yml       # 本地/单机部署编排
├── docker-compose.prod.yml  # 生产覆盖配置
├── .env.example             # 根环境变量模板
└── AGENTS.md                # 多 Agent 协作与交付门禁规范
```

主要子工程：

| 子工程 | 技术栈 | 入口 | 职责 |
| --- | --- | --- | --- |
| `services/api` | Express、TypeScript、TypeORM、MySQL、Redis、BullMQ | `src/index.ts` | 鉴权、业务 API、库存锁、任务队列、SSE 通知、文件上传 |
| `services/web` | React 18、Vite、React Router、React Query、Zustand | `src/main.tsx` | Web 后台、管理台、报表、移动 Web 页面 |
| `services/mini` | 原生微信小程序 | `miniprogram/app.js` | 手机端任务、入库、QC、盘点操作 |
| `infra/db` | MySQL SQL | `init.sql` | 基础表、演示租户、演示数据、开发账号 |
| `infra/nginx` | Nginx | `default.conf` | 静态资源、API 反代、SSE、上传文件代理 |

## 系统架构

### 总体架构

```text
用户浏览器 / 微信小程序
        |
        | HTTPS / HTTP
        v
Web Nginx 容器
  - React 静态文件
  - SPA fallback
  - /api 反向代理
  - /uploads 认证代理
        |
        v
API Node.js 服务
  - Express REST API
  - JWT Access Token + HttpOnly Refresh Cookie
  - 权限快照、角色、菜单、按钮权限
  - 业务服务层
  - BullMQ Worker
  - SSE 通知流
        |
        +-------------------+
        |                   |
        v                   v
MySQL 8.0              Redis 7
  - 业务数据              - 分布式锁
  - 多租户隔离            - BullMQ 队列
  - 审计与流水            - Refresh Token 吊销
  - 库存快照              - 短期缓存
```

### Web 前端架构

Web 端位于 `services/web`。

关键目录：

```text
services/web/src/
├── api/             # API hooks 与 request 封装
├── components/      # 通用组件、布局、AI 浮层
├── constants/       # 菜单与操作权限编码
├── hooks/           # 权限、业务 hook
├── pages/           # 页面模块
├── stores/          # Zustand 全局状态
├── styles/          # 全局样式和 design token
├── types/           # 枚举和模型类型
└── utils/           # 格式化、二维码、导出、权限工具
```

核心机制：

- `React Router` 管理路由，`App.tsx` 中使用 `RequireAuth`、`RequireMenuAccess`、`RequireActionAccess` 做页面级守卫。
- `React Query` 管理服务端状态，统一缓存、刷新、失效和异步状态。
- `Zustand` 管理 UI 状态，如侧边栏、Toast、全局 loading、AI 面板。
- `request.ts` 封装 Axios，统一处理 JWT、401 刷新、业务错误、snake_case 到 camelCase 转换、库存锁冲突重试。
- `notification.ts` 通过应用级单例 SSE 流接收站内通知。
- Web 移动页面 `/m` 复用 Web 鉴权与 API，用于手机浏览器扫码、工单、仓库、QC 操作。

### API 后端架构

API 位于 `services/api`。

关键目录：

```text
services/api/src/
├── app.ts                 # Express app、中间件、路由挂载
├── index.ts               # 启动入口，初始化 DB/Redis/队列
├── config/                # MySQL、Redis、部署配置
├── middleware/            # 鉴权、错误处理、APM
├── modules/               # 业务模块
├── shared/                # 通用响应、错误、队列、角色工具
└── workers/               # BullMQ 后台 worker
```

API 层次：

```text
routes -> controller -> service -> database / redis / queue
```

主要设计：

- `authMiddleware` 校验 Access Token，并写入 `req.tenantId`、`req.userId`、`req.roles`、`req.permissionSnapshot`。
- `requirePermissionsOrRoles` 同时支持细粒度权限码和历史角色 fallback。
- TypeORM 负责实体映射；部分复杂查询使用 SQL。
- 库存关键写操作结合 Redis 分布式锁和 MySQL 事务，减少并发扣减冲突。
- 业务通知通过事件和通知模块落库，并通过 `/api/notifications/stream` SSE 推给前端。
- BullMQ 用于采购建议、MRP、通知、排产建议等异步任务。

### 数据库架构

数据库初始化位于 `infra/db/init.sql`。

核心设计：

- 所有业务数据按 `tenant_id` 隔离。
- 主数据包括：租户、用户、角色、部门、SKU 分类、SKU、BOM、供应商、客户、仓库库位。
- 交易数据包括：销售订单、采购订单、送货单、入库单、库存流水、生产订单、任务、质检、结算。
- 库存既有当前快照表，也有流水表，便于追溯。
- 质量、AI、通知、审计等辅助模块独立落表。

关键表族：

| 表族 | 代表表 | 说明 |
| --- | --- | --- |
| 租户与权限 | `tenants`, `users`, `roles`, `user_roles`, access-control 相关表 | 登录、角色、菜单、按钮权限、审计 |
| 主数据 | `skus`, `sku_categories`, `bom_headers`, `bom_items`, `suppliers`, `customers`, `departments` | 业务基础数据 |
| 仓储库存 | `inventory`, `inventory_balances`, `inventory_dye_lots`, `inventory_transactions` | 库存快照、缸号、流水 |
| 采购 | `purchase_orders`, `delivery_notes`, `purchase_receipts`, `purchase_suggestions`, `three_way_match_records` | 采购建议、采购、到货、入库、三单匹配 |
| 销售 | `sales_orders`, `sales_order_items`, `sales_deliveries`, `sales_settlements`, `sales_payments` | 销售订单、发货、结算 |
| 生产 | `production_orders`, `production_tasks`, `production_schedules`, `joint_production_batches` | 生产订单、工单、排程、联合批次 |
| 质量 | `inspection_records`, `quality_issues`, `quality_inspections` | QC 检验、质量异常、追溯 |
| AI 与通知 | `ai_messages`, `ai_suggestions`, `notifications` | AI 对话、建议、站内通知 |
| 盘点/资产/低耗品 | `stocktaking` 相关表、`asset` 相关表、`consumable` 相关表 | 手机盘点、固定资产、低耗品领用 |

## 数据流向

### 登录与权限流

```text
用户输入租户编码、账号、密码
        |
        v
POST /api/auth/login
        |
        v
后端校验 tenant + user + bcrypt password
        |
        v
签发 Access Token，Refresh Token 写入 HttpOnly Cookie
        |
        v
返回用户信息 + permissionSnapshot
        |
        v
前端保存 Access Token 到 sessionStorage，权限快照保存到 localStorage
        |
        v
路由守卫控制页面，按钮权限控制操作
```

### 销售到生产流

```text
客户/销售订单
  -> 订单约束检查：库存、产能、交期、成本
  -> 提交审批
  -> 审批通过
  -> 生成生产订单或联合生产批次
  -> 生成排程和工单
  -> 工人开工、投料、报工
  -> 完工、质量追溯、工资统计
```

### 采购到入库流

```text
库存缺口 / MRP / AI 建议
  -> 采购建议
  -> 审批通过
  -> 采购订单
  -> 到货送货单
  -> 来料检验
  -> 采购入库
  -> 库存快照更新 + 库存流水落库
  -> 三单匹配
  -> 采购结算
```

### 仓库库存流

```text
入库 / 出库 / 投料 / 发货 / 盘点调整
  -> 校验 SKU、仓库、库位、缸号、权限
  -> 获取库存锁
  -> 写库存流水 inventory_transactions
  -> 更新 inventory 当前库存
  -> 必要时更新缸号库存 inventory_dye_lots
  -> 触发库存预警、报表、通知
```

### 小程序移动作业流

```text
租户 + 账号 + 密码登录
  -> 根据权限展示控制面板九宫格
  -> 我的任务 / 仓库入库 / QC 检验 / 库存盘点
  -> 扫码或手动选择业务对象
  -> 调用与 Web 共用的 API
  -> 数据实时写入同一套 MySQL 业务表
```

## 核心模块分析

### 1. 驾驶舱与分析

入口：

- Web：`/dashboard`
- API：`/api/analytics`

能力：

- 展示在产订单、本月完工产值、库存金额、待审批事项。
- 展示生产进度、库存预警、采购建议。
- 提供经营分析、供应商分析、工人效率、库存运营报表。

适用角色：

- 老板、主管为主。

### 2. 主数据

入口：

- SKU：`/master-data/sku`
- SKU 分类：`/master-data/sku-category`
- BOM：`/master-data/bom`
- 供应商：`/master-data/supplier`
- 客户：`/sales/customers`
- 工艺配置：`/master-data/process-config`
- SKU 工艺：`/master-data/sku-process`
- 仓库库位：`/master-data/warehouse-location`

能力：

- SKU 多级分类、采购单位、生产单位、库存单位、安全库存。
- BOM 版本、启用归档、物料展开。
- 供应商价格、价格导入、价格历史。
- 工艺路线、工序、工价、工作站类型、工序投入产出。
- 仓库、库区、货架、库位条码打印和扫码定位。

操作建议：

1. 先维护 SKU 分类。
2. 新增 SKU，并设置单位、安全库存、采购/生产属性。
3. 维护 BOM 和工艺路线。
4. 维护供应商、客户、仓库库位。
5. 再进入销售、采购、生产模块。

### 3. 销售订单

入口：

- 创建订单：`/sales/orders`
- 订单列表：`/sales/order-list`
- 客户管理：`/sales/customers`
- 销售结算：`/settlement`

能力：

- 创建销售订单，支持客户 SKU 兼容。
- 校验库存、产能、交期、资金占用、库存周转。
- 支持草稿、提交、审批、驳回、撤回、确认、发货、完结。
- 可按订单生成生产订单或联合生产批次。
- 支持销售应收、待结算、收款与老板视角结算审批。

常用流程：

1. 销售维护客户资料。
2. 创建销售订单并添加 SKU 明细。
3. 查看约束检查结果。
4. 提交审批。
5. 老板或主管审批。
6. 生产生成工单，仓库按需发货。
7. 财务或老板处理结算。

### 4. 采购

入口：

- 采购建议看板：`/purchase/suggestions`
- 采购建议管理：`/purchase/purchase-suggestions`
- 采购订单：`/purchase/orders`
- 到货送货：`/purchase/deliveries`
- 采购入库：`/purchase/receipts`
- 来料检验：`/purchase/incoming-inspection`
- 三单匹配：`/purchase/match`
- 采购退货：`/purchase/returns`
- 采购结算：`/purchase/settlements`
- 价格管理：`/purchase/prices`

能力：

- 从 MRP、生产缺料、AI 建议生成采购建议。
- 采购建议审批后转采购订单。
- 采购订单支持到货登记、入库、退货、结算。
- 来料检验支持检验单、抽检结果和图片上传。
- 三单匹配关联采购订单、送货单、入库单。
- 价格导入向导支持 Excel 导入和异常确认。

常用流程：

1. 采购查看采购建议。
2. 老板或主管审批建议。
3. 采购创建采购订单。
4. 供应商送货后登记到货单。
5. QC 完成来料检验。
6. 仓库确认入库，库存增加。
7. 采购进行三单匹配和结算。

### 5. 仓储库存

入口：

- 库存总览：`/inventory`
- 盘点：`/stocktaking`
- 仓库库位：`/master-data/warehouse-location`
- 小程序仓库入库与盘点：见小程序章节

能力：

- 查看 SKU 库存、仓库库位、缸号/染色批次、安全库存。
- 执行采购入库、生产入库、领料出库、发货出库、调整入库/出库。
- 支持仓库/货架条码扫码。
- 支持库存盘点任务创建、录入、提交、确认。
- 支持库存流水追溯和库存运营报表。

注意事项：

- 库存操作需要明确 SKU、仓库、库位。
- 涉及缸号的面料建议录入 `dyeLotNo`，避免色差追溯困难。
- 库存调整必须有备注和业务来源，便于审计。

### 6. 生产

入口：

- 排产：`/production/schedule`
- 生产订单：`/production/orders`
- 工单任务：`/production/tasks`
- 缺料看板：`/production/shortage`
- 排产建议：`/schedule-suggestions`

能力：

- 销售订单转生产订单。
- 支持联合生产批次，合并同类面料/工序。
- 基于 BOM 和工艺路线生成工单。
- 工单支持开工、投料、报工、异常上报。
- 主管可监督任务，工人可查看自己的任务。
- 缺料看板可触发采购建议。

常用流程：

1. 主管确认销售订单或联合批次。
2. 生成生产订单。
3. 基于工艺配置生成排程和工单。
4. 工人领取任务并确认开工。
5. 仓库或工人完成领料/投料。
6. 工人完成报工。
7. 主管处理异常。

### 7. 质量

入口：

- 质量追溯：`/quality/trace`
- 来料检验：`/purchase/incoming-inspection`
- 小程序 QC：见小程序章节

能力：

- 查看生产订单、工单、检验、异常和图片证据。
- 创建质量问题，记录严重程度、原因、整改建议。
- 来料检验支持合格、让步接收、不合格等结果。
- 支持图片上传和认证访问。

### 8. 低耗品与固定资产

入口：

- 低耗品领用：`/consumables/issues`
- 固定资产验收：`/assets/acceptance`
- 固定资产台账：`/assets/ledger`

能力：

- 低耗品库存查询、领用申请、审批、执行。
- 固定资产从采购入库后转资产卡片。
- 资产台账支持归还、转移、报废等生命周期操作。

### 9. 权限与系统管理

入口：

- 租户配置：`/system/tenants`
- 菜单功能：`/system/menus`
- 角色配置：`/system/roles`
- 用户配置：`/system/users`
- 角色授权：`/system/role-permissions`
- 用户角色：`/system/user-role-assignments`
- 审计日志：`/system/audit-logs`
- 平台首页：`/platform/home`

能力：

- 平台级用户可管理租户。
- 租户内管理员可管理角色、用户、菜单和按钮权限。
- 角色授权会生成权限快照，前端路由和后端 API 均会校验。
- 审计日志记录敏感权限变更。

### 10. AI 与通知

入口：

- AI 对话：`/ai-chat`
- AI 浮动面板：右下角入口
- 通知中心：`/notifications`

能力：

- AI 对话基于业务数据上下文做问答。
- 采购建议、排产建议、缺料建议可由 AI/规则引擎触发。
- 通知中心通过 SSE 实时接收审批、采购、系统消息。

配置：

- `OPENAI_API_KEY`：启用 OpenAI 能力。
- `AI_ENGINE_URL`：如接入独立 AI 引擎服务时配置。

## 角色权限拆解

系统采用“租户 + 用户 + 角色 + 菜单权限 + 操作权限”的组合模型。

### 内置角色

| 角色编码 | 中文名称 | 典型职责 | 常用入口 |
| --- | --- | --- | --- |
| `platform_super_admin` | 平台超级管理员 | 管理租户、平台视角审计、切换租户上下文 | `/platform/home`, `/system/tenants` |
| `tenant_admin` | 租户管理员 | 管理租户内用户、角色、权限 | `/system/*` |
| `admin` | 系统管理员 | 租户内系统配置和基础管理 | `/system/users`, `/system/roles` |
| `boss` | 工厂老板 | 经营总览、审批、结算、报表、关键配置 | `/dashboard`, `/analytics`, 审批与结算页面 |
| `supervisor` | 车间主管 | 生产排程、工单监督、异常处理、部分审批 | `/production/*`, `/quality/trace` |
| `worker` | 生产工人 | 查看分配任务、开工、投料、报工、异常上报 | `/m`, `/production/tasks` |
| `warehouse` | 仓库管理员 | 库存、入库、出库、盘点、库位、低耗品执行 | `/inventory`, `/stocktaking`, 小程序仓库 |
| `purchaser` / `purchase` | 采购员 | 采购建议、采购订单、到货、价格、匹配、结算 | `/purchase/*` |
| `qc` | QC 验货员 | 来料检验、质量问题、QC 上传 | `/purchase/incoming-inspection`, 小程序 QC |
| `sales` | 销售人员 | 客户、销售订单、订单跟进 | `/sales/*` |
| `manager` | 经理 | 工艺配置、报表管理等管理功能 | `/master-data/process-config`, 报表 |

### 权限编码

前端权限常量位于 `services/web/src/constants/accessControl.ts`。

菜单权限示例：

| 菜单权限 | 页面 |
| --- | --- |
| `overview.dashboard` | 驾驶舱 |
| `warehouse.inventory` | 库存 |
| `purchase.order` | 采购订单 |
| `production.task` | 生产任务 |
| `quality.trace` | 质量追溯 |
| `system.role.permission.config` | 角色授权 |

操作权限示例：

| 操作权限 | 能力 |
| --- | --- |
| `sku:create`, `sku:edit` | 新增/编辑 SKU |
| `inventory:inbound`, `inventory:outbound` | 入库/出库 |
| `purchase:order:create` | 创建采购订单 |
| `sales:order:approve` | 审批销售订单 |
| `production:task:operate` | 工单操作 |
| `stocktaking:submit`, `stocktaking:confirm` | 提交/确认盘点 |
| `system.role.grant` | 角色授权 |

权限判断链路：

```text
用户登录
  -> 后端构建 permissionSnapshot
  -> 前端路由按 menuCodes 放行
  -> 前端按钮按 actionCodes 显示/禁用
  -> 后端接口按 requirePermissionsOrRoles 二次校验
```

## 快速启动

### 前置要求

建议版本：

- Node.js 18+
- npm 9+
- Docker 24+
- Docker Compose v2+
- 微信开发者工具，用于小程序调试

### 方式一：Docker Compose 一键启动

适合新同事最快跑通完整系统。

1. 复制环境变量：

```bash
cp .env.example .env
```

2. 修改 `.env` 中的 `CHANGE_ME` 字段，至少包括：

```text
DB_ROOT_PASSWORD
DB_PASS
REDIS_PASSWORD
JWT_SECRET
JWT_REFRESH_SECRET
```

3. 启动：

```bash
docker compose up -d --build
```

4. 查看服务：

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f web
```

5. 访问：

```text
Web: http://localhost
Web health: http://localhost/health
API health: docker exec sf_api wget -qO- http://127.0.0.1:3000/health
MySQL: 127.0.0.1:3307
Redis: 127.0.0.1:6379
```

6. 登录演示账号：

```text
租户：FACTORY001
账号：admin / warehouse / smoke_tester
密码：Demo123!

租户：FACTORY001
账号：boss_dev / admin_dev / supervisor_dev / warehouse_dev / worker_dev / sales_dev / purchaser_dev / qc_dev / manager_dev
密码：Dev123!2026
```

如果数据库卷已存在，`init.sql` 不会重新执行。需要补开发账号时可执行：

```bash
set -a
source .env
set +a
docker exec -i sf_mysql mysql -uroot -p"$DB_ROOT_PASSWORD" "$DB_NAME" < infra/db/local-dev-accounts.sql
```

### 方式二：本地源码开发启动

适合需要改 API 或 Web 的开发者。

1. 启动 MySQL 和 Redis：

```bash
cp .env.example .env
docker compose up -d mysql redis
```

2. 安装依赖：

```bash
cd services/api
npm install

cd ../web
npm install

cd ../mini
npm install
```

3. 启动 API：

API 服务没有自动读取 `.env` 的 dotenv 逻辑，源码开发时需要显式导出环境变量。示例：

```bash
cd services/api
NODE_ENV=development \
PORT=3000 \
DB_HOST=127.0.0.1 \
DB_PORT=3307 \
DB_NAME=smart_factory \
DB_USER=sf_app \
DB_PASS=<你的 .env 中 DB_PASS> \
REDIS_HOST=127.0.0.1 \
REDIS_PORT=6379 \
REDIS_PASSWORD=<你的 .env 中 REDIS_PASSWORD> \
JWT_SECRET=<至少 32 位随机字符串> \
JWT_REFRESH_SECRET=<另一个至少 32 位随机字符串> \
UPLOAD_DIR=/tmp/smartfactory-uploads \
npm run dev
```

4. 启动 Web：

```bash
cd services/web
npm run dev
```

默认 Vite 地址：

```text
http://localhost:5173
```

开发代理目标由 `services/web/.env.example` 中的 `VITE_API_PROXY_TARGET` 描述；生产构建默认同源 `/api`。

### 方式三：小程序启动

小程序不需要构建，使用微信开发者工具导入 `services/mini`。

步骤：

1. 打开微信开发者工具。
2. 导入目录：`services/mini`，不要导入仓库根目录。
3. 确认 `project.config.json` 中 `miniprogramRoot` 为 `miniprogram/`。
4. 本地联调时，在微信开发者工具“详情 - 本地设置”勾选“不校验合法域名、web-view 域名、TLS 版本以及 HTTPS 证书”。
5. 如连接真实后端，修改 `services/mini/miniprogram/utils/config.js` 中的后端地址为已加入微信 request 合法域名的 HTTPS 地址。
6. 执行静态校验：

```bash
cd services/mini
npm run check
```

## 环境变量

根环境变量模板：`.env.example`。

关键变量：

| 变量 | 说明 |
| --- | --- |
| `APP_NAME` | 应用名称 |
| `WEB_PORT` | Web 容器对外端口，默认 80 |
| `DB_ROOT_PASSWORD` | MySQL root 密码 |
| `DB_NAME` | 应用数据库名，默认 `smart_factory` |
| `DB_USER` / `DB_PASS` | API 连接数据库的账号密码 |
| `DB_POOL_SIZE` | Docker compose 中传给 API 的连接池大小 |
| `REDIS_PASSWORD` | Redis 密码 |
| `JWT_SECRET` | Access Token 签名密钥，生产必须强随机 |
| `JWT_REFRESH_SECRET` | Refresh Token 签名密钥，必须不同于 `JWT_SECRET` |
| `JWT_EXPIRES_IN` | Access Token 有效期 |
| `CORS_ORIGINS` | API CORS 白名单，生产不允许使用通配符 |
| `FILE_STORAGE_DRIVER` | 文件存储方式，`local` 或 `oss` |
| `UPLOAD_DIR` | 本地文件存储目录 |
| `OSS_*` | 阿里云 OSS 配置 |
| `AI_ENGINE_URL` | 独立 AI 服务地址 |
| `OPENAI_API_KEY` | OpenAI API Key |
| `INVENTORY_WAREHOUSE_PHASE` | 库存仓位校验阶段，`A`/`B`/`C` |

Web 环境变量：

| 变量 | 说明 |
| --- | --- |
| `VITE_APP_TITLE` | 页面标题 |
| `VITE_APP_ENV` | `development` / `staging` / `production` |
| `VITE_TENANT_CODE` | 默认租户编码 |
| `VITE_API_BASE_URL` | API 基础地址，未配置时同源 |
| `VITE_API_PROXY_TARGET` | Vite 开发代理目标 |

## 数据库与初始化数据

### 初始化入口

Docker 首次启动 MySQL 时自动执行：

```text
infra/db/init.sql
```

该脚本包含：

- 数据库字符集与基础表结构。
- `FACTORY001` 演示租户。
- 演示账号和开发账号。
- SKU、BOM、库存、采购、销售、生产、质量等演示数据。

### 注意事项

- `docker compose down` 不会删除数据库卷。
- 若想重新执行 `init.sql`，需要删除 `mysql_data` 卷。该操作会清空数据库，谨慎执行。
- 已有数据库只需补账号或局部结构时，优先执行 `infra/db/local-dev-*.sql` 或具体修复脚本，不要直接重置。

查看数据库：

```bash
set -a
source .env
set +a
docker exec -it sf_mysql mysql -uroot -p"$DB_ROOT_PASSWORD" "$DB_NAME"
```

常用检查：

```sql
SELECT id, code, name, status FROM tenants;
SELECT id, username, real_name, status FROM users WHERE tenant_id = 1;
SELECT tenant_id, code, name FROM roles;
```

## Web 端操作说明

### 登录

访问 `http://localhost` 或 `http://localhost:5173`。

填写：

```text
租户：FACTORY001
账号：boss_dev
密码：Dev123!2026
```

登录成功后：

- 普通租户用户进入 `/dashboard`。
- 平台级用户进入 `/platform/home`。
- 权限不足时页面会自动回退到可访问页面。

### 推荐新人上手路径

1. 使用 `boss_dev` 登录，浏览驾驶舱和报表。
2. 进入主数据，查看 SKU、BOM、工艺配置、仓库库位。
3. 使用 `sales_dev` 创建销售订单。
4. 使用 `boss_dev` 或 `supervisor_dev` 审批订单。
5. 进入生产订单和生产任务，查看工单生成情况。
6. 使用 `worker_dev` 在 `/m` 或小程序查看任务并操作。
7. 使用 `warehouse_dev` 操作采购入库、库存、盘点。
8. 使用 `qc_dev` 操作来料检验和质量问题。
9. 使用 `purchaser_dev` 完成采购建议、采购订单、三单匹配。

### 模块入口速查

| 模块 | 路由 |
| --- | --- |
| 驾驶舱 | `/dashboard` |
| 库存 | `/inventory` |
| 采购建议 | `/purchase/suggestions`, `/purchase/purchase-suggestions` |
| 采购订单 | `/purchase/orders` |
| 到货送货 | `/purchase/deliveries` |
| 采购入库 | `/purchase/receipts` |
| 来料检验 | `/purchase/incoming-inspection` |
| 三单匹配 | `/purchase/match` |
| 销售开单 | `/sales/orders` |
| 销售订单列表 | `/sales/order-list` |
| 客户 | `/sales/customers` |
| 生产排程 | `/production/schedule` |
| 生产订单 | `/production/orders` |
| 生产任务 | `/production/tasks` |
| 缺料看板 | `/production/shortage` |
| 质量追溯 | `/quality/trace` |
| SKU | `/master-data/sku` |
| BOM | `/master-data/bom` |
| 工艺配置 | `/master-data/process-config` |
| 仓库库位 | `/master-data/warehouse-location` |
| 盘点 | `/stocktaking` |
| 低耗品 | `/consumables/issues` |
| 固定资产验收 | `/assets/acceptance` |
| 固定资产台账 | `/assets/ledger` |
| AI 对话 | `/ai-chat` |
| 通知中心 | `/notifications` |
| 系统管理 | `/system/*` |

### 关键模块操作步骤

#### 主数据建档

1. 进入 SKU 分类，确认一级、二级分类。
2. 进入 SKU 页面，新建或导入物料。
3. 维护采购单位、生产单位、库存单位和换算关系。
4. 进入 BOM 页面，为成品或半成品维护物料结构。
5. 进入工艺配置，维护工序、工作站、工价、投入/产出物料。
6. 进入仓库库位，维护仓库、库区、货架和库位，并打印条码。

#### 销售订单

1. 进入客户管理，新建客户和联系人。
2. 进入销售开单，选择客户、交期、订单明细。
3. 查看约束检查结果。
4. 保存草稿或提交审批。
5. 老板/主管在订单列表中审批。
6. 审批通过后创建生产订单或加入联合生产批次。

#### 采购入库

1. 采购查看采购建议或手动创建采购订单。
2. 供应商到货后创建送货单。
3. QC 在来料检验中录入抽检结果。
4. 仓库在采购入库中确认入库数量、库位、缸号。
5. 系统写入库存流水并更新库存快照。
6. 采购进入三单匹配和结算。

#### 生产任务

1. 主管进入生产订单或排程页面生成任务。
2. 工人进入 `/m` 或小程序“我的任务”。
3. 打开任务详情，确认开工。
4. 查看物料，执行领料/投料。
5. 完成报工，填写数量、工时、备注。
6. 如有问题，提交异常上报。
7. 主管处理异常并推进任务。

#### 库存盘点

1. 仓库或老板创建盘点任务。
2. 选择盘点范围。
3. Web 或小程序中录入实际数量。
4. 提交盘点。
5. 老板确认盘盈盘亏调整。
6. 系统写入调整流水。

#### 质量追溯

1. 进入质量追溯页面。
2. 按生产订单、工单、检验单查询。
3. 查看任务、投料、产出、质检和异常链路。
4. 新增质量问题，上传图片。
5. 跟踪整改建议和处理结果。

## 小程序操作说明

小程序位于 `services/mini`，原生微信小程序，不使用 Taro 或 React。

### 登录

小程序直接使用 Web 端租户、账号、密码登录，不与微信登录打通。

字段：

```text
租户
账号
密码
```

登录后根据权限展示控制面板九宫格：

- 我的任务
- 仓库入库
- QC 检验
- 库存盘点

### 我的任务

适用角色：工人、主管、老板。

能力：

- 查看当前账号分配的任务。
- 进入二级任务详情。
- 确认开工。
- 查看所有物料和投料要求。
- 确认投料。
- 完成报工。
- 异常上报。
- 返回控制面板或任务列表。

### 仓库入库

适用角色：仓库、主管、老板。

能力：

- 扫描物料条码。
- 扫描仓库/货架/库位条码。
- 按 SKU 编码或名称搜索候选物料。
- 录入入库数量、缸号/染色批次、库位。
- 确认入库并更新库存。

### QC 检验

适用角色：QC、主管、老板。

能力：

- 查看来料检验单。
- 上传验货数据。
- 录入抽检数量、合格数、不良项、备注。
- 上传图片留证。
- 提交检验结果。

### 库存盘点

适用角色：仓库、主管、老板。

能力：

- 扫描仓库/货架条码。
- 查看盘点任务和盘点物料。
- 录入实际库存。
- 保存草稿。
- 提交盘点。

### 小程序联调注意事项

- 本地 `http://localhost:3000` 联调时，需要微信开发者工具关闭合法域名校验。
- 正式环境必须使用 HTTPS API 域名，并在微信公众平台配置 request 合法域名。
- 小程序 API 地址配置在 `services/mini/miniprogram/utils/config.js`。
- 小程序静态检查命令：

```bash
cd services/mini
npm run check
```

## 测试与质量检查

### Web

```bash
cd services/web
npm run lint
npm run typecheck
npm run test
npm run build
```

### API

```bash
cd services/api
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
```

### 小程序

```bash
cd services/mini
npm run check
```

### 根目录集成测试

根目录 `package.json` 提供了大量 Playwright 和 API 集成测试脚本，常用：

```bash
npm run test:api:integration
npm run test:api:e2e
npm run test:web:ui:mock
npm run test:production-task:ui:smoke
npm run test:purchase:ui:smoke
npm run test:stocktaking:ui:smoke
npm run test:permission-control:ui:smoke
```

部分真实 UI 测试需要先启动完整服务，并设置：

```bash
PLAYWRIGHT_SKIP_WEBSERVER=1
PLAYWRIGHT_APP_BASE_URL=http://127.0.0.1:80
```

## 部署与运维

### 单机部署

1. 准备服务器，安装 Docker 和 Docker Compose。
2. 拉取代码。
3. 配置 `.env`。
4. 执行：

```bash
docker compose up -d --build
```

5. 检查：

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f web
curl http://127.0.0.1/health
```

### 生产部署

生产覆盖文件：

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

生产建议：

- `JWT_SECRET`、`JWT_REFRESH_SECRET` 使用强随机值。
- `CORS_ORIGINS` 明确配置正式域名。
- 数据库和 Redis 端口不要暴露公网。
- 文件存储建议使用 OSS。
- 前置 HTTPS 终止层，Nginx 或负载均衡启用 HSTS。
- 定期备份 MySQL 卷和上传文件。
- API 多副本时确认 Redis 可用，因为 BullMQ、通知、锁依赖 Redis。

### 备份

MySQL 备份示例：

```bash
set -a
source .env
set +a
docker exec sf_mysql mysqldump -uroot -p"$DB_ROOT_PASSWORD" "$DB_NAME" > backup-smart-factory.sql
```

恢复示例：

```bash
set -a
source .env
set +a
docker exec -i sf_mysql mysql -uroot -p"$DB_ROOT_PASSWORD" "$DB_NAME" < backup-smart-factory.sql
```

### 日志

```bash
docker compose logs -f api
docker compose logs -f web
docker compose logs -f mysql
docker compose logs -f redis
```

API 指标端点：

```text
GET /api/health/metrics
```

该端点需要认证，并要求直接 `boss` 角色。

## 开发规范

### 修改 API

1. 先确认对应模块路由和权限。
2. Controller 负责参数校验和响应。
3. Service 负责业务规则、事务、库存锁、事件。
4. 重要写操作必须考虑租户隔离、权限、并发、审计。
5. 新接口同步补充 Web API hook 和测试。

### 修改 Web

1. 页面放在 `services/web/src/pages/<module>`。
2. API hook 放在 `services/web/src/api`。
3. 通用组件优先复用 `components/common`。
4. 路由和权限在 `App.tsx`、`constants/accessControl.ts` 中登记。
5. 服务端数据使用 React Query，不要手写重复缓存。
6. 长连接、定时器、Blob URL、扫码实例必须在 cleanup 中释放。

### 修改小程序

1. 页面放在 `services/mini/miniprogram/pages`。
2. 通用请求、鉴权、导航工具放在 `utils`。
3. 小程序使用 Web 端账号密码登录。
4. 不要依赖浏览器 API。
5. 修改后执行 `npm run check`。

### 数据库变更

优先策略：

- 新增表。
- 为已有表追加字段。
- 新增索引。
- 编写兼容迁移和回滚说明。

谨慎操作：

- 修改历史字段含义。
- 删除字段。
- 修改 `init.sql` 基线定义。

任何数据库结构演进都必须说明：

- 影响模块。
- 兼容策略。
- 迁移路径。
- 回滚路径。
- 回归验证范围。

## 常见问题

### 1. 登录提示租户或账号不存在

检查：

```sql
SELECT * FROM tenants WHERE code = 'FACTORY001';
SELECT username, status FROM users WHERE tenant_id = 1;
```

如果开发账号缺失，执行：

```bash
set -a
source .env
set +a
docker exec -i sf_mysql mysql -uroot -p"$DB_ROOT_PASSWORD" "$DB_NAME" < infra/db/local-dev-accounts.sql
```

### 2. Web 能打开但 API 失败

检查：

```bash
docker compose ps
docker compose logs -f api
curl http://127.0.0.1/health
```

本地 Vite 开发时确认 `VITE_API_PROXY_TARGET` 指向正确入口。

### 3. 401 或登录反复失效

可能原因：

- `JWT_SECRET` 或 `JWT_REFRESH_SECRET` 改动后旧 token 失效。
- 浏览器 Cookie 被禁用。
- 跨域调试时 `withCredentials` 和 CORS 白名单不匹配。

处理：

- 清理浏览器站点数据。
- 重新登录。
- 检查 `CORS_ORIGINS`。

### 4. 小程序请求 localhost 报合法域名错误

本地调试时在微信开发者工具中勾选“不校验合法域名、web-view 域名、TLS 版本以及 HTTPS 证书”。

正式环境必须配置 HTTPS 域名，并在微信公众平台加入 request 合法域名。

### 5. 数据没有初始化

`init.sql` 只会在 MySQL 数据卷首次创建时执行。如果已有 `mysql_data` 卷，需要手动导入 SQL 或删除卷后重建。

谨慎重建：

```bash
docker compose down
docker volume ls | grep mysql_data
```

删除卷会清空数据库，不要在生产环境执行。

### 6. 库存操作提示锁冲突

库存写操作会使用 Redis 锁和 DB 事务。短时间并发操作同一 SKU、仓库、库位时可能出现锁冲突。

处理：

- 稍后重试。
- 检查 Redis 是否可用。
- 检查是否存在重复提交或前端重复点击。

### 7. 上传图片或附件无法访问

检查：

- `FILE_STORAGE_DRIVER` 是否正确。
- `UPLOAD_DIR` 是否挂载。
- `/uploads` 访问必须带认证 token。
- 生产 OSS 模式下检查 `OSS_BUCKET`、`OSS_ENDPOINT` 和密钥。

## 参考文档

- 产品说明：`docs/prd-smart-factory-agent.md`
- 架构设计：`docs/architecture-design.md`
- 数据库设计：`docs/database-design.md`
- 部署指南：`docs/deployment-guide.md`
- 生产部署 Runbook：`docs/production-server-deployment-runbook.md`
- 小程序说明：`services/mini/README.md`
- 多 Agent 协作规范：`AGENTS.md`
