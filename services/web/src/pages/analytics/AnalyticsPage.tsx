/**
 * [artifact:前端代码] — 经营分析页
 *
 * 4 个 Tab：库存结构 / 生产效率 / 采购成本 / 物料占比
 */

import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  useInventoryAnalysis,
  useProductionEfficiency,
  usePurchaseCostAnalysis,
  useMaterialCategoryRatio,
} from '@/api/analytics';
import styles from './AnalyticsPage.module.css';

// ── Tab 定义 ──────────────────────────────────────────────

type TabKey = 'inventory' | 'production' | 'purchase' | 'material';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'inventory',  label: '库存结构' },
  { key: 'production', label: '生产效率' },
  { key: 'purchase',   label: '采购成本' },
  { key: 'material',   label: '物料占比' },
];

const BAR_COLORS = ['bar_fill--blue', 'bar_fill--green', 'bar_fill--amber', 'bar_fill--red'];

// ── Tab 1: 库存结构 ────────────────────────────────────────

function InventoryTab() {
  const { data, isLoading } = useInventoryAnalysis();

  if (isLoading) return <div className={styles.loading_state}>加载中...</div>;

  const breakdown = data?.categoryBreakdown ?? [];

  return (
    <>
      <div className={styles.stat_grid}>
        <div className={styles.stat_card}>
          <p className={styles.stat_label}>品类数</p>
          <p className={styles.stat_value}>{breakdown.length}</p>
        </div>
        <div className={styles.stat_card}>
          <p className={styles.stat_label}>SKU 总数</p>
          <p className={styles.stat_value}>
            {breakdown.reduce((sum, c) => sum + c.skuCount, 0)}
          </p>
        </div>
        <div className={styles.stat_card}>
          <p className={styles.stat_label}>库存总量</p>
          <p className={styles.stat_value}>
            {breakdown.reduce((sum, c) => sum + parseFloat(c.totalQty || '0'), 0).toLocaleString()}
          </p>
        </div>
      </div>

      <h3 className={styles.section_title}>品类占比</h3>
      <div className={styles.bar_list}>
        {breakdown.map((cat, i) => (
          <div className={styles.bar_item} key={cat.category}>
            <div className={styles.bar_header}>
              <span className={styles.bar_name}>{cat.category}</span>
              <span className={styles.bar_value}>{cat.skuCount} SKU · {parseFloat(cat.pct).toFixed(1)}%</span>
            </div>
            <div className={styles.bar_track}>
              <div
                className={`${styles.bar_fill} ${styles[BAR_COLORS[i % BAR_COLORS.length]]}`}
                style={{ width: `${Math.max(parseFloat(cat.pct), 2)}%` }}
              />
            </div>
          </div>
        ))}
        {breakdown.length === 0 && (
          <div className={styles.empty_state}>暂无库存数据</div>
        )}
      </div>
    </>
  );
}

// ── Tab 2: 生产效率 ────────────────────────────────────────

