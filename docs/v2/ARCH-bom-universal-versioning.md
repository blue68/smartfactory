# [artifact:架构设计] BOM 通用化 + 版本迭代架构预研

**文档编号**：ARCH-BOM-V2-001
**版本**：v1.0
**创建日期**：2026-03-12
**作者**：@tech-lead-architect
**输入来源**：PRD-v2-iteration-plan.md（R-04 需求）、V1 BOM 代码审查结果
**交付目标**：为 Sprint 2 后端工程师和前端工程师提供完整的技术约束与设计指导

---

## 目录

1. [现状分析](#一现状分析)
2. [数据模型设计](#二数据模型设计)
3. [MRP 计算模型](#三mrp-计算模型)
4. [API 设计草案](#四api-设计草案)
5. [数据迁移方案](#五数据迁移方案)
6. [风险评估](#六风险评估)

---

## 一、现状分析

### 1.1 V1 BOM 数据模型概览

V1 BOM 由两张核心表构成：

```
bom_headers（表头）
  id, tenant_id, sku_id, version(VARCHAR 20), status(draft/active/archived),
  description, is_active, created_at, updated_at, created_by, updated_by

bom_items（明细）
  id, tenant_id, bom_header_id, parent_item_id, component_sku_id,
  quantity, unit, level, scrap_rate, sort_order, notes,
  created_at, updated_at, created_by, updated_by
```

生产工单表（`production_orders`）中有 `bom_header_id` 字段，引用的是表头 ID，但没有版本快照保护。

### 1.2 V1 核心问题识别

#### 问题一：版本管理不完整（严重）

`bom_headers.version` 仅是一个自由文本字段，没有以下机制：
- 没有 `effective_date`（版本生效日期），无法确定某个版本从何时起生效
- `is_active` 与 `status='active'` 语义重叠，存在双重标志不一致风险（`is_active=1` 但 `status='archived'` 的矛盾状态在 V1 代码中未做互斥校验）
- 工单绑定 `bom_header_id` 而非 `bom_version_snapshot_id`，BOM 激活新版本后旧工单的展开计算会静默使用新版本数据，违反 BD-001 决策的快照要求

#### 问题二：无半成品通用引用机制（严重）

当前 `bom_items.component_sku_id` 引用的是 SKU，不是另一个 BOM。半成品被多个成品 BOM 引用时，只能将半成品的子料在每个 BOM 中重复录入（物理复制），导致：
- 半成品结构变更时需逐个修改所有引用它的成品 BOM，极易遗漏
- 采购需求计算无法识别跨 BOM 的通用件合并，可能产生重复采购
- 无法在 UI 上展示"哪些成品引用了某个半成品"的引用关系

#### 问题三：MRP 计算模型不支持多工单聚合（严重）

当前 `calcMaterialRequirements(bomId, productionQty)` 只能针对单个 BOM 计算，无法跨多个待生产工单做物料需求汇总，无法对库存和安全库存做联合扣减，这是 Sprint 4 智能调度的上游漏洞。

#### 问题四：循环引用检测不完整（中等）

`insertBomItems` 中的循环引用检测只检查"当前物料是否就是成品本身"，但没有检测间接循环（A→B→C→A 这类多跳循环），虽然 CTE 的 `FIND_IN_SET` 防止了展开时的无限递归，但创建时不报错而展开时截断会带来静默数据错误。

#### 问题五：缓存 key 设计与版本绑定不彻底（轻微）

Redis 缓存 key 为 `bom:expanded:{tenantId}:{bomId}:{version}`，但 `version` 是字符串（如 "1.0"）而非状态标志。当 `bom_items` 被修改（`addBomItem`、`deleteBomItem`）时，如果未同步更新版本字符串，缓存失效逻辑依赖版本字符串不变，可能读到旧缓存。

### 1.3 影响评估

| 问题 | 影响范围 | Sprint 2 必须修复 |
|---|---|---|
| 工单无版本快照 | BD-001 合规、MRP 准确性 | 是 |
| 无通用件引用 | US-V2-005、采购计算准确性 | 是 |
| 跨工单 MRP 聚合 | Sprint 4 智能调度前置 | 是（接口设计阶段埋口） |
| 循环引用检测 | 数据完整性 | 是 |
| 缓存 key 设计 | 性能 | 是（修复策略） |

---

## 二、数据模型设计

### 2.1 设计原则

1. **向前兼容**：所有 V1 已有表的变更仅为 `ADD COLUMN`，不做 `DROP` 或 `MODIFY` 破坏性操作
2. **引用而非复制**：通用半成品通过 BOM 间的引用关系实现，不物理复制子料结构
3. **快照隔离**：生产工单创建时锁定 BOM 版本快照，后续版本变更不影响进行中工单
4. **计算幂等**：相同输入的 MRP 计算结果始终一致，不受时序影响

### 2.2 BOM 表头扩展（`bom_headers`）

在现有 `bom_headers` 基础上新增字段（通过 ALTER TABLE 向前兼容追加）：

```sql
ALTER TABLE `bom_headers`
  -- 版本生效日期（激活时自动填写，draft/archived 时为 NULL）
  ADD COLUMN `effective_date`   DATE            DEFAULT NULL
    COMMENT '版本生效日期，激活时自动设为当日'
    AFTER `status`,

  -- 废弃日期（被新版本替代时自动填写）
  ADD COLUMN `deprecated_at`    DATETIME(3)     DEFAULT NULL
    COMMENT '版本废弃时间（新版本激活时旧版本自动填写）'
    AFTER `effective_date`,

  -- BOM 类型：成品 BOM 或半成品 BOM
  ADD COLUMN `bom_type`         ENUM('finished','semi') NOT NULL DEFAULT 'finished'
    COMMENT 'finished=成品BOM, semi=半成品BOM'
    AFTER `description`,

  -- 修复 is_active 与 status 双标志冗余：保留 status 作为唯一权威字段
  -- is_active 字段废弃，保留列但不再写入，仅通过 status='active' 判断
  -- 注意：is_active 列不删除，保持向前兼容（V1 读取的代码不会因缺列报错）

  -- 添加联合唯一索引：同一 SKU + 版本号在同一租户内唯一
  ADD UNIQUE KEY `uk_tenant_sku_version` (`tenant_id`, `sku_id`, `version`);
```

**is_active 字段的处理策略**：

V1 中 `is_active` 与 `status='active'` 语义重复。V2 中以 `status` 字段为唯一真相来源。`is_active` 列保留（不删除）但在 V2 所有写操作中保持与 `status` 同步（`status='active'` 时 `is_active=1`，否则 `is_active=0`），避免 V1 旧代码读到不一致数据。

### 2.3 BOM 明细扩展（`bom_items`）

```sql
ALTER TABLE `bom_items`
  -- 引用标志：NULL=直接子料；非NULL=引用的半成品 BOM 的 bom_header_id
  ADD COLUMN `ref_bom_header_id`  BIGINT UNSIGNED DEFAULT NULL
    COMMENT '引用的半成品 BOM 表头 ID（非空时为通用件引用行）'
    AFTER `component_sku_id`,

  ADD INDEX `idx_ref_bom_header` (`tenant_id`, `ref_bom_header_id`);
```

**引用行语义说明**：

当 `ref_bom_header_id IS NOT NULL` 时，该 `bom_items` 行表示"引用通用半成品"而非"直接子料"。规则：
- `component_sku_id`：仍填写该半成品的 SKU ID（用于显示和采购计算入口标识）
- `ref_bom_header_id`：指向该半成品对应的 `bom_headers.id`（必须是 `bom_type='semi'` 且 `status='active'` 的版本）
- `quantity` / `unit` / `scrap_rate`：描述父成品使用该半成品的数量，即"需要几个这个半成品"
- `children`（逻辑上）：不存储在父成品的 `bom_items` 中，展开时动态从引用的半成品 BOM 读取

### 2.4 BOM 版本快照表（新表）

```sql
CREATE TABLE IF NOT EXISTS `bom_version_snapshots` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT UNSIGNED NOT NULL,
  `production_order_id` BIGINT UNSIGNED NOT NULL
    COMMENT '关联的生产工单ID',
  `bom_header_id`     BIGINT UNSIGNED NOT NULL
    COMMENT '快照来源的BOM表头ID（此刻的激活版本）',
  `bom_sku_id`        BIGINT UNSIGNED NOT NULL
    COMMENT '成品SKU ID（冗余，加速查询）',
  `version`           VARCHAR(20)     NOT NULL
    COMMENT '快照时的版本号（冗余记录，用于展示和审计）',
  `snapshot_data`     JSON            NOT NULL
    COMMENT '展开后的BOM树（JSON序列化），创建工单时固化',
  `created_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_po_bom` (`tenant_id`, `production_order_id`, `bom_header_id`),
  KEY `idx_tenant_bom_header` (`tenant_id`, `bom_header_id`),
  KEY `idx_tenant_po` (`tenant_id`, `production_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='BOM版本快照表（生产工单创建时固化，不随BOM版本变更）';
```

**快照机制说明**：

工单创建时，系统展开当前激活 BOM（含通用件递归展开），将完整树序列化为 JSON 存入 `snapshot_data`，同时在 `production_orders` 表记录 `bom_snapshot_id`（见下文 2.6）。后续 MRP 计算使用快照数据，而非实时展开 `bom_items`。

快照数据格式（JSON）：
```json
{
  "bomHeaderId": 42,
  "skuId": 101,
  "version": "2.0",
  "snapshotAt": "2026-04-01T08:00:00.000Z",
  "items": [
    {
      "bomItemId": 201,
      "componentSkuId": 501,
      "skuCode": "SM-BED-TAIL-WF",
      "skuName": "白色绒布Full床尾",
      "quantity": "1.0000",
      "unit": "件",
      "scrapRate": "0.0200",
      "netQuantity": "1.0200",
      "isRef": true,
      "refBomHeaderId": 88,
      "children": [
        {
          "bomItemId": 301,
          "componentSkuId": 601,
          "skuCode": "FAB-WHITE-VELVET",
          "skuName": "白色绒布",
          "quantity": "2.5000",
          "unit": "米",
          "scrapRate": "0.0500",
          "netQuantity": "2.6250",
          "isRef": false,
          "children": []
        }
      ]
    }
  ]
}
```

### 2.5 半成品引用关系视图（辅助查询表）

为了快速回答"某个半成品被哪些成品 BOM 引用"，维护一张物化关系表（由触发器或应用层在 BOM 变更时同步维护）：

```sql
CREATE TABLE IF NOT EXISTS `bom_semi_references` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  -- 被引用的半成品
  `semi_bom_header_id`  BIGINT UNSIGNED NOT NULL
    COMMENT '半成品BOM表头ID',
  `semi_sku_id`         BIGINT UNSIGNED NOT NULL
    COMMENT '半成品SKU ID（冗余）',
  -- 引用方（成品BOM明细行）
  `parent_bom_header_id` BIGINT UNSIGNED NOT NULL
    COMMENT '成品BOM表头ID',
  `parent_bom_item_id`  BIGINT UNSIGNED NOT NULL
    COMMENT '成品BOM中引用该半成品的明细行ID',
  `created_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ref` (`tenant_id`, `semi_bom_header_id`, `parent_bom_item_id`),
  KEY `idx_semi_bom`   (`tenant_id`, `semi_bom_header_id`),
  KEY `idx_parent_bom` (`tenant_id`, `parent_bom_header_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='半成品被引用关系表（用于影响提示和引用计数）';
```

**维护策略**：由应用层（BOM Service）在以下操作时同步写入/删除：
- 新增引用行（`bom_items.ref_bom_header_id IS NOT NULL`）时插入
- 删除 `bom_items` 引用行时删除
- BOM 激活/归档操作不影响此表（关系由明细行管理）

### 2.6 生产工单表扩展（`production_orders`）

```sql
ALTER TABLE `production_orders`
  ADD COLUMN `bom_snapshot_id`   BIGINT UNSIGNED DEFAULT NULL
    COMMENT '工单创建时固化的BOM版本快照ID（来自bom_version_snapshots）'
    AFTER `bom_header_id`;

  -- 注：bom_header_id 字段保留，记录工单基于哪个BOM表头创建，用于审计溯源
  -- bom_snapshot_id 才是实际计算时使用的快照来源
```

### 2.7 完整 ER 模型（V2 BOM 相关部分）

```
skus (1) ─────────────── (N) bom_headers
                                │
                    ┌───────────┴───────────┐
                    │ bom_type              │
                 'finished'             'semi'
                    │                       │
                    │                       │
              bom_items ─── ref_bom_header_id ──> bom_headers(semi)
                    │                                    │
                    │                       bom_semi_references
                    │
              production_orders
                    │
              bom_version_snapshots
```

---

## 三、MRP 计算模型

### 3.1 通用件合并计算逻辑（核心算法）

**问题场景**（家具制造业务示例）：

```
销售订单：
  - 白色绒布Full密竖条纹软包床  × 5件  (成品A，BOM_A)
  - 白色绒布Full护翼密竖条纹软包 × 3件  (成品B，BOM_B)

BOM_A（成品A）：
  - 床架        × 1件（直接子料）
  - 白色绒布Full床尾 × 1件（引用半成品 BOM_TAIL_WF，ref_bom_header_id=88）
    └── 白色绒布 × 2.5米（scrap_rate=5%，netQty=2.625米）
    └── 海绵填充 × 1块

BOM_B（成品B）：
  - 护翼框架    × 1件（直接子料）
  - 白色绒布Full床尾 × 1件（同样引用 BOM_TAIL_WF，ref_bom_header_id=88）
    └── 白色绒布 × 2.5米（同上）
    └── 海绵填充 × 1块
```

**正确 MRP 计算结果**：
- 白色绒布：(5×1×2.625) + (3×1×2.625) = 13.125 + 7.875 = **21.000米**
- 海绵填充：(5×1×1) + (3×1×1) = **8块**
- 床架：5×1 = **5件**
- 护翼框架：3×1 = **3件**

通用件 `BOM_TAIL_WF` 的子料需求被正确合并，不会出现重复采购。

**算法伪代码**：

```
function calcMultiOrderMRP(orders: Array<{bomSnapshotId, productionQty}>):
  materialAccumulator = Map<skuId, Decimal>  // 物料汇总桶

  for each order in orders:
    snapshot = loadSnapshot(order.bomSnapshotId)
    traverseSnapshot(snapshot.items, qty=order.productionQty, accumulator)

  function traverseSnapshot(items, parentQty, accumulator):
    for each item in items:
      nodeQty = parentQty × item.netQuantity

      if item.children.length == 0:
        // 叶子节点 = 原材料，直接累加
        accumulator[item.componentSkuId] += nodeQty
      else:
        // 中间节点（半成品），透传乘数到子节点
        // 无论是引用件还是直接子料，此处行为相同
        // 关键：引用件的 children 在快照固化时已展开，无需再次查库
        traverseSnapshot(item.children, nodeQty, accumulator)

  return accumulator
```

**关键设计决策：引用件在快照固化时完全展开**

生产工单创建时，`bom_version_snapshots.snapshot_data` 中的 `children` 已经递归展开了所有通用件的子料结构。因此 MRP 计算时只需遍历快照，不需要再回查 `bom_items` 表，也不存在"同一通用件被多次展开但各自独立汇总"的重复问题——汇总发生在叶子节点（原材料），而所有路径下的叶子节点会在同一个 `accumulator` 中累加。

### 3.2 多版本并存时的物料需求计算

**场景**：同一成品存在 v1.0（已激活）和 v2.0（草稿，正在修改），同时有：
- 工单 WO-001 基于 v1.0 的快照（已在生产中）
- 工单 WO-002 基于 v1.0 的快照（刚创建）
- 工单 WO-003 即将创建（v2.0 已激活但 WO-003 还未创建）

MRP 聚合计算规则：
1. 已有工单：始终使用 `bom_snapshot_id` 指向的快照数据，不受当前激活版本影响
2. 待创建工单：使用创建时刻的激活版本展开并生成新快照
3. 跨版本汇总：将所有工单的快照展开后，在叶子节点（原材料）层统一汇总，不在半成品层汇总

```
多工单 MRP 汇总流程：

待生产工单列表
  ├── WO-001 (snapshot_v1)  → 展开 → [白色绒布:5件, 海绵:5块, ...]
  ├── WO-002 (snapshot_v1)  → 展开 → [白色绒布:5件, 海绵:5块, ...]
  └── WO-003 (snapshot_v2)  → 展开 → [白色绒布:6件, 海绵:5块, ...]
                                           ↓ 叶子节点汇总
                                    白色绒布: 5+5+6 = 16件
                                    海绵:     5+5+5 = 15块
```

### 3.3 安全库存扣减算法

**物料净需求计算公式**：

```
净需求量 = max(0, 毛需求量 - 现有可用库存 + 安全库存缓冲)
```

其中：
- **毛需求量**：MRP 展开计算结果（所有待生产工单的原材料总需求）
- **现有可用库存**：`inventory.qty_on_hand - inventory.qty_reserved`（可用量，不含已预留）
- **安全库存缓冲**：`skus.safety_stock`（安全库存下限，确保库存不低于此值）

**扣减时序**：

```sql
-- 安全库存扣减逻辑（伪SQL）
SELECT
  s.id AS sku_id,
  s.sku_code,
  s.sku_name,
  mrp.total_gross_qty                          AS gross_requirement,
  GREATEST(0, i.qty_on_hand - i.qty_reserved)  AS available_qty,
  s.safety_stock,
  GREATEST(0,
    mrp.total_gross_qty
    - GREATEST(0, i.qty_on_hand - i.qty_reserved)
    + s.safety_stock
  )                                             AS net_requirement
FROM mrp_result mrp
JOIN skus s ON s.id = mrp.sku_id
LEFT JOIN inventory i ON i.tenant_id = s.tenant_id AND i.sku_id = s.id
```

**在途库存处理**：

在途采购量（已下采购订单但未到货）可用于减少净需求：
```
调整后净需求 = max(0, 净需求量 - 在途数量)
在途数量 = SUM(purchase_order_items.qty_ordered - qty_received)
           WHERE purchase_orders.status IN ('confirmed', 'partial_received')
```

V2 阶段将在途库存作为可选参数传入计算接口，由前端在生成采购建议时选择是否考虑在途。

### 3.4 缓存策略 V2 修正

**V1 问题**：`bom_items` 被修改后，若 `version` 字符串未变（如仅修改了用量），缓存 key 不变导致读取旧展开结果。

**V2 修正方案**：Redis 缓存 key 不再依赖 `version` 字符串，改为依赖 `bom_headers.updated_at` 时间戳（毫秒级）：

```
缓存 key：bom:expanded:{tenantId}:{bomHeaderId}:{updatedAtMs}
```

失效策略：
1. 任何修改 `bom_items` 的操作（addItem、deleteItem、updateItem）都更新 `bom_headers.updated_at`（通过 MySQL `ON UPDATE CURRENT_TIMESTAMP` 或显式 UPDATE）
2. 激活版本切换时删除旧版本缓存

生产工单使用快照后，不再依赖实时展开缓存计算 MRP，只在 BOM 查看（UI 展示）时使用缓存。

---

## 四、API 设计草案

以下为 Sprint 2 后端工程师需实现的关键接口列表。详细请求/响应 Schema 由 @senior-backend-engineer 在实现阶段补全。

所有接口路径前缀：`/api/v1/boms`

统一返回结构：
```json
{ "code": 0, "data": {}, "message": "success" }
```

### 4.1 BOM 版本管理接口

| 方法 | 路径 | 说明 | 关键约束 |
|---|---|---|---|
| `GET` | `/` | 获取 BOM 列表 | 支持 `skuId`、`bomType`、`status` 过滤 |
| `GET` | `/:id/expand` | 展开 BOM（含通用件递归） | 实时展开，不走工单快照路径 |
| `POST` | `/` | 创建新 BOM（draft 状态） | `bomType` 必填，防循环引用检查增强 |
| `PUT` | `/:id` | 更新 BOM 头信息 | 仅 draft 状态允许修改；status 字段变更走 activate/archive 专用接口 |
| `POST` | `/:id/activate` | 激活 BOM 版本 | 事务内：同 SKU 旧 active→archived，并填写 deprecated_at |
| `POST` | `/:id/copy` | 复制 BOM 为新版本（草稿） | 复制时深拷贝所有 bom_items，引用行的 ref_bom_header_id 保留 |
| `DELETE` | `/:id/items/:itemId` | 删除 BOM 明细行（含子孙） | 同步删除 bom_semi_references 中的相关记录 |
| `GET` | `/:id/material-requirements` | 计算单 BOM 物料需求 | 参数：`productionQty`；使用实时 bom_items 展开 |

### 4.2 通用件引用接口（新增）

| 方法 | 路径 | 说明 | 关键约束 |
|---|---|---|---|
| `GET` | `/semi-list` | 获取可用半成品 BOM 列表 | 仅返回 `bom_type='semi'` 且 `status='active'` 的版本；支持名称/编码搜索 |
| `POST` | `/:id/items/ref` | 向 BOM 添加通用件引用行 | `refBomHeaderId` 必须是激活的半成品 BOM；同步写入 bom_semi_references；防止引用自身 |
| `GET` | `/semi/:semiId/references` | 查询某半成品被哪些成品 BOM 引用 | 返回引用列表（含引用数量、引用方 BOM 名称） |

请求体示例（添加通用件引用行）：
```json
{
  "componentSkuId": 501,
  "refBomHeaderId": 88,
  "quantity": "1.0000",
  "unit": "件",
  "scrapRate": "0.0200"
}
```

### 4.3 工单快照接口（新增，供生产工单模块调用）

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/snapshot` | 为生产工单生成 BOM 快照 |
| `GET` | `/snapshot/:snapshotId` | 读取已有快照数据 |

`POST /snapshot` 请求体：
```json
{
  "productionOrderId": 1001,
  "bomHeaderId": 42
}
```

处理逻辑：
1. 取 `bomHeaderId` 对应的激活版本（状态校验）
2. 递归展开 BOM（含通用件）
3. 将展开结果序列化为 JSON 写入 `bom_version_snapshots`
4. 返回 `snapshotId`

### 4.4 多工单 MRP 聚合接口（新增）

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/mrp/aggregate` | 跨多工单聚合计算物料净需求 |

请求体：
```json
{
  "orders": [
    { "productionOrderId": 1001, "qty": 5 },
    { "productionOrderId": 1002, "qty": 3 }
  ],
  "includeInTransit": true,
  "safetyStockMode": "include"
}
```

响应体（关键字段）：
```json
{
  "code": 0,
  "data": {
    "requirements": [
      {
        "skuId": 601,
        "skuCode": "FAB-WHITE-VELVET",
        "skuName": "白色绒布",
        "grossQty": "21.0000",
        "availableQty": "8.0000",
        "inTransitQty": "5.0000",
        "safetyStock": "3.0000",
        "netQty": "11.0000",
        "unit": "米",
        "hasDyeLot": true
      }
    ],
    "calculatedAt": "2026-04-01T10:00:00.000Z"
  }
}
```

### 4.5 接口权限约束

| 操作 | 最低角色 |
|---|---|
| 查看 BOM | 所有登录用户 |
| 创建/修改 BOM | supervisor（车间主管）及以上 |
| 激活 BOM 版本 | admin（老板） |
| 归档 BOM 版本 | admin |
| 删除 BOM 明细 | supervisor（仅 draft 状态） |
| 生成 MRP 聚合 | supervisor 及以上 |

---

## 五、数据迁移方案

### 5.1 迁移目标

将 V1 所有 BOM 数据无损迁移到 V2 数据模型，满足：
- V1 所有 `status='active'` 的 BOM 版本迁移后仍为 `status='active'`
- 存量 BOM 数据的 `bom_type` 补齐默认值（`finished`）
- 存量生产工单（`production_orders`）自动关联快照
- `is_active` 字段与 `status` 字段同步对齐

### 5.2 迁移步骤

**Step 1：Schema 变更（在维护窗口执行）**

```sql
-- 1.1 bom_headers 添加新字段
ALTER TABLE `bom_headers`
  ADD COLUMN `effective_date`    DATE            DEFAULT NULL AFTER `status`,
  ADD COLUMN `deprecated_at`     DATETIME(3)     DEFAULT NULL AFTER `effective_date`,
  ADD COLUMN `bom_type`          ENUM('finished','semi') NOT NULL DEFAULT 'finished' AFTER `description`;

-- 1.2 添加唯一索引（需先确认 V1 是否存在重复版本，若有须先清理）
-- 先检查
SELECT tenant_id, sku_id, version, COUNT(*) AS cnt
FROM bom_headers
GROUP BY tenant_id, sku_id, version
HAVING cnt > 1;
-- 若无重复，执行：
ALTER TABLE `bom_headers`
  ADD UNIQUE KEY `uk_tenant_sku_version` (`tenant_id`, `sku_id`, `version`);

-- 1.3 bom_items 添加引用字段
ALTER TABLE `bom_items`
  ADD COLUMN `ref_bom_header_id` BIGINT UNSIGNED DEFAULT NULL AFTER `component_sku_id`,
  ADD INDEX `idx_ref_bom_header` (`tenant_id`, `ref_bom_header_id`);

-- 1.4 production_orders 添加快照字段
ALTER TABLE `production_orders`
  ADD COLUMN `bom_snapshot_id` BIGINT UNSIGNED DEFAULT NULL AFTER `bom_header_id`;

-- 1.5 创建新表
CREATE TABLE IF NOT EXISTS `bom_version_snapshots` ( ... );  -- 见 2.4 节
CREATE TABLE IF NOT EXISTS `bom_semi_references`   ( ... );  -- 见 2.5 节
```

**Step 2：数据回填（在迁移脚本中执行）**

```sql
-- 2.1 回填 effective_date：active BOM 设为 updated_at 的日期
UPDATE bom_headers
SET effective_date = DATE(updated_at)
WHERE status = 'active' AND effective_date IS NULL;

-- 2.2 修复 is_active 与 status 不一致的脏数据（确保同步）
UPDATE bom_headers SET is_active = 1 WHERE status = 'active';
UPDATE bom_headers SET is_active = 0 WHERE status != 'active';

-- 2.3 为存量生产工单生成 BOM 快照
-- （通过迁移脚本调用 BomService.createSnapshotForExistingOrder，对所有关联了 bom_header_id 的工单批量生成快照）
-- 注：快照 snapshot_data 以工单创建时刻的 bom_items 状态为准
-- 若工单已完成（completed/cancelled），快照数据可从当时的 bom_items 重建（因为 items 未删除）
-- 迁移脚本伪代码：
-- FOR each production_order WHERE bom_snapshot_id IS NULL:
--   snapshot = expandBom(bom_header_id)
--   INSERT INTO bom_version_snapshots(...)
--   UPDATE production_orders SET bom_snapshot_id = snapshot.id WHERE id = order.id
```

**Step 3：验证（迁移后必须通过的校验查询）**

```sql
-- 检验1：所有工单都有快照
SELECT COUNT(*) FROM production_orders
WHERE bom_snapshot_id IS NULL AND status NOT IN ('cancelled');
-- 期望结果：0

-- 检验2：active BOM 的 effective_date 不为空
SELECT COUNT(*) FROM bom_headers
WHERE status = 'active' AND effective_date IS NULL;
-- 期望结果：0

-- 检验3：is_active 与 status 一致性
SELECT COUNT(*) FROM bom_headers
WHERE (status = 'active' AND is_active = 0)
   OR (status != 'active' AND is_active = 1);
-- 期望结果：0

-- 检验4：V1 存量 BOM 展开结果与 V2 展开结果（通过快照）计算一致性
-- 抽取 10 个活跃 BOM，分别用 V1 算法和 V2 快照算法计算物料需求，对比结果差异率=0
```

### 5.3 回滚方案

Schema 变更使用 `ADD COLUMN` 和新表创建，均为非破坏性操作。若迁移失败：
1. 删除新表：`DROP TABLE bom_version_snapshots; DROP TABLE bom_semi_references;`
2. 删除新增列：`ALTER TABLE bom_headers DROP COLUMN effective_date, DROP COLUMN deprecated_at, DROP COLUMN bom_type;`
3. V1 代码无感知恢复运行

**关键回滚约束**：唯一索引 `uk_tenant_sku_version` 若已添加，回滚时须先删除：
`ALTER TABLE bom_headers DROP INDEX uk_tenant_sku_version;`

---

## 六、风险评估

### 6.1 复杂度评分总览

| 技术模块 | 实现复杂度 | 风险等级 | 缓解措施 |
|---|---|---|---|
| Schema 变更 + 数据迁移 | 中 | P1 | 维护窗口执行，先测试环境验证，预留回滚脚本 |
| 通用件引用展开算法 | 高 | P0 | 单独实现 + 单测覆盖（至少 8 个场景） |
| 快照固化逻辑 | 中 | P1 | 工单创建与快照生成在同一事务中 |
| 多工单 MRP 聚合 | 高 | P0 | 与 V1 单 BOM 计算结果做对比基准测试 |
| 循环引用检测增强 | 中 | P1 | 建立有向图 DFS 检测，覆盖间接循环场景 |
| 缓存 key 策略修正 | 低 | P2 | 单元测试覆盖失效触发场景 |

### 6.2 P0 风险详细描述

#### 风险 ARCH-BOM-R01：通用件循环引用

**场景**：A（成品）→ B（半成品，引用件）→ C（原料），若 C 被错误注册为半成品 BOM 并引用 A，则形成循环。

**增强检测算法**：

在创建/修改 `bom_items` 时，不仅检测直接自引用，还需检测完整引用链：

```typescript
// 伪代码：引用链循环检测
async function checkCircularRef(
  rootBomHeaderId: number,   // 当前正在编辑的BOM
  newRefBomHeaderId: number, // 即将添加的引用目标
): Promise<void> {
  // 获取 newRefBomHeaderId 的所有下游引用（递归）
  const downstream = await getAllDownstreamBomIds(newRefBomHeaderId);
  if (downstream.has(rootBomHeaderId)) {
    throw new AppError('检测到循环引用：引用链中存在当前BOM');
  }
}
```

**接受边界**：展开深度限制仍为 10 层（包含引用展开的层数），超过 10 层抛出业务错误。

#### 风险 ARCH-BOM-R02：快照数据体积膨胀

**场景**：复杂家具产品 BOM 可能有 5-8 层结构，100+ 个叶子节点，快照 JSON 可能达到 50-200KB。

**缓解措施**：
1. 快照 JSON 在写入前做 GZIP 压缩，MySQL JSON 列存储压缩数据（应用层解压）
2. 对超过 500 个节点的 BOM 展开发出警告日志
3. 30 天后完成的工单快照可迁移至冷存储（归档表），主表保留 90 天内的快照

#### 风险 ARCH-BOM-R03：半成品 BOM 版本激活时的引用一致性

**场景**：半成品 BOM_TAIL_WF 从 v1.0 激活新版本 v2.0，此时有进行中的工单 WO-001（快照基于 v1.0）和新工单 WO-002（待创建，将使用 v2.0）。

**规则**：
1. 半成品 BOM 激活新版本 **不触发** 对已有成品 BOM 的 `bom_items` 自动更新
2. 已有成品 BOM（处于 active 状态）中引用该半成品的 `ref_bom_header_id` 不变（仍指向旧版本半成品 BOM ID）
3. 若成品 BOM 需要使用半成品新版本，必须显式操作：新建成品 BOM 草稿版本 → 更新引用行的 `ref_bom_header_id` 至新半成品版本 → 激活成品 BOM 新版本
4. 前端在展示时检测引用的半成品版本是否是最新激活版本，若不是则显示"可升级"提示（黄色标记），但不强制升级

**此规则符合 BD-001 快照机制精神**：人工驱动版本同步，避免自动级联更新导致的数据突变风险。

### 6.3 测试要求（交付给 @senior-qa-engineer）

Sprint 2 BOM 模块至少需要覆盖以下测试场景：

| # | 测试场景 | 类型 |
|---|---|---|
| T01 | 创建半成品 BOM，激活后被成品 BOM 引用 | 集成测试 |
| T02 | 同一通用件被 3 个成品 BOM 引用，MRP 计算结果正确合并 | 单元测试 |
| T03 | 成品 BOM 激活 v2.0 后，已有工单仍使用 v1.0 快照计算 | 集成测试 |
| T04 | 工单创建时 BOM 无激活版本，系统拒绝并返回明确错误 | 边界测试 |
| T05 | 循环引用：A→B→A 的间接循环被拒绝 | 边界测试 |
| T06 | 循环引用：A→B→C→A 的三跳循环被拒绝 | 边界测试 |
| T07 | V1 存量 BOM 数据迁移后，MRP 计算结果与 V1 一致（基准对比） | 回归测试 |
| T08 | 半成品 BOM 版本升级后，成品 BOM 中显示"可升级"提示 | 功能测试 |
| T09 | 多工单 MRP 聚合：5 个工单共用通用件，净需求计算正确 | 集成测试 |
| T10 | 安全库存扣减：含在途库存的净需求 = 毛需求 - 可用库存 - 在途 + 安全库存 | 单元测试 |
| T11 | BOM 明细修改后 Redis 缓存正确失效，展开结果无旧数据 | 集成测试 |
| T12 | 快照 JSON 大于 100KB 时写入不报错，读取并正确反序列化 | 性能测试 |

---

## 附录 A：与 Sprint 3/4 的接口预留

以下接口在 Sprint 2 阶段仅完成 Schema 设计和接口定义（返回 501 Not Implemented），Sprint 3/4 阶段实现：

| 接口 | Sprint | 说明 |
|---|---|---|
| `POST /mrp/aggregate` | Sprint 3 | 多工单 MRP 聚合（依赖工单完整链路） |
| 安全库存 + 在途扣减算法 | Sprint 4 | 依赖完整采购数据链路 |
| BOM 通用件自动升级建议 | Sprint 4 | 在智能调度模块中实现 |

---

## 附录 B：向 @senior-backend-engineer 的实现约束

1. `bom_headers` 的 `status` 状态机转换必须在 Service 层强制校验，Controller 层不做状态判断
2. 所有 BOM 写操作必须在事务内执行，`bom_semi_references` 的同步写入必须与主操作在同一事务
3. `activateBom` 方法必须在同一事务内：(a) 填写旧版本 `deprecated_at`，(b) 将旧版本 `is_active` 改为 0，(c) 激活新版本，(d) 失效所有相关 Redis 缓存 key
4. 新增 `addBomItemRef`（添加通用件引用行）与 `addBomItem`（添加直接子料）须为独立方法，不合并
5. `expandBom` 方法须增加引用件展开分支：遇到 `ref_bom_header_id IS NOT NULL` 时，递归展开引用的半成品 BOM（取其激活版本的 items）而非查当前 BOM 的子节点
6. 禁止在 Controller 层直接操作 `bom_semi_references` 表，所有相关写操作必须封装在 Service 方法内

---

## 附录 C：向 @senior-frontend-engineer 的 UI 约束

1. BOM 列表页须增加 `bom_type` 筛选（成品 BOM / 半成品 BOM）
2. 版本列表需展示版本状态（草稿/激活/历史），激活版本以绿色标签高亮
3. 引用件在 BOM 明细树中以不同图标/颜色区分（如锁链图标），不可在成品 BOM 页内展开编辑
4. 添加通用件时弹出半成品搜索选择器，展示"已被 N 个 BOM 引用"计数（从 `bom_semi_references` 聚合）
5. 半成品 BOM 页激活新版本时，若有成品 BOM 引用旧版本，弹出影响提示框（"以下 N 个成品 BOM 引用了旧版本，建议升级"），不强制但应提示
6. 所有版本操作（激活、复制、归档）需要有操作确认弹窗，明确展示影响范围

---

*文档版本*：v1.0
*最后更新*：2026-03-12
*下一步行动*：
- @senior-backend-engineer 阅读本文档后开始 Sprint 2 后端设计（BOM 版本化 + 通用件 API）
- @senior-qa-engineer 基于附录中的测试场景列表准备测试用例
- @engineering-manager 对本架构设计进行 SDD 审批后方可进入编码阶段
