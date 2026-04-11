import { AppDataSource } from '../../config/database';

export type SemiFinishedModeTag = 'internal_only' | 'outsource_only' | 'mixed' | 'no_operation';

export interface SemiFinishedModeReportRow {
  skuId: number;
  skuCode: string;
  skuName: string;
  skuSpec: string | null;
  internalPlannedQty: string;
  outsourcePlannedQty: string;
  internalCompletedQty: string;
  outsourceCompletedQty: string;
  modeTag: SemiFinishedModeTag;
}

export interface SemiFinishedModeReportFilter {
  page: number;
  pageSize: number;
  from?: string;
  to?: string;
  keyword?: string;
  modeTag?: SemiFinishedModeTag;
}

export class ProductionModeReportService {
  private readonly tenantId: number;

  constructor(ctx: { tenantId: number }) {
    this.tenantId = ctx.tenantId;
  }

  private mapRow(row: Record<string, unknown>): SemiFinishedModeReportRow {
    return {
      skuId: Number(row['skuId']),
      skuCode: String(row['skuCode'] ?? ''),
      skuName: String(row['skuName'] ?? ''),
      skuSpec: row['skuSpec'] != null ? String(row['skuSpec']) : null,
      internalPlannedQty: String(row['internalPlannedQty'] ?? '0'),
      outsourcePlannedQty: String(row['outsourcePlannedQty'] ?? '0'),
      internalCompletedQty: String(row['internalCompletedQty'] ?? '0'),
      outsourceCompletedQty: String(row['outsourceCompletedQty'] ?? '0'),
      modeTag: this.resolveModeTag(
        Number(row['internalOpCount'] ?? 0),
        Number(row['outsourceOpCount'] ?? 0),
      ),
    };
  }

  private resolveModeTag(internalOpCount: number, outsourceOpCount: number): SemiFinishedModeTag {
    if (internalOpCount > 0 && outsourceOpCount > 0) return 'mixed';
    if (outsourceOpCount > 0) return 'outsource_only';
    if (internalOpCount > 0) return 'internal_only';
    return 'no_operation';
  }

  private async resolveExecutionModeExpr(): Promise<string> {
    const [row] = await AppDataSource.query<Array<{ cnt: string }>>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'production_operations'
         AND column_name = 'execution_mode'`,
    );
    if (Number(row?.cnt ?? 0) > 0) {
      return "COALESCE(po.execution_mode, 'internal')";
    }
    return "'internal'";
  }

  async getSemiFinishedModeReport(
    filter: SemiFinishedModeReportFilter,
  ): Promise<[SemiFinishedModeReportRow[], number]> {
    const { page, pageSize, from, to, keyword, modeTag } = filter;
    const executionModeExpr = await this.resolveExecutionModeExpr();

    const opConditions: string[] = [
      'po.tenant_id = ?',
      'po.output_sku_id IS NOT NULL',
      "po.status <> 'cancelled'",
    ];
    const opParams: unknown[] = [this.tenantId];
    if (from) {
      opConditions.push('po.created_at >= ?');
      opParams.push(from);
    }
    if (to) {
      opConditions.push('po.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
      opParams.push(to);
    }

    const skuConditions: string[] = [
      's.tenant_id = ?',
      "s.status <> 'inactive'",
      "c1.code = 'SEMIFIN'",
    ];
    const skuParams: unknown[] = [this.tenantId];
    if (keyword) {
      skuConditions.push('(s.sku_code LIKE ? OR s.name LIKE ? OR s.spec LIKE ?)');
      const kw = `%${keyword}%`;
      skuParams.push(kw, kw, kw);
    }

    if (modeTag === 'internal_only') {
      skuConditions.push('COALESCE(agg.internalOpCount, 0) > 0 AND COALESCE(agg.outsourceOpCount, 0) = 0');
    } else if (modeTag === 'outsource_only') {
      skuConditions.push('COALESCE(agg.outsourceOpCount, 0) > 0 AND COALESCE(agg.internalOpCount, 0) = 0');
    } else if (modeTag === 'mixed') {
      skuConditions.push('COALESCE(agg.internalOpCount, 0) > 0 AND COALESCE(agg.outsourceOpCount, 0) > 0');
    } else if (modeTag === 'no_operation') {
      skuConditions.push('COALESCE(agg.internalOpCount, 0) = 0 AND COALESCE(agg.outsourceOpCount, 0) = 0');
    }

    const where = skuConditions.join(' AND ');
    const aggregateSubQuery = `
      SELECT
        po.output_sku_id AS skuId,
        SUM(CASE WHEN ${executionModeExpr} = 'internal' THEN po.planned_qty ELSE 0 END) AS internalPlannedQty,
        SUM(CASE WHEN ${executionModeExpr} = 'outsource' THEN po.planned_qty ELSE 0 END) AS outsourcePlannedQty,
        SUM(CASE WHEN ${executionModeExpr} = 'internal' THEN po.completed_qty ELSE 0 END) AS internalCompletedQty,
        SUM(CASE WHEN ${executionModeExpr} = 'outsource' THEN po.completed_qty ELSE 0 END) AS outsourceCompletedQty,
        SUM(CASE WHEN ${executionModeExpr} = 'internal' THEN 1 ELSE 0 END) AS internalOpCount,
        SUM(CASE WHEN ${executionModeExpr} = 'outsource' THEN 1 ELSE 0 END) AS outsourceOpCount
      FROM production_operations po
      WHERE ${opConditions.join(' AND ')}
      GROUP BY po.output_sku_id
    `;

    const countSql = `
      SELECT COUNT(*) AS cnt
      FROM skus s
      INNER JOIN sku_categories c1 ON c1.id = s.category1_id
      LEFT JOIN (${aggregateSubQuery}) agg ON agg.skuId = s.id
      WHERE ${where}
    `;
    const countRows = await AppDataSource.query<Array<{ cnt: string }>>(countSql, [...opParams, ...skuParams]);
    const total = Number(countRows[0]?.cnt ?? 0);
    if (total === 0) {
      return [[], 0];
    }

    const listSql = `
      SELECT
        s.id AS skuId,
        s.sku_code AS skuCode,
        s.name AS skuName,
        s.spec AS skuSpec,
        COALESCE(agg.internalPlannedQty, 0) AS internalPlannedQty,
        COALESCE(agg.outsourcePlannedQty, 0) AS outsourcePlannedQty,
        COALESCE(agg.internalCompletedQty, 0) AS internalCompletedQty,
        COALESCE(agg.outsourceCompletedQty, 0) AS outsourceCompletedQty,
        COALESCE(agg.internalOpCount, 0) AS internalOpCount,
        COALESCE(agg.outsourceOpCount, 0) AS outsourceOpCount
      FROM skus s
      INNER JOIN sku_categories c1 ON c1.id = s.category1_id
      LEFT JOIN (${aggregateSubQuery}) agg ON agg.skuId = s.id
      WHERE ${where}
      ORDER BY
        COALESCE(agg.outsourceOpCount, 0) DESC,
        COALESCE(agg.internalOpCount, 0) DESC,
        s.sku_code ASC
      LIMIT ? OFFSET ?
    `;

    const rows = await AppDataSource.query<Array<Record<string, unknown>>>(
      listSql,
      [...opParams, ...skuParams, pageSize, (page - 1) * pageSize],
    );

    return [rows.map((row) => this.mapRow(row)), total];
  }
}
