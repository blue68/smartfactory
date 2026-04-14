import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type { PaginatedData } from '@/types/api';
import type { DepartmentMutationPayload, DepartmentSummary } from '@/types/models';

export interface DepartmentListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
}

export const departmentKeys = {
  all: ['departments'] as const,
  list: (query?: DepartmentListQuery) => [...departmentKeys.all, 'list', query] as const,
};

function normalizeDepartment(item: DepartmentSummary): DepartmentSummary {
  return {
    ...item,
    id: Number(item.id),
    tenantId: Number(item.tenantId),
    sortOrder: item.sortOrder != null ? Number(item.sortOrder) : 0,
  };
}

export const departmentApi = {
  getList: (query?: DepartmentListQuery) =>
    request
      .get<PaginatedData<DepartmentSummary>>('/api/departments', (query ?? {}) as Record<string, unknown>)
      .then((data) => ({
        ...data,
        list: (data.list ?? []).map((item) => normalizeDepartment(item)),
      })),

  create: (payload: DepartmentMutationPayload) =>
    request.post<{ id: number }>('/api/departments', payload),

  update: (id: number, payload: DepartmentMutationPayload) =>
    request.put<{ success: boolean }>(`/api/departments/${id}`, payload),

  updateStatus: (id: number, payload: { status: string }) =>
    request.post<{ success: boolean }>(`/api/departments/${id}/status`, payload),
};

export function useDepartmentList(query?: DepartmentListQuery) {
  return useQuery({
    queryKey: departmentKeys.list(query),
    queryFn: () => departmentApi.getList(query),
    placeholderData: (previous) => previous,
  });
}

export function useCreateDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: departmentApi.create,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: departmentKeys.all });
    },
  });
}

export function useUpdateDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: DepartmentMutationPayload }) =>
      departmentApi.update(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: departmentKeys.all });
    },
  });
}

export function useUpdateDepartmentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: { status: string } }) =>
      departmentApi.updateStatus(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: departmentKeys.all });
    },
  });
}
