import { AppDataSource } from '../../config/database';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';

type QueryRunnerLike = { query: typeof AppDataSource.query };

interface TemplateMetaRow {
  id: number;
  sku_id: number;
  name: string;
  version: string | null;
}

interface StepRow {
  id: number;
  step_no: number;
  step_name: string;
  workstation_type: string | null;
  workstation_id: number | null;
  standard_hours: string | null;
  max_hours: string | null;
  guide_text: string | null;
  guide_attachment_url: string | null;
  guide_attachment_name: string | null;
  execution_mode: 'internal' | 'outsource' | null;
  output_type: 'semi_finished' | 'final_product' | 'none' | null;
  output_sku_id: number | null;
  predecessor_step_nos_json: number[] | null;
  route_group_key: string | null;
  route_level: number | null;
}

interface StepMaterialRow {
  step_no: number;
  input_sku_id: number;
  usage_per_unit: string;
  loss_rate: string;
  consume_timing: 'start' | 'complete';
  is_key_material: number;
  spec_text: string | null;
  process_params_json: string | Record<string, unknown> | null;
}

interface BomComponentRow {
  id: number;
  parent_item_id: number | null;
  component_sku_id: number;
  category1_code: string | null;
  sort_order: number;
}

interface BomSemiParent {
  parentSkuId: number | null;
  level: number;
  path: string;
}

export interface ProcessSnapshotStepPayload {
  id?: number | string;
  processStepId?: number | string;
  process_step_id?: number | string;
  stepNo?: number | string;
  step_no?: number | string;
  stepName?: string;
  step_name?: string;
  name?: string;
  workstationType?: string | null;
  workstation_type?: string | null;
  workstationId?: number | null;
  workstation_id?: number | null;
  standardHours?: string | null;
  standard_hours?: string | null;
  maxHours?: string | null;
  max_hours?: string | null;
  guideText?: string | null;
  guide_text?: string | null;
  guideAttachmentUrl?: string | null;
  guide_attachment_url?: string | null;
  guideAttachmentName?: string | null;
  guide_attachment_name?: string | null;
  executionMode?: 'internal' | 'outsource' | null;
  execution_mode?: 'internal' | 'outsource' | null;
  outputType?: 'semi_finished' | 'final_product' | 'none' | null;
  output_type?: 'semi_finished' | 'final_product' | 'none' | null;
  outputSkuId?: number | string | null;
  output_sku_id?: number | string | null;
  predecessorStepNos?: number[];
  predecessor_step_nos?: Array<number | string>;
  routeGroupKey?: string | null;
  route_group_key?: string | null;
  routeLevel?: number | null;
  route_level?: number | string | null;
  inheritedFromTemplateId?: number | null;
  inheritedFromTemplateName?: string | null;
  inheritedFromSkuId?: number | null;
  materials?: Array<{
    inputSkuId: number;
    usagePerUnit: string;
    lossRate: string;
    consumeTiming: 'start' | 'complete';
    isKeyMaterial: boolean;
    specText: string | null;
    processParams: Record<string, unknown> | null;
  }>;
}

export interface ProcessSnapshotPayload {
  templateId?: number | null;
  templateName?: string;
  version?: string;
  snapshotAt?: string;
  inheritedTemplates?: Array<{
    skuId: number;
    templateId: number;
    templateName: string;
    parentSkuId: number;
  }>;
  steps?: ProcessSnapshotStepPayload[];
}

interface ComposeResult {
  steps: ProcessSnapshotStepPayload[];
  terminalStepNos: number[];
  inheritedTemplates: Array<{
    skuId: number;
    templateId: number;
    templateName: string;
    parentSkuId: number;
  }>;
}

export class ProcessTemplateSnapshotBuilder {
  constructor(private readonly tenantId: number) {}

