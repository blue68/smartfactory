import { createHash } from 'crypto';
import { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { BomExpansionService, ExpandedMaterial } from './bom-expansion.service';
import { generateNo } from '../../shared/generateNo';

export interface SnapshotResult {
  snapshotId: number;
  expandedItems: ExpandedMaterial[];
  reused: boolean;
}

interface ExistingSnapshotRow {
  id: number;
}

interface BomVersionRow {
  version: string;
}

/**
 * BOM 快照管理服务
 * BD-001：工单创建时冻结 BOM 版本，确保生产过程中 BOM 变更不影响进行中的工单。
 *
 * 快照复用策略：相同 SHA-256 hash 的展开结果视为相同快照，直接复用已有记录。
 */
export class BomSnapshotService {
  private readonly tenantId: number;
  private readonly userId: number;
  private readonly expansionSvc: BomExpansionService;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
    this.expansionSvc = new BomExpansionService(ctx);
  }

  /**
   * 在事务内创建（或复用）BOM 快照
   * @param bomHeaderId  BOM 头 ID
   * @param qtyPlanned   生产数量（用于展开计算）
   * @param manager      事务管理器（必须在事务内调用）
   */
  async createSnapshot(
    bomHeaderId: number,
    qtyPlanned: string,
    manager: EntityManager,
  ): Promise<SnapshotResult> {
    // Step 1: 展开 BOM
    const expandedItems = await this.expansionSvc.expandBOM(
      bomHeaderId,
      qtyPlanned,
      manager,
    );

    // Step 2: 计算快照 hash（对确定性序列化后的结果取 SHA-256）
    const sortedItems = [...expandedItems].sort((a, b) => a.skuId - b.skuId);
    const snapshotData = JSON.stringify(sortedItems);
    const snapshotHash = createHash('sha256').update(snapshotData).digest('hex');

    // Step 3: 检查是否已存在相同 hash 的快照（复用）
    const existing: ExistingSnapshotRow[] = await manager.query(
      `SELECT id FROM bom_version_snapshots
       WHERE bom_header_id = ? AND tenant_id = ? AND snapshot_hash = ?
       LIMIT 1`,
      [bomHeaderId, this.tenantId, snapshotHash],
    );

    if (existing.length > 0) {
      return {
        snapshotId: existing[0].id,
        expandedItems,
        reused: true,
      };
    }

    // Step 4: 查询当前 BOM 版本号（记录到快照）
    const bomVersionRows: BomVersionRow[] = await manager.query(
      `SELECT version FROM bom_headers WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [bomHeaderId, this.tenantId],
    );
    const bomVersion = bomVersionRows[0]?.version ?? '1';

    // Step 5: 生成快照编号
    const snapshotNo = await generateNo('bom_snapshot', this.tenantId);

    // Step 6: INSERT bom_version_snapshots
    const insertResult = await manager.query(
      `INSERT INTO bom_version_snapshots
         (tenant_id, bom_header_id, snapshot_no, bom_version, snapshot_data, snapshot_hash, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        this.tenantId,
        bomHeaderId,
        snapshotNo,
        bomVersion,
        snapshotData,
        snapshotHash,
        this.userId,
      ],
    );

    return {
      snapshotId: Number(insertResult.insertId),
      expandedItems,
      reused: false,
    };
  }

  /**
   * 查询已有快照的展开数据（通过 snapshotId）
   */
  async getSnapshotItems(snapshotId: number): Promise<ExpandedMaterial[]> {
    const rows: Array<{ snapshot_data: string }> = await AppDataSource.query(
      `SELECT snapshot_data FROM bom_version_snapshots
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [snapshotId, this.tenantId],
    );

    if (rows.length === 0) return [];

    return JSON.parse(rows[0].snapshot_data) as ExpandedMaterial[];
  }
}
