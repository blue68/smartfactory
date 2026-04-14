import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  usePurchaseOrderDetail,
  usePurchaseReceiptDetail,
  usePurchaseReceiptList,
  useUpdatePurchaseReceiptNotes,
} from '@/api/purchase';
import type { PurchaseReceipt } from '@/types/models';
import { useAppStore } from '@/stores/appStore';
import { usePermission } from '@/hooks/usePermission';
import { formatBusinessClassLabel, formatReceiptModeLabel } from '@/utils/purchaseFlow';
import Drawer from '@/components/common/Drawer';
import Table from '@/components/common/Table';
import type { Column } from '@/components/common/Table';
import Button from '@/components/common/Button';
import styles from './PurchaseReceiptPage.module.css';

const EMPTY_RECEIPTS: PurchaseReceipt[] = [];

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  return String(value).replace('T', ' ').slice(0, 19);
}

function formatReceiptStatus(status?: string | null): string {
  if (!status) return '—';
  if (status === 'confirmed') return '已入库';
  if (status === 'pending') return '待确认';
  if (status === 'cancelled') return '已取消';
  return status;
}

function formatPurchaseOrderStatus(status?: string | null): string {
  if (!status) return '—';
  const labelMap: Record<string, string> = {
    draft: '草稿',
    pending: '待确认',
    confirmed: '已确认',
    partial_received: '部分到货',
    received: '已到货',
    completed: '已完成',
    closed: '已关闭',
    cancelled: '已取消',
  };
  return labelMap[status] ?? status;
}

function isReceiptNoteEditable(receivedAt?: string | null): boolean {
  if (!receivedAt) return false;
  const createdAt = new Date(receivedAt);
  if (Number.isNaN(createdAt.getTime())) return false;
  return Date.now() <= createdAt.getTime() + 24 * 60 * 60 * 1000;
}

interface ReceiptBranchCard {
  key: string;
  title: string;
  description: string;
  actionLabel?: string;
  action?: () => void;
  tone: 'info' | 'warning' | 'neutral';
}

