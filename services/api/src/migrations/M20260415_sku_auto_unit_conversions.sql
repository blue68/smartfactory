-- 为历史 SKU 回填自动单位换算规则：
-- 1. 采购单位 -> 库存单位（使用 stock_conv_factor）
-- 2. 当生产领用单位与采购单位相同且不等于库存单位时，沿用同一条规则

INSERT INTO sku_unit_conversions (
  tenant_id,
  sku_id,
  from_unit,
  to_unit,
  conversion_rate,
  description,
  created_by,
  updated_by
)
SELECT
  s.tenant_id,
  s.id,
  s.purchase_unit,
  s.stock_unit,
  s.stock_conv_factor,
  '[auto] 采购单位→库存单位',
  COALESCE(s.created_by, 0),
  COALESCE(s.updated_by, COALESCE(s.created_by, 0))
FROM skus s
WHERE COALESCE(NULLIF(TRIM(s.purchase_unit), ''), '') <> ''
  AND COALESCE(NULLIF(TRIM(s.stock_unit), ''), '') <> ''
  AND s.purchase_unit <> s.stock_unit
  AND COALESCE(s.stock_conv_factor, 0) > 0
ON DUPLICATE KEY UPDATE
  conversion_rate = VALUES(conversion_rate),
  description = VALUES(description),
  updated_by = VALUES(updated_by),
  updated_at = CURRENT_TIMESTAMP(3);
