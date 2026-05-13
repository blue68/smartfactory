import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import Decimal from 'decimal.js';
import { generateNo } from '../../shared/generateNo';
import { ProcessSnapshotPayload, ProcessTemplateSnapshotBuilder } from './processTemplateSnapshotBuilder';

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
  guide_text?: string | null;
  guide_attachment_url?: string | null;
  guide_attachment_name?: string | null;
  output_type: 'semi_finished' | 'final_product' | 'none' | null;
  output_sku_id: number | null;
  execution_mode: 'internal' | 'outsource';
  predecessor_step_nos_json?: number[] | null;
  route_group_key?: string | null;
  route_level?: number | null;
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
  predecessorStepNos?: Array<number | string>;
  predecessor_step_nos?: Array<number | string>;
  routeGroupKey?: string | null;
  route_group_key?: string | null;
  routeLevel?: number | string | null;
  route_level?: number | string | null;
  executionMode?: 'internal' | 'outsource' | null;
  execution_mode?: 'internal' | 'outsource' | null;
  guideText?: string | null;
  guide_text?: string | null;
  guideAttachmentUrl?: string | null;
  guide_attachment_url?: string | null;
  guideAttachmentName?: string | null;
  guide_attachment_name?: string | null;
  materials?: Array<{
    inputSkuId?: number | string;
    usagePerUnit?: string | number | null;
    lossRate?: string | number | null;
    consumeTiming?: 'start' | 'complete' | null;
    isKeyMaterial?: boolean | number | null;
    specText?: string | null;
    spec_text?: string | null;
    processParams?: Record<string, unknown> | null;
    process_params?: Record<string, unknown> | null;
  }>;
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

interface BomComponentRow {
  id: number;
  parent_item_id: number | null;
  component_sku_id: number;
  category1_code: string | null;
  sort_order: number;
}

interface BomComponentParent {
  parentSkuId: number | null;
  level: number;
  path: string;
}

interface BomDependencyItemRow {
  id: number;
  component_sku_id: number;
  quantity: string;
  scrap_rate: string | null;
  sort_order: number;
  child_bom_id: number | null;
}

interface BomDependencyNode {
  key: string;
  skuId: number;
  bomId: number;
  parentKey: string | null;
  level: number;
  path: string;
  qtyRequired: string;
  sortOrder: number;
  children: BomDependencyNode[];
}

interface OperationListRow {
  id: number | string;
  componentId: number | string | null;
  componentType: 'fg' | 'wip' | 'rm' | null;
  bomLevel: number | string | null;
  bomPath: string | null;
  processStepId: number | string | null;
  stepNo: number | string | null;
  stepName: string | null;
  outputSkuId: number | string | null;
  outputSkuCode: string | null;
  outputSkuName: string | null;
  outputUnit: string | null;
  executionMode: 'internal' | 'outsource' | null;
  plannedQty: string | number | null;
  completedQty: string | number | null;
  status: string;
}

