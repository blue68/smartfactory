/**
 * [artifact:前端代码] — ScheduleSuggestionPage（智能调度建议页）
 * Sprint 4 / FE-S4-05
 *
 * 页面布局：
 *  1. 顶部统计行：4 列 ScheduleStatCard
 *  2. 中间内容区：左60% 采购建议 + 右40% 排产建议
 *  3. 底部历史记录 Tab（采购历史 / 排产历史）
 *
 * 当前使用静态 mock 数据；后续替换为 API hook。
 */

import { useState } from 'react';
import ScheduleStatCard from '@/components/ScheduleStatCard/ScheduleStatCard';
import styles from './ScheduleSuggestionPage.module.css';

// ─── Mock 数据 ────────────────────────────────
const mockStats = {
  pendingPurchase: 12,
  pendingProduction: 8,
  stockAlerts: 3,
  capacityRate: '78%',
};

/** 采购建议 mock 列表 */
const mockPurchaseSuggestions = [
  { id: 'P001', skuName: '橡木板材 (18mm)', qty: 200, unit: '张', urgency: 'high', reason: '库存低于安全线', deadline: '2026-03-16' },
  { id: 'P002', skuName: '沙发面料 (灰色)', qty: 80, unit: '米', urgency: 'normal', reason: 'MRP 周期补货', deadline: '2026-03-20' },
  { id: 'P003', skuName: '海绵块 (50mm)', qty: 150, unit: '块', urgency: 'high', reason: '工单缺料预警', deadline: '2026-03-15' },
  { id: 'P004', skuName: '五金合页 (60mm)', qty: 500, unit: '个', urgency: 'normal', reason: 'MRP 周期补货', deadline: '2026-03-22' },
];

/** 排产建议 mock 列表 */
const mockProductionSuggestions = [
  { id: 'W001', orderNo: 'SO-2026-0312', skuName: '三人位布艺沙发', qty: 20, unit: '套', priority: 'urgent', deadline: '2026-03-18' },
  { id: 'W002', orderNo: 'SO-2026-0308', skuName: '实木餐椅', qty: 50, unit: '把', priority: 'normal', deadline: '2026-03-25' },
  { id: 'W003', orderNo: 'SO-2026-0310', skuName: '橡木书桌', qty: 10, unit: '张', priority: 'high', deadline: '2026-03-21' },
];

/** 历史记录 mock */
const mockPurchaseHistory = [
  { id: 'H-P01', date: '2026-03-13', action: '批准采购建议 P-230', operator: '张主管', result: '已转采购单' },
  { id: 'H-P02', date: '2026-03-12', action: '批准采购建议 P-228', operator: '张主管', result: '已转采购单' },
  { id: 'H-P03', date: '2026-03-11', action: '驳回采购建议 P-225', operator: '李老板', result: '已驳回' },
];

const mockProductionHistory = [
  { id: 'H-W01', date: '2026-03-13', action: '排产工单 W-450', operator: '赵车间主管', result: '已排产' },
  { id: 'H-W02', date: '2026-03-12', action: '排产工单 W-448', operator: '赵车间主管', result: '已排产' },
];

