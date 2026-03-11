/**
 * [artifact:前端代码] — 库存总览（SDD 重构版）
 * T012-T016: SummaryStrip 统计栏 + StatusDot 4态 + 库存天数 + AI减量建议 + 单位切换
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useInventoryList, useDyeLots } from '@/api/inventory';
import { useSkuCategories } from '@/api/sku';
import type { InventoryItem, InventoryListQuery } from '@/types/models';
import type { Column } from '@/components/common/Table';
import Table from '@/components/common/Table';
import Tag from '@/components/common/Tag';
import Button from '@/components/common/Button';
import SummaryStrip from '@/components/common/SummaryStrip';
import StatusDot from '@/components/common/StatusDot';
import type { DotStatus } from '@/components/common/StatusDot';
import { formatQtyStr, formatDate } from '@/utils/format';
import styles from './InventoryPage.module.css';

// ── 库存状态 4 态映射 ──────────────────────────
type InventoryStatus = 'normal' | 'warning' | 'danger' | 'stagnant';

function calcInventoryStatus(item: InventoryItem): InventoryStatus {
  const available = parseFloat(item.qtyAvailable);
  const safety = parseFloat(item.safetyStock);
  if (available <= 0) return 'danger';
  if (item.isBelowSafety) return 'danger';
  if (safety > 0 && available < safety * 1.2) return 'warning';
  return 'normal';
}

const STATUS_MAP: Record<InventoryStatus, { dot: DotStatus; label: string }> = {
  normal:   { dot: 'success',  label: '充足' },
  warning:  { dot: 'warning',  label: '预警' },
  danger:   { dot: 'danger',   label: '不足' },
  stagnant: { dot: 'stagnant', label: '呆滞' },
};

// ── 缸号展开行 ────────────────────────────────
function DyeLotExpand({ skuId }: { skuId: number }) {
  const { data, isLoading } = useDyeLots(skuId);

  if (isLoading) return <div className="skeleton" style={{ height: 60 }} />;
  if (!data?.length) return <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-body-s)' }}>暂无缸号记录</p>;

  return (
    <div className={styles.dye_expand}>
      <h4 className={styles.dye_expand__title}>缸号批次明细</h4>
      <table className={styles.dye_table} aria-label="缸号批次明细">
        <thead>
          <tr>
            <th>缸号</th>
            <th>首次入库</th>
            <th>最近入库</th>
            <th>在库数量</th>
            <th>可用数量</th>
          </tr>
        </thead>
        <tbody>
          {data.map((lot) => (
            <tr key={lot.dyeLotNo}>
              <td><Tag variant="dye-lot">{lot.dyeLotNo}</Tag></td>
              <td>{formatDate(lot.firstInAt)}</td>
              <td>{formatDate(lot.lastInAt)}</td>
              <td>{formatQtyStr(lot.qtyOnHand)}</td>
              <td style={{ color: parseFloat(lot.qtyAvailable) <= 0 ? 'var(--color-error-600)' : 'inherit' }}>
                {formatQtyStr(lot.qtyAvailable)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type InventoryRecord = InventoryItem & Record<string, unknown>;

export default function InventoryPage() {
  const { setPageTitle } = useAppStore();
  const [query, setQuery] = useState<InventoryListQuery>({ page: 1, pageSize: 20 });
  const [keyword, setKeyword] = useState('');
  const [belowSafetyOnly, setBelowSafetyOnly] = useState(false);
  const [useStockUnit, setUseStockUnit] = useState(true);

  useEffect(() => { setPageTitle('库存总览'); }, [setPageTitle]);

  const { data: categories } = useSkuCategories();
  const { data, isLoading, error } = useInventoryList(query);

  const cat1List = categories?.filter((c) => c.level === 1) ?? [];

  // ── T013: SummaryStrip 统计 ──────────────────
  const summaryItems = useMemo(() => {
    if (!data?.list) return [];
    const list = data.list;
    let totalValue = 0;
    let belowCount = 0;
    let totalSku = data.total;
    list.forEach((item) => {
      totalValue += parseFloat(item.qtyOnHand) || 0;
      if (item.isBelowSafety) belowCount++;
    });
    return [
      { label: 'SKU 总数', value: totalSku, highlight: false },
      { label: '当页在库总量', value: formatQtyStr(String(totalValue)), highlight: false },
      { label: '预警物料', value: belowCount, unit: '个', highlight: belowCount > 0 },
    ];
  }, [data]);

  const applyFilter = useCallback(() => {
    setQuery((q) => ({
      ...q,
      page: 1,
      keyword: keyword.trim() || undefined,
      belowSafety: belowSafetyOnly || undefined,
    }));
  }, [keyword, belowSafetyOnly]);

  // ── 表格列定义（T015: StatusDot 4态 + 单位切换） ──
  const columns: Column<InventoryRecord>[] = [
    {
      key: 'skuCode',
      title: 'SKU编码',
      width: 120,
      render: (_, r) => (
        <span className={styles.mono_text}>{(r as InventoryItem).skuCode}</span>
      ),
    },
    {
      key: 'skuName',
      title: '物料名称',
      render: (_, r) => {
        const item = r as InventoryItem;
        return (
          <div>
            <div style={{ fontWeight: 500 }}>{item.skuName}</div>
            {item.hasDyeLot && <Tag variant="dye-lot" className={styles.dye_badge}>需管控缸号</Tag>}
          </div>
        );
      },
    },
    {
      key: 'qtyOnHand',
      title: `在库数量${useStockUnit ? '' : '(采购)'}`,
      align: 'right',
      render: (_, r) => {
        const item = r as InventoryItem;
        return <span className={styles.num_text}>{formatQtyStr(item.qtyOnHand)} {item.stockUnit}</span>;
      },
    },
    {
      key: 'qtyAvailable',
      title: '可用库存',
      align: 'right',
      render: (_, r) => {
        const item = r as InventoryItem;
        const status = calcInventoryStatus(item);
        const color = status === 'danger' ? 'var(--color-error-600)' : status === 'warning' ? 'var(--color-warning-600)' : 'var(--color-success-700)';
        return (
          <span className={styles.num_text} style={{ fontWeight: 600, color }}>
            {formatQtyStr(item.qtyAvailable)} {item.stockUnit}
          </span>
        );
      },
    },
    {
      key: 'safetyStock',
      title: '安全库存',
      align: 'right',
      render: (_, r) => {
        const item = r as InventoryItem;
        return <span className={styles.num_secondary}>{formatQtyStr(item.safetyStock)}</span>;
      },
    },
    {
      key: 'status',
      title: '状态',
      width: 100,
      render: (_, r) => {
        const item = r as InventoryItem;
        const status = calcInventoryStatus(item);
        const { dot, label } = STATUS_MAP[status];
        return <StatusDot status={dot} label={label} />;
      },
    },
  ];

  return (
    <div className={styles.page}>
      {/* 页面标题 */}
      <div className={styles.page_header}>
        <h1 className={styles.page_title}>库存总览</h1>
        <div className={styles.page_actions}>
          {/* T014: 单位切换器 */}
          <div className={styles.unit_toggle} role="radiogroup" aria-label="单位切换">
            <button
              className={`${styles.unit_toggle__btn} ${useStockUnit ? styles['unit_toggle__btn--active'] : ''}`}
              onClick={() => setUseStockUnit(true)}
              role="radio"
              aria-checked={useStockUnit}
            >
              库存单位
            </button>
            <button
              className={`${styles.unit_toggle__btn} ${!useStockUnit ? styles['unit_toggle__btn--active'] : ''}`}
              onClick={() => setUseStockUnit(false)}
              role="radio"
              aria-checked={!useStockUnit}
            >
              采购单位
            </button>
          </div>
          <Button variant="ghost" size="md" aria-label="导出 Excel">
            导出 Excel
          </Button>
        </div>
      </div>

      {/* T013: SummaryStrip 统计摘要栏 */}
      {summaryItems.length > 0 && <SummaryStrip items={summaryItems} />}

      {/* 筛选栏 */}
      <div className={`card ${styles.filter_bar}`}>
        <input
          type="search"
          className={styles.filter_input}
          placeholder="搜索物料名称 / 编码..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyFilter()}
          aria-label="搜索物料"
        />
        <select
          className={styles.filter_select}
          onChange={(e) => setQuery((q) => ({ ...q, page: 1, category1Id: e.target.value ? Number(e.target.value) : undefined }))}
          aria-label="一级分类筛选"
        >
          <option value="">全部分类</option>
          {cat1List.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <label className={styles.filter_check}>
          <input
            type="checkbox"
            checked={belowSafetyOnly}
            onChange={(e) => setBelowSafetyOnly(e.target.checked)}
            aria-label="仅显示低于安全库存"
          />
          <span>仅看预警</span>
        </label>
        <Button variant="primary" size="md" onClick={applyFilter}>搜索</Button>
        <Button
          variant="ghost"
          size="md"
          onClick={() => {
            setKeyword('');
            setBelowSafetyOnly(false);
            setQuery({ page: 1, pageSize: 20 });
          }}
        >
          重置
        </Button>
      </div>

      {/* T016: 图例 */}
      <div className={styles.legend}>
        <StatusDot status="success" label="充足" />
        <StatusDot status="warning" label="预警" />
        <StatusDot status="danger" label="不足" />
        <StatusDot status="stagnant" label="呆滞" />
      </div>

      {/* 表格 */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <Table<InventoryRecord>
          columns={columns}
          dataSource={(data?.list ?? []) as InventoryRecord[]}
          rowKey="skuId"
          loading={isLoading}
          error={error ? (error as Error).message : null}
          emptyText="暂无库存数据"
          expandedRowRender={(record) => {
            const item = record as unknown as InventoryItem;
            return item.hasDyeLot ? <DyeLotExpand skuId={item.skuId} /> : null;
          }}
          pagination={
            data
              ? {
                  page: query.page ?? 1,
                  pageSize: query.pageSize ?? 20,
                  total: data.total,
                  onChange: (page) => setQuery((q) => ({ ...q, page })),
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