function ProductionTab() {
  const { data, isLoading } = useProductionEfficiency();

  if (isLoading) return <div className={styles.loading_state}>加载中...</div>;

  return (
    <>
      <div className={styles.stat_grid}>
        <div className={styles.stat_card}>
          <p className={styles.stat_label}>平均完工率</p>
          <p className={styles.stat_value}>
            {data?.avgCompletionRate ?? '--'}
            <span className={styles.stat_unit}>%</span>
          </p>
        </div>
        <div className={styles.stat_card}>
          <p className={styles.stat_label}>平均生产周期</p>
          <p className={styles.stat_value}>
            {data?.avgCycleTime ?? '--'}
            <span className={styles.stat_unit}>天</span>
          </p>
        </div>
      </div>

      <h3 className={styles.section_title}>工人效率排名</h3>
      {(data?.workerEfficiency ?? []).length > 0 ? (
        <table className={styles.simple_table}>
          <thead>
            <tr>
              <th>姓名</th>
              <th>已完成任务</th>
              <th>平均效率</th>
            </tr>
          </thead>
          <tbody>
            {(data?.workerEfficiency ?? []).map((w) => (
              <tr key={w.workerName}>
                <td>{w.workerName}</td>
                <td>{w.completedTasks}</td>
                <td>{w.avgRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className={styles.empty_state}>暂无生产效率数据</div>
      )}
    </>
  );
}

// ── Tab 3: 采购成本 ────────────────────────────────────────

function PurchaseTab() {
  const { data, isLoading } = usePurchaseCostAnalysis();

  if (isLoading) return <div className={styles.loading_state}>加载中...</div>;

  const trend = data?.monthlyTrend ?? [];
  const maxAmount = Math.max(...trend.map((t) => parseFloat(t.totalAmount) || 0), 1);

  return (
    <>
      <h3 className={styles.section_title}>月度采购趋势</h3>
      <div className={styles.bar_list}>
        {trend.map((m) => {
          const amt = parseFloat(m.totalAmount) || 0;
          return (
            <div className={styles.bar_item} key={m.month}>
              <div className={styles.bar_header}>
                <span className={styles.bar_name}>{m.month}</span>
                <span className={styles.bar_value}>¥{amt.toLocaleString()} ({m.orderCount}单)</span>
              </div>
              <div className={styles.bar_track}>
                <div
                  className={`${styles.bar_fill} ${styles['bar_fill--blue']}`}
                  style={{ width: `${(amt / maxAmount) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
        {trend.length === 0 && (
          <div className={styles.empty_state}>暂无采购数据</div>
        )}
      </div>

      <h3 className={styles.section_title} style={{ marginTop: 'var(--space-6)' }}>
        供应商 TOP 排名
      </h3>
      {(data?.topSuppliers ?? []).length > 0 ? (
        <table className={styles.simple_table}>
          <thead>
            <tr>
              <th>供应商</th>
              <th>采购金额</th>
              <th>订单数</th>
            </tr>
          </thead>
          <tbody>
            {(data?.topSuppliers ?? []).map((s) => (
              <tr key={s.supplierName}>
                <td>{s.supplierName}</td>
                <td>¥{parseFloat(s.totalAmount).toLocaleString()}</td>
                <td>{s.orderCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className={styles.empty_state}>暂无供应商数据</div>
      )}
    </>
  );
}

// ── Tab 4: 物料占比 ────────────────────────────────────────

function MaterialTab() {
  const { data, isLoading } = useMaterialCategoryRatio();

  if (isLoading) return <div className={styles.loading_state}>加载中...</div>;

  const categories = data?.categories ?? [];
  const total = parseFloat(data?.totalMaterialCost ?? '0');

  return (
    <>
      <div className={styles.stat_grid}>
        <div className={styles.stat_card}>
          <p className={styles.stat_label}>物料总成本</p>
          <p className={styles.stat_value}>¥{total.toLocaleString()}</p>
        </div>
        <div className={styles.stat_card}>
          <p className={styles.stat_label}>品类数量</p>
          <p className={styles.stat_value}>{categories.length}</p>
        </div>
      </div>

      <h3 className={styles.section_title}>品类成本占比</h3>
      <div className={styles.bar_list}>
        {categories.map((cat, i) => (
          <div className={styles.bar_item} key={cat.categoryName}>
            <div className={styles.bar_header}>
              <span className={styles.bar_name}>{cat.categoryName}</span>
              <span className={styles.bar_value}>
                ¥{parseFloat(cat.totalCost).toLocaleString()} · {parseFloat(cat.percentage).toFixed(1)}%
              </span>
            </div>
            <div className={styles.bar_track}>
              <div
                className={`${styles.bar_fill} ${styles[BAR_COLORS[i % BAR_COLORS.length]]}`}
                style={{ width: `${Math.max(parseFloat(cat.percentage), 2)}%` }}
              />
            </div>
          </div>
        ))}
        {categories.length === 0 && (
          <div className={styles.empty_state}>暂无物料数据</div>
        )}
      </div>
    </>
  );
}

// ── 主页面 ──────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { setPageTitle } = useAppStore();
  const [activeTab, setActiveTab] = useState<TabKey>('inventory');

  useEffect(() => { setPageTitle('经营分析'); }, [setPageTitle]);

  const renderContent = () => {
    switch (activeTab) {
      case 'inventory':  return <InventoryTab />;
      case 'production': return <ProductionTab />;
      case 'purchase':   return <PurchaseTab />;
      case 'material':   return <MaterialTab />;
    }
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.page_title}>经营分析</h1>

      <div className={styles.tab_bar} role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`${styles.tab_item} ${activeTab === tab.key ? styles['tab_item--active'] : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.content}>
        {renderContent()}
      </div>
    </div>
  );
}
