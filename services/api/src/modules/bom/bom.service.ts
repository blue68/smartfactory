import Decimal from 'decimal.js';
import * as XLSX from 'xlsx';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { formatBomStatus } from '../../shared/exportFormat';
import { getRedisClient, RedisKeys, RedisTTL } from '../../config/redis';

// ─── 常量 ────────────────────────────────────────────────────────
const MAX_AI_CONFIDENCE = 95;
const CONFIDENCE_PER_USAGE = 15;

// ─── 类型定义 ──────────────────────────────────────────────────

export interface BomItemNode {
  bomItemId: number;
  componentSkuId: number;
  skuCode: string;
  skuName: string;
  spec: string | null;
  quantity: string;
  unit: string;
  scrapRate: string;
  /** quantity * (1 + scrapRate) —— 含损耗的实际用量 */
  netQuantity: string;
  businessClass: string;
  controlMode: string;
  level: number;
  children: BomItemNode[];
}

export interface BomHeader {
  id: number;
  skuId: number;
  skuName: string;
  /** P2-2: SKU code included for list display */
  skuCode?: string;
  version: string;
  status: string;
  description?: string;
  items: BomItemNode[];
  /** V2-S2: 明细行数量（列表接口聚合字段） */
  itemCount?: number;
}

// ── 品类成本占比分析 ────────────────────────────────────────

export interface CostSegment {
  categoryName: string;
  totalCost: string;    // 保留2位小数字符串
  percentage: number;   // 0-100 整数
}

export interface CostBreakdownResult {
  bomTotal: string;             // BOM 总估算成本，保留2位小数
  segments: CostSegment[];
  missingPriceCount: number;    // 未维护价格的物料数
}

/** BOM 物料需求汇总（多层展开展平后，相同 SKU 合并） */
export interface MaterialRequirement {
  skuId: number;
  skuCode: string;
  skuName: string;
  spec: string | null;
  stockUnit: string;
  purchaseUnit: string;
  hasDyeLot: boolean;
  totalQty: string;  // 库存单位，含损耗
  unit: string;
}

export interface CreateBomParams {
  skuId: number;
  version?: string;
  description?: string;
  items: CreateBomItemParam[];
}

export interface CreateBomItemParam {
  parentItemId?: number | null;
  componentSkuId: number;
  quantity: string;
  unit: string;
  scrapRate?: string;
  sortOrder?: number;
  notes?: string;
  children?: CreateBomItemParam[];
}

// ─── BOM Service ───────────────────────────────────────────────

export class BomService {
  private readonly tenantId: number;
  private readonly userId: number;

  private formatBomQuantity(value: Decimal): string {
    return value.toFixed(6).replace(/\.?0+$/, '');
  }

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  // ── 查询 BOM 表头列表 ──────────────────────────────────────

  async listBoms(skuId?: number): Promise<BomHeader[]> {
    const conditions = ['b.tenant_id = ?'];
    const params: unknown[] = [this.tenantId];
    if (skuId) {
      conditions.push('b.sku_id = ?');
      params.push(skuId);
    }

    // BOM 主数据页当前未接分页协议，这里保留一个足够大的保护上限，
    // 避免像 FACTORY002 这类 1000+ 套 BOM 被静默截断成 500 条。
    const headers = await AppDataSource.query<Array<{
      id: number; sku_id: number; sku_name: string; sku_code: string; version: string; status: string; item_count: number;
    }>>(
      `SELECT b.id, b.sku_id, s.name AS sku_name, s.sku_code, b.version, b.status,
              (SELECT COUNT(*) FROM bom_items WHERE bom_header_id = b.id AND tenant_id = b.tenant_id) AS item_count
       FROM bom_headers b
       INNER JOIN skus s ON s.id = b.sku_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY b.id DESC
       LIMIT 5000`,
      params,
    );

    return headers.map((h) => ({
      ...h,
      skuId: h.sku_id,
      skuName: h.sku_name,
      skuCode: h.sku_code,
      itemCount: Number(h.item_count),
      items: [],
    }));
  }

  // ── 获取 BOM 并递归展开（带缓存）────────────────────────────

  async getBomWithExpansion(bomId: number): Promise<BomHeader> {
    const header = await this.getBomHeader(bomId);
    const cacheKey = RedisKeys.bomExpanded(this.tenantId, bomId, header.version);
    const redis = getRedisClient();

    const cached = await redis.get(cacheKey);
    if (cached) {
      return { ...header, items: JSON.parse(cached) as BomItemNode[] };
    }

    const items = await this.expandBom(bomId);
    await redis.setex(cacheKey, RedisTTL.BOM_EXPANDED, JSON.stringify(items));

    return { ...header, items };
  }

  // ── BOM 递归展开核心算法（WITH RECURSIVE CTE）──────────────

