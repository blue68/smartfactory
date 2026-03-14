/**
 * [artifact:前端代码] — 缺料看板页面 (R-11)
 */
import { useMemo } from 'react';
import { useShortageSummary, useGenerateMrpSuggestions } from '@/api/mrp';
import type { ShortageSummaryItem } from '@/api/mrp';
import Button from '@/components/common/Button';
import Table from '@/components/common/Table';
import type { Column } from '@/components/common/Table';
import styles from './ShortageBoard.module.css';

type ShortageRow = ShortageSummaryItem & {
  severity: 'green' | 'yellow' | 'red';
};

export default function ShortageBoard() {
  const { data: summaryData, isLoading } = useShortageSummary();
  const generateSuggestions = useGenerateMrpSuggestions();

  const items = summaryData?.items ?? [];

  const rows: ShortageRow[] = useMemo(() => {
    return items.map((item) => {
      const shortage = Number(item.totalShortageQty || 0);
      let severity: 'green' | 'yellow' | 'red' = 'green';
      if (shortage > 0) severity = 'red';
      return { ...item, severity };
    });
  }, [items]);

  const stats = useMemo(() => {
    const green = rows.filter((r) => r.severity === 'green').length;
    const red = rows.filter((r) => r.severity === 'red').length;
    return { total: rows.length, green, red };
  }, [rows]);

  const columns: Column<ShortageRow>[] = useMemo(() => [
    { key: 'skuCode', title: 'SKU编码', width: 120 },
    { key: 'skuName', title: 'SKU名称', width: 180 },
    { key: 'unit', title: '单位', width: 60 },
    {
      key: 'totalShortageQty', title: '缺口数量', width: 100, align: 'right',
      render: (v, r) => {
        const cls = r.severity === 'red' ? styles.red : styles.green;
        return <span className={cls} style={{ fontWeight: 700 }}>{String(v)}</span>;
      },
    },
    {
      key: 'affectedOrders', title: '影响工单数', width: 100, align: 'center',
      render: (v) => String((v as number[])?.length ?? 0),
    },
    { key: 'neededByDate', title: '需求日期', width: 110 },
    {
      key: 'severity', title: '级别', width: 80,
      render: (v) => {
        const map = { green: { label: '充足', cls: styles.badgeGreen }, red: { label: '缺料', cls: styles.badgeRed } };
        const s = map[v as keyof typeof map] ?? map.green;
        return <span className={`${styles.badge} ${s.cls}`}>{s.label}</span>;
      },
    },
  ], []);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>缺料看板</h2>
        <Button onClick={() => generateSuggestions.mutate({})} loading={generateSuggestions.isPending}>
          一键生成采购建议
        </Button>
      </div>

      <div className={styles.statsRow}>
        <div className={styles.statCard}><h4>总物料</h4><div className={styles.value}>{stats.total}</div></div>
        <div className={styles.statCard}><h4>库存充足</h4><div className={`${styles.value} ${styles.green}`}>{stats.green}</div></div>
        <div className={styles.statCard}><h4>严重缺料</h4><div className={`${styles.value} ${styles.red}`}>{stats.red}</div></div>
      </div>

      <Table<ShortageRow>
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        rowKey="skuId"
      />
    </div>
  );
}
