import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  useClosePurchaseOrder,
  usePurchaseOrderDetail,
  usePurchaseOrderList,
  usePurchaseOrderTailTracking,
} from '@/api/purchase';
import type { PurchaseOrder, PurchaseOrderTailRow } from '@/types/models';
import {
  PurchaseOrderStatus,
  PurchaseOrderStatusLabel,
  type PurchaseOrderStatus as PurchaseOrderStatusType,
} from '@/types/enums';
import { usePermission } from '@/hooks/usePermission';
import { useAppStore } from '@/stores/appStore';
import request from '@/utils/request';
import Drawer from '@/components/common/Drawer';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import Table from '@/components/common/Table';
import type { Column } from '@/components/common/Table';
import StatusBadge from '@/components/common/StatusBadge';
import ProgressBar from '@/components/common/ProgressBar';
import styles from './PurchaseOrderPage.module.css';

const PAGE_SIZE = 12;

const currencyFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type FocusFilter = 'all' | 'overdue' | 'receiving' | 'received' | 'closed';
const EMPTY_PURCHASE_ORDERS: PurchaseOrder[] = [];
const EMPTY_PURCHASE_ORDER_TAILS: PurchaseOrderTailRow[] = [];

function formatDate(value?: string | null): string {
  if (!value) return '—';
  return String(value).slice(0, 10);
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  return String(value).replace('T', ' ').slice(0, 19);
}

function formatDeliveryStatus(status?: string | null): string {
  if (!status) return '—';
  if (status === 'pending') return '待质检';
  if (status === 'confirmed') return '已确认';
  if (status === 'received') return '已收货';
  return status;
}

function toNumber(value?: string | number | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value?: string | number | null): string {
  return currencyFormatter.format(toNumber(value));
}

function formatQty(value?: string | number | null): string {
  const parsed = toNumber(value);
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2);
}

function calcProgressPct(received?: string | number | null, ordered?: string | number | null): number {
  const orderedValue = toNumber(ordered);
  if (orderedValue <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((toNumber(received) / orderedValue) * 100)));
}

function resolveRiskTone(tail?: PurchaseOrderTailRow): 'danger' | 'warning' | 'safe' | 'neutral' {
  if (!tail) return 'safe';
  if (tail.overdueDays >= 7) return 'danger';
  if (tail.overdueDays > 0) return 'warning';
  return 'neutral';
}

function SummaryCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint: string;
  tone?: 'default' | 'warning' | 'danger' | 'success' | 'info';
}) {
  return (
    <article className={`${styles.summaryCard} ${styles[`summaryCard--${tone}`]}`}>
      <div className={styles.summaryCardLabel}>{label}</div>
      <div className={styles.summaryCardValue}>{value}</div>
      <div className={styles.summaryCardHint}>{hint}</div>
    </article>
  );
}

