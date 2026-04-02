import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { SalesOrderEntity, SalesOrderStatus } from './salesOrder.entity';
import { SalesOrderItemEntity } from './salesOrderItem.entity';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { NotificationService } from '../notification/notification.service';
import { ProductionOrderService } from '../production/production-order.service';
import { SalesService } from '../sales/sales.service';

// ─── 产能检查常量 ─────────────────────────────────────────────────────────────
/** 默认日产能（件/天），当工作站表无数据时降级使用 */
const DEFAULT_MAX_CAPACITY_PER_DAY = 1000;

// ─── 产能检查结果类型 ─────────────────────────────────────────────────────────

export interface ConflictingOrder {
  id: number;
  orderNo: string;
  skuName: string;
  quantity: number;
  deadline: string;
}

export interface CapacityCheckResult {
  available: boolean;
  currentLoad: number;
  maxCapacity: number;
  estimatedCompletionDate: string;
  conflictingOrders: ConflictingOrder[];
}

// ─── 状态流转合法性 Map ──────────────────────────────────────────────────────
// key: 当前状态，value: 允许流转到的目标状态集合
const TRANSITION_MAP: Record<SalesOrderStatus, SalesOrderStatus[]> = {
  draft:            ['confirmed', 'pending_approval', 'closed'],
  pending_approval: ['confirmed', 'draft', 'closed'],
  confirmed:        ['in_production', 'closed'],
  in_production:    ['shipped', 'closed'],
  produced:         ['shipped', 'closed'],
  partial_shipped:  ['shipped', 'closed'],
  shipped:          ['completed', 'closed'],
  completed:        ['closed'],
  closed:           [],
  cancelled:        [],
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
  saveAsDraft?: boolean;
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

  private _productionOrderService(): ProductionOrderService {
    return new ProductionOrderService({ tenantId: this.tenantId, userId: this.userId });
  }

  private _salesFlowService(): SalesService {
    return new SalesService({ tenantId: this.tenantId, userId: this.userId });
  }

  private async _writeAuditLog(
    executor: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    params: {
      action: string;
      targetId: number;
      targetCode: string;
      beforeData?: unknown;
      afterData?: unknown;
    },
  ): Promise<void> {
    try {
      await executor.query(
        `INSERT INTO audit_logs
           (tenant_id, module, action, target_id, target_code, before_data, after_data, operator_id)
         VALUES (?, 'sales_order', ?, ?, ?, ?, ?, ?)`,
        [
          this.tenantId,
          params.action,
          params.targetId,
          params.targetCode,
          params.beforeData ? JSON.stringify(params.beforeData) : null,
          params.afterData ? JSON.stringify(params.afterData) : null,
          this.userId,
        ],
      );
    } catch {
      // 审计日志缺失不应阻断销售主链路
    }
  }

  // ── 1. 列表（联表查询客户名，支持关键字 / 状态 / 客户 / 紧急）──────────────

  async list(filter: SalesOrderListFilter): Promise<{
    list: unknown[];
    total: number;
    statusCounts: Record<string, number>;
  }> {
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
      conds.push("so.order_type = ?");
      params.push(filter.isUrgent ? 'urgent' : 'normal');
    }

    const where = conds.join(' AND ');
    const offset = (filter.page - 1) * filter.pageSize;

    // GAP-R08-04: 全量状态统计不依赖分页，仅以 tenant_id 为条件
    const [list, countRows, statusRows] = await Promise.all([
      AppDataSource.query(
        `SELECT so.id, so.order_no AS orderNo, so.customer_id AS customerId,
                c.name AS customerName, DATE(so.created_at) AS orderDate,
                so.expected_delivery AS deliveryDate, (so.order_type = 'urgent') AS isUrgent,
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
      AppDataSource.query<Array<{ status: string; count: string }>>(
        `SELECT status, COUNT(*) AS count
         FROM sales_orders
         WHERE tenant_id = ?
         GROUP BY status`,
        [this.tenantId],
      ),
    ]);

    // 将状态统计行转换为 { draft: 3, confirmed: 5, ... } 结构
    const statusCounts: Record<string, number> = {};
    for (const row of statusRows) {
      statusCounts[row.status] = Number(row.count);
    }

    return { list, total: Number(countRows[0]?.total ?? 0), statusCounts };
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

  async getById(id: number): Promise<Record<string, unknown>> {
    const [orderRow] = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT so.id, so.tenant_id AS tenantId, so.order_no AS orderNo,
              so.customer_id AS customerId, DATE(so.created_at) AS orderDate,
              so.expected_delivery AS deliveryDate,
              (so.order_type = 'urgent') AS isUrgent,
              so.status, so.total_amount AS totalAmount,
              so.approved_by AS approvedBy, so.approved_at AS approvedAt,
              so.approval_status AS approvalStatus, so.approval_notes AS approvalNotes,
              so.notes, so.created_by AS createdBy, so.updated_by AS updatedBy,
              so.created_at AS createdAt, so.updated_at AS updatedAt,
              COALESCE(c.name, CONCAT('客户#', so.customer_id)) AS customerName,
              approver.real_name AS approvedByName
       FROM sales_orders so
       LEFT JOIN customers c ON c.id = so.customer_id AND c.tenant_id = so.tenant_id
       LEFT JOIN users approver ON approver.id = so.approved_by AND approver.tenant_id = so.tenant_id
       WHERE so.id = ? AND so.tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );
    if (!orderRow) {
      throw AppError.notFound('销售订单不存在', ResponseCode.ORDER_NOT_FOUND);
    }

    const items = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT soi.id, soi.order_id AS orderId, soi.sku_id AS productId,
              COALESCE(s.sku_code, CONCAT('SKU#', soi.sku_id)) AS productCode,
              COALESCE(s.name, CONCAT('SKU#', soi.sku_id)) AS productName, s.spec,
              soi.qty_ordered AS quantity, soi.qty_ordered AS qtyOrdered,
              COALESCE(soi.qty_delivered, 0) AS qtyDelivered, COALESCE(s.stock_unit, '件') AS unit,
              soi.unit_price AS unitPrice, soi.amount, NULL AS notes
       FROM sales_order_items soi
       LEFT JOIN skus s ON s.id = soi.sku_id AND s.tenant_id = soi.tenant_id
       WHERE soi.order_id = ? AND soi.tenant_id = ?
      ORDER BY soi.id ASC`,
      [id, this.tenantId],
    );

    const productionOrders = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT po.id, po.work_order_no AS workOrderNo, po.status,
              po.material_status AS materialStatus, po.created_at AS createdAt,
              po.planned_end AS plannedEnd
       FROM production_orders po
       WHERE po.sales_order_id = ? AND po.tenant_id = ?
       ORDER BY po.id ASC`,
      [id, this.tenantId],
    ).catch(() => []);

    const deliveries = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT sd.id, sd.delivery_no AS deliveryNo, sd.tracking_no AS trackingNo,
              sd.status, sd.shipped_at AS shippedAt, sd.received_at AS receivedAt
       FROM sales_deliveries sd
       WHERE sd.order_id = ? AND sd.tenant_id = ?
       ORDER BY sd.id DESC`,
      [id, this.tenantId],
    ).catch(() => []);

    const auditLogs = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT al.id, al.module, al.action, al.target_id AS targetId, al.target_code AS targetCode,
              al.before_data AS beforeData, al.after_data AS afterData,
              al.operator_id AS operatorId, al.created_at AS createdAt,
              u.real_name AS operatorName
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.operator_id AND u.tenant_id = al.tenant_id
       WHERE al.tenant_id = ? AND al.module = 'sales_order' AND al.target_id = ?
       ORDER BY al.id DESC`,
      [this.tenantId, id],
    ).catch(() => []);

    return {
      ...orderRow,
      items,
      productionOrders,
      deliveries,
      auditLogs,
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

    // 保存草稿时始终为 draft；正式创建时紧急订单进入 pending_approval
    const initialStatus: SalesOrderStatus = params.saveAsDraft
      ? 'draft'
      : params.isUrgent
      ? 'pending_approval'
      : 'draft';

    return AppDataSource.transaction(async (manager) => {
      const result = await manager.query(
        `INSERT INTO sales_orders
           (tenant_id, order_no, customer_id, expected_delivery,
            order_type, status, total_amount, notes,
            sales_person_id, created_by, updated_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          this.tenantId, orderNo, params.customerId,
          params.deliveryDate,
          params.isUrgent ? 'urgent' : 'normal', initialStatus,
          totalAmount, params.notes ?? null,
          this.userId,   // sales_person_id = the authenticated user placing the order
          this.userId, this.userId,
        ],
      );
      const orderId = Number(result.insertId);

      await this._insertItems(manager, orderId, params.items);
      await this._writeAuditLog(manager, {
        action: 'CREATE',
        targetId: orderId,
        targetCode: orderNo,
        afterData: {
          status: initialStatus,
          orderType: params.isUrgent ? 'urgent' : 'normal',
          totalAmount,
          saveAsDraft: Boolean(params.saveAsDraft),
        },
      });

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
       SET status = 'pending_approval', approval_notes = NULL, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [this.userId, id, this.tenantId],
    );
    await this._writeAuditLog(AppDataSource, {
      action: 'SUBMIT_APPROVAL',
      targetId: id,
      targetCode: order.orderNo,
      beforeData: { status: order.status },
      afterData: { status: 'pending_approval' },
    });
  }

  // ── 7. 审批通过（pending_approval → confirmed）────────────────────────────

  async approve(id: number, approverId: number): Promise<void> {
    const order = await this._loadOrder(id);
    let affectedInventorySkuIds: number[] = [];

    if (order.status !== 'pending_approval') {
      throw AppError.badRequest(
        '只有待审批状态的订单才能执行审批',
        ResponseCode.ORDER_INVALID_TRANSITION,
      );
    }

    await AppDataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE sales_orders
         SET status = 'confirmed', approved_by = ?, approved_at = NOW(3),
             approval_notes = NULL, updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [approverId, approverId, id, this.tenantId],
      );

      await this._productionOrderService().createFromSalesOrder(id, manager);
      affectedInventorySkuIds = ProductionOrderService.drainTrackedInventorySnapshotSkuIds(manager);
      await this._writeAuditLog(manager, {
        action: 'APPROVE',
        targetId: id,
        targetCode: order.orderNo,
        beforeData: { status: order.status },
        afterData: { status: 'in_production' },
      });
    });

    await this._productionOrderService().invalidateInventorySnapshotCaches(affectedInventorySkuIds);

    // GAP-R08-25: 通知订单创建者审批已通过
    const notificationService = new NotificationService({ tenantId: this.tenantId, userId: approverId });
    await notificationService.create(
      order.createdBy,
      'approval_result',
      '销售订单审批通过',
      `订单 ${order.orderNo} 已审批通过`,
      'sales_order',
      id,
    );
  }

  // ── 8. 驳回（pending_approval → closed）──────────────────────────────────
  // GAP-R08-14: 驳回后状态改为 closed，不允许再次提交

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
       SET status = 'closed', approval_notes = ?, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [reason, rejectorId, id, this.tenantId],
    );
    await this._writeAuditLog(AppDataSource, {
      action: 'REJECT',
      targetId: id,
      targetCode: order.orderNo,
      beforeData: { status: order.status },
      afterData: { status: 'closed', approvalNotes: reason },
    });

    // GAP-R08-25: 通知订单创建者审批已驳回
    const notificationService = new NotificationService({ tenantId: this.tenantId, userId: rejectorId });
    await notificationService.create(
      order.createdBy,
      'approval_result',
      '销售订单已驳回',
      `订单 ${order.orderNo} 已被驳回，原因：${reason}`,
      'sales_order',
      id,
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
      throw AppError.forbidden('只有订单创建者可撤回审批');
    }

    await AppDataSource.query(
      `UPDATE sales_orders
       SET status = 'draft', approval_notes = NULL, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [this.userId, id, this.tenantId],
    );
    await this._writeAuditLog(AppDataSource, {
      action: 'WITHDRAW',
      targetId: id,
      targetCode: order.orderNo,
      beforeData: { status: order.status },
      afterData: { status: 'draft' },
    });
  }

  // ── 10. 编辑订单（仅 draft 状态）────────────────────────────────────────────

  async updateOrder(id: number, params: Partial<CreateSalesOrderParams>): Promise<{ id: number; orderNo: string }> {
    const order = await this._loadOrder(id);

    if (order.status !== 'draft') {
      throw AppError.badRequest('只有草稿状态的订单才能编辑', ResponseCode.ORDER_NOT_DRAFT);
    }

    await AppDataSource.transaction(async (manager) => {
      const updates: string[] = [];
      const values: unknown[] = [];

      if (params.customerId !== undefined) { updates.push('customer_id = ?'); values.push(params.customerId); }
      if (params.deliveryDate !== undefined) { updates.push('expected_delivery = ?'); values.push(params.deliveryDate); }
      if (params.isUrgent !== undefined)   { updates.push("order_type = ?");   values.push(params.isUrgent ? 'urgent' : 'normal'); }
      if (params.notes !== undefined)      { updates.push('notes = ?');       values.push(params.notes ?? null); }

      if (params.items && params.items.length > 0) {
        const totalAmount = this._calcTotal(params.items);
        updates.push('total_amount = ?');
        values.push(totalAmount);
        await manager.query(`DELETE FROM sales_order_items WHERE order_id = ? AND tenant_id = ?`, [id, this.tenantId]);
        await this._insertItems(manager, id, params.items);
      }

      if (updates.length > 0) {
        updates.push('updated_by = ?');
        values.push(this.userId, id, this.tenantId);
        await manager.query(`UPDATE sales_orders SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`, values);
      }
    });

    return { id, orderNo: order.orderNo };
  }

  // ── 11. 常规订单直接确认（仅 draft，boss 可跳过审批）──────────────────────
  // 注意：pending_approval 应走 approve() 流程

  async confirm(id: number): Promise<void> {
    const order = await this._loadOrder(id);
    let affectedInventorySkuIds: number[] = [];
    if (order.status !== 'draft') {
      throw AppError.badRequest('只有草稿状态的订单才能直接确认（待审批订单请使用审批功能）', ResponseCode.ORDER_INVALID_TRANSITION);
    }
    await AppDataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE sales_orders
         SET status = 'confirmed', approved_by = ?, approved_at = NOW(3), updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [this.userId, this.userId, id, this.tenantId],
      );

      await this._productionOrderService().createFromSalesOrder(id, manager);
      affectedInventorySkuIds = ProductionOrderService.drainTrackedInventorySnapshotSkuIds(manager);
      await this._writeAuditLog(manager, {
        action: 'CONFIRM',
        targetId: id,
        targetCode: order.orderNo,
        beforeData: { status: order.status },
        afterData: { status: 'in_production' },
      });
    });

    await this._productionOrderService().invalidateInventorySnapshotCaches(affectedInventorySkuIds);
  }

  // ── 12. 标记发货 ──────────────────────────────────────────────────────────

  async ship(
    id: number,
    trackingNo?: string,
    shippedItemsInput?: Array<{ orderItemId: number; shippedQty: number }>,
  ): Promise<void> {
    const order = await this._loadOrder(id);
    const SHIPPABLE_STATUSES: SalesOrderStatus[] = ['in_production', 'produced', 'partial_shipped'];
    if (!SHIPPABLE_STATUSES.includes(order.status)) {
      throw AppError.badRequest(
        '只有生产中、待发货或部分发货状态的订单才能标记发货',
        ResponseCode.ORDER_INVALID_TRANSITION,
      );
    }

    const rawOrderItems = await AppDataSource.query<Array<{
      id: number;
      qty_ordered: string;
      qty_delivered: string;
    }>>(
      `SELECT id, qty_ordered, qty_delivered
       FROM sales_order_items
       WHERE order_id = ? AND tenant_id = ?
       ORDER BY id ASC`,
      [id, this.tenantId],
    );
    const orderItems = rawOrderItems.map((item) => ({
      id: Number(item.id),
      qty_ordered: item.qty_ordered,
      qty_delivered: item.qty_delivered,
    }));
    if (orderItems.length === 0) {
      throw AppError.badRequest('订单无可发货明细', ResponseCode.INVALID_PARAMS);
    }

    const remainingQtyByItemId = new Map(
      orderItems.map((item) => [
        item.id,
        Math.max(0, Number(item.qty_ordered) - Number(item.qty_delivered ?? 0)),
      ]),
    );

    const shippedItems = shippedItemsInput && shippedItemsInput.length > 0
      ? shippedItemsInput.map((item) => ({
          orderItemId: item.orderItemId,
          shippedQty: Number(item.shippedQty),
        }))
      : orderItems
          .map((item) => ({
            orderItemId: item.id,
            shippedQty: remainingQtyByItemId.get(item.id) ?? 0,
          }))
          .filter((item) => item.shippedQty > 0);

    if (shippedItems.length === 0) {
      throw AppError.badRequest('订单已全部发货，无需重复操作', ResponseCode.ORDER_INVALID_TRANSITION);
    }

    const seenOrderItemIds = new Set<number>();
    for (const item of shippedItems) {
      if (seenOrderItemIds.has(item.orderItemId)) {
        throw AppError.badRequest('发货明细存在重复的订单行，请合并后重试', ResponseCode.INVALID_PARAMS);
      }
      seenOrderItemIds.add(item.orderItemId);

      const remainingQty = remainingQtyByItemId.get(item.orderItemId);
      if (remainingQty === undefined) {
        throw AppError.badRequest('部分发货明细不属于该订单', ResponseCode.INVALID_PARAMS);
      }
      if (item.shippedQty <= 0) {
        throw AppError.badRequest('发货数量必须大于 0', ResponseCode.INVALID_PARAMS);
      }
      if (item.shippedQty > remainingQty) {
        throw AppError.badRequest('发货数量超过该明细剩余待发数量', ResponseCode.INVALID_PARAMS);
      }
    }

    const shipResult = await this._salesFlowService().shipOrder(id, {
      trackingNo,
      shippedItems,
    });

    await this._writeAuditLog(AppDataSource, {
      action: 'SHIP',
      targetId: id,
      targetCode: order.orderNo,
      beforeData: { status: order.status },
      afterData: { status: shipResult.orderStatus },
    });
  }

  // ── 13. 标记完成 ──────────────────────────────────────────────────────────

  async complete(id: number): Promise<void> {
    const order = await this._loadOrder(id);
    if (order.status !== 'shipped') {
      throw AppError.badRequest('只有已发货的订单才能标记完成', ResponseCode.ORDER_INVALID_TRANSITION);
    }

    const pendingDeliveries = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT id
       FROM sales_deliveries
       WHERE order_id = ? AND tenant_id = ? AND status = 'pending'
       ORDER BY id ASC`,
      [id, this.tenantId],
    ).catch(() => []);

    if (pendingDeliveries.length === 0) {
      throw AppError.badRequest('订单没有待确认收货的发货记录', ResponseCode.ORDER_INVALID_TRANSITION);
    }

    for (const delivery of pendingDeliveries) {
      await this._salesFlowService().confirmReceipt(id, delivery.id);
    }

    await this._writeAuditLog(AppDataSource, {
      action: 'COMPLETE',
      targetId: id,
      targetCode: order.orderNo,
      beforeData: { status: order.status },
      afterData: { status: 'completed' },
    });
  }

  // ── 14. 关闭订单 ──────────────────────────────────────────────────────────

  async close(id: number, reason: string): Promise<void> {
    const order = await this._loadOrder(id);
    if (order.status === 'closed' || order.status === 'completed') {
      throw AppError.badRequest('已完成或已关闭的订单不能再关闭', ResponseCode.ORDER_INVALID_TRANSITION);
    }
    await AppDataSource.query(
      `UPDATE sales_orders SET status = 'closed', approval_notes = ?, updated_by = ? WHERE id = ? AND tenant_id = ?`,
      [reason, this.userId, id, this.tenantId],
    );
    await this._writeAuditLog(AppDataSource, {
      action: 'CLOSE',
      targetId: id,
      targetCode: order.orderNo,
      beforeData: { status: order.status },
      afterData: { status: 'closed', approvalNotes: reason },
    });
  }

  // ── 15. 触发建工单 ────────────────────────────────────────────────────────

  async createProductionOrders(id: number): Promise<{ productionOrderIds: number[] }> {
    const order = await this._loadOrder(id);
    if (order.status !== 'confirmed') {
      throw AppError.badRequest('只有已确认的订单才能创建生产工单', ResponseCode.ORDER_INVALID_TRANSITION);
    }
    const createdOrders = await this._productionOrderService().createFromSalesOrder(id);
    const productionOrderIds = createdOrders.map((orderRow) => orderRow.id);

    return { productionOrderIds };
  }

  // ── 16. 待审批列表 ────────────────────────────────────────────────────────

  async getPendingApprovals(): Promise<{ count: number; orders: unknown[] }> {
    const orders = await AppDataSource.query(
      `SELECT so.id, so.order_no AS orderNo, so.customer_id AS customerId,
              c.name AS customerName, DATE(so.created_at) AS orderDate,
              so.expected_delivery AS deliveryDate, (so.order_type = 'urgent') AS isUrgent,
              so.total_amount AS totalAmount, so.created_at AS createdAt
       FROM sales_orders so
       INNER JOIN customers c ON c.id = so.customer_id
       WHERE so.tenant_id = ? AND so.status = 'pending_approval'
       ORDER BY so.order_type DESC, so.created_at ASC`,
      [this.tenantId],
    );
    return { count: orders.length, orders };
  }

  // ── 17. 产能预检（下单前评估，独立端点）──────────────────────────────────────

  /**
   * 产能可行性检查
   *
   * 逻辑：
   * 1. 查询 expectedDelivery 日期当天之前所有非取消状态的在产工单，
   *    累加 qty_planned 作为 currentLoad（已占用产能）
   * 2. maxCapacity = 工作站 capacity 之和（若无工作站则降级为默认常量）×
   *    今天到交期的天数
   * 3. available = (currentLoad + quantity) <= maxCapacity
   * 4. estimatedCompletionDate：若可用，返回 expectedDelivery；
   *    否则估算在当前积压基础上追加所需天数后的完工日期
   * 5. conflictingOrders：deadline 落在今天到 expectedDelivery 区间内的
   *    同期在产工单（最多返回 10 条）
   */
  async capacityCheck(params: {
    skuId: number;
    quantity: number;
    expectedDelivery: string;
  }): Promise<CapacityCheckResult> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deliveryDate = new Date(params.expectedDelivery);
    deliveryDate.setHours(0, 0, 0, 0);

    // 交期不能早于今天
    if (deliveryDate < today) {
      return {
        available: false,
        currentLoad: params.quantity,
        maxCapacity: 0,
        estimatedCompletionDate: params.expectedDelivery,
        conflictingOrders: [],
      };
    }

    const workDays = Math.max(
      1,
      Math.ceil((deliveryDate.getTime() - today.getTime()) / (1000 * 3600 * 24)),
    );

    // 查询工作站日产能总和
    const [wsRow] = await AppDataSource.query<Array<{ totalCapacity: string | null }>>(
      `SELECT COALESCE(SUM(capacity), 0) AS totalCapacity
       FROM workstations
       WHERE tenant_id = ? AND status = 'active'`,
      [this.tenantId],
    );
    const dailyCapacity = Number(wsRow?.totalCapacity ?? 0) > 0
      ? Number(wsRow!.totalCapacity)
      : DEFAULT_MAX_CAPACITY_PER_DAY;

    const maxCapacity = dailyCapacity * workDays;

    // 查询区间内非取消在产工单的已占用总产能
    const [loadRow] = await AppDataSource.query<Array<{ currentLoad: string }>>(
      `SELECT COALESCE(SUM(qty_planned), 0) AS currentLoad
       FROM production_orders
       WHERE tenant_id = ?
         AND status IN ('pending', 'scheduled', 'in_progress')
         AND (planned_end IS NULL OR planned_end <= ?)`,
      [this.tenantId, params.expectedDelivery],
    );
    const currentLoad = Number(loadRow?.currentLoad ?? 0);

    const available = (currentLoad + params.quantity) <= maxCapacity;

    // 估算完工日期
    let estimatedCompletionDate = params.expectedDelivery;
    if (!available) {
      const overload = currentLoad + params.quantity - maxCapacity;
      const extraDays = Math.ceil(overload / dailyCapacity);
      const completionDate = new Date(deliveryDate);
      completionDate.setDate(completionDate.getDate() + extraDays);
      estimatedCompletionDate = completionDate.toISOString().slice(0, 10);
    }

    // 查询冲突工单（同期截止日期在今天 ~ 交期范围内，最多 10 条）
    const todayStr = today.toISOString().slice(0, 10);
    const conflictRows = await AppDataSource.query<Array<{
      id: number;
      work_order_no: string;
      sku_name: string;
      qty_planned: string;
      planned_end: string | null;
    }>>(
      `SELECT po.id, po.work_order_no, s.name AS sku_name,
              po.qty_planned, po.planned_end
       FROM production_orders po
       LEFT JOIN skus s ON s.id = po.sku_id
       WHERE po.tenant_id = ?
         AND po.status != 'cancelled'
         AND (po.planned_end IS NULL OR po.planned_end BETWEEN ? AND ?)
       ORDER BY po.planned_end ASC
       LIMIT 10`,
      [this.tenantId, todayStr, params.expectedDelivery],
    );

    const conflictingOrders: ConflictingOrder[] = conflictRows.map((row) => ({
      id: row.id,
      orderNo: row.work_order_no,
      skuName: row.sku_name ?? '',
      quantity: Number(row.qty_planned),
      deadline: row.planned_end ?? params.expectedDelivery,
    }));

    return {
      available,
      currentLoad,
      maxCapacity,
      estimatedCompletionDate,
      conflictingOrders,
    };
  }

  // ── 18. 状态统计 ──────────────────────────────────────────────────────────

  async getStats(): Promise<{ total: number; byStatus: Record<string, number> }> {
    const rows = await AppDataSource.query<Array<{ status: string; count: string }>>(
      `SELECT status, COUNT(*) AS count FROM sales_orders WHERE tenant_id = ? GROUP BY status`,
      [this.tenantId],
    );
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      const cnt = Number(row.count);
      byStatus[row.status] = cnt;
      total += cnt;
    }
    return { total, byStatus };
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
           (tenant_id, order_id, sku_id, qty_ordered, unit_price, amount, created_by, updated_by)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          this.tenantId, orderId, item.skuId,
          item.quantity, item.unitPrice, amount,
          this.userId, this.userId,
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
