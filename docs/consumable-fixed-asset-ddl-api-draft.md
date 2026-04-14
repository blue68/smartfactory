# 损耗品与固定资产管控扩展方案（DDL 草案 + API 示例）

[artifact:DBDesign]
status: READY
owner: senior-backend-engineer
scope:
- 损耗品与固定资产的字段级 DDL 草案
- 与现有 BOM、MRP、采购、库存流程的兼容边界
inputs:
- 现有 `skus`、`purchase_orders`、`purchase_order_items`、`inventory_transactions`、`material_requirements` 表结构
- 现有 BOM 展开、工单缺料、采购建议生成逻辑
handoff_to:
- tech-lead-architect
- engineering-manager
deliverables:
- 可用于架构评审和迁移设计的数据库草案
risks:
- 若固定资产误复用生产库存可用量，会污染缺料与采购建议结果
- 若损耗品默认进入 BOM，会误入 `material_requirements`
exit_criteria:
- 新增能力全部以前向兼容方式接入，不改变现有原材料、半成品、成品链路

[artifact:APIDoc]
status: READY
owner: senior-backend-engineer
scope:
- 损耗品与固定资产相关 API 草案
- 请求/响应示例与校验约束
inputs:
- 现有 API 统一响应规范
handoff_to:
- senior-frontend-engineer
- senior-qa-engineer
deliverables:
- 可用于前后端联调与测试用例设计的接口草案
risks:
- 若采购收货接口不按 `receipt_mode` 分流，资产与损耗品会共用错误的入账路径
exit_criteria:
- 接口层可以清晰区分生产物料、损耗品、固定资产三类业务对象

**文档版本**：v0.1  
**创建日期**：2026-04-13  
**适用范围**：在不破坏当前原材料、半成品、成品全流程管控的前提下，扩展损耗品与固定资产管理。  
**说明**：本文档为实施草案，字段、索引与接口命名尽量贴合当前工程风格，但尚未落库和联调。

---

## 一、兼容原则

1. 现有 `MATERIAL / SEMIFIN / FINISHED` 的业务语义保持不变。
2. `material_requirements` 继续只表示生产工单原材料需求，不承接损耗品与固定资产。
3. BOM 子项准入改为“分类 + 管控策略”双重控制，默认只有生产物料可以进入 BOM。
4. 损耗品可复用采购与库存主干，但不进入 MRP、缺料检测、AI 采购建议。
5. 固定资产走独立资产台账，不进入生产库存可用量计算。

---

## 二、字段级 DDL 草案

## 2.1 SKU 主数据扩展

目标：不重写现有分类体系，仅在 `skus` 上增加一层“管控策略”。

```sql
ALTER TABLE `skus`
  ADD COLUMN `business_class`
    ENUM('production_material','consumable','fixed_asset')
    NOT NULL DEFAULT 'production_material'
    COMMENT '业务大类：生产物料 / 损耗品 / 固定资产'
    AFTER `description`,
  ADD COLUMN `control_mode`
    ENUM('mrp','stock_only','direct_expense','asset')
    NOT NULL DEFAULT 'mrp'
    COMMENT '控制模式：MRP驱动 / 仅库存 / 直耗 / 资产'
    AFTER `business_class`,
  ADD COLUMN `allow_bom_component`
    TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '是否允许作为 BOM 子项'
    AFTER `control_mode`,
  ADD COLUMN `allow_purchase`
    TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '是否允许走采购流程'
    AFTER `allow_bom_component`,
  ADD COLUMN `allow_inventory`
    TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '是否进入库存账'
    AFTER `allow_purchase`,
  ADD COLUMN `allow_production_issue`
    TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '是否允许走生产领料/投料'
    AFTER `allow_inventory`,
  ADD COLUMN `requires_asset_acceptance`
    TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '是否必须通过资产验收建卡'
    AFTER `allow_production_issue`,
  ADD COLUMN `default_warehouse_type`
    VARCHAR(30) DEFAULT NULL
    COMMENT '默认仓库类型：raw_material / consumable / asset_pending / asset / finished'
    AFTER `requires_asset_acceptance`,
  ADD COLUMN `approval_policy_code`
    VARCHAR(50) DEFAULT NULL
    COMMENT '审批策略编码'
    AFTER `default_warehouse_type`,
  ADD COLUMN `asset_tracking_mode`
    ENUM('none','batch','serial')
    NOT NULL DEFAULT 'none'
    COMMENT '资产追踪模式：无 / 批次 / 单件序列号'
    AFTER `approval_policy_code`;

ALTER TABLE `skus`
  ADD KEY `idx_tenant_business_class` (`tenant_id`, `business_class`),
  ADD KEY `idx_tenant_control_mode` (`tenant_id`, `control_mode`);
```