interface OperationInputRow {
  operationId: number | string;
  skuId: number | string;
  skuCode: string | null;
  skuName: string | null;
  unit: string | null;
  itemType: 'semi_finished' | 'material';
  requiredQty: string | number | null;
  sourceOperationId?: number | string | null;
  sourceStatus?: string | null;
  sourceCompletedQty?: string | number | null;
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
        order.sku_id,
        order.process_template_id,
        order.process_snapshot,
      );
      if (processSteps.length === 0) {
        throw AppError.badRequest('工单缺少工序定义，无法 release', ResponseCode.INVALID_PARAMS);
      }

      const bomDependencyRoot = await this.buildBomDependencyRootIfNeeded(
        manager,
        order,
        processSteps,
      );
      if (bomDependencyRoot) {
        return this.releaseOrderByBomDependency(manager, order, processSteps, bomDependencyRoot);
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
      const bomSemiFinishedParents = await this.resolveBomSemiFinishedParents(manager, order.sku_id);

      for (const step of processSteps) {
        if (step.output_type !== 'semi_finished' || !step.output_sku_id) continue;
        if (wipComponentMap.has(step.output_sku_id)) continue;

        const bomParent = bomSemiFinishedParents.get(step.output_sku_id) ?? null;
        const previousWipStep = processSteps
          .filter((candidate) =>
            candidate.step_no < step.step_no
            && candidate.output_type === 'semi_finished'
            && Number(candidate.output_sku_id ?? 0) > 0
            && wipComponentMap.has(Number(candidate.output_sku_id)),
          )
          .sort((a, b) => b.step_no - a.step_no)[0];
        const fallbackParentComponent = previousWipStep?.output_sku_id
          ? (wipComponentMap.get(previousWipStep.output_sku_id) ?? rootComponent)
          : rootComponent;
        const parentComponent = bomParent
          ? (
              bomParent.parentSkuId
                ? (wipComponentMap.get(bomParent.parentSkuId) ?? rootComponent)
                : rootComponent
            )
          : fallbackParentComponent;
        const wipComponent = await this.insertComponent(
          manager,
          orderId,
          parentComponent.id,
          step.output_sku_id,
          'wip',
          order.qty_planned,
          bomParent?.level ?? (parentComponent.level + 1),
          bomParent?.path ?? `${parentComponent.path}/wip:${step.output_sku_id}`,
        );
        wipComponentMap.set(step.output_sku_id, wipComponent);
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

      const operationIdByStepNo = new Map<number, number>();
      const operations: Array<{ id: number; stepNo: number; predecessorStepNos: number[] }> = [];
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
        const predecessorStepNos = this.resolveStepPredecessorStepNos(processSteps, step.step_no);
        operationIdByStepNo.set(step.step_no, operationId);
        operations.push({
          id: operationId,
          stepNo: step.step_no,
          predecessorStepNos,
        });
      }

      for (const operation of operations) {
        for (const predecessorStepNo of operation.predecessorStepNos) {
          const predecessorOperationId = operationIdByStepNo.get(predecessorStepNo);
          if (!predecessorOperationId) continue;
          await manager.query(
            `INSERT INTO production_operation_dependencies
               (tenant_id, operation_id, predecessor_operation_id, required_qty)
             VALUES (?, ?, ?, ?)`,
            [this.tenantId, operation.id, predecessorOperationId, order.qty_planned],
          );
        }
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
    const operations = await AppDataSource.query<OperationListRow[]>(
      `SELECT po.id, po.component_id AS componentId,
              poc.component_type AS componentType,
              poc.bom_level AS bomLevel,
              poc.bom_path AS bomPath,
              po.process_step_id AS processStepId,
              ps.step_no AS stepNo,
              COALESCE(ps.step_name, CONCAT('STEP#', po.process_step_id)) AS stepName,
              po.output_sku_id AS outputSkuId,
              s.sku_code AS outputSkuCode,
              po.execution_mode AS executionMode,
              COALESCE(s.name, CONCAT('SKU#', po.output_sku_id)) AS outputSkuName,
              s.stock_unit AS outputUnit,
              po.planned_qty AS plannedQty,
              po.completed_qty AS completedQty,
              po.status
       FROM production_operations po
       LEFT JOIN production_order_components poc ON poc.id = po.component_id
       LEFT JOIN process_steps ps ON ps.id = po.process_step_id
       LEFT JOIN skus s ON s.id = po.output_sku_id AND s.tenant_id = po.tenant_id
       WHERE po.production_order_id = ? AND po.tenant_id = ?
       ORDER BY COALESCE(poc.bom_level, 0) DESC, ps.step_no ASC, po.id ASC`,
      [orderId, this.tenantId],
    );

    if (operations.length === 0) {
      return [];
    }

    const bomInputs = await AppDataSource.query<OperationInputRow[]>(
      `SELECT op.id AS operationId,
              bi.component_sku_id AS skuId,
              sku.sku_code AS skuCode,
              COALESCE(sku.name, CONCAT('SKU#', bi.component_sku_id)) AS skuName,
              COALESCE(NULLIF(bi.unit, ''), sku.stock_unit, sku.purchase_unit) AS unit,
              CASE
                WHEN EXISTS (
                  SELECT 1
                  FROM bom_headers child_bh
                  WHERE child_bh.tenant_id = bi.tenant_id
                    AND child_bh.sku_id = bi.component_sku_id
                    AND child_bh.status = 'active'
                  LIMIT 1
                ) THEN 'semi_finished'
                ELSE 'material'
              END AS itemType,
              (op.planned_qty * bi.quantity * (1 + COALESCE(bi.scrap_rate, 0))) AS requiredQty
       FROM production_operations op
       JOIN bom_headers bh
         ON bh.tenant_id = op.tenant_id
        AND bh.sku_id = op.output_sku_id
        AND bh.status = 'active'
       JOIN bom_items bi
         ON bi.tenant_id = bh.tenant_id
        AND bi.bom_header_id = bh.id
        AND bi.parent_item_id IS NULL
       LEFT JOIN skus sku
         ON sku.tenant_id = bi.tenant_id
        AND sku.id = bi.component_sku_id
       WHERE op.tenant_id = ?
         AND op.production_order_id = ?
         AND op.output_sku_id IS NOT NULL
       ORDER BY op.id ASC, bi.sort_order ASC, bi.id ASC`,
      [this.tenantId, orderId],
    );

    const dependencyInputs = await AppDataSource.query<OperationInputRow[]>(
      `SELECT dep.operation_id AS operationId,
              pred.id AS sourceOperationId,
              pred.output_sku_id AS skuId,
              sku.sku_code AS skuCode,
              COALESCE(sku.name, CONCAT('SKU#', pred.output_sku_id)) AS skuName,
              sku.stock_unit AS unit,
              'semi_finished' AS itemType,
              dep.required_qty AS requiredQty,
              pred.status AS sourceStatus,
              pred.completed_qty AS sourceCompletedQty
       FROM production_operation_dependencies dep
       JOIN production_operations current_op
         ON current_op.id = dep.operation_id
        AND current_op.tenant_id = dep.tenant_id
       JOIN production_operations pred
         ON pred.id = dep.predecessor_operation_id
        AND pred.tenant_id = dep.tenant_id
       LEFT JOIN skus sku
         ON sku.tenant_id = pred.tenant_id
        AND sku.id = pred.output_sku_id
       WHERE dep.tenant_id = ?
         AND current_op.production_order_id = ?`,
      [this.tenantId, orderId],
    );

    const dependenciesByOperationAndSku = new Map<string, OperationInputRow>();
    for (const item of dependencyInputs) {
      dependenciesByOperationAndSku.set(`${Number(item.operationId)}:${Number(item.skuId)}`, item);
    }

    const inputsByOperation = new Map<number, OperationInputRow[]>();
    for (const item of bomInputs) {
      const operationId = Number(item.operationId);
      const dependency = dependenciesByOperationAndSku.get(`${operationId}:${Number(item.skuId)}`);
      const merged: OperationInputRow = dependency && item.itemType === 'semi_finished'
        ? { ...item, sourceOperationId: dependency.sourceOperationId, sourceStatus: dependency.sourceStatus, sourceCompletedQty: dependency.sourceCompletedQty }
        : item;
      const existing = inputsByOperation.get(operationId) ?? [];
      existing.push(merged);
      inputsByOperation.set(operationId, existing);
    }

    for (const item of dependencyInputs) {
      const operationId = Number(item.operationId);
      const existing = inputsByOperation.get(operationId) ?? [];
      const alreadyExists = existing.some((input) => Number(input.skuId) === Number(item.skuId));
      if (!alreadyExists) {
        existing.push(item);
        inputsByOperation.set(operationId, existing);
      }
    }

    return operations.map((operation) => {
      const operationId = Number(operation.id);
      const componentType = operation.componentType ?? 'fg';
      const plannedQty = new Decimal(operation.plannedQty ?? 0).toFixed(4);
      const completedQty = new Decimal(operation.completedQty ?? 0).toFixed(4);
      const inputItems = (inputsByOperation.get(operationId) ?? []).map((item) => ({
        skuId: Number(item.skuId),
        skuCode: item.skuCode,
        skuName: item.skuName,
        itemType: item.itemType,
        unit: item.unit,
        requiredQty: new Decimal(item.requiredQty ?? 0).toFixed(4),
        sourceOperationId: item.sourceOperationId == null ? null : Number(item.sourceOperationId),
        sourceStatus: item.sourceStatus ?? null,
        sourceCompletedQty: item.sourceCompletedQty == null ? null : new Decimal(item.sourceCompletedQty).toFixed(4),
      }));

      return {
        id: operationId,
        componentId: operation.componentId == null ? null : Number(operation.componentId),
        componentType,
        bomLevel: operation.bomLevel == null ? null : Number(operation.bomLevel),
        bomPath: operation.bomPath,
        processStepId: operation.processStepId == null ? null : Number(operation.processStepId),
        stepNo: operation.stepNo == null ? null : Number(operation.stepNo),
        stepName: operation.stepName,
        outputSkuId: operation.outputSkuId == null ? null : Number(operation.outputSkuId),
        outputSkuCode: operation.outputSkuCode,
        outputSkuName: operation.outputSkuName,
        outputUnit: operation.outputUnit,
        executionMode: operation.executionMode,
        plannedQty,
        completedQty,
        status: operation.status,
        inputItems,
        outputItem: {
          skuId: operation.outputSkuId == null ? null : Number(operation.outputSkuId),
          skuCode: operation.outputSkuCode,
          skuName: operation.outputSkuName,
          itemType: componentType === 'fg' ? 'finished' : 'semi_finished',
          unit: operation.outputUnit,
          plannedQty,
          completedQty,
        },
      };
    });
  }

  private async buildBomDependencyRootIfNeeded(
    manager: { query: typeof AppDataSource.query },
    order: ProductionOrderRow,
    processSteps: ProcessStepRow[],
  ): Promise<BomDependencyNode | null> {
    const hasExplicitSemiFinishedSteps = processSteps.some(
      (step) => step.output_type === 'semi_finished' && Number(step.output_sku_id ?? 0) > 0,
    );
    if (hasExplicitSemiFinishedSteps) {
      return null;
    }

    const rootBomId = await this.findActiveBomIdBySku(manager, order.sku_id);
    if (!rootBomId) {
      return null;
    }

    const root = await this.buildBomDependencyNode(
      manager,
      {
        skuId: order.sku_id,
        bomId: rootBomId,
        qtyRequired: new Decimal(order.qty_planned ?? 0),
        level: 0,
        path: `fg:${order.sku_id}`,
        parentKey: null,
        sortOrder: 0,
      },
      new Set([rootBomId]),
    );

    return root.children.length > 0 ? root : null;
  }

  private async buildBomDependencyNode(
    manager: { query: typeof AppDataSource.query },
    current: {
      skuId: number;
      bomId: number;
      qtyRequired: Decimal;
      level: number;
      path: string;
      parentKey: string | null;
      sortOrder: number;
    },
    visitedBomIds: Set<number>,
  ): Promise<BomDependencyNode> {
    const node: BomDependencyNode = {
      key: current.path,
      skuId: current.skuId,
      bomId: current.bomId,
      parentKey: current.parentKey,
      level: current.level,
      path: current.path,
      qtyRequired: current.qtyRequired.toFixed(4),
      sortOrder: current.sortOrder,
      children: [],
    };

    const rows = await manager.query<BomDependencyItemRow[]>(
      `SELECT
          bi.id,
          bi.component_sku_id,
          CAST(bi.quantity AS CHAR) AS quantity,
          CAST(COALESCE(bi.scrap_rate, 0) AS CHAR) AS scrap_rate,
          bi.sort_order,
          child_bh.id AS child_bom_id
       FROM bom_items bi
       LEFT JOIN bom_headers child_bh
         ON child_bh.tenant_id = bi.tenant_id
        AND child_bh.sku_id = bi.component_sku_id
        AND child_bh.status = 'active'
       WHERE bi.bom_header_id = ?
         AND bi.tenant_id = ?
         AND bi.parent_item_id IS NULL
       ORDER BY bi.sort_order ASC, bi.id ASC`,
      [current.bomId, this.tenantId],
    );

    for (const row of rows) {
      const childBomId = Number(row.child_bom_id ?? 0);
      if (!Number.isInteger(childBomId) || childBomId <= 0 || visitedBomIds.has(childBomId)) {
        continue;
      }

      const childQty = current.qtyRequired
        .mul(new Decimal(row.quantity ?? 0))
        .mul(new Decimal(1).plus(new Decimal(row.scrap_rate ?? 0)));
      const childSkuId = Number(row.component_sku_id);
      const childPath = `${current.path}/wip:${childSkuId}:${row.id}`;
      const nextVisited = new Set(visitedBomIds);
      nextVisited.add(childBomId);

      node.children.push(await this.buildBomDependencyNode(
        manager,
        {
          skuId: childSkuId,
          bomId: childBomId,
          qtyRequired: childQty,
          level: current.level + 1,
          path: childPath,
          parentKey: node.key,
          sortOrder: Number(row.sort_order ?? 0),
        },
        nextVisited,
      ));
    }

    return node;
  }

  private async releaseOrderByBomDependency(
    manager: { query: typeof AppDataSource.query },
    order: ProductionOrderRow,
    processSteps: ProcessStepRow[],
    root: BomDependencyNode,
  ): Promise<{
    productionOrderId: number;
    reused: boolean;
    componentCount: number;
    operationCount: number;
  }> {
    const orderId = Number(order.id);
    const nodes = this.flattenBomDependencyNodes(root);
    const componentByNodeKey = new Map<string, CreatedComponent>();

    for (const node of [...nodes].sort((a, b) => a.level - b.level || a.path.localeCompare(b.path, 'zh-CN'))) {
      const parentComponent = node.parentKey ? componentByNodeKey.get(node.parentKey) ?? null : null;
      const component = await this.insertComponent(
        manager,
        orderId,
        parentComponent?.id ?? null,
        node.skuId,
        node.level === 0 ? 'fg' : 'wip',
        node.qtyRequired,
        node.level,
        node.path,
      );
      componentByNodeKey.set(node.key, component);
    }

    const operationIdByNodeKey = new Map<string, number>();
    for (const node of [...nodes].sort((a, b) => b.level - a.level || a.path.localeCompare(b.path, 'zh-CN'))) {
      const component = componentByNodeKey.get(node.key);
      if (!component) continue;
      const processStepId = this.pickBomDependencyProcessStepId(processSteps, node, order.sku_id);
      const opInsert = await manager.query(
        `INSERT INTO production_operations
           (tenant_id, production_order_id, component_id, process_step_id, output_sku_id,
            planned_qty, completed_qty, status, execution_mode, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', 'internal', ?, ?)`,
        [
          this.tenantId,
          orderId,
          component.id,
          processStepId,
          node.skuId,
          node.qtyRequired,
          this.userId,
          this.userId,
        ],
      );
      operationIdByNodeKey.set(node.key, Number(opInsert.insertId));
    }

    for (const node of nodes) {
      const operationId = operationIdByNodeKey.get(node.key);
      if (!operationId) continue;
      for (const child of node.children) {
        const predecessorOperationId = operationIdByNodeKey.get(child.key);
        if (!predecessorOperationId) continue;
        await manager.query(
          `INSERT INTO production_operation_dependencies
             (tenant_id, operation_id, predecessor_operation_id, required_qty)
           VALUES (?, ?, ?, ?)`,
          [this.tenantId, operationId, predecessorOperationId, child.qtyRequired],
        );
      }
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

    return {
      productionOrderId: orderId,
      reused: false,
      componentCount: Number(componentCountRow?.cnt ?? 0),
      operationCount: Number(operationCountRow?.cnt ?? 0),
    };
  }

  private flattenBomDependencyNodes(root: BomDependencyNode): BomDependencyNode[] {
    return [root, ...root.children.flatMap((child) => this.flattenBomDependencyNodes(child))];
  }

  private pickBomDependencyProcessStepId(
    processSteps: ProcessStepRow[],
    node: BomDependencyNode,
    rootSkuId: number,
  ): number {
    const exactOutputStep = processSteps.find(
      (step) => Number(step.output_sku_id ?? 0) === node.skuId,
    );
    if (exactOutputStep) {
      return exactOutputStep.id;
    }

    if (node.skuId === rootSkuId) {
      const finalStep = processSteps.find((step) => step.output_type === 'final_product')
        ?? [...processSteps].sort((a, b) => b.step_no - a.step_no)[0];
      return finalStep.id;
    }

    const semiStep = processSteps.find((step) => step.output_type === 'semi_finished')
      ?? processSteps.find((step) => step.output_type !== 'final_product')
      ?? processSteps[0];
    return semiStep.id;
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
    orderSkuId: number,
    processTemplateId: number | null,
    processSnapshot: string | ProcessSnapshotPayload | null,
  ): Promise<ProcessStepRow[]> {
    if (!processTemplateId) return [];

    const liveSteps = await manager.query<ProcessStepRow[]>(
      `SELECT id, step_no, step_name, output_type, output_sku_id, execution_mode,
              predecessor_step_nos_json, route_group_key, route_level
       FROM process_steps
       WHERE template_id = ? AND tenant_id = ?
       ORDER BY step_no ASC, id ASC`,
      [processTemplateId, this.tenantId],
    );

    if (!processSnapshot) {
      const payload = await this.persistProcessSnapshot(manager, orderId, orderSkuId, processTemplateId);
      return this.resolveSnapshotSteps(payload, liveSteps);
    }

    const parsed = this.parseJsonField<ProcessSnapshotPayload>(
      processSnapshot,
      '工艺快照数据已损坏，无法释放工单',
    );

    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      const payload = await this.persistProcessSnapshot(manager, orderId, orderSkuId, processTemplateId);
      return this.resolveSnapshotSteps(payload, liveSteps);
    }

    const resolvedSteps = this.resolveSnapshotSteps(parsed, liveSteps);

    const needsUpgrade = parsed.steps.some((step) => !Number(step.processStepId ?? step.id ?? 0));
    if (needsUpgrade) {
      await this.persistProcessSnapshot(manager, orderId, orderSkuId, processTemplateId);
    }

    return resolvedSteps;
  }

  private async persistProcessSnapshot(
    manager: { query: typeof AppDataSource.query },
    orderId: number,
    orderSkuId: number,
    processTemplateId: number,
  ): Promise<ProcessSnapshotPayload> {
    const payload = await new ProcessTemplateSnapshotBuilder(this.tenantId).build(
      manager,
      processTemplateId,
      orderSkuId,
    );

    await manager.query(
      `UPDATE production_orders
       SET process_snapshot = ?, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [JSON.stringify(payload), this.userId, orderId, this.tenantId],
    );

    return payload;
  }

  private resolveSnapshotSteps(
    snapshot: ProcessSnapshotPayload,
    liveSteps: ProcessStepRow[],
  ): ProcessStepRow[] {
    const liveByStepNo = new Map(liveSteps.map((step) => [Number(step.step_no), step]));

    return (snapshot.steps ?? []).map((step, index) => {
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
      const predecessorStepNos = this.normalizeStepNoList(
        step.predecessorStepNos ?? step.predecessor_step_nos ?? live?.predecessor_step_nos_json ?? null,
      );
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
        predecessor_step_nos_json: predecessorStepNos,
        route_group_key: (step.routeGroupKey ?? step.route_group_key ?? live?.route_group_key ?? '').trim() || null,
        route_level: (() => {
          const raw = step.routeLevel ?? step.route_level ?? live?.route_level ?? null;
          const value = raw == null ? null : Number(raw);
          return value !== null && Number.isInteger(value) && value > 0 ? value : null;
        })(),
      };
    });
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

  private normalizeStepNoList(raw: unknown): number[] {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
  }

  private resolveStepPredecessorStepNos(steps: ProcessStepRow[], currentStepNo: number): number[] {
    const current = steps.find((item) => item.step_no === currentStepNo);
    const explicit = this.normalizeStepNoList(current?.predecessor_step_nos_json ?? null).filter((stepNo) => stepNo < currentStepNo);
    if (explicit.length > 0) {
      return explicit;
    }

    if (!current) return [];

    if (current.output_type === 'semi_finished' && current.output_sku_id) {
      const previousSameOutput = steps
        .filter((item) => item.step_no < currentStepNo && item.output_sku_id === current.output_sku_id)
        .map((item) => item.step_no)
        .sort((a, b) => b - a)[0];
      if (previousSameOutput) {
        return [previousSameOutput];
      }
      return [];
    }

    if (current.output_type === 'final_product') {
      const latestSemiFinishedStepBySku = new Map<number, number>();
      for (const step of steps) {
        if (step.step_no >= currentStepNo) continue;
        if (step.output_type !== 'semi_finished' || !step.output_sku_id) continue;
        latestSemiFinishedStepBySku.set(step.output_sku_id, step.step_no);
      }
      const inferred = [...latestSemiFinishedStepBySku.values()].sort((a, b) => a - b);
      if (inferred.length > 0) {
        return inferred;
      }
    }

    const previous = steps
      .filter((item) => item.step_no < currentStepNo)
      .map((item) => item.step_no)
      .sort((a, b) => b - a)[0];
    return previous ? [previous] : [];
  }

  private async resolveBomSemiFinishedParents(
    manager: { query: typeof AppDataSource.query },
    rootSkuId: number,
  ): Promise<Map<number, BomComponentParent>> {
    const rootBomId = await this.findActiveBomIdBySku(manager, rootSkuId);
    if (!rootBomId) {
      return new Map();
    }
    const result = new Map<number, BomComponentParent>();
    await this.walkBomSemiFinishedParents(manager, rootBomId, null, 1, `fg:${rootSkuId}`, new Set([rootBomId]), result);
    return result;
  }

  private async walkBomSemiFinishedParents(
    manager: { query: typeof AppDataSource.query },
    bomId: number,
    currentSemiParentSkuId: number | null,
    currentLevel: number,
    currentPath: string,
    visitedBomIds: Set<number>,
    result: Map<number, BomComponentParent>,
  ): Promise<void> {
    const rows = await manager.query<BomComponentRow[]>(
      `SELECT
         bi.id,
         bi.parent_item_id,
         bi.component_sku_id,
         sc1.code AS category1_code,
         bi.sort_order
       FROM bom_items bi
       INNER JOIN skus s ON s.id = bi.component_sku_id AND s.tenant_id = bi.tenant_id
       LEFT JOIN sku_categories sc1 ON sc1.id = s.category1_id
       WHERE bi.bom_header_id = ? AND bi.tenant_id = ?
       ORDER BY bi.level ASC, bi.sort_order ASC, bi.id ASC`,
      [bomId, this.tenantId],
    );

    await this.walkBomRowsForParents(manager, rows, null, currentSemiParentSkuId, currentLevel, currentPath, visitedBomIds, result);
  }

  private async walkBomRowsForParents(
    manager: { query: typeof AppDataSource.query },
    rows: BomComponentRow[],
    parentItemId: number | null,
    currentSemiParentSkuId: number | null,
    currentLevel: number,
    currentPath: string,
    visitedBomIds: Set<number>,
    result: Map<number, BomComponentParent>,
  ): Promise<void> {
    const siblings = rows
      .filter((row) => (row.parent_item_id === null ? null : Number(row.parent_item_id)) === parentItemId)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);

    for (const row of siblings) {
      const skuId = Number(row.component_sku_id);
      const isSemiFinished = row.category1_code === 'SEMIFIN';
      const nextSemiParentSkuId = isSemiFinished ? skuId : currentSemiParentSkuId;
      const nodeLevel = currentLevel + 1;
      const nodePath = `${currentPath}/${isSemiFinished ? 'wip' : 'node'}:${skuId}`;

      if (isSemiFinished && !result.has(skuId)) {
        result.set(skuId, {
          parentSkuId: currentSemiParentSkuId,
          level: nodeLevel,
          path: nodePath,
        });
      }

      const childBomId = await this.findActiveBomIdBySku(manager, skuId);
      if (childBomId && !visitedBomIds.has(childBomId)) {
        const nextVisited = new Set(visitedBomIds);
        nextVisited.add(childBomId);
        await this.walkBomSemiFinishedParents(
          manager,
          childBomId,
          nextSemiParentSkuId,
          nodeLevel,
          nodePath,
          nextVisited,
          result,
        );
      } else {
        await this.walkBomRowsForParents(
          manager,
          rows,
          Number(row.id),
          nextSemiParentSkuId,
          nodeLevel,
          nodePath,
          visitedBomIds,
          result,
        );
      }
    }
  }

  private async findActiveBomIdBySku(
    manager: { query: typeof AppDataSource.query },
    skuId: number,
  ): Promise<number | null> {
    const [row] = await manager.query<Array<{ id: number }>>(
      `SELECT id
       FROM bom_headers
       WHERE tenant_id = ? AND sku_id = ? AND status = 'active'
       ORDER BY id DESC
       LIMIT 1`,
      [this.tenantId, skuId],
    );
    return row ? Number(row.id) : null;
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
