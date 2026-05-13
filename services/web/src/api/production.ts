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
  purchaseUnit: string | null;
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

export interface ProductionOrderComponent {
  id: number;
  parentComponentId: number | null;
  skuId: number;
  skuName: string;
  resolvedSkuId: number | null;
  resolvedSkuName: string | null;
  componentType: 'fg' | 'wip' | 'rm';
  qtyRequired: string;
  bomLevel: number;
  bomPath: string | null;
}

export interface ProductionOrderOperation {
  id: number;
  componentId: number | null;
  componentType: 'fg' | 'wip' | 'rm' | null;
  bomLevel?: number | null;
  bomPath?: string | null;
  processStepId: number | null;
  stepNo: number | null;
  stepName: string;
  outputSkuId: number | null;
  outputSkuCode?: string | null;
  outputSkuName: string | null;
  outputUnit?: string | null;
  executionMode?: 'internal' | 'outsource' | null;
  plannedQty: string;
  completedQty: string;
  status: string;
  inputItems?: ProductionOrderOperationInputItem[];
  outputItem?: ProductionOrderOperationOutputItem;
}

export interface ProductionOrderOperationInputItem {
  skuId: number;
  skuCode?: string | null;
  skuName: string | null;
  itemType: 'semi_finished' | 'material';
  unit?: string | null;
  requiredQty: string;
  sourceOperationId?: number | null;
  sourceStatus?: string | null;
  sourceCompletedQty?: string | null;
}

export interface ProductionOrderOperationOutputItem {
  skuId: number | null;
  skuCode?: string | null;
  skuName: string | null;
  itemType: 'finished' | 'semi_finished';
  unit?: string | null;
  plannedQty: string;
  completedQty: string;
}

export interface ReleaseProductionOrderResult {
  productionOrderId: number;
  reused: boolean;
  componentCount: number;
  operationCount: number;
}

export interface ScheduleAdjustmentPayload {
  scheduleId: number;
  workerId?: number;
  workstationId?: number;
  plannedQty?: string;
  expectedUpdatedAt?: string;
}

export interface ProductionWorkerOption {
  id: number;
  name: string;
  station?: string;
}

export interface WorkstationOption {
  id: number;
  name: string;
  type: string;
  capacity: number;
  status: 'active' | 'inactive';
  linkedProcessCount: number;
}

export interface WorkstationPayload {
  name: string;
  type: string;
  capacity?: number;
  status?: 'active' | 'inactive';
}

export interface ScheduleHistoryEntry {
  date: string;
  taskCount: number;
  orderCount: number;
  stationCount: number;
  workerCount: number;
  totalHours: string;
  confirmed: boolean;
  confirmedAt: string | null;
  generatedAt: string | null;
}

export interface WorkTimeRange {
  startTime: string;
  endTime: string;
}

export interface ProductionWorkCalendarDay {
  date: string;
  isWorkday: boolean;
  isHoliday: boolean;
  holidayName?: string;
  normalRanges: WorkTimeRange[];
  overtimeRanges: WorkTimeRange[];
  normalHours: string;
  overtimeHours: string;
  totalHours: string;
}

export interface UpdateWorkCalendarDayPayload {
  date: string;
  isWorkday: boolean;
  name?: string;
  normalRanges?: WorkTimeRange[];
  overtimeRanges?: WorkTimeRange[];
}

export type ProductionBatchMode = 'priority_sequential' | 'compatible_merge';
export type ProductionBatchStatus = 'draft' | 'confirmed' | 'cancelled' | 'closed' | 'released';

export interface EligibleSalesOrder {
  id: number;
  orderNo: string;
  customerId: number;
  customerName: string;
  priority: number;
  expectedDelivery: string | null;
  openItemCount: number;
  openQtyTotal: string;
  status: string;
}

export interface ProductionBatchListItem {
  id: number;
  batchNo: string;
  name: string | null;
  mode: ProductionBatchMode;
  status: ProductionBatchStatus | string;
  orderCount: number;
  itemCount: number;
  totalPlannedQty: string;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  linkedProductionOrderCount: number;
}

export interface ProductionBatchDetailOrder {
  id: number;
  salesOrderId: number;
  salesOrderNo: string;
  priority: number;
  expectedDelivery: string | null;
  customerName: string;
  sequenceNo: number;
  status: string;
}

