/**
 * [artifact:接口联调代码] — 工序配置 API
 *
 * 后端实体说明：
 *   - ProcessTemplateEntity (process_templates 表)
 *     字段：id, tenantId, skuId, name, status, createdAt, updatedAt, createdBy, updatedBy
 *   - ProcessStepEntity (process_steps 表)
 *     字段：id, tenantId, templateId, stepNo, stepName, standardHours, workstationType, workstationId, createdAt
 *
 * list 接口额外 JOIN skus 表，补充 skuName/skuCode 字段。
 *
 * R-05 新增：
 *   - setMaxHours  PUT /api/process-config/steps/:stepId/max-hours
 *   - getWages     GET /api/process-config/steps/:stepId/wages
 *   - setWages     PUT /api/process-config/steps/:stepId/wages
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type { PaginatedData } from '@/types/api';

// ─────────────────────────────────────────────
// 后端原始类型（与后端 service / entity 字段严格对齐）
// ─────────────────────────────────────────────

/** list 接口单条记录（JOIN skus 后的 raw 结果） */
export interface ProcessTemplateListItem {
  id: number;
  name: string;
  skuId: number;
  skuName: string | null;
  skuCode: string | null;
  status: 'active' | 'inactive';
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** getById 接口返回的工序步骤 */
export interface ProcessStep {
  id: number;
  tenantId: number;
  templateId: number;
  stepNo: number;
  stepName: string;
  /** decimal 字段，后端返回字符串，如 "2.0000" */
  standardHours: string | null;
  /** decimal 字段，R-05 新增，后端返回字符串，如 "8.00" */
  maxHours: string | null;
  workstationType: string | null;
  workstationId: number | null;
  createdAt: string;
}

/** getById 接口完整返回 */
export interface ProcessTemplateDetail {
  template: {
    id: number;
    tenantId: number;
    skuId: number;
    name: string;
    status: 'active' | 'inactive';
    createdAt: string;
    updatedAt: string;
    createdBy: number;
    updatedBy: number;
  };
  steps: ProcessStep[];
}

// ─────────────────────────────────────────────
// 查询参数
// ─────────────────────────────────────────────

export interface ProcessConfigListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  type?: string;
}

// ─────────────────────────────────────────────
// 创建 / 更新 Payload（匹配后端 CreateSchema）
// ─────────────────────────────────────────────

export interface ProcessStepPayload {
  stepNo: number;
  stepName: string;
  standardHours?: number;
  workstationType?: string;
  workstationId?: number;
}

export interface CreateProcessConfigPayload {
  /** 模板名称 */
  name: string;
  /** 关联 SKU ID */
  skuId: number;
  /** 工序步骤列表（可选） */
  steps?: ProcessStepPayload[];
}

export type UpdateProcessConfigPayload = Partial<CreateProcessConfigPayload>;

// ─────────────────────────────────────────────
// Query Keys
// ─────────────────────────────────────────────

export const processConfigKeys = {
  all: ['process-configs'] as const,
  lists: () => [...processConfigKeys.all, 'list'] as const,
  list: (query: ProcessConfigListQuery) => [...processConfigKeys.lists(), query] as const,
  detail: (id: number) => [...processConfigKeys.all, 'detail', id] as const,
};

// ─────────────────────────────────────────────
// 原始请求函数
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// R-05 工步工价类型
// ─────────────────────────────────────────────

export type WorkerGrade = 'skilled' | 'apprentice';

export interface StepWageItem {
  id: number;
  stepId: number;
  workerGrade: WorkerGrade;
  unitPrice: string; // decimal 字符串，如 "12.0000"
  updatedAt: string;
}

export interface SetMaxHoursPayload {
  maxHours: number;
}

export interface SetWagesPayload {
  workerGrade: WorkerGrade;
  unitPrice: number;
}

// ─────────────────────────────────────────────
// 原始请求函数
// ─────────────────────────────────────────────

