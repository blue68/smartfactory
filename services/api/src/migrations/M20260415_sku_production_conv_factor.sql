-- 为 SKU 增加显式的生产领用换算系数
SET @has_production_conv_factor := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'skus'
    AND column_name = 'production_conv_factor'
);

SET @ddl_sql := IF(
  @has_production_conv_factor = 0,
  'ALTER TABLE skus ADD COLUMN production_conv_factor DECIMAL(10,4) NULL COMMENT ''生产领用换算系数'' AFTER stock_conv_factor',
  'SELECT 1'
);

PREPARE alter_stmt FROM @ddl_sql;
EXECUTE alter_stmt;
DEALLOCATE PREPARE alter_stmt;

-- 历史回填：当生产领用单位与采购单位一致且不同于库存单位时，沿用采购换算系数
UPDATE skus
SET production_conv_factor = stock_conv_factor
WHERE production_conv_factor IS NULL
  AND COALESCE(NULLIF(TRIM(production_unit), ''), '') <> ''
  AND COALESCE(NULLIF(TRIM(stock_unit), ''), '') <> ''
  AND production_unit <> stock_unit
  AND production_unit = purchase_unit
  AND COALESCE(stock_conv_factor, 0) > 0;

-- 历史回填：为已有显式生产领用倍率的 SKU 生成自动换算规则
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
  s.production_unit,
  s.stock_unit,
  s.production_conv_factor,
  '[auto] 生产领用单位→库存单位',
  COALESCE(s.updated_by, s.created_by, 0),
  COALESCE(s.updated_by, s.created_by, 0)
FROM skus s
WHERE COALESCE(NULLIF(TRIM(s.production_unit), ''), '') <> ''
  AND COALESCE(NULLIF(TRIM(s.stock_unit), ''), '') <> ''
  AND s.production_unit <> s.stock_unit
  AND COALESCE(s.production_conv_factor, 0) > 0
ON DUPLICATE KEY UPDATE
  conversion_rate = VALUES(conversion_rate),
  description = VALUES(description),
  updated_by = VALUES(updated_by),
  updated_at = CURRENT_TIMESTAMP(3);
