/**
 * [artifact:前端代码] — 老板驾驶舱
 * 重构依据：frontend-sdd-analysis.md T009 / T010 / T011
 *
 * T009 — 4个 KPI 卡片（月营收/库存金额/在产工单/待审批）使用通用 KpiCard 组件，每张左色条颜色独立
 * T010 — 生产进度区使用 ProgressBar 组件（4态颜色阈值）；库存预警区使用 StatusDot 组件（4态）
 * T011 — 顶部 AI 分析状态 Banner
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { useAppStore } from '@/stores/appStore';
import { useProductionOrderList } from '@/api/production';
import { useInventoryList } from '@/api/inventory';
import { useSuggestionList } from '@/api/purchase';
import { useSalesOrderList } from '@/api/sales';
import { useDashboardKpi } from '@/api/analytics';
import { ProductionOrderStatus, SuggestionStatus, SalesOrderStatus } from '@/types/enums';
import KpiCard from '@/components/common/KpiCard';
import ProgressBar from '@/components/common/ProgressBar';
import StatusDot from '@/components/common/StatusDot';
import type { DotStatus } from '@/components/common/StatusDot';
import StatusBadge from '@/components/common/StatusBadge';
import Button from '@/components/common/Button';
import { formatCNY, formatPercent, formatDate } from '@/utils/format';
import styles from './DashboardPage.module.css';

// 产能负荷趋势占位数据（后续可由 /api/analytics/production-efficiency 驱动）
const CAPACITY_PLACEHOLDER = [
  { date: '—', load: 0 }, { date: '—', load: 0 },
  { date: '—', load: 0 }, { date: '—', load: 0 },
];

/**
 * 根据库存可用量 vs 安全库存计算 StatusDot 的 4 态语义
 *   available === 0            → danger（严重缺货）
 *   available < safetyStock    → warning（临近预警）
 *   available ≥ safetyStock*3  → stagnant（呆滞风险）
 *   其余                       → success（正常）
 */
function resolveInventoryDotStatus(
  available: string,
  safety: string,
): DotStatus {
  const avail = parseFloat(available);
  const safe = parseFloat(safety);
  if (isNaN(avail) || avail === 0) return 'danger';
  if (!isNaN(safe) && avail < safe) return 'warning';
  if (!isNaN(safe) && safe > 0 && avail >= safe * 3) return 'stagnant';
  return 'success';
}

const STATUS_DOT_LABEL: Record<DotStatus, string> = {
  danger: '严重预警',
  warning: '临近预警',
  success: '库存正常',
  stagnant: '呆滞风险',
  info: '信息',
};

// ─────────────────────────────────────────────
// AI 分析状态 Banner（T011）
// ─────────────────────────────────────────────
interface AiBannerProps {
  suggestionCount: number;
  lastAnalysisTime: string;
  onNavigate: () => void;
}

