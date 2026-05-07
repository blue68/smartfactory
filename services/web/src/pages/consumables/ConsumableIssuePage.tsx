import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { usePermission } from '@/hooks/usePermission';
import { ACTION_CODES } from '@/constants/accessControl';
import {
  useApproveConsumableIssue,
  useConsumableIssueDetail,
  useConsumableIssueList,
  useConsumableStockList,
  useCreateConsumableIssue,
  useExecuteConsumableIssue,
} from '@/api/consumables';
import { useDepartmentList } from '@/api/departments';
import { useLocationOptions, useWarehouseOptions } from '@/api/inventory';
import type {
  ConsumableIssueItem,
  ConsumableIssueOrder,
  ConsumableStockItem,
  CreateConsumableIssuePayload,
} from '@/types/models';
import type { Column } from '@/components/common/Table';
import Table from '@/components/common/Table';
import Drawer from '@/components/common/Drawer';
import Button from '@/components/common/Button';
import Tag from '@/components/common/Tag';
import { buildDepartmentMap, formatDepartmentLabel, normalizeDepartmentId } from '@/utils/department';
import styles from './ConsumableIssuePage.module.css';

interface DraftIssueLine {
  key: string;
  skuId: number;
  skuCode: string;
  skuName: string;
  warehouseId?: number;
  locationId?: number;
  warehouseName?: string;
  locationName?: string;
  availableQty?: string;
  stockUnit?: string;
  qtyRequested: string;
  issueUnit: string;
  budgetCode: string;
  notes: string;
}

function getStockKey(params: { skuId: number; warehouseId?: number | null; locationId?: number | null }): string {
  return `${params.skuId}-${params.warehouseId ?? 0}-${params.locationId ?? 0}`;
}

function formatQty(value?: string | number | null): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return '0';
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2);
}

function getIssueStatusTag(status: ConsumableIssueOrder['status']): { label: string; variant: 'warning' | 'success' | 'error' | 'info' | 'neutral' } {
  switch (status) {
    case 'draft':
      return { label: '待审批', variant: 'warning' };
    case 'approved':
      return { label: '已审批', variant: 'info' };
    case 'issued':
      return { label: '已发放', variant: 'success' };
    case 'rejected':
      return { label: '已驳回', variant: 'error' };
    default:
      return { label: status || '未知', variant: 'neutral' };
  }
}

function getStockTone(item: ConsumableStockItem): 'danger' | 'warning' | 'safe' {
  const available = Number(item.qtyAvailable ?? 0);
  if (available <= 0) return 'danger';
  if (available < 10) return 'warning';
  return 'safe';
}

function newDraftLine(stock: ConsumableStockItem): DraftIssueLine {
  return {
    key: `${stock.skuId}-${stock.warehouseId ?? 0}-${stock.locationId ?? 0}-${Date.now()}`,
    skuId: stock.skuId,
    skuCode: stock.skuCode,
    skuName: stock.skuName,
    warehouseId: stock.warehouseId ?? undefined,
    locationId: stock.locationId ?? undefined,
    warehouseName: stock.warehouseName ?? undefined,
    locationName: stock.locationName ?? undefined,
    availableQty: stock.qtyAvailable,
    stockUnit: stock.stockUnit,
    qtyRequested: '',
    issueUnit: stock.stockUnit,
    budgetCode: '',
    notes: '',
  };
}