  async build(
    manager: QueryRunnerLike,
    rootTemplateId: number,
    rootSkuId: number,
  ): Promise<ProcessSnapshotPayload> {
    const rootTemplate = await this.findTemplateById(manager, rootTemplateId);
    if (!rootTemplate) {
      throw AppError.badRequest('工艺模板不存在，无法生成工艺快照', ResponseCode.INVALID_PARAMS);
    }

    const counter = { nextStepNo: 1 };
    const composed = await this.composeTemplate(
      manager,
      rootTemplate,
      Number(rootSkuId),
      counter,
      new Set<number>(),
      null,
    );

    return {
      templateId: rootTemplate.id,
      templateName: rootTemplate.name,
      version: rootTemplate.version ?? '1.0',
      snapshotAt: new Date().toISOString(),
      inheritedTemplates: composed.inheritedTemplates,
      steps: composed.steps,
    };
  }

  private async composeTemplate(
    manager: QueryRunnerLike,
    template: TemplateMetaRow,
    skuId: number,
    counter: { nextStepNo: number },
    visitedSkuIds: Set<number>,
    inheritedFrom: { templateId: number; templateName: string; skuId: number } | null,
  ): Promise<ComposeResult> {
    if (visitedSkuIds.has(skuId)) {
      throw AppError.badRequest(
        `检测到工艺模板循环引用，SKU#${skuId} 无法继续展开`,
        ResponseCode.INVALID_PARAMS,
      );
    }

    const nextVisited = new Set(visitedSkuIds);
    nextVisited.add(skuId);

    const { steps, stepMaterialsByNo } = await this.fetchTemplateContent(manager, template.id);
    const explicitSemiOutputs = new Set(
      steps
        .filter((step) => step.output_type === 'semi_finished' && Number(step.output_sku_id) > 0)
        .map((step) => Number(step.output_sku_id)),
    );

    const directSemiChildren = await this.findDirectSemiFinishedChildren(manager, skuId);
    const autoChildren = directSemiChildren.filter((child) => !explicitSemiOutputs.has(child.skuId));

    const childResults: ComposeResult[] = [];
    for (const child of autoChildren) {
      const childTemplate = await this.findDefaultTemplateBySku(manager, child.skuId);
      if (!childTemplate) continue;
      const childResult = await this.composeTemplate(
        manager,
        childTemplate,
        child.skuId,
        counter,
        nextVisited,
        { templateId: template.id, templateName: template.name, skuId },
      );
      childResults.push({
        ...childResult,
        inheritedTemplates: [
          {
            skuId: child.skuId,
            templateId: childTemplate.id,
            templateName: childTemplate.name,
            parentSkuId: skuId,
          },
          ...childResult.inheritedTemplates,
        ],
      });
    }

    const childTerminalStepNos = [...new Set(childResults.flatMap((result) => result.terminalStepNos))].sort((a, b) => a - b);
    const remap = new Map<number, number>();
    steps.forEach((step) => {
      remap.set(Number(step.step_no), counter.nextStepNo++);
    });

    const currentSteps = steps.map((step) => {
      const originalStepNo = Number(step.step_no);
      const internalPredecessors = this.inferInternalPredecessors(steps, originalStepNo);
      const remappedInternalPredecessors = internalPredecessors
        .map((stepNo) => remap.get(stepNo) ?? null)
        .filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0);

      const predecessorStepNos = remappedInternalPredecessors.length > 0
        ? remappedInternalPredecessors
        : childTerminalStepNos;

      return {
        id: step.id,
        processStepId: step.id,
        stepNo: remap.get(originalStepNo) ?? originalStepNo,
        stepName: step.step_name,
        workstationType: step.workstation_type ?? null,
        workstationId: step.workstation_id ?? null,
        standardHours: step.standard_hours ?? null,
        maxHours: step.max_hours ?? null,
        guideText: step.guide_text ?? null,
        guideAttachmentUrl: step.guide_attachment_url ?? null,
        guideAttachmentName: step.guide_attachment_name ?? null,
        executionMode: step.execution_mode ?? 'internal',
        outputType: step.output_type ?? 'none',
        outputSkuId: step.output_sku_id ?? null,
        predecessorStepNos,
        routeGroupKey: step.route_group_key?.trim() || null,
        routeLevel: step.route_level ?? null,
        process_step_id: step.id,
        step_no: remap.get(originalStepNo) ?? originalStepNo,
        step_name: step.step_name,
        workstation_type: step.workstation_type ?? null,
        workstation_id: step.workstation_id ?? null,
        standard_hours: step.standard_hours ?? null,
        max_hours: step.max_hours ?? null,
        guide_text: step.guide_text ?? null,
        guide_attachment_url: step.guide_attachment_url ?? null,
        guide_attachment_name: step.guide_attachment_name ?? null,
        execution_mode: step.execution_mode ?? 'internal',
        output_type: step.output_type ?? 'none',
        output_sku_id: step.output_sku_id ?? null,
        predecessor_step_nos: predecessorStepNos,
        route_group_key: step.route_group_key?.trim() || null,
        route_level: step.route_level ?? null,
        inheritedFromTemplateId: inheritedFrom?.templateId ?? null,
        inheritedFromTemplateName: inheritedFrom?.templateName ?? null,
        inheritedFromSkuId: inheritedFrom?.skuId ?? null,
        materials: (stepMaterialsByNo.get(originalStepNo) ?? []).map((item) => ({
          inputSkuId: Number(item.input_sku_id),
          usagePerUnit: item.usage_per_unit,
          lossRate: item.loss_rate,
          consumeTiming: item.consume_timing,
          isKeyMaterial: Boolean(item.is_key_material),
          specText: item.spec_text ?? null,
          processParams: this.parseProcessParams(item.process_params_json),
        })),
      } satisfies ProcessSnapshotStepPayload;
    });

