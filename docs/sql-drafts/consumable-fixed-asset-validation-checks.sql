-- =============================================================================
-- consumable-fixed-asset-validation-checks.sql
-- 发布前数据核查 SQL
-- 目标：
--   1) 校验历史 SKU 回填是否符合预期
--   2) 扫描存量 BOM 是否混入损耗品 / 固定资产
--   3) 扫描固定资产是否被错误标记为 inventory 收货
--   4) 检查损耗品仓 / 资产待验收仓 / 资产仓主数据是否齐备
-- 使用方式：
--   - 在目标租户环境执行
--   - 将 ? 替换为实际 tenant_id
-- =============================================================================

-- 1. 历史 SKU 回填分布
SELECT
  tenant_id,
  business_class,
  control_mode,
  COUNT(*) AS sku_count
FROM skus
WHERE tenant_id = ?
GROUP BY tenant_id, business_class, control_mode
ORDER BY business_class, control_mode;

-- 2. 类目与业务大类不一致的 SKU
SELECT
  s.id,
  s.sku_code,
  s.name,
  c.code AS category_code,
  s.business_class,
  s.control_mode,
  s.allow_bom_component,
  s.allow_inventory
FROM skus s
LEFT JOIN sku_categories c ON c.id = s.category1_id
WHERE s.tenant_id = ?
  AND (
    (c.code IN ('MATERIAL', 'SEMIFIN') AND s.business_class <> 'production_material')
    OR (c.code = 'PACKING' AND s.business_class <> 'consumable')
    OR (c.code = 'FINISHED' AND s.allow_bom_component <> 0)
  )
ORDER BY s.id DESC;

-- 3. 存量 BOM 中混入损耗品 / 固定资产
SELECT
  bh.id AS bom_id,
  bh.version,
  bh.status AS bom_status,
  bi.id AS bom_item_id,
  bi.component_sku_id,
  s.sku_code,
  s.name AS sku_name,
  s.business_class,
  s.allow_bom_component
FROM bom_items bi
INNER JOIN bom_headers bh ON bh.id = bi.bom_header_id AND bh.tenant_id = bi.tenant_id
INNER JOIN skus s ON s.id = bi.component_sku_id AND s.tenant_id = bi.tenant_id
WHERE bi.tenant_id = ?
  AND (
    s.business_class IN ('consumable', 'fixed_asset')
    OR s.allow_bom_component = 0
  )
ORDER BY bh.id DESC, bi.id DESC;

-- 4. 固定资产采购明细被错误标记为 inventory 收货
SELECT
  poi.id,
  poi.po_id,
  poi.sku_id,
  s.sku_code,
  s.name AS sku_name,
  poi.business_class,
  poi.receipt_mode,
  poi.requires_acceptance,
  poi.qty_ordered,
  poi.qty_received
FROM purchase_order_items poi
INNER JOIN skus s ON s.id = poi.sku_id AND s.tenant_id = poi.tenant_id
WHERE poi.tenant_id = ?
  AND (
    poi.business_class = 'fixed_asset'
    OR s.business_class = 'fixed_asset'
  )
  AND poi.receipt_mode = 'inventory'
ORDER BY poi.id DESC;

-- 5. 固定资产入库明细被错误写入 inventory 收货路径
SELECT
  pri.id,
  pri.receipt_id,
  pri.po_item_id,
  pri.sku_id,
  s.sku_code,
  s.name AS sku_name,
  pri.business_class,
  pri.receipt_mode,
  pri.requires_acceptance,
  pri.qty_received,
  pri.amount
FROM purchase_receipt_items pri
INNER JOIN skus s ON s.id = pri.sku_id AND s.tenant_id = pri.tenant_id
WHERE pri.tenant_id = ?
  AND (
    pri.business_class = 'fixed_asset'
    OR s.business_class = 'fixed_asset'
  )
  AND pri.receipt_mode = 'inventory'
ORDER BY pri.id DESC;

-- 6. 固定资产是否误进入库存主账
SELECT
  i.sku_id,
  s.sku_code,
  s.name AS sku_name,
  s.business_class,
  SUM(i.qty_on_hand) AS qty_on_hand,
  SUM(i.qty_reserved) AS qty_reserved,
  SUM(i.qty_in_transit) AS qty_in_transit
FROM inventory i
INNER JOIN skus s ON s.id = i.sku_id AND s.tenant_id = i.tenant_id
WHERE i.tenant_id = ?
  AND s.business_class = 'fixed_asset'
GROUP BY i.sku_id, s.sku_code, s.name, s.business_class
HAVING SUM(i.qty_on_hand) <> 0
    OR SUM(i.qty_reserved) <> 0
    OR SUM(i.qty_in_transit) <> 0
ORDER BY i.sku_id DESC;

-- 7. 损耗品仓 / 资产待验收仓 / 资产仓主数据检查
SELECT
  id,
  code,
  name,
  type,
  status
FROM warehouses
WHERE tenant_id = ?
  AND type IN ('consumable', 'asset_pending', 'asset')
ORDER BY type, id;

-- 8. 固定资产 SKU 是否缺少资产档案
SELECT
  s.id,
  s.sku_code,
  s.name,
  s.business_class,
  s.control_mode,
  s.requires_asset_acceptance
FROM skus s
LEFT JOIN sku_asset_profiles ap ON ap.sku_id = s.id AND ap.tenant_id = s.tenant_id
WHERE s.tenant_id = ?
  AND s.business_class = 'fixed_asset'
  AND ap.id IS NULL
ORDER BY s.id DESC;

-- 9. 损耗品 SKU 是否缺少损耗品档案
SELECT
  s.id,
  s.sku_code,
  s.name,
  s.business_class,
  s.control_mode
FROM skus s
LEFT JOIN sku_consumable_profiles cp ON cp.sku_id = s.id AND cp.tenant_id = s.tenant_id
WHERE s.tenant_id = ?
  AND s.business_class = 'consumable'
  AND cp.id IS NULL
ORDER BY s.id DESC;