export interface ProductionBatchDetailItem {
  id: number;
  salesOrderId: number;
  salesOrderItemId: number;
  skuId: number;
  skuCode: string;
  skuName: string;
  qtyOpen: string;
  qtyPlanned: string;
  priorityRank: number;
  sequenceNo: number;
  mode: ProductionBatchMode;
  mergeGroupKey: string | null;
  expectedDelivery: string | null;
  status: string;
}

export interface ProductionBatchLinkedOrder {
  id: number;
  workOrderNo: string;
  salesOrderId: number;
  salesOrderItemId: number;
  batchItemId: number;
  qtyPlanned: string;
  qtyCompleted: string;
  status: string;
  materialStatus: string | null;
  mergeGroupKey: string | null;
  skuName: string;
}

export interface ProductionBatchShortage {
  skuId: number;
  skuCode: string;
  skuName: string;
  shortageQty: string;
  requiredQty: string;
  currentStock: string;
  inTransitQty: string;
}

export interface ProductionBatchDetail {
  header: {
    id: number;
    batchNo: string;
    name: string | null;
    mode: ProductionBatchMode;
    status: ProductionBatchStatus | string;
    orderCount: number;
    itemCount: number;
    totalPlannedQty: string;
    notes: string | null;
    confirmedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  orders: ProductionBatchDetailOrder[];
  items: ProductionBatchDetailItem[];
  linkedProductionOrders: ProductionBatchLinkedOrder[];
  shortages: ProductionBatchShortage[];
}

export interface CreateProductionBatchPayload {
  mode: ProductionBatchMode;
  salesOrderIds: number[];
  notes?: string;
  name?: string;
}

// ── Query Keys ───────────────────────────────
export const productionKeys = {
  all: ['production'] as const,
  orders: () => [...productionKeys.all, 'orders'] as const,
  orderList: (params: { status?: ProductionOrderStatus; salesOrderId?: number; batchId?: number }) =>
    [...productionKeys.orders(), params] as const,
  orderDetail: (id: number) => [...productionKeys.orders(), 'detail', id] as const,
  orderComponents: (id: number) => [...productionKeys.orders(), id, 'components'] as const,
  orderOperations: (id: number) => [...productionKeys.orders(), id, 'operations'] as const,
  schedule: (params: string | { date: string; batchId?: number | null }) =>
    [...productionKeys.all, 'schedule', typeof params === 'string' ? { date: params } : params] as const,
  workCalendar: (year: number, month: number) => [...productionKeys.all, 'workCalendar', year, month] as const,
  workerTasks: (workerId: number, date: string) =>
    [...productionKeys.all, 'workerTasks', workerId, date] as const,
  // Sprint 3 追加
  materials: (id: number) => [...productionKeys.orders(), id, 'materials'] as const,
  materialCheck: (id: number) => [...productionKeys.orders(), id, 'material-check'] as const,
  batches: () => [...productionKeys.all, 'batches'] as const,
  batchList: (params: { status?: string; keyword?: string; page?: number; pageSize?: number }) =>
    [...productionKeys.batches(), params] as const,
  batchDetail: (id: number) => [...productionKeys.batches(), 'detail', id] as const,
  eligibleSalesOrders: (params: { keyword?: string; customerId?: number; page?: number; pageSize?: number }) =>
    [...productionKeys.batches(), 'eligible-sales-orders', params] as const,
};

// ── 原始请求函数 ─────────────────────────────
export const productionApi = {
  getOrders: (params?: {
    status?: ProductionOrderStatus;
    salesOrderId?: number;
    batchId?: number;
    page?: number;
    pageSize?: number;
  }) =>
    request.get<PaginatedData<ProductionOrder>>(
      '/api/production/orders',
      params as Record<string, unknown>,
    ),

  getOrderById: (id: number) =>
    request.get<ProductionOrder>(`/api/production/orders/${id}`),

  getOrderComponents: (id: number) =>
    request.get<ProductionOrderComponent[]>(`/api/production/orders/${id}/components`),

  getOrderOperations: (id: number) =>
    request.get<ProductionOrderOperation[]>(`/api/production/orders/${id}/operations`),

  releaseOrder: (id: number) =>
    request.post<ReleaseProductionOrderResult>(`/api/production/orders/${id}/release`),

  createOrder: (payload: CreateProductionOrderPayload) =>
    request.post<{ id: number; workOrderNo: string }>('/api/production/orders', payload),

  generateSchedule: (date?: string, force?: boolean, batchId?: number) =>
    request.get<ScheduleResult>(
      '/api/production/schedule/generate',
      date || force || batchId
        ? { ...(date ? { date } : {}), ...(force ? { force: true } : {}), ...(batchId ? { batchId } : {}) }
        : undefined,
      { timeout: config.aiRequestTimeout },
    ),

  confirmSchedule: (date: string, batchId?: number) =>
    request.post<null>('/api/production/schedule/confirm', {
      date,
      ...(batchId ? { batchId } : {}),
    }),

  getScheduleHistory: (params?: { limit?: number }) =>
    request.get<ScheduleHistoryEntry[]>(
      '/api/production/schedule/history',
      params as Record<string, unknown> | undefined,
    ),

  getWorkCalendar: (params: { year: number; month: number }) =>
    request.get<ProductionWorkCalendarDay[]>('/api/production/work-calendar', params),

  updateWorkCalendarDay: (payload: UpdateWorkCalendarDayPayload) =>
    request.put<null>('/api/production/work-calendar/day', payload),

  getWorkerTasks: (workerId: number, date?: string) =>
    request.get<ProductionTask[]>(
      `/api/production/tasks/worker/${workerId}`,
      date ? { date } : undefined,
    ),

  adjustSchedule: (date: string, adjustments: ScheduleAdjustmentPayload[]) =>
    request.put<{ updated: number }>(`/api/production/schedule/${date}/adjust`, { adjustments }),

  getWorkers: () =>
    request.get<ProductionWorkerOption[]>('/api/production/workers'),

  getWorkstations: (params?: { includeInactive?: boolean }) =>
    request.get<WorkstationOption[]>('/api/production/workstations', params),

  createWorkstation: (payload: WorkstationPayload) =>
    request.post<WorkstationOption>('/api/production/workstations', payload),

  updateWorkstation: (id: number, payload: Partial<WorkstationPayload>) =>
    request.put<WorkstationOption>(`/api/production/workstations/${id}`, payload),

  removeWorkstation: (id: number) =>
    request.delete<{ id: number }>(`/api/production/workstations/${id}`),

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

  getEligibleSalesOrders: (params?: {
    keyword?: string;
    customerId?: number;
    page?: number;
    pageSize?: number;
  }) =>
    request.get<PaginatedData<EligibleSalesOrder>>(
      '/api/production/batches/eligible-sales-orders',
      params as Record<string, unknown> | undefined,
    ),

  getBatches: (params?: {
    status?: string;
    keyword?: string;
    page?: number;
    pageSize?: number;
  }) =>
    request.get<PaginatedData<ProductionBatchListItem>>(
      '/api/production/batches',
      params as Record<string, unknown> | undefined,
    ),

  getBatchById: (id: number) =>
    request.get<ProductionBatchDetail>(`/api/production/batches/${id}`),

  createBatch: (payload: CreateProductionBatchPayload) =>
    request.post<{
      id: number;
      batchNo: string;
      mode: ProductionBatchMode;
      status: ProductionBatchStatus | string;
      orderCount: number;
      itemCount: number;
    }>('/api/production/batches', payload),

  confirmBatch: (id: number) =>
    request.post<{
      batchId: number;
      createdProductionOrderIds: number[];
      skippedItemIds: number[];
      status: string;
    }>(`/api/production/batches/${id}/confirm`),
};

// ── React Query Hooks ────────────────────────

/** 生产工单列表 */
export function useProductionOrderList(
  params: { status?: ProductionOrderStatus; salesOrderId?: number; batchId?: number } = {},
  page = 1,
  pageSize = 20,
) {
  return useQuery({
    queryKey: [...productionKeys.orderList(params), page, pageSize],
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

export function useProductionOrderComponents(id: number | null) {
  return useQuery({
    queryKey: productionKeys.orderComponents(id!),
    queryFn: () => productionApi.getOrderComponents(id!),
    enabled: id !== null && id > 0,
  });
}

export function useProductionOrderOperations(id: number | null) {
  return useQuery({
    queryKey: productionKeys.orderOperations(id!),
    queryFn: () => productionApi.getOrderOperations(id!),
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

/** 释放生产工单并生成 BOM 依赖任务链 */
export function useReleaseProductionOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: number) => productionApi.releaseOrder(orderId),
    onSuccess: (_data, orderId) => {
      void qc.invalidateQueries({ queryKey: productionKeys.orders() });
      void qc.invalidateQueries({ queryKey: productionKeys.orderDetail(orderId) });
      void qc.invalidateQueries({ queryKey: productionKeys.orderComponents(orderId) });
      void qc.invalidateQueries({ queryKey: productionKeys.orderOperations(orderId) });
      void qc.invalidateQueries({ queryKey: productionKeys.materials(orderId) });
    },
  });
}

/** 生成排产计划（3-10s，有12小时缓存） */
export function useSchedule(date: string | null, batchId?: number | null) {
  return useQuery({
    queryKey: productionKeys.schedule({ date: date ?? 'pending', batchId: batchId ?? null }),
    queryFn: () => productionApi.generateSchedule(date ?? undefined, undefined, batchId ?? undefined),
    enabled: Boolean(date),
    staleTime: 1000 * 60 * 60 * 12, // 12小时缓存
  });
}

export function useScheduleHistory(limit = 14, enabled = true) {
  return useQuery({
    queryKey: [...productionKeys.all, 'schedule-history', limit],
    queryFn: () => productionApi.getScheduleHistory({ limit }),
    enabled,
    staleTime: 1000 * 60 * 5,
  });
}

export function useProductionWorkCalendar(year: number, month: number, enabled = true) {
  return useQuery({
    queryKey: productionKeys.workCalendar(year, month),
    queryFn: () => productionApi.getWorkCalendar({ year, month }),
    enabled,
    staleTime: 1000 * 60 * 5,
  });
}

/** 确认排产计划（下发任务） */
export function useConfirmSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ date, batchId }: { date: string; batchId?: number }) =>
      productionApi.confirmSchedule(date, batchId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...productionKeys.all, 'schedule'] });
      void qc.invalidateQueries({ queryKey: productionKeys.orders() });
    },
  });
}

