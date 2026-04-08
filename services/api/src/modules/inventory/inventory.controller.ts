import { Request, Response } from 'express';
import { z } from 'zod';
import { InventoryService } from './inventory.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';
import { AppError } from '../../shared/AppError';

const InboundSchema = z.object({
  skuId: z.number().int().positive().optional(),
  skuCode: z.string().trim().min(1).max(100).optional(),
  warehouseId: z.number().int().positive().optional(),
  locationId: z.number().int().positive().optional(),
  qtyInput: z.string().regex(/^\d+(\.\d{1,4})?$/),
  inputUnit: z.string().min(1).max(20),
  transactionType: z.enum(['PURCHASE_IN', 'PRODUCTION_IN', 'ADJUSTMENT_IN']),
  dyeLotNo: z.string().max(50).optional(),
  referenceType: z.string().max(50).optional(),
  referenceId: z.number().int().positive().optional(),
  referenceNo: z.string().max(50).optional(),
  batchCost: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  notes: z.string().max(500).optional(),
}).refine(
  (value) => Boolean(value.skuId) || Boolean(value.skuCode),
  'skuId 或 skuCode 至少传一个',
);

const OutboundSchema = z.object({
  skuId: z.number().int().positive(),
  warehouseId: z.number().int().positive().optional(),
  locationId: z.number().int().positive().optional(),
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
  warehouseId: z.coerce.number().int().positive().optional(),
  locationId: z.coerce.number().int().positive().optional(),
  onlyDefaultLocation: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  keyword: z.string().max(100).optional(),
  belowSafety: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

const ListDailySnapshotSchema = PaginationSchema.extend({
  snapshotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  skuId: z.coerce.number().int().positive().optional(),
  keyword: z.string().max(100).optional(),
});

const ListInventoryTransactionsSchema = PaginationSchema.extend({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  warehouseId: z.coerce.number().int().positive().optional(),
  locationId: z.coerce.number().int().positive().optional(),
  keyword: z.string().max(100).optional(),
});

const ListWarehouseSchema = z.object({
  onlyActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

const ListLocationSchema = z.object({
  warehouseId: z.coerce.number().int().positive().optional(),
  onlyActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

const MasterDataStatusSchema = z.enum(['active', 'inactive', 'locked', 'archived']);
const LocationTypeSchema = z.enum(['general', 'zone', 'rack', 'shelf', 'bin']);

const CreateWarehouseSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(100),
  type: z.string().trim().max(30).optional(),
  plantCode: z.string().trim().max(50).optional(),
  status: MasterDataStatusSchema.default('active'),
});

const UpdateWarehouseSchema = z.object({
  code: z.string().trim().min(1).max(50).optional(),
  name: z.string().trim().min(1).max(100).optional(),
  type: z.string().trim().max(30).optional(),
  plantCode: z.string().trim().max(50).optional(),
  status: MasterDataStatusSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, '至少传入一个更新字段');

const CreateLocationSchema = z.object({
  warehouseId: z.number().int().positive(),
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(100),
  locationType: LocationTypeSchema.default('general'),
  aisleCode: z.string().trim().max(30).optional(),
  rackCode: z.string().trim().max(30).optional(),
  shelfCode: z.string().trim().max(30).optional(),
  binCode: z.string().trim().max(30).optional(),
  level: z.number().int().min(1).max(9).default(1),
  parentId: z.number().int().positive().optional(),
  status: MasterDataStatusSchema.default('active'),
});

const UpdateLocationSchema = z.object({
  warehouseId: z.number().int().positive().optional(),
  code: z.string().trim().min(1).max(50).optional(),
  name: z.string().trim().min(1).max(100).optional(),
  locationType: LocationTypeSchema.optional(),
  aisleCode: z.string().trim().max(30).optional(),
  rackCode: z.string().trim().max(30).optional(),
  shelfCode: z.string().trim().max(30).optional(),
  binCode: z.string().trim().max(30).optional(),
  level: z.number().int().min(1).max(9).optional(),
  parentId: z.number().int().positive().nullable().optional(),
  status: MasterDataStatusSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, '至少传入一个更新字段');

const ImportCsvQuerySchema = z.object({
  downloadFailed: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

const RebuildSnapshotSchema = z.object({
  snapshotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  skuId: z.number().int().positive().optional(),
  skuIds: z.array(z.number().int().positive()).min(1).max(200).optional(),
  dryRun: z.boolean().optional(),
}).refine(
  (value) => !(value.skuId && value.skuIds),
  'skuId 和 skuIds 不能同时传入',
);

const ReconcileInventorySchema = z.object({
  skuId: z.number().int().positive().optional(),
  skuIds: z.array(z.number().int().positive()).min(1).max(200).optional(),
  dryRun: z.boolean().default(true),
  includeReserved: z.boolean().default(false),
  includeInTransit: z.boolean().default(false),
}).refine(
  (value) => !(value.skuId && value.skuIds),
  'skuId 和 skuIds 不能同时传入',
);

const RepairInventorySchema = z.object({
  snapshotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  skuId: z.number().int().positive().optional(),
  skuIds: z.array(z.number().int().positive()).min(1).max(200).optional(),
  dryRun: z.boolean().default(true),
  includeReserved: z.boolean().default(true),
  includeInTransit: z.boolean().default(true),
}).refine(
  (value) => !(value.skuId && value.skuIds),
  'skuId 和 skuIds 不能同时传入',
);

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

  async listWarehouses(req: Request, res: Response): Promise<void> {
    const q = ListWarehouseSchema.parse(req.query);
    const list = await this.svc(req).listWarehouses(q.onlyActive ?? true);
    success(res, list);
  }

  async listLocations(req: Request, res: Response): Promise<void> {
    const q = ListLocationSchema.parse(req.query);
    const list = await this.svc(req).listLocations({
      warehouseId: q.warehouseId,
      onlyActive: q.onlyActive ?? true,
    });
    success(res, list);
  }

  async createWarehouse(req: Request, res: Response): Promise<void> {
    const body = CreateWarehouseSchema.parse(req.body ?? {});
    const data = await this.svc(req).createWarehouse(body);
    created(res, data, '仓库创建成功');
  }

  async updateWarehouse(req: Request, res: Response): Promise<void> {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const body = UpdateWarehouseSchema.parse(req.body ?? {});
    const data = await this.svc(req).updateWarehouse(id, body);
    success(res, data, '仓库更新成功');
  }

  async deleteWarehouse(req: Request, res: Response): Promise<void> {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const data = await this.svc(req).deleteWarehouse(id);
    success(res, data, '仓库删除成功');
  }

  async createLocation(req: Request, res: Response): Promise<void> {
    const body = CreateLocationSchema.parse(req.body ?? {});
    const data = await this.svc(req).createLocation(body);
    created(res, data, '库位创建成功');
  }

  async updateLocation(req: Request, res: Response): Promise<void> {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const body = UpdateLocationSchema.parse(req.body ?? {});
    const data = await this.svc(req).updateLocation(id, body);
    success(res, data, '库位更新成功');
  }

  async deleteLocation(req: Request, res: Response): Promise<void> {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const data = await this.svc(req).deleteLocation(id);
    success(res, data, '库位删除成功');
  }

  async downloadWarehouseImportTemplateCsv(req: Request, res: Response): Promise<void> {
    const csv = this.svc(req).generateWarehouseImportTemplateCsv();
    this.sendCsvAttachment(res, 'warehouse-import-template.csv', csv);
  }

  async importWarehousesCsv(req: Request, res: Response): Promise<void> {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file?.buffer) {
      throw AppError.badRequest('请上传 CSV 文件');
    }

    const q = ImportCsvQuerySchema.parse(req.query);
    const result = await this.svc(req).importWarehousesFromCsv(file.buffer);
    if (q.downloadFailed && result.failCount > 0) {
      this.sendCsvAttachment(
        res,
        `warehouse-import-failures-${Date.now()}.csv`,
        this.buildFailureCsv(
          result.failures,
          ['code', 'name', 'type', 'plantCode', 'status'],
        ),
      );
      return;
    }
    success(res, result, `仓库导入完成：成功 ${result.successCount} 条，失败 ${result.failCount} 条`);
  }

  async downloadLocationImportTemplateCsv(req: Request, res: Response): Promise<void> {
    const csv = this.svc(req).generateLocationImportTemplateCsv();
    this.sendCsvAttachment(res, 'location-import-template.csv', csv);
  }

  async importLocationsCsv(req: Request, res: Response): Promise<void> {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file?.buffer) {
      throw AppError.badRequest('请上传 CSV 文件');
    }

    const q = ImportCsvQuerySchema.parse(req.query);
    const result = await this.svc(req).importLocationsFromCsv(file.buffer);
    if (q.downloadFailed && result.failCount > 0) {
      this.sendCsvAttachment(
        res,
        `location-import-failures-${Date.now()}.csv`,
        this.buildFailureCsv(
          result.failures,
          [
            'warehouseCode',
            'code',
            'name',
            'locationType',
            'aisleCode',
            'rackCode',
            'shelfCode',
            'binCode',
            'level',
            'parentCode',
            'status',
          ],
        ),
      );
      return;
    }
    success(res, result, `库位导入完成：成功 ${result.successCount} 条，失败 ${result.failCount} 条`);
  }

  async listDailySnapshots(req: Request, res: Response): Promise<void> {
    const q = ListDailySnapshotSchema.parse(req.query);
    const { list, total, snapshotDate } = await this.svc(req).listDailySnapshots(q);
    success(res, {
      ...buildPaginated(list, total, q.page, q.pageSize),
      snapshotDate,
    });
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

  async listTransactions(req: Request, res: Response): Promise<void> {
    const skuId = z.coerce.number().int().positive().parse(req.params.skuId);
    const q = ListInventoryTransactionsSchema.parse(req.query);
    const result = await this.svc(req).listTransactions(skuId, q);
    success(res, {
      skuId: result.skuId,
      skuCode: result.skuCode,
      skuName: result.skuName,
      stockUnit: result.stockUnit,
      ...buildPaginated(result.list, result.total, q.page, q.pageSize),
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
      warehouseId: z.number().int().positive().optional(),
      locationId: z.number().int().positive().optional(),
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

  async rebuildSnapshots(req: Request, res: Response): Promise<void> {
    const body = RebuildSnapshotSchema.parse(req.body ?? {});
    const result = await this.svc(req).rebuildDailySnapshots(body);
    success(
      res,
      result,
      body.dryRun ? '库存日结快照预览完成' : '库存日结快照已重建',
    );
  }

  async reconcileInventory(req: Request, res: Response): Promise<void> {
    const body = ReconcileInventorySchema.parse(req.body ?? {});
    const result = await this.svc(req).reconcileInventoryBalances(body);
    success(
      res,
      result,
      body.dryRun ? '库存账本差异预览完成' : '库存账本已对账修复',
    );
  }

  async repairInventory(req: Request, res: Response): Promise<void> {
    const body = RepairInventorySchema.parse(req.body ?? {});
    const result = await this.svc(req).repairInventoryState(body);
    success(
      res,
      result,
      body.dryRun ? '库存修复预览完成' : '库存修复已执行',
    );
  }

  private sendCsvAttachment(res: Response, filename: string, content: string): void {
    const encodedFilename = encodeURIComponent(filename);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`);
    res.send(`\uFEFF${content}`);
  }

  private buildFailureCsv(
    failures: Array<{ rowNo: number; reason: string; row: Record<string, string> }>,
    fields: string[],
  ): string {
    const escape = (value: string): string => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const header = ['rowNo', 'reason', ...fields];
    const lines = [header.map(escape).join(',')];
    failures.forEach((failure) => {
      const values = [
        String(failure.rowNo),
        failure.reason,
        ...fields.map((field) => failure.row[field] ?? ''),
      ];
      lines.push(values.map(escape).join(','));
    });
    return lines.join('\n');
  }
}

export const inventoryController = new InventoryController();
