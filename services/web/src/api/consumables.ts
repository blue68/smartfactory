import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type { PaginatedData } from '@/types/api';
import type {
  ApproveConsumableIssuePayload,
  ConsumableIssueOrder,
  ConsumableStockItem,
  CreateConsumableIssuePayload,
  ExecuteConsumableIssuePayload,
} from '@/types/models';

export const consumableKeys = {
  all: ['consumables'] as const,
  issues: () => [...consumableKeys.all, 'issues'] as const,
  issueList: (params?: { status?: string; departmentId?: number; keyword?: string; page?: number; pageSize?: number }) =>
    [...consumableKeys.issues(), 'list', params] as const,
  issueDetail: (id: number) => [...consumableKeys.issues(), 'detail', id] as const,
  stock: () => [...consumableKeys.all, 'stock'] as const,
  stockList: (params?: { warehouseId?: number; keyword?: string; page?: number; pageSize?: number }) =>
    [...consumableKeys.stock(), 'list', params] as const,
};

export const consumableApi = {
  getIssueOrders: (params?: { status?: string; departmentId?: number; keyword?: string; page?: number; pageSize?: number }) =>
    request.get<PaginatedData<ConsumableIssueOrder>>(
      '/api/consumables/issues',
      params as Record<string, unknown>,
    ),

  getIssueOrderById: (id: number) =>
    request.get<ConsumableIssueOrder>(`/api/consumables/issues/${id}`),

  createIssueOrder: (payload: CreateConsumableIssuePayload) =>
    request.post<{ id: number; issueNo: string }>('/api/consumables/issues', payload),

  approveIssueOrder: (id: number, payload: ApproveConsumableIssuePayload) =>
    request.post<null>(`/api/consumables/issues/${id}/approve`, payload),

  executeIssueOrder: (id: number, payload?: ExecuteConsumableIssuePayload) =>
    request.post<{ id: number; issueNo: string; issuedItemCount: number }>(
      `/api/consumables/issues/${id}/execute`,
      payload ?? {},
    ),

  getStock: (params?: { warehouseId?: number; keyword?: string; page?: number; pageSize?: number }) =>
    request.get<PaginatedData<ConsumableStockItem>>(
      '/api/consumables/stock',
      params as Record<string, unknown>,
    ),
};

export function useConsumableIssueList(params?: { status?: string; departmentId?: number; keyword?: string; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: consumableKeys.issueList(params),
    queryFn: () => consumableApi.getIssueOrders(params),
    placeholderData: (previous) => previous,
  });
}

export function useConsumableIssueDetail(id: number | null) {
  return useQuery({
    queryKey: consumableKeys.issueDetail(id!),
    queryFn: () => consumableApi.getIssueOrderById(id!),
    enabled: id !== null && id > 0,
    placeholderData: (previous) => previous,
  });
}

export function useCreateConsumableIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: consumableApi.createIssueOrder,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: consumableKeys.issues() });
    },
  });
}

export function useApproveConsumableIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ApproveConsumableIssuePayload }) =>
      consumableApi.approveIssueOrder(id, payload),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: consumableKeys.issues() });
      void qc.invalidateQueries({ queryKey: consumableKeys.issueDetail(variables.id) });
    },
  });
}

export function useExecuteConsumableIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload?: ExecuteConsumableIssuePayload }) =>
      consumableApi.executeIssueOrder(id, payload),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: consumableKeys.issues() });
      void qc.invalidateQueries({ queryKey: consumableKeys.issueDetail(variables.id) });
      void qc.invalidateQueries({ queryKey: consumableKeys.stock() });
    },
  });
}

export function useConsumableStockList(params?: { warehouseId?: number; keyword?: string; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: consumableKeys.stockList(params),
    queryFn: () => consumableApi.getStock(params),
    placeholderData: (previous) => previous,
  });
}
