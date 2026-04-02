SET @has_delivery_note_item_dye_lot := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'delivery_note_items'
    AND column_name = 'dye_lot_no'
);

SET @sql_add_delivery_note_item_dye_lot := IF(
  @has_delivery_note_item_dye_lot = 0,
  'ALTER TABLE `delivery_note_items` ADD COLUMN `dye_lot_no` VARCHAR(100) DEFAULT NULL COMMENT ''面料/皮料类到货后确认的缸号'' AFTER `sku_id`',
  'SELECT 1'
);
PREPARE stmt_add_delivery_note_item_dye_lot FROM @sql_add_delivery_note_item_dye_lot;
EXECUTE stmt_add_delivery_note_item_dye_lot;
DEALLOCATE PREPARE stmt_add_delivery_note_item_dye_lot;

SET @has_incoming_inspection_item_dye_lot := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'incoming_inspection_items'
    AND column_name = 'dye_lot_no'
);

SET @sql_add_incoming_inspection_item_dye_lot := IF(
  @has_incoming_inspection_item_dye_lot = 0,
  'ALTER TABLE `incoming_inspection_items` ADD COLUMN `dye_lot_no` VARCHAR(100) DEFAULT NULL COMMENT ''继承送货明细的缸号'' AFTER `po_item_id`',
  'SELECT 1'
);
PREPARE stmt_add_incoming_inspection_item_dye_lot FROM @sql_add_incoming_inspection_item_dye_lot;
EXECUTE stmt_add_incoming_inspection_item_dye_lot;
DEALLOCATE PREPARE stmt_add_incoming_inspection_item_dye_lot;

SET @has_purchase_receipt_items_table := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name = 'purchase_receipt_items'
);

SET @has_purchase_receipt_item_dye_lot := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'purchase_receipt_items'
    AND column_name = 'dye_lot_no'
);

SET @sql_add_purchase_receipt_item_dye_lot := IF(
  @has_purchase_receipt_items_table > 0 AND @has_purchase_receipt_item_dye_lot = 0,
  'ALTER TABLE `purchase_receipt_items` ADD COLUMN `dye_lot_no` VARCHAR(100) DEFAULT NULL COMMENT ''采购入库缸号'' AFTER `sku_id`',
  'SELECT 1'
);
PREPARE stmt_add_purchase_receipt_item_dye_lot FROM @sql_add_purchase_receipt_item_dye_lot;
EXECUTE stmt_add_purchase_receipt_item_dye_lot;
DEALLOCATE PREPARE stmt_add_purchase_receipt_item_dye_lot;
