# Redis 高可用与分布式锁失败回退机制验证报告

**验证日期：** 2026-03-11
**验证范围：** `services/api/src/config/redis.ts` / `services/api/src/modules/inventory/inventory.service.ts`
**验证人：** senior-backend-engineer

---

## 一、Redis 使用场景总览

系统通过 `RedisKeys` 常量统一管理所有 Key 命名，覆盖以下 8 个场景：

| Key 模式 | 场景 | TTL |
|---|---|---|
| `lock:inventory:{tenantId}:{skuId}` | 库存入库/出库分布式锁 | 5s |
| `inventory:{tenantId}:{skuId}` | 库存快照读取缓存 | 60s |
| `sku:{tenantId}` | SKU 列表缓存 | 300s |
| `bom:{tenantId}:{bomId}:{version}` | BOM 展开结果缓存 | 1800s |
| `session:{token}` | 用户 JWT 会话缓存 | 7 天 |
| `ai_suggestion:{requestId}` | AI 建议结果缓存 | 600s |
| `schedule:{tenantId}:{date}` | 排产计划缓存 | 12h |
| `alert_sent:{tenantId}:{skuId}:{date}` | 安全库存预警去重标记 | 24h |

所有 Key 集中定义，无散落硬编码，符合规范。

---

## 二、Redis 连接高可用配置评估

### 2.1 当前配置（`config/redis.ts`）

```
retryStrategy:       指数退避，间隔 200ms * times，上限 5s，超过 20 次停止重试
maxRetriesPerRequest: 2（单命令最多重试 2 次后立即 reject）
connectTimeout:      5000ms
commandTimeout:      3000ms
enableOfflineQueue:  false（断线期间命令立即 reject，不排队）
lazyConnect:         false（进程启动时立即建立连接）
```

### 2.2 事件监听

覆盖 `connect` / `ready` / `error` / `close` / `reconnecting` 五个事件，全链路可观测。

### 2.3 可用性探测

提供 `isRedisAvailable()` 工具函数，通过 `PING` 探测连接状态，可供健康检查接口和监控系统调用。

### 2.4 评估结论

| 配置项 | 状态 | 说明 |
|---|---|---|
| 断线重连 | 通过 | 指数退避，避免重连风暴 |
| 命令超时 | 通过 | 3s 超时，配合 `enableOfflineQueue: false` 快速失败 |
| 重试上限 | 通过 | 20 次后停止，由外部健康检查恢复，防止无限重试 |
| 离线队列 | 通过 | 关闭，断线命令立即 reject，业务层可立即感知并降级 |
| 可用性探测 | 通过 | `isRedisAvailable()` 可供健康检查端点使用 |

---

## 三、库存并发安全性评估

### 3.1 并发控制架构：双层锁机制

入库（`inbound`）和出库（`outbound`）均采用 **Redis 分布式锁 + MySQL 行锁** 的双层防护。

```
请求到达
   |
   +--> [第一层] Redis SET NX PX（跨进程互斥，毫秒级阻断）
   |       |
   |       +-- Redis 可用且锁空闲  --> 加锁成功，进入事务
   |       +-- Redis 可用但锁被持有 --> 返回 null --> 拒绝请求（4003）
   |       +-- Redis 不可用（异常） --> 告警日志，降级到第二层
   |
   +--> [第二层] MySQL BEGIN TRANSACTION + SELECT ... FOR UPDATE
           |
           +-- 行锁保护库存读取与扣减的原子性
           +-- 无论 Redis 状态如何，此层始终执行
           +-- 库存不足时事务回滚，数据零风险
```

### 3.2 入库（`inbound`）并发控制细节

- Redis 锁：`acquireLock(lockKey, 5000ms)`
- DB 行锁：`SELECT id FROM inventory WHERE ... FOR UPDATE`（在事务内首先执行）
- 首次入库（inventory 行不存在）：`INSERT ... ON DUPLICATE KEY UPDATE` 依赖 InnoDB gap lock 保证安全

### 3.3 出库（`outbound`）并发控制细节

