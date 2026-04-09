/**
 * [artifact:前端代码] — ScheduleSuggestionPage（智能调度建议页）
 * Sprint 4 / FE-S4-05
 *
 * 页面布局：
 *  1. 顶部统计行：4 列 ScheduleStatCard
 *  2. 中间内容区：左60% 采购建议 + 右40% 排产建议
 *  3. 底部历史记录 Tab（批次历史）
 *  4. 触发计算按钮 + 计算状态轮询
 *
 * 数据来源：真实 API hooks（不再使用静态 mock）
 */

import { useState, useEffect, useMemo } from 'react';
import ScheduleStatCard from '@/components/ScheduleStatCard/ScheduleStatCard';
import { ACTION_CODES } from '@/constants/accessControl';
import { usePermission } from '@/hooks/usePermission';
import {
  useLatestSuggestion,
  useTriggerCalculation,
  useCalculationStatus,
  useAcceptItem,
  useRejectItem,
  useSuggestionHistory,
} from '@/hooks/useScheduleSuggestion';
import type {
  PurchaseSuggestionItem,
  WorkOrderSuggestionItem,
  SuggestionHistoryBatch,
} from '@/api/scheduleSuggestion';
import styles from './ScheduleSuggestionPage.module.css';

// ─── 工具：格式化日期 ─────────────────────────
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

function fmtHistoryStatus(status: string): string {
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'calculating') return '计算中';
  if (status === 'pending') return '排队中';
  return status;
}

function historyStatusClass(status: string): string {
  if (status === 'completed') return styles['history_result--approved'];
  if (status === 'failed') return styles['history_result--rejected'];
  return '';
}

// ─── Loading 骨架 ─────────────────────────────
function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <ul className={styles.suggestion_list} role="list" aria-busy="true" aria-label="加载中">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className={styles.suggestion_item} style={{ opacity: 0.4 }}>
          <div className={styles.suggestion_item__top}>
            <span
              className={styles.suggestion_item__name}
              style={{ background: 'var(--color-gray-200)', borderRadius: 4, color: 'transparent', minWidth: 120 }}
            >
              &nbsp;
            </span>
          </div>
          <div className={styles.suggestion_item__meta} style={{ height: 16, background: 'var(--color-gray-100)', borderRadius: 4 }} />
        </li>
      ))}
    </ul>
  );
}

// ─── 错误占位 ─────────────────────────────────
function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      style={{
        padding: 'var(--space-6)',
        textAlign: 'center',
        color: 'var(--color-error-600)',
        fontSize: 'var(--text-body-s)',
      }}
    >
      <p>{message}</p>
      {onRetry && (
        <button
          type="button"
          className={styles.btn_approve}
          style={{ marginTop: 'var(--space-3)' }}
          onClick={onRetry}
        >
          重试
        </button>
      )}
    </div>
  );
}

// ─── 空状态占位 ───────────────────────────────
function EmptyBlock({ onTrigger, triggering }: { onTrigger: () => void; triggering: boolean }) {
  return (
    <div
      style={{
        padding: 'var(--space-8)',
        textAlign: 'center',
        color: 'var(--text-secondary)',
        fontSize: 'var(--text-body-m)',
      }}
    >
      <p style={{ marginBottom: 'var(--space-3)' }}>暂无建议数据，点击触发 AI 计算</p>
      <button
        type="button"
        className={styles.btn_approve}
        disabled={triggering}
        onClick={onTrigger}
        style={{ opacity: triggering ? 0.6 : 1 }}
      >
        {triggering ? '计算中…' : '触发计算'}
      </button>
    </div>
  );
}

