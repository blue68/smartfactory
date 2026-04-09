/**
 * [artifact:前端代码] — AI 采购建议页
 *
 * Design source: docs/ui/web-purchase-suggestion.html
 * Features:
 *   - AI 状态面板（分析完成时间 / 下次分析 / 数据来源）
 *   - 分组 Filter Tabs（全部 / 待审批 / 已批准待执行 / 已执行 / 已驳回）
 *   - 建议卡片列表（4列信息格 / 缸号提示 / 推理折叠 / 操作栏）
 *   - 手动发起分析（AI Thinking Modal 含进度步骤 + 倒计时）
 *   - 驳回弹窗
 *   - AI 悬浮按钮
 */

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  useSuggestionList,
  useGenerateSuggestions,
  useApproveSuggestion,
  useFeedbackSuggestion,
} from '@/api/purchase';
import { Confidence, SuggestionStatus } from '@/types/enums';
import type { PurchaseSuggestion } from '@/types/models';
import Modal from '@/components/common/Modal';
import { formatCNY } from '@/utils/format';
import styles from './SuggestionPage.module.css';

// ─── Mock data (used when API returns empty / during dev) ─────────────────────
const MOCK_SUGGESTIONS: (PurchaseSuggestion & Record<string, unknown>)[] = [
  {
    id: 1,
    skuId: 101,
    skuCode: 'MAT-LEATHER-001',
    skuName: '进口牛皮 1.2mm 棕色',
    suggestedSupplierId: 10,
    supplierName: '广州皮革城',
    suggestedQty: '50',
    purchaseUnit: '平方米',
    estimatedPrice: '70',
    estimatedAmount: '3500',
    shortageQty: '28',
    reason: JSON.stringify([
      '订单B19（白色烤漆衣柜）皮料需求：60平方米（3/15交货），当前可用库存：55平方米（均来自不同缸号批次），严格匹配缸号后有效可用：32平方米，缺口：28平方米',
      '考虑5%生产损耗率，建议采购50平方米（安全缓冲5平方米）',
      '广州皮革城历史合格率：98%，交货周期：2-3天，准时率：89%',
      '当前DY-2025-088批次（5平方米）即将耗尽，避免混用，建议直接启用新缸号',
    ]),
    confidence: Confidence.HIGH,
    confidenceDetail: '基于订单需求、库存盘点及供应商历史数据综合评估',
    dyeLotRequirement: '订单B19已领用缸号 DY-2026-001，本次采购须向供应商指定相同批次（缸号一致），避免色差风险。如无法保证缸号，需与客户提前沟通。',
    status: SuggestionStatus.PENDING,
    createdAt: '2026-03-12T07:30:00Z',
    // Extra display fields (appended for mock UI)
    priority: 'urgent',
    arrivalDate: '3/12（今日需下单）',
    isUrgentDate: true,
  },
  {
    id: 2,
    skuId: 102,
    skuCode: 'MAT-WOOD-002',
    skuName: '红橡木板 200×2400',
    suggestedSupplierId: 11,
    supplierName: '华森木业',
    suggestedQty: '12',
    purchaseUnit: '张',
    estimatedPrice: '180',
    estimatedAmount: '2160',
    shortageQty: '12',
    reason: JSON.stringify([
      '订单A23需要8张（3/12交货），订单C31需要4张（3/18交货），合计12张',
      '当前库存8张，已被占用8张（订单A23），可用量：0张',
      '华森木业历史准时率：92%，交货周期：2-3天 → 需今日下单保障供应',
    ]),
    confidence: Confidence.HIGH,
    confidenceDetail: '库存可用量为零，需求紧迫，供应商历史数据良好',
    dyeLotRequirement: null,
    status: SuggestionStatus.PENDING,
    createdAt: '2026-03-12T07:30:00Z',
    priority: 'urgent',
    arrivalDate: '3/13（今日需下单）',
    isUrgentDate: true,
  },
  {
    id: 3,
    skuId: 103,
    skuCode: 'MAT-BOARD-003',
    skuName: '白色烤漆板 1220×2440',
    suggestedSupplierId: 12,
    supplierName: '广州板材',
    suggestedQty: '10',
    purchaseUnit: '张',
    estimatedPrice: '320',
    estimatedAmount: '3200',
    shortageQty: '10',
    reason: JSON.stringify([
      '订单D05（书柜）板材需求：10张（3/20交货），当前库存：0张',
      '广州板材历史供货稳定，交货周期：3-5天，准时率：85%',
      '建议3/16前到货以保障生产排程',
    ]),
    confidence: Confidence.MEDIUM,
    confidenceDetail: '基于历史采购频率和订单需求预测，置信度中等',
    dyeLotRequirement: null,
    status: SuggestionStatus.APPROVED,
    createdAt: '2026-03-10T09:15:00Z',
    priority: 'normal',
    arrivalDate: '3/16',
    isUrgentDate: false,
    approvedAt: '3/10 09:15',
  },
];