/** 手动调整排产 */
export function useAdjustSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ date, adjustments }: { date: string; adjustments: ScheduleAdjustmentPayload[] }) =>
      productionApi.adjustSchedule(date, adjustments),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...productionKeys.all, 'schedule'] });
    },
  });
}

export function useUpdateWorkCalendarDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: productionApi.updateWorkCalendarDay,
    onSuccess: (_data, payload) => {
      const [year, month] = payload.date.split('-');
      void qc.invalidateQueries({ queryKey: productionKeys.workCalendar(Number(year), Number(month)) });
      void qc.invalidateQueries({ queryKey: [...productionKeys.all, 'schedule'] });
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

/** 工人列表 */
export function useProductionWorkers() {
  return useQuery({
    queryKey: [...productionKeys.all, 'workers'],
    queryFn: () => productionApi.getWorkers(),
    staleTime: 1000 * 60 * 10,
  });
}

/** 工作站列表 */
export function useProductionWorkstations(includeInactive = false) {
  return useQuery({
    queryKey: [...productionKeys.all, 'workstations', { includeInactive }],
    queryFn: () => productionApi.getWorkstations(includeInactive ? { includeInactive: true } : undefined),
    staleTime: 1000 * 60 * 10,
  });
}

export function useCreateProductionWorkstation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: productionApi.createWorkstation,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...productionKeys.all, 'workstations'] });
    },
  });
}

