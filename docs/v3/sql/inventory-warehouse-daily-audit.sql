-- =============================================================================
-- inventory-warehouse-daily-audit.sql
-- 用途：库存仓位治理日巡检（建议每日定时执行）
-- 覆盖：
--   1) 无效仓位引用（缺失主数据 / 跨仓错绑 / 非 active）
--   2) 停用仓位写入（inventory_transactions 日增量）
--   3) 默认仓位新增监控（inventory_transactions 日增量 + 当前库存占比）
-- =============================================================================

-- 参数区（执行前按环境修改）
SET @tenant_id = COALESCE(@tenant_id, 1);
SET @window_start = COALESCE(@window_start, DATE_SUB(CURDATE(), INTERVAL 1 DAY));
SET @window_end = COALESCE(@window_end, CURDATE());

-- -----------------------------------------------------------------------------
-- 0) 巡检窗口确认
-- -----------------------------------------------------------------------------
SELECT
  @tenant_id AS tenant_id,
  @window_start AS window_start,
  @window_end AS window_end;

-- -----------------------------------------------------------------------------
-- 1) inventory 主表无效仓位引用
-- -----------------------------------------------------------------------------
SELECT
  'inventory_invalid_binding' AS check_name,
  COUNT(*) AS issue_count
FROM inventory inv
LEFT JOIN warehouses w
  ON w.id = inv.warehouse_id
 AND w.tenant_id = inv.tenant_id
LEFT JOIN locations l
  ON l.id = inv.location_id
 AND l.tenant_id = inv.tenant_id
WHERE inv.tenant_id = @tenant_id
  AND (
    inv.warehouse_id IS NULL
    OR inv.location_id IS NULL
    OR w.id IS NULL
    OR l.id IS NULL
    OR l.warehouse_id <> inv.warehouse_id
    OR w.status <> 'active'
    OR l.status <> 'active'
  );

SELECT
  inv.id,
  inv.sku_id,
  inv.warehouse_id,
  inv.location_id,
  w.code AS warehouse_code,
  w.status AS warehouse_status,
  l.code AS location_code,
  l.status AS location_status,
  CASE
    WHEN inv.warehouse_id IS NULL OR inv.location_id IS NULL THEN 'NULL_BINDING'
    WHEN w.id IS NULL OR l.id IS NULL THEN 'MASTER_DATA_MISSING'
    WHEN l.warehouse_id <> inv.warehouse_id THEN 'LOCATION_WAREHOUSE_MISMATCH'
    WHEN w.status <> 'active' OR l.status <> 'active' THEN 'INACTIVE_BINDING'
    ELSE 'UNKNOWN'
  END AS issue_type
FROM inventory inv
LEFT JOIN warehouses w
  ON w.id = inv.warehouse_id
 AND w.tenant_id = inv.tenant_id
LEFT JOIN locations l
  ON l.id = inv.location_id
 AND l.tenant_id = inv.tenant_id
WHERE inv.tenant_id = @tenant_id
  AND (
    inv.warehouse_id IS NULL
    OR inv.location_id IS NULL
    OR w.id IS NULL
    OR l.id IS NULL
    OR l.warehouse_id <> inv.warehouse_id
    OR w.status <> 'active'
    OR l.status <> 'active'
  )
ORDER BY inv.id DESC
LIMIT 200;

-- -----------------------------------------------------------------------------
-- 2) inventory_transactions 日增量：无效仓位引用 + 停用仓位写入
-- -----------------------------------------------------------------------------
SELECT
  'tx_invalid_binding_daily' AS check_name,
  COUNT(*) AS issue_count
FROM inventory_transactions it
LEFT JOIN warehouses w
  ON w.id = it.warehouse_id
 AND w.tenant_id = it.tenant_id
LEFT JOIN locations l
  ON l.id = it.location_id
 AND l.tenant_id = it.tenant_id
WHERE it.tenant_id = @tenant_id
  AND it.created_at >= @window_start
  AND it.created_at < @window_end
  AND (
    it.warehouse_id IS NULL
    OR it.location_id IS NULL
    OR w.id IS NULL
    OR l.id IS NULL
    OR l.warehouse_id <> it.warehouse_id
    OR w.status <> 'active'
    OR l.status <> 'active'
  );

SELECT
  DATE_FORMAT(it.created_at, '%Y-%m-%d') AS tx_date,
  it.transaction_no,
  it.transaction_type,
  it.reference_type,
  it.reference_no,
  it.sku_id,
  it.warehouse_id,
  w.code AS warehouse_code,
  w.status AS warehouse_status,
  it.location_id,
  l.code AS location_code,
  l.status AS location_status,
  CASE
    WHEN it.warehouse_id IS NULL OR it.location_id IS NULL THEN 'NULL_BINDING'
    WHEN w.id IS NULL OR l.id IS NULL THEN 'MASTER_DATA_MISSING'
    WHEN l.warehouse_id <> it.warehouse_id THEN 'LOCATION_WAREHOUSE_MISMATCH'
    WHEN w.status <> 'active' OR l.status <> 'active' THEN 'INACTIVE_BINDING_WRITE'
    ELSE 'UNKNOWN'
  END AS issue_type
FROM inventory_transactions it
LEFT JOIN warehouses w
  ON w.id = it.warehouse_id
 AND w.tenant_id = it.tenant_id
LEFT JOIN locations l
  ON l.id = it.location_id
 AND l.tenant_id = it.tenant_id