  /**
   * BOM管理页采用“动态引用树”语义：
   * - 若组件 SKU 存在 active 子 BOM，则优先按该子 BOM 继续展开
   * - 若组件 SKU 不存在 active 子 BOM，则回退到当前 header 内联 children
   *
   * 这样同一个半成品 BOM 被多个上层引用时，修改子 BOM 后上层展开树会同步反映最新结构。
   */
  async expandBom(bomId: number): Promise<BomItemNode[]> {
    return this.expandBomHeader(bomId, 1, new Set<number>([bomId]));
  }

  private async expandBomHeader(
    bomId: number,
    levelBase: number,
    visitedBomIds: Set<number>,
  ): Promise<BomItemNode[]> {
    const rows = await this.fetchBomRows(bomId);
    return this.buildDynamicTree(rows, null, levelBase, visitedBomIds);
  }

  private async buildDynamicTree(
    rows: Array<{
      id: number; parent_item_id: number | null; component_sku_id: number;
      sku_code: string; sku_name: string; spec: string | null;
      business_class: string; control_mode: string;
      quantity: string; unit: string; scrap_rate: string; sort_order: number;
    }>,
    parentId: number | null,
    currentLevel: number,
    visitedBomIds: Set<number>,
  ): Promise<BomItemNode[]> {
    const siblings = rows
      .filter((r) => r.parent_item_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);

    const result: BomItemNode[] = [];
    for (const row of siblings) {
      const qty = new Decimal(row.quantity);
      const scrap = new Decimal(row.scrap_rate);
      const netQty = qty.mul(new Decimal(1).plus(scrap));

      const activeChildBomId = await this.findActiveBomIdBySku(row.component_sku_id);
      let children: BomItemNode[] = [];

      if (activeChildBomId !== null && !visitedBomIds.has(activeChildBomId)) {
        const nextVisited = new Set(visitedBomIds);
        nextVisited.add(activeChildBomId);
        children = await this.expandBomHeader(activeChildBomId, currentLevel + 1, nextVisited);
      } else {
        children = await this.buildDynamicTree(rows, row.id, currentLevel + 1, visitedBomIds);
      }

      result.push({
        bomItemId: Number(row.id),
        componentSkuId: Number(row.component_sku_id),
        skuCode: row.sku_code,
        skuName: row.sku_name,
        spec: row.spec,
        quantity: this.formatBomQuantity(qty),
        unit: row.unit,
        scrapRate: scrap.toFixed(4),
        netQuantity: this.formatBomQuantity(netQty),
        businessClass: row.business_class,
        controlMode: row.control_mode,
        level: currentLevel,
        children,
      });
    }

    return result;
  }

  private async fetchBomRows(
    bomId: number,
  ): Promise<Array<{
    id: number;
    parent_item_id: number | null;
    component_sku_id: number;
    sku_code: string;
    sku_name: string;
    spec: string | null;
    business_class: string;
    control_mode: string;
    quantity: string;
    unit: string;
    scrap_rate: string;
    sort_order: number;
  }>> {
    return AppDataSource.query<Array<{
      id: number;
      parent_item_id: number | null;
      component_sku_id: number;
      sku_code: string;
      sku_name: string;
      spec: string | null;
      business_class: string;
      control_mode: string;
      quantity: string;
      unit: string;
      scrap_rate: string;
      sort_order: number;
    }>>(
      `SELECT
         bi.id,
         bi.parent_item_id,
         bi.component_sku_id,
         s.sku_code,
         s.name AS sku_name,
         s.spec,
         s.business_class,
         s.control_mode,
         bi.quantity,
         bi.unit,
         bi.scrap_rate,
         bi.sort_order
       FROM bom_items bi
       INNER JOIN skus s ON s.id = bi.component_sku_id
       WHERE bi.bom_header_id = ? AND bi.tenant_id = ?
       ORDER BY bi.level, bi.sort_order, bi.id`,
      [bomId, this.tenantId],
    );
  }