export default function ConsumableIssuePage() {
  const setPageTitle = useAppStore((state) => state.setPageTitle);
  const showToast = useAppStore((state) => state.showToast);
  const { can } = usePermission();

  const canCreate = can(ACTION_CODES.CONSUMABLE_ISSUE_CREATE);
  const canApprove = can(ACTION_CODES.CONSUMABLE_ISSUE_APPROVE);
  const canExecute = can(ACTION_CODES.CONSUMABLE_ISSUE_EXECUTE);

  const [issueStatus, setIssueStatus] = useState('');
  const [issueKeyword, setIssueKeyword] = useState('');
  const [issuePage, setIssuePage] = useState(1);
  const [stockKeyword, setStockKeyword] = useState('');
  const [stockPage, setStockPage] = useState(1);
  const [selectedIssueId, setSelectedIssueId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [approvalNote, setApprovalNote] = useState('');
  const [executeNote, setExecuteNote] = useState('');
  const [form, setForm] = useState<{
    requestDepartmentId: string;
    purpose: string;
    notes: string;
    items: DraftIssueLine[];
  }>({
    requestDepartmentId: '',
    purpose: '',
    notes: '',
    items: [],
  });

  useEffect(() => {
    setPageTitle('损耗品领用');
  }, [setPageTitle]);

  const issueQuery = useConsumableIssueList({
    status: issueStatus || undefined,
    keyword: issueKeyword.trim() || undefined,
    page: issuePage,
    pageSize: 10,
  });
  const stockQuery = useConsumableStockList({
    keyword: stockKeyword.trim() || undefined,
    page: stockPage,
    pageSize: 8,
  });
  const detailQuery = useConsumableIssueDetail(selectedIssueId);
  const createMutation = useCreateConsumableIssue();
  const approveMutation = useApproveConsumableIssue();
  const executeMutation = useExecuteConsumableIssue();
  const departmentQuery = useDepartmentList({ page: 1, pageSize: 200 });
  const warehouseQuery = useWarehouseOptions();
  const locationQuery = useLocationOptions(undefined);

  const issueList = useMemo(() => issueQuery.data?.list ?? [], [issueQuery.data?.list]);
  const stockList = useMemo(() => stockQuery.data?.list ?? [], [stockQuery.data?.list]);
  const departments = useMemo(() => departmentQuery.data?.list ?? [], [departmentQuery.data?.list]);
  const warehouseOptions = warehouseQuery.data ?? [];
  const locationOptions = locationQuery.data ?? [];
  const detail = detailQuery.data?.id === selectedIssueId ? detailQuery.data : null;
  const issueError = issueQuery.error instanceof Error ? issueQuery.error.message : null;
  const stockError = stockQuery.error instanceof Error ? stockQuery.error.message : null;
  const detailError = detailQuery.error instanceof Error ? detailQuery.error.message : null;
  const stockContextError = warehouseQuery.error instanceof Error || locationQuery.error instanceof Error
    ? [
        warehouseQuery.error instanceof Error ? `仓库选项加载失败：${warehouseQuery.error.message}` : null,
        locationQuery.error instanceof Error ? `库位选项加载失败：${locationQuery.error.message}` : null,
      ].filter(Boolean).join('；')
    : null;
  const draftLineRefs = useRef<Record<string, HTMLElement | null>>({});
  const departmentMap = useMemo(() => buildDepartmentMap(departments), [departments]);
  const stockByKey = useMemo(
    () => new Map(stockList.map((item) => [getStockKey(item), item])),
    [stockList],
  );
  const departmentOptions = useMemo(() => {
    const sourceIds = new Set<number>();
    departments
      .filter((item) => item.status === 'active')
      .forEach((item) => sourceIds.add(item.id));
    issueList.forEach((item) => {
      const departmentId = normalizeDepartmentId(item.requestDepartmentId);
      if (departmentId) sourceIds.add(departmentId);
    });
    const detailDepartmentId = normalizeDepartmentId(detail?.requestDepartmentId);
    if (detailDepartmentId) sourceIds.add(detailDepartmentId);
    const formDepartmentId = normalizeDepartmentId(form.requestDepartmentId);
    if (formDepartmentId) sourceIds.add(formDepartmentId);
    return Array.from(sourceIds)
      .map((departmentId) => departmentMap.get(departmentId))
      .filter(Boolean)
      .sort((left, right) => Number(left?.sortOrder ?? 0) - Number(right?.sortOrder ?? 0) || Number(left?.id ?? 0) - Number(right?.id ?? 0));
  }, [departmentMap, departments, detail?.requestDepartmentId, form.requestDepartmentId, issueList]);

  const issueColumns: Column<ConsumableIssueOrder>[] = useMemo(() => [
    {
      key: 'issueNo',
      title: '领用单号',
      width: 180,
      render: (_value, record) => (
        <button type="button" className={styles.linkButton} onClick={() => setSelectedIssueId(record.id)}>
          {record.issueNo}
        </button>
      ),
    },
    {
      key: 'purpose',
      title: '用途 / 备注',
      width: 280,
      render: (_value, record) => (
        <div>
          <div className={styles.primaryCell}>{record.purpose || '未填写用途'}</div>
          <div className={styles.secondaryCell}>{record.notes || '无附加说明'}</div>
        </div>
      ),
    },
    {
      key: 'requestDepartmentId',
      title: '领用部门',
      width: 120,
      render: (value) => formatDepartmentLabel(value as string | number | null, departmentMap),
    },
    {
      key: 'totalQtyRequested',
      title: '申请 / 发放',
      width: 140,
      render: (_value, record) => (
        <div>
          <div className={styles.primaryCell}>{formatQty(record.totalQtyRequested)}</div>
          <div className={styles.secondaryCell}>已发 {formatQty(record.totalQtyIssued)}</div>
        </div>
      ),
    },
    {
      key: 'status',
      title: '状态',
      width: 120,
      render: (value) => {
        const tone = getIssueStatusTag(String(value));
        return <Tag variant={tone.variant}>{tone.label}</Tag>;
      },
    },
    {
      key: 'createdAt',
      title: '创建时间',
      width: 180,
      render: (value) => String(value ?? '').slice(0, 19).replace('T', ' ') || '—',
    },
  ], [departmentMap]);

  const stockColumns: Column<ConsumableStockItem>[] = useMemo(() => [
    {
      key: 'skuCode',
      title: 'SKU',
      width: 160,
      render: (_value, record) => (
        <div>
          <div className={styles.primaryCell}>{record.skuCode}</div>
          <div className={styles.secondaryCell}>{record.skuName}</div>
        </div>
      ),
    },
    {
      key: 'warehouseName',
      title: '仓库 / 库位',
      width: 200,
      render: (_value, record) => (
        <div>
          <div className={styles.primaryCell}>{record.warehouseName || '未配置仓库'}</div>
          <div className={styles.secondaryCell}>{record.locationName || '未配置库位'}</div>
        </div>
      ),
    },
    {
      key: 'qtyAvailable',
      title: '可用库存',
      width: 120,
      render: (_value, record) => {
        const tone = getStockTone(record);
        return (
          <div className={styles.stockMetric}>
            <strong>{formatQty(record.qtyAvailable)}</strong>
            <Tag variant={tone === 'danger' ? 'error' : tone === 'warning' ? 'warning' : 'success'}>
              {tone === 'danger' ? '库存不足' : tone === 'warning' ? '临近下限' : '可领用'}
            </Tag>
          </div>
        );
      },
    },
    {
      key: 'id',
      title: '操作',
      width: 120,
      render: (_value, record) => (
        <Button
          size="sm"
          variant="text"
          disabled={!canCreate}
          onClick={() => {
            setCreateOpen(true);
            setForm((prev) => ({
              ...prev,
              items: [...prev.items, newDraftLine(record)],
            }));
          }}
        >
          加入领用单
        </Button>
      ),
    },
  ], [canCreate]);

  const handleDraftLineChange = (key: string, field: keyof DraftIssueLine, value: string | number | undefined) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.key !== key) return item;
        const nextItem = {
          ...item,
          [field]: value,
          ...(field === 'warehouseId' ? { locationId: undefined } : null),
        };
        const matchedStock = stockByKey.get(getStockKey({
          skuId: nextItem.skuId,
          warehouseId: typeof nextItem.warehouseId === 'number' ? nextItem.warehouseId : undefined,
          locationId: typeof nextItem.locationId === 'number' ? nextItem.locationId : undefined,
        }));
        return {
          ...nextItem,
          warehouseName: matchedStock?.warehouseName ?? nextItem.warehouseName,
          locationName: matchedStock?.locationName ?? nextItem.locationName,
          availableQty: matchedStock?.qtyAvailable ?? nextItem.availableQty,
          stockUnit: matchedStock?.stockUnit ?? nextItem.stockUnit,
        };
      }),
    }));
  };

  const handleRemoveLine = (key: string) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.key !== key),
    }));
  };

  const handleCreateIssue = async () => {
    if (form.items.length === 0) {
      showToast({ type: 'warning', message: '请先从库存面板加入至少一条领用明细' });
      return;
    }

    const payloadItems: CreateConsumableIssuePayload['items'] = [];
    for (const item of form.items) {
      if (!item.qtyRequested || Number(item.qtyRequested) <= 0) {
        showToast({ type: 'warning', message: `请填写 ${item.skuCode} 的领用数量` });
        return;
      }
      if (!item.issueUnit.trim()) {
        showToast({ type: 'warning', message: `请填写 ${item.skuCode} 的领用单位` });
        return;
      }
      if (item.availableQty != null && Number(item.qtyRequested) > Number(item.availableQty)) {
        showToast({
          type: 'warning',
          message: `${item.skuCode} 可用库存仅 ${formatQty(item.availableQty)} ${item.stockUnit || item.issueUnit}，当前申请超量`,
        });
        draftLineRefs.current[item.key]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      payloadItems.push({
        skuId: item.skuId,
        warehouseId: item.warehouseId,
        locationId: item.locationId,
        qtyRequested: item.qtyRequested.trim(),
        issueUnit: item.issueUnit.trim(),
        budgetCode: item.budgetCode.trim() || undefined,
        notes: item.notes.trim() || undefined,
      });
    }

    try {
      const result = await createMutation.mutateAsync({
        requestDepartmentId: form.requestDepartmentId ? Number(form.requestDepartmentId) : undefined,
        purpose: form.purpose.trim() || undefined,
        notes: form.notes.trim() || undefined,
        items: payloadItems,
      });
      showToast({ type: 'success', message: `领用单 ${result.issueNo} 已创建` });
      setCreateOpen(false);
      setForm({
        requestDepartmentId: '',
        purpose: '',
        notes: '',
        items: [],
      });
      setSelectedIssueId(result.id);
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message || '创建领用单失败' });
    }
  };

  const handleApprove = async (approved: boolean) => {
    if (!detail) return;
    try {
      await approveMutation.mutateAsync({
        id: detail.id,
        payload: {
          approved,
          notes: approvalNote.trim() || undefined,
        },
      });
      showToast({ type: 'success', message: approved ? '领用单已审批通过' : '领用单已驳回' });
      setApprovalNote('');
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message || '审批失败' });
    }
  };

  const handleExecute = async () => {
    if (!detail) return;
    try {
      await executeMutation.mutateAsync({
        id: detail.id,
        payload: { notes: executeNote.trim() || undefined },
      });
      showToast({ type: 'success', message: '损耗品已完成出库' });
      setExecuteNote('');
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message || '执行出库失败' });
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>Consumable Operations</div>
          <h1 className={styles.title}>损耗品领用台</h1>
          <p className={styles.subtitle}>把领用申请、审批和实际出库收在一个页面里，同时保留库存视角。</p>
        </div>
        <div className={styles.heroActions}>
          <Button variant="ghost" onClick={() => stockQuery.refetch()}>刷新库存</Button>
          <Button variant="primary" disabled={!canCreate} onClick={() => setCreateOpen(true)}>新建领用单</Button>
        </div>
      </section>

      <section className={styles.summaryStrip}>
        <article className={styles.summaryCard}>
          <span>领用单总数</span>
          <strong>{issueQuery.data?.total ?? 0}</strong>
          <small>当前筛选结果</small>
        </article>
        <article className={styles.summaryCard}>
          <span>待审批</span>
          <strong>{issueList.filter((item) => item.status === 'draft').length}</strong>
          <small>主管待处理</small>
        </article>
        <article className={styles.summaryCard}>
          <span>已审批待出库</span>
          <strong>{issueList.filter((item) => item.status === 'approved').length}</strong>
          <small>仓库待执行</small>
        </article>
      </section>

      {issueError || stockError ? (
        <div className="alert alert--warning" role="alert">
          <span className="alert__icon" aria-hidden="true">⚠️</span>
          <div className="alert__body">
            <div className="alert__title">联调数据暂不可用</div>
            <div className="alert__desc">
              {[issueError ? `领用单列表：${issueError}` : null, stockError ? `库存面板：${stockError}` : null]
                .filter(Boolean)
                .join('；')}
            </div>
          </div>
        </div>
      ) : null}

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>领用单列表</h2>
              <p>按状态推进“待审批 → 已审批 → 已发放”，点击单号查看明细。</p>
            </div>
            <div className={styles.filters}>
              <select value={issueStatus} onChange={(e) => { setIssueStatus(e.target.value); setIssuePage(1); }}>
                <option value="">全部状态</option>
                <option value="draft">待审批</option>
                <option value="approved">已审批</option>
                <option value="issued">已发放</option>
                <option value="rejected">已驳回</option>
              </select>
              <input
                value={issueKeyword}
                onChange={(e) => { setIssueKeyword(e.target.value); setIssuePage(1); }}
                placeholder="搜索单号或用途"
              />
            </div>
          </div>

          <Table
            columns={issueColumns}
            dataSource={issueList}
            rowKey="id"
            loading={issueQuery.isLoading}
            error={issueError}
            emptyText="暂无领用单，可从右上角创建"
            pagination={{
              page: issuePage,
              pageSize: issueQuery.data?.pageSize ?? 10,
              total: issueQuery.data?.total ?? 0,
              onChange: setIssuePage,
            }}
          />
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>可领用库存</h2>
              <p>从库存面板选货，直接塞进新建领用单，减少反复查 SKU。</p>
            </div>
            <div className={styles.filters}>
              <input
                value={stockKeyword}
                onChange={(e) => { setStockKeyword(e.target.value); setStockPage(1); }}
                placeholder="搜索 SKU 编码或名称"
              />
            </div>
          </div>

          <Table
            columns={stockColumns}
            dataSource={stockList}
            rowKey={(record) => `${record.skuId}-${record.warehouseId ?? 0}-${record.locationId ?? 0}`}
            loading={stockQuery.isLoading}
            error={stockError}
            emptyText="暂无可领用库存"
            pagination={{
              page: stockPage,
              pageSize: stockQuery.data?.pageSize ?? 8,
              total: stockQuery.data?.total ?? 0,
              onChange: setStockPage,
            }}
          />
        </section>
      </div>

      <Drawer
        open={selectedIssueId !== null}
        onClose={() => {
          setSelectedIssueId(null);
          setApprovalNote('');
          setExecuteNote('');
        }}
        title={detail?.issueNo ? `领用单详情 · ${detail.issueNo}` : '领用单详情'}
        width={820}
        footer={detail ? (
          <div className={styles.drawerFooter}>
            <Button variant="ghost" onClick={() => setSelectedIssueId(null)}>关闭</Button>
            {detail.status === 'draft' && canApprove ? (
              <>
                <Button variant="danger" onClick={() => void handleApprove(false)} loading={approveMutation.isPending}>驳回</Button>
                <Button variant="primary" onClick={() => void handleApprove(true)} loading={approveMutation.isPending}>审批通过</Button>
              </>
            ) : null}
            {detail.status === 'approved' && canExecute ? (
              <Button variant="success" onClick={() => void handleExecute()} loading={executeMutation.isPending}>执行出库</Button>
            ) : null}
          </div>
        ) : null}
      >
        {detailError && !detail ? (
          <div className="alert alert--error" role="alert">
            <span className="alert__icon" aria-hidden="true">❌</span>
            <div className="alert__body">
              <div className="alert__title">领用单详情加载失败</div>
              <div className="alert__desc">{detailError}</div>
              <div className={styles.statusActions}>
                <Button size="sm" variant="ghost" onClick={() => setSelectedIssueId(null)}>关闭</Button>
                <Button size="sm" variant="primary" onClick={() => void detailQuery.refetch()}>重试</Button>
              </div>
            </div>
          </div>
        ) : !detail ? (
          <div className={styles.emptyBlock}>正在加载领用单详情...</div>
        ) : (
          <div className={styles.detailWrap}>
            <section className={styles.detailHero}>
              <div>
                <Tag variant={getIssueStatusTag(detail.status).variant}>{getIssueStatusTag(detail.status).label}</Tag>
                <h3>{detail.purpose || '未填写用途'}</h3>
                <p>{detail.notes || '该领用单没有附加备注'}</p>
              </div>
              <div className={styles.metaGrid}>
                <div><span>部门</span><strong>{formatDepartmentLabel(detail.requestDepartmentId, departmentMap)}</strong></div>
                <div><span>审批时间</span><strong>{detail.approvedAt ? String(detail.approvedAt).slice(0, 19).replace('T', ' ') : '—'}</strong></div>
                <div><span>出库时间</span><strong>{detail.issuedAt ? String(detail.issuedAt).slice(0, 19).replace('T', ' ') : '—'}</strong></div>
                <div><span>创建时间</span><strong>{detail.createdAt ? String(detail.createdAt).slice(0, 19).replace('T', ' ') : '—'}</strong></div>
              </div>
            </section>

            {detail.status === 'draft' && canApprove ? (
              <section className={styles.noteSection}>
                <label htmlFor="approval-note">审批备注</label>
                <textarea
                  id="approval-note"
                  value={approvalNote}
                  onChange={(e) => setApprovalNote(e.target.value)}
                  rows={3}
                  placeholder="填写审批意见，留给后续追溯"
                />
              </section>
            ) : null}

            {detail.status === 'approved' && canExecute ? (
              <section className={styles.noteSection}>
                <label htmlFor="execute-note">出库备注</label>
                <textarea
                  id="execute-note"
                  value={executeNote}
                  onChange={(e) => setExecuteNote(e.target.value)}
                  rows={3}
                  placeholder="如有领用说明或班组备注，可记录在这里"
                />
              </section>
            ) : null}

            <section className={styles.itemsSection}>
              <div className={styles.sectionTitle}>领用明细</div>
              {(detail.items ?? []).length === 0 ? (
                <div className={styles.emptyBlock}>领用单没有可展示的明细</div>
              ) : (
                <div className={styles.itemCards}>
                  {(detail.items ?? []).map((item: ConsumableIssueItem) => (
                    <article key={item.id} className={styles.itemCard}>
                      <div className={styles.itemCardHeader}>
                        <div>
                          <strong>{item.skuName || `SKU#${item.skuId}`}</strong>
                          <div className={styles.secondaryCell}>{item.skuCode}</div>
                        </div>
                        <div className={styles.itemQty}>
                          {formatQty(item.qtyIssued)} / {formatQty(item.qtyRequested)} {item.issueUnit}
                        </div>
                      </div>
                      <div className={styles.itemMetaGrid}>
                        <div><span>仓库</span><strong>{item.warehouseId ? `#${item.warehouseId}` : '未指定'}</strong></div>
                        <div><span>库位</span><strong>{item.locationId ? `#${item.locationId}` : '未指定'}</strong></div>
                        <div><span>预算</span><strong>{item.budgetCode || '未填写'}</strong></div>
                        <div><span>备注</span><strong>{item.notes || '—'}</strong></div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </Drawer>

      <Drawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建领用单"
        width={920}
        footer={(
          <div className={styles.drawerFooter}>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button variant="primary" onClick={() => void handleCreateIssue()} loading={createMutation.isPending}>提交领用单</Button>
          </div>
        )}
      >
        <div className={styles.formShell}>
          {stockContextError ? (
            <div className="alert alert--warning" role="alert">
              <span className="alert__icon" aria-hidden="true">⚠️</span>
              <div className="alert__body">
                <div className="alert__title">仓库上下文暂不可用</div>
                <div className="alert__desc">
                  {stockContextError}。当前仍可先录入基础领用信息，仓库和库位可待联调环境恢复后补齐。
                </div>
                <div className={styles.statusActions}>
                  <Button size="sm" variant="ghost" onClick={() => void warehouseQuery.refetch()}>重试仓库</Button>
                  <Button size="sm" variant="ghost" onClick={() => void locationQuery.refetch()}>重试库位</Button>
                </div>
              </div>
            </div>
          ) : null}
          <div className={styles.formGrid}>
            <label>
              <span>领用部门</span>
              <div className={`${styles.selectWithInput} ${normalizeDepartmentId(form.requestDepartmentId) ? styles.selectOnly : ''}`}>
                <select
                  value={form.requestDepartmentId}
                  onChange={(e) => setForm((prev) => ({ ...prev, requestDepartmentId: e.target.value }))}
                >
                  <option value="">未指定</option>
                  {form.requestDepartmentId && !departmentOptions.some((department) => String(department?.id) === form.requestDepartmentId) ? (
                    <option value={form.requestDepartmentId}>{formatDepartmentLabel(form.requestDepartmentId, departmentMap)}</option>
                  ) : null}
                  {departmentOptions.map((department) => (
                    <option key={department!.id} value={department!.id}>
                      {formatDepartmentLabel(department!.id, departmentMap)}
                    </option>
                  ))}
                </select>
                {!normalizeDepartmentId(form.requestDepartmentId) ? (
                  <input
                    value={form.requestDepartmentId}
                    onChange={(e) => setForm((prev) => ({ ...prev, requestDepartmentId: e.target.value }))}
                    placeholder="也可直接填写部门 ID"
                    inputMode="numeric"
                  />
                ) : null}
              </div>
            </label>
            <label>
              <span>领用用途</span>
              <input
                value={form.purpose}
                onChange={(e) => setForm((prev) => ({ ...prev, purpose: e.target.value }))}
                placeholder="例如 车间防护用品周领用"
              />
            </label>
          </div>
          <label className={styles.textareaLabel}>
            <span>领用说明</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              rows={3}
              placeholder="补充审批背景、领用频次或班组说明"
            />
          </label>

          <div className={styles.formSection}>
            <div className={styles.sectionTitle}>已加入明细</div>
            {form.items.length === 0 ? (
              <div className={styles.emptyBlock}>还没有选择领用明细。可从右侧库存表点击“加入领用单”。</div>
            ) : (
              <div className={styles.lineList}>
                {form.items.map((item) => {
                  const lineLocations = item.warehouseId
                    ? locationOptions.filter((location) => location.warehouseId === item.warehouseId)
                    : [];
                  return (
                    <article key={item.key} className={styles.lineCard}>
                      <div
                        ref={(node) => {
                          draftLineRefs.current[item.key] = node;
                        }}
                      />
                      <div className={styles.lineCardHeader}>
                        <div>
                          <strong>{item.skuName}</strong>
                          <div className={styles.secondaryCell}>{item.skuCode}</div>
                          {(item.warehouseName || item.locationName || item.availableQty != null) ? (
                            <div className={styles.secondaryCell}>
                              {item.warehouseName || '未指定仓库'}
                              {item.locationName ? ` / ${item.locationName}` : ''}
                              {item.availableQty != null ? ` · 可用 ${formatQty(item.availableQty)} ${item.stockUnit || item.issueUnit}` : ''}
                            </div>
                          ) : null}
                        </div>
                        <Button size="sm" variant="text" onClick={() => handleRemoveLine(item.key)}>移除</Button>
                      </div>
                      <div className={styles.lineGrid}>
                        <label>
                          <span>领用数量</span>
                          <input
                            value={item.qtyRequested}
                            onChange={(e) => handleDraftLineChange(item.key, 'qtyRequested', e.target.value)}
                            placeholder="0"
                          />
                        </label>
                        <label>
                          <span>领用单位</span>
                          <input
                            value={item.issueUnit}
                            onChange={(e) => handleDraftLineChange(item.key, 'issueUnit', e.target.value)}
                          />
                        </label>
                        <label>
                          <span>仓库</span>
                          <select
                            value={item.warehouseId ?? ''}
                            onChange={(e) => handleDraftLineChange(
                              item.key,
                              'warehouseId',
                              e.target.value ? Number(e.target.value) : undefined,
                            )}
                          >
                            <option value="">未指定</option>
                            {warehouseOptions.map((warehouse) => (
                              <option key={warehouse.id} value={warehouse.id}>
                                {warehouse.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>库位</span>
                          <select
                            value={item.locationId ?? ''}
                            onChange={(e) => handleDraftLineChange(
                              item.key,
                              'locationId',
                              e.target.value ? Number(e.target.value) : undefined,
                            )}
                          >
                            <option value="">未指定</option>
                            {lineLocations.map((location) => (
                              <option key={location.id} value={location.id}>
                                {location.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>预算编码</span>
                          <input
                            value={item.budgetCode}
                            onChange={(e) => handleDraftLineChange(item.key, 'budgetCode', e.target.value)}
                            placeholder="可选"
                          />
                        </label>
                        <label>
                          <span>行备注</span>
                          <input
                            value={item.notes}
                            onChange={(e) => handleDraftLineChange(item.key, 'notes', e.target.value)}
                            placeholder="可选"
                          />
                        </label>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Drawer>
    </div>
  );
}
