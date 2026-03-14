import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
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
  useSubmitSalesOrder,
  useApproveSalesOrder,
  useRejectSalesOrder,
  useWithdrawSalesOrder,
  useShipSalesOrder,
  useCompleteSalesOrder,
  useCloseSalesOrder,
  useCreateProductionOrders,
} from '@/api/salesOrder';
import type {
  SalesOrder,
  SalesOrderItem,
  SalesOrderStatus,
  SalesOrderListQuery,
  CreateSalesOrderPayload,
} from '@/api/salesOrder';
import { useCustomerOptions } from '@/api/customer';
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
  in_production: '生产中',
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
  // For 'closed', show all steps as completed (green) and add a callout below.
  const isClosed = currentStatus === 'closed';
  const effectiveStatus: SalesOrderStatus = isClosed ? 'completed' : currentStatus;
  const currentIndex = TIMELINE_STEPS.findIndex((s) => s.key === effectiveStatus);

  return (
    <div>
      <div className={styles.statusTimeline}>
        {TIMELINE_STEPS.map((step, idx) => {
          const isCompleted = idx < currentIndex;
          const isActive    = idx === currentIndex && !isClosed;

          // Dot appearance
          let dotBg: string;
          let dotBorder: string;
          let dotContent: React.ReactNode;

          if (isClosed || isCompleted) {
            dotBg     = 'var(--color-success-600, #16a34a)';
            dotBorder = 'var(--color-success-600, #16a34a)';
            dotContent = (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M2 5.5l2.2 2.2L8 3" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            );
          } else if (isActive) {
            dotBg     = 'var(--color-primary-600, #2563eb)';
            dotBorder = 'var(--color-primary-600, #2563eb)';
            dotContent = (
              <span
                style={{
                  display: 'block',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: '#fff',
                }}
              />
            );
          } else {
            dotBg     = '#fff';
            dotBorder = 'var(--color-gray-300, #d1d5db)';
            dotContent = null;
          }

          // Line after this step is green only if both this step and the next
          // are completed (i.e., the line is fully "passed").
          const lineCompleted = isClosed || idx < currentIndex - 1 || (isCompleted && idx === currentIndex - 1);
          const lineColor = lineCompleted
            ? 'var(--color-success-600, #16a34a)'
            : 'var(--color-gray-300, #d1d5db)';

          return (
            <div key={step.key} className={styles.timelineStepWrapper}>
              {/* Step node */}
              <div className={styles.timelineStep}>
                <div
                  className={styles.timelineDot}
                  style={{
                    background: dotBg,
                    borderColor: dotBorder,
                  }}
                >
                  {dotContent}
                </div>
                <span
                  className={styles.timelineLabel}
                  style={{
                    color: (isClosed || isCompleted)
                      ? 'var(--color-success-600, #16a34a)'
                      : isActive
                        ? 'var(--color-primary-600, #2563eb)'
                        : 'var(--color-gray-400, #9ca3af)',
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector line — only between steps */}
              {idx < TIMELINE_STEPS.length - 1 && (
                <div
                  className={styles.timelineLine}
                  style={{ background: lineColor }}
                />
              )}
            </div>
          );
        })}
      </div>

      {isClosed && (
        <div className={styles.timelineClosedNote}>
          此订单已关闭
        </div>
      )}
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

// ---------------------------------------------------------------------------
// Create Order Modal
// ---------------------------------------------------------------------------

interface CreateOrderModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function CreateOrderModal({ open, onClose, onSuccess }: CreateOrderModalProps) {
  const { data: customerList = [] } = useCustomerOptions();
  const createOrder = useCreateSalesOrder();

  const [customerId, setCustomerId] = useState<number | ''>('');
  const [orderDate, setOrderDate] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [items, setItems] = useState<DraftLineItem[]>([emptyLineItem()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleReset = useCallback(() => {
    setCustomerId('');
    setOrderDate('');
    setDeliveryDate('');
    setUrgent(false);
    setItems([emptyLineItem()]);
    setError('');
  }, []);

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

  const handleSubmit = async () => {
    if (!customerId) { setError('请选择客户'); return; }
    if (!orderDate) { setError('请选择订单日期'); return; }
    if (!deliveryDate) { setError('请选择交期'); return; }
    if (items.length === 0) { setError('请至少添加一个产品行'); return; }
    for (const item of items) {
      if (!item.productCode || !item.productName) {
        setError('请填写所有产品编号和名称');
        return;
      }
      if (item.quantity <= 0) { setError('产品数量必须大于0'); return; }
    }

    const payload: CreateSalesOrderPayload = {
      customerId: customerId as number,
      orderDate,
      deliveryDate,
      isUrgent: urgent,
      items: items.map((it) => ({
        skuId: it.skuId as number,
        productName: it.productName,
        quantity: it.quantity,
        unit: it.unit,
        unitPrice: String(it.unitPrice),
      })),
    };

    try {
      setSubmitting(true);
      setError('');
      await createOrder.mutateAsync(payload);
      handleReset();
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '创建失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const totalAmount = items.reduce(
    (sum, it) => sum + it.quantity * it.unitPrice,
    0,
  );

  return (
    <Modal open={open} onClose={handleClose} title="新建销售订单" size="lg" hideFooter>
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

      {/* Line Items */}
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
                <th>产品编号</th>
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
                    <input
                      className={styles.cellInput}
                      value={item.productCode}
                      onChange={(e) => updateItem(idx, 'productCode', e.target.value)}
                      placeholder="编号"
                    />
                  </td>
                  <td>
                    <input
                      className={styles.cellInput}
                      value={item.productName}
                      onChange={(e) => updateItem(idx, 'productName', e.target.value)}
                      placeholder="名称"
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
                      onChange={(e) => updateItem(idx, 'unit', e.target.value)}
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

      {error && <div className={styles.formError}>{error}</div>}

      <div className={styles.modalFooter}>
        <Button variant="secondary" onClick={handleClose} disabled={submitting}>
          取消
        </Button>
        <Button variant="primary" onClick={handleSubmit} loading={submitting}>
          创建订单
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
}

function OrderDetailDrawer({ orderId, onClose, onRefresh }: OrderDetailDrawerProps) {
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
  const [closeReason, setCloseReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

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

  const renderActions = (o: SalesOrder) => {
    const id = o.id;
    switch (o.status) {
      case 'draft':
        return (
          <div className={styles.actionGroup}>
            {/* 提交审批: boss, supervisor, sales */}
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
            {/* 关闭: boss only */}
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
            {/* 确认订单 / 触发建工单: boss only */}
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
            {/* 发货: boss, supervisor */}
            {canShip && (
              <Button
                size="sm"
                variant="secondary"
                loading={actionLoading}
                onClick={() => handleAction(() => shipOrder.mutateAsync(id))}
              >
                标记发货
              </Button>
            )}
            {/* 关闭: boss only */}
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
            {/* 发货: boss, supervisor */}
            {canShip && (
              <Button
                size="sm"
                variant="primary"
                loading={actionLoading}
                onClick={() => handleAction(() => shipOrder.mutateAsync(id))}
              >
                标记发货
              </Button>
            )}
            {/* 关闭: boss only */}
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
            {/* 完成: boss, supervisor */}
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
            {/* 关闭: boss only */}
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
        width={560}
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

            {/* Actions */}
            <div className={styles.drawerSection}>
              <div className={styles.drawerSectionTitle}>状态操作</div>
              {actionError && (
                <div className={styles.formError}>{actionError}</div>
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
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={handleCreateSuccess}
      />

      {/* Detail Drawer */}
      <OrderDetailDrawer
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
        onRefresh={refresh}
      />
    </div>
  );
}