export function useUpdateProductionWorkstation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<WorkstationPayload> }) =>
      productionApi.updateWorkstation(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...productionKeys.all, 'workstations'] });
    },
  });
}

export function useDeleteProductionWorkstation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => productionApi.removeWorkstation(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...productionKeys.all, 'workstations'] });
    },
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

export function useEligibleSalesOrderList(
  params: { keyword?: string; customerId?: number } = {},
  page = 1,
  pageSize = 20,
) {
  return useQuery({
    queryKey: productionKeys.eligibleSalesOrders({ ...params, page, pageSize }),
    queryFn: () => productionApi.getEligibleSalesOrders({ ...params, page, pageSize }),
  });
}

export function useProductionBatchList(
  params: { status?: string; keyword?: string } = {},
  page = 1,
  pageSize = 20,
) {
  return useQuery({
    queryKey: productionKeys.batchList({ ...params, page, pageSize }),
    queryFn: () => productionApi.getBatches({ ...params, page, pageSize }),
  });
}

export function useProductionBatchDetail(id: number | null) {
  return useQuery({
    queryKey: productionKeys.batchDetail(id!),
    queryFn: () => productionApi.getBatchById(id!),
    enabled: id !== null && id > 0,
  });
}

export function useCreateProductionBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: productionApi.createBatch,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productionKeys.batches() });
      void qc.invalidateQueries({ queryKey: productionKeys.orders() });
    },
  });
}

export function useConfirmProductionBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => productionApi.confirmBatch(id),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: productionKeys.batches() });
      void qc.invalidateQueries({ queryKey: productionKeys.batchDetail(id) });
      void qc.invalidateQueries({ queryKey: productionKeys.orders() });
    },
  });
}
