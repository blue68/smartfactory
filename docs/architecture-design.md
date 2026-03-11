# [artifact:架构设计] 智造管家 — 系统架构设计文档

**产品名称**：智造管家（SmartFactory Agent）
**文档版本**：v1.0
**创建日期**：2026-03-11
**负责人**：@senior-backend-engineer（架构设计）
**输入来源**：PRD v1.4、用户故事 v1.3、原型 v1.4、设计规范 v1.0
**交付给**：@senior-backend-engineer（API开发）、@senior-frontend-engineer（前端约束）

---

## 一、技术选型与理由

### 1.1 选型原则

本系统面向 15-30 人的中小工厂，初期单租户日活用户约 20-30 人，数据规模约 1000 个 SKU。架构选型优先原则如下：

1. **开发效率优先**：选择团队熟悉、生态成熟的技术栈，避免过度工程化
2. **运维门槛低**：私有化部署须 Docker 一键启动，客户无需专业运维
3. **可观测性**：系统状态对运营团队完全可见，出问题可快速定位
4. **适度超前**：架构预留多租户和水平扩展能力，但 Phase 1 不强制启用

### 1.2 后端框架选型

**选型：Node.js + TypeScript + Express**（遵循 CLAUDE.md 默认技术栈）

理由：
- 符合团队规范，避免选型摩擦
- TypeScript 提供类型安全，降低复杂业务逻辑（BOM 展开、单位换算）的 bug 率
- Express 生态成熟，中间件丰富，适合快速迭代
- Node.js 异步特性适合 AI 流式输出（SSE/WebSocket）场景

补充说明：
- AI 引擎层（采购建议、排产算法）独立为 Python 微服务，原因是 Python 在数值计算（numpy/scipy）和 ML（scikit-learn）上生态远优于 Node.js
- Phase 1 规则引擎可用 Node.js 实现；Phase 2 ML 模型切换至 Python 服务，接口契约不变

### 1.3 前端框架选型

**Web 端：React 18 + TypeScript + Vite**（遵循 CLAUDE.md 默认技术栈）

理由：
- React 生态成熟，组件复用率高
- TypeScript 与后端共享类型定义（monorepo packages/types）
- Vite 构建速度快，开发体验好
- React Query（TanStack Query）处理服务端状态和缓存，减少手写 loading/error 逻辑

状态管理：
- 服务端状态：React Query（接口数据、缓存、后台同步）
- 客户端状态：Zustand（轻量，比 Redux 简单，适合本项目复杂度）

**微信小程序：原生微信小程序 + TypeScript**

理由：
- 微信小程序有自己的运行时，React Native 和 Taro 等跨端方案在小程序端存在性能损耗和 API 兼容性问题
- 本项目小程序功能聚焦（出入库录入、任务查看），页面数量有限（约 15 个页面），原生开发可控性更高
- 原生小程序更容易满足工厂现场大字体、高对比度、手套操作的特殊交互要求
- 微信小程序原生 API 对扫码、推送通知、离线缓存支持最完善

### 1.4 数据库选型

**主数据库：MySQL 8.0**（遵循 CLAUDE.md 默认技术栈）

理由：
- 业务数据强一致性要求（库存扣减、三单匹配）需要事务支持
- 关系型数据模型适合复杂的 BOM 多层展开查询
- MySQL 8.0 支持递归 CTE（WITH RECURSIVE），原生支持 BOM 展开
- 成熟的备份、主从复制方案

补充存储：
- **Redis 7**（遵循 CLAUDE.md）：缓存库存数据、Session、分布式锁（防止并发库存扣减超卖）、消息队列（Bull）
- **本地文件存储 / MinIO**：图片存储（QC 验货照片、异常上报图片）；SaaS 模式用云 OSS，私有化模式用 MinIO（S3 兼容，Docker 部署）

不引入 MongoDB 或 Elasticsearch 的理由：
- 当前数据规模不需要文档存储，结构化数据用 MySQL 即可
- 全文搜索需求（物料名称模糊搜索）用 MySQL FULLTEXT INDEX 满足，1000 个 SKU 量级无需 ES

### 1.5 缓存方案

Redis 承担以下职责：

| 场景 | Key 设计 | TTL | 说明 |
|---|---|---|---|
| 库存实时数据 | `inventory:{tenantId}:{skuId}` | 60s | 高频读取，异步写回 |
| SKU 主数据 | `sku:{tenantId}` | 5min | 变更时主动失效 |
| BOM 展开结果 | `bom:{tenantId}:{bomId}:{version}` | 30min | BOM 修改时失效 |
| 用户 Session | `session:{token}` | 7d | 滑动窗口续期 |
| AI 建议结果 | `ai_suggestion:{requestId}` | 10min | 避免重复计算 |
| 排产计划 | `schedule:{tenantId}:{date}` | 12h | 当日失效 |
| 分布式锁 | `lock:inventory:{skuId}` | 5s | 防止并发扣减 |
| 预警消息去重 | `alert_sent:{tenantId}:{skuId}:{date}` | 24h | 防止消息轰炸 |

### 1.6 消息队列

**选型：Bull（基于 Redis 的 Node.js 任务队列）**

理由：
- Bull 基于 Redis，不引入额外中间件（Kafka/RabbitMQ），降低私有化部署复杂度
- 满足当前异步任务需求（日均操作 100 次量级）
- 内置重试、失败处理、定时任务功能

队列职责：

| 队列名 | 生产者 | 消费者 | 用途 |
|---|---|---|---|
| `notification.queue` | 预警检测器、AI 引擎 | 通知推送服务 | 微信消息推送 |
| `ai.suggestion.queue` | 采购模块、排产模块 | AI Python 服务 | 异步 AI 任务 |
| `inventory.sync.queue` | 出入库操作 | 库存聚合服务 | 实时库存同步 |
| `bom.calculation.queue` | 订单下单 | BOM 计算服务 | 异步 BOM 物料需求计算 |
| `daily.task.queue` | 定时调度（cron） | 多个消费者 | 每日7:00采购建议生成、7:30排产计划生成 |
| `trace.record.queue` | 工序完工上报 | 溯源链记录服务 | 异步写入溯源数据 |

### 1.7 AI/ML 技术方案

**Phase 1（规则引擎，第 1-12 周）**
- 语言：Node.js / TypeScript
- 采购建议：基于库存缺口计算的确定性规则引擎
- 排产算法：基于优先级规则的贪心调度（工期优先 + 物料可用性约束）
- 下单约束引擎：四维阈值检查（纯规则）

**Phase 2（ML 模型，第 13 周起）**
- 语言：Python 3.11 + FastAPI
- 采购需求预测：时间序列预测（Prophet 或 LightGBM）
- 排产优化：约束满足问题（Google OR-Tools）
- 对话 AI 助手：调用大模型 API（DeepSeek / 文心一言），配合 RAG 检索业务数据

**AI 对话层（Phase 2）**：
- LLM 接口：通过统一 LLM Gateway 调用（支持 DeepSeek、文心一言等国内模型，避免 OpenAI API 不稳定问题）
- RAG 向量数据库：pgvector（PostgreSQL 扩展）或简单的向量搜索（Chroma，Docker 部署）
- 私有化部署降级：可切换至本地 Ollama 部署的轻量模型（如 Qwen2.5-7B）

### 1.8 微信小程序技术方案

- 框架：原生微信小程序 + TypeScript
- 网络：小程序 `wx.request` 封装，统一处理 token、重试、loading
- 离线缓存：`wx.setStorageSync` / `wx.getStorageSync`（本地 Storage 最大 10MB）
- 推送：订阅消息（SubscribeMessage）模板消息
- 图片上传：`wx.chooseMedia` + 直传服务器（带签名的预签名 URL）
- 扫码：`wx.scanCode`

### 1.9 部署方案

**SaaS 多租户模式**：
```
云服务器（阿里云 / 腾讯云 ECS）
├── Nginx（反向代理 + 静态资源）
├── Node.js API 服务（PM2 管理，多进程）
├── Python AI 服务（uvicorn + gunicorn）
├── MySQL（RDS 托管，自动备份）
├── Redis（云 Redis，高可用）
└── MinIO / 云 OSS（图片存储）
```

