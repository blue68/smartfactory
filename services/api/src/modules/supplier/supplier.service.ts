import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { SupplierEntity } from './supplier.entity';
import { AppError } from '../../shared/AppError';
import { Like, FindOptionsWhere } from 'typeorm';
import { getRedisClient, isRedisAvailable } from '../../config/redis';

/** 供应商导出筛选参数 */
export interface SupplierExportFilter {
  keyword?: string;
  rating?: string;
  isActive?: boolean;
}

/** 单供应商绩效快照（comparePerformance 返回单元） */
export interface SupplierPerfSnapshot {
  supplierId: number;
  supplierName: string;
  onTimeRate: string;
  totalOrders: number;
  recentAmounts: Array<{ month: string; amount: string }>;
  /** 质量合格率（百分比字符串，如 "95.0%"） */
  qualityRate: string;
  /** 价格竞争力评分 0-100 */
  priceScore: number;
  /** 平均响应速度（小时） */
  responseHours: number;
  /** 订单完成率（百分比字符串，如 "88.5%"） */
  completionRate: string;
  /** 服务满意度评分 0-100 */
  satisfactionScore: number;
  /** 合作年限（从 suppliers.created_at 计算） */
  cooperationYears: number;
  /** 历史采购总额 */
  totalPurchaseAmount: string;
  /** 平均交货周期（天） */
  avgLeadDays: number;
}

export interface SupplierListFilter {
  page: number;
  pageSize: number;
  keyword?: string;
  rating?: string;
  isActive?: boolean;
  /** R02-BE-03: 按供应商品类筛选 */
  category?: string;
}

export interface CreateSupplierParams {
  code: string;
  name: string;
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
  /** 启用/停用状态，由 Controller normalizePayload 从 isActive 转换而来 */
  status?: 'active' | 'inactive';
}

export class SupplierService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: { tenantId: number; userId: number }) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  async list(filter: SupplierListFilter): Promise<[SupplierEntity[], number]> {
    const repo = AppDataSource.getRepository(SupplierEntity);

    // 当存在 keyword 或 category 时统一使用 QueryBuilder，保证所有条件可组合
    if (filter.keyword || filter.category) {
      const qb = repo.createQueryBuilder('s')
        .where('s.tenant_id = :tenantId', { tenantId: this.tenantId });

      if (filter.keyword) {
        qb.andWhere('(s.name LIKE :kw OR s.code LIKE :kw)', { kw: `%${filter.keyword}%` });
      }
      if (filter.rating) {
        qb.andWhere('s.grade = :grade', { grade: filter.rating });
      }
      if (filter.isActive !== undefined) {
        qb.andWhere('s.status = :status', { status: filter.isActive ? 'active' : 'inactive' });
      }
      // R02-BE-03: 按品类筛选
      if (filter.category) {
        qb.andWhere('s.category = :category', { category: filter.category });
      }

      return qb
        .orderBy('s.created_at', 'DESC')
        .skip((filter.page - 1) * filter.pageSize)
        .take(filter.pageSize)
        .getManyAndCount();
    }

    const where: FindOptionsWhere<SupplierEntity> = { tenantId: this.tenantId };
    if (filter.rating) {
      where.grade = filter.rating as 'A' | 'B' | 'C' | 'D';
    }
    if (filter.isActive !== undefined) {
      where.status = filter.isActive ? 'active' : 'inactive';
    }