function AiStatusBanner({ suggestionCount, lastAnalysisTime, onNavigate }: AiBannerProps) {
  return (
    <div className={styles.ai_banner} role="status" aria-live="polite">
      <span className={styles.ai_banner__icon} aria-hidden="true">🤖</span>
      <div className={styles.ai_banner__text}>
        <span className={styles.ai_banner__title}>
          AI 今日已完成采购分析，产生&nbsp;
          <strong className={styles.ai_banner__count}>{suggestionCount}</strong>
          &nbsp;条建议待处理
        </span>
        <span className={styles.ai_banner__meta}>
          上次分析：{lastAnalysisTime} · 已覆盖全部低于安全库存物料
        </span>
      </div>
      <Button
        variant="text"
        size="sm"
        onClick={onNavigate}
        className={styles.ai_banner__action}
      >
        立即处理 →
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────
// 页面主体
// ─────────────────────────────────────────────
export default function DashboardPage() {
  const { setPageTitle } = useAppStore();
  const navigate = useNavigate();
  const [productionPage] = useState(1);

  useEffect(() => { setPageTitle('老板驾驶舱'); }, [setPageTitle]);

  // ── IMP-001: 对接真实驾驶舱 KPI API ──
  const { data: kpiData, isLoading: kpiLoading } = useDashboardKpi();
  const kpi = kpiData ?? {
    monthlyRevenue: '0', inventoryValue: '0',
    inProgressOrders: 0, pendingApproval: 0,
    belowSafetyCount: 0, capacityLoadRate: '0',
  };

  // ── API hooks ──
  const { data: productionData, isLoading: prodLoading } = useProductionOrderList(
    { status: ProductionOrderStatus.IN_PROGRESS }, productionPage, 5,
  );
  const { data: inventoryData, isLoading: invLoading } = useInventoryList(
    { belowSafety: true, pageSize: 5 },
  );
  const { data: suggestionsData } = useSuggestionList(SuggestionStatus.PENDING, 1, 5);
  const { data: pendingOrdersData } = useSalesOrderList(
    { status: SalesOrderStatus.PENDING_APPROVAL }, 1, 5,
  );

  const inProductionCount = productionData?.total ?? 0;
  const belowSafetyCount  = inventoryData?.total  ?? 0;
  const pendingSuggestions = suggestionsData?.total ?? 0;
  const pendingOrders     = pendingOrdersData?.total ?? 0;

  // 待审批总数 = 采购建议 + 订单审批
  const totalPendingApproval = pendingSuggestions + pendingOrders;

  return (
    <div className={styles.page}>

      {/* ── T011: AI 分析状态 Banner ── */}
      <AiStatusBanner
        suggestionCount={pendingSuggestions}
        lastAnalysisTime={new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        onNavigate={() => navigate('/purchase/suggestions')}
      />

      {/* ── T009: KPI 卡片行 ── */}
      <section aria-label="核心指标">
        <div className={styles.kpi_grid}>

          {/* 本月完工产值 — 绿色左色条（success） */}
          <KpiCard
            title="本月完工产值"
            value={kpiLoading ? '—' : formatCNY(Number(kpi.monthlyRevenue))}
            color="var(--color-success-500)"
            icon={<span aria-hidden="true">💰</span>}
          />

          {/* 当前库存金额 — 蓝色左色条（primary） */}
          <KpiCard
            title="当前库存金额"
            value={kpiLoading ? '—' : formatCNY(Number(kpi.inventoryValue))}
            color="var(--color-primary-500)"
            icon={<span aria-hidden="true">📦</span>}
          />

          {/* 在产工单 — 橙色左色条（accent） */}
          <KpiCard
            title="在产工单"
            value={prodLoading ? '—' : inProductionCount}
            unit="个"
            color="var(--color-accent-500)"
            icon={<span aria-hidden="true">🏭</span>}
          />

          {/* 待审批事项 — 红色左色条（error），有待审批时高亮 */}
          <KpiCard
            title="待审批事项"
            value={totalPendingApproval}
            unit="项"
            color={
              totalPendingApproval > 0
                ? 'var(--color-error-500)'
                : 'var(--color-gray-400)'
            }
            icon={<span aria-hidden="true">📋</span>}
          />
        </div>
      </section>

      {/* ── 中部：产能负荷趋势 + 在产工单进度 ── */}
      <div className={styles.middle_row}>

        {/* 产能负荷趋势图 */}
        <section className={`card ${styles.chart_card}`} aria-label="产能负荷趋势">
          <div className={styles.section_header}>
            <h2 className={styles.section_title}>产能负荷趋势</h2>
            <span className={styles.section_subtitle}>近 7 天</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={CAPACITY_PLACEHOLDER} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
                width={40}
              />
              <Tooltip
                formatter={(v: number) => [`${v}%`, '产能负荷']}
                contentStyle={{ borderRadius: 8, border: '1px solid var(--border-default)', fontSize: 13 }}
              />
              <Line
                type="monotone"
                dataKey="load"
                stroke="var(--color-primary-500)"
                strokeWidth={2.5}
                dot={{ fill: 'var(--color-primary-500)', r: 4 }}
                activeDot={{ r: 6 }}
              />
              {/* 90% 警戒线 */}
              <Line
                type="monotone"
                dataKey={() => 90}
                stroke="var(--color-error-400)"
                strokeDasharray="5 5"
                strokeWidth={1.5}
                dot={false}
                name="警戒线 90%"
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </LineChart>
          </ResponsiveContainer>
        </section>

        {/* T010: 在产工单进度 — 使用通用 ProgressBar 组件 */}
        <section className={`card ${styles.progress_card}`} aria-label="在产工单进度">
          <div className={styles.section_header}>
            <h2 className={styles.section_title}>在产工单</h2>
            <Button variant="text" size="sm" onClick={() => navigate('/production/schedule')}>
              查看全部 →
            </Button>
          </div>

          {prodLoading ? (
            <div className={styles.list_loading}>
              {[1, 2, 3].map(i => (
                <div key={i} className={styles.list_skeleton}>
                  <div className="skeleton" style={{ height: 14, width: '60%' }} />
                  <div className="skeleton" style={{ height: 8, width: '100%', marginTop: 6 }} />
                </div>
              ))}
            </div>
          ) : productionData?.list.length === 0 ? (
            <p className={styles.empty_hint}>暂无在产工单</p>
          ) : (
            <ul className={styles.order_list} role="list">
              {productionData?.list.map((order) => (
                <li key={order.id} className={styles.order_item}>
                  <div className={styles.order_item__header}>
                    <span className={styles.order_item__no}>{order.workOrderNo}</span>
                    <StatusBadge status={order.status} />
                  </div>
                  <div className={styles.order_item__sku}>{order.skuName}</div>

                  {/* T010: 使用通用 ProgressBar（4态自动着色） */}
                  <div className={styles.order_item__progress_wrap}>
                    <ProgressBar
                      value={order.progressPct}
                      showLabel
                      size="sm"
                      className={styles.order_item__progress_bar}
                    />
                  </div>

                  {/* T010: 补充完工日期 */}
                  <div className={styles.order_item__date}>
                    交期：{formatDate(order.plannedEnd)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── 底部：库存预警 + 待审批采购建议 ── */}
      <div className={styles.bottom_row}>

        {/* T010: 库存预警 — 使用 StatusDot 展示 4 态 */}
        <section className={`card ${styles.alert_card}`} aria-label="库存预警">
          <div className={styles.section_header}>
            <h2 className={styles.section_title}>库存预警</h2>
            <Button variant="text" size="sm" onClick={() => navigate('/inventory?belowSafety=true')}>
              查看全部 →
            </Button>
          </div>

          {invLoading ? (
            <div className="skeleton" style={{ height: 100, borderRadius: 8 }} />
          ) : inventoryData?.list.length === 0 ? (
            <p className={styles.empty_hint}>当前无库存预警</p>
          ) : (
            <ul className={styles.alert_list} role="list">
              {inventoryData?.list.map((item) => {
                const dotStatus = resolveInventoryDotStatus(
                  item.qtyAvailable,
                  item.safetyStock,
                );
                // 缺口量 = 安全库存 - 可用量（负数说明呆滞，不展示）
                const gap = parseFloat(item.safetyStock) - parseFloat(item.qtyAvailable);
                const showGap = gap > 0;

                return (
                  <li key={item.skuId} className={styles.alert_item}>
                    <div className={styles.alert_item__header}>
                      <span className={styles.alert_item__name}>{item.skuName}</span>
                      <StatusDot
                        status={dotStatus}
                        label={STATUS_DOT_LABEL[dotStatus]}
                        className={styles.alert_item__dot}
                      />
                    </div>
                    <div className={styles.alert_item__detail}>
                      <span className={styles.alert_item__qty_bad}>
                        {item.qtyAvailable} {item.stockUnit}
                      </span>
                      <span className={styles.alert_item__sep}>/ 安全库存</span>
                      <span className={styles.alert_item__safety}>
                        {item.safetyStock} {item.stockUnit}
                      </span>
                      {/* T010: 补充缺口量强调显示 */}
                      {showGap && (
                        <span className={styles.alert_item__gap}>
                          缺口 <strong>{gap.toFixed(0)}</strong> {item.stockUnit}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 待审批采购建议 */}
        <section className={`card ${styles.alert_card}`} aria-label="待审批采购建议">
          <div className={styles.section_header}>
            <h2 className={styles.section_title}>待审批采购建议</h2>
            <Button variant="text" size="sm" onClick={() => navigate('/purchase/suggestions')}>
              查看全部 →
            </Button>
          </div>

          {suggestionsData?.list.length === 0 ? (
            <p className={styles.empty_hint}>暂无待审批建议</p>
          ) : (
            <ul className={styles.alert_list} role="list">
              {suggestionsData?.list.map((s) => (
                <li key={s.id} className={styles.suggestion_item}>
                  <div className={styles.suggestion_item__header}>
                    <span className={styles.suggestion_item__name}>{s.skuName}</span>
                    <span className={styles.suggestion_item__amount}>{formatCNY(s.estimatedAmount)}</span>
                  </div>
                  <div className={styles.suggestion_item__detail}>
                    建议采购&nbsp;
                    <strong>{s.suggestedQty}</strong>&nbsp;{s.purchaseUnit}
                    <span className={styles.alert_item__sep}> · </span>
                    {s.supplierName}
                  </div>
                  <p className={styles.suggestion_item__reason}>{s.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
