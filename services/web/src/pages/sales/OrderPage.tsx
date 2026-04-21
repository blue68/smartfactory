/**
 * [artifact:前端代码] — 新建销售订单页
 * 设计稿: docs/ui/web-sales-order.html
 * 功能：创建销售订单、交期产能预估、约束引擎检查、紧急插单AI分析
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import { useUrgentAnalysis } from '@/api/sales';
import {
  checkInventory,
  checkSalesOrderCapacity,
  useCreateSalesOrder,
  useConfirmSalesOrder,
} from '@/api/salesOrder';
import { useCustomerOptions } from '@/api/customer';
import { useSkuList } from '@/api/sku';
import { bomApi } from '@/api/bom';
import { BomStatus, ConstraintResult } from '@/types/enums';
import type {
  UrgentAnalysisResult,
  ConstraintCheck,
} from '@/types/models';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import styles from './OrderPage.module.css';

function formatLocalDate(date: Date): string {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

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
  unitPrice: string;
  deadline: string;
  notes: string;
}

interface RealtimeAssessmentState {
  loading: boolean;
  error: string;
  inventory: {
    available: number;
    sufficient: boolean;
    stockUnit: string;
  } | null;
  capacity: {
    available: boolean;
    currentLoad: number;
    maxCapacity: number;
    estimatedCompletionDate: string;
  } | null;
}

function getVisibleSkuCode(sku: { skuCode: string; customerSkuCode?: string | null }): string {
  return sku.customerSkuCode ?? sku.skuCode;
}

function getVisibleSkuName(sku: { name: string; customerSkuName?: string | null }): string {
  return sku.customerSkuName ?? sku.name;
}

export default function OrderPage() {
  const { setPageTitle, showToast } = useAppStore();
  const navigate = useNavigate();

  // ─── 真实 API 数据：客户列表 & 成品 SKU 列表 ─────────────────────────────
  const { data: customerOptions = [] } = useCustomerOptions();

  const [form, setForm] = useState<FormState>({
    customer: '',
    orderType: 'normal',
    product: '',
    qty: '',
    unitPrice: '',
    deadline: '',
    notes: '',
  });
  const selectedCustomerId = Number(form.customer) > 0 ? Number(form.customer) : undefined;
  const { data: skuPage } = useSkuList({
    pageSize: 200,
    skuTypes: 'finished',
    customerId: selectedCustomerId,
  });
  const { data: fallbackSkuPage } = useSkuList({
    pageSize: 200,
    skuTypes: 'finished',
  });
  const customerFinishedSkus = useMemo(
    () => (skuPage?.list ?? []).filter((sku) => sku.category1Code === 'FINISHED'),
    [skuPage],
  );
  const fallbackFinishedSkus = useMemo(
    () => (fallbackSkuPage?.list ?? []).filter((sku) => sku.category1Code === 'FINISHED'),
    [fallbackSkuPage],
  );
  const finishedSkus = useMemo(() => {
    if (!selectedCustomerId) return fallbackFinishedSkus;
    return customerFinishedSkus.length > 0 ? customerFinishedSkus : fallbackFinishedSkus;
  }, [selectedCustomerId, customerFinishedSkus, fallbackFinishedSkus]);

  const [showConstraintCard, setShowConstraintCard] = useState(false);
  const [urgentModalOpen, setUrgentModalOpen] = useState(false);
  const [urgentAnalysisReady, setUrgentAnalysisReady] = useState(false);
  const [constraintLoading, setConstraintLoading] = useState(false);

  // 约束检查展示数据：优先使用 API 返回数据，fallback 为空数组
  const [constraintChecks, setConstraintChecks] = useState<ConstraintCheckDisplay[]>([]);
  const [realtimeAssessment, setRealtimeAssessment] = useState<RealtimeAssessmentState>({
    loading: false,
    error: '',
    inventory: null,
    capacity: null,
  });

  // Urgent AI countdown
  const [aiSteps, setAiSteps] = useState<AiStep[]>(INITIAL_AI_STEPS);
  const [countdown, setCountdown] = useState(18);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const realtimeReqRef = useRef(0);

  // Draft save state
  const [draftLabel, setDraftLabel] = useState('草稿');
  const [autoSaveText, setAutoSaveText] = useState('尚未保存');

  const createMutation = useCreateSalesOrder();
  const confirmMutation = useConfirmSalesOrder();
  const urgentMutation = useUrgentAnalysis();

  useEffect(() => {
    setPageTitle('新建销售订单');
  }, [setPageTitle]);

  const todayLabel = useMemo(() => formatLocalDate(new Date()), []);

  // Cleanup countdown on unmount
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  useEffect(() => {
    const skuId = Number(form.product);
    const qty = Number(form.qty);
    const canAssess = Number.isInteger(skuId) && skuId > 0
      && Number.isFinite(qty) && qty > 0
      && /^\d{4}-\d{2}-\d{2}$/.test(form.deadline);

    if (!canAssess) {
      setRealtimeAssessment({
        loading: false,
        error: '',
        inventory: null,
        capacity: null,
      });
      return;
    }

    const reqId = ++realtimeReqRef.current;
    setRealtimeAssessment((prev) => ({ ...prev, loading: true, error: '' }));

    const timer = window.setTimeout(() => {
      void Promise.all([
        checkInventory(skuId, qty),
        checkSalesOrderCapacity({
          skuId,
          quantity: qty,
          expectedDelivery: form.deadline,
        }),
      ])
        .then(([inventory, capacity]) => {
          if (realtimeReqRef.current !== reqId) return;
          setRealtimeAssessment({
            loading: false,
            error: '',
            inventory,
            capacity,
          });
        })
        .catch((e: unknown) => {
          if (realtimeReqRef.current !== reqId) return;
          setRealtimeAssessment({
            loading: false,
            error: e instanceof Error ? e.message : '实时评估失败',
            inventory: null,
            capacity: null,
          });
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [form.product, form.qty, form.deadline]);

  const handleFormChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    if (form.orderType === 'urgent') {
      setUrgentAnalysisReady(false);
      setShowConstraintCard(false);
      setConstraintChecks([]);
    }
    setForm((prev) => {
      if (name === 'customer') {
        return { ...prev, customer: value, product: '' };
      }
      return { ...prev, [name]: value };
    });
  };

  const handleOrderTypeChange = (value: 'normal' | 'urgent') => {
    setUrgentAnalysisReady(false);
    setShowConstraintCard(false);
    setConstraintChecks([]);
    setForm((prev) => ({ ...prev, orderType: value }));
  };

  const handleSaveDraft = () => {
    const saveDraft = async () => {
      try {
        if (!form.customer || !form.product || !form.qty || !form.deadline) {
          localStorage.setItem('sales-order-draft:order-page', JSON.stringify(form));
          setDraftLabel('草稿（本地暂存）');
          setAutoSaveText('刚刚已本地保存');
          showToast({ type: 'info', message: '关键信息未填完，已先本地暂存' });
          return;
        }

        const payload = buildSingleItemPayload();
        const draftPayload = {
          ...payload,
          saveAsDraft: true,
        };
        await createMutation.mutateAsync(draftPayload);
        setDraftLabel('草稿（已保存）');
        setAutoSaveText('刚刚已保存');
        showToast({ type: 'success', message: '草稿已保存到系统' });
        navigate('/sales/order-list');
      } catch (e) {
        showToast({ type: 'error', message: (e as Error).message });
      }
    };

    void saveDraft();
  };

  const handleCancel = () => {
    if (window.confirm('确定放弃本次编辑？未保存的内容将丢失。')) {
      navigate(-1);
    }
  };

  /** 启动紧急插单分析倒计时动画 */
  const startUrgentCountdown = () => {
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
          return 0;
        }

        return next;
      });
    }, 1000);
  };

  const buildSingleItemPayload = () => {
    const selectedCustomer = customerOptions.find((c) => String(c.id) === form.customer);
    const selectedSku = finishedSkus.find((s) => String(s.id) === form.product);

    if (!selectedCustomer) {
      throw new Error('请选择有效客户');
    }
    if (!selectedSku) {
      throw new Error('请选择有效产品');
    }

    const customerId = Number(selectedCustomer.id);
    const skuId = Number(selectedSku.id);

    if (!Number.isInteger(customerId) || customerId <= 0) {
      throw new Error('客户数据无效，请重新选择');
    }
    if (!Number.isInteger(skuId) || skuId <= 0) {
      throw new Error('产品数据无效，请重新选择');
    }

    return {
      customerId,
      orderDate: new Date().toISOString().slice(0, 10),
      deliveryDate: form.deadline,
      isUrgent: form.orderType === 'urgent',
      notes: form.notes,
      items: [
        {
          skuId,
          productName: getVisibleSkuName(selectedSku),
          quantity: Number(form.qty),
          unitPrice: form.unitPrice || '0',
        },
      ],
    };
  };

  const handleSubmit = async () => {
    if (!form.customer || !form.product || !form.qty || !form.unitPrice || !form.deadline) {
      showToast({ type: 'error', message: '请填写所有必填字段' });
      return;
    }
    if (Number(form.qty) <= 0) {
      showToast({ type: 'error', message: '数量必须大于 0' });
      return;
    }
    if (Number(form.unitPrice) < 0) {
      showToast({ type: 'error', message: '单价不能为负数' });
      return;
    }

    if (form.orderType === 'urgent' && !urgentAnalysisReady) {
      setUrgentModalOpen(true);
      setShowConstraintCard(true);
      setConstraintLoading(true);
      setConstraintChecks([]);
      startUrgentCountdown();

      try {
        const selectedSkuId = Number(form.product);
        const skuBomList = await bomApi.getList(selectedSkuId);
        const preferredBom = skuBomList.find((bom) => bom.status === BomStatus.ACTIVE) ?? skuBomList[0];
        const bomId = Number(preferredBom?.id);
        if (!Number.isInteger(bomId) || bomId <= 0) {
          throw new Error('当前产品未配置BOM，请先在BOM管理中创建并激活BOM');
        }
        const analysisResult: UrgentAnalysisResult = await urgentMutation.mutateAsync({
          skuId: selectedSkuId,
          bomId,
          qty: form.qty,
          expectedDelivery: form.deadline,
        });
        setConstraintChecks(buildConstraintChecksFromAnalysis(analysisResult));
        setUrgentAnalysisReady(true);
        if (analysisResult.overallResult === ConstraintResult.BLOCK) {
          showToast({ type: 'error', message: '插单影响分析：当前约束不满足，请确认后提交' });
        } else {
          showToast({ type: 'info', message: '插单影响分析完成，请查看约束检查结果' });
        }
      } catch (e) {
        setConstraintChecks([{
          passed: false,
          label: '紧急插单影响评估',
          detail: e instanceof Error ? e.message : '评估失败，请稍后重试',
        }]);
        showToast({ type: 'error', message: e instanceof Error ? e.message : '影响评估失败' });
      } finally {
        if (countdownRef.current) clearInterval(countdownRef.current);
        setConstraintLoading(false);
        setUrgentModalOpen(false);
      }

      return;
    }

    try {
      const payload = buildSingleItemPayload();
      const result = await createMutation.mutateAsync(payload);
      const createdOrderId = Number((result as { id: number }).id);
      const createdOrderNo = String((result as { orderNo: string }).orderNo ?? '');

      if (form.orderType === 'urgent') {
        showToast({
          type: 'success',
          message: `插单申请 ${createdOrderNo || ''} 已提交审批`,
        });
      } else {
        await confirmMutation.mutateAsync(createdOrderId);
        showToast({
          type: 'success',
          message: `订单 ${createdOrderNo || ''} 已确认并触发生产工单创建`,
        });
      }
      navigate('/sales/order-list');
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleCancelUrgent = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setUrgentModalOpen(false);
  };

  const isUrgent = form.orderType === 'urgent';
  const isSubmitting =
    createMutation.isPending || confirmMutation.isPending || urgentMutation.isPending;

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
                  disabled={!form.customer}
                >
                  <option value="">{form.customer ? '请选择产品' : '请先选择客户'}</option>
                  {finishedSkus.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {getVisibleSkuName(s)} ({getVisibleSkuCode(s)})
                    </option>
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

              {/* 单价 */}
              <div className={styles.form_group}>
                <label className={`${styles.form_label} ${styles['form_label--required']}`} htmlFor="unitPrice">
                  单价
                </label>
                <div className={styles.input_with_unit}>
                  <input
                    type="number"
                    id="unitPrice"
                    name="unitPrice"
                    className={styles.form_input}
                    value={form.unitPrice}
                    min={0}
                    step="0.01"
                    onChange={handleFormChange}
                  />
                  <span className={styles.input_unit}>元</span>
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
                <span className={styles.form_hint}>当前日期：{todayLabel}</span>
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
          const hasEnoughFields = Number(form.product) > 0
            && Number(form.qty) > 0
            && /^\d{4}-\d{2}-\d{2}$/.test(form.deadline);
          const capacity = realtimeAssessment.capacity;
          const inventory = realtimeAssessment.inventory;
          let capacityText = '待填写订单信息后评估';

          if (hasEnoughFields && realtimeAssessment.loading) {
            capacityText = '评估中...';
          } else if (hasEnoughFields && realtimeAssessment.error) {
            capacityText = `评估失败：${realtimeAssessment.error}`;
          } else if (capacity) {
            capacityText = `当前负荷 ${capacity.currentLoad}/${capacity.maxCapacity}，${
              capacity.available ? '可接单' : '产能已接近上限'
            }`;
          }

          const inventoryText = !hasEnoughFields
            ? '待选择客户和产品后评估'
            : realtimeAssessment.loading
              ? '评估中...'
              : realtimeAssessment.error
                ? `评估失败：${realtimeAssessment.error}`
                : inventory
                  ? `可用 ${inventory.available} ${inventory.stockUnit}，${inventory.sufficient ? '库存充足' : '库存不足'}`
                  : '暂无评估结果';

          const estimatedDelivery = capacity?.estimatedCompletionDate ?? null;
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
                    <span className={styles.estimate_value}>{inventoryText}</span>
                  </div>
                  <div className={styles.estimate_row}>
                    <span
                      className={`${styles.estimate_dot} ${
                        capacity?.available === false
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
                {constraintLoading ? '加载中…' : constraintChecks.length > 0 ? '检查完成' : '待发起评估'}
              </span>
            </div>
            <div className={styles.card_body}>
              {constraintLoading ? (
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
              ) : constraintChecks.length === 0 ? (
                <div className={styles.constraint_list}>
                  <div className={styles.constraint_item}>
                    <div className={styles.constraint_text}>
                      <div className={styles.constraint_detail}>
                        尚未发起约束评估，请点击“发起影响评估”。
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
          {isUrgent ? (urgentAnalysisReady ? '提交插单申请' : '发起影响评估') : '确认订单'}
        </Button>
      </footer>

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