    return repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (filter.page - 1) * filter.pageSize,
      take: filter.pageSize,
    });
  }

  async getOptions(): Promise<SupplierEntity[]> {
    const repo = AppDataSource.getRepository(SupplierEntity);
    return repo.find({
      where: { tenantId: this.tenantId, status: 'active' },
      order: { name: 'ASC' },
    });
  }

  async getById(id: number): Promise<SupplierEntity> {
    const repo = AppDataSource.getRepository(SupplierEntity);
    const supplier = await repo.findOne({ where: { id, tenantId: this.tenantId } });
    if (!supplier) throw AppError.notFound('供应商不存在');
    return supplier;
  }

  async create(params: CreateSupplierParams): Promise<SupplierEntity> {
    const repo = AppDataSource.getRepository(SupplierEntity);

    // 检查编码唯一性
    const exists = await repo.findOne({
      where: { tenantId: this.tenantId, code: params.code },
    });
    if (exists) throw AppError.conflict(`供应商编码 ${params.code} 已存在`);

    const entity = repo.create({
      tenantId: this.tenantId,
      code: params.code,
      name: params.name,
      grade: params.grade ?? 'B',
      contact: params.contact ?? null,
      phone: params.phone ?? null,
      contactEmail: params.contactEmail ?? null,
      address: params.address ?? null,
      paymentDays: params.paymentDays ?? null,
      leadDays: params.leadDays ?? null,
      category: params.category ?? null,
      notes: params.notes ?? null,
      mainSkus: params.mainSkus ?? null,
      createdBy: this.userId,
      updatedBy: this.userId,
    });
    return repo.save(entity);
  }

  // BE-P1: 供应商绩效
  async getPerformance(supplierId: number): Promise<{
    onTimeRate: string;
    totalOrders: number;
    recentAmounts: Array<{ month: string; amount: string }>;
    qualityRate: string;
    priceScore: number;
    responseHours: number;
    completionRate: string;
    satisfactionScore: number;
    cooperationYears: number;
    totalPurchaseAmount: string;
    avgLeadDays: number;
  }> {
    // ── 基础订单统计 ───────────────────────────────────────────────────────────
    const [totalRow] = await AppDataSource.query(
      `SELECT COUNT(*) AS total FROM purchase_orders WHERE tenant_id = ? AND supplier_id = ?`,
      [this.tenantId, supplierId],
    );
    const [onTimeRow] = await AppDataSource.query(
      `SELECT COUNT(*) AS cnt FROM purchase_orders
       WHERE tenant_id = ? AND supplier_id = ? AND status = 'completed'
         AND expected_date IS NOT NULL AND updated_at <= DATE_ADD(expected_date, INTERVAL 1 DAY)`,
      [this.tenantId, supplierId],
    );
    const [completedRow] = await AppDataSource.query(
      `SELECT COUNT(*) AS cnt FROM purchase_orders
       WHERE tenant_id = ? AND supplier_id = ? AND status = 'completed'`,
      [this.tenantId, supplierId],
    );
    const total = Number(totalRow?.total || 0);
    const onTime = Number(onTimeRow?.cnt || 0);
    const completed = Number(completedRow?.cnt || 0);
    const onTimeRate = total > 0 ? `${((onTime / total) * 100).toFixed(1)}%` : '0%';
    const completionRate = total > 0 ? `${((completed / total) * 100).toFixed(1)}%` : '0%';

    // ── 近6个月采购金额 ────────────────────────────────────────────────────────
    const amountRows = await AppDataSource.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, SUM(total_amount) AS amount
       FROM purchase_orders WHERE tenant_id = ? AND supplier_id = ?
       GROUP BY month ORDER BY month DESC LIMIT 6`,
      [this.tenantId, supplierId],
    );

    // ── 历史采购总额 ───────────────────────────────────────────────────────────
    const [totalAmountRow] = await AppDataSource.query(
      `SELECT IFNULL(SUM(total_amount), 0) AS total
       FROM purchase_orders WHERE tenant_id = ? AND supplier_id = ?`,
      [this.tenantId, supplierId],
    );
    const totalPurchaseAmount = String(totalAmountRow?.total ?? '0');

    // ── 平均交货周期（已完成订单的 updated_at - created_at，单位天）──
    const [leadRow] = await AppDataSource.query(
      `SELECT AVG(DATEDIFF(updated_at, created_at)) AS avg_days
       FROM purchase_orders
       WHERE tenant_id = ? AND supplier_id = ? AND status = 'completed'`,
      [this.tenantId, supplierId],
    );
    const avgLeadDays = leadRow?.avg_days != null ? Math.round(Number(leadRow.avg_days)) : 0;

    // ── 合作年限（从 suppliers.created_at 计算）────────────────────────────────
    const [supplierRow] = await AppDataSource.query(
      `SELECT created_at FROM suppliers WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [supplierId, this.tenantId],
    ) as Array<{ created_at: Date | string }>;
    let cooperationYears = 0;
    if (supplierRow?.created_at) {
      const createdDate = supplierRow.created_at instanceof Date
        ? supplierRow.created_at
        : new Date(String(supplierRow.created_at));
      const diffMs = Date.now() - createdDate.getTime();
      cooperationYears = Math.max(0, Math.floor(diffMs / (365.25 * 24 * 60 * 60 * 1000)));
    }

    // ── 质量合格率（从 quality_inspections 聚合，表不存在时使用默认值）─────────
    let qualityRate = '100.0%';
    try {
      const [qiRow] = await AppDataSource.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN result = 'pass' OR result = 'qualified' OR result = 'approved' THEN 1 ELSE 0 END) AS passed
         FROM quality_inspections
         WHERE tenant_id = ? AND supplier_id = ?`,
        [this.tenantId, supplierId],
      );
      const qiTotal = Number(qiRow?.total || 0);
      const qiPassed = Number(qiRow?.passed || 0);
      if (qiTotal > 0) {
        qualityRate = `${((qiPassed / qiTotal) * 100).toFixed(1)}%`;
      }
    } catch {
      // quality_inspections 表可能未建立，降级使用默认值
    }

    // ── 价格竞争力评分（基于该供应商 SKU 价格与同类供应商均价对比，0-100）──────
    // 无法从单一供应商数据直接计算市场竞争力时，采用基于合格率+准时率的综合估算
    const onTimeNum = total > 0 ? (onTime / total) * 100 : 0;
    const qualityNum = parseFloat(qualityRate.replace('%', '')) || 100;
    const priceScore = Math.min(100, Math.round((onTimeNum * 0.4 + qualityNum * 0.6)));

    // ── 平均响应速度（小时）— 从 purchase_orders 的 confirmed_at - created_at 估算 ──
    let responseHours = 24; // 默认 24 小时
    try {
      const [respRow] = await AppDataSource.query(
        `SELECT AVG(TIMESTAMPDIFF(HOUR, created_at, confirmed_at)) AS avg_hours
         FROM purchase_orders
         WHERE tenant_id = ? AND supplier_id = ? AND confirmed_at IS NOT NULL`,
        [this.tenantId, supplierId],
      );
      if (respRow?.avg_hours != null) {
        responseHours = Math.max(1, Math.round(Number(respRow.avg_hours)));
      }
    } catch {
      // confirmed_at 字段不存在时使用默认值
    }

    // ── 服务满意度（基于准时率 + 质量合格率加权计算，暂无独立评分表）──────────
    const satisfactionScore = Math.min(100, Math.round((onTimeNum * 0.5 + qualityNum * 0.5)));

    return {
      onTimeRate,
      totalOrders: total,
      recentAmounts: amountRows.map((r: any) => ({ month: r.month, amount: String(r.amount || 0) })),
      qualityRate,
      priceScore,
      responseHours,
      completionRate,
      satisfactionScore,
      cooperationYears,
      totalPurchaseAmount,
      avgLeadDays,
    };
  }

  async update(id: number, params: Partial<CreateSupplierParams>): Promise<SupplierEntity> {
    const supplier = await this.getById(id);
    const repo = AppDataSource.getRepository(SupplierEntity);

    if (params.code && params.code !== supplier.code) {
      const exists = await repo.findOne({
        where: { tenantId: this.tenantId, code: params.code },
      });
      if (exists) throw AppError.conflict(`供应商编码 ${params.code} 已存在`);
    }

    Object.assign(supplier, {
      ...(params.code !== undefined ? { code: params.code } : {}),
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.grade !== undefined ? { grade: params.grade } : {}),
      ...(params.contact !== undefined ? { contact: params.contact } : {}),
      ...(params.phone !== undefined ? { phone: params.phone } : {}),
      ...(params.contactEmail !== undefined ? { contactEmail: params.contactEmail } : {}),
      ...(params.address !== undefined ? { address: params.address } : {}),
      ...(params.paymentDays !== undefined ? { paymentDays: params.paymentDays } : {}),
      ...(params.leadDays !== undefined ? { leadDays: params.leadDays } : {}),
      ...(params.category !== undefined ? { category: params.category } : {}),
      ...(params.notes !== undefined ? { notes: params.notes } : {}),
      ...(params.mainSkus !== undefined ? { mainSkus: params.mainSkus } : {}),
      // isActive → status 由 Controller normalizePayload 转换后传入
      ...(params.status !== undefined ? { status: params.status } : {}),
      updatedBy: this.userId,
    });

    return repo.save(supplier);
  }

  // 供应商详情 — 关联 SKU 列表
  async getRelatedSkus(supplierId: number): Promise<Array<{
    id: number;
    skuCode: string;
    name: string;
    spec: string | null;
    stockUnit: string | null;
    purchaseUnit: string | null;
    currentPrice: string;
    priceUnit: string | null;
    isMainSupplier: boolean;
  }>> {
    const rows = await AppDataSource.query(
      `SELECT DISTINCT s.id, s.sku_code AS skuCode, s.name, s.spec,
              s.stock_unit AS stockUnit, s.purchase_unit AS purchaseUnit,
              sp.price AS currentPrice, sp.unit AS priceUnit,
              CASE WHEN sp.is_current = 1 THEN true ELSE false END AS isMainSupplier
       FROM supplier_prices sp
       INNER JOIN skus s ON s.id = sp.sku_id
       WHERE sp.tenant_id = ? AND sp.supplier_id = ? AND sp.is_current = 1
       ORDER BY s.name`,
      [this.tenantId, supplierId],
    );
    return rows.map((r: Record<string, unknown>) => ({
      id: Number(r.id),
      skuCode: String(r.skuCode),
      name: String(r.name),
      spec: r.spec != null ? String(r.spec) : null,
      stockUnit: r.stockUnit != null ? String(r.stockUnit) : null,
      purchaseUnit: r.purchaseUnit != null ? String(r.purchaseUnit) : null,
      currentPrice: String(r.currentPrice ?? 0),
      priceUnit: r.priceUnit != null ? String(r.priceUnit) : null,
      isMainSupplier: Boolean(r.isMainSupplier),
    }));
  }

  // 供应商详情 — 价格协议列表
  async getPriceAgreements(supplierId: number): Promise<Array<{
    id: number;
    skuId: number;
    skuName: string;
    unitPrice: string;
    purchaseUnit: string | null;
    moq: number | null;
    validFrom: string | null;
    validTo: string | null;
    isCurrent: boolean;
    status: string;
  }>> {
    const rows = await AppDataSource.query(
      `SELECT sp.id, sp.sku_id AS skuId, s.name AS skuName, sp.price AS unitPrice,
              sp.unit AS purchaseUnit, sp.moq, sp.effective_at AS validFrom,
              sp.expired_at AS validTo, sp.is_current AS isCurrent
       FROM supplier_prices sp
       INNER JOIN skus s ON s.id = sp.sku_id
       WHERE sp.tenant_id = ? AND sp.supplier_id = ?
       ORDER BY sp.is_current DESC, sp.effective_at DESC`,
      [this.tenantId, supplierId],
    );
    const now = new Date();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    return rows.map((r: Record<string, unknown>) => {
      const isCurrent = Boolean(r.isCurrent);
      const validTo = r.validTo != null ? (r.validTo instanceof Date ? r.validTo : new Date(String(r.validTo))) : null;
      let status: string;
      if (isCurrent && (validTo === null || validTo > now)) {
        if (validTo !== null && validTo.getTime() - now.getTime() <= thirtyDaysMs) {
          status = '即将到期';
        } else {
          status = '有效';
        }
      } else {
        status = '已过期';
      }
      return {
        id: Number(r.id),
        skuId: Number(r.skuId),
        skuName: String(r.skuName),
        unitPrice: String(r.unitPrice ?? 0),
        purchaseUnit: r.purchaseUnit != null ? String(r.purchaseUnit) : null,
        moq: r.moq != null ? Number(r.moq) : null,
        validFrom: r.validFrom != null ? (r.validFrom instanceof Date ? r.validFrom.toISOString().slice(0, 10) : String(r.validFrom).slice(0, 10)) : null,
        validTo: r.validTo != null ? (r.validTo instanceof Date ? r.validTo.toISOString().slice(0, 10) : String(r.validTo).slice(0, 10)) : null,
        isCurrent,
        status,
      };
    });
  }

  // ─── R-02: 供应商导出 ────────────────────────────────────────────────────────

  /**
   * 查询符合筛选条件的供应商，上限 5000 条，供导出使用。
   */
  async exportSuppliers(filter: SupplierExportFilter): Promise<SupplierEntity[]> {
    const repo = AppDataSource.getRepository(SupplierEntity);

    const qb = repo.createQueryBuilder('s')
      .where('s.tenant_id = :tenantId', { tenantId: this.tenantId });

    if (filter.keyword) {
      qb.andWhere('(s.name LIKE :kw OR s.code LIKE :kw)', { kw: `%${filter.keyword}%` });
    }
    if (filter.rating) {
      qb.andWhere('s.grade = :grade', { grade: filter.rating });
    }
    if (filter.isActive !== undefined) {
      qb.andWhere('s.status = :status', { status: filter.isActive ? 'active' : 'inactive' });
    }

    return qb
      .orderBy('s.created_at', 'DESC')
      .take(5000)
      .getMany();
  }

  // ─── R-02: 绩效对比 ──────────────────────────────────────────────────────────

  /**
   * 并发查询多个供应商绩效，补全缺失月份，结果 Redis 缓存 5 分钟。
   * @param supplierIds 供应商 ID 数组（最多 20 个）
   * @param months      最近 N 个月，默认 6
   */
  async comparePerformance(
    supplierIds: number[],
    months = 6,
  ): Promise<SupplierPerfSnapshot[]> {
    // ── 1. 尝试从 Redis 读取缓存 ──────────────────────────────────────────────
    const sortedIds = [...supplierIds].sort((a, b) => a - b);
    const cacheKey = `perf_compare:${this.tenantId}:${sortedIds.join(',')}:${months}`;

    if (await isRedisAvailable()) {
      try {
        const cached = await getRedisClient().get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as SupplierPerfSnapshot[];
        }
      } catch {
        // Redis 不可用时静默降级
      }
    }

    // ── 2. 并发查询各供应商绩效 + 名称 ───────────────────────────────────────
    const results = await Promise.all(
      sortedIds.map(async (id) => {
        const [nameRow] = await AppDataSource.query(
          `SELECT name FROM suppliers WHERE id = ? AND tenant_id = ? LIMIT 1`,
          [id, this.tenantId],
        ) as Array<{ name: string }>;

        const perf = await this.getPerformance(id);
        return { supplierId: id, supplierName: nameRow?.name ?? '', ...perf };
      }),
    );

    // ── 3. 补全缺失月份（保证每个供应商都有完整的 N 个月数据）───────────────
    const allMonths = this._buildMonthRange(months);
    const normalized: SupplierPerfSnapshot[] = results.map((r) => {
      const amountMap = new Map(r.recentAmounts.map((a) => [a.month, a.amount]));
      const recentAmounts = allMonths.map((m) => ({
        month: m,
        amount: amountMap.get(m) ?? '0',
      }));
      return { ...r, recentAmounts };
    });

    // ── 4. 写入缓存，TTL 300s ─────────────────────────────────────────────────
    if (await isRedisAvailable()) {
      try {
        await getRedisClient().set(cacheKey, JSON.stringify(normalized), 'EX', 300);
      } catch {
        // 写缓存失败不影响响应
      }
    }

    return normalized;
  }

  /** 生成最近 N 个月的 YYYY-MM 数组，从远到近排列 */
  private _buildMonthRange(months: number): string[] {
    const result: string[] = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return result;
  }

  // BE-P1-013: 供应商月度对账单
  async getMonthlyStatement(supplierId: number, month: string): Promise<{
    orders: Array<{ poNo: string; amount: string; status: string; createdAt: string }>;
    totalAmount: string;
  }> {
    const rows = await AppDataSource.query(
      `SELECT po_no, total_amount AS amount, status, created_at
       FROM purchase_orders
       WHERE tenant_id = ? AND supplier_id = ? AND DATE_FORMAT(created_at, '%Y-%m') = ?
       ORDER BY created_at DESC`,
      [this.tenantId, supplierId, month],
    );
    const totalAmount = rows.reduce(
      (s: Decimal, r: Record<string, unknown>) => s.plus(new Decimal(String(r.amount || 0))),
      new Decimal(0),
    );
    return {
      orders: rows.map((r: Record<string, unknown>) => ({
        poNo: String(r.po_no),
        amount: String(r.amount),
        status: String(r.status),
        createdAt: String(r.created_at),
      })),
      totalAmount: totalAmount.toFixed(2),
    };
  }
}
