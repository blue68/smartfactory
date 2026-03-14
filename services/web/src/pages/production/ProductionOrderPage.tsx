/**
 * [artifact:前端代码] — 生产工单管理页面 (R-10)
 */
import { useState, useCallback, useMemo } from 'react';
import {
  useProductionOrderList,
  useProductionOrderDetail,
  useCreateFromSalesOrder,
  useMaterialRequirements,
  useCancelOrder,
} from '@/api/production';
import type { MaterialRequirement } from '@/api/production';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import Table from '@/components/common/Table';
import Drawer from '@/components/common/Drawer';
import type { Column } from '@/components/common/Table';
import styles from './ProductionOrderPage.module.css';

interface OrderRow {
  id: number;
  workOrderNo: string;
  salesOrderNo: string;
  skuName: string;
  qtyPlanned: string;
  qtyCompleted: string;
  status: string;
  plannedEnd: string;
  progressPct: number;
  [key: string]: unknown;
}

type MaterialRow = MaterialRequirement;

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  pending: { label: '待排产', cls: styles.badgePending },
  scheduled: { label: '已排产', cls: styles.badgeScheduled },
  in_progress: { label: '生产中', cls: styles.badgeInProgress },
  completed: { label: '已完工', cls: styles.badgeCompleted },
  cancelled: { label: '已取消', cls: styles.badgeCancelled },
};

