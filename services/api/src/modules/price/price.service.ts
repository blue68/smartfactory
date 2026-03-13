import * as path from 'path';
import * as XLSX from 'xlsx';
import { AppDataSource } from '../../config/database';
import { PriceEntity } from './price.entity';
import { ImportTaskEntity, ImportErrorDetail } from './import-task.entity';
import { AppError } from '../../shared/AppError';

/** 价格导入单行结构（对应模板列） */
export interface ImportPriceRow {
  supplierCode: string;
  skuCode: string;
  unitPrice: string;
  purchaseUnit: string;
  moq?: string;
  validFrom?: string;
  validTo?: string;
}

/** importPrices 返回摘要 */
export interface ImportPriceResult {
  taskId: number;
  totalRows: number;
  successCount: number;
  failCount: number;
  skipCount: number;
  warningCount: number;
  errors: ImportErrorDetail[];
  warnings: ImportErrorDetail[];
}

export interface PriceListFilter {
  page: number;
  pageSize: number;
  keyword?: string;
  supplierId?: number;
  skuId?: number;
  isActive?: boolean;
}

export interface CreatePriceParams {
  supplierId: number;
  skuId: number;
  unitPrice: string;
  purchaseUnit: string;
  moq?: number;
  validFrom?: string;
  validTo?: string;
  notes?: string;
  taxRate?: string;
  batchPricing?: boolean;
  batchRule?: string;
  attachmentUrl?: string;
}

export class PriceService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: { tenantId: number; userId: number }) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  async list(filter: PriceListFilter): Promise<[any[], number]> {
    const qb = AppDataSource.getRepository(PriceEntity)
      .createQueryBuilder('p')
      .leftJoin('suppliers', 's', 's.id = p.supplier_id')
      .leftJoin('skus', 'k', 'k.id = p.sku_id')
      .select([
        'p.id AS id',
        'p.supplier_id AS supplierId',
        's.name AS supplierName',
        'p.sku_id AS skuId',
        'k.sku_code AS skuCode',
        'k.name AS skuName',
        'p.price AS unitPrice',
        'p.unit AS purchaseUnit',
        'p.is_current AS isActive',
        'p.effective_at AS validFrom',
        'p.expired_at AS validTo',
        'p.moq AS moq',
        'p.notes AS notes',
        'p.tax_rate AS taxRate',
        'p.batch_pricing AS batchPricing',
        'p.batch_rule AS batchRule',
        'p.attachment_url AS attachmentUrl',
        'p.created_at AS createdAt',
        'p.updated_at AS updatedAt',
      ])
      .where('p.tenant_id = :tenantId', { tenantId: this.tenantId });

    if (filter.supplierId) {
      qb.andWhere('p.supplier_id = :supplierId', { supplierId: filter.supplierId });
    }
    if (filter.skuId) {
      qb.andWhere('p.sku_id = :skuId', { skuId: filter.skuId });
    }
    if (filter.isActive !== undefined) {
      qb.andWhere('p.is_current = :isCurrent', { isCurrent: filter.isActive ? 1 : 0 });
    }
    if (filter.keyword) {
      qb.andWhere('(k.name LIKE :kw OR k.sku_code LIKE :kw OR s.name LIKE :kw)', {
        kw: `%${filter.keyword}%`,
      });
    }

    const total = await qb.getCount();
    const list = await qb
      .orderBy('p.created_at', 'DESC')
      .offset((filter.page - 1) * filter.pageSize)
      .limit(filter.pageSize)
      .getRawMany();

