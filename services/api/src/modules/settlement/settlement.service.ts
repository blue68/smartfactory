import { z } from 'zod';
import { AppDataSource } from '../../config/database';
import { AppError } from '../../shared/AppError';
import { buildPaginated, PaginatedData, ResponseCode } from '../../shared/ApiResponse';
import { TenantContext } from '../../shared/BaseRepository';
import { generateNo } from '../../shared/generateNo';

// ─── 校验 Schema ──────────────────────────────────────────────────────────────

export const CreateSettlementSchema = z.object({
  orderId: z.number().int().positive('订单ID必须为正整数'),
  notes:   z.string().max(1000).optional(),
});

export const ListSettlementSchema = z.object({
  page:       z.coerce.number().int().min(1).default(1),
  pageSize:   z.coerce.number().int().min(1).max(100).default(20),
  status:     z.enum(['draft', 'confirmed', 'paid', 'cancelled']).optional(),
  customerId: z.coerce.number().int().positive().optional(),
  keyword:    z.string().trim().max(100).optional(),
  overdueOnly: z.preprocess(
    (value) => value === true || value === 'true',
    z.boolean().default(false),
  ),
});

export const ReceivableQuerySchema = z.object({
  groupBy: z.enum(['customer', 'month', 'aging']).default('customer'),
});

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

export type SettlementStatus = 'draft' | 'confirmed' | 'paid' | 'cancelled';

export interface Settlement {
  id: number;
  settlementNo: string;
  customerId: number;
  customerName: string;
  orderId: number;
  orderNo: string;
  totalAmount: string;
  status: SettlementStatus;
  dueDate: string | null;
  confirmedBy: number | null;
  confirmedAt: string | null;
  paidAt: string | null;
  notes: string | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReceivableByCustomer {
  customerId: number;
  customerName: string;
  totalAmount: string;
  pendingCount: number;
}

export interface ReceivableByMonth {
  month: string;
  totalAmount: string;
  count: number;
}

export interface ReceivableByAging {
  bucket: 'current' | '1_30' | '31_60' | '61_90' | '90_plus';
  label: string;
  totalAmount: string;
  count: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class SettlementService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId   = ctx.userId;
  }

  // ── 从已交付订单创建结算单 ──────────────────────────────────────────────────

