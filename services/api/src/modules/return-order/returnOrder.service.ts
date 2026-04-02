import { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import Decimal from 'decimal.js';
import { generateNo } from '../../shared/generateNo';
import { recalculatePurchaseOrderStatus } from '../purchase/purchase-order-status.util';
import { getRedisClient, RedisKeys } from '../../config/redis';

// ─── 参数类型定义 ─────────────────────────────────────────────────

export interface ListReturnOrderFilter {
  page: number;
  pageSize: number;
  status?: string;
  returnType?: string;
  supplierId?: number;
  dateFrom?: string;
  dateTo?: string;
  keyword?: string;
}

export interface CreateReturnOrderParams {
  returnType: 'purchase_return' | 'production_return';
  sourcePoId?: number;
  supplierId?: number;
  returnReason: string;
  notes?: string;
  items: Array<{
    skuId: number;
    qtyReturn: string;
    purchaseUnit: string;
    unitPrice: string;
    defectReason?: string;
  }>;
}

export interface CreateFromInspectionItem {
  sku_id: number;
  qty_failed: string;
  purchase_unit?: string;
  unit_price?: string;
  po_item_id?: number;
}

// ─── Service ─────────────────────────────────────────────────────

export class ReturnOrderService {
  private readonly tenantId: number;
  private readonly userId: number;
  private static returnOrderItemUpdatedBySupported: boolean | null = null;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  private buildMergedNotes(current: unknown, additions: Array<string | null | undefined>): string | null {
    const parts = [String(current ?? '').trim(), ...additions.map((item) => String(item ?? '').trim())]
      .filter(Boolean);
    if (!parts.length) return null;
    return parts.join('\n');
  }

  private async hasReturnOrderItemUpdatedByColumn(manager?: EntityManager): Promise<boolean> {
    if (ReturnOrderService.returnOrderItemUpdatedBySupported !== null) {
      return ReturnOrderService.returnOrderItemUpdatedBySupported;
    }

    const runner = manager ?? AppDataSource;
    const rows = await runner.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'return_order_items'
         AND column_name = 'updated_by'`,
    );

    ReturnOrderService.returnOrderItemUpdatedBySupported = Number(rows[0]?.cnt ?? 0) > 0;
    return ReturnOrderService.returnOrderItemUpdatedBySupported;
  }

  private async syncDailySnapshot(
    manager: { query: typeof AppDataSource.query },
    skuId: number,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO inventory_daily_snapshots
         (tenant_id, snapshot_date, sku_id, qty_on_hand, qty_reserved, qty_available)
       SELECT
         tenant_id,
         CURDATE(),
         sku_id,
         qty_on_hand,
         qty_reserved,
         qty_on_hand - qty_reserved
       FROM inventory
       WHERE tenant_id = ? AND sku_id = ?
       ON DUPLICATE KEY UPDATE
         qty_on_hand = VALUES(qty_on_hand),
         qty_reserved = VALUES(qty_reserved),
         qty_available = VALUES(qty_available)`,
      [this.tenantId, skuId],
    );
  }

  private async collectShipInventoryDeltas(
    manager: EntityManager,
    returnId: number,
  ): Promise<Array<{ skuId: number; qtyStock: Decimal; stockUnit: string }>> {
    const rows = await manager.query<Array<{
      skuId: number;
      qtyReturn: string;
      purchaseUnit: string;
      stockUnit: string;
      conversionRate: string | null;
    }>>(
      `SELECT
         roi.sku_id AS skuId,
         roi.qty_return AS qtyReturn,
         roi.purchase_unit AS purchaseUnit,
         s.stock_unit AS stockUnit,
         uc.conversion_rate AS conversionRate
       FROM return_order_items roi
       INNER JOIN skus s
         ON s.id = roi.sku_id
        AND s.tenant_id = roi.tenant_id
       LEFT JOIN sku_unit_conversions uc
         ON uc.tenant_id = roi.tenant_id
        AND uc.sku_id = roi.sku_id
        AND uc.from_unit = roi.purchase_unit
        AND uc.to_unit = s.stock_unit
       WHERE roi.return_id = ? AND roi.tenant_id = ?`,
      [returnId, this.tenantId],
    );

    const deltas = new Map<number, { qtyStock: Decimal; stockUnit: string }>();

    for (const row of rows) {
      if (row.purchaseUnit !== row.stockUnit && !row.conversionRate) {
        throw AppError.badRequest(
          `SKU#${row.skuId} 缺少 ${row.purchaseUnit} -> ${row.stockUnit} 的单位换算，无法执行退货出库`,
        );
      }

      const qtyStock = new Decimal(row.qtyReturn).mul(new Decimal(row.conversionRate ?? '1'));
      const current = deltas.get(Number(row.skuId));
      if (current) {
        current.qtyStock = current.qtyStock.plus(qtyStock);
        continue;
      }
      deltas.set(Number(row.skuId), {
        qtyStock,
        stockUnit: row.stockUnit,
      });
    }

    return Array.from(deltas.entries()).map(([skuId, item]) => ({
      skuId,
      qtyStock: item.qtyStock,
      stockUnit: item.stockUnit,
    }));
  }

  private shouldDeductInventoryOnShip(record: {
    return_type: string;
    source_inspection_id: number | null;
  }): boolean {
    return record.return_type === 'purchase_return' && !record.source_inspection_id;
  }

  // ── 分页列表 ─────────────────────────────────────────────────
  async list(filter: ListReturnOrderFilter) {
    const conds = ['ro.tenant_id = ?'];
    const params: unknown[] = [this.tenantId];

    if (filter.status) {
      conds.push('ro.status = ?');
      params.push(filter.status);
    }
    if (filter.returnType) {
      conds.push('ro.return_type = ?');
      params.push(filter.returnType);
    }
    if (filter.supplierId) {
      conds.push('ro.supplier_id = ?');
      params.push(filter.supplierId);
    }
    if (filter.dateFrom) {
      conds.push('DATE(ro.created_at) >= ?');
      params.push(filter.dateFrom);
    }
    if (filter.dateTo) {
      conds.push('DATE(ro.created_at) <= ?');
      params.push(filter.dateTo);
    }
    if (filter.keyword) {
      conds.push('(ro.return_no LIKE ? OR sup.name LIKE ? OR po.po_no LIKE ? OR ir.inspection_no LIKE ?)');
      const keyword = `%${filter.keyword}%`;
      params.push(keyword, keyword, keyword, keyword);
    }

    const where = conds.join(' AND ');
    const offset = (filter.page - 1) * filter.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query(
        `SELECT
                ro.id,
                ro.return_no AS returnNo,
                ro.return_type AS returnType,
                ro.source_po_id AS sourcePoId,
                ro.source_inspection_id AS sourceInspectionId,
                ro.supplier_id AS supplierId,
                ro.status,
                ro.return_reason AS returnReason,
                ro.total_qty AS totalQty,
                ro.notes,
                ro.confirmed_at AS confirmedAt,
                ro.shipped_at AS shippedAt,
                ro.completed_at AS completedAt,
                ro.created_at AS createdAt,
                ro.updated_at AS updatedAt,
                sup.name AS supplierName,
                po.po_no AS poNo,
                ir.inspection_no AS inspectionNo,
                COALESCE(SUM(CAST(roi.qty_return AS DECIMAL(16,4)) * CAST(roi.unit_price AS DECIMAL(14,4))), 0) AS totalAmount,
                COUNT(roi.id) AS itemCount
         FROM return_orders ro
         LEFT JOIN suppliers sup ON sup.id = ro.supplier_id
         LEFT JOIN purchase_orders po ON po.id = ro.source_po_id
         LEFT JOIN incoming_inspection_records ir ON ir.id = ro.source_inspection_id
         LEFT JOIN return_order_items roi ON roi.return_id = ro.id AND roi.tenant_id = ro.tenant_id
         WHERE ${where}
         GROUP BY
           ro.id, ro.return_no, ro.return_type, ro.source_po_id, ro.source_inspection_id,
           ro.supplier_id, ro.status, ro.return_reason, ro.total_qty, ro.notes,
           ro.confirmed_at, ro.shipped_at, ro.completed_at, ro.created_at, ro.updated_at,
           sup.name, po.po_no, ir.inspection_no
         ORDER BY ro.id DESC
         LIMIT ? OFFSET ?`,
        [...params, filter.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total
         FROM return_orders ro
         LEFT JOIN suppliers sup ON sup.id = ro.supplier_id
         LEFT JOIN purchase_orders po ON po.id = ro.source_po_id
         LEFT JOIN incoming_inspection_records ir ON ir.id = ro.source_inspection_id
         WHERE ${where}`,
        params,
      ),
    ]);

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  // ── 详情（含 items）──────────────────────────────────────────
  async getById(id: number) {
    const [record] = await AppDataSource.query(
      `SELECT
              ro.id,
              ro.return_no AS returnNo,
              ro.return_type AS returnType,
              ro.source_po_id AS sourcePoId,
              ro.source_inspection_id AS sourceInspectionId,
              ro.supplier_id AS supplierId,
              ro.status,
              ro.return_reason AS returnReason,
              ro.total_qty AS totalQty,
              ro.notes,
              ro.confirmed_at AS confirmedAt,
              ro.shipped_at AS shippedAt,
              ro.completed_at AS completedAt,
              ro.created_at AS createdAt,
              ro.updated_at AS updatedAt,
              sup.name AS supplierName,
              po.po_no AS poNo,
              ir.inspection_no AS inspectionNo,
              COALESCE(SUM(CAST(roi.qty_return AS DECIMAL(16,4)) * CAST(roi.unit_price AS DECIMAL(14,4))), 0) AS totalAmount,
              COUNT(roi.id) AS itemCount
       FROM return_orders ro
       LEFT JOIN suppliers sup ON sup.id = ro.supplier_id
       LEFT JOIN purchase_orders po ON po.id = ro.source_po_id
       LEFT JOIN incoming_inspection_records ir ON ir.id = ro.source_inspection_id
       LEFT JOIN return_order_items roi ON roi.return_id = ro.id AND roi.tenant_id = ro.tenant_id
       WHERE ro.id = ? AND ro.tenant_id = ?
       GROUP BY
         ro.id, ro.return_no, ro.return_type, ro.source_po_id, ro.source_inspection_id,
         ro.supplier_id, ro.status, ro.return_reason, ro.total_qty, ro.notes,
         ro.confirmed_at, ro.shipped_at, ro.completed_at, ro.created_at, ro.updated_at,
         sup.name, po.po_no, ir.inspection_no
       LIMIT 1`,
      [id, this.tenantId],
    );

    if (!record) {
      throw AppError.notFound('退货单不存在', ResponseCode.NOT_FOUND);
    }

    const items = await AppDataSource.query(
      `SELECT
              roi.id,
              roi.return_id AS returnId,
              roi.sku_id AS skuId,
              roi.qty_return AS qtyReturn,
              roi.purchase_unit AS purchaseUnit,
              roi.unit_price AS unitPrice,
              roi.defect_reason AS defectReason,
              CAST(roi.qty_return AS DECIMAL(16,4)) * CAST(roi.unit_price AS DECIMAL(14,4)) AS amount,
              roi.created_at AS createdAt,
              roi.updated_at AS updatedAt,
              s.sku_code AS skuCode,
              s.name AS skuName
       FROM return_order_items roi
       LEFT JOIN skus s ON s.id = roi.sku_id
       WHERE roi.return_id = ? AND roi.tenant_id = ?
       ORDER BY roi.id ASC`,
      [id, this.tenantId],
    );

    return { ...record, items };
  }

  // ── 手动创建退货单 ────────────────────────────────────────────
  async create(params: CreateReturnOrderParams): Promise<{ id: number; returnNo: string }> {
    if (!params.items.length) {
      throw AppError.badRequest('退货单至少需要一条明细');
    }

    return AppDataSource.transaction(async (manager) => {
      const returnNo = await generateNo('return_order', this.tenantId);
      const supportsItemUpdatedBy = await this.hasReturnOrderItemUpdatedByColumn(manager);

      const totalQty = params.items.reduce((sum: Decimal, item) => {
        return sum.plus(new Decimal(item.qtyReturn));
      }, new Decimal(0));

      const result = await manager.query(
        `INSERT INTO return_orders
           (tenant_id, return_no, return_type, source_po_id, source_inspection_id,
            supplier_id, status, return_reason, total_qty, notes, created_by, updated_by)
         VALUES (?,?,?,?,NULL,?,'draft',?,?,?,?,?)`,
        [
          this.tenantId,
          returnNo,
          params.returnType,
          params.sourcePoId ?? null,
          params.supplierId ?? null,
          params.returnReason,
          totalQty.toString(),
          params.notes ?? null,
          this.userId,
          this.userId,
        ],
      );
      const returnId = Number(result.insertId);

      for (const item of params.items) {
        const qty = new Decimal(item.qtyReturn);
        const price = new Decimal(item.unitPrice);
        await manager.query(
          supportsItemUpdatedBy
            ? `INSERT INTO return_order_items
                 (tenant_id, return_id, sku_id, qty_return, purchase_unit,
                  unit_price, defect_reason, created_by, updated_by)
               VALUES (?,?,?,?,?,?,?,?,?)`
            : `INSERT INTO return_order_items
                 (tenant_id, return_id, sku_id, qty_return, purchase_unit,
                  unit_price, defect_reason, created_by)
               VALUES (?,?,?,?,?,?,?,?)`,
          supportsItemUpdatedBy
            ? [
                this.tenantId,
                returnId,
                item.skuId,
                qty.toString(),
                item.purchaseUnit,
                price.toString(),
                item.defectReason ?? null,
                this.userId,
                this.userId,
              ]
            : [
                this.tenantId,
                returnId,
                item.skuId,
                qty.toString(),
                item.purchaseUnit,
                price.toString(),
                item.defectReason ?? null,
                this.userId,
              ],
        );
      }

      return { id: returnId, returnNo };
    });
  }

  /**
   * 质检不合格自动创建退货单
   * 接收 manager 参数以在同一事务中执行（由 incomingInspection.submit 调用）
   */
  async createFromInspection(
    inspectionId: number,
    failedItems: CreateFromInspectionItem[],
    manager: EntityManager,
  ): Promise<{ id: number; returnNo: string }> {
    if (!failedItems.length) {
      throw AppError.badRequest('无不合格品可退货');
    }

    // 获取质检单关联的 PO 及供应商信息
    const [inspection] = await manager.query(
      `SELECT r.po_id, r.tenant_id,
              po.supplier_id
       FROM incoming_inspection_records r
       LEFT JOIN purchase_orders po ON po.id = r.po_id
       WHERE r.id = ? AND r.tenant_id = ?
       LIMIT 1`,
      [inspectionId, this.tenantId],
    );

    if (!inspection) {
      throw AppError.notFound('质检单不存在', ResponseCode.NOT_FOUND);
    }

    const returnNo = await generateNo('return_order', this.tenantId);

    const totalQty = failedItems.reduce((sum: Decimal, item) => {
      return sum.plus(new Decimal(item.qty_failed || '0'));
    }, new Decimal(0));

    const result = await manager.query(
      `INSERT INTO return_orders
         (tenant_id, return_no, return_type, source_po_id, source_inspection_id,
          supplier_id, status, return_reason, total_qty, notes,
          confirmed_at, created_by, updated_by)
       VALUES (?,?,'purchase_return',?,?,?,'confirmed',?,?,?,NOW(),?,?)`,
      [
        this.tenantId,
        returnNo,
        inspection.po_id,
        inspectionId,
        inspection.supplier_id ?? null,
        '质检不合格退货（BD-004）',
        totalQty.toString(),
        null,
        this.userId,
        this.userId,
      ],
    );
    const returnId = Number(result.insertId);
    const supportsItemUpdatedBy = await this.hasReturnOrderItemUpdatedByColumn(manager);

    for (const item of failedItems) {
      const qty = new Decimal(item.qty_failed || '0');
      const price = new Decimal(item.unit_price || '0');

      await manager.query(
        supportsItemUpdatedBy
          ? `INSERT INTO return_order_items
               (tenant_id, return_id, sku_id, qty_return, purchase_unit,
                unit_price, defect_reason, created_by, updated_by)
             VALUES (?,?,?,?,?,?,?,?,?)`
          : `INSERT INTO return_order_items
               (tenant_id, return_id, sku_id, qty_return, purchase_unit,
                unit_price, defect_reason, created_by)
             VALUES (?,?,?,?,?,?,?,?)`,
        supportsItemUpdatedBy
          ? [
              this.tenantId,
              returnId,
              item.sku_id,
              qty.toString(),
              item.purchase_unit ?? 'pcs',
              price.toString(),
              '质检不合格',
              this.userId,
              this.userId,
            ]
          : [
              this.tenantId,
              returnId,
              item.sku_id,
              qty.toString(),
              item.purchase_unit ?? 'pcs',
              price.toString(),
              '质检不合格',
              this.userId,
            ],
      );

      // 更新 purchase_order_items.qty_rejected
      if (item.po_item_id) {
        await manager.query(
          `UPDATE purchase_order_items
           SET qty_rejected = COALESCE(qty_rejected, 0) + ?,
               updated_by = ?
           WHERE id = ? AND tenant_id = ?`,
          [qty.toString(), this.userId, item.po_item_id, this.tenantId],
        );
      }
    }

    // 标记质检单的 return_triggered = 1
    await manager.query(
      `UPDATE incoming_inspection_records
       SET return_triggered = 1, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [this.userId, inspectionId, this.tenantId],
    );

    return { id: returnId, returnNo };
  }

  // ── 确认退货单 ────────────────────────────────────────────────
  async confirm(id: number): Promise<void> {
    const record = await this.findAndValidate(id, 'draft');

    await AppDataSource.query(
      `UPDATE return_orders
       SET status = 'confirmed',
           confirmed_at = NOW(),
           updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [this.userId, record.id, this.tenantId],
    );
  }

  // ── 标记已发出（ship）────────────────────────────────────────
  async ship(id: number, params?: { trackingNo?: string; notes?: string }): Promise<void> {
    const affectedSkuIds: number[] = [];

    await AppDataSource.transaction(async (manager) => {
      const [record] = await manager.query<Array<{
        id: number;
        status: string;
        notes: string | null;
        return_type: string;
        source_inspection_id: number | null;
        return_no: string;
      }>>(
        `SELECT id, status, notes, return_type, source_inspection_id, return_no
         FROM return_orders
         WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [id, this.tenantId],
      );

      if (!record) {
        throw AppError.notFound('退货单不存在', ResponseCode.NOT_FOUND);
      }

      if (record.status !== 'confirmed') {
        throw AppError.conflict(
          `退货单当前状态为 ${record.status}，不允许此操作（须为 confirmed）`,
        );
      }

      const mergedNotes = this.buildMergedNotes(record.notes, [
        params?.trackingNo ? `物流单号：${params.trackingNo}` : null,
        params?.notes ? `发出备注：${params.notes}` : null,
      ]);

      const shouldDeductInventory = this.shouldDeductInventoryOnShip(record);
      const inventoryDeltas = shouldDeductInventory
        ? await this.collectShipInventoryDeltas(manager, record.id)
        : [];

      if (inventoryDeltas.length > 0) {
        const inventoryRows = await manager.query<Array<{
          sku_id: number;
          qty_on_hand: string;
          qty_reserved: string;
        }>>(
          `SELECT sku_id, qty_on_hand, qty_reserved
           FROM inventory
           WHERE tenant_id = ?
             AND sku_id IN (${inventoryDeltas.map(() => '?').join(', ')})
           FOR UPDATE`,
          [this.tenantId, ...inventoryDeltas.map((item) => item.skuId)],
        );

        const inventoryMap = new Map(
          inventoryRows.map((row) => [
            Number(row.sku_id),
            {
              qtyOnHand: new Decimal(row.qty_on_hand),
              qtyReserved: new Decimal(row.qty_reserved),
            },
          ]),
        );

        for (const item of inventoryDeltas) {
          const inventoryRow = inventoryMap.get(item.skuId);
          const availableQty = inventoryRow
            ? inventoryRow.qtyOnHand.minus(inventoryRow.qtyReserved)
            : new Decimal(0);
          if (availableQty.lt(item.qtyStock)) {
            throw AppError.conflict(
              `SKU#${item.skuId} 库存不足，当前可用 ${availableQty.toFixed(4)} ${item.stockUnit}，无法发出退货`,
            );
          }
        }
      }

      await manager.query(
        `UPDATE return_orders
         SET status = 'shipped',
             shipped_at = NOW(),
             notes = ?,
             updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [mergedNotes, this.userId, record.id, this.tenantId],
      );

      for (const item of inventoryDeltas) {
        const txNo = await generateNo('transaction', this.tenantId);
        await manager.query(
          `INSERT INTO inventory_transactions
             (tenant_id, transaction_no, sku_id, transaction_type, direction,
              qty_input, input_unit, qty_stock_unit, stock_unit,
              reference_type, reference_id, reference_no, notes, created_by)
           VALUES (?, ?, ?, 'PURCHASE_RETURN_OUT', 'OUT', ?, ?, ?, ?, 'return_order', ?, ?, ?, ?)`,
          [
            this.tenantId,
            txNo,
            item.skuId,
            item.qtyStock.toFixed(4),
            item.stockUnit,
            item.qtyStock.toFixed(4),
            item.stockUnit,
            record.id,
            record.return_no,
            `采购退货 ${record.return_no} 发货出库`,
            this.userId,
          ],
        );

        await manager.query(
          `UPDATE inventory
           SET qty_on_hand = qty_on_hand - ?,
               last_out_at = NOW()
           WHERE tenant_id = ? AND sku_id = ?`,
          [item.qtyStock.toFixed(4), this.tenantId, item.skuId],
        );

        await this.syncDailySnapshot(manager, item.skuId);
        affectedSkuIds.push(item.skuId);
      }
    });

    if (!affectedSkuIds.length) {
      return;
    }

    await Promise.all(
      affectedSkuIds.map((skuId) =>
        getRedisClient().del(RedisKeys.inventorySnapshot(this.tenantId, skuId)).catch(() => {}),
      ),
    );
  }

  // ── 标记完成（complete）──────────────────────────────────────
  async complete(id: number, params?: { notes?: string }): Promise<void> {
    // Fetch full record so we have source_po_id available after validation.
    const [record] = await AppDataSource.query(
      `SELECT id, status, source_po_id, notes FROM return_orders
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );

    if (!record) {
      throw AppError.notFound('退货单不存在', ResponseCode.NOT_FOUND);
    }

    if (record.status !== 'shipped') {
      throw AppError.conflict(
        `退货单当前状态为 ${record.status}，不允许此操作（须为 shipped）`,
      );
    }

    await AppDataSource.transaction(async (manager) => {
      const mergedNotes = this.buildMergedNotes(record.notes, [
        params?.notes ? `完成备注：${params.notes}` : null,
      ]);
      await manager.query(
        `UPDATE return_orders
         SET status = 'completed',
             completed_at = NOW(),
             notes = ?,
             updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [mergedNotes, this.userId, record.id, this.tenantId],
      );

      if (record.source_po_id) {
        await recalculatePurchaseOrderStatus({
          manager,
          tenantId: this.tenantId,
          userId: this.userId,
          poId: record.source_po_id,
        });
      }
    });
  }

  // ── 内部工具：查询并校验状态 ─────────────────────────────────
  private async findAndValidate(
    id: number,
    requiredStatus: string,
    includeNotes = false,
  ): Promise<{ id: number; status: string; notes?: string | null }> {
    const [record] = await AppDataSource.query(
      `SELECT id, status${includeNotes ? ', notes' : ''}
       FROM return_orders
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );

    if (!record) {
      throw AppError.notFound('退货单不存在', ResponseCode.NOT_FOUND);
    }

    if (record.status !== requiredStatus) {
      throw AppError.conflict(
        `退货单当前状态为 ${record.status}，不允许此操作（须为 ${requiredStatus}）`,
      );
    }

    return record;
  }
}
