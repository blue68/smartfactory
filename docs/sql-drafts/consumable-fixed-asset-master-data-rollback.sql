-- =============================================================================
-- consumable-fixed-asset-master-data-rollback.sql
-- 损耗品/固定资产默认仓库主数据回滚草案
-- 使用前提：
--   1) 先将 ? 替换为实际 tenant_id
--   2) 只在确认以下仓库/库位尚未承载正式业务数据时执行
--   3) 若任何前置检查返回非 0 或存在明细行，先停止回滚
-- =============================================================================

-- 默认待回滚编码：
--   WH-CONS / LOC-CONS-01
--   WH-AST-PEND / LOC-AST-PEND-01
--   WH-AST / LOC-AST-01

-- 1. 检查是否仍有库存主账引用
SELECT
  w.code AS warehouse_code,
  l.code AS location_code,
  COUNT(*) AS inventory_rows
FROM inventory i
INNER JOIN warehouses w ON w.id = i.warehouse_id AND w.tenant_id = i.tenant_id
INNER JOIN locations l ON l.id = i.location_id AND l.tenant_id = i.tenant_id
WHERE i.tenant_id = ?
  AND w.code IN ('WH-CONS', 'WH-AST-PEND', 'WH-AST')
GROUP BY w.code, l.code
ORDER BY w.code, l.code;

-- 2. 检查是否仍有库存流水引用
SELECT
  w.code AS warehouse_code,
  l.code AS location_code,
  COUNT(*) AS inventory_tx_rows
FROM inventory_transactions it
INNER JOIN warehouses w ON w.id = it.warehouse_id AND w.tenant_id = it.tenant_id
INNER JOIN locations l ON l.id = it.location_id AND l.tenant_id = it.tenant_id
WHERE it.tenant_id = ?
  AND w.code IN ('WH-CONS', 'WH-AST-PEND', 'WH-AST')
GROUP BY w.code, l.code
ORDER BY w.code, l.code;

-- 3. 检查损耗品领用是否已引用这些仓库/库位
SELECT
  w.code AS warehouse_code,
  l.code AS location_code,
  COUNT(*) AS consumable_issue_rows
FROM consumable_issue_items cii
INNER JOIN warehouses w ON w.id = cii.warehouse_id AND w.tenant_id = cii.tenant_id
INNER JOIN locations l ON l.id = cii.location_id AND l.tenant_id = cii.tenant_id
WHERE cii.tenant_id = ?
  AND w.code IN ('WH-CONS', 'WH-AST-PEND', 'WH-AST')
GROUP BY w.code, l.code
ORDER BY w.code, l.code;

-- 4. 检查资产卡片是否已进入正式流转
SELECT
  COUNT(*) AS asset_card_rows
FROM asset_cards
WHERE tenant_id = ?
  AND status <> 'draft';

-- 5. 若以上检查均安全，再执行删除（建议事务内执行）
START TRANSACTION;

DELETE l
FROM locations l
INNER JOIN warehouses w
  ON w.id = l.warehouse_id
 AND w.tenant_id = l.tenant_id
WHERE l.tenant_id = ?
  AND (
    (w.code = 'WH-CONS' AND l.code = 'LOC-CONS-01')
    OR (w.code = 'WH-AST-PEND' AND l.code = 'LOC-AST-PEND-01')
    OR (w.code = 'WH-AST' AND l.code = 'LOC-AST-01')
  );

DELETE FROM warehouses
WHERE tenant_id = ?
  AND code IN ('WH-CONS', 'WH-AST-PEND', 'WH-AST');

COMMIT;

-- 6. 回滚后复核
SELECT id, code, name, type, status
FROM warehouses
WHERE tenant_id = ?
  AND code IN ('WH-CONS', 'WH-AST-PEND', 'WH-AST');