function ReceiptDetailDrawer({
  receiptId,
  canEditNotes,
  onClose,
  onOpenOrder,
  onOpenMatch,
  onOpenDelivery,
  onOpenAssetAcceptance,
  onOpenConsumableIssue,
}: {
  receiptId: number | null;
  canEditNotes: boolean;
  onClose: () => void;
  onOpenOrder: (poId: number | null | undefined) => void;
  onOpenMatch: (poId: number | null | undefined, receiptId: number | null | undefined) => void;
  onOpenDelivery: (deliveryId: number | null | undefined, poId: number | null | undefined) => void;
  onOpenAssetAcceptance: () => void;
  onOpenConsumableIssue: () => void;
}) {
  const { showToast } = useAppStore();
  const { data, isLoading } = usePurchaseReceiptDetail(receiptId);
  const updateNotes = useUpdatePurchaseReceiptNotes();
  const [noteDraft, setNoteDraft] = useState('');

  useEffect(() => {
    setNoteDraft(data?.notes ?? '');
  }, [data?.id, data?.notes]);

  const noteEditable = canEditNotes && isReceiptNoteEditable(data?.receivedAt);
  const branchCards = useMemo<ReceiptBranchCard[]>(() => {
    if (!data?.items?.length) return [];
    const assetCount = data.items.filter(
      (item) => item.businessClass === 'fixed_asset' && item.receiptMode === 'asset_capitalization',
    ).length;
    const consumableInventoryCount = data.items.filter(
      (item) => item.businessClass === 'consumable' && item.receiptMode === 'inventory',
    ).length;
    const directExpenseCount = data.items.filter((item) => item.receiptMode === 'direct_expense').length;

    const cards: ReceiptBranchCard[] = [];
    if (assetCount > 0) {
      cards.push({
        key: 'asset',
        title: '固定资产验收',
        description: `${assetCount} 条明细已进入资产待验收池，下一步去资产验收页建卡并进入资产台账。`,
        actionLabel: '去资产验收',
        action: onOpenAssetAcceptance,
        tone: 'info',
      });
    }
    if (consumableInventoryCount > 0) {
      cards.push({
        key: 'consumable',
        title: '损耗品库存',
        description: `${consumableInventoryCount} 条明细已入损耗品库存，后续可按部门在损耗品领用台发起领用。`,
        actionLabel: '去损耗品领用',
        action: onOpenConsumableIssue,
        tone: 'warning',
      });
    }
    if (directExpenseCount > 0) {
      cards.push({
        key: 'direct-expense',
        title: '直耗收货',
        description: `${directExpenseCount} 条明细按直耗收货完成，不进入库存，也不会进入资产验收。`,
        tone: 'neutral',
      });
    }
    return cards;
  }, [data?.items, onOpenAssetAcceptance, onOpenConsumableIssue]);

  const handleSaveNotes = async () => {
    if (!data?.id || !noteDraft.trim()) {
      showToast({ type: 'warning', message: '请填写备注内容' });
      return;
    }

    try {
      await updateNotes.mutateAsync({
        id: data.id,
        payload: { notes: noteDraft.trim() },
      });
      showToast({ type: 'success', message: '入库备注已更新' });
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message });
    }
  };

  return (
    <Drawer
      open={receiptId !== null}
      onClose={onClose}
      title={`入库单详情${data?.receiptNo ? ` - ${data.receiptNo}` : ''}`}
      width={720}
      footer={(
        <div className={styles.drawerFooter}>
          {data?.poId && data?.id ? (
            <Button variant="text" onClick={() => onOpenMatch(data.poId, data.id)}>查看三单匹配</Button>
          ) : null}
          {data?.deliveryNoteId ? (
            <Button variant="text" onClick={() => onOpenDelivery(data.deliveryNoteId, data.poId)}>查看送货单</Button>
          ) : null}
          {data?.poId ? (
            <Button variant="text" onClick={() => onOpenOrder(data.poId)}>查看采购单</Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>关闭</Button>
        </div>
      )}
    >
      {isLoading || !data ? (
        <div className={styles.drawerLoading}>加载中...</div>
      ) : (
        <div className={styles.drawerBody}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>基本信息</h3>
            <div className={styles.metaGrid}>
              <div className={styles.kv}><span>入库单号</span><strong>{data.receiptNo}</strong></div>
              <div className={styles.kv}>
                <span>采购订单</span>
                <strong>{data.poNo ?? '—'}</strong>
                {data.poId ? (
                  <Button size="sm" variant="text" onClick={() => onOpenOrder(data.poId)}>
                    查看采购单
                  </Button>
                ) : null}
              </div>
              <div className={styles.kv}>
                <span>送货单</span>
                <strong>{data.deliveryNo ?? '—'}</strong>
                {data.deliveryNoteId ? (
                  <Button size="sm" variant="text" onClick={() => onOpenDelivery(data.deliveryNoteId, data.poId)}>
                    查看送货单
                  </Button>
                ) : null}
              </div>
              <div className={styles.kv}><span>关联质检单</span><strong>{data.inspectionNo ?? '—'}</strong></div>
              <div className={styles.kv}><span>供应商</span><strong>{data.supplierName ?? '—'}</strong></div>
              <div className={styles.kv}><span>状态</span><strong>{formatReceiptStatus(data.status)}</strong></div>
              <div className={styles.kv}><span>入库时间</span><strong>{formatDateTime(data.receivedAt)}</strong></div>
              <div className={styles.kv}><span>操作人</span><strong>{data.operatorName ?? '—'}</strong></div>
              <div className={styles.kv}><span>总数量</span><strong>{data.totalQty ?? '—'}</strong></div>
              <div className={styles.kv}><span>总金额</span><strong>{data.totalAmount ?? '—'}</strong></div>
            </div>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>入库备注</h3>
            {noteEditable ? (
              <div className={styles.noteEditor}>
                <textarea
                  className={styles.noteTextarea}
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  maxLength={500}
                  rows={4}
                  placeholder="可在入库单创建 24 小时内补充备注，例如现场收货情况、批次说明"
                />
                <div className={styles.noteActions}>
                  <span className={styles.noteHint}>仅允许在入库后 24 小时内补充备注</span>
                  <Button
                    size="sm"
                    onClick={() => void handleSaveNotes()}
                    loading={updateNotes.isPending}
                  >
                    保存备注
                  </Button>
                </div>
              </div>
            ) : (
              <div className={styles.noteReadonly}>
                <div>{data.notes?.trim() || '暂无备注'}</div>
                <div className={styles.noteHint}>
                  {canEditNotes ? '备注编辑窗口已结束（入库后 24 小时）' : '当前角色无备注编辑权限'}
                </div>
              </div>
            )}
          </section>

          {branchCards.length ? (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>收货分流</h3>
              <div className={styles.branchGrid}>
                {branchCards.map((card) => (
                  <article
                    key={card.key}
                    className={`${styles.branchCard} ${styles[`branchCard--${card.tone}`]}`}
                  >
                    <div className={styles.branchCardTitle}>{card.title}</div>
                    <div className={styles.branchCardDesc}>{card.description}</div>
                    {card.action && card.actionLabel ? (
                      <Button size="sm" variant="text" onClick={card.action}>
                        {card.actionLabel}
                      </Button>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>入库明细</h3>
            <div className={styles.itemList}>
              {data.items?.map((item) => (
                <div key={item.id} className={styles.itemCard}>
                  <div className={styles.itemTop}>
                    <strong>{item.skuName ?? `SKU#${item.skuId}`}</strong>
                    <span>{item.skuCode ?? '—'}</span>
                  </div>
                  <div className={styles.itemTags}>
                    <span className={styles.itemTag}>{formatBusinessClassLabel(item.businessClass)}</span>
                    <span className={styles.itemTag}>{formatReceiptModeLabel(item.receiptMode)}</span>
                    {item.requiresAcceptance ? <span className={styles.itemTag}>需验收</span> : null}
                  </div>
                  <div className={styles.itemMeta}>
                    <span>入库数量：{item.qtyReceived}</span>
                    <span>单位：{item.purchaseUnit}</span>
                    {item.dyeLotNo ? <span>缸号：{item.dyeLotNo}</span> : null}
                    <span>单价：{item.unitPrice}</span>
                    <span>金额：{item.amount ?? '—'}</span>
                    {item.requestDepartmentName ? <span>需求部门：{item.requestDepartmentName}</span> : null}
                  </div>
                </div>
              )) ?? <div className={styles.emptyHint}>暂无入库明细</div>}
            </div>
          </section>
        </div>
      )}
    </Drawer>
  );
}

export default function PurchaseReceiptPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { setPageTitle } = useAppStore();
  const { can } = usePermission();
  const canEditReceiptNotes = can('purchase:receipt:edit');
  const statusParam = searchParams.get('status') ?? '';
  const poIdParam = Number(searchParams.get('poId') ?? '') || undefined;
  const receiptIdParam = Number(searchParams.get('receiptId') ?? '') || null;
  const [statusFilter, setStatusFilter] = useState(statusParam);
  const [poIdFilter, setPoIdFilter] = useState<number | undefined>(poIdParam);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(receiptIdParam);
  const { data, isLoading } = usePurchaseReceiptList({
    status: statusFilter || undefined,
    poId: poIdFilter,
    page,
    pageSize: 20,
  });
  const { data: filterOrderDetail } = usePurchaseOrderDetail(poIdFilter ?? null);

  useEffect(() => {
    setPageTitle('入库记录');
  }, [setPageTitle]);

  useEffect(() => {
    setStatusFilter(statusParam);
  }, [statusParam]);

  useEffect(() => {
    setPoIdFilter(poIdParam);
  }, [poIdParam]);

  useEffect(() => {
    setSelectedId(receiptIdParam);
  }, [receiptIdParam]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (statusFilter) next.set('status', statusFilter);
    else next.delete('status');
    if (poIdFilter) next.set('poId', String(poIdFilter));
    else next.delete('poId');
    if (selectedId) next.set('receiptId', String(selectedId));
    else next.delete('receiptId');

    const nextQuery = next.toString();
    if (nextQuery !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [poIdFilter, searchParams, selectedId, setSearchParams, statusFilter]);

  const list = data?.list ?? EMPTY_RECEIPTS;
  const total = data?.total ?? 0;
  const activePoNo = useMemo(
    () => filterOrderDetail?.poNo ?? list.find((item) => item.poId === poIdFilter)?.poNo ?? null,
    [filterOrderDetail?.poNo, list, poIdFilter],
  );

  const summary = useMemo(() => ({
    total: total || list.length,
    confirmed: list.filter((row) => row.status === 'confirmed').length,
    pending: list.filter((row) => row.status === 'pending').length,
  }), [list, total]);

  const columns: Column<PurchaseReceipt>[] = useMemo(() => [
    { key: 'receiptNo', title: '入库单号', width: 150 },
    { key: 'poNo', title: '采购订单', width: 140 },
    { key: 'deliveryNo', title: '送货单', width: 140, render: (value) => String(value ?? '—') },
    { key: 'inspectionNo', title: '质检单', width: 140, render: (value) => String(value ?? '—') },
    { key: 'supplierName', title: '供应商', width: 140 },
    {
      key: 'poStatus',
      title: '采购单状态',
      width: 110,
      render: (value) => formatPurchaseOrderStatus(String(value ?? '')),
    },
    {
      key: 'status',
      title: '状态',
      width: 100,
      render: (value) => <span className={styles.statusPill}>{formatReceiptStatus(String(value ?? ''))}</span>,
    },
    { key: 'totalQty', title: '入库数量', width: 100, align: 'right' },
    { key: 'receivedAt', title: '入库时间', width: 170, render: (value) => formatDateTime(String(value ?? '')) },
    {
      key: 'id',
      title: '操作',
      width: 90,
      render: (_value, record) => (
        <Button size="sm" variant="text" onClick={() => setSelectedId(record.id)}>详情</Button>
      ),
    },
  ], []);

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>Purchase Receipts</div>
          <h1 className={styles.title}>入库记录</h1>
          <p className={styles.subtitle}>查看采购入库单、关联质检单与采购单，并在 24 小时窗口内补充收货备注。</p>
        </div>
      </div>

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}><span>入库单总数</span><strong>{summary.total}</strong></div>
        <div className={styles.summaryCard}><span>已入库</span><strong>{summary.confirmed}</strong></div>
        <div className={styles.summaryCard}><span>待确认</span><strong>{summary.pending}</strong></div>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <div className={styles.panelTitle}>采购入库单列表</div>
            <div className={styles.panelDesc}>支持按状态筛选，查看来源采购单、送货单和质检单。</div>
          </div>
          <div className={styles.filters}>
            <select
              className={styles.filterSelect}
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">全部状态</option>
              <option value="confirmed">已入库</option>
              <option value="pending">待确认</option>
              <option value="cancelled">已取消</option>
            </select>
          </div>
        </div>

        {poIdFilter ? (
          <div className={styles.activeFilterBar}>
            <span className={styles.activeFilterChip}>
              {activePoNo ? `采购单 ${activePoNo}` : `采购单 #${poIdFilter}`}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setPoIdFilter(undefined)}>
              清除采购单过滤
            </Button>
          </div>
        ) : null}

        <Table<PurchaseReceipt>
          columns={columns}
          dataSource={list}
          rowKey="id"
          loading={isLoading}
          pagination={{ page, pageSize: 20, total, onChange: setPage }}
          emptyText="暂无入库记录"
        />
      </section>

      <ReceiptDetailDrawer
        receiptId={selectedId}
        canEditNotes={canEditReceiptNotes}
        onClose={() => setSelectedId(null)}
        onOpenOrder={(poId) => {
          if (!poId) return;
          navigate(`/purchase/orders?orderId=${poId}`);
        }}
        onOpenMatch={(poId, receiptId) => {
          if (!poId || !receiptId) return;
          navigate(`/purchase/match?poId=${poId}&receiptId=${receiptId}`);
        }}
        onOpenDelivery={(deliveryId, poId) => {
          if (!deliveryId) return;
          navigate(`/purchase/deliveries?deliveryId=${deliveryId}${poId ? `&poId=${poId}` : ''}`);
        }}
        onOpenAssetAcceptance={() => {
          navigate('/assets/acceptance');
        }}
        onOpenConsumableIssue={() => {
          navigate('/consumables/issues');
        }}
      />
    </div>
  );
}
