import { Request, Response } from 'express';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { SupplierService } from './supplier.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';
import { AppError } from '../../shared/AppError';

const ListQuerySchema = PaginationSchema.extend({
  keyword: z.string().max(100).optional(),
  rating: z.enum(['A', 'B', 'C', 'D']).optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

/** 导出筛选参数（与列表相同，无需分页） */
const ExportQuerySchema = z.object({
  keyword: z.string().max(100).optional(),
  rating: z.enum(['A', 'B', 'C', 'D']).optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

/** 绩效对比请求体 */
const CompareBodySchema = z.object({
  supplierIds: z.array(z.number().int().positive()).min(1).max(5),
  months: z.number().int().min(1).max(24).optional().default(6),
});

/**
 * 创建/更新 Schema
 * 同时兼容前端字段名（rating/contactName/contactPhone）和后端字段名（grade/contact/phone）
 */
const CreateSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  // 兼容前端 rating 和后端 grade
  grade: z.enum(['A', 'B', 'C', 'D']).optional(),
  rating: z.enum(['A', 'B', 'C', 'D']).optional(),
  // 兼容前端 contactName 和后端 contact
  contact: z.string().max(100).optional(),
  contactName: z.string().max(100).optional(),
  // 兼容前端 contactPhone 和后端 phone
  phone: z.string().max(30).optional(),
  contactPhone: z.string().max(30).optional(),
  contactEmail: z.string().max(200).optional(),
  address: z.string().max(300).optional(),
  paymentDays: z.number().int().min(0).max(365).optional().nullable(),
  leadDays: z.number().int().min(0).max(365).optional().nullable(),
  category: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  mainSkus: z.array(z.number().int().positive()).optional(),
  isActive: z.boolean().optional(),
});

/**
 * 前后端字段映射层 — 入口：将前端字段名转换为后端数据库字段名
 *
 * 完整映射关系（前端 → 后端）：
 *   rating       → grade        （供应商等级 A/B/C/D）
 *   contactName  → contact      （联系人姓名）
 *   contactPhone → phone        （联系人电话）
 *   isActive     → status       （true → 'active' / false → 'inactive'）
 *
 * 两种命名同时兼容：前端发 rating 或 grade 均可识别，优先取前端字段名。
 */
function normalizePayload(body: z.infer<typeof CreateSchema>) {
  const result: {
    code?: string;
    name?: string;
    grade?: 'A' | 'B' | 'C' | 'D';
    contact?: string;
    phone?: string;
    contactEmail?: string;
    address?: string;
    paymentDays?: number | null;
    leadDays?: number | null;
    category?: string;
    notes?: string;
    mainSkus?: number[];
    status?: 'active' | 'inactive';
  } = {
    code: body.code,
    name: body.name,
    grade: body.rating ?? body.grade,
    contact: body.contactName ?? body.contact,
    phone: body.contactPhone ?? body.phone,
    contactEmail: body.contactEmail,
    address: body.address,
    paymentDays: body.paymentDays,
    leadDays: body.leadDays,
    category: body.category,
    notes: body.notes,
    mainSkus: body.mainSkus,
  };

  // isActive → status 映射（仅在字段明确传入时才设置，避免 undefined 覆盖现有值）
  if (body.isActive !== undefined) {
    result.status = body.isActive ? 'active' : 'inactive';
  }

  return result;
}

/**
 * 前后端字段映射层 — 出口：将后端数据库字段名转换为前端期望的字段名
 *
 * 完整映射关系（后端 → 前端）：
 *   grade   → rating       （同时保留 grade，供内部调试）
 *   contact → contactName  （同时保留 contact，供内部调试）
 *   phone   → contactPhone （同时保留 phone，供内部调试）
 *   status  → isActive     （'active' → true / 其他 → false）
 *
 * 覆盖的 Controller 出口：list / options / getOne / create / update
 */
function toFrontendFormat(entity: Record<string, unknown>) {
  return {
    id: entity.id,
    code: entity.code,
    name: entity.name,
    // 等级：前端使用 rating，同时保留 grade 供调试
    rating: entity.grade,
    grade: entity.grade,
    // 联系人：前端使用 contactName，同时保留 contact 供调试
    contactName: entity.contact,
    contact: entity.contact,
    // 联系电话：前端使用 contactPhone，同时保留 phone 供调试
    contactPhone: entity.phone,
    phone: entity.phone,
    contactEmail: entity.contactEmail,
    address: entity.address,
    paymentDays: entity.paymentDays,
    leadDays: entity.leadDays,
    category: entity.category,
    notes: entity.notes,
    mainSkus: entity.mainSkus,
    // 状态：前端使用 isActive 布尔值，同时保留 status 原始值
    isActive: entity.status === 'active',
    status: entity.status,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export class SupplierController {
  private svc(req: Request): SupplierService {
    return new SupplierService({ tenantId: req.tenantId, userId: req.userId });
  }

  async list(req: Request, res: Response): Promise<void> {
    const q = ListQuerySchema.parse(req.query);
    const [list, total] = await this.svc(req).list({
      page: q.page,
      pageSize: q.pageSize,
      keyword: q.keyword,
      rating: q.rating,
      isActive: q.isActive,
    });
    const mapped = list.map((e) => toFrontendFormat(e as unknown as Record<string, unknown>));
    success(res, buildPaginated(mapped, total, q.page, q.pageSize));
  }

  async options(req: Request, res: Response): Promise<void> {
    const list = await this.svc(req).getOptions();
    const mapped = list.map((e) => toFrontendFormat(e as unknown as Record<string, unknown>));
    success(res, mapped);
  }

  async getOne(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const supplier = await this.svc(req).getById(id);
    success(res, toFrontendFormat(supplier as unknown as Record<string, unknown>));
  }

  async create(req: Request, res: Response): Promise<void> {
    const body = CreateSchema.parse(req.body);
    const params = normalizePayload(body);
    // code/name 经 CreateSchema 校验保证必填，断言类型满足 CreateSupplierParams
    const supplier = await this.svc(req).create(params as Parameters<SupplierService['create']>[0]);
    created(res, toFrontendFormat(supplier as unknown as Record<string, unknown>), '供应商已创建');
  }

  async update(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = CreateSchema.partial().parse(req.body);
    const params = normalizePayload(body as z.infer<typeof CreateSchema>);
    // 过滤掉 undefined 值，只传有值的字段
    const filtered = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined),
    );
    const supplier = await this.svc(req).update(id, filtered);
    success(res, toFrontendFormat(supplier as unknown as Record<string, unknown>), '供应商已更新');
  }

  // BE-P1: 供应商绩效
  async getPerformance(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.svc(req).getPerformance(id);
    success(res, data);
  }

  // 供应商详情 — 关联 SKU 列表
  async getRelatedSkus(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.svc(req).getRelatedSkus(id);
    success(res, data);
  }

  // 供应商详情 — 价格协议列表
  async getPriceAgreements(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.svc(req).getPriceAgreements(id);
    success(res, data);
  }

  // ─── R-02: 供应商导出 Excel ──────────────────────────────────────────────────

  /**
   * GET /api/suppliers/export
   * 将符合筛选条件的供应商（上限5000）导出为 xlsx 文件并流式返回。
   */
  async exportExcel(req: Request, res: Response): Promise<void> {
    const q = ExportQuerySchema.parse(req.query);
    const list = await this.svc(req).exportSuppliers({
      keyword: q.keyword,
      rating: q.rating,
      isActive: q.isActive,
    });

    // ── 构建工作表数据 ────────────────────────────────────────────────────────
    const header = [
      '供应商编码', '供应商名称', '等级', '状态',
      '联系人', '联系电话', '联系邮箱',
      '地址', '账期(天)', '交货周期(天)',
      '品类', '备注', '创建时间',
    ];
    const rows = list.map((s) => [
      s.code,
      s.name,
      s.grade,
      s.status === 'active' ? '启用' : '停用',
      s.contact ?? '',
      s.phone ?? '',
      s.contactEmail ?? '',
      s.address ?? '',
      s.paymentDays ?? '',
      s.leadDays ?? '',
      s.category ?? '',
      s.notes ?? '',
      s.createdAt instanceof Date
        ? s.createdAt.toISOString().slice(0, 19).replace('T', ' ')
        : String(s.createdAt ?? ''),
    ]);

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    // 设置列宽（字符数）
    ws['!cols'] = [
      { wch: 14 }, { wch: 24 }, { wch: 6 }, { wch: 6 },
      { wch: 12 }, { wch: 14 }, { wch: 26 },
      { wch: 30 }, { wch: 10 }, { wch: 12 },
      { wch: 14 }, { wch: 20 }, { wch: 20 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '供应商列表');

    const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const filename = encodeURIComponent(`供应商列表_${new Date().toISOString().slice(0, 10)}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Length', String(xlsxBuf.length));
    res.end(xlsxBuf);
  }

  // ─── R-02: 供应商绩效对比 ────────────────────────────────────────────────────

  /**
   * POST /api/suppliers/compare
   * Body: { supplierIds: number[], months?: number }
   */
  async comparePerformance(req: Request, res: Response): Promise<void> {
    const body = CompareBodySchema.parse(req.body);
    const data = await this.svc(req).comparePerformance(body.supplierIds, body.months);
    success(res, data);
  }

  // BE-P1-013: 月度对账单
  async getMonthlyStatement(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const month = z.string().regex(/^\d{4}-\d{2}$/).parse(req.query.month as string);
    const data = await this.svc(req).getMonthlyStatement(id, month);
    success(res, data);
  }
}

export const supplierController = new SupplierController();