// ─── Tab config ───────────────────────────────────────────────────────────────
type TabValue = SuggestionStatus | '';

interface TabConfig {
  value: TabValue;
  label: string;
  count: number;
}

function buildTabs(suggestions: PurchaseSuggestion[]): TabConfig[] {
  const pending  = suggestions.filter(s => s.status === SuggestionStatus.PENDING).length;
  const approved = suggestions.filter(s => s.status === SuggestionStatus.APPROVED).length;
  const executed = suggestions.filter(s => s.status === SuggestionStatus.EXECUTED || s.status === SuggestionStatus.CONVERTED).length;
  const rejected = suggestions.filter(s => s.status === SuggestionStatus.REJECTED).length;

  return [
    { value: '',                          label: `全部（${suggestions.length}）`,      count: suggestions.length },
    { value: SuggestionStatus.PENDING,    label: `待审批（${pending}）`,               count: pending },
    { value: SuggestionStatus.APPROVED,   label: `已批准待执行（${approved}）`,        count: approved },
    { value: SuggestionStatus.EXECUTED,   label: `已执行（${executed}）`,              count: executed },
    { value: SuggestionStatus.REJECTED,   label: `已驳回（${rejected}）`,              count: rejected },
  ];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseReasonList(reason: string): string[] {
  try {
    const parsed = JSON.parse(reason);
    if (Array.isArray(parsed)) return parsed as string[];
  } catch {
    // not JSON — split by newline or return as single item
  }
  return reason.split('\n').filter(Boolean);
}

function getConfidenceTagClass(confidence: Confidence): string {
  if (confidence === Confidence.HIGH)   return styles.tag_confidence_high;
  if (confidence === Confidence.MEDIUM) return styles.tag_confidence_medium;
  return styles.tag_confidence_low;
}

function getConfidenceLabel(confidence: Confidence): string {
  if (confidence === Confidence.HIGH)   return '高置信度';
  if (confidence === Confidence.MEDIUM) return '中置信度';
  return '低置信度';
}

// ─── AI Thinking Steps ────────────────────────────────────────────────────────
const THINKING_STEPS = [
  '读取 12 个在产订单',
  '展开 BOM 计算物料需求',
  '匹配供应商库存与交期',
  '校验面料缸号匹配规则',
  '生成采购建议报告',
];

type StepState = 'done' | 'current' | 'pending';

// ─── Main Component ───────────────────────────────────────────────────────────
export default function SuggestionPage() {
  const { setPageTitle, showToast } = useAppStore();
  const [statusFilter, setStatusFilter] = useState<TabValue>('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [selectedSuggestion, setSelectedSuggestion] = useState<PurchaseSuggestion | null>(null);
  const [feedbackModal, setFeedbackModal] = useState<{ open: boolean; suggestion: PurchaseSuggestion | null }>({
    open: false,
    suggestion: null,
  });
  const [feedbackText, setFeedbackText] = useState('');
  const [rejectModal, setRejectModal] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [rejectReason, setRejectReason] = useState('');
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<number>(2); // 0-based index of current step
  const [countdown, setCountdown] = useState(12);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setPageTitle('AI 采购建议'); }, [setPageTitle]);

  const { data, isLoading, error } = useSuggestionList(
    statusFilter as SuggestionStatus || undefined, 1, 50,
  );
  const generateMutation = useGenerateSuggestions();
  const approveMutation  = useApproveSuggestion();
  const feedbackMutation = useFeedbackSuggestion();

  // 生产/部署环境仅使用真实接口数据；开发模式允许回退到 Mock 便于静态联调
  const allSuggestions: PurchaseSuggestion[] =
    data?.list && data.list.length > 0
      ? data.list
      : (import.meta.env.DEV ? MOCK_SUGGESTIONS : []);

  const filteredSuggestions = statusFilter === ''
    ? allSuggestions
    : allSuggestions.filter(s => {
        if (statusFilter === SuggestionStatus.EXECUTED) {
          return s.status === SuggestionStatus.EXECUTED || s.status === SuggestionStatus.CONVERTED;
        }
        return s.status === statusFilter;
      });

  const tabs = buildTabs(allSuggestions);

  // ── Thinking modal logic ──────────────────────────────────────────────────
  const showThinkingModal = () => {
    setCurrentStep(2);
    setCountdown(12);
    setThinkingOpen(true);

    let count = 12;
    let step  = 2;
    countdownRef.current = setInterval(() => {
      count -= 1;
      setCountdown(count);
      if (count % 3 === 0 && step < THINKING_STEPS.length - 1) {
        step += 1;
        setCurrentStep(step);
      }
      if (count <= 0) {
        clearInterval(countdownRef.current!);
        setThinkingOpen(false);
        void handleGenerate();
      }
    }, 1000);
  };

  const hideThinkingModal = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setThinkingOpen(false);
  };

  // ── API handlers ──────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    try {
      await generateMutation.mutateAsync(undefined);
      showToast({ type: 'success', message: '分析完成！已更新采购建议列表。' });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleApprove = async (id: number) => {
    try {
      await approveMutation.mutateAsync({ id, payload: { approved: true } });
      showToast({ type: 'success', message: '已批准采购建议' });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleReject = async () => {
    if (!rejectModal.id || !rejectReason.trim()) return;
    try {
      await approveMutation.mutateAsync({
        id: rejectModal.id,
        payload: { approved: false, rejectReason: rejectReason.trim() },
      });
      showToast({ type: 'info', message: '已驳回采购建议' });
      setRejectModal({ open: false, id: null });
      setRejectReason('');
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleFeedback = async () => {
    if (!feedbackModal.suggestion?.id || !feedbackText.trim()) return;
    try {
      await feedbackMutation.mutateAsync({
        id: feedbackModal.suggestion.id,
        payload: { feedback: feedbackText.trim() },
      });
      showToast({ type: 'success', message: '采购员反馈已记录' });
      setFeedbackModal({ open: false, suggestion: null });
      setFeedbackText('');
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Step state helper ─────────────────────────────────────────────────────
  const getStepState = (index: number): StepState => {
    if (index < currentStep)  return 'done';
    if (index === currentStep) return 'current';
    return 'pending';
  };

  // ── Priority / urgency ─────────────────────────────────────────────────────
  // Mock extended fields
  const getExtendedField = (s: PurchaseSuggestion, field: string) =>
    (s as unknown as Record<string, unknown>)[field];

  const isPriorityUrgent = (s: PurchaseSuggestion) =>
    getExtendedField(s, 'priority') === 'urgent';

  const getArrivalDate = (s: PurchaseSuggestion): string =>
    (getExtendedField(s, 'arrivalDate') as string | undefined) ?? '待定';

  const isUrgentDate = (s: PurchaseSuggestion): boolean =>
    (getExtendedField(s, 'isUrgentDate') as boolean | undefined) ?? false;

  const getApprovedAt = (s: PurchaseSuggestion): string | null =>
    (getExtendedField(s, 'approvedAt') as string | undefined) ?? null;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <div className={styles.page}>

        {/* ── Page Header ────────────────────────────────────────────────── */}
        <div className={styles.page_header}>
          <h1 className={styles.page_title}>AI 采购建议</h1>
          <button
            className={`${styles.btn} ${styles.btn_ai} ${styles.btn_md}`}
            onClick={showThinkingModal}
            aria-label="手动发起AI采购需求分析"
          >
            <span aria-hidden="true">✨</span>
            手动发起采购需求分析
          </button>
        </div>

        {/* ── AI Status Panel ─────────────────────────────────────────────── */}
        <div className={styles.ai_status_panel} role="region" aria-label="AI分析状态">
          <div className={styles.ai_status_panel__icon} aria-hidden="true">🤖</div>
          <div className={styles.ai_status_panel__content}>
            <div className={styles.ai_status_panel__title}>AI 分析已完成</div>
            <div className={styles.ai_status_panel__meta}>
              上次分析时间：今日 07:30 · 下次自动分析：明日 07:00 · 分析基于：12个在产订单 + 当前库存 + 8家供应商历史数据
            </div>
          </div>
          <div className={styles.ai_status_panel__right}>
            <span className={`${styles.tag} ${styles.tag_success}`}>✓ 分析完成</span>
            <span className={styles.ai_status_panel__count}>
              共生成 {allSuggestions.length} 条建议
            </span>
          </div>
        </div>

        {/* ── Filter Tabs ──────────────────────────────────────────────────── */}
        <div className={styles.filter_tabs_wrap}>
          <div className={styles.filter_tabs} role="tablist" aria-label="按审批状态筛选">
            {tabs.map((tab) => (
              <button
                key={tab.value}
                role="tab"
                aria-selected={statusFilter === tab.value}
                aria-controls="suggestion-list"
                className={`${styles.filter_tab} ${statusFilter === tab.value ? styles.filter_tab_active : ''}`}
                onClick={() => setStatusFilter(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Suggestion List ──────────────────────────────────────────────── */}
        {isLoading ? (
          <div className={styles.loading_list}>
            {[1, 2, 3].map(i => <div key={i} className={styles.card_skeleton} />)}
          </div>
        ) : error ? (
          <div style={{ padding: '1rem', color: '#DC2626', fontSize: '0.875rem' }}>
            加载失败：{(error as Error).message}
          </div>
        ) : (
          <div
            className={styles.suggestion_list}
            id="suggestion-list"
            role="region"
            aria-label="采购建议列表"
          >
            {filteredSuggestions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: '#64748B', fontSize: '0.875rem' }}>
                暂无{statusFilter ? '' : '采购建议'}数据
              </div>
            ) : (
              filteredSuggestions.map((s) => {
                const expanded     = expandedIds.has(s.id);
                const isPending    = s.status === SuggestionStatus.PENDING;
                const isApproved   = s.status === SuggestionStatus.APPROVED;
                const reasonLines  = parseReasonList(s.reason);
                const urgent       = isPriorityUrgent(s);
                const arrivalDate  = getArrivalDate(s);
                const urgentDate   = isUrgentDate(s);
                const approvedAt   = getApprovedAt(s);

                return (
                  <article
                    key={s.id}
                    className={`${styles.suggestion_card} ${isApproved ? styles.suggestion_card_approved : ''}`}
                    aria-label={`采购建议：${s.skuName}`}
                  >
                    {/* Card Header */}
                    <div className={styles.card_header}>
                      <div className={styles.card_title_area}>
                        <div className={styles.card_name}>{s.skuName}</div>
                        <div className={styles.card_tags}>
                          {urgent && (
                            <span className={`${styles.tag} ${styles.tag_priority_urgent}`}>紧急</span>
                          )}
                          {!urgent && (
                            <span className={`${styles.tag} ${styles.tag_neutral}`}>正常</span>
                          )}
                          <span className={`${styles.tag} ${getConfidenceTagClass(s.confidence)}`}>
                            ● {getConfidenceLabel(s.confidence)}
                          </span>
                          {s.dyeLotRequirement && (
                            <span className={`${styles.tag} ${styles.tag_dye_lot}`}>
                              🎨 面料·含缸号要求
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Card Body */}
                    <div className={styles.card_body}>

                      {/* Info Grid */}
                      <div className={styles.info_grid}>
                        <div className={styles.kv}>
                          <div className={styles.kv_key}>建议采购数量</div>
                          <div className={styles.kv_val}>
                            {s.suggestedQty}{' '}
                            <span className={styles.kv_unit}>{s.purchaseUnit}</span>
                          </div>
                        </div>
                        <div className={styles.kv}>
                          <div className={styles.kv_key}>推荐供应商</div>
                          <div className={`${styles.kv_val} ${styles.kv_val_supplier}`}>
                            {s.supplierName}
                          </div>
                        </div>
                        <div className={styles.kv}>
                          <div className={styles.kv_key}>预估金额</div>
                          <div className={`${styles.kv_val} ${styles.kv_val_money}`}>
                            {formatCNY(s.estimatedAmount)}
                          </div>
                        </div>
                        <div className={styles.kv}>
                          <div className={styles.kv_key}>建议到货日期</div>
                          <div className={`${styles.kv_val} ${urgentDate ? styles.kv_val_urgent : styles.kv_val_normal}`}>
                            {arrivalDate}
                          </div>
                        </div>
                      </div>

                      {/* Dye Lot Notice */}
                      {s.dyeLotRequirement && (
                        <div className={styles.dye_lot_notice} role="note" aria-label="缸号要求说明">
                          <span className={styles.dye_lot_notice__icon} aria-hidden="true">🎨</span>
                          <div className={styles.dye_lot_notice__text}>
                            <strong>缸号要求：</strong>
                            {s.dyeLotRequirement.split(/(DY-[\w-]+)/g).map((part, i) =>
                              /^DY-/.test(part) ? (
                                <code key={i} className={styles.dye_lot_notice__code}>{part}</code>
                              ) : (
                                <span key={i}>{part}</span>
                              )
                            )}
                          </div>
                        </div>
                      )}

                      {/* Approved notice */}
                      {isApproved && approvedAt && (
                        <div className={styles.approved_notice}>
                          ✓ 老板已批准（{approvedAt}）· 采购员请联系{s.supplierName}下单
                        </div>
                      )}

                      {/* Reason Accordion */}
                      <div className={styles.reason_accordion}>
                        <button
                          className={`${styles.reason_trigger} ${expanded ? styles.reason_trigger_expanded : ''}`}
                          aria-expanded={expanded}
                          aria-controls={`reason-${s.id}`}
                          onClick={() => toggleExpand(s.id)}
                        >
                          <span>▼ AI 推理依据（点击展开）</span>
                          <span
                            className={`${styles.reason_arrow} ${expanded ? styles.reason_arrow_expanded : ''}`}
                            aria-hidden="true"
                          >
                            ▼
                          </span>
                        </button>
                        <div
                          id={`reason-${s.id}`}
                          className={`${styles.reason_content} ${expanded ? styles.reason_content_visible : ''}`}
                          role="region"
                        >
                          <ul className={styles.reason_list}>
                            {reasonLines.map((line, i) => (
                              <li key={i} className={styles.reason_list_item}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>

                    {/* Actions Bar */}
                    <div className={styles.card_actions}>
                      <div className={styles.card_status}>
                        {isPending && (
                          <span className={`${styles.tag} ${styles.tag_warning}`}>● 待老板审批</span>
                        )}
                        {isApproved && (
                          <span className={`${styles.tag} ${styles.tag_success}`}>✓ 已批准</span>
                        )}
                        {s.status === SuggestionStatus.REJECTED && (
                          <span className={`${styles.tag} ${styles.tag_error}`}>✕ 已驳回</span>
                        )}
                        {(s.status === SuggestionStatus.EXECUTED || s.status === SuggestionStatus.CONVERTED) && (
                          <span className={`${styles.tag} ${styles.tag_info}`}>✓ 已执行</span>
                        )}
                      </div>
                      <div className={styles.card_btns}>
                        {isPending && (
                          <>
                            <button
                              className={`${styles.btn} ${styles.btn_ghost} ${styles.btn_sm}`}
                              type="button"
                              onClick={() => {
                                setFeedbackModal({ open: true, suggestion: s });
                                setFeedbackText('');
                              }}
                            >
                              采购员反馈问题
                            </button>
                            <button
                              className={`${styles.btn} ${styles.btn_success} ${styles.btn_md}`}
                              aria-label={`批准${s.skuName}采购建议，金额${formatCNY(s.estimatedAmount)}`}
                              disabled={approveMutation.isPending}
                              onClick={() => void handleApprove(s.id)}
                            >
                              ✓ 批准
                            </button>
                            <button
                              className={`${styles.btn} ${styles.btn_danger} ${styles.btn_sm}`}
                              aria-label={`驳回${s.skuName}采购建议`}
                              onClick={() => setRejectModal({ open: true, id: s.id })}
                            >
                              ✕ 驳回
                            </button>
                          </>
                        )}
                        {isApproved && (
                          <>
                            <button
                              className={`${styles.btn} ${styles.btn_ghost} ${styles.btn_sm}`}
                              type="button"
                              onClick={() => setSelectedSuggestion(s)}
                            >
                              查看详情
                            </button>
                            <button
                              className={`${styles.btn} ${styles.btn_primary} ${styles.btn_md}`}
                              type="button"
                            >
                              标记已下单
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ── AI Thinking Modal ──────────────────────────────────────────────── */}
      {thinkingOpen && (
        <div
          className={styles.modal_overlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="thinking-modal-title"
          aria-live="polite"
          onClick={(e) => { if (e.target === e.currentTarget) hideThinkingModal(); }}
        >
          <div className={styles.thinking_modal}>
            <div className={styles.modal_icon} aria-hidden="true">🤖</div>
            <h2 className={styles.modal_title} id="thinking-modal-title">
              AI 正在分析采购需求...
            </h2>
            <p className={styles.modal_subtitle}>
              请稍候，AI 正在为您计算物料缺口并匹配最优供应方案
            </p>

            <div className={styles.modal_steps} role="list" aria-label="AI分析步骤">
              {THINKING_STEPS.map((step, index) => {
                const state = getStepState(index);
                return (
                  <div key={index} className={styles.step_item} role="listitem">
                    <div
                      className={`${styles.step_icon} ${
                        state === 'done'    ? styles.step_icon_done :
                        state === 'current' ? styles.step_icon_current :
                                             styles.step_icon_pending
                      }`}
                      aria-label={state === 'done' ? '已完成' : state === 'current' ? '进行中' : '待处理'}
                    >
                      {state === 'done' ? '✓' : state === 'current' ? '⟳' : '○'}
                    </div>
                    <span
                      className={`${styles.step_text} ${
                        state === 'done'    ? styles.step_text_done :
                        state === 'current' ? styles.step_text_current :
                                             styles.step_text_pending
                      }`}
                    >
                      {step}
                      {state === 'current' && (
                        <span className={styles.step_spinner} aria-hidden="true" />
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className={styles.modal_countdown}>
              预计还需 <strong>{countdown}</strong> 秒
            </div>

            <div className={styles.modal_footer}>
              <button
                className={`${styles.btn} ${styles.btn_ghost} ${styles.btn_md}`}
                onClick={hideThinkingModal}
                aria-label="取消AI分析"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={selectedSuggestion !== null}
        title="采购建议详情"
        onClose={() => setSelectedSuggestion(null)}
        hideFooter
        size="lg"
      >
        {selectedSuggestion && (
          <div className={styles.detail_panel}>
            <div className={styles.detail_summary}>
              <div>
                <div className={styles.detail_title}>{selectedSuggestion.skuName}</div>
                <div className={styles.detail_subtitle}>
                  {selectedSuggestion.skuCode} · {selectedSuggestion.supplierName || '待匹配供应商'}
                </div>
              </div>
              <span className={`${styles.tag} ${getConfidenceTagClass(selectedSuggestion.confidence)}`}>
                {getConfidenceLabel(selectedSuggestion.confidence)}
              </span>
            </div>

            <div className={styles.detail_grid}>
              <div className={styles.detail_item}>
                <span>建议数量</span>
                <strong>{selectedSuggestion.suggestedQty} {selectedSuggestion.purchaseUnit}</strong>
              </div>
              <div className={styles.detail_item}>
                <span>缺口数量</span>
                <strong>{selectedSuggestion.shortageQty} {selectedSuggestion.purchaseUnit}</strong>
              </div>
              <div className={styles.detail_item}>
                <span>预估金额</span>
                <strong>{formatCNY(selectedSuggestion.estimatedAmount)}</strong>
              </div>
              <div className={styles.detail_item}>
                <span>建议到货</span>
                <strong>{getArrivalDate(selectedSuggestion)}</strong>
              </div>
              <div className={styles.detail_item}>
                <span>状态</span>
                <strong>{selectedSuggestion.status}</strong>
              </div>
              <div className={styles.detail_item}>
                <span>生成时间</span>
                <strong>{selectedSuggestion.createdAt.slice(0, 16).replace('T', ' ')}</strong>
              </div>
            </div>

            {selectedSuggestion.dyeLotRequirement && (
              <div className={styles.detail_block}>
                <div className={styles.detail_block_title}>缸号要求</div>
                <p>{selectedSuggestion.dyeLotRequirement}</p>
              </div>
            )}

            <div className={styles.detail_block}>
              <div className={styles.detail_block_title}>AI 推理依据</div>
              <ul className={styles.detail_reason_list}>
                {parseReasonList(selectedSuggestion.reason).map((line, index) => (
                  <li key={`${selectedSuggestion.id}-${index}`}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={feedbackModal.open}
        title="采购员反馈问题"
        onClose={() => {
          setFeedbackModal({ open: false, suggestion: null });
          setFeedbackText('');
        }}
        onConfirm={() => void handleFeedback()}
        confirmLabel="提交反馈"
        confirmLoading={feedbackMutation.isPending}
        size="sm"
      >
        <div className={styles.reject_form}>
          <p className={styles.feedback_hint}>
            该反馈会保存在当前采购建议上，供审批人与采购员后续继续跟进。
          </p>
          <label htmlFor="feedback-text" className={styles.reject_label}>
            问题说明 <span style={{ color: '#EF4444' }}>*</span>
          </label>
          <textarea
            id="feedback-text"
            className={styles.reject_textarea}
            rows={4}
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder="例如：供应商交期无法满足、当前建议数量偏低、需先确认缸号..."
          />
        </div>
      </Modal>

      {/* ── Reject Modal ──────────────────────────────────────────────────── */}
      <Modal
        open={rejectModal.open}
        title="驳回采购建议"
        onClose={() => setRejectModal({ open: false, id: null })}
        onConfirm={() => void handleReject()}
        confirmLabel="确认驳回"
        confirmVariant="danger"
        confirmLoading={approveMutation.isPending}
        size="sm"
      >
        <div className={styles.reject_form}>
          <label htmlFor="reject-reason" className={styles.reject_label}>
            驳回原因 <span style={{ color: '#EF4444' }}>*</span>
          </label>
          <textarea
            id="reject-reason"
            className={styles.reject_textarea}
            rows={4}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="请说明驳回原因..."
          />
        </div>
      </Modal>

      {/* ── AI Float Button ───────────────────────────────────────────────── */}
      <button
        className={styles.ai_float_btn}
        aria-label="打开AI助手"
      >
        🤖
      </button>
    </>
  );
}
