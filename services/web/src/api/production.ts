/**
 * [artifact:接口联调代码] — 生产管理模块 API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type {
  ProductionOrder,
  CreateProductionOrderPayload,
  ScheduleResult,
  ProductionTask,
  CompleteTaskPayload,
} from '@/types/models';
import type { PaginatedData } from '@/types/api';
import type { ProductionOrderStatus } from '@/types/enums';
import { config } from '@/config';

// ── Sprint 3 Types ────────────────────────────
export interface MaterialRequirement {
  id: number;
  skuId: number;
  skuCode: string;
  skuName: string;
  qtyRequired: string;
  qtyReserved: string;
  qtyShortage: string;
  status: 'shortage' | 'partial' | 'fulfilled';
  currentStock: string;
  inTransit: string;
  [key: string]: unknown;
}

export interface MaterialCheckResult {
  materialStatus: 'unchecked' | 'shortage' | 'partial' | 'ready';
  items: MaterialRequirement[];
  totalShortage: number;
}

// ── Query Keys ───────────────────────────────
export const productionKeys = {
  all: ['production'] as const,
  orders: () => [...productionKeys.all, 'orders'] as const,
  orderList: (params: { status?: ProductionOrderStatus; salesOrderId?: number }) =>
    [...productionKeys.orders(), params] as const,
  orderDetail: (id: number) => [...productionKeys.orders(), 'detail', id] as const,
  schedule: (date: string) => [...productionKeys.all, 'schedule', date] as const,
  workerTasks: (workerId: number, date: string) =>
    [...productionKeys.all, 'workerTasks', workerId, date] as const,
  // Sprint 3 追加
  materials: (id: number) => [...productionKeys.orders(), id, 'materials'] as const,
  materialCheck: (id: number) => [...productionKeys.orders(), id, 'material-check'] as const,
};

// ── 原始请求函数 ─────────────────────────────
export const productionApi = {
  getOrders: (params?: {
    status?: ProductionOrderStatus;
    salesOrderId?: number;
    page?: number;
    pageSize?: number;
  }) =>
    request.get<PaginatedData<ProductionOrder>>(
      '/api/production/orders',
      params as Record<string, unknown>,
    ),

  getOrderById: (id: number) =>
    request.get<ProductionOrder>(`/api/production/orders/${id}`),

  createOrder: (payload: CreateProductionOrderPayload) =>
    request.post<{ id: number; workOrderNo: string }>('/api/production/orders', payload),

  generateSchedule: (date?: string) =>
    request.get<ScheduleResult>(
      '/api/production/schedule/generate',
      date ? { date } : undefined,
      { timeout: config.aiRequestTimeout },
    ),

  confirmSchedule: (date: string) =>
    request.post<null>('/api/production/schedule/confirm', { date }),

  getWorkerTasks: (workerId: number, date?: string) =>
    request.get<ProductionTask[]>(
      `/api/production/tasks/worker/${workerId}`,
      date ? { date } : undefined,
    ),

  startTask: (taskId: number) =>
    request.post<null>(`/api/production/tasks/${taskId}/start`),

  completeTask: (taskId: number, payload: CompleteTaskPayload) =>
    request.post<null>(`/api/production/tasks/${taskId}/complete`, payload),

  // Sprint 3 追加
  createFromSalesOrder: (salesOrderId: number) =>
    request.post<{ orders: Array<{ id: number; workOrderNo: string }> }>(
      `/api/production/orders/from-sales-order/${salesOrderId}`
    ),

  getMaterialRequirements: (orderId: number) =>
    request.get<MaterialRequirement[]>(`/api/production/orders/${orderId}/materials`),

  checkMaterialStatus: (orderId: number) =>
    request.get<MaterialCheckResult>(`/api/production/orders/${orderId}/material-check`),

  cancelOrder: (orderId: number) =>
    request.put<null>(`/api/production/orders/${orderId}/cancel`),
};

// ── React Query Hooks ────────────────────────

/** 生产工单列表 */
export function useProductionOrderList(
  params: { status?: ProductionOrderStatus; salesOrderId?: number } = {},
  page = 1,
  pageSize = 20,
) {
  return useQuery({
    queryKey: productionKeys.orderList(params),
    queryFn: () => productionApi.getOrders({ ...params, page, pageSize }),
  });
}

/** 生产工单详情 */
export function useProductionOrderDetail(id: number | null) {
  return useQuery({
    queryKey: productionKeys.orderDetail(id!),
    queryFn: () => productionApi.getOrderById(id!),
    enabled: id !== null && id > 0,
  });
}

/** 创建生产工单 */
export function useCreateProductionOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: productionApi.createOrder,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productionKeys.orders() });
    },
  });
}

/** 生成排产计划（3-10s，有12小时缓存） */
export function useSchedule(date: string) {
  return useQuery({
    queryKey: productionKeys.schedule(date),
    queryFn: () => productionApi.generateSchedule(date),
    staleTime: 1000 * 60 * 60 * 12, // 12小时缓存
  });
}

/** 确认排产计划（下发任务） */
export function useConfirmSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: productionApi.confirmSchedule,
    onSuccess: (_data, date) => {
      void qc.invalidateQueries({ queryKey: productionKeys.schedule(date) });
      void qc.invalidateQueries({ queryKey: productionKeys.orders() });
    },
  });
}

/** 工人当日任务 */
export function useWorkerTasks(workerId: number | null, date: string) {
  return useQuery({
    queryKey: productionKeys.workerTasks(workerId!, date),
    queryFn: () => productionApi.getWorkerTasks(workerId!, date),
    enabled: workerId !== null && workerId > 0,
    refetchInterval: 1000 * 60 * 2, // 每2分钟轮询
  });
}

/** 开始任务 */
export function useStartTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: productionApi.startTask,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productionKeys.all });
    },
  });
}

/** 完工上报 */
export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, payload }: { taskId: number; payload: CompleteTaskPayload }) =>
      productionApi.completeTask(taskId, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productionKeys.all });
    },
  });
}

// ── Sprint 3 Hooks ────────────────────────────

/** 从销售订单创建生产工单 */
export function useCreateFromSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (salesOrderId: number) => productionApi.createFromSalesOrder(salesOrderId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productionKeys.orders() });
    },
  });
}

/** 物料需求列表 */
export function useMaterialRequirements(orderId: number | null) {
  return useQuery({
    queryKey: productionKeys.materials(orderId!),
    queryFn: () => productionApi.getMaterialRequirements(orderId!),
    enabled: orderId !== null && orderId > 0,
  });
}

/** 备料状态检测 */
export function useMaterialCheck(orderId: number | null) {
  return useQuery({
    queryKey: productionKeys.materialCheck(orderId!),
    queryFn: () => productionApi.checkMaterialStatus(orderId!),
    enabled: orderId !== null && orderId > 0,
  });
}

/** 取消工单 */
export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: number) => productionApi.cancelOrder(orderId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productionKeys.orders() });
    },
  });
}