**私有化部署模式**（Docker Compose 一键部署）：
```yaml
# docker-compose.yml 包含所有服务
services:
  nginx          # 反向代理
  api            # Node.js API
  ai-service     # Python AI 服务（可选，Phase 2）
  mysql          # MySQL 8.0
  redis          # Redis 7
  minio          # S3 兼容图片存储
  backup         # 自动备份（cron + mysqldump）
```

配置区分：环境变量文件 `.env.saas` / `.env.private`，代码层面通过 `DEPLOY_MODE` 环境变量切换行为。

私有化最低配置要求：4 核 8GB 内存，100GB SSD。

---

## 二、系统架构图

### 2.1 整体分层架构

```
┌─────────────────────────────────────────────────────────────────┐
│                          接入层（Access Layer）                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Web 端      │  │  微信小程序   │  │  微信消息推送接收     │  │
│  │  React + TS  │  │  原生小程序   │  │  （Webhook）         │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                       │              │
│         └─────────────────┴───────────────────────┘             │
│                           │ HTTPS                                │
│  ┌────────────────────────▼────────────────────────────────┐    │
│  │           Nginx（反向代理、静态资源、SSL终止）             │    │
│  └────────────────────────┬────────────────────────────────┘    │
└───────────────────────────┼─────────────────────────────────────┘

┌───────────────────────────┼─────────────────────────────────────┐
│                     应用层（Application Layer）                   │
│  ┌─────────────────────── ▼ ──────────────────────────────┐     │
│  │               API Gateway（Express Router）              │     │
│  │     认证中间件 │ 权限中间件 │ 租户中间件 │ 限流中间件     │     │
│  └────┬──────┬──────┬──────┬──────┬──────┬──────┬─────────┘     │
│       │      │      │      │      │      │      │                │
│  [用户] [基础] [库存] [采购] [销售] [生产] [质量] [AI分析]        │
│  [权限] [数据] [模块] [模块] [模块] [模块] [溯源] [模块]         │
│                                                                  │
│  ┌─────────────────────────────────────────────────────┐        │
│  │              共享服务层（Shared Services）             │        │
│  │  通知推送服务 │ 文件存储服务 │ 定时任务调度 │ 审计日志  │        │
│  └─────────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     领域层（Domain Layer）                        │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │ 库存领域  │  │ 采购领域  │  │ 生产领域  │  │  销售领域     │   │
│  │ 实体/值对象│  │ 实体/值对象│  │ 实体/值对象│  │  实体/值对象  │   │
│  │ 聚合根    │  │ 聚合根    │  │ 聚合根    │  │  聚合根      │   │
│  │ 领域服务  │  │ 领域服务  │  │ 领域服务  │  │  领域服务    │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │
│                                                                  │
│  ┌──────────┐  ┌────────────────────┐  ┌────────────────────┐  │
│  │ 基础数据  │  │    AI Agent 领域    │  │   质量溯源领域      │  │
│  │ 领域     │  │  建议引擎/约束引擎   │  │   溯源链/验货      │  │
│  └──────────┘  └────────────────────┘  └────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   基础设施层（Infrastructure Layer）              │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │  MySQL   │  │  Redis   │  │   Bull   │  │ Python AI    │   │
│  │  8.0     │  │  7.x     │  │  队列    │  │ 服务（Phase2）│   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────────┐  │
│  │  MinIO   │  │ 微信API  │  │   外部 LLM API（DeepSeek等）  │  │
│  │ /云 OSS  │  │ 推送服务  │  │   / Ollama 本地（私有化）     │  │
│  └──────────┘  └──────────┘  └──────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 服务划分

本系统采用**单体模块化架构（Modular Monolith）**，而非微服务。理由：

- 当前用户量极小（日活 30 人），微服务的运维复杂度远超收益
- 单体便于私有化 Docker 一键部署
- 模块间通过明确接口通信，可在流量增长时按需拆分

模块划分：

```
src/
├── modules/
│   ├── auth/           # 用户认证与权限
│   ├── tenant/         # 多租户管理
│   ├── master-data/    # 基础主数据（SKU、BOM、供应商、工序）
│   ├── inventory/      # 库存管理（出入库、缸号、多单位）
│   ├── procurement/    # 采购管理（建议、三单匹配、价格）
│   ├── sales/          # 销售管理（订单、插单、约束引擎）
│   ├── production/     # 生产管理（排产、任务、进度）
│   ├── quality/        # 质量溯源（验货、溯源链）
│   ├── ai-agent/       # AI Agent（对话、建议协调、预测）
│   ├── notification/   # 通知推送（微信、站内）
│   └── analytics/      # 数据分析（看板、报表）
├── shared/
│   ├── middleware/     # 认证、权限、租户、限流
│   ├── utils/          # 公共工具（单位换算、BOM 展开）
│   ├── types/          # 共享类型定义
│   └── errors/         # 统一错误类型
└── infrastructure/
    ├── database/       # MySQL 连接、事务管理
    ├── cache/          # Redis 操作封装
    ├── queue/          # Bull 队列定义
    ├── storage/        # 文件存储（MinIO/OSS）
    └── wechat/         # 微信 API 封装
```

### 2.3 数据流架构

**库存更新数据流（关键路径）**：

```
仓库管理员扫码（小程序）
    │
    ▼
POST /api/inventory/inbound
    │
    ├── 1. 身份认证 + 租户解析
    ├── 2. 参数校验（单位合法性、缸号必填性）
    ├── 3. 单位换算（采购单位 → 库存单位）
    ├── 4. 获取分布式锁（Redis：lock:inventory:{skuId}）
    ├── 5. 写入入库记录（MySQL inventory_records）
    ├── 6. 更新库存快照（MySQL sku_inventory）
    ├── 7. 释放锁
    ├── 8. 更新 Redis 缓存（异步，库存快照）
    ├── 9. 推送 inventory.sync.queue（触发实时看板更新）
    └── 10. 检查安全库存（触发预警队列，如需要）

Response: 201 { code: 0, data: { newQuantity, unit }, message: "入库成功" }
```

**AI 采购建议生成数据流**：

```
定时任务（每日 7:00）/ 手动触发
    │
    ▼
ai.suggestion.queue（Bull）
    │
    ▼
消费者：AI 建议引擎
    │
    ├── 1. 读取在产订单列表
    ├── 2. BOM 多层展开（MySQL WITH RECURSIVE / 缓存结果）
    ├── 3. 计算物料需求汇总（含缸号匹配逻辑）
    ├── 4. 读取当前库存 + 在途库存
    ├── 5. 计算缺口（区分普通缺口和缸号匹配缺口）
    ├── 6. 查询供应商信息 + 历史价格
    ├── 7. 生成建议列表（Phase1：规则；Phase2：ML 预测）
    ├── 8. 计算置信度
    ├── 9. 写入 procurement_suggestions
    └── 10. 触发 notification.queue（推送给采购员和老板）
```

**AI 对话流式输出数据流**：

```
用户输入（Web 端）
    │
    ▼
POST /api/ai/chat（SSE 长连接）
    │
    ├── 1. 解析用户意图（意图分类：查询/建议/分析）
    ├── 2. 提取实体（物料名称、订单号、日期范围等）
    ├── 3. 查询业务数据（按意图调用对应模块 API）
    ├── 4. 构建 Prompt（业务数据 + 用户问题）
    ├── 5. 调用 LLM API（流式）
    └── 6. SSE 推送（每个 token 实时推送到客户端）

客户端收到：
    event: thinking_start
    event: data { step: "正在分析库存数据..." }
    event: data { step: "正在匹配订单BOM..." }
    event: token { content: "当前..." }  # 逐token流式
    event: done
```

### 2.4 AI Agent 架构

```
┌──────────────────────────────────────────────────────┐
│                   AI Agent 协调层                      │
│                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │  对话 Agent  │  │  建议 Agent  │  │ 预警 Agent│  │
│  │  自然语言理解 │  │  采购建议    │  │ 主动推送  │  │
│  │  + 数据检索  │  │  排产建议    │  │ 缺料/风险 │  │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘  │
│         │                 │                  │        │
└─────────┼─────────────────┼──────────────────┼────────┘
          │                 │                  │
