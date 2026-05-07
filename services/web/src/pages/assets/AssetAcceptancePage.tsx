import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import { usePermission } from '@/hooks/usePermission';
import { ACTION_CODES } from '@/constants/accessControl';
import { useAccessUserList } from '@/api/accessControl';
import { useDepartmentList } from '@/api/departments';
import { usePurchaseReceiptDetail, usePurchaseReceiptList } from '@/api/purchase';
import { useCreateAssetAcceptance } from '@/api/assets';
import type { PurchaseReceipt, PurchaseReceiptItem } from '@/types/models';
import type { Column } from '@/components/common/Table';
import Table from '@/components/common/Table';
import Drawer from '@/components/common/Drawer';
import Button from '@/components/common/Button';
import Tag from '@/components/common/Tag';
import { buildDepartmentMap, formatDepartmentLabel } from '@/utils/department';
import styles from './AssetAcceptancePage.module.css';

interface AssetCardDraft {
  key: string;
  assetName: string;
  serialNo: string;
  assetTagNo: string;
  departmentId: string;
  custodianUserId: string;
  locationText: string;
  notes: string;
}

interface AcceptanceDraftItem {
  receiptItemId: number;
  purchaseItemId?: number | null;
  skuCode?: string;
  skuName?: string;
  qtyReceived: number;
  cards: AssetCardDraft[];
}

function formatBusinessClassLabel(value?: string | null): string {
  if (value === 'finished_goods') return '成品商品';
  if (value === 'consumable') return '损耗品';
  if (value === 'fixed_asset') return '固定资产';
  if (value === 'production_material') return '生产物料';
  return '待补配置';
}

function formatReceiptModeLabel(value?: string | null): string {
  if (value === 'inventory') return '库存入库';
  if (value === 'direct_expense') return '直接费用化';
  if (value === 'asset_capitalization') return '资产待验收';
  return '待补配置';
}

function getReceiptModeTagVariant(value?: string | null): 'warning' | 'info' | 'error' | 'neutral' {
  if (value === 'direct_expense') return 'error';
  if (value === 'asset_capitalization') return 'info';
  if (value === 'inventory') return 'neutral';
  return 'warning';
}

function getReceiptStatusMeta(status?: string | null): { label: string; variant: 'warning' | 'success' | 'error' | 'info' | 'neutral' } {
  if (status === 'pending') return { label: '待确认', variant: 'warning' };
  if (status === 'confirmed') return { label: '已入库', variant: 'success' };
  if (status === 'received') return { label: '已收货', variant: 'success' };
  if (status === 'cancelled') return { label: '已取消', variant: 'error' };
  return { label: status || '未知', variant: 'neutral' };
}

function isEligibleItem(item: PurchaseReceiptItem): boolean {
  const qtyReceived = Number(item.qtyReceived ?? 0);
  const acceptedCardCount = Number(item.acceptedCardCount ?? 0);
  return item.businessClass === 'fixed_asset'
    && item.receiptMode === 'asset_capitalization'
    && acceptedCardCount < qtyReceived;
}

function emptyCardDraft(item: PurchaseReceiptItem, index: number): AssetCardDraft {
  return {
    key: `${item.id}-${index}-${Date.now()}`,
    assetName: item.skuName ?? '',
    serialNo: '',
    assetTagNo: '',
    departmentId: item.requestDepartmentId ? String(item.requestDepartmentId) : '',
    custodianUserId: '',
    locationText: '',
    notes: '',
  };
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  return String(value).slice(0, 19).replace('T', ' ');
}

function formatQty(value?: string | number | null): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return '0';
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2);
}

function buildDraftItems(receipt?: PurchaseReceipt | null): AcceptanceDraftItem[] {
  return (receipt?.items ?? [])
    .filter(isEligibleItem)
    .map((item) => {
      const acceptedCardCount = Math.max(0, Number(item.acceptedCardCount ?? 0));
      const qtyReceived = Math.max(1, Math.floor(Number(item.qtyReceived ?? 1) - acceptedCardCount));
      return {
        receiptItemId: item.id,
        purchaseItemId: typeof item.purchaseItemId === 'number' ? item.purchaseItemId : null,
        skuCode: item.skuCode,
        skuName: item.skuName,
        qtyReceived,
        cards: Array.from({ length: qtyReceived }).map((_, index) => emptyCardDraft(item, index)),
      };
    });
}

