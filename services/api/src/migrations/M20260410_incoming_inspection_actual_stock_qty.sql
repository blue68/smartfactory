SET @has_incoming_inspection_item_accepted_stock_qty := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'incoming_inspection_items'
    AND column_name = 'accepted_stock_qty'
);

SET @sql_add_incoming_inspection_item_accepted_stock_qty := IF(
  @has_incoming_inspection_item_accepted_stock_qty = 0,
  'ALTER TABLE `incoming_inspection_items` ADD COLUMN `accepted_stock_qty` DECIMAL(16,4) DEFAULT NULL COMMENT ''实际接受入库的库存单位数量（如面料米数）'' AFTER `qty_failed`',
  'SELECT 1'
);
PREPARE stmt_add_incoming_inspection_item_accepted_stock_qty FROM @sql_add_incoming_inspection_item_accepted_stock_qty;
EXECUTE stmt_add_incoming_inspection_item_accepted_stock_qty;
DEALLOCATE PREPARE stmt_add_incoming_inspection_item_accepted_stock_qty;
