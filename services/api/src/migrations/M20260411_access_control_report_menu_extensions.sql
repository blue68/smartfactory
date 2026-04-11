INSERT INTO permission_menus
  (id, tenant_id, parent_id, menu_type, code, name, route_path, icon, group_name, sort_order, status, is_system, default_visible, created_by, updated_by, created_at, updated_at)
SELECT *
FROM (
  SELECT
    9009104 AS id,
    0 AS tenant_id,
    9009001 AS parent_id,
    'page' AS menu_type,
    'report.semi_finished_mode' AS code,
    '半成品模式报表' AS name,
    '/report/semi-finished-modes' AS route_path,
    'table' AS icon,
    '报表' AS group_name,
    40 AS sort_order,
    'active' AS status,
    1 AS is_system,
    1 AS default_visible,
    0 AS created_by,
    0 AS updated_by,
    NOW(3) AS created_at,
    NOW(3) AS updated_at
  UNION ALL
  SELECT
    9009105 AS id,
    0 AS tenant_id,
    9009001 AS parent_id,
    'page' AS menu_type,
    'report.inventory_operation' AS code,
    '库存经营' AS name,
    '/report/inventory-operation' AS route_path,
    'fund-projection-screen' AS icon,
    '报表' AS group_name,
    50 AS sort_order,
    'active' AS status,
    1 AS is_system,
    1 AS default_visible,
    0 AS created_by,
    0 AS updated_by,
    NOW(3) AS created_at,
    NOW(3) AS updated_at
) AS seeds
WHERE NOT EXISTS (
  SELECT 1
  FROM permission_menus pm
  WHERE pm.tenant_id = seeds.tenant_id
    AND pm.code = seeds.code
);