┌─────────▼─────────────────▼──────────────────▼────────┐
│                   工具层（Tools）                        │
│                                                        │
│  inventory_query  │  bom_expand    │  order_query      │
│  supplier_query   │  schedule_read │  analytics_query  │
│  constraint_check │  trace_query   │  price_query      │
└────────────────────────────────────────────────────────┘
          │
┌─────────▼─────────────────────────────────────────────┐
│               AI 推理层（Inference Layer）               │
│                                                        │
│  Phase 1: 规则引擎（Node.js，确定性逻辑）               │
│  Phase 2: LLM API + 规则融合（Python FastAPI）          │
│                                                        │
│  置信度评估 → 建议格式化 → 推理依据生成                   │
└────────────────────────────────────────────────────────┘
```

---

## 三、模块职责划分

### 3.1 用户与权限模块（auth）

**职责边界**：
- 用户注册、登录、登出，JWT Token 签发与刷新
- 角色定义（老板/采购员/仓管/车间主管/工人/QC/销售）
- 权限矩阵管理（基于 RBAC）
- 多租户解析（从 JWT 中提取 tenantId）
- 微信小程序一键登录（openid 绑定）

**核心实体**：
- `User`：用户基本信息，关联租户和角色
- `Role`：角色定义，含权限列表
- `Permission`：权限项（资源 + 操作）
- `Tenant`：租户信息（SaaS 模式）

**对外接口**：
- `POST /api/auth/login`：账号密码登录
- `POST /api/auth/wechat-login`：微信 openid 登录
- `POST /api/auth/refresh`：刷新 Token
- `GET /api/users`：用户列表（管理员）
- `authMiddleware`：供所有模块使用的认证中间件

**依赖关系**：无（底层模块，被所有其他模块依赖）

---

### 3.2 基础数据模块（master-data）

**职责边界**：
- SKU 主数据 CRUD（含一级/二级分类、多单位配置）
- BOM 管理（多层 BOM 录入、快速录入向导）
- 供应商主数据（A/B/C 分级、联系人、账期、交货周期）
- 工序配置（标准工序模板 + 款式差异增减）
- Excel 批量导入（字段智能映射）
- 系统内部编码自动生成（SKU 内部编号）

**核心实体**：
- `SKU`：物料主数据，含 category1/category2、单位配置
- `UnitConversion`：多单位换算关系（SKU 级别）
- `BOM`：产品物料清单，树形结构
- `BOMItem`：BOM 明细行（物料、数量、工序单位）
- `Supplier`：供应商主数据，含分级信息
- `WorkProcess`：工序配置
- `WorkProcessTemplate`：工序模板

**对外接口**：
- `GET /api/sku`：SKU 列表（支持分类、关键字筛选）
- `GET /api/sku/:id/bom`：获取 BOM（触发展开计算）
- `GET /api/bom/:id/expand`：BOM 多层展开（返回完整物料树）
- `GET /api/suppliers`：供应商列表
- `GET /api/sku-categories`：二级分类枚举值（供前端筛选器使用）
- `POST /api/import/sku`：Excel 导入
- `bomExpansionService`：供采购模块、生产模块调用的 BOM 展开服务

**依赖关系**：依赖 auth 模块（权限校验）

---

### 3.3 库存管理模块（inventory）

**职责边界**：
- 入库录入（采购入库、完工入库）+ 单位换算
- 出库录入（领料出库、成品出货）+ 单位换算
- 缸号批次管理（面料类 SKU 专用）
- 库存快照维护（实时库存数量）
- 先进先出出库推荐
- 安全库存监控与预警触发
- 库存盘点辅助
- 物料损耗记录

**核心实体**：
- `InventoryRecord`：出入库记录流水（不可删除）
- `SKUInventory`：库存快照（聚合值，按 SKU）
- `DyeLotBatch`：缸号批次（面料类 SKU 的子库存）
- `StocktakeRecord`：盘点记录
- `MaterialLoss`：物料损耗记录

**对外接口**：
- `POST /api/inventory/inbound`：入库录入
- `POST /api/inventory/outbound`：出库录入
- `GET /api/inventory`：库存总览（支持 SKU 分类、缸号展开）
- `GET /api/inventory/:skuId/dye-lots`：缸号批次详情
- `GET /api/inventory/:skuId/available`：可用库存计算（扣减已占用）
- `inventoryService.deductStock()`：供生产模块调用的库存扣减服务
- `inventoryService.getAvailableStock()`：供采购模块调用的可用库存查询

**依赖关系**：依赖 master-data（SKU 信息、单位换算），被采购、生产、销售模块依赖

---

### 3.4 采购管理模块（procurement）

**职责边界**：
- 采购建议生成（调用 AI Agent 模块的建议引擎）
- 采购建议审批流（提交 → 老板确认 → 执行）
- 采购订单（PO）管理
- 采购到货录入（送货单）
- 三单匹配（PO - 送货单 - 入库单一致性校验）
- 供应商价格管理（按批次/时间段）
- 价格异常检测（超历史均值 20% 预警）
- 月度对账单汇总

**核心实体**：
- `PurchaseSuggestion`：AI 采购建议
- `PurchaseOrder`（PO）：采购订单
- `DeliveryNote`：送货单
- `ThreeWayMatch`：三单匹配记录
- `SupplierPrice`：供应商价格协议（含时间段）
- `PriceHistory`：采购价格历史

**对外接口**：
- `GET /api/procurement/suggestions`：采购建议列表
- `POST /api/procurement/suggestions/:id/approve`：老板审批
- `POST /api/procurement/orders`：创建采购订单
- `POST /api/procurement/orders/:id/delivery`：录入送货单
- `GET /api/procurement/three-way-match`：三单匹配列表
- `POST /api/procurement/three-way-match/:id/confirm`：确认差异
- `GET /api/procurement/prices`：价格协议管理

**依赖关系**：依赖 master-data（供应商、SKU）、inventory（库存查询）、ai-agent（建议生成）、notification（审批推送）

---

### 3.5 销售订单模块（sales）

**职责边界**：
- 销售客户管理（基本信息、账期、信用额度）
- 常规订单录入 + 预估交期计算
- 紧急插单（含 AI 影响分析）
- 订单修改管控（影响分析 + 操作记录）
- 下单智能约束引擎（四重检查）
- 交付确认与签收
- 销售财务结算（应收账款）

**核心实体**：
- `Customer`：销售客户
- `SalesOrder`：销售订单（含状态机）
- `OrderConstraintCheck`：约束检查记录
- `DeliveryConfirmation`：交付确认单
- `Settlement`：结算单

**对外接口**：
- `POST /api/sales/orders`：下销售订单（触发约束引擎）
- `POST /api/sales/orders/:id/urgent`：紧急插单（触发 AI 影响分析）
- `PUT /api/sales/orders/:id`：订单修改
- `POST /api/sales/orders/:id/constraint-check`：手动触发约束检查
- `GET /api/sales/orders/:id/impact-analysis`：影响分析查询

**依赖关系**：依赖 master-data（BOM）、inventory（库存查询）、production（排产查询）、ai-agent（约束引擎和影响分析）、notification（审批推送）

---

### 3.6 生产管理模块（production）

**职责边界**：
- 订单优先级计算（交期、插单标记、客户重要性）
- 每日排产计划生成（调用 AI 排产引擎）
- 排产计划确认与手动调整
- 工序任务推送（推送给工人小程序）
- 工序完工上报（工人）
- 生产进度跟踪（订单级、工序级）
- 领料申请发起与仓库确认
- 插单影响分析

**核心实体**：
- `ProductionOrder`：生产工单（关联销售订单）
- `ProductionSchedule`：每日排产计划
- `WorkTask`：工序任务（分配给具体工人）
- `TaskCompletion`：完工上报记录
- `MaterialRequest`：领料申请
- `ProductionException`：异常上报

**对外接口**：
- `GET /api/production/schedule/:date`：获取某日排产计划
- `POST /api/production/schedule/:date/confirm`：确认并下发排产
- `GET /api/production/tasks`：工人任务列表（按 workerId 过滤）
- `POST /api/production/tasks/:id/complete`：工序完工上报
- `POST /api/production/material-request`：发起领料申请
- `GET /api/production/progress`：生产进度看板
- `POST /api/production/impact-analysis`：插单影响分析

**依赖关系**：依赖 master-data（工序配置）、inventory（物料可用性）、sales（订单）、ai-agent（排产算法）、notification（任务推送）

---

### 3.7 质量溯源模块（quality）

**职责边界**：
- 验货单管理（QC 验货员创建、逐件验货）
- 质量问题记录（问题类型、严重程度、图片）
- 溯源链查询（成品 → 部件 → 物料批次/缸号 → 工序 → 工人）
- 溯源数据采集（工人扫码完工时记录）
- 质量统计分析（高频问题识别）

**核心实体**：
- `InspectionOrder`：验货单
- `QualityIssue`：质量问题记录
- `TraceRecord`：溯源数据记录（工序级别，工人完工时写入）
- `TraceChain`：溯源链（查询时动态组装）

**对外接口**：
- `POST /api/quality/inspections`：创建验货单
- `POST /api/quality/inspections/:id/issues`：记录质量问题
- `GET /api/quality/trace/:orderId/:componentId`：溯源链查询
- `POST /api/quality/trace-records`：工序完工时记录溯源数据
- `GET /api/quality/analytics`：质量统计分析

**依赖关系**：依赖 production（工序任务）、inventory（物料批次/缸号）、master-data（产品工序）

---

### 3.8 AI Agent 模块（ai-agent）

**职责边界**：
- 采购建议引擎（缺口计算 + 建议生成 + 置信度评估）
- 排产优化算法（约束条件建模 + 优先级排序）
- 下单约束引擎（四重检查：库存周转/资金占用/生产成本/产能负荷）
- 插单影响分析
- AI 对话助手（意图识别 + 数据检索 + LLM 生成）
- 预警检测（主动分析并触发推送）
- AI 状态管理（思考中、流式输出、错误恢复）

**核心实体**：
- `AIRequest`：AI 请求记录（含输入、输出、耗时、置信度）
- `ChatSession`：对话会话
- `ChatMessage`：对话消息记录
- `ConstraintConfig`：约束阈值配置（四重检查的阈值由老板配置）

**对外接口**：
- `POST /api/ai/chat`：对话接口（SSE 流式）
- `POST /api/ai/purchase-suggestion`：触发采购建议计算
- `POST /api/ai/schedule`：触发排产计划生成
- `POST /api/ai/constraint-check`：约束引擎检查
- `POST /api/ai/impact-analysis`：插单影响分析
- `GET /api/ai/chat/history`：对话历史
- `aiEngine.generateSuggestion()`：供采购模块调用
- `aiEngine.generateSchedule()`：供生产模块调用
- `constraintEngine.check()`：供销售模块调用

**依赖关系**：依赖所有业务模块（数据读取），被采购、生产、销售模块依赖（能力调用）

---

### 3.9 通知推送模块（notification）

**职责边界**：
- 微信订阅消息发送（审批通知、任务推送、预警）
- 站内通知管理
- 推送消息去重（同一物料同日最多推送 1 次预警）
- 推送失败重试
- 推送记录归档

**核心实体**：
- `Notification`：通知记录（含推送状态）
- `NotificationTemplate`：消息模板

**对外接口**：
- `notification.queue` 消费者：异步处理推送任务
- `GET /api/notifications`：站内通知列表
- `POST /api/notifications/:id/read`：标记已读
- `notificationService.send()`：供其他模块调用的推送服务

**依赖关系**：依赖 auth（用户微信 openid）

---

### 3.10 数据分析模块（analytics）

**职责边界**：
- 老板驾驶舱 KPI 数据聚合
- 库存结构分析（含二级品类维度）
- 物料品类成本占比分析（基于 BOM 展开 + 采购价格）
- 采购品类分布分析
- 生产效率分析（工序产能利用率）
- 供应商绩效分析
- 数据导出（Excel/CSV）

**核心实体**：无独立持久化实体，聚合其他模块数据

**对外接口**：
- `GET /api/analytics/dashboard`：驾驶舱 KPI
- `GET /api/analytics/inventory-structure`：库存结构分析
- `GET /api/analytics/bom-cost-breakdown`：BOM 品类成本占比
- `GET /api/analytics/procurement-distribution`：采购品类分布
- `GET /api/analytics/production-efficiency`：生产效率
- `GET /api/analytics/supplier-performance`：供应商绩效
- `POST /api/analytics/export`：数据导出

**依赖关系**：依赖所有业务模块（数据读取）

---

## 四、关键技术方案

### 4.1 BOM 多层展开算法

**数据模型**：

```sql
-- BOM 存储为邻接表（parent_item_id 引用自身）
bom_items (
  id, bom_id, sku_id, parent_item_id,
  quantity DECIMAL(15,4),  -- 以生产领用单位记录
  unit_id, level INT,
  created_at, updated_at
)
```

**递归展开（MySQL WITH RECURSIVE）**：

```sql
-- Phase 1: 一次性展开完整 BOM 树
WITH RECURSIVE bom_tree AS (
  -- 根节点（成品）
  SELECT id, sku_id, parent_item_id, quantity, unit_id, level,
         CAST(quantity AS DECIMAL(20,4)) AS total_qty
  FROM bom_items
  WHERE bom_id = :bomId AND parent_item_id IS NULL

  UNION ALL

  -- 递归展开子节点
  SELECT bi.id, bi.sku_id, bi.parent_item_id, bi.quantity, bi.unit_id, bi.level,
         bom_tree.total_qty * bi.quantity AS total_qty
  FROM bom_items bi
  INNER JOIN bom_tree ON bi.parent_item_id = bom_tree.id
  WHERE bi.bom_id = :bomId
)
SELECT sku_id, SUM(total_qty) as total_qty, unit_id
FROM bom_tree
WHERE level > 0  -- 排除成品本身，只取原材料
GROUP BY sku_id, unit_id;
```

**性能优化**：
- BOM 展开结果缓存至 Redis（Key: `bom:{tenantId}:{bomId}:{version}`，TTL 30 分钟）
- BOM 修改时触发缓存失效（Write-Through 策略）
- 对于复杂 BOM（层级 > 5），限制最大递归深度为 10 层防止死循环

**BOM 版本管理**：
- `bom` 表添加 `version` 字段，每次修改创建新版本
- 订单关联 BOM 时锁定 BOM 版本，避免 BOM 修改影响在制订单

---

### 4.2 AI 采购建议引擎

**Phase 1 规则引擎技术方案**：

**步骤 1：物料需求计算**

```typescript
// 伪代码：需求计算逻辑
async function calculateMaterialRequirements(tenantId: string) {
  // 1. 获取所有"在产"状态的销售订单
  const activeOrders = await getActiveOrders(tenantId);

  // 2. 对每个订单展开 BOM，计算物料需求
  const requirements: Map<string, Decimal> = new Map();
  for (const order of activeOrders) {
    const bomItems = await bomExpansionService.expand(order.bomId);
    for (const item of bomItems) {
      const needed = item.totalQty.mul(order.quantity);
      requirements.set(item.skuId, (requirements.get(item.skuId) ?? new Decimal(0)).add(needed));
    }
  }
  return requirements;
}
```

**步骤 2：缸号匹配逻辑（关键业务规则）**

```typescript
// 面料类 SKU 的可用库存 = 普通库存（非面料）OR 缸号匹配库存（面料）
async function getEffectiveAvailable(skuId: string, orderId: string): Promise<Decimal> {
  const sku = await getSKU(skuId);
  if (sku.category2 !== 'fabric') {
    // 非面料：直接返回库存快照
    return getStockSnapshot(skuId);
  }

  // 面料：只有缸号一致的库存才可用
  const usedDyeLotId = await getOrderUsedDyeLot(orderId, skuId);
  if (!usedDyeLotId) {
    // 订单尚未使用该面料：所有缸号库存均可用
    return getTotalFabricStock(skuId);
  }

  // 订单已使用某缸号：只有该缸号的库存可用（其他缸号不可用，计入缺口）
  return getDyeLotStock(skuId, usedDyeLotId);
}
```

**步骤 3：缺口计算与建议输出**

```typescript
interface PurchaseSuggestionItem {
  skuId: string;
  skuName: string;
  gapQuantity: Decimal;         // 缺口（采购单位）
  suggestedQuantity: Decimal;   // 建议采购量（含安全库存余量）
  suggestedSupplierId: string;  // 推荐供应商（A 级优先）
  dyeLotRequirement?: string;   // 面料类：缸号要求说明
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'; // 置信度
  reasoning: string;            // 中文推理说明
}
```

**置信度规则**：
- HIGH：历史用量数据 >= 30 天，BOM 完整，供应商有有效价格
- MEDIUM：BOM 完整但历史数据 < 30 天，或供应商价格缺失
- LOW：BOM 不完整，或 SKU 首次使用

---

### 4.3 智能排产算法

**Phase 1：优先级贪心调度**

约束条件建模：

```typescript
interface SchedulingConstraints {
  orders: {
    orderId: string;
    priority: number;         // 综合优先级（0-100）
    deadline: Date;
    processes: ProcessStep[]; // 工序列表（顺序约束）
    materialAvailability: Map<string, boolean>; // 物料可用性
  }[];
  workers: {
    workerId: string;
    skills: string[];         // 可执行工序类型
    available: boolean;
  }[];
  workstations: {
    id: string;
    capacity: number;
    processTypes: string[];   // 可执行工序类型
  }[];
}
```

**优先级计算公式**：

```
priority = deadline_urgency * 0.5
         + is_urgent_flag * 0.3
         + customer_importance * 0.15
         + order_value * 0.05

