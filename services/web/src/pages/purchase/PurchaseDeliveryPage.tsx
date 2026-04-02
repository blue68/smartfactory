import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  purchaseApi,
  purchaseKeys,
  useCreatePurchaseDelivery,
  useExecuteThreeWayMatch,
  usePurchaseDeliveryDetail,
  usePurchaseDeliveryList,
  usePurchaseOrderDetail,
} from '@/api/purchase';
import { useCreateInspection } from '@/api/incomingInspection';
import { usePermission } from '@/hooks/usePermission';
import { useAppStore } from '@/stores/appStore';
import type { CreateDeliveryNotePayload, DeliveryNote } from '@/types/models';
import { PurchaseOrderStatusLabel } from '@/types/enums';
import Drawer from '@/components/common/Drawer';
import Modal from '@/components/common/Modal';
import Table from '@/components/common/Table';
import type { Column } from '@/components/common/Table';
import Button from '@/components/common/Button';
import styles from './PurchaseDeliveryPage.module.css';

const EMPTY_DELIVERIES: DeliveryNote[] = [];

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

function formatMatchStatus(status?: string | null): string {
  if (!status) return '待匹配';
  if (status === 'matched' || status === 'confirmed') return '已匹配';
  if (status === 'qty_diff') return '数量差异';
  if (status === 'price_diff') return '价格差异';
  if (status === 'price_warning') return '价格预警';
  return status;
}