    const combinedSteps = [...childResults.flatMap((result) => result.steps), ...currentSteps];
    return {
      steps: combinedSteps,
      terminalStepNos: this.findTerminalStepNos(combinedSteps),
      inheritedTemplates: childResults.flatMap((result) => result.inheritedTemplates),
    };
  }

  private inferInternalPredecessors(steps: StepRow[], currentStepNo: number): number[] {
    const current = steps.find((item) => Number(item.step_no) === Number(currentStepNo));
    const explicit = this.normalizeStepNoList(current?.predecessor_step_nos_json ?? null)
      .filter((stepNo) => stepNo < currentStepNo);
    if (explicit.length > 0) return explicit;
    if (!current) return [];

    if (current.output_type === 'semi_finished' && current.output_sku_id) {
      const previousSameOutput = steps
        .filter((item) => Number(item.step_no) < currentStepNo && Number(item.output_sku_id) === Number(current.output_sku_id))
        .map((item) => Number(item.step_no))
        .sort((a, b) => b - a)[0];
      return previousSameOutput ? [previousSameOutput] : [];
    }

    if (current.output_type === 'final_product') {
      const latestSemiFinishedStepBySku = new Map<number, number>();
      for (const step of steps) {
        const stepNo = Number(step.step_no);
        if (stepNo >= currentStepNo) continue;
        if (step.output_type !== 'semi_finished' || !step.output_sku_id) continue;
        latestSemiFinishedStepBySku.set(Number(step.output_sku_id), stepNo);
      }
      const inferred = [...latestSemiFinishedStepBySku.values()].sort((a, b) => a - b);
      if (inferred.length > 0) return inferred;
    }

    const previous = steps
      .filter((item) => Number(item.step_no) < currentStepNo)
      .map((item) => Number(item.step_no))
      .sort((a, b) => b - a)[0];
    return previous ? [previous] : [];
  }

  private findTerminalStepNos(steps: ProcessSnapshotStepPayload[]): number[] {
    const predecessorSet = new Set<number>();
    steps.forEach((step) => {
      (step.predecessorStepNos ?? []).forEach((stepNo) => predecessorSet.add(Number(stepNo)));
    });
    return steps
      .map((step) => Number(step.stepNo ?? 0))
      .filter((stepNo) => Number.isInteger(stepNo) && stepNo > 0 && !predecessorSet.has(stepNo))
      .sort((a, b) => a - b);
  }

  private normalizeStepNoList(raw: unknown): number[] {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
  }

  private parseProcessParams(raw: string | Record<string, unknown> | null): Record<string, unknown> | null {
    if (!raw) return null;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return raw;
  }

  private async fetchTemplateContent(
    manager: QueryRunnerLike,
    templateId: number,
  ): Promise<{ steps: StepRow[]; stepMaterialsByNo: Map<number, StepMaterialRow[]> }> {
    const steps = await manager.query<StepRow[]>(
      `SELECT id, step_no, step_name, workstation_type, workstation_id, standard_hours, max_hours,
              guide_text, guide_attachment_url, guide_attachment_name, execution_mode,
              output_type, output_sku_id, predecessor_step_nos_json, route_group_key, route_level
       FROM process_steps
       WHERE template_id = ? AND tenant_id = ?
       ORDER BY step_no ASC, id ASC`,
      [templateId, this.tenantId],
    );

    const stepMaterials = await manager.query<StepMaterialRow[]>(
      `SELECT step_no, input_sku_id, usage_per_unit, loss_rate, consume_timing,
              is_key_material, spec_text, process_params_json
       FROM process_step_materials
       WHERE template_id = ? AND tenant_id = ?
       ORDER BY step_no ASC, id ASC`,
      [templateId, this.tenantId],
    );

    const stepMaterialsByNo = new Map<number, StepMaterialRow[]>();
    for (const item of stepMaterials) {
      const key = Number(item.step_no);
      if (!stepMaterialsByNo.has(key)) stepMaterialsByNo.set(key, []);
      stepMaterialsByNo.get(key)!.push(item);
    }

    return { steps, stepMaterialsByNo };
  }

  private async findTemplateById(
    manager: QueryRunnerLike,
    templateId: number,
  ): Promise<TemplateMetaRow | null> {
    const [row] = await manager.query<TemplateMetaRow[]>(
      `SELECT id, sku_id, name, version
       FROM process_templates
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [templateId, this.tenantId],
    );
    return row ? { ...row, id: Number(row.id), sku_id: Number(row.sku_id) } : null;
  }

  private async findDefaultTemplateBySku(
    manager: QueryRunnerLike,
    skuId: number,
  ): Promise<TemplateMetaRow | null> {
    const rows = await manager.query<TemplateMetaRow[]>(
      `SELECT id, sku_id, name, version
       FROM process_templates
       WHERE sku_id = ? AND tenant_id = ?
       ORDER BY is_default DESC, id DESC
       LIMIT 1`,
      [skuId, this.tenantId],
    );
    const row = rows[0];
    return row ? { ...row, id: Number(row.id), sku_id: Number(row.sku_id) } : null;
  }

  private async findDirectSemiFinishedChildren(
    manager: QueryRunnerLike,
    rootSkuId: number,
  ): Promise<Array<{ skuId: number; level: number; path: string }>> {
    const rootBomId = await this.findActiveBomIdBySku(manager, rootSkuId);
    if (!rootBomId) return [];
    const parents = new Map<number, BomSemiParent>();
    await this.walkBomSemiFinishedParents(
      manager,
      rootBomId,
      null,
      1,
      `fg:${rootSkuId}`,
      new Set([rootBomId]),
      parents,
    );
    return [...parents.entries()]
      .filter(([, meta]) => meta.parentSkuId === null)
      .map(([skuId, meta]) => ({ skuId, level: meta.level, path: meta.path }))
      .sort((a, b) => a.level - b.level || a.path.localeCompare(b.path, 'zh-CN'));
  }

  private async walkBomSemiFinishedParents(
    manager: QueryRunnerLike,
    bomId: number,
    currentSemiParentSkuId: number | null,
    currentLevel: number,
    currentPath: string,
    visitedBomIds: Set<number>,
    result: Map<number, BomSemiParent>,
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

    await this.walkBomRowsForParents(
      manager,
      rows,
      null,
      currentSemiParentSkuId,
      currentLevel,
      currentPath,
      visitedBomIds,
      result,
    );
  }

  private async walkBomRowsForParents(
    manager: QueryRunnerLike,
    rows: BomComponentRow[],
    parentItemId: number | null,
    currentSemiParentSkuId: number | null,
    currentLevel: number,
    currentPath: string,
    visitedBomIds: Set<number>,
    result: Map<number, BomSemiParent>,
  ): Promise<void> {
    const siblings = rows
      .filter((row) => (row.parent_item_id === null ? null : Number(row.parent_item_id)) === parentItemId)
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order) || Number(a.id) - Number(b.id));

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

  private async findActiveBomIdBySku(manager: QueryRunnerLike, skuId: number): Promise<number | null> {
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
}
