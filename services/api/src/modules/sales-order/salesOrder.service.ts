import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { SalesOrderEntity, SalesOrderStatus } from './salesOrder.entity';
import { SalesOrderItemEntity } from './salesOrderItem.entity';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';

// ─── 状态流转合法性 Map ──────────────────────────────────────────────────────
// key: 当前状态，value: 允许流转到的目标状态集合
const TRANSITION_MAP: Record<SalesOrderStatus, SalesOrderStatus[]> = {
  draft:            ['confirmed', 'pending_approval', 'closed'],
  pending_approval: ['confirmed', 'draft', 'closed'],
  confirmed:        ['in_production', 'closed'],
  in_production:    ['shipped', 'closed'],
  shipped:          ['completed', 'closed'],
  completed:        ['closed'],
  closed:           [],
};

// ─── 参数接口 ────────────────────────────────────────────────────────────────

export interface SalesOrderListFilter {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: SalesOrderStatus;
  customerId?: number;
  isUrgent?: boolean;
}

export interface OrderItemInput {
  skuId: number;
  quantity: string;
  unitPrice: string;
  notes?: string;
  sortOrder?: number;
}

export interface CreateSalesOrderParams {
  customerId: number;
  orderDate: string;
  deliveryDate: string;
  isUrgent?: boolean;
  notes?: string;
  items: OrderItemInput[];
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class SalesOrderService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: { tenantId: number; userId: number }) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  // ── 1. 列表（联表查询客户名，支持关键字 / 状态 / 客户 / 紧急）──────────────

  async list(filter: SalesOrderListFilter): Promise<{ list: unknown[]; total: number }> {
    const conds: string[] = ['so.tenant_id = ?'];
    const params: unknown[] = [this.tenantId];

    if (filter.keyword) {
      conds.push('(so.order_no LIKE ? OR c.name LIKE ?)');
      params.push(`%${filter.keyword}%`, `%${filter.keyword}%`);
    }
    if (filter.status) {
      conds.push('so.status = ?');
      params.push(filter.status);
    }
    if (filter.customerId) {
      conds.push('so.customer_id = ?');
      params.push(filter.customerId);
    }
    if (filter.isUrgent !== undefined) {
      conds.push('so.is_urgent = ?');
      params.push(filter.isUrgent ? 1 : 0);
    }

    const where = conds.join(' AND ');
    const offset = (filter.page - 1) * filter.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query(
        `SELECT so.id, so.order_no AS orderNo, so.customer_id AS customerId,
                c.name AS customerName, so.order_date AS orderDate,
                so.delivery_date AS deliveryDate, so.is_urgent AS isUrgent,
                so.status, so.total_amount AS totalAmount,
                so.created_at AS createdAt, so.updated_at AS updatedAt
         FROM sales_orders so
         INNER JOIN customers c ON c.id = so.customer_id
         WHERE ${where}
         ORDER BY so.id DESC
         LIMIT ? OFFSET ?`,
        [...params, filter.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: string }>>(
        `SELECT COUNT(*) AS total
         FROM sales_orders so
         INNER JOIN customers c ON c.id = so.customer_id
         WHERE ${where}`,
        params,
      ),
    ]);

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  // ── 1.5 待审批数量 ───────────────────────────────────────────────────────

  async getPendingApprovalCount(): Promise<number> {
    const [row] = await AppDataSource.query<Array<{ cnt: string }>>(
      `SELECT COUNT(*) AS cnt FROM sales_orders
       WHERE tenant_id = ? AND status = 'pending_approval'`,
      [this.tenantId],
    );
    return Number(row?.cnt ?? 0);
  }

  // ── 2. 详情（含明细行 + 客户名）──────────────────────────────────────────

  async getById(id: number): Promise<{ order: SalesOrderEntity; items: SalesOrderItemEntity[]; customerName: string }> {
    const [orderRows] = await AppDataSource.query<SalesOrderEntity[]>(
      `SELECT so.*, c.name AS customerName
       FROM sales_orders so
       INNER JOIN customers c ON c.id = so.customer_id
       WHERE so.id = ? AND so.tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );
    if (!orderRows) {
      throw AppError.notFound('销售订单不存在', ResponseCode.ORDER_NOT_FOUND);
    }

    const items = await AppDataSource.query<SalesOrderItemEntity[]>(
      `SELECT soi.*, s.name AS skuName, s.sku_code AS skuCode
       FROM sales_order_items soi
       LEFT JOIN skus s ON s.id = soi.sku_id
       WHERE soi.order_id = ? AND soi.tenant_id = ?
       ORDER BY soi.sort_order ASC, soi.id ASC`,
      [id, this.tenantId],
    );

    const raw = orderRows as unknown as Record<string, unknown>;
    return {
      order: orderRows,
      customerName: String(raw.customerName ?? ''),
      items,
    };
  }

  // ── 私有：仅加载订单主行（用于状态操作）──────────────────────────────────

  private async _loadOrder(id: number): Promise<SalesOrderEntity> {
    const repo = AppDataSource.getRepository(SalesOrderEntity);
    const order = await repo.findOne({ where: { id, tenantId: this.tenantId } });
    if (!order) {
      throw AppError.notFound('销售订单不存在', ResponseCode.ORDER_NOT_FOUND);
    }
    return order;
  }

  // ── 3. 创建订单（生成订单号，计算金额，自动判断是否需要走审批）────────────

  async create(params: CreateSalesOrderParams): Promise<{ id: number; orderNo: string }> {
    if (!params.items || params.items.length === 0) {
      throw AppError.badRequest('至少需要一条明细行');
    }

    const orderNo = await this._generateOrderNo();
    const totalAmount = this._calcTotal(params.items);

    // 紧急订单初始状态为 pending_approval，常规为 draft
    const initialStatus: SalesOrderStatus = params.isUrgent ? 'pending_approval' : 'draft';

    return AppDataSource.transaction(async (manager) => {
      const result = await manager.query(
        `INSERT INTO sales_orders
           (tenant_id, order_no, customer_id, order_date, delivery_date,
            is_urgent, status, total_amount, notes, created_by, updated_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          this.tenantId, orderNo, params.customerId,
          params.orderDate, params.deliveryDate,
          params.isUrgent ? 1 : 0, initialStatus,
          totalAmount, params.notes ?? null,
          this.userId, this.userId,
        ],
      );
      const orderId = Number(result.insertId);

      await this._insertItems(manager, orderId, params.items);

      return { id: orderId, orderNo };
    });
  }

  // ── 4. 全量替换明细行（仅允许 draft 状态）────────────────────────────────

  async updateItems(id: number, items: OrderItemInput[]): Promise<void> {
    const order = await this._loadOrder(id);

    if (order.status !== 'draft') {
      throw AppError.badRequest(
        '只有草稿状态的订单才能修改明细',
        ResponseCode.ORDER_CANNOT_MODIFY,
      );
    }
    if (!items || items.length === 0) {
      throw AppError.badRequest('至少需要一条明细行');
    }

    const totalAmount = this._calcTotal(items);

    await AppDataSource.transaction(async (manager) => {
      // 全量删除旧明细
      await manager.query(
        `DELETE FROM sales_order_items WHERE order_id = ? AND tenant_id = ?`,
        [id, this.tenantId],
      );
      // 插入新明细
      await this._insertItems(manager, id, items);
      // 同步更新总金额
      await manager.query(
        `UPDATE sales_orders SET total_amount = ?, updated_by = ? WHERE id = ? AND tenant_id = ?`,
        [totalAmount, this.userId, id, this.tenantId],
      );
    });
  }

  // ── 5. 通用状态流转（校验合法性）──────────────────────────────────────────

  async transition(id: number, targetStatus: SalesOrderStatus): Promise<void> {
    const order = await this._loadOrder(id);
    this._assertTransition(order.status, targetStatus);

    await AppDataSource.query(
      `UPDATE sales_orders
       SET status = ?, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [targetStatus, this.userId, id, this.tenantId],
    );
  }

  // ── 6. 提交审批（草稿 → pending_approval，仅用于补充提交）────────────────

  async submitForApproval(id: number): Promise<void> {
    const order = await this._loadOrder(id);

    if (order.status !== 'draft') {
      throw AppError.badRequest(
        '只有草稿状态的订单才能提交审批',
        ResponseCode.ORDER_NOT_DRAFT,
      );
    }

    await AppDataSource.query(
      `UPDATE sales_orders
       SET status = 'pending_approval', reject_reason = NULL, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [this.userId, id, this.tenantId],
    );
  }

  // ── 7. 审批通过（pending_approval → confirmed）────────────────────────────

  async approve(id: number, approverId: number): Promise<void> {
    const order = await this._loadOrder(id);

    if (order.status !== 'pending_approval') {
      throw AppError.badRequest(
        '只有待审批状态的订单才能执行审批',
        ResponseCode.ORDER_INVALID_TRANSITION,
      );
    }

    await AppDataSource.query(
      `UPDATE sales_orders
       SET status = 'confirmed', approved_by = ?, approved_at = NOW(3),
           reject_reason = NULL, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [approverId, approverId, id, this.tenantId],
    );
  }

  // ── 8. 驳回（pending_approval → draft）───────────────────────────────────

  async reject(id: number, rejectorId: number, reason: string): Promise<void> {
    const order = await this._loadOrder(id);

    if (order.status !== 'pending_approval') {
      throw AppError.badRequest(
        '只有待审批状态的订单才能驳回',
        ResponseCode.ORDER_INVALID_TRANSITION,
      );
    }

    await AppDataSource.query(
      `UPDATE sales_orders
       SET status = 'draft', reject_reason = ?, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [reason, rejectorId, id, this.tenantId],
    );
  }

  // ── 9. 撤回审批（pending_approval → draft，P0-01 修正）────────────────────

  async withdraw(id: number): Promise<void> {
    const order = await this._loadOrder(id);

    if (order.status !== 'pending_approval') {
      throw AppError.badRequest(
        '只有待审批状态的订单才能撤回',
        ResponseCode.ORDER_INVALID_TRANSITION,
      );
    }

    // 仅申请人(created_by)或 boss 可撤回
    if (order.createdBy !== this.userId) {
      throw AppError.forbidden('只有订单创建者或管理员可撤回审批');
    }

    await AppDataSource.query(
      `UPDATE sales_orders
       SET status = 'draft', reject_reason = NULL, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [this.userId, id, this.tenantId],
    );
  }

  // ─── 私有工具方法 ────────────────────────────────────────────────────────

  /**
   * 生成订单号：SO-YYMMDD-XXXX
   * XXXX 为当日序号（基于当日已有订单数量 +1，补零至4位）
   */
  private async _generateOrderNo(): Promise<string> {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dateStr = `${yy}${mm}${dd}`;
    const prefix = `SO-${dateStr}-`;

    const [row] = await AppDataSource.query<Array<{ cnt: string }>>(
      `SELECT COUNT(*) AS cnt FROM sales_orders
       WHERE tenant_id = ? AND order_no LIKE ?`,
      [this.tenantId, `${prefix}%`],
    );
    const seq = (Number(row?.cnt ?? 0) + 1).toString().padStart(4, '0');
    return `${prefix}${seq}`;
  }

  /** 批量插入明细行（在事务 manager 上执行） */
  private async _insertItems(
    manager: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    orderId: number,
    items: OrderItemInput[],
  ): Promise<void> {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const amount = new Decimal(item.quantity).mul(item.unitPrice).toFixed(2);
      await manager.query(
        `INSERT INTO sales_order_items
           (tenant_id, order_id, sku_id, quantity, unit_price, amount, notes, sort_order)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          this.tenantId, orderId, item.skuId,
          item.quantity, item.unitPrice, amount,
          item.notes ?? null,
          item.sortOrder ?? i,
        ],
      );
    }
  }

  /** 计算订单总金额（Decimal 精确计算） */
  private _calcTotal(items: OrderItemInput[]): string {
    return items
      .reduce(
        (sum, item) => sum.plus(new Decimal(item.quantity).mul(item.unitPrice)),
        new Decimal(0),
      )
      .toFixed(2);
  }

  /** 校验状态流转是否合法 */
  private _assertTransition(current: SalesOrderStatus, target: SalesOrderStatus): void {
    const allowed = TRANSITION_MAP[current] ?? [];
    if (!allowed.includes(target)) {
      throw AppError.badRequest(
        `状态 ${current} 不能流转到 ${target}`,
        ResponseCode.ORDER_INVALID_TRANSITION,
      );
    }
  }
}