// ─── 计算进度横幅 ──────────────────────────────
function CalcProgressBanner({
  jobId,
  onDone,
}: {
  jobId: string;
  onDone: () => void;
}) {
  const { data, isError } = useCalculationStatus(jobId);

  useEffect(() => {
    if (data?.status === 'completed' || data?.status === 'failed') {
      onDone();
    }
  }, [data?.status, onDone]);

  const statusText = isError
    ? '状态查询失败'
    : data?.status === 'running'
    ? `AI 计算中… ${data.progress != null ? `${data.progress}%` : ''}`
    : data?.status === 'failed'
    ? `计算失败：${data.errorMessage ?? '未知错误'}`
    : data?.status === 'completed'
    ? '计算完成，正在刷新…'
    : '任务排队中…';

  const isFailure = isError || data?.status === 'failed';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: 'var(--space-3) var(--space-5)',
        background: isFailure ? 'var(--color-error-50)' : 'var(--color-primary-50)',
        borderLeft: `4px solid ${isFailure ? 'var(--color-error-500)' : 'var(--color-primary-500)'}`,
        color: isFailure ? 'var(--color-error-700)' : 'var(--color-primary-700)',
        fontSize: 'var(--text-body-s)',
        fontWeight: 500,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
      }}
    >
      {!isFailure && (
        <span
          style={{
            display: 'inline-block',
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '2px solid var(--color-primary-400)',
            borderTopColor: 'transparent',
            animation: 'spin 0.8s linear infinite',
            flexShrink: 0,
          }}
          aria-hidden="true"
        />
      )}
      {statusText}
    </div>
  );
}

// ─── 子组件：采购建议区 ──────────────────────
interface PurchasePanelProps {
  items: PurchaseSuggestionItem[];
  loading: boolean;
  error: boolean;
  onRefetch: () => void;
  onTrigger: () => void;
  triggering: boolean;
}