deadline_urgency = max(0, 1 - (deadline - today) / 14)  // 14天为基准，越近越高
```

**排产执行逻辑**（贪心）：
1. 按优先级降序排列待排订单
2. 对每个订单的工序，按顺序分配工人和工作站
3. 物料不可用的工序延后（等待采购到货）
4. 人员冲突时，低优先级订单让步

**插单影响分析**（差分法）：
1. 将插单加入订单池，重新运行排产算法
2. 对比插单前后每个订单的计划完工日期
3. 计算延期天数差值，输出受影响订单列表

**Phase 2 升级**：迁移至 Python + Google OR-Tools（整数规划），支持更复杂约束（换线时间、设备维护窗口）

---

### 4.4 下单智能约束引擎

**四重检查实现**：

```typescript
interface ConstraintCheckResult {
  passed: boolean;
  violations: ConstraintViolation[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  aiSuggestion: string;
}

interface ConstraintViolation {
  type: 'TURNOVER' | 'CAPITAL' | 'COST' | 'CAPACITY';
  currentValue: number;
  threshold: number;
  severity: 'WARNING' | 'BLOCK';
  description: string;
}

// 四重检查
async function checkConstraints(order: NewOrder): Promise<ConstraintCheckResult> {
  const results = await Promise.all([
    checkInventoryTurnover(order),  // (1) 库存周转天数
    checkCapitalOccupancy(order),   // (2) 资金占用
    checkProductionCost(order),     // (3) 生产成本
    checkCapacityLoad(order),       // (4) 产能负荷
  ]);
  // ... 汇总结果
}
```

**阈值管理**：
- 阈值由老板在系统设置中配置（ConstraintConfig 表）
- 默认阈值：库存周转 > 90 天预警 / > 120 天拦截；资金占用 > 80% 预警 / > 100% 拦截
- 不同阈值对应不同处理策略（预警但允许下单 / 拦截须老板审批）

**实时计算策略**：
- 库存周转天数 = 当前库存金额 / 近 30 日日均销售金额，结果缓存 5 分钟
- 资金占用 = 已下单未发货金额 + 在途采购金额，Redis 实时维护
- 产能负荷 = 未来 14 天计划工时 / 总可用工时，排产计划更新时同步计算

---

### 4.5 多单位换算

**精度处理**：使用 `decimal.js` 库进行所有数量计算，避免浮点精度问题。

```typescript
import Decimal from 'decimal.js';

// 单位换算：从源单位换算到目标单位
function convertUnit(
  quantity: Decimal,
  fromUnitId: string,
  toUnitId: string,
  conversions: UnitConversion[]  // 从 SKU 主数据读取
): Decimal {
  if (fromUnitId === toUnitId) return quantity;

  // 统一先换算到基准单位（库存单位），再换算到目标单位
  const toBase = conversions.find(c => c.fromUnitId === fromUnitId);
  const fromBase = conversions.find(c => c.fromUnitId === toUnitId);

  if (!toBase || !fromBase) throw new UnitConversionError('换算关系不存在');

  const baseQuantity = quantity.mul(toBase.factor);          // 换算到库存单位
  return baseQuantity.div(fromBase.factor);                   // 换算到目标单位
}
```

**换算关系存储**：

```sql
unit_conversions (
  id, sku_id, tenant_id,
  from_unit_id,      -- 源单位
  to_unit_id,        -- 目标单位（始终是库存单位）
  factor DECIMAL(18,6),  -- 换算系数（1个源单位 = factor个目标单位）
  PRIMARY KEY (sku_id, from_unit_id)
)
```

**约定**：to_unit 始终为该 SKU 的库存单位（基准单位），所有换算先到库存单位再到目标。

**库存底层存储**：统一以库存单位存储，显示层按需换算。

---

### 4.6 缸号批次管理

**数据模型**：

```sql
-- 缸号批次独立记录，支持同 SKU 多缸号并存
dye_lot_batches (
  id, tenant_id, sku_id,
  dye_lot_code VARCHAR(20) NOT NULL,  -- 缸号编码，最多20字符
  inbound_date DATE,
  current_quantity DECIMAL(15,4),     -- 当前剩余数量（库存单位）
  initial_quantity DECIMAL(15,4),
  status ENUM('ACTIVE', 'EXHAUSTED', 'ARCHIVED'),
  created_at, updated_at
)

-- 出入库记录关联缸号
inventory_records (
  id, tenant_id, sku_id,
  dye_lot_batch_id,          -- 面料类必填，关联 dye_lot_batches
  quantity DECIMAL(15,4),    -- 库存单位
  direction ENUM('IN', 'OUT'),
  ...
)

-- 订单-缸号绑定记录（一旦订单使用了某缸号即锁定）
order_dye_lot_bindings (
  id, tenant_id, sales_order_id, sku_id,
  dye_lot_batch_id,
  bound_at TIMESTAMP,
  is_cross_lot BOOLEAN DEFAULT FALSE  -- 是否跨缸号（车间主管确认后）
)
```

**先进先出逻辑**：

```typescript
// 推荐出库缸号：按入库日期升序，先进先出
async function recommendDyeLotForOutbound(skuId: string, orderId: string): Promise<DyeLotBatch[]> {
  // 检查该订单是否已绑定缸号
  const binding = await getOrderDyeLotBinding(orderId, skuId);
  if (binding) {
    // 已绑定：优先推荐同缸号批次
    const boundBatch = await getDyeLotBatch(binding.dyeLotBatchId);
    const otherBatches = await getOtherBatches(skuId, binding.dyeLotBatchId);
    return [boundBatch, ...otherBatches]; // 绑定缸号排首位
  }

  // 未绑定：按先进先出推荐
  return getDyeLotBatchesByFIFO(skuId);
}
```

**同订单缸号一致性校验**：
- 订单首次领用面料时，记录缸号绑定（`order_dye_lot_bindings`）
- 后续领料时，查询绑定记录，推荐绑定缸号排首位
- 选择不同缸号时，前端弹出强警告，需要填写原因才可提交
- `is_cross_lot = TRUE` 的记录在溯源链中特殊标注

---

### 4.7 溯源链数据采集与查询

**数据采集时机**：

```
工人扫码完工（可选步骤）
    │
    ▼
POST /api/quality/trace-records
    │
    ▼
异步写入 trace.record.queue（Bull）
    │
    ▼
消费者：溯源链记录服务
    │
    ├── 1. 记录工人ID + 工序ID + 完工时间
    ├── 2. 自动关联：从该订单的领料记录中获取使用的物料批次
    ├── 3. 自动关联：面料类物料关联缸号（从 order_dye_lot_bindings）
    └── 4. 写入 trace_records 表
```

**溯源链存储模型**：

```sql
trace_records (
  id, tenant_id,
  sales_order_id,
  product_id,          -- 成品 SKU ID
  component_id,        -- 部件 ID（半成品/零件）
  work_process_id,     -- 工序 ID
  worker_id,           -- 操作工人 ID
  completed_at TIMESTAMP,
  material_batches JSON,  -- [{skuId, batchId, dyeLotId, quantity}]
  is_data_complete BOOLEAN DEFAULT FALSE  -- 是否有扫码记录（影响溯源完整度标注）
)
```

**溯源链查询**（JOIN 拼装，以查询性能换实现简单）：

```sql
-- 给定订单ID，查询完整溯源链
SELECT
  tr.*,
  so.order_no,
  s_product.name as product_name,
  s_component.name as component_name,
  wp.name as process_name,
  u.name as worker_name,
  dlb.dye_lot_code
FROM trace_records tr
JOIN sales_orders so ON tr.sales_order_id = so.id
JOIN skus s_product ON tr.product_id = s_product.id
JOIN skus s_component ON tr.component_id = s_component.id
JOIN work_processes wp ON tr.work_process_id = wp.id
JOIN users u ON tr.worker_id = u.id
LEFT JOIN dye_lot_batches dlb ON JSON_EXTRACT(tr.material_batches, '$[0].dyeLotId') = dlb.id
WHERE tr.sales_order_id = :orderId
ORDER BY tr.completed_at ASC;
```

**查询性能**：
- `sales_order_id` 建立索引
- 溯源链查询频率低（QC 验货时），不做激进缓存，接受 200-500ms 查询时间
- 复杂溯源报告（历史汇总分析）使用定时预计算，写入 analytics 聚合表

---

### 4.8 离线同步方案（微信小程序）

**离线场景分析**：
- 可离线操作：查看缓存的今日任务、录入出入库（写入本地队列）、查看本地缓存库存
- 不可离线操作：实时库存查询（须从服务端取）、AI 建议（需联网调用）、审批操作

**本地缓存策略**：

```typescript
// 微信小程序端缓存设计
const CACHE_KEYS = {
  TODAY_TASKS: 'cache_today_tasks',         // 今日任务（联网时拉取，离线时读取）
  INVENTORY_SNAPSHOT: 'cache_inventory',    // 库存快照（5分钟TTL）
  OFFLINE_QUEUE: 'offline_operation_queue', // 离线操作队列
  USER_INFO: 'cache_user_info',
};

// 离线操作队列（本地持久化）
interface OfflineOperation {
  id: string;           // 本地生成的临时ID
  type: 'INBOUND' | 'OUTBOUND' | 'TASK_COMPLETE';
  payload: object;
  createdAt: number;    // 时间戳，联网后校验时序
  retryCount: number;
}
```

**离线队列同步（联网恢复时）**：

```typescript
// 联网恢复时的同步逻辑
async function syncOfflineOperations() {
  const queue = wx.getStorageSync(CACHE_KEYS.OFFLINE_QUEUE) as OfflineOperation[];
  if (!queue.length) return;

  for (const op of queue) {
    try {
      await submitOperation(op);          // 上传到服务端
      removeFromQueue(op.id);            // 成功后移出队列
    } catch (error) {
      if (error.type === 'CONFLICT') {   // 冲突处理
        showConflictResolutionUI(op, error.serverState);
      }
    }
  }
}
```

**冲突解决策略**：
- 出入库操作：时间戳先到先得（服务端以收到时间为准），离线操作在队列中保留操作时间
- 库存数据：以服务端为权威，离线缓存仅供展示，联网后强制刷新
- 冲突较严重时（如库存已变动导致出库失败）：提示用户手动处理，不自动覆盖

**离线 UI 规范**（对应设计规范中的离线状态条）：
- 检测到离线：顶部橙色条"当前处于离线模式，数据将在联网后同步"
- 联网恢复：`wx.onNetworkStatusChange` 监听，立即触发同步，Toast 通知"已恢复在线，同步数据中..."

---

### 4.9 SaaS 多租户架构

**租户隔离方案：行级隔离（RLS via tenant_id）**

理由：
- 私有化部署客户通常是单租户，数据库级隔离会浪费资源
- 行级隔离在当前数据规模（1000 SKU / 租户）下性能完全满足
- 运维成本最低，不需要为每个租户维护独立 Schema 或数据库

实现方式：

```typescript
// 所有核心业务表均包含 tenant_id 字段
// 中间件自动注入 tenantId，服务层强制过滤

// 1. JWT 中包含 tenantId
const token = {
  userId: 'xxx',
  tenantId: 'tenant_abc',
  role: 'BOSS'
};

// 2. tenantMiddleware 从 JWT 中提取 tenantId 注入 context
app.use(tenantMiddleware);

// 3. 所有数据库查询强制携带 tenantId（通过基础 Repository 类封装）
class BaseRepository {
  protected async findAll(where: object) {
    return this.db.find({ ...where, tenantId: this.ctx.tenantId });
  }
}
```

**SaaS vs 私有化模式切换**：

| 配置项 | SaaS | 私有化 |
|---|---|---|
| `DEPLOY_MODE` | `saas` | `private` |
| `TENANT_MODE` | `multi` | `single` |
| `AI_PROVIDER` | `deepseek-api` | `ollama-local` |
| `STORAGE_TYPE` | `oss` | `minio` |
| `BACKUP_TYPE` | `cloud` | `local` |
| 租户注册 | 自动开通 | 管理员手动创建 |

私有化部署时，`TENANT_MODE=single`，系统自动使用固定 tenantId，无需多租户管理界面。

---

## 五、代码规范

### 5.1 项目目录结构

```
smart-factory-agent/
├── packages/
│   ├── api/                    # Node.js API 服务
│   │   ├── src/
│   │   │   ├── modules/        # 业务模块（见架构图）
│   │   │   │   ├── inventory/
│   │   │   │   │   ├── inventory.controller.ts   # HTTP 路由处理
│   │   │   │   │   ├── inventory.service.ts      # 业务逻辑
│   │   │   │   │   ├── inventory.repository.ts   # 数据访问
│   │   │   │   │   ├── inventory.types.ts        # 模块类型定义
│   │   │   │   │   └── inventory.test.ts         # 单元测试
│   │   │   │   └── ...
│   │   │   ├── shared/
│   │   │   │   ├── middleware/
│   │   │   │   ├── utils/
│   │   │   │   └── errors/
│   │   │   ├── infrastructure/
│   │   │   └── app.ts          # Express 应用入口
│   │   ├── tests/              # 集成测试
│   │   └── package.json
│   │
│   ├── web/                    # React Web 端
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   ├── components/
│   │   │   ├── features/       # 按功能域组织（Feature Sliced Design）
│   │   │   ├── services/       # API 调用层
│   │   │   └── stores/         # Zustand 状态
│   │   └── package.json
│   │
│   ├── miniprogram/            # 微信小程序
│   │   ├── pages/
│   │   ├── components/
│   │   ├── services/           # API 封装
│   │   ├── utils/
│   │   └── app.ts
│   │
│   ├── ai-service/             # Python AI 服务（Phase 2）
│   │   ├── app/
│   │   │   ├── api/
│   │   │   ├── engines/        # 算法引擎
│   │   │   └── models/         # ML 模型
│   │   └── requirements.txt
│   │
│   └── types/                  # 共享类型定义（前后端共用）
│       ├── api.types.ts        # API 请求/响应类型
│       ├── domain.types.ts     # 业务领域类型
│       └── index.ts
│
├── deploy/
│   ├── docker-compose.yml      # 本地开发
│   ├── docker-compose.prod.yml # 私有化部署
│   └── .env.example
│
├── docs/                       # 设计文档
└── package.json                # Monorepo 根配置（pnpm workspace）
```

### 5.2 命名规范

**文件命名**：`kebab-case`（如 `inventory.service.ts`）

**类命名**：`PascalCase`（如 `InventoryService`）

**函数/变量命名**：`camelCase`（如 `calculateMaterialGap`）

**常量命名**：`SCREAMING_SNAKE_CASE`（如 `MAX_RETRY_COUNT`）

**数据库表名**：`snake_case`（如 `inventory_records`）

**API 路径**：`kebab-case`（如 `/api/dye-lot-batches`）

**禁止**：
- 魔法数字（使用命名常量）
- 单字母变量（除循环变量 `i`、`j`）
- 缩写过度（`qty` 可用，`i` 代替 `inventory` 不可用）

### 5.3 分层规范

每层职责严格限定，禁止跨层调用：

```
Controller → Service → Repository → Database
    ↑仅HTTP解析+响应   ↑业务逻辑    ↑纯数据访问

禁止：Controller 直接操作 Repository
禁止：Repository 包含业务逻辑
禁止：Service 处理 HTTP req/res 对象
```

**Service 层规范**：
- 所有业务逻辑在 Service 层
- 跨模块调用通过 Service 接口（不直接访问其他模块的 Repository）
- 事务由 Service 层管理

**Repository 层规范**：
- 只负责数据读写，不包含业务判断
- 所有查询均携带 `tenantId`
- 返回值为领域实体，不返回原始 SQL 结果

### 5.4 错误处理规范

**统一错误类型**：

```typescript
// 所有业务错误继承 AppError
class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly message: string,
    public readonly statusCode: number = 500,
    public readonly details?: object
  ) {
    super(message);
  }
}