export const processConfigApi = {
  getList: (query: ProcessConfigListQuery) =>
    request.get<PaginatedData<ProcessTemplateListItem>>(
      '/api/process-configs',
      query as Record<string, unknown>,
    ),

  getById: (id: number) =>
    request.get<ProcessTemplateDetail>(`/api/process-configs/${id}`),

  create: (payload: CreateProcessConfigPayload) =>
    request.post<ProcessTemplateListItem>('/api/process-configs', payload),

  update: (id: number, payload: UpdateProcessConfigPayload) =>
    request.put<ProcessTemplateListItem>(`/api/process-configs/${id}`, payload),

  remove: (id: number) =>
    request.delete<{ id: number }>(`/api/process-configs/${id}`),

  setDefault: (id: number) =>
    request.patch<ProcessTemplateListItem>(`/api/process-configs/${id}/set-default`, {}),

  // ── R-05 新增 ──
  // FE-05-07: 使用 PATCH 替代 PUT（语义更准确，仅更新指定字段）
  setMaxHours: (stepId: number, maxHours: number) =>
    request.patch<{ stepId: number; maxHours: number }>(
      `/api/process-configs/steps/${stepId}/max-hours`,
      { maxHours } satisfies SetMaxHoursPayload,
    ),

  getWages: (stepId: number) =>
    request.get<StepWageItem[]>(`/api/process-configs/steps/${stepId}/wages`),

  setWages: (stepId: number, payload: SetWagesPayload) =>
    request.patch<StepWageItem>(
      `/api/process-configs/steps/${stepId}/wages`,
      payload,
    ),
};

// ─────────────────────────────────────────────
// React Query Hooks
// ─────────────────────────────────────────────

/** 工序模板分页列表 */
export function useProcessConfigList(query: ProcessConfigListQuery) {
  return useQuery({
    queryKey: processConfigKeys.list(query),
    queryFn: () => processConfigApi.getList(query),
  });
}

/** 工序模板详情（含工序步骤） */
export function useProcessConfigDetail(id: number | null) {
  return useQuery({
    queryKey: processConfigKeys.detail(id ?? 0),
    queryFn: () => processConfigApi.getById(id!),
    enabled: id !== null,
  });
}

/** 创建工序模板 */
export function useCreateProcessConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: processConfigApi.create,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: processConfigKeys.lists() });
    },
  });
}

/** 更新工序模板 */
export function useUpdateProcessConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateProcessConfigPayload }) =>
      processConfigApi.update(id, payload),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: processConfigKeys.lists() });
      void qc.invalidateQueries({ queryKey: processConfigKeys.detail(variables.id) });
    },
  });
}

/** 删除工序模板 */
export function useDeleteProcessConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => processConfigApi.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: processConfigKeys.lists() });
    },
  });
}

/** 设为默认工序模板 */
export function useSetDefaultProcessConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => processConfigApi.setDefault(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: processConfigKeys.lists() });
    },
  });
}

// ─────────────────────────────────────────────
// 工种类型
// ─────────────────────────────────────────────

export interface WorkstationType {
  id: number;
  name: string;
  sortOrder: number;
  createdAt: string;
}

export const workstationTypeKeys = {
  all: ['workstation-types'] as const,
};

export const workstationTypeApi = {
  getList: () =>
    request.get<WorkstationType[]>('/api/process-configs/workstation-types'),
  create: (payload: { name: string; sortOrder?: number }) =>
    request.post<WorkstationType>('/api/process-configs/workstation-types', payload),
  update: (id: number, payload: { name?: string; sortOrder?: number }) =>
    request.patch<WorkstationType>(`/api/process-configs/workstation-types/${id}`, payload),
  remove: (id: number) =>
    request.delete<{ id: number }>(`/api/process-configs/workstation-types/${id}`),
};

export function useWorkstationTypes() {
  return useQuery({
    queryKey: workstationTypeKeys.all,
    queryFn: workstationTypeApi.getList,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateWorkstationType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: workstationTypeApi.create,
    onSuccess: () => void qc.invalidateQueries({ queryKey: workstationTypeKeys.all }),
  });
}

export function useUpdateWorkstationType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: { name?: string; sortOrder?: number } }) =>
      workstationTypeApi.update(id, payload),
    onSuccess: () => void qc.invalidateQueries({ queryKey: workstationTypeKeys.all }),
  });
}

export function useDeleteWorkstationType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => workstationTypeApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: workstationTypeKeys.all }),
  });
}

// ─────────────────────────────────────────────
// R-05 React Query Hooks
// ─────────────────────────────────────────────

/** 设置工步极限工时 */
export function useSetMaxHours() {
  return useMutation({
    mutationFn: ({ stepId, maxHours }: { stepId: number; maxHours: number }) =>
      processConfigApi.setMaxHours(stepId, maxHours),
  });
}

/** 获取工步工价列表 */
export function useStepWages(stepId: number | null) {
  return useQuery({
    queryKey: ['step-wages', stepId],
    queryFn: () => processConfigApi.getWages(stepId!),
    enabled: stepId !== null,
  });
}

/** 设置工步工价 */
export function useSetWages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      stepId,
      payload,
    }: {
      stepId: number;
      payload: SetWagesPayload;
    }) => processConfigApi.setWages(stepId, payload),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['step-wages', variables.stepId] });
    },
  });
}
