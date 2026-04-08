/**
 * [artifact:接口联调代码] — 库存盘点模块 API
 *
 * 后端接口：
 *   GET    /api/stocktaking           — 盘点任务列表
 *   POST   /api/stocktaking           — 创建盘点任务
 *   GET    /api/stocktaking/:id/items — 盘点明细
 *   PUT    /api/stocktaking/:id/items — 批量更新实盘数量
 *   POST   /api/stocktaking/:id/submit — 提交待确认
 *   POST   /api/stocktaking/:id/adjustment-order — 盘点差异一键生成调整单（可执行）
 *   POST   /api/stocktaking/:id/confirm — 确认盘点结果（boss only）
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';

const STOCKTAKING_ACTION_TIMEOUT = 120_000;

// ── 类型定义 ───────────────────────────────────────────────

export type StocktakingScope = 'all' | 'category' | 'location';
export type StocktakingStatus = 'draft' | 'in_progress' | 'pending_confirm' | 'confirmed' | 'cancelled';

export const StocktakingScopeLabel: Record<StocktakingScope, string> = {
  all: '全库盘点',
  category: '按品类盘点',
  location: '按库位盘点',
};

export const StocktakingStatusLabel: Record<StocktakingStatus, string> = {
  draft: '草稿',
  in_progress: '盘点中',
  pending_confirm: '待确认',
  confirmed: '已确认',
  cancelled: '已取消',
};

export interface StocktakingTask {
  id: number;
  taskNo: string;
  scope: StocktakingScope;
  scopeValue?: string;
  status: StocktakingStatus;
  warehouseId?: number | null;
  locationId?: number | null;
  warehouseCode?: string | null;
  warehouseName?: string | null;
  locationCode?: string | null;
  locationName?: string | null;
  totalItems: number;
  diffItems: number;
  createdAt: string;
  confirmedAt?: string;
  createdBy?: string;
}

export interface StocktakingItem {
  id: number;
  taskId: number;
  skuId: number;
  skuCode: string;
  skuName: string;
  stockUnit: string;
  warehouseId?: number | null;
  locationId?: number | null;
  warehouseCode?: string | null;
  warehouseName?: string | null;
  locationCode?: string | null;
  locationName?: string | null;
  systemQty: string;
  actualQty: string | null;
  diffQty: string | null;
}

export interface StocktakingListResult {
  list: StocktakingTask[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateStocktakingPayload {
  scope: StocktakingScope;
  scopeValue?: string;
  warehouseId?: number;
  locationId?: number;
  notes?: string;
}

export interface UpdateItemsPayload {
  items: Array<{ skuId: number; actualQty: string }>;
}

export interface UpdateItemsResult {
  updatedCount: number;
}

export interface SubmitStocktakingResult {
  submittedAt: string;
}

export interface CreateAdjustmentOrderPayload {
  execute?: boolean;
}

export interface StocktakingAdjustmentOrderItem {
  skuId: number;
  skuCode: string;
  skuName: string;
  stockUnit: string | null;
  warehouseId: number | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  locationId: number | null;
  locationCode: string | null;
  locationName: string | null;
  diffQty: string;
  direction: 'IN' | 'OUT';
  adjustQty: string;
}

export interface StocktakingAdjustmentOrder {
  adjustmentNo: string;
  taskId: number;
  taskNo: string;
  execute: boolean;
  confirmedAt: string | null;
  diffCount: number;
  totalAdjustQty: string;
  items: StocktakingAdjustmentOrderItem[];
}

type ServerStocktakingStatus = 'draft' | 'in_progress' | 'completed' | 'confirmed' | 'cancelled';

type ServerStocktakingTask = Omit<StocktakingTask, 'status'> & {
  status: ServerStocktakingStatus;
};

interface ServerStocktakingTaskDetailResult {
  task: ServerStocktakingTask;
  items: StocktakingItem[];
}

interface ServerStocktakingListResult {
  list: ServerStocktakingTask[];
  total: number;
  page: number;
  pageSize: number;
}

function normalizeTaskStatus(status: ServerStocktakingStatus): StocktakingStatus {
  if (status === 'completed') return 'pending_confirm';
  return status;
}

function normalizeTask(task: ServerStocktakingTask): StocktakingTask {
  return {
    ...task,
    status: normalizeTaskStatus(task.status),
  };
}

// ── Query Keys ─────────────────────────────────────────────

export const stocktakingKeys = {
  all: ['stocktaking'] as const,
  list: (page: number, pageSize: number) =>
    [...stocktakingKeys.all, 'list', page, pageSize] as const,
  items: (taskId: number) => [...stocktakingKeys.all, 'items', taskId] as const,
};

// ── API 函数 ────────────────────────────────────────────────

export const stocktakingApi = {
  getList: (page = 1, pageSize = 20) =>
    request
      .get<ServerStocktakingListResult>('/api/stocktaking', { page, pageSize })
      .then((result): StocktakingListResult => ({
        ...result,
        list: result.list.map(normalizeTask),
      })),

  create: (payload: CreateStocktakingPayload) =>
    request
      .post<ServerStocktakingTask>('/api/stocktaking', payload)
      .then((result) => normalizeTask(result)),

  getItems: (taskId: number) =>
    request
      .get<ServerStocktakingTaskDetailResult>(`/api/stocktaking/${taskId}`)
      .then((result) => result.items),

  updateItems: (taskId: number, payload: UpdateItemsPayload) =>
    request.put<UpdateItemsResult>(`/api/stocktaking/${taskId}/items`, payload.items),

  submit: (taskId: number) =>
    request.post<SubmitStocktakingResult>(
      `/api/stocktaking/${taskId}/submit`,
      undefined,
      { timeout: STOCKTAKING_ACTION_TIMEOUT },
    ),

  createAdjustmentOrder: (taskId: number, payload: CreateAdjustmentOrderPayload = {}) =>
    request.post<StocktakingAdjustmentOrder>(
      `/api/stocktaking/${taskId}/adjustment-order`,
      payload,
      { timeout: STOCKTAKING_ACTION_TIMEOUT },
    ),

  confirm: (taskId: number) =>
    request.post<void>(
      `/api/stocktaking/${taskId}/confirm`,
      undefined,
      { timeout: STOCKTAKING_ACTION_TIMEOUT },
    ),
};

// ── React Query Hooks ───────────────────────────────────────

export function useStocktakingList(page = 1, pageSize = 20) {
  return useQuery({
    queryKey: stocktakingKeys.list(page, pageSize),
    queryFn: () => stocktakingApi.getList(page, pageSize),
    staleTime: 30_000,
  });
}

export function useStocktakingItems(taskId: number | null) {
  return useQuery({
    queryKey: stocktakingKeys.items(taskId ?? 0),
    queryFn: () => stocktakingApi.getItems(taskId!),
    enabled: taskId !== null,
    staleTime: 15_000,
  });
}

export function useCreateStocktaking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateStocktakingPayload) =>
      stocktakingApi.create(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: stocktakingKeys.all });
    },
  });
}

export function useUpdateStocktakingItems(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateItemsPayload) =>
      stocktakingApi.updateItems(taskId, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: stocktakingKeys.items(taskId) });
    },
  });
}

export function useConfirmStocktaking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: number) => stocktakingApi.confirm(taskId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: stocktakingKeys.all });
    },
  });
}

export function useSubmitStocktaking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: number) => stocktakingApi.submit(taskId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: stocktakingKeys.all });
    },
  });
}

export function useCreateStocktakingAdjustmentOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, payload }: { taskId: number; payload?: CreateAdjustmentOrderPayload }) =>
      stocktakingApi.createAdjustmentOrder(taskId, payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: stocktakingKeys.all });
      void qc.invalidateQueries({ queryKey: stocktakingKeys.items(vars.taskId) });
    },
  });
}
