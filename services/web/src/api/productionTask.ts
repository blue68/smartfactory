import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';

export const taskKeys = {
  all: ['production-tasks'] as const,
  list: (filter: Record<string, unknown>) => [...taskKeys.all, 'list', filter] as const,
};

export interface TaskListQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  keyword?: string;
}

export interface ProductionTask {
  id: number;
  taskDate: string;
  status: 'pending' | 'in_progress' | 'completed' | 'exception';
  plannedQty: number;
  completedQty: number;
  orderNo: string;
  processName: string;
  workstationName: string;
  workerName: string;
}

export const taskApi = {
  list: (filter: TaskListQuery) =>
    request.get<any>('/api/production/tasks', filter as Record<string, unknown>),
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