  async createSettlement(params: z.infer<typeof CreateSettlementSchema>): Promise<Settlement> {
    const newId = await AppDataSource.transaction(async (manager) => {
      const [orderRow] = await manager.query(
        `SELECT id, order_no, customer_id, total_amount, status
         FROM sales_orders
         WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [params.orderId, this.tenantId],
      );
      if (!orderRow) {
        throw AppError.notFound('销售订单不存在');
      }
      if (!['shipped', 'completed'].includes(String(orderRow.status))) {
        throw AppError.badRequest('只能为已发货或已完成的订单创建结算单');
      }

      const [existing] = await manager.query(
        `SELECT id FROM settlements
         WHERE tenant_id = ? AND order_id = ? AND status != 'cancelled' LIMIT 1`,
        [this.tenantId, params.orderId],
      );
      if (existing) {
        throw AppError.conflict('该订单已存在有效结算单，请勿重复创建');
      }

      const settlementNo = await generateNo('settlement', this.tenantId);
      const insertResult = await manager.query(
        `INSERT INTO settlements
           (tenant_id, settlement_no, customer_id, order_id, total_amount, status,
            notes, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
        [
          this.tenantId,
          settlementNo,
          orderRow.customer_id,
          params.orderId,
          orderRow.total_amount,
          params.notes ?? null,
          this.userId,
          this.userId,
        ],
      );
      return Number((insertResult as { insertId: number }).insertId);
    });

    return this.getSettlementById(newId);
  }

  // ── 结算单列表（分页 + 状态筛选）────────────────────────────────────────────

  async listSettlements(
    params: z.infer<typeof ListSettlementSchema>,
  ): Promise<PaginatedData<Settlement>> {
    const { page, pageSize, status, customerId } = params;
    const offset = (page - 1) * pageSize;
    const { where, args } = this.buildListWhere(params);

    const [[{ total }], rows] = await Promise.all([
      AppDataSource.query(
        `SELECT COUNT(*) AS total
         FROM settlements s
         INNER JOIN customers c  ON c.id = s.customer_id AND c.tenant_id = s.tenant_id
         INNER JOIN sales_orders so ON so.id = s.order_id AND so.tenant_id = s.tenant_id
         WHERE ${where}`,
        args,
      ) as Promise<[{ total: number }]>,
      AppDataSource.query(
        `SELECT s.*, c.name AS customer_name, so.order_no
         FROM settlements s
         INNER JOIN customers c  ON c.id = s.customer_id AND c.tenant_id = s.tenant_id
         INNER JOIN sales_orders so ON so.id = s.order_id AND so.tenant_id = s.tenant_id
         WHERE ${where}
         ORDER BY s.created_at DESC
         LIMIT ? OFFSET ?`,
        [...args, pageSize, offset],
      ),
    ]);

    return buildPaginated(
      (rows as any[]).map(this.mapSettlement),
      Number(total),
      page,
      pageSize,
    );
  }

  async listSettlementExportRows(
    params: z.infer<typeof ListSettlementSchema>,
  ): Promise<Settlement[]> {
    const { where, args } = this.buildListWhere(params);
    const rows = await AppDataSource.query(
      `SELECT s.*, c.name AS customer_name, so.order_no
       FROM settlements s
       INNER JOIN customers c  ON c.id = s.customer_id AND c.tenant_id = s.tenant_id
       INNER JOIN sales_orders so ON so.id = s.order_id AND so.tenant_id = s.tenant_id
       WHERE ${where}
       ORDER BY s.created_at DESC`,
      args,
    );

    return (rows as any[]).map(this.mapSettlement);
  }

  // ── 结算单详情 ──────────────────────────────────────────────────────────────

  async getDetail(id: number): Promise<Settlement> {
    const [row] = await AppDataSource.query(
      `SELECT s.*, c.name AS customer_name, so.order_no
       FROM settlements s
       INNER JOIN customers c   ON c.id = s.customer_id AND c.tenant_id = s.tenant_id
       INNER JOIN sales_orders so ON so.id = s.order_id AND so.tenant_id = s.tenant_id
       WHERE s.id = ? AND s.tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );
    if (!row) throw AppError.notFound('结算单不存在');
    return this.mapSettlement(row);
  }

  // ── 确认结算（仅 boss）──────────────────────────────────────────────────────

  async confirmSettlement(id: number): Promise<Settlement> {
    await AppDataSource.transaction(async (manager) => {
      const [settlement] = await manager.query<Array<{ id: number; status: SettlementStatus }>>(
        `SELECT id, status
         FROM settlements
         WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [id, this.tenantId],
      );
      if (!settlement) throw AppError.notFound('结算单不存在');
      if (settlement.status !== 'draft') {
        throw AppError.badRequest(`当前状态为 ${settlement.status}，无法确认`);
      }

      await manager.query(
        `UPDATE settlements
         SET status       = 'confirmed',
             confirmed_by = ?,
             confirmed_at = NOW(3),
             updated_by   = ?,
             updated_at   = NOW(3)
         WHERE id = ? AND tenant_id = ?`,
        [this.userId, this.userId, id, this.tenantId],
      );
    });

