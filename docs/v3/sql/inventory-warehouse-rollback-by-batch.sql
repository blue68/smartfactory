-- inventory-warehouse-rollback-by-batch.sql
-- 仓库/库位迁移回滚脚本（按批次）
-- 用途：迁移异常时，将本批次 fallback 数据回滚到“未绑定”状态。
-- 说明：
--   1) 只处理 migration_unmapped_records 中 entity_type=inventory/inventory_transaction 的记录。
--   2) 执行前务必先完成全量备份。
-- 参数：
--   SET @tenant_id = 1;
--   SET @batch_no = 'M20260403_20260403123000';

SET @tenant_id = COALESCE(@tenant_id, 1);
SET @batch_no = COALESCE(@batch_no, 'M20260403_YYYYMMDDHHMMSS');

START TRANSACTION;

-- 1) 回滚 inventory fallback
UPDATE inventory inv
INNER JOIN migration_unmapped_records mur
  ON mur.tenant_id = inv.tenant_id
 AND mur.entity_type = 'inventory'
 AND mur.entity_id = inv.id
SET
  inv.warehouse_id = NULL,
  inv.location_id = NULL,
  inv.source_ref = 'rollback:inventory-warehouse-migration',
  inv.updated_at = NOW(3)
WHERE mur.tenant_id = @tenant_id
  AND mur.batch_no = (@batch_no COLLATE utf8mb4_unicode_ci);

-- 2) 回滚 inventory_transactions fallback
UPDATE inventory_transactions it
INNER JOIN migration_unmapped_records mur
  ON mur.tenant_id = it.tenant_id
 AND mur.entity_type = 'inventory_transaction'
 AND mur.entity_id = it.id
SET
  it.warehouse_id = NULL,
  it.location_id = NULL,
  it.source_ref = 'rollback:inventory-warehouse-migration',
  it.updated_at = NOW(3)
WHERE mur.tenant_id = @tenant_id
  AND mur.batch_no = (@batch_no COLLATE utf8mb4_unicode_ci);

-- 3) 回滚结果核对
SELECT
  'inventory_rollback_count' AS metric,
  COUNT(*) AS rolled_back_rows
FROM migration_unmapped_records mur
WHERE mur.tenant_id = @tenant_id
  AND mur.batch_no = (@batch_no COLLATE utf8mb4_unicode_ci)
  AND mur.entity_type = 'inventory'
UNION ALL
SELECT
  'inventory_transactions_rollback_count' AS metric,
  COUNT(*) AS rolled_back_rows
FROM migration_unmapped_records mur
WHERE mur.tenant_id = @tenant_id
  AND mur.batch_no = (@batch_no COLLATE utf8mb4_unicode_ci)
  AND mur.entity_type = 'inventory_transaction';

COMMIT;
