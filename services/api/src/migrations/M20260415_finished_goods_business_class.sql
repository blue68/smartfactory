ALTER TABLE `skus`
  MODIFY COLUMN `business_class`
    ENUM('production_material','finished_goods','consumable','fixed_asset')
    NOT NULL DEFAULT 'production_material'
    COMMENT '业务大类：生产物料 / 成品商品 / 损耗品 / 固定资产';

ALTER TABLE `purchase_order_items`
  MODIFY COLUMN `business_class`
    ENUM('production_material','finished_goods','consumable','fixed_asset')
    NOT NULL DEFAULT 'production_material'
    COMMENT '采购明细业务大类';

ALTER TABLE `purchase_receipt_items`
  MODIFY COLUMN `business_class`
    ENUM('production_material','finished_goods','consumable','fixed_asset')
    NOT NULL DEFAULT 'production_material'
    COMMENT '入库明细业务大类';

ALTER TABLE `inventory_transactions`
  MODIFY COLUMN `business_class`
    ENUM('production_material','finished_goods','consumable')
    NOT NULL DEFAULT 'production_material'
    COMMENT '库存流水业务大类';

UPDATE `skus` s
INNER JOIN `sku_categories` c ON c.id = s.category1_id
SET
  s.business_class = 'finished_goods',
  s.control_mode = 'stock_only',
  s.allow_bom_component = 0,
  s.allow_purchase = 1,
  s.allow_inventory = 1,
  s.allow_production_issue = 0,
  s.requires_asset_acceptance = 0,
  s.default_warehouse_type = 'finished',
  s.asset_tracking_mode = 'none'
WHERE c.code = 'FINISHED';

UPDATE `purchase_order_items` poi
INNER JOIN `skus` s ON s.id = poi.sku_id AND s.tenant_id = poi.tenant_id
INNER JOIN `sku_categories` c ON c.id = s.category1_id
SET
  poi.business_class = 'finished_goods',
  poi.receipt_mode = 'inventory',
  poi.requires_acceptance = 0
WHERE c.code = 'FINISHED';

UPDATE `purchase_receipt_items` pri
INNER JOIN `skus` s ON s.id = pri.sku_id AND s.tenant_id = pri.tenant_id
INNER JOIN `sku_categories` c ON c.id = s.category1_id
SET
  pri.business_class = 'finished_goods',
  pri.receipt_mode = 'inventory',
  pri.requires_acceptance = 0
WHERE c.code = 'FINISHED';

UPDATE `inventory_transactions` it
INNER JOIN `skus` s ON s.id = it.sku_id AND s.tenant_id = it.tenant_id
INNER JOIN `sku_categories` c ON c.id = s.category1_id
SET it.business_class = 'finished_goods'
WHERE c.code = 'FINISHED';
