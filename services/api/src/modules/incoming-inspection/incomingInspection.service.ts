import { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import Decimal from 'decimal.js';

// ─── 编号生成（本地实现，格式 IQC-YYYYMMDD-NNNN）────────────────
function generateInspectionNo(): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
  return `IQC-${date}-${rand}`;
}

function generateReceiptNo(): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
  return `RC-${date}-${rand}`;
}

// ─── 参数类型定义 ─────────────────────────────────────────────────

export interface ListInspectionFilter {
  page: number;
  pageSize: number;
  status?: string;
  poId?: number;
  dateFrom?: string;
  dateTo?: string;
  result?: string;
}

export interface CreateInspectionParams {
  poId: number;
  deliveryNoteId: number;
  inspectionDate: string;
  notes?: string;
}

export interface UpdateInspectionItemInput {
  id: number;
  qtysampled: string;
  qtyPassed: string;
  qtyFailed: string;
  result: 'pass' | 'fail' | 'conditional_pass';
  defectTypes?: unknown[];
  defectImages?: string[];
  disposition: 'accept' | 'return' | 'rework' | 'scrap';
  notes?: string;
}

export interface SubmitInspectionParams {
  overallResult: 'pass' | 'fail' | 'conditional_pass';
  notes?: string;
}

// ─── Service ─────────────────────────────────────────────────────

