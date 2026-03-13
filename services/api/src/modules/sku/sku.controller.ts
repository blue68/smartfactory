import { Request, Response } from 'express';
import { z } from 'zod';
import { parse as csvParse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { SkuService, ImportSkuRow } from './sku.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { AppError } from '../../shared/AppError';
import { PaginationSchema } from '../../middleware/validator';

// ─── CSV 模板默认列顺序 ─────────────────────────────────────────────────────────
// SKU编码,物料名称,规格型号,一级分类,二级分类,基本单位,采购单位,计价单位,安全库存,状态,备注
const DEFAULT_COLUMN_MAP: Record<string, keyof ImportSkuRow> = {
  'SKU编码':  'skuCode',
  '物料名称': 'name',
  '规格型号': 'spec',
  '一级分类': 'category1Code',
  '二级分类': 'category2Code',
  '基本单位': 'stockUnit',
  '采购单位': 'purchaseUnit',
  '计价单位': 'productionUnit',
  '安全库存': 'safetyStock',
  '状态':    'status',
  '备注':    'description',
};

const CreateSkuSchema = z.object({
  skuCode: z.string().max(50).optional(),
  barcode: z.string().max(100).optional(),
  name: z.string().min(1).max(200),
  spec: z.string().max(500).optional(),
  category1Id: z.number().int().positive(),
  category2Id: z.number().int().positive(),
  stockUnit: z.string().min(1).max(20),
  purchaseUnit: z.string().min(1).max(20),
  productionUnit: z.string().min(1).max(20),
  stockConvFactor: z.number().optional(),
  prodConvNote: z.string().max(200).optional(),
  hasDyeLot: z.boolean().optional(),
  useFifo: z.boolean().optional(),
  safetyStock: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
  description: z.string().optional(),
});

const ListSkuQuerySchema = PaginationSchema.extend({
  category1Id: z.coerce.number().int().positive().optional(),
  category2Id: z.coerce.number().int().positive().optional(),
  keyword: z.string().max(100).optional(),
  hasDyeLot: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

const BatchStatusSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(200),
  status: z.enum(['active', 'inactive']),
});

const BatchSafetyStockSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(200),
  safetyStock: z.number().min(0).max(999999999),
});

const UnitConversionSchema = z.object({
  conversions: z.array(z.object({
    fromUnit: z.string().min(1).max(20),
    toUnit: z.string().min(1).max(20),
    conversionRate: z.string().regex(/^\d+(\.\d{1,6})?$/),
    description: z.string().max(100).optional(),
  })).min(1),
});

export class SkuController {
  private svc(req: Request): SkuService {
    return new SkuService({ tenantId: req.tenantId, userId: req.userId });
  }