export default function ProductionOrderPage() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerTab, setDrawerTab] = useState<'info' | 'materials'>('info');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [salesOrderIdInput, setSalesOrderIdInput] = useState('');

  const { data: listData, isLoading } = useProductionOrderList(
    { status: (statusFilter || undefined) as any },
    page,
    20,
  );
  const { data: detailData } = useProductionOrderDetail(selectedId);
  const { data: materialsData } = useMaterialRequirements(selectedId);
  const createFromSO = useCreateFromSalesOrder();
  const cancelOrder = useCancelOrder();

  const list = ((listData as any)?.list ?? []) as OrderRow[];
  const total = (listData as any)?.total ?? 0;
  const detail = detailData as OrderRow | undefined;
  const materials = (materialsData ?? []) as MaterialRow[];

  const columns: Column<OrderRow>[] = useMemo(() => [
    { key: 'workOrderNo', title: '工单号', width: 140 },
    { key: 'salesOrderNo', title: '销售订单', width: 120 },
    { key: 'skuName', title: '产品', width: 160 },
    { key: 'qtyPlanned', title: '计划数量', width: 90, align: 'right' },
    { key: 'qtyCompleted', title: '已完成', width: 80, align: 'right' },
    {
      key: 'status', title: '状态', width: 90,
      render: (v) => {
        const s = STATUS_MAP[v as string] ?? STATUS_MAP.pending;
        return <span className={`${styles.badge} ${s.cls}`}>{s.label}</span>;
      },
    },
    { key: 'plannedEnd', title: '计划完工', width: 100, render: (v) => String(v ?? '-') },
    {
      key: 'progressPct', title: '进度', width: 70,
      render: (v) => `${v ?? 0}%`,
    },
    {
      key: 'id', title: '操作', width: 80,
      render: (_, r) => (
        <Button size="sm" variant="text" onClick={() => { setSelectedId(r.id); setDrawerTab('info'); }}>
          详情
        </Button>
      ),
    },
  ], []);

  const materialColumns: Column<MaterialRow>[] = useMemo(() => [
    { key: 'skuCode', title: 'SKU编码', width: 120 },
    { key: 'skuName', title: 'SKU名称', width: 160 },
    { key: 'qtyRequired', title: '需求量', width: 90, align: 'right' },
    { key: 'currentStock', title: '可用库存', width: 90, align: 'right' },
    { key: 'inTransit', title: '在途', width: 80, align: 'right' },
    {
      key: 'qtyShortage', title: '缺口', width: 80, align: 'right',
      render: (v) => {
        const n = Number(v);
        return <span style={{ color: n > 0 ? '#dc2626' : '#059669', fontWeight: 600 }}>{String(v)}</span>;
      },
    },
    {
      key: 'status', title: '状态', width: 80,
      render: (v) => {
        const color = v === 'fulfilled' ? '#059669' : v === 'partial' ? '#d97706' : '#dc2626';
        return <span style={{ color, fontWeight: 600 }}>{v === 'fulfilled' ? '充足' : v === 'partial' ? '部分' : '缺料'}</span>;
      },
    },
  ], []);

  const handleCreate = useCallback(async () => {
    const soId = Number(salesOrderIdInput);
    if (!soId || soId <= 0) return;
    await createFromSO.mutateAsync(soId);
    setShowCreateModal(false);
    setSalesOrderIdInput('');
  }, [salesOrderIdInput, createFromSO]);

  const handleCancel = useCallback(async () => {
    if (!selectedId) return;
    await cancelOrder.mutateAsync(selectedId);
    setShowCancelModal(false);
    setSelectedId(null);
  }, [selectedId, cancelOrder]);

  return (
    <div className={styles.container}>
      <div className={styles.actions}>
        <Button onClick={() => setShowCreateModal(true)}>从销售订单创建工单</Button>
      </div>

      <div className={styles.filterRow}>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">全部状态</option>
          <option value="pending">待排产</option>
          <option value="scheduled">已排产</option>
          <option value="in_progress">生产中</option>
          <option value="completed">已完工</option>
          <option value="cancelled">已取消</option>
        </select>
        <input placeholder="搜索工单号/产品..." value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      </div>

      <Table<OrderRow>
        columns={columns}
        dataSource={list}
        loading={isLoading}
        pagination={{ page, pageSize: 20, total, onChange: setPage }}
        rowKey="id"
      />

      {/* 详情 Drawer */}
      <Drawer open={selectedId !== null} onClose={() => setSelectedId(null)} title={`工单详情 - ${detail?.workOrderNo ?? ''}`} width={640}>
        {detail && (
          <>
            <div className={styles.tabRow}>
              <div className={`${styles.tab} ${drawerTab === 'info' ? styles.tabActive : ''}`} onClick={() => setDrawerTab('info')}>基本信息</div>
              <div className={`${styles.tab} ${drawerTab === 'materials' ? styles.tabActive : ''}`} onClick={() => setDrawerTab('materials')}>物料需求</div>
            </div>

            {drawerTab === 'info' && (
              <div className={styles.drawerSection}>
                <dl className={styles.infoGrid}>
                  <dt>工单号</dt><dd>{detail.workOrderNo}</dd>
                  <dt>销售订单</dt><dd>{detail.salesOrderNo ?? '-'}</dd>
                  <dt>产品</dt><dd>{detail.skuName ?? '-'}</dd>
                  <dt>计划数量</dt><dd>{detail.qtyPlanned}</dd>
                  <dt>已完成</dt><dd>{detail.qtyCompleted}</dd>
                  <dt>状态</dt><dd>{STATUS_MAP[detail.status]?.label ?? detail.status}</dd>
                  <dt>进度</dt><dd>{detail.progressPct}%</dd>
                  <dt>计划完工</dt><dd>{detail.plannedEnd ?? '-'}</dd>
                </dl>
                {detail.status === 'pending' && (
                  <div style={{ marginTop: '1rem' }}>
                    <Button variant="danger" onClick={() => setShowCancelModal(true)}>取消工单</Button>
                  </div>
                )}
              </div>
            )}

            {drawerTab === 'materials' && (
              <div className={styles.drawerSection}>
                <h4>原材料需求明细</h4>
                <Table<MaterialRow>
                  columns={materialColumns}
                  dataSource={materials}
                  rowKey="id"
                />
              </div>
            )}
          </>
        )}
      </Drawer>

      {/* 创建工单 Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="从销售订单创建工单"
        onConfirm={handleCreate}
        confirmLoading={createFromSO.isPending}
      >
        <div style={{ padding: '1rem 0' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>销售订单 ID</label>
          <input
            type="number"
            value={salesOrderIdInput}
            onChange={(e) => setSalesOrderIdInput(e.target.value)}
            placeholder="输入销售订单ID"
            style={{ width: '100%', height: 36, border: '1px solid #d1d5db', borderRadius: 6, padding: '0 0.75rem' }}
          />
        </div>
      </Modal>

      {/* 取消工单确认 */}
      <Modal
        open={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        title="确认取消工单"
        onConfirm={handleCancel}
        confirmLoading={cancelOrder.isPending}
        confirmVariant="danger"
      >
        <p>确定要取消工单 <strong>{detail?.workOrderNo}</strong> 吗？此操作将级联取消所有工序任务并释放库存预留。</p>
      </Modal>
    </div>
  );
}
