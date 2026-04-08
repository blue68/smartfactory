import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Modal from '@/components/common/Modal';
import Drawer from '@/components/common/Drawer';
import Button from '@/components/common/Button';
import Table from '@/components/common/Table';
import type { Column } from '@/components/common/Table';
import {
  useSalesOrderList,
  useSalesOrder,
  useOrderStats,
  usePendingApprovals,
  useCreateSalesOrder,
  updateSalesOrder,
  useSubmitSalesOrder,
  useApproveSalesOrder,
  useRejectSalesOrder,
  useWithdrawSalesOrder,
  useShipSalesOrder,
  useCompleteSalesOrder,
  useCloseSalesOrder,
  useCreateProductionOrders,
  checkInventory,
  checkSalesOrderCapacity,
} from '@/api/salesOrder';
import type {
  SalesOrder,
  SalesOrderItem,
  SalesOrderStatus,
  SalesOrderListQuery,
  CreateSalesOrderPayload,
  CapacityConflictingOrder,
} from '@/api/salesOrder';
import { useCustomerOptions } from '@/api/customer';
import { useSkuList } from '@/api/sku';
import { useWarehouseOptions, useLocationOptions } from '@/api/inventory';
import { useAuthStore } from '@/stores/authStore';
import { UserRole } from '@/types/enums';
import styles from './SalesOrderListPage.module.css';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<SalesOrderStatus, string> = {
  draft: '草稿',
  pending_approval: '待审批',
  confirmed: '已确认',
  produced: '待发货',
  in_production: '生产中',
  partial_shipped: '部分发货',
  shipped: '已发货',
  completed: '已完成',
  closed: '已关闭',
};

const STATUS_OPTIONS: { value: SalesOrderStatus | ''; label: string }[] = [
  { value: '', label: '全部状态' },
  { value: 'draft', label: '草稿' },
  { value: 'pending_approval', label: '待审批' },
  { value: 'confirmed', label: '已确认' },
  { value: 'in_production', label: '生产中' },
  { value: 'shipped', label: '已发货' },
  { value: 'completed', label: '已完成' },
  { value: 'closed', label: '已关闭' },
];

// ---------------------------------------------------------------------------
// BD-003 permission hooks
// ---------------------------------------------------------------------------

/** 创建订单 / 提交审批: boss, supervisor, sales */
function useCanCreateOrder() {
  return useAuthStore((s) =>
    s.hasAnyRole([UserRole.BOSS, UserRole.SUPERVISOR, UserRole.SALES]),
  );
}

/** 审批通过 / 驳回 / 确认订单 / 关闭: boss only */
function useCanApprove() {
  return useAuthStore((s) => s.hasRole(UserRole.BOSS));
}

/** 发货 / 完成: boss, supervisor */
function useCanShip() {
  return useAuthStore((s) =>
    s.hasAnyRole([UserRole.BOSS, UserRole.SUPERVISOR]),
  );
}

// Keep a convenience alias used for the pending-approvals banner (boss sees it)
function useIsAdmin() {
  return useCanApprove();
}

// ---------------------------------------------------------------------------
// Status timeline — ordered progression steps (closed is a terminal branch,
// not part of the linear flow, so it is handled separately)
// ---------------------------------------------------------------------------

const TIMELINE_STEPS: { key: SalesOrderStatus; label: string }[] = [
  { key: 'draft',            label: '草稿' },
  { key: 'pending_approval', label: '待审批' },
  { key: 'confirmed',        label: '已确认' },
  { key: 'in_production',    label: '生产中' },
  { key: 'shipped',          label: '已发货' },
  { key: 'completed',        label: '已完成' },
];

interface StatusTimelineProps {
  currentStatus: SalesOrderStatus;
}

