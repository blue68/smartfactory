import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type {
  ProductionTaskDependencySummary,
  ProductionTaskInputItem,
  ProductionTaskInputMaterial,
  ProductionTaskMaterialTransaction,
  ProductionTaskOutputItem,
  ProductionTaskWageReport,
} from '@/types/models';

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
  taskType?: 'finished' | 'semi_finished';
}

export interface TaskException {
  id: number;
  type: string;
  description: string;
  severity: string;
  createdAt: string;
  resolvedAt?: string | null;
  resolution?: string | null;
  reporterName?: string | null;
  resolverName?: string | null;
}

export interface TaskStats {
  total: number;
  byStatus: {
    pending: number;
    started: number;
    completed: number;
    exception: number;
    suspended: number;
    [key: string]: number;
  };
}

export interface ProductionTask {
  id: number;
  taskNo?: string;
  taskDate: string;
  status: 'pending' | 'in_progress' | 'completed' | 'exception' | 'suspended';
  taskType?: 'finished' | 'semi_finished';
  statusLabel?: string;
  plannedQty: number;
  completedQty: number;
  scrapQty?: number;
  orderNo: string;
  productName?: string;
  plannedFinishTime?: string;
  processStepId?: number;
  processName: string;
  operationId?: number | null;
  outputSkuId?: number | null;
  outputSkuName?: string | null;
  workstationName: string;
  workerName: string;
  skuCode?: string;
  skuName?: string;
  priority?: number;
  priorityScore?: number;
  priorityLevel?: 'critical' | 'high' | 'medium' | 'normal';
  priorityLabel?: string;
  priorityReason?: string;
  downstreamTaskCount?: number;
  activeDownstreamTaskCount?: number;
  dependencyBlocked?: boolean | 0 | 1;
  isOvertime?: boolean;
  maxHours?: number;
  actualHours?: number;
  createdAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
  unitPrice?: number;
  workerGrade?: string;
  workerGradeConfigured?: boolean;
  dependencySummary?: ProductionTaskDependencySummary;
  inputItems?: ProductionTaskInputItem[];
  inputMaterials?: ProductionTaskInputMaterial[];
  outputItems?: ProductionTaskOutputItem[];
  materialTransactions?: ProductionTaskMaterialTransaction[];
  wageReport?: ProductionTaskWageReport | null;
  exceptions?: TaskException[];
}

export interface TaskInventoryActionItemPayload {
  skuId: number;
  qty: string;
  warehouseId?: number;
  locationId?: number;
  dyeLotNo?: string;
  notes?: string;
}

function normalizeTaskStatus<T extends { status?: string | null }>(task: T): T {
  if (task.status === 'started') {
    return { ...task, status: 'in_progress' } as T;
  }
  return task;
}

export const taskApi = {
  list: (filter: TaskListQuery) =>
    request.get<any>('/api/production/tasks', filter as Record<string, unknown>).then((result) => {
      if (Array.isArray(result)) {
        return result.map(normalizeTaskStatus);
      }
      return {
        ...result,
        list: Array.isArray(result?.list) ? result.list.map(normalizeTaskStatus) : [],
      };
    }),
  stats: () =>
    request.get<TaskStats>('/api/production/tasks/stats'),
  detail: (taskId: number) =>
    request.get<ProductionTask>(`/api/production/tasks/${taskId}`).then(normalizeTaskStatus),
  start: (taskId: number) =>
    request.post<any>(`/api/production/tasks/${taskId}/start`),
  complete: (taskId: number, data: { completedQty: string; actualHours: string; notes?: string; scrapQty?: string }) =>
    request.post<any>(`/api/production/tasks/${taskId}/complete-v2`, data),
  issueMaterials: (taskId: number, data: { items: TaskInventoryActionItemPayload[] }) =>
    request.post<any>(`/api/production/tasks/${taskId}/issue-materials`, data),
  returnMaterials: (taskId: number, data: { items: TaskInventoryActionItemPayload[] }) =>
    request.post<any>(`/api/production/tasks/${taskId}/return-materials`, data),
  reportException: (taskId: number, data: { type: string; description: string; affectsProgress: boolean; severity: 'medium' | 'high' }) =>
    request.post<any>(`/api/production/tasks/${taskId}/exception`, data),
  resolveException: (taskId: number, data: { resolution: string }) =>
    request.post<any>(`/api/production/tasks/${taskId}/resolve-exception`, data),
  suspendTask: (taskId: number, data: { reason: string }) =>
    request.post<any>(`/api/production/tasks/${taskId}/suspend`, data),
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
    queryFn: async () => {
      const result = await taskApi.stats();
      return {
        ...result,
        byStatus: {
          ...result.byStatus,
          in_progress: result.byStatus.in_progress ?? result.byStatus.started ?? 0,
        },
      };
    },
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

export function useIssueTaskMaterials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: number; data: { items: TaskInventoryActionItemPayload[] } }) =>
      taskApi.issueMaterials(taskId, data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: taskKeys.all }); },
  });
}

export function useReturnTaskMaterials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: number; data: { items: TaskInventoryActionItemPayload[] } }) =>
      taskApi.returnMaterials(taskId, data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: taskKeys.all }); },
  });
}

export function useReportException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: number; data: { type: string; description: string; affectsProgress: boolean; severity: 'medium' | 'high' } }) =>
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
