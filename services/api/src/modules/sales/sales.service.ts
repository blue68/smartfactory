import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { ConstraintEngine } from './constraintEngine';
import Decimal from 'decimal.js';

export interface CreateOrderParams {
  customerId: number;
  orderType: 'normal' | 'urgent';
  expectedDelivery: string;
  notes?: string;
  items: Array<{
    skuId: number;
    bomId: number;
    qtyOrdered: string;
    unitPrice: string;
  }>;
}

export interface UpdateOrderParams {
  expectedDelivery?: string;
  notes?: string;
  items?: Array<{
    skuId: number;
    bomId: number;
    qtyOrdered: string;
    unitPrice: string;
  }>;
}

export class SalesService {
  private readonly tenantId: number;
  private readonly userId: number;
  private readonly constraintEngine: ConstraintEngine;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
    this.constraintEngine = new ConstraintEngine(ctx);
  }

  /**
   * 创建销售订单
   * 流程：参数校验 → 约束检查 → 写入订单 → 记录检查结果 → 触发BOM计算
   */
  async createOrder(params: CreateOrderParams): Promise<{
    orderId: number;
    orderNo: string;
    constraintResult: string;
    estimatedDelivery: string | null;
    requiresApproval: boolean;
  }> {
    // 1. 约束引擎检查：遍历所有 items，汇总最严格结果
    //    overallResult 优先级：block > warning > pass
    //    blockedReasons / impactAnalysis 取各 item 结果的并集
    const itemReports = await Promise.all(
      params.items.map((item) =>
        this.constraintEngine.check(
          item.skuId,
          item.bomId,
          item.qtyOrdered,
          params.expectedDelivery,
          params.orderType === 'urgent',
        ),
      ),
    );

    // 合并各 item 约束检查结果，取最严格的 overallResult
    const resultPriority = { block: 2, warning: 1, pass: 0 } as const;
    const constraintReport = itemReports.reduce((merged, report) => {
      // overallResult 取优先级最高的
      if (resultPriority[report.overallResult] > resultPriority[merged.overallResult]) {
        merged.overallResult = report.overallResult;
      }
      // 各维度检查：任一 item 不通过则整体不通过，currentValue/threshold 取最差值
      if (!report.inventoryTurnoverCheck.passed) {
        merged.inventoryTurnoverCheck = report.inventoryTurnoverCheck;
      }
      if (!report.capitalOccupationCheck.passed) {
        merged.capitalOccupationCheck = report.capitalOccupationCheck;
      }
      if (!report.productionCostCheck.passed) {
        merged.productionCostCheck = report.productionCostCheck;
      }
      if (!report.capacityLoadCheck.passed) {
        merged.capacityLoadCheck = report.capacityLoadCheck;
      }
      // 合并拦截原因（去重）
      for (const reason of report.blockedReasons) {
        if (!merged.blockedReasons.includes(reason)) {
          merged.blockedReasons.push(reason);
        }
      }
      // 合并影响分析：受影响订单取并集，资金/成本累加
      const ia = report.impactAnalysis;
      for (const o of ia.affectedOrders) {
        const exists = merged.impactAnalysis.affectedOrders.find((x) => x.orderId === o.orderId);
        if (!exists) merged.impactAnalysis.affectedOrders.push(o);
      }
      merged.impactAnalysis.additionalCapital = (
        parseFloat(merged.impactAnalysis.additionalCapital) +
        parseFloat(ia.additionalCapital)
      ).toFixed(2);
      merged.impactAnalysis.additionalProductionCost = (
        parseFloat(merged.impactAnalysis.additionalProductionCost) +
        parseFloat(ia.additionalProductionCost)
      ).toFixed(2);
      return merged;
    }, itemReports[0]);

    const requiresApproval = constraintReport.overallResult === 'block';
    const orderStatus = requiresApproval ? 'pending_approval' : 'confirmed';
    const approvalStatus = requiresApproval ? 'pending' : 'not_required';

    const totalAmount = params.items.reduce(
      (sum, i) => sum.plus(new Decimal(i.qtyOrdered).mul(i.unitPrice)),
      new Decimal(0),
    );

    const orderNo = this.generateOrderNo();

    return AppDataSource.transaction(async (manager) => {
      // 2. 写入销售订单
      const result = await manager.query(
        `INSERT INTO sales_orders
           (tenant_id, order_no, customer_id, order_type, status, priority,
            expected_delivery, estimated_delivery, total_amount,
            constraint_passed, approval_status, sales_person_id, notes, created_by, updated_by)
         VALUES (?,?,?,?,?,50,?,NULL,?,?,?,?,?,?,?)`,
        [
          this.tenantId, orderNo, params.customerId, params.orderType, orderStatus,
          params.expectedDelivery, totalAmount.toFixed(2),
          constraintReport.overallResult === 'pass' ? 1 : 0,
          approvalStatus, this.userId, params.notes ?? null, this.userId, this.userId,
        ],
      );
      const orderId = Number(result.insertId);

      // 3. 写入明细
      for (const item of params.items) {
        await manager.query(
          `INSERT INTO sales_order_items
             (tenant_id, order_id, sku_id, qty_ordered, qty_delivered, unit_price, amount, bom_header_id, created_by, updated_by)
           VALUES (?,?,?,?,0,?,?,?,?,?)`,
          [
            this.tenantId, orderId, item.skuId, item.qtyOrdered,
            item.unitPrice,
            new Decimal(item.qtyOrdered).mul(item.unitPrice).toFixed(2),
            item.bomId, this.userId, this.userId,
          ],
        );
      }

      // 4. 写入约束检查记录
      await manager.query(
        `INSERT INTO order_constraint_checks
           (tenant_id, order_id, check_time, inventory_turnover_check, capital_occupation_check,
            production_cost_check, capacity_load_check, overall_result, blocked_reasons, impact_analysis, created_by)
         VALUES (?,?,NOW(),?,?,?,?,?,?,?,?)`,
        [
          this.tenantId, orderId,
          JSON.stringify(constraintReport.inventoryTurnoverCheck),
          JSON.stringify(constraintReport.capitalOccupationCheck),
          JSON.stringify(constraintReport.productionCostCheck),
          JSON.stringify(constraintReport.capacityLoadCheck),
          constraintReport.overallResult,
          JSON.stringify(constraintReport.blockedReasons),
          JSON.stringify(constraintReport.impactAnalysis),
          this.userId,
        ],
      );

      return {
        orderId,
        orderNo,
        constraintResult: constraintReport.overallResult,
        estimatedDelivery: null,
        requiresApproval,
      };
    });
  }

  async listOrders(params: {
    status?: string; customerId?: number; salesPersonId?: number;
    page: number; pageSize: number;
  }) {
    const conds = ['so.tenant_id = ?'];
    const p: unknown[] = [this.tenantId];
    if (params.status) { conds.push('so.status = ?'); p.push(params.status); }
    if (params.customerId) { conds.push('so.customer_id = ?'); p.push(params.customerId); }
    if (params.salesPersonId) { conds.push('so.sales_person_id = ?'); p.push(params.salesPersonId); }

    const where = conds.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query(
        `SELECT so.*, c.name AS customerName, u.real_name AS salesPersonName
         FROM sales_orders so
         INNER JOIN customers c ON c.id = so.customer_id
         INNER JOIN users u ON u.id = so.sales_person_id
         WHERE ${where} ORDER BY so.priority DESC, so.expected_delivery ASC
         LIMIT ? OFFSET ?`,
        [...p, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM sales_orders so WHERE ${where}`, p,
      ),
    ]);

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  async getOrderWithConstraint(orderId: number) {
    const [order] = await AppDataSource.query(
      `SELECT so.*, c.name AS customerName,
              occ.overall_result AS constraintResult,
              occ.blocked_reasons AS blockedReasons,
              occ.impact_analysis AS impactAnalysis
       FROM sales_orders so
       INNER JOIN customers c ON c.id = so.customer_id
       LEFT JOIN order_constraint_checks occ ON occ.order_id = so.id
       WHERE so.id = ? AND so.tenant_id = ? LIMIT 1`,
      [orderId, this.tenantId],
    );
    if (!order) throw AppError.notFound('销售订单不存在', ResponseCode.ORDER_NOT_FOUND);

    const items = await AppDataSource.query(
      `SELECT soi.*, s.name AS skuName, s.sku_code AS skuCode
       FROM sales_order_items soi INNER JOIN skus s ON s.id = soi.sku_id
       WHERE soi.order_id = ? AND soi.tenant_id = ?`,
      [orderId, this.tenantId],
    );

    return { ...order, items };
  }

  async approveOrder(
    orderId: number,
    action: 'approved' | 'rejected' | 'conditional',
    notes?: string,
  ): Promise<void> {
    const [order] = await AppDataSource.query<Array<{ id: number; approval_status: string }>>(
      'SELECT id, approval_status FROM sales_orders WHERE id = ? AND tenant_id = ? LIMIT 1',
      [orderId, this.tenantId],
    );
    if (!order) throw AppError.notFound('销售订单不存在', ResponseCode.ORDER_NOT_FOUND);
    if (order.approval_status !== 'pending') {
      throw AppError.badRequest('该订单不在待审批状态');
    }

    const newStatus = action === 'rejected' ? 'pending_approval' : 'confirmed';
    await AppDataSource.query(
      `UPDATE sales_orders
       SET approval_status = ?, approved_by = ?, approved_at = NOW(),
           status = ?, approval_notes = ?, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [action, this.userId, newStatus, notes ?? null, this.userId, orderId, this.tenantId],
    );
  }

  /**
   * 插单影响分析（不实际创建订单，仅返回分析结果）
   */
  async analyzeUrgentOrder(params: {
    skuId: number; bomId: number; qty: string; expectedDelivery: string;
  }): Promise<any> {
    const report = await this.constraintEngine.check(
      params.skuId, params.bomId, params.qty, params.expectedDelivery, true,
    );
    return report;
  }

  /**
   * BE-P1-006: 修改销售订单
   * 可修改状态: pending_approval | confirmed
   * 事务内: 更新主表 → 删除旧 items → 插入新 items → 重新约束检查
   */
  async updateOrder(
    orderId: number,
    payload: UpdateOrderParams,
  ): Promise<{
    orderId: number;
    orderNo: string;
    constraintResult: string | null;
    requiresApproval: boolean;
  }> {
    // 1. 查询现有订单，校验状态
    const [order] = await AppDataSource.query<
      Array<{ id: number; status: string; order_type: string; order_no: string }>
    >(
      'SELECT id, status, order_type, order_no FROM sales_orders WHERE id = ? AND tenant_id = ? LIMIT 1',
      [orderId, this.tenantId],
    );
    if (!order) throw AppError.notFound('销售订单不存在', ResponseCode.ORDER_NOT_FOUND);

    const MODIFIABLE_STATUSES = ['pending_approval', 'confirmed'];
    if (!MODIFIABLE_STATUSES.includes(order.status)) {
      throw AppError.badRequest(
        `当前订单状态「${order.status}」不允许修改，仅 pending_approval / confirmed 状态可修改`,
        ResponseCode.ORDER_CANNOT_MODIFY,
      );
    }

    // 2. 如果传入了新 items，重新执行约束检查
    let constraintResult: string | null = null;
    let requiresApproval = false;

    if (payload.items && payload.items.length > 0) {
      const effectiveDelivery =
        payload.expectedDelivery ??
        (await AppDataSource.query<Array<{ expected_delivery: string }>>(
          'SELECT DATE_FORMAT(expected_delivery, "%Y-%m-%d") AS expected_delivery FROM sales_orders WHERE id = ? LIMIT 1',
          [orderId],
        ).then((rows) => rows[0]?.expected_delivery ?? ''));

      const itemReports = await Promise.all(
        payload.items.map((item) =>
          this.constraintEngine.check(
            item.skuId,
            item.bomId,
            item.qtyOrdered,
            effectiveDelivery,
            order.order_type === 'urgent',
          ),
        ),
      );

      const resultPriority = { block: 2, warning: 1, pass: 0 } as const;
      const merged = itemReports.reduce((acc, report) => {
        if (resultPriority[report.overallResult] > resultPriority[acc.overallResult]) {
          acc.overallResult = report.overallResult;
        }
        for (const reason of report.blockedReasons) {
          if (!acc.blockedReasons.includes(reason)) acc.blockedReasons.push(reason);
        }
        return acc;
      }, itemReports[0]);

      constraintResult = merged.overallResult;
      requiresApproval = merged.overallResult === 'block';
    }

    // 3. 事务内完成写入
    return AppDataSource.transaction(async (manager) => {
      // 3a. 构造主表更新字段（只更新传入的字段）
      const setClauses: string[] = ['updated_by = ?'];
      const setValues: unknown[] = [this.userId];

      if (payload.expectedDelivery !== undefined) {
        setClauses.unshift('expected_delivery = ?');
        setValues.unshift(payload.expectedDelivery);
      }
      if (payload.notes !== undefined) {
        setClauses.unshift('notes = ?');
        setValues.unshift(payload.notes);
      }
      if (payload.items && payload.items.length > 0) {
        const newTotal = payload.items.reduce(
          (sum, i) => sum.plus(new Decimal(i.qtyOrdered).mul(i.unitPrice)),
          new Decimal(0),
        );
        setClauses.unshift('total_amount = ?');
        setValues.unshift(newTotal.toFixed(2));

        // 若约束检查结果改变审批状态，同步更新 status / approval_status
        if (requiresApproval) {
          setClauses.unshift('status = ?, approval_status = ?');
          setValues.unshift('pending_approval', 'pending');
        } else {
          setClauses.unshift('status = ?, approval_status = ?');
          setValues.unshift('confirmed', 'not_required');
        }
        setClauses.unshift('constraint_passed = ?');
        setValues.unshift(constraintResult === 'pass' ? 1 : 0);
      }

      await manager.query(
        `UPDATE sales_orders SET ${setClauses.join(', ')} WHERE id = ? AND tenant_id = ?`,
        [...setValues, orderId, this.tenantId],
      );

      // 3b. 替换 items（只有传入 items 时才替换）
      if (payload.items && payload.items.length > 0) {
        await manager.query(
          'DELETE FROM sales_order_items WHERE order_id = ? AND tenant_id = ?',
          [orderId, this.tenantId],
        );

        for (const item of payload.items) {
          await manager.query(
            `INSERT INTO sales_order_items
               (tenant_id, order_id, sku_id, qty_ordered, qty_delivered, unit_price, amount, bom_header_id, created_by, updated_by)
             VALUES (?,?,?,?,0,?,?,?,?,?)`,
            [
              this.tenantId, orderId, item.skuId, item.qtyOrdered,
              item.unitPrice,
              new Decimal(item.qtyOrdered).mul(item.unitPrice).toFixed(2),
              item.bomId, this.userId, this.userId,
            ],
          );
        }
      }

      // 3c. 若有新约束检查结果，追加一条检查记录
      if (constraintResult !== null && payload.items && payload.items.length > 0) {
        const itemReports = await Promise.all(
          payload.items.map((item) => {
            const deliveryDate =
              payload.expectedDelivery ?? new Date().toISOString().slice(0, 10);
            return this.constraintEngine.check(
              item.skuId,
              item.bomId,
              item.qtyOrdered,
              deliveryDate,
              order.order_type === 'urgent',
            );
          }),
        );
        const resultPriority = { block: 2, warning: 1, pass: 0 } as const;
        const finalReport = itemReports.reduce((acc, report) => {
          if (resultPriority[report.overallResult] > resultPriority[acc.overallResult]) {
            acc.overallResult = report.overallResult;
          }
          if (!acc.inventoryTurnoverCheck.passed) { /* keep worst */ }
          if (!report.inventoryTurnoverCheck.passed) acc.inventoryTurnoverCheck = report.inventoryTurnoverCheck;
          if (!report.capitalOccupationCheck.passed) acc.capitalOccupationCheck = report.capitalOccupationCheck;
          if (!report.productionCostCheck.passed) acc.productionCostCheck = report.productionCostCheck;
          if (!report.capacityLoadCheck.passed) acc.capacityLoadCheck = report.capacityLoadCheck;
          for (const r of report.blockedReasons) {
            if (!acc.blockedReasons.includes(r)) acc.blockedReasons.push(r);
          }
          return acc;
        }, itemReports[0]);

        await manager.query(
          `INSERT INTO order_constraint_checks
             (tenant_id, order_id, check_time, inventory_turnover_check, capital_occupation_check,
              production_cost_check, capacity_load_check, overall_result, blocked_reasons, impact_analysis, created_by)
           VALUES (?,?,NOW(),?,?,?,?,?,?,?,?)`,
          [
            this.tenantId, orderId,
            JSON.stringify(finalReport.inventoryTurnoverCheck),
            JSON.stringify(finalReport.capitalOccupationCheck),
            JSON.stringify(finalReport.productionCostCheck),
            JSON.stringify(finalReport.capacityLoadCheck),
            finalReport.overallResult,
            JSON.stringify(finalReport.blockedReasons),
            JSON.stringify(finalReport.impactAnalysis),
            this.userId,
          ],
        );
      }

      return {
        orderId,
        orderNo: order.order_no,
        constraintResult,
        requiresApproval,
      };
    });
  }

  /**
   * BE-P1-007: 取消销售订单
   * 禁止取消状态: completed | shipped
   * 事务内: 取消订单 → 取消关联生产工单 → 释放库存预留
   */
  async cancelOrder(
    orderId: number,
    reason?: string,
  ): Promise<{
    orderId: number;
    orderNo: string;
    cancelledProductionOrders: number;
    releasedSkus: number;
  }> {
    // 1. 查询并校验订单状态
    const [order] = await AppDataSource.query<
      Array<{ id: number; status: string; order_no: string }>
    >(
      'SELECT id, status, order_no FROM sales_orders WHERE id = ? AND tenant_id = ? LIMIT 1',
      [orderId, this.tenantId],
    );
    if (!order) throw AppError.notFound('销售订单不存在', ResponseCode.ORDER_NOT_FOUND);

    const FORBIDDEN_STATUSES = ['completed', 'shipped'];
    if (FORBIDDEN_STATUSES.includes(order.status)) {
      throw AppError.badRequest(
        `订单状态「${order.status}」不允许取消，已完成/已发货订单无法撤销`,
        ResponseCode.ORDER_CANNOT_MODIFY,
      );
    }

    if (order.status === 'cancelled') {
      throw AppError.badRequest('订单已是取消状态，请勿重复操作', ResponseCode.ORDER_CANNOT_MODIFY);
    }

    // 2. 获取订单 SKU 列表，用于释放库存预留
    const orderItems = await AppDataSource.query<Array<{ sku_id: number; qty_ordered: string }>>(
      'SELECT sku_id, qty_ordered FROM sales_order_items WHERE order_id = ? AND tenant_id = ?',
      [orderId, this.tenantId],
    );

    return AppDataSource.transaction(async (manager) => {
      // 2a. 取消销售订单
      await manager.query(
        `UPDATE sales_orders
         SET status = 'cancelled', notes = CONCAT(COALESCE(notes, ''), ?), updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [
          reason ? `\n[取消原因] ${reason}` : '\n[已取消]',
          this.userId,
          orderId,
          this.tenantId,
        ],
      );

      // 2b. 联动取消关联生产工单（只取消可撤销的工单）
      const cancelResult = await manager.query(
        `UPDATE production_orders
         SET status = 'cancelled', updated_by = ?
         WHERE sales_order_id = ? AND tenant_id = ?
           AND status IN ('pending', 'scheduled')`,
        [this.userId, orderId, this.tenantId],
      );
      const cancelledProductionOrders = Number(cancelResult.affectedRows ?? 0);

      // 2c. 释放库存预留
      let releasedSkus = 0;
      if (orderItems.length > 0) {
        for (const item of orderItems) {
          // GREATEST 防止 qty_reserved 被减成负数
          await manager.query(
            `UPDATE inventory
             SET qty_reserved = GREATEST(0, qty_reserved - ?)
             WHERE sku_id = ? AND tenant_id = ?`,
            [item.qty_ordered, item.sku_id, this.tenantId],
          );
        }
        releasedSkus = orderItems.length;
      }

      return {
        orderId,
        orderNo: order.order_no,
        cancelledProductionOrders,
        releasedSkus,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // BE-P2-007: 发货确认 & 收货确认
  // ---------------------------------------------------------------------------
  //
  // DDL REQUIRED (run via migration before deploying):
  //
  // CREATE TABLE IF NOT EXISTS sales_deliveries (
  //   id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  //   tenant_id     INT UNSIGNED NOT NULL,
  //   order_id      BIGINT UNSIGNED NOT NULL,
  //   delivery_no   VARCHAR(32) NOT NULL,
  //   tracking_no   VARCHAR(128),
  //   status        ENUM('pending','received') NOT NULL DEFAULT 'pending',
  //   shipped_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  //   received_at   DATETIME,
  //   created_by    INT UNSIGNED NOT NULL,
  //   updated_by    INT UNSIGNED NOT NULL,
  //   created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  //   updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  //   INDEX idx_order  (tenant_id, order_id),
  //   INDEX idx_status (tenant_id, status)
  // ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  //
  // CREATE TABLE IF NOT EXISTS sales_delivery_items (
  //   id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  //   tenant_id       INT UNSIGNED NOT NULL,
  //   delivery_id     BIGINT UNSIGNED NOT NULL,
  //   order_item_id   BIGINT UNSIGNED NOT NULL,
  //   shipped_qty     DECIMAL(14,4) NOT NULL,
  //   created_by      INT UNSIGNED NOT NULL,
  //   INDEX idx_delivery  (tenant_id, delivery_id),
  //   INDEX idx_order_item (order_item_id)
  // ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  /**
   * 发货：为销售订单创建发货记录，更新订单状态
   *
   * 允许发货的订单状态：produced | partial_shipped
   * 发货后状态：
   *   - 所有明细累计 qty_delivered >= qty_ordered → 'shipped'
   *   - 否则 → 'partial_shipped'
   */
  async shipOrder(
    orderId: number,
    params: {
      trackingNo?: string;
      shippedItems: Array<{ orderItemId: number; shippedQty: number }>;
    },
  ): Promise<{
    deliveryId: number;
    deliveryNo: string;
    orderStatus: string;
  }> {
    // 1. 校验订单状态
    const [order] = await AppDataSource.query<
      Array<{ id: number; status: string; order_no: string }>
    >(
      'SELECT id, status, order_no FROM sales_orders WHERE id = ? AND tenant_id = ? LIMIT 1',
      [orderId, this.tenantId],
    );
    if (!order) throw AppError.notFound('销售订单不存在', ResponseCode.ORDER_NOT_FOUND);

    const SHIPPABLE_STATUSES = ['produced', 'partial_shipped'];
    if (!SHIPPABLE_STATUSES.includes(order.status)) {
      throw AppError.badRequest(
        `订单状态「${order.status}」不允许发货，仅 produced / partial_shipped 状态可发货`,
        ResponseCode.ORDER_CANNOT_MODIFY,
      );
    }

    // 2. 校验所有 orderItemId 均属于本订单
    if (params.shippedItems.length === 0) {
      throw AppError.badRequest('shippedItems 不能为空');
    }
    const orderItemIds = params.shippedItems.map((i) => i.orderItemId);
    const placeholders = orderItemIds.map(() => '?').join(',');
    const existingItems = await AppDataSource.query<
      Array<{ id: number; qty_ordered: string; qty_delivered: string }>
    >(
      `SELECT id, qty_ordered, qty_delivered
       FROM sales_order_items
       WHERE id IN (${placeholders}) AND order_id = ? AND tenant_id = ?`,
      [...orderItemIds, orderId, this.tenantId],
    );
    if (existingItems.length !== orderItemIds.length) {
      throw AppError.badRequest('部分 orderItemId 不属于该订单，请检查参数');
    }

    const deliveryNo = this.generateDeliveryNo();

    return AppDataSource.transaction(async (manager) => {
      // 3. 插入发货主表
      const deliveryResult = await manager.query(
        `INSERT INTO sales_deliveries
           (tenant_id, order_id, delivery_no, tracking_no, status, shipped_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, 'pending', NOW(), ?, ?)`,
        [
          this.tenantId,
          orderId,
          deliveryNo,
          params.trackingNo ?? null,
          this.userId,
          this.userId,
        ],
      );
      const deliveryId = Number(deliveryResult.insertId);

      // 4. 插入发货明细 & 累加 qty_delivered
      for (const item of params.shippedItems) {
        await manager.query(
          `INSERT INTO sales_delivery_items
             (tenant_id, delivery_id, order_item_id, shipped_qty, created_by)
           VALUES (?, ?, ?, ?, ?)`,
          [this.tenantId, deliveryId, item.orderItemId, item.shippedQty, this.userId],
        );

        await manager.query(
          `UPDATE sales_order_items
           SET qty_delivered = qty_delivered + ?, updated_by = ?
           WHERE id = ? AND tenant_id = ?`,
          [item.shippedQty, this.userId, item.orderItemId, this.tenantId],
        );
      }

      // 5. 判断是否全部发货完毕（每条明细 qty_delivered >= qty_ordered）
      const [qtyCheck] = await manager.query<
        Array<{ total: number; fully_shipped: number }>
      >(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN qty_delivered >= qty_ordered THEN 1 ELSE 0 END) AS fully_shipped
         FROM sales_order_items
         WHERE order_id = ? AND tenant_id = ?`,
        [orderId, this.tenantId],
      );
      const allShipped =
        Number(qtyCheck.total) > 0 &&
        Number(qtyCheck.fully_shipped) === Number(qtyCheck.total);
      const newOrderStatus = allShipped ? 'shipped' : 'partial_shipped';

      // 6. 更新订单状态
      await manager.query(
        `UPDATE sales_orders SET status = ?, updated_by = ? WHERE id = ? AND tenant_id = ?`,
        [newOrderStatus, this.userId, orderId, this.tenantId],
      );

      return { deliveryId, deliveryNo, orderStatus: newOrderStatus };
    });
  }

  /**
   * 收货确认：标记指定发货记录为已收货，若所有发货均已收货则将订单置为 completed
   */
  async confirmReceipt(
    orderId: number,
    deliveryId: number,
  ): Promise<{
    deliveryId: number;
    orderStatus: string;
    orderCompleted: boolean;
  }> {
    // 1. 校验发货记录存在且属于本订单、本租户
    const [delivery] = await AppDataSource.query<
      Array<{ id: number; status: string; order_id: number }>
    >(
      `SELECT id, status, order_id
       FROM sales_deliveries
       WHERE id = ? AND order_id = ? AND tenant_id = ? LIMIT 1`,
      [deliveryId, orderId, this.tenantId],
    );
    if (!delivery) {
      throw AppError.notFound('发货记录不存在或不属于该订单', ResponseCode.NOT_FOUND);
    }
    if (delivery.status === 'received') {
      throw AppError.badRequest('该发货记录已确认收货，请勿重复操作');
    }

    // 2. 校验关联订单存在
    const [order] = await AppDataSource.query<Array<{ id: number; status: string }>>(
      'SELECT id, status FROM sales_orders WHERE id = ? AND tenant_id = ? LIMIT 1',
      [orderId, this.tenantId],
    );
    if (!order) throw AppError.notFound('销售订单不存在', ResponseCode.ORDER_NOT_FOUND);

    return AppDataSource.transaction(async (manager) => {
      // 3. 更新该发货记录为已收货
      await manager.query(
        `UPDATE sales_deliveries
         SET status = 'received', received_at = NOW(), updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [this.userId, deliveryId, this.tenantId],
      );

      // 4. 检查本订单所有发货记录是否均已收货
      const [receiptCheck] = await manager.query<
        Array<{ total: number; received: number }>
      >(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) AS received
         FROM sales_deliveries
         WHERE order_id = ? AND tenant_id = ?`,
        [orderId, this.tenantId],
      );
      const allReceived =
        Number(receiptCheck.total) > 0 &&
        Number(receiptCheck.received) === Number(receiptCheck.total);

      // 5. 若全部收货，将订单状态置为 completed
      if (allReceived) {
        await manager.query(
          `UPDATE sales_orders SET status = 'completed', updated_by = ? WHERE id = ? AND tenant_id = ?`,
          [this.userId, orderId, this.tenantId],
        );
      }

      return {
        deliveryId,
        orderStatus: allReceived ? 'completed' : order.status,
        orderCompleted: allReceived,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // BE-P2-008: 财务结算（结算单 + 开票跟踪 + 应收账款）
  // ---------------------------------------------------------------------------
  //
  // DDL REQUIRED:
  //
  // CREATE TABLE IF NOT EXISTS sales_settlements (
  //   id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  //   tenant_id     INT UNSIGNED NOT NULL,
  //   order_id      BIGINT UNSIGNED NOT NULL,
  //   settlement_no VARCHAR(32) NOT NULL,
  //   total_amount  DECIMAL(14,2) NOT NULL,
  //   paid_amount   DECIMAL(14,2) NOT NULL DEFAULT 0,
  //   status        ENUM('pending','partial_paid','paid','overdue') NOT NULL DEFAULT 'pending',
  //   due_date      DATE NOT NULL,
  //   invoice_no    VARCHAR(64),
  //   invoice_date  DATE,
  //   notes         TEXT,
  //   created_by    INT UNSIGNED NOT NULL,
  //   updated_by    INT UNSIGNED NOT NULL,
  //   created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  //   updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  //   UNIQUE KEY uk_order (tenant_id, order_id),
  //   INDEX idx_status (tenant_id, status),
  //   INDEX idx_due_date (tenant_id, due_date)
  // ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  //
  // CREATE TABLE IF NOT EXISTS sales_payments (
  //   id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  //   tenant_id       INT UNSIGNED NOT NULL,
  //   settlement_id   BIGINT UNSIGNED NOT NULL,
  //   payment_amount  DECIMAL(14,2) NOT NULL,
  //   payment_method  VARCHAR(32) NOT NULL DEFAULT 'bank_transfer',
  //   payment_date    DATE NOT NULL,
  //   reference_no    VARCHAR(64),
  //   notes           TEXT,
  //   created_by      INT UNSIGNED NOT NULL,
  //   created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  //   INDEX idx_settlement (tenant_id, settlement_id)
  // ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  /**
   * 创建结算单：对已完成/已发货订单生成应收结算
   */
  async createSettlement(
    orderId: number,
    params: { dueDate: string; notes?: string },
  ): Promise<{ settlementId: number; settlementNo: string }> {
    const [order] = await AppDataSource.query<
      Array<{ id: number; status: string; total_amount: string; order_no: string }>
    >(
      'SELECT id, status, total_amount, order_no FROM sales_orders WHERE id = ? AND tenant_id = ? LIMIT 1',
      [orderId, this.tenantId],
    );
    if (!order) throw AppError.notFound('销售订单不存在', ResponseCode.ORDER_NOT_FOUND);

    const SETTLEMENT_STATUSES = ['shipped', 'completed', 'partial_shipped'];
    if (!SETTLEMENT_STATUSES.includes(order.status)) {
      throw AppError.badRequest(`订单状态「${order.status}」不允许创建结算单，需先发货`);
    }

    // 检查是否已有结算单
    const [existing] = await AppDataSource.query<Array<{ id: number }>>(
      'SELECT id FROM sales_settlements WHERE order_id = ? AND tenant_id = ? LIMIT 1',
      [orderId, this.tenantId],
    );
    if (existing) {
      throw AppError.badRequest('该订单已有结算单，请勿重复创建');
    }

    const settlementNo = this.generateSettlementNo();
    const result = await AppDataSource.query(
      `INSERT INTO sales_settlements
         (tenant_id, order_id, settlement_no, total_amount, paid_amount, status, due_date, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, 0, 'pending', ?, ?, ?, ?)`,
      [
        this.tenantId, orderId, settlementNo, order.total_amount,
        params.dueDate, params.notes ?? null, this.userId, this.userId,
      ],
    );
    return { settlementId: Number(result.insertId), settlementNo };
  }

  /**
   * 录入付款记录
   */
  async recordPayment(
    settlementId: number,
    params: { paymentAmount: string; paymentMethod?: string; paymentDate: string; referenceNo?: string; notes?: string },
  ): Promise<{ paymentId: number; settlementStatus: string }> {
    const [settlement] = await AppDataSource.query<
      Array<{ id: number; total_amount: string; paid_amount: string; status: string }>
    >(
      'SELECT id, total_amount, paid_amount, status FROM sales_settlements WHERE id = ? AND tenant_id = ? LIMIT 1',
      [settlementId, this.tenantId],
    );
    if (!settlement) throw AppError.notFound('结算单不存在');
    if (settlement.status === 'paid') {
      throw AppError.badRequest('该结算单已全额付清');
    }

    const paymentAmount = new Decimal(params.paymentAmount);
    const newPaid = new Decimal(settlement.paid_amount).plus(paymentAmount);
    const total = new Decimal(settlement.total_amount);

    if (newPaid.gt(total)) {
      throw AppError.badRequest(`付款总额 ${newPaid.toFixed(2)} 超过结算金额 ${total.toFixed(2)}`);
    }

    const newStatus = newPaid.gte(total) ? 'paid' : 'partial_paid';

    return AppDataSource.transaction(async (manager) => {
      const payResult = await manager.query(
        `INSERT INTO sales_payments
           (tenant_id, settlement_id, payment_amount, payment_method, payment_date, reference_no, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          this.tenantId, settlementId, paymentAmount.toFixed(2),
          params.paymentMethod ?? 'bank_transfer', params.paymentDate,
          params.referenceNo ?? null, params.notes ?? null, this.userId,
        ],
      );

      await manager.query(
        `UPDATE sales_settlements SET paid_amount = ?, status = ?, updated_by = ? WHERE id = ? AND tenant_id = ?`,
        [newPaid.toFixed(2), newStatus, this.userId, settlementId, this.tenantId],
      );

      return { paymentId: Number(payResult.insertId), settlementStatus: newStatus };
    });
  }

  /**
   * 更新开票信息
   */
  async updateInvoice(
    settlementId: number,
    params: { invoiceNo: string; invoiceDate: string },
  ): Promise<void> {
    const result = await AppDataSource.query(
      `UPDATE sales_settlements SET invoice_no = ?, invoice_date = ?, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [params.invoiceNo, params.invoiceDate, this.userId, settlementId, this.tenantId],
    );
    if (Number(result.affectedRows) === 0) {
      throw AppError.notFound('结算单不存在');
    }
  }

  /**
   * 查询应收账款汇总
   */
  async getReceivableSummary(): Promise<{
    totalReceivable: string;
    overdueAmount: string;
    overdueCount: number;
    settlements: Array<Record<string, unknown>>;
  }> {
    const settlements = await AppDataSource.query(
      `SELECT ss.*, so.order_no, c.name AS customerName
       FROM sales_settlements ss
       INNER JOIN sales_orders so ON so.id = ss.order_id
       INNER JOIN customers c ON c.id = so.customer_id
       WHERE ss.tenant_id = ? AND ss.status IN ('pending', 'partial_paid', 'overdue')
       ORDER BY ss.due_date ASC`,
      [this.tenantId],
    );

    let totalReceivable = new Decimal(0);
    let overdueAmount = new Decimal(0);
    let overdueCount = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const s of settlements) {
      const remaining = new Decimal(s.total_amount).minus(s.paid_amount);
      totalReceivable = totalReceivable.plus(remaining);
      if (s.due_date && s.due_date.toISOString?.().slice(0, 10) < today) {
        overdueAmount = overdueAmount.plus(remaining);
        overdueCount++;
      }
    }

    return {
      totalReceivable: totalReceivable.toFixed(2),
      overdueAmount: overdueAmount.toFixed(2),
      overdueCount,
      settlements,
    };
  }

  private generateOrderNo(): string {
    const ts = Date.now();
    const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    return `SO${ts}${rand}`;
  }

  private generateDeliveryNo(): string {
    const ts = Date.now();
    const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    return `DL${ts}${rand}`;
  }

  private generateSettlementNo(): string {
    const ts = Date.now();
    const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    return `ST${ts}${rand}`;
  }
}
