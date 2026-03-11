import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import Decimal from 'decimal.js';

export interface CreatePOParams {
  supplierId: number;
  suggestionId?: number;
  expectedDate?: string;
  notes?: string;
  items: Array<{
    skuId: number;
    qtyOrdered: string;
    purchaseUnit: string;
    unitPrice: string;
  }>;
}

export interface CreateDeliveryNoteParams {
  poId: number;
  deliveryDate: string;
  notes?: string;
  items: Array<{ skuId: number; qtyDelivered: string; purchaseUnit: string; unitPrice: string }>;
}

export class PurchaseService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  async createPO(params: CreatePOParams): Promise<{ id: number; poNo: string }> {
    return AppDataSource.transaction(async (manager) => {
      const poNo = this.generateNo('PO');
      const totalAmount = params.items.reduce(
        (sum, i) => sum.plus(new Decimal(i.qtyOrdered).mul(i.unitPrice)),
        new Decimal(0),
      );

      const result = await manager.query(
        `INSERT INTO purchase_orders
           (tenant_id, po_no, supplier_id, suggestion_id, status, total_amount,
            expected_date, notes, created_by, updated_by)
         VALUES (?,?,?,?,  'draft',?,?,?,?,?)`,
        [
          this.tenantId, poNo, params.supplierId,
          params.suggestionId ?? null, totalAmount.toFixed(2),
          params.expectedDate ?? null, params.notes ?? null,
          this.userId, this.userId,
        ],
      );
      const poId = Number(result.insertId);

      for (const item of params.items) {
        await manager.query(
          `INSERT INTO purchase_order_items
             (tenant_id, po_id, sku_id, qty_ordered, qty_received, purchase_unit,
              unit_price, amount, created_by, updated_by)
           VALUES (?,?,?,?,0,?,?,?,?,?)`,
          [
            this.tenantId, poId, item.skuId, item.qtyOrdered,
            item.purchaseUnit, item.unitPrice,
            new Decimal(item.qtyOrdered).mul(item.unitPrice).toFixed(2),
            this.userId, this.userId,
          ],
        );
      }

      // 更新关联建议状态为 executed
      if (params.suggestionId) {
        await manager.query(
          `UPDATE purchase_suggestions SET status = 'executed', updated_by = ?
           WHERE id = ? AND tenant_id = ?`,
          [this.userId, params.suggestionId, this.tenantId],
        );
      }

      return { id: poId, poNo };
    });
  }

  async listPOs(params: { status?: string; supplierId?: number; page: number; pageSize: number }) {
    const conds = ['po.tenant_id = ?'];
    const p: unknown[] = [this.tenantId];
    if (params.status) { conds.push('po.status = ?'); p.push(params.status); }
    if (params.supplierId) { conds.push('po.supplier_id = ?'); p.push(params.supplierId); }

    const where = conds.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query(
        `SELECT po.*, sup.name AS supplierName
         FROM purchase_orders po
         INNER JOIN suppliers sup ON sup.id = po.supplier_id
         WHERE ${where} ORDER BY po.id DESC LIMIT ? OFFSET ?`,
        [...p, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM purchase_orders po WHERE ${where}`, p,
      ),
    ]);

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  async createDeliveryNote(params: CreateDeliveryNoteParams): Promise<{ id: number; deliveryNo: string }> {
    const [po] = await AppDataSource.query<Array<{ id: number; status: string; tenant_id: number }>>(
      'SELECT id, status, tenant_id FROM purchase_orders WHERE id = ? AND tenant_id = ? LIMIT 1',
      [params.poId, this.tenantId],
    );
    if (!po) throw AppError.notFound('采购订单不存在', ResponseCode.PO_NOT_FOUND);
    if (po.status === 'cancelled') throw AppError.badRequest('已取消的采购订单不能录入送货单');

    return AppDataSource.transaction(async (manager) => {
      const deliveryNo = this.generateNo('DN');
      const [poRow] = await manager.query<Array<{ supplier_id: number }>>(
        'SELECT supplier_id FROM purchase_orders WHERE id = ? LIMIT 1', [params.poId],
      );

      const result = await manager.query(
        `INSERT INTO delivery_notes
           (tenant_id, delivery_no, po_id, supplier_id, delivery_date, status, notes, created_by, updated_by)
         VALUES (?,?,?,?,'pending',?,?,?,?)`,
        [
          this.tenantId, deliveryNo, params.poId, poRow.supplier_id,
          params.deliveryDate, params.notes ?? null, this.userId, this.userId,
        ],
      );
      const dnId = Number(result.insertId);

      for (const item of params.items) {
        await manager.query(
          `INSERT INTO delivery_note_items
             (tenant_id, delivery_note_id, sku_id, qty_delivered, purchase_unit,
              unit_price, amount, created_by, updated_by)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            this.tenantId, dnId, item.skuId, item.qtyDelivered, item.purchaseUnit,
            item.unitPrice,
            new Decimal(item.qtyDelivered).mul(item.unitPrice).toFixed(2),
            this.userId, this.userId,
          ],
        );
      }

      return { id: dnId, deliveryNo };
    });
  }

  private generateNo(prefix: string): string {
    const ts = Date.now();
    const rand = Math.floor(Math.random() * 999).toString().padStart(3, '0');
    return `${prefix}${ts}${rand}`;
  }
}