  private async findActiveBomIdBySku(componentSkuId: number): Promise<number | null> {
    const [row] = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT id
         FROM bom_headers
        WHERE tenant_id = ? AND sku_id = ? AND status = 'active'
        ORDER BY id DESC
        LIMIT 1`,
      [this.tenantId, componentSkuId],
    );
    return row ? Number(row.id) : null;
  }

  private async invalidateExpandedCache(): Promise<void> {
    const redis = getRedisClient();
    let cursor = '0';
    const keys: string[] = [];

    do {
      const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', `bom:${this.tenantId}:*`, 'COUNT', 500);
      cursor = nextCursor;
      if (Array.isArray(batch) && batch.length > 0) keys.push(...batch);
    } while (cursor !== '0');

    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }

  // ── 物料需求计算（BOM展开 × 生产数量）─────────────────────

  /**
   * 计算生产 productionQty 件成品所需的全量原材料清单。
   * 算法：递归遍历 BOM 树，叶子节点汇总，同 SKU 累加。
   */
  async calcMaterialRequirements(
    bomId: number,
    productionQty: string | number,
  ): Promise<MaterialRequirement[]> {
    const bom = await this.getBomWithExpansion(bomId);
    const accumulator = new Map<number, { req: MaterialRequirement; total: Decimal }>();

    this.traverseForRequirements(
      bom.items,
      new Decimal(productionQty),
      accumulator,
    );

    // 补充 stockUnit / purchaseUnit / hasDyeLot（从 SKU 表读取）
    const skuIds = [...accumulator.keys()];
    if (skuIds.length === 0) return [];

    const skuInfo = await AppDataSource.query<Array<{
      id: number; stock_unit: string; purchase_unit: string; has_dye_lot: number;
    }>>(
      `SELECT id, stock_unit, purchase_unit, has_dye_lot
       FROM skus WHERE id IN (${skuIds.map(() => '?').join(',')}) AND tenant_id = ?`,
      [...skuIds, this.tenantId],
    );

    const skuMap = new Map(skuInfo.map((s) => [s.id, s]));

    return [...accumulator.values()].map(({ req, total }) => {
      const info = skuMap.get(req.skuId);
      return {
        ...req,
        stockUnit: info?.stock_unit ?? req.unit,
        purchaseUnit: info?.purchase_unit ?? req.unit,
        hasDyeLot: Boolean(info?.has_dye_lot),
        totalQty: this.formatBomQuantity(total),
        unit: info?.stock_unit ?? req.unit,
      };
    });
  }

  /**
   * 深度优先遍历 BOM 树，叶子节点（无子节点）累积物料需求；
   * 中间节点（半成品）透传乘数到子节点。
   */
  private traverseForRequirements(
    nodes: BomItemNode[],
    parentQty: Decimal,
    acc: Map<number, { req: MaterialRequirement; total: Decimal }>,
  ): void {
    for (const node of nodes) {
      const nodeQty = parentQty.mul(new Decimal(node.netQuantity));

      if (node.children.length === 0) {
        if (node.businessClass !== 'production_material' || node.controlMode !== 'mrp') {
          continue;
        }
        // 叶子节点 = 原材料，直接累积
        const existing = acc.get(node.componentSkuId);
        if (existing) {
          existing.total = existing.total.plus(nodeQty);
        } else {
          acc.set(node.componentSkuId, {
            req: {
              skuId: node.componentSkuId,
              skuCode: node.skuCode,
              skuName: node.skuName,
              spec: node.spec,
              stockUnit: node.unit,
              purchaseUnit: node.unit,
              hasDyeLot: false,
              totalQty: '0',
              unit: node.unit,
            },
            total: nodeQty,
          });
        }
      } else {
        // 中间节点（半成品），递归展开子节点
        this.traverseForRequirements(node.children, nodeQty, acc);
      }
    }
  }

  // ── 创建 BOM ────────────────────────────────────────────────

  async createBom(params: CreateBomParams): Promise<{ id: number }> {
    return AppDataSource.transaction(async (manager) => {
      // 1. 创建表头
      const headerResult = await manager.query(
        `INSERT INTO bom_headers (tenant_id, sku_id, version, status, description, created_by, updated_by)
         VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
        [
          this.tenantId, params.skuId,
          params.version ?? '1.0',
          params.description ?? null,
          this.userId, this.userId,
        ],
      );
      const bomId = Number(headerResult.insertId);

      // 2. 校验循环引用，插入明细
      await this.insertBomItems(manager, bomId, params.items, null, 1, params.skuId);