  async list(req: Request, res: Response): Promise<void> {
    const q = ListSkuQuerySchema.parse(req.query);
    const [list, total] = await this.svc(req).listSkus({
      page: q.page,
      pageSize: q.pageSize,
      category1Id: q.category1Id,
      category2Id: q.category2Id,
      keyword: q.keyword,
      hasDyeLot: q.hasDyeLot,
      status: q.status,
    });
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async getOne(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const sku = await this.svc(req).getSkuById(id);
    success(res, sku);
  }

  async create(req: Request, res: Response): Promise<void> {
    const body = CreateSkuSchema.parse(req.body);
    const sku = await this.svc(req).createSku(body);
    created(res, sku, 'SKU已创建');
  }

  async update(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = CreateSkuSchema.partial().extend({
      status: z.enum(['active', 'inactive']).optional(),
    }).parse(req.body);
    const sku = await this.svc(req).updateSku(id, body);
    success(res, sku, 'SKU已更新');
  }

  async setUnitConversions(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const { conversions } = UnitConversionSchema.parse(req.body);
    const result = await this.svc(req).setUnitConversions(id, conversions);
    success(res, result, '单位换算关系已保存');
  }

  async getStats(req: Request, res: Response): Promise<void> {
    const stats = await this.svc(req).getSkuStats();
    success(res, stats);
  }

  async batchUpdateStatus(req: Request, res: Response): Promise<void> {
    const body = BatchStatusSchema.parse(req.body);
    const result = await this.svc(req).batchUpdateStatus(body.ids, body.status);
    success(res, result, `已批量更新 ${result.affected} 条 SKU 状态`);
  }

  async batchUpdateSafetyStock(req: Request, res: Response): Promise<void> {
    const body = BatchSafetyStockSchema.parse(req.body);
    const result = await this.svc(req).batchUpdateSafetyStock(body.ids, body.safetyStock);
    success(res, result, `已批量更新 ${result.affected} 条 SKU 安全库存`);
  }

  async getCategories(req: Request, res: Response): Promise<void> {
    const categories = await this.svc(req).getCategories();
    success(res, categories);
  }

  /**
   * GET /api/skus/export
   * 将符合筛选条件的 SKU（上限5000）导出为 xlsx 文件。
   * 查询参数与 list 接口保持一致（category1Id, category2Id, keyword, hasDyeLot, status）。
   */
  async exportExcel(req: Request, res: Response): Promise<void> {
    const q = ListSkuQuerySchema.omit({ page: true, pageSize: true }).parse(req.query);

    const list = await this.svc(req).exportSkus({
      category1Id: q.category1Id,
      category2Id: q.category2Id,
      keyword: q.keyword,
      hasDyeLot: q.hasDyeLot,
      status: q.status,
    });

    const header = [
      'SKU编码', '物料名称', '规格型号',
      '一级分类', '二级分类',
      '基本单位', '采购单位', '计价单位',
      '安全库存', '状态', '缸号管理', '备注', '创建时间',
    ];

    const rows = list.map((s) => [
      s.skuCode ?? '',
      s.name ?? '',
      s.spec ?? '',
      s.category1Name ?? '',
      s.category2Name ?? '',
      s.stockUnit ?? '',
      s.purchaseUnit ?? '',
      s.productionUnit ?? '',
      s.safetyStock ?? '0',
      s.status === 'active' ? '启用' : '停用',
      s.hasDyeLot ? '是' : '否',
      s.description ?? '',
      s.createdAt instanceof Date
        ? s.createdAt.toISOString().slice(0, 19).replace('T', ' ')
        : String(s.createdAt ?? ''),
    ]);

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = [
      { wch: 14 }, { wch: 24 }, { wch: 16 },
      { wch: 12 }, { wch: 12 },
      { wch: 8  }, { wch: 8  }, { wch: 8  },
      { wch: 10 }, { wch: 6  }, { wch: 10 }, { wch: 20 }, { wch: 20 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SKU列表');

    const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const filename = encodeURIComponent(`skus_${Date.now()}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Length', String(xlsxBuf.length));
    res.end(xlsxBuf);
  }

  /**
   * POST /api/skus/import
   * multipart/form-data: file (CSV 或 xlsx), mapping (optional JSON)
   *
   * 文件类型通过 buffer 魔数自动检测：
   *   - xlsx/zip: 起始字节 0x50 0x4B (PK)
   *   - 其余均作为 CSV 处理
   */
  async importSkus(req: Request, res: Response): Promise<void> {
    // 1. 文件校验
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      throw AppError.badRequest('请上传 CSV 或 Excel 文件');
    }

    // 2. 通过魔数检测文件类型（xlsx 是 ZIP 格式，起始字节为 PK = 0x50 0x4B）
    const buf = file.buffer;
    const isXlsx = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b;

    // 3. 根据文件类型选择解析策略，统一输出 Record<string, string>[]
    let rawRows: Record<string, string>[];
    try {
      if (isXlsx) {
        // ── xlsx 分支 ───────────────────────────────────────────────────────
        const workbook = XLSX.read(buf, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          throw new Error('Excel 文件中没有工作表');
        }
        const ws = workbook.Sheets[sheetName];
        // defval: '' 保证缺失单元格以空字符串填充，与 csv-parse 行为一致
        rawRows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, {
          defval: '',
          raw: false, // 所有值转为字符串（日期、数字等统一处理）
        });
      } else {
        // ── CSV 分支（保持原有逻辑）────────────────────────────────────────
        // 剥离 UTF-8 BOM（EF BB BF）
        let csvBuffer = buf;
        if (
          csvBuffer.length >= 3 &&
          csvBuffer[0] === 0xef &&
          csvBuffer[1] === 0xbb &&
          csvBuffer[2] === 0xbf
        ) {
          csvBuffer = csvBuffer.subarray(3);
        }
        const csvText = csvBuffer.toString('utf-8');

        rawRows = csvParse(csvText, {
          columns:            true,
          skip_empty_lines:   true,
          trim:               true,
          relax_column_count: true, // 容忍列数不一致
        }) as Record<string, string>[];
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '未知解析错误';
      throw AppError.badRequest(`文件解析失败: ${msg}`);
    }

    if (rawRows.length === 0) {
      success(res, { imported: 0, failed: 0, errors: [] }, '导入完成，文件无有效数据行');
      return;
    }

    // 4. 解析前端传入的 mapping 字段（可选），格式: { "前端列名": "templateColName" }
    //    目前前端按模板列名传输，此处解析后备用，默认仍用 DEFAULT_COLUMN_MAP
    let columnMap: Record<string, keyof ImportSkuRow> = { ...DEFAULT_COLUMN_MAP };
    const mappingRaw = (req.body as Record<string, string>)?.mapping;
    if (mappingRaw) {
      try {
        const userMapping: Record<string, string> = JSON.parse(mappingRaw);
        // userMapping: { "用户文件列名": "模板列名" }
        // 将用户列名 → templateColName → ImportSkuRow field 建立映射
        const resolved: Record<string, keyof ImportSkuRow> = {};
        for (const [userCol, templateCol] of Object.entries(userMapping)) {
          const field = DEFAULT_COLUMN_MAP[templateCol];
          if (field) resolved[userCol] = field;
        }
        if (Object.keys(resolved).length > 0) {
          columnMap = resolved;
        }
      } catch {
        // mapping 解析失败时静默降级，使用默认列映射
      }
    }

    // 5. 将原始行转换为 ImportSkuRow 结构
    const importRows: ImportSkuRow[] = rawRows.map((raw) => {
      const mapped: Partial<ImportSkuRow> = {};
      for (const [colName, field] of Object.entries(columnMap)) {
        const val = raw[colName];
        if (val !== undefined) {
          (mapped as Record<string, string>)[field] = val;
        }
      }
      return mapped as ImportSkuRow;
    });

    // 6. 调用 service 执行批量导入
    const result = await this.svc(req).importSkus(importRows);

    success(res, result, '导入完成');
  }
}

export const skuController = new SkuController();
