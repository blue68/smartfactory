-- =============================================================================
-- inventory-default-location-repair-by-mapping.sql
-- 用途：按业务映射表批量修复“默认仓位”历史流水（inventory_transactions）
-- 场景：迁移后仍有 DEFAULT/DEFAULT-UNKNOWN 写入，需要按 sku_code + source_note 回补真实仓位
-- =============================================================================

-- 参数区（执行前按环境修改）
SET @tenant_id = COALESCE(@tenant_id, 1);
SET @batch_no = COALESCE(@batch_no, NULL);  -- 例：'M20260403_20260403153000'；NULL = 不限批次
SET @operator_id = COALESCE(@operator_id, 0);

-- -----------------------------------------------------------------------------
-- 0) 前置检查
-- -----------------------------------------------------------------------------
SELECT
  @tenant_id AS tenant_id,
  @batch_no AS batch_no,
  @operator_id AS operator_id;

SELECT
  COUNT(*) AS unmapped_tx_count
FROM migration_unmapped_records mur
WHERE mur.tenant_id = @tenant_id
  AND mur.entity_type = 'inventory_transaction'
  AND (@batch_no IS NULL OR mur.batch_no = (@batch_no COLLATE utf8mb4_unicode_ci));

-- -----------------------------------------------------------------------------
-- 1) 生成可修复候选（仅处理当前仍在默认仓位的流水）
-- -----------------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS tmp_default_tx_repair_candidates;
CREATE TEMPORARY TABLE tmp_default_tx_repair_candidates AS
SELECT
  mur.id AS unmapped_id,
  mur.batch_no,
  mur.entity_id AS tx_id,
  it.sku_id,
  COALESCE(mur.sku_code, s.sku_code) AS sku_code,
  mur.source_note,
  m.id AS mapping_id,
  tw.id AS target_warehouse_id,
  tl.id AS target_location_id,
  tw.code AS target_warehouse_code,
  tl.code AS target_location_code
FROM migration_unmapped_records mur
INNER JOIN inventory_transactions it
  ON it.id = mur.entity_id
 AND it.tenant_id = mur.tenant_id
LEFT JOIN skus s
  ON s.id = it.sku_id
 AND s.tenant_id = it.tenant_id
INNER JOIN warehouses cw
  ON cw.id = it.warehouse_id
 AND cw.tenant_id = it.tenant_id
INNER JOIN locations cl
  ON cl.id = it.location_id
 AND cl.tenant_id = it.tenant_id
INNER JOIN inventory_location_mappings m
  ON m.tenant_id = mur.tenant_id
 AND m.status = 'active'
 AND m.sku_code = COALESCE(mur.sku_code, s.sku_code)
 AND m.source_note = COALESCE(mur.source_note, '__EMPTY__')
INNER JOIN warehouses tw
  ON tw.tenant_id = mur.tenant_id
 AND tw.code = m.warehouse_code
 AND tw.status = 'active'
INNER JOIN locations tl
  ON tl.tenant_id = mur.tenant_id
 AND tl.warehouse_id = tw.id
 AND tl.code = m.location_code
 AND tl.status = 'active'
WHERE mur.tenant_id = @tenant_id
  AND mur.entity_type = 'inventory_transaction'
  AND (@batch_no IS NULL OR mur.batch_no = (@batch_no COLLATE utf8mb4_unicode_ci))
  AND cw.code = 'DEFAULT'
  AND cl.code = 'DEFAULT-UNKNOWN';

SELECT
  COUNT(*) AS repairable_tx_count,
  COUNT(DISTINCT sku_id) AS repairable_sku_count
FROM tmp_default_tx_repair_candidates;

SELECT
  batch_no,
  tx_id,
  sku_id,
  sku_code,
  source_note,
  target_warehouse_code,
  target_location_code
FROM tmp_default_tx_repair_candidates
ORDER BY batch_no DESC, tx_id DESC
LIMIT 200;

-- -----------------------------------------------------------------------------
-- 2) 执行修复（写入 inventory_transactions）
-- -----------------------------------------------------------------------------
UPDATE inventory_transactions it
INNER JOIN tmp_default_tx_repair_candidates c
  ON c.tx_id = it.id
SET it.warehouse_id = c.target_warehouse_id,
    it.location_id = c.target_location_id,
    it.source_ref = CONCAT('repair:mapping:', c.mapping_id),
    it.updated_by = @operator_id;

SELECT ROW_COUNT() AS repaired_tx_rows;

-- -----------------------------------------------------------------------------
-- 3) 清理已修复的 unmapped 记录
-- -----------------------------------------------------------------------------
DELETE mur
FROM migration_unmapped_records mur
INNER JOIN tmp_default_tx_repair_candidates c
  ON c.unmapped_id = mur.id;

SELECT ROW_COUNT() AS cleaned_unmapped_rows;

-- -----------------------------------------------------------------------------
-- 4) 修复后核对
-- -----------------------------------------------------------------------------
SELECT
  COUNT(*) AS remaining_unmapped_tx_count
FROM migration_unmapped_records mur
WHERE mur.tenant_id = @tenant_id
  AND mur.entity_type = 'inventory_transaction'
  AND (@batch_no IS NULL OR mur.batch_no = (@batch_no COLLATE utf8mb4_unicode_ci));

SELECT
  COUNT(*) AS still_default_tx_count
FROM inventory_transactions it
INNER JOIN warehouses w
  ON w.id = it.warehouse_id
 AND w.tenant_id = it.tenant_id
INNER JOIN locations l
  ON l.id = it.location_id
 AND l.tenant_id = it.tenant_id
WHERE it.tenant_id = @tenant_id
  AND w.code = 'DEFAULT'
  AND l.code = 'DEFAULT-UNKNOWN';

-- -----------------------------------------------------------------------------
-- 5) 后续动作建议（手工执行）
-- -----------------------------------------------------------------------------
-- 建议在 API 执行以下操作以回刷库存主表与日结快照：
--   POST /api/inventory/reconcile { dryRun: false, includeReserved: true, includeInTransit: true }
--   POST /api/inventory/snapshots/rebuild { dryRun: false }
