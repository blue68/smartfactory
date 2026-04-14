import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { usePermission } from '@/hooks/usePermission';
import { ACTION_CODES } from '@/constants/accessControl';
import { useAssetCardDetail, useAssetCardList, useReturnAssetCard } from '@/api/assets';
import type { AssetCard, AssetMovement } from '@/types/models';
import type { Column } from '@/components/common/Table';
import Table from '@/components/common/Table';
import Drawer from '@/components/common/Drawer';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import Tag from '@/components/common/Tag';
import {
  formatAssetCategoryLabel,
  formatAssetMovementPosition,
  formatAssetMovementSource,
} from '@/utils/assetDisplay';
import styles from './AssetLedgerPage.module.css';

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  return String(value).slice(0, 19).replace('T', ' ');
}

function formatCurrency(value?: string | null): string {
  if (!value) return '—';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parsed);
}

function formatCustodianLabel(params: {
  name?: string | null;
  username?: string | null;
  userId?: number | null;
}): string {
  const name = String(params.name ?? '').trim();
  const username = String(params.username ?? '').trim();
  if (name && username && name !== username) {
    return `${name} (${username})`;
  }
  if (name || username) {
    return name || username;
  }
  return params.userId ? `用户 #${params.userId}` : '未指定';
}

function getStatusMeta(status: AssetCard['status']): { label: string; variant: 'success' | 'warning' | 'info' | 'error' | 'neutral' } {
  switch (status) {
    case 'in_use':
      return { label: '使用中', variant: 'success' };
    case 'idle':
      return { label: '闲置', variant: 'warning' };
    case 'repair':
      return { label: '维修中', variant: 'info' };
    case 'scrapped':
      return { label: '已报废', variant: 'error' };
    case 'in_storage':
      return { label: '在库', variant: 'neutral' };
    default:
      return { label: status || '未知', variant: 'neutral' };
  }
}

function formatMovementLabel(type: AssetMovement['movementType']): string {
  switch (type) {
    case 'acceptance':
      return '验收建卡';
    case 'transfer':
      return '资产调拨';
    case 'return':
      return '资产退回';
    case 'scrap':
      return '资产报废';
    case 'repair':
      return '维修登记';
    default:
      return type || '未知动作';
  }
}

