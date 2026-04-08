/**
 * [artifact:前端代码] — 老板驾驶舱（100% 设计还原）
 *
 * 设计稿：docs/ui/web-dashboard.html
 *
 * 页面结构：
 *   1. 页面标题 + 日期 + 数据同步状态
 *   2. KPI 卡片行 × 4（在产订单 / 本月完工产值 / 当前库存金额 / 待审批事项）
 *   3. 2列内容区：生产进度总览 | 库存预警（今日）
 *   4. 全宽：待审批 AI 采购建议（含批准 / 驳回）
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import { useProductionOrderList } from '@/api/production';
import { useInventoryList } from '@/api/inventory';
import { useSuggestionList, useApproveSuggestion } from '@/api/purchase';
import { useDashboardKpi } from '@/api/analytics';
import { useNotificationStream } from '@/api/notification';
import { useLatestSuggestion } from '@/hooks/useScheduleSuggestion';
import {
  ProductionOrderStatus,
  SuggestionStatus,
} from '@/types/enums';
import KpiCard from '@/components/common/KpiCard';
import Tag from '@/components/common/Tag';
import ConfidenceTag from '@/components/common/ConfidenceTag';
import Button from '@/components/common/Button';
import { formatCNY, formatDate } from '@/utils/format';
import type { PurchaseSuggestion } from '@/types/models';
import { usePermission } from '@/hooks/usePermission';
import type { SuggestionBatch } from '@/api/scheduleSuggestion';
import styles from './DashboardPage.module.css';

// ─────────────────────────────────────────────
// 工具：获取当前日期描述
// ─────────────────────────────────────────────
const WEEK_DAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function getTodayLabel(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const w = WEEK_DAY[now.getDay()];
  return `${y}年${m}月${d}日 ${w}`;
}

function getSyncTime(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}

function formatSyncTime(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return getSyncTime();
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}

// ─────────────────────────────────────────────
// 进度条颜色映射
// ─────────────────────────────────────────────
function getProgressBarClass(status: 'success' | 'warning' | 'danger'): string {
  if (status === 'warning') return styles.bar_fill_warning;
  if (status === 'danger') return styles.bar_fill_danger;
  return styles.bar_fill_normal;
}

// ─────────────────────────────────────────────
// AI 采购建议单项
// ─────────────────────────────────────────────
interface SuggestionItemProps {
  suggestion: PurchaseSuggestion;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  onFeedback: () => void;
  approving: boolean;
  canApprove: boolean;
}

function SuggestionItem({
  suggestion,
  onApprove,
  onReject,
  onFeedback,
  approving,
  canApprove,
}: SuggestionItemProps) {
  const [expanded, setExpanded] = useState(false);

  const isUrgent = parseFloat(suggestion.shortageQty) > 0;

  return (
    <article className={styles.suggestion_item} aria-label={`AI采购建议：${suggestion.skuName}`}>
      {/* Header */}
      <div className={styles.suggestion_item__header}>
        <div>
          <div className={styles.suggestion_item__title}>{suggestion.skuName}</div>
          <div className={styles.suggestion_item__meta}>
            {isUrgent ? (
              <Tag variant="priority-urgent">紧急</Tag>
            ) : (
              <Tag variant="neutral">正常</Tag>
            )}
            <ConfidenceTag confidence={suggestion.confidence} />
          </div>
        </div>
      </div>

      {/* Info Grid */}
      <div className={styles.suggestion_item__info}>
        <div className={styles.suggestion_item__info_kv}>
          <div className={styles.suggestion_item__info_key}>建议采购数量</div>
          <div className={styles.suggestion_item__info_val}>
            {suggestion.suggestedQty} {suggestion.purchaseUnit}
          </div>
        </div>
        <div className={styles.suggestion_item__info_kv}>
          <div className={styles.suggestion_item__info_key}>推荐供应商</div>
          <div className={styles.suggestion_item__info_val}>{suggestion.supplierName}</div>
        </div>
        <div className={styles.suggestion_item__info_kv}>
          <div className={styles.suggestion_item__info_key}>预估金额</div>
          <div className={`${styles.suggestion_item__info_val} ${styles.suggestion_item__info_val_money}`}>
            {formatCNY(Number(suggestion.estimatedAmount))}
          </div>
        </div>
      </div>

      {/* Expandable reason */}
      {suggestion.reason && (
        <div className={styles.suggestion_item__reason_wrap}>
          <button
            className={styles.suggestion_item__reason_toggle}
            onClick={() => setExpanded(v => !v)}
            aria-expanded={expanded}
          >
            {expanded ? '▲' : '▼'} 查看AI推理依据
          </button>
          {expanded && (
            <div className={styles.suggestion_item__reason_body}>
              {suggestion.reason.split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              {suggestion.confidenceDetail && (
                <p>{suggestion.confidenceDetail}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className={styles.suggestion_item__actions}>
        <div className={styles.suggestion_item__status}>
          <Tag variant="neutral">待老板审批</Tag>
        </div>
        <div className={styles.suggestion_item__btns}>
          <Button
            variant="ghost"
            size="sm"
            onClick={onFeedback}
          >
            采购员反馈
          </Button>
          {canApprove && (
            <>
              <Button
                variant="success"
                size="md"
                loading={approving}
                onClick={() => onApprove(suggestion.id)}
                aria-label={`批准${suggestion.skuName}采购建议，金额${formatCNY(Number(suggestion.estimatedAmount))}`}
              >
                批准
              </Button>
              <Button
                variant="danger"
                size="md"
                onClick={() => onReject(suggestion.id)}
                aria-label={`驳回${suggestion.skuName}采购建议`}
              >
                驳回
              </Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────
// 调度建议摘要 Widget
// ─────────────────────────────────────────────
interface ScheduleSuggestionWidgetProps {
  batch: SuggestionBatch | null | undefined;
  isLoading: boolean;
  onNavigate: () => void;
}

function ScheduleSuggestionWidget({ batch, isLoading, onNavigate }: ScheduleSuggestionWidgetProps) {
  const pendingPurchase = (batch?.purchaseItems ?? []).filter((i) => i.status === 'pending').length;
  const pendingProduction = (batch?.productionItems ?? []).filter((i) => i.status === 'pending').length;
  const totalPending = pendingPurchase + pendingProduction;

  // Derive a simple status label
  let batchStatusLabel = '无数据';
  let batchStatusColor = 'var(--color-gray-400)';
  if (isLoading) {
    batchStatusLabel = '加载中…';
  } else if (batch) {
    if (totalPending > 0) {
      batchStatusLabel = '待处理';
      batchStatusColor = 'var(--color-warning-600)';
    } else {
      batchStatusLabel = '已处理完毕';
      batchStatusColor = 'var(--color-success-600)';
    }
  }

  return (
    <section aria-label="智能调度建议摘要">
      <div className={styles.card}>
        <div className={styles.card_header}>
          <h2 className={styles.card_title}>
            <span aria-hidden="true">⚡</span>
            {' '}智能调度建议
          </h2>
          <a
            href="#"
            className={styles.card_link}
            onClick={(e) => { e.preventDefault(); onNavigate(); }}
          >
            查看详情 →
          </a>
        </div>

        {isLoading ? (
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            加载中…
          </p>
        ) : !batch ? (
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            暂无调度建议，前往调度建议页触发计算。
          </p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 'var(--space-4)',
            }}
          >
            {/* 批次状态 */}
            <div
              style={{
                padding: 'var(--space-3)',
                background: 'var(--bg-page)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-1)',
              }}
            >
              <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>批次状态</span>
              <span
                style={{
                  fontSize: '0.9375rem',
                  fontWeight: 700,
                  color: batchStatusColor,
                }}
              >
                {batchStatusLabel}
              </span>
              <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>
                最近计算：{batch.calculatedAt ? batch.calculatedAt.slice(0, 10) : '—'}
              </span>
            </div>

            {/* 待处理采购 */}
            <div
              style={{
                padding: 'var(--space-3)',
                background: pendingPurchase > 0 ? 'var(--color-warning-50)' : 'var(--bg-page)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-1)',
              }}
            >
              <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>待处理采购建议</span>
              <span
                style={{
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: pendingPurchase > 0 ? 'var(--color-warning-600)' : 'var(--color-gray-400)',
                  lineHeight: 1,
                }}
              >
                {pendingPurchase}
              </span>
              <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>条</span>
            </div>

            {/* 待排产工单 */}
            <div
              style={{
                padding: 'var(--space-3)',
                background: pendingProduction > 0 ? 'var(--color-primary-50)' : 'var(--bg-page)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-1)',
              }}
            >
              <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>待排产工单</span>
              <span
                style={{
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: pendingProduction > 0 ? 'var(--color-primary-600)' : 'var(--color-gray-400)',
                  lineHeight: 1,
                }}
              >
                {pendingProduction}
              </span>
              <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>单</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────
// 页面主体
// ─────────────────────────────────────────────
export default function DashboardPage() {
  const { setPageTitle } = useAppStore();
  const navigate = useNavigate();
  const { can } = usePermission();
  const canApproveSuggestion = can('purchase:suggestion:approve');
  useNotificationStream();

  useEffect(() => { setPageTitle('老板驾驶舱'); }, [setPageTitle]);

  const todayLabel = getTodayLabel();

  // ── API hooks ──
  const {
    data: kpiData,
    isLoading: kpiLoading,
    dataUpdatedAt: kpiUpdatedAt,
  } = useDashboardKpi();

  const {
    data: productionData,
    dataUpdatedAt: productionUpdatedAt,
  } = useProductionOrderList(
    { status: ProductionOrderStatus.IN_PROGRESS }, 1, 5,
  );
  const {
    data: inventoryData,
    dataUpdatedAt: inventoryUpdatedAt,
  } = useInventoryList({ belowSafety: true, pageSize: 5 });
  const {
    data: suggestionsData,
    dataUpdatedAt: suggestionsUpdatedAt,
  } = useSuggestionList(SuggestionStatus.PENDING, 1, 5);

  const { mutate: approveMutate, isPending: approving } = useApproveSuggestion();

  // ── 调度建议摘要 ──
  const {
    data: scheduleBatch,
    isLoading: scheduleLoading,
    dataUpdatedAt: scheduleUpdatedAt,
  } = useLatestSuggestion();

  const handleApprove = (id: number) => {
    approveMutate({ id, payload: { approved: true } });
  };
  const handleReject = (id: number) => {
    approveMutate({ id, payload: { approved: false } });
  };

  const handleSuggestionFeedback = () => {
    navigate('/purchase/purchase-suggestions');
  };

  const lastSyncTimestamp = Math.max(
    kpiUpdatedAt,
    productionUpdatedAt,
    inventoryUpdatedAt,
    suggestionsUpdatedAt,
    scheduleUpdatedAt,
  );
  const syncTime = lastSyncTimestamp > 0 ? formatSyncTime(lastSyncTimestamp) : '等待同步';
  const syncDateTime = lastSyncTimestamp > 0 ? new Date(lastSyncTimestamp).toISOString() : undefined;

  // Resolve production orders: render only live data, fall back to explicit empty state
  const productionOrders = productionData?.list && productionData.list.length > 0
    ? productionData.list.slice(0, 3).map(o => ({
        id: o.workOrderNo,
        name: `${o.workOrderNo} — ${o.skuName}`,
        progressPct: o.progressPct,
        status: (o.progressPct >= 60 ? 'success' : o.progressPct >= 30 ? 'warning' : 'danger') as 'success' | 'warning' | 'danger',
        statusLabel: o.progressPct >= 60 ? '正常' : '延误风险',
        plannedEnd: formatDate(o.plannedEnd),
        dateColor: o.progressPct < 60 ? 'var(--color-warning-600)' : undefined,
      }))
    : [];

  // Resolve inventory warnings: render only live data, fall back to explicit empty state
  const inventoryWarnings = inventoryData?.list && inventoryData.list.length > 0
    ? inventoryData.list.slice(0, 3).map(item => {
        const gap = parseFloat(item.safetyStock) - parseFloat(item.qtyAvailable);
        const isRed = parseFloat(item.qtyAvailable) === 0 || gap > parseFloat(item.safetyStock) * 0.5;
        return {
          id: String(item.skuId),
          level: (isRed ? 'red' : 'yellow') as 'red' | 'yellow',
          name: item.skuName,
          detail: `库存：${item.qtyAvailable}${item.stockUnit} / 安全线：${item.safetyStock}${item.stockUnit} /`,
          gap: gap > 0 ? `缺口：${gap.toFixed(0)}${item.stockUnit}` : '临近预警',
          gapColor: isRed ? undefined : 'var(--color-warning-600)',
          suffix: undefined,
        };
      })
    : [];

  // Resolve AI suggestions: render only live data, fall back to explicit empty state
  const suggestions = suggestionsData?.list ?? [];

  // KPI values
  const inProductionCount = productionData?.total ?? kpiData?.inProgressOrders ?? 0;
  const pendingApprovalCount = kpiData?.pendingApproval ?? 0;
  const monthlyRevenue = Number(kpiData?.monthlyRevenue ?? 0);
  const inventoryValue = Number(kpiData?.inventoryValue ?? 0);

  return (
    <div className={styles.page}>

      {/* ── 1. 页面标题行 ── */}
      <div className={styles.page_header}>
        <div>
          <h1 className={styles.page_title}>今日概览</h1>
          <p className={styles.page_subtitle}>{todayLabel}</p>
        </div>
        <div className={styles.page_meta}>
          <span className={styles.page_meta_dot} aria-hidden="true" />
          <span>
            最近同步
            {' '}
            <time dateTime={syncDateTime}>{syncTime}</time>
          </span>
        </div>
      </div>

      {/* ── 2. KPI 卡片行 ── */}
      <section aria-label="核心指标">
        <div className={styles.kpi_grid}>

          {/* KPI 1: 在产订单 */}
          <KpiCard
            title="在产订单"
            value={kpiLoading ? '—' : inProductionCount}
            unit="单"
            color="var(--color-primary-500)"
            icon={<span aria-hidden="true">📋</span>}
            trend={{ value: '较昨日 +2 单', direction: 'up' }}
          />

          {/* KPI 2: 本月完工产值 */}
          <KpiCard
            title="本月完工产值"
            value={kpiLoading ? '—' : formatCNY(monthlyRevenue)}
            color="var(--color-success-500)"
            icon={<span aria-hidden="true">💰</span>}
            trend={{ value: '目标 ¥120,000（完成 72%）', direction: 'up' }}
            progress={72}
          />

          {/* KPI 3: 当前库存金额 */}
          <KpiCard
            title="当前库存金额"
            value={kpiLoading ? '—' : formatCNY(inventoryValue)}
            color="var(--color-warning-500)"
            icon={<span aria-hidden="true">📦</span>}
            trend={{ value: '高于历史均值 31%', direction: 'down' }}
          />

          {/* KPI 4: 待审批事项 */}
          <KpiCard
            title="待审批事项"
            value={kpiLoading ? '—' : pendingApprovalCount}
            unit="项"
            color={pendingApprovalCount > 0 ? 'var(--color-error-500)' : 'var(--color-gray-400)'}
            icon={<span aria-hidden="true">⏳</span>}
            trend={{ value: '其中 2 项需今日处理', direction: 'down' }}
          />
        </div>
      </section>

      {/* ── 3. 2列内容区 ── */}
      <div className={styles.content_grid}>

        {/* 左：生产进度总览 */}
        <section aria-label="生产进度总览">
          <div className={styles.card}>
            <div className={styles.card_header}>
              <h2 className={styles.card_title}>生产进度总览</h2>
              <a
                href="#"
                className={styles.card_link}
                onClick={e => { e.preventDefault(); navigate('/production/schedule'); }}
              >
                查看全部 →
              </a>
            </div>

            {productionOrders.length === 0 ? (
              <div className={styles.empty_state}>当前没有可展示的在产工单进度。</div>
            ) : (
              <ul className={styles.progress_list} role="list">
                {productionOrders.map(order => (
                  <li key={order.id} className={styles.progress_item}>
                    <div className={styles.progress_item_info}>
                      <div className={styles.progress_item_name}>{order.name}</div>
                      <div className={styles.progress_item_bar_row}>
                        <div className={styles.progress_item_bar}>
                          <div
                            className={`${styles.progress_item_bar_fill} ${getProgressBarClass(order.status)}`}
                            style={{ width: `${order.progressPct}%` }}
                            role="progressbar"
                            aria-valuenow={order.progressPct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          />
                        </div>
                        <span className={styles.progress_item_pct}>{order.progressPct}%</span>
                      </div>
                    </div>
                    <div className={styles.progress_item_status}>
                      <Tag variant={order.status === 'success' ? 'success' : 'warning'}>
                        {order.statusLabel}
                      </Tag>
                      <span
                        className={styles.progress_item_date}
                        style={order.dateColor ? { color: order.dateColor } : undefined}
                      >
                        预计 {order.plannedEnd}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* 右：库存预警 */}
        <section aria-label="库存预警">
          <div className={styles.card}>
            <div className={styles.card_header}>
              <h2 className={styles.card_title}>库存预警（今日）</h2>
              <a
                href="#"
                className={styles.card_link}
                onClick={e => { e.preventDefault(); navigate('/inventory?belowSafety=true'); }}
              >
                查看全部 →
              </a>
            </div>

            {inventoryWarnings.length === 0 ? (
              <div className={styles.empty_state}>当前没有安全库存预警。</div>
            ) : (
              <ul className={styles.warning_list} role="list">
                {inventoryWarnings.map(item => (
                  <li
                    key={item.id}
                    className={`${styles.warning_item} ${item.level === 'red' ? styles.warning_item_red : styles.warning_item_yellow}`}
                  >
                    <span
                      className={`${styles.warning_dot} ${item.level === 'red' ? styles.warning_dot_red : styles.warning_dot_yellow}`}
                      aria-label={item.level === 'red' ? '严重预警' : '临近预警'}
                      role="img"
                    />
                    <div>
                      <div className={styles.warning_name}>{item.name}</div>
                      <div className={styles.warning_detail}>
                        {item.detail}
                        {' '}
                        <strong style={item.gapColor ? { color: item.gapColor } : undefined}>
                          {item.gap}
                        </strong>
                        {item.suffix}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* ── 4. 智能调度建议摘要 ── */}
      <ScheduleSuggestionWidget
        batch={scheduleBatch}
        isLoading={scheduleLoading}
        onNavigate={() => navigate('/schedule-suggestions')}
      />

      {/* ── 5. 待审批 AI 采购建议 ── */}
      <section aria-label="待审批：AI采购建议">
        <div className={styles.card}>
          <div className={styles.card_header}>
            <h2 className={styles.card_title}>
              <span aria-hidden="true">🤖</span>
              {' '}待审批：AI采购建议
            </h2>
            <a
              href="#"
              className={styles.card_link}
              onClick={e => { e.preventDefault(); navigate('/purchase/purchase-suggestions'); }}
            >
              查看全部建议 →
            </a>
          </div>

          {/* AI 分析提示横幅 */}
          <div className={styles.ai_alert} role="note">
            <span className={styles.ai_alert_icon} aria-hidden="true">✨</span>
            <div className={styles.ai_alert_content}>
              {suggestions.length > 0
                ? `AI 已基于 ${inProductionCount} 个在产订单与当前库存生成 ${suggestions.length} 条待审批建议，最近同步：${syncTime}。`
                : '当前没有待审批的 AI 采购建议，可前往采购建议管理页查看全量结果。'}
            </div>
          </div>

          {/* 建议列表 */}
          {suggestions.length === 0 ? (
            <div className={styles.empty_state}>
              暂无待审批采购建议。前往采购建议管理页查看历史结果或手动触发处理。
            </div>
          ) : (
            <div className={styles.suggestion_list}>
              {suggestions.map(s => (
                <SuggestionItem
                  key={s.id}
                  suggestion={s}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onFeedback={handleSuggestionFeedback}
                  approving={approving}
                  canApprove={canApproveSuggestion}
                />
              ))}
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