WHERE it.tenant_id = @tenant_id
  AND it.created_at >= @window_start
  AND it.created_at < @window_end
  AND (
    it.warehouse_id IS NULL
    OR it.location_id IS NULL
    OR w.id IS NULL
    OR l.id IS NULL
    OR l.warehouse_id <> it.warehouse_id
    OR w.status <> 'active'
    OR l.status <> 'active'
  )
ORDER BY it.created_at DESC, it.id DESC
LIMIT 200;

-- -----------------------------------------------------------------------------
-- 3) 默认仓位新增监控（日增量）
-- -----------------------------------------------------------------------------
SELECT
  DATE_FORMAT(it.created_at, '%Y-%m-%d') AS tx_date,
  COUNT(*) AS default_tx_count,
  CAST(SUM(CASE WHEN it.direction = 'IN' THEN it.qty_stock_unit ELSE -it.qty_stock_unit END) AS DECIMAL(20,6)) AS default_qty_delta
FROM inventory_transactions it
INNER JOIN warehouses w
  ON w.id = it.warehouse_id
 AND w.tenant_id = it.tenant_id
INNER JOIN locations l
  ON l.id = it.location_id
 AND l.tenant_id = it.tenant_id
WHERE it.tenant_id = @tenant_id
  AND it.created_at >= @window_start
  AND it.created_at < @window_end
  AND w.code = 'DEFAULT'
  AND l.code = 'DEFAULT-UNKNOWN'
GROUP BY DATE_FORMAT(it.created_at, '%Y-%m-%d')
ORDER BY tx_date DESC;

SELECT
  it.reference_type,
  COUNT(*) AS default_tx_count,
  CAST(SUM(CASE WHEN it.direction = 'IN' THEN it.qty_stock_unit ELSE -it.qty_stock_unit END) AS DECIMAL(20,6)) AS default_qty_delta
FROM inventory_transactions it
INNER JOIN warehouses w
  ON w.id = it.warehouse_id
 AND w.tenant_id = it.tenant_id
INNER JOIN locations l
  ON l.id = it.location_id
 AND l.tenant_id = it.tenant_id
WHERE it.tenant_id = @tenant_id
  AND it.created_at >= @window_start
  AND it.created_at < @window_end
  AND w.code = 'DEFAULT'
  AND l.code = 'DEFAULT-UNKNOWN'
GROUP BY it.reference_type
ORDER BY default_tx_count DESC;

-- -----------------------------------------------------------------------------
-- 4) 默认仓位当前库存占比（治理阈值建议：< 3%）
-- -----------------------------------------------------------------------------
SELECT
  CAST(SUM(inv.qty_on_hand) AS DECIMAL(20,6)) AS total_qty,
  CAST(SUM(CASE WHEN w.code = 'DEFAULT' AND l.code = 'DEFAULT-UNKNOWN' THEN inv.qty_on_hand ELSE 0 END) AS DECIMAL(20,6)) AS default_qty,
  ROUND(
    CASE
      WHEN SUM(inv.qty_on_hand) = 0 THEN 0
      ELSE SUM(CASE WHEN w.code = 'DEFAULT' AND l.code = 'DEFAULT-UNKNOWN' THEN inv.qty_on_hand ELSE 0 END)
           / SUM(inv.qty_on_hand) * 100
    END,
    4
  ) AS default_ratio_pct
FROM inventory inv
LEFT JOIN warehouses w
  ON w.id = inv.warehouse_id
 AND w.tenant_id = inv.tenant_id
LEFT JOIN locations l
  ON l.id = inv.location_id
 AND l.tenant_id = inv.tenant_id
WHERE inv.tenant_id = @tenant_id;

-- -----------------------------------------------------------------------------
-- 5) 默认仓位 SKU TOP20（用于修复优先级）
-- -----------------------------------------------------------------------------
SELECT
  inv.sku_id,
  s.sku_code,
  s.name AS sku_name,
  CAST(inv.qty_on_hand AS DECIMAL(20,6)) AS qty_on_hand,
  CAST(inv.qty_reserved AS DECIMAL(20,6)) AS qty_reserved,
  CAST((inv.qty_on_hand - inv.qty_reserved) AS DECIMAL(20,6)) AS qty_available
FROM inventory inv
INNER JOIN skus s
  ON s.id = inv.sku_id
 AND s.tenant_id = inv.tenant_id
INNER JOIN warehouses w
  ON w.id = inv.warehouse_id
 AND w.tenant_id = inv.tenant_id
INNER JOIN locations l
  ON l.id = inv.location_id
 AND l.tenant_id = inv.tenant_id
WHERE inv.tenant_id = @tenant_id
  AND w.code = 'DEFAULT'
  AND l.code = 'DEFAULT-UNKNOWN'
ORDER BY inv.qty_on_hand DESC, inv.sku_id ASC
LIMIT 20;

-- -----------------------------------------------------------------------------
-- 6) 未匹配迁移记录（近 7 天）
-- -----------------------------------------------------------------------------
SELECT
  DATE_FORMAT(created_at, '%Y-%m-%d') AS created_date,
  batch_no,
  entity_type,
  COUNT(*) AS unmapped_count
FROM migration_unmapped_records
WHERE tenant_id = @tenant_id
  AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d'), batch_no, entity_type
ORDER BY created_date DESC, batch_no DESC, entity_type ASC;
