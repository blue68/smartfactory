import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';

export const taskKeys = {
  all: ['production-tasks'] as const,
  list: (filter: Record<string, unknown>) => [...taskKeys.all, 'list', filter] as const,
  detail: (taskId: number) => [...taskKeys.all, 'detail', taskId] as const,
};

export interface TaskListQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  keyword?: string;
  dateFrom?: string;
  dateTo?: string;
  processId?: number;
}

export interface TaskException {
  id: number;
  type: string;
  description: string;
  severity: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface ProductionTask {
  id: number;
  taskDate: string;
  status: 'pending' | 'in_progress' | 'completed' | 'exception';
  plannedQty: number;
  completedQty: number;
  scrapQty?: number;
  orderNo: string;
  processName: string;
  workstationName: string;
  workerName: string;
  skuCode?: string;
  skuName?: string;
  priority?: number;
  isOvertime?: boolean;
  maxHours?: number;
  actualHours?: number;
  exceptions?: TaskException[];
}

export const taskApi = {
  list: (filter: TaskListQuery) =>
    request.get<any>('/api/production/tasks', filter as Record<string, unknown>),
  detail: (taskId: number) =>
    request.get<ProductionTask>(`/api/production/tasks/${taskId}`),
  start: (taskId: number) =>
    request.post<any>(`/api/production/tasks/${taskId}/start`),
  complete: (taskId: number, data: { completedQty: string; notes?: string }) =>
    request.post<any>(`/api/production/tasks/${taskId}/complete`, data),
  reportException: (taskId: number, data: { type: string; description: string; severity: string }) =>
    request.post<any>(`/api/production/tasks/${taskId}/exception`, data),
};

export function useTaskList(filter: TaskListQuery) {
  return useQuery({
    queryKey: taskKeys.list(filter as Record<string, unknown>),
    queryFn: () => taskApi.list(filter),
  });
}

export function useTaskDetail(taskId: number | null) {
  return useQuery({
    queryKey: taskKeys.detail(taskId!),
    queryFn: () => taskApi.detail(taskId!),
    enabled: taskId !== null && taskId > 0,
  });
}

export function useStartTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: number) => taskApi.start(taskId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: taskKeys.all }); },
  });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: number; data: { completedQty: string; notes?: string } }) =>
      taskApi.complete(taskId, data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: taskKeys.all }); },
  });
}

export function useReportException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: number; data: { type: string; description: string; severity: string } }) =>
      taskApi.reportException(taskId, data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: taskKeys.all }); },
  });
}