export default function AssetAcceptancePage() {
  const navigate = useNavigate();
  const setPageTitle = useAppStore((state) => state.setPageTitle);
  const showToast = useAppStore((state) => state.showToast);
  const { can } = usePermission();
  const canAccept = can(ACTION_CODES.ASSET_ACCEPTANCE_CREATE);

  const [page, setPage] = useState(1);
  const [selectedReceiptId, setSelectedReceiptId] = useState<number | null>(null);
  const [keyword, setKeyword] = useState('');
  const [draftItems, setDraftItems] = useState<AcceptanceDraftItem[]>([]);
  const [createdCards, setCreatedCards] = useState<Array<{ id: number; assetNo: string; receiptItemId: number }>>([]);

  useEffect(() => {
    setPageTitle('固定资产验收');
  }, [setPageTitle]);

  const receiptQuery = usePurchaseReceiptList({ page, pageSize: 12, assetAcceptanceOnly: true });
  const detailQuery = usePurchaseReceiptDetail(selectedReceiptId);
  const acceptanceMutation = useCreateAssetAcceptance();
  const userQuery = useAccessUserList({ page: 1, pageSize: 200, status: 'active' });
  const departmentQuery = useDepartmentList({ page: 1, pageSize: 200 });

  const receiptList = useMemo(() => {
    const list = receiptQuery.data?.list ?? [];
    if (!keyword.trim()) return list;
    const normalized = keyword.trim().toLowerCase();
    return list.filter((item) => {
      const haystack = [
        item.receiptNo,
        item.poNo,
        item.supplierName,
        item.deliveryNo,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(normalized);
    });
  }, [keyword, receiptQuery.data?.list]);

  const detail = detailQuery.data?.id === selectedReceiptId ? detailQuery.data : null;
  const eligibleItems = useMemo(
    () => (detail?.items ?? []).filter(isEligibleItem),
    [detail],
  );
  const userOptions = userQuery.data?.list ?? [];
  const departments = useMemo(() => departmentQuery.data?.list ?? [], [departmentQuery.data?.list]);
  const departmentMap = useMemo(() => buildDepartmentMap(departments), [departments]);
  const receiptError = receiptQuery.error instanceof Error ? receiptQuery.error.message : null;
  const detailError = detailQuery.error instanceof Error ? detailQuery.error.message : null;
  const userError = userQuery.error instanceof Error ? userQuery.error.message : null;
  const departmentOptions = useMemo(() => {
    const sourceIds = new Set<number>();
    departments
      .filter((item) => item.status === 'active')
      .forEach((item) => sourceIds.add(item.id));
    eligibleItems.forEach((item) => {
      if (typeof item.requestDepartmentId === 'number' && item.requestDepartmentId > 0) {
        sourceIds.add(item.requestDepartmentId);
      }
    });
    draftItems.forEach((item) => {
      item.cards.forEach((card) => {
        const parsed = Number(card.departmentId);
        if (Number.isInteger(parsed) && parsed > 0) {
          sourceIds.add(parsed);
        }
      });
    });
    return Array.from(sourceIds)
      .map((departmentId) => departmentMap.get(departmentId))
      .filter(Boolean)
      .sort((left, right) => Number(left?.sortOrder ?? 0) - Number(right?.sortOrder ?? 0) || Number(left?.id ?? 0) - Number(right?.id ?? 0));
  }, [departmentMap, departments, draftItems, eligibleItems]);

  useEffect(() => {
    if (!detail) return;
    setDraftItems(buildDraftItems(detail));
    setCreatedCards([]);
  }, [detail]);

  const receiptColumns: Column<PurchaseReceipt>[] = useMemo(() => [
    {
      key: 'receiptNo',
      title: '入库单号',
      width: 170,
      render: (_value, record) => (
        <button type="button" className={styles.linkButton} onClick={() => setSelectedReceiptId(record.id)}>
          {record.receiptNo}
        </button>
      ),
    },
    {
      key: 'supplierName',
      title: '供应商 / 采购单',
      width: 240,
      render: (_value, record) => (
        <div>
          <div className={styles.primaryCell}>{record.supplierName || '未绑定供应商'}</div>
          <div className={styles.secondaryCell}>{record.poNo || `PO#${record.poId}`}</div>
        </div>
      ),
    },
    {
      key: 'status',
      title: '收货状态',
      width: 130,
      render: (value, record) => {
        const statusMeta = getReceiptStatusMeta(String(value ?? ''));
        return (
          <div className={styles.statusCell}>
            <Tag variant={statusMeta.variant}>{statusMeta.label}</Tag>
            <span>{formatQty(record.totalQty)} 件</span>
          </div>
        );
      },
    },
    {
      key: 'receivedAt',
      title: '收货时间',
      width: 180,
      render: (value) => formatDateTime(String(value ?? '')),
    },
    {
      key: 'id',
      title: '操作',
      width: 120,
      render: (_value, record) => (
        <Button size="sm" variant="text" onClick={() => setSelectedReceiptId(record.id)}>
          验收建卡
        </Button>
      ),
    },
  ], []);

  const updateDraftCard = (
    receiptItemId: number,
    cardKey: string,
    field: keyof AssetCardDraft,
    value: string,
  ) => {
    setDraftItems((prev) => prev.map((item) => (
      item.receiptItemId === receiptItemId
        ? {
            ...item,
            cards: item.cards.map((card) => (
              card.key === cardKey ? { ...card, [field]: value } : card
            )),
          }
        : item
    )));
  };

  const updateCardCount = (receiptItemId: number, nextCount: number, sourceItem?: PurchaseReceiptItem) => {
    setDraftItems((prev) => prev.map((item) => {
      if (item.receiptItemId !== receiptItemId) return item;
      const safeCount = Math.max(1, Math.min(nextCount, item.qtyReceived));
      if (safeCount === item.cards.length) return item;
      if (safeCount > item.cards.length && sourceItem) {
        const extra = Array.from({ length: safeCount - item.cards.length }).map((_, index) =>
          emptyCardDraft(sourceItem, item.cards.length + index),
        );
        return { ...item, cards: [...item.cards, ...extra] };
      }
      return { ...item, cards: item.cards.slice(0, safeCount) };
    }));
  };

  const handleAccept = async () => {
    if (!detail) return;
    if (draftItems.length === 0) {
      showToast({ type: 'warning', message: '当前入库单没有可建卡的固定资产明细' });
      return;
    }

    for (const item of draftItems) {
      for (const card of item.cards) {
        if (!card.assetName.trim()) {
          showToast({ type: 'warning', message: `请为明细 #${item.receiptItemId} 填写资产名称` });
          return;
        }
      }
    }

    try {
      const result = await acceptanceMutation.mutateAsync({
        receiptId: detail.id,
        items: draftItems.map((item) => ({
          receiptItemId: item.receiptItemId,
          cards: item.cards.map((card) => ({
            assetName: card.assetName.trim(),
            serialNo: card.serialNo.trim() || undefined,
            assetTagNo: card.assetTagNo.trim() || undefined,
            departmentId: card.departmentId ? Number(card.departmentId) : undefined,
            custodianUserId: card.custodianUserId ? Number(card.custodianUserId) : undefined,
            locationText: card.locationText.trim() || undefined,
            notes: card.notes.trim() || undefined,
          })),
        })),
      });
      setCreatedCards(result.cards);
      showToast({ type: 'success', message: `已完成 ${result.createdCount} 张资产卡片建卡` });
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message || '固定资产验收失败' });
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>Asset Capitalization</div>
          <h1 className={styles.title}>固定资产验收页</h1>
          <p className={styles.subtitle}>从采购入库记录中挑出需建卡明细，完成收货后的资产卡片落账。</p>
        </div>
        <div className={styles.heroMeta}>
          <span>当前收货单池</span>
          <strong>{receiptQuery.data?.total ?? 0}</strong>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>待检查入库单</h2>
            <p>这里只展示可验收建卡的收货单，右侧仅对“固定资产 + 资产待验收”明细建卡。</p>
          </div>
          <input
            className={styles.search}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索入库单号 / 采购单 / 供应商"
          />
        </div>

        <Table
          columns={receiptColumns}
          dataSource={receiptList}
          rowKey="id"
          loading={receiptQuery.isLoading}
          error={receiptError}
          emptyText="当前没有可验收建卡的收货记录"
          pagination={{
            page,
            pageSize: receiptQuery.data?.pageSize ?? 12,
            total: receiptQuery.data?.total ?? 0,
            onChange: setPage,
          }}
        />
      </section>

      <Drawer
        open={selectedReceiptId !== null}
        onClose={() => setSelectedReceiptId(null)}
        title={detail?.receiptNo ? `验收建卡 · ${detail.receiptNo}` : '验收建卡'}
        width={940}
        footer={createdCards.length > 0 ? (
          <div className={styles.drawerFooter}>
            <Button variant="ghost" onClick={() => setSelectedReceiptId(null)}>关闭</Button>
            <Button variant="primary" onClick={() => navigate('/assets/ledger')}>查看资产台账</Button>
          </div>
        ) : (
          <div className={styles.drawerFooter}>
            <Button variant="ghost" onClick={() => setSelectedReceiptId(null)}>取消</Button>
            <Button
              variant="primary"
              disabled={!canAccept || eligibleItems.length === 0}
              loading={acceptanceMutation.isPending}
              onClick={() => void handleAccept()}
            >
              验收建卡
            </Button>
          </div>
        )}
      >
        {detailError && !detail ? (
          <div className="alert alert--error" role="alert">
            <span className="alert__icon" aria-hidden="true">❌</span>
            <div className="alert__body">
              <div className="alert__title">收货详情加载失败</div>
              <div className="alert__desc">{detailError}</div>
              <div className={styles.statusActions}>
                <Button size="sm" variant="ghost" onClick={() => setSelectedReceiptId(null)}>关闭</Button>
                <Button size="sm" variant="primary" onClick={() => void detailQuery.refetch()}>重试</Button>
              </div>
            </div>
          </div>
        ) : !detail ? (
          <div className={styles.emptyBlock}>正在加载收货详情...</div>
        ) : createdCards.length > 0 ? (
          <div className={styles.successPanel}>
            <Tag variant="success">建卡成功</Tag>
            <h3>本次已生成以下资产编号</h3>
            <div className={styles.createdGrid}>
              {createdCards.map((card) => (
                <div key={card.id} className={styles.createdCard}>
                  <strong>{card.assetNo}</strong>
                  <span>来源明细 #{card.receiptItemId}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className={styles.drawerBody}>
            {userError ? (
              <div className="alert alert--warning" role="alert">
                <span className="alert__icon" aria-hidden="true">⚠️</span>
                <div className="alert__body">
                  <div className="alert__title">保管人列表加载失败</div>
                  <div className="alert__desc">
                    {userError}。当前仍可手工录入保管人用户 ID，待权限服务恢复后再改用下拉选择。
                  </div>
                  <div className={styles.statusActions}>
                    <Button size="sm" variant="ghost" onClick={() => void userQuery.refetch()}>重试用户列表</Button>
                  </div>
                </div>
              </div>
            ) : null}
            <section className={styles.receiptSummary}>
              <div>
                <Tag variant={getReceiptStatusMeta(detail.status).variant}>{getReceiptStatusMeta(detail.status).label}</Tag>
                <h3>{detail.poNo || `PO#${detail.poId}`}</h3>
                <p>{detail.supplierName || '未绑定供应商'} · 收货时间 {formatDateTime(detail.receivedAt)}</p>
              </div>
              <div className={styles.metaGrid}>
                <div><span>入库单号</span><strong>{detail.receiptNo}</strong></div>
                <div><span>送货单</span><strong>{detail.deliveryNo || '—'}</strong></div>
                <div><span>收货数量</span><strong>{formatQty(detail.totalQty)}</strong></div>
                <div><span>金额</span><strong>{detail.totalAmount || '—'}</strong></div>
              </div>
            </section>

            {eligibleItems.length === 0 ? (
              <div className={styles.emptyBlock}>
                当前入库单没有需要验收建卡的资产明细。仅“固定资产”且入库方式为“资产待验收”的明细可在这里建卡。
              </div>
            ) : (
              <div className={styles.itemList}>
                {draftItems.map((draft) => {
                  const sourceItem = eligibleItems.find((item) => item.id === draft.receiptItemId);
                  if (!sourceItem) return null;
                  return (
                    <article key={draft.receiptItemId} className={styles.itemCard}>
                      <div className={styles.itemHeader}>
                        <div>
                          <strong>{draft.skuName || `SKU#${sourceItem.skuId}`}</strong>
                          <div className={styles.secondaryCell}>{draft.skuCode}</div>
                        </div>
                        <div className={styles.itemBadges}>
                          <Tag variant="info">{formatBusinessClassLabel(sourceItem.businessClass)}</Tag>
                          <Tag variant={getReceiptModeTagVariant(sourceItem.receiptMode)}>
                            {formatReceiptModeLabel(sourceItem.receiptMode)}
                          </Tag>
                          {sourceItem.requiresAcceptance ? <Tag variant="success">需验收</Tag> : null}
                        </div>
                      </div>

                      <div className={styles.itemMeta}>
                        <div><span>入库明细</span><strong>#{draft.receiptItemId}</strong></div>
                        <div><span>收货数量</span><strong>{formatQty(sourceItem.qtyReceived)}</strong></div>
                        <div><span>已建卡</span><strong>{formatQty(sourceItem.acceptedCardCount ?? 0)}</strong></div>
                        <div><span>单价</span><strong>{sourceItem.unitPrice}</strong></div>
                        <div><span>预算</span><strong>{sourceItem.budgetCode || '未配置'}</strong></div>
                      </div>

                      <label className={styles.countControl}>
                        <span>建卡数量</span>
                        <input
                          type="number"
                          min={1}
                          max={draft.qtyReceived}
                          value={draft.cards.length}
                          onChange={(e) => updateCardCount(
                            draft.receiptItemId,
                            Number(e.target.value),
                            sourceItem,
                          )}
                        />
                      </label>

                      <div className={styles.cardList}>
                        {draft.cards.map((card, index) => (
                          <div key={card.key} className={styles.cardDraft}>
                            <div className={styles.cardDraftTitle}>资产卡片 #{index + 1}</div>
                            <div className={styles.cardGrid}>
                              <label>
                                <span>资产名称</span>
                                <input
                                  value={card.assetName}
                                  onChange={(e) => updateDraftCard(draft.receiptItemId, card.key, 'assetName', e.target.value)}
                                />
                              </label>
                              <label>
                                <span>序列号</span>
                                <input
                                  value={card.serialNo}
                                  onChange={(e) => updateDraftCard(draft.receiptItemId, card.key, 'serialNo', e.target.value)}
                                  placeholder="如设备要求序列号，这里必须填写"
                                />
                              </label>
                              <label>
                                <span>资产标签号</span>
                                <input
                                  value={card.assetTagNo}
                                  onChange={(e) => updateDraftCard(draft.receiptItemId, card.key, 'assetTagNo', e.target.value)}
                                />
                              </label>
                              <label>
                                <span>使用部门</span>
                                <div className={styles.selectWithInput}>
                                  <select
                                    value={card.departmentId}
                                    onChange={(e) => updateDraftCard(draft.receiptItemId, card.key, 'departmentId', e.target.value)}
                                  >
                                    <option value="">未指定</option>
                                    {card.departmentId && !departmentOptions.some((department) => String(department?.id) === card.departmentId) ? (
                                      <option value={card.departmentId}>{formatDepartmentLabel(card.departmentId, departmentMap)}</option>
                                    ) : null}
                                    {departmentOptions.map((department) => (
                                      <option key={department!.id} value={department!.id}>
                                        {formatDepartmentLabel(department!.id, departmentMap)}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    value={card.departmentId}
                                    onChange={(e) => updateDraftCard(draft.receiptItemId, card.key, 'departmentId', e.target.value)}
                                    placeholder="可手输部门 ID"
                                  />
                                </div>
                              </label>
                              <label>
                                <span>保管人</span>
                                <div className={styles.selectWithInput}>
                                  <select
                                    value={card.custodianUserId}
                                    onChange={(e) => updateDraftCard(draft.receiptItemId, card.key, 'custodianUserId', e.target.value)}
                                  >
                                    <option value="">未指定</option>
                                    {card.custodianUserId && !userOptions.some((user) => String(user.id) === card.custodianUserId) ? (
                                      <option value={card.custodianUserId}>当前值 #{card.custodianUserId}</option>
                                    ) : null}
                                    {userOptions.map((user) => (
                                      <option key={user.id} value={user.id}>
                                        {user.realName}（{user.username}）
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    value={card.custodianUserId}
                                    onChange={(e) => updateDraftCard(draft.receiptItemId, card.key, 'custodianUserId', e.target.value)}
                                    placeholder="可手输用户 ID"
                                  />
                                </div>
                              </label>
                              <label>
                                <span>放置位置</span>
                                <input
                                  value={card.locationText}
                                  onChange={(e) => updateDraftCard(draft.receiptItemId, card.key, 'locationText', e.target.value)}
                                  placeholder="例如 设备区-A01"
                                />
                              </label>
                            </div>
                            <label className={styles.noteLabel}>
                              <span>备注</span>
                              <textarea
                                rows={2}
                                value={card.notes}
                                onChange={(e) => updateDraftCard(draft.receiptItemId, card.key, 'notes', e.target.value)}
                              />
                            </label>
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