function StatusTimeline({ currentStatus }: StatusTimelineProps) {
  const isClosed = currentStatus === 'closed';
  const effectiveStatus: SalesOrderStatus = isClosed ? 'completed' : currentStatus;
  const currentIndex = TIMELINE_STEPS.findIndex((s) => s.key === effectiveStatus);

  return (
    <div className={styles.timelineBar}>
      {TIMELINE_STEPS.map((step, idx) => {
        const isCompleted = idx < currentIndex || isClosed;
        const isActive    = idx === currentIndex && !isClosed;
        return (
          <div key={step.key} className={styles.timelinePill}>
            <span
              className={`${styles.timelineDot} ${
                isCompleted ? styles.timelineDotDone : isActive ? styles.timelineDotActive : styles.timelineDotIdle
              }`}
            />
            <span
              className={`${styles.timelineLabel} ${
                isCompleted ? styles.timelineLabelDone : isActive ? styles.timelineLabelActive : styles.timelineLabelIdle
              }`}
            >
              {step.label}
            </span>
            {idx < TIMELINE_STEPS.length - 1 && (
              <span
                className={`${styles.timelineConnector} ${
                  idx < currentIndex ? styles.timelineConnectorDone : styles.timelineConnectorIdle
                }`}
              />
            )}
          </div>
        );
      })}
      {isClosed && <span className={styles.timelineCallout}>已关闭</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface StatusBadgeProps {
  status: SalesOrderStatus;
}

function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`${styles.statusBadge} ${styles[`status_${status}`]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

interface UrgentTagProps {
  urgent: boolean;
}

function UrgentTag({ urgent }: UrgentTagProps) {
  if (!urgent) return <span className={styles.urgentTagEmpty}>—</span>;
  return <span className={styles.urgentTag}>紧急</span>;
}

// ---------------------------------------------------------------------------
// Pending Approvals Banner (admin only)
// ---------------------------------------------------------------------------

interface PendingApprovalsBannerProps {
  count: number;
}

function PendingApprovalsBanner({ count }: PendingApprovalsBannerProps) {
  if (count <= 0) return null;
  return (
    <div className={styles.pendingBanner} role="status" aria-live="polite">
      <span className={styles.pendingBannerIcon} aria-hidden="true">&#9888;</span>
      <span className={styles.pendingBannerText}>
        您有
        <span className={styles.pendingBannerBadge}>{count}</span>
        条待审批订单，请及时处理。
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty line item template
// ---------------------------------------------------------------------------

interface DraftLineItem {
  skuId: number | '';
  productCode: string;
  productName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

function emptyLineItem(): DraftLineItem {
  return { skuId: '', productCode: '', productName: '', quantity: 1, unit: '件', unitPrice: 0 };
}

function buildAssessmentLinesFromDraftItems(items: DraftLineItem[]): AssessmentLineInput[] {
  return items
    .map((item) => ({
      skuId: Number(item.skuId),
      productCode: item.productCode ?? '',
      productName: item.productName ?? '',
      quantity: Number(item.quantity),
    }))
    .filter((item) => Number.isInteger(item.skuId) && item.skuId > 0 && item.quantity > 0);
}

function buildAssessmentLinesFromOrderItems(items: SalesOrderItem[]): AssessmentLineInput[] {
  return items
    .map((item) => ({
      skuId: Number(item.productId),
      productCode: item.productCode ?? '',
      productName: item.productName ?? '',
      quantity: Number(item.qtyOrdered ?? item.quantity ?? 0),
    }))
    .filter((item) => Number.isInteger(item.skuId) && item.skuId > 0 && item.quantity > 0);
}

interface AssessmentLineInput {
  skuId: number;
  productCode: string;
  productName: string;
  quantity: number;
}

interface AssessmentShortageLine {
  skuId: number;
  productCode: string;
  productName: string;
  requiredQty: number;
  availableQty: number;
  stockUnit: string;
}

interface DeliveryCapacityAssessment {
  expectedDelivery: string;
  latestEstimatedCompletionDate: string | null;
  delayDays: number;
  capacityAvailable: boolean;
  inventorySufficient: boolean;
  currentLoadTotal: number;
  maxCapacityTotal: number;
  overloadedLines: string[];
  shortageLines: AssessmentShortageLine[];
  conflictingOrders: CapacityConflictingOrder[];
  failedLineCount: number;
}

function isISODateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime());
}

function getDelayDays(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T00:00:00`).getTime();
  const to = new Date(`${toDate}T00:00:00`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  return Math.ceil((to - from) / 86400000);
}

async function buildDeliveryCapacityAssessment(
  lines: AssessmentLineInput[],
  expectedDelivery: string,
): Promise<DeliveryCapacityAssessment> {
  const validLines = lines.filter((line) => Number.isInteger(line.skuId) && line.skuId > 0 && line.quantity > 0);
  if (validLines.length === 0 || !isISODateString(expectedDelivery)) {
    return {
      expectedDelivery,
      latestEstimatedCompletionDate: null,
      delayDays: 0,
      capacityAvailable: true,
      inventorySufficient: true,
      currentLoadTotal: 0,
      maxCapacityTotal: 0,
      overloadedLines: [],
      shortageLines: [],
      conflictingOrders: [],
      failedLineCount: 0,
    };
  }

  const lineResults = await Promise.all(
    validLines.map(async (line) => {
      try {
        const [inventory, capacity] = await Promise.all([
          checkInventory(line.skuId, line.quantity),
          checkSalesOrderCapacity({
            skuId: line.skuId,
            quantity: Math.max(1, Math.round(line.quantity)),
            expectedDelivery,
          }),
        ]);
        return { line, inventory, capacity, failed: false as const };
      } catch {
        return { line, inventory: null, capacity: null, failed: true as const };
      }
    }),
  );

  const shortageLines: AssessmentShortageLine[] = lineResults
    .filter((item) => item.inventory && !item.inventory.sufficient)
    .map((item) => ({
      skuId: item.line.skuId,
      productCode: item.line.productCode,
      productName: item.line.productName,
      requiredQty: item.line.quantity,
      availableQty: item.inventory?.available ?? 0,
      stockUnit: item.inventory?.stockUnit ?? '件',
    }));

  const overloadedLines = lineResults
    .filter((item) => item.capacity && !item.capacity.available)
    .map((item) => item.line.productName || item.line.productCode || `SKU#${item.line.skuId}`);

  const conflictMap = new Map<number, CapacityConflictingOrder>();
  lineResults.forEach((item) => {
    item.capacity?.conflictingOrders?.forEach((order) => {
      if (!conflictMap.has(order.id)) {
        conflictMap.set(order.id, order);
      }
    });
  });

  const estimatedDates = lineResults
    .map((item) => item.capacity?.estimatedCompletionDate)
    .filter((date): date is string => Boolean(date) && isISODateString(String(date)));

  const latestEstimatedCompletionDate = estimatedDates.length > 0
    ? estimatedDates.sort()[estimatedDates.length - 1] ?? null
    : null;

  return {
    expectedDelivery,
    latestEstimatedCompletionDate,
    delayDays: latestEstimatedCompletionDate ? getDelayDays(expectedDelivery, latestEstimatedCompletionDate) : 0,
    capacityAvailable: overloadedLines.length === 0,
    inventorySufficient: shortageLines.length === 0,
    currentLoadTotal: lineResults.reduce((sum, item) => sum + (item.capacity?.currentLoad ?? 0), 0),
    maxCapacityTotal: lineResults.reduce((sum, item) => sum + (item.capacity?.maxCapacity ?? 0), 0),
    overloadedLines,
    shortageLines,
    conflictingOrders: Array.from(conflictMap.values()).slice(0, 6),
    failedLineCount: lineResults.filter((item) => item.failed).length,
  };
}

interface DeliveryCapacityPanelProps {
  title: string;
  expectedDelivery: string;
  loading: boolean;
  error: string;
  assessment: DeliveryCapacityAssessment | null;
  approvalContext?: boolean;
}

function DeliveryCapacityPanel({
  title,
  expectedDelivery,
  loading,
  error,
  assessment,
  approvalContext = false,
}: DeliveryCapacityPanelProps) {
  const canEvaluate = isISODateString(expectedDelivery);
  const loadRatio = assessment && assessment.maxCapacityTotal > 0
    ? Math.min(999, Math.round((assessment.currentLoadTotal / assessment.maxCapacityTotal) * 100))
    : null;

  const approvalTip = assessment
    ? assessment.delayDays > 0 || !assessment.capacityAvailable || !assessment.inventorySufficient
      ? '存在延期或资源风险，建议审批前与销售和计划协同复核。'
      : '当前风险可控，可进入审批流程。'
    : '';

  return (
    <div className={styles.assessmentPanel}>
      <div className={styles.assessmentHeader}>
        <h4 className={styles.assessmentTitle}>{title}</h4>
        <span className={styles.assessmentTag}>实时计算</span>
      </div>

      {!canEvaluate && (
        <div className={styles.assessmentHint}>请选择交期后自动评估。</div>
      )}
      {canEvaluate && loading && (
        <div className={styles.assessmentHint}>正在计算交期与产能，请稍候...</div>
      )}
      {canEvaluate && !loading && error && (
        <div className={styles.assessmentError}>{error}</div>
      )}
      {canEvaluate && !loading && assessment && (
        <>
          <div className={styles.assessmentGrid}>
            <div className={styles.assessmentItem}>
              <span className={styles.assessmentLabel}>预估最早交期</span>
              <span className={`${styles.assessmentValue} ${assessment.delayDays > 0 ? styles.assessmentValueWarn : ''}`}>
                {assessment.latestEstimatedCompletionDate ?? expectedDelivery}
              </span>
              {assessment.delayDays > 0 && (
                <span className={styles.assessmentMeta}>较期望交期延后 {assessment.delayDays} 天</span>
              )}
            </div>

            <div className={styles.assessmentItem}>
              <span className={styles.assessmentLabel}>产能负荷</span>
              <span className={styles.assessmentValue}>
                {loadRatio === null ? '—' : `${loadRatio}%`}
              </span>
              <span className={styles.assessmentMeta}>
                {assessment.capacityAvailable ? '当前产能可承接' : `存在超载 SKU：${assessment.overloadedLines.slice(0, 2).join('、')}`}
              </span>
            </div>

            <div className={styles.assessmentItem}>
              <span className={styles.assessmentLabel}>库存可用性</span>
              <span className={`${styles.assessmentValue} ${!assessment.inventorySufficient ? styles.assessmentValueWarn : ''}`}>
                {assessment.inventorySufficient ? '可满足' : `${assessment.shortageLines.length} 个 SKU 库存不足`}
              </span>
              {!assessment.inventorySufficient && assessment.shortageLines[0] && (
                <span className={styles.assessmentMeta}>
                  例如：{assessment.shortageLines[0].productName} 可用 {assessment.shortageLines[0].availableQty} / 需求 {assessment.shortageLines[0].requiredQty}
                </span>
              )}
            </div>
          </div>

          {assessment.conflictingOrders.length > 0 && (
            <div className={styles.assessmentConflictBox}>
              <span className={styles.assessmentConflictLabel}>冲突工单：</span>
              <span className={styles.assessmentConflictValue}>
                {assessment.conflictingOrders.map((item) => item.orderNo).join('、')}
              </span>
            </div>
          )}

          {assessment.failedLineCount > 0 && (
            <div className={styles.assessmentHint}>有 {assessment.failedLineCount} 个 SKU 评估失败，已按可用结果展示。</div>
          )}

          {approvalContext && (
            <div className={`${styles.assessmentApprovalTip} ${assessment.delayDays > 0 || !assessment.capacityAvailable || !assessment.inventorySufficient ? styles.assessmentApprovalTipWarn : ''}`}>
              审批建议：{approvalTip}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Order Modal
// ---------------------------------------------------------------------------

interface CreateOrderModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialOrder?: SalesOrder | null;
}

function CreateOrderModal({ open, onClose, onSuccess, initialOrder = null }: CreateOrderModalProps) {
  const qc = useQueryClient();
  const { data: customerList = [] } = useCustomerOptions();
  const { data: skuPage } = useSkuList({ pageSize: 200, skuTypes: 'finished' });
  const createOrder = useCreateSalesOrder();
  const isEdit = Boolean(initialOrder);
  const skuOptions = useMemo(
    () =>
      (skuPage?.list ?? [])
        .filter((sku) => sku.category1Code === 'FINISHED')
        .map((sku) => ({ ...sku, id: Number(sku.id) })),
    [skuPage],
  );

  const [customerId, setCustomerId] = useState<number | ''>('');
  const [orderDate, setOrderDate] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [items, setItems] = useState<DraftLineItem[]>([emptyLineItem()]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [assessmentError, setAssessmentError] = useState('');
  const [assessment, setAssessment] = useState<DeliveryCapacityAssessment | null>(null);
  const assessmentReqRef = useRef(0);

  const buildDraftItemsFromOrder = useCallback((order: SalesOrder): DraftLineItem[] => {
    const orderItems = order.items ?? [];
    if (orderItems.length === 0) return [emptyLineItem()];
    return orderItems.map((item) => ({
      skuId: item.productId && Number(item.productId) > 0 ? Number(item.productId) : '',
      productCode: item.productCode ?? '',
      productName: item.productName ?? '',
      quantity: Number(item.qtyOrdered ?? item.quantity ?? 1) || 1,
      unit: item.unit ?? '件',
      unitPrice: Number(item.unitPrice ?? 0),
    }));
  }, []);

  const populateFromOrder = useCallback((order: SalesOrder) => {
    setCustomerId(Number(order.customerId) || '');
    setOrderDate(order.orderDate ? String(order.orderDate).slice(0, 10) : '');
    setDeliveryDate(order.deliveryDate ? String(order.deliveryDate).slice(0, 10) : '');
    setUrgent(Boolean(order.isUrgent));
    setItems(buildDraftItemsFromOrder(order));
    setNotes(order.notes ?? '');
    setError('');
  }, [buildDraftItemsFromOrder]);

  const handleReset = useCallback(() => {
    if (initialOrder) {
      populateFromOrder(initialOrder);
      setAssessmentLoading(false);
      setAssessmentError('');
      setAssessment(null);
      return;
    }
    setCustomerId('');
    setOrderDate('');
    setDeliveryDate('');
    setUrgent(false);
    setItems([emptyLineItem()]);
    setNotes('');
    setError('');
    setAssessmentLoading(false);
    setAssessmentError('');
    setAssessment(null);
  }, [initialOrder, populateFromOrder]);

  const handleClose = useCallback(() => {
    handleReset();
    onClose();
  }, [handleReset, onClose]);

  const addItem = () => setItems((prev) => [...prev, emptyLineItem()]);

  const removeItem = (idx: number) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));

  const updateItem = <K extends keyof DraftLineItem>(
    idx: number,
    key: K,
    value: DraftLineItem[K],
  ) => {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      return next;
    });
  };

  useEffect(() => {
    if (skuOptions.length === 0) return;
    setItems((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        if (!item.skuId) return item;
        const selectedSku = skuOptions.find((sku) => Number(sku.id) === Number(item.skuId));
        if (!selectedSku) return item;

        const nextItem = {
          ...item,
          productCode: item.productCode || selectedSku.skuCode,
          productName: item.productName || selectedSku.name,
          unit: item.unit || selectedSku.stockUnit || '件',
        };

        if (
          nextItem.productCode !== item.productCode ||
          nextItem.productName !== item.productName ||
          nextItem.unit !== item.unit
        ) {
          changed = true;
          return nextItem;
        }

        return item;
      });

      return changed ? next : prev;
    });
  }, [skuOptions]);

  useEffect(() => {
    if (!open) return;
    handleReset();
  }, [open, handleReset]);

  useEffect(() => {
    if (!open) return;

    const expectedDelivery = deliveryDate ? String(deliveryDate).slice(0, 10) : '';
    if (!isISODateString(expectedDelivery)) {
      setAssessmentLoading(false);
      setAssessmentError('');
      setAssessment(null);
      return;
    }

    const lineInputs = buildAssessmentLinesFromDraftItems(items);
    const currentReqId = ++assessmentReqRef.current;
    const timer = window.setTimeout(() => {
      setAssessmentLoading(true);
      setAssessmentError('');
      void buildDeliveryCapacityAssessment(lineInputs, expectedDelivery)
        .then((result) => {
          if (assessmentReqRef.current !== currentReqId) return;
          setAssessment(result);
        })
        .catch((e: unknown) => {
          if (assessmentReqRef.current !== currentReqId) return;
          setAssessment(null);
          setAssessmentError(e instanceof Error ? e.message : '交期与产能评估失败，请稍后重试');
        })
        .finally(() => {
          if (assessmentReqRef.current !== currentReqId) return;
          setAssessmentLoading(false);
        });
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [open, deliveryDate, items]);

  const handleSkuChange = (idx: number, rawSkuId: string) => {
    const skuId = Number(rawSkuId) || '';
    const selectedSku = skuOptions.find((sku) => Number(sku.id) === Number(skuId));
    setItems((prev) => {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        skuId,
        productCode: selectedSku?.skuCode ?? '',
        productName: selectedSku?.name ?? '',
        unit: selectedSku?.stockUnit ?? next[idx].unit,
      };
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!customerId) { setError('请选择客户'); return; }
    if (!orderDate) { setError('请选择订单日期'); return; }
    if (!deliveryDate) { setError('请选择交期'); return; }
    if (items.length === 0) { setError('请至少添加一个产品行'); return; }

    const normalizedItems = items.map((item) => {
      const skuId = Number(item.skuId);
      const selectedSku = skuOptions.find((sku) => Number(sku.id) === skuId);
      return {
        ...item,
        skuId,
        productCode: item.productCode || selectedSku?.skuCode || '',
        productName: item.productName || selectedSku?.name || `SKU#${skuId}`,
        unit: item.unit || selectedSku?.stockUnit || '件',
      };
    });

    for (const item of normalizedItems) {
      if (!Number.isInteger(item.skuId) || item.skuId <= 0) {
        setError('请选择所有产品');
        return;
      }
      if (item.quantity <= 0) { setError('产品数量必须大于0'); return; }
    }

    const payload: CreateSalesOrderPayload = {
      customerId: customerId as number,
      orderDate,
      deliveryDate,
      isUrgent: urgent,
      notes: notes.trim() || undefined,
      items: normalizedItems.map((it) => ({
        skuId: it.skuId,
        productName: it.productName,
        quantity: it.quantity,
        unit: it.unit,
        unitPrice: String(it.unitPrice),
      })),
    };

    try {
      setSubmitting(true);
      setError('');
      if (initialOrder) {
        await updateSalesOrder(initialOrder.id, payload);
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['sales-orders'] }),
          qc.invalidateQueries({ queryKey: ['sales-order', initialOrder.id] }),
        ]);
      } else {
        await createOrder.mutateAsync(payload);
      }
      handleReset();
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : `${isEdit ? '保存' : '创建'}失败，请重试`);
    } finally {
      setSubmitting(false);
    }
  };

  const totalAmount = items.reduce(
    (sum, it) => sum + it.quantity * it.unitPrice,
    0,
  );

  return (
    <Modal open={open} onClose={handleClose} title={isEdit ? '编辑销售订单' : '新建销售订单'} size="lg" hideFooter>
      <div className={styles.formGrid}>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>客户 *</label>
          <select
            className={styles.select}
            value={customerId}
            onChange={(e) => setCustomerId(Number(e.target.value) || '')}
          >
            <option value="">请选择客户</option>
            {customerList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}（{c.code}）
              </option>
            ))}
          </select>
        </div>

        <div className={styles.formGroup}>
          <label className={styles.formLabel}>订单日期 *</label>
          <input
            type="date"
            className={styles.searchInput}
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
          />
        </div>

        <div className={styles.formGroup}>
          <label className={styles.formLabel}>交期 *</label>
          <input
            type="date"
            className={styles.searchInput}
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
          />
        </div>

        <div className={styles.formGroup}>
          <label className={styles.formLabel}>紧急订单</label>
          <label className={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={urgent}
              onChange={(e) => setUrgent(e.target.checked)}
              className={styles.toggleInput}
            />
            <span className={styles.toggleText}>{urgent ? '是' : '否'}</span>
          </label>
        </div>
      </div>

      <div className={styles.itemsSection}>
        <div className={styles.itemsHeader}>
          <span className={styles.itemsTitle}>产品明细</span>
          <Button size="sm" variant="secondary" onClick={addItem}>
            + 添加行
          </Button>
        </div>

        <div className={styles.itemsTableWrapper}>
          <table className={styles.itemsTable}>
            <thead>
              <tr>
                <th>产品 SKU</th>
                <th>产品名称</th>
                <th>数量</th>
                <th>单位</th>
                <th>单价(元)</th>
                <th>小计(元)</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx}>
                  <td>
                    <select
                      className={styles.cellInput}
                      value={item.skuId}
                      onChange={(e) => handleSkuChange(idx, e.target.value)}
                    >
                      <option value="">请选择 SKU</option>
                      {skuOptions.map((sku) => (
                        <option key={sku.id} value={sku.id}>
                          {sku.skuCode} · {sku.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className={styles.cellInput}
                      value={item.productName}
                      readOnly
                      placeholder="选择 SKU 后自动带出"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      className={`${styles.cellInput} ${styles.cellInputNarrow}`}
                      value={item.quantity}
                      onChange={(e) =>
                        updateItem(idx, 'quantity', Number(e.target.value))
                      }
                    />
                  </td>
                  <td>
                    <input
                      className={`${styles.cellInput} ${styles.cellInputNarrow}`}
                      value={item.unit}
                      readOnly
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      className={`${styles.cellInput} ${styles.cellInputNarrow}`}
                      value={item.unitPrice}
                      onChange={(e) =>
                        updateItem(idx, 'unitPrice', Number(e.target.value))
                      }
                    />
                  </td>
                  <td className={styles.cellAmount}>
                    {(item.quantity * item.unitPrice).toFixed(2)}
                  </td>
                  <td>
                    <button
                      className={styles.removeBtn}
                      onClick={() => removeItem(idx)}
                      disabled={items.length === 1}
                      title="删除行"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className={styles.totalLabel}>合计</td>
                <td className={styles.totalAmount}>
                  {totalAmount.toFixed(2)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <DeliveryCapacityPanel
        title="交期与产能评估"
        expectedDelivery={deliveryDate}
        loading={assessmentLoading}
        error={assessmentError}
        assessment={assessment}
      />

      <div className={styles.formGroup}>
        <label className={styles.formLabel}>备注</label>
        <textarea
          className={styles.textarea}
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="可选"
        />
      </div>

      {error && <div className={styles.formError}>{error}</div>}

      <div className={styles.modalFooter}>
        <Button variant="secondary" onClick={handleClose} disabled={submitting}>
          取消
        </Button>
        <Button variant="primary" onClick={handleSubmit} loading={submitting}>
          {isEdit ? '保存修改' : '创建订单'}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Reject Modal
// ---------------------------------------------------------------------------

interface RejectModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

function RejectModal({ open, onClose, onConfirm }: RejectModalProps) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleClose = () => {
    setReason('');
    setError('');
    onClose();
  };

  const handleConfirm = async () => {
    if (!reason.trim()) { setError('请填写拒绝原因'); return; }
    try {
      setSubmitting(true);
      await onConfirm(reason.trim());
      setReason('');
      setError('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="拒绝审批" size="sm" hideFooter>
      <div className={styles.formGroup}>
        <label className={styles.formLabel}>拒绝原因 *</label>
        <textarea
          className={styles.textarea}
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="请填写拒绝原因..."
        />
      </div>
      {error && <div className={styles.formError}>{error}</div>}
      <div className={styles.modalFooter}>
        <Button variant="secondary" onClick={handleClose} disabled={submitting}>
          取消
        </Button>
        <Button variant="danger" onClick={handleConfirm} loading={submitting}>
          确认拒绝
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Order Detail Drawer
// ---------------------------------------------------------------------------

interface OrderDetailDrawerProps {
  orderId: number | null;
  onClose: () => void;
  onRefresh: () => void;
  onEdit: (order: SalesOrder) => void;
}

function OrderDetailDrawer({ orderId, onClose, onRefresh, onEdit }: OrderDetailDrawerProps) {
  const canCreateOrder = useCanCreateOrder();
  const canApprove     = useCanApprove();
  const canShip        = useCanShip();
  const { data: order, isLoading: loading, error, refetch } = useSalesOrder(orderId);
  const submitOrder = useSubmitSalesOrder();
  const approveOrder = useApproveSalesOrder();
  const rejectOrderApi = useRejectSalesOrder();
  const withdrawOrder = useWithdrawSalesOrder();
  const shipOrder = useShipSalesOrder();
  const completeOrder = useCompleteSalesOrder();
  const closeOrder = useCloseSalesOrder();
  const createProdOrders = useCreateProductionOrders();

  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [shipModalOpen, setShipModalOpen] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [shipTrackingNo, setShipTrackingNo] = useState('');
  const [shipWarehouseId, setShipWarehouseId] = useState<number | ''>('');
  const [shipLocationId, setShipLocationId] = useState<number | ''>('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [assessmentError, setAssessmentError] = useState('');
  const [assessment, setAssessment] = useState<DeliveryCapacityAssessment | null>(null);
  const assessmentReqRef = useRef(0);
  const { data: warehouseOptions = [] } = useWarehouseOptions(true);
  const { data: locationOptions = [] } = useLocationOptions(
    shipWarehouseId === '' ? undefined : Number(shipWarehouseId),
    true,
  );

  const handleAction = async (fn: () => Promise<unknown>) => {
    try {
      setActionLoading(true);
      setActionError('');
      await fn();
      refetch();
      onRefresh();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectConfirm = async (reason: string) => {
    if (!orderId) return;
    await rejectOrderApi.mutateAsync({ id: orderId, reason });
    setRejectModalOpen(false);
    refetch();
    onRefresh();
  };

  const handleClose = async () => {
    if (!orderId || !closeReason.trim()) return;
    await handleAction(() => closeOrder.mutateAsync({ id: orderId, reason: closeReason.trim() }));
    setCloseModalOpen(false);
    setCloseReason('');
  };

  useEffect(() => {
    if (!shipModalOpen || warehouseOptions.length === 0 || shipWarehouseId !== '') return;
    setShipWarehouseId(Number(warehouseOptions[0].id));
  }, [shipModalOpen, warehouseOptions, shipWarehouseId]);

  useEffect(() => {
    if (!shipModalOpen) return;
    setShipLocationId('');
  }, [shipWarehouseId, shipModalOpen]);

  useEffect(() => {
    if (!shipModalOpen || locationOptions.length === 0 || shipLocationId !== '') return;
    setShipLocationId(Number(locationOptions[0].id));
  }, [shipModalOpen, locationOptions, shipLocationId]);

  useEffect(() => {
    if (!order || order.status !== 'pending_approval') {
      setAssessmentLoading(false);
      setAssessmentError('');
      setAssessment(null);
      return;
    }

    const expectedDelivery = String(order.deliveryDate ?? '').slice(0, 10);
    if (!isISODateString(expectedDelivery)) {
      setAssessmentLoading(false);
      setAssessmentError('');
      setAssessment(null);
      return;
    }

    const lineInputs = buildAssessmentLinesFromOrderItems(order.items ?? []);
    const currentReqId = ++assessmentReqRef.current;
    const timer = window.setTimeout(() => {
      setAssessmentLoading(true);
      setAssessmentError('');
      void buildDeliveryCapacityAssessment(lineInputs, expectedDelivery)
        .then((result) => {
          if (assessmentReqRef.current !== currentReqId) return;
          setAssessment(result);
        })
        .catch((e: unknown) => {
          if (assessmentReqRef.current !== currentReqId) return;
          setAssessment(null);
          setAssessmentError(e instanceof Error ? e.message : '审批评估失败，请稍后重试');
        })
        .finally(() => {
          if (assessmentReqRef.current !== currentReqId) return;
          setAssessmentLoading(false);
        });
    }, 200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [order]);

  const openShipModal = () => {
    setShipModalOpen(true);
    setShipTrackingNo('');
    setShipWarehouseId('');
    setShipLocationId('');
    setActionError('');
  };

  const handleShip = async () => {
    if (!orderId) return;
    if (shipWarehouseId === '' || shipLocationId === '') {
      setActionError('发货时必须选择仓库和库位');
      return;
    }
    await handleAction(() => shipOrder.mutateAsync({
      id: orderId,
      trackingNo: shipTrackingNo.trim() || undefined,
      warehouseId: Number(shipWarehouseId),
      locationId: Number(shipLocationId),
    }));
    setShipModalOpen(false);
    setShipTrackingNo('');
    setShipWarehouseId('');
    setShipLocationId('');
  };

  const renderActions = (o: SalesOrder) => {
    const id = o.id;
    switch (o.status) {
      case 'draft':
        return (
          <div className={styles.actionGroup}>
            {canCreateOrder && (
              <Button
                size="sm"
                variant="primary"
                loading={actionLoading}
                onClick={() => handleAction(() => submitOrder.mutateAsync(id))}
              >
                提交审批
              </Button>
            )}
            {canApprove && (
              <Button
                size="sm"
                variant="secondary"
                loading={actionLoading}
                onClick={() => setCloseModalOpen(true)}
              >
                关闭订单
              </Button>
            )}
          </div>
        );

      case 'pending_approval':
        return (
          <div className={styles.actionGroup}>
            {/* 撤回: boss, supervisor, sales (order submitter) — guard same as create */}
            {canCreateOrder && (
              <Button
                size="sm"
                variant="secondary"
                loading={actionLoading}
                onClick={() => handleAction(() => withdrawOrder.mutateAsync(id))}
              >
                撤回
              </Button>
            )}
            {/* 审批通过 / 拒绝: boss only */}
            {canApprove && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  loading={actionLoading}
                  onClick={() => handleAction(() => approveOrder.mutateAsync(id))}
                >
                  审批通过
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={actionLoading}
                  onClick={() => setRejectModalOpen(true)}
                >
                  拒绝
                </Button>
              </>
            )}
          </div>
        );

      case 'confirmed':
        return (
          <div className={styles.actionGroup}>
            {canApprove && (
              <Button
                size="sm"
                variant="primary"
                loading={actionLoading}
                onClick={() => handleAction(() => createProdOrders.mutateAsync(id))}
              >
                触发建工单
              </Button>
            )}
            {canShip && (
              <Button
                size="sm"
                variant="secondary"
                loading={actionLoading}
                onClick={openShipModal}
              >
                标记发货
              </Button>
            )}
            {canApprove && (
              <Button
                size="sm"
                variant="ghost"
                loading={actionLoading}
                onClick={() => setCloseModalOpen(true)}
              >
                关闭订单
              </Button>
            )}
          </div>
        );

      case 'in_production':
        return (
          <div className={styles.actionGroup}>
            {canShip && (
              <Button
                size="sm"
                variant="primary"
                loading={actionLoading}
                onClick={openShipModal}
              >
                标记发货
              </Button>
            )}
            {canApprove && (
              <Button
                size="sm"
                variant="ghost"
                loading={actionLoading}
                onClick={() => setCloseModalOpen(true)}
              >
                关闭订单
              </Button>
            )}
          </div>
        );

      case 'shipped':
        return (
          <div className={styles.actionGroup}>
            {canShip && (
              <Button
                size="sm"
                variant="primary"
                loading={actionLoading}
                onClick={() => handleAction(() => completeOrder.mutateAsync(id))}
              >
                确认完成
              </Button>
            )}
            {canApprove && (
              <Button
                size="sm"
                variant="ghost"
                loading={actionLoading}
                onClick={() => setCloseModalOpen(true)}
              >
                关闭订单
              </Button>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <Drawer
        open={orderId !== null}
        onClose={onClose}
        title="订单详情"
        width="min(1100px, 92vw)"
      >
        {loading && (
          <div className={styles.drawerLoading}>加载中...</div>
        )}
        {error && (
          <div className={styles.drawerError}>加载失败：{error instanceof Error ? error.message : '未知错误'}</div>
        )}
        {order && (
          <>
            {/* Basic info */}
            <div className={styles.drawerSection}>
              <div className={styles.drawerSectionTitle}>基本信息</div>
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>订单号</span>
                  <span className={styles.infoValue}>{order.orderNo}</span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>客户</span>
                  <span className={styles.infoValue}>{order.customerName}</span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>订单日期</span>
                  <span className={styles.infoValue}>{order.orderDate}</span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>交期</span>
                  <span className={styles.infoValue}>{order.deliveryDate}</span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>状态</span>
                  <span className={styles.infoValue}>
                    <StatusBadge status={order.status} />
                  </span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>紧急</span>
                  <span className={styles.infoValue}>
                    <UrgentTag urgent={order.isUrgent} />
                  </span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>总金额</span>
                  <span className={`${styles.infoValue} ${styles.amountValue}`}>
                    ¥ {Number(order.totalAmount ?? 0).toFixed(2)}
                  </span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>备注</span>
                  <span className={styles.infoValue}>{order.notes ?? '—'}</span>
                </div>
              </div>
            </div>

            {/* Status Timeline */}
            <div className={styles.drawerSection}>
              <div className={styles.drawerSectionTitle}>订单进度</div>
              <StatusTimeline currentStatus={order.status} />
            </div>

            {/* Items */}
            <div className={styles.drawerSection}>
              <div className={styles.drawerSectionTitle}>产品明细</div>
              <table className={styles.drawerItemsTable}>
                <thead>
                  <tr>
                    <th>产品编号</th>
                    <th>产品名称</th>
                    <th>数量</th>
                    <th>单位</th>
                    <th>单价</th>
                    <th>小计</th>
                  </tr>
                </thead>
                <tbody>
                  {(order.items ?? []).map((item: SalesOrderItem) => (
                    <tr key={item.id}>
                      <td>{item.productCode}</td>
                      <td>{item.productName}</td>
                      <td>{item.quantity}</td>
                      <td>{item.unit}</td>
                      <td>¥{Number(item.unitPrice).toFixed(2)}</td>
                      <td>¥{(Number(item.quantity) * Number(item.unitPrice)).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {order.status === 'pending_approval' && (
              <div className={styles.drawerSection}>
                <DeliveryCapacityPanel
                  title="交期与产能评估（审批参考）"
                  expectedDelivery={String(order.deliveryDate ?? '').slice(0, 10)}
                  loading={assessmentLoading}
                  error={assessmentError}
                  assessment={assessment}
                  approvalContext
                />
              </div>
            )}

            {/* Actions */}
            <div className={styles.drawerSection}>
              <div className={styles.drawerSectionTitle}>状态操作</div>
              {actionError && (
                <div className={styles.formError}>{actionError}</div>
              )}
              {order.status === 'draft' && canCreateOrder && (
                <div className={styles.actionGroup} style={{ marginBottom: '12px' }}>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={actionLoading}
                    onClick={() => onEdit(order)}
                  >
                    编辑订单
                  </Button>
                </div>
              )}
              {renderActions(order)}
            </div>
          </>
        )}
      </Drawer>

      <RejectModal
        open={rejectModalOpen}
        onClose={() => setRejectModalOpen(false)}
        onConfirm={handleRejectConfirm}
      />

      {/* 关闭订单原因 Modal */}
      <Modal
        open={closeModalOpen}
        title="关闭订单"
        onClose={() => { setCloseModalOpen(false); setCloseReason(''); }}
        onConfirm={handleClose}
        confirmLabel="确认关闭"
        confirmLoading={actionLoading}
        confirmVariant="danger"
        size="sm"
      >
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>关闭原因 *</label>
          <textarea
            className={styles.textarea}
            rows={3}
            value={closeReason}
            onChange={(e) => setCloseReason(e.target.value)}
            placeholder="请填写关闭订单的原因..."
          />
        </div>
      </Modal>

      <Modal
        open={shipModalOpen}
        title="标记发货"
        onClose={() => {
          setShipModalOpen(false);
          setShipTrackingNo('');
          setShipWarehouseId('');
          setShipLocationId('');
        }}
        onConfirm={() => void handleShip()}
        confirmLabel="确认发货"
        confirmLoading={actionLoading}
        size="md"
      >
        <div className={styles.formGrid}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>物流单号</label>
            <input
              className={styles.modalInput}
              value={shipTrackingNo}
              onChange={(event) => setShipTrackingNo(event.target.value)}
              placeholder="选填，记录物流单号"
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>发货仓库 *</label>
            <select
              className={styles.modalSelect}
              value={shipWarehouseId === '' ? '' : String(shipWarehouseId)}
              onChange={(event) => {
                const next = event.target.value;
                setShipWarehouseId(next ? Number(next) : '');
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
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>发货库位 *</label>
            <select
              className={styles.modalSelect}
              value={shipLocationId === '' ? '' : String(shipLocationId)}
              onChange={(event) => {
                const next = event.target.value;
                setShipLocationId(next ? Number(next) : '');
              }}
              disabled={shipWarehouseId === ''}
            >
              <option value="">{shipWarehouseId === '' ? '请先选择仓库' : '请选择库位'}</option>
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

// ---------------------------------------------------------------------------
// CountUp hook — 数字滚动动画
// ---------------------------------------------------------------------------

function useCountUp(target: number, duration = 600): number {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = prevRef.current;
    if (start === target) return;
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutQuart
      const eased = 1 - Math.pow(1 - progress, 4);
      setDisplay(Math.round(start + (target - start) * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        prevRef.current = target;
      }
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);

  return display;
}

// ---------------------------------------------------------------------------
// Summary Cards
// ---------------------------------------------------------------------------

interface StatCardDef {
  key: SalesOrderStatus | '';
  label: string;
  colorClass: string;
}

const STAT_CARD_DEFS: StatCardDef[] = [
  { key: '',                label: '全部',   colorClass: 'statCardTotal' },
  { key: 'pending_approval', label: '待审批', colorClass: 'statCardPending' },
  { key: 'confirmed',        label: '已确认', colorClass: 'statCardConfirmed' },
  { key: 'in_production',    label: '生产中', colorClass: 'statCardProduction' },
  { key: 'shipped',          label: '已发货', colorClass: 'statCardShipped' },
  { key: 'completed',        label: '已完成', colorClass: 'statCardCompleted' },
  { key: 'closed',           label: '已关闭', colorClass: 'statCardClosed' },
];

interface AnimatedStatValueProps {
  value: number;
}

function AnimatedStatValue({ value }: AnimatedStatValueProps) {
  const display = useCountUp(value);
  return <span>{display}</span>;
}

interface SummaryCardsProps {
  total: number;
  statusCounts: Record<string, number>;
  activeStatus: SalesOrderStatus | '';
  onStatusClick: (status: SalesOrderStatus | '') => void;
}

function SummaryCards({ total, statusCounts, activeStatus, onStatusClick }: SummaryCardsProps) {
  const getCount = (key: SalesOrderStatus | ''): number => {
    if (key === '') return total;
    return statusCounts[key] ?? 0;
  };

  return (
    <div className={styles.statsRow}>
      {STAT_CARD_DEFS.map((def) => {
        const count = getCount(def.key);
        const isActive = activeStatus === def.key;
        return (
          <button
            key={def.key}
            type="button"
            className={`${styles.statCard} ${styles[def.colorClass]} ${isActive ? styles.statCardActive : ''}`}
            onClick={() => onStatusClick(def.key)}
            aria-pressed={isActive}
          >
            <div className={styles.statValue}>
              <AnimatedStatValue value={count} />
            </div>
            <div className={styles.statLabel}>{def.label}</div>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function SalesOrderListPage() {
  const [query, setQuery] = useState<SalesOrderListQuery>({
    page: 1,
    pageSize: 20,
    keyword: '',
    status: undefined,
    isUrgent: undefined,
  });

  // GAP-R08-07: raw input state for debounced keyword search
  const [searchInput, setSearchInput] = useState('');

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<SalesOrder | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

  const isAdmin        = useIsAdmin();
  const canCreateOrder = useCanCreateOrder();

  const { data, isLoading: loading, error, refetch: refresh } = useSalesOrderList(query);
  const { data: orderStatsData } = useOrderStats();
  const { data: pendingData } = usePendingApprovals();
  const pendingCount = isAdmin ? (pendingData?.count ?? 0) : 0;

  const orders: SalesOrder[] = data?.list ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.ceil(total / (query.pageSize ?? 20));

  // GAP-R08-07: debounce keyword search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery((prev) => ({ ...prev, keyword: searchInput, page: 1 }));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Summary stats from dedicated aggregation API
  const statsTotal = orderStatsData?.total ?? data?.total ?? 0;
  const statusCounts = useMemo<Record<string, number>>(
    () => orderStatsData?.byStatus ?? {},
    [orderStatsData],
  );

  const handleQueryChange = useCallback(
    <K extends keyof SalesOrderListQuery>(key: K, value: SalesOrderListQuery[K]) => {
      setQuery((prev) => ({ ...prev, [key]: value, page: 1 }));
    },
    [],
  );

  const handlePageChange = useCallback((page: number) => {
    setQuery((prev) => ({ ...prev, page }));
  }, []);

  const handleCreateSuccess = useCallback(() => {
    setCreateModalOpen(false);
    setEditingOrder(null);
    refresh();
  }, [refresh]);

  // Table columns
  const columns: Column<Record<string, unknown>>[] = [
    {
      key: 'orderNo',
      title: '订单号',
      render: (_, row) => (
        <button
          className={styles.linkBtn}
          onClick={() => setSelectedOrderId(row.id as number)}
        >
          {row.orderNo as string}
        </button>
      ),
    },
    { key: 'customerName', title: '客户名称' },
    { key: 'orderDate', title: '订单日期' },
    { key: 'deliveryDate', title: '交期' },
    {
      key: 'totalAmount',
      title: '金额',
      render: (v) => (
        <span className={styles.amountCell}>
          ¥{Number(v ?? 0).toFixed(2)}
        </span>
      ),
    },
    {
      key: 'isUrgent',
      title: '紧急',
      render: (v) => <UrgentTag urgent={Boolean(v)} />,
    },
    {
      key: 'status',
      title: '状态',
      render: (v) => <StatusBadge status={v as SalesOrderStatus} />,
    },
    {
      key: 'id',
      title: '操作',
      render: (_, row) => (
        <button
          className={styles.linkBtn}
          onClick={() => setSelectedOrderId(row.id as number)}
        >
          查看详情
        </button>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>销售订单管理</h1>
        {canCreateOrder && (
          <Button variant="primary" onClick={() => setCreateModalOpen(true)}>
            + 新建订单
          </Button>
        )}
      </div>

      {/* Pending approvals banner — admin only */}
      <PendingApprovalsBanner count={pendingCount} />

      {/* Summary cards */}
      <SummaryCards
        total={statsTotal}
        statusCounts={statusCounts}
        activeStatus={(query.status ?? '') as SalesOrderStatus | ''}
        onStatusClick={(s) => {
          // GAP-R08-05: toggle — clicking active card clears the filter
          const current = query.status ?? '';
          handleQueryChange('status', s !== '' && s === current ? undefined : (s || undefined));
        }}
      />

      {/* Filter bar */}
      <div className={styles.filterBar}>
        <input
          className={styles.searchInput}
          placeholder="搜索订单号 / 客户名称..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select
          className={styles.select}
          value={query.status ?? ''}
          onChange={(e) =>
            handleQueryChange(
              'status',
              (e.target.value as SalesOrderStatus) || undefined,
            )
          }
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          className={styles.select}
          value={query.isUrgent === undefined ? '' : String(query.isUrgent)}
          onChange={(e) => {
            const v = e.target.value;
            handleQueryChange(
              'isUrgent',
              v === '' ? undefined : v === 'true',
            );
          }}
        >
          <option value="">全部紧急度</option>
          <option value="true">紧急</option>
          <option value="false">非紧急</option>
        </select>
      </div>

      {/* Table */}
      <div className={styles.tableCard}>
        {error && (
          <div className={styles.tableError}>加载失败：{error instanceof Error ? error.message : '未知错误'}</div>
        )}
        <Table
          columns={columns}
          dataSource={orders as unknown as Record<string, unknown>[]}
          loading={loading}
          rowKey="id"
        />

        {/* Pagination */}
        {totalPages > 1 && (
          <div className={styles.pagination}>
            <button
              className={styles.pageBtn}
              disabled={(query.page ?? 1) <= 1}
              onClick={() => handlePageChange((query.page ?? 1) - 1)}
            >
              上一页
            </button>
            <span className={styles.pageInfo}>
              第 {query.page ?? 1} / {totalPages} 页，共 {total} 条
            </span>
            <button
              className={styles.pageBtn}
              disabled={(query.page ?? 1) >= totalPages}
              onClick={() => handlePageChange((query.page ?? 1) + 1)}
            >
              下一页
            </button>
          </div>
        )}
      </div>

      {/* Create Modal */}
      <CreateOrderModal
        open={createModalOpen || editingOrder !== null}
        onClose={() => {
          setCreateModalOpen(false);
          setEditingOrder(null);
        }}
        onSuccess={handleCreateSuccess}
        initialOrder={editingOrder}
      />

      {/* Detail Drawer */}
      <OrderDetailDrawer
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
        onRefresh={refresh}
        onEdit={(order) => {
          setEditingOrder(order);
        }}
      />
    </div>
  );
}
