import Decimal from 'decimal.js';
import { EntityManager } from 'typeorm';

export type PurchaseOrderLifecycleStatus =
  | 'draft'
  | 'confirmed'
  | 'partial_received'
  | 'received'
  | 'cancelled';

export async function recalculatePurchaseOrderStatus(params: {
  manager: EntityManager;
  tenantId: number;
  userId: number;
  poId: number;
}): Promise<PurchaseOrderLifecycleStatus | null> {
  const { manager, tenantId, userId, poId } = params;

  const poRows = await manager.query<Array<{ id: number; status: PurchaseOrderLifecycleStatus }>>(
    `SELECT id, status FROM purchase_orders
     WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
    [poId, tenantId],
  );
  const po = Array.isArray(poRows) ? poRows[0] : null;

  if (!po || po.status === 'cancelled') {
    return po?.status ?? null;
  }

  const aggRows = await manager.query<
    Array<{ total_ordered: string | null; total_received: string | null }>
  >(
    `SELECT
       SUM(COALESCE(qty_ordered, 0)) AS total_ordered,
       SUM(COALESCE(qty_received, 0)) AS total_received
     FROM purchase_order_items
     WHERE po_id = ? AND tenant_id = ?`,
    [poId, tenantId],
  );
  const agg = Array.isArray(aggRows) ? aggRows[0] : null;

  const totalOrdered = new Decimal(agg?.total_ordered ?? '0');
  const totalReceived = new Decimal(agg?.total_received ?? '0');

  let nextStatus: PurchaseOrderLifecycleStatus = 'confirmed';
  if (totalOrdered.gt(0) && totalReceived.gte(totalOrdered)) {
    nextStatus = 'received';
  } else if (totalReceived.gt(0)) {
    nextStatus = 'partial_received';
  }

  if (nextStatus === po.status) {
    return nextStatus;
  }

  await manager.query(
    `UPDATE purchase_orders
     SET status = ?, updated_by = ?
     WHERE id = ? AND tenant_id = ?`,
    [nextStatus, userId, poId, tenantId],
  );

  return nextStatus;
}