export default function AssetLedgerPage() {
  const setPageTitle = useAppStore((state) => state.setPageTitle);
  const showToast = useAppStore((state) => state.showToast);
  const { can } = usePermission();
  const canReturn = can(ACTION_CODES.ASSET_RETURN);

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [keyword, setKeyword] = useState('');
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnLocationText, setReturnLocationText] = useState('');
  const [returnNotes, setReturnNotes] = useState('');

  useEffect(() => {
    setPageTitle('资产台账');
  }, [setPageTitle]);

  const listQuery = useAssetCardList({
    status: status || undefined,
    keyword: keyword.trim() || undefined,
    page,
    pageSize: 12,
  });
  const detailQuery = useAssetCardDetail(selectedCardId);
  const returnMutation = useReturnAssetCard();

  const cardList = listQuery.data?.list ?? [];
  const detail = detailQuery.data?.id === selectedCardId ? detailQuery.data : null;
  const listError = listQuery.error instanceof Error ? listQuery.error.message : null;
  const detailError = detailQuery.error instanceof Error ? detailQuery.error.message : null;

  const columns: Column<AssetCard>[] = useMemo(() => [
    {
      key: 'assetNo',
      title: '资产编号',
      width: 180,
      render: (_value, record) => (
        <button type="button" className={styles.linkButton} onClick={() => setSelectedCardId(record.id)}>
          {record.assetNo}
        </button>
      ),
    },
    {
      key: 'assetName',
      title: '资产 / SKU',
      width: 240,
      render: (_value, record) => (
        <div>
          <div className={styles.primaryCell}>{record.assetName}</div>
          <div className={styles.secondaryCell}>{record.skuCode || '—'} · {record.skuName || '未绑定 SKU'}</div>
        </div>
      ),
    },
    {
      key: 'status',
      title: '状态',
      width: 120,
      render: (value) => {
        const meta = getStatusMeta(String(value));
        return <Tag variant={meta.variant}>{meta.label}</Tag>;
      },
    },
    {
      key: 'locationText',
      title: '当前位置',
      width: 180,
      render: (value, record) => (
        <div>
          <div className={styles.primaryCell}>{String(value ?? '未填写')}</div>
          <div className={styles.secondaryCell}>{record.departmentName || (record.departmentId ? `部门 #${record.departmentId}` : '未挂部门')}</div>
        </div>
      ),
    },
    {
      key: 'netValue',
      title: '净值',
      width: 140,
      render: (value) => formatCurrency(String(value ?? '')),
    },
    {
      key: 'capitalizedAt',
      title: '建卡时间',
      width: 180,
      render: (value) => formatDateTime(String(value ?? '')),
    },
  ], []);

  const handleOpenReturn = () => {
    if (!detail) return;
    setReturnLocationText(detail.locationText ?? '');
    setReturnNotes('');
    setReturnOpen(true);
  };

  const handleSubmitReturn = async () => {
    if (!detail) return;
    try {
      await returnMutation.mutateAsync({
        id: detail.id,
        payload: {
          locationText: returnLocationText.trim() || undefined,
          notes: returnNotes.trim() || undefined,
        },
      });
      showToast({ type: 'success', message: `资产 ${detail.assetNo} 已完成退回` });
      setReturnOpen(false);
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message || '资产退回失败' });
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>Asset Ledger</div>
          <h1 className={styles.title}>资产台账中心</h1>
          <p className={styles.subtitle}>固定资产不再混进库存快照里，这里单独看卡片、位置、责任部门和动作流水。</p>
        </div>
        <div className={styles.heroStats}>
          <div><span>台账总数</span><strong>{listQuery.data?.total ?? 0}</strong></div>
          <div><span>使用中</span><strong>{cardList.filter((item) => item.status === 'in_use').length}</strong></div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>资产卡片</h2>
            <p>点击资产编号查看详情、流水和退回入口。</p>
          </div>
          <div className={styles.filters}>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">全部状态</option>
              <option value="in_storage">在库</option>
              <option value="in_use">使用中</option>
              <option value="idle">闲置</option>
              <option value="repair">维修中</option>
              <option value="scrapped">已报废</option>
            </select>
            <input
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
              placeholder="搜索资产编号 / 名称 / SKU / 序列号"
            />
          </div>
        </div>

        <Table
          columns={columns}
          dataSource={cardList}
          rowKey="id"
          loading={listQuery.isLoading}
          error={listError}
          emptyText="尚未建卡，可从资产验收页进入"
          pagination={{
            page,
            pageSize: listQuery.data?.pageSize ?? 12,
            total: listQuery.data?.total ?? 0,
            onChange: setPage,
          }}
        />
      </section>

      <Drawer
        open={selectedCardId !== null}
        onClose={() => setSelectedCardId(null)}
        title={detail?.assetNo ? `资产详情 · ${detail.assetNo}` : '资产详情'}
        width={860}
        footer={detail ? (
          <div className={styles.drawerFooter}>
            <Button variant="ghost" onClick={() => setSelectedCardId(null)}>关闭</Button>
            {canReturn && detail.status !== 'scrapped' ? (
              <Button variant="warning" onClick={handleOpenReturn}>资产退回</Button>
            ) : null}
          </div>
        ) : null}
      >
        {detailError && !detail ? (
          <div className="alert alert--error" role="alert">
            <span className="alert__icon" aria-hidden="true">❌</span>
            <div className="alert__body">
              <div className="alert__title">资产详情加载失败</div>
              <div className="alert__desc">{detailError}</div>
              <div className={styles.statusActions}>
                <Button size="sm" variant="ghost" onClick={() => setSelectedCardId(null)}>关闭</Button>
                <Button size="sm" variant="primary" onClick={() => void detailQuery.refetch()}>重试</Button>
              </div>
            </div>
          </div>
        ) : !detail ? (
          <div className={styles.emptyBlock}>正在加载资产详情...</div>
        ) : (
          <div className={styles.detailWrap}>
            <section className={styles.summary}>
              <div>
                <Tag variant={getStatusMeta(detail.status).variant}>{getStatusMeta(detail.status).label}</Tag>
                <h3>{detail.assetName}</h3>
                <p>{detail.skuCode || '未绑定 SKU'} · {detail.serialNo || '无序列号'} · {detail.assetTagNo || '无标签号'}</p>
              </div>
              <div className={styles.metaGrid}>
                <div><span>资产编号</span><strong>{detail.assetNo}</strong></div>
                <div><span>资产分类</span><strong>{formatAssetCategoryLabel(detail.assetCategory)}</strong></div>
                <div><span>当前部门</span><strong>{detail.departmentName || (detail.departmentId ? `部门 #${detail.departmentId}` : '未分配')}</strong></div>
                <div><span>当前责任人</span><strong>{formatCustodianLabel({
                  name: detail.custodianName,
                  username: detail.custodianUsername,
                  userId: detail.custodianUserId,
                })}</strong></div>
                <div><span>当前位置</span><strong>{detail.locationText || '未填写'}</strong></div>
                <div><span>原值</span><strong>{formatCurrency(detail.originalValue)}</strong></div>
                <div><span>净值</span><strong>{formatCurrency(detail.netValue)}</strong></div>
                <div><span>建卡时间</span><strong>{formatDateTime(detail.capitalizedAt)}</strong></div>
                <div><span>采购入库单</span><strong>{detail.receiptNo || (detail.receiptId ? `#${detail.receiptId}` : '—')}</strong></div>
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionTitle}>动作流水</div>
              {(detail.movements ?? []).length === 0 ? (
                <div className={styles.emptyBlock}>该资产还没有流水记录</div>
              ) : (
                <div className={styles.timeline}>
                  {(detail.movements ?? []).map((movement) => (
                    <article key={movement.id} className={styles.timelineItem}>
                      <div className={styles.timelineMarker} />
                      <div className={styles.timelineBody}>
                        <div className={styles.timelineHeader}>
                          <strong>{formatMovementLabel(movement.movementType)}</strong>
                          <span>{formatDateTime(movement.occurredAt)}</span>
                        </div>
                        <div className={styles.timelineMeta}>
                          <span>流水号 {movement.movementNo}</span>
                          <span>来源 {formatAssetMovementSource(movement)}</span>
                        </div>
                        <div className={styles.timelineMeta}>
                          <span>来源位置：{formatAssetMovementPosition({
                            departmentName: movement.fromDepartmentName,
                            departmentId: movement.fromDepartmentId,
                            locationText: movement.fromLocationText,
                          })}</span>
                          <span>去向位置：{formatAssetMovementPosition({
                            departmentName: movement.toDepartmentName,
                            departmentId: movement.toDepartmentId,
                            locationText: movement.toLocationText,
                          })}</span>
                        </div>
                        {movement.notes ? <p className={styles.timelineNotes}>{movement.notes}</p> : null}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {detail.notes ? (
              <section className={styles.section}>
                <div className={styles.sectionTitle}>资产备注</div>
                <div className={styles.noteBlock}>{detail.notes}</div>
              </section>
            ) : null}
          </div>
        )}
      </Drawer>

      <Modal
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        onConfirm={() => void handleSubmitReturn()}
        confirmLabel="确认退回"
        confirmVariant="primary"
        confirmLoading={returnMutation.isPending}
        title="确认资产退回"
      >
        <div className={styles.modalBody}>
          <p>
            将退回资产 <strong>{detail?.assetNo || '—'}</strong>
            {detail?.departmentName || detail?.departmentId ? `，当前责任部门 ${detail?.departmentName || `部门 #${detail?.departmentId}`}` : ''}
            {detail?.custodianName || detail?.custodianUsername || detail?.custodianUserId ? `，当前责任人 ${formatCustodianLabel({
              name: detail?.custodianName,
              username: detail?.custodianUsername,
              userId: detail?.custodianUserId,
            })}` : ''}。
          </p>
          {detail?.locationText ? (
            <p className={styles.modalHint}>当前放置位置：{detail.locationText}</p>
          ) : null}
          <label>
            <span>退回位置</span>
            <input
              value={returnLocationText}
              onChange={(e) => setReturnLocationText(e.target.value)}
              placeholder="例如 资产中转区-A01"
            />
          </label>
          <label>
            <span>退回说明</span>
            <textarea
              rows={3}
              value={returnNotes}
              onChange={(e) => setReturnNotes(e.target.value)}
              placeholder="记录归还原因、交接信息或现场状态"
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}