建议回填规则：

```sql
-- 原材料
UPDATE `skus` s
INNER JOIN `sku_categories` c ON c.id = s.category1_id
SET
  s.business_class = 'production_material',
  s.control_mode = 'mrp',
  s.allow_bom_component = 1,
  s.allow_purchase = 1,
  s.allow_inventory = 1,
  s.allow_production_issue = 1,
  s.requires_asset_acceptance = 0,
  s.default_warehouse_type = 'raw_material',
  s.asset_tracking_mode = 'none'
WHERE c.code = 'MATERIAL';

-- 半成品
UPDATE `skus` s
INNER JOIN `sku_categories` c ON c.id = s.category1_id
SET
  s.business_class = 'production_material',
  s.control_mode = 'mrp',
  s.allow_bom_component = 1,
  s.allow_purchase = 1,
  s.allow_inventory = 1,
  s.allow_production_issue = 1,
  s.requires_asset_acceptance = 0,
  s.default_warehouse_type = 'raw_material',
  s.asset_tracking_mode = 'none'
WHERE c.code = 'SEMIFIN';

-- 成品
UPDATE `skus` s
INNER JOIN `sku_categories` c ON c.id = s.category1_id
SET
  s.business_class = 'production_material',
  s.control_mode = 'mrp',
  s.allow_bom_component = 0,
  s.allow_purchase = 0,
  s.allow_inventory = 1,
  s.allow_production_issue = 0,
  s.requires_asset_acceptance = 0,
  s.default_warehouse_type = 'finished',
  s.asset_tracking_mode = 'none'
WHERE c.code = 'FINISHED';

-- 包材辅料，如租户侧已存在 PACKING 类目，默认先按损耗品处理
UPDATE `skus` s
INNER JOIN `sku_categories` c ON c.id = s.category1_id
SET
  s.business_class = 'consumable',
  s.control_mode = 'stock_only',
  s.allow_bom_component = 0,
  s.allow_purchase = 1,
  s.allow_inventory = 1,
  s.allow_production_issue = 0,
  s.requires_asset_acceptance = 0,
  s.default_warehouse_type = 'consumable',
  s.asset_tracking_mode = 'none'
WHERE c.code = 'PACKING';
```

## 2.2 损耗品档案表

```sql
CREATE TABLE IF NOT EXISTS `sku_consumable_profiles` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `sku_id`              BIGINT UNSIGNED NOT NULL,
  `issue_mode`          ENUM('department_issue','direct_expense') NOT NULL DEFAULT 'department_issue'
                        COMMENT '领用方式：部门领用 / 直接费用化',
  `approval_level`      ENUM('none','normal','strict') NOT NULL DEFAULT 'normal'
                        COMMENT '审批强度',
  `expense_subject`     VARCHAR(100) DEFAULT NULL COMMENT '默认费用科目',
  `min_stock`           DECIMAL(16,4) NOT NULL DEFAULT 0 COMMENT '最低库存',
  `max_stock`           DECIMAL(16,4) DEFAULT NULL COMMENT '最高库存',
  `purchase_lead_days`  SMALLINT UNSIGNED DEFAULT NULL COMMENT '采购提前期',
  `issue_dept_required` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '领用时是否必须选择部门',
  `notes`               VARCHAR(500) DEFAULT NULL,
  `created_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_sku` (`tenant_id`, `sku_id`),
  KEY `idx_tenant_issue_mode` (`tenant_id`, `issue_mode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='损耗品控制档案';
