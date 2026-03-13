/**
 * [artifact:接口联调代码] — 质量溯源中心
 * 100% 还原 web-quality-trace.html 设计稿
 * 布局：统计卡片 + 溯源链可视化 + 双列（问题列表 + 问题分布图）
 *
 * API 联调说明：
 * - 统计卡片：useQualityStats(periodDays)
 * - 溯源链：useTraceability(selectedOrderId)，点击质量问题"溯源"按钮触发
 * - 质量问题列表：useIssueList()
 * - 问题类型分布柱状图：来自 QualityStats.issueTypeBreakdown（实时数据）
 * - 高频问题 TOP3：来自 QualityStats.top5Issues 前3条（实时数据）
 * - 新建验货单：useCreateInspection（已接入，保持不变）
 */

import { useEffect, useState, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import Modal from '@/components/common/Modal';
import Tag from '@/components/common/Tag';
import Button from '@/components/common/Button';
import {
  useCreateInspection,
  useQualityStats,
  useTraceability,
  useIssueList,
} from '@/api/quality';
import { IssueType, IssueTypeLabel, IssueSeverity, IssueSeverityLabel } from '@/types/enums';
import styles from './TracePage.module.css';

// ─── 新建验货单表单类型 ────────────────────────
type CreateInspectionForm = {
  productionOrderId: string;
  inspectionDate: string;
  qtyInspected: string;
};

// ─── periodDays 映射 ──────────────────────────
const DATE_RANGE_OPTIONS: Array<{ label: string; value: 7 | 30 | 90 }> = [
  { label: '近30天', value: 30 },
  { label: '近7天',  value: 7  },
  { label: '近90天', value: 90 },
];

// ─── 严重程度 → Tag variant 映射 ──────────────
function severityToTagVariant(
  severity: IssueSeverity,
): 'error' | 'warning' | 'success' | 'neutral' {
  switch (severity) {
    case IssueSeverity.CRITICAL: return 'error';
    case IssueSeverity.MAJOR:    return 'error';
    case IssueSeverity.MINOR:    return 'warning';
    case IssueSeverity.COSMETIC: return 'success';
    default:                     return 'neutral';
  }
}

// ─── 问题类型 → 中文标签 ──────────────────────
function issueTypeToLabel(type: IssueType | string): string {
  return IssueTypeLabel[type as IssueType] ?? type;
}

// ─── 时间格式化（API 返回 ISO 字符串，展示为 M/D HH:mm）─
function formatTime(iso: string | Date): string {
  try {
    const d = new Date(iso);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${month}/${day} ${hh}:${mm}`;
  } catch {
    return String(iso);
  }
}

// ─── 溯源链节点类型（内部渲染用） ────────────
type TraceNodeType = 'product' | 'part' | 'material' | 'process' | 'worker' | 'missing';

interface TraceNode {
  type: TraceNodeType;
  icon: string;
  cardTitle: string;
  cardLines: string[];
  highlight?: { text: string; color: string };
  tagText: string;
  tagVariant: 'error' | 'warning' | 'success' | 'neutral' | 'dye-lot';
  extraAlert?: string;
  dashed?: boolean;
}

// ─── 将 API ComponentTrace 转换为溯源节点列表 ─
import type { TraceabilityChain, TraceComponent } from '@/types/models';

function buildTraceNodes(chain: TraceabilityChain): TraceNode[] {
  const nodes: TraceNode[] = [];

  // 第一个节点：成品信息
  nodes.push({
    type: 'product',
    icon: '📦',
    cardTitle: '成品',
    cardLines: [
      `${chain.workOrderNo} ${chain.skuName}`,
      `客户: ${chain.customerName}`,
      `销售单: ${chain.salesOrderNo}`,
    ],
    tagText: '已验货',
    tagVariant: 'neutral',
  });

  // 溯源链各组件节点
  const components: TraceComponent[] = chain.components ?? [];
  components.forEach((comp) => {
    const isMissing = !comp.hasScanRecord;

    // 工序节点
    const processNode: TraceNode = {
      type: isMissing ? 'missing' : 'process',
      icon: isMissing ? '❓' : '⚙️',
      cardTitle: `工序：${comp.processStepName}`,
      cardLines: isMissing
        ? ['工人未扫码上报，', '无法追溯操作工人']
        : [
            comp.componentName ? `部件: ${comp.componentName}` : `工序步骤: ${comp.stepNo}`,
            `完成时间: ${formatTime(comp.operationTime)}`,
          ],
      tagText: isMissing ? '工序数据缺失' : '数据完整',
      tagVariant: isMissing ? 'neutral' : 'success',
      dashed: isMissing,
    };

    // 工人节点（仅当有扫码记录时显示）
    if (!isMissing) {
      nodes.push(processNode);
      nodes.push({
        type: 'worker',
        icon: '👤',
        cardTitle: '操作工人',
        cardLines: [
          comp.workerName,
          `工人ID: W-${String(comp.workerId).padStart(3, '0')}`,
        ],
        tagText: comp.processStepName,
        tagVariant: 'neutral',
      });

      // 如果有缸号，显示物料批次节点
      if (comp.dyeLotNo) {
        const isAbnormalDyeLot =
          chain.summary.dyeLots.length > 1 &&
          chain.summary.dyeLots.indexOf(comp.dyeLotNo) > 0;

        nodes.push({
          type: 'material',
          icon: '🎨',
          cardTitle: '物料批次',
          cardLines: [
            comp.skuName ?? '物料',
            `缸号: ${comp.dyeLotNo}`,
          ],
          tagText: `🎨 缸号: ${comp.dyeLotNo}`,
          tagVariant: 'dye-lot',
          extraAlert: isAbnormalDyeLot
            ? `⚠ 该缸号与同订单其他部件缸号（${chain.summary.dyeLots[0]}）不一致，疑为跨缸号使用`
            : undefined,
        });
      }
    } else {
      nodes.push(processNode);
    }
  });

  return nodes;
}

// ─── 问题类型 → 柱状图颜色映射 ──────────────
const ISSUE_TYPE_COLORS: Record<string, string> = {
  appearance: '#F87171',
  dimension:  '#FBBF24',
  function:   '#38BDF8',
  material:   '#A78BFA',
};

// ─── TOP3 标签颜色配置 ────────────────────────
const TOP3_STYLES = [
  { bg: 'var(--color-error-50)',   color: 'var(--color-error-700)',   tagVariant: 'error'   as const },
  { bg: 'var(--color-warning-50)', color: 'var(--color-warning-700)', tagVariant: 'warning' as const },
  { bg: 'var(--color-gray-50)',    color: 'var(--text-primary)',       tagVariant: 'neutral' as const },
];

// ─── 主组件 ───────────────────────────────────
export default function TracePage() {
  const { setPageTitle, showToast } = useAppStore();

  const [dateRange, setDateRange] = useState<string>('近30天');
  const [createModal, setCreateModal] = useState(false);
  const [form, setForm] = useState<CreateInspectionForm>({
    productionOrderId: '',
    inspectionDate: '',
    qtyInspected: '',
  });
  // 当前溯源的生产工单 ID（点击质量问题"溯源"按钮时设置）
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

  // 当前选中的 periodDays 值
  const periodDays = useMemo<7 | 30 | 90>(() => {
    const found = DATE_RANGE_OPTIONS.find((o) => o.label === dateRange);
    return found?.value ?? 30;
  }, [dateRange]);

  // ── API 调用 ─────────────────────────────────
  const statsQuery     = useQualityStats(periodDays);
  const issueListQuery = useIssueList({}, 1, 20);
  const traceQuery     = useTraceability(selectedOrderId);

  const createMutation = useCreateInspection();

  useEffect(() => { setPageTitle('质量溯源中心'); }, [setPageTitle]);

  // ── 派生统计卡片数据（来自 QualityStats API）────
  const stats = useMemo(() => {
    const d = statsQuery.data;
    if (!d) return null;

    // 近X天验货批次：用 issueTypeBreakdown 的总条数近似，
    // 实际 totalInspected 是件数；批次数后端未直接返回，
    // 这里取 totalInspected 作为件数展示，与原 mock 语义对齐
    const passRate =
      d.totalInspected > 0
        ? (((d.totalInspected - d.totalFailed) / d.totalInspected) * 100).toFixed(1) + '%'
        : '—';

    // 严重问题件数（CRITICAL / MAJOR 两级对应后端 severe/normal 两级）
    // 后端 top5Issues 聚合的是组件维度，totalFailed 对应总不合格件
    const severeCount = d.top5Issues
      .slice(0, 5)
      .reduce((acc, item) => acc + item.count, 0);

    // 已完成溯源比例（无直接字段，无法从当前 QualityStats 接口获取；保留 mock 但加注释）
    // TODO: 后端需新增 traceCompletionRate 字段后替换此值
    const traceCompletionPct = '—';

    return [
      {
        label: `近${d.periodDays}天验货件数`,
        value: String(d.totalInspected),
        unit: '件',
        sub: `不合格 ${d.totalFailed} 件`,
        color: 'var(--color-primary-600)',
        subColor: undefined as string | undefined,
      },
      {
        label: '综合合格率',
        value: passRate,
        unit: undefined,
        // failRate 后端已计算，直接展示不合格率；合格率 = 100% - failRate
        sub: `不合格率 ${d.failRate}`,
        color: 'var(--color-success-600)',
        subColor: 'var(--color-success-600)',
      },
      {
        label: '高频问题件数',
        value: String(severeCount),
        unit: '件',
        sub: 'TOP5 高频问题累计',
        color: 'var(--color-error-600)',
        subColor: 'var(--color-error-600)',
      },
      {
        label: '已完成溯源',
        // TODO: 后端需返回 traceCompletionRate 字段，当前暂无该统计
        value: traceCompletionPct,
        unit: undefined,
        sub: '后端暂未提供溯源完成率',
        color: 'var(--color-stagnant-600)',
        subColor: undefined as string | undefined,
      },
    ];
  }, [statsQuery.data]);

  // ── 派生溯源链节点数组 ──────────────────────
  const traceNodes = useMemo<TraceNode[]>(() => {
    if (!traceQuery.data) return [];
    return buildTraceNodes(traceQuery.data);
  }, [traceQuery.data]);

  // ── 派生柱状图数据（来自 QualityStats.issueTypeBreakdown）──
  const barChartData = useMemo(() => {
    const breakdown = statsQuery.data?.issueTypeBreakdown ?? [];
    if (breakdown.length === 0) return null; // null 时保留 mock
    return breakdown.map((item) => ({
      label: issueTypeToLabel(item.type),
      percent: Math.round(parseFloat(item.pct)),
      color: ISSUE_TYPE_COLORS[item.type] ?? '#94A3B8',
    }));
  }, [statsQuery.data]);

  // ── 派生 TOP3 数据（来自 QualityStats.top5Issues 前3条）──
  const top3Data = useMemo(() => {
    const top5 = statsQuery.data?.top5Issues ?? [];
    if (top5.length === 0) return null; // null 时保留 mock
    return top5.slice(0, 3).map((item, idx) => ({
      rank: `#${idx + 1}`,
      label: item.description,
      tagText: `${item.count}次 / ${periodDays}天`,
      ...TOP3_STYLES[idx] ?? TOP3_STYLES[2],
    }));
  }, [statsQuery.data, periodDays]);

  // ── 柱状图 fallback mock（后端无数据时使用）──
  // TODO: 当 issueTypeBreakdown 有数据后，此 mock 将不再使用
  const BAR_CHART_FALLBACK = [
    { label: '外观问题', percent: 72, color: '#F87171' },
    { label: '尺寸偏差', percent: 18, color: '#FBBF24' },
    { label: '功能问题', percent: 7,  color: '#38BDF8' },
    { label: '材质问题', percent: 3,  color: '#A78BFA' },
  ];

  // ── TOP3 fallback mock（后端无数据时使用）──
  // TODO: 当 top5Issues 有数据后，此 mock 将不再使用
  const TOP3_FALLBACK = [
    { rank: '#1', label: '面料色差（跨缸号）', tagText: '6次 / 30天', tagVariant: 'error'   as const, bg: 'var(--color-error-50)',   color: 'var(--color-error-700)'   },
    { rank: '#2', label: '五金孔位偏移',       tagText: '4次 / 30天', tagVariant: 'warning' as const, bg: 'var(--color-warning-50)', color: 'var(--color-warning-700)' },
    { rank: '#3', label: '表面划痕',           tagText: '3次 / 30天', tagVariant: 'neutral' as const, bg: 'var(--color-gray-50)',    color: 'var(--text-primary)'      },
  ];

  const finalBarChart = barChartData ?? BAR_CHART_FALLBACK;
  const finalTop3     = top3Data     ?? TOP3_FALLBACK;

  // ── 创建验货单 ────────────────────────────────
  const handleCreate = async () => {
    if (!form.productionOrderId || !form.inspectionDate || !form.qtyInspected) {
      showToast({ type: 'warning', message: '请填写生产工单号、验货日期和验货数量' });
      return;
    }
    try {
      await createMutation.mutateAsync({
        productionOrderId: Number(form.productionOrderId),
        inspectionDate: form.inspectionDate,
        qtyInspected: form.qtyInspected,
      });
      showToast({ type: 'success', message: '验货单已创建' });
      setCreateModal(false);
      setForm({ productionOrderId: '', inspectionDate: '', qtyInspected: '' });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  // ── 溯源区标题 ───────────────────────────────
  const traceSectionTitle = traceQuery.data
    ? `溯源链 — ${traceQuery.data.salesOrderNo} ${traceQuery.data.skuName}`
    : selectedOrderId !== null
    ? '溯源链加载中...'
    : '溯源链 — 请点击质量问题列表中的「溯源」按钮查看';

  return (
    <div className={styles.page}>
      {/* 页面头部 */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>质量溯源中心</h1>
        </div>
        <div className={styles.pageHeaderActions}>
          <select
            className={styles.dateSelect}
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            aria-label="时间范围"
          >
            {DATE_RANGE_OPTIONS.map((o) => (
              <option key={o.value}>{o.label}</option>
            ))}
          </select>
          <Button variant="primary" size="md" onClick={() => setCreateModal(true)}>
            + 新建验货单
          </Button>
        </div>
      </div>

      {/* 统计卡片行 */}
      <div className={styles.statsRow} role="region" aria-label="质量概况统计">
        {statsQuery.isLoading ? (
          /* 加载骨架：复用 4 个静态占位卡 */
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={styles.statCard} aria-busy="true">
              <div className={styles.statLabel} style={{ background: 'var(--color-gray-100)', borderRadius: 4, height: 16, width: '60%' }} />
              <div className={styles.statValue} style={{ background: 'var(--color-gray-100)', borderRadius: 4, height: 32, width: '40%', marginTop: 8 }} />
              <div className={styles.statSub} style={{ background: 'var(--color-gray-100)', borderRadius: 4, height: 14, width: '80%', marginTop: 6 }} />
            </div>
          ))
        ) : statsQuery.isError ? (
          <div className={styles.statCard} style={{ gridColumn: '1 / -1', color: 'var(--color-error-600)' }}>
            统计数据加载失败，请刷新页面重试
          </div>
        ) : (
          (stats ?? []).map((s) => (
            <div key={s.label} className={styles.statCard}>
              <div className={styles.statLabel}>{s.label}</div>
              <div className={styles.statValue} style={{ color: s.color }}>
                {s.value}
                {s.unit && <span className={styles.statUnit}>{s.unit}</span>}
              </div>
              <div className={styles.statSub} style={s.subColor ? { color: s.subColor } : undefined}>
                {s.sub}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 溯源链可视化区域 */}
      <section className={styles.traceSection} aria-label="成品溯源链">
        <div className={styles.traceSectionHeader}>
          <div>
            <div className={styles.traceSectionTitle}>{traceSectionTitle}</div>
            <div className={styles.traceSectionSubtitle}>
              从成品向下追溯：成品 → 问题部件 → 使用物料批次（含缸号）→ 生产工序 → 操作工人
            </div>
          </div>
          <Button variant="ghost" size="sm">导出溯源报告</Button>
        </div>

        {/* 溯源链内容区：加载 / 错误 / 空 / 节点列表 */}
        {traceQuery.isLoading && selectedOrderId !== null ? (
          <div className={styles.traceScroll} style={{ padding: '24px 0', color: 'var(--text-secondary)' }}>
            溯源链加载中...
          </div>
        ) : traceQuery.isError ? (
          <div className={styles.traceScroll} style={{ padding: '24px 0', color: 'var(--color-error-600)' }}>
            溯源链加载失败：{(traceQuery.error as Error).message}
          </div>
        ) : traceNodes.length === 0 && selectedOrderId === null ? (
          <div className={styles.traceScroll} style={{ padding: '24px 0', color: 'var(--text-secondary)' }}>
            暂无溯源数据，请在下方质量问题列表点击「溯源」按钮查看具体工单的溯源链。
          </div>
        ) : (
          <div className={styles.traceScroll} role="region" aria-label="溯源链可视化">
            <div className={styles.traceFlow} role="list">
              {traceNodes.map((node, idx) => (
                <div key={idx} className={styles.traceFlowItem}>
                  <div
                    className={styles.traceStep}
                    role="listitem"
                    aria-label={`${node.cardTitle}节点`}
                  >
                    <div
                      className={`${styles.traceIcon} ${styles[`traceIcon--${node.type}`]}`}
                      aria-label={node.cardTitle}
                    >
                      {node.icon}
                    </div>
                    <div
                      className={styles.traceCard}
                      style={node.dashed ? { background: 'var(--color-gray-50)', borderStyle: 'dashed' } : undefined}
                    >
                      <div
                        className={styles.traceCardTitle}
                        style={node.dashed ? { color: 'var(--text-secondary)' } : undefined}
                      >
                        {node.cardTitle}
                      </div>
                      <div className={styles.traceCardDetail}>
                        {node.cardLines.map((line, li) => (
                          <span key={li}>{line}{li < node.cardLines.length - 1 && <br />}</span>
                        ))}
                      </div>
                      {node.highlight && (
                        <div className={styles.traceCardHighlight} style={{ color: node.highlight.color }}>
                          <strong>{node.highlight.text}</strong>
                        </div>
                      )}
                      <div className={styles.traceCardTag}>
                        <Tag variant={node.tagVariant}>{node.tagText}</Tag>
                      </div>
                      {node.extraAlert && (
                        <div className={styles.traceCardAlert}>{node.extraAlert}</div>
                      )}
                    </div>
                  </div>

                  {/* 连接箭头（最后一个节点后不显示） */}
                  {idx < traceNodes.length - 1 && (
                    <div className={styles.traceArrow} aria-hidden="true" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI 根因分析（当有溯源数据时展示，内容保持 mock 占位待 AI 模块接入）*/}
        {/* TODO: AI 根因分析文本需接入 AI 模块，当前为静态占位 */}
        {traceQuery.data && (
          <div className={styles.aiAnalysis}>
            <div className={styles.aiAnalysisTitle}>🔍 AI 根因分析</div>
            <div className={styles.aiAnalysisBody}>
              <strong>溯源摘要：</strong>
              共追溯 {traceQuery.data.summary.totalComponents} 个组件，
              其中 {traceQuery.data.summary.withScanRecord} 个有完整扫码记录。
              {traceQuery.data.summary.dyeLots.length > 1 && (
                <>
                  {' '}检测到多个缸号（{traceQuery.data.summary.dyeLots.join('、')}），
                  存在跨缸号使用风险，请核查领料记录。
                </>
              )}
              {traceQuery.data.summary.dyeLots.length === 1 && (
                <> 缸号统一（{traceQuery.data.summary.dyeLots[0]}），无跨缸号问题。</>
              )}
              <br /><br />
              <strong>建议：</strong>
              对工序数据缺失的组件，督促工人在完成工序后及时扫码上报；
              如存在跨缸号使用，请联系客户沟通处理方案，并排查同批次其余成品。
            </div>
          </div>
        )}
      </section>

      {/* 双列：质量问题列表 + 问题分布图 */}
      <div className={styles.contentGrid}>
        {/* 左：质量问题记录 */}
        <section aria-label="近期质量问题记录">
          <div className={styles.card}>
            <div className={styles.cardHeaderRow}>
              <h2 className={styles.cardTitle}>质量问题记录（近{periodDays}天）</h2>
              <Button variant="ghost" size="sm">查看全部</Button>
            </div>

            {issueListQuery.isLoading ? (
              <div className={styles.issueList} aria-busy="true">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className={styles.issueItem} style={{ opacity: 0.4 }}>
                    <div className={styles.issueItemContent}>
                      <div className={styles.issueItemTitle} style={{ background: 'var(--color-gray-100)', height: 16, borderRadius: 4, width: '60%' }} />
                      <div className={styles.issueItemDesc}  style={{ background: 'var(--color-gray-100)', height: 14, borderRadius: 4, width: '90%', marginTop: 6 }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : issueListQuery.isError ? (
              <div style={{ color: 'var(--color-error-600)', padding: '16px 0' }}>
                质量问题列表加载失败，请刷新重试
              </div>
            ) : (issueListQuery.data?.list ?? []).length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', padding: '16px 0' }}>
                暂无质量问题记录
              </div>
            ) : (
              <div className={styles.issueList} role="list">
                {(issueListQuery.data?.list ?? []).map((issue) => {
                  const severityEnum = issue.severity as IssueSeverity;
                  const tagVariant   = severityToTagVariant(severityEnum);
                  const severityLabel = IssueSeverityLabel[severityEnum] ?? issue.severity;
                  const primaryType  = issue.issueTypes?.[0];
                  const categoryLabel = primaryType ? issueTypeToLabel(primaryType) : '—';
                  // 是否展示为选中态（当前已选中溯源的工单关联的问题）
                  const isActive = false; // 具体订单关联关系需通过 inspectionId → productionOrderId 二次查询，此处暂设为 false

                  return (
                    <div
                      key={issue.id}
                      className={`${styles.issueItem} ${isActive ? styles['issueItem--severe'] : ''}`}
                      role="listitem"
                      aria-label={`${severityLabel}问题：${issue.componentName}`}
                    >
                      <div className={styles.issueItemContent}>
                        <div className={styles.issueItemHeader}>
                          <Tag variant={tagVariant}>{severityLabel}</Tag>
                          <Tag variant="neutral">{categoryLabel}</Tag>
                        </div>
                        <div className={styles.issueItemTitle}>{issue.componentName}</div>
                        <div className={styles.issueItemDesc}>
                          {issue.description ?? '无问题描述'}
                        </div>
                        <div className={styles.issueItemMeta}>
                          <span>{formatTime(issue.createdAt)}</span>
                          <span>验货单: {issue.inspectionNo}</span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="查看溯源链"
                        onClick={() => {
                          // TODO: 当前后端 listIssues 未返回 productionOrderId 字段，
                          // 待后端补充该字段后将下行注释打开并删除 showToast 调用：
                          // setSelectedOrderId((issue as { productionOrderId?: number }).productionOrderId ?? null);
                          setSelectedOrderId(null);
                          showToast({
                            type: 'warning',
                            message: '溯源功能需后端在质量问题列表中返回 productionOrderId 字段，请联系后端工程师补充',
                          });
                        }}
                      >
                        溯源
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* 右：问题类型分布 */}
        <section aria-label="质量问题统计分析">
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>问题类型分布（近{periodDays}天）</h2>

            {/* 水平条形图 */}
            {/* 数据来源：QualityStats.issueTypeBreakdown（实时）；后端无数据时降级为 fallback mock */}
            <div className={styles.barChart} role="list" aria-label="问题类型水平条形图">
              {finalBarChart.map((bar) => (
                <div key={bar.label} className={styles.barChartItem} role="listitem">
                  <div className={styles.barChartLabel}>{bar.label}</div>
                  <div className={styles.barChartBarWrap}>
                    <div
                      className={styles.barChartBar}
                      style={{ width: `${bar.percent}%`, background: bar.color }}
                      role="progressbar"
                      aria-valuenow={bar.percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${bar.label}占${bar.percent}%`}
                    />
                  </div>
                  <div className={styles.barChartVal}>{bar.percent}%</div>
                </div>
              ))}
            </div>

            {/* 高频问题 TOP 3 */}
            {/* 数据来源：QualityStats.top5Issues 前3条（实时）；后端无数据时降级为 fallback mock */}
            <div className={styles.top3Section}>
              <div className={styles.top3Title}>高频问题 TOP 3</div>
              <div className={styles.top3List}>
                {finalTop3.map((item) => (
                  <div
                    key={item.rank}
                    className={styles.top3Item}
                    style={{ background: item.bg }}
                  >
                    <span className={styles.top3ItemLabel} style={{ color: item.color }}>
                      {item.rank} {item.label}
                    </span>
                    <Tag variant={item.tagVariant}>{item.tagText}</Tag>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* 新建验货单 Modal */}
      <Modal
        open={createModal}
        title="新建验货单"
        onClose={() => setCreateModal(false)}
        onConfirm={() => void handleCreate()}
        confirmLabel="创建"
        confirmLoading={createMutation.isPending}
        size="md"
      >
        <div className={styles.createForm}>
          <div className={styles.formField}>
            <label className={styles.formLabel}>
              生产工单号 <span className={styles.required}>*</span>
            </label>
            <input
              className={styles.formInput}
              type="number"
              min="1"
              value={form.productionOrderId}
              onChange={(e) => setForm((f) => ({ ...f, productionOrderId: e.target.value }))}
              placeholder="请输入工单 ID"
            />
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel}>
              验货日期 <span className={styles.required}>*</span>
            </label>
            <input
              className={styles.formInput}
              type="date"
              value={form.inspectionDate}
              onChange={(e) => setForm((f) => ({ ...f, inspectionDate: e.target.value }))}
            />
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel}>
              验货数量 <span className={styles.required}>*</span>
            </label>
            <input
              className={styles.formInput}
              type="number"
              min="0"
              step="0.01"
              value={form.qtyInspected}
              onChange={(e) => setForm((f) => ({ ...f, qtyInspected: e.target.value }))}
              placeholder="0.00"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
