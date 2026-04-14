import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { buildPaginated } from '../../shared/ApiResponse';
import { generateNo } from '../../shared/generateNo';

export interface ListAssetCardParams {
  page: number;
  pageSize: number;
  status?: string;
  departmentId?: number;
  keyword?: string;
}

export interface CreateAssetAcceptanceParams {
  receiptId: number;
  items: Array<{
    receiptItemId: number;
    cards: Array<{
      assetName?: string;
      serialNo?: string;
      assetTagNo?: string;
      departmentId?: number;
      custodianUserId?: number;
      locationText?: string;
      notes?: string;
    }>;
  }>;
}

export interface AssetTransferParams {
  departmentId?: number;
  custodianUserId?: number;
  locationText?: string;
  notes?: string;
}

export interface AssetScrapParams {
  notes?: string;
}

export interface AssetReturnParams {
  locationText?: string;
  notes?: string;
}

export class AssetService {
  private readonly tenantId: number;
  private readonly userId: number;
  private static purchaseReceiptItemControlColumnsSupported: boolean | null = null;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  private mergeNotes(...values: Array<unknown>): string | null {
    const merged = values
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
      .join('\n');
    return merged || null;
  }

  private async hasPurchaseReceiptItemControlColumns(
    runner: Pick<typeof AppDataSource, 'query'> = AppDataSource,
  ): Promise<boolean> {
    if (AssetService.purchaseReceiptItemControlColumnsSupported !== null) {
      return AssetService.purchaseReceiptItemControlColumnsSupported;
    }

    const rows = await runner.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'purchase_receipt_items'
         AND column_name = 'receipt_mode'`,
    );

    AssetService.purchaseReceiptItemControlColumnsSupported = Number(rows[0]?.cnt ?? 0) > 0;
    return AssetService.purchaseReceiptItemControlColumnsSupported;
  }

  async listCards(params: ListAssetCardParams) {
    const conds = ['ac.tenant_id = ?'];
    const args: unknown[] = [this.tenantId];
    if (params.status) {
      conds.push('ac.status = ?');
      args.push(params.status);
    }
    if (params.departmentId) {
      conds.push('ac.department_id = ?');
      args.push(params.departmentId);
    }
    if (params.keyword?.trim()) {
      const keyword = `%${params.keyword.trim()}%`;
      conds.push('(ac.asset_no LIKE ? OR ac.asset_name LIKE ? OR s.sku_code LIKE ? OR ac.serial_no LIKE ? OR ac.asset_tag_no LIKE ?)');
      args.push(keyword, keyword, keyword, keyword, keyword);
    }

    const where = conds.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query<Array<Record<string, unknown>>>(
        `SELECT
           ac.id,
           ac.asset_no AS assetNo,
           ac.asset_name AS assetName,
           ac.asset_category AS assetCategory,
           ac.serial_no AS serialNo,
           ac.asset_tag_no AS assetTagNo,
           ac.status,
           ac.department_id AS departmentId,
           ac.custodian_user_id AS custodianUserId,
           d.name AS departmentName,
           COALESCE(cu.real_name, cu.username) AS custodianName,
           cu.username AS custodianUsername,
           ac.location_text AS locationText,
           ac.original_value AS originalValue,
           ac.net_value AS netValue,
           ac.capitalized_at AS capitalizedAt,
           ac.created_at AS createdAt,
           s.sku_code AS skuCode,
           s.name AS skuName
         FROM asset_cards ac
         INNER JOIN skus s ON s.id = ac.sku_id AND s.tenant_id = ac.tenant_id
         LEFT JOIN departments d ON d.id = ac.department_id AND d.tenant_id = ac.tenant_id
         LEFT JOIN users cu ON cu.id = ac.custodian_user_id AND cu.tenant_id = ac.tenant_id
         WHERE ${where}
         ORDER BY ac.id DESC
         LIMIT ? OFFSET ?`,
        [...args, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total
         FROM asset_cards ac
         INNER JOIN skus s ON s.id = ac.sku_id AND s.tenant_id = ac.tenant_id
         WHERE ${where}`,
        args,
      ),
    ]);

    return buildPaginated(list, Number(countRows[0]?.total ?? 0), params.page, params.pageSize);
  }

  async getCardById(id: number) {
    const [card] = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT
         ac.id,
         ac.asset_no AS assetNo,
         ac.asset_name AS assetName,
         ac.asset_category AS assetCategory,
         ac.tracking_mode AS trackingMode,
         ac.serial_no AS serialNo,
         ac.asset_tag_no AS assetTagNo,
         ac.status,
         ac.receipt_id AS receiptId,
         ac.receipt_item_id AS receiptItemId,
         ac.purchase_order_id AS purchaseOrderId,
         ac.purchase_item_id AS purchaseItemId,
         ac.department_id AS departmentId,
         ac.custodian_user_id AS custodianUserId,
         d.name AS departmentName,
         COALESCE(cu.real_name, cu.username) AS custodianName,
         cu.username AS custodianUsername,
         ac.location_text AS locationText,
         ac.original_value AS originalValue,
         ac.net_value AS netValue,
         ac.capitalized_at AS capitalizedAt,
         ac.notes,
         ac.created_at AS createdAt,
         ac.updated_at AS updatedAt,
         pr.receipt_no AS receiptNo,
         s.sku_code AS skuCode,
         s.name AS skuName
       FROM asset_cards ac
       INNER JOIN skus s ON s.id = ac.sku_id AND s.tenant_id = ac.tenant_id
       LEFT JOIN departments d ON d.id = ac.department_id AND d.tenant_id = ac.tenant_id
       LEFT JOIN users cu ON cu.id = ac.custodian_user_id AND cu.tenant_id = ac.tenant_id
       LEFT JOIN purchase_receipts pr ON pr.id = ac.receipt_id AND pr.tenant_id = ac.tenant_id
       WHERE ac.id = ? AND ac.tenant_id = ?
       LIMIT 1`,
      [id, this.tenantId],
    );

    if (!card) {
      throw AppError.notFound('固定资产卡片不存在');
    }

    const movements = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT
         am.id,
         am.movement_no AS movementNo,
         am.movement_type AS movementType,
         am.from_department_id AS fromDepartmentId,
         am.to_department_id AS toDepartmentId,
         fd.name AS fromDepartmentName,
         td.name AS toDepartmentName,
         am.from_location_text AS fromLocationText,
         am.to_location_text AS toLocationText,
         am.reference_type AS referenceType,
         am.reference_id AS referenceId,
         CASE
           WHEN am.reference_type = 'purchase_receipt' THEN pr.receipt_no
           WHEN am.reference_type = 'asset_card' THEN refCard.asset_no
           ELSE NULL
         END AS referenceNo,
         am.notes,
         am.occurred_at AS occurredAt
       FROM asset_movements am
       LEFT JOIN departments fd ON fd.id = am.from_department_id AND fd.tenant_id = am.tenant_id
       LEFT JOIN departments td ON td.id = am.to_department_id AND td.tenant_id = am.tenant_id
       LEFT JOIN purchase_receipts pr
         ON am.reference_type = 'purchase_receipt'
        AND pr.id = am.reference_id
        AND pr.tenant_id = am.tenant_id
       LEFT JOIN asset_cards refCard
         ON am.reference_type = 'asset_card'
        AND refCard.id = am.reference_id
        AND refCard.tenant_id = am.tenant_id
       WHERE am.asset_card_id = ? AND am.tenant_id = ?
       ORDER BY am.id DESC`,
      [id, this.tenantId],
    );

    return { ...card, movements };
  }

  async acceptAssets(params: CreateAssetAcceptanceParams) {
    const createdCards: Array<{ id: number; assetNo: string; receiptItemId: number }> = [];

    await AppDataSource.transaction(async (manager) => {
      const supportsReceiptItemControlColumns = await this.hasPurchaseReceiptItemControlColumns(manager);
      const [receipt] = await manager.query<Array<{ id: number; po_id: number }>>(
        `SELECT id, po_id
         FROM purchase_receipts
         WHERE id = ? AND tenant_id = ?
         LIMIT 1
         FOR UPDATE`,
        [params.receiptId, this.tenantId],
      );

      if (!receipt) {
        throw AppError.notFound('采购入库单不存在');
      }

      for (const item of params.items) {
        const [receiptItem] = await manager.query<Array<{
          id: number;
          sku_id: number;
          qty_received: string;
          unit_price: string;
          amount: string;
          po_item_id: number | null;
          business_class?: string | null;
          receipt_mode?: string | null;
          requires_acceptance?: number | null;
          sku_business_class?: string | null;
          control_mode?: string | null;
          asset_tracking_mode?: string | null;
          sku_name?: string | null;
          asset_category?: string | null;
          requires_serial_no?: number | null;
        }>>(
          `SELECT
             pri.id,
             pri.sku_id,
             pri.qty_received,
             pri.unit_price,
             pri.amount,
             ${supportsReceiptItemControlColumns ? 'pri.po_item_id,' : 'NULL AS po_item_id,'}
             ${supportsReceiptItemControlColumns ? 'pri.business_class,' : 'NULL AS business_class,'}
             ${supportsReceiptItemControlColumns ? 'pri.receipt_mode,' : 'NULL AS receipt_mode,'}
             ${supportsReceiptItemControlColumns ? 'pri.requires_acceptance,' : 'NULL AS requires_acceptance,'}
             s.business_class AS sku_business_class,
             s.control_mode,
             s.asset_tracking_mode,
             s.requires_asset_acceptance,
             s.name AS sku_name,
             ap.asset_category,
             ap.requires_serial_no
           FROM purchase_receipt_items pri
           INNER JOIN skus s ON s.id = pri.sku_id AND s.tenant_id = pri.tenant_id
           LEFT JOIN sku_asset_profiles ap ON ap.sku_id = s.id AND ap.tenant_id = s.tenant_id
           WHERE pri.id = ? AND pri.receipt_id = ? AND pri.tenant_id = ?
           LIMIT 1
           FOR UPDATE`,
          [item.receiptItemId, params.receiptId, this.tenantId],
        );

        if (!receiptItem) {
          throw AppError.badRequest(`入库明细不存在：${item.receiptItemId}`);
        }

        const receiptBusinessClass = String(receiptItem.business_class ?? receiptItem.sku_business_class ?? '');
        const receiptMode = String(receiptItem.receipt_mode ?? receiptItem.control_mode ?? '');
        if (receiptBusinessClass !== 'fixed_asset' || receiptMode !== 'asset_capitalization') {
          throw AppError.badRequest(`入库明细 ${item.receiptItemId} 不是固定资产资本化收货`);
        }

        const [aggregate] = await manager.query<Array<{ acceptedCount: number }>>(
          `SELECT COUNT(*) AS acceptedCount
           FROM asset_cards
           WHERE receipt_item_id = ? AND tenant_id = ?`,
          [item.receiptItemId, this.tenantId],
        );
        const receivedQty = new Decimal(receiptItem.qty_received || '0');
        const nextAcceptedCount = Number(aggregate?.acceptedCount ?? 0) + item.cards.length;
        if (nextAcceptedCount > receivedQty.toNumber()) {
          throw AppError.badRequest(`入库明细 ${item.receiptItemId} 建卡数量超过已收货数量`);
        }

        const unitValue = receivedQty.gt(0)
          ? new Decimal(receiptItem.amount || '0').div(receivedQty)
          : new Decimal(receiptItem.unit_price || '0');

        for (const cardInput of item.cards) {
          if (Boolean(Number(receiptItem.requires_serial_no ?? 0)) && !cardInput.serialNo?.trim()) {
            throw AppError.badRequest(`入库明细 ${item.receiptItemId} 要求录入序列号`);
          }

          const assetNo = await generateNo('asset_card', this.tenantId);
          const assetName = cardInput.assetName?.trim() || String(receiptItem.sku_name ?? '固定资产');
          const notes = this.mergeNotes(cardInput.notes);

          const insertResult = await manager.query(
            `INSERT INTO asset_cards
               (tenant_id, asset_no, sku_id, receipt_id, receipt_item_id, purchase_order_id, purchase_item_id,
                asset_name, asset_category, tracking_mode, serial_no, asset_tag_no, status, department_id,
                custodian_user_id, location_text, original_value, net_value, capitalized_at, notes, created_by, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?, ?, ?, NOW(3), ?, ?, ?)`,
            [
              this.tenantId,
              assetNo,
              receiptItem.sku_id,
              params.receiptId,
              item.receiptItemId,
              receipt.po_id,
              receiptItem.po_item_id ?? null,
              assetName,
              receiptItem.asset_category ?? null,
              String(receiptItem.asset_tracking_mode ?? 'serial'),
              cardInput.serialNo?.trim() || null,
              cardInput.assetTagNo?.trim() || null,
              cardInput.departmentId ?? null,
              cardInput.custodianUserId ?? null,
              cardInput.locationText?.trim() || null,
              unitValue.toFixed(2),
              unitValue.toFixed(2),
              notes,
              this.userId,
              this.userId,
            ],
          );
          const assetCardId = Number(insertResult.insertId);
          const movementNo = await generateNo('asset_movement', this.tenantId);

          await manager.query(
            `INSERT INTO asset_movements
               (tenant_id, asset_card_id, movement_no, movement_type, to_department_id, to_location_text, reference_type, reference_id, notes, occurred_at, created_by)
             VALUES (?, ?, ?, 'acceptance', ?, ?, 'purchase_receipt', ?, ?, NOW(3), ?)`,
            [
              this.tenantId,
              assetCardId,
              movementNo,
              cardInput.departmentId ?? null,
              cardInput.locationText?.trim() || null,
              params.receiptId,
              notes,
              this.userId,
            ],
          );

          createdCards.push({ id: assetCardId, assetNo, receiptItemId: item.receiptItemId });
        }
      }
    });

    return {
      receiptId: params.receiptId,
      createdCount: createdCards.length,
      cards: createdCards,
    };
  }

  async transferCard(id: number, params: AssetTransferParams): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
      const [card] = await manager.query<Array<{
        department_id: number | null;
        location_text: string | null;
        status: string;
      }>>(
        `SELECT department_id, location_text, status
         FROM asset_cards
         WHERE id = ? AND tenant_id = ?
         LIMIT 1
         FOR UPDATE`,
        [id, this.tenantId],
      );

      if (!card) {
        throw AppError.notFound('固定资产卡片不存在');
      }
      if (card.status === 'scrapped') {
        throw AppError.conflict('已报废资产不允许调拨');
      }

      await manager.query(
        `UPDATE asset_cards
         SET department_id = ?, custodian_user_id = ?, location_text = ?, status = 'in_use', notes = ?, updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [
          params.departmentId ?? null,
          params.custodianUserId ?? null,
          params.locationText?.trim() || null,
          this.mergeNotes(params.notes),
          this.userId,
          id,
          this.tenantId,
        ],
      );

      const movementNo = await generateNo('asset_movement', this.tenantId);
      await manager.query(
        `INSERT INTO asset_movements
           (tenant_id, asset_card_id, movement_no, movement_type, from_department_id, to_department_id, from_location_text, to_location_text, reference_type, reference_id, notes, occurred_at, created_by)
         VALUES (?, ?, ?, 'transfer', ?, ?, ?, ?, 'asset_card', ?, ?, NOW(3), ?)`,
        [
          this.tenantId,
          id,
          movementNo,
          card.department_id ?? null,
          params.departmentId ?? null,
          card.location_text ?? null,
          params.locationText?.trim() || null,
          id,
          this.mergeNotes(params.notes),
          this.userId,
        ],
      );
    });
  }

  async scrapCard(id: number, params: AssetScrapParams): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
      const [card] = await manager.query<Array<{
        department_id: number | null;
        location_text: string | null;
        status: string;
      }>>(
        `SELECT department_id, location_text, status
         FROM asset_cards
         WHERE id = ? AND tenant_id = ?
         LIMIT 1
         FOR UPDATE`,
        [id, this.tenantId],
      );

      if (!card) {
        throw AppError.notFound('固定资产卡片不存在');
      }
      if (card.status === 'scrapped') {
        throw AppError.conflict('资产已报废，无需重复操作');
      }

      await manager.query(
        `UPDATE asset_cards
         SET status = 'scrapped', net_value = 0, notes = ?, updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [this.mergeNotes(params.notes), this.userId, id, this.tenantId],
      );

      const movementNo = await generateNo('asset_movement', this.tenantId);
      await manager.query(
        `INSERT INTO asset_movements
           (tenant_id, asset_card_id, movement_no, movement_type, from_department_id, from_location_text, reference_type, reference_id, notes, occurred_at, created_by)
         VALUES (?, ?, ?, 'scrap', ?, ?, 'asset_card', ?, ?, NOW(3), ?)`,
        [
          this.tenantId,
          id,
          movementNo,
          card.department_id ?? null,
          card.location_text ?? null,
          id,
          this.mergeNotes(params.notes),
          this.userId,
        ],
      );
    });
  }

  async returnCard(id: number, params: AssetReturnParams): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
      const [card] = await manager.query<Array<{
        department_id: number | null;
        custodian_user_id: number | null;
        location_text: string | null;
        status: string;
      }>>(
        `SELECT department_id, custodian_user_id, location_text, status
         FROM asset_cards
         WHERE id = ? AND tenant_id = ?
         LIMIT 1
         FOR UPDATE`,
        [id, this.tenantId],
      );

      if (!card) {
        throw AppError.notFound('固定资产卡片不存在');
      }
      if (card.status === 'scrapped') {
        throw AppError.conflict('已报废资产不允许退回');
      }

      const nextLocationText = params.locationText?.trim() || card.location_text || null;
      await manager.query(
        `UPDATE asset_cards
         SET department_id = NULL,
             custodian_user_id = NULL,
             location_text = ?,
             status = 'idle',
             notes = ?,
             updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [
          nextLocationText,
          this.mergeNotes(params.notes),
          this.userId,
          id,
          this.tenantId,
        ],
      );

      const movementNo = await generateNo('asset_movement', this.tenantId);
      await manager.query(
        `INSERT INTO asset_movements
           (tenant_id, asset_card_id, movement_no, movement_type, from_department_id, from_location_text, to_location_text, reference_type, reference_id, notes, occurred_at, created_by)
         VALUES (?, ?, ?, 'return', ?, ?, ?, 'asset_card', ?, ?, NOW(3), ?)`,
        [
          this.tenantId,
          id,
          movementNo,
          card.department_id ?? null,
          card.location_text ?? null,
          nextLocationText,
          id,
          this.mergeNotes(params.notes),
          this.userId,
        ],
      );
    });
  }
}
