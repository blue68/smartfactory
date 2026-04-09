/**
 * [artifact:前端代码] — 来料质检单列表页 (R-09)
 *
 * 功能：
 *   - 统计卡片：全部 / 待检 / 合格 / 不合格
 *   - 筛选栏：状态下拉 + 日期范围 + 关键词搜索
 *   - 表格：质检单号、采购订单号、供应商、质检日期、状态、结果、操作
 *   - 查看详情（Drawer）/ 创建质检单（Modal）
 *   - BD-004：不合格品只有"退货"处置选项
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/stores/appStore';
import {
  useInspectionList,
  useInspectionDetail,
  useInspectionPreviewReceipt,
  useCreateInspection,
  useUpdateInspectionItems,
  useSubmitInspection,
  type IncomingInspection,
  type IncomingInspectionItem,
  type CreateInspectionPayload,
  type UpdateInspectionItemsPayload,
  type SubmitInspectionPayload,
} from '@/api/incomingInspection';
import {
  purchaseApi,
  usePurchaseDeliveryDetail,
  usePurchaseOrderDetail,
} from '@/api/purchase';
import { useWarehouseOptions, useLocationOptions } from '@/api/inventory';
import Table from '@/components/common/Table';
import type { Column } from '@/components/common/Table';
import Modal from '@/components/common/Modal';
import Drawer from '@/components/common/Drawer';
import Button from '@/components/common/Button';
import { formatDate, formatDateTime } from '@/utils/format';
import styles from './IncomingInspectionPage.module.css';

// ── Types ──────────────────────────────────────────────────────────────────────

type InspectionRow = IncomingInspection & Record<string, unknown>;

type StatusFilter = '' | 'draft' | 'in_progress' | 'passed' | 'partially_passed' | 'failed';
const EMPTY_INSPECTION_ITEMS: IncomingInspectionItem[] = [];

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  in_progress: '质检中',
  passed: '合格',
  partially_passed: '部分合格',
  failed: '不合格',
};

const RESULT_LABEL: Record<string, string> = {
  pass: '通过',
  fail: '不通过',
  conditional_pass: '有条件通过',
};

const DISPOSITION_LABEL: Record<string, string> = {
  accept: '接受',
  return: '退货',
  rework: '返工',
  scrap: '报废',
};

function getStatusClass(status: string): string {
  const map: Record<string, string> = {
    draft: styles.status_gray,
    in_progress: styles.status_blue,
    passed: styles.status_green,
    partially_passed: styles.status_yellow,
    failed: styles.status_red,
  };
  return map[status] ?? styles.status_gray;
}

function getResultClass(result: string | null): string {
  if (!result) return '';
  const map: Record<string, string> = {
    pass: styles.result_pass,
    fail: styles.result_fail,
    conditional_pass: styles.result_conditional,
  };
  return map[result] ?? '';
}

function normalizeBusinessNo(value: string): string {
  return value.trim().toLowerCase();
}

function parseQty(value?: string | number | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ── Create Modal Form ──────────────────────────────────────────────────────────

interface CreateForm {
  poId: string;
  deliveryNoteId: string;
  inspectorId: string;
  inspectionDate: string;
  notes: string;
}

const DEFAULT_CREATE_FORM: CreateForm = {
  poId: '',
  deliveryNoteId: '',
  inspectorId: '1',
  inspectionDate: new Date().toISOString().split('T')[0],
  notes: '',
};

// ── Submit Conclusion Form ─────────────────────────────────────────────────────

interface SubmitForm {
  overallResult: 'pass' | 'fail' | 'conditional_pass' | '';
  warehouseId: number | '';
  locationId: number | '';
  notes: string;
}

interface EditableInspectionDyeLotSegment {
  segmentKey: string;
  sourceItemIds: number[];
  sourceDeliveredQtys: string[];
  dyeLotNo: string;
  qtyDelivered: string;
  qtySampled: string;
  qtyPassed: string;
  qtyFailed: string;
  result: 'pass' | 'fail' | 'conditional_pass' | '';
  disposition: 'accept' | 'return' | 'rework' | 'scrap';
  notes: string;
}

interface EditableInspectionItem {
  id: number;
  sourceItemIds: number[];
  sourceDeliveredQtys: string[];
  skuCode?: string;
  skuName?: string;
  dyeLotNo?: string | null;
  hasDyeLot?: boolean;
  qtyDelivered: string;
  qtySampled: string;
  qtyPassed: string;
  qtyFailed: string;
  result: 'pass' | 'fail' | 'conditional_pass' | '';
  disposition: 'accept' | 'return' | 'rework' | 'scrap';
  notes: string;
  dyeLotSegments?: EditableInspectionDyeLotSegment[];
}

interface AggregatedInspectionItem extends IncomingInspectionItem {
  sourceItemIds: number[];
  sourceDeliveredQtys: string[];
}

interface ReceiptDispositionInsight {
  hasAcceptedSampleReceipt: boolean;
  acceptedReceiptQty: number;
  pendingReturnQty: number;
  affectedItemCount: number;
}

function formatQtyInput(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0.0000';
  return value.toFixed(4);
}

function createDyeLotSegmentKey(): string {
  return `segment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function aggregateInspectionItems(items: IncomingInspectionItem[]): AggregatedInspectionItem[] {
  const grouped = new Map<string, AggregatedInspectionItem>();

  for (const item of items) {
    const key = `${item.skuId ?? ''}::${item.skuCode ?? ''}::${item.skuName ?? ''}::${item.dyeLotNo ?? ''}`;
    const existing = grouped.get(key);
    const qtyDelivered = parseQty(item.qtyDelivered);
    const qtySampled = parseQty(item.qtySampled);
    const qtyPassed = parseQty(item.qtyPassed);
    const qtyFailed = parseQty(item.qtyFailed);

    if (!existing) {
      grouped.set(key, {
        ...item,
        id: Number(item.id),
        dyeLotNo: item.dyeLotNo ?? null,
        hasDyeLot: Boolean(item.hasDyeLot),
        qtyDelivered: formatQtyInput(qtyDelivered),
        qtySampled: formatQtyInput(qtySampled),
        qtyPassed: formatQtyInput(qtyPassed),
        qtyFailed: formatQtyInput(qtyFailed),
        sourceItemIds: [Number(item.id)],
        sourceDeliveredQtys: [String(item.qtyDelivered ?? '0')],
      });
      continue;
    }

    existing.qtyDelivered = formatQtyInput(parseQty(existing.qtyDelivered) + qtyDelivered);
    existing.qtySampled = formatQtyInput(parseQty(existing.qtySampled) + qtySampled);
    existing.qtyPassed = formatQtyInput(parseQty(existing.qtyPassed) + qtyPassed);
    existing.qtyFailed = formatQtyInput(parseQty(existing.qtyFailed) + qtyFailed);
    existing.sourceItemIds.push(Number(item.id));
    existing.sourceDeliveredQtys.push(String(item.qtyDelivered ?? '0'));

    if (existing.result !== item.result) {
      existing.result = null;
    }
    if (existing.disposition !== item.disposition) {
      existing.disposition = null;
    }
    if (String(existing.notes ?? '') !== String(item.notes ?? '')) {
      existing.notes = existing.notes || item.notes || null;
    }
  }

  return Array.from(grouped.values());
}

function distributeAcrossSourceRows(
  total: number,
  capacities: number[],
): string[] {
  const allocations = capacities.map(() => 0);
  let remaining = total;

  for (let index = 0; index < capacities.length; index += 1) {
    if (remaining <= 0) break;
    const allocation = Math.min(capacities[index], remaining);
    allocations[index] = allocation;
    remaining -= allocation;
  }

  return allocations.map((value) => formatQtyInput(value));
}

function distributePassedFailedAcrossSourceRows(
  totalPassed: number,
  totalFailed: number,
  capacities: number[],
): Array<{ qtyPassed: string; qtyFailed: string }> {
  const remainingCapacity = [...capacities];
  const passed = capacities.map(() => 0);
  const failed = capacities.map(() => 0);
  let remainingPassed = totalPassed;
  let remainingFailed = totalFailed;

  for (let index = 0; index < remainingCapacity.length; index += 1) {
    if (remainingPassed <= 0) break;
    const allocation = Math.min(remainingCapacity[index], remainingPassed);
    passed[index] = allocation;
    remainingCapacity[index] -= allocation;
    remainingPassed -= allocation;
  }

  for (let index = 0; index < remainingCapacity.length; index += 1) {
    if (remainingFailed <= 0) break;
    const allocation = Math.min(remainingCapacity[index], remainingFailed);
    failed[index] = allocation;
    remainingCapacity[index] -= allocation;
    remainingFailed -= allocation;
  }

  return capacities.map((_, index) => ({
    qtyPassed: formatQtyInput(passed[index]),
    qtyFailed: formatQtyInput(failed[index]),
  }));
}

function getReceiptDispositionInsight(
  items: Array<Pick<EditableInspectionItem, 'qtyDelivered' | 'qtySampled' | 'qtyPassed' | 'disposition' | 'dyeLotSegments'>>,
): ReceiptDispositionInsight {
  const inspectionUnits = items.flatMap((item) => (
    item.dyeLotSegments && item.dyeLotSegments.length > 0
      ? item.dyeLotSegments.map((segment) => ({
          qtyDelivered: segment.qtyDelivered,
          qtySampled: segment.qtySampled,
          qtyPassed: segment.qtyPassed,
          disposition: segment.disposition,
        }))
      : [{
          qtyDelivered: item.qtyDelivered,
          qtySampled: item.qtySampled,
          qtyPassed: item.qtyPassed,
          disposition: item.disposition,
        }]
  ));

  return inspectionUnits.reduce<ReceiptDispositionInsight>((summary, item) => {
    const deliveredQty = parseQty(item.qtyDelivered);
    const sampledQty = parseQty(item.qtySampled);
    const passedQty = parseQty(item.qtyPassed);
    const isSampleInspection = sampledQty > 0 && sampledQty < deliveredQty;
    const qualifiesForAcceptedReceipt = isSampleInspection && item.disposition === 'accept' && passedQty > 0;

    if (!qualifiesForAcceptedReceipt) {
      return summary;
    }

    return {
      hasAcceptedSampleReceipt: true,
      acceptedReceiptQty: summary.acceptedReceiptQty + passedQty,
      pendingReturnQty: summary.pendingReturnQty + Math.max(deliveredQty - passedQty, 0),
      affectedItemCount: summary.affectedItemCount + 1,
    };
  }, {
    hasAcceptedSampleReceipt: false,
    acceptedReceiptQty: 0,
    pendingReturnQty: 0,
    affectedItemCount: 0,
  });
}

function buildEditableInspectionItems(items: IncomingInspectionItem[]): EditableInspectionItem[] {
  const normalItems = items.filter((item) => !item.hasDyeLot);
  const dyeItems = items.filter((item) => Boolean(item.hasDyeLot));
  const editableItems: EditableInspectionItem[] = aggregateInspectionItems(normalItems).map((item) => ({
    id: item.id,
    sourceItemIds: item.sourceItemIds,
    sourceDeliveredQtys: item.sourceDeliveredQtys,
    skuCode: item.skuCode,
    skuName: item.skuName,
    dyeLotNo: item.dyeLotNo ?? null,
    hasDyeLot: Boolean(item.hasDyeLot),
    qtyDelivered: String(item.qtyDelivered ?? '0'),
    qtySampled: String(item.qtySampled ?? '0'),
    qtyPassed: String(item.qtyPassed ?? '0'),
    qtyFailed: String(item.qtyFailed ?? '0'),
    result: (item.result ?? '') as EditableInspectionItem['result'],
    disposition: (item.disposition ?? 'accept') as EditableInspectionItem['disposition'],
    notes: String(item.notes ?? ''),
  }));

  const dyeGrouped = new Map<string, EditableInspectionItem>();
  for (const item of dyeItems) {
    const groupKey = `${item.skuId ?? ''}::${item.skuCode ?? ''}::${item.skuName ?? ''}`;
    const existing = dyeGrouped.get(groupKey);
    const sourceId = Number(item.id);
    const deliveredQty = formatQtyInput(parseQty(item.qtyDelivered));

    if (!existing) {
      const segment: EditableInspectionDyeLotSegment = {
        segmentKey: createDyeLotSegmentKey(),
        sourceItemIds: [sourceId],
        sourceDeliveredQtys: [String(item.qtyDelivered ?? '0')],
        dyeLotNo: String(item.dyeLotNo ?? ''),
        qtyDelivered: deliveredQty,
        qtySampled: formatQtyInput(parseQty(item.qtySampled)),
        qtyPassed: formatQtyInput(parseQty(item.qtyPassed)),
        qtyFailed: formatQtyInput(parseQty(item.qtyFailed)),
        result: (item.result ?? '') as EditableInspectionDyeLotSegment['result'],
        disposition: (item.disposition ?? 'accept') as EditableInspectionDyeLotSegment['disposition'],
        notes: String(item.notes ?? ''),
      };
      dyeGrouped.set(groupKey, {
        id: sourceId,
        sourceItemIds: [sourceId],
        sourceDeliveredQtys: [String(item.qtyDelivered ?? '0')],
        skuCode: item.skuCode,
        skuName: item.skuName,
        dyeLotNo: null,
        hasDyeLot: true,
        qtyDelivered: deliveredQty,
        qtySampled: segment.qtySampled,
        qtyPassed: segment.qtyPassed,
        qtyFailed: segment.qtyFailed,
        result: '',
        disposition: 'accept',
        notes: '',
        dyeLotSegments: [segment],
      });
      continue;
    }

    existing.sourceItemIds.push(sourceId);
    existing.sourceDeliveredQtys.push(String(item.qtyDelivered ?? '0'));
    existing.qtyDelivered = formatQtyInput(parseQty(existing.qtyDelivered) + parseQty(item.qtyDelivered));
    existing.qtySampled = formatQtyInput(parseQty(existing.qtySampled) + parseQty(item.qtySampled));
    existing.qtyPassed = formatQtyInput(parseQty(existing.qtyPassed) + parseQty(item.qtyPassed));
    existing.qtyFailed = formatQtyInput(parseQty(existing.qtyFailed) + parseQty(item.qtyFailed));

    const normalizedDyeLot = String(item.dyeLotNo ?? '').trim();
    const existingSegment = existing.dyeLotSegments?.find((segment) => segment.dyeLotNo.trim() === normalizedDyeLot);
    if (existingSegment) {
      existingSegment.sourceItemIds.push(sourceId);
      existingSegment.sourceDeliveredQtys.push(String(item.qtyDelivered ?? '0'));
      existingSegment.qtyDelivered = formatQtyInput(parseQty(existingSegment.qtyDelivered) + parseQty(item.qtyDelivered));
      existingSegment.qtySampled = formatQtyInput(parseQty(existingSegment.qtySampled) + parseQty(item.qtySampled));
      existingSegment.qtyPassed = formatQtyInput(parseQty(existingSegment.qtyPassed) + parseQty(item.qtyPassed));
      existingSegment.qtyFailed = formatQtyInput(parseQty(existingSegment.qtyFailed) + parseQty(item.qtyFailed));
      if (existingSegment.result !== (item.result ?? '')) {
        existingSegment.result = '';
      }
      if (existingSegment.disposition !== (item.disposition ?? 'accept')) {
        existingSegment.disposition = 'accept';
      }
      if (existingSegment.notes !== String(item.notes ?? '')) {
        existingSegment.notes = existingSegment.notes || String(item.notes ?? '');
      }
      continue;
    }

    existing.dyeLotSegments?.push({
      segmentKey: createDyeLotSegmentKey(),
      sourceItemIds: [sourceId],
      sourceDeliveredQtys: [String(item.qtyDelivered ?? '0')],
      dyeLotNo: normalizedDyeLot,
      qtyDelivered: deliveredQty,
      qtySampled: formatQtyInput(parseQty(item.qtySampled)),
      qtyPassed: formatQtyInput(parseQty(item.qtyPassed)),
      qtyFailed: formatQtyInput(parseQty(item.qtyFailed)),
      result: (item.result ?? '') as EditableInspectionDyeLotSegment['result'],
      disposition: (item.disposition ?? 'accept') as EditableInspectionDyeLotSegment['disposition'],
      notes: String(item.notes ?? ''),
    });
  }

  return [...editableItems, ...Array.from(dyeGrouped.values())];
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function IncomingInspectionPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { setPageTitle, showToast } = useAppStore();

  // Filter state
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Create modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(DEFAULT_CREATE_FORM);

  // Submit conclusion state
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitForm, setSubmitForm] = useState<SubmitForm>({
    overallResult: '',
    warehouseId: '',
    locationId: '',
    notes: '',
  });

  const clearCreateQuery = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('create');
    next.delete('poId');
    next.delete('deliveryNoteId');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    setPageTitle('来料质检');
  }, [setPageTitle]);

  useEffect(() => {
    const create = searchParams.get('create');
    const poId = searchParams.get('poId');
    const deliveryNoteId = searchParams.get('deliveryNoteId');
    if (create === '1') {
      setCreateForm((prev) => ({
        ...prev,
        poId: poId ?? prev.poId,
        deliveryNoteId: deliveryNoteId ?? prev.deliveryNoteId,
      }));
      setCreateOpen(true);
    }
  }, [searchParams]);

  // API hooks
  const listParams = {
    status: statusFilter || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    pageSize: 10,
  };

  const { data, isLoading, error } = useInspectionList(listParams);
  const { data: detailData, isLoading: detailLoading } = useInspectionDetail(selectedId);
  const createFromDelivery = searchParams.get('create') === '1';
  const createPoId = createFromDelivery ? Number(createForm.poId) || null : null;
  const createDeliveryNoteId = createFromDelivery ? Number(createForm.deliveryNoteId) || null : null;
  const { data: createOrder } = usePurchaseOrderDetail(createOpen ? createPoId : null);
  const { data: createDelivery } = usePurchaseDeliveryDetail(createOpen ? createDeliveryNoteId : null);
  const purchaseOrderListQuery = useQuery({
    queryKey: ['incoming-inspection', 'create-po-options'],
    enabled: createOpen && !createFromDelivery,
    staleTime: 5 * 60 * 1000,
    queryFn: () => purchaseApi.getOrders({ page: 1, pageSize: 200 }),
  });
  const selectedCreatePoId = useMemo(() => {
    const poInput = createForm.poId.trim();
    if (!poInput) return null;
    const fallbackPoId = Number(poInput);
    if (Number.isInteger(fallbackPoId) && !poInput.includes('-')) {
      return fallbackPoId;
    }
    const matchedOrder = (purchaseOrderListQuery.data?.list ?? []).find(
      (order) => normalizeBusinessNo(order.poNo) === normalizeBusinessNo(poInput),
    );
    return matchedOrder ? Number(matchedOrder.id) || null : null;
  }, [createForm.poId, purchaseOrderListQuery.data?.list]);
  const purchaseDeliveryListQuery = useQuery({
    queryKey: ['incoming-inspection', 'create-delivery-options', selectedCreatePoId],
    enabled: createOpen && !createFromDelivery && selectedCreatePoId !== null && selectedCreatePoId > 0,
    staleTime: 2 * 60 * 1000,
    queryFn: () => purchaseApi.getDeliveries({ poId: selectedCreatePoId ?? undefined, page: 1, pageSize: 200 }),
  });
  const createMutation = useCreateInspection();
  const updateItemsMutation = useUpdateInspectionItems();
  const submitMutation = useSubmitInspection();
  const { data: warehouseOptions = [] } = useWarehouseOptions(true);
  const { data: locationOptions = [] } = useLocationOptions(
    submitForm.warehouseId === '' ? undefined : Number(submitForm.warehouseId),
    true,
  );
  const [editableItems, setEditableItems] = useState<EditableInspectionItem[]>([]);

  const allRows: InspectionRow[] = (data?.list ?? []) as InspectionRow[];

  const currentRecord = detailData ?? allRows.find((r) => r.id === selectedId);
  const { data: previewReceiptData } = useInspectionPreviewReceipt(
    selectedId,
    Boolean(selectedId && currentRecord?.receiptTriggered),
  );

  const filteredRows = keyword.trim()
    ? allRows.filter((r) => {
        const kw = keyword.toLowerCase();
        return (
          r.inspectionNo?.toLowerCase().includes(kw) ||
          r.poNo?.toLowerCase().includes(kw) ||
          r.supplierName?.toLowerCase().includes(kw)
        );
      })
    : allRows;

  // Stats
  const statsAll = allRows.length;
  const statsPending = allRows.filter((r) => r.status === 'draft' || r.status === 'in_progress').length;
  const statsPassed = allRows.filter((r) => r.status === 'passed').length;
  const statsFailed = allRows.filter((r) => r.status === 'failed' || r.status === 'partially_passed').length;

  // Detail items
  const detailItems: IncomingInspectionItem[] = detailData?.items ?? EMPTY_INSPECTION_ITEMS;
  const aggregatedDetailItems = useMemo(
    () => aggregateInspectionItems(detailItems),
    [detailItems],
  );
  const editableReceiptInsight = useMemo(
    () => getReceiptDispositionInsight(editableItems),
    [editableItems],
  );
  const detailReceiptInsight = useMemo(
    () => getReceiptDispositionInsight(
      aggregatedDetailItems.map((item) => ({
        qtyDelivered: String(item.qtyDelivered ?? '0'),
        qtySampled: String(item.qtySampled ?? '0'),
        qtyPassed: String(item.qtyPassed ?? '0'),
        disposition: (item.disposition ?? 'accept') as EditableInspectionItem['disposition'],
      })),
    ),
    [aggregatedDetailItems],
  );
  const showFailedReceiptNotice = Boolean(
    currentRecord
    && currentRecord.status === 'failed'
    && detailReceiptInsight.hasAcceptedSampleReceipt,
  );
  const showSubmitFailedReceiptNotice = submitForm.overallResult === 'fail'
    && editableReceiptInsight.hasAcceptedSampleReceipt;

  useEffect(() => {
    if (!submitOpen || warehouseOptions.length === 0 || submitForm.warehouseId !== '') return;
    setSubmitForm((prev) => ({
      ...prev,
      warehouseId: Number(warehouseOptions[0].id),
      locationId: '',
    }));
  }, [submitOpen, warehouseOptions, submitForm.warehouseId]);

  useEffect(() => {
    if (!submitOpen || submitForm.warehouseId === '') return;
    setSubmitForm((prev) => ({ ...prev, locationId: '' }));
  }, [submitForm.warehouseId, submitOpen]);

  useEffect(() => {
    if (!submitOpen || locationOptions.length === 0 || submitForm.locationId !== '') return;
    setSubmitForm((prev) => ({
      ...prev,
      locationId: Number(locationOptions[0].id),
    }));
  }, [submitOpen, locationOptions, submitForm.locationId]);

  useEffect(() => {
    setEditableItems(buildEditableInspectionItems(detailItems));
  }, [detailItems, selectedId, drawerOpen]);

  const purchaseOrderOptions = useMemo(() => {
    const keywordValue = normalizeBusinessNo(createForm.poId);
    const baseList = purchaseOrderListQuery.data?.list ?? [];
    const matched = keywordValue
      ? baseList.filter((order) => (
          normalizeBusinessNo(order.poNo).includes(keywordValue)
          || normalizeBusinessNo(String(order.supplierName ?? '')).includes(keywordValue)
        ))
      : baseList;
    return matched.slice(0, 80);
  }, [createForm.poId, purchaseOrderListQuery.data?.list]);

  const purchaseDeliveryOptions = useMemo(() => {
    const keywordValue = normalizeBusinessNo(createForm.deliveryNoteId);
    const baseList = purchaseDeliveryListQuery.data?.list ?? [];
    const matched = keywordValue
      ? baseList.filter((delivery) => normalizeBusinessNo(delivery.deliveryNo).includes(keywordValue))
      : baseList;
    return matched.slice(0, 120);
  }, [createForm.deliveryNoteId, purchaseDeliveryListQuery.data?.list]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const openDrawer = useCallback((id: number) => {
    setSelectedId(id);
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setSelectedId(null);
  }, []);

  const handleCreate = async () => {
    if (!createForm.poId || !createForm.inspectorId || !createForm.inspectionDate) {
      showToast({ type: 'warning', message: '请填写必填字段' });
      return;
    }
    if (!createForm.deliveryNoteId.trim()) {
      showToast({ type: 'warning', message: '请填写或选择送货单号' });
      return;
    }
    try {
      let resolvedPoId: number | null = null;
      const poInput = createForm.poId.trim();
      if (createFromDelivery) {
        resolvedPoId = Number(poInput) || null;
      } else {
        const fallbackPoId = Number(poInput);
        if (Number.isInteger(fallbackPoId) && !poInput.includes('-')) {
          resolvedPoId = fallbackPoId;
        } else {
          const matchedOrder = (purchaseOrderListQuery.data?.list ?? []).find(
            (order) => normalizeBusinessNo(order.poNo) === normalizeBusinessNo(poInput),
          );
          if (matchedOrder) {
            resolvedPoId = Number(matchedOrder.id) || null;
          } else {
            const orders = await purchaseApi.getOrders({ page: 1, pageSize: 200 });
            const fallbackMatchedOrder = orders.list.find(
              (order) => normalizeBusinessNo(order.poNo) === normalizeBusinessNo(poInput),
            );
            resolvedPoId = fallbackMatchedOrder ? Number(fallbackMatchedOrder.id) || null : null;
          }
        }
      }

      if (!resolvedPoId) {
        showToast({ type: 'warning', message: '未找到对应的采购订单号' });
        return;
      }

      let resolvedDeliveryNoteId: number | undefined;
      const deliveryInput = createForm.deliveryNoteId.trim();
      if (createFromDelivery) {
        resolvedDeliveryNoteId = Number(deliveryInput) || undefined;
      } else {
        const fallbackDeliveryId = Number(deliveryInput);
        if (Number.isInteger(fallbackDeliveryId) && !deliveryInput.includes('-')) {
          resolvedDeliveryNoteId = fallbackDeliveryId;
        } else {
          const matchedDelivery = (purchaseDeliveryListQuery.data?.list ?? []).find(
            (delivery) =>
              normalizeBusinessNo(delivery.deliveryNo) === normalizeBusinessNo(deliveryInput),
          );
          if (matchedDelivery) {
            resolvedDeliveryNoteId = Number(matchedDelivery.id) || undefined;
          } else {
            const deliveries = await purchaseApi.getDeliveries({
              poId: resolvedPoId,
              page: 1,
              pageSize: 200,
            });
            const fallbackMatchedDelivery = deliveries.list.find(
              (delivery) =>
                normalizeBusinessNo(delivery.deliveryNo) === normalizeBusinessNo(deliveryInput),
            );
            if (!fallbackMatchedDelivery) {
              showToast({ type: 'warning', message: '未找到对应的送货单号' });
              return;
            }
            resolvedDeliveryNoteId = Number(fallbackMatchedDelivery.id) || undefined;
          }
        }
      }

      const payload: CreateInspectionPayload = {
        poId: resolvedPoId,
        deliveryNoteId: resolvedDeliveryNoteId,
        inspectorId: Number(createForm.inspectorId),
        inspectionDate: createForm.inspectionDate,
        notes: createForm.notes || undefined,
      };
      await createMutation.mutateAsync(payload);
      showToast({ type: 'success', message: '质检单创建成功' });
      setCreateOpen(false);
      setCreateForm(DEFAULT_CREATE_FORM);
      clearCreateQuery();
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleSubmitConclusion = async () => {
    if (!selectedId || !submitForm.overallResult) {
      showToast({ type: 'warning', message: '请选择质检结论' });
      return;
    }
    if (submitForm.warehouseId === '' || submitForm.locationId === '') {
      showToast({ type: 'warning', message: '请选择入库仓库和库位' });
      return;
    }
    try {
      const payload: SubmitInspectionPayload = {
        overallResult: submitForm.overallResult,
        warehouseId: Number(submitForm.warehouseId),
        locationId: Number(submitForm.locationId),
        notes: submitForm.notes || undefined,
      };
      await submitMutation.mutateAsync({ id: selectedId, data: payload });
      showToast({ type: 'success', message: '质检结论已提交' });
      setSubmitOpen(false);
      setSubmitForm({ overallResult: '', warehouseId: '', locationId: '', notes: '' });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const setEditableField = useCallback((
    id: number,
    field: keyof EditableInspectionItem,
    value: string,
  ) => {
    setEditableItems((prev) => prev.map((item) => (
      item.id === id ? { ...item, [field]: value } : item
    )));
  }, []);

  const setDyeLotSegmentField = useCallback((
    itemId: number,
    segmentKey: string,
    field: keyof EditableInspectionDyeLotSegment,
    value: string,
  ) => {
    setEditableItems((prev) => prev.map((item) => {
      if (item.id !== itemId || !item.dyeLotSegments) {
        return item;
      }
      return {
        ...item,
        dyeLotSegments: item.dyeLotSegments.map((segment) => (
          segment.segmentKey === segmentKey ? { ...segment, [field]: value } : segment
        )),
      };
    }));
  }, []);

  const addDyeLotSegment = useCallback((itemId: number) => {
    setEditableItems((prev) => prev.map((item) => {
      if (item.id !== itemId || !item.hasDyeLot) return item;
      const nextSegments = [...(item.dyeLotSegments ?? [])];
      nextSegments.push({
        segmentKey: createDyeLotSegmentKey(),
        sourceItemIds: [...item.sourceItemIds],
        sourceDeliveredQtys: [...item.sourceDeliveredQtys],
        dyeLotNo: '',
        qtyDelivered: '0.0000',
        qtySampled: '0.0000',
        qtyPassed: '0.0000',
        qtyFailed: '0.0000',
        result: '',
        disposition: 'accept',
        notes: '',
      });
      return {
        ...item,
        dyeLotSegments: nextSegments,
      };
    }));
  }, []);

  const removeDyeLotSegment = useCallback((itemId: number, segmentKey: string) => {
    setEditableItems((prev) => prev.map((item) => {
      if (item.id !== itemId || !item.dyeLotSegments || item.dyeLotSegments.length <= 1) {
        return item;
      }
      return {
        ...item,
        dyeLotSegments: item.dyeLotSegments.filter((segment) => segment.segmentKey !== segmentKey),
      };
    }));
  }, []);

  const handleSaveItems = async () => {
    if (!selectedId) return;
    if (!editableItems.length) {
      showToast({ type: 'warning', message: '暂无可保存的质检明细' });
      return;
    }

    const incompleteItem = editableItems.find((item) => (
      item.hasDyeLot
        ? item.dyeLotSegments?.some((segment) => !segment.result || !segment.disposition)
        : !item.result || !item.disposition
    ));
    if (incompleteItem) {
      showToast({ type: 'warning', message: '请先为每条质检明细选择结果和处置方式' });
      return;
    }

    const missingDyeLotItem = editableItems.find((item) => (
      item.hasDyeLot
        ? item.dyeLotSegments?.some((segment) => !String(segment.dyeLotNo ?? '').trim())
        : item.hasDyeLot && !String(item.dyeLotNo ?? '').trim()
    ));
    if (missingDyeLotItem) {
      showToast({
        type: 'warning',
        message: `请先登记 ${missingDyeLotItem.skuCode ?? missingDyeLotItem.skuName ?? '该物料'} 的缸号`,
      });
      return;
    }

    const invalidDyeLotSplitItem = editableItems.find(
      (item) => item.hasDyeLot && item.dyeLotSegments && (
        item.dyeLotSegments.some((segment) => parseQty(segment.qtyDelivered) <= 0)
        || Math.abs(
          item.dyeLotSegments.reduce((sum, segment) => sum + parseQty(segment.qtyDelivered), 0)
          - parseQty(item.qtyDelivered),
        ) > 0.0001
      ),
    );
    if (invalidDyeLotSplitItem) {
      showToast({
        type: 'warning',
        message: `${invalidDyeLotSplitItem.skuCode ?? invalidDyeLotSplitItem.skuName ?? '该物料'} 的缸号分段到货数量必须大于 0，且合计等于该 SKU 的总到货数量`,
      });
      return;
    }

    try {
      const payloadItems: UpdateInspectionItemsPayload['items'] = editableItems.flatMap<UpdateInspectionItemsPayload['items'][number]>((item) => {
        if (item.hasDyeLot && item.dyeLotSegments?.length) {
          return item.dyeLotSegments.map((segment) => ({
            sourceItemIds: item.sourceItemIds,
            qtyDelivered: segment.qtyDelivered || '0',
            qtysampled: segment.qtySampled || '0',
            qtyPassed: segment.qtyPassed || '0',
            qtyFailed: segment.qtyFailed || '0',
            dyeLotNo: segment.dyeLotNo.trim() || undefined,
            result: segment.result as 'pass' | 'fail' | 'conditional_pass',
            disposition: segment.disposition,
            notes: segment.notes.trim() || undefined,
          }));
        }

        const sourceCapacities = item.sourceDeliveredQtys.map((qty) => parseQty(qty));
        const normalizedDyeLotNo = String(item.dyeLotNo ?? '').trim();

        if (item.sourceItemIds.length <= 1) {
          return [{
            id: item.id,
            sourceItemIds: item.sourceItemIds,
            qtyDelivered: item.qtyDelivered || '0',
            qtysampled: item.qtySampled || '0',
            qtyPassed: item.qtyPassed || '0',
            qtyFailed: item.qtyFailed || '0',
            dyeLotNo: normalizedDyeLotNo || undefined,
            result: item.result as 'pass' | 'fail' | 'conditional_pass',
            disposition: item.disposition,
            notes: item.notes.trim() || undefined,
          }];
        }

        const sampledAllocations = distributeAcrossSourceRows(parseQty(item.qtySampled), sourceCapacities);
        const passFailAllocations = distributePassedFailedAcrossSourceRows(
          parseQty(item.qtyPassed),
          parseQty(item.qtyFailed),
          sourceCapacities,
        );

        return item.sourceItemIds.map((sourceId, index) => ({
          id: sourceId,
          sourceItemIds: [sourceId],
          qtyDelivered: String(item.sourceDeliveredQtys[index] ?? '0'),
          qtysampled: sampledAllocations[index],
          qtyPassed: passFailAllocations[index].qtyPassed,
          qtyFailed: passFailAllocations[index].qtyFailed,
          dyeLotNo: normalizedDyeLotNo || undefined,
          result: item.result as 'pass' | 'fail' | 'conditional_pass',
          disposition: item.disposition,
          notes: item.notes.trim() || undefined,
        }));
      });

      await updateItemsMutation.mutateAsync({
        id: selectedId,
        data: {
          items: payloadItems,
        },
      });
      showToast({ type: 'success', message: '质检明细已保存' });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  // ── Table columns ──────────────────────────────────────────────────────────

  const columns: Column<InspectionRow>[] = [
    {
      key: 'inspectionNo',
      title: '质检单号',
      width: 140,
      render: (_, r) => (
        <span className={styles.mono_code}>{r.inspectionNo as string}</span>
      ),
    },
    {
      key: 'poNo',
      title: '采购订单号',
      width: 140,
      render: (_, r) => (
        <span className={styles.mono_code}>{(r.poNo as string) ?? '—'}</span>
      ),
    },
    {
      key: 'supplierName',
      title: '供应商',
      render: (_, r) => <span>{(r.supplierName as string) ?? '—'}</span>,
    },
    {
      key: 'inspectionDate',
      title: '质检日期',
      width: 120,
      render: (_, r) => formatDate(r.inspectionDate as string),
    },
    {
      key: 'status',
      title: '状态',
      width: 110,
      render: (_, r) => (
        <span className={`${styles.status_badge} ${getStatusClass(r.status as string)}`}>
          {STATUS_LABEL[r.status as string] ?? r.status}
        </span>
      ),
    },
    {
      key: 'overallResult',
      title: '质检结果',
      width: 120,
      render: (_, r) => {
        const result = r.overallResult as string | null;
        if (!result) return <span className={styles.text_muted}>—</span>;
        return (
          <span className={`${styles.result_badge} ${getResultClass(result)}`}>
            {RESULT_LABEL[result] ?? result}
          </span>
        );
      },
    },
    {
      key: 'actions',
      title: '操作',
      width: 100,
      render: (_, r) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => openDrawer(r.id as number)}
        >
          查看详情
        </Button>
      ),
    },
  ];

  // ── Item table columns (inside drawer) ────────────────────────────────────

  type ItemRow = IncomingInspectionItem & Record<string, unknown>;

  const itemColumns: Column<ItemRow>[] = [
    {
      key: 'skuCode',
      title: 'SKU编码',
      width: 140,
      render: (_, r) => (
        <span className={styles.mono_code}>{(r.skuCode as string) ?? '—'}</span>
      ),
    },
    {
      key: 'skuName',
      title: '物料名称',
      width: 180,
      render: (_, r) => <span>{(r.skuName as string) ?? '—'}</span>,
    },
    {
      key: 'dyeLotNo',
      title: '缸号',
      width: 140,
      render: (_, r) => {
        const value = r.dyeLotNo as string | null | undefined;
        return value ? <span className={styles.mono_code}>{value}</span> : <span className={styles.text_muted}>—</span>;
      },
    },
    {
      key: 'qtyDelivered',
      title: '到货数量',
      width: 96,
      align: 'right',
      render: (_, r) => String(r.qtyDelivered),
    },
    {
      key: 'qtySampled',
      title: '抽检数量',
      width: 96,
      align: 'right',
      render: (_, r) => String(r.qtySampled),
    },
    {
      key: 'qtyPassed',
      title: '合格数量',
      width: 96,
      align: 'right',
      render: (_, r) => (
        <span className={styles.text_success}>{String(r.qtyPassed)}</span>
      ),
    },
    {
      key: 'qtyFailed',
      title: '不合格数量',
      width: 104,
      align: 'right',
      render: (_, r) => (
        <span className={r.qtyFailed !== '0' ? styles.text_danger : ''}>
          {String(r.qtyFailed)}
        </span>
      ),
    },
    {
      key: 'result',
      title: '单项结果',
      width: 128,
      render: (_, r) => {
        const result = r.result as string | null;
        if (!result) return <span className={styles.text_muted}>—</span>;
        return (
          <span className={`${styles.result_badge} ${getResultClass(result)}`}>
            {RESULT_LABEL[result] ?? result}
          </span>
        );
      },
    },
    {
      key: 'disposition',
      title: '处置方式',
      width: 104,
      render: (_, r) => {
        const disposition = r.disposition as string | null;
        if (!disposition) return <span className={styles.text_muted}>—</span>;
        return <span>{DISPOSITION_LABEL[disposition] ?? disposition}</span>;
      },
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className={styles.page}>

        {/* ── Page Header ──────────────────────────────────────── */}
        <div className={styles.page_header}>
          <h1 className={styles.page_title}>来料质检</h1>
          <Button variant="primary" size="md" onClick={() => setCreateOpen(true)}>
            + 新建质检单
          </Button>
        </div>

        {/* ── Stats Cards ───────────────────────────────────────── */}
        <div className={styles.stats_grid} role="region" aria-label="质检统计">
          <div className={styles.stat_card}>
            <div className={styles.stat_card__label}>全部质检单</div>
            <div className={`${styles.stat_card__value} ${styles['stat_card__value--all']}`}>
              {statsAll}
            </div>
          </div>
          <div className={styles.stat_card}>
            <div className={styles.stat_card__label}>待检 / 质检中</div>
            <div className={`${styles.stat_card__value} ${styles['stat_card__value--pending']}`}>
              {statsPending}
            </div>
          </div>
          <div className={styles.stat_card}>
            <div className={styles.stat_card__label}>合格</div>
            <div className={`${styles.stat_card__value} ${styles['stat_card__value--passed']}`}>
              {statsPassed}
            </div>
          </div>
          <div className={styles.stat_card}>
            <div className={styles.stat_card__label}>不合格 / 部分合格</div>
            <div className={`${styles.stat_card__value} ${styles['stat_card__value--failed']}`}>
              {statsFailed}
            </div>
          </div>
        </div>

        <section className={styles.workbench_notice} aria-label="质检处理规则">
          <div className={styles.workbench_notice__main}>
            <span className={styles.workbench_notice__eyebrow}>QUALITY DECISION</span>
            <h2 className={styles.workbench_notice__title}>抽检与退货处理规则</h2>
            <p className={styles.workbench_notice__text}>
              来料质检支持全检和抽检。全检通过并选择“接受”时，系统按来料数量入库；抽检时，“合格数量”代表本次确认入库数量。
            </p>
          </div>
          <div className={styles.rule_cards}>
            <article className={styles.rule_card}>
              <span className={styles.rule_card__tag}>全检通过</span>
              <strong className={styles.rule_card__title}>整批按来料数量入库</strong>
              <p className={styles.rule_card__text}>单项结果为“通过”且处置方式为“接受”时，系统按整批来料数量生成入库。</p>
            </article>
            <article className={`${styles.rule_card} ${styles.rule_card__warning}`}>
              <span className={styles.rule_card__tag}>抽检不通过</span>
              <strong className={styles.rule_card__title}>仅合格数量入库，其余执行退货</strong>
              <p className={styles.rule_card__text}>若抽检后仍有部分合格并选择“接受”，系统只会入库合格数量，其余未入库数据需继续走退货处理。</p>
            </article>
          </div>
        </section>

        {/* ── Filter Bar ────────────────────────────────────────── */}
        <div className={styles.filter_bar} role="toolbar" aria-label="筛选工具栏">
          <div className={styles.filter_group}>
            <label htmlFor="statusFilter" className={styles.filter_label}>状态</label>
            <select
              id="statusFilter"
              className={styles.filter_select}
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(1); }}
            >
              <option value="">全部状态</option>
              <option value="draft">草稿</option>
              <option value="in_progress">质检中</option>
              <option value="passed">合格</option>
              <option value="partially_passed">部分合格</option>
              <option value="failed">不合格</option>
            </select>
          </div>

          <div className={styles.filter_group}>
            <label htmlFor="dateFrom" className={styles.filter_label}>开始日期</label>
            <input
              id="dateFrom"
              type="date"
              className={styles.filter_input}
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            />
          </div>

          <div className={styles.filter_group}>
            <label htmlFor="dateTo" className={styles.filter_label}>结束日期</label>
            <input
              id="dateTo"
              type="date"
              className={styles.filter_input}
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            />
          </div>

          <div className={`${styles.filter_group} ${styles.filter_group_grow}`}>
            <label htmlFor="keyword" className={styles.filter_label}>关键词</label>
            <input
              id="keyword"
              type="search"
              className={styles.filter_input}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="质检单号 / 采购单号 / 供应商"
            />
          </div>

          {(statusFilter || dateFrom || dateTo || keyword) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatusFilter('');
                setDateFrom('');
                setDateTo('');
                setKeyword('');
                setPage(1);
              }}
            >
              清除筛选
            </Button>
          )}
        </div>

        {/* ── Table ─────────────────────────────────────────────── */}
        <div className={styles.table_card}>
          <Table<InspectionRow>
            columns={columns}
            dataSource={filteredRows}
            rowKey="id"
            loading={isLoading}
            error={error ? (error as Error).message : null}
            emptyText="暂无质检单数据"
            pagination={
              data
                ? { page, pageSize: 10, total: data.total, onChange: setPage }
                : undefined
            }
          />
        </div>
      </div>

      {/* ================================================================
          Detail Drawer
      ================================================================ */}
      <Drawer
        open={drawerOpen}
        title={`质检单详情 — ${currentRecord?.inspectionNo ?? '...'}`}
        onClose={closeDrawer}
        width={860}
        footer={
          currentRecord?.status === 'in_progress' || currentRecord?.status === 'draft' ? (
            <div className={styles.drawer_footer_actions}>
              <Button variant="ghost" size="md" onClick={closeDrawer}>
                关闭
              </Button>
              {currentRecord?.deliveryNoteId ? (
                <Button
                  variant="text"
                  size="md"
                  onClick={() => navigate(`/purchase/deliveries?deliveryId=${currentRecord.deliveryNoteId}&poId=${currentRecord.poId}`)}
                >
                  查看送货单
                </Button>
              ) : null}
              {previewReceiptData?.receiptId ? (
                <Button
                  variant="text"
                  size="md"
                  onClick={() => navigate(`/purchase/receipts?receiptId=${previewReceiptData.receiptId}&poId=${currentRecord?.poId ?? ''}`)}
                >
                  查看入库单
                </Button>
              ) : null}
              <Button
                variant="primary"
                size="md"
                loading={updateItemsMutation.isPending}
                onClick={() => void handleSaveItems()}
              >
                保存质检明细
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => setSubmitOpen(true)}
              >
                提交质检结论
              </Button>
            </div>
          ) : (
            <div className={styles.drawer_footer_actions}>
              {currentRecord?.deliveryNoteId ? (
                <Button
                  variant="text"
                  size="md"
                  onClick={() => navigate(`/purchase/deliveries?deliveryId=${currentRecord.deliveryNoteId}&poId=${currentRecord.poId}`)}
                >
                  查看送货单
                </Button>
              ) : null}
              {previewReceiptData?.receiptId ? (
                <Button
                  variant="text"
                  size="md"
                  onClick={() => navigate(`/purchase/receipts?receiptId=${previewReceiptData.receiptId}&poId=${currentRecord?.poId ?? ''}`)}
                >
                  查看入库单
                </Button>
              ) : null}
              {previewReceiptData?.receiptId && currentRecord?.poId ? (
                <Button
                  variant="text"
                  size="md"
                  onClick={() => navigate(`/purchase/match?poId=${currentRecord.poId}&receiptId=${previewReceiptData.receiptId}`)}
                >
                  查看三单匹配
                </Button>
              ) : null}
              <Button variant="ghost" size="md" onClick={closeDrawer}>
                关闭
              </Button>
            </div>
          )
        }
      >
        {detailLoading ? (
          <div className={styles.drawer_loading}>加载中...</div>
        ) : currentRecord ? (
          <div className={styles.drawer_content}>
            {/* Basic info section */}
            <section className={styles.detail_section}>
              <h3 className={styles.detail_section_title}>基本信息</h3>
              <div className={styles.detail_grid}>
                <div className={styles.detail_kv}>
                  <span className={styles.detail_key}>质检单号</span>
                  <span className={`${styles.detail_val} ${styles.mono_code}`}>
                    {currentRecord.inspectionNo as string}
                  </span>
                </div>
                <div className={styles.detail_kv}>
                  <span className={styles.detail_key}>采购订单</span>
                  <span className={`${styles.detail_val} ${styles.mono_code}`}>
                    {(currentRecord.poNo as string) ?? '—'}
                  </span>
                </div>
                <div className={styles.detail_kv}>
                  <span className={styles.detail_key}>供应商</span>
                  <span className={styles.detail_val}>
                    {(currentRecord.supplierName as string) ?? '—'}
                  </span>
                </div>
                <div className={styles.detail_kv}>
                  <span className={styles.detail_key}>质检日期</span>
                  <span className={styles.detail_val}>
                    {formatDate(currentRecord.inspectionDate as string)}
                  </span>
                </div>
                <div className={styles.detail_kv}>
                  <span className={styles.detail_key}>状态</span>
                  <span className={`${styles.status_badge} ${getStatusClass(currentRecord.status as string)}`}>
                    {STATUS_LABEL[currentRecord.status as string]}
                  </span>
                </div>
                <div className={styles.detail_kv}>
                  <span className={styles.detail_key}>质检结论</span>
                  {currentRecord.overallResult ? (
                    <span className={`${styles.result_badge} ${getResultClass(currentRecord.overallResult as string)}`}>
                      {RESULT_LABEL[currentRecord.overallResult as string]}
                    </span>
                  ) : (
                    <span className={styles.text_muted}>—</span>
                  )}
                </div>
                <div className={styles.detail_kv}>
                  <span className={styles.detail_key}>完成时间</span>
                  <span className={styles.detail_val}>
                    {formatDateTime(currentRecord.completedAt as string | null)}
                  </span>
                </div>
                <div className={styles.detail_kv}>
                  <span className={styles.detail_key}>已触发入库</span>
                  <span className={styles.detail_val}>
                    {currentRecord.receiptTriggered ? '是' : '否'}
                  </span>
                </div>
                {previewReceiptData?.receiptNo ? (
                  <div className={styles.detail_kv}>
                    <span className={styles.detail_key}>关联入库单</span>
                    <span className={`${styles.detail_val} ${styles.mono_code}`}>
                      {previewReceiptData.receiptNo}
                    </span>
                  </div>
                ) : null}
                {currentRecord.notes && (
                  <div className={`${styles.detail_kv} ${styles.detail_kv_full}`}>
                    <span className={styles.detail_key}>备注</span>
                    <span className={styles.detail_val}>{currentRecord.notes as string}</span>
                  </div>
                )}
              </div>
            </section>

            {/* BD-004 notice for failed inspections */}
            {(currentRecord.status === 'failed') && (
              <div className={styles.rule_notice}>
                <span className={styles.rule_notice__icon} aria-hidden="true">!</span>
                <div>
                  <strong>BD-004 合规提示：</strong>
                  不合格品仅允许"退货"处置，不可选择"降级使用"。请确认处置方式符合规定。
                </div>
              </div>
            )}
            {showFailedReceiptNotice ? (
              <div className={`${styles.rule_notice} ${styles.rule_notice__warning}`}>
                <span className={styles.rule_notice__icon} aria-hidden="true">!</span>
                <div>
                  <strong>部分可入库提示：</strong>
                  当前质检单总体结论为“不通过”，但抽检项中仍有
                  {' '}
                  {formatQtyInput(detailReceiptInsight.acceptedReceiptQty)}
                  {' '}
                  可按“接受”入库。系统仅会入库这部分合格数量，其余未入库数据请继续执行退货处理。
                </div>
              </div>
            ) : null}

            {/* Items table section */}
            <section className={styles.detail_section}>
              <h3 className={styles.detail_section_title}>质检明细</h3>
              {aggregatedDetailItems.length === 0 ? (
                <p className={styles.text_muted}>暂无质检明细</p>
              ) : currentRecord.status === 'draft' || currentRecord.status === 'in_progress' ? (
                <div className={styles.editableItemList}>
                  {editableItems.map((item) => (
                    <article key={item.id} className={styles.editableItemCard}>
                      {(() => {
                        const deliveredQty = parseQty(item.qtyDelivered);
                        const sampledQty = parseQty(item.qtySampled);
                        const isFullInspection = deliveredQty > 0 && sampledQty === deliveredQty;
                        const isAcceptDisposition = item.disposition === 'accept';
                        const hasAcceptedSampleReceipt = sampledQty > 0
                          && sampledQty < deliveredQty
                          && isAcceptDisposition
                          && parseQty(item.qtyPassed) > 0;

                        return (
                          <>
                      <div className={styles.editableItemHeader}>
                        <div>
                          <div className={styles.mono_code}>{item.skuCode ?? '—'}</div>
                          <div className={styles.detail_val}>{item.skuName ?? '—'}</div>
                          {item.hasDyeLot ? (
                            <div className={styles.inlineMeta}>缸号管理物料，请按实际来料缸号拆分分段后分别录入抽检与处置结果。</div>
                          ) : null}
                        </div>
                        <div className={styles.editableItemQty}>到货数量 {item.qtyDelivered}</div>
                      </div>

                      {item.hasDyeLot && item.dyeLotSegments?.length ? (
                        <div className={styles.dyeLotSection}>
                          <div className={styles.dyeLotSectionHeader}>
                            <div className={styles.form_help}>
                              同一 SKU 可按不同缸号拆分多条来料分段。所有缸号分段的到货数量合计必须等于该 SKU 的总到货数量
                              {' '}
                              {item.qtyDelivered}
                              。
                            </div>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => addDyeLotSegment(item.id)}
                            >
                              新增缸号
                            </Button>
                          </div>
                          <div className={styles.dyeLotSegmentList}>
                            {item.dyeLotSegments.map((segment, segmentIndex) => {
                              const segmentDeliveredQty = parseQty(segment.qtyDelivered);
                              const segmentSampledQty = parseQty(segment.qtySampled);
                              const segmentPassedQty = parseQty(segment.qtyPassed);
                              const segmentIsFullInspection = segmentDeliveredQty > 0 && segmentSampledQty === segmentDeliveredQty;
                              const segmentIsAcceptDisposition = segment.disposition === 'accept';
                              const segmentHasAcceptedSampleReceipt = segmentSampledQty > 0
                                && segmentSampledQty < segmentDeliveredQty
                                && segmentIsAcceptDisposition
                                && segmentPassedQty > 0;

                              return (
                                <section key={segment.segmentKey} className={styles.dyeLotSegment}>
                                  <div className={styles.dyeLotSegmentHeader}>
                                    <div className={styles.dyeLotSegmentTitle}>
                                      缸号分段
                                      {' '}
                                      {segmentIndex + 1}
                                    </div>
                                    {item.dyeLotSegments && item.dyeLotSegments.length > 1 ? (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeDyeLotSegment(item.id, segment.segmentKey)}
                                      >
                                        删除分段
                                      </Button>
                                    ) : null}
                                  </div>
                                  <div className={styles.editableItemGrid}>
                                    <div className={`${styles.form_field} ${styles.form_field_full}`}>
                                      <label className={styles.form_label}>缸号</label>
                                      <input
                                        className={styles.form_input}
                                        value={segment.dyeLotNo}
                                        onChange={(e) => setDyeLotSegmentField(item.id, segment.segmentKey, 'dyeLotNo', e.target.value)}
                                        placeholder="请输入供应商来料缸号"
                                      />
                                      <div className={styles.form_help}>
                                        面料/皮料等缸号管理物料需在来料后按缸号拆分登记，后续入库、三单匹配和结算都会沿用这里的缸号。
                                      </div>
                                    </div>
                                    <div className={styles.form_field}>
                                      <label className={styles.form_label}>该缸到货数量</label>
                                      <input
                                        className={styles.form_input}
                                        value={segment.qtyDelivered}
                                        onChange={(e) => setDyeLotSegmentField(item.id, segment.segmentKey, 'qtyDelivered', e.target.value.replace(/[^\d.]/g, ''))}
                                      />
                                    </div>
                                    <div className={styles.form_field}>
                                      <label className={styles.form_label}>抽检数量</label>
                                      <input
                                        className={styles.form_input}
                                        value={segment.qtySampled}
                                        onChange={(e) => setDyeLotSegmentField(item.id, segment.segmentKey, 'qtySampled', e.target.value.replace(/[^\d.]/g, ''))}
                                      />
                                    </div>
                                    <div className={styles.form_field}>
                                      <label className={styles.form_label}>合格数量</label>
                                      <input
                                        className={styles.form_input}
                                        value={segment.qtyPassed}
                                        onChange={(e) => setDyeLotSegmentField(item.id, segment.segmentKey, 'qtyPassed', e.target.value.replace(/[^\d.]/g, ''))}
                                      />
                                      <div className={styles.form_help}>
                                        {segmentIsFullInspection
                                          ? '全检时，单项结果为“通过”且处置方式为“接受”，系统将按该缸来料数量入库。'
                                          : '抽检时，这里填写的是该缸本次确认入库数量；可按整缸来料或实际认可数量填写。'}
                                      </div>
                                    </div>
                                    <div className={styles.form_field}>
                                      <label className={styles.form_label}>不合格数量</label>
                                      <input
                                        className={styles.form_input}
                                        value={segment.qtyFailed}
                                        onChange={(e) => setDyeLotSegmentField(item.id, segment.segmentKey, 'qtyFailed', e.target.value.replace(/[^\d.]/g, ''))}
                                      />
                                    </div>
                                    <div className={styles.form_field}>
                                      <label className={styles.form_label}>单项结果</label>
                                      <select
                                        className={styles.form_input}
                                        value={segment.result}
                                        onChange={(e) => setDyeLotSegmentField(item.id, segment.segmentKey, 'result', e.target.value)}
                                      >
                                        <option value="">请选择</option>
                                        <option value="pass">通过</option>
                                        <option value="conditional_pass">有条件通过</option>
                                        <option value="fail">不通过</option>
                                      </select>
                                    </div>
                                    <div className={styles.form_field}>
                                      <label className={styles.form_label}>处置方式</label>
                                      <select
                                        className={styles.form_input}
                                        value={segment.disposition}
                                        onChange={(e) => setDyeLotSegmentField(item.id, segment.segmentKey, 'disposition', e.target.value)}
                                      >
                                        <option value="accept">接受</option>
                                        <option value="return">退货</option>
                                        <option value="rework">返工</option>
                                        <option value="scrap">报废</option>
                                      </select>
                                      {segmentIsAcceptDisposition ? (
                                        <div className={styles.form_help}>
                                          {segmentIsFullInspection
                                            ? '当前为接受入库，全检通过时该缸将整缸入库。'
                                            : '当前为接受入库，抽检场景请用“合格数量”明确该缸本次入库数量。'}
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>

                                  {segmentHasAcceptedSampleReceipt ? (
                                    <div className={`${styles.inline_notice} ${styles.inline_notice__warning}`}>
                                      当前缸号为抽检且处置方式为“接受”。若总体质检结论提交为“不通过”，系统仅会按该缸合格数量
                                      {' '}
                                      {segment.qtyPassed}
                                      {' '}
                                      入库，其余未入库数量需继续执行退货。
                                    </div>
                                  ) : null}

                                  <div className={styles.form_field}>
                                    <label className={styles.form_label}>备注</label>
                                    <textarea
                                      className={styles.form_textarea}
                                      rows={2}
                                      value={segment.notes}
                                      onChange={(e) => setDyeLotSegmentField(item.id, segment.segmentKey, 'notes', e.target.value)}
                                      placeholder="可填写缺陷描述、抽检说明等"
                                    />
                                  </div>
                                </section>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className={styles.editableItemGrid}>
                            <div className={styles.form_field}>
                              <label className={styles.form_label}>抽检数量</label>
                              <input
                                className={styles.form_input}
                                value={item.qtySampled}
                                onChange={(e) => setEditableField(item.id, 'qtySampled', e.target.value.replace(/[^\d.]/g, ''))}
                              />
                            </div>
                            <div className={styles.form_field}>
                              <label className={styles.form_label}>合格数量</label>
                              <input
                                className={styles.form_input}
                                value={item.qtyPassed}
                                onChange={(e) => setEditableField(item.id, 'qtyPassed', e.target.value.replace(/[^\d.]/g, ''))}
                              />
                              <div className={styles.form_help}>
                                {isFullInspection
                                  ? '全检时，单项结果为“通过”且处置方式为“接受”，系统将按来料数量入库。'
                                  : '抽检时，这里填写的是本次确认入库数量；可按整批来料或实际认可数量填写。'}
                              </div>
                            </div>
                            <div className={styles.form_field}>
                              <label className={styles.form_label}>不合格数量</label>
                              <input
                                className={styles.form_input}
                                value={item.qtyFailed}
                                onChange={(e) => setEditableField(item.id, 'qtyFailed', e.target.value.replace(/[^\d.]/g, ''))}
                              />
                            </div>
                            <div className={styles.form_field}>
                              <label className={styles.form_label}>单项结果</label>
                              <select
                                className={styles.form_input}
                                value={item.result}
                                onChange={(e) => setEditableField(item.id, 'result', e.target.value)}
                              >
                                <option value="">请选择</option>
                                <option value="pass">通过</option>
                                <option value="conditional_pass">有条件通过</option>
                                <option value="fail">不通过</option>
                              </select>
                            </div>
                            <div className={styles.form_field}>
                              <label className={styles.form_label}>处置方式</label>
                              <select
                                className={styles.form_input}
                                value={item.disposition}
                                onChange={(e) => setEditableField(item.id, 'disposition', e.target.value)}
                              >
                                <option value="accept">接受</option>
                                <option value="return">退货</option>
                                <option value="rework">返工</option>
                                <option value="scrap">报废</option>
                              </select>
                              {isAcceptDisposition ? (
                                <div className={styles.form_help}>
                                  {isFullInspection
                                    ? '当前为接受入库，全检通过时将整批入库。'
                                    : '当前为接受入库，抽检场景请用“合格数量”明确本次入库数量。'}
                                </div>
                              ) : null}
                            </div>
                          </div>

                          {hasAcceptedSampleReceipt ? (
                            <div className={`${styles.inline_notice} ${styles.inline_notice__warning}`}>
                              当前为抽检且处置方式为“接受”。若总体质检结论提交为“不通过”，系统仅会按合格数量
                              {' '}
                              {item.qtyPassed}
                              {' '}
                              入库，其余未入库数量需继续执行退货。
                            </div>
                          ) : null}

                          <div className={styles.form_field}>
                            <label className={styles.form_label}>备注</label>
                            <textarea
                              className={styles.form_textarea}
                              rows={2}
                              value={item.notes}
                              onChange={(e) => setEditableField(item.id, 'notes', e.target.value)}
                              placeholder="可填写缺陷描述、抽检说明等"
                            />
                          </div>
                        </>
                      )}
                          </>
                        );
                      })()}
                    </article>
                  ))}
                </div>
              ) : (
                <div className={styles.items_table_wrap}>
                  <Table<ItemRow>
                    columns={itemColumns}
                    dataSource={aggregatedDetailItems as ItemRow[]}
                    rowKey={(record) => String(record.id)}
                    emptyText="暂无明细数据"
                    className={styles.detailItemsTable}
                  />
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className={styles.text_muted}>暂无数据</div>
        )}
      </Drawer>

      {/* ================================================================
          Create Inspection Modal
      ================================================================ */}
      <Modal
        open={createOpen}
        title="新建来料质检单"
        onClose={() => {
          setCreateOpen(false);
          setCreateForm(DEFAULT_CREATE_FORM);
          clearCreateQuery();
        }}
        onConfirm={() => void handleCreate()}
        confirmLabel="创建"
        confirmLoading={createMutation.isPending}
        size="md"
      >
        <div className={styles.form}>
          <div className={styles.form_field}>
            <label htmlFor="create-poId" className={styles.form_label}>
              采购订单号 <span className={styles.required}>*</span>
            </label>
            {createFromDelivery && createForm.poId ? (
              <input
                id="create-poId"
                className={styles.form_input}
                value={createOrder?.poNo ?? ''}
                placeholder="系统将自动带出采购订单号"
                readOnly
              />
            ) : (
              <input
                id="create-poId"
                className={styles.form_input}
                list="incoming-inspection-po-options"
                value={createForm.poId}
                onChange={(e) => setCreateForm((f) => ({ ...f, poId: e.target.value }))}
                placeholder="请输入或选择采购订单号"
              />
            )}
            {!createFromDelivery && (
              <>
                <datalist id="incoming-inspection-po-options">
                  {purchaseOrderOptions.map((order) => (
                    <option
                      key={order.id}
                      value={order.poNo}
                      label={`${order.poNo} · ${order.supplierName ?? '未知供应商'} · ${order.status}`}
                    />
                  ))}
                </datalist>
                <div className={styles.form_help}>
                  {purchaseOrderListQuery.isLoading
                    ? '正在加载采购订单候选...'
                    : purchaseOrderListQuery.isError
                    ? '采购订单候选加载失败，可手动输入采购订单号'
                    : `已加载 ${purchaseOrderListQuery.data?.list.length ?? 0} 条采购订单，可输入关键字筛选`}
                </div>
              </>
            )}
          </div>

          <div className={styles.form_field}>
            <label htmlFor="create-deliveryNoteId" className={styles.form_label}>
              送货单号
            </label>
            {createFromDelivery && createForm.deliveryNoteId ? (
              <input
                id="create-deliveryNoteId"
                className={styles.form_input}
                value={createDelivery?.deliveryNo ?? ''}
                placeholder="系统将自动带出送货单号"
                readOnly
              />
            ) : (
              <input
                id="create-deliveryNoteId"
                className={styles.form_input}
                list="incoming-inspection-delivery-options"
                value={createForm.deliveryNoteId}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, deliveryNoteId: e.target.value }))
                }
                placeholder="请输入或选择送货单号"
              />
            )}
            {!createFromDelivery && (
              <>
                <datalist id="incoming-inspection-delivery-options">
                  {purchaseDeliveryOptions.map((delivery) => (
                    <option
                      key={delivery.id}
                      value={delivery.deliveryNo}
                      label={`${delivery.deliveryNo} · ${delivery.status} · ${delivery.deliveryDate}`}
                    />
                  ))}
                </datalist>
                <div className={styles.form_help}>
                  {selectedCreatePoId === null
                    ? '请先输入或选择采购订单号，再加载对应送货单候选'
                    : purchaseDeliveryListQuery.isLoading
                    ? '正在加载送货单候选...'
                    : purchaseDeliveryListQuery.isError
                    ? '送货单候选加载失败，可手动输入送货单号'
                    : `已加载 ${purchaseDeliveryListQuery.data?.list.length ?? 0} 条送货单候选，可输入关键字筛选`}
                </div>
              </>
            )}
          </div>

          <div className={styles.form_field}>
            <label htmlFor="create-inspectionDate" className={styles.form_label}>
              质检日期 <span className={styles.required}>*</span>
            </label>
            <input
              id="create-inspectionDate"
              type="date"
              className={styles.form_input}
              value={createForm.inspectionDate}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, inspectionDate: e.target.value }))
              }
            />
          </div>

          <div className={styles.form_field}>
            <label htmlFor="create-notes" className={styles.form_label}>备注</label>
            <textarea
              id="create-notes"
              className={styles.form_textarea}
              rows={3}
              value={createForm.notes}
              onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="请输入备注（可选）"
            />
          </div>
        </div>
      </Modal>

      {/* ================================================================
          Submit Conclusion Modal
      ================================================================ */}
      <Modal
        open={submitOpen}
        title="提交质检结论"
        onClose={() => {
          setSubmitOpen(false);
          setSubmitForm({ overallResult: '', warehouseId: '', locationId: '', notes: '' });
        }}
        onConfirm={() => void handleSubmitConclusion()}
        confirmLabel="提交结论"
        confirmLoading={submitMutation.isPending}
        size="sm"
      >
        <div className={styles.form}>
          {showSubmitFailedReceiptNotice ? (
            <div className={`${styles.rule_notice} ${styles.rule_notice__warning}`}>
              <span className={styles.rule_notice__icon} aria-hidden="true">!</span>
              <div>
                <strong>提交前确认：</strong>
                本次总体结论选择“不通过”，但抽检明细中仍有
                {' '}
                {formatQtyInput(editableReceiptInsight.acceptedReceiptQty)}
                {' '}
                合格数量会触发入库。系统仅会入库这部分合格数据，其余约
                {' '}
                {formatQtyInput(editableReceiptInsight.pendingReturnQty)}
                {' '}
                未入库数量需后续执行退货。
              </div>
            </div>
          ) : null}
          <div className={styles.form_field}>
            <label className={styles.form_label}>
              总体质检结论 <span className={styles.required}>*</span>
            </label>
            <div className={styles.result_options}>
              {(
                [
                  { value: 'pass', label: '通过', cls: styles.option_pass },
                  { value: 'conditional_pass', label: '有条件通过', cls: styles.option_conditional },
                  { value: 'fail', label: '不通过', cls: styles.option_fail },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.value}
                  className={`${styles.result_option} ${opt.cls} ${submitForm.overallResult === opt.value ? styles.result_option_selected : ''}`}
                >
                  <input
                    type="radio"
                    name="overallResult"
                    value={opt.value}
                    checked={submitForm.overallResult === opt.value}
                    onChange={() =>
                      setSubmitForm((f) => ({ ...f, overallResult: opt.value }))
                    }
                    className={styles.sr_only}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          <div className={styles.form_field}>
            <label htmlFor="submit-notes" className={styles.form_label}>备注</label>
            <textarea
              id="submit-notes"
              className={styles.form_textarea}
              rows={3}
              value={submitForm.notes}
              onChange={(e) => setSubmitForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="请输入质检备注或说明..."
            />
          </div>

          <div className={styles.form_field}>
            <label htmlFor="submit-warehouse" className={styles.form_label}>
              入库仓库 <span className={styles.required}>*</span>
            </label>
            <select
              id="submit-warehouse"
              className={styles.form_input}
              value={submitForm.warehouseId === '' ? '' : String(submitForm.warehouseId)}
              onChange={(e) => {
                const nextValue = e.target.value;
                setSubmitForm((prev) => ({
                  ...prev,
                  warehouseId: nextValue ? Number(nextValue) : '',
                  locationId: '',
                }));
              }}
            >
              <option value="">请选择仓库</option>
              {warehouseOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.code} · {option.name}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.form_field}>
            <label htmlFor="submit-location" className={styles.form_label}>
              入库库位 <span className={styles.required}>*</span>
            </label>
            <select
              id="submit-location"
              className={styles.form_input}
              value={submitForm.locationId === '' ? '' : String(submitForm.locationId)}
              onChange={(e) => {
                const nextValue = e.target.value;
                setSubmitForm((prev) => ({
                  ...prev,
                  locationId: nextValue ? Number(nextValue) : '',
                }));
              }}
              disabled={submitForm.warehouseId === ''}
            >
              <option value="">
                {submitForm.warehouseId === '' ? '请先选择仓库' : '请选择库位'}
              </option>
              {locationOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.code} · {option.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Modal>
    </>
  );
}