- Redis 锁：`acquireLock(lockKey, 5000ms)`
- DB 行锁（主表）：`SELECT qty_on_hand, qty_reserved FROM inventory ... FOR UPDATE`
- DB 行锁（缸号表）：`SELECT qty_on_hand, qty_reserved FROM inventory_dye_lots ... FOR UPDATE`
- 充足性校验在持锁状态下进行，扣减和校验原子一致，**不存在超卖风险**

### 3.4 缓存读取（`getAvailableStock`）降级策略

该方法供采购/销售模块的非写操作调用（库存充足性预估）：

- Redis 读取失败：`catch` 静默降级到 DB 直接查询，业务不中断
- Redis 写入失败：`catch` 静默忽略，下次查询穿透到 DB，不影响数据正确性
- **注意**：该方法读取的快照数据为缓存值（TTL 60s），存在最多 60s 的读取延迟，适用于预估场景；实际扣减操作通过 `FOR UPDATE` 行锁读取最新值，不受缓存影响

### 3.5 安全库存预警（`checkSafetyStockAlert`）

预警去重依赖 `alert_sent` 的 Redis Key，若 Redis 不可用，预警可能重复触发（每次入库后调用一次）。此为非关键路径，不影响库存数据正确性，但建议后续优化：将预警入队解耦，Redis 只做去重辅助而非强依赖。

---

## 四、发现的问题与修复记录

### 问题 1：`acquireLock` 原始设计：锁获取失败直接抛出，无降级路径

**原始代码行为：**
```typescript
// 旧实现：Redis 连接异常与锁被占用均统一 throw Error
// 业务层 catch 后直接返回 INVENTORY_LOCK_FAILED，Redis 宕机=拒绝所有库存操作
if (result !== 'OK') {
  throw new Error(`获取分布式锁失败: ${key}`);
}
```

**问题：** Redis 实例宕机时，所有入库/出库请求均以 `INVENTORY_LOCK_FAILED` 失败，系统完全不可用。

**修复：** `acquireLock` 区分两种失败语义：
- 锁被持有（`SET NX` 返回非 OK）：返回 `null`，业务层识别为并发冲突，拒绝请求
- Redis 不可用（命令抛出异常）：异常向上传播，业务层 catch 后降级到纯 DB 行锁继续执行

### 问题 2：入库操作（`inbound`）事务内无 DB 行锁

**原始行为：** 入库仅依赖 Redis 锁 + `INSERT ... ON DUPLICATE KEY UPDATE`，无显式 `SELECT ... FOR UPDATE`。

**问题：** Redis 降级场景下，多个入库并发写同一 SKU 时，`ON DUPLICATE KEY UPDATE` 的 `qty_on_hand + delta` 计算基于各自读取的快照值，并发执行可能导致数量不一致。

**修复：** 在事务开始时执行 `SELECT id FROM inventory ... FOR UPDATE`，锁定行后再执行 UPSERT，保证串行化。

### 问题 3：`releaseLock` 在 `finally` 中抛出异常掩盖业务错误

**原始行为：** `releaseLock` 直接调用 `redis.eval`，若 Redis 此时不可用，`finally` 块抛出的异常会替换原始事务异常，导致调用方收到错误的异常信息。

**修复：** `releaseLock` 内部 `try/catch`，失败时只打 `console.warn`，锁的 TTL（5s）到期后自动释放，不影响业务结果。

### 问题 4：`getAvailableStock` Redis 异常时无降级，直接抛出

**原始行为：** `redis.get()` 和 `redis.setex()` 无异常处理，Redis 不可用时方法抛出，导致依赖此方法的采购建议、销售约束引擎全部失败。

**修复：** 读取和写入缓存分别用 `try/catch` 包裹，失败时静默降级到 DB 查询。

### 问题 5：Redis 连接配置缺少关键高可用参数

**原始配置缺失：** `maxRetriesPerRequest`、`connectTimeout`、`commandTimeout`、`enableOfflineQueue`。

