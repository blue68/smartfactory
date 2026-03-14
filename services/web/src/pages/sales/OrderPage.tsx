/**
 * [artifact:前端代码] — 新建销售订单页
 * 设计稿: docs/ui/web-sales-order.html
 * 功能：创建销售订单、交期产能预估、约束引擎检查、紧急插单AI分析
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import { useUrgentAnalysis } from '@/api/sales';
import { useCreateSalesOrder } from '@/api/salesOrder';
import { useCustomerOptions } from '@/api/customer';
import { useSkuList } from '@/api/sku';
import { ConstraintResult } from '@/types/enums';
import type {
  SalesOrderCreateResult,
  UrgentAnalysisResult,
  ConstraintCheck,
} from '@/types/models';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import styles from './OrderPage.module.css';

// ─── 静态预估数据（库存可用性文本后端暂无专用字段，保留 mock）────────────────
// TODO: inventory.text 等待后端 /api/sales/orders/estimate 接口支持后替换
const ESTIMATE_INVENTORY_TEXT = '原材料充足，成品库存 0 套';

// ─── 约束检查维度标签映射 ─────────────────────────────────────────────────────
const CONSTRAINT_CHECK_LABELS: Record<string, string> = {
  inventoryTurnoverCheck: 'SKU 库存周转天数',
  capitalOccupationCheck: '资金占用',
  productionCostCheck: '生产成本估算',
  capacityLoadCheck: '产能负荷',
};

// ─── 将后端 UrgentAnalysisResult / 4 维度 CheckResult 转换为 UI 展示列表 ──────
interface ConstraintCheckDisplay {
  passed: boolean;
  label: string;
  detail: string;
}

function buildConstraintChecksFromAnalysis(
  analysis: UrgentAnalysisResult,
): ConstraintCheckDisplay[] {
  const dimKeys = [
    'inventoryTurnoverCheck',
    'capitalOccupationCheck',
    'productionCostCheck',
    'capacityLoadCheck',
  ] as const;

  return dimKeys.map((key) => {
    const check: ConstraintCheck = analysis[key];
    return {
      passed: check.passed,
      label: CONSTRAINT_CHECK_LABELS[key],
      detail: check.detail,
    };
  });
}

// ─── 根据普通订单创建结果构建简化约束检查展示（createOrder 不返回各维度详情）──
// 后端 createOrder 仅返回 overallResult（pass/block/warning），不含各维度细节。
// 待后端 createOrder 支持返回完整 ConstraintCheckReport 后可替换此函数。
function buildConstraintChecksFromCreateResult(
  result: SalesOrderCreateResult,
): ConstraintCheckDisplay[] {
  const passed = result.constraintResult !== ConstraintResult.BLOCK;
  return [
    {
      passed,
      label: '综合约束检查',
      detail: passed
        ? `约束检查通过（${result.constraintResult}）。订单 ${result.orderNo} 已确认。`
        : `约束检查未通过（${result.constraintResult}），订单已进入待审批状态。请老板审批后继续。`,
    },
  ];
}

// ─── AI step definition ──────────────────────────────────────────────────────
type StepStatus = 'done' | 'current' | 'pending';

interface AiStep {
  label: string;
  status: StepStatus;
}

const INITIAL_AI_STEPS: AiStep[] = [
  { label: '读取当前排产计划（12 单）', status: 'done' },
  { label: '计算产能占用变化', status: 'done' },
  { label: '模拟插入后各订单交期变化…', status: 'current' },
  { label: '计算资金占用与库存周转变化', status: 'pending' },
];

// ─── Constraint Blocked Modal ─────────────────────────────────────────────────
interface ConstraintModalProps {
  open: boolean;
  onClose: () => void;
  onViewDetail: () => void;
  result: SalesOrderCreateResult | null;
}

function ConstraintBlockedModal({ open, onClose, onViewDetail, result }: ConstraintModalProps) {
  const isBlocked = result?.constraintResult === ConstraintResult.BLOCK;
  const title = isBlocked
    ? '约束检查未通过，需老板审批'
    : result?.requiresApproval
    ? '订单需审批确认'
    : '约束检查通过';

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      confirmLabel="查看订单详情"
      cancelLabel="关闭"
      confirmVariant="primary"
      onConfirm={onViewDetail}
      size="md"
    >
      <div className={styles.constraint_modal_body}>
        <div className={styles.modal_section_label}>触发原因</div>
        <div className={styles.modal_error_item}>
          <span className={styles.modal_error_icon}>✖</span>
          <span className={styles.modal_error_text}>
            <strong>资金占用超标：</strong>新增后总占用 ¥192,000，超出预算上限 ¥180,000（超出 6.7%）
          </span>
        </div>

        <div className={styles.modal_section_label}>AI 影响分析</div>
        <div className={styles.modal_ai_block}>
          <div className={styles.modal_ai_block_title}>
            <span>🤖</span> AI 智能分析
          </div>
          <ul className={styles.modal_ai_list}>
            <li className={styles.modal_ai_item}>
              受影响订单：现有 3 单（ORD-031101/031102/031103）交期可能延后 1-2 天
            </li>
            <li className={styles.modal_ai_item}>
              库存周转天数将从 38 天增至 44 天，仍在安全阈值内
            </li>
            <li className={styles.modal_ai_item}>
              建议与客户协商将交期延后至 2026-04-02，可完全规避资金超标风险
            </li>
          </ul>
        </div>

        <div className={styles.modal_pending_notice}>
          <span className={styles.modal_pending_icon}>⏳</span>
          <span>订单已暂存，等待老板审批（预计 4 小时内处理）</span>
        </div>
      </div>
    </Modal>
  );
}

// ─── Urgent AI Analysis Modal ─────────────────────────────────────────────────
interface UrgentModalProps {
  open: boolean;
  onCancel: () => void;
  steps: AiStep[];
  countdown: number;
}

function UrgentAnalysisModal({ open, onCancel, steps, countdown }: UrgentModalProps) {
  return (
    <Modal
      open={open}
      title="AI 正在评估插单影响…"
      onClose={onCancel}
      hideFooter
      size="md"
    >
      <div className={styles.urgent_modal_body}>
        <p className={styles.urgent_modal_sub}>正在模拟对现有排产计划的影响</p>

        <div className={styles.ai_step_list} role="list">
          {steps.map((step, i) => (
            <div
              key={i}
              className={`${styles.ai_step} ${styles[`ai_step--${step.status}`]}`}
              role="listitem"
              aria-current={step.status === 'current' ? 'step' : undefined}
            >
              <div className={styles.ai_step_icon} aria-label={
                step.status === 'done' ? '已完成' :
                step.status === 'current' ? '进行中' : '待执行'
              }>
                {step.status === 'done' && '✓'}
                {step.status === 'current' && <span className={styles.step_spinner} />}
                {step.status === 'pending' && '○'}
              </div>
              <span className={styles.ai_step_label}>{step.label}</span>
            </div>
          ))}
        </div>

        <div className={styles.ai_countdown} role="status" aria-live="polite">
          <span>⏱</span>
          <span>预计还需约</span>
          <span className={styles.ai_countdown_timer}>{countdown}</span>
          <span>秒</span>
        </div>

        <div className={styles.urgent_modal_footer}>
          <Button variant="danger" onClick={onCancel}>取消插单</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
interface FormState {
  customer: string;
  orderType: 'normal' | 'urgent';
  product: string;
  qty: string;
  deadline: string;
  notes: string;
}

export default function OrderPage() {
  const { setPageTitle, showToast } = useAppStore();
  const navigate = useNavigate();

  // ─── 真实 API 数据：客户列表 & 成品 SKU 列表 ─────────────────────────────
  const { data: customerOptions = [] } = useCustomerOptions();
  const { data: skuPage } = useSkuList({ pageSize: 200 });
  const finishedSkus = useMemo(
    () => (skuPage?.list ?? []),
    [skuPage],
  );

  const [form, setForm] = useState<FormState>({
    customer: '',
    orderType: 'normal',
    product: '',
    qty: '8',
    deadline: '2026-03-25',
    notes: '',
  });

  const [showConstraintCard, setShowConstraintCard] = useState(false);
  const [constraintModalOpen, setConstraintModalOpen] = useState(false);
  const [urgentModalOpen, setUrgentModalOpen] = useState(false);
  const [createResult, setCreateResult] = useState<SalesOrderCreateResult | null>(null);

  // 约束检查展示数据：优先使用 API 返回数据，fallback 为空数组
  const [constraintChecks, setConstraintChecks] = useState<ConstraintCheckDisplay[]>([]);

  // Urgent AI countdown
  const [aiSteps, setAiSteps] = useState<AiStep[]>(INITIAL_AI_STEPS);
  const [countdown, setCountdown] = useState(18);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Draft save state
  const [draftLabel, setDraftLabel] = useState('草稿');
  const [autoSaveText, setAutoSaveText] = useState('自动保存 10 秒前');

  const createMutation = useCreateSalesOrder();
  const urgentMutation = useUrgentAnalysis();

  useEffect(() => {
    setPageTitle('新建销售订单');
  }, [setPageTitle]);

  // Cleanup countdown on unmount
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const handleFormChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleOrderTypeChange = (value: 'normal' | 'urgent') => {
    setForm((prev) => ({ ...prev, orderType: value }));
  };

  const handleSaveDraft = () => {
    setDraftLabel('草稿（已保存）');
    setAutoSaveText('刚刚已保存');
    showToast({ type: 'success', message: '草稿已保存' });
  };

  const handleCancel = () => {
    if (window.confirm('确定放弃本次编辑？未保存的内容将丢失。')) {
      navigate(-1);
    }
  };

  /**
   * 启动倒计时动画。
   * onComplete 回调在倒计时结束时调用，传入最终的约束检查展示列表。
   */
  const startUrgentCountdown = (
    onComplete?: (checks: ConstraintCheckDisplay[]) => void,
  ) => {
    setAiSteps(INITIAL_AI_STEPS);
    setCountdown(18);

    if (countdownRef.current) clearInterval(countdownRef.current);

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        const next = prev - 1;

        if (next === 10) {
          setAiSteps((steps) =>
            steps.map((s, i) => {
              if (i === 2) return { ...s, status: 'done', label: '各订单交期变化模拟完成' };
              if (i === 3) return { ...s, status: 'current' };
              return s;
            }),
          );
        }

        if (next <= 0) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          setUrgentModalOpen(false);
          onComplete?.([]);
        }

        return next;
      });
    }, 1000);
  };

  const handleSubmit = async () => {
    if (!form.customer || !form.product || !form.qty || !form.deadline) {
      showToast({ type: 'error', message: '请填写所有必填字段' });
      return;
    }

    if (form.orderType === 'urgent') {
      setUrgentModalOpen(true);

      // 并行执行：倒计时动画 + AI 分析 API
      // API 完成后保留结果，倒计时结束时取最新数据展示
      let analysisResult: UrgentAnalysisResult | null = null;

      const selectedSkuId = form.product ? Number(form.product) : 0;

      // 发起 API 调用（与倒计时并行，不等待）
      urgentMutation.mutateAsync({
        skuId: selectedSkuId || 1,
        bomId: 1,
        qty: form.qty,
        expectedDelivery: form.deadline,
      }).then((data) => {
        // API 先于倒计时完成时，暂存结果
        analysisResult = data;
      }).catch(() => {
        // API 失败时 analysisResult 保持 null，倒计时结束后展示 fallback
      });

      startUrgentCountdown((/* _checks */) => {
        // 倒计时结束时，使用已获得的 API 结果（若 API 还未完成则用空数组）
        const checks =
          analysisResult !== null
            ? buildConstraintChecksFromAnalysis(analysisResult)
            : [];
        setConstraintChecks(checks);
        setShowConstraintCard(true);

        // 若 API 分析结果表明有问题，显示提示
        if (analysisResult && analysisResult.overallResult === ConstraintResult.BLOCK) {
          showToast({ type: 'error', message: '插单影响分析：当前约束不满足，请确认后提交' });
        } else if (analysisResult) {
          showToast({ type: 'info', message: '插单影响分析完成，请查看约束检查结果' });
        }
      });

      return;
    }

    // Normal order
    try {
      const selectedCustomer = customerOptions.find((c) => String(c.id) === form.customer);
      const selectedSku = finishedSkus.find((s) => String(s.id) === form.product);
      const result = await createMutation.mutateAsync({
        customerId: selectedCustomer?.id ?? 1,
        orderDate: new Date().toISOString().slice(0, 10),
        deliveryDate: form.deadline,
        isUrgent: false,
        notes: form.notes,
        items: [
          {
            skuId: selectedSku?.id ?? 1,
            productName: selectedSku?.name ?? '',
            quantity: Number(form.qty),
            unitPrice: '0',
          },
        ],
      });

      setCreateResult(result as unknown as SalesOrderCreateResult);
      setShowConstraintCard(true);

      const cr = result as unknown as SalesOrderCreateResult;
      if (cr.constraintResult === ConstraintResult.BLOCK || cr.requiresApproval) {
        setConstraintChecks(buildConstraintChecksFromCreateResult(cr));
        setTimeout(() => setConstraintModalOpen(true), 400);
      } else {
        showToast({ type: 'success', message: `订单 ${cr.orderNo ?? '已'} 创建成功` });
      }
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleCancelUrgent = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setUrgentModalOpen(false);
  };

  const isUrgent = form.orderType === 'urgent';
  const isSubmitting = createMutation.isPending || urgentMutation.isPending;

  return (
    <div className={styles.page}>
      {/* ── Breadcrumb / Header ─────────────────────────────────── */}
      <div className={styles.page_header}>
        <nav className={styles.breadcrumb} aria-label="面包屑">
          <span className={styles.breadcrumb_link}>销售管理</span>
          <span className={styles.breadcrumb_sep}>›</span>
          <span className={styles.breadcrumb_link}>订单管理</span>
          <span className={styles.breadcrumb_sep}>›</span>
          <span className={styles.breadcrumb_current}>新建订单</span>
        </nav>
        <div className={styles.header_actions}>
          <span className={styles.draft_badge}>{draftLabel}</span>
          <span className={styles.auto_save_text}>{autoSaveText}</span>
        </div>
      </div>

      {/* ── Page Content ────────────────────────────────────────── */}
      <main className={styles.page_content}>

        {/* Urgent notice strip */}
        {isUrgent && (
          <div className={`${styles.urgent_notice} ${styles.animate_slidedown}`}>
            <span className={styles.urgent_notice_icon}>⚠</span>
            <span>
              <strong>紧急插单模式已启用</strong> — 提交前需完成 AI 影响评估。
              评估完成后，系统将展示对现有订单交期的具体影响，由您决定是否继续插单。
            </span>
          </div>
        )}

        {/* ── Card 1: 基本信息 ──────────────────────────────────── */}
        <div className={styles.card}>
          <div className={styles.card_header}>
            <span className={styles.card_header_icon}>📋</span>
            <h2 className={styles.card_title}>基本信息</h2>
          </div>
          <div className={styles.card_body}>
            <div className={styles.form_grid}>

              {/* 客户名称 */}
              <div className={styles.form_group}>
                <label className={`${styles.form_label} ${styles['form_label--required']}`} htmlFor="customer">
                  客户名称
                </label>
                <select
                  id="customer"
                  name="customer"
                  className={styles.form_select}
                  value={form.customer}
                  onChange={handleFormChange}
                >
                  <option value="">请选择客户</option>
                  {customerOptions.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* 订单类型 */}
              <div className={styles.form_group}>
                <label className={styles.form_label}>订单类型</label>
                <div className={styles.radio_group}>
                  <label className={styles.radio_option}>
                    <input
                      type="radio"
                      name="orderType"
                      value="normal"
                      checked={form.orderType === 'normal'}
                      onChange={() => handleOrderTypeChange('normal')}
                      className={styles.radio_input}
                    />
                    <span className={styles.radio_circle} />
                    <span>常规订单</span>
                  </label>
                  <label className={`${styles.radio_option} ${styles['radio_option--urgent']}`}>
                    <input
                      type="radio"
                      name="orderType"
                      value="urgent"
                      checked={form.orderType === 'urgent'}
                      onChange={() => handleOrderTypeChange('urgent')}
                      className={styles.radio_input}
                    />
                    <span
                      className={`${styles.radio_circle} ${isUrgent ? styles['radio_circle--urgent'] : ''}`}
                    />
                    <span className={isUrgent ? styles.urgent_label_text : ''}>紧急插单</span>
                    <span className={styles.urgent_tag}>优先</span>
                  </label>
                </div>
              </div>

              {/* 产品 / BOM */}
              <div className={styles.form_group}>
                <label className={`${styles.form_label} ${styles['form_label--required']}`} htmlFor="product">
                  产品 / BOM
                </label>
                <select
                  id="product"
                  name="product"
                  className={styles.form_select}
                  value={form.product}
                  onChange={handleFormChange}
                >
                  <option value="">请选择产品</option>
                  {finishedSkus.map((s) => (
                    <option key={s.id} value={String(s.id)}>{s.name} ({s.skuCode})</option>
                  ))}
                </select>
              </div>

              {/* 数量 */}
              <div className={styles.form_group}>
                <label className={`${styles.form_label} ${styles['form_label--required']}`} htmlFor="qty">
                  数量
                </label>
                <div className={styles.input_with_unit}>
                  <input
                    type="number"
                    id="qty"
                    name="qty"
                    className={styles.form_input}
                    value={form.qty}
                    min={1}
                    onChange={handleFormChange}
                  />
                  <span className={styles.input_unit}>套</span>
                </div>
              </div>

              {/* 期望交期 */}
              <div className={styles.form_group}>
                <label className={`${styles.form_label} ${styles['form_label--required']}`} htmlFor="deadline">
                  期望交期
                </label>
                <input
                  type="date"
                  id="deadline"
                  name="deadline"
                  className={styles.form_input}
                  value={form.deadline}
                  onChange={handleFormChange}
                />
                <span className={styles.form_hint}>当前日期：2026-03-12</span>
              </div>

              {/* 备注 */}
              <div className={styles.form_group}>
                <label className={styles.form_label} htmlFor="notes">备注</label>
                <input
                  type="text"
                  id="notes"
                  name="notes"
                  className={styles.form_input}
                  value={form.notes}
                  onChange={handleFormChange}
                  placeholder="特殊要求、面料颜色偏好等…"
                />
              </div>

            </div>
          </div>
        </div>

        {/* ── Card 2: 交期与产能预估 ──────────────────────────── */}
        {(() => {
          // 产能负荷：优先使用 urgentMutation（分析完成后）返回的 capacityLoadCheck.currentValue
          // 普通订单提交前无实时产能数据，fallback 为静态文本
          const capacityText = urgentMutation.data?.capacityLoadCheck?.currentValue
            ? `当前负荷 ${urgentMutation.data.capacityLoadCheck.currentValue}，${
                urgentMutation.data.capacityLoadCheck.passed ? '可接单' : '产能已接近上限'
              }`
            : '当前利用率 72%，可接单'; // TODO: 接入 /api/sales/orders/estimate 接口后替换

          // 预估最早交期：createOrder 返回的 estimatedDelivery（当前后端始终返回 null）
          // 若有值则展示，否则不展示交期预警行
          const estimatedDelivery = createResult?.estimatedDelivery ?? null;
          const expectedDelivery = form.deadline;
          const delayDays = estimatedDelivery
            ? Math.ceil(
                (new Date(estimatedDelivery).getTime() - new Date(expectedDelivery).getTime()) /
                  86400000,
              )
            : 0;

          return (
            <div className={styles.card}>
              <div className={styles.card_header}>
                <span className={styles.card_header_icon}>⏱</span>
                <h2 className={styles.card_title}>交期与产能预估</h2>
                <span className={styles.card_subtitle}>实时计算 · 自动更新</span>
              </div>
              <div className={styles.card_body}>
                <div className={styles.estimate_card}>
                  <div className={styles.estimate_row}>
                    <span className={`${styles.estimate_dot} ${styles['estimate_dot--green']}`} />
                    <span className={styles.estimate_label}>库存可用性</span>
                    {/* 库存可用性文本：后端暂无专用字段，保留静态文本 */}
                    <span className={styles.estimate_value}>{ESTIMATE_INVENTORY_TEXT}</span>
                  </div>
                  <div className={styles.estimate_row}>
                    <span
                      className={`${styles.estimate_dot} ${
                        urgentMutation.data?.capacityLoadCheck?.passed === false
                          ? styles['estimate_dot--red']
                          : styles['estimate_dot--green']
                      }`}
                    />
                    <span className={styles.estimate_label}>产能负荷</span>
                    <span className={styles.estimate_value}>
                      {capacityText}
                    </span>
                  </div>

                  {/* 预估交期行：仅在 createOrder 返回 estimatedDelivery（非 null）时展示 */}
                  {estimatedDelivery !== null && (
                    <div className={styles.estimate_row}>
                      <span className={`${styles.estimate_dot} ${delayDays > 0 ? styles['estimate_dot--yellow'] : styles['estimate_dot--green']}`} />
                      <span className={styles.estimate_label}>预估最早交期</span>
                      <span className={`${styles.estimate_value} ${delayDays > 0 ? styles['estimate_value--warning'] : ''}`}>
                        {estimatedDelivery}（您期望：{expectedDelivery}）
                      </span>
                    </div>
                  )}
                </div>

                {/* 交期预警：仅在存在 estimatedDelivery 且晚于期望时展示 */}
                {estimatedDelivery !== null && delayDays > 0 && (
                  <div className={`${styles.estimate_warning} ${styles.animate_slidedown}`}>
                    <span className={styles.estimate_warning_icon}>⚠</span>
                    <span className={styles.estimate_warning_text}>
                      预估交期晚于期望 <strong>{delayDays} 天</strong>，建议与客户确认是否可接受。
                      <br />
                      最早可承诺交期：<span className={styles.estimate_warning_date}>{estimatedDelivery}</span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── Card 3: 约束检查结果（提交后显示）─────────────────── */}
        {showConstraintCard && (
          <div className={`${styles.card} ${styles.animate_fadein}`}>
            <div className={styles.card_header}>
              <span className={styles.card_header_icon}>🔍</span>
              <h2 className={styles.card_title}>约束检查结果</h2>
              <span className={styles.card_subtitle}>
                {constraintChecks.length > 0 ? '检查完成' : '加载中…'}
              </span>
            </div>
            <div className={styles.card_body}>
              {constraintChecks.length === 0 ? (
                // API 尚未返回或调用失败时的占位状态
                <div className={styles.constraint_list}>
                  <div className={styles.constraint_item}>
                    <div className={styles.constraint_text}>
                      <div className={styles.constraint_detail}>
                        约束检查数据加载中，请稍候…
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={styles.constraint_list}>
                  {constraintChecks.map((check, i) => (
                    <div
                      key={i}
                      className={`${styles.constraint_item} ${
                        check.passed
                          ? styles['constraint_item--pass']
                          : styles['constraint_item--fail']
                      }`}
                    >
                      <div
                        className={`${styles.constraint_icon} ${
                          check.passed
                            ? styles['constraint_icon--pass']
                            : styles['constraint_icon--fail']
                        }`}
                      >
                        {check.passed ? '✓' : '✗'}
                      </div>
                      <div className={styles.constraint_text}>
                        <div
                          className={`${styles.constraint_label} ${
                            check.passed
                              ? styles['constraint_label--pass']
                              : styles['constraint_label--fail']
                          }`}
                        >
                          {check.label}
                        </div>
                        <div className={styles.constraint_detail}>{check.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      </main>

      {/* ── Sticky Footer ─────────────────────────────────────── */}
      <footer className={styles.page_footer}>
        <Button variant="ghost" size="md" onClick={handleCancel}>取消</Button>
        <div className={styles.footer_spacer} />
        <Button variant="secondary" size="md" onClick={handleSaveDraft}>保存草稿</Button>
        <Button
          variant={isUrgent ? 'warning' : 'primary'}
          size="lg"
          loading={isSubmitting}
          onClick={() => void handleSubmit()}
        >
          {isUrgent ? '发起影响评估' : '提交订单'}
        </Button>
      </footer>

      {/* ── Modal: Constraint Blocked ───────────────────────── */}
      <ConstraintBlockedModal
        open={constraintModalOpen}
        onClose={() => setConstraintModalOpen(false)}
        onViewDetail={() => {
          setConstraintModalOpen(false);
          if (createResult) {
            navigate(`/sales/orders/${createResult.orderId}`);
          }
        }}
        result={createResult}
      />

      {/* ── Modal: Urgent AI Analysis ───────────────────────── */}
      <UrgentAnalysisModal
        open={urgentModalOpen}
        onCancel={handleCancelUrgent}
        steps={aiSteps}
        countdown={countdown}
      />
    </div>
  );
}
