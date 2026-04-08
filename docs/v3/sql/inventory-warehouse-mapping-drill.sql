-- inventory-warehouse-mapping-drill.sql
-- 业务映射接入 + 全量迁移演练脚本（仅用于演练环境）
-- 目标：
--   1) 接入业务侧映射数据到 inventory_location_mappings
--   2) 按“映射优先、默认兜底”回填 inventory / inventory_transactions
--   3) 记录 fallback 明细到 migration_unmapped_records，输出演练指标
-- 参数：
--   SET @tenant_id = 1;
--   SET @operator_id = 0;
--   SET @batch_no = CONCAT('DRILL_', DATE_FORMAT(NOW(3), '%Y%m%d%H%i%s'));
--
-- 前置条件：
--   - 仅在演练环境执行，执行前完成全量备份
--   - 已存在 DEFAULT / DEFAULT-UNKNOWN 主数据

SET @tenant_id = COALESCE(@tenant_id, 1);
SET @operator_id = COALESCE(@operator_id, 0);
SET @batch_no = COALESCE(@batch_no, CONCAT('DRILL_', DATE_FORMAT(NOW(3), '%Y%m%d%H%i%s')));

-- 0) 默认仓位预检查
SELECT
  w.id AS default_warehouse_id,
  l.id AS default_location_id
INTO @default_warehouse_id, @default_location_id
FROM warehouses w
INNER JOIN locations l
  ON l.tenant_id = w.tenant_id
 AND l.warehouse_id = w.id
WHERE w.tenant_id = @tenant_id
  AND w.code = 'DEFAULT'
  AND l.code = 'DEFAULT-UNKNOWN'
LIMIT 1;

SELECT
  @default_warehouse_id AS default_warehouse_id,
  @default_location_id AS default_location_id;

-- 1) 映射导入临时表（先导入业务方 CSV，再执行 upsert）
DROP TEMPORARY TABLE IF EXISTS tmp_inventory_location_mapping_import;
CREATE TEMPORARY TABLE tmp_inventory_location_mapping_import (
  sku_code VARCHAR(64) NOT NULL,
  source_note VARCHAR(255) NOT NULL,
  warehouse_code VARCHAR(64) NOT NULL,
  location_code VARCHAR(64) NOT NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active'
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 示例（演练时替换为业务真实映射导入）
-- INSERT INTO tmp_inventory_location_mapping_import
--   (sku_code, source_note, warehouse_code, location_code, status)
-- VALUES
--   ('SKU-001', 'DN20260401-01', 'WH-A', 'A-01-01', 'active');

SELECT COUNT(*) AS imported_mapping_rows
FROM tmp_inventory_location_mapping_import;

INSERT INTO inventory_location_mappings
  (tenant_id, sku_code, source_note, warehouse_code, location_code, status, created_by, updated_by)
SELECT
  @tenant_id,
  t.sku_code,
  t.source_note,
  t.warehouse_code,
  t.location_code,
  t.status,
  @operator_id,
  @operator_id
FROM tmp_inventory_location_mapping_import t
ON DUPLICATE KEY UPDATE
  warehouse_code = VALUES(warehouse_code),
  location_code = VALUES(location_code),
  status = VALUES(status),
  updated_by = VALUES(updated_by),
  updated_at = NOW(3);

-- 2) 映射覆盖率预览（执行前）
SELECT
  'tx_mapping_candidates' AS metric,
  COUNT(*) AS value
FROM inventory_transactions it
INNER JOIN skus s
  ON s.id = it.sku_id
 AND s.tenant_id = it.tenant_id
INNER JOIN inventory_location_mappings m
  ON m.tenant_id = it.tenant_id
 AND m.sku_code = (s.sku_code COLLATE utf8mb4_unicode_ci)
 AND m.status = 'active'
 AND m.source_note = (COALESCE(NULLIF(it.reference_no, ''), NULLIF(it.notes, ''), '__EMPTY__') COLLATE utf8mb4_unicode_ci)
WHERE it.tenant_id = @tenant_id
UNION ALL
SELECT
  'inv_mapping_candidates' AS metric,
  COUNT(*) AS value
FROM inventory inv
INNER JOIN skus s
  ON s.id = inv.sku_id
 AND s.tenant_id = inv.tenant_id
INNER JOIN inventory_location_mappings m
  ON m.tenant_id = inv.tenant_id
 AND m.sku_code = (s.sku_code COLLATE utf8mb4_unicode_ci)
 AND m.status = 'active'
 AND m.source_note = (COALESCE(NULLIF(inv.source_ref, ''), '__EMPTY__') COLLATE utf8mb4_unicode_ci)
WHERE inv.tenant_id = @tenant_id;

START TRANSACTION;

-- 3) 映射优先：回填 inventory_transactions
UPDATE inventory_transactions it
INNER JOIN skus s
  ON s.id = it.sku_id
 AND s.tenant_id = it.tenant_id
INNER JOIN inventory_location_mappings m
  ON m.tenant_id = it.tenant_id
 AND m.sku_code = (s.sku_code COLLATE utf8mb4_unicode_ci)
 AND m.status = 'active'
 AND m.source_note = (COALESCE(NULLIF(it.reference_no, ''), NULLIF(it.notes, ''), '__EMPTY__') COLLATE utf8mb4_unicode_ci)
INNER JOIN warehouses w
  ON w.tenant_id = it.tenant_id
 AND w.code = m.warehouse_code
 AND w.status = 'active'
INNER JOIN locations l
  ON l.tenant_id = it.tenant_id
 AND l.warehouse_id = w.id
 AND l.code = m.location_code
 AND l.status = 'active'
SET
  it.warehouse_id = w.id,
  it.location_id = l.id,
  it.source_ref = CONCAT('mapping-drill:', @batch_no),
  it.updated_by = @operator_id