**问题：** 缺少 `enableOfflineQueue: false` 时，断线期间命令会排队，重连后批量执行，可能造成请求积压雪崩；缺少 `commandTimeout` 时，命令可能长时间阻塞。

**修复：** 补全上述四个参数，并增加 `ready` / `close` / `reconnecting` 事件监听和 `isRedisAvailable()` 探测函数。

---

## 五、修复后并发场景覆盖矩阵

| 场景 | Redis 状态 | 并发控制手段 | 结果 |
|---|---|---|---|
| 正常出库，无并发 | 可用 | Redis 锁 + DB FOR UPDATE | 安全扣减 |
| 并发出库同一 SKU | 可用 | Redis 锁阻断第二请求 | 第二请求返回 4003，无超卖 |
| Redis 宕机，单次出库 | 不可用 | 降级到 DB FOR UPDATE | 安全扣减，服务不中断 |
| Redis 宕机，并发出库 | 不可用 | DB FOR UPDATE 串行化 | 安全扣减，无超卖 |
| 正常入库，无并发 | 可用 | Redis 锁 + DB FOR UPDATE | 安全累加 |
| 并发入库同一 SKU | 可用 | Redis 锁阻断第二请求 | 第二请求返回 4003 |
| Redis 宕机，并发入库 | 不可用 | DB FOR UPDATE 串行化 | 安全累加，数量一致 |
| 库存缓存读取，Redis 宕机 | 不可用 | 降级到 DB SELECT | 读取最新值，服务不中断 |

---

## 六、遗留风险与后续建议

### 风险 1（低）：安全库存预警在 Redis 宕机时可能重复触发

- **位置：** `checkSafetyStockAlert`，去重依赖 `alert_sent` Key
- **影响：** 非关键路径，不影响库存数据，仅导致重复通知
- **建议：** 将预警投递改为幂等消息队列（如 Bull/BullMQ），Redis 仅作去重辅助，不作强依赖

### 风险 2（低）：`getAvailableStock` 缓存数据最多有 60s 延迟

- **位置：** 销售约束引擎（`constraintEngine.ts`）和采购建议服务（`suggestion.service.ts`）调用此方法
- **影响：** 预估结果可能基于 60s 内的旧数据，不影响最终扣减（扣减走行锁）
- **建议：** 对实时性要求高的销售下单约束检查，可在扣减前读取 DB 最新值而非缓存

### 风险 3（中）：单节点 Redis，无 Sentinel/Cluster 配置

- **位置：** `config/redis.ts` 使用单 `new Redis({host, port})` 连接
- **影响：** Redis 实例故障时，降级到 DB 行锁可正常工作（已验证），但期间锁的跨进程互斥能力丧失，高并发场景下 DB 行锁成为吞吐瓶颈
- **建议：** 生产环境接入 Redis Sentinel（主从切换）或 Redis Cluster；代码层已为降级做好准备，升级无需改动业务逻辑

---

## 七、结论

| 验证项 | 结果 |
|---|---|
| Redis 连接配置具备高可用参数 | 通过（本次修复后） |
| 分布式锁使用 SET NX PX 原子操作 | 通过 |
| 分布式锁释放使用 Lua 原子脚本 | 通过 |
| Redis 不可用时自动降级到 DB 行锁 | 通过（本次修复后） |
| 出库操作使用 SELECT FOR UPDATE 防超卖 | 通过 |
| 入库操作使用 SELECT FOR UPDATE 防并发写冲突 | 通过（本次修复后） |
| 缓存读写异常不影响业务可用性 | 通过（本次修复后） |
| releaseLock 异常不掩盖业务异常 | 通过（本次修复后） |

**整体结论：满足生产要求。**

核心库存操作（入库/出库）具备双层并发保障，Redis 高可用配置已达生产标准，Redis 完全不可用时系统可自动降级运行，数据安全性由 MySQL 行锁兜底，不存在超卖风险。

建议在上线后完成风险 3（Redis 单点）的改造，将单节点升级为 Sentinel 模式，以进一步提升高并发下的吞吐能力。
