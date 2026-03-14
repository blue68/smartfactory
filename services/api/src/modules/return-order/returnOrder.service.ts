import { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import Decimal from 'decimal.js';
import { generateNo } from '../../shared/generateNo';

// ─── 参数类型定义 ─────────────────────────────────────────────────

export interface ListReturnOrderFilter {
  page: number;
  pageSize: number;
  status?: string;
  returnType?: string;
  supplierId?: number;
  dateFrom?: string;
  dateTo?: string;
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

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
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

    const where = conds.join(' AND ');
    const offset = (filter.page - 1) * filter.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query(
        `SELECT ro.*,
                sup.name AS supplierName,
                po.po_no AS sourcePoNo,
                ir.inspection_no AS sourceInspectionNo
         FROM return_orders ro
         LEFT JOIN suppliers sup ON sup.id = ro.supplier_id
         LEFT JOIN purchase_orders po ON po.id = ro.source_po_id
         LEFT JOIN incoming_inspection_records ir ON ir.id = ro.source_inspection_id
         WHERE ${where}
         ORDER BY ro.id DESC
         LIMIT ? OFFSET ?`,
        [...params, filter.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM return_orders ro WHERE ${where}`,
        params,
      ),
    ]);

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  // ── 详情（含 items）──────────────────────────────────────────
  async getById(id: number) {
    const [record] = await AppDataSource.query(
      `SELECT ro.*,
              sup.name AS supplierName,
              po.po_no AS sourcePoNo,
              ir.inspection_no AS sourceInspectionNo
       FROM return_orders ro
       LEFT JOIN suppliers sup ON sup.id = ro.supplier_id
       LEFT JOIN purchase_orders po ON po.id = ro.source_po_id
       LEFT JOIN incoming_inspection_records ir ON ir.id = ro.source_inspection_id
       WHERE ro.id = ? AND ro.tenant_id = ?
       LIMIT 1`,
      [id, this.tenantId],
    );

    if (!record) {
      throw AppError.notFound('退货单不存在', ResponseCode.NOT_FOUND);
    }

    const items = await AppDataSource.query(
      `SELECT roi.*,
              s.sku_code AS skuCode,
              s.sku_name AS skuName
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
          `INSERT INTO return_order_items
             (tenant_id, return_id, sku_id, qty_return, purchase_unit,
              unit_price, defect_reason, created_by, updated_by)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            this.tenantId,
            returnId,
            item.skuId,
            qty.toString(),
            item.purchaseUnit,
            price.toString(),
            item.defectReason ?? null,
            this.userId,
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

    for (const item of failedItems) {
      const qty = new Decimal(item.qty_failed || '0');
      const price = new Decimal(item.unit_price || '0');

      await manager.query(
        `INSERT INTO return_order_items
           (tenant_id, return_id, sku_id, qty_return, purchase_unit,
            unit_price, defect_reason, created_by, updated_by)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          this.tenantId,
          returnId,
          item.sku_id,
          qty.toString(),
          item.purchase_unit ?? 'pcs',
          price.toString(),
          '质检不合格',
          this.userId,
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
  async ship(id: number): Promise<void> {
    const record = await this.findAndValidate(id, 'confirmed');

    await AppDataSource.query(
      `UPDATE return_orders
       SET status = 'shipped',
           shipped_at = NOW(),
           updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [this.userId, record.id, this.tenantId],
    );
  }

  // ── 标记完成（complete）──────────────────────────────────────
  async complete(id: number): Promise<void> {
    const record = await this.findAndValidate(id, 'shipped');

    await AppDataSource.query(
      `UPDATE return_orders
       SET status = 'completed',
           completed_at = NOW(),
           updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [this.userId, record.id, this.tenantId],
    );
  }

  // ── 内部工具：查询并校验状态 ─────────────────────────────────
  private async findAndValidate(
    id: number,
    requiredStatus: string,
  ): Promise<{ id: number; status: string }> {
    const [record] = await AppDataSource.query(
      `SELECT id, status FROM return_orders
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
