/**
 * [artifact:接口联调代码] — 工序配置 API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type { PaginatedData } from '@/types/api';

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

export interface ProcessConfig {
  id: number;
  name: string;
  /** 工序类型/分类 */
  type: string;
  /** 标准工时（小时/套） */
  standardHours: number;
  /** 单位成本（元/套） */
  unitCost: number;
  /** 所属工作站名称 */
  workstation: string;
  /** 工序说明 */
  description?: string;
  /** 排序序号 */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessConfigListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  type?: string;
}

export interface CreateProcessConfigPayload {
  name: string;
  type: string;
  standardHours: number;
  unitCost: number;
  workstation: string;
  description?: string;
  sortOrder?: number;
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

export const processConfigApi = {
  getList: (query: ProcessConfigListQuery) =>
    request.get<PaginatedData<ProcessConfig>>('/api/process-configs', query as Record<string, unknown>),

  getById: (id: number) =>
    request.get<ProcessConfig>(`/api/process-configs/${id}`),

  create: (payload: CreateProcessConfigPayload) =>
    request.post<ProcessConfig>('/api/process-configs', payload),

  update: (id: number, payload: UpdateProcessConfigPayload) =>
    request.put<ProcessConfig>(`/api/process-configs/${id}`, payload),

  remove: (id: number) =>
    request.delete<{ id: number }>(`/api/process-configs/${id}`),
};

// ─────────────────────────────────────────────
// React Query Hooks
// ─────────────────────────────────────────────

/** 工序配置分页列表 */
export function useProcessConfigList(query: ProcessConfigListQuery) {
  return useQuery({
    queryKey: processConfigKeys.list(query),
    queryFn: () => processConfigApi.getList(query),
  });
}

/** 创建工序配置 */
export function useCreateProcessConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: processConfigApi.create,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: processConfigKeys.lists() });
    },
  });
}

/** 更新工序配置 */
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

/** 删除工序配置 */
export function useDeleteProcessConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => processConfigApi.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: processConfigKeys.lists() });
    },
  });
}
