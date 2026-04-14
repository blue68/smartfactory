INSERT INTO permission_menus
  (id, tenant_id, parent_id, menu_type, code, name, route_path, icon, group_name, sort_order, status, is_system, default_visible, created_by, updated_by, created_at, updated_at)
SELECT *
FROM (
  SELECT 9003111 AS id, 0 AS tenant_id, 9003001 AS parent_id, 'page' AS menu_type, 'consumables.issue' AS code, '损耗品领用' AS name, '/consumables/issues' AS route_path, 'gift' AS icon, '采购' AS group_name, 110 AS sort_order, 'active' AS status, 1 AS is_system, 1 AS default_visible, 0 AS created_by, 0 AS updated_by, NOW(3) AS created_at, NOW(3) AS updated_at
  UNION ALL
  SELECT 9006103, 0, 9006001, 'page', 'assets.acceptance', '资产验收', '/assets/acceptance', 'idcard', '仓库', 30, 'active', 1, 1, 0, 0, NOW(3), NOW(3)
  UNION ALL
  SELECT 9006104, 0, 9006001, 'page', 'assets.ledger', '资产台账', '/assets/ledger', 'container', '仓库', 40, 'active', 1, 1, 0, 0, NOW(3), NOW(3)
) AS seeds
WHERE NOT EXISTS (
  SELECT 1
  FROM permission_menus pm
  WHERE pm.tenant_id = seeds.tenant_id
    AND pm.code = seeds.code
);

INSERT INTO permission_actions
  (id, tenant_id, menu_id, code, name, action_type, status, default_enabled, created_by, updated_by, created_at, updated_at)
SELECT *
FROM (
  SELECT 9023703 AS id, 0 AS tenant_id, 9003111 AS menu_id, 'consumable:issue:view' AS code, '查看损耗品领用' AS name, 'view' AS action_type, 'active' AS status, 1 AS default_enabled, 0 AS created_by, 0 AS updated_by, NOW(3) AS created_at, NOW(3) AS updated_at
  UNION ALL
  SELECT 9023704, 0, 9003111, 'consumable:issue:create', '创建损耗品领用', 'create', 'active', 1, 0, 0, NOW(3), NOW(3)
  UNION ALL
  SELECT 9023705, 0, 9003111, 'consumable:issue:approve', '审批损耗品领用', 'approve', 'active', 1, 0, 0, NOW(3), NOW(3)
  UNION ALL
  SELECT 9023706, 0, 9003111, 'consumable:issue:execute', '执行损耗品领用', 'custom', 'active', 1, 0, 0, NOW(3), NOW(3)
  UNION ALL
  SELECT 9023707, 0, 9003111, 'consumable:stock:view', '查看损耗品库存', 'view', 'active', 1, 0, 0, NOW(3), NOW(3)
  UNION ALL
  SELECT 9024009, 0, 9006103, 'asset:acceptance:create', '执行资产验收', 'create', 'active', 1, 0, 0, NOW(3), NOW(3)
  UNION ALL
  SELECT 9024010, 0, 9006104, 'asset:view', '查看资产台账', 'view', 'active', 1, 0, 0, NOW(3), NOW(3)
  UNION ALL
  SELECT 9024011, 0, 9006104, 'asset:transfer', '资产调拨', 'custom', 'active', 1, 0, 0, NOW(3), NOW(3)
  UNION ALL
  SELECT 9024012, 0, 9006104, 'asset:return', '资产退回', 'custom', 'active', 1, 0, 0, NOW(3), NOW(3)
  UNION ALL
  SELECT 9024013, 0, 9006104, 'asset:scrap', '资产报废', 'approve', 'active', 1, 0, 0, NOW(3), NOW(3)
) AS seeds
WHERE NOT EXISTS (
  SELECT 1
  FROM permission_actions pa
  WHERE pa.tenant_id = seeds.tenant_id
    AND pa.code = seeds.code
);

INSERT INTO role_permissions
  (tenant_id, role_id, permission_type, permission_key, permission_ref_id, created_by)