function PurchaseSuggestionPanel({
  items,
  loading,
  error,
  onRefetch,
  onTrigger,
  triggering,
}: PurchasePanelProps) {
  const { mutate: acceptItem, isPending: accepting } = useAcceptItem();
  const { mutate: rejectItem, isPending: rejecting } = useRejectItem();

  const pendingItems = items.filter((i) => i.status === 'pending');

  return (
    <section className={styles.panel} aria-labelledby="purchase-panel-title">
      <div className={styles.panel__header}>
        <h3 id="purchase-panel-title" className={styles.panel__title}>
          <span className={styles.panel__title_icon} aria-hidden="true">🛒</span>
          采购建议
        </h3>
        {!loading && !error && (
          <span className={styles.panel__badge}>{pendingItems.length} 条待处理</span>
        )}
      </div>

      {loading ? (
        <SkeletonRows count={3} />
      ) : error ? (
        <ErrorBlock message="采购建议加载失败" onRetry={onRefetch} />
      ) : items.length === 0 ? (
        <EmptyBlock onTrigger={onTrigger} triggering={triggering} />
      ) : (
        <ul className={styles.suggestion_list} role="list">
          {items.map((item) => (
            <li key={item.id} className={styles.suggestion_item}>
              <div className={styles.suggestion_item__top}>
                <span className={styles.suggestion_item__name}>{item.skuName}</span>
                <span
                  className={[
                    styles.suggestion_item__urgency,
                    item.status === 'pending' ? '' : '',
                    item.source === 'shortage_trigger' ? styles['suggestion_item__urgency--high'] : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {item.source === 'shortage_trigger' ? '紧急' : '普通'}
                </span>
              </div>
              <div className={styles.suggestion_item__meta}>
                <span>
                  建议采购：<strong>{item.suggestedQty} {item.unit}</strong>
                </span>
                <span className={styles.suggestion_item__sep} aria-hidden="true">·</span>
                <span>{item.reason}</span>
                {item.neededByDate && (
                  <>
                    <span className={styles.suggestion_item__sep} aria-hidden="true">·</span>
                    <span>需求日期：{fmtDate(item.neededByDate)}</span>
                  </>
                )}
                {item.supplierName && (
                  <>
                    <span className={styles.suggestion_item__sep} aria-hidden="true">·</span>
                    <span>供应商：{item.supplierName}</span>
                  </>
                )}
              </div>
              {item.status === 'pending' ? (
                <div className={styles.suggestion_item__actions}>
                  <button
                    type="button"
                    className={styles.btn_approve}
                    disabled={accepting || rejecting}
                    onClick={() => acceptItem(item.id)}
                    aria-label={`批准 ${item.skuName} 采购建议`}
                  >
                    {accepting ? '处理中…' : '批准'}
                  </button>
                  <button
                    type="button"
                    className={styles.btn_reject}
                    disabled={accepting || rejecting}
                    onClick={() =>
                      rejectItem({ itemId: item.id, reason: '人工驳回' })
                    }
                    aria-label={`驳回 ${item.skuName} 采购建议`}
                  >
                    驳回
                  </button>
                </div>
              ) : (
                <div className={styles.suggestion_item__actions}>
                  <span
                    className={[
                      styles.suggestion_item__urgency,
                      item.status === 'rejected' ? styles['suggestion_item__urgency--high'] : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={item.status === 'accepted' || item.status === 'applied' ? {
                      background: 'var(--color-success-100)',
                      color: 'var(--color-success-700)',
                    } : undefined}
                  >
                    {item.status === 'accepted'
                      ? '已批准'
                      : item.status === 'applied'
                      ? '已应用'
                      : '已驳回'}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── 子组件：排产建议区 ──────────────────────
interface ProductionPanelProps {
  items: WorkOrderSuggestionItem[];
  loading: boolean;
  error: boolean;
  onRefetch: () => void;
  onTrigger: () => void;
  triggering: boolean;
}

function ProductionSuggestionPanel({
  items,
  loading,
  error,
  onRefetch,
  onTrigger,
  triggering,
}: ProductionPanelProps) {
  const { mutate: acceptItem, isPending: accepting } = useAcceptItem();
  const { mutate: rejectItem, isPending: rejecting } = useRejectItem();

  const pendingItems = items.filter((i) => i.status === 'pending');

  return (
    <section className={styles.panel} aria-labelledby="production-panel-title">
      <div className={styles.panel__header}>
        <h3 id="production-panel-title" className={styles.panel__title}>
          <span className={styles.panel__title_icon} aria-hidden="true">🏭</span>
          排产建议
        </h3>
        {!loading && !error && (
          <span className={styles.panel__badge}>{pendingItems.length} 条待排产</span>
        )}
      </div>

      {loading ? (
        <SkeletonRows count={2} />
      ) : error ? (
        <ErrorBlock message="排产建议加载失败" onRetry={onRefetch} />
      ) : items.length === 0 ? (
        <EmptyBlock onTrigger={onTrigger} triggering={triggering} />
      ) : (
        <ul className={styles.suggestion_list} role="list">
          {items.map((item) => (
            <li key={item.id} className={styles.suggestion_item}>
              <div className={styles.suggestion_item__top}>
                <span className={styles.suggestion_item__name}>{item.skuName}</span>
                <span
                  className={[
                    styles.suggestion_item__urgency,
                    item.rank === 1 ? styles['suggestion_item__urgency--high'] : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {item.rank === 1 ? '紧急' : item.totalScore >= 80 ? '高优' : '普通'}
                </span>
              </div>
              <div className={styles.suggestion_item__meta}>
                <span>
                  工单：<strong>{item.workOrderNo}</strong>
                </span>
                <span className={styles.suggestion_item__sep} aria-hidden="true">·</span>
                <span>综合评分：<strong>{item.totalScore}</strong></span>
                <span className={styles.suggestion_item__sep} aria-hidden="true">·</span>
                <span>排名第 {item.rank}</span>
                {item.recommendedWorkerName && (
                  <>
                    <span className={styles.suggestion_item__sep} aria-hidden="true">·</span>
                    <span>推荐工人：{item.recommendedWorkerName}</span>
                  </>
                )}
              </div>
              {item.status === 'pending' ? (
                <div className={styles.suggestion_item__actions}>
                  <button
                    type="button"
                    className={styles.btn_approve}
                    disabled={accepting || rejecting}
                    onClick={() => acceptItem(item.id)}
                    aria-label={`确认排产 ${item.workOrderNo}`}
                  >
                    {accepting ? '处理中…' : '确认排产'}
                  </button>
                  <button
                    type="button"
                    className={styles.btn_reject}
                    disabled={accepting || rejecting}
                    onClick={() =>
                      rejectItem({ itemId: item.id, reason: '延后处理' })
                    }
                    aria-label={`延后排产 ${item.workOrderNo}`}
                  >
                    延后
                  </button>
                </div>
              ) : (
                <div className={styles.suggestion_item__actions}>
                  <span
                    className={[
                      styles.suggestion_item__urgency,
                      item.status === 'rejected' ? styles['suggestion_item__urgency--high'] : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={item.status === 'accepted' || item.status === 'applied' ? {
                      background: 'var(--color-success-100)',
                      color: 'var(--color-success-700)',
                    } : undefined}
                  >
                    {item.status === 'accepted'
                      ? '已确认'
                      : item.status === 'applied'
                      ? '已排产'
                      : '已延后'}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── 子组件：历史记录 Tab ────────────────────
type HistoryTab = 'purchase' | 'production';

function HistoryPanel() {
  const [activeTab, setActiveTab] = useState<HistoryTab>('purchase');
  const [page] = useState(1);
  const { data, isLoading, isError } = useSuggestionHistory(page, 10);

  const batches: SuggestionHistoryBatch[] = data?.list ?? [];

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
        hidden={activeTab !== 'purchase'}
        className={styles.tab_panel}
      >
        {isLoading ? (
          <p style={{ padding: 'var(--space-5)', color: 'var(--text-secondary)', fontSize: 'var(--text-body-s)' }}>
            加载中…
          </p>
        ) : isError ? (
          <p style={{ padding: 'var(--space-5)', color: 'var(--color-error-600)', fontSize: 'var(--text-body-s)' }}>
            历史记录加载失败
          </p>
        ) : batches.length === 0 ? (
          <p style={{ padding: 'var(--space-5)', color: 'var(--text-secondary)', fontSize: 'var(--text-body-s)' }}>
            暂无历史记录
          </p>
        ) : (
          <table className={styles.history_table}>
            <thead>
              <tr>
                <th>计算时间</th>
                <th>批次 ID</th>
                <th>采购条目</th>
                <th>预估金额</th>
                <th>类型</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((row) => (
                <tr key={row.id}>
                  <td>{fmtDate(row.createdAt)}</td>
                  <td>{row.batchNo}</td>
                  <td>{row.purchaseCount} 条</td>
                  <td>—</td>
                  <td>
                    <span
                      className={[
                        styles.history_result,
                        styles['history_result--approved'],
                      ].join(' ')}
                    >
                      {row.triggerType !== 'manual' ? '冷启动' : 'AI计算'}
                    </span>
                  </td>
                  <td>
                    <span className={[styles.history_result, historyStatusClass(row.status)].filter(Boolean).join(' ')}>
                      {fmtHistoryStatus(row.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div
        id="tab-panel-production"
        role="tabpanel"
        hidden={activeTab !== 'production'}
        className={styles.tab_panel}
      >
        {isLoading ? (
          <p style={{ padding: 'var(--space-5)', color: 'var(--text-secondary)', fontSize: 'var(--text-body-s)' }}>
            加载中…
          </p>
        ) : isError ? (
          <p style={{ padding: 'var(--space-5)', color: 'var(--color-error-600)', fontSize: 'var(--text-body-s)' }}>
            历史记录加载失败
          </p>
        ) : batches.length === 0 ? (
          <p style={{ padding: 'var(--space-5)', color: 'var(--text-secondary)', fontSize: 'var(--text-body-s)' }}>
            暂无历史记录
          </p>
        ) : (
          <table className={styles.history_table}>
            <thead>
              <tr>
                <th>计算时间</th>
                <th>批次 ID</th>
                <th>排产条目</th>
                <th>类型</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((row) => (
                <tr key={row.id}>
                  <td>{fmtDate(row.createdAt)}</td>
                  <td>{row.batchNo}</td>
                  <td>{row.productionCount} 条</td>
                  <td>
                    <span className={[styles.history_result, styles['history_result--approved']].join(' ')}>
                      {row.triggerType !== 'manual' ? '冷启动' : 'AI计算'}
                    </span>
                  </td>
                  <td>
                    <span className={[styles.history_result, historyStatusClass(row.status)].filter(Boolean).join(' ')}>
                      {fmtHistoryStatus(row.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

// ─── 页面主体 ─────────────────────────────────
export default function ScheduleSuggestionPage() {
  // ── 触发计算状态 ──
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);

  const { mutate: triggerCalc, isPending: triggering } = useTriggerCalculation();
  const {
    data: batch,
    isLoading: batchLoading,
    isError: batchError,
    refetch: batchRefetch,
  } = useLatestSuggestion();

  const handleTrigger = () => {
    triggerCalc(undefined, {
      onSuccess: (res) => {
        if (res?.jobId) {
          setPollingJobId(res.jobId);
        }
      },
    });
  };

  const handlePollDone = () => {
    setPollingJobId(null);
    void batchRefetch();
  };

  // ── 角色隔离（BD-003 权限矩阵）──
  const { can } = usePermission();
  const canViewPurchase = useMemo(
    () => can(ACTION_CODES.SCHEDULE_SUGGESTION_PURCHASE_VIEW),
    [can],
  );
  const canViewProduction = useMemo(
    () => can(ACTION_CODES.SCHEDULE_SUGGESTION_PRODUCTION_VIEW),
    [can],
  );
  const canTriggerCalc = useMemo(
    () => can(ACTION_CODES.SCHEDULE_SUGGESTION_TRIGGER),
    [can],
  );

  // ── 统计数据 ──
  const purchaseItems = batch?.purchaseItems ?? [];
  const productionItems = batch?.productionItems ?? [];
  const pendingPurchase = purchaseItems.filter((i) => i.status === 'pending').length;
  const pendingProduction = productionItems.filter((i) => i.status === 'pending').length;
  const stockAlerts = purchaseItems.filter((i) => i.source === 'shortage_trigger').length;
  const capacityRate = batch
    ? `${Math.round(
        (productionItems.length > 0
          ? (productionItems.reduce((s, i) => s + i.totalScore, 0) / productionItems.length / 100) * 100
          : 0)
      )}%`
    : '—';

  return (
    <div className={styles.page}>
      {/* 页面标题 */}
      <header className={styles.page__header}>
        <div className={styles.page__breadcrumb}>
          <span className={styles.page__breadcrumb_item}>智能调度</span>
          <span className={styles.page__breadcrumb_sep} aria-hidden="true">/</span>
          <span className={styles.page__breadcrumb_item} aria-current="page">调度建议</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
          <h2 className={styles.page__title}>
            <span aria-hidden="true">⚡</span> 智能调度建议
          </h2>
          {canTriggerCalc && (
            <button
              type="button"
              className={styles.btn_approve}
              disabled={triggering || pollingJobId !== null}
              onClick={handleTrigger}
              aria-label="触发 AI 重新计算调度建议"
            >
              {triggering || pollingJobId !== null ? '计算中…' : '触发计算'}
            </button>
          )}
        </div>
        <p className={styles.page__subtitle}>
          基于当前库存、销售订单与产能数据，AI 自动生成采购与排产建议
        </p>
        {batch?.calculatedAt && (
          <p className={styles.page__subtitle} style={{ fontSize: 'var(--text-body-s)' }}>
            最近一次计算时间：{fmtDate(batch.calculatedAt)}
          </p>
        )}
      </header>

      {/* 计算进度横幅 */}
      {pollingJobId && (
        <CalcProgressBanner jobId={pollingJobId} onDone={handlePollDone} />
      )}

      {/* 顶部统计卡片行 */}
      <div className={styles.stats_row} role="region" aria-label="调度统计概览">
        <ScheduleStatCard
          title="待处理采购建议"
          value={batchLoading ? '—' : pendingPurchase}
          unit="条"
          variant="warning"
          icon="🛒"
        />
        <ScheduleStatCard
          title="待排产工单"
          value={batchLoading ? '—' : pendingProduction}
          unit="单"
          variant="info"
          icon="🏭"
        />
        <ScheduleStatCard
          title="库存预警"
          value={batchLoading ? '—' : stockAlerts}
          unit="项"
          variant="danger"
          icon="⚠️"
        />
        <ScheduleStatCard
          title="产能利用率"
          value={batchLoading ? '—' : capacityRate}
          variant="normal"
          icon="📊"
        />
      </div>

      {/* 中间内容区：按角色显示对应面板 */}
      <div className={styles.content_row}>
        {/* 采购建议：boss/admin/supervisor/purchaser 可见 */}
        {canViewPurchase && (
          <div className={canViewProduction ? styles.content_left : styles.content_row}>
            <PurchaseSuggestionPanel
              items={purchaseItems}
              loading={batchLoading}
              error={batchError}
              onRefetch={() => void batchRefetch()}
              onTrigger={handleTrigger}
              triggering={triggering}
            />
          </div>
        )}

        {/* 排产建议：boss/admin/supervisor 可见 */}
        {canViewProduction && (
          <div className={canViewPurchase ? styles.content_right : styles.content_row}>
            <ProductionSuggestionPanel
              items={productionItems}
              loading={batchLoading}
              error={batchError}
              onRefetch={() => void batchRefetch()}
              onTrigger={handleTrigger}
              triggering={triggering}
            />
          </div>
        )}
      </div>

      {/* 底部历史记录 */}
      <HistoryPanel />
    </div>
  );
}
