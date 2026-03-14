/**
 * [artifact:前端代码] — 退货单管理页面 (R-09)
 */
import { useState, useCallback, useMemo } from 'react';
import {
  useReturnOrderList,
  useConfirmReturnOrder,
  useShipReturnOrder,
  useCompleteReturnOrder,
} from '@/api/returnOrder';
import Button from '@/components/common/Button';
import Table from '@/components/common/Table';
import type { Column } from '@/components/common/Table';
import styles from './ReturnOrderPage.module.css';

interface ReturnRow {
  id: number;
  returnNo: string;
  returnType: 'purchase_return' | 'production_return';
  supplierId: number | null;
  supplierName: string | null;
  poNo: string | null;
  status: 'draft' | 'confirmed' | 'shipped' | 'completed' | 'cancelled';
  returnReason: string;
  totalQty: string;
  createdAt: string | null;
  [key: string]: unknown;
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: styles.statusDraft },
  confirmed: { label: '已确认', cls: styles.statusConfirmed },
  shipped: { label: '已发出', cls: styles.statusShipped },
  completed: { label: '已完成', cls: styles.statusCompleted },
  cancelled: { label: '已取消', cls: styles.statusCancelled },
};

const TYPE_MAP: Record<string, string> = {
  purchase_return: '采购退货',
  production_return: '生产退货',
};

export default function ReturnOrderPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useReturnOrderList({
    status: statusFilter || undefined,
    page,
    pageSize: 20,
  });
  const confirmReturn = useConfirmReturnOrder();
  const shipReturn = useShipReturnOrder();
  const completeReturn = useCompleteReturnOrder();

  const list = (data as any)?.list ?? [];
  const total = (data as any)?.total ?? 0;

  const handleConfirm = useCallback((id: number) => {
    confirmReturn.mutate(id);
  }, [confirmReturn]);

  const handleShip = useCallback((id: number) => {
    shipReturn.mutate({ id });
  }, [shipReturn]);

  const handleComplete = useCallback((id: number) => {
    completeReturn.mutate({ id });
  }, [completeReturn]);

  const columns: Column<ReturnRow>[] = useMemo(() => [
    { key: 'returnNo', title: '退货单号', width: 140 },
    {
      key: 'returnType', title: '类型', width: 90,
      render: (v) => TYPE_MAP[v as string] ?? v,
    },
    { key: 'supplierName', title: '供应商', width: 130, render: (v) => String(v ?? '-') },
    { key: 'poNo', title: '采购订单', width: 120, render: (v) => String(v ?? '-') },
    { key: 'totalQty', title: '退货数量', width: 90, align: 'right' },
    { key: 'returnReason', title: '退货原因', width: 180 },
    {
      key: 'status', title: '状态', width: 90,
      render: (v) => {
        const s = STATUS_MAP[v as string] ?? STATUS_MAP.draft;
        return <span className={`${styles.badge} ${s.cls}`}>{s.label}</span>;
      },
    },
    {
      key: 'id', title: '操作', width: 160,
      render: (_, r) => (
        <div style={{ display: 'flex', gap: 4 }}>
          {r.status === 'draft' && (
            <Button size="sm" loading={confirmReturn.isPending} onClick={() => handleConfirm(r.id)}>确认</Button>
          )}
          {r.status === 'confirmed' && (
            <Button size="sm" loading={shipReturn.isPending} onClick={() => handleShip(r.id)}>发出</Button>
          )}
          {r.status === 'shipped' && (
            <Button size="sm" variant="success" loading={completeReturn.isPending} onClick={() => handleComplete(r.id)}>完成</Button>
          )}
        </div>
      ),
    },
  ], [handleConfirm, handleShip, handleComplete]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>退货管理</h2>
      </div>

      <div className={styles.filterRow}>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="confirmed">已确认</option>
          <option value="shipped">已发出</option>
          <option value="completed">已完成</option>
          <option value="cancelled">已取消</option>
        </select>
      </div>

      <Table<ReturnRow>
        columns={columns}
        dataSource={list}
        loading={isLoading}
        pagination={{ page, pageSize: 20, total, onChange: setPage }}
        rowKey="id"
      />
    </div>
  );
}
