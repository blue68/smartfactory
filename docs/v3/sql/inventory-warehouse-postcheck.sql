-- inventory-warehouse-postcheck.sql
-- 迁移后核对脚本（手工执行）
-- 用途：核对 SKU 总量一致性、默认仓位占比、核心 SKU 抽样。
-- 参数：
--   SET @tenant_id = 1;
--   SET @ratio_threshold = 3.00;

SET @tenant_id = COALESCE(@tenant_id, 1);
SET @ratio_threshold = COALESCE(@ratio_threshold, 3.00);

-- 1) 当前库存总量（库存台账口径）
SELECT
  @tenant_id AS tenant_id,
  CAST(SUM(inv.qty_on_hand) AS DECIMAL(20,6)) AS total_qty_on_hand,
  CAST(SUM(inv.qty_reserved) AS DECIMAL(20,6)) AS total_qty_reserved,
  CAST(SUM(inv.qty_on_hand - inv.qty_reserved) AS DECIMAL(20,6)) AS total_qty_available
FROM inventory inv
WHERE inv.tenant_id = @tenant_id;

-- 2) 流水累计总量（流水口径）
SELECT
  @tenant_id AS tenant_id,
  CAST(SUM(CASE WHEN it.direction = 'IN' THEN it.qty_stock_unit ELSE -it.qty_stock_unit END) AS DECIMAL(20,6)) AS ledger_qty_on_hand
FROM inventory_transactions it
WHERE it.tenant_id = @tenant_id;

-- 3) 按 SKU 对账（偏差 > 0.000001）
WITH ledger AS (
  SELECT
    it.sku_id,
    CAST(SUM(CASE WHEN it.direction = 'IN' THEN it.qty_stock_unit ELSE -it.qty_stock_unit END) AS DECIMAL(20,6)) AS ledger_qty
  FROM inventory_transactions it
  WHERE it.tenant_id = @tenant_id
  GROUP BY it.sku_id
),
inv AS (
  SELECT
    i.sku_id,
    CAST(SUM(i.qty_on_hand) AS DECIMAL(20,6)) AS inv_qty
  FROM inventory i
  WHERE i.tenant_id = @tenant_id
  GROUP BY i.sku_id
)
SELECT
  COALESCE(inv.sku_id, ledger.sku_id) AS sku_id,
  COALESCE(inv.inv_qty, 0) AS inventory_qty,
  COALESCE(ledger.ledger_qty, 0) AS ledger_qty,
  CAST(COALESCE(inv.inv_qty, 0) - COALESCE(ledger.ledger_qty, 0) AS DECIMAL(20,6)) AS delta_qty
FROM inv
LEFT JOIN ledger ON ledger.sku_id = inv.sku_id
UNION ALL
SELECT
  ledger.sku_id,
  0,
  ledger.ledger_qty,
  CAST(0 - ledger.ledger_qty AS DECIMAL(20,6)) AS delta_qty
FROM ledger
LEFT JOIN inv ON inv.sku_id = ledger.sku_id
WHERE inv.sku_id IS NULL;

-- 4) 默认仓位占比（按在库数量）
SELECT
  CAST(SUM(CASE WHEN w.code = 'DEFAULT' AND l.code = 'DEFAULT-UNKNOWN' THEN i.qty_on_hand ELSE 0 END) AS DECIMAL(20,6)) AS default_qty,
  CAST(SUM(i.qty_on_hand) AS DECIMAL(20,6)) AS total_qty,
  CAST(
    CASE
      WHEN SUM(i.qty_on_hand) = 0 THEN 0
      ELSE (SUM(CASE WHEN w.code = 'DEFAULT' AND l.code = 'DEFAULT-UNKNOWN' THEN i.qty_on_hand ELSE 0 END) / SUM(i.qty_on_hand)) * 100
    END
    AS DECIMAL(10,4)
  ) AS default_ratio_pct,
  CASE
    WHEN (
      CASE
        WHEN SUM(i.qty_on_hand) = 0 THEN 0
        ELSE (SUM(CASE WHEN w.code = 'DEFAULT' AND l.code = 'DEFAULT-UNKNOWN' THEN i.qty_on_hand ELSE 0 END) / SUM(i.qty_on_hand)) * 100
      END
    ) < @ratio_threshold THEN 'PASS'
    ELSE 'FAIL'
  END AS ratio_verdict
FROM inventory i
LEFT JOIN warehouses w
  ON w.id = i.warehouse_id
 AND w.tenant_id = i.tenant_id
LEFT JOIN locations l
  ON l.id = i.location_id
 AND l.tenant_id = i.tenant_id
WHERE i.tenant_id = @tenant_id;

-- 5) 默认仓位 SKU TOP20（用于治理清单）
SELECT
  i.sku_id,
  s.sku_code,
  s.name AS sku_name,
  CAST(i.qty_on_hand AS DECIMAL(20,6)) AS qty_on_hand,
  i.source_ref,
  i.updated_at
FROM inventory i
INNER JOIN skus s
  ON s.id = i.sku_id
 AND s.tenant_id = i.tenant_id
INNER JOIN warehouses w
  ON w.id = i.warehouse_id
 AND w.tenant_id = i.tenant_id
INNER JOIN locations l
  ON l.id = i.location_id
 AND l.tenant_id = i.tenant_id
WHERE i.tenant_id = @tenant_id
  AND w.code = 'DEFAULT'
  AND l.code = 'DEFAULT-UNKNOWN'
ORDER BY i.qty_on_hand DESC, i.sku_id ASC
LIMIT 20;

-- 6) 核心 SKU 抽样（近 30 天流水频次 TOP20）
WITH hot_skus AS (
  SELECT
    it.sku_id,
    COUNT(*) AS tx_count
  FROM inventory_transactions it
  WHERE it.tenant_id = @tenant_id
    AND it.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
  GROUP BY it.sku_id
  ORDER BY tx_count DESC
  LIMIT 20
)
SELECT
  hs.sku_id,
  s.sku_code,
  s.name AS sku_name,
  hs.tx_count,
  CAST(COALESCE(SUM(i.qty_on_hand), 0) AS DECIMAL(20,6)) AS qty_on_hand,
  CAST(COALESCE(SUM(i.qty_reserved), 0) AS DECIMAL(20,6)) AS qty_reserved,
  COUNT(DISTINCT CONCAT(COALESCE(i.warehouse_id, 0), '-', COALESCE(i.location_id, 0))) AS location_count
FROM hot_skus hs
INNER JOIN skus s
  ON s.id = hs.sku_id
 AND s.tenant_id = @tenant_id
LEFT JOIN inventory i
  ON i.sku_id = hs.sku_id
 AND i.tenant_id = @tenant_id
GROUP BY hs.sku_id, s.sku_code, s.name, hs.tx_count
ORDER BY hs.tx_count DESC, hs.sku_id ASC;