// 预定义错误码
enum ErrorCode {
  // 业务错误（4xxx）
  INSUFFICIENT_STOCK = 'E4001',
  DYE_LOT_MISMATCH = 'E4002',
  BOM_INCOMPLETE = 'E4003',
  CONSTRAINT_VIOLATED = 'E4004',
  UNIT_CONVERSION_FAILED = 'E4005',

  // 认证错误（401x）
  TOKEN_EXPIRED = 'E4011',
  PERMISSION_DENIED = 'E4013',

  // 系统错误（5xxx）
  AI_SERVICE_TIMEOUT = 'E5001',
  DATABASE_ERROR = 'E5002',
  EXTERNAL_API_ERROR = 'E5003',
}
```

**统一响应结构**（遵循 CLAUDE.md API 规范）：

```typescript
// 成功响应
{ code: 0, data: object, message: "success" }

// 失败响应
{ code: number, data: null, message: string, errorCode: string }
```

**全局错误处理中间件**：
- 捕获所有未处理异常，转换为统一响应格式
- AppError 按业务码映射 HTTP 状态码
- 未知错误返回 500，不暴露内部细节

### 5.5 日志规范

**日志框架**：`pino`（高性能 JSON 日志，适合生产环境）

**日志级别**：`ERROR > WARN > INFO > DEBUG`

**日志格式（JSON）**：

```json
{
  "timestamp": "2026-03-11T07:30:00.000Z",
  "level": "INFO",
  "module": "inventory",
  "traceId": "req-abc-123",       // 请求追踪 ID
  "tenantId": "tenant_001",
  "userId": "user_456",
  "action": "inbound_created",
  "payload": { "skuId": "xxx", "quantity": 100 },
  "duration": 45                   // 执行耗时（ms）
}
```

**日志规范**：
- 每个 HTTP 请求记录 traceId（从 Header `X-Request-Id` 取或自动生成）
- 所有 AI 请求记录：输入摘要、耗时、token 消耗
- 库存变更操作必须记录 INFO 级别日志（审计用途）
- 敏感数据（供应商报价）在日志中脱敏处理
- 生产环境禁止 DEBUG 级别日志

**日志存储**：
- SaaS：集中写入日志服务（可选 ELK 或云日志服务）
- 私有化：写入本地文件，按天轮转，保留 30 天

---

## 六、性能、扩展性、可维护性设计

### 6.1 缓存策略

**缓存分层**：

```
L1 - 内存缓存（Node.js 进程内，node-lru-cache）
     TTL: 30s，容量: 500条
     用途: SKU 主数据、单位换算关系（高频不变数据）

