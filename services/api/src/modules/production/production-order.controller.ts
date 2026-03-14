import { Request, Response } from 'express';
import { z } from 'zod';
import { ProductionOrderService } from './production-order.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';

/**
 * 生产工单控制器（Sprint 3 新增）
 * 覆盖：从销售订单创建工单、物料需求查询、实时缺料检测、取消工单
 */
export class ProductionOrderController {
  private svc(req: Request): ProductionOrderService {
    return new ProductionOrderService({ tenantId: req.tenantId, userId: req.userId });
  }

  /**
   * POST /production/orders/from-sales-order/:salesOrderId
   * 从销售订单批量创建生产工单（含 BOM 快照冻结 + 物料预留）
   */
  async createFromSalesOrder(req: Request, res: Response): Promise<void> {
    const salesOrderId = z.coerce.number().int().positive().parse(req.params.salesOrderId);
    const orders = await this.svc(req).createFromSalesOrder(salesOrderId);
    created(res, orders, `已为销售订单 #${salesOrderId} 创建 ${orders.length} 张生产工单`);
  }

  /**
   * GET /production/orders
   * 工单列表（支持 status/skuId/dateFrom/dateTo/priority 筛选 + 分页）
   */
  async listOrders(req: Request, res: Response): Promise<void> {
    const q = PaginationSchema.extend({
      status: z.string().optional(),
      skuId: z.coerce.number().int().positive().optional(),
      dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      priority: z.coerce.number().int().min(1).max(100).optional(),
    }).parse(req.query);

    const { list, total } = await this.svc(req).list(q);
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  /**
   * GET /production/orders/:id
   * 工单详情（含工序任务列表、物料需求明细）
   */
  async getOrder(req: Request, res: Response): Promise<void> {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const data = await this.svc(req).getById(id);
    success(res, data);
  }

  /**
   * GET /production/orders/:id/materials
   * 工单物料需求明细（含库存对比）
   */
  async getMaterialRequirements(req: Request, res: Response): Promise<void> {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const data = await this.svc(req).getMaterialRequirements(id);
    success(res, data);
  }

  /**
   * GET /production/orders/:id/material-check
   * 实时缺料检测（当场查询库存，更新 material_status）
   */
  async checkMaterialStatus(req: Request, res: Response): Promise<void> {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const data = await this.svc(req).checkMaterialStatus(id);
    success(res, data);
  }

  /**
   * PUT /production/orders/:id/cancel
   * 取消工单（级联取消任务，释放库存预留）
   */
  async cancelOrder(req: Request, res: Response): Promise<void> {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    await this.svc(req).cancel(id);
    success(res, null, '工单已取消');
  }
}

export const productionOrderController = new ProductionOrderController();
