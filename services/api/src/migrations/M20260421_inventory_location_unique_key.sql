ALTER TABLE `inventory`
  DROP INDEX `uk_tenant_sku`,
  ADD UNIQUE KEY `uk_tenant_sku_wh_loc` (`tenant_id`, `sku_id`, `warehouse_id`, `location_id`);
