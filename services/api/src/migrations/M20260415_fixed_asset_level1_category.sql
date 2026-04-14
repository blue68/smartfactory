INSERT INTO `sku_categories` (`tenant_id`, `level`, `parent_id`, `code`, `name`, `sort_order`, `is_active`, `created_by`, `updated_by`)
SELECT 0, 1, NULL, 'ASSET', '固定资产', 50, 1, 0, 0
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1
  FROM `sku_categories`
  WHERE `tenant_id` = 0
    AND `level` = 1
    AND `code` = 'ASSET'
);