WHERE it.tenant_id = @tenant_id;

-- 4) 映射优先：回填 inventory（source_ref 参与映射匹配）
UPDATE inventory inv
INNER JOIN skus s
  ON s.id = inv.sku_id
 AND s.tenant_id = inv.tenant_id
INNER JOIN inventory_location_mappings m
  ON m.tenant_id = inv.tenant_id
 AND m.sku_code = (s.sku_code COLLATE utf8mb4_unicode_ci)
 AND m.status = 'active'
 AND m.source_note = (COALESCE(NULLIF(inv.source_ref, ''), '__EMPTY__') COLLATE utf8mb4_unicode_ci)
INNER JOIN warehouses w
  ON w.tenant_id = inv.tenant_id
 AND w.code = m.warehouse_code
 AND w.status = 'active'
INNER JOIN locations l
  ON l.tenant_id = inv.tenant_id
 AND l.warehouse_id = w.id
 AND l.code = m.location_code
 AND l.status = 'active'
SET
  inv.warehouse_id = w.id,
  inv.location_id = l.id,
  inv.source_ref = CONCAT('mapping-drill:', @batch_no),
  inv.updated_by = @operator_id
WHERE inv.tenant_id = @tenant_id;

-- 5) 默认兜底：inventory_transactions 未匹配记录落表 + 回填默认仓位
INSERT IGNORE INTO migration_unmapped_records
  (tenant_id, batch_no, entity_type, entity_id, sku_id, sku_code, source_note, fallback_warehouse_code, fallback_location_code)
SELECT
  it.tenant_id,
  @batch_no,
  'inventory_transaction',
  it.id,
  it.sku_id,
  s.sku_code,
  COALESCE(NULLIF(it.reference_no, ''), NULLIF(it.notes, ''), '__EMPTY__'),
  'DEFAULT',
  'DEFAULT-UNKNOWN'
FROM inventory_transactions it
LEFT JOIN skus s
  ON s.id = it.sku_id
 AND s.tenant_id = it.tenant_id
WHERE it.tenant_id = @tenant_id
  AND (it.warehouse_id IS NULL OR it.location_id IS NULL);

UPDATE inventory_transactions it
SET
  it.warehouse_id = COALESCE(it.warehouse_id, @default_warehouse_id),
  it.location_id = COALESCE(it.location_id, @default_location_id),
  it.source_ref = COALESCE(it.source_ref, CONCAT('fallback-drill:', @batch_no)),
  it.updated_by = @operator_id
WHERE it.tenant_id = @tenant_id
  AND (it.warehouse_id IS NULL OR it.location_id IS NULL);

-- 6) 默认兜底：inventory 未匹配记录落表 + 回填默认仓位
INSERT IGNORE INTO migration_unmapped_records
  (tenant_id, batch_no, entity_type, entity_id, sku_id, sku_code, source_note, fallback_warehouse_code, fallback_location_code)
SELECT
  inv.tenant_id,
  @batch_no,
  'inventory',
  inv.id,
  inv.sku_id,
  s.sku_code,
  COALESCE(NULLIF(inv.source_ref, ''), '__EMPTY__'),
  'DEFAULT',
  'DEFAULT-UNKNOWN'
FROM inventory inv
LEFT JOIN skus s
  ON s.id = inv.sku_id
 AND s.tenant_id = inv.tenant_id
WHERE inv.tenant_id = @tenant_id
  AND (inv.warehouse_id IS NULL OR inv.location_id IS NULL);

UPDATE inventory inv
SET
  inv.warehouse_id = COALESCE(inv.warehouse_id, @default_warehouse_id),
  inv.location_id = COALESCE(inv.location_id, @default_location_id),
  inv.source_ref = COALESCE(inv.source_ref, CONCAT('fallback-drill:', @batch_no)),
  inv.updated_by = @operator_id
WHERE inv.tenant_id = @tenant_id
  AND (inv.warehouse_id IS NULL OR inv.location_id IS NULL);

COMMIT;

-- 7) 演练结果输出
SELECT
  @batch_no AS batch_no,
  (SELECT COUNT(*) FROM migration_unmapped_records mur
   WHERE mur.tenant_id = @tenant_id
     AND mur.batch_no = (@batch_no COLLATE utf8mb4_unicode_ci)
     AND mur.entity_type = 'inventory') AS inventory_fallback_rows,
  (SELECT COUNT(*) FROM migration_unmapped_records mur
   WHERE mur.tenant_id = @tenant_id
     AND mur.batch_no = (@batch_no COLLATE utf8mb4_unicode_ci)
     AND mur.entity_type = 'inventory_transaction') AS tx_fallback_rows;

SELECT
  CAST(SUM(CASE WHEN w.code = 'DEFAULT' AND l.code = 'DEFAULT-UNKNOWN' THEN inv.qty_on_hand ELSE 0 END) AS DECIMAL(20,6)) AS default_qty,
  CAST(SUM(inv.qty_on_hand) AS DECIMAL(20,6)) AS total_qty,
  CAST(
    CASE
      WHEN SUM(inv.qty_on_hand) = 0 THEN 0
      ELSE (SUM(CASE WHEN w.code = 'DEFAULT' AND l.code = 'DEFAULT-UNKNOWN' THEN inv.qty_on_hand ELSE 0 END) / SUM(inv.qty_on_hand)) * 100
    END AS DECIMAL(10,4)
  ) AS default_ratio_pct
FROM inventory inv
LEFT JOIN warehouses w
  ON w.id = inv.warehouse_id
 AND w.tenant_id = inv.tenant_id
LEFT JOIN locations l
  ON l.id = inv.location_id
 AND l.tenant_id = inv.tenant_id
WHERE inv.tenant_id = @tenant_id;
