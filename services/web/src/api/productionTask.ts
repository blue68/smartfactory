import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';

export const taskKeys = {
  all: ['production-tasks'] as const,
  list: (filter: Record<string, unknown>) => [...taskKeys.all, 'list', filter] as const,
  detail: (taskId: number) => [...taskKeys.all, 'detail', taskId] as const,
  stats: () => [...taskKeys.all, 'stats'] as const,
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

export interface TaskStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  exception: number;
  suspended: number;
}

export interface ProductionTask {
  id: number;
  taskDate: string;
  status: 'pending' | 'in_progress' | 'completed' | 'exception' | 'suspended';
  plannedQty: number;
  completedQty: number;
  scrapQty?: number;
  orderNo: string;
  productName?: string;
  plannedFinishTime?: string;
  processName: string;
  workstationName: string;
  workerName: string;
  skuCode?: string;
  skuName?: string;
  priority?: number;
  isOvertime?: boolean;
  maxHours?: number;
  actualHours?: number;
  unitPrice?: number;
  workerGrade?: string;
  workerGradeConfigured?: boolean;
  exceptions?: TaskException[];
}

export const taskApi = {
  list: (filter: TaskListQuery) =>
    request.get<any>('/api/production/tasks', filter as Record<string, unknown>),
  stats: () =>
    request.get<TaskStats>('/api/production-tasks/stats'),
  detail: (taskId: number) =>
    request.get<ProductionTask>(`/api/production/tasks/${taskId}`),
  start: (taskId: number) =>
    request.post<any>(`/api/production/tasks/${taskId}/start`),
  complete: (taskId: number, data: { completedQty: string; actualHours: string; notes?: string }) =>
    request.post<any>(`/api/production/tasks/${taskId}/complete`, data),
  reportException: (taskId: number, data: { type: string; description: string; affectsProgress: boolean }) =>
    request.post<any>(`/api/production/tasks/${taskId}/exception`, data),
  resolveException: (taskId: number, data: { resolution: string }) =>
    request.put<any>(`/api/production-tasks/${taskId}/resolve`, data),
  suspendTask: (taskId: number, data: { reason: string }) =>
    request.put<any>(`/api/production-tasks/${taskId}/suspend`, data),
};

export function useTaskList(filter: TaskListQuery) {
  return useQuery({
    queryKey: taskKeys.list(filter as Record<string, unknown>),
    queryFn: () => taskApi.list(filter),
  });
}

export function useTaskStats() {
  return useQuery({
    queryKey: taskKeys.stats(),
    queryFn: () => taskApi.stats(),
    staleTime: 30_000,
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
    mutationFn: ({ taskId, data }: { taskId: number; data: { completedQty: string; actualHours: string; notes?: string } }) =>
      taskApi.complete(taskId, data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: taskKeys.all }); },
  });
}

export function useReportException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: number; data: { type: string; description: string; affectsProgress: boolean } }) =>
      taskApi.reportException(taskId, data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: taskKeys.all }); },
  });
}

export function useResolveException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: number; data: { resolution: string } }) =>
      taskApi.resolveException(taskId, data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: taskKeys.all }); },
  });
}

export function useSuspendTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: number; data: { reason: string } }) =>
      taskApi.suspendTask(taskId, data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: taskKeys.all }); },
  });
}
