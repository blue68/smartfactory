import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import Decimal from 'decimal.js';
import { generateNo } from '../../shared/generateNo';

interface ProductionOrderRow {
  id: number;
  work_order_no: string;
  sku_id: number;
  qty_planned: string;
  status: string;
  bom_snapshot_id: number | null;
  process_template_id: number | null;
  process_snapshot: string | null;
}

interface SnapshotItem {
  skuId: number;
  qty: string;
  level?: number;
}

interface ProcessStepRow {
  id: number;
  step_no: number;
  step_name: string;
  output_type: 'semi_finished' | 'final_product' | 'none' | null;
  output_sku_id: number | null;
  execution_mode: 'internal' | 'outsource';
}

interface ProcessSnapshotStep {
  id?: number | string;
  processStepId?: number | string;
  stepNo?: number | string;
  step_no?: number | string;
  stepName?: string;
  name?: string;
  step_name?: string;
  outputType?: 'semi_finished' | 'final_product' | 'none' | null;
  output_type?: 'semi_finished' | 'final_product' | 'none' | null;
  outputSkuId?: number | string | null;
  output_sku_id?: number | string | null;
  executionMode?: 'internal' | 'outsource' | null;
  execution_mode?: 'internal' | 'outsource' | null;
}

interface ProcessSnapshotPayload {
  templateId?: number | null;
  templateName?: string;
  version?: string;
  snapshotAt?: string;
  steps?: ProcessSnapshotStep[];
}

interface ExistingReleaseState {
  operationCount: number;
  componentCount: number;
  resolutionCount: number;
}

interface CreatedComponent {
  id: number;
  skuId: number;
  path: string;
  level: number;
}

export class ProductionPhase1Service {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  async releaseOrder(orderId: number): Promise<{
    productionOrderId: number;
    reused: boolean;
    componentCount: number;
    operationCount: number;
  }> {
    return AppDataSource.transaction(async (manager) => {
      const [order] = await manager.query<ProductionOrderRow[]>(
        `SELECT id, work_order_no, sku_id, qty_planned, status, bom_snapshot_id, process_template_id, process_snapshot
         FROM production_orders
         WHERE id = ? AND tenant_id = ?
         LIMIT 1`,
        [orderId, this.tenantId],
      );

      if (!order) {
        throw AppError.notFound('生产工单不存在', ResponseCode.PRODUCTION_ORDER_NOT_FOUND);
      }

      if (order.status === 'completed' || order.status === 'cancelled') {
        throw AppError.badRequest(`工单状态为「${order.status}」，不可执行 release`, ResponseCode.INVALID_PARAMS);
      }

      if (!order.bom_snapshot_id) {
        throw AppError.badRequest('工单缺少 BOM 快照，无法 release', ResponseCode.INVALID_PARAMS);
      }

      if (!order.process_template_id && !order.process_snapshot) {
        throw AppError.badRequest('工单缺少工艺模板或工艺快照，无法 release', ResponseCode.INVALID_PARAMS);
      }

      const existing = await this.fetchExistingReleaseState(manager, orderId);
      if (existing.operationCount > 0 || existing.componentCount > 0 || existing.resolutionCount > 0) {
        if (!this.isReusableRelease(existing)) {
          throw AppError.conflict('工单 release 数据不完整，请先修复后重试', ResponseCode.CONFLICT);
        }
        await this.ensureOutsourcePurchaseSuggestions(manager, order);
        return {
          productionOrderId: orderId,
          reused: true,
          componentCount: existing.componentCount,
          operationCount: existing.operationCount,
        };
      }

      const processSteps = await this.fetchProcessSteps(
        manager,
        order.id,
        order.process_template_id,
        order.process_snapshot,
      );
      if (processSteps.length === 0) {
        throw AppError.badRequest('工单缺少工序定义，无法 release', ResponseCode.INVALID_PARAMS);
      }
      const rootComponent = await this.insertComponent(
        manager,
        orderId,
        null,
        order.sku_id,
        'fg',
        order.qty_planned,
        0,
        'fg',
      );
      const wipComponentMap = new Map<number, CreatedComponent>();
      let previousWipComponent: CreatedComponent | null = null;

      for (const step of processSteps) {
        if (step.output_type !== 'semi_finished' || !step.output_sku_id) continue;
        if (wipComponentMap.has(step.output_sku_id)) continue;

        const parentComponent = previousWipComponent ?? rootComponent;
        const wipComponent = await this.insertComponent(
          manager,
          orderId,
          parentComponent.id,
          step.output_sku_id,
          'wip',
          order.qty_planned,
          parentComponent.level + 1,
          `${parentComponent.path}/wip:${step.output_sku_id}`,
        );
        wipComponentMap.set(step.output_sku_id, wipComponent);
        previousWipComponent = wipComponent;
      }

      const snapshotItems = await this.fetchSnapshotItems(manager, order.bom_snapshot_id);
      for (const item of snapshotItems) {
        await this.insertComponent(
          manager,
          orderId,
          rootComponent.id,
          item.skuId,
          'rm',
          item.qty,
          item.level ?? 1,
          `fg/rm:${item.skuId}`,
        );
      }

      let previousOperationId: number | null = null;
      for (const step of processSteps) {
        const outputSkuId = step.output_type === 'semi_finished' && step.output_sku_id
          ? step.output_sku_id
          : order.sku_id;
        const componentId = wipComponentMap.get(outputSkuId)?.id ?? rootComponent.id;
        const opInsert = await manager.query(
          `INSERT INTO production_operations
             (tenant_id, production_order_id, component_id, process_step_id, output_sku_id,
              planned_qty, completed_qty, status, execution_mode, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?, ?)`,
          [
            this.tenantId,
            orderId,
            componentId,
            step.id,
            outputSkuId,
            order.qty_planned,
            step.execution_mode === 'outsource' ? 'outsource' : 'internal',
            this.userId,
            this.userId,
          ],
        );
        const operationId = Number(opInsert.insertId);

        if (previousOperationId) {
          await manager.query(
            `INSERT INTO production_operation_dependencies
               (tenant_id, operation_id, predecessor_operation_id, required_qty)
             VALUES (?, ?, ?, ?)`,
            [this.tenantId, operationId, previousOperationId, order.qty_planned],
          );
        }

        previousOperationId = operationId;
      }

      const [componentCountRow] = await manager.query<Array<{ cnt: string }>>(
        `SELECT COUNT(*) AS cnt
         FROM production_order_components
         WHERE production_order_id = ? AND tenant_id = ?`,
        [orderId, this.tenantId],
      );
      const [operationCountRow] = await manager.query<Array<{ cnt: string }>>(
        `SELECT COUNT(*) AS cnt
         FROM production_operations
         WHERE production_order_id = ? AND tenant_id = ?`,
        [orderId, this.tenantId],
      );

      await this.ensureOutsourcePurchaseSuggestions(manager, order);

      return {
        productionOrderId: orderId,
        reused: false,
        componentCount: Number(componentCountRow?.cnt ?? 0),
        operationCount: Number(operationCountRow?.cnt ?? 0),
      };
    });
  }