    return [list, total];
  }

  async getById(id: number): Promise<PriceEntity> {
    const repo = AppDataSource.getRepository(PriceEntity);
    const price = await repo.findOne({ where: { id, tenantId: this.tenantId } });
    if (!price) throw AppError.notFound('价格记录不存在');
    return price;
  }

  async create(params: CreatePriceParams): Promise<PriceEntity> {
    // 价格异常检测：与历史均价对比（事务外查询，只读，不影响一致性）
    const [avgRow] = await AppDataSource.query(
      `SELECT AVG(price) AS avgPrice FROM supplier_prices
       WHERE tenant_id = ? AND sku_id = ? AND is_current = 0`,
      [this.tenantId, params.skuId],
    ) as Array<{ avgPrice: string | null }>;

    // 将旧价格标记为非当前 + 保存新价格，包裹在事务中保证原子性
    const saved = await AppDataSource.transaction(async (em) => {
      const repo = em.getRepository(PriceEntity);

      // 将该供应商+SKU的旧价格标记为非当前
      await repo.update(
        { tenantId: this.tenantId, supplierId: params.supplierId, skuId: params.skuId, isCurrent: true },
        { isCurrent: false, updatedBy: this.userId },
      );

      const entity = repo.create({
        tenantId: this.tenantId,
        supplierId: params.supplierId,
        skuId: params.skuId,
        price: params.unitPrice,
        unit: params.purchaseUnit ?? '',
        isCurrent: true,
        effectiveAt: params.validFrom ?? null,
        expiredAt: params.validTo ?? null,
        moq: params.moq || null,
        notes: params.notes ?? null,
        taxRate: params.taxRate ?? null,
        batchPricing: params.batchPricing ?? false,
        batchRule: params.batchRule ?? null,
        attachmentUrl: params.attachmentUrl ?? null,
        createdBy: this.userId,
        updatedBy: this.userId,
      });

      return repo.save(entity);
    });

    // 如果价格超历史均价 20%，添加异常标记（返回给前端判断）
    if (avgRow?.avgPrice) {
      const avg = parseFloat(avgRow.avgPrice);
      const current = parseFloat(params.unitPrice);
      if (avg > 0 && current > avg * 1.2) {
        (saved as any).priceAnomaly = true;
        (saved as any).avgPrice = avg.toFixed(4);
      }
    }

    return saved;
  }

  async update(id: number, params: Partial<CreatePriceParams>): Promise<PriceEntity> {
    const price = await this.getById(id);
    const repo = AppDataSource.getRepository(PriceEntity);

    Object.assign(price, {
      ...(params.unitPrice !== undefined ? { price: params.unitPrice } : {}),
      ...(params.purchaseUnit !== undefined ? { unit: params.purchaseUnit } : {}),
      ...(params.validFrom !== undefined ? { effectiveAt: params.validFrom } : {}),
      ...(params.validTo !== undefined ? { expiredAt: params.validTo } : {}),
      ...(params.moq !== undefined ? { moq: params.moq || null } : {}),
      ...(params.notes !== undefined ? { notes: params.notes } : {}),
      ...(params.taxRate !== undefined ? { taxRate: params.taxRate } : {}),
      ...(params.batchPricing !== undefined ? { batchPricing: params.batchPricing } : {}),
      ...(params.batchRule !== undefined ? { batchRule: params.batchRule } : {}),
      ...(params.attachmentUrl !== undefined ? { attachmentUrl: params.attachmentUrl } : {}),
      updatedBy: this.userId,
    });

    return repo.save(price);
  }

  // ─── R-03: 价格导入模板 ──────────────────────────────────────────────────────

  /**
   * 生成价格批量导入 Excel 模板（7列 + 示例数据 + 说明行）。
   * 返回 xlsx Buffer，调用方负责写入响应。
   */
  generateImportTemplate(): Buffer {
    const header = [
      '供应商编码*', 'SKU编码*', '单价*', '采购单位*',
      '最小起订量', '生效日期(YYYY-MM-DD)', '失效日期(YYYY-MM-DD)',
    ];
    const exampleRow = [
      'SUP-001', 'SKU-0001', '88.50', '件',
      '100', '2026-01-01', '2026-12-31',
    ];
    const noteRow = [
      '说明: 带*为必填; 单价保留最多4位小数; 日期格式YYYY-MM-DD; 上限5000行',
      '', '', '', '', '', '',
    ];

    const ws = XLSX.utils.aoa_to_sheet([header, exampleRow, noteRow]);
    ws['!cols'] = [
      { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 22 }, { wch: 22 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '价格导入模板');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  // ─── R-03: 批量导入价格 ──────────────────────────────────────────────────────

  /**
   * 解析 Excel 文件，批量预加载供应商/SKU 字典，逐行校验，事务写入。
   * @param fileBuffer 上传文件的内存 Buffer（multer memoryStorage）
   * @param fileName   原始文件名（用于记录）
   * @param tenantId   租户 ID
   * @param userId     操作用户 ID
   */
  async importPrices(
    fileBuffer: Buffer,
    fileName: string,
    tenantId: number,
    userId: number,
  ): Promise<ImportPriceResult> {
    const taskRepo = AppDataSource.getRepository(ImportTaskEntity);

    // ── 1. 创建导入任务记录（pending）────────────────────────────────────────
    const task = taskRepo.create({
      tenantId,
      type: 'price',
      status: 'processing',
      filePath: '',
      fileName,
      createdBy: userId,
    });
    await taskRepo.save(task);

    try {
      // ── 2. 解析 Excel ──────────────────────────────────────────────────────
      const buf = fileBuffer;
      const wb = XLSX.read(buf, { type: 'buffer' });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw AppError.badRequest('Excel 文件中没有工作表');

      const ws = wb.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, {
        defval: '',
        raw: false,
      });

      // 过滤掉说明行（第一列含"说明:"前缀）
      const dataRows = rawRows.filter((r) => {
        const firstVal = Object.values(r)[0] ?? '';
        return !String(firstVal).startsWith('说明:');
      });

      const IMPORT_LIMIT = 5000;
      if (dataRows.length === 0) {
        await taskRepo.update(task.id, {
          status: 'completed',
          totalRows: 0,
          successCount: 0,
        });
        return {
          taskId: task.id, totalRows: 0, successCount: 0,
          failCount: 0, skipCount: 0, warningCount: 0,
          errors: [], warnings: [],
        };
      }
      if (dataRows.length > IMPORT_LIMIT) {
        await taskRepo.update(task.id, { status: 'failed' });
        throw AppError.badRequest(`导入行数超过上限 ${IMPORT_LIMIT}，当前 ${dataRows.length} 行`);
      }

      // ── 3. 列名映射 ────────────────────────────────────────────────────────
      const COL_MAP: Record<string, keyof ImportPriceRow> = {
        '供应商编码*': 'supplierCode', '供应商编码': 'supplierCode',
        'SKU编码*':   'skuCode',      'SKU编码':   'skuCode',
        '单价*':      'unitPrice',    '单价':      'unitPrice',
        '采购单位*':  'purchaseUnit', '采购单位':  'purchaseUnit',
        '最小起订量':             'moq',
        '生效日期(YYYY-MM-DD)':  'validFrom',
        '失效日期(YYYY-MM-DD)':  'validTo',
      };

      const parsedRows: Array<ImportPriceRow & { _rowNo: number }> = dataRows.map((raw, idx) => {
        const mapped: Partial<ImportPriceRow> = {};
        for (const [col, field] of Object.entries(COL_MAP)) {
          if (raw[col] !== undefined) {
            (mapped as Record<string, string>)[field] = String(raw[col]).trim();
          }
        }
        return { ...(mapped as ImportPriceRow), _rowNo: idx + 1 };
      });

      // ── 4. 批量预加载供应商/SKU 字典（避免 N+1） ──────────────────────────
      const supplierCodes = [...new Set(parsedRows.map((r) => r.supplierCode).filter(Boolean))];
      const skuCodes      = [...new Set(parsedRows.map((r) => r.skuCode).filter(Boolean))];

      const supplierRows = supplierCodes.length > 0
        ? await AppDataSource.query(
            `SELECT id, code FROM suppliers WHERE tenant_id = ? AND code IN (${supplierCodes.map(() => '?').join(',')})`,
            [tenantId, ...supplierCodes],
          ) as Array<{ id: number; code: string }>
        : [];
      const skuRows = skuCodes.length > 0
        ? await AppDataSource.query(
            `SELECT id, sku_code AS skuCode FROM skus WHERE tenant_id = ? AND sku_code IN (${skuCodes.map(() => '?').join(',')})`,
            [tenantId, ...skuCodes],
          ) as Array<{ id: number; skuCode: string }>
        : [];

      const supplierMap = new Map<string, number>(supplierRows.map((r) => [r.code, Number(r.id)]));
      const skuMap      = new Map<string, number>(skuRows.map((r) => [r.skuCode, Number(r.id)]));

      // 批量预加载各 SKU 历史均价（用于异常检测，避免逐行查询）
      const skuIds = [...skuMap.values()];
      const avgPriceMap = new Map<number, number>();
      if (skuIds.length > 0) {
        const avgRows = await AppDataSource.query(
          `SELECT sku_id, AVG(price) AS avgPrice FROM supplier_prices
           WHERE tenant_id = ? AND sku_id IN (${skuIds.map(() => '?').join(',')}) AND is_current = 0
           GROUP BY sku_id`,
          [tenantId, ...skuIds],
        ) as Array<{ sku_id: number; avgPrice: string }>;
        for (const r of avgRows) {
          avgPriceMap.set(Number(r.sku_id), parseFloat(r.avgPrice ?? '0'));
        }
      }

      // ── 5. 逐行校验 ───────────────────────────────────────────────────────
      const errors: ImportErrorDetail[]   = [];
      const warnings: ImportErrorDetail[] = [];
      type ValidRow = {
        rowNo: number; supplierId: number; skuId: number;
        unitPrice: string; purchaseUnit: string; moq: number | null;
        validFrom: string | null; validTo: string | null;
        priceAnomaly: boolean;
      };
      const validRows: ValidRow[] = [];

      for (const row of parsedRows) {
        const rowNo = row._rowNo;

        // 必填校验
        if (!row.supplierCode) {
          errors.push({ row: rowNo, column: '供应商编码', message: '供应商编码不能为空', type: 'error' });
          continue;
        }
        if (!row.skuCode) {
          errors.push({ row: rowNo, column: 'SKU编码', message: 'SKU编码不能为空', type: 'error' });
          continue;
        }
        if (!row.unitPrice) {
          errors.push({ row: rowNo, column: '单价', message: '单价不能为空', type: 'error' });
          continue;
        }
        if (!row.purchaseUnit) {
          errors.push({ row: rowNo, column: '采购单位', message: '采购单位不能为空', type: 'error' });
          continue;
        }

        // 字典查找
        const supplierId = supplierMap.get(row.supplierCode);
        if (!supplierId) {
          errors.push({ row: rowNo, column: '供应商编码', message: `供应商编码 ${row.supplierCode} 不存在`, type: 'error' });
          continue;
        }
        const skuId = skuMap.get(row.skuCode);
        if (!skuId) {
          errors.push({ row: rowNo, column: 'SKU编码', message: `SKU编码 ${row.skuCode} 不存在`, type: 'error' });
          continue;
        }

        // 单价格式
        if (!/^\d+(\.\d{1,4})?$/.test(row.unitPrice)) {
          errors.push({ row: rowNo, column: '单价', message: `单价格式非法: ${row.unitPrice}`, type: 'error' });
          continue;
        }

        // 日期格式（可选）
        const dateReg = /^\d{4}-\d{2}-\d{2}$/;
        if (row.validFrom && !dateReg.test(row.validFrom)) {
          errors.push({ row: rowNo, column: '生效日期', message: `生效日期格式非法: ${row.validFrom}`, type: 'error' });
          continue;
        }
        if (row.validTo && !dateReg.test(row.validTo)) {
          errors.push({ row: rowNo, column: '失效日期', message: `失效日期格式非法: ${row.validTo}`, type: 'error' });
          continue;
        }

        // MOQ（可选，整数）
        let moq: number | null = null;
        if (row.moq && row.moq !== '') {
          moq = parseInt(row.moq, 10);
          if (isNaN(moq) || moq < 0) {
            errors.push({ row: rowNo, column: '最小起订量', message: `最小起订量必须为非负整数`, type: 'error' });
            continue;
          }
        }

        // 价格异常检测（超历史均价 20% → warning，不阻断）
        const avg = avgPriceMap.get(skuId) ?? 0;
        const current = parseFloat(row.unitPrice);
        let priceAnomaly = false;
        if (avg > 0 && current > avg * 1.2) {
          priceAnomaly = true;
          warnings.push({
            row: rowNo,
            column: '单价',
            message: `单价 ${row.unitPrice} 超历史均价(${avg.toFixed(4)})20%`,
            type: 'warning',
          });
        }

        validRows.push({
          rowNo, supplierId, skuId,
          unitPrice: row.unitPrice,
          purchaseUnit: row.purchaseUnit,
          moq,
          validFrom: row.validFrom || null,
          validTo: row.validTo || null,
          priceAnomaly,
        });
      }

      // ── 6. 事务写入合法行 ─────────────────────────────────────────────────
      let successCount = 0;
      if (validRows.length > 0) {
        await AppDataSource.transaction(async (em) => {
          const priceRepo = em.getRepository(PriceEntity);

          for (const vr of validRows) {
            // 将旧价格标记为非当前
            await priceRepo.update(
              { tenantId, supplierId: vr.supplierId, skuId: vr.skuId, isCurrent: true },
              { isCurrent: false, updatedBy: userId },
            );
            // 插入新价格
            const entity = priceRepo.create({
              tenantId,
              supplierId: vr.supplierId,
              skuId: vr.skuId,
              price: vr.unitPrice,
              unit: vr.purchaseUnit,
              isCurrent: true,
              effectiveAt: vr.validFrom,
              expiredAt: vr.validTo,
              moq: vr.moq,
              notes: vr.priceAnomaly ? '【价格异常】超历史均价20%' : null,
              createdBy: userId,
              updatedBy: userId,
            });
            await priceRepo.save(entity);
            successCount++;
          }
        });
      }

      // ── 7. 更新任务状态 ───────────────────────────────────────────────────
      await taskRepo.update(task.id, {
        status: 'completed',
        totalRows: parsedRows.length,
        successCount,
        failCount: errors.length,
        skipCount: 0,
        warningCount: warnings.length,
        errorDetails: errors.length > 0 ? errors : null,
        warningDetails: warnings.length > 0 ? warnings : null,
      });

      return {
        taskId: task.id,
        totalRows: parsedRows.length,
        successCount,
        failCount: errors.length,
        skipCount: 0,
        warningCount: warnings.length,
        errors,
        warnings,
      };
    } catch (err) {
      // 标记任务失败
      await taskRepo.update(task.id, { status: 'failed' });
      throw err;
    }
  }

  // ─── R-03: 查询导入任务状态 ──────────────────────────────────────────────────

  /**
   * 查询导入任务进度，校验租户归属。
   */
  async getImportTaskStatus(taskId: number): Promise<ImportTaskEntity> {
    const repo = AppDataSource.getRepository(ImportTaskEntity);
    const task = await repo.findOne({ where: { id: taskId, tenantId: this.tenantId } });
    if (!task) throw AppError.notFound('导入任务不存在');
    return task;
  }

  // BE-P1-014: 采购价格历史
  async getPriceHistory(skuId: number, supplierId?: number): Promise<Array<{
    price: string; unit: string; supplierName: string; effectiveAt: string;
  }>> {
    let sql = `SELECT sp.price, sp.unit, s.name AS supplier_name, sp.effective_at
       FROM supplier_prices sp
       INNER JOIN suppliers s ON s.id = sp.supplier_id
       WHERE sp.tenant_id = ? AND sp.sku_id = ?`;
    const params: unknown[] = [this.tenantId, skuId];
    if (supplierId) {
      sql += ' AND sp.supplier_id = ?';
      params.push(supplierId);
    }
    sql += ' ORDER BY sp.effective_at DESC LIMIT 50';
    const rows = await AppDataSource.query(sql, params);
    return rows.map((r: Record<string, unknown>) => ({
      price: String(r.price),
      unit: String(r.unit),
      supplierName: String(r.supplier_name),
      effectiveAt: String(r.effective_at),
    }));
  }
}