export class IncomingInspectionService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  // ── 分页列表 ─────────────────────────────────────────────────
  async list(filter: ListInspectionFilter) {
    const conds = ['r.tenant_id = ?'];
    const params: unknown[] = [this.tenantId];

    if (filter.status) {
      conds.push('r.status = ?');
      params.push(filter.status);
    }
    if (filter.poId) {
      conds.push('r.po_id = ?');
      params.push(filter.poId);
    }
    if (filter.dateFrom) {
      conds.push('r.inspection_date >= ?');
      params.push(filter.dateFrom);
    }
    if (filter.dateTo) {
      conds.push('r.inspection_date <= ?');
      params.push(filter.dateTo);
    }
    if (filter.result) {
      conds.push('r.overall_result = ?');
      params.push(filter.result);
    }

    const where = conds.join(' AND ');
    const offset = (filter.page - 1) * filter.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query(
        `SELECT r.*,
                po.po_no AS poNo,
                sup.name AS supplierName,
                dn.delivery_no AS deliveryNo,
                u.username AS inspectorName
         FROM incoming_inspection_records r
         LEFT JOIN purchase_orders po ON po.id = r.po_id
         LEFT JOIN suppliers sup ON sup.id = po.supplier_id
         LEFT JOIN delivery_notes dn ON dn.id = r.delivery_note_id
         LEFT JOIN users u ON u.id = r.inspector_id
         WHERE ${where}
         ORDER BY r.id DESC
         LIMIT ? OFFSET ?`,
        [...params, filter.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM incoming_inspection_records r WHERE ${where}`,
        params,
      ),
    ]);

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  // ── 详情（含 items）──────────────────────────────────────────
  async getById(id: number) {
    const [record] = await AppDataSource.query(
      `SELECT r.*,
              po.po_no AS poNo,
              sup.name AS supplierName,
              dn.delivery_no AS deliveryNo
       FROM incoming_inspection_records r
       LEFT JOIN purchase_orders po ON po.id = r.po_id
       LEFT JOIN suppliers sup ON sup.id = po.supplier_id
       LEFT JOIN delivery_notes dn ON dn.id = r.delivery_note_id
       WHERE r.id = ? AND r.tenant_id = ?
       LIMIT 1`,
      [id, this.tenantId],
    );

    if (!record) {
      throw AppError.notFound('质检单不存在', ResponseCode.NOT_FOUND);
    }

    const items = await AppDataSource.query(
      `SELECT i.*,
              s.sku_code AS skuCode,
              s.sku_name AS skuName,
              s.stock_unit AS stockUnit
       FROM incoming_inspection_items i
       LEFT JOIN skus s ON s.id = i.sku_id
       WHERE i.inspection_id = ? AND i.tenant_id = ?
       ORDER BY i.id ASC`,
      [id, this.tenantId],
    );

    return { ...record, items };
  }

  // ── 创建质检单，从送货单带入明细 ───────────────────────────────
  async create(params: CreateInspectionParams): Promise<{ id: number; inspectionNo: string }> {
    // 验证送货单存在且属于该租户
    const [dn] = await AppDataSource.query(
      `SELECT dn.id, dn.po_id, dn.status
       FROM delivery_notes dn
       WHERE dn.id = ? AND dn.tenant_id = ?
       LIMIT 1`,
      [params.deliveryNoteId, this.tenantId],
    );
    if (!dn) throw AppError.notFound('送货单不存在', ResponseCode.NOT_FOUND);
    if (dn.po_id !== params.poId) {
      throw AppError.badRequest('送货单不属于该采购订单');
    }

    // 检查是否已有质检单
    const [existingInspection] = await AppDataSource.query(
      `SELECT id FROM incoming_inspection_records
       WHERE delivery_note_id = ? AND tenant_id = ?
       LIMIT 1`,
      [params.deliveryNoteId, this.tenantId],
    );
    if (existingInspection) {
      throw AppError.conflict('该送货单已存在质检单');
    }

    // 读取送货单明细
    const dnItems = await AppDataSource.query(
      `SELECT dni.sku_id, dni.qty_delivered, dni.purchase_unit, dni.unit_price, poi.id AS po_item_id
       FROM delivery_note_items dni
       LEFT JOIN purchase_order_items poi
         ON poi.sku_id = dni.sku_id AND poi.po_id = ? AND poi.tenant_id = ?
       WHERE dni.delivery_note_id = ? AND dni.tenant_id = ?`,
      [params.poId, this.tenantId, params.deliveryNoteId, this.tenantId],
    );

    if (!dnItems.length) {
      throw AppError.badRequest('送货单无明细');
    }

    return AppDataSource.transaction(async (manager) => {
      const inspectionNo = generateInspectionNo();

      const result = await manager.query(
        `INSERT INTO incoming_inspection_records
           (tenant_id, inspection_no, po_id, delivery_note_id, inspector_id,
            inspection_date, status, overall_result, receipt_triggered, return_triggered,
            notes, created_by, updated_by)
         VALUES (?,?,?,?,?,?,'draft',NULL,0,0,?,?,?)`,
        [
          this.tenantId,
          inspectionNo,
          params.poId,
          params.deliveryNoteId,
          this.userId,
          params.inspectionDate,
          params.notes ?? null,
          this.userId,
          this.userId,
        ],
      );
      const inspectionId = Number(result.insertId);

      // 从送货单明细生成质检明细
      for (const item of dnItems) {
        await manager.query(
          `INSERT INTO incoming_inspection_items
             (tenant_id, inspection_id, sku_id, po_item_id, qty_delivered,
              qty_sampled, qty_passed, qty_failed, result,
              defect_types, defect_images, disposition, notes, created_by, updated_by)
           VALUES (?,?,?,?,?,0,0,0,NULL,'[]','[]','accept',NULL,?,?)`,
          [
            this.tenantId,
            inspectionId,
            item.sku_id,
            item.po_item_id ?? null,
            item.qty_delivered,
            this.userId,
            this.userId,
          ],
        );
      }

      // 关联送货单的 inspection_id
      await manager.query(
        `UPDATE delivery_notes SET inspection_id = ? WHERE id = ? AND tenant_id = ?`,
        [inspectionId, params.deliveryNoteId, this.tenantId],
      );

      return { id: inspectionId, inspectionNo };
    });
  }

  // ── 更新质检明细（逐行录入结果）────────────────────────────────
  async updateItems(id: number, items: UpdateInspectionItemInput[]): Promise<void> {
    const [record] = await AppDataSource.query(
      `SELECT id, status FROM incoming_inspection_records
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );
    if (!record) throw AppError.notFound('质检单不存在', ResponseCode.NOT_FOUND);
    if (record.status === 'passed' || record.status === 'failed' || record.status === 'partially_passed') {
      throw AppError.conflict('质检单已提交，无法修改明细');
    }

    await AppDataSource.transaction(async (manager) => {
      // 更新质检单状态为 in_progress
      await manager.query(
        `UPDATE incoming_inspection_records
         SET status = 'in_progress', updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [this.userId, id, this.tenantId],
      );

      for (const item of items) {
        // BUG-S3-001: 校验 qty_passed + qty_failed <= qty_delivered
        const [dbItem] = await manager.query(
          `SELECT qty_delivered FROM incoming_inspection_items
           WHERE id = ? AND inspection_id = ? AND tenant_id = ? LIMIT 1`,
          [item.id, id, this.tenantId],
        );
        if (!dbItem) {
          throw AppError.notFound(`质检明细 id=${item.id} 不存在`, ResponseCode.NOT_FOUND);
        }
        const qtyDelivered = new Decimal(dbItem.qty_delivered || '0');
        const qtyPassed = new Decimal(item.qtyPassed || '0');
        const qtyFailed = new Decimal(item.qtyFailed || '0');
        if (qtyPassed.plus(qtyFailed).gt(qtyDelivered)) {
          throw AppError.badRequest(
            `质检明细 id=${item.id} 的合格数量+不合格数量(${qtyPassed.plus(qtyFailed).toString()})超过到货数量(${qtyDelivered.toString()})`,
          );
        }

        await manager.query(
          `UPDATE incoming_inspection_items
           SET qty_sampled = ?,
               qty_passed = ?,
               qty_failed = ?,
               result = ?,
               defect_types = ?,
               defect_images = ?,
               disposition = ?,
               notes = ?,
               updated_by = ?
           WHERE id = ? AND inspection_id = ? AND tenant_id = ?`,
          [
            item.qtysampled,
            item.qtyPassed,
            item.qtyFailed,
            item.result,
            JSON.stringify(item.defectTypes ?? []),
            JSON.stringify(item.defectImages ?? []),
            item.disposition,
            item.notes ?? null,
            this.userId,
            item.id,
            id,
            this.tenantId,
          ],
        );
      }
    });
  }

  // ── 提交质检结论（核心事务逻辑）────────────────────────────────
  async submit(id: number, params: SubmitInspectionParams): Promise<void> {
    // 事务外仅做存在性校验，不读取 receipt_triggered / return_triggered。
    // 幂等位的状态检查必须在事务内通过 FOR UPDATE 行锁读取，
    // 以防止并发请求同时通过检查后重复执行入库（CR-002）。
    const [preCheck] = await AppDataSource.query(
      `SELECT id FROM incoming_inspection_records
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );
    if (!preCheck) throw AppError.notFound('质检单不存在', ResponseCode.NOT_FOUND);

    // 读取所有质检明细（明细数据在事务外读取即可，不涉及幂等控制）
    const items = await AppDataSource.query(
      `SELECT ii.*,
              poi.purchase_unit, poi.unit_price
       FROM incoming_inspection_items ii
       LEFT JOIN purchase_order_items poi ON poi.id = ii.po_item_id
       WHERE ii.inspection_id = ? AND ii.tenant_id = ?`,
      [id, this.tenantId],
    );

    if (!items.length) {
      throw AppError.badRequest('质检单无明细，请先录入质检结果');
    }

    // BUG-S3-002: BD-004 校验 — 不合格品（result=fail）仅允许退货处置
    const invalidDispositionItems = items.filter(
      (i: any) => i.result === 'fail' && i.disposition !== 'return',
    );
    if (invalidDispositionItems.length > 0) {
      throw AppError.badRequest('不合格品仅允许退货处置(BD-004)');
    }

    await AppDataSource.transaction(async (manager) => {
      // 事务内使用 SELECT ... FOR UPDATE 获取行级锁，
      // 保证同一质检单的并发请求串行执行，幂等位检查在锁保护下进行。
      const [record] = await manager.query(
        `SELECT id, status, receipt_triggered, return_triggered, po_id, delivery_note_id
         FROM incoming_inspection_records
         WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [id, this.tenantId],
      );

      if (record.status === 'passed' || record.status === 'failed' || record.status === 'partially_passed') {
        throw AppError.conflict('质检单已完成提交，禁止重复操作');
      }

      // 确定最终状态
      const allPassed = items.every((i: any) => i.result === 'pass');
      const allFailed = items.every((i: any) => i.result === 'fail');
      let finalStatus: string;
      if (allPassed) {
        finalStatus = 'passed';
      } else if (allFailed) {
        finalStatus = 'failed';
      } else {
        finalStatus = 'partially_passed';
      }

      // 更新质检单状态
      await manager.query(
        `UPDATE incoming_inspection_records
         SET status = ?,
             overall_result = ?,
             notes = ?,
             completed_at = NOW(),
             updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [finalStatus, params.overallResult, params.notes ?? null, this.userId, id, this.tenantId],
      );

      // ── 合格品处理：生成入库单 + 库存事务 ─────────────────────
      const passedItems = items.filter(
        (i: any) => new Decimal(i.qty_passed || '0').gt(0),
      );

      if (passedItems.length > 0 && !record.receipt_triggered) {
        await this.handlePassedItems(manager, id, record, passedItems);
      }

      // ── 不合格品处理（BD-004）：disposition=return 自动生成退货单 ───
      const failedForReturn = items.filter(
        (i: any) =>
          new Decimal(i.qty_failed || '0').gt(0) && i.disposition === 'return',
      );

      if (failedForReturn.length > 0 && !record.return_triggered) {
        await this.handleFailedItems(manager, id, record, failedForReturn);
      }
    });
  }

  // 合格品处理：生成 purchase_receipts + inventory_transactions + 更新库存
  private async handlePassedItems(
    manager: EntityManager,
    inspectionId: number,
    record: any,
    passedItems: any[],
  ): Promise<void> {
    const receiptNo = generateReceiptNo();

    // 计算入库总金额
    const totalAmount = passedItems.reduce((sum: Decimal, item: any) => {
      const qty = new Decimal(item.qty_passed || '0');
      const price = new Decimal(item.unit_price || '0');
      return sum.plus(qty.mul(price));
    }, new Decimal(0));

    // 生成 purchase_receipts
    const receiptResult = await manager.query(
      `INSERT INTO purchase_receipts
         (tenant_id, receipt_no, po_id, delivery_note_id, status,
          total_amount, notes, created_by, updated_by)
       VALUES (?,?,?,?,'confirmed',?,?,?,?)`,
      [
        this.tenantId,
        receiptNo,
        record.po_id,
        record.delivery_note_id,
        totalAmount.toFixed(2),
        null,
        this.userId,
        this.userId,
      ],
    );
    const receiptId = Number(receiptResult.insertId);

    // 更新 delivery_notes.receipt_id
    await manager.query(
      `UPDATE delivery_notes SET receipt_id = ? WHERE id = ? AND tenant_id = ?`,
      [receiptId, record.delivery_note_id, this.tenantId],
    );

    for (const item of passedItems) {
      const qtyPassed = new Decimal(item.qty_passed || '0');
      const unitPrice = new Decimal(item.unit_price || '0');

      // 写入 purchase_receipt_items
      await manager.query(
        `INSERT INTO purchase_receipt_items
           (tenant_id, receipt_id, sku_id, qty_received, purchase_unit,
            unit_price, amount, created_by, updated_by)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          this.tenantId,
          receiptId,
          item.sku_id,
          qtyPassed.toString(),
          item.purchase_unit ?? 'pcs',
          unitPrice.toString(),
          qtyPassed.mul(unitPrice).toFixed(2),
          this.userId,
          this.userId,
        ],
      );

      // 写入 inventory_transactions（PURCHASE_IN）
      const txResult = await manager.query(
        `INSERT INTO inventory_transactions
           (tenant_id, sku_id, transaction_type, qty_change, reference_type,
            reference_id, reference_no, notes, created_by)
         VALUES (?,?,'PURCHASE_IN',?,?,?,?,?,?)`,
        [
          this.tenantId,
          item.sku_id,
          qtyPassed.toString(),
          'purchase_receipt',
          receiptId,
          receiptNo,
          `质检入库 IQC#${inspectionId}`,
          this.userId,
        ],
      );
      void txResult;

      // 更新 inventory.qty_on_hand（upsert）
      await manager.query(
        `INSERT INTO inventory (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit, updated_by)
         VALUES (?, ?, ?, 0, 0, ?)
         ON DUPLICATE KEY UPDATE
           qty_on_hand = qty_on_hand + VALUES(qty_on_hand),
           updated_by = VALUES(updated_by)`,
        [this.tenantId, item.sku_id, qtyPassed.toString(), this.userId],
      );

      // 更新 purchase_order_items.qty_received 和 qty_passed
      if (item.po_item_id) {
        await manager.query(
          `UPDATE purchase_order_items
           SET qty_received = qty_received + ?,
               qty_passed = COALESCE(qty_passed, 0) + ?,
               updated_by = ?
           WHERE id = ? AND tenant_id = ?`,
          [
            qtyPassed.toString(),
            qtyPassed.toString(),
            this.userId,
            item.po_item_id,
            this.tenantId,
          ],
        );
      }
    }

    // 标记幂等位
    await manager.query(
      `UPDATE incoming_inspection_records
       SET receipt_triggered = 1, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [this.userId, inspectionId, this.tenantId],
    );
  }

  // 不合格品处理：生成 return_orders + return_order_items
  private async handleFailedItems(
    manager: EntityManager,
    inspectionId: number,
    record: any,
    failedItems: any[],
  ): Promise<void> {
    // 获取供应商 ID
    const [po] = await manager.query(
      `SELECT supplier_id FROM purchase_orders WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [record.po_id, this.tenantId],
    );

    const now = new Date();
    const dateStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('');
    const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    const returnNo = `RTN-${dateStr}-${rand}`;

    const totalQty = failedItems.reduce((sum: Decimal, item: any) => {
      return sum.plus(new Decimal(item.qty_failed || '0'));
    }, new Decimal(0));

    const returnResult = await manager.query(
      `INSERT INTO return_orders
         (tenant_id, return_no, return_type, source_po_id, source_inspection_id,
          supplier_id, status, return_reason, total_qty, notes,
          confirmed_at, created_by, updated_by)
       VALUES (?,?,'purchase_return',?,?,?,'confirmed',?,?,?,NOW(),?,?)`,
      [
        this.tenantId,
        returnNo,
        record.po_id,
        inspectionId,
        po?.supplier_id ?? null,
        '质检不合格退货（BD-004）',
        totalQty.toString(),
        null,
        this.userId,
        this.userId,
      ],
    );
    const returnId = Number(returnResult.insertId);

    for (const item of failedItems) {
      const qtyFailed = new Decimal(item.qty_failed || '0');

      await manager.query(
        `INSERT INTO return_order_items
           (tenant_id, return_id, sku_id, qty_return, purchase_unit,
            unit_price, defect_reason, created_by, updated_by)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          this.tenantId,
          returnId,
          item.sku_id,
          qtyFailed.toString(),
          item.purchase_unit ?? 'pcs',
          item.unit_price ?? '0.00',
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
          [qtyFailed.toString(), this.userId, item.po_item_id, this.tenantId],
        );
      }
    }

    // 标记幂等位
    await manager.query(
      `UPDATE incoming_inspection_records
       SET return_triggered = 1, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [this.userId, inspectionId, this.tenantId],
    );
  }

  // ── 预览入库单 ───────────────────────────────────────────────
  async previewReceipt(id: number) {
    const [record] = await AppDataSource.query(
      `SELECT r.id, r.inspection_no, r.po_id, r.delivery_note_id,
              r.overall_result, r.status,
              po.po_no AS poNo,
              sup.name AS supplierName,
              dn.delivery_no AS deliveryNo
       FROM incoming_inspection_records r
       LEFT JOIN purchase_orders po ON po.id = r.po_id
       LEFT JOIN suppliers sup ON sup.id = po.supplier_id
       LEFT JOIN delivery_notes dn ON dn.id = r.delivery_note_id
       WHERE r.id = ? AND r.tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );
    if (!record) throw AppError.notFound('质检单不存在', ResponseCode.NOT_FOUND);

    const passedItems = await AppDataSource.query(
      `SELECT ii.sku_id,
              s.sku_code AS skuCode,
              s.sku_name AS skuName,
              ii.qty_passed,
              poi.purchase_unit,
              poi.unit_price,
              (CAST(ii.qty_passed AS DECIMAL(14,4)) * CAST(poi.unit_price AS DECIMAL(14,4))) AS amount
       FROM incoming_inspection_items ii
       LEFT JOIN skus s ON s.id = ii.sku_id
       LEFT JOIN purchase_order_items poi ON poi.id = ii.po_item_id
       WHERE ii.inspection_id = ? AND ii.tenant_id = ?
         AND CAST(ii.qty_passed AS DECIMAL(14,4)) > 0`,
      [id, this.tenantId],
    );

    const totalAmount = passedItems.reduce((sum: Decimal, item: any) => {
      return sum.plus(new Decimal(item.amount || '0'));
    }, new Decimal(0));

    return {
      ...record,
      items: passedItems,
      totalAmount: totalAmount.toFixed(2),
      receiptTriggered: Boolean(record.receipt_triggered),
    };
  }
}