  async listComponents(orderId: number): Promise<unknown[]> {
    await this.assertOrderExists(orderId);
    return AppDataSource.query(
      `SELECT poc.id, poc.parent_component_id AS parentComponentId,
              poc.sku_id AS skuId, COALESCE(s.name, CONCAT('SKU#', poc.sku_id)) AS skuName,
              poc.resolved_sku_id AS resolvedSkuId,
              COALESCE(rs.name, CONCAT('SKU#', poc.resolved_sku_id)) AS resolvedSkuName,
              poc.component_type AS componentType,
              poc.qty_required AS qtyRequired,
              poc.bom_level AS bomLevel,
              poc.bom_path AS bomPath
       FROM production_order_components poc
       LEFT JOIN skus s ON s.id = poc.sku_id
       LEFT JOIN skus rs ON rs.id = poc.resolved_sku_id
       WHERE poc.production_order_id = ? AND poc.tenant_id = ?
       ORDER BY poc.bom_level ASC, poc.id ASC`,
      [orderId, this.tenantId],
    );
  }

  async listOperations(orderId: number): Promise<unknown[]> {
    await this.assertOrderExists(orderId);
    return AppDataSource.query(
      `SELECT po.id, po.component_id AS componentId,
              poc.component_type AS componentType,
              po.process_step_id AS processStepId,
              ps.step_no AS stepNo,
              COALESCE(ps.step_name, CONCAT('STEP#', po.process_step_id)) AS stepName,
              po.output_sku_id AS outputSkuId,
              po.execution_mode AS executionMode,
              COALESCE(s.name, CONCAT('SKU#', po.output_sku_id)) AS outputSkuName,
              po.planned_qty AS plannedQty,
              po.completed_qty AS completedQty,
              po.status
       FROM production_operations po
       LEFT JOIN production_order_components poc ON poc.id = po.component_id
       LEFT JOIN process_steps ps ON ps.id = po.process_step_id
       LEFT JOIN skus s ON s.id = po.output_sku_id
       WHERE po.production_order_id = ? AND po.tenant_id = ?
       ORDER BY ps.step_no ASC, po.id ASC`,
      [orderId, this.tenantId],
    );
  }

