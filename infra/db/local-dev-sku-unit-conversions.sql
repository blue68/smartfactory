-- 本地开发环境：补充 SKU 单位换算测试数据
-- 目标：
-- 1. 为本地库存/采购/质检等流程补齐 purchaseUnit -> stockUnit 的真实换算关系
-- 2. 同步回填 skus.stock_conv_factor，兼容仍读取旧字段的页面/接口
-- 3. 使用 UPSERT，允许重复执行

START TRANSACTION;

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
  seed.from_unit,
  seed.to_unit,
  seed.conversion_rate,
  seed.description,
  0,
  0
FROM skus s
INNER JOIN (
  SELECT 1 AS tenant_id, 'RM-00056' AS sku_code, '卷' AS from_unit, 'm' AS to_unit,  '120.000000' AS conversion_rate, '1卷=120m（本地测试数据）' AS description
  UNION ALL
  SELECT 1, 'RM-00057', '卷', 'm',  '80.000000',  '1卷=80m（本地测试数据）'
  UNION ALL
  SELECT 1, 'RM-00058', '卷', 'm',  '100.000000', '1卷=100m（本地测试数据）'
  UNION ALL
  SELECT 1, 'RM-00301', '卷', 'm',  '50.000000',  '1卷=50m（本地测试数据）'
  UNION ALL
  SELECT 1, 'RM-00089', '张', 'm²', '4.500000',   '1张=4.5m²（本地测试数据）'
  UNION ALL
  SELECT 1, 'RM-00090', '张', 'm²', '3.800000',   '1张=3.8m²（本地测试数据）'
  UNION ALL
  SELECT 1, 'RM-00201', '箱', '瓶', '12.000000',  '1箱=12瓶（本地测试数据）'
  UNION ALL
  SELECT 1, 'RM-00150', '盒', '个', '50.000000',  '1盒=50个（本地测试数据）'
  UNION ALL
  SELECT 1, 'RM-00151', '盒', '副', '10.000000',  '1盒=10副（本地测试数据）'
  UNION ALL
  SELECT 1, 'RM-00300', '捆', '个', '20.000000',  '1捆=20个（本地测试数据）'
  UNION ALL
  SELECT 9999, 'RM-PW-2017935', '卷', '米', '25.000000', '1卷=25米（本地测试数据）'
  UNION ALL
  SELECT 9999, 'RM-PW-2301508', '卷', '米', '25.000000', '1卷=25米（本地测试数据）'
) AS seed
  ON seed.tenant_id = s.tenant_id
 AND seed.sku_code = s.sku_code
ON DUPLICATE KEY UPDATE
  conversion_rate = VALUES(conversion_rate),
  description = VALUES(description),
  updated_by = VALUES(updated_by),
  updated_at = CURRENT_TIMESTAMP(3);

UPDATE skus s
INNER JOIN sku_unit_conversions uc
  ON uc.tenant_id = s.tenant_id
 AND uc.sku_id = s.id
 AND uc.from_unit = s.purchase_unit
 AND uc.to_unit = s.stock_unit
SET
  s.stock_conv_factor = uc.conversion_rate,
  s.updated_at = CURRENT_TIMESTAMP(3),
  s.updated_by = 0
WHERE s.purchase_unit <> s.stock_unit;

COMMIT;

SELECT tenant_id, COUNT(*) AS conversion_count
FROM sku_unit_conversions
GROUP BY tenant_id
ORDER BY tenant_id;