SELECT
  r.tenant_id,
  r.id,
  'menu',
  seeds.menu_code,
  pm.id,
  0
FROM (
  SELECT 'boss' AS role_code, 'consumables.issue' AS menu_code
  UNION ALL SELECT 'supervisor', 'consumables.issue'
  UNION ALL SELECT 'purchaser', 'consumables.issue'
  UNION ALL SELECT 'warehouse', 'consumables.issue'
  UNION ALL SELECT 'boss', 'assets.acceptance'
  UNION ALL SELECT 'supervisor', 'assets.acceptance'
  UNION ALL SELECT 'warehouse', 'assets.acceptance'
  UNION ALL SELECT 'boss', 'assets.ledger'
  UNION ALL SELECT 'supervisor', 'assets.ledger'
  UNION ALL SELECT 'purchaser', 'assets.ledger'
  UNION ALL SELECT 'warehouse', 'assets.ledger'
) AS seeds
INNER JOIN roles r
  ON r.tenant_id = 0
 AND r.code = seeds.role_code
INNER JOIN permission_menus pm
  ON pm.tenant_id = 0
 AND pm.code = seeds.menu_code
ON DUPLICATE KEY UPDATE
  permission_ref_id = VALUES(permission_ref_id);

INSERT INTO role_permissions
  (tenant_id, role_id, permission_type, permission_key, permission_ref_id, created_by)
SELECT
  r.tenant_id,
  r.id,
  'action',
  seeds.action_code,
  pa.id,
  0
FROM (
  SELECT 'boss' AS role_code, 'consumable:issue:view' AS action_code
  UNION ALL SELECT 'supervisor', 'consumable:issue:view'
  UNION ALL SELECT 'purchaser', 'consumable:issue:view'
  UNION ALL SELECT 'warehouse', 'consumable:issue:view'
  UNION ALL SELECT 'boss', 'consumable:issue:create'
  UNION ALL SELECT 'purchaser', 'consumable:issue:create'
  UNION ALL SELECT 'warehouse', 'consumable:issue:create'
  UNION ALL SELECT 'boss', 'consumable:issue:approve'
  UNION ALL SELECT 'supervisor', 'consumable:issue:approve'
  UNION ALL SELECT 'boss', 'consumable:issue:execute'
  UNION ALL SELECT 'warehouse', 'consumable:issue:execute'
  UNION ALL SELECT 'boss', 'consumable:stock:view'
  UNION ALL SELECT 'supervisor', 'consumable:stock:view'
  UNION ALL SELECT 'purchaser', 'consumable:stock:view'
  UNION ALL SELECT 'warehouse', 'consumable:stock:view'
  UNION ALL SELECT 'boss', 'asset:acceptance:create'
  UNION ALL SELECT 'supervisor', 'asset:acceptance:create'
  UNION ALL SELECT 'warehouse', 'asset:acceptance:create'
  UNION ALL SELECT 'boss', 'asset:view'
  UNION ALL SELECT 'supervisor', 'asset:view'
  UNION ALL SELECT 'purchaser', 'asset:view'
  UNION ALL SELECT 'warehouse', 'asset:view'
  UNION ALL SELECT 'boss', 'asset:transfer'
  UNION ALL SELECT 'supervisor', 'asset:transfer'
  UNION ALL SELECT 'warehouse', 'asset:transfer'
  UNION ALL SELECT 'boss', 'asset:return'
  UNION ALL SELECT 'supervisor', 'asset:return'
  UNION ALL SELECT 'warehouse', 'asset:return'
  UNION ALL SELECT 'boss', 'asset:scrap'
  UNION ALL SELECT 'supervisor', 'asset:scrap'
) AS seeds
INNER JOIN roles r
  ON r.tenant_id = 0
 AND r.code = seeds.role_code
INNER JOIN permission_actions pa
  ON pa.tenant_id = 0
 AND pa.code = seeds.action_code
ON DUPLICATE KEY UPDATE
  permission_ref_id = VALUES(permission_ref_id);
