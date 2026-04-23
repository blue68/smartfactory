import { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { generateNo } from '../../shared/generateNo';
import { ProductionOrderService } from './production-order.service';
import { MrpService } from '../mrp/mrp.service';

interface BatchHeaderRow {
  id: number;
  tenant_id: number;
  batch_no: string;
  name: string | null;
  mode: 'priority_sequential' | 'compatible_merge';
  status: 'draft' | 'confirmed' | 'order_generated' | 'cancelled' | 'closed';
  order_count: number;
  item_count: number;
  total_planned_qty: string;
  notes: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface BatchItemRow {
  id: number;
  batch_id: number;
  batch_order_id: number;
  sales_order_id: number;
  sales_order_item_id: number;
  sku_id: number;
  bom_header_id: number | null;
  process_template_id: number | null;
  qty_open: string;
  qty_planned: string;
  mode: 'priority_sequential' | 'compatible_merge';
  priority_rank: number;
  sequence_no: number;
  merge_group_key: string | null;
  expected_delivery_snapshot: string | null;
  status: 'planned' | 'released' | 'closed' | 'cancelled';
}

export class ProductionBatchService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  private orderSvc(): ProductionOrderService {
    return new ProductionOrderService({ tenantId: this.tenantId, userId: this.userId });
  }

  private mrpSvc(): MrpService {
    return new MrpService({ tenantId: this.tenantId, userId: this.userId });
  }

  async listEligibleSalesOrders(params: {
    keyword?: string;
    customerId?: number;
    page: number;
    pageSize: number;
  }): Promise<{ list: unknown[]; total: number }> {
    const conds = ['so.tenant_id = ?', `so.status IN ('confirmed', 'in_production')`];
    const q: unknown[] = [this.tenantId];
    if (params.keyword) {
      conds.push('(so.order_no LIKE ? OR c.name LIKE ?)');
      q.push(`%${params.keyword}%`, `%${params.keyword}%`);
    }
    if (params.customerId) {
      conds.push('so.customer_id = ?');
      q.push(params.customerId);
    }
    const where = conds.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const rows = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT
          so.id,
          so.order_no AS orderNo,
          so.status,
          so.priority,
          DATE_FORMAT(so.expected_delivery, '%Y-%m-%d') AS expectedDelivery,
          c.id AS customerId,
          c.name AS customerName,
          COUNT(DISTINCT soi.id) AS itemCount,
          COALESCE(SUM(
            CASE
              WHEN COALESCE(unbatched_po_alloc.qty_planned, 0) > 0
                THEN unbatched_po_alloc.qty_planned
              ELSE GREATEST(soi.qty_ordered - COALESCE(po_alloc.qty_planned, 0), 0)
            END
          ), 0) AS openQty
       FROM sales_orders so
       INNER JOIN customers c ON c.id = so.customer_id AND c.tenant_id = so.tenant_id
       INNER JOIN sales_order_items soi ON soi.order_id = so.id AND soi.tenant_id = so.tenant_id
       LEFT JOIN (
         SELECT
           p.tenant_id,
           COALESCE(p.sales_order_item_id, soi2.id) AS sales_order_item_id,
           SUM(p.qty_planned) AS qty_planned
         FROM production_orders p
         LEFT JOIN sales_order_items soi2
           ON soi2.order_id = p.sales_order_id
          AND soi2.sku_id = p.sku_id
          AND soi2.tenant_id = p.tenant_id
         WHERE p.tenant_id = ?
           AND p.status <> 'cancelled'
         GROUP BY p.tenant_id, COALESCE(p.sales_order_item_id, soi2.id)
       ) po_alloc
         ON po_alloc.sales_order_item_id = soi.id
        AND po_alloc.tenant_id = soi.tenant_id
       LEFT JOIN (
         SELECT
           p.tenant_id,
           COALESCE(p.sales_order_item_id, soi2.id) AS sales_order_item_id,
           SUM(p.qty_planned) AS qty_planned
         FROM production_orders p
         LEFT JOIN sales_order_items soi2
           ON soi2.order_id = p.sales_order_id
          AND soi2.sku_id = p.sku_id
          AND soi2.tenant_id = p.tenant_id
         WHERE p.tenant_id = ?
           AND p.status <> 'cancelled'
           AND p.joint_batch_id IS NULL
         GROUP BY p.tenant_id, COALESCE(p.sales_order_item_id, soi2.id)
       ) unbatched_po_alloc
         ON unbatched_po_alloc.sales_order_item_id = soi.id
        AND unbatched_po_alloc.tenant_id = soi.tenant_id
       WHERE ${where}
       GROUP BY so.id, so.order_no, so.status, so.priority, so.expected_delivery, c.id, c.name
       HAVING openQty > 0
       ORDER BY so.priority DESC, so.expected_delivery ASC, so.id ASC
       LIMIT ? OFFSET ?`,
      [this.tenantId, this.tenantId, ...q, params.pageSize, offset],
    );

    const countRows = await AppDataSource.query<Array<{ total: number }>>(
      `SELECT COUNT(*) AS total
       FROM (
         SELECT so.id
         FROM sales_orders so
         INNER JOIN sales_order_items soi ON soi.order_id = so.id AND soi.tenant_id = so.tenant_id
         LEFT JOIN (
           SELECT
             p.tenant_id,
             COALESCE(p.sales_order_item_id, soi2.id) AS sales_order_item_id,
             SUM(p.qty_planned) AS qty_planned
           FROM production_orders p
           LEFT JOIN sales_order_items soi2
             ON soi2.order_id = p.sales_order_id
            AND soi2.sku_id = p.sku_id
            AND soi2.tenant_id = p.tenant_id
           WHERE p.tenant_id = ?
             AND p.status <> 'cancelled'
           GROUP BY p.tenant_id, COALESCE(p.sales_order_item_id, soi2.id)
         ) po_alloc
           ON po_alloc.sales_order_item_id = soi.id
          AND po_alloc.tenant_id = soi.tenant_id
         LEFT JOIN (
           SELECT
             p.tenant_id,
             COALESCE(p.sales_order_item_id, soi2.id) AS sales_order_item_id,
             SUM(p.qty_planned) AS qty_planned
           FROM production_orders p
           LEFT JOIN sales_order_items soi2
             ON soi2.order_id = p.sales_order_id
            AND soi2.sku_id = p.sku_id
            AND soi2.tenant_id = p.tenant_id
           WHERE p.tenant_id = ?
             AND p.status <> 'cancelled'
             AND p.joint_batch_id IS NULL
           GROUP BY p.tenant_id, COALESCE(p.sales_order_item_id, soi2.id)
         ) unbatched_po_alloc
           ON unbatched_po_alloc.sales_order_item_id = soi.id
          AND unbatched_po_alloc.tenant_id = soi.tenant_id
         WHERE ${where}
         GROUP BY so.id
         HAVING COALESCE(SUM(
           CASE
             WHEN COALESCE(unbatched_po_alloc.qty_planned, 0) > 0
               THEN unbatched_po_alloc.qty_planned
             ELSE GREATEST(soi.qty_ordered - COALESCE(po_alloc.qty_planned, 0), 0)
           END
         ), 0) > 0
       ) x`,
      [this.tenantId, this.tenantId, ...q],
    );

    return { list: rows, total: Number(countRows[0]?.total ?? 0) };
  }

  async listBatches(params: {
    page: number;
    pageSize: number;
    status?: string;
    keyword?: string;
  }): Promise<{ list: unknown[]; total: number }> {
    const conds = ['jb.tenant_id = ?'];
    const q: unknown[] = [this.tenantId];
    if (params.status) {
      conds.push('jb.status = ?');
      q.push(params.status);
    }
    if (params.keyword) {
      conds.push('(jb.batch_no LIKE ? OR jb.name LIKE ?)');
      q.push(`%${params.keyword}%`, `%${params.keyword}%`);
    }
    const where = conds.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;
    const [list, totalRows] = await Promise.all([
      AppDataSource.query(
        `SELECT
            jb.id,
            jb.batch_no AS batchNo,
            jb.name,
            jb.mode,
            jb.status,
            jb.order_count AS orderCount,
            jb.item_count AS itemCount,
            jb.total_planned_qty AS totalPlannedQty,
            DATE_FORMAT(jb.confirmed_at, '%Y-%m-%d %H:%i:%s') AS confirmedAt,
            DATE_FORMAT(jb.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
            DATE_FORMAT(jb.updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt,
            COUNT(DISTINCT po.id) AS linkedProductionOrderCount
         FROM joint_production_batches jb
         LEFT JOIN production_orders po
           ON po.joint_batch_id = jb.id
          AND po.tenant_id = jb.tenant_id
          AND po.status <> 'cancelled'
         WHERE ${where}
         GROUP BY jb.id
         ORDER BY jb.created_at DESC
         LIMIT ? OFFSET ?`,
        [...q, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total
         FROM joint_production_batches jb
         WHERE ${where}`,
        q,
      ),
    ]);
    return { list, total: Number(totalRows[0]?.total ?? 0) };
  }

  async createBatch(payload: {
    mode: 'priority_sequential' | 'compatible_merge';
    salesOrderIds: number[];
    notes?: string;
    name?: string;
  }): Promise<unknown> {
    if (payload.salesOrderIds.length === 0) {
      throw AppError.badRequest('至少选择一个销售订单', ResponseCode.INVALID_PARAMS);
    }

    return AppDataSource.transaction(async (manager) => {
      const uniqueOrderIds = [...new Set(payload.salesOrderIds.map(Number))];
      const orderRows = await manager.query<Array<{
        id: number;
        order_no: string;
        status: string;
        priority: number;
        expected_delivery: string;
      }>>(
        `SELECT id, order_no, status, priority, expected_delivery
         FROM sales_orders
         WHERE tenant_id = ?
           AND id IN (${uniqueOrderIds.map(() => '?').join(',')})
         ORDER BY priority DESC, expected_delivery ASC, id ASC`,
        [this.tenantId, ...uniqueOrderIds],
      );
      if (orderRows.length !== uniqueOrderIds.length) {
        throw AppError.badRequest('存在无效销售订单，无法创建联合批次', ResponseCode.INVALID_PARAMS);
      }
      const invalidOrder = orderRows.find((row) => !['confirmed', 'in_production'].includes(row.status));
      if (invalidOrder) {
        throw AppError.badRequest(
          `销售订单 ${invalidOrder.order_no} 状态为 ${invalidOrder.status}，不能加入联合批次`,
          ResponseCode.INVALID_PARAMS,
        );
      }

      const batchNo = await generateNo('production_batch' as never, this.tenantId);
      const insertResult = await manager.query(
        `INSERT INTO joint_production_batches
           (tenant_id, batch_no, name, mode, status, order_count, item_count, total_planned_qty, notes, created_by, updated_by)
         VALUES (?, ?, ?, ?, 'draft', 0, 0, 0, ?, ?, ?)`,
        [this.tenantId, batchNo, payload.name ?? null, payload.mode, payload.notes ?? null, this.userId, this.userId],
      );
      const batchId = Number(insertResult.insertId);

      let sequenceNo = 1;
      let itemCount = 0;
      let totalPlannedQty = 0;
      for (const order of orderRows) {
        const batchOrderResult = await manager.query(
          `INSERT INTO joint_production_batch_orders
             (tenant_id, batch_id, sales_order_id, order_priority, sequence_no, locked_expected_delivery, status, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, 'bound', ?, ?)`,
          [this.tenantId, batchId, order.id, order.priority, sequenceNo, order.expected_delivery, this.userId, this.userId],
        );
        const batchOrderId = Number(batchOrderResult.insertId);

        const itemRows = await manager.query<Array<{
          id: number;
          sku_id: number;
          qty_ordered: string;
          bom_header_id: number | null;
          eligible_qty: string;
          process_template_id: number | null;
          expected_delivery: string;
        }>>(
          `SELECT
              soi.id,
              soi.sku_id,
              soi.qty_ordered,
              COALESCE(unbatched_po_alloc.bom_header_id, soi.bom_header_id) AS bom_header_id,
              CASE
                WHEN COALESCE(unbatched_po_alloc.qty_planned, 0) > 0
                  THEN unbatched_po_alloc.qty_planned
                ELSE GREATEST(soi.qty_ordered - COALESCE(po_alloc.qty_planned, 0), 0)
              END AS eligible_qty,
              (
                COALESCE(
                  unbatched_po_alloc.process_template_id,
                  (
                    SELECT pt.id
                    FROM process_templates pt
                    WHERE pt.tenant_id = soi.tenant_id
                      AND pt.sku_id = soi.sku_id
                    ORDER BY pt.is_default DESC, pt.id DESC
                    LIMIT 1
                  )
                )
              ) AS process_template_id,
              so.expected_delivery
           FROM sales_order_items soi
           INNER JOIN sales_orders so
             ON so.id = soi.order_id
            AND so.tenant_id = soi.tenant_id
           LEFT JOIN (
             SELECT
               p.tenant_id,
               COALESCE(p.sales_order_item_id, soi2.id) AS sales_order_item_id,
               SUM(p.qty_planned) AS qty_planned
             FROM production_orders p
             LEFT JOIN sales_order_items soi2
               ON soi2.order_id = p.sales_order_id
              AND soi2.sku_id = p.sku_id
              AND soi2.tenant_id = p.tenant_id
             WHERE p.tenant_id = ?
               AND p.status <> 'cancelled'
             GROUP BY p.tenant_id, COALESCE(p.sales_order_item_id, soi2.id)
           ) po_alloc
             ON po_alloc.sales_order_item_id = soi.id
            AND po_alloc.tenant_id = soi.tenant_id
           LEFT JOIN (
             SELECT
               p.tenant_id,
               COALESCE(p.sales_order_item_id, soi2.id) AS sales_order_item_id,
               SUM(p.qty_planned) AS qty_planned,
               MAX(p.bom_header_id) AS bom_header_id,
               MAX(p.process_template_id) AS process_template_id
             FROM production_orders p
             LEFT JOIN sales_order_items soi2
               ON soi2.order_id = p.sales_order_id
              AND soi2.sku_id = p.sku_id
              AND soi2.tenant_id = p.tenant_id
             WHERE p.tenant_id = ?
               AND p.status <> 'cancelled'
               AND p.joint_batch_id IS NULL
             GROUP BY p.tenant_id, COALESCE(p.sales_order_item_id, soi2.id)
           ) unbatched_po_alloc
             ON unbatched_po_alloc.sales_order_item_id = soi.id
            AND unbatched_po_alloc.tenant_id = soi.tenant_id
           WHERE soi.order_id = ? AND soi.tenant_id = ?
           ORDER BY soi.id ASC`,
          [this.tenantId, this.tenantId, order.id, this.tenantId],
        );

        for (const item of itemRows) {
          const qtyOpen = Number(item.eligible_qty ?? 0);
          if (qtyOpen <= 0) continue;
          const mergeKey =
            payload.mode === 'compatible_merge'
              ? `${item.sku_id}:${item.bom_header_id ?? 0}:${item.process_template_id ?? 0}`
              : null;
          const snapshot = {
            salesOrderId: order.id,
            salesOrderNo: order.order_no,
            salesOrderItemId: item.id,
            expectedDelivery: item.expected_delivery,
            priority: order.priority,
            skuId: item.sku_id,
          };
          await manager.query(
            `INSERT INTO joint_production_batch_items
               (tenant_id, batch_id, batch_order_id, sales_order_id, sales_order_item_id, sku_id,
                bom_header_id, process_template_id, qty_open, qty_planned, mode, priority_rank, sequence_no,
                merge_group_key, expected_delivery_snapshot, snapshot_json, status, created_by, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?)`,
            [
              this.tenantId,
              batchId,
              batchOrderId,
              order.id,
              item.id,
              item.sku_id,
              item.bom_header_id,
                item.process_template_id,
                item.eligible_qty,
                item.eligible_qty,
                payload.mode,
                order.priority,
                sequenceNo,
              mergeKey,
              item.expected_delivery,
              JSON.stringify(snapshot),
              this.userId,
              this.userId,
            ],
          );
          itemCount += 1;
          totalPlannedQty += qtyOpen;
        }
        sequenceNo += 1;
      }

      if (itemCount === 0) {
        throw AppError.badRequest('所选销售订单没有可规划的明细项', ResponseCode.INVALID_PARAMS);
      }

      await manager.query(
        `UPDATE joint_production_batches
         SET order_count = ?, item_count = ?, total_planned_qty = ?, updated_by = ?, updated_at = NOW()
         WHERE id = ? AND tenant_id = ?`,
        [orderRows.length, itemCount, totalPlannedQty.toFixed(4), this.userId, batchId, this.tenantId],
      );

      return {
        id: batchId,
        batchNo,
        mode: payload.mode,
        status: 'draft',
        orderCount: orderRows.length,
        itemCount,
      };
    });
  }

  async getBatchDetail(batchId: number): Promise<unknown> {
    const [header] = await AppDataSource.query<BatchHeaderRow[]>(
      `SELECT *
       FROM joint_production_batches
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [batchId, this.tenantId],
    );
    if (!header) {
      throw AppError.notFound('联合生产批次不存在', ResponseCode.NOT_FOUND);
    }

    const [orders, items, linkedProductionOrders, shortages] = await Promise.all([
      AppDataSource.query(
        `SELECT
            jbo.id,
            jbo.sales_order_id AS salesOrderId,
            so.order_no AS salesOrderNo,
            so.priority,
            DATE_FORMAT(jbo.locked_expected_delivery, '%Y-%m-%d') AS expectedDelivery,
            c.name AS customerName,
            jbo.sequence_no AS sequenceNo,
            jbo.status
         FROM joint_production_batch_orders jbo
         INNER JOIN sales_orders so ON so.id = jbo.sales_order_id AND so.tenant_id = jbo.tenant_id
         INNER JOIN customers c ON c.id = so.customer_id AND c.tenant_id = so.tenant_id
         WHERE jbo.batch_id = ? AND jbo.tenant_id = ?
         ORDER BY jbo.sequence_no ASC, so.priority DESC`,
        [batchId, this.tenantId],
      ),
      AppDataSource.query(
        `SELECT
            jbi.id,
            jbi.sales_order_id AS salesOrderId,
            jbi.sales_order_item_id AS salesOrderItemId,
            jbi.sku_id AS skuId,
            s.sku_code AS skuCode,
            s.name AS skuName,
            jbi.qty_open AS qtyOpen,
            jbi.qty_planned AS qtyPlanned,
            jbi.priority_rank AS priorityRank,
            jbi.sequence_no AS sequenceNo,
            jbi.mode,
            jbi.merge_group_key AS mergeGroupKey,
            DATE_FORMAT(jbi.expected_delivery_snapshot, '%Y-%m-%d') AS expectedDelivery,
            jbi.status
         FROM joint_production_batch_items jbi
         INNER JOIN skus s ON s.id = jbi.sku_id AND s.tenant_id = jbi.tenant_id
         WHERE jbi.batch_id = ? AND jbi.tenant_id = ?
         ORDER BY jbi.sequence_no ASC, jbi.priority_rank DESC, jbi.id ASC`,
        [batchId, this.tenantId],
      ),
      AppDataSource.query(
        `SELECT
            po.id,
            po.work_order_no AS workOrderNo,
            po.sales_order_id AS salesOrderId,
            po.sales_order_item_id AS salesOrderItemId,
            po.joint_batch_item_id AS batchItemId,
            po.qty_planned AS qtyPlanned,
            po.qty_completed AS qtyCompleted,
            po.status,
            po.material_status AS materialStatus,
            po.merge_group_key AS mergeGroupKey,
            s.name AS skuName
         FROM production_orders po
         INNER JOIN skus s ON s.id = po.sku_id AND s.tenant_id = po.tenant_id
         WHERE po.joint_batch_id = ? AND po.tenant_id = ?
         ORDER BY po.batch_sequence_no ASC, po.id ASC`,
        [batchId, this.tenantId],
      ),
      this.getBatchShortages(batchId),
    ]);

    return {
      header: {
        id: header.id,
        batchNo: header.batch_no,
        name: header.name,
        mode: header.mode,
        status: header.status,
        orderCount: header.order_count,
        itemCount: header.item_count,
        totalPlannedQty: header.total_planned_qty,
        notes: header.notes,
        confirmedAt: header.confirmed_at,
        createdAt: header.created_at,
        updatedAt: header.updated_at,
      },
      orders,
      items,
      linkedProductionOrders,
      shortages,
    };
  }

  async confirmBatch(batchId: number): Promise<unknown> {
    return AppDataSource.transaction(async (manager) => {
      const [header] = await manager.query<BatchHeaderRow[]>(
        `SELECT *
         FROM joint_production_batches
         WHERE id = ? AND tenant_id = ?
         LIMIT 1 FOR UPDATE`,
        [batchId, this.tenantId],
      );
      if (!header) {
        throw AppError.notFound('联合生产批次不存在', ResponseCode.NOT_FOUND);
      }
      if (['cancelled', 'closed'].includes(header.status)) {
        throw AppError.conflict('当前批次状态不允许确认建单', ResponseCode.CONFLICT);
      }

      const items = await manager.query<BatchItemRow[]>(
        `SELECT *
         FROM joint_production_batch_items
         WHERE batch_id = ? AND tenant_id = ? AND status IN ('planned', 'released')
         ORDER BY sequence_no ASC, priority_rank DESC, id ASC`,
        [batchId, this.tenantId],
      );
      if (items.length === 0) {
        throw AppError.badRequest('联合生产批次没有可释放的明细项', ResponseCode.INVALID_PARAMS);
      }

      const createdProductionOrderIds: number[] = [];
      const skippedItemIds: number[] = [];
      for (const item of items) {
        const order = await this.orderSvc().createFromSalesOrderItem(
          item.sales_order_item_id,
          {
            batchId,
            batchItemId: item.id,
            batchSequenceNo: item.sequence_no,
            planMode: item.mode,
            mergeGroupKey: item.merge_group_key,
            priorityRank: item.priority_rank,
            autoGenerateSuggestions: false,
          },
          manager,
        );

        const [existingAlloc] = await manager.query<Array<{ id: number }>>(
          `SELECT id
           FROM production_order_source_allocations
           WHERE tenant_id = ? AND production_order_id = ? AND batch_item_id = ?
           LIMIT 1`,
          [this.tenantId, order.id, item.id],
        );
        if (!existingAlloc) {
          await manager.query(
            `INSERT INTO production_order_source_allocations
               (tenant_id, production_order_id, batch_id, batch_item_id, sales_order_id, sales_order_item_id, allocated_qty, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              this.tenantId,
              order.id,
              batchId,
              item.id,
              item.sales_order_id,
              item.sales_order_item_id,
              item.qty_planned,
              this.userId,
            ],
          );
          createdProductionOrderIds.push(order.id);
        } else {
          skippedItemIds.push(item.id);
        }

        await manager.query(
          `UPDATE joint_production_batch_items
           SET status = 'released', updated_by = ?, updated_at = NOW()
           WHERE id = ? AND tenant_id = ?`,
          [this.userId, item.id, this.tenantId],
        );
      }

      await manager.query(
        `UPDATE joint_production_batch_orders
         SET status = 'released', updated_by = ?, updated_at = NOW()
         WHERE batch_id = ? AND tenant_id = ?`,
        [this.userId, batchId, this.tenantId],
      );
      await manager.query(
        `UPDATE joint_production_batches
         SET status = 'order_generated',
             confirmed_at = COALESCE(confirmed_at, NOW(3)),
             updated_by = ?,
             updated_at = NOW()
         WHERE id = ? AND tenant_id = ?`,
        [this.userId, batchId, this.tenantId],
      );

      return {
        batchId,
        createdProductionOrderIds: [...new Set(createdProductionOrderIds)],
        skippedItemIds,
        status: 'order_generated',
      };
    });
  }

  async getBatchShortages(batchId: number): Promise<unknown[]> {
    const [header] = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT id FROM joint_production_batches WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [batchId, this.tenantId],
    );
    if (!header) {
      throw AppError.notFound('联合生产批次不存在', ResponseCode.NOT_FOUND);
    }
    return AppDataSource.query(
      `SELECT
          mr.sku_id AS skuId,
          s.sku_code AS skuCode,
          s.name AS skuName,
          s.stock_unit AS stockUnit,
          SUM(mr.qty_required) AS qtyRequired,
          SUM(mr.qty_reserved) AS qtyReserved,
          SUM(mr.qty_shortage) AS qtyShortage,
          COUNT(DISTINCT mr.production_order_id) AS affectedOrderCount,
          GROUP_CONCAT(DISTINCT mr.production_order_id ORDER BY mr.production_order_id) AS affectedProductionOrderIds,
          MAX(mr.suggestion_id) AS suggestionId
       FROM material_requirements mr
       INNER JOIN production_orders po
         ON po.id = mr.production_order_id
        AND po.tenant_id = mr.tenant_id
       INNER JOIN skus s
         ON s.id = mr.sku_id
        AND s.tenant_id = mr.tenant_id
       WHERE mr.tenant_id = ?
         AND po.joint_batch_id = ?
       GROUP BY mr.sku_id, s.sku_code, s.name, s.stock_unit
       ORDER BY SUM(mr.qty_shortage) DESC, mr.sku_id ASC`,
      [this.tenantId, batchId],
    );
  }

  async generateBatchPurchaseSuggestions(batchId: number): Promise<unknown> {
    const [header] = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT id FROM joint_production_batches WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [batchId, this.tenantId],
    );
    if (!header) {
      throw AppError.notFound('联合生产批次不存在', ResponseCode.NOT_FOUND);
    }
    return this.mrpSvc().generateSuggestions(undefined, undefined, { batchId });
  }
}