```

## 2.3 固定资产档案表

```sql
CREATE TABLE IF NOT EXISTS `sku_asset_profiles` (
  `id`                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`             BIGINT UNSIGNED NOT NULL,
  `sku_id`                BIGINT UNSIGNED NOT NULL,
  `asset_category`        VARCHAR(50) NOT NULL COMMENT '资产类别编码，如 equipment / it / office',
  `depreciation_method`   ENUM('straight_line','manual','none') NOT NULL DEFAULT 'straight_line'
                          COMMENT '折旧方式',
  `useful_life_months`    SMALLINT UNSIGNED DEFAULT NULL COMMENT '使用寿命（月）',
  `residual_rate`         DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT '残值率',
  `capex_subject`         VARCHAR(100) DEFAULT NULL COMMENT '资本化科目',
  `requires_serial_no`    TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否要求序列号',
  `maintenance_cycle_days` SMALLINT UNSIGNED DEFAULT NULL COMMENT '保养周期（天）',
  `warranty_months`       SMALLINT UNSIGNED DEFAULT NULL COMMENT '保修期（月）',
  `notes`                 VARCHAR(500) DEFAULT NULL,
  `created_at`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`            BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`            BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_sku` (`tenant_id`, `sku_id`),
  KEY `idx_tenant_asset_category` (`tenant_id`, `asset_category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='固定资产控制档案';
```

## 2.4 采购单明细扩展

目标：让采购明细在收货时能分流到库存、直耗、资产建卡三条路径。

```sql
ALTER TABLE `purchase_order_items`
  ADD COLUMN `business_class`
    ENUM('production_material','consumable','fixed_asset')
    NOT NULL DEFAULT 'production_material'
    COMMENT '采购明细业务大类'
    AFTER `sku_id`,
  ADD COLUMN `receipt_mode`
    ENUM('inventory','direct_expense','asset_capitalization')
    NOT NULL DEFAULT 'inventory'
    COMMENT '收货入账模式'
    AFTER `business_class`,
  ADD COLUMN `requires_acceptance`
    TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '是否要求验收'
    AFTER `receipt_mode`,
  ADD COLUMN `request_department_id`
    BIGINT UNSIGNED DEFAULT NULL
    COMMENT '需求部门'
    AFTER `requires_acceptance`,
  ADD COLUMN `budget_code`
    VARCHAR(50) DEFAULT NULL
    COMMENT '预算编号'
    AFTER `request_department_id`;

ALTER TABLE `purchase_order_items`
  ADD KEY `idx_tenant_business_class` (`tenant_id`, `business_class`);
```

## 2.5 库存流水扩展

固定资产不建议以 `inventory_transactions` 作为主账，但损耗品领用建议继续复用该表。

```sql
ALTER TABLE `inventory_transactions`
  ADD COLUMN `business_class`
    ENUM('production_material','consumable')
    NOT NULL DEFAULT 'production_material'
    COMMENT '库存流水业务大类，仅生产物料和损耗品使用'
    AFTER `sku_id`,
  ADD COLUMN `department_id`
    BIGINT UNSIGNED DEFAULT NULL
    COMMENT '损耗品领用部门'
    AFTER `reference_no`,
  ADD COLUMN `issue_order_id`
    BIGINT UNSIGNED DEFAULT NULL
    COMMENT '关联损耗品领用单'
    AFTER `department_id`;

ALTER TABLE `inventory_transactions`
  ADD KEY `idx_tenant_business_created` (`tenant_id`, `business_class`, `created_at`);
```

新增交易类型约定：

- `CONSUMABLE_IN`
- `CONSUMABLE_OUT`
- `CONSUMABLE_ADJUST`

说明：固定资产的 `receipt / transfer / scrap` 统一记录在 `asset_movements`，不再进入 `inventory_transactions`。

## 2.6 损耗品领用单

```sql
CREATE TABLE IF NOT EXISTS `consumable_issue_orders` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT UNSIGNED NOT NULL,
  `issue_no`        VARCHAR(50) NOT NULL COMMENT '领用单号',
  `department_id`   BIGINT UNSIGNED NOT NULL COMMENT '领用部门',
  `purpose`         VARCHAR(200) DEFAULT NULL COMMENT '领用用途',
  `status`          ENUM('draft','approved','issued','cancelled') NOT NULL DEFAULT 'draft',
  `requested_by`    BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '申请人',
  `approved_by`     BIGINT UNSIGNED DEFAULT NULL COMMENT '审批人',
  `approved_at`     DATETIME(3) DEFAULT NULL,
  `issued_by`       BIGINT UNSIGNED DEFAULT NULL COMMENT '发料人',
  `issued_at`       DATETIME(3) DEFAULT NULL,
  `notes`           VARCHAR(500) DEFAULT NULL,
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_issue_no` (`tenant_id`, `issue_no`),
  KEY `idx_tenant_department_status` (`tenant_id`, `department_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='损耗品领用单';
```

```sql
CREATE TABLE IF NOT EXISTS `consumable_issue_items` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT UNSIGNED NOT NULL,
  `issue_order_id`  BIGINT UNSIGNED NOT NULL,
  `sku_id`          BIGINT UNSIGNED NOT NULL,
  `warehouse_id`    BIGINT UNSIGNED DEFAULT NULL,
  `location_id`     BIGINT UNSIGNED DEFAULT NULL,
  `qty_issued`      DECIMAL(16,4) NOT NULL COMMENT '领用数量',
  `stock_unit`      VARCHAR(20) NOT NULL,
  `expense_subject` VARCHAR(100) DEFAULT NULL,
  `notes`           VARCHAR(500) DEFAULT NULL,
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_issue_order` (`tenant_id`, `issue_order_id`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='损耗品领用明细';
```

## 2.7 固定资产卡片与流转账

```sql
CREATE TABLE IF NOT EXISTS `asset_cards` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`          BIGINT UNSIGNED NOT NULL,
  `sku_id`             BIGINT UNSIGNED NOT NULL COMMENT '来源SKU',
  `asset_no`           VARCHAR(50) NOT NULL COMMENT '资产编号',
  `asset_name`         VARCHAR(200) NOT NULL COMMENT '资产名称',
  `spec`               VARCHAR(500) DEFAULT NULL COMMENT '规格型号',
  `serial_no`          VARCHAR(100) DEFAULT NULL COMMENT '设备序列号',
  `purchase_order_id`  BIGINT UNSIGNED DEFAULT NULL,
  `purchase_item_id`   BIGINT UNSIGNED DEFAULT NULL,
  `receipt_id`         BIGINT UNSIGNED DEFAULT NULL COMMENT '采购收货/验收单ID',
  `warehouse_id`       BIGINT UNSIGNED DEFAULT NULL,
  `location_id`        BIGINT UNSIGNED DEFAULT NULL,
  `department_id`      BIGINT UNSIGNED DEFAULT NULL COMMENT '使用部门',
  `custodian_user_id`  BIGINT UNSIGNED DEFAULT NULL COMMENT '责任人',
  `original_value`     DECIMAL(16,2) NOT NULL COMMENT '原值',
  `capitalized_at`     DATETIME(3) DEFAULT NULL COMMENT '资本化日期',
  `status`             ENUM('in_storage','in_use','idle','repair','scrapped') NOT NULL DEFAULT 'in_storage',
  `notes`              VARCHAR(500) DEFAULT NULL,
  `created_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_asset_no` (`tenant_id`, `asset_no`),
  UNIQUE KEY `uk_tenant_serial_no` (`tenant_id`, `serial_no`),
  KEY `idx_tenant_status` (`tenant_id`, `status`),
  KEY `idx_tenant_department` (`tenant_id`, `department_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='固定资产卡片台账';
```

```sql
CREATE TABLE IF NOT EXISTS `asset_movements` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`          BIGINT UNSIGNED NOT NULL,
  `asset_card_id`      BIGINT UNSIGNED NOT NULL,
  `movement_no`        VARCHAR(50) NOT NULL COMMENT '资产流水号',
  `movement_type`      ENUM('receipt','assign','transfer','return','repair','scrap')
                       NOT NULL COMMENT '资产流转类型',
  `from_department_id` BIGINT UNSIGNED DEFAULT NULL,
  `to_department_id`   BIGINT UNSIGNED DEFAULT NULL,
  `from_location_id`   BIGINT UNSIGNED DEFAULT NULL,
  `to_location_id`     BIGINT UNSIGNED DEFAULT NULL,
  `reference_type`     VARCHAR(50) DEFAULT NULL,
  `reference_id`       BIGINT UNSIGNED DEFAULT NULL,
  `notes`              VARCHAR(500) DEFAULT NULL,
  `occurred_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_movement_no` (`tenant_id`, `movement_no`),
  KEY `idx_tenant_asset_time` (`tenant_id`, `asset_card_id`, `occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='固定资产流转流水';
```

## 2.8 仓库类型建议

当前 `warehouses.type` 已可复用，无需新增字段，建议补以下类型值：

```sql
INSERT INTO `warehouses`
  (`tenant_id`, `code`, `name`, `type`, `status`, `created_by`, `updated_by`)
VALUES
  (1, 'WH-CONS', '损耗品仓', 'consumable', 'active', 0, 0),
  (1, 'WH-AST-PEND', '资产待验收仓', 'asset_pending', 'active', 0, 0),
  (1, 'WH-AST', '资产仓', 'asset', 'active', 0, 0);
```

---

## 三、服务端校验规则

## 3.1 BOM 校验

- `allow_bom_component = 0` 的 SKU 禁止保存到 `bom_items`
- `business_class = 'fixed_asset'` 的 SKU 一律禁止保存到 BOM
- `business_class = 'consumable'` 默认禁止，只有明确配置 `allow_bom_component = 1` 才放行

建议错误信息：

```json
{
  "code": 1001,
  "data": null,
  "message": "当前SKU不允许作为BOM子项，请检查物料管控属性"
}
```

## 3.2 工单与 MRP 校验

- BOM 展开后，只将 `business_class = 'production_material'` 的叶子节点写入 `material_requirements`
- `control_mode != 'mrp'` 的 SKU 不参与缺料检测和采购建议
- 损耗品与固定资产不进入 `purchase_suggestions`

## 3.3 采购收货分流

- `receipt_mode = 'inventory'`：走现有收货入库逻辑
- `receipt_mode = 'direct_expense'`：登记到货并结束，不写库存，不生成资产卡片
- `receipt_mode = 'asset_capitalization'`：登记到货后进入资产验收建卡流程

---

## 四、API 草案与请求/响应示例

以下接口为草案，响应结构沿用当前统一规范：

```json
{
  "code": 0,
  "data": {},
  "message": "操作成功"
}
```

## 4.1 新增损耗品 SKU

```http
POST /api/sku
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "skuCode": "CONS-GLOVE-001",
  "name": "耐磨手套",
  "spec": "12副/箱",
  "category1Id": 1004,
  "category2Id": 2107,
  "stockUnit": "副",
  "purchaseUnit": "箱",
  "productionUnit": "副",
  "stockConvFactor": 12,
  "safetyStock": 120,
  "status": "active",
  "businessClass": "consumable",
  "controlMode": "stock_only",
  "allowBomComponent": false,
  "allowPurchase": true,
  "allowInventory": true,
  "allowProductionIssue": false,
  "requiresAssetAcceptance": false,
  "defaultWarehouseType": "consumable",
  "approvalPolicyCode": "CONS-NORMAL",
  "assetTrackingMode": "none",
  "consumableProfile": {
    "issueMode": "department_issue",
    "approvalLevel": "normal",
    "expenseSubject": "制造费用-低值易耗",
    "minStock": 120,
    "maxStock": 600,
    "purchaseLeadDays": 7,
    "issueDeptRequired": true,
    "notes": "默认按部门领用出库"
  }
}
```

```json
{
  "code": 0,
  "data": {
    "id": 9801001,
    "skuCode": "CONS-GLOVE-001"
  },
  "message": "损耗品SKU创建成功"
}
```

## 4.2 新增固定资产 SKU

```http
POST /api/sku
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "skuCode": "FA-CNC-001",
  "name": "数控开料机",
  "spec": "CNC-1325",
  "category1Id": 1010,
  "category2Id": 2201,
  "stockUnit": "台",
  "purchaseUnit": "台",
  "productionUnit": "台",
  "stockConvFactor": 1,
  "safetyStock": 0,
  "status": "active",
  "businessClass": "fixed_asset",
  "controlMode": "asset",
  "allowBomComponent": false,
  "allowPurchase": true,
  "allowInventory": false,
  "allowProductionIssue": false,
  "requiresAssetAcceptance": true,
  "defaultWarehouseType": "asset_pending",
  "approvalPolicyCode": "ASSET-STRICT",
  "assetTrackingMode": "serial",
  "assetProfile": {
    "assetCategory": "equipment",
    "depreciationMethod": "straight_line",
    "usefulLifeMonths": 60,
    "residualRate": 5,
    "capexSubject": "固定资产-生产设备",
    "requiresSerialNo": true,
    "maintenanceCycleDays": 90,
    "warrantyMonths": 12,
    "notes": "需到货验收后生成资产卡片"
  }
}
```

```json
{
  "code": 0,
  "data": {
    "id": 9802001,
    "skuCode": "FA-CNC-001"
  },
  "message": "固定资产SKU创建成功"
}
```

## 4.3 新建采购单

建议采购页面按业务类型分开建单，但接口允许单据明细显式声明 `businessClass` 与 `receiptMode`。

```http
POST /api/purchase/orders
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "supplierId": 301,
  "expectedDate": "2026-04-20",
  "notes": "4月耗材采购",
  "items": [
    {
      "skuId": 9801001,
      "businessClass": "consumable",
      "receiptMode": "inventory",
      "requiresAcceptance": false,
      "requestDepartmentId": 21,
      "budgetCode": "BGT-2026-MFG-04",
      "qtyOrdered": 20,
      "purchaseUnit": "箱",
      "unitPrice": 180
    }
  ]
}
```

```json
{
  "code": 0,
  "data": {
    "id": 760001,
    "poNo": "PO-20260413-001"
  },
  "message": "采购单创建成功"
}
```

## 4.4 创建损耗品领用单

```http
POST /api/consumables/issues
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "departmentId": 21,
  "purpose": "车间日常防护用品领用",
  "notes": "周领用",
  "items": [
    {
      "skuId": 9801001,
      "warehouseId": 11,
      "locationId": 1101,
      "qtyIssued": 24,
      "stockUnit": "副",
      "expenseSubject": "制造费用-低值易耗",
      "notes": "一线班组"
    }
  ]
}
```

```json
{
  "code": 0,
  "data": {
    "id": 880001,
    "issueNo": "CI-20260413-001",
    "status": "draft"
  },
  "message": "损耗品领用单创建成功"
}
```

## 4.5 审批损耗品领用单

```http
POST /api/consumables/issues/880001/approve
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "approved": true,
  "comment": "按车间周计划发放"
}
```

```json
{
  "code": 0,
  "data": {
    "id": 880001,
    "status": "approved"
  },
  "message": "损耗品领用单审批成功"
}
```

## 4.6 执行损耗品出库

```http
POST /api/consumables/issues/880001/execute
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "operatorId": 56
}
```

```json
{
  "code": 0,
  "data": {
    "id": 880001,
    "status": "issued",
    "inventoryTransactionNos": [
      "IT-20260413-101",
      "IT-20260413-102"
    ]
  },
  "message": "损耗品已完成出库"
}
```

## 4.7 固定资产到货验收并建卡

```http
POST /api/assets/acceptance
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "purchaseOrderId": 760101,
  "purchaseItemId": 76010101,
  "skuId": 9802001,
  "warehouseId": 31,
  "locationId": 3101,
  "qtyAccepted": 1,
  "unitPrice": 68000,
  "serialNo": "SN-CNC-20260413001",
  "departmentId": 21,
  "custodianUserId": 105,
  "capitalizedAt": "2026-04-13T10:30:00+08:00",
  "notes": "安装调试完成，验收通过"
}
```

```json
{
  "code": 0,
  "data": {
    "assetCardIds": [990001],
    "assetNos": ["FA-20260413-001"]
  },
  "message": "固定资产验收并建卡成功"
}
```

## 4.8 固定资产调拨

```http
POST /api/assets/cards/990001/transfer
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "toDepartmentId": 25,
  "toLocationId": 3202,
  "notes": "由木工车间调拨至组装车间"
}
```

```json
{
  "code": 0,
  "data": {
    "id": 990001,
    "status": "in_use",
    "movementNo": "AM-20260413-001"
  },
  "message": "资产调拨成功"
}
```

## 4.9 固定资产退回

```http
POST /api/assets/cards/990001/return
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "locationText": "资产中转区-A01",
  "notes": "设备已由组装车间归还仓库"
}
```

```json
{
  "code": 0,
  "data": null,
  "message": "固定资产退回完成"
}
```

说明：
- 退回后资产状态回到 `idle`
- `departmentId` 与 `custodianUserId` 清空
- 同步记录 `movement_type = return` 的资产流水

## 4.10 查询资产台账列表

```http
GET /api/assets/cards?page=1&pageSize=20&status=in_use&departmentId=25
Authorization: Bearer <token>
```

```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "id": 990001,
        "assetNo": "FA-20260413-001",
        "assetName": "数控开料机",
        "skuId": 9802001,
        "serialNo": "SN-CNC-20260413001",
        "departmentId": 25,
        "departmentName": "组装车间",
        "custodianUserId": 105,
        "custodianUserName": "李工",
        "warehouseId": 32,
        "locationId": 3202,
        "originalValue": "68000.00",
        "status": "in_use",
        "capitalizedAt": "2026-04-13T10:30:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  },
  "message": "查询成功"
}
```

---

## 五、前后端联调约束

1. SKU 编辑页在 `businessClass` 切换时动态展示 `consumableProfile` 或 `assetProfile`。
2. BOM 编辑器保存前必须读取 SKU 的 `allowBomComponent`。
3. 采购收货页必须根据 `receiptMode` 切换流程文案与提交目标。
4. 库存页默认只展示 `business_class in ('production_material','consumable')`。
5. 资产台账页单独展示 `asset_cards`，不与现有库存快照混表。

---

## 六、回归验证清单

## 6.1 必测回归

- 原材料创建、采购、来料、入库、缺料检测、采购建议全部保持原样
- 半成品 BOM 展开、外协采购、工单领料不受影响
- 成品工单、入库、交付、结算不受影响
- 现有库存报表仍只统计生产物料和库存型损耗品

## 6.2 新增测试

- 损耗品库存型采购入库成功，且不生成 `material_requirements`
- 损耗品直耗型采购到货成功，且不写 `inventory`
- 固定资产采购到货后可建卡，且不进入缺料与采购建议
- 包材被配置为 `allow_bom_component = 1` 时可进入 BOM，未配置时被拒绝

---

## 七、实施建议

建议按以下顺序实施迁移与代码改造：

1. 先加 `skus` 控制字段并回填旧数据。
2. 再给 BOM、工单展开、MRP、采购建议加守卫逻辑。
3. 之后实现损耗品领用闭环。
4. 最后实现固定资产验收建卡与调拨。

推荐迁移文件命名：

- `M20260413_sku_control_mode_extension.sql`
- `M20260413_consumable_issue_tables.sql`
- `M20260413_asset_ledger_tables.sql`
- `M20260413_bom_mrp_guard_by_business_class.sql`