function PurchaseOrderDetailDrawer({
  orderId,
  onClose,
  onCreateDelivery,
  onRequestClose,
  canClose,
  onOpenReceipt,
  onOpenMatch,
  onOpenDelivery,
}: {
  orderId: number | null;
  onClose: (order: PurchaseOrder) => void;
  onCreateDelivery: (poId: number) => void;
  onRequestClose: () => void;
  canClose: boolean;
  onOpenReceipt: (receiptId: number | null | undefined, poId: number) => void;
  onOpenMatch: (poId: number) => void;
  onOpenDelivery: (deliveryId: number, poId: number) => void;
}) {
  const { data, isLoading } = usePurchaseOrderDetail(orderId);

  const itemSummary = useMemo(() => {
    if (!data) {
      return { ordered: 0, received: 0, gap: 0, deliveryCount: 0 };
    }
    return data.items.reduce(
      (acc, item) => {
        acc.ordered += toNumber(item.qtyOrdered);
        acc.received += toNumber(item.qtyReceived);
        acc.gap += toNumber(item.gapQty);
        acc.deliveryCount += item.deliveryHistory?.length ?? 0;
        return acc;
      },
      { ordered: 0, received: 0, gap: 0, deliveryCount: 0 },
    );
  }, [data]);
  const hasRemainingDeliverable = useMemo(() => {
    if (!data?.items?.length) return false;
    return data.items.some((item) => {
      const deliveredQty = (item.deliveryHistory ?? []).reduce((sum, history) => {
        if (String(history.deliveryStatus ?? '') === 'rejected') return sum;
        return sum + toNumber(history.qtyDelivered);
      }, 0);
      return toNumber(item.qtyOrdered) - deliveredQty > 0;
    });
  }, [data]);

  const detailSuggestionId =
    typeof data?.suggestionId === 'number' || typeof data?.suggestionId === 'string'
      ? String(data?.suggestionId)
      : null;

  return (
    <Drawer
      open={orderId !== null}
      onClose={onRequestClose}
      title={`采购订单详情${data?.poNo ? ` - ${data.poNo}` : ''}`}
      width={820}
      footer={data ? (
        <div className={styles.drawerFooter}>
          {data?.id && hasRemainingDeliverable && (data.status === PurchaseOrderStatus.CONFIRMED || data.status === PurchaseOrderStatus.PARTIAL_RECEIVED) ? (
            <Button variant="text" onClick={() => onCreateDelivery(data.id)}>录入送货</Button>
          ) : null}
          {data.id ? (
            <Button variant="text" onClick={() => onOpenMatch(data.id)}>查看三单匹配</Button>
          ) : null}
          <Button variant="ghost" onClick={onRequestClose}>关闭</Button>
          {canClose && data.status !== PurchaseOrderStatus.CANCELLED && (
            <Button variant="danger" onClick={() => onClose(data)}>手动关闭订单</Button>
          )}
        </div>
      ) : null}
    >
      {isLoading || !data ? (
        <div className={styles.drawerLoading}>正在加载订单履约详情...</div>
      ) : (
        <div className={styles.detailDrawer}>
          <section className={styles.detailHero}>
            <div className={styles.detailHeader}>
              <div className={styles.detailHeaderText}>
                <div className={styles.detailOverline}>Purchase Fulfillment</div>
                <div className={styles.detailTitleRow}>
                  <h2 className={styles.detailTitle}>{data.poNo}</h2>
                  <StatusBadge status={data.status} />
                </div>
                <p className={styles.detailSubtitle}>
                  供应商 {data.supplierName} · 创建于 {formatDateTime(data.createdAt)} · 预期到货 {formatDate(data.expectedDate)}
                </p>
              </div>
              <div className={styles.detailHeroStats}>
                <div className={styles.heroMetric}>
                  <span>订单金额</span>
                  <strong>{formatCurrency(data.totalAmount)}</strong>
                </div>
                <div className={styles.heroMetric}>
                  <span>已到货 / 订购</span>
                  <strong>{formatQty(itemSummary.received)} / {formatQty(itemSummary.ordered)}</strong>
                </div>
                <div className={styles.heroMetric}>
                  <span>剩余缺口</span>
                  <strong>{formatQty(itemSummary.gap)}</strong>
                </div>
                <div className={styles.heroMetric}>
                  <span>到货批次</span>
                  <strong>{itemSummary.deliveryCount}</strong>
                </div>
              </div>
            </div>

            {data.closeReason ? (
              <div className={styles.detailAlert}>
                当前订单已关闭。关闭原因：{data.closeReason}
              </div>
            ) : null}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h3 className={styles.sectionTitle}>订单摘要</h3>
                <p className={styles.sectionHint}>对齐产品原型中的追踪链路，强调来源、金额和关闭信息。</p>
              </div>
            </div>
            <div className={styles.metaGrid}>
              <div className={styles.kv}><span>供应商</span><strong>{data.supplierName}</strong></div>
              <div className={styles.kv}><span>履约状态</span><strong>{PurchaseOrderStatusLabel[data.status] ?? data.status}</strong></div>
              <div className={styles.kv}><span>预期到货</span><strong>{formatDate(data.expectedDate)}</strong></div>
              <div className={styles.kv}><span>创建时间</span><strong>{formatDateTime(data.createdAt)}</strong></div>
              {detailSuggestionId ? (
                <div className={styles.kv}><span>关联建议</span><strong>#{detailSuggestionId}</strong></div>
              ) : null}
              <div className={styles.kv}><span>订单总额</span><strong>{formatCurrency(data.totalAmount)}</strong></div>
              {data.closedAt ? (
                <div className={styles.kv}><span>关闭时间</span><strong>{formatDateTime(data.closedAt)}</strong></div>
              ) : null}
              {data.closedByName ? (
                <div className={styles.kv}><span>关闭人</span><strong>{data.closedByName}</strong></div>
              ) : null}
              {data.notes ? (
                <div className={`${styles.kv} ${styles.kvFull}`}>
                  <span>订单备注</span>
                  <strong>{data.notes}</strong>
                </div>
              ) : null}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h3 className={styles.sectionTitle}>采购明细与分批到货</h3>
                <p className={styles.sectionHint}>每行展示累计到货进度，并展开各次送货 / 入库记录。</p>
              </div>
            </div>
            <div className={styles.itemList}>
              {data.items.map((item) => {
                const progressPct = calcProgressPct(item.qtyReceived, item.qtyOrdered);
                return (
                  <article key={item.id ?? `${item.skuId}-${item.skuCode}`} className={styles.itemCard}>
                    <div className={styles.itemHeader}>
                      <div className={styles.itemTitleWrap}>
                        <div className={styles.itemTitle}>{item.skuName ?? `SKU#${item.skuId}`}</div>
                        <div className={styles.itemMeta}>
                          {item.skuCode ?? '—'} · 采购单位 {item.purchaseUnit}
                        </div>
                      </div>
                      <div className={styles.itemQty}>
                        {formatQty(item.qtyReceived)} / {formatQty(item.qtyOrdered)}
                      </div>
                    </div>

                    <div className={styles.itemProgressMeta}>
                      <span>履约进度</span>
                      <span>{progressPct}%</span>
                    </div>
                    <ProgressBar value={progressPct} showLabel />

                    <div className={styles.itemFooter}>
                      <span>未到货：{formatQty(item.gapQty)}</span>
                      <span>单价：{formatCurrency(item.unitPrice)}</span>
                      <span>金额：{formatCurrency(item.amount)}</span>
                    </div>

                    {item.deliveryHistory?.length ? (
                      <div className={styles.itemHistory}>
                        {item.deliveryHistory.map((history) => (
                          <div
                            key={`${history.deliveryId}-${history.receiptId ?? 'no-receipt'}`}
                            className={styles.historyRow}
                          >
                            <div className={styles.historyTop}>
                              <strong>
                                {history.deliveryNo}
                                <Button
                                  size="sm"
                                  variant="text"
                                  onClick={() => onOpenDelivery(Number(history.deliveryId), data.id)}
                                >
                                  查看送货
                                </Button>
                              </strong>
                              <span className={styles.historyMetaText}>
                                到货日期 {formatDate(history.deliveryDate)}
                              </span>
                            </div>
                            <div className={styles.historyMeta}>
                              <span>本次送货：{formatQty(history.qtyDelivered)}</span>
                              <span>送货状态：{formatDeliveryStatus(history.deliveryStatus)}</span>
                              <span>
                                入库单：{history.receiptNo ?? '—'}
                                {history.receiptId ? (
                                  <Button
                                    size="sm"
                                    variant="text"
                                    onClick={() => onOpenReceipt(Number(history.receiptId), data.id)}
                                  >
                                    查看入库
                                  </Button>
                                ) : null}
                              </span>
                              <span>本次入库：{formatQty(history.qtyReceived)}</span>
                              <span>入库时间：{formatDateTime(history.receivedAt)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.itemHistoryEmpty}>该明细尚无到货记录</div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h3 className={styles.sectionTitle}>送货与入库记录</h3>
                <p className={styles.sectionHint}>贯通送货、入库与三单匹配的后续操作入口。</p>
              </div>
            </div>
            {data.deliveries?.length ? (
              <div className={styles.deliveryList}>
                {data.deliveries.map((delivery) => (
                  <article key={delivery.id} className={styles.deliveryCard}>
                    <div className={styles.deliveryTop}>
                      <strong>
                        {delivery.deliveryNo}
                        <Button
                          size="sm"
                          variant="text"
                          onClick={() => onOpenDelivery(Number(delivery.id), data.id)}
                        >
                          查看送货
                        </Button>
                      </strong>
                      <span className={styles.deliveryStatus}>{formatDeliveryStatus(delivery.status)}</span>
                    </div>
                    <div className={styles.deliveryMeta}>
                      <span>送货日期：{formatDate(delivery.deliveryDate)}</span>
                      <span>本次送货：{formatQty(delivery.totalDelivered)}</span>
                      <span>
                        入库单：{delivery.receiptNo ?? '—'}
                        {delivery.receiptNo && delivery.receiptId ? (
                          <Button
                            size="sm"
                            variant="text"
                            onClick={() => onOpenReceipt(Number(delivery.receiptId), data.id)}
                          >
                            查看入库
                          </Button>
                        ) : null}
                      </span>
                      <span>收货时间：{formatDateTime(delivery.receivedAt)}</span>
                    </div>
                    {delivery.notes ? <div className={styles.deliveryNotes}>{delivery.notes}</div> : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.emptyHint}>暂无送货记录</div>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

export default function PurchaseOrderPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = usePermission();
  const setPageTitle = useAppStore((state) => state.setPageTitle);
  const showToast = useAppStore((state) => state.showToast);

  const canCloseOrder = can('purchase:order:close');
  const statusParam = (searchParams.get('status') || '') as PurchaseOrderStatusType | '';
  const focusParam = (searchParams.get('focus') || 'all') as FocusFilter;
  const orderIdParam = Number(searchParams.get('orderId') ?? '') || null;

  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatusType | ''>(statusParam);
  const [focusFilter, setFocusFilter] = useState<FocusFilter>(
    ['all', 'overdue', 'receiving', 'received', 'closed'].includes(focusParam) ? focusParam : 'all',
  );
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(orderIdParam);
  const [closingOrder, setClosingOrder] = useState<PurchaseOrder | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [exporting, setExporting] = useState(false);

  const deferredKeyword = useDeferredValue(keyword.trim().toLowerCase());

  const { data, isLoading } = usePurchaseOrderList(undefined, 1, 200);
  const { data: tailData, isLoading: tailLoading } = usePurchaseOrderTailTracking(1, 6);
  const closeMutation = useClosePurchaseOrder();

  useEffect(() => {
    setPageTitle('采购订单');
  }, [setPageTitle]);

  useEffect(() => {
    setStatusFilter(statusParam);
  }, [statusParam]);

  useEffect(() => {
    setSelectedId(orderIdParam);
  }, [orderIdParam]);

  useEffect(() => {
    setFocusFilter(['all', 'overdue', 'receiving', 'received', 'closed'].includes(focusParam) ? focusParam : 'all');
  }, [focusParam]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, focusFilter, keyword]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (statusFilter) next.set('status', statusFilter);
    else next.delete('status');
    if (focusFilter !== 'all') next.set('focus', focusFilter);
    else next.delete('focus');
    if (selectedId) next.set('orderId', String(selectedId));
    else next.delete('orderId');

    const nextQuery = next.toString();
    if (nextQuery !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [focusFilter, searchParams, selectedId, setSearchParams, statusFilter]);

  const orders = data?.list ?? EMPTY_PURCHASE_ORDERS;
  const tailList = tailData?.list ?? EMPTY_PURCHASE_ORDER_TAILS;

  const tailMap = useMemo(
    () => new Map<number, PurchaseOrderTailRow>(tailList.map((item) => [item.id, item])),
    [tailList],
  );

  const statusCounts = useMemo(() => ({
    all: orders.length,
    overdue: orders.filter((order) => tailMap.has(order.id)).length,
    receiving: orders.filter((order) =>
      order.status === PurchaseOrderStatus.CONFIRMED || order.status === PurchaseOrderStatus.PARTIAL_RECEIVED,
    ).length,
    received: orders.filter((order) => order.status === PurchaseOrderStatus.RECEIVED).length,
    closed: orders.filter((order) => order.status === PurchaseOrderStatus.CANCELLED).length,
  }), [orders, tailMap]);

  const summary = useMemo(() => {
    const totalAmount = orders.reduce((sum, order) => sum + toNumber(order.totalAmount), 0);
    const inTransit = orders.filter((order) =>
      order.status === PurchaseOrderStatus.CONFIRMED || order.status === PurchaseOrderStatus.PARTIAL_RECEIVED,
    ).length;
    const partial = orders.filter((order) => order.status === PurchaseOrderStatus.PARTIAL_RECEIVED).length;
    const received = orders.filter((order) => order.status === PurchaseOrderStatus.RECEIVED).length;
    const overdueAmount = tailList.reduce((sum, order) => sum + toNumber(order.totalAmount), 0);

    return {
      total: orders.length,
      inTransit,
      partial,
      received,
      overdue: tailList.length,
      overdueAmount,
      totalAmount,
    };
  }, [orders, tailList]);

  const spotlightOrder = tailList[0] ?? null;

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const tail = tailMap.get(order.id);
      const matchesStatus = !statusFilter || order.status === statusFilter;
      const matchesFocus =
        focusFilter === 'all' ||
        (focusFilter === 'overdue' && Boolean(tail)) ||
        (focusFilter === 'receiving' &&
          (order.status === PurchaseOrderStatus.CONFIRMED ||
            order.status === PurchaseOrderStatus.PARTIAL_RECEIVED)) ||
        (focusFilter === 'received' && order.status === PurchaseOrderStatus.RECEIVED) ||
        (focusFilter === 'closed' && order.status === PurchaseOrderStatus.CANCELLED);

      if (!matchesStatus || !matchesFocus) return false;

      if (!deferredKeyword) return true;

      const haystack = [
        order.poNo,
        order.supplierName,
        order.notes,
        order.closeReason,
        PurchaseOrderStatusLabel[order.status],
        tail?.totalGap,
        tail?.overdueDays,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(deferredKeyword);
    });
  }, [deferredKeyword, focusFilter, orders, statusFilter, tailMap]);

  const pagedOrders = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredOrders.slice(start, start + PAGE_SIZE);
  }, [filteredOrders, page]);

  const openCloseModal = useCallback((order: PurchaseOrder) => {
    setClosingOrder(order);
    setCloseReason('');
  }, []);

  const handleConfirmClose = useCallback(async () => {
    if (!closingOrder) return;
    if (!closeReason.trim()) {
      showToast({ type: 'warning', message: '请先填写关闭原因，再确认关闭采购订单' });
      return;
    }
    try {
      await closeMutation.mutateAsync({
        id: closingOrder.id,
        payload: { reason: closeReason.trim() },
      });
      setClosingOrder(null);
      setCloseReason('');
      showToast({ type: 'success', message: '采购订单已关闭' });
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message ?? '关闭采购订单失败，请稍后重试' });
    }
  }, [closeMutation, closeReason, closingOrder, showToast]);

  const handleExport = useCallback(async () => {
    try {
      setExporting(true);
      const blob = await request.downloadBlob('/api/purchase/orders/export/csv');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `采购订单_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast({ type: 'success', message: '采购订单已导出' });
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message ?? '导出失败，请稍后重试' });
    } finally {
      setExporting(false);
    }
  }, [showToast]);

  const columns: Column<PurchaseOrder>[] = useMemo(() => [
    {
      key: 'poNo',
      title: '采购单',
      width: 210,
      render: (_value, record) => (
        <div className={styles.orderIdentity}>
          <button type="button" className={styles.orderNo} onClick={() => setSelectedId(record.id)}>
            {record.poNo}
          </button>
          <div className={styles.orderSub}>创建于 {formatDateTime(record.createdAt)}</div>
        </div>
      ),
    },
    {
      key: 'supplierName',
      title: '供应商 / 备注',
      width: 220,
      render: (_value, record) => (
        <div className={styles.supplierBlock}>
          <div className={styles.supplierName}>{record.supplierName}</div>
          <div className={styles.supplierNote}>{record.closeReason || record.notes || '暂无备注'}</div>
        </div>
      ),
    },
    {
      key: 'status',
      title: '履约状态',
      width: 160,
      render: (_value, record) => (
        <div className={styles.statusCluster}>
          <StatusBadge status={record.status} />
          <span className={styles.orderSub}>预期到货 {formatDate(record.expectedDate)}</span>
        </div>
      ),
    },
    {
      key: 'totalAmount',
      title: '采购金额',
      width: 140,
      align: 'right',
      render: (value) => (
        <div className={styles.amountBlock}>
          <div className={styles.amountMain}>{formatCurrency(value as string)}</div>
          <div className={styles.amountSub}>订单总额</div>
        </div>
      ),
    },
    {
      key: 'id',
      title: '催货信号',
      width: 180,
      render: (_value, record) => {
        const tail = tailMap.get(record.id);
        const tone = resolveRiskTone(tail);
        const label = tail
          ? `已超期 ${tail.overdueDays} 天`
          : record.status === PurchaseOrderStatus.RECEIVED
            ? '已完成到货'
            : record.status === PurchaseOrderStatus.CANCELLED
              ? '已手动关闭'
              : '按计划推进';
        const caption = tail
          ? `当前缺口 ${formatQty(tail.totalGap)}`
          : record.status === PurchaseOrderStatus.PARTIAL_RECEIVED
            ? '仍有尾单待催'
            : record.status === PurchaseOrderStatus.CONFIRMED
              ? '等待首批送货'
              : '无异常';

        return (
          <div>
            <span className={`${styles.riskChip} ${styles[`riskChip--${tone}`]}`}>{label}</span>
            <div className={styles.riskCaption}>{caption}</div>
          </div>
        );
      },
    },
    {
      key: 'id',
      title: '操作',
      width: 220,
      render: (_value, record) => (
        <div className={styles.actions}>
          <Button size="sm" variant="text" onClick={() => setSelectedId(record.id)}>详情</Button>
          {(record.status === PurchaseOrderStatus.CONFIRMED || record.status === PurchaseOrderStatus.PARTIAL_RECEIVED) ? (
            <Button
              size="sm"
              variant="text"
              onClick={() => navigate(`/purchase/deliveries?poId=${record.id}&create=1`)}
            >
              送货
            </Button>
          ) : null}
          <Button size="sm" variant="text" onClick={() => navigate(`/purchase/match?poId=${record.id}`)}>
            匹配
          </Button>
          {canCloseOrder && record.status !== PurchaseOrderStatus.CANCELLED && (
            <Button size="sm" variant="danger" onClick={() => openCloseModal(record)}>关闭</Button>
          )}
        </div>
      ),
    },
  ], [canCloseOrder, navigate, openCloseModal, tailMap]);

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.heroEyebrow}>Purchase Operations</div>
          <h1 className={styles.heroTitle}>采购订单履约中心</h1>
          <p className={styles.heroSubtitle}>
            查看集中到货节奏、尾单风险和异常关闭处理。
          </p>

          <div className={styles.heroMeta}>
            <div className={styles.heroMetaItem}>
              <span>当前订单池</span>
              <strong>{summary.total} 张</strong>
            </div>
            <div className={styles.heroMetaItem}>
              <span>超期待催金额</span>
              <strong>{formatCurrency(summary.overdueAmount)}</strong>
            </div>
            <div className={styles.heroMetaItem}>
              <span>已完成到货</span>
              <strong>{summary.received} 张</strong>
            </div>
          </div>

          <div className={styles.heroActions}>
            <Button variant="ghost" onClick={() => navigate('/purchase/match')}>
              查看三单匹配
            </Button>
            <Button variant="primary" onClick={() => void handleExport()} loading={exporting}>
              导出 CSV
            </Button>
          </div>
        </div>

        <aside className={styles.heroSpotlight}>
          <div className={styles.spotlightKicker}>优先处理</div>
          {spotlightOrder ? (
            <>
              <div className={styles.spotlightTitle}>{spotlightOrder.poNo}</div>
              <div className={styles.spotlightMeta}>
                <span>{spotlightOrder.supplierName}</span>
                <span>已超期 {spotlightOrder.overdueDays} 天</span>
              </div>
              <div className={styles.spotlightHint}>
                缺口 {formatQty(spotlightOrder.totalGap)}，订单金额 {formatCurrency(spotlightOrder.totalAmount)}
              </div>
              <Button variant="danger" onClick={() => setSelectedId(spotlightOrder.id)}>
                打开详情并催货
              </Button>
            </>
          ) : (
            <>
              <div className={styles.spotlightTitle}>当前无超期尾单</div>
              <div className={styles.spotlightHint}>可以优先查看在途订单的首批到货节奏。</div>
            </>
          )}
        </aside>
      </section>

      <div className={styles.summaryGrid}>
        <SummaryCard
          label="在途订单"
          value={summary.inTransit}
          hint="包含待到货与部分到货"
          tone="info"
        />
        <SummaryCard
          label="部分到货"
          value={summary.partial}
          hint="需持续盯住缺口与下一批送货"
          tone="warning"
        />
        <SummaryCard
          label="超期待催"
          value={summary.overdue}
          hint="尾单已超过预期到货时间"
          tone="danger"
        />
        <SummaryCard
          label="订单总额"
          value={formatCurrency(summary.totalAmount)}
          hint="当前加载范围内的采购金额"
          tone="success"
        />
      </div>

      <div className={styles.workspace}>
        <section className={styles.mainPanel}>
          <div className={styles.panelHeader}>
            <div className={styles.panelHeaderStack}>
              <div className={styles.panelTitle}>采购订单列表</div>
              <div className={styles.panelDesc}>按状态、风险和关键词筛选，快速进入订单详情或异常关闭处理。</div>
            </div>
            <div className={styles.resultMeta}>
              当前展示 {filteredOrders.length} / {orders.length} 张订单
            </div>
          </div>

          <div className={styles.filterBar}>
            <label className={styles.searchBox}>
              <span className={styles.searchIcon}>⌕</span>
              <input
                className={styles.searchInput}
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索采购单号、供应商、备注、关闭原因"
              />
            </label>

            <div className={styles.selectWrap}>
              <select
                className={styles.select}
                value={statusFilter}
                onChange={(event) => setStatusFilter((event.target.value || '') as PurchaseOrderStatusType | '')}
              >
                <option value="">全部状态</option>
                <option value={PurchaseOrderStatus.CONFIRMED}>待到货</option>
                <option value={PurchaseOrderStatus.PARTIAL_RECEIVED}>部分到货</option>
                <option value={PurchaseOrderStatus.RECEIVED}>已收货</option>
                <option value={PurchaseOrderStatus.CANCELLED}>已关闭</option>
              </select>
            </div>
          </div>

          <div className={styles.focusTabs}>
            {[
              { key: 'all', label: '全部' },
              { key: 'overdue', label: '待催货' },
              { key: 'receiving', label: '履约中' },
              { key: 'received', label: '已完成' },
              { key: 'closed', label: '已关闭' },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                className={`${styles.focusTab} ${focusFilter === item.key ? styles['focusTab--active'] : ''}`}
                onClick={() => setFocusFilter(item.key as FocusFilter)}
              >
                <span>{item.label}</span>
                <strong>{statusCounts[item.key as FocusFilter]}</strong>
              </button>
            ))}
          </div>

          <Table<PurchaseOrder>
            className={styles.ordersTable}
            columns={columns}
            dataSource={pagedOrders}
            rowKey="id"
            loading={isLoading}
            pagination={{ page, pageSize: PAGE_SIZE, total: filteredOrders.length, onChange: setPage }}
            emptyText="暂无符合条件的采购订单"
            rowClassName={(record) => {
              if (tailMap.has(record.id)) return styles.rowOverdue;
              if (record.status === PurchaseOrderStatus.CANCELLED) return styles.rowCancelled;
              return '';
            }}
          />
        </section>

        <aside className={styles.rail}>
          <section className={styles.sidePanel}>
            <div className={styles.panelHeaderStack}>
              <div className={styles.panelTitle}>尾单催货看板</div>
              <div className={styles.panelDesc}>对齐用户故事里的超期 partial_received 订单视图。</div>
            </div>

            {tailLoading ? (
              <div className={styles.railEmpty}>正在加载尾单数据...</div>
            ) : tailList.length ? (
              <div className={styles.railList}>
                {tailList.map((row) => (
                  <article key={row.id} className={styles.railCard}>
                    <div className={styles.railCardTop}>
                      <div>
                        <div className={styles.railCardTitle}>{row.poNo}</div>
                        <div className={styles.railCardMeta}>{row.supplierName}</div>
                      </div>
                      <span className={`${styles.riskChip} ${styles[`riskChip--${resolveRiskTone(row)}`]}`}>
                        超期 {row.overdueDays} 天
                      </span>
                    </div>

                    <div className={styles.railCardBody}>
                      <ProgressBar value={calcProgressPct(row.totalReceived, row.totalOrdered)} showLabel />
                      <div className={styles.railCardMeta}>
                        已到货 {formatQty(row.totalReceived)} / {formatQty(row.totalOrdered)}
                      </div>
                      <div className={styles.railCardMeta}>
                        缺口 {formatQty(row.totalGap)} · 金额 {formatCurrency(row.totalAmount)}
                      </div>
                    </div>

                    <div className={styles.railCardFooter}>
                      <span>预期到货 {formatDate(row.expectedDate)}</span>
                      <Button size="sm" variant="text" onClick={() => setSelectedId(row.id)}>查看详情</Button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.railEmpty}>暂无超期尾单，当前到货节奏正常。</div>
            )}
          </section>

          <section className={styles.sidePanel}>
            <div className={styles.panelHeaderStack}>
              <div className={styles.panelTitle}>协同链路</div>
              <div className={styles.panelDesc}>把采购订单放回完整履约流程里，而不是孤立看列表。</div>
            </div>

            <div className={styles.flowList}>
              <div className={styles.flowStep}>
                <span className={styles.flowIndex}>1</span>
                <div className={styles.flowCopy}>
                  <strong>审批后下单</strong>
                  <span>采购建议审批通过后生成采购订单，订单状态进入待到货。</span>
                </div>
              </div>
              <div className={styles.flowStep}>
                <span className={styles.flowIndex}>2</span>
                <div className={styles.flowCopy}>
                  <strong>分批送货 / 入库</strong>
                  <span>供应商可多次送货，订单详情页持续累计到货进度与入库记录。</span>
                </div>
              </div>
              <div className={styles.flowStep}>
                <span className={styles.flowIndex}>3</span>
                <div className={styles.flowCopy}>
                  <strong>尾单催货 / 手动关闭</strong>
                  <span>超期尾单进入催货看板，异常订单由主管填写原因后手动关闭。</span>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <PurchaseOrderDetailDrawer
        orderId={selectedId}
        onRequestClose={() => setSelectedId(null)}
        onClose={openCloseModal}
        onCreateDelivery={(poId) => {
          navigate(`/purchase/deliveries?poId=${poId}&create=1`);
        }}
        canClose={canCloseOrder}
        onOpenReceipt={(receiptId, poId) => {
          if (!receiptId) return;
          navigate(`/purchase/receipts?receiptId=${receiptId}&poId=${poId}`);
        }}
        onOpenMatch={(poId) => {
          navigate(`/purchase/match?poId=${poId}`);
        }}
        onOpenDelivery={(deliveryId, poId) => {
          navigate(`/purchase/deliveries?deliveryId=${deliveryId}&poId=${poId}`);
        }}
      />

      <Modal
        open={closingOrder !== null}
        onClose={() => {
          setClosingOrder(null);
          setCloseReason('');
        }}
        title={`关闭采购订单${closingOrder?.poNo ? ` - ${closingOrder.poNo}` : ''}`}
        onConfirm={() => void handleConfirmClose()}
        confirmLoading={closeMutation.isPending}
        confirmVariant="danger"
        confirmLabel="确认关闭"
        footer={(
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setClosingOrder(null);
                setCloseReason('');
              }}
            >
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => void handleConfirmClose()}
              loading={closeMutation.isPending}
              disabled={!closeReason.trim()}
            >
              确认关闭
            </Button>
          </>
        )}
      >
        <div className={styles.closeModal}>
          <p className={styles.closeHint}>
            关闭后该订单将不再允许继续录入送货单。根据产品交互要求，关闭原因必须明确记录，便于后续复盘尾单与尾款处理。
          </p>
          <textarea
            className={styles.textarea}
            value={closeReason}
            onChange={(event) => setCloseReason(event.target.value)}
            maxLength={200}
            placeholder="例如：供应商停供，尾单改由其他供应商补货"
            rows={4}
          />
          {!closeReason.trim() ? (
            <div className={styles.validationHint}>请填写关闭原因后再确认关闭。</div>
          ) : null}
          <div className={styles.textareaMeta}>{closeReason.trim().length}/200</div>
        </div>
      </Modal>
    </div>
  );
}
