import Decimal from 'decimal.js';
import { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { BomSnapshotService } from './bom-snapshot.service';

// ─── 内部行类型 ──────────────────────────────────────────────────────────────

interface SalesOrderRow {
  id: number;
  order_no: string;
  status: string;
  expected_delivery: string;
}

interface SalesOrderItemRow {
  id: number;
  sku_id: number;
  sku_code: string;
  qty_ordered: string;
}

interface ActiveBomRow {
  id: number;
  version: string;
}

interface ProcessTemplateRow {
  id: number;
}

interface InventoryRow {
  qty_on_hand: string;
  qty_reserved: string;
}

interface MaterialRequirementRow {
  id: number;
  sku_id: number;
  sku_code: string;
  sku_name: string;
  qty_required: string;
  qty_reserved: string;
  qty_shortage: string;
  status: string;
  qty_on_hand: string;
  available_qty: string;
}

// ─── 公共接口 ────────────────────────────────────────────────────────────────

export interface CreatedOrder {
  id: number;
  workOrderNo: string;
  skuId: number;
  qtyPlanned: string;
  materialStatus: string;
}

export interface ListOrderFilter {
  status?: string;
  skuId?: number;
  dateFrom?: string;
  dateTo?: string;
  priority?: number;
  page: number;
  pageSize: number;
}

/**
 * 生产工单服务（Sprint 3 扩展）
 * 核心职责：
 *   - 从销售订单批量创建生产工单（含 BOM 快照冻结 + 物料需求写入 + 库存预留）
 *   - 工单列表、详情、取消
 *   - 物料需求查询与实时缺料检测
 */
export class ProductionOrderService {
  private readonly tenantId: number;
  private readonly userId: number;
  private readonly snapshotSvc: BomSnapshotService;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
    this.snapshotSvc = new BomSnapshotService(ctx);
  }

  // ── R-10: 从销售订单创建生产工单 ──────────────────────────────────────────

  /**
   * 从销售订单批量创建生产工单
   * 整个过程在单一数据库事务内完成（BOM 展开 + 快照 + 库存预留 原子操作）
   * @param salesOrderId  销售订单 ID
   * @param outerManager  外部事务管理器（若需嵌套事务则传入，否则自动开启新事务）
   */
  async createFromSalesOrder(
    salesOrderId: number,
    outerManager?: EntityManager,
  ): Promise<CreatedOrder[]> {
    const run = async (manager: EntityManager): Promise<CreatedOrder[]> => {
      // 1. 查询销售订单
      const salesOrderRows: SalesOrderRow[] = await manager.query(
        `SELECT id, order_no, status, expected_delivery
         FROM sales_orders
         WHERE id = ? AND tenant_id = ? LIMIT 1`,
        [salesOrderId, this.tenantId],
      );

      if (salesOrderRows.length === 0) {
        throw AppError.notFound('销售订单不存在', ResponseCode.ORDER_NOT_FOUND);
      }

      const salesOrder = salesOrderRows[0];

      if (!['confirmed', 'approved'].includes(salesOrder.status)) {
        throw AppError.badRequest(
          `销售订单状态为 "${salesOrder.status}"，无法创建工单（需为 confirmed 或 approved）`,
          ResponseCode.ORDER_CANNOT_MODIFY,
        );
      }

      // 2. 查询销售订单明细
      const items: SalesOrderItemRow[] = await manager.query(
        `SELECT soi.id, soi.sku_id, s.sku_code, soi.qty_ordered
         FROM sales_order_items soi
         INNER JOIN skus s ON s.id = soi.sku_id
         WHERE soi.sales_order_id = ? AND soi.tenant_id = ?
         ORDER BY soi.id`,
        [salesOrderId, this.tenantId],
      );

      if (items.length === 0) {
        throw AppError.badRequest('销售订单无明细行，无法创建工单', ResponseCode.INVALID_PARAMS);
      }

      const createdOrders: CreatedOrder[] = [];

      // 3. 对每条明细创建一张工单
      for (const item of items) {
        // 3a. 查询激活 BOM
        const bomRows: ActiveBomRow[] = await manager.query(
          `SELECT id, version FROM bom_headers
           WHERE sku_id = ? AND tenant_id = ? AND is_active = 1
           LIMIT 1`,
          [item.sku_id, this.tenantId],
        );

        if (bomRows.length === 0) {
          throw AppError.badRequest(
            `SKU ${item.sku_code} 无激活 BOM 版本，无法创建工单`,
            ResponseCode.BOM_NOT_FOUND,
          );
        }

        const bom = bomRows[0];

        // 3b. 查询工艺模板（按 sku_id 匹配最新模板）
        const templateRows: ProcessTemplateRow[] = await manager.query(
          `SELECT id FROM process_templates
           WHERE sku_id = ? AND tenant_id = ?
           ORDER BY id DESC LIMIT 1`,
          [item.sku_id, this.tenantId],
        );

        if (templateRows.length === 0) {
          throw AppError.badRequest(
            `SKU ${item.sku_code} 无工艺模板，无法创建工单`,
            ResponseCode.INVALID_PARAMS,
          );
        }

        const template = templateRows[0];

        // 3c. 创建 BOM 快照（BD-001：冻结当前激活版本）
        const { snapshotId, expandedItems } = await this.snapshotSvc.createSnapshot(
          bom.id,
          item.qty_ordered,
          manager,
        );

        // 3d. 生成工单编号
        const today = new Date();
        const dateStr = [
          today.getFullYear(),
          String(today.getMonth() + 1).padStart(2, '0'),
          String(today.getDate()).padStart(2, '0'),
        ].join('');
        const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
        const workOrderNo = `WO-${dateStr}-${rand}`;

        // 3e. INSERT production_orders（含 bom_snapshot_id，material_status 初始为 unchecked）
        const orderResult = await manager.query(
          `INSERT INTO production_orders
             (tenant_id, work_order_no, sales_order_id, sku_id, bom_header_id,
              bom_snapshot_id, process_template_id, qty_planned, qty_completed,
              status, material_status, priority, planned_start, planned_end,
              notes, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', 'unchecked', 50,
                   NULL, ?, NULL, ?, ?)`,
          [
            this.tenantId,
            workOrderNo,
            salesOrderId,
            item.sku_id,
            bom.id,
            snapshotId,
            template.id,
            item.qty_ordered,
            salesOrder.expected_delivery,
            this.userId,
            this.userId,
          ],
        );

        const productionOrderId = Number(orderResult.insertId);

        // 3f. INSERT material_requirements（逐行写入展开后的原材料需求）
        for (const material of expandedItems) {
          await manager.query(
            `INSERT INTO material_requirements
               (tenant_id, production_order_id, bom_snapshot_id, sku_id,
                qty_required, qty_reserved, qty_shortage, status, created_by, updated_by)
             VALUES (?, ?, ?, ?, ?, 0, ?, 'shortage', ?, ?)`,
            [
              this.tenantId,
              productionOrderId,
              snapshotId,
              material.skuId,
              material.qty,
              material.qty,
              this.userId,
              this.userId,
            ],
          );
        }

        // 3g. 尝试库存预留（逐行尝试，部分预留也记录）
        let totalMaterials = expandedItems.length;
        let fulfilledCount = 0;
        let partialCount = 0;

        for (const material of expandedItems) {
          const requiredQty = new Decimal(material.qty);

          // 查询当前库存可用量
          const invRows: InventoryRow[] = await manager.query(
            `SELECT qty_on_hand, qty_reserved
             FROM inventory
             WHERE sku_id = ? AND tenant_id = ? LIMIT 1`,
            [material.skuId, this.tenantId],
          );

          const onHand = new Decimal(invRows[0]?.qty_on_hand ?? '0');
          const reserved = new Decimal(invRows[0]?.qty_reserved ?? '0');
          const available = onHand.minus(reserved);

          if (available.gte(requiredQty)) {
            // 库存充足：完全预留
            const updateResult = await manager.query(
              `UPDATE inventory
               SET qty_reserved = qty_reserved + ?, updated_at = NOW()
               WHERE sku_id = ? AND tenant_id = ?
                 AND qty_on_hand - qty_reserved >= ?`,
              [
                requiredQty.toFixed(6),
                material.skuId,
                this.tenantId,
                requiredQty.toFixed(6),
              ],
            );

            if (Number(updateResult.affectedRows) > 0) {
              // 更新物料需求行状态
              await manager.query(
                `UPDATE material_requirements
                 SET qty_reserved = ?, qty_shortage = 0, status = 'fulfilled', updated_at = NOW()
                 WHERE production_order_id = ? AND sku_id = ? AND tenant_id = ?`,
                [requiredQty.toFixed(6), productionOrderId, material.skuId, this.tenantId],
              );
              fulfilledCount++;
            } else {
              // 并发竞争导致预留失败，回退为 shortage
              await manager.query(
                `UPDATE material_requirements
                 SET qty_shortage = ?, status = 'shortage', updated_at = NOW()
                 WHERE production_order_id = ? AND sku_id = ? AND tenant_id = ?`,
                [requiredQty.toFixed(6), productionOrderId, material.skuId, this.tenantId],
              );
            }
          } else if (available.gt(0)) {
            // 部分可用：按可用量预留，剩余标记缺料
            const reserveQty = available;
            const shortageQty = requiredQty.minus(available);

            await manager.query(
              `UPDATE inventory
               SET qty_reserved = qty_reserved + ?, updated_at = NOW()
               WHERE sku_id = ? AND tenant_id = ?`,
              [reserveQty.toFixed(6), material.skuId, this.tenantId],
            );

            await manager.query(
              `UPDATE material_requirements
               SET qty_reserved = ?, qty_shortage = ?, status = 'partial', updated_at = NOW()
               WHERE production_order_id = ? AND sku_id = ? AND tenant_id = ?`,
              [
                reserveQty.toFixed(6),
                shortageQty.toFixed(6),
                productionOrderId,
                material.skuId,
                this.tenantId,
              ],
            );
            partialCount++;
          }
          // 若 available <= 0，保持 shortage 状态不变
        }

        // 3h. 根据预留结果更新 material_status
        let materialStatus: string;
        if (fulfilledCount === totalMaterials) {
          materialStatus = 'ready';
        } else if (fulfilledCount > 0 || partialCount > 0) {
          materialStatus = 'partial';
        } else {
          materialStatus = 'shortage';
        }

        await manager.query(
          `UPDATE production_orders
           SET material_status = ?, updated_by = ?
           WHERE id = ? AND tenant_id = ?`,
          [materialStatus, this.userId, productionOrderId, this.tenantId],
        );

        createdOrders.push({
          id: productionOrderId,
          workOrderNo,
          skuId: item.sku_id,
          qtyPlanned: item.qty_ordered,
          materialStatus,
        });
      }

      // 4. 更新销售订单状态为 in_production
      await manager.query(
        `UPDATE sales_orders
         SET status = 'in_production', updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [this.userId, salesOrderId, this.tenantId],
      );

      return createdOrders;
    };

    // 若调用方已有事务则复用，否则开启新事务
    if (outerManager) {
      return run(outerManager);
    }
    return AppDataSource.transaction(run);
  }

  // ── 工单列表 ─────────────────────────────────────────────────────────────

  async list(filter: ListOrderFilter): Promise<{ list: unknown[]; total: number }> {
    const conds = ['po.tenant_id = ?'];
    const p: unknown[] = [this.tenantId];

    if (filter.status) { conds.push('po.status = ?'); p.push(filter.status); }
    if (filter.skuId) { conds.push('po.sku_id = ?'); p.push(filter.skuId); }
    if (filter.dateFrom) { conds.push('po.planned_start >= ?'); p.push(filter.dateFrom); }
    if (filter.dateTo) { conds.push('po.planned_end <= ?'); p.push(filter.dateTo); }
    if (filter.priority !== undefined) { conds.push('po.priority = ?'); p.push(filter.priority); }

    const where = conds.join(' AND ');
    const offset = (filter.page - 1) * filter.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query(
        `SELECT po.id, po.work_order_no AS workOrderNo,
                po.status, po.material_status AS materialStatus,
                po.qty_planned AS qtyPlanned, po.qty_completed AS qtyCompleted,
                po.priority, po.planned_start AS plannedStart, po.planned_end AS plannedEnd,
                po.actual_start AS actualStart, po.actual_end AS actualEnd,
                po.created_at AS createdAt,
                s.name AS skuName, s.sku_code AS skuCode,
                so.order_no AS salesOrderNo, so.expected_delivery,
                ROUND(po.qty_completed / NULLIF(po.qty_planned, 0) * 100, 1) AS progressPct,
                bvs.snapshot_no AS bomSnapshotNo
         FROM production_orders po
         INNER JOIN skus s ON s.id = po.sku_id
         INNER JOIN sales_orders so ON so.id = po.sales_order_id
         LEFT JOIN bom_version_snapshots bvs ON bvs.id = po.bom_snapshot_id
         WHERE ${where}
         ORDER BY po.priority DESC, so.expected_delivery ASC
         LIMIT ? OFFSET ?`,
        [...p, filter.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: string }>>(
        `SELECT COUNT(*) AS total FROM production_orders po WHERE ${where}`,
        p,
      ),
    ]);

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  // ── 工单详情 ─────────────────────────────────────────────────────────────

  async getById(id: number): Promise<unknown> {
    const rows = await AppDataSource.query(
      `SELECT po.id, po.work_order_no AS workOrderNo,
              po.status, po.material_status AS materialStatus,
              po.qty_planned AS qtyPlanned, po.qty_completed AS qtyCompleted,
              po.priority, po.planned_start AS plannedStart, po.planned_end AS plannedEnd,
              po.actual_start AS actualStart, po.actual_end AS actualEnd,
              po.notes, po.created_at AS createdAt, po.updated_at AS updatedAt,
              s.name AS skuName, s.sku_code AS skuCode,
              so.order_no AS salesOrderNo, so.expected_delivery, so.customer_id,
              ROUND(po.qty_completed / NULLIF(po.qty_planned, 0) * 100, 1) AS progressPct,
              bvs.snapshot_no AS bomSnapshotNo, bvs.bom_version AS bomVersion
       FROM production_orders po
       INNER JOIN skus s ON s.id = po.sku_id
       INNER JOIN sales_orders so ON so.id = po.sales_order_id
       LEFT JOIN bom_version_snapshots bvs ON bvs.id = po.bom_snapshot_id
       WHERE po.id = ? AND po.tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );

    if (rows.length === 0) {
      throw AppError.notFound('生产工单不存在', ResponseCode.PRODUCTION_ORDER_NOT_FOUND);
    }

    const order = rows[0];

    // 工序任务列表
    const tasks = await AppDataSource.query(
      `SELECT pt.id, pt.task_no AS taskNo, pt.status, pt.task_date AS taskDate,
              pt.planned_qty AS plannedQty, pt.completed_qty AS completedQty,
              pt.started_at AS startedAt, pt.completed_at AS completedAt,
              pt.version,
              ps.step_no AS stepNo, ps.step_name AS stepName,
              ps.output_type AS outputType, ps.output_sku_id AS outputSkuId,
              u.real_name AS workerName
       FROM production_tasks pt
       INNER JOIN process_steps ps ON ps.id = pt.process_step_id
       LEFT JOIN users u ON u.id = pt.worker_id
       WHERE pt.production_order_id = ? AND pt.tenant_id = ?
       ORDER BY ps.step_no, pt.task_date`,
      [id, this.tenantId],
    );

    // 物料需求列表
    const materials = await this.getMaterialRequirements(id);

    return { ...order, tasks, materials };
  }

  // ── 取消工单 ─────────────────────────────────────────────────────────────

  async cancel(id: number): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
      // 查询工单状态
      const orderRows = await manager.query(
        `SELECT id, status, bom_snapshot_id FROM production_orders
         WHERE id = ? AND tenant_id = ? LIMIT 1`,
        [id, this.tenantId],
      );

      if (orderRows.length === 0) {
        throw AppError.notFound('生产工单不存在', ResponseCode.PRODUCTION_ORDER_NOT_FOUND);
      }

      const order = orderRows[0];

      if (order.status === 'cancelled') {
        throw AppError.conflict('工单已取消', ResponseCode.CONFLICT);
      }

      if (order.status === 'completed') {
        throw AppError.badRequest('已完工工单无法取消', ResponseCode.ORDER_CANNOT_MODIFY);
      }

      // 取消工单
      await manager.query(
        `UPDATE production_orders
         SET status = 'cancelled', updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [this.userId, id, this.tenantId],
      );

      // 级联取消未完工任务
      await manager.query(
        `UPDATE production_tasks
         SET status = 'cancelled', updated_by = ?
         WHERE production_order_id = ? AND tenant_id = ?
           AND status NOT IN ('completed', 'cancelled')`,
        [this.userId, id, this.tenantId],
      );

      // 释放已预留库存
      const materialRows: Array<{ sku_id: number; qty_reserved: string }> = await manager.query(
        `SELECT sku_id, qty_reserved
         FROM material_requirements
         WHERE production_order_id = ? AND tenant_id = ? AND qty_reserved > 0`,
        [id, this.tenantId],
      );

      for (const mat of materialRows) {
        if (new Decimal(mat.qty_reserved).gt(0)) {
          await manager.query(
            `UPDATE inventory
             SET qty_reserved = GREATEST(qty_reserved - ?, 0), updated_at = NOW()
             WHERE sku_id = ? AND tenant_id = ?`,
            [mat.qty_reserved, mat.sku_id, this.tenantId],
          );
        }
      }

      // 将物料需求标记为 shortage（预留已释放）
      await manager.query(
        `UPDATE material_requirements
         SET qty_reserved = 0, qty_shortage = qty_required, status = 'shortage', updated_at = NOW()
         WHERE production_order_id = ? AND tenant_id = ?`,
        [id, this.tenantId],
      );
    });
  }

  // ── 获取工单物料需求明细 ──────────────────────────────────────────────────

  async getMaterialRequirements(id: number): Promise<MaterialRequirementRow[]> {
    // 验证工单归属
    const orderRows = await AppDataSource.query(
      `SELECT id FROM production_orders WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );

    if (orderRows.length === 0) {
      throw AppError.notFound('生产工单不存在', ResponseCode.PRODUCTION_ORDER_NOT_FOUND);
    }

    return AppDataSource.query(
      `SELECT mr.id, mr.sku_id AS skuId, s.sku_code AS skuCode, s.name AS skuName,
              mr.qty_required AS qtyRequired, mr.qty_reserved AS qtyReserved,
              mr.qty_shortage AS qtyShortage, mr.status,
              COALESCE(inv.qty_on_hand, 0) AS qtyOnHand,
              COALESCE(inv.qty_on_hand - inv.qty_reserved, 0) AS availableQty
       FROM material_requirements mr
       INNER JOIN skus s ON s.id = mr.sku_id
       LEFT JOIN inventory inv ON inv.sku_id = mr.sku_id AND inv.tenant_id = mr.tenant_id
       WHERE mr.production_order_id = ? AND mr.tenant_id = ?
       ORDER BY mr.id`,
      [id, this.tenantId],
    );
  }

  // ── 实时缺料检测 ──────────────────────────────────────────────────────────

  async checkMaterialStatus(id: number): Promise<{
    materialStatus: string;
    requirements: Array<{
      skuId: number;
      skuCode: string;
      skuName: string;
      qtyRequired: string;
      qtyOnHand: string;
      availableQty: string;
      qtyShortage: string;
      status: string;
    }>;
  }> {
    // 验证工单归属
    const orderRows = await AppDataSource.query(
      `SELECT id, material_status FROM production_orders
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );

    if (orderRows.length === 0) {
      throw AppError.notFound('生产工单不存在', ResponseCode.PRODUCTION_ORDER_NOT_FOUND);
    }

    // 实时对比库存，重新计算缺料状态
    const requirements: Array<{
      sku_id: number;
      sku_code: string;
      sku_name: string;
      qty_required: string;
      qty_on_hand: string;
      qty_reserved_other: string;
    }> = await AppDataSource.query(
      `SELECT mr.sku_id, s.sku_code, s.name AS sku_name,
              mr.qty_required,
              COALESCE(inv.qty_on_hand, 0) AS qty_on_hand,
              COALESCE(
                inv.qty_reserved - mr.qty_reserved,
                0
              ) AS qty_reserved_other
       FROM material_requirements mr
       INNER JOIN skus s ON s.id = mr.sku_id
       LEFT JOIN inventory inv ON inv.sku_id = mr.sku_id AND inv.tenant_id = mr.tenant_id
       WHERE mr.production_order_id = ? AND mr.tenant_id = ?`,
      [id, this.tenantId],
    );

    let fulfilledCount = 0;
    let partialCount = 0;
    const total = requirements.length;

    const details = requirements.map((r) => {
      const required = new Decimal(r.qty_required);
      const onHand = new Decimal(r.qty_on_hand);
      const reservedByOthers = new Decimal(r.qty_reserved_other).lt(0)
        ? new Decimal(0)
        : new Decimal(r.qty_reserved_other);
      const available = onHand.minus(reservedByOthers);

      let status: string;
      let qtyShortage: Decimal;

      if (available.gte(required)) {
        status = 'fulfilled';
        qtyShortage = new Decimal(0);
        fulfilledCount++;
      } else if (available.gt(0)) {
        status = 'partial';
        qtyShortage = required.minus(available);
        partialCount++;
      } else {
        status = 'shortage';
        qtyShortage = required;
      }

      return {
        skuId: r.sku_id,
        skuCode: r.sku_code,
        skuName: r.sku_name,
        qtyRequired: required.toFixed(4),
        qtyOnHand: onHand.toFixed(4),
        availableQty: Decimal.max(available, 0).toFixed(4),
        qtyShortage: qtyShortage.toFixed(4),
        status,
      };
    });

    let materialStatus: string;
    if (fulfilledCount === total && total > 0) {
      materialStatus = 'ready';
    } else if (fulfilledCount > 0 || partialCount > 0) {
      materialStatus = 'partial';
    } else if (total === 0) {
      materialStatus = 'ready'; // 无物料需求（如纯服务类）视为就绪
    } else {
      materialStatus = 'shortage';
    }

    // 同步更新工单的 material_status
    await AppDataSource.query(
      `UPDATE production_orders SET material_status = ?, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [materialStatus, this.userId, id, this.tenantId],
    );

    return { materialStatus, requirements: details };
  }
}