    return this.getSettlementById(id);
  }

  // ── 标记已付款（仅 boss）────────────────────────────────────────────────────

  async paySettlement(id: number): Promise<Settlement> {
    await AppDataSource.transaction(async (manager) => {
      const [settlement] = await manager.query<Array<{ id: number; status: SettlementStatus }>>(
        `SELECT id, status
         FROM settlements
         WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [id, this.tenantId],
      );
      if (!settlement) throw AppError.notFound('结算单不存在');
      if (settlement.status !== 'confirmed') {
        throw AppError.badRequest(`当前状态为 ${settlement.status}，只有已确认的结算单才能标记付款`);
      }

      await manager.query(
        `UPDATE settlements
         SET status     = 'paid',
             paid_at    = NOW(3),
             updated_by = ?,
             updated_at = NOW(3)
         WHERE id = ? AND tenant_id = ?`,
        [this.userId, id, this.tenantId],
      );
    });

    return this.getSettlementById(id);
  }

  // ── 取消结算单（boss / supervisor）──────────────────────────────────────────

  async cancelSettlement(id: number): Promise<Settlement> {
    await AppDataSource.transaction(async (manager) => {
      const [settlement] = await manager.query<Array<{ id: number; status: SettlementStatus }>>(
        `SELECT id, status
         FROM settlements
         WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [id, this.tenantId],
      );
      if (!settlement) throw AppError.notFound('结算单不存在');
      if (settlement.status === 'paid') {
        throw AppError.badRequest('已付款的结算单无法取消');
      }
      if (settlement.status === 'cancelled') {
        throw AppError.badRequest('结算单已处于取消状态');
      }

      await manager.query(
        `UPDATE settlements
         SET status     = 'cancelled',
             updated_by = ?,
             updated_at = NOW(3)
         WHERE id = ? AND tenant_id = ?`,
        [this.userId, id, this.tenantId],
      );
    });

    return this.getSettlementById(id);
  }

  // ── 应收账款汇总 ────────────────────────────────────────────────────────────

  async getReceivable(
    groupBy: 'customer' | 'month' | 'aging',
  ): Promise<{
    groupBy: string;
    data: ReceivableByCustomer[] | ReceivableByMonth[] | ReceivableByAging[];
    overdueAmount?: string;
    overdueCount?: number;
  }> {
    if (groupBy === 'customer') {
      const rows: unknown[] = await AppDataSource.query(
        `SELECT s.customer_id,
                c.name                AS customer_name,
                SUM(s.total_amount)   AS total_amount,
                COUNT(*)              AS pending_count
         FROM settlements s
         INNER JOIN customers c ON c.id = s.customer_id
         WHERE s.tenant_id = ? AND s.status IN ('draft', 'confirmed')
         GROUP BY s.customer_id, c.name
         ORDER BY total_amount DESC`,
        [this.tenantId],
      );

      const data: ReceivableByCustomer[] = (rows as any[]).map((r) => ({
        customerId:   Number(r['customer_id']),
        customerName: String(r['customer_name']),
        totalAmount:  Number(r['total_amount']).toFixed(2),
        pendingCount: Number(r['pending_count']),
      }));

      return { groupBy: 'customer', data };
    }

    if (groupBy === 'aging') {
      const rows: unknown[] = await AppDataSource.query(
        `SELECT CASE
                  WHEN s.due_date IS NULL OR DATE(s.due_date) >= CURDATE() THEN 'current'
                  WHEN DATEDIFF(CURDATE(), DATE(s.due_date)) BETWEEN 1 AND 30 THEN '1_30'
                  WHEN DATEDIFF(CURDATE(), DATE(s.due_date)) BETWEEN 31 AND 60 THEN '31_60'
                  WHEN DATEDIFF(CURDATE(), DATE(s.due_date)) BETWEEN 61 AND 90 THEN '61_90'
                  ELSE '90_plus'
                END AS bucket,
                SUM(s.total_amount) AS total_amount,
                COUNT(*) AS cnt
         FROM settlements s
         WHERE s.tenant_id = ? AND s.status IN ('draft', 'confirmed')
         GROUP BY bucket`,
        [this.tenantId],
      );

      const bucketOrder: Array<ReceivableByAging['bucket']> = ['current', '1_30', '31_60', '61_90', '90_plus'];
      const bucketLabels: Record<ReceivableByAging['bucket'], string> = {
        current: '未逾期',
        '1_30': '逾期 1-30 天',
        '31_60': '逾期 31-60 天',
        '61_90': '逾期 61-90 天',
        '90_plus': '逾期 90 天以上',
      };
      const rowMap = new Map(
        (rows as any[]).map((row) => [String(row['bucket']), row]),
      );
      const data: ReceivableByAging[] = bucketOrder.map((bucket) => {
        const row = rowMap.get(bucket);
        return {
          bucket,
          label: bucketLabels[bucket],
          totalAmount: Number(row?.['total_amount'] ?? 0).toFixed(2),
          count: Number(row?.['cnt'] ?? 0),
        };
      });
      const overdueBuckets = data.filter((item) => item.bucket !== 'current');
      const overdueAmount = overdueBuckets
        .reduce((sum, item) => sum + Number(item.totalAmount), 0)
        .toFixed(2);
      const overdueCount = overdueBuckets
        .reduce((sum, item) => sum + item.count, 0);

      return { groupBy: 'aging', data, overdueAmount, overdueCount };
    }

    // 按月汇总
    const rows: unknown[] = await AppDataSource.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
              SUM(total_amount) AS total_amount,
              COUNT(*)          AS cnt
       FROM settlements
       WHERE tenant_id = ? AND status IN ('draft', 'confirmed')
       GROUP BY month
       ORDER BY month DESC
       LIMIT 12`,
      [this.tenantId],
    );

    const data: ReceivableByMonth[] = (rows as any[]).map((r) => ({
      month:       String(r['month']),
      totalAmount: Number(r['total_amount']).toFixed(2),
      count:       Number(r['cnt']),
    }));

    return { groupBy: 'month', data };
  }

  // ── 私有辅助方法 ─────────────────────────────────────────────────────────────

  private async getSettlementById(id: number): Promise<Settlement> {
    const [row] = await AppDataSource.query(
      `SELECT s.*, c.name AS customer_name, so.order_no
       FROM settlements s
       INNER JOIN customers c   ON c.id = s.customer_id AND c.tenant_id = s.tenant_id
       INNER JOIN sales_orders so ON so.id = s.order_id AND so.tenant_id = s.tenant_id
       WHERE s.id = ? AND s.tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );
    if (!row) throw AppError.notFound('结算单不存在');
    return this.mapSettlement(row);
  }

  private mapSettlement(r: Record<string, unknown>): Settlement {
    return {
      id:            Number(r['id']),
      settlementNo:  String(r['settlement_no']),
      customerId:    Number(r['customer_id']),
      customerName:  String(r['customer_name'] ?? ''),
      orderId:       Number(r['order_id']),
      orderNo:       String(r['order_no'] ?? ''),
      totalAmount:   Number(r['total_amount']).toFixed(2),
      status:        r['status'] as SettlementStatus,
      dueDate:       r['due_date'] != null ? String(r['due_date']).slice(0, 10) : null,
      confirmedBy:   r['confirmed_by'] != null ? Number(r['confirmed_by']) : null,
      confirmedAt:   r['confirmed_at'] != null ? String(r['confirmed_at']) : null,
      paidAt:        r['paid_at'] != null ? String(r['paid_at']) : null,
      notes:         r['notes'] != null ? String(r['notes']) : null,
      createdBy:     Number(r['created_by']),
      createdAt:     String(r['created_at']),
      updatedAt:     String(r['updated_at']),
    };
  }

  private buildListWhere(params: z.infer<typeof ListSettlementSchema>): { where: string; args: unknown[] } {
    const { status, customerId, keyword, overdueOnly } = params;
    const whereClauses = ['s.tenant_id = ?'];
    const args: unknown[] = [this.tenantId];

    if (status) {
      whereClauses.push('s.status = ?');
      args.push(status);
    }
    if (customerId) {
      whereClauses.push('s.customer_id = ?');
      args.push(customerId);
    }
    if (keyword) {
      whereClauses.push('(s.settlement_no LIKE ? OR c.name LIKE ? OR so.order_no LIKE ?)');
      const likeKeyword = `%${keyword}%`;
      args.push(likeKeyword, likeKeyword, likeKeyword);
    }
    if (overdueOnly) {
      whereClauses.push("s.status IN ('draft', 'confirmed')");
      whereClauses.push('s.due_date IS NOT NULL');
      whereClauses.push('DATE(s.due_date) < CURDATE()');
    }

    return { where: whereClauses.join(' AND '), args };
  }
}