      return { id: bomId };
    });
  }

  private async insertBomItems(
    manager: import('typeorm').EntityManager,
    bomId: number,
    items: CreateBomItemParam[],
    parentDbId: number | null,
    level: number,
    headerSkuId?: number,
  ): Promise<void> {
    if (level > 10) {
      throw AppError.badRequest('BOM层级不能超过10层', ResponseCode.BOM_CIRCULAR_REF);
    }

    // 只在未传入 headerSkuId 时查询（首次调用可直接传入，避免递归冗余查询）
    if (headerSkuId === undefined) {
      const [header] = await manager.query<Array<{ sku_id: number }>>(
        'SELECT sku_id FROM bom_headers WHERE id = ? AND tenant_id = ? LIMIT 1',
        [bomId, this.tenantId],
      );
      headerSkuId = header?.sku_id;
    }

    for (const item of items) {
      // 检查循环引用：若当前 componentSkuId 是 BOM 对应成品，则循环
      if (headerSkuId !== undefined && headerSkuId === item.componentSkuId) {
        throw AppError.badRequest(
          `检测到循环引用：物料 ${item.componentSkuId} 是当前BOM的成品`,
          ResponseCode.BOM_CIRCULAR_REF,
        );
      }

      await this.assertBomComponentAllowed(manager, item.componentSkuId);

      const result = await manager.query(
        `INSERT INTO bom_items
           (tenant_id, bom_header_id, parent_item_id, component_sku_id,
            quantity, unit, level, scrap_rate, sort_order, notes, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          this.tenantId, bomId, parentDbId, item.componentSkuId,
          item.quantity, item.unit, level,
          item.scrapRate ?? '0', item.sortOrder ?? 0,
          item.notes ?? null, this.userId, this.userId,
        ],
      );

      const newItemId = Number(result.insertId);
      // 递归处理子节点（若前端以嵌套方式传入）
      const sub = item.children;
      if (sub && sub.length > 0) {
        await this.insertBomItems(manager, bomId, sub, newItemId, level + 1, headerSkuId);
      }
    }
  }

  async activateBom(bomId: number): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
      // 先将同一 SKU 的其他 active BOM 归档
      const [header] = await manager.query<Array<{ sku_id: number }>>(
        'SELECT sku_id FROM bom_headers WHERE id = ? AND tenant_id = ? LIMIT 1',
        [bomId, this.tenantId],
      );
      if (!header) throw AppError.notFound('BOM不存在', ResponseCode.BOM_NOT_FOUND);

      await manager.query(
        `UPDATE bom_headers SET status = 'archived', is_active = 0, updated_by = ?
         WHERE sku_id = ? AND tenant_id = ? AND status = 'active' AND id != ?`,
        [this.userId, header.sku_id, this.tenantId, bomId],
      );

      await manager.query(
        `UPDATE bom_headers SET status = 'active', is_active = 1, updated_by = ? WHERE id = ? AND tenant_id = ?`,
        [this.userId, bomId, this.tenantId],
      );
    });

    // P1-1: add tenant_id filter to prevent cross-tenant cache leak
    const [header] = await AppDataSource.query<Array<{ version: string }>>(
      'SELECT version FROM bom_headers WHERE id = ? AND tenant_id = ? LIMIT 1',
      [bomId, this.tenantId],
    );
    if (header) {
    await this.invalidateExpandedCache();
    }
  }

  // ── BE-P1-001: 更新 BOM 头信息 ─────────────────────────────

  /**
   * 更新 BOM 头信息（version, description, status）。
   * 约束：只有 draft 状态的 BOM 才允许修改 version 字段。
   */
  async updateBom(
    bomId: number,
    payload: { version?: string; description?: string; status?: 'draft' | 'active' | 'archived' },
  ): Promise<void> {
    let oldVersion: string;

    await AppDataSource.transaction(async (manager) => {
      // 事务内获取 header（FOR UPDATE 行锁防并发）
      const [header] = await manager.query<Array<{
        id: number; sku_id: number; version: string; status: string;
      }>>(
        'SELECT id, sku_id, version, status FROM bom_headers WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE',
        [bomId, this.tenantId],
      );
      if (!header) throw AppError.notFound('BOM不存在', ResponseCode.BOM_NOT_FOUND);
      oldVersion = header.version;

      // 非 draft 状态禁止修改 version
      if (payload.version !== undefined && header.status !== 'draft') {
        throw AppError.badRequest(
          '只有 draft 状态的 BOM 才能修改版本号',
          ResponseCode.BOM_STATUS_CONFLICT,
        );
      }

      // 版本号唯一性校验（FOR UPDATE 防并发写入重复版本号）
      if (payload.version !== undefined && payload.version !== header.version) {
        const [existing] = await manager.query<Array<{ id: number }>>(
          'SELECT id FROM bom_headers WHERE tenant_id = ? AND sku_id = ? AND version = ? AND id != ? LIMIT 1 FOR UPDATE',
          [this.tenantId, header.sku_id, payload.version, bomId],
        );
        if (existing) {
          throw AppError.badRequest(
            '版本号已存在，请使用其他版本号',
            ResponseCode.BOM_VERSION_DUPLICATE,
          );
        }
      }

      const setClauses: string[] = ['updated_by = ?'];
      const params: unknown[] = [this.userId];

      if (payload.version !== undefined)     { setClauses.push('version = ?');     params.push(payload.version); }
      if (payload.description !== undefined) { setClauses.push('description = ?'); params.push(payload.description); }
      if (payload.status !== undefined)      { setClauses.push('status = ?');      params.push(payload.status); }

      params.push(bomId, this.tenantId);

      await manager.query(
        `UPDATE bom_headers SET ${setClauses.join(', ')} WHERE id = ? AND tenant_id = ?`,
        params,
      );
    });

    // 事务提交后失效 Redis 缓存
    await this.invalidateExpandedCache();
  }

  // ── BE-P1-001: 删除 BOM 明细行 ──────────────────────────────

  /**
   * 物理删除 BOM 明细行（含其所有子孙节点）。
   * 校验明细必须属于当前租户。
   */
  async deleteBomItem(bomItemId: number, expectedBomId: number): Promise<void> {
    // P1-4: existence check moved INSIDE the transaction to eliminate TOCTOU race condition
    let capturedBomHeaderId: number | undefined;

    await AppDataSource.transaction(async (manager) => {
      // 先锁 header，确认 draft 状态（与 updateBomItem 保持一致的加锁顺序）
      const [header] = await manager.query<Array<{ status: string }>>(
        'SELECT status FROM bom_headers WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE',
        [expectedBomId, this.tenantId],
      );
      if (!header) throw AppError.notFound('BOM不存在', ResponseCode.BOM_NOT_FOUND);
      if (header.status !== 'draft') {
        throw AppError.badRequest('只有 draft 状态的 BOM 允许删除明细', ResponseCode.BOM_STATUS_CONFLICT);
      }

      const [item] = await manager.query<Array<{ id: number; bom_header_id: number }>>(
        'SELECT id, bom_header_id FROM bom_items WHERE id = ? AND tenant_id = ? AND bom_header_id = ? LIMIT 1 FOR UPDATE',
        [bomItemId, this.tenantId, expectedBomId],
      );
      if (!item) throw AppError.notFound('BOM明细不存在', ResponseCode.BOM_NOT_FOUND);

      capturedBomHeaderId = item.bom_header_id;

      // 递归删除所有子孙节点（借助 WITH RECURSIVE CTE，深度限制 10 层防 DoS）
      await manager.query(
        `DELETE FROM bom_items
         WHERE tenant_id = ? AND id IN (
           WITH RECURSIVE descendants AS (
             SELECT id, 1 AS depth FROM bom_items WHERE id = ? AND tenant_id = ?
             UNION ALL
             SELECT bi.id, d.depth + 1 FROM bom_items bi
             INNER JOIN descendants d ON bi.parent_item_id = d.id
             WHERE bi.tenant_id = ? AND d.depth < 10
           )
           SELECT id FROM descendants
         )`,
        [this.tenantId, bomItemId, this.tenantId, this.tenantId],
      );
    });

    // 失效该 BOM 的展开缓存（在事务提交后执行）
    if (capturedBomHeaderId !== undefined) {
      await this.invalidateExpandedCache();
    }
  }

  // ── BE-P1-001: 复制 BOM ──────────────────────────────────────

  /**
   * 复制 BOM：克隆 bom_headers（新 version, status=draft）及全量 bom_items。
   * 返回新 BOM 的 id。
   */
  async copyBom(bomId: number, newVersion: string): Promise<{ id: number }> {
    return AppDataSource.transaction(async (manager) => {
      // 1. 校验源 BOM 存在且属于当前租户（事务内查询）
      const [srcHeader] = await manager.query<Array<{
        sku_id: number; description: string | null;
      }>>(
        'SELECT sku_id, description FROM bom_headers WHERE id = ? AND tenant_id = ? LIMIT 1',
        [bomId, this.tenantId],
      );
      if (!srcHeader) throw AppError.notFound('BOM不存在', ResponseCode.BOM_NOT_FOUND);

      // 2. 检查目标版本号在同一 SKU 下是否已存在（FOR UPDATE 防止并发写入重复版本号）
      const [existing] = await manager.query<Array<{ id: number }>>(
        'SELECT id FROM bom_headers WHERE tenant_id = ? AND sku_id = ? AND version = ? LIMIT 1 FOR UPDATE',
        [this.tenantId, srcHeader.sku_id, newVersion],
      );
      if (existing) {
        throw AppError.badRequest(
          '版本号已存在，请使用其他版本号',
          ResponseCode.BOM_VERSION_DUPLICATE,
        );
      }

      // 3. 复制表头
      const headerResult = await manager.query(
        `INSERT INTO bom_headers (tenant_id, sku_id, version, status, description, created_by, updated_by)
         VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
        [this.tenantId, srcHeader.sku_id, newVersion, srcHeader.description ?? null, this.userId, this.userId],
      );
      const newBomId = Number(headerResult.insertId);

      // 4. 批量复制明细（保留层级关系：使用 id 映射表重建 parent_item_id）
      const srcItems = await manager.query<Array<{
        id: number; parent_item_id: number | null;
        component_sku_id: number; quantity: string; unit: string;
        level: number; scrap_rate: string; sort_order: number; notes: string | null;
      }>>(
        `SELECT id, parent_item_id, component_sku_id, quantity, unit,
                level, scrap_rate, sort_order, notes
         FROM bom_items WHERE bom_header_id = ? AND tenant_id = ?
         ORDER BY level, id`,
        [bomId, this.tenantId],
      );

      // oldId -> newId 映射，用于修正 parent_item_id
      const idMap = new Map<number, number>();

      for (const item of srcItems) {
        const newParentId = item.parent_item_id !== null
          ? (idMap.get(item.parent_item_id) ?? null)
          : null;

        const result = await manager.query(
          `INSERT INTO bom_items
             (tenant_id, bom_header_id, parent_item_id, component_sku_id,
              quantity, unit, level, scrap_rate, sort_order, notes, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            this.tenantId, newBomId, newParentId, item.component_sku_id,
            item.quantity, item.unit, item.level, item.scrap_rate,
            item.sort_order, item.notes ?? null, this.userId, this.userId,
          ],
        );
        idMap.set(item.id, Number(result.insertId));
      }

      return { id: newBomId };
    });
  }

  // ── BE-P1-002: AI 辅助 BOM 建议 ─────────────────────────────

  /**
   * 查找同一一级品类下其他成品的活动 BOM，统计常用物料，
   * 按使用频次降序返回 Top 10，附置信度与原因说明。
   */
  async getAiSuggestion(skuId: number): Promise<{
    suggestedItems: Array<{
      skuId: number;
      skuName: string;
      quantity: string;
      unit: string;
      confidence: number;
      reason: string;
    }>;
  }> {
    // P2-1: use a proper typed interface instead of (r: any)
    interface AiSuggestionRow {
      skuId: number;
      skuName: string;
      avgQty: string;
      unit: string;
      usageCount: number;
    }

    const rows = await AppDataSource.query<AiSuggestionRow[]>(
      `SELECT bi.component_sku_id AS skuId, s.name AS skuName,
              AVG(CAST(bi.quantity AS DECIMAL(18,4))) AS avgQty, bi.unit,
              COUNT(*) AS usageCount
       FROM bom_items bi
       INNER JOIN bom_headers bh ON bh.id = bi.bom_header_id AND bh.tenant_id = bi.tenant_id
       INNER JOIN skus target ON target.id = ? AND target.tenant_id = bi.tenant_id
       INNER JOIN skus bom_sku ON bom_sku.id = bh.sku_id AND bom_sku.category1_id = target.category1_id
       INNER JOIN skus s ON s.id = bi.component_sku_id
       WHERE bi.tenant_id = ? AND bh.status = 'active' AND bh.sku_id != ?
       GROUP BY bi.component_sku_id, s.name, bi.unit
       ORDER BY usageCount DESC
       LIMIT 10`,
      [skuId, this.tenantId, skuId],
    );

    return {
      suggestedItems: rows.map((r) => ({
        skuId: Number(r.skuId),
        skuName: r.skuName,
        quantity: String(Number(r.avgQty).toFixed(2)),
        unit: r.unit,
        confidence: Math.min(MAX_AI_CONFIDENCE, Number(r.usageCount) * CONFIDENCE_PER_USAGE),
        reason: `同品类 ${r.usageCount} 个 BOM 使用该物料`,
      })),
    };
  }

  // ── GET /bom/:id/cost-breakdown  品类成本占比 ─────────────

  /**
   * 按品类（category1）统计 BOM 各物料的估算成本占比。
   * 物料成本 = quantity × 最新供应商报价（supplier_prices.price，is_current=1 取最新记录）。
   * 无报价的物料计入 missingPriceCount，其成本按 0 计算。
   */
  async getCostBreakdown(bomId: number): Promise<CostBreakdownResult> {
    // 1. 先确认 BOM 存在（复用私有方法，不存在时抛 NotFound）
    await this.getBomHeader(bomId);

    // 2. 成本占比按“动态展开后的真实叶子物料”统计，而不是按 bom_items 直子项统计。
    const bom = await this.getBomWithExpansion(bomId);
    const accumulator = new Map<number, { total: Decimal; unit: string }>();
    this.traverseForCostBreakdown(bom.items, new Decimal(1), accumulator);

    const skuIds = [...accumulator.keys()];
    if (skuIds.length === 0) {
      return { bomTotal: '0.00', segments: [], missingPriceCount: 0 };
    }

    const placeholders = skuIds.map(() => '?').join(',');
    const skuInfoRows = await AppDataSource.query<Array<{
      id: number;
      categoryName: string | null;
    }>>(
      `SELECT s.id, COALESCE(c2.name, c1.name, '未分类') AS categoryName
         FROM skus s
         LEFT JOIN sku_categories c1
           ON c1.id = s.category1_id
          AND c1.tenant_id IN (0, s.tenant_id)
         LEFT JOIN sku_categories c2
           ON c2.id = s.category2_id
          AND c2.tenant_id IN (0, s.tenant_id)
        WHERE s.tenant_id = ?
          AND s.id IN (${placeholders})`,
      [this.tenantId, ...skuIds],
    );
    const skuInfoMap = new Map(skuInfoRows.map((row) => [Number(row.id), row]));

    const priceRows = await AppDataSource.query<Array<{
      sku_id: number;
      price: string;
    }>>(
      `SELECT sku_id, price
         FROM (
           SELECT sku_id, price,
                  ROW_NUMBER() OVER (PARTITION BY sku_id ORDER BY effective_at DESC, id DESC) AS rn
             FROM supplier_prices
            WHERE tenant_id = ? AND is_current = 1
              AND sku_id IN (${placeholders})
         ) t
        WHERE rn = 1`,
      [this.tenantId, ...skuIds],
    );
    const priceMap = new Map(priceRows.map((row) => [Number(row.sku_id), new Decimal(row.price ?? 0)]));

    const categoryCostMap = new Map<string, Decimal>();
    let bomTotalDecimal = new Decimal(0);
    let missingPriceCount = 0;

    for (const [skuId, value] of accumulator.entries()) {
      const price = priceMap.get(skuId);
      if (!price) {
        missingPriceCount += 1;
        continue;
      }
      const categoryName = skuInfoMap.get(skuId)?.categoryName ?? '未分类';
      const cost = value.total.mul(price);
      bomTotalDecimal = bomTotalDecimal.plus(cost);
      categoryCostMap.set(categoryName, (categoryCostMap.get(categoryName) ?? new Decimal(0)).plus(cost));
    }

    const segments: CostSegment[] = [...categoryCostMap.entries()]
      .sort((a, b) => b[1].comparedTo(a[1]))
      .map(([categoryName, cost]) => ({
        categoryName,
        totalCost: cost.toFixed(2),
        percentage: bomTotalDecimal.isZero()
          ? 0
          : Math.round(cost.div(bomTotalDecimal).mul(100).toNumber()),
      }));

    return {
      bomTotal: bomTotalDecimal.toFixed(2),
      segments,
      missingPriceCount,
    };
  }

  private traverseForCostBreakdown(
    nodes: BomItemNode[],
    parentQty: Decimal,
    acc: Map<number, { total: Decimal; unit: string }>,
  ): void {
    for (const node of nodes) {
      const nodeQty = parentQty.mul(new Decimal(node.netQuantity));
      if (node.children.length === 0) {
        const existing = acc.get(node.componentSkuId);
        if (existing) {
          existing.total = existing.total.plus(nodeQty);
        } else {
          acc.set(node.componentSkuId, { total: nodeQty, unit: node.unit });
        }
      } else {
        this.traverseForCostBreakdown(node.children, nodeQty, acc);
      }
    }
  }

  // ── 新增 BOM 明细行（顶层，level = 1）──────────────────────

  /**
   * 向已有 BOM 追加一条顶层明细行（parent_item_id = NULL, level = 1）。
   * 校验：componentSkuId 不得与 BOM 的成品 skuId 相同（防直接循环引用）。
   * 成功后失效该 BOM 的展开缓存。
   */
  async addBomItem(
    bomId: number,
    payload: {
      componentSkuId: number;
      quantity: string;
      unit: string;
      scrapRate?: string;
    },
  ): Promise<{ bomItemId: number }> {
    let bomItemId: number;
    let cachedVersion: string;

    await AppDataSource.transaction(async (manager) => {
      // 1. 事务内校验 BOM 存在并加行锁（防 TOCTOU）
      const [header] = await manager.query<Array<{ sku_id: number; version: string; status: string }>>(
        'SELECT sku_id, version, status FROM bom_headers WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE',
        [bomId, this.tenantId],
      );
      if (!header) throw AppError.notFound('BOM不存在', ResponseCode.BOM_NOT_FOUND);

      // 2. 仅 draft 状态允许新增物料
      if (header.status !== 'draft') {
        throw AppError.badRequest(
          '只有 draft 状态的 BOM 允许新增物料',
          ResponseCode.BOM_STATUS_CONFLICT,
        );
      }

      // 3. 防止直接循环引用
      if (header.sku_id === payload.componentSkuId) {
        throw AppError.badRequest(
          `检测到循环引用：物料 ${payload.componentSkuId} 是当前BOM的成品`,
          ResponseCode.BOM_CIRCULAR_REF,
        );
      }

      await this.assertBomComponentAllowed(manager, payload.componentSkuId);

      // 4. 插入明细行
      const result = await manager.query(
        `INSERT INTO bom_items
           (tenant_id, bom_header_id, parent_item_id, component_sku_id,
            quantity, unit, level, scrap_rate, sort_order, created_by, updated_by)
         VALUES (?, ?, NULL, ?, ?, ?, 1, ?, 0, ?, ?)`,
        [
          this.tenantId, bomId, payload.componentSkuId,
          payload.quantity, payload.unit,
          payload.scrapRate ?? '0',
          this.userId, this.userId,
        ],
      );

      bomItemId = Number(result.insertId);
      cachedVersion = header.version;
    });

    // 5. 事务提交后失效 Redis 展开缓存
    await this.invalidateExpandedCache();

    return { bomItemId: bomItemId! };
  }

  // ── V2-S2: 更新 BOM 明细行字段 ──────────────────────────────

  /**
   * 更新 BOM 明细行的 quantity / unit / scrapRate。
   * 约束：
   *   1. 明细必须属于当前租户且归属于指定 bomId。
   *   2. 对应的 BOM header 必须处于 draft 状态。
   * 事务内使用 FOR UPDATE 行锁防并发。
   * 事务提交后失效 Redis 展开缓存。
   */
  async updateBomItem(
    bomId: number,
    itemId: number,
    payload: { quantity?: string; unit?: string; scrapRate?: string },
  ): Promise<void> {
    let capturedVersion: string;

    await AppDataSource.transaction(async (manager) => {
      // 1. 先锁 header（与 deleteBomItem 加锁顺序一致，防止死锁）
      const [header] = await manager.query<Array<{ status: string; version: string }>>(
        `SELECT status, version FROM bom_headers WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [bomId, this.tenantId],
      );
      if (!header) throw AppError.notFound('BOM不存在', ResponseCode.BOM_NOT_FOUND);
      if (header.status !== 'draft') {
        throw AppError.badRequest(
          '只有 draft 状态的 BOM 允许修改明细',
          ResponseCode.BOM_STATUS_CONFLICT,
        );
      }
      capturedVersion = header.version;

      // 2. 再锁 item（校验明细存在、归属租户、归属 bomId）
      const [item] = await manager.query<Array<{ id: number }>>(
        `SELECT id FROM bom_items
         WHERE id = ? AND tenant_id = ? AND bom_header_id = ? LIMIT 1 FOR UPDATE`,
        [itemId, this.tenantId, bomId],
      );
      if (!item) throw AppError.notFound('BOM明细不存在', ResponseCode.BOM_NOT_FOUND);

      // 3. 动态构建 SET 子句（仅更新有传入的字段）
      const setClauses: string[] = ['updated_by = ?'];
      const params: unknown[] = [this.userId];

      if (payload.quantity  !== undefined) { setClauses.push('quantity = ?');   params.push(payload.quantity); }
      if (payload.unit      !== undefined) { setClauses.push('unit = ?');        params.push(payload.unit); }
      if (payload.scrapRate !== undefined) { setClauses.push('scrap_rate = ?'); params.push(payload.scrapRate); }

      params.push(itemId, this.tenantId, bomId);

      await manager.query(
        `UPDATE bom_items SET ${setClauses.join(', ')}
         WHERE id = ? AND tenant_id = ? AND bom_header_id = ?`,
        params,
      );
    });

    // 4. 事务提交后失效 Redis 展开缓存
    await this.invalidateExpandedCache();
  }

  // ── BOM 导出 Excel ───────────────────────────────────────────

  /**
   * 将指定 BOM 导出为 Excel (.xlsx) Buffer。
   * 第一行：BOM 基本信息（成品名、版本、状态）。
   * 第三行起：物料明细表头 + 数据（递归展开 items 树，层级用缩进表示）。
   */
  async exportBomToExcel(bomId: number): Promise<Buffer> {
    const bom = await this.getBomWithExpansion(bomId);

    // 扁平化 items 树为行记录
    interface ExcelRow {
      层级: string;
      SKU编码: string;
      物料名称: string;
      规格: string;
      用量: string;
      单位: string;
      损耗率: string;
    }

    const flatRows: ExcelRow[] = [];

    const flatten = (nodes: BomItemNode[]): void => {
      for (const node of nodes) {
        const indent = '  '.repeat(node.level - 1);
        flatRows.push({
          层级:     `${indent}L${node.level}`,
          SKU编码:  node.skuCode,
          物料名称: node.skuName,
          规格:     node.spec ?? '',
          用量:     node.quantity,
          单位:     node.unit,
          损耗率:   node.scrapRate,
        });
        if (node.children.length > 0) {
          flatten(node.children);
        }
      }
    };
    flatten(bom.items);

    const workbook = XLSX.utils.book_new();

    // 第一行：BOM 基本信息（使用 aoa_to_sheet 自定义布局）
    const infoRows: unknown[][] = [
      ['成品名称', bom.skuName ?? '', '版本', bom.version, '状态', formatBomStatus(bom.status)],
      [],  // 空行（第二行）
      // 第三行起：物料明细（由 sheet_add_json 追加）
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(infoRows);

    // 从第三行（origin: 2，0-indexed）开始写物料明细
    XLSX.utils.sheet_add_json(worksheet, flatRows, {
      origin: 2,
      skipHeader: false,
    });

    XLSX.utils.book_append_sheet(workbook, worksheet, 'BOM明细');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return buffer;
  }

  // ── 私有辅助 ────────────────────────────────────────────────

  private async getBomHeader(bomId: number): Promise<BomHeader> {
    const [header] = await AppDataSource.query<Array<{
      id: number; sku_id: number; sku_name: string; sku_code: string; version: string; status: string; description: string | null;
    }>>(
      `SELECT b.id, b.sku_id, s.name AS sku_name, s.sku_code, b.version, b.status, b.description
       FROM bom_headers b INNER JOIN skus s ON s.id = b.sku_id
       WHERE b.id = ? AND b.tenant_id = ? LIMIT 1`,
      [bomId, this.tenantId],
    );
    if (!header) throw AppError.notFound('BOM不存在', ResponseCode.BOM_NOT_FOUND);
    return { id: header.id, skuId: header.sku_id, skuName: header.sku_name, skuCode: header.sku_code, version: header.version, status: header.status, description: header.description ?? undefined, items: [] };
  }

  private async assertBomComponentAllowed(
    manager: import('typeorm').EntityManager,
    skuId: number,
  ): Promise<void> {
    const [sku] = await manager.query<Array<{
      id: number;
      business_class: string;
      allow_bom_component: number;
    }>>(
      `SELECT id, business_class, allow_bom_component
       FROM skus
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [skuId, this.tenantId],
    );

    if (!sku) {
      throw AppError.notFound(`SKU不存在：${skuId}`, ResponseCode.SKU_NOT_FOUND);
    }

    if (sku.business_class === 'fixed_asset' || !Boolean(sku.allow_bom_component)) {
      throw AppError.badRequest(
        `当前SKU ${skuId} 不允许作为BOM子项，请检查物料管控属性`,
        ResponseCode.INVALID_PARAMS,
      );
    }
  }
}