L2 - Redis 分布式缓存
     TTL: 60s - 30min（按数据类型）
     用途: 库存快照、BOM 展开结果、排产计划

L3 - 数据库（MySQL）
     权威数据源，所有持久化数据
```

**缓存失效策略**：
- 主动失效（Write-Through）：SKU 修改时删除 SKU 缓存；BOM 修改时删除 BOM 展开缓存
- 被动失效（TTL）：库存快照 60 秒后过期（确保 < 5 秒延迟目标的充分余量）

### 6.2 数据库索引策略

**核心表索引设计原则**：

```sql
-- 所有表必须有的索引：tenant_id（多租户过滤）
-- 高频查询字段建联合索引：tenant_id + 业务过滤字段

-- 库存记录表（高频写入）
CREATE INDEX idx_inventory_records_tenant_sku
  ON inventory_records (tenant_id, sku_id, created_at DESC);

-- 缸号批次表（面料缸号查询）
CREATE INDEX idx_dye_lot_batches_tenant_sku
  ON dye_lot_batches (tenant_id, sku_id, status);

-- 订单缸号绑定（缸号一致性校验热路径）
CREATE INDEX idx_order_dye_lot_binding_order_sku
  ON order_dye_lot_bindings (sales_order_id, sku_id);

-- 溯源链查询（按订单查询）
CREATE INDEX idx_trace_records_order
  ON trace_records (tenant_id, sales_order_id);