function toNumber(value?: string | number | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatQty(value?: string | number | null): string {
  const parsed = toNumber(value);
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2);
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

interface DeliveryEventItem {
  key: string;
  time: string;
  title: string;
  description: string;
  tone: 'neutral' | 'success' | 'warning';
}

interface DeliveryCreateItemForm {
  lineKey: string;
  skuId: number;
  skuCode?: string;
  skuName?: string;
  hasDyeLot?: boolean;
  purchaseUnit: string;
  unitPrice: string;
  remainingQty: string;
  qtyDelivered: string;
  dyeLotNo: string;
}

function buildCreateItemLineKey(item: {
  skuId: number;
  purchaseUnit?: string | null;
  unitPrice?: string | number | null;
}): string {
  return [
    String(item.skuId),
    String(item.purchaseUnit ?? ''),
    toNumber(item.unitPrice).toFixed(4),
  ].join('::');
}

function getAllocatedQtyForLine(items: DeliveryCreateItemForm[], lineKey: string): number {
  return items
    .filter((item) => item.lineKey === lineKey)
    .reduce((sum, item) => sum + toNumber(item.qtyDelivered), 0);
}

function toTimelineTimestamp(value?: string | null): number {
  if (!value) return 0;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const ts = new Date(normalized).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function buildDeliveryEvents(delivery: DeliveryNote): DeliveryEventItem[] {
  const events: DeliveryEventItem[] = [];

  if (delivery.createdAt || delivery.deliveryDate) {
    events.push({
      key: 'delivery-created',
      time: delivery.createdAt ?? delivery.deliveryDate ?? '',
      title: '送货单登记',
      description: delivery.creatorName
        ? `${delivery.creatorName} 已登记送货单 ${delivery.deliveryNo}`
        : `送货单 ${delivery.deliveryNo} 已登记`,
      tone: 'neutral',
    });
  }

  if (delivery.deliveryDate) {
    events.push({
      key: 'delivery-arrived',
      time: delivery.deliveryDate,
      title: '供应商送货',
      description: `${delivery.supplierName ?? '供应商'} 已完成本次送货`,
      tone: 'neutral',
    });
  }

  if (delivery.inspectionId) {
    events.push({
      key: 'inspection-created',
      time: delivery.inspectionCreatedAt ?? delivery.createdAt ?? delivery.deliveryDate ?? '',
      title: '来料质检',
      description: `已创建质检单 ${delivery.inspectionNo ?? `#${delivery.inspectionId}`}`,
      tone: 'warning',
    });
  }

  if (delivery.receiptId && delivery.receivedAt) {
    events.push({
      key: 'receipt-created',
      time: delivery.receivedAt,
      title: '入库完成',
      description: `已生成入库单 ${delivery.receiptNo ?? `#${delivery.receiptId}`}`,
      tone: 'success',
    });
  }

  if (delivery.matchId) {
    const isMatched = delivery.matchStatus === 'matched' || delivery.matchStatus === 'confirmed';
    events.push({
      key: 'match-created',
      time: delivery.matchConfirmedAt ?? delivery.matchCreatedAt ?? delivery.receivedAt ?? delivery.deliveryDate ?? '',
      title: isMatched ? '三单匹配完成' : '三单匹配差异',
      description: isMatched
        ? `匹配记录 #${delivery.matchId} 已确认`
        : `匹配记录 #${delivery.matchId} 当前状态：${formatMatchStatus(delivery.matchStatus)}`,
      tone: isMatched ? 'success' : 'warning',
    });
  }

  return events
    .filter((event) => Boolean(event.time))
    .sort((a, b) => toTimelineTimestamp(a.time) - toTimelineTimestamp(b.time));
}

function buildCreateItems(order?: { items?: Array<Record<string, unknown>> } | null): DeliveryCreateItemForm[] {
  return (order?.items ?? [])
    .map((item) => {
      const deliveredQty = (Array.isArray(item.deliveryHistory) ? item.deliveryHistory : []).reduce(
        (sum, history) => {
          if (String(history?.deliveryStatus ?? '') === 'rejected') return sum;
          return sum + toNumber(history?.qtyDelivered as string | number | null);
        },
        0,
      );
      const remainingQty = formatQty(
        Math.max(
          toNumber(item.qtyOrdered as string | number | null) - deliveredQty,
          0,
        ),
      );
      return {
        lineKey: buildCreateItemLineKey({
          skuId: Number(item.skuId),
          purchaseUnit: String(item.purchaseUnit ?? ''),
          unitPrice: item.unitPrice as string | number | null,
        }),
        skuId: Number(item.skuId),
        skuCode: String(item.skuCode ?? ''),
        skuName: String(item.skuName ?? ''),
        hasDyeLot: Boolean(item.hasDyeLot),
        purchaseUnit: String(item.purchaseUnit ?? ''),
        // 后端校验要求送货单单价为最多 2 位小数，订单详情通常返回 4 位小数。
        unitPrice: toNumber(item.unitPrice as string | number | null).toFixed(2),
        remainingQty,
        qtyDelivered: toNumber(item.gapQty as string | number | null) > 0 ? remainingQty : '0',
        dyeLotNo: '',
      };
    })
    .filter((item) => toNumber(item.remainingQty) > 0);
}

interface InspectionCreateTarget {
  deliveryId: number;
  deliveryNo?: string;
  poId: number;
  poNo?: string;
}

interface MatchExecuteTarget {
  deliveryId: number;
  deliveryNo?: string;
  poId: number;
  poNo?: string;
  receiptId: number;
  receiptNo?: string;
}

function CreateInspectionModal({
  open,
  target,
  onClose,
}: {
  open: boolean;
  target: InspectionCreateTarget | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const showToast = useAppStore((state) => state.showToast);
  const createMutation = useCreateInspection();
  const [inspectionDate, setInspectionDate] = useState(todayDateString());
  const [notes, setNotes] = useState('');
  const { data: order } = usePurchaseOrderDetail(open ? target?.poId ?? null : null);
  const { data: delivery } = usePurchaseDeliveryDetail(open ? target?.deliveryId ?? null : null);

  useEffect(() => {
    if (!open) return;
    setInspectionDate(todayDateString());
    setNotes('');
  }, [open, target?.deliveryId]);

  const handleSubmit = async () => {
    if (!target?.poId || !target?.deliveryId) {
      showToast({ type: 'warning', message: '缺少送货单上下文，无法创建质检单' });
      return;
    }

    const poId = Number(target.poId);
    const deliveryId = Number(target.deliveryId);
    if (!Number.isFinite(poId) || !Number.isFinite(deliveryId)) {
      showToast({ type: 'warning', message: '送货单上下文无效，无法创建质检单' });
      return;
    }

    try {
      const result = await createMutation.mutateAsync({
        poId,
        deliveryNoteId: deliveryId,
        inspectorId: 1,
        inspectionDate,
        notes: notes.trim() || undefined,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: purchaseKeys.deliveries() }),
        queryClient.invalidateQueries({ queryKey: purchaseKeys.deliveryDetail(deliveryId) }),
        queryClient.invalidateQueries({ queryKey: purchaseKeys.orderDetail(poId) }),
      ]);
      showToast({ type: 'success', message: `来料质检单 ${result.inspectionNo} 已创建` });
      onClose();
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message ?? '创建质检单失败' });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建来料质检单"
      size="md"
      footer={(
        <div className={styles.createModalFooter}>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={() => void handleSubmit()} loading={createMutation.isPending}>创建</Button>
        </div>
      )}
    >
      <div className={styles.createModal}>
        <div className={styles.createGrid}>
          <label className={styles.createField}>
            <span className={styles.createLabel}>采购订单单号</span>
            <input
              className={styles.createInput}
              value={target?.poNo ?? order?.poNo ?? ''}
              placeholder="系统将自动带出采购订单单号"
              readOnly
            />
          </label>

          <label className={styles.createField}>
            <span className={styles.createLabel}>送货单号</span>
            <input
              className={styles.createInput}
              value={target?.deliveryNo ?? delivery?.deliveryNo ?? ''}
              placeholder="系统将自动带出送货单号"
              readOnly
            />
          </label>
        </div>

        <div className={styles.createGrid}>
          <label className={styles.createField}>
            <span className={styles.createLabel}>质检日期</span>
            <input
              type="date"
              className={styles.createInput}
              value={inspectionDate}
              onChange={(event) => setInspectionDate(event.target.value)}
            />
          </label>

          <label className={styles.createField}>
            <span className={styles.createLabel}>供应商</span>
            <input
              className={styles.createInput}
              value={delivery?.supplierName ?? order?.supplierName ?? ''}
              placeholder="系统将自动带出供应商"
              readOnly
            />
          </label>
        </div>

        <label className={styles.createField}>
          <span className={styles.createLabel}>备注</span>
          <textarea
            className={styles.createTextarea}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
            maxLength={500}
            placeholder="请输入备注（可选）"
          />
        </label>
      </div>
    </Modal>
  );
}

