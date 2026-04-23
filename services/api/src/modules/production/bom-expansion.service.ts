import Decimal from 'decimal.js';
import { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';

export interface ExpandedMaterial {
  skuId: number;
  qty: string;
  unit: string;
  level: number;
}

interface BomItemRow {
  id: number;
  component_sku_id: number;
  business_class: string;
  control_mode: string;
  quantity: string;
  scrap_rate: string;
  unit: string;
}

interface BomHeaderIdRow {
  id: number;
}

/**
 * BOM 展开服务
 * BD-001：递归展开多层 BOM，合并同一 sku_id 的数量，返回原材料需求列表。
 * 最大展开层级为 10，防止深度过大或循环引用导致的栈溢出。
 */
export class BomExpansionService {
  private readonly tenantId: number;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
  }

  /**
   * 展开 BOM，返回合并后的原材料需求列表
   * @param bomHeaderId   BOM 头 ID
   * @param qtyPlanned    生产数量
   * @param manager       可选事务管理器（事务内调用时传入）
   */
  async expandBOM(
    bomHeaderId: number,
    qtyPlanned: string,
    manager?: EntityManager,
  ): Promise<ExpandedMaterial[]> {
    const rawItems = await this._doExpandBOM(
      bomHeaderId,
      new Decimal(qtyPlanned),
      1,
      new Set<number>(),
      manager,
    );
    return this._mergeBySkuId(rawItems);
  }

  // ── 私有递归展开 ─────────────────────────────────────────────────────

  private async _doExpandBOM(
    bomHeaderId: number,
    qty: Decimal,
    level: number,
    visited: Set<number>,
    manager?: EntityManager,
  ): Promise<ExpandedMaterial[]> {
    if (level > 10) {
      throw AppError.badRequest(
        `BOM 层级超过最大限制（10 层），请检查 BOM 配置`,
        ResponseCode.BOM_CIRCULAR_REF,
      );
    }

    if (visited.has(bomHeaderId)) {
      throw AppError.badRequest(
        `BOM 存在循环引用（bom_header_id=${bomHeaderId}）`,
        ResponseCode.BOM_CIRCULAR_REF,
      );
    }

    visited.add(bomHeaderId);

    const query = manager
      ? manager.query.bind(manager)
      : AppDataSource.query.bind(AppDataSource);

    const items: BomItemRow[] = await query(
      `SELECT
         bi.id,
         bi.component_sku_id,
         s.business_class,
         s.control_mode,
         bi.quantity,
         bi.scrap_rate,
         bi.unit
       FROM bom_items bi
       INNER JOIN skus s
         ON s.id = bi.component_sku_id
        AND s.tenant_id = bi.tenant_id
       WHERE bi.bom_header_id = ? AND bi.tenant_id = ?
       ORDER BY bi.sort_order, bi.id`,
      [bomHeaderId, this.tenantId],
    );

    const result: ExpandedMaterial[] = [];

    for (const item of items) {
      // 计算考虑损耗率后的需求数量
      const adjustedQty = qty
        .mul(new Decimal(item.quantity))
        .mul(new Decimal(1).plus(new Decimal(item.scrap_rate)));

      // 检查该组件是否存在激活的子 BOM（半成品）
      const subBomRows: BomHeaderIdRow[] = await query(
        `SELECT id FROM bom_headers
         WHERE sku_id = ? AND tenant_id = ? AND status = 'active'
         LIMIT 1`,
        [item.component_sku_id, this.tenantId],
      );

      if (subBomRows.length > 0) {
        // 有激活 BOM，递归展开（克隆 visited 防止兄弟节点误报循环）
        const subVisited = new Set(visited);
        const subItems = await this._doExpandBOM(
          subBomRows[0].id,
          adjustedQty,
          level + 1,
          subVisited,
          manager,
        );
        result.push(...subItems);
      } else {
        if (item.business_class !== 'production_material') {
          continue;
        }
        // 原材料，直接加入列表
        result.push({
          skuId: item.component_sku_id,
          qty: adjustedQty.toFixed(6),
          unit: item.unit,
          level,
        });
      }
    }

    return result;
  }

  /**
   * 将相同 skuId 的条目合并，取最低 level（在 BOM 树中的最浅层）
   */
  private _mergeBySkuId(items: ExpandedMaterial[]): ExpandedMaterial[] {
    const map = new Map<number, ExpandedMaterial>();

    for (const item of items) {
      const existing = map.get(item.skuId);
      if (existing) {
        existing.qty = new Decimal(existing.qty).plus(new Decimal(item.qty)).toFixed(6);
        existing.level = Math.min(existing.level, item.level);
      } else {
        map.set(item.skuId, { ...item });
      }
    }

    return Array.from(map.values());
  }
}