-- BOM 展开（递归查询）
CREATE INDEX idx_bom_items_bom_parent
  ON bom_items (bom_id, parent_item_id);

-- 采购建议（状态筛选）
CREATE INDEX idx_purchase_suggestions_tenant_status
  ON purchase_suggestions (tenant_id, status, created_at DESC);
```

**慢查询监控**：MySQL slow_query_log 开启，阈值 500ms，每日分析慢查询日志。

### 6.3 API 限流方案

**限流策略**（基于 Redis + express-rate-limit）：

```typescript
// 全局限流：每 IP 每分钟 300 次
// AI 接口限流：每用户每分钟 10 次（AI 计算资源保护）
// 文件上传限流：每用户每分钟 20 次

const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => `${req.tenantId}:${req.userId}`,
  store: new RedisStore({ client: redisClient }),
  message: { code: 429, message: 'AI 请求过于频繁，请稍候再试' }
});
```

### 6.4 监控告警方案

**指标收集**（Prometheus + Grafana 或轻量方案）：

私有化部署采用轻量方案（不要求客户有专业运维）：

```yaml
# docker-compose.yml 中包含轻量监控
services:
  uptime-kuma:    # 可用性监控，可视化 Dashboard
    image: louislam/uptime-kuma

  # API 服务内置 /metrics 端点（prom-client）
  # 关键指标：
  #   - HTTP 请求成功率、P95 响应时间
  #   - 数据库连接池使用率
  #   - Redis 内存使用率
  #   - Bull 队列积压数量
  #   - AI 接口调用成功率和耗时
```

**关键告警阈值**：

| 指标 | 告警条件 | 告警级别 |
|---|---|---|
| API P95 响应时间 | > 2000ms 持续 5 分钟 | WARNING |
| 错误率 | > 1% 持续 2 分钟 | CRITICAL |
| DB 连接池使用率 | > 80% | WARNING |
| AI 服务响应时间 | > 10s | WARNING |
| Bull 队列积压 | `notification.queue` > 100 | WARNING |
| 磁盘使用率 | > 80% | WARNING |

**告警通道**：微信群消息（私有化）/ 钉钉机器人 / 邮件（SaaS）

---

## 七、核心数据库 ER 模型概要

### 7.1 核心实体关系描述

```
Tenant (1) ─── (N) User
Tenant (1) ─── (N) SKU
Tenant (1) ─── (N) Supplier

