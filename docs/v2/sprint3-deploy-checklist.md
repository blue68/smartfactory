# Sprint 3 部署检查清单

**文档版本**: v1.0
**生成日期**: 2026-03-14
**生成角色**: DevOps Engineer
**适用分支**: master → main
**前置条件**: QA 验收通过（参见 sprint3-test-cases.md）、Code Review 通过（参见 sprint3-code-review.md）

---

## 目录

1. [数据库变更清单](#1-数据库变更清单)
2. [后端路由注册检查](#2-后端路由注册检查)
3. [CI/CD 配置检查](#3-cicd-配置检查)
4. [环境变量检查](#4-环境变量检查)
5. [部署步骤（按顺序）](#5-部署步骤按顺序)
6. [回滚方案](#6-回滚方案)
7. [上线检查清单](#7-上线检查清单)

---

## 1. 数据库变更清单

### 1.1 检查结论

**结论: PASS — 所有 DDL 均已写入 `infra/db/init.sql`，使用 `CREATE TABLE IF NOT EXISTS` 和 `ADD COLUMN IF NOT EXISTS`，具备幂等性。**

**关键风险**: 6 个 ALTER TABLE 语句直接写入了 `init.sql`（初始化脚本），而非独立迁移文件。对于已有运行实例，`init.sql` 不会被 Docker 重新执行，这些 ALTER 变更**必须通过专用迁移脚本**（`services/api/src/migrations/`）才能应用到生产环境。当前目录中不存在 Sprint 3 迁移文件，这是本次部署的最高风险项。

---

### 1.2 新增表（6 张）

| 编号 | 表名 | 用途 | 所属模块 | 状态 |
|------|------|------|----------|------|
| S3-01 | `incoming_inspection_records` | 来料质检单主表 | /api/incoming-inspections | init.sql 已包含 |
| S3-02 | `incoming_inspection_items` | 来料质检明细表 | /api/incoming-inspections | init.sql 已包含 |
| S3-03 | `return_orders` | 退货单主表 | /api/return-orders | init.sql 已包含 |
| S3-04 | `return_order_items` | 退货单明细表 | /api/return-orders | init.sql 已包含 |
| S3-05 | `bom_version_snapshots` | BOM 版本快照（工单锁定用） | /api/production (BD-001) | init.sql 已包含 |
| S3-06 | `material_requirements` | 原材料需求计划（MRP） | /api/mrp | init.sql 已包含 |

**新表关键约束说明**:

- `incoming_inspection_records.inspection_no` — UNIQUE KEY `uk_tenant_inspection_no`，格式 `IQC-YYYYMMDD-NNNN`，应用层需保证序号生成不重复
- `return_orders.return_no` — UNIQUE KEY `uk_tenant_return_no`，格式 `RTN-YYYYMMDD-NNNN`，同上
- `bom_version_snapshots.snapshot_hash` — 存储 `snapshot_data` 的 SHA256 摘要，应用层需在写入前计算并填充，不可为空
- `material_requirements` — 无 UNIQUE KEY，依赖 `(production_order_id, sku_id)` 业务唯一性，应用层需做防重处理

---

### 1.3 现有表结构变更（6 个 ALTER TABLE）

| 编号 | 目标表 | 变更内容 | 影响评估 |
|------|--------|----------|----------|
| S3-A1 | `production_orders` | 新增 `bom_snapshot_id`（BIGINT, nullable）、`material_status`（ENUM, DEFAULT 'unchecked'） | 存量记录 `material_status` 自动填充默认值，无破坏性 |
| S3-A2 | `production_tasks` | 修改 `status` 枚举扩展为含 `exception`、`suspended`；新增 `version`（INT, DEFAULT 1） | **MODIFY COLUMN 会重建列**，在大表上执行时间可能较长，需在低峰期执行或使用 pt-online-schema-change |
| S3-A3 | `delivery_notes` | 新增 `inspection_id`（BIGINT, nullable）、`receipt_id`（BIGINT, nullable） | 存量记录均为 NULL，无破坏性 |
| S3-A4 | `purchase_order_items` | 新增 `qty_passed`（DECIMAL, DEFAULT 0）、`qty_rejected`（DECIMAL, DEFAULT 0） | 存量记录自动填充 0，无破坏性 |
| S3-A5 | `process_steps` | 新增 `output_type`（ENUM, DEFAULT 'none'）、`output_sku_id`（BIGINT, nullable） | 存量记录自动填充默认值，无破坏性 |
| S3-A6 | `purchase_suggestions` | 新增 `source`（ENUM, DEFAULT 'ai_schedule'）、`production_order_id`（BIGINT, nullable） | 存量记录自动填充默认值，无破坏性 |

---

### 1.4 迁移脚本缺口分析（高风险）

**现有迁移文件**（`services/api/src/migrations/`）：

```
M20260312_sprint1_r02_r03.sql
V2_sprint1_r01_r05.sql
V2_sprint1_r06_task_exceptions.sql
V2_sprint1_submit_count.sql
V2_sprint1_work_calendar.sql
V2_sprint1b_r07_r08.sql
```

**发现**: 无任何 Sprint 3 迁移文件。6 个 ALTER TABLE 语句仅存在于 `init.sql`，对于已运行的生产数据库**不会自动执行**。

**必须在部署前创建**:

```
services/api/src/migrations/V2_sprint3_schema.sql
```

文件内容应包含全部 6 条 ALTER TABLE 语句（`ADD COLUMN IF NOT EXISTS` 保证幂等），以及创建 6 张新表的 DDL（`CREATE TABLE IF NOT EXISTS`）。`infra/db/migrate.sh` 会按文件名排序自动执行，命名前缀须确保排在所有 sprint1 文件之后。

---

## 2. 后端路由注册检查

### 2.1 检查说明

以下检查需在部署前人工或通过 `grep` 确认 `services/api/src/app.ts` 中路由注册情况。本次检查基于模块文件实际存在的路由文件进行推断。

---

### 2.2 新增模块路由

| 路由前缀 | 模块目录 | 路由文件 | 文件存在 | 需在 app.ts 注册 |
|----------|----------|----------|----------|-----------------|
| `/api/incoming-inspections` | `modules/incoming-inspection/` | `incomingInspection.routes.ts` | 已确认存在 | 需确认 |
| `/api/return-orders` | `modules/return-order/` | `returnOrder.routes.ts` | 已确认存在 | 需确认 |
| `/api/mrp` | 待确认 | 待确认 | 需检查 | 需确认 |
| `/api/purchase-suggestions` | `modules/purchase/` | `purchaseSuggestion.routes.ts` | 已确认存在 | 需确认 |

---

### 2.3 生产模块新增路由（production.routes.ts）

生产模块路由文件 `services/api/src/modules/production/production.routes.ts` 已确认包含以下 Sprint 3 新增路由：

| HTTP 方法 | 路径 | 处理器 | 权限 | 状态 |
|-----------|------|--------|------|------|
| POST | `/orders/from-sales-order/:salesOrderId` | `productionOrderController.createFromSalesOrder` | supervisor, boss | 已注册 |
| GET | `/orders/:id/materials` | `productionOrderController.getMaterialRequirements` | 已登录用户 | 已注册 |
| GET | `/orders/:id/material-check` | `productionOrderController.checkMaterialStatus` | 已登录用户 | 已注册 |
| PUT | `/orders/:id/cancel` | `productionOrderController.cancelOrder` | supervisor, boss | 已注册 |

**路由顺序风险**: `POST /orders/from-sales-order/:salesOrderId` 已正确置于 `GET /orders/:id` 之前，避免参数路由遮蔽，顺序正确。

---

### 2.4 依赖的新控制器文件

| 文件 | 用途 |
|------|------|
| `modules/production/production-order.controller.ts` | Sprint 3 生产工单扩展控制器，处理 `createFromSalesOrder`、`getMaterialRequirements`、`checkMaterialStatus`、`cancelOrder` |

部署前需确认该文件已编译进 `dist/` 产物。

---

## 3. CI/CD 配置检查

### 3.1 CI 流水线（`.github/workflows/ci.yml`）

**结论: 无需修改，现有配置可覆盖 Sprint 3 新增代码。**

| 检查项 | 当前配置 | Sprint 3 适配状态 |
|--------|----------|------------------|
| 触发路径 | `services/**` | 覆盖所有新增模块，无需修改 |
| 后端单元测试 | `npm run test:unit` | 需确认 Sprint 3 新模块的单测已补充 |
| 集成测试数据库 | MySQL 8.0 + `smart_factory_test` | 正常 |
| CI 中 init.sql 加载 | `mysql ... < ../../infra/db/init.sql` | Sprint 3 新表已包含在 init.sql，CI 自动获益 |
| CI 中迁移脚本执行 | `ls src/migrations/*.sql \| sort` | Sprint 3 迁移文件一旦创建，CI 会自动执行 |
| 前端检查 | lint + typecheck + unit test | 无需修改 |
| CI Gate | 三个 job 全部通过才放行 | 无需修改 |

**发现的注意事项**:

CI 集成测试阶段执行 `init.sql` 时，其中包含针对 `sf_app` 用户的 `GRANT ALL PRIVILEGES ON smart_factory_test.*`，但 CI 环境使用的用户名是 `sfuser`。CI 脚本已有回退逻辑（先 `sfuser`，失败则用 `root`），目前可正常工作，但建议后续统一用户名。

---

### 3.2 CD 流水线（`.github/workflows/deploy.yml`）

**结论: 无需修改，现有配置已支持 Sprint 3 部署。**

| 检查项 | 当前配置 | 状态 |
|--------|----------|------|
| 触发条件 | `main` 分支 push，路径含 `services/**`、`infra/**` | 正确，infra/db/init.sql 变更可触发 CD |
| 镜像构建 | `docker/build-push-action@v5`，推送到 GHCR | 无需修改 |
| 部署方式 | SSH 连接服务器，执行 `bash infra/db/migrate.sh` | 关键：依赖 Sprint 3 迁移脚本存在 |
| 滚动更新 | `order: start-first`，`failure_action: rollback` | 支持零停机更新 |
| 健康检查 | `curl -sf http://localhost:3000/health`，等待 60s | 正常 |
| 旧镜像清理 | `docker image prune -f --filter "until=168h"` | 正常 |

**关键依赖**: CD 部署脚本执行 `bash infra/db/migrate.sh`，该脚本从 `services/api/src/migrations/` 读取 SQL 文件。若 Sprint 3 迁移文件未创建，CD 部署后 6 个 ALTER TABLE 将不会执行，导致新代码操作不存在的列，产生运行时错误。

---

### 3.3 Docker 配置检查

| 文件 | 检查项 | 状态 |
|------|--------|------|
| `services/api/Dockerfile` | Node 20 Alpine，多阶段构建，非 root 用户运行 | 无需修改 |
| `services/api/Dockerfile` | bcrypt 原生编译依赖已处理（python3/make/g++） | 正常 |
| `docker-compose.yml` | `init.sql` 挂载路径：`./infra/db/init.sql:/docker-entrypoint-initdb.d/01-init.sql:ro` | 正常 |
| `docker-compose.yml` | API 服务健康检查：`wget -qO- http://localhost:3000/health` | 正常 |
| `docker-compose.prod.yml` | API 生产副本数：`replicas: 2`，滚动更新 `parallelism: 1` | 正常 |
| `docker-compose.prod.yml` | API 内存限制：768M / CPU 1.5 核 | Sprint 3 新增 MRP 计算逻辑，建议评估是否需要调整至 1G |

---

## 4. 环境变量检查

### 4.1 Sprint 3 新增环境变量

**结论: Sprint 3 新增模块（来料质检、退货、MRP、采购建议）均为纯数据库业务逻辑，不引入新的外部服务依赖，无需新增环境变量。**

---

### 4.2 现有环境变量完整性确认

以下变量为运行 Sprint 3 所有功能必须存在的完整列表，对照 `.env.example` 确认：

| 变量名 | 用途 | 是否必填 | 备注 |
|--------|------|----------|------|
| `DB_HOST` | MySQL 主机 | 必填 | 容器内为 `mysql` |
| `DB_PORT` | MySQL 端口 | 必填 | 默认 3306 |
| `DB_NAME` | 数据库名 | 必填 | `smart_factory` |
| `DB_USER` | 应用账号 | 必填 | `sf_app` |
| `DB_PASS` | 应用密码 | 必填 | 替换 `CHANGE_ME` |
| `DB_ROOT_PASSWORD` | Root 密码（容器初始化） | 必填 | 替换 `CHANGE_ME` |
| `DB_POOL_SIZE` | 连接池大小 | 选填 | 默认 10，Sprint 3 MRP 批量查询建议调整为 15 |
| `REDIS_PASSWORD` | Redis 密码 | 必填 | 替换 `CHANGE_ME` |
| `JWT_SECRET` | JWT 签名密钥 | 必填 | 至少 32 字符，替换 `CHANGE_ME` |
| `JWT_REFRESH_SECRET` | Refresh Token 密钥 | 必填 | 与 `JWT_SECRET` 不同 |
| `JWT_EXPIRES_IN` | Token 有效期 | 选填 | 默认 7d |
| `CORS_ORIGINS` | 跨域白名单 | 必填（生产） | 不可使用通配符 `*` |
| `LOG_LEVEL` | 日志级别 | 选填 | 生产建议 `warn` |
| `AI_ENGINE_URL` | AI 引擎地址 | 选填 | Sprint 3 暂不依赖 |
| `OPENAI_API_KEY` | OpenAI 密钥 | 选填 | Sprint 3 暂不依赖 |

**生产环境部署前必须替换所有 `CHANGE_ME` 占位值。**

---

### 4.3 GitHub Actions Secrets 检查

CD 流水线依赖以下 Repository Secrets，部署前确认已在 GitHub 仓库 Settings → Secrets 中配置：

| Secret 名称 | 用途 |
|-------------|------|
| `DEPLOY_HOST` | 生产服务器 IP 或域名 |
| `DEPLOY_USER` | SSH 登录用户名 |
| `DEPLOY_SSH_KEY` | SSH 私钥（PEM 格式） |
| `DEPLOY_PATH` | 服务器上项目路径（默认 `/opt/smart-factory`） |

---

## 5. 部署步骤（按顺序）

> 部署前提：QA 测试通过，Code Review 通过，PR 已合并到 main 分支。

### Step 1 — 创建 Sprint 3 数据库迁移脚本（上线前必做）

在本地执行，创建迁移文件并提交：

```bash
# 文件名前缀须排在 V2_sprint1b_r07_r08.sql 之后
# 使用字母顺序排序，V2_sprint3_ > V2_sprint1_ 成立
touch services/api/src/migrations/V2_sprint3_schema.sql
```

文件内容需包含：

1. `CREATE TABLE IF NOT EXISTS` — 全部 6 张新表（从 init.sql 第 1178-1321 行复制）
2. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — 全部 6 条 ALTER 语句（从 init.sql 第 1327-1377 行复制）
3. `ALTER TABLE production_tasks MODIFY COLUMN` — 枚举扩展（S3-A2，注意此语句不支持 IF NOT EXISTS，需判断幂等）

```bash
# 提交迁移文件
git add services/api/src/migrations/V2_sprint3_schema.sql
git commit -m "chore(db): add Sprint 3 migration script for 6 new tables and 6 ALTER TABLE"
git push origin main
```

---

### Step 2 — 确认 CI 通过

```
GitHub Actions → CI workflow → 等待所有 job 绿色
  - API typecheck + unit test
  - API integration test（含迁移脚本执行）
  - Web lint + typecheck + unit test
  - CI Gate 汇总通过
```

---

### Step 3 — 备份生产数据库

在生产服务器执行，CD 自动部署前手动备份：

```bash
# 登录生产服务器
ssh ${DEPLOY_USER}@${DEPLOY_HOST}

# 执行备份（使用只读备份账号，参见 init.sql 注释说明）
docker exec sf_mysql mysqldump \
  -u sf_backup -p \
  --single-transaction \
  --routines \
  --triggers \
  smart_factory \
  > /opt/backup/smart_factory_$(date +%Y%m%d_%H%M%S)_pre_sprint3.sql

# 确认备份文件大小合理（非空）
ls -lh /opt/backup/smart_factory_*pre_sprint3*
```

---

### Step 4 — 执行数据库迁移

```bash
# 在生产服务器项目目录中执行
cd /opt/smart-factory
git pull origin main

# 执行迁移脚本（幂等，已执行过的文件会跳过）
bash infra/db/migrate.sh

# 验证新表已创建
docker exec sf_mysql mysql -u sf_app -p smart_factory \
  -e "SHOW TABLES LIKE 'incoming_inspection%';
      SHOW TABLES LIKE 'return_order%';
      SHOW TABLES LIKE 'bom_version_snapshots';
      SHOW TABLES LIKE 'material_requirements';"

# 验证 ALTER TABLE 已执行
docker exec sf_mysql mysql -u sf_app -p smart_factory \
  -e "DESCRIBE production_orders;" | grep -E "bom_snapshot_id|material_status"

docker exec sf_mysql mysql -u sf_app -p smart_factory \
  -e "DESCRIBE production_tasks;" | grep -E "version|exception|suspended"

docker exec sf_mysql mysql -u sf_app -p smart_factory \
  -e "DESCRIBE purchase_suggestions;" | grep -E "source|production_order_id"
```

---

### Step 5 — 触发 CD 部署（或手动滚动更新）

**方式 A：由 CI/CD 自动触发（推荐）**

Step 1 的 commit push 到 main 后，GitHub Actions Deploy workflow 自动执行，无需手工介入。

**方式 B：手动执行（紧急情况）**

```bash
cd /opt/smart-factory
export IMAGE_TAG=<目标 commit SHA 前 7 位>
export REGISTRY=ghcr.io
export IMAGE_REPO=<github_org/repo_name>

# 拉取新镜像
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull api web

# 滚动更新（start-first，不中断服务）
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --no-deps api web
```

---

### Step 6 — 健康检查与冒烟测试

```bash
# API 健康端点
curl -sf http://localhost:3000/health

# Sprint 3 新路由冒烟测试（需有效 JWT）
TOKEN="<登录获取的 JWT>"

# 来料质检列表
curl -sf -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/incoming-inspections

# 退货单列表
curl -sf -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/return-orders

# 采购建议列表
curl -sf -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/purchase-suggestions

# MRP 查询（需存在生产工单 ID）
curl -sf -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/mrp

# 生产模块新路由：物料需求（替换 {id} 为实际工单 ID）
curl -sf -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/production/orders/{id}/material-check"
```

---

### Step 7 — 清理与收尾

```bash
# 清理超过 7 天的旧镜像
docker image prune -f --filter "until=168h"

# 确认容器状态均为 healthy
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

---

## 6. 回滚方案

### 6.1 应用层回滚

```bash
cd /opt/smart-factory

# 查看可回滚的镜像版本（最近部署历史）
docker images | grep smart-factory-api

# 指定上一个稳定版本 TAG 回滚
export IMAGE_TAG=<上一个稳定版本的 commit SHA>
export REGISTRY=ghcr.io
export IMAGE_REPO=<github_org/repo_name>

docker compose -f docker-compose.yml -f docker-compose.prod.yml pull api web
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --no-deps api web
```

---

### 6.2 数据库回滚

**Sprint 3 的 DDL 操作均为加法操作（新增表、新增列），不删除或修改现有列的数据类型（除 S3-A2 的枚举扩展外），回滚风险较低。**

**情形 A — 回滚应用代码，保留数据库变更（推荐）**

只回滚应用镜像到 Sprint 2 版本，不执行数据库回滚。Sprint 3 新增的列（均有 DEFAULT 值）和新表对 Sprint 2 代码透明，不产生破坏性影响。

**情形 B — 必须完全回滚数据库（紧急情况）**

```bash
# 仅在业务数据量极小、新表无业务数据时执行
# 使用部署前备份文件还原（Step 3 生成的备份）
docker exec -i sf_mysql mysql \
  -u root -p smart_factory \
  < /opt/backup/smart_factory_<timestamp>_pre_sprint3.sql
```

**注意**: 情形 B 会丢失备份点之后的所有业务数据，仅限于在部署后极短时间内（数据无变更或可接受丢失）使用。

---

### 6.3 S3-A2 特殊说明（枚举扩展回滚）

`production_tasks.status` 枚举扩展添加了 `exception` 和 `suspended` 两个值。若任务表中已有数据使用了这两个新状态，回滚枚举定义将导致这些行成为无效状态。回滚前需确认：

```sql
SELECT COUNT(*) FROM production_tasks
WHERE status IN ('exception', 'suspended');
```

若返回 0，可安全执行枚举回滚；若大于 0，需先将这些记录状态迁移回合法值。

---

### 6.4 回滚决策矩阵

| 故障现象 | 回滚范围 | 预计耗时 |
|----------|----------|----------|
| 新路由 5xx 错误，存量功能正常 | 仅应用镜像回滚（情形 A） | 3-5 分钟 |
| 数据库迁移失败，应用未启动 | 修复迁移脚本重试，或恢复备份 | 15-30 分钟 |
| 存量功能受损 | 应用镜像 + 数据库备份（情形 B） | 30-60 分钟 |
| 服务完全不可用 | 立即回滚镜像，同步评估 DB 状态 | 5-10 分钟 |

---

## 7. 上线检查清单

执行人在每项完成后打勾确认，所有项通过后方可宣布上线成功。

### 7.1 部署前置条件

- [ ] QA 验收报告已确认通过（参见 sprint3-test-cases.md）
- [ ] Code Review 已通过（参见 sprint3-code-review.md）
- [ ] APPROVAL-sprint3.md 已由 Engineering Manager 签署
- [ ] Sprint 3 迁移文件 `V2_sprint3_schema.sql` 已创建并合并到 main
- [ ] 生产数据库备份已完成，备份文件大小正常（非空）
- [ ] GitHub Actions Secrets（DEPLOY_HOST、DEPLOY_USER、DEPLOY_SSH_KEY）已配置
- [ ] 生产环境 `.env` 中所有 `CHANGE_ME` 已替换为真实值

### 7.2 数据库变更验证

- [ ] `incoming_inspection_records` 表已创建，`inspection_no` UNIQUE KEY 存在
- [ ] `incoming_inspection_items` 表已创建
- [ ] `return_orders` 表已创建，`return_no` UNIQUE KEY 存在
- [ ] `return_order_items` 表已创建
- [ ] `bom_version_snapshots` 表已创建，`snapshot_hash` 列存在
- [ ] `material_requirements` 表已创建
- [ ] `production_orders` 含新列 `bom_snapshot_id`、`material_status`
- [ ] `production_tasks` status 枚举含 `exception`、`suspended`；含新列 `version`
- [ ] `delivery_notes` 含新列 `inspection_id`、`receipt_id`
- [ ] `purchase_order_items` 含新列 `qty_passed`、`qty_rejected`
- [ ] `process_steps` 含新列 `output_type`、`output_sku_id`
- [ ] `purchase_suggestions` 含新列 `source`、`production_order_id`
- [ ] `migration_history` 表中 `V2_sprint3_schema.sql` 已记录为已执行

### 7.3 路由注册验证

- [ ] `GET /api/incoming-inspections` 返回 200 或 401（非 404）
- [ ] `GET /api/return-orders` 返回 200 或 401（非 404）
- [ ] `GET /api/mrp` 返回 200 或 401（非 404）
- [ ] `GET /api/purchase-suggestions` 返回 200 或 401（非 404）
- [ ] `GET /api/production/orders/{id}/materials` 返回 200 或 401（非 404）
- [ ] `GET /api/production/orders/{id}/material-check` 返回 200 或 401（非 404）
- [ ] `PUT /api/production/orders/{id}/cancel` 返回 200 或 401/403（非 404）
- [ ] `POST /api/production/orders/from-sales-order/{salesOrderId}` 返回 200 或 401/403（非 404）

### 7.4 CI/CD 流水线验证

- [ ] CI workflow 全部 job 显示绿色（api-unit、api-integration、web、ci-gate）
- [ ] CD workflow 部署 job 显示成功
- [ ] Docker 容器状态：`sf_mysql`、`sf_redis`、`sf_api`、`sf_web` 均为 `healthy`
- [ ] API 日志中无 `ER_NO_SUCH_TABLE`、`ER_BAD_FIELD_ERROR` 类型错误

### 7.5 存量功能回归验证

- [ ] `POST /api/auth/login` 正常返回 JWT
- [ ] `GET /api/production/orders` 正常返回工单列表（存量数据未丢失）
- [ ] `GET /api/purchase-orders` 正常返回采购订单
- [ ] `GET /api/sales-orders` 正常返回销售订单
- [ ] `GET /api/inventory` 正常返回库存数据

### 7.6 监控与告警

- [ ] 确认日志聚合系统（api_logs volume）正常收集新模块日志
- [ ] 确认 `/health` 端点响应时间 < 200ms
- [ ] 部署后 15 分钟内未收到告警通知
- [ ] 数据库慢查询日志（slow_query_log）中无 Sprint 3 新查询报警

---

## 附录：关键文件路径速查

| 文件 | 路径 |
|------|------|
| 数据库初始化脚本 | `/Users/kongwen/claude_wk/ai-software-company/infra/db/init.sql` |
| 数据库迁移执行脚本 | `/Users/kongwen/claude_wk/ai-software-company/infra/db/migrate.sh` |
| Sprint 3 迁移文件（待创建） | `services/api/src/migrations/V2_sprint3_schema.sql` |
| CI 工作流 | `.github/workflows/ci.yml` |
| CD 工作流 | `.github/workflows/deploy.yml` |
| Docker Compose（开发） | `docker-compose.yml` |
| Docker Compose（生产覆盖） | `docker-compose.prod.yml` |
| API Dockerfile | `services/api/Dockerfile` |
| 环境变量模板 | `.env.example` |
| 生产模块路由 | `services/api/src/modules/production/production.routes.ts` |
| 来料质检路由 | `services/api/src/modules/incoming-inspection/incomingInspection.routes.ts` |
| 退货模块路由 | `services/api/src/modules/return-order/returnOrder.routes.ts` |
| 采购建议路由 | `services/api/src/modules/purchase/purchaseSuggestion.routes.ts` |

---

*本文档由 DevOps Engineer 基于 Sprint 3 代码实际状态生成，部署执行人须对照本清单逐项确认。任何检查项未通过均需在上线前解决或由 Engineering Manager 批准豁免。*