// ─── 子组件：采购建议区 ──────────────────────
function PurchaseSuggestionPanel() {
  return (
    <section className={styles.panel} aria-labelledby="purchase-panel-title">
      <div className={styles.panel__header}>
        <h3 id="purchase-panel-title" className={styles.panel__title}>
          <span className={styles.panel__title_icon} aria-hidden="true">🛒</span>
          采购建议
        </h3>
        <span className={styles.panel__badge}>{mockPurchaseSuggestions.length} 条待处理</span>
      </div>

      <ul className={styles.suggestion_list} role="list">
        {mockPurchaseSuggestions.map((item) => (
          <li key={item.id} className={styles.suggestion_item}>
            <div className={styles.suggestion_item__top}>
              <span className={styles.suggestion_item__name}>{item.skuName}</span>
              <span
                className={[
                  styles.suggestion_item__urgency,
                  item.urgency === 'high' ? styles['suggestion_item__urgency--high'] : '',
                ].join(' ')}
              >
                {item.urgency === 'high' ? '紧急' : '普通'}
              </span>
            </div>
            <div className={styles.suggestion_item__meta}>
              <span>建议采购：<strong>{item.qty} {item.unit}</strong></span>
              <span className={styles.suggestion_item__sep} aria-hidden="true">·</span>
              <span>{item.reason}</span>
              <span className={styles.suggestion_item__sep} aria-hidden="true">·</span>
              <span>需求日期：{item.deadline}</span>
            </div>
            <div className={styles.suggestion_item__actions}>
              <button type="button" className={styles.btn_approve}>批准</button>
              <button type="button" className={styles.btn_reject}>驳回</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── 子组件：排产建议区 ──────────────────────
function ProductionSuggestionPanel() {
  return (
    <section className={styles.panel} aria-labelledby="production-panel-title">
      <div className={styles.panel__header}>
        <h3 id="production-panel-title" className={styles.panel__title}>
          <span className={styles.panel__title_icon} aria-hidden="true">🏭</span>
          排产建议
        </h3>
        <span className={styles.panel__badge}>{mockProductionSuggestions.length} 条待排产</span>
      </div>

      <ul className={styles.suggestion_list} role="list">
        {mockProductionSuggestions.map((item) => (
          <li key={item.id} className={styles.suggestion_item}>
            <div className={styles.suggestion_item__top}>
              <span className={styles.suggestion_item__name}>{item.skuName}</span>
              <span
                className={[
                  styles.suggestion_item__urgency,
                  item.priority === 'urgent' ? styles['suggestion_item__urgency--high'] : '',
                ].join(' ')}
              >
                {item.priority === 'urgent' ? '紧急' : item.priority === 'high' ? '高优' : '普通'}
              </span>
            </div>
            <div className={styles.suggestion_item__meta}>
              <span>订单：<strong>{item.orderNo}</strong></span>
              <span className={styles.suggestion_item__sep} aria-hidden="true">·</span>
              <span>数量：<strong>{item.qty} {item.unit}</strong></span>
              <span className={styles.suggestion_item__sep} aria-hidden="true">·</span>
              <span>交期：{item.deadline}</span>
            </div>
            <div className={styles.suggestion_item__actions}>
              <button type="button" className={styles.btn_approve}>确认排产</button>
              <button type="button" className={styles.btn_reject}>延后</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── 子组件：历史记录 Tab ────────────────────
type HistoryTab = 'purchase' | 'production';

function HistoryPanel() {
  const [activeTab, setActiveTab] = useState<HistoryTab>('purchase');

  return (
    <section className={styles.history} aria-labelledby="history-title">
      <h3 id="history-title" className={styles.history__title}>历史记录</h3>

      {/* Tab 切换 */}
      <div className={styles.tab_bar} role="tablist" aria-label="历史记录类型">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'purchase'}
          aria-controls="tab-panel-purchase"
          className={[
            styles.tab_item,
            activeTab === 'purchase' ? styles['tab_item--active'] : '',
          ].join(' ')}
          onClick={() => setActiveTab('purchase')}
        >
          采购历史
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'production'}
          aria-controls="tab-panel-production"
          className={[
            styles.tab_item,
            activeTab === 'production' ? styles['tab_item--active'] : '',
          ].join(' ')}
          onClick={() => setActiveTab('production')}
        >
          排产历史
        </button>
      </div>

      {/* Tab 面板 */}
      <div
        id="tab-panel-purchase"
        role="tabpanel"
        aria-labelledby="tab-purchase"
        hidden={activeTab !== 'purchase'}
        className={styles.tab_panel}
      >
        <table className={styles.history_table}>
          <thead>
            <tr>
              <th>日期</th>
              <th>操作</th>
              <th>操作人</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            {mockPurchaseHistory.map((row) => (
              <tr key={row.id}>
                <td>{row.date}</td>
                <td>{row.action}</td>
                <td>{row.operator}</td>
                <td>
                  <span className={[
                    styles.history_result,
                    row.result === '已驳回' ? styles['history_result--rejected'] : styles['history_result--approved'],
                  ].join(' ')}>
                    {row.result}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        id="tab-panel-production"
        role="tabpanel"
        aria-labelledby="tab-production"
        hidden={activeTab !== 'production'}
        className={styles.tab_panel}
      >
        <table className={styles.history_table}>
          <thead>
            <tr>
              <th>日期</th>
              <th>操作</th>
              <th>操作人</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            {mockProductionHistory.map((row) => (
              <tr key={row.id}>
                <td>{row.date}</td>
                <td>{row.action}</td>
                <td>{row.operator}</td>
                <td>
                  <span className={[
                    styles.history_result,
                    styles['history_result--approved'],
                  ].join(' ')}>
                    {row.result}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── 页面主体 ─────────────────────────────────
export default function ScheduleSuggestionPage() {
  return (
    <div className={styles.page}>
      {/* 页面标题 */}
      <header className={styles.page__header}>
        <div className={styles.page__breadcrumb}>
          <span className={styles.page__breadcrumb_item}>智能调度</span>
          <span className={styles.page__breadcrumb_sep} aria-hidden="true">/</span>
          <span className={styles.page__breadcrumb_item} aria-current="page">调度建议</span>
        </div>
        <h2 className={styles.page__title}>
          <span aria-hidden="true">⚡</span> 智能调度建议
        </h2>
        <p className={styles.page__subtitle}>
          基于当前库存、销售订单与产能数据，AI 自动生成采购与排产建议
        </p>
      </header>

      {/* 顶部统计卡片行 */}
      <div className={styles.stats_row} role="region" aria-label="调度统计概览">
        <ScheduleStatCard
          title="待处理采购建议"
          value={mockStats.pendingPurchase}
          unit="条"
          variant="warning"
          icon="🛒"
          onClick={() => { /* TODO: 跳转或展开采购建议列表 */ }}
        />
        <ScheduleStatCard
          title="待排产工单"
          value={mockStats.pendingProduction}
          unit="单"
          variant="info"
          icon="🏭"
          onClick={() => { /* TODO: 跳转或展开排产建议列表 */ }}
        />
        <ScheduleStatCard
          title="库存预警"
          value={mockStats.stockAlerts}
          unit="项"
          variant="danger"
          icon="⚠️"
          onClick={() => { /* TODO: 跳转库存预警详情 */ }}
        />
        <ScheduleStatCard
          title="产能利用率"
          value={mockStats.capacityRate}
          variant="normal"
          icon="📊"
        />
      </div>

      {/* 中间内容区：左右分栏 */}
      <div className={styles.content_row}>
        {/* 左60%：采购建议 */}
        <div className={styles.content_left}>
          <PurchaseSuggestionPanel />
        </div>

        {/* 右40%：排产建议 */}
        <div className={styles.content_right}>
          <ProductionSuggestionPanel />
        </div>
      </div>

      {/* 底部历史记录 */}
      <HistoryPanel />
    </div>
  );
}