SKU (1) ─── (N) UnitConversion         -- 多单位换算关系
SKU (1) ─── (N) DyeLotBatch            -- 缸号批次（面料类专用）
SKU (1) ─── (N) SKUInventory (1:1)     -- 库存快照（按缸号分行）

BOM (N) ─── (1) SKU                    -- BOM 属于某成品/半成品
BOM (1) ─── (N) BOMItem
BOMItem (N) ─── (1) SKU               -- BOM 明细关联物料 SKU
BOMItem (N) ─── (1) BOMItem           -- 自引用（多层BOM树，parent_item_id）

SalesOrder (1) ─── (N) ProductionOrder
SalesOrder (1) ─── (1) BOM             -- 订单关联BOM版本
SalesOrder (1) ─── (N) OrderDyeLotBinding

ProductionOrder (1) ─── (N) WorkTask
WorkTask (N) ─── (1) User             -- 工人
WorkTask (N) ─── (1) WorkProcess      -- 工序
WorkTask (1) ─── (N) TaskCompletion
WorkTask (1) ─── (N) TraceRecord      -- 溯源数据

PurchaseOrder (1) ─── (N) PurchaseOrderItem
PurchaseOrder (1) ─── (1) DeliveryNote
PurchaseOrder (1) ─── (1) InventoryRecord (入库)
PurchaseOrder (1) ─── (1) ThreeWayMatch

InventoryRecord (N) ─── (1) SKU
InventoryRecord (N) ─── (1) DyeLotBatch  -- 面料类必须关联缸号

InspectionOrder (N) ─── (1) SalesOrder
InspectionOrder (1) ─── (N) QualityIssue
QualityIssue (1) ─── (N) TraceRecord      -- 质量问题关联溯源链

PurchaseSuggestion (N) ─── (1) SKU
PurchaseSuggestion (N) ─── (1) Supplier
PurchaseSuggestion (1) ─── (1) PurchaseOrder  -- 建议被采纳后

ConstraintConfig (N) ─── (1) Tenant         -- 约束阈值配置
ChatSession (N) ─── (1) User
ChatSession (1) ─── (N) ChatMessage
```

### 7.2 关键表设计要点

**inventory_records（出入库流水）**：
- 不可删除，只能申请撤销（增加一条反向记录）
- direction 字段区分入库/出库
- 携带 `reference_type` + `reference_id` 关联来源单据（采购单/生产单/销售单）
- 面料类出入库必须关联 `dye_lot_batch_id`
- `operation_unit` 记录操作时单位，`quantity_in_base_unit` 记录库存单位数量

**sku_inventory（库存快照）**：
- 这是高频读取的聚合表，用于快速返回当前库存，不重新计算流水
- 与 `inventory_records` 保持最终一致性（通过事务写入）
- 面料类 SKU：每个缸号一行（sku_id + dye_lot_batch_id 联合唯一）

**bom_items（BOM 明细）**：
- 使用邻接表存储树形结构（parent_item_id 自引用）
- `level` 字段记录层级深度，便于查询和递归终止
- 数量以生产领用单位存储（`production_unit`）

**trace_records（溯源记录）**：
- `material_batches` 使用 JSON 列存储批次信息（避免过度范式化，溯源是只读查询）
- `is_data_complete` 标记该条记录是否来自工人扫码（影响前端"数据完整"vs"工序数据缺失"标注）

**constraint_configs（约束阈值配置）**：
- 每个租户一条记录，老板可在系统设置中调整
- `warning_thresholds` 和 `block_thresholds` 分别对应预警阈值和拦截阈值

**ai_requests（AI 请求记录）**：
- 记录所有 AI 调用的输入摘要、输出摘要、耗时、token 消耗、置信度
- 用于 AI 建议准确率回归验证（3 个月后对比建议与实际结果）

---

## 八、API 接口规范摘要

（详细 API 文档由 @senior-backend-engineer 输出）

### 8.1 通用规范

- **Base URL**：`/api/v1`
- **认证**：`Authorization: Bearer {JWT_TOKEN}`
- **租户**：从 JWT 自动解析，无需 Header 传递
- **分页**：`?page=1&pageSize=20`
- **排序**：`?sortBy=createdAt&order=desc`
- **时间格式**：ISO 8601（`2026-03-11T07:30:00.000Z`）
- **数量精度**：所有数量字段返回字符串（避免 JSON 浮点精度丢失）

### 8.2 统一响应结构

```typescript
// 成功
{
  "code": 0,
  "data": { ... },
  "message": "success"
}

// 失败
{
  "code": 1,
  "data": null,
  "message": "库存不足，当前可用库存为 3 个",
  "errorCode": "E4001"
}

// 分页列表
{
  "code": 0,
  "data": {
    "items": [...],
    "total": 100,
    "page": 1,
    "pageSize": 20
  },
  "message": "success"
}
```

### 8.3 AI 流式接口规范（SSE）

```
GET /api/v1/ai/chat/stream?sessionId=xxx

// SSE 事件类型
event: thinking_start
data: { "step": "正在分析库存数据..." }

event: thinking_progress
data: { "step": "正在匹配订单BOM...", "estimatedSeconds": 5 }

event: token
data: { "content": "根据当前库存..." }  // 逐 token 推送

event: done
data: { "confidence": "HIGH", "reasoning": "..." }

event: error
data: { "code": "E5001", "message": "AI 服务繁忙，请稍后重试" }
```

---

## 九、分期实施计划与架构演进

### Phase 1（第 1-6 周）：数字化基础

**架构目标**：
- 搭建基础 API 框架（Express + TypeScript）
- 完成 MySQL Schema 初始化（全量建表）
- 实现核心模块：auth、master-data、inventory、notification
- 微信小程序基础版（出入库录入、任务查看）
- 约束引擎基础版（规则校验）
- Docker Compose 私有化部署包

**不做**：AI Python 服务、LLM 对话、复杂排产算法

### Phase 2（第 7-12 周）：AI 辅助决策

**架构新增**：
- AI 建议引擎（Node.js 规则版）
- 排产算法（贪心调度）
- Bull 任务队列（异步 AI 任务）
- 三单匹配逻辑
- Redis 缓存体系完善

### Phase 3（第 13-20 周）：精细化运营

**架构升级**：
- Python AI 服务上线（FastAPI，ML 模型）
- LLM 对话接入（SSE 流式）
- 质量溯源完整实现
- 数据分析看板
- 监控告警完善

---

## 十、技术约束交付说明

### 给 @senior-backend-engineer

1. 所有业务表包含 `tenant_id` 字段，且建立索引
2. 库存扣减必须使用 Redis 分布式锁，防止并发超卖
3. 所有数量计算使用 `decimal.js`，禁止 JavaScript 原生浮点运算
4. AI 接口超时设置：30 秒后自动终止并触发错误恢复
5. BOM 展开缓存 Key 必须包含 BOM 版本号，避免缓存脏数据

### 给 @senior-frontend-engineer

1. Web 端：React 18 + TypeScript + Vite + React Query + Zustand
2. 微信小程序：原生开发 + TypeScript，不使用跨端框架
3. AI 对话使用 SSE（EventSource）接收流式输出，不使用 WebSocket
4. 所有 API 调用统一通过 `services/api.ts` 封装，含 loading 状态、错误处理、retry 逻辑
5. 离线缓存使用 `wx.setStorageSync`，缓存 Key 规范见架构文档 4.8 节
6. 数量显示统一使用 `decimal.js` 格式化，不直接展示浮点运算结果

---

*架构设计文档 v1.0，2026-03-11*
*@senior-backend-engineer 负责架构设计*
*输入：PRD v1.4 / 用户故事 v1.3 / 原型 v1.4 / 设计规范 v1.0*
*下一步：@senior-backend-engineer 输出数据库设计（database-design.md）和 API 文档（api-docs.md）*