  private async assertOrderExists(orderId: number): Promise<void> {
    const [order] = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT id FROM production_orders WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [orderId, this.tenantId],
    );
    if (!order) {
      throw AppError.notFound('生产工单不存在', ResponseCode.PRODUCTION_ORDER_NOT_FOUND);
    }
  }

  private async fetchExistingReleaseState(
    manager: { query: typeof AppDataSource.query },
    orderId: number,
  ): Promise<ExistingReleaseState> {
    const [existing] = await manager.query<Array<{
      operationCount: string;
      componentCount: string;
      resolutionCount: string;
    }>>(
      `SELECT
          (SELECT COUNT(*) FROM production_operations
           WHERE production_order_id = ? AND tenant_id = ?) AS operationCount,
          (SELECT COUNT(*) FROM production_order_components
           WHERE production_order_id = ? AND tenant_id = ?) AS componentCount,
          (SELECT COUNT(*) FROM production_order_sku_resolutions
           WHERE production_order_id = ? AND tenant_id = ?) AS resolutionCount`,
      [orderId, this.tenantId, orderId, this.tenantId, orderId, this.tenantId],
    );

    return {
      operationCount: Number(existing?.operationCount ?? 0),
      componentCount: Number(existing?.componentCount ?? 0),
      resolutionCount: Number(existing?.resolutionCount ?? 0),
    };
  }

  private isReusableRelease(state: ExistingReleaseState): boolean {
    return state.operationCount > 0
      && state.componentCount > 0
      && state.resolutionCount === state.componentCount;
  }

  private async insertComponent(
    manager: { query: typeof AppDataSource.query },
    orderId: number,
    parentComponentId: number | null,
    skuId: number,
    componentType: 'fg' | 'wip' | 'rm',
    qtyRequired: string,
    bomLevel: number,
    bomPath: string,
  ): Promise<CreatedComponent> {
    const insert = await manager.query(
      `INSERT INTO production_order_components
         (tenant_id, production_order_id, parent_component_id, sku_id, resolved_sku_id,
          component_type, qty_required, bom_level, bom_path, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.tenantId,
        orderId,
        parentComponentId,
        skuId,
        skuId,
        componentType,
        qtyRequired,
        bomLevel,
        bomPath,
        this.userId,
        this.userId,
      ],
    );

    const componentId = Number(insert.insertId);
    await manager.query(
      `INSERT INTO production_order_sku_resolutions
         (tenant_id, production_order_id, component_id, base_sku_id, resolved_sku_id, rule_id, created_by)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      [this.tenantId, orderId, componentId, skuId, skuId, this.userId],
    );

    return {
      id: componentId,
      skuId,
      path: bomPath,
      level: bomLevel,
    };
  }

  private parseJsonField<T>(value: unknown, invalidMessage: string): T {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as T;
      } catch {
        throw AppError.badRequest(invalidMessage, ResponseCode.INVALID_PARAMS);
      }
    }

    if (value !== null && value !== undefined) {
      return value as T;
    }

    throw AppError.badRequest(invalidMessage, ResponseCode.INVALID_PARAMS);
  }

  private async fetchSnapshotItems(
    manager: { query: typeof AppDataSource.query },
    snapshotId: number | null,
  ): Promise<SnapshotItem[]> {
    if (!snapshotId) return [];
    const rows = await manager.query<Array<{ snapshot_data: unknown }>>(
      `SELECT snapshot_data
       FROM bom_version_snapshots
      WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [snapshotId, this.tenantId],
    );
    if (rows.length === 0) return [];

    const parsed = this.parseJsonField<unknown>(
      rows[0].snapshot_data,
      'BOM 快照数据已损坏，无法释放工单',
    );

    if (!Array.isArray(parsed)) {
      throw AppError.badRequest('BOM 快照格式无效，无法释放工单', ResponseCode.INVALID_PARAMS);
    }

    return parsed
      .map((item) => ({
        skuId: Number((item as { skuId?: unknown }).skuId),
        qty: String((item as { qty?: unknown }).qty ?? '0'),
        level: (item as { level?: unknown }).level == null ? undefined : Number((item as { level?: unknown }).level),
      }))
      .filter((item) => Number.isFinite(item.skuId) && item.skuId > 0);
  }

  private async fetchProcessSteps(
    manager: { query: typeof AppDataSource.query },
    orderId: number,
    processTemplateId: number | null,
    processSnapshot: string | ProcessSnapshotPayload | null,
  ): Promise<ProcessStepRow[]> {
    if (!processTemplateId) return [];

    const liveSteps = await manager.query<ProcessStepRow[]>(
      `SELECT id, step_no, step_name, output_type, output_sku_id, execution_mode
       FROM process_steps
       WHERE template_id = ? AND tenant_id = ?
       ORDER BY step_no ASC, id ASC`,
      [processTemplateId, this.tenantId],
    );

    if (!processSnapshot) {
      await this.persistProcessSnapshot(manager, orderId, processTemplateId, liveSteps);
      return liveSteps;
    }

    const parsed = this.parseJsonField<ProcessSnapshotPayload>(
      processSnapshot,
      '工艺快照数据已损坏，无法释放工单',
    );

    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      await this.persistProcessSnapshot(manager, orderId, processTemplateId, liveSteps);
      return liveSteps;
    }

    const liveByStepNo = new Map(liveSteps.map((step) => [step.step_no, step]));
    const resolvedSteps = parsed.steps.map((step, index) => {
      const stepNo = Number(step.stepNo ?? step.step_no ?? index + 1);
      const snapshotStepId = Number(step.processStepId ?? step.id ?? 0);
      const live = liveByStepNo.get(stepNo);
      if (!live && snapshotStepId <= 0) {
        throw AppError.badRequest('工艺快照与当前模板不一致，无法释放工单', ResponseCode.INVALID_PARAMS);
      }

      const outputType = step.outputType ?? step.output_type ?? live?.output_type ?? null;
      const executionModeRaw = step.executionMode ?? step.execution_mode ?? live?.execution_mode ?? 'internal';
      const executionMode: 'internal' | 'outsource' =
        executionModeRaw === 'outsource' ? 'outsource' : 'internal';
      const outputSkuIdRaw = step.outputSkuId ?? step.output_sku_id;
      const outputSkuId = outputSkuIdRaw == null ? (live?.output_sku_id ?? null) : Number(outputSkuIdRaw);
      const processStepId = snapshotStepId > 0 ? snapshotStepId : Number(live?.id ?? 0);

      return {
        id: processStepId,
        step_no: stepNo,
        step_name: step.stepName ?? step.step_name ?? step.name ?? live?.step_name ?? `STEP#${stepNo}`,
        output_type: outputType,
        output_sku_id: Number.isFinite(outputSkuId) ? outputSkuId : null,
        execution_mode: executionMode,
      };
    });

    const needsUpgrade = parsed.steps.some((step) => !Number(step.processStepId ?? step.id ?? 0));
    if (needsUpgrade) {
      await this.persistProcessSnapshot(manager, orderId, processTemplateId, resolvedSteps);
    }

    return resolvedSteps;
  }

  private async persistProcessSnapshot(
    manager: { query: typeof AppDataSource.query },
    orderId: number,
    processTemplateId: number,
    steps: ProcessStepRow[],
  ): Promise<void> {
    const templateRows = await manager.query<Array<{ id: number; name: string; version: string | null }>>(
      `SELECT id, name, version
       FROM process_templates
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [processTemplateId, this.tenantId],
    );

    const template = templateRows[0];
    const payload: ProcessSnapshotPayload = {
      templateId: template?.id ?? processTemplateId,
      templateName: template?.name,
      version: template?.version ?? '1.0',
      snapshotAt: new Date().toISOString(),
      steps: steps.map((step) => ({
        id: step.id,
        stepNo: step.step_no,
        stepName: step.step_name,
        outputType: step.output_type,
        outputSkuId: step.output_sku_id,
        executionMode: step.execution_mode,
      })),
    };

    await manager.query(
      `UPDATE production_orders
       SET process_snapshot = ?, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [JSON.stringify(payload), this.userId, orderId, this.tenantId],
    );
  }

  private async ensureOutsourcePurchaseSuggestions(
    manager: { query: typeof AppDataSource.query },
    order: Pick<ProductionOrderRow, 'id' | 'work_order_no' | 'qty_planned'>,
  ): Promise<void> {
    const outsourceOps = await manager.query<Array<{
      operationId: number;
      productionOrderId: number;
      outputSkuId: number | null;
      plannedQty: string;
      stepName: string | null;
      skuCode: string | null;
      skuName: string | null;
      purchaseUnit: string | null;
    }>>(
      `SELECT
          op.id AS operationId,
          op.production_order_id AS productionOrderId,
          op.output_sku_id AS outputSkuId,
          op.planned_qty AS plannedQty,
          ps.step_name AS stepName,
          s.sku_code AS skuCode,
          s.name AS skuName,
          s.purchase_unit AS purchaseUnit
       FROM production_operations op
       LEFT JOIN process_steps ps
         ON ps.id = op.process_step_id
        AND ps.tenant_id = op.tenant_id
       LEFT JOIN skus s
         ON s.id = op.output_sku_id
        AND s.tenant_id = op.tenant_id
       WHERE op.tenant_id = ?
         AND op.production_order_id = ?
         AND op.execution_mode = 'outsource'
         AND op.output_sku_id IS NOT NULL`,
      [this.tenantId, order.id],
    );

    for (const op of outsourceOps) {
      const outputSkuId = Number(op.outputSkuId ?? 0);
      if (!Number.isInteger(outputSkuId) || outputSkuId <= 0) continue;

      const [existing] = await manager.query<Array<{ id: number }>>(
        `SELECT id
         FROM purchase_suggestions
         WHERE tenant_id = ?
           AND production_operation_id = ?
           AND status IN ('pending', 'approved', 'executed')
         LIMIT 1`,
        [this.tenantId, op.operationId],
      );
      if (existing) continue;

      const suggestedSupplierId = await this.pickSuggestedSupplierId(manager, outputSkuId);
      const estimatedPrice = await this.pickEstimatedPrice(manager, suggestedSupplierId, outputSkuId);
      const suggestedQty = new Decimal(op.plannedQty ?? order.qty_planned ?? '0').toFixed(4);
      const estimatedAmount = estimatedPrice
        ? new Decimal(suggestedQty).mul(estimatedPrice).toFixed(2)
        : null;
      const suggestionNo = await generateNo('suggestion', this.tenantId);
      const stepLabel = op.stepName?.trim() || `工序#${op.operationId}`;
      const skuLabel = op.skuCode ? `${op.skuCode}/${op.skuName ?? ''}` : (op.skuName || `SKU#${outputSkuId}`);
      const reason = `外协半成品采购：工单 ${order.work_order_no}，${stepLabel}，目标物料 ${skuLabel}`;

      await manager.query(
        `INSERT INTO purchase_suggestions
           (tenant_id, suggestion_no, source, production_order_id, production_operation_id, sku_id,
            suggested_supplier_id, suggested_qty, purchase_unit,
            estimated_price, estimated_amount, shortage_qty, reason,
            confidence, status, created_by, updated_by)
         VALUES (?, ?, 'outsource_operation', ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?,
                 'high', 'pending', ?, ?)`,
        [
          this.tenantId,
          suggestionNo,
          op.productionOrderId,
          op.operationId,
          outputSkuId,
          suggestedSupplierId,
          suggestedQty,
          op.purchaseUnit ?? 'pcs',
          estimatedPrice,
          estimatedAmount,
          suggestedQty,
          reason,
          this.userId,
          this.userId,
        ],
      );
    }
  }

  private async pickSuggestedSupplierId(
    manager: { query: typeof AppDataSource.query },
    skuId: number,
  ): Promise<number | null> {
    const rows = await manager.query<Array<{ supplierId: number }>>(
      `SELECT s.id AS supplierId
       FROM suppliers s
       LEFT JOIN supplier_prices sp
         ON sp.supplier_id = s.id
        AND sp.sku_id = ?
        AND sp.is_current = 1
        AND sp.tenant_id = s.tenant_id
       WHERE s.tenant_id = ?
         AND s.status = 'active'
         AND JSON_CONTAINS(s.main_skus, CAST(? AS JSON))
       ORDER BY FIELD(s.grade, 'A','B','C'), sp.price ASC
       LIMIT 1`,
      [skuId, this.tenantId, skuId],
    );

    return rows[0]?.supplierId ? Number(rows[0].supplierId) : null;
  }

  private async pickEstimatedPrice(
    manager: { query: typeof AppDataSource.query },
    supplierId: number | null,
    skuId: number,
  ): Promise<string | null> {
    if (!supplierId) return null;
    const rows = await manager.query<Array<{ price: string | null }>>(
      `SELECT price
       FROM supplier_prices
       WHERE tenant_id = ?
         AND supplier_id = ?
         AND sku_id = ?
         AND is_current = 1
       ORDER BY id DESC
       LIMIT 1`,
      [this.tenantId, supplierId, skuId],
    );
    return rows[0]?.price ?? null;
  }
}
