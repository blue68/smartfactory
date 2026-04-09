type SqlQueryRunner = {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
};

export async function syncInventoryDailySnapshotForSku(
  manager: SqlQueryRunner,
  tenantId: number,
  skuId: number,
): Promise<void> {
  await manager.query(
    `INSERT INTO inventory_daily_snapshots
       (tenant_id, snapshot_date, warehouse_id, sku_id, qty_on_hand, qty_reserved, qty_available)
     SELECT
       tenant_id,
       CURDATE(),
       COALESCE(warehouse_id, 0) AS warehouse_id,
       sku_id,
       SUM(qty_on_hand) AS qty_on_hand,
       SUM(qty_reserved) AS qty_reserved,
       SUM(qty_on_hand) - SUM(qty_reserved) AS qty_available
     FROM inventory
     WHERE tenant_id = ? AND sku_id = ?
     GROUP BY tenant_id, COALESCE(warehouse_id, 0), sku_id
     ON DUPLICATE KEY UPDATE
       qty_on_hand = VALUES(qty_on_hand),
       qty_reserved = VALUES(qty_reserved),
       qty_available = VALUES(qty_available)`,
    [tenantId, skuId],
  );

  await manager.query(
    `DELETE ids
       FROM inventory_daily_snapshots ids
      WHERE ids.tenant_id = ?
        AND ids.snapshot_date = CURDATE()
        AND ids.sku_id = ?
        AND NOT EXISTS (
          SELECT 1
            FROM inventory inv
           WHERE inv.tenant_id = ids.tenant_id
             AND inv.sku_id = ids.sku_id
             AND COALESCE(inv.warehouse_id, 0) = ids.warehouse_id
        )`,
    [tenantId, skuId],
  );
}

export async function rebuildInventoryDailySnapshotsForScope(
  manager: SqlQueryRunner,
  params: {
    snapshotDate: string;
    whereSql: string;
    whereParams: unknown[];
  },
): Promise<void> {
  await manager.query(
    `DELETE FROM inventory_daily_snapshots
      WHERE snapshot_date = ?
        AND ${params.whereSql}`,
    [params.snapshotDate, ...params.whereParams],
  );

  await manager.query(
    `INSERT INTO inventory_daily_snapshots
       (tenant_id, snapshot_date, warehouse_id, sku_id, qty_on_hand, qty_reserved, qty_available)
     SELECT
       tenant_id,
       ?,
       COALESCE(warehouse_id, 0) AS warehouse_id,
       sku_id,
       SUM(qty_on_hand) AS qty_on_hand,
       SUM(qty_reserved) AS qty_reserved,
       SUM(qty_on_hand) - SUM(qty_reserved) AS qty_available
     FROM inventory
     WHERE ${params.whereSql}
     GROUP BY tenant_id, COALESCE(warehouse_id, 0), sku_id
     ON DUPLICATE KEY UPDATE
       qty_on_hand = VALUES(qty_on_hand),
       qty_reserved = VALUES(qty_reserved),
       qty_available = VALUES(qty_available)`,
    [params.snapshotDate, ...params.whereParams],
  );
}
