import { Request, Response } from 'express';
import { z } from 'zod';
import { InventoryService } from './inventory.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';

const InboundSchema = z.object({
  skuId: z.number().int().positive(),
  qtyInput: z.string().regex(/^\d+(\.\d{1,4})?$/),
  inputUnit: z.string().min(1).max(20),
  transactionType: z.enum(['PURCHASE_IN', 'PRODUCTION_IN', 'ADJUSTMENT_IN']),
  dyeLotNo: z.string().max(50).optional(),
  referenceType: z.string().max(50).optional(),
  referenceId: z.number().int().positive().optional(),
  referenceNo: z.string().max(50).optional(),
  batchCost: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  notes: z.string().max(500).optional(),
});

const OutboundSchema = z.object({
  skuId: z.number().int().positive(),
  qtyInput: z.string().regex(/^\d+(\.\d{1,4})?$/),
  inputUnit: z.string().min(1).max(20),
  transactionType: z.enum(['MATERIAL_OUT', 'DELIVERY_OUT', 'ADJUSTMENT_OUT']),
  dyeLotNo: z.string().max(50).optional(),
  productionOrderId: z.number().int().positive().optional(),
  referenceType: z.string().max(50).optional(),
  referenceId: z.number().int().positive().optional(),
  referenceNo: z.string().max(50).optional(),
  notes: z.string().max(500).optional(),
});

const ListInventorySchema = PaginationSchema.extend({
  category1Id: z.coerce.number().int().positive().optional(),
  category2Id: z.coerce.number().int().positive().optional(),
  keyword: z.string().max(100).optional(),
  belowSafety: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export class InventoryController {
  private svc(req: Request): InventoryService {
    // roles 来自 JWT 中间件解析后挂载在 req.roles（string[]）
    // 必须传入，否则 outbound 跨缸号授权校验链路断裂（DyeLotAuthorizeService 无法获取角色）
    return new InventoryService({
      tenantId: req.tenantId,
      userId: req.userId,
      roles: req.roles ?? [],
    });
  }

  async list(req: Request, res: Response): Promise<void> {
    const q = ListInventorySchema.parse(req.query);
    const { list, total } = await this.svc(req).listInventory(q);
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async getDyeLots(req: Request, res: Response): Promise<void> {
    const skuId = Number(req.params.skuId);
    const data = await this.svc(req).getDyeLotDetails(skuId);
    success(res, data);
  }

  async getAvailable(req: Request, res: Response): Promise<void> {
    const skuId = Number(req.params.skuId);
    const data = await this.svc(req).getAvailableStock(skuId);
    success(res, {
      qtyOnHand: data.qtyOnHand.toFixed(4),
      qtyReserved: data.qtyReserved.toFixed(4),
      qtyAvailable: data.qtyAvailable.toFixed(4),
      stockUnit: data.stockUnit,
    });
  }

  async inbound(req: Request, res: Response): Promise<void> {
    const body = InboundSchema.parse(req.body);
    const result = await this.svc(req).inbound(body);
    created(res, result, '入库成功');
  }

  async outbound(req: Request, res: Response): Promise<void> {
    const body = OutboundSchema.parse(req.body);
    const result = await this.svc(req).outbound(body);
    success(res, result, '出库成功');
  }

  async fifoDyeLot(req: Request, res: Response): Promise<void> {
    const skuId = Number(req.params.skuId);
    const qty = z.string().regex(/^\d+(\.\d{1,4})?$/).parse(req.query.qty as string);
    const data = await this.svc(req).recommendFifoDyeLot(skuId, qty);
    success(res, data);
  }

  // BE-P1-005: 库存汇总看板
  async getSummary(req: Request, res: Response): Promise<void> {
    const result = await this.svc(req).getSummary();
    success(res, result);
  }

  // BE-08-08: 库存实时查询（供销售订单页面使用）
  async checkAvailability(req: Request, res: Response): Promise<void> {
    const skuId = z.coerce.number().int().positive().parse(req.query.skuId);
    const qty = req.query.qty ? z.coerce.number().positive().parse(req.query.qty) : undefined;
    const data = await this.svc(req).getAvailableStock(skuId);
    const available = Number(data.qtyAvailable.toFixed(4));
    success(res, {
      available,
      sufficient: qty !== undefined ? available >= qty : true,
      stockUnit: data.stockUnit,
    });
  }

  // BE-P1: 物料损耗记录
  async recordWaste(req: Request, res: Response): Promise<void> {
    const schema = z.object({
      skuId: z.number().int().positive(),
      qty: z.string().regex(/^\d+(\.\d+)?$/),
      reason: z.string().min(1).max(200),
      notes: z.string().max(500).optional(),
    });
    const body = schema.parse(req.body);
    const result = await this.svc(req).recordWaste(body);
    success(res, result, '损耗已记录');
  }

  // BE-P1-003: 盘点接口
  async startStocktake(req: Request, res: Response): Promise<void> {
    const result = await this.svc(req).startStocktake();
    created(res, result, '盘点已开始');
  }

  async submitStocktakeItem(req: Request, res: Response): Promise<void> {
    const schema = z.object({
      skuId: z.number().int().positive(),
      countedQty: z.string().regex(/^\d+(\.\d{1,4})?$/),
    });
    const stocktakeId = Number(req.params.id);
    const body = schema.parse(req.body);
    await this.svc(req).submitStocktakeItem(stocktakeId, body.skuId, body.countedQty);
    success(res, null, '盘点项已提交');
  }

  async getStocktakeDiff(req: Request, res: Response): Promise<void> {
    const stocktakeId = Number(req.params.id);
    const result = await this.svc(req).getStocktakeDiff(stocktakeId);
    success(res, result);
  }
}

export const inventoryController = new InventoryController();