function ExecuteMatchModal({
  open,
  target,
  onClose,
}: {
  open: boolean;
  target: MatchExecuteTarget | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const showToast = useAppStore((state) => state.showToast);
  const executeMutation = useExecuteThreeWayMatch();

  const handleSubmit = async () => {
    if (!target?.poId || !target.deliveryId || !target.receiptId) {
      showToast({ type: 'warning', message: '缺少匹配上下文，无法执行三单匹配' });
      return;
    }

    try {
      const result = await executeMutation.mutateAsync({
        poId: Number(target.poId),
        deliveryNoteId: Number(target.deliveryId),
        receiptId: Number(target.receiptId),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: purchaseKeys.matches() }),
        queryClient.invalidateQueries({ queryKey: purchaseKeys.deliveries() }),
        queryClient.invalidateQueries({ queryKey: purchaseKeys.deliveryDetail(Number(target.deliveryId)) }),
        queryClient.invalidateQueries({ queryKey: purchaseKeys.receipts() }),
        queryClient.invalidateQueries({ queryKey: purchaseKeys.receiptDetail(Number(target.receiptId)) }),
      ]);
      if (result.matchStatus === 'matched' || result.matchStatus === 'confirmed') {
        showToast({ type: 'success', message: '三单完全匹配，已自动完成' });
      } else {
        showToast({ type: 'warning', message: '已执行三单匹配，请到三单匹配页确认差异' });
      }
      onClose();
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message ?? '执行三单匹配失败' });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="执行三单匹配"
      size="md"
      footer={(
        <div className={styles.createModalFooter}>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={() => void handleSubmit()} loading={executeMutation.isPending}>执行匹配</Button>
        </div>
      )}
    >
      <div className={styles.createModal}>
        <div className={styles.createGrid}>
          <label className={styles.createField}>
            <span className={styles.createLabel}>采购订单号</span>
            <input
              className={styles.createInput}
              value={target?.poNo ?? ''}
              placeholder="系统将自动带出采购订单号"
              readOnly
            />
          </label>

          <label className={styles.createField}>
            <span className={styles.createLabel}>送货单号</span>
            <input
              className={styles.createInput}
              value={target?.deliveryNo ?? ''}
              placeholder="系统将自动带出送货单号"
              readOnly
            />
          </label>
        </div>

        <label className={styles.createField}>
          <span className={styles.createLabel}>入库单号</span>
          <input
            className={styles.createInput}
            value={target?.receiptNo ?? ''}
            placeholder="系统将自动带出入库单号"
            readOnly
          />
        </label>
      </div>
    </Modal>
  );
}

