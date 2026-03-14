# Sprint 4 部署就绪检查清单

**文档版本**: v1.0
**生成日期**: 2026-03-14
**生成角色**: DevOps Engineer
**适用分支**: master → main
**前置条件**: QA 验收通过（参见 sprint4-test-cases.md）、Code Review 通过（参见 sprint4-code-review.md，Critical/High 问题已修复）

---

## 目录

1. [依赖变更（BullMQ）](#1-依赖变更bullmq)
2. [环境变量（Redis 配置）](#2-环境变量redis-配置)
3. [数据库迁移步骤](#3-数据库迁移步骤)
4. [启动流程变更（Workers、cron job）](#4-启动流程变更workerscron-job)
5. [监控建议](#5-监控建议)
6. [回滚策略](#6-回滚策略)
7. [部署前检查清单](#7-部署前检查清单)
8. [部署后验证清单](#8-部署后验证清单)

---

## 1. 依赖变更（BullMQ）

### 1.1 新增依赖概览

| 包名 | 版本 | 用途 | 引入方式 |
|------|------|------|----------|
| `bullmq` | ^5.71.0 | 生产级 Redis 消息队列（Queue + Worker） | `dependencies` |

**注意**：`package.json` 中同时存在 `bull@^4.16.0` 和 `bullmq@^5.71.0`，两个库共存于同一进程。

- `bull` 负责 Sprint 3 及之前的存量队列，Redis Key 前缀为 `bull:`
- `bullmq` 负责 Sprint 4 引入的三个新队列，Redis Key 前缀为 `erp_bullmq`
- 两套前缀完全隔离，**不存在 Key 命名冲突**

### 1.2 Docker 镜像构建影响

`bullmq@5.x` 无原生 C++ 扩展，纯 JS 实现，不需要额外编译工具链。现有 `services/api/Dockerfile` 的多阶段构建（Node 20 Alpine + python3/make/g++）无需修改，`npm ci` 可直接安装。

### 1.3 部署前验证命令

```bash
# 在构建产物中确认 bullmq 已安装
docker run --rm <image>:<tag> node -e "require('bullmq'); console.log('bullmq OK')"

# 确认 bull 和 bullmq 共存无冲突
docker run --rm <image>:<tag> node -e "require('bull'); require('bullmq'); console.log('both OK')"
```

---

## 2. 环境变量（Redis 配置）

### 2.1 Sprint 4 新增/强制依赖的环境变量

Sprint 4 引入 BullMQ，Worker 在进程启动时（import 阶段）立即建立独立 Redis 连接。以下变量在 Sprint 3 已存在，但从 Sprint 4 起**从可选变为强制必填**：

| 变量名 | 读取位置 | 默认值 | 生产要求 |
|--------|---------|--------|----------|
| `REDIS_HOST` | `src/shared/queue.config.ts` `getBullMQConnectionOptions()` | `localhost` | **必须**设为实际 Redis 主机名或 IP |
| `REDIS_PORT` | 同上 | `6379` | 确认与 Redis 服务端口一致 |
| `REDIS_PASSWORD` | 同上 | `undefined`（无密码） | **生产必须**设置强密码 |
| `REDIS_DB` | 同上 | `0` | 建议 BullMQ 与业务缓存共用 DB 0（前缀隔离），或根据容量规划独立 DB |

**关键技术说明**：`getBullMQConnectionOptions()` 中 `maxRetriesPerRequest: null` 为 BullMQ 必需配置（支持 BLPOP 等阻塞命令），`enableReadyCheck: false` 避免 Worker 启动时因就绪检查失败而报错。这两项已在代码中固定，运维无需额外配置。

### 2.2 Sprint 4 完整环境变量清单

以下为运行 Sprint 4 所有功能的完整变量表。在部署前对照生产环境 `.env` 逐行确认：

| 变量名 | 用途 | 是否必填 | Sprint 4 变化 |
|--------|------|----------|--------------|
| `DB_HOST` | MySQL 主机 | 必填 | 无变化 |
| `DB_PORT` | MySQL 端口 | 必填 | 无变化 |
| `DB_NAME` | 数据库名 | 必填 | 无变化 |
| `DB_USER` | 应用账号 | 必填 | 无变化 |
| `DB_PASS` | 应用密码 | 必填 | 无变化 |
| `DB_ROOT_PASSWORD` | Root 密码（容器初始化） | 必填 | 无变化 |
| `DB_POOL_SIZE` | 连接池大小 | 选填 | **建议从 15 调整至 20**：BullMQ Worker 并发（MrpWorker×3 + SuggestionWorker×1 + NotificationWorker×5）最多同时使用 9 个数据库连接，加上 HTTP 请求并发，连接池需适当扩容 |
| `REDIS_HOST` | Redis 主机 | **必填（Sprint 4 强制）** | **新增强制要求** |
| `REDIS_PORT` | Redis 端口 | **必填（Sprint 4 强制）** | **新增强制要求** |
| `REDIS_PASSWORD` | Redis 密码 | **必填（生产）** | **新增强制要求** |
| `REDIS_DB` | Redis 数据库编号 | 选填 | 新增，默认 0 |
| `JWT_SECRET` | JWT 签名密钥 | 必填 | 无变化（启动时强制校验长度 ≥ 32 位） |
| `JWT_REFRESH_SECRET` | Refresh Token 密钥 | 必填 | 无变化 |
| `JWT_EXPIRES_IN` | Token 有效期 | 选填 | 无变化 |
| `CORS_ORIGINS` | 跨域白名单 | 必填（生产） | 无变化 |
| `LOG_LEVEL` | 日志级别 | 选填 | 无变化 |
| `PORT` | API 监听端口 | 选填 | 无变化，默认 3000 |
| `NODE_ENV` | 运行环境 | 必填（生产） | 无变化，生产须设为 `production` |

### 2.3 GitHub Actions Secrets 确认

Sprint 4 不引入新的 Secrets，确认以下已配置：

| Secret 名称 | 用途 |
|-------------|------|
| `DEPLOY_HOST` | 生产服务器 IP 或域名 |
| `DEPLOY_USER` | SSH 登录用户名 |
| `DEPLOY_SSH_KEY` | SSH 私钥（PEM 格式） |
| `DEPLOY_PATH` | 服务器上项目路径（默认 `/opt/smart-factory`） |

---

## 3. 数据库迁移步骤

### 3.1 迁移脚本概览

**迁移文件**: `services/api/src/migrations/V2_sprint4_schedule_tables.sql`

| 操作类型 | 对象 | 幂等性 | 说明 |
|----------|------|--------|------|
| `CREATE TABLE IF NOT EXISTS` | `schedule_suggestions` | 是 | 调度建议批次表，含 BullMQ job_id 追踪字段 |
| `CREATE TABLE IF NOT EXISTS` | `schedule_suggestion_items` | 是 | 调度建议明细表（采购/排产共表） |
| `CREATE TABLE IF NOT EXISTS` | `suggestion_audit_logs` | 是 | 建议审计日志表 |
| `DROP PROCEDURE IF EXISTS` + `CREATE PROCEDURE` + `CALL` + `DROP PROCEDURE` | `sp_s4_add_purchase_suggestion_columns` | 是 | 通过存储过程+INFORMATION_SCHEMA幂等扩展 `purchase_suggestions` 表 9 个字段 |

**新增字段（purchase_suggestions 表）**：`approved_by`、`approved_at`、`capital_cost`、`safety_stock_qty`、`current_stock_qty`、`calc_batch_id`、`supplier_score`、`lead_time_days`、`last_purchase_price`

### 3.2 迁移安全性评估

| 风险点 | 评估结论 | 说明 |
|--------|----------|------|
| 新建表操作 | **安全** | `IF NOT EXISTS` 保证幂等，不影响现有数据 |
| `purchase_suggestions` 字段扩展 | **安全** | 所有新增字段均为 `DEFAULT NULL`，存量记录自动填充 NULL，应用层新旧代码均可读写 |
| 存储过程临时创建再删除 | **安全** | `DROP PROCEDURE IF EXISTS` 先清理，执行完毕后立即 `DROP`，不污染数据库对象 |
| 外键约束缺失 | **已知风险（可接受）** | Code Review CR-S4-015 记录了 `schedule_suggestion_items` 缺外键，已列为下一 Sprint 跟进，当前迁移可安全执行 |
| MySQL 版本依赖 | **注意** | 脚本使用 `INFORMATION_SCHEMA.COLUMNS` 幂等检测，要求 MySQL 8.0+，请确认生产环境版本 |
| 脚本执行后自带验证 SQL | **建议执行** | 脚本末尾的 `SELECT` 语句输出各表是否存在和新列数量，部署时应检查输出结果 |

### 3.3 执行前准备

```bash
# Step 1：确认 MySQL 版本 >= 8.0
docker exec sf_mysql mysql -u root -p -e "SELECT VERSION();"

# Step 2：备份生产数据库（在 CD 自动部署前手动执行）
docker exec sf_mysql mysqldump \
  -u sf_backup -p \
  --single-transaction \
  --routines \
  --triggers \
  smart_factory \
  > /opt/backup/smart_factory_$(date +%Y%m%d_%H%M%S)_pre_sprint4.sql

# 确认备份文件非空
ls -lh /opt/backup/smart_factory_*pre_sprint4*
```

### 3.4 执行迁移

```bash
cd /opt/smart-factory
git pull origin main

# 执行迁移脚本（migrate.sh 按文件名排序，V2_sprint4_ 排在 V2_sprint3_ 之后自动执行）
bash infra/db/migrate.sh
```

### 3.5 迁移结果验证

```bash
# 验证三张新表已创建
docker exec sf_mysql mysql -u sf_app -p smart_factory \
  -e "SHOW TABLES LIKE 'schedule_suggestions';
      SHOW TABLES LIKE 'schedule_suggestion_items';
      SHOW TABLES LIKE 'suggestion_audit_logs';"

# 验证 purchase_suggestions 新增 9 个字段（应返回 9）
docker exec sf_mysql mysql -u sf_app -p smart_factory \
  -e "SELECT COUNT(*) AS new_cols_count
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'purchase_suggestions'
        AND COLUMN_NAME IN (
          'approved_by','approved_at','capital_cost',
          'safety_stock_qty','current_stock_qty','calc_batch_id',
          'supplier_score','lead_time_days','last_purchase_price'
        );"

# 验证 migration_history 中 sprint4 迁移已记录
docker exec sf_mysql mysql -u sf_app -p smart_factory \
  -e "SELECT * FROM migration_history WHERE filename LIKE '%sprint4%';"
```

---

## 4. 启动流程变更（Workers、cron job）

### 4.1 变更概览

Sprint 4 在 `services/api/src/index.ts` 的 `bootstrap()` 函数中新增以下内容：

| 阶段 | 变更内容 | 风险 |
|------|----------|------|
| 模块导入（import 阶段） | 导入 3 个 Worker 文件，**import 即触发 Worker 实例化并连接 Redis** | Redis 不可用时进程启动会报 Worker 连接错误（不阻断启动，但 Worker 不可用） |
| bootstrap Step 3 | 注册每日 06:00 采购建议计算 cron job（BullMQ repeat job） | cron 注册失败已 try/catch 降级处理，不影响主服务启动 |
| gracefulShutdown | 并行关闭 `closeMrpWorker()` + `closeNotificationWorker()` + `closeSuggestionWorker()` | 进程收到 SIGTERM 时最长等待时间取决于当前最长 Job 执行时长 |

### 4.2 三个 Worker 规格

| Worker 文件 | 队列名称 | prefix | concurrency | 重试策略 | 职责 |
|-------------|----------|--------|-------------|----------|------|
| `mrp.worker.ts` | `erp.inventory.shortage-recheck` | `erp_bullmq` | 3 | 3次/指数退避（由入队方配置） | 采购收货确认后重新评估缺料状态 |
| `notification.worker.ts` | `erp.notification.send` | `erp_bullmq` | 5 | 3次/固定10s（由入队方配置） | 站内通知发送（MVP 阶段仅打日志） |
| `suggestion.worker.ts` | `erp.schedule.suggestion-calculate` | `erp_bullmq` | 1 | 3次/固定30s | 调度建议计算（重量级，串行执行） |

### 4.3 cron job 注册机制说明

- cron job 使用 BullMQ repeat job 机制，调度计划持久化存储在 Redis
- 进程**第一次启动**时注册 `jobId: 'daily-suggestion-calculate'`，调度规则 `0 6 * * *`（每天 06:00 服务器本地时间）
- 进程重启后，BullMQ 检测到同 `jobId` 的 repeat job 已存在，**自动恢复**，不重复注册
- cron job 注册失败（Redis 不可用）时仅打印 WARN 日志，主服务正常启动

**时区注意事项**：cron 表达式 `0 6 * * *` 基于服务器本地时区执行。确认生产服务器时区设置：

```bash
# 确认服务器时区
timedatectl status

# 若需要指定时区，在 docker-compose.prod.yml 中为 api 服务添加环境变量
# TZ: Asia/Shanghai
```

### 4.4 连接数资源影响

每个 Worker 实例创建独立的 ioredis 连接（BullMQ 要求不复用业务连接）：

| 资源类型 | Sprint 3 | Sprint 4 新增 | Sprint 4 合计 |
|----------|----------|--------------|--------------|
| Redis 连接数 | 1（业务缓存） | 3（3个Worker各1条） + 3（3个Queue各1条）= 6 | 约 7 条 |
| 数据库连接池 | 10-15 | Worker 并发最多消耗 9 个（3+5+1） | 建议 DB_POOL_SIZE=20 |

确认 Redis 服务端 `maxclients` 配置充足（生产建议 ≥ 100）：

```bash
docker exec sf_redis redis-cli CONFIG GET maxclients
```

---

## 5. 监控建议

### 5.1 BullMQ 队列监控

#### 5.1.1 关键 Redis Key 监控

BullMQ 在 Redis 中维护以下 Key 结构（prefix=`erp_bullmq`）：

| Key 模式 | 含义 | 告警阈值建议 |
|----------|------|-------------|
| `erp_bullmq:<queue>:wait` | 等待执行的 Job 数量 | `shortage-recheck` > 100；`suggestion-calculate` > 5 |
| `erp_bullmq:<queue>:active` | 正在执行的 Job 数量 | 超过 Worker concurrency 值时告警 |
| `erp_bullmq:<queue>:failed` | 最终失败（耗尽重试）的 Job 数量 | > 0 立即告警 |
| `erp_bullmq:<queue>:delayed` | 等待重试中的 Job 数量 | `suggestion-calculate` > 3 告警 |

```bash
# 查看各队列等待 Job 数
docker exec sf_redis redis-cli LLEN "erp_bullmq:erp.inventory.shortage-recheck:wait"
docker exec sf_redis redis-cli LLEN "erp_bullmq:erp.schedule.suggestion-calculate:wait"
docker exec sf_redis redis-cli LLEN "erp_bullmq:erp.notification.send:wait"

# 查看失败 Job 数（ZSet）
docker exec sf_redis redis-cli ZCARD "erp_bullmq:erp.inventory.shortage-recheck:failed"
docker exec sf_redis redis-cli ZCARD "erp_bullmq:erp.schedule.suggestion-calculate:failed"
```

#### 5.1.2 Bull Board 可视化（推荐）

可在 API 服务中集成 `@bull-board/express` 或独立部署 Bull Board：

```typescript
// 示例：在 app.ts 中挂载 Bull Board（仅内网访问，需鉴权）
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');
createBullBoard({
  queues: [
    new BullMQAdapter(queueService.getQueue(QUEUE_SHORTAGE_RECHECK)!),
    new BullMQAdapter(queueService.getQueue(QUEUE_SUGGESTION_CALCULATE)!),
    new BullMQAdapter(queueService.getQueue(QUEUE_NOTIFICATION_SEND)!),
  ],
  serverAdapter,
});
app.use('/admin/queues', authMiddleware, serverAdapter.getRouter());
```

### 5.2 Worker 健康检查

#### 5.2.1 数据库侧 Job 状态监控

通过 `schedule_suggestions` 表监控调度建议计算任务健康状态：

```sql
-- 检查是否存在僵尸批次（状态 calculating 超过 30 分钟）
SELECT id, batch_no, tenant_id, job_id, calc_started_at,
       TIMESTAMPDIFF(MINUTE, calc_started_at, NOW()) AS running_minutes
FROM schedule_suggestions
WHERE status = 'calculating'
  AND calc_started_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE);

-- 检查过去 24 小时失败批次
SELECT COUNT(*) AS failed_count, DATE(created_at) AS date
FROM schedule_suggestions
WHERE status = 'failed'
  AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
GROUP BY DATE(created_at);

-- 确认每日 cron job 今日是否正常触发（每天 06:00 执行）
SELECT batch_no, status, trigger_type, calc_started_at, calc_finished_at
FROM schedule_suggestions
WHERE trigger_type = 'cron'
  AND created_at >= CURDATE()
ORDER BY created_at DESC
LIMIT 5;
```

#### 5.2.2 Prometheus 指标建议（下一迭代实现）

| 指标名称 | 类型 | 说明 |
|----------|------|------|
| `bullmq_queue_waiting_total` | Gauge | 各队列等待 Job 数 |
| `bullmq_queue_active_total` | Gauge | 各队列活跃 Job 数 |
| `bullmq_queue_failed_total` | Counter | 各队列失败 Job 累计数 |
| `bullmq_job_duration_seconds` | Histogram | Job 执行耗时分布 |
| `suggestion_calculation_duration_seconds` | Histogram | 调度建议计算耗时 |
| `mrp_recheck_affected_orders` | Histogram | 每次缺料重检影响的工单数 |

### 5.3 日志监控

Worker 日志关键字告警配置：

| 日志关键词 | 级别 | 触发动作 |
|------------|------|----------|
| `[MrpWorker] Job #* 最终失败` | ERROR | 立即告警，检查缺料重检是否积压 |
| `[SuggestionWorker] Job #* 最终失败` | ERROR | 立即告警，人工触发重算或检查数据库 |
| `[QueueService] BullMQ addJob 失败，降级到 EventEmitter` | WARN | 告警，检查 Redis 连接状态 |
| `[Bootstrap] cron job 注册失败` | WARN | 告警，确认 Redis 可用性，手动触发当日计算 |
| `Redis 连接超时` | ERROR | 立即告警，检查 Redis 服务状态 |

```bash
# 实时监控 Worker 日志
docker logs -f sf_api 2>&1 | grep -E "\[MrpWorker\]|\[SuggestionWorker\]|\[NotificationWorker\]|\[QueueService\]"

# 查看最近 1 小时内的失败 Job 日志
docker logs sf_api --since 1h 2>&1 | grep "最终失败"
```

### 5.4 资源消耗基线

部署后前 48 小时需建立以下基线数据：

| 指标 | 观测方式 | 目标基线 |
|------|----------|----------|
| SuggestionWorker 每次计算耗时 | 日志 `[SuggestionWorker] Job #* 执行完成` 时间差 | < 60 秒（50 个 SKU 场景） |
| MrpWorker 每次重检耗时 | 日志时间差 | < 5 秒 |
| Redis 内存使用量（BullMQ Job 数据） | `docker exec sf_redis redis-cli INFO memory` | 建立基线，超过 80% 内存告警 |
| 数据库连接池使用率 | TypeORM 连接池监控 | 峰值不超过 80%（16/20） |

---

## 6. 回滚策略

### 6.1 回滚决策矩阵

| 故障现象 | 建议回滚范围 | 预计耗时 | 操作 |
|----------|-------------|----------|------|
| Worker 连接错误，HTTP API 正常 | 仅调查 Redis 连接，不回滚代码 | 5-10 分钟 | 检查 REDIS_HOST/REDIS_PASSWORD 配置 |
| `suggestion-calculate` Worker 失败，其他正常 | 不回滚，人工介入 | 10-30 分钟 | 查数据库僵尸批次，手动触发重算 |
| Sprint 4 新路由 5xx，存量功能正常 | 应用镜像回滚（不回滚数据库） | 3-5 分钟 | 方案 A |
| 数据库迁移失败，应用未启动 | 修复迁移脚本重试，或恢复备份 | 15-30 分钟 | 方案 B |
| 存量功能受损（登录/工单/采购） | 应用镜像 + 数据库备份 | 30-60 分钟 | 方案 C |
| 服务完全不可用 | 立即回滚镜像，同步评估 DB | 5-10 分钟 | 方案 A + 评估 |

### 6.2 方案 A — 应用层回滚（推荐首选）

```bash
cd /opt/smart-factory

# 查看可回滚的镜像（上一个稳定版本）
docker images | grep smart-factory-api | head -5

# 指定 Sprint 3 稳定版本 TAG 回滚
export IMAGE_TAG=<Sprint3 稳定 commit SHA 前 7 位>
export REGISTRY=ghcr.io
export IMAGE_REPO=<github_org/repo_name>

# 拉取旧镜像
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull api

# 滚动回滚（start-first 保证不中断服务）
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --no-deps api

# 确认回滚成功
curl -sf http://localhost:3000/health
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

**数据库兼容性说明**：Sprint 4 的数据库变更均为**新增操作**（新建表、新增列），对 Sprint 3 应用代码完全透明。回滚应用镜像至 Sprint 3 版本后，Sprint 4 新增的表和字段不会被访问，**不产生任何破坏性影响**。

### 6.3 方案 B — 数据库迁移失败处理

```bash
# 查看迁移失败原因
docker exec sf_mysql mysql -u sf_app -p smart_factory \
  -e "SELECT * FROM migration_history ORDER BY executed_at DESC LIMIT 5;"

# 确认失败的具体语句（查看 MySQL 错误日志）
docker logs sf_mysql 2>&1 | tail -50

# 若迁移脚本存在 Bug，修复后重新执行
# 脚本已设计为幂等，直接重新执行不会产生副作用
docker exec -i sf_mysql mysql -u sf_app -p smart_factory \
  < services/api/src/migrations/V2_sprint4_schedule_tables.sql
```

### 6.4 方案 C — 完整回滚（最后手段）

```bash
# 仅在业务数据量极小、新表无业务数据时执行
# 使用部署前备份文件还原
docker exec -i sf_mysql mysql \
  -u root -p smart_factory \
  < /opt/backup/smart_factory_<timestamp>_pre_sprint4.sql
```

**警告**：方案 C 会丢失备份点之后的所有业务数据，仅限于部署后极短时间内（数据无变更或可接受丢失）使用。

### 6.5 BullMQ 特有回滚注意事项

#### 6.5.1 僵尸批次处理

若 SuggestionWorker 在计算过程中被强制中断（未优雅退出），`schedule_suggestions` 中可能遗留 `status='calculating'` 的僵尸批次。回滚前需清理：

```sql
-- 查找僵尸批次
SELECT id, batch_no, job_id, calc_started_at FROM schedule_suggestions
WHERE status = 'calculating'
  AND calc_started_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE);

-- 将僵尸批次标记为失败（人工介入）
UPDATE schedule_suggestions
SET status = 'failed',
    error_message = '进程重启/回滚导致计算中断，需重新触发',
    updated_at = NOW()
WHERE status = 'calculating'
  AND calc_started_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE);
```

#### 6.5.2 Redis 中 repeat job 清理

回滚至 Sprint 3 后，BullMQ repeat job 的调度计划仍存在于 Redis。Sprint 3 代码不消费这些队列，不产生影响，但建议在 Redis 中清理以保持整洁：

```bash
# 查看 repeat job 相关 Key
docker exec sf_redis redis-cli KEYS "erp_bullmq:*repeat*"

# 清理所有 BullMQ erp_bullmq 前缀 Key（谨慎执行，仅回滚后操作）
docker exec sf_redis redis-cli --scan --pattern "erp_bullmq:*" | xargs docker exec sf_redis redis-cli DEL
```

---

## 7. 部署前检查清单

在触发 CD 部署前，由部署执行人逐项确认并打勾：

### 7.1 质量门禁确认

- [ ] QA 验收报告已确认通过（参见 `docs/v2/sprint4-test-cases.md`）
- [ ] Code Review Critical 问题已全部修复（CR-S4-001 SQL注入、CR-S4-002 Worker未注册优雅退出、CR-S4-003 并发竞态）
- [ ] Code Review High 问题已全部修复（CR-S4-004 N+1查询、CR-S4-005 无事务、CR-S4-006/007/008 接口Bug、CR-S4-009 字段语义错误）
- [ ] EM 审批文件 `docs/v2/sprint4-em-approval.md` 已确认 APPROVED
- [ ] PR 已合并到 main 分支，CI 全部通过（api-unit、api-integration、web、ci-gate 均为绿色）

### 7.2 环境准备确认

- [ ] 生产环境 `.env` 中 `REDIS_HOST` 已设置为实际 Redis 地址（非 localhost）
- [ ] 生产环境 `.env` 中 `REDIS_PASSWORD` 已设置强密码（非空）
- [ ] 生产环境 `.env` 中 `REDIS_PORT` 已确认与 Redis 服务端口一致
- [ ] 生产环境 `.env` 中 `DB_POOL_SIZE` 已调整至 20（适配 Worker 并发连接需求）
- [ ] 生产环境 `.env` 中 `NODE_ENV=production` 已设置
- [ ] 生产环境 `.env` 中所有 `CHANGE_ME` 占位值已替换
- [ ] Redis 服务 `maxclients` >= 100，当前可用连接数充足

### 7.3 数据库准备确认

- [ ] 已确认生产 MySQL 版本 >= 8.0（迁移脚本依赖 INFORMATION_SCHEMA）
- [ ] 已完成数据库备份，备份文件非空，路径：`/opt/backup/smart_factory_*_pre_sprint4.sql`
- [ ] 已在测试环境预执行 `V2_sprint4_schedule_tables.sql` 并验证通过
- [ ] `migration_history` 表中确认 `V2_sprint3_schema.sql` 已执行（Sprint 3 迁移是 Sprint 4 的前置依赖）

### 7.4 服务器资源确认

- [ ] 服务器磁盘空间充足（`df -h`，`/var/lib/docker` 剩余 > 10G）
- [ ] 服务器内存充足（Worker 引入额外 Redis 连接，建议剩余 > 512MB）
- [ ] Docker Engine 版本 >= 24.0（`docker --version`）

---

## 8. 部署后验证清单

部署完成后，在 15 分钟内完成以下验证：

### 8.1 容器健康状态

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
# 期望：sf_mysql、sf_redis、sf_api、sf_web 全部显示 healthy
```

- [ ] `sf_mysql` 容器状态为 `healthy`
- [ ] `sf_redis` 容器状态为 `healthy`
- [ ] `sf_api` 容器状态为 `healthy`（健康检查 `GET /health` 返回 200）
- [ ] `sf_web` 容器状态为 `healthy`

### 8.2 Worker 启动确认

```bash
# 查看 API 启动日志，确认三个 Worker 均已启动
docker logs sf_api 2>&1 | grep -E "Worker.*已启动|cron job 已注册"
```

- [ ] 日志出现 `[MrpWorker] 已启动，监听队列: erp.inventory.shortage-recheck，prefix=erp_bullmq`
- [ ] 日志出现 `[NotificationWorker] 已启动，监听队列: erp.notification.send，prefix=erp_bullmq`
- [ ] 日志出现 `[SuggestionWorker] 已启动，监听队列: erp.schedule.suggestion-calculate，prefix=erp_bullmq`
- [ ] 日志出现 `[Bootstrap] 每日采购建议计算 cron job 已注册（每天 06:00）`
- [ ] 日志出现 `[Redis] 连接就绪`
- [ ] 日志**无** `[Bootstrap] cron job 注册失败` 告警

### 8.3 数据库迁移验证

```bash
# 三张新表存在性验证
docker exec sf_mysql mysql -u sf_app -p smart_factory \
  -e "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME IN ('schedule_suggestions','schedule_suggestion_items','suggestion_audit_logs');"
# 期望返回 3 行

# purchase_suggestions 新增 9 列验证
docker exec sf_mysql mysql -u sf_app -p smart_factory \
  -e "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='purchase_suggestions'
        AND COLUMN_NAME IN ('approved_by','approved_at','capital_cost',
          'safety_stock_qty','current_stock_qty','calc_batch_id',
          'supplier_score','lead_time_days','last_purchase_price');"
# 期望返回 9
```

- [ ] `schedule_suggestions` 表已创建，含 `job_id` 字段
- [ ] `schedule_suggestion_items` 表已创建，含 `item_type`、`calc_steps` 字段
- [ ] `suggestion_audit_logs` 表已创建
- [ ] `purchase_suggestions` 表新增 9 个字段，返回值为 9
- [ ] `migration_history` 中 `V2_sprint4_schedule_tables.sql` 已记录

### 8.4 新路由冒烟测试

```bash
TOKEN="<通过 POST /api/auth/login 获取的 supervisor 角色 JWT>"

# Sprint 4 调度建议路由
curl -sf -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/schedule-suggestions/latest
# 期望：200 或 404（无数据时）

# 触发调度建议计算
curl -sf -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"triggerType":"manual"}' \
  http://localhost:3000/api/schedule-suggestions/calculate
# 期望：202 Accepted，返回 batchId 和 jobId

# 查询计算状态（替换 <jobId>）
curl -sf -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/schedule-suggestions/status?jobId=<jobId>"
# 期望：200，status 字段为 waiting/active/completed
```

- [ ] `GET /api/schedule-suggestions/latest` 返回 200 或 404（非 5xx、非 404路由不存在）
- [ ] `POST /api/schedule-suggestions/calculate` 返回 202，响应含 `batchId`
- [ ] `GET /api/schedule-suggestions/status` 返回 200
- [ ] `GET /api/schedule-suggestions/history` 返回 200
- [ ] 触发计算后，`schedule_suggestions` 表中出现新记录，`status` 为 `pending` 或 `calculating`

### 8.5 存量功能回归验证

- [ ] `POST /api/auth/login` 正常返回 JWT（存量认证未受影响）
- [ ] `GET /api/production/orders` 正常返回工单列表（存量数据未丢失）
- [ ] `GET /api/purchase-orders` 正常返回采购订单
- [ ] `GET /api/inventory` 正常返回库存数据
- [ ] `GET /api/mrp` 正常返回（Sprint 3 功能未受影响）
- [ ] API 日志中无 `ER_NO_SUCH_TABLE`、`ER_BAD_FIELD_ERROR` 等数据库错误

### 8.6 监控与告警确认

- [ ] `/health` 端点响应时间 < 200ms（`time curl http://localhost:3000/health`）
- [ ] 部署后 15 分钟内未收到告警通知
- [ ] Redis 连接数正常（`docker exec sf_redis redis-cli CLIENT LIST | wc -l`，确认在预期范围内）
- [ ] 数据库慢查询日志（`slow_query_log`）中无 Sprint 4 新查询报警

---

## 附录：关键文件路径速查

| 文件 | 路径 |
|------|------|
| Sprint 4 迁移脚本 | `services/api/src/migrations/V2_sprint4_schedule_tables.sql` |
| BullMQ 连接配置 | `services/api/src/shared/queue.config.ts` |
| BullMQ 队列服务 | `services/api/src/shared/queue-service.ts` |
| MRP Worker | `services/api/src/workers/mrp.worker.ts` |
| 通知 Worker | `services/api/src/workers/notification.worker.ts` |
| 调度建议 Worker | `services/api/src/workers/suggestion.worker.ts` |
| API 启动入口 | `services/api/src/index.ts` |
| 调度建议路由 | `services/api/src/modules/schedule-suggestion/schedule-suggestion.routes.ts` |
| 数据库迁移执行脚本 | `infra/db/migrate.sh` |
| CI 工作流 | `.github/workflows/ci.yml` |
| CD 工作流 | `.github/workflows/deploy.yml` |
| Docker Compose（开发） | `docker-compose.yml` |
| Docker Compose（生产覆盖） | `docker-compose.prod.yml` |
| API Dockerfile | `services/api/Dockerfile` |
| 环境变量模板 | `.env.example` |
| Sprint 4 Code Review | `docs/v2/sprint4-code-review.md` |
| Sprint 4 测试用例 | `docs/v2/sprint4-test-cases.md` |
| Sprint 4 EM 审批 | `docs/v2/sprint4-em-approval.md` |

---

*本文档由 DevOps Engineer 基于 Sprint 4 代码实际状态（commit 09eda23）生成。*
*部署执行人须对照本清单逐项确认，任何检查项未通过均需在上线前解决或由 Engineering Manager 批准豁免。*
*前置条件：Code Review 报告（sprint4-code-review.md）中所有 Critical 和 High 问题已确认修复，QA 验收通过。*