function DeliveryDetailDrawer({
  deliveryId,
  onClose,
  onCreateInspection,
  onExecuteMatch,
}: {
  deliveryId: number | null;
  onClose: () => void;
  onCreateInspection: (target: InspectionCreateTarget) => void;
  onExecuteMatch: (target: MatchExecuteTarget) => void;
}) {
  const navigate = useNavigate();
  const { data, isLoading } = usePurchaseDeliveryDetail(deliveryId);
  const events = useMemo(() => (data ? buildDeliveryEvents(data) : []), [data]);

  return (
    <Drawer
      open={deliveryId !== null}
      onClose={onClose}
      title={`送货单详情${data?.deliveryNo ? ` - ${data.deliveryNo}` : ''}`}
      width={760}
      footer={
        <div className={styles.drawerFooter}>
          {data?.poId ? (
            <Button variant="text" onClick={() => navigate(`/purchase/orders?orderId=${data.poId}`)}>
              查看采购订单
            </Button>
          ) : null}
          {data?.receiptId ? (
            <Button variant="text" onClick={() => navigate(`/purchase/receipts?receiptId=${data.receiptId}&poId=${data.poId}`)}>
              查看入库单
            </Button>
          ) : null}
          {data?.poId ? (
            <Button
              variant="text"
              onClick={() => {
                if (data.matchId) {
                  navigate(`/purchase/match?matchId=${data.matchId}&poId=${data.poId}${data.receiptId ? `&receiptId=${data.receiptId}` : ''}`);
                  return;
                }
                if (!data.receiptId) return;
                onExecuteMatch({
                  deliveryId: data.id,
                  deliveryNo: data.deliveryNo,
                  poId: data.poId,
                  poNo: data.poNo,
                  receiptId: data.receiptId,
                  receiptNo: data.receiptNo ?? undefined,
                });
                onClose();
              }}
            >
              {data.matchId ? '查看三单匹配' : '执行三单匹配'}
            </Button>
          ) : null}
          {data?.poId && !data?.inspectionId ? (
            <Button
              variant="primary"
              onClick={() => onCreateInspection({
                deliveryId: data.id,
                deliveryNo: data.deliveryNo,
                poId: data.poId,
                poNo: data.poNo,
              })}
            >
              创建质检单
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>关闭</Button>
        </div>
      }
    >
      {isLoading || !data ? (
        <div className={styles.drawerLoading}>加载中...</div>
      ) : (
        <div className={styles.drawerBody}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>基本信息</h3>
            <div className={styles.metaGrid}>
              <div className={styles.kv}><span>送货单号</span><strong>{data.deliveryNo}</strong></div>
              <div className={styles.kv}><span>采购订单</span><strong>{data.poNo ?? '—'}</strong></div>
              <div className={styles.kv}><span>供应商</span><strong>{data.supplierName ?? '—'}</strong></div>
              <div className={styles.kv}><span>送货日期</span><strong>{formatDate(data.deliveryDate)}</strong></div>
              <div className={styles.kv}><span>状态</span><strong>{formatDeliveryStatus(data.status)}</strong></div>
              <div className={styles.kv}><span>录入人</span><strong>{data.creatorName ?? '—'}</strong></div>
              <div className={styles.kv}><span>关联质检单</span><strong>{data.inspectionNo ?? '—'}</strong></div>
              <div className={styles.kv}><span>关联入库单</span><strong>{data.receiptNo ?? '—'}</strong></div>
              <div className={styles.kv}><span>匹配状态</span><strong>{formatMatchStatus(data.matchStatus)}</strong></div>
              <div className={styles.kv}><span>收货时间</span><strong>{formatDateTime(data.receivedAt)}</strong></div>
              {data.notes ? (
                <div className={`${styles.kv} ${styles.kvFull}`}><span>备注</span><strong>{data.notes}</strong></div>
              ) : null}
            </div>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>关键节点</h3>
            {events.length > 0 ? (
              <div className={styles.eventTimeline}>
                {events.map((event) => (
                  <div key={event.key} className={styles.eventItem}>
                    <div className={`${styles.eventDot} ${styles[`eventDot_${event.tone}`]}`} />
                    <div className={styles.eventBody}>
                      <div className={styles.eventMetaRow}>
                        <span className={styles.eventTitle}>{event.title}</span>
                        <span className={styles.eventTime}>{formatDateTime(event.time)}</span>
                      </div>
                      <div className={styles.eventDescription}>{event.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyHint}>暂无关键节点</div>
            )}
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>送货明细</h3>
            <div className={styles.itemList}>
              {data.items?.map((item) => (
                <div key={item.id} className={styles.itemCard}>
                  <div className={styles.itemTop}>
                    <strong>{item.skuName ?? `SKU#${item.skuId}`}</strong>
                    <span>{item.skuCode ?? '—'}</span>
                  </div>
                  <div className={styles.itemMeta}>
                    <span>送货数量：{item.qtyDelivered}</span>
                    <span>单位：{item.purchaseUnit}</span>
                    {item.dyeLotNo ? <span>缸号：{String(item.dyeLotNo)}</span> : null}
                    <span>单价：{item.unitPrice}</span>
                    <span>金额：{item.amount ?? '—'}</span>
                  </div>
                </div>
              )) ?? <div className={styles.emptyHint}>暂无送货明细</div>}
            </div>
          </section>
        </div>
      )}
    </Drawer>
  );
}

function CreateDeliveryModal({
  open,
  initialPoId,
  onClose,
  onCreated,
}: {
  open: boolean;
  initialPoId?: number;
  onClose: () => void;
  onCreated: (deliveryId: number, poId: number) => void;
}) {
  const queryClient = useQueryClient();
  const showToast = useAppStore((state) => state.showToast);
  const [poInput, setPoInput] = useState(initialPoId ? String(initialPoId) : '');
  const [deliveryDate, setDeliveryDate] = useState(todayDateString());
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DeliveryCreateItemForm[]>([]);
  const createMutation = useCreatePurchaseDelivery();

  const resolvedPoId = Number(poInput) || null;
  const { data: order, isLoading: orderLoading } = usePurchaseOrderDetail(open ? resolvedPoId : null);
  const canCreate = order?.status === 'confirmed' || order?.status === 'partial_received';
  const hasOrderContext = Boolean(initialPoId || order);

  useEffect(() => {
    if (!open) return;
    setPoInput(initialPoId ? String(initialPoId) : '');
    setDeliveryDate(todayDateString());
    setNotes('');
    setItems([]);
  }, [initialPoId, open]);

  useEffect(() => {
    if (!open || !order) return;
    setItems(buildCreateItems(order));
  }, [open, order]);

  const handleSubmit = async () => {
    if (!resolvedPoId) {
      showToast({ type: 'warning', message: '请先输入采购订单 ID' });
      return;
    }
    if (!order?.id) {
      showToast({ type: 'warning', message: '未找到对应采购订单，请确认单号后重试' });
      return;
    }
    if (!canCreate) {
      showToast({ type: 'warning', message: `当前订单状态「${order.status}」不允许录入送货单` });
      return;
    }

    const positiveItems = items
      .filter((item) => toNumber(item.qtyDelivered) > 0)
      .map((item) => ({
        skuId: item.skuId,
        qtyDelivered: item.qtyDelivered.trim(),
        purchaseUnit: item.purchaseUnit,
        unitPrice: item.unitPrice,
        dyeLotNo: item.dyeLotNo.trim() || undefined,
      }));

    if (!positiveItems.length) {
      showToast({ type: 'warning', message: '请至少填写一条本次送货数量' });
      return;
    }

    const groupedOverflowItem = items.find((item) =>
      getAllocatedQtyForLine(items, item.lineKey) > toNumber(item.remainingQty),
    );
    if (groupedOverflowItem) {
      showToast({
        type: 'warning',
        message: `${groupedOverflowItem.skuCode || groupedOverflowItem.skuName || `SKU#${groupedOverflowItem.skuId}`} 的送货总量不能超过剩余缺口`,
      });
      return;
    }

    const missingDyeLotItem = items.find((item) =>
      toNumber(item.qtyDelivered) > 0 && item.hasDyeLot && !item.dyeLotNo.trim(),
    );
    if (missingDyeLotItem) {
      showToast({
        type: 'warning',
        message: `${missingDyeLotItem.skuCode || missingDyeLotItem.skuName || `SKU#${missingDyeLotItem.skuId}`} 需要先登记缸号`,
      });
      return;
    }

    const payload: CreateDeliveryNotePayload = {
      poId: resolvedPoId,
      deliveryDate,
      notes: notes.trim() || undefined,
      items: positiveItems,
    };

    try {
      const result = await createMutation.mutateAsync({ orderId: resolvedPoId, payload });
      await Promise.allSettled([
        queryClient.prefetchQuery({
          queryKey: purchaseKeys.orderDetail(resolvedPoId),
          queryFn: () => purchaseApi.getOrderById(resolvedPoId),
        }),
        queryClient.prefetchQuery({
          queryKey: purchaseKeys.deliveryList({ poId: resolvedPoId, page: 1, pageSize: 20 }),
          queryFn: () => purchaseApi.getDeliveries({ poId: resolvedPoId, page: 1, pageSize: 20 }),
        }),
        queryClient.prefetchQuery({
          queryKey: purchaseKeys.deliveryDetail(result.id),
          queryFn: () => purchaseApi.getDeliveryById(result.id),
        }),
      ]);
      showToast({ type: 'success', message: `送货单 ${result.deliveryNo} 已创建` });
      onCreated(result.id, resolvedPoId);
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message ?? '创建送货单失败' });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建送货单"
      size="xl"
      footer={(
        <div className={styles.createModalFooter}>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={() => void handleSubmit()} loading={createMutation.isPending}>创建送货单</Button>
        </div>
      )}
    >
      <div className={styles.createModal}>
        <div className={styles.createGrid}>
          <label className={styles.createField}>
            <span className={styles.createLabel}>{hasOrderContext ? '采购订单单号' : '采购订单 ID'}</span>
            {hasOrderContext ? (
              <input
                className={styles.createInput}
                value={order?.poNo ?? (orderLoading ? '正在加载采购订单...' : '')}
                placeholder="系统将自动带出采购订单单号"
                readOnly
              />
            ) : (
              <input
                className={styles.createInput}
                value={poInput}
                onChange={(event) => setPoInput(event.target.value.replace(/[^\d]/g, ''))}
                placeholder="请输入采购订单 ID"
              />
            )}
          </label>

          <label className={styles.createField}>
            <span className={styles.createLabel}>送货日期</span>
            <input
              type="date"
              className={styles.createInput}
              value={deliveryDate}
              onChange={(event) => setDeliveryDate(event.target.value)}
            />
          </label>
        </div>

        {orderLoading ? (
          <div className={styles.createNotice}>正在加载采购订单明细...</div>
        ) : order ? (
          <>
            <div className={styles.createOrderCard}>
              <div>
                <div className={styles.createOrderTitle}>{order.poNo} · {order.supplierName}</div>
                <div className={styles.createOrderMeta}>
                  当前状态 {PurchaseOrderStatusLabel[order.status] ?? order.status} · 预期到货 {formatDate(order.expectedDate)}
                </div>
              </div>
              <div className={styles.createOrderMeta}>
                总额 {order.totalAmount} · 可继续送货 {canCreate ? '是' : '否'}
              </div>
            </div>

            {canCreate ? (
              items.length ? (
                <div className={styles.createItems}>
                  {items.map((item, index) => (
                    <div key={`${item.lineKey}-${index}`} className={styles.createItemRow}>
                      <div className={styles.createItemInfo}>
                        <strong>
                          {item.skuName || `SKU#${item.skuId}`}
                          {item.hasDyeLot ? <span className={styles.dyeLotTag}>需登记缸号</span> : null}
                        </strong>
                        <span>
                          {item.skuCode || '—'} · 可送总量 {item.remainingQty} {item.purchaseUnit}
                          {item.hasDyeLot ? ` · 已拆分 ${formatQty(getAllocatedQtyForLine(items, item.lineKey))} ${item.purchaseUnit}` : ''}
                        </span>
                      </div>
                      <div className={styles.createItemQtyGroup}>
                        <input
                          className={styles.createInput}
                          value={item.qtyDelivered}
                          onChange={(event) => {
                            const nextValue = event.target.value.replace(/[^\d.]/g, '');
                            setItems((prev) => prev.map((row, rowIndex) =>
                              rowIndex === index ? { ...row, qtyDelivered: nextValue } : row,
                            ));
                          }}
                          placeholder="本次送货数量"
                        />
                        <span>{item.purchaseUnit}</span>
                        {item.hasDyeLot ? (
                          <input
                            className={styles.createInput}
                            value={item.dyeLotNo}
                            onChange={(event) => {
                              const nextValue = event.target.value.trimStart();
                              setItems((prev) => prev.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, dyeLotNo: nextValue } : row,
                              ));
                            }}
                            placeholder="登记供应商来料缸号"
                          />
                        ) : null}
                        {item.hasDyeLot ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setItems((prev) => {
                                const next = [...prev];
                                next.splice(index + 1, 0, {
                                  ...item,
                                  qtyDelivered: '0',
                                  dyeLotNo: '',
                                });
                                return next;
                              });
                            }}
                          >
                            新增缸号
                          </Button>
                        ) : null}
                        {item.hasDyeLot && items.filter((row) => row.lineKey === item.lineKey).length > 1 ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setItems((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
                            }}
                          >
                            删除分段
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.createNotice}>该采购订单已无剩余可送货数量，当前不需要新建送货单。</div>
              )
            ) : (
              <div className={styles.createNotice}>当前采购订单状态不允许继续录入送货单，仅 confirmed / partial_received 可操作。</div>
            )}
          </>
        ) : resolvedPoId ? (
          <div className={styles.createNotice}>未找到对应采购订单，请检查订单后重试。</div>
        ) : (
          <div className={styles.createNotice}>输入采购订单 ID 后，系统会自动带出供应商和待送货明细。</div>
        )}

        <label className={styles.createField}>
          <span className={styles.createLabel}>送货备注</span>
          <textarea
            className={styles.createTextarea}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
            maxLength={500}
            placeholder="可填写本次送货批次、车次、包装情况等说明"
          />
        </label>
      </div>
    </Modal>
  );
}

export default function PurchaseDeliveryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = usePermission();
  const setPageTitle = useAppStore((state) => state.setPageTitle);
  const canViewInspection = can('purchase:delivery:view');
  const statusParam = searchParams.get('status') ?? '';
  const poIdParam = Number(searchParams.get('poId') ?? '') || undefined;
  const deliveryIdParam = Number(searchParams.get('deliveryId') ?? '') || null;
  const createParam = searchParams.get('create') === '1';
  const [statusFilter, setStatusFilter] = useState(statusParam);
  const [poIdFilter, setPoIdFilter] = useState<number | undefined>(poIdParam);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(deliveryIdParam);
  const [createOpen, setCreateOpen] = useState(false);
  const [createPoId, setCreatePoId] = useState<number | undefined>(poIdParam);
  const [inspectionCreateTarget, setInspectionCreateTarget] = useState<InspectionCreateTarget | null>(null);
  const [matchExecuteTarget, setMatchExecuteTarget] = useState<MatchExecuteTarget | null>(null);
  const { data: filteredOrder } = usePurchaseOrderDetail(poIdFilter ?? null);

  const { data, isLoading } = usePurchaseDeliveryList({
    status: statusFilter || undefined,
    poId: poIdFilter,
    page,
    pageSize: 20,
  });

  useEffect(() => {
    setPageTitle('到货管理');
  }, [setPageTitle]);

  useEffect(() => { setStatusFilter(statusParam); }, [statusParam]);
  useEffect(() => { setPoIdFilter(poIdParam); }, [poIdParam]);
  useEffect(() => { setSelectedId(deliveryIdParam); }, [deliveryIdParam]);

  useEffect(() => {
    if (!createParam) return;
    setCreatePoId(poIdParam);
    setCreateOpen(true);
  }, [createParam, poIdParam]);

  const closeCreateModal = useCallback(() => {
    setCreateOpen(false);
    const next = new URLSearchParams(searchParams);
    next.delete('create');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (statusFilter) next.set('status', statusFilter);
    else next.delete('status');
    if (poIdFilter) next.set('poId', String(poIdFilter));
    else next.delete('poId');
    if (selectedId) next.set('deliveryId', String(selectedId));
    else next.delete('deliveryId');
    const nextQuery = next.toString();
    if (nextQuery !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [poIdFilter, searchParams, selectedId, setSearchParams, statusFilter]);

  const list = data?.list ?? EMPTY_DELIVERIES;
  const total = data?.total ?? 0;
  const isHydratingCreatedDelivery = Boolean(poIdFilter && selectedId && isLoading && list.length === 0);

  const summary = useMemo(() => ({
    total: total || list.length,
    pending: list.filter((row) => row.status === 'pending').length,
    inspected: list.filter((row) => Boolean(row.inspectionId)).length,
    received: list.filter((row) => Boolean(row.receiptId)).length,
    matched: list.filter((row) => row.matchStatus === 'matched' || row.matchStatus === 'confirmed').length,
  }), [list, total]);

  const columns: Column<DeliveryNote>[] = useMemo(() => [
    { key: 'deliveryNo', title: '送货单号', width: 150 },
    { key: 'poNo', title: '采购订单', width: 140 },
    { key: 'supplierName', title: '供应商', width: 140 },
    { key: 'deliveryDate', title: '送货日期', width: 120, render: (value) => formatDate(String(value ?? '')) },
    {
      key: 'status',
      title: '状态',
      width: 110,
      render: (value) => <span className={styles.statusPill}>{formatDeliveryStatus(String(value ?? ''))}</span>,
    },
    {
      key: 'matchStatus',
      title: '匹配状态',
      width: 110,
      render: (value) => <span className={styles.matchPill}>{formatMatchStatus(String(value ?? ''))}</span>,
    },
    { key: 'inspectionNo', title: '质检单', width: 140, render: (value) => String(value ?? '—') },
    { key: 'receiptNo', title: '入库单', width: 140, render: (value) => String(value ?? '—') },
    { key: 'totalDelivered', title: '本次送货', width: 100, align: 'right' },
    {
      key: 'id',
      title: '操作',
      width: 180,
      render: (_value, record) => (
        <div className={styles.actions}>
          <Button size="sm" variant="text" onClick={() => setSelectedId(record.id)}>详情</Button>
          {canViewInspection && !record.inspectionId ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setInspectionCreateTarget({
                deliveryId: record.id,
                deliveryNo: record.deliveryNo,
                poId: record.poId,
                poNo: record.poNo,
              })}
            >
              创建质检单
            </Button>
          ) : null}
          {record.poId && record.receiptId ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (record.matchId) {
                  navigate(`/purchase/match?matchId=${record.matchId}&poId=${record.poId}&receiptId=${record.receiptId}`);
                  return;
                }
                setMatchExecuteTarget({
                  deliveryId: record.id,
                  deliveryNo: record.deliveryNo,
                  poId: record.poId,
                  poNo: record.poNo,
                  receiptId: Number(record.receiptId),
                  receiptNo: record.receiptNo ?? undefined,
                });
              }}
            >
              {record.matchId ? '查看匹配' : '执行匹配'}
            </Button>
          ) : null}
        </div>
      ),
    },
  ], [canViewInspection, navigate]);

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>Purchase Deliveries</div>
          <h1 className={styles.title}>到货管理</h1>
          <p className={styles.subtitle}>查看供应商送货单、关联质检与入库进度，并从采购订单直接录入本次送货。</p>
        </div>
      </div>

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}><span>送货单总数</span><strong>{summary.total}</strong></div>
        <div className={styles.summaryCard}><span>待质检</span><strong>{summary.pending}</strong></div>
        <div className={styles.summaryCard}><span>已关联质检</span><strong>{summary.inspected}</strong></div>
        <div className={styles.summaryCard}><span>已入库</span><strong>{summary.received}</strong></div>
        <div className={styles.summaryCard}><span>已匹配</span><strong>{summary.matched}</strong></div>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <div className={styles.panelTitle}>送货单列表</div>
            <div className={styles.panelDesc}>支持按状态和采购订单筛选，贯通送货、质检、入库和三单匹配。</div>
            {poIdFilter ? (
              <div className={styles.activeFilter}>
                当前仅显示采购单
                <strong>{filteredOrder?.poNo ?? `#${poIdFilter}`}</strong>
                的送货记录
              </div>
            ) : null}
          </div>
          <div className={styles.filters}>
            <select
              className={styles.filterSelect}
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">全部状态</option>
              <option value="pending">待质检</option>
              <option value="confirmed">已确认</option>
              <option value="received">已收货</option>
            </select>
            {poIdFilter ? (
              <Button size="sm" variant="ghost" onClick={() => setPoIdFilter(undefined)}>
                清除采购单筛选
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => {
                setCreatePoId(poIdFilter);
                setCreateOpen(true);
              }}
            >
              + 新建送货单
            </Button>
          </div>
        </div>

        {isHydratingCreatedDelivery ? (
          <div className={styles.routeLoadingState}>
            <div className={styles.routeLoadingTitle}>正在同步刚创建的送货单...</div>
            <div className={styles.routeLoadingDesc}>采购订单筛选、送货记录和详情抽屉会在数据就绪后一次性稳定展示。</div>
          </div>
        ) : (
          <Table<DeliveryNote>
            columns={columns}
            dataSource={list}
            rowKey="id"
            loading={isLoading}
            pagination={{ page, pageSize: 20, total, onChange: setPage }}
            emptyText="暂无送货单"
          />
        )}
      </section>

      <DeliveryDetailDrawer
        deliveryId={selectedId}
        onClose={() => setSelectedId(null)}
        onCreateInspection={setInspectionCreateTarget}
        onExecuteMatch={setMatchExecuteTarget}
      />
      <CreateDeliveryModal
        open={createOpen}
        initialPoId={createPoId}
        onClose={closeCreateModal}
        onCreated={(deliveryId, poId) => {
          setCreateOpen(false);
          navigate(`/purchase/deliveries?deliveryId=${deliveryId}&poId=${poId}`);
        }}
      />
      <CreateInspectionModal
        open={inspectionCreateTarget !== null}
        target={inspectionCreateTarget}
        onClose={() => setInspectionCreateTarget(null)}
      />
      <ExecuteMatchModal
        open={matchExecuteTarget !== null}
        target={matchExecuteTarget}
        onClose={() => setMatchExecuteTarget(null)}
      />
    </div>
  );
}
