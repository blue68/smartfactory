/**
 * [artifact:前端代码] — 新建销售订单页
 * 功能：创建多 SKU 销售订单、交期产能预估、紧急插单评估
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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
  ConstraintCheck,
  UrgentAnalysisResult,
} from '@/types/models';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import styles from './OrderPage.module.css';

function formatLocalDate(date: Date): string {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

const CONSTRAINT_CHECK_LABELS: Record<string, string> = {
  inventoryTurnoverCheck: 'SKU 库存周转天数',
  capitalOccupationCheck: '资金占用',
  productionCostCheck: '生产成本估算',
  capacityLoadCheck: '产能负荷',
};

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
              <div
                className={styles.ai_step_icon}
                aria-label={step.status === 'done' ? '已完成' : step.status === 'current' ? '进行中' : '待执行'}
              >
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

interface OrderFormState {
  customer: string;
  orderType: 'normal' | 'urgent';
  deadline: string;
  notes: string;
}

interface DraftLineItem {
  key: string;
  skuId: number | '';
  skuSearch: string;
  productCode: string;
  productName: string;
  unit: string;
  quantity: string;
  unitPrice: string;
}

interface SkuOption {
  id: number;
  skuCode: string;
  name: string;
  stockUnit?: string | null;
  customerSkuCode?: string | null;
  customerSkuName?: string | null;
}

interface AssessmentLineInput {
  skuId: number;
  productCode: string;
  productName: string;
  quantity: number;
}

interface AssessmentShortageLine {
  skuId: number;
  productCode: string;
  productName: string;
  requiredQty: number;
  availableQty: number;
  stockUnit: string;
}

interface DeliveryCapacityAssessment {
  expectedDelivery: string;
  latestEstimatedCompletionDate: string | null;
  delayDays: number;
  capacityAvailable: boolean;
  inventorySufficient: boolean;
  currentLoadTotal: number;
  maxCapacityTotal: number;
  overloadedLines: string[];
  shortageLines: AssessmentShortageLine[];
  conflictingOrders: Array<{ id: number; orderNo: string }>;
  failedLineCount: number;
}

interface AssessmentLineResult {
  inventory: Awaited<ReturnType<typeof checkInventory>> | null;
  capacity: Awaited<ReturnType<typeof checkSalesOrderCapacity>> | null;
  failed: boolean;
}

type AssessmentLineCacheEntry = AssessmentLineResult | Promise<AssessmentLineResult>;

let draftLineSequence = 0;

function createDraftLineItem(): DraftLineItem {
  draftLineSequence += 1;
  return {
    key: `sales-order-line-${draftLineSequence}`,
    skuId: '',
    skuSearch: '',
    productCode: '',
    productName: '',
    unit: '',
    quantity: '',
    unitPrice: '',
  };
}

function getVisibleSkuCode(sku: SkuOption): string {
  return sku.customerSkuCode ?? sku.skuCode;
}

function getVisibleSkuName(sku: SkuOption): string {
  return sku.customerSkuName ?? sku.name;
}

function getSkuOptionLabel(sku: SkuOption): string {
  return `${getVisibleSkuName(sku)} (${getVisibleSkuCode(sku)})`;
}

function isISODateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime());
}

function getDelayDays(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T00:00:00`).getTime();
  const to = new Date(`${toDate}T00:00:00`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  return Math.ceil((to - from) / 86400000);
}

function buildAssessmentLinesFromDraftItems(items: DraftLineItem[]): AssessmentLineInput[] {
  return items
    .map((item) => ({
      skuId: Number(item.skuId),
      productCode: item.productCode.trim(),
      productName: item.productName.trim(),
      quantity: Number(item.quantity),
    }))
    .filter((item) => Number.isInteger(item.skuId) && item.skuId > 0 && Number.isFinite(item.quantity) && item.quantity > 0);
}

async function buildDeliveryCapacityAssessment(
  lines: AssessmentLineInput[],
  expectedDelivery: string,
  cache?: Map<string, AssessmentLineCacheEntry>,
): Promise<DeliveryCapacityAssessment> {
  const validLines = lines.filter((line) => Number.isInteger(line.skuId) && line.skuId > 0 && line.quantity > 0);
  if (validLines.length === 0 || !isISODateString(expectedDelivery)) {
    return {
      expectedDelivery,
      latestEstimatedCompletionDate: null,
      delayDays: 0,
      capacityAvailable: true,
      inventorySufficient: true,
      currentLoadTotal: 0,
      maxCapacityTotal: 0,
      overloadedLines: [],
      shortageLines: [],
      conflictingOrders: [],
      failedLineCount: 0,
    };
  }

  const lineResults = await Promise.all(
    validLines.map(async (line) => {
      const cacheKey = `${line.skuId}:${line.quantity}:${expectedDelivery}`;
      const cachedEntry = cache?.get(cacheKey);
      if (cachedEntry) {
        const cachedResult = cachedEntry instanceof Promise ? await cachedEntry : cachedEntry;
        return { line, ...cachedResult };
      }

      const pendingResult: Promise<AssessmentLineResult> = Promise.all([
        checkInventory(line.skuId, line.quantity),
        checkSalesOrderCapacity({
          skuId: line.skuId,
          quantity: Math.max(1, Math.round(line.quantity)),
          expectedDelivery,
        }),
      ])
        .then(([inventory, capacity]) => ({
          inventory,
          capacity,
          failed: false,
        }))
        .catch(() => ({
          inventory: null,
          capacity: null,
          failed: true,
        }));

      cache?.set(cacheKey, pendingResult);
      const result = await pendingResult;
      cache?.set(cacheKey, result);
      return { line, ...result };
    }),
  );

  const shortageLines: AssessmentShortageLine[] = lineResults
    .filter((item) => item.inventory && !item.inventory.sufficient)
    .map((item) => ({
      skuId: item.line.skuId,
      productCode: item.line.productCode,
      productName: item.line.productName,
      requiredQty: item.line.quantity,
      availableQty: item.inventory?.available ?? 0,
      stockUnit: item.inventory?.stockUnit ?? '件',
    }));

  const overloadedLines = lineResults
    .filter((item) => item.capacity && !item.capacity.available)
    .map((item) => item.line.productName || item.line.productCode || `SKU#${item.line.skuId}`);

  const conflictMap = new Map<number, { id: number; orderNo: string }>();
  lineResults.forEach((item) => {
    item.capacity?.conflictingOrders?.forEach((order) => {
      if (!conflictMap.has(order.id)) {
        conflictMap.set(order.id, { id: order.id, orderNo: order.orderNo });
      }
    });
  });

  const estimatedDates = lineResults
    .map((item) => item.capacity?.estimatedCompletionDate)
    .filter((date): date is string => Boolean(date) && isISODateString(String(date)));

  const latestEstimatedCompletionDate = estimatedDates.length > 0
    ? estimatedDates.sort()[estimatedDates.length - 1] ?? null
    : null;

  return {
    expectedDelivery,
    latestEstimatedCompletionDate,
    delayDays: latestEstimatedCompletionDate ? getDelayDays(expectedDelivery, latestEstimatedCompletionDate) : 0,
    capacityAvailable: overloadedLines.length === 0,
    inventorySufficient: shortageLines.length === 0,
    currentLoadTotal: lineResults.reduce((sum, item) => sum + (item.capacity?.currentLoad ?? 0), 0),
    maxCapacityTotal: lineResults.reduce((sum, item) => sum + (item.capacity?.maxCapacity ?? 0), 0),
    overloadedLines,
    shortageLines,
    conflictingOrders: Array.from(conflictMap.values()).slice(0, 6),
    failedLineCount: lineResults.filter((item) => item.failed).length,
  };
}

function buildConstraintChecksFromAssessment(
  assessment: DeliveryCapacityAssessment,
): ConstraintCheckDisplay[] {
  const firstShortage = assessment.shortageLines[0];
  return [
    {
      passed: assessment.inventorySufficient,
      label: '库存可用性',
      detail: assessment.inventorySufficient
        ? '当前整单涉及 SKU 库存可满足需求'
        : `存在 ${assessment.shortageLines.length} 个 SKU 库存不足，例如 ${firstShortage?.productName ?? '当前 SKU'} 仅剩 ${firstShortage?.availableQty ?? 0} ${firstShortage?.stockUnit ?? '件'}`,
    },
    {
      passed: assessment.capacityAvailable,
      label: '产能负荷',
      detail: assessment.capacityAvailable
        ? '当前产能可承接该订单'
        : `存在超载 SKU：${assessment.overloadedLines.slice(0, 3).join('、')}`,
    },
    {
      passed: assessment.delayDays === 0,
      label: '交期承诺',
      detail: assessment.latestEstimatedCompletionDate
        ? assessment.delayDays > 0
          ? `预估最早交期 ${assessment.latestEstimatedCompletionDate}，较期望交期延后 ${assessment.delayDays} 天`
          : `预估最早交期 ${assessment.latestEstimatedCompletionDate}，可按期交付`
        : '已完成整单交期测算',
    },
    {
      passed: assessment.failedLineCount === 0,
      label: '评估完整性',
      detail: assessment.failedLineCount === 0
        ? '所有 SKU 已完成库存与产能校验'
        : `有 ${assessment.failedLineCount} 个 SKU 评估失败，请关注提交后的审批结论`,
    },
  ];
}

function getLineSubtotal(line: DraftLineItem): number {
  const quantity = Number(line.quantity);
  const unitPrice = Number(line.unitPrice);
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return 0;
  return quantity * unitPrice;
}

interface SearchableSkuSelectProps {
  id: string;
  value: string;
  options: SkuOption[];
  disabled?: boolean;
  placeholder: string;
  onInputChange: (value: string) => void;
  onSelect: (sku: SkuOption) => void;
}

function SearchableSkuSelect({
  id,
  value,
  options,
  disabled = false,
  placeholder,
  onInputChange,
  onSelect,
}: SearchableSkuSelectProps) {
  const [open, setOpen] = useState(false);
  const query = value.trim().toLowerCase();

  const filteredOptions = useMemo(() => {
    const base = query
      ? options.filter((sku) => {
          const keyword = `${getVisibleSkuName(sku)} ${getVisibleSkuCode(sku)} ${sku.name} ${sku.skuCode}`.toLowerCase();
          return keyword.includes(query);
        })
      : options;
    return base.slice(0, 12);
  }, [options, query]);

  return (
    <div className={styles.searchable_select}>
      <input
        id={id}
        className={styles.form_input}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          onInputChange(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      />

      {open && !disabled && (
        <div className={styles.searchable_dropdown} id={`${id}-listbox`} role="listbox" aria-label="SKU 候选列表">
          {filteredOptions.length === 0 && (
            <div className={styles.searchable_empty}>未找到匹配的产品</div>
          )}
          {filteredOptions.map((sku) => (
            <button
              key={sku.id}
              type="button"
              className={styles.searchable_option}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(sku);
                setOpen(false);
              }}
            >
              <span className={styles.searchable_option_name}>{getVisibleSkuName(sku)}</span>
              <span className={styles.searchable_option_code}>{getVisibleSkuCode(sku)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OrderPage() {
  const { setPageTitle, showToast } = useAppStore();
  const navigate = useNavigate();
  const { data: customerOptions = [] } = useCustomerOptions();

  const [form, setForm] = useState<OrderFormState>({
    customer: '',
    orderType: 'normal',
    deadline: '',
    notes: '',
  });
  const [lineItems, setLineItems] = useState<DraftLineItem[]>([createDraftLineItem()]);
  const [bulkQuantity, setBulkQuantity] = useState('');
  const [bulkUnitPrice, setBulkUnitPrice] = useState('');
  const [showConstraintCard, setShowConstraintCard] = useState(false);
  const [urgentModalOpen, setUrgentModalOpen] = useState(false);
  const [urgentAnalysisReady, setUrgentAnalysisReady] = useState(false);
  const [constraintLoading, setConstraintLoading] = useState(false);
  const [constraintChecks, setConstraintChecks] = useState<ConstraintCheckDisplay[]>([]);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [assessmentError, setAssessmentError] = useState('');
  const [assessment, setAssessment] = useState<DeliveryCapacityAssessment | null>(null);
  const [aiSteps, setAiSteps] = useState<AiStep[]>(INITIAL_AI_STEPS);
  const [countdown, setCountdown] = useState(18);
  const [draftLabel, setDraftLabel] = useState('草稿');
  const [autoSaveText, setAutoSaveText] = useState('尚未保存');
  const [submitAction, setSubmitAction] = useState<'draft' | 'submit' | null>(null);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const assessmentReqRef = useRef(0);
  const assessmentCacheRef = useRef<Map<string, AssessmentLineCacheEntry>>(new Map());

  const createMutation = useCreateSalesOrder();
  const confirmMutation = useConfirmSalesOrder();
  const urgentMutation = useUrgentAnalysis();
  const isSubmitting =
    submitAction !== null
    || createMutation.isPending
    || confirmMutation.isPending
    || urgentMutation.isPending;

  useEffect(() => {
    setPageTitle('新建销售订单');
  }, [setPageTitle]);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const todayLabel = useMemo(() => formatLocalDate(new Date()), []);
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
    () =>
      (skuPage?.list ?? [])
        .filter((sku) => sku.category1Code === 'FINISHED')
        .map((sku) => ({ ...sku, id: Number(sku.id) })) as SkuOption[],
    [skuPage],
  );
  const fallbackFinishedSkus = useMemo(
    () =>
      (fallbackSkuPage?.list ?? [])
        .filter((sku) => sku.category1Code === 'FINISHED')
        .map((sku) => ({ ...sku, id: Number(sku.id) })) as SkuOption[],
    [fallbackSkuPage],
  );
  const finishedSkus = useMemo(() => {
    if (!selectedCustomerId) return fallbackFinishedSkus;
    return customerFinishedSkus.length > 0 ? customerFinishedSkus : fallbackFinishedSkus;
  }, [selectedCustomerId, customerFinishedSkus, fallbackFinishedSkus]);

  const validAssessmentLines = useMemo(
    () => buildAssessmentLinesFromDraftItems(lineItems),
    [lineItems],
  );

  const totalQuantity = useMemo(
    () => lineItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
    [lineItems],
  );
  const totalAmount = useMemo(
    () => lineItems.reduce((sum, item) => sum + getLineSubtotal(item), 0),
    [lineItems],
  );

  useEffect(() => {
    const expectedDelivery = form.deadline ? String(form.deadline).slice(0, 10) : '';
    if (!isISODateString(expectedDelivery) || validAssessmentLines.length === 0 || isSubmitting) {
      assessmentReqRef.current += 1;
      setAssessmentLoading(false);
      setAssessmentError('');
      setAssessment(null);
      return;
    }

    const currentReqId = ++assessmentReqRef.current;
    const timer = window.setTimeout(() => {
      setAssessmentLoading(true);
      setAssessmentError('');
      void buildDeliveryCapacityAssessment(validAssessmentLines, expectedDelivery, assessmentCacheRef.current)
        .then((result) => {
          if (assessmentReqRef.current !== currentReqId) return;
          setAssessment(result);
        })
        .catch((error: unknown) => {
          if (assessmentReqRef.current !== currentReqId) return;
          setAssessment(null);
          setAssessmentError(error instanceof Error ? error.message : '交期与产能评估失败');
        })
        .finally(() => {
          if (assessmentReqRef.current !== currentReqId) return;
          setAssessmentLoading(false);
        });
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [form.deadline, isSubmitting, validAssessmentLines]);

  const resetUrgentAnalysis = () => {
    setUrgentAnalysisReady(false);
    setShowConstraintCard(false);
    setConstraintLoading(false);
    setConstraintChecks([]);
  };

  const updateMetaForm = (next: Partial<OrderFormState>) => {
    if (form.orderType === 'urgent' || next.orderType === 'urgent') {
      resetUrgentAnalysis();
    }
    setForm((prev) => ({ ...prev, ...next }));
  };

  const updateLineItem = <K extends keyof DraftLineItem>(
    key: string,
    field: K,
    value: DraftLineItem[K],
  ) => {
    if (form.orderType === 'urgent') {
      resetUrgentAnalysis();
    }
    setLineItems((prev) => prev.map((item) => (
      item.key === key ? { ...item, [field]: value } : item
    )));
  };

  const handleCustomerChange = (value: string) => {
    updateMetaForm({ customer: value });
    setLineItems([createDraftLineItem()]);
  };

  const handleOrderTypeChange = (value: 'normal' | 'urgent') => {
    updateMetaForm({ orderType: value });
  };

  const handleSelectSku = (lineKey: string, sku: SkuOption) => {
    updateLineItem(lineKey, 'skuId', sku.id);
    setLineItems((prev) => prev.map((item) => (
      item.key === lineKey
        ? {
            ...item,
            skuId: sku.id,
            skuSearch: getSkuOptionLabel(sku),
            productCode: getVisibleSkuCode(sku),
            productName: getVisibleSkuName(sku),
            unit: sku.stockUnit ?? item.unit ?? '件',
          }
        : item
    )));
  };

  const addLineItem = () => {
    setLineItems((prev) => [...prev, createDraftLineItem()]);
  };

  const removeLineItem = (lineKey: string) => {
    setLineItems((prev) => {
      if (prev.length === 1) return prev;
      return prev.filter((item) => item.key !== lineKey);
    });
    if (form.orderType === 'urgent') {
      resetUrgentAnalysis();
    }
  };

  const applyBulkField = (field: 'quantity' | 'unitPrice', rawValue: string) => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      showToast({ type: 'warning', message: field === 'quantity' ? '请填写批量数量' : '请填写批量单价' });
      return;
    }
    const numericValue = Number(trimmed);
    if (!Number.isFinite(numericValue) || numericValue < 0 || (field === 'quantity' && numericValue <= 0)) {
      showToast({ type: 'warning', message: field === 'quantity' ? '批量数量必须大于 0' : '批量单价不能为负数' });
      return;
    }

    setLineItems((prev) => prev.map((item) => (
      item.skuId ? { ...item, [field]: trimmed } : item
    )));
    if (form.orderType === 'urgent') {
      resetUrgentAnalysis();
    }
  };

  const startUrgentCountdown = () => {
    setAiSteps(INITIAL_AI_STEPS);
    setCountdown(18);

    if (countdownRef.current) clearInterval(countdownRef.current);

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        const next = prev - 1;

        if (next === 10) {
          setAiSteps((steps) =>
            steps.map((step, index) => {
              if (index === 2) return { ...step, status: 'done', label: '各订单交期变化模拟完成' };
              if (index === 3) return { ...step, status: 'current' };
              return step;
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

  const buildOrderPayload = () => {
    const selectedCustomer = customerOptions.find((item) => String(item.id) === form.customer);
    if (!selectedCustomer) {
      throw new Error('请选择有效客户');
    }
    if (!isISODateString(form.deadline)) {
      throw new Error('请选择有效交期');
    }

    const populatedLines = lineItems.filter((item) => (
      item.skuId !== '' || item.skuSearch.trim() || item.quantity.trim() || item.unitPrice.trim()
    ));
    if (populatedLines.length === 0) {
      throw new Error('请至少添加一个产品行');
    }

    const items = populatedLines.map((item, index) => {
      const skuId = Number(item.skuId);
      const selectedSku = finishedSkus.find((sku) => Number(sku.id) === skuId);
      if (!Number.isInteger(skuId) || skuId <= 0 || !selectedSku) {
        throw new Error(`第 ${index + 1} 行请选择有效产品`);
      }
      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`第 ${index + 1} 行数量必须大于 0`);
      }
      const unitPrice = Number(item.unitPrice);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new Error(`第 ${index + 1} 行单价不能为负数`);
      }

      return {
        skuId,
        productName: item.productName || getVisibleSkuName(selectedSku),
        quantity,
        unit: item.unit || selectedSku.stockUnit || '件',
        unitPrice: item.unitPrice || '0',
      };
    });

    return {
      customerId: Number(selectedCustomer.id),
      orderDate: new Date().toISOString().slice(0, 10),
      deliveryDate: form.deadline,
      isUrgent: form.orderType === 'urgent',
      notes: form.notes.trim() || undefined,
      items,
    };
  };

  const handleSaveDraft = () => {
    if (isSubmitting) return;
    const saveDraft = async () => {
      setSubmitAction('draft');
      try {
        if (!form.customer || !form.deadline || validAssessmentLines.length === 0) {
          localStorage.setItem('sales-order-draft:order-page', JSON.stringify({
            form,
            lineItems,
          }));
          setDraftLabel('草稿（本地暂存）');
          setAutoSaveText('刚刚已本地保存');
          showToast({ type: 'info', message: '关键信息未填完，已先本地暂存' });
          return;
        }

        const payload = buildOrderPayload();
        await createMutation.mutateAsync({
          ...payload,
          saveAsDraft: true,
        });
        setDraftLabel('草稿（已保存）');
        setAutoSaveText('刚刚已保存');
        showToast({ type: 'success', message: '草稿已保存到系统' });
        navigate('/sales/order-list');
      } catch (error) {
        showToast({ type: 'error', message: (error as Error).message });
      } finally {
        setSubmitAction(null);
      }
    };

    void saveDraft();
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setSubmitAction('submit');
    let payload: ReturnType<typeof buildOrderPayload>;
    try {
      payload = buildOrderPayload();
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message });
      setSubmitAction(null);
      return;
    }

    if (form.orderType === 'urgent' && !urgentAnalysisReady) {
      setUrgentModalOpen(true);
      setShowConstraintCard(true);
      setConstraintLoading(true);
      setConstraintChecks([]);
      startUrgentCountdown();

      try {
        if (payload.items.length === 1) {
          const selectedSkuId = Number(payload.items[0].skuId);
          const skuBomList = await bomApi.getList(selectedSkuId);
          const preferredBom = skuBomList.find((bom) => bom.status === BomStatus.ACTIVE) ?? skuBomList[0];
          const bomId = Number(preferredBom?.id);
          if (!Number.isInteger(bomId) || bomId <= 0) {
            throw new Error('当前产品未配置BOM，请先在BOM管理中创建并激活BOM');
          }
          const analysisResult: UrgentAnalysisResult = await urgentMutation.mutateAsync({
            skuId: selectedSkuId,
            bomId,
            qty: String(payload.items[0].quantity),
            expectedDelivery: form.deadline,
          });
          setConstraintChecks(buildConstraintChecksFromAnalysis(analysisResult));
          setUrgentAnalysisReady(true);
          if (analysisResult.overallResult === ConstraintResult.BLOCK) {
            showToast({ type: 'error', message: '插单影响分析：当前约束不满足，请确认后提交' });
          } else {
            showToast({ type: 'info', message: '插单影响分析完成，请查看约束检查结果' });
          }
        } else {
          const summaryAssessment = await buildDeliveryCapacityAssessment(
            validAssessmentLines,
            form.deadline,
            assessmentCacheRef.current,
          );
          setConstraintChecks(buildConstraintChecksFromAssessment(summaryAssessment));
          setUrgentAnalysisReady(true);
          if (!summaryAssessment.inventorySufficient || !summaryAssessment.capacityAvailable || summaryAssessment.delayDays > 0) {
            showToast({ type: 'warning', message: '多 SKU 插单评估完成，存在库存、产能或交期风险，请确认后提交' });
          } else {
            showToast({ type: 'info', message: '多 SKU 插单评估完成，可继续提交审批' });
          }
        }
      } catch (error) {
        setConstraintChecks([{
          passed: false,
          label: '紧急插单影响评估',
          detail: error instanceof Error ? error.message : '评估失败，请稍后重试',
        }]);
        showToast({ type: 'error', message: error instanceof Error ? error.message : '影响评估失败' });
      } finally {
        if (countdownRef.current) clearInterval(countdownRef.current);
        setConstraintLoading(false);
        setUrgentModalOpen(false);
        setSubmitAction(null);
      }
      return;
    }

    try {
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
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message });
    } finally {
      setSubmitAction(null);
    }
  };

  const handleCancel = () => {
    if (window.confirm('确定放弃本次编辑？未保存的内容将丢失。')) {
      navigate(-1);
    }
  };

  const handleCancelUrgent = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setUrgentModalOpen(false);
  };

  const isUrgent = form.orderType === 'urgent';

  return (
    <div className={styles.page}>
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

      <main className={styles.page_content}>
        {isUrgent && (
          <div className={`${styles.urgent_notice} ${styles.animate_slidedown}`}>
            <span className={styles.urgent_notice_icon}>⚠</span>
            <span>
              <strong>紧急插单模式已启用</strong> — 单 SKU 将走 AI 影响分析，多 SKU 将走整单库存与产能聚合评估。
            </span>
          </div>
        )}

        <div className={styles.card}>
          <div className={styles.card_header}>
            <span className={styles.card_header_icon}>📋</span>
            <h2 className={styles.card_title}>基本信息</h2>
          </div>
          <div className={styles.card_body}>
            <div className={styles.form_grid}>
              <div className={styles.form_group}>
                <label className={`${styles.form_label} ${styles['form_label--required']}`} htmlFor="customer">
                  客户名称
                </label>
                <select
                  id="customer"
                  name="customer"
                  className={styles.form_select}
                  value={form.customer}
                  onChange={(event) => handleCustomerChange(event.target.value)}
                >
                  <option value="">请选择客户</option>
                  {customerOptions.map((customer) => (
                    <option key={customer.id} value={String(customer.id)}>
                      {customer.name}（{customer.code}）
                    </option>
                  ))}
                </select>
              </div>

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
                    <span className={`${styles.radio_circle} ${isUrgent ? styles['radio_circle--urgent'] : ''}`} />
                    <span className={isUrgent ? styles.urgent_label_text : ''}>紧急插单</span>
                    <span className={styles.urgent_tag}>优先</span>
                  </label>
                </div>
              </div>

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
                  onChange={(event) => updateMetaForm({ deadline: event.target.value })}
                />
                <span className={styles.form_hint}>当前日期：{todayLabel}</span>
              </div>

              <div className={`${styles.form_group} ${styles.form_group_full}`}>
                <label className={styles.form_label} htmlFor="notes">备注</label>
                <input
                  type="text"
                  id="notes"
                  name="notes"
                  className={styles.form_input}
                  value={form.notes}
                  onChange={(event) => updateMetaForm({ notes: event.target.value })}
                  placeholder="特殊要求、面料颜色偏好、送货备注等…"
                />
              </div>
            </div>

            <div className={styles.line_items_section}>
              <div className={styles.line_items_header}>
                <div>
                  <h3 className={styles.line_items_title}>产品明细</h3>
                  <p className={styles.line_items_hint}>一个订单可同时录入多个 SKU，支持搜索产品、批量填写数量和单价。</p>
                </div>
                <Button variant="secondary" size="sm" onClick={addLineItem}>
                  + 添加SKU
                </Button>
              </div>

              <div className={styles.bulk_toolbar}>
                <div className={styles.bulk_group}>
                  <span className={styles.bulk_label}>批量数量</span>
                  <input
                    className={styles.bulk_input}
                    type="number"
                    min={1}
                    step="1"
                    value={bulkQuantity}
                    onChange={(event) => setBulkQuantity(event.target.value)}
                    placeholder="应用到已选 SKU 行"
                  />
                  <Button size="sm" variant="ghost" onClick={() => applyBulkField('quantity', bulkQuantity)}>
                    应用数量
                  </Button>
                </div>

                <div className={styles.bulk_group}>
                  <span className={styles.bulk_label}>批量单价</span>
                  <input
                    className={styles.bulk_input}
                    type="number"
                    min={0}
                    step="0.01"
                    value={bulkUnitPrice}
                    onChange={(event) => setBulkUnitPrice(event.target.value)}
                    placeholder="应用到已选 SKU 行"
                  />
                  <Button size="sm" variant="ghost" onClick={() => applyBulkField('unitPrice', bulkUnitPrice)}>
                    应用单价
                  </Button>
                </div>
              </div>

              <div className={styles.line_items_table_wrapper}>
                <div className={styles.line_items_table_scroll}>
                  <table className={styles.line_items_table}>
                    <thead>
                      <tr>
                        <th>产品 / BOM</th>
                        <th>数量</th>
                        <th>单位</th>
                        <th>单价(元)</th>
                        <th>小计(元)</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((item, index) => (
                        <tr key={item.key}>
                          <td>
                            <SearchableSkuSelect
                              id={`product-search-${index}`}
                              value={item.skuSearch}
                              options={finishedSkus}
                              disabled={!form.customer}
                              placeholder={form.customer ? '搜索产品名称 / 编码' : '请先选择客户'}
                              onInputChange={(value) => {
                                updateLineItem(item.key, 'skuSearch', value);
                                if (!value.trim()) {
                                  setLineItems((prev) => prev.map((line) => (
                                    line.key === item.key
                                      ? { ...line, skuId: '', productCode: '', productName: '', unit: '' }
                                      : line
                                  )));
                                }
                              }}
                              onSelect={(sku) => handleSelectSku(item.key, sku)}
                            />
                            {(item.productCode || item.productName) && (
                              <div className={styles.line_item_meta}>
                                <span>{item.productName}</span>
                                <span>{item.productCode}</span>
                              </div>
                            )}
                          </td>
                          <td>
                            <div className={styles.input_with_unit}>
                              <input
                                id={index === 0 ? 'qty' : undefined}
                                data-testid={`line-qty-${index}`}
                                type="number"
                                min={1}
                                step="1"
                                className={styles.form_input}
                                value={item.quantity}
                                onChange={(event) => updateLineItem(item.key, 'quantity', event.target.value)}
                              />
                            </div>
                          </td>
                          <td>
                            <input
                              className={`${styles.form_input} ${styles.line_item_unit}`}
                              value={item.unit}
                              readOnly
                              placeholder="自动带出"
                            />
                          </td>
                          <td>
                            <div className={styles.input_with_unit}>
                              <input
                                id={index === 0 ? 'unitPrice' : undefined}
                                data-testid={`line-price-${index}`}
                                type="number"
                                min={0}
                                step="0.01"
                                className={styles.form_input}
                                value={item.unitPrice}
                                onChange={(event) => updateLineItem(item.key, 'unitPrice', event.target.value)}
                              />
                              <span className={styles.input_unit}>元</span>
                            </div>
                          </td>
                          <td className={styles.line_item_amount}>
                            {getLineSubtotal(item).toFixed(2)}
                          </td>
                          <td>
                            <button
                              type="button"
                              className={styles.remove_line_button}
                              onClick={() => removeLineItem(item.key)}
                              disabled={lineItems.length === 1}
                              aria-label={`删除第 ${index + 1} 行`}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className={styles.line_items_total_label}>
                          合计 {validAssessmentLines.length} 个 SKU / {totalQuantity} 件
                        </td>
                        <td />
                        <td />
                        <td />
                        <td className={styles.line_items_total_amount}>{totalAmount.toFixed(2)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.card_header}>
            <span className={styles.card_header_icon}>⏱</span>
            <h2 className={styles.card_title}>交期与产能预估</h2>
            <span className={styles.card_subtitle}>按整单明细实时计算</span>
          </div>
          <div className={styles.card_body}>
            <div className={styles.estimate_card}>
              <div className={styles.estimate_row}>
                <span className={`${styles.estimate_dot} ${assessment?.inventorySufficient === false ? styles['estimate_dot--red'] : styles['estimate_dot--green']}`} />
                <span className={styles.estimate_label}>库存可用性</span>
                <span className={styles.estimate_value}>
                  {!form.deadline || validAssessmentLines.length === 0
                    ? '填写交期并至少选择一个产品后自动评估'
                    : assessmentLoading
                      ? '评估中...'
                      : assessmentError
                        ? `评估失败：${assessmentError}`
                        : assessment?.inventorySufficient
                          ? '当前整单库存可满足需求'
                          : `${assessment?.shortageLines.length ?? 0} 个 SKU 库存不足`}
                </span>
              </div>
              <div className={styles.estimate_row}>
                <span className={`${styles.estimate_dot} ${assessment?.capacityAvailable === false ? styles['estimate_dot--red'] : styles['estimate_dot--green']}`} />
                <span className={styles.estimate_label}>产能负荷</span>
                <span className={styles.estimate_value}>
                  {!form.deadline || validAssessmentLines.length === 0
                    ? '待填写订单信息后评估'
                    : assessmentLoading
                      ? '评估中...'
                      : assessmentError
                        ? `评估失败：${assessmentError}`
                        : assessment
                          ? `当前负荷 ${assessment.currentLoadTotal}/${assessment.maxCapacityTotal}，${assessment.capacityAvailable ? '可接单' : '存在超载 SKU'}`
                          : '暂无评估结果'}
                </span>
              </div>
              <div className={styles.estimate_row}>
                <span className={`${styles.estimate_dot} ${assessment && assessment.delayDays > 0 ? styles['estimate_dot--yellow'] : styles['estimate_dot--green']}`} />
                <span className={styles.estimate_label}>预估最早交期</span>
                <span className={`${styles.estimate_value} ${assessment && assessment.delayDays > 0 ? styles['estimate_value--warning'] : ''}`}>
                  {assessment?.latestEstimatedCompletionDate ?? (form.deadline || '待评估')}
                  {form.deadline ? `（您期望：${form.deadline}）` : ''}
                </span>
              </div>
            </div>

            {assessment?.conflictingOrders && assessment.conflictingOrders.length > 0 && (
              <div className={`${styles.estimate_warning} ${styles.animate_slidedown}`}>
                <span className={styles.estimate_warning_icon}>⚠</span>
                <span className={styles.estimate_warning_text}>
                  冲突订单：{assessment.conflictingOrders.map((item) => item.orderNo).join('、')}
                </span>
              </div>
            )}

            {assessment && assessment.delayDays > 0 && (
              <div className={`${styles.estimate_warning} ${styles.animate_slidedown}`}>
                <span className={styles.estimate_warning_icon}>⚠</span>
                <span className={styles.estimate_warning_text}>
                  预估交期晚于期望 <strong>{assessment.delayDays} 天</strong>，建议与客户确认是否可接受。
                </span>
              </div>
            )}
          </div>
        </div>

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
                  {constraintChecks.map((check, index) => (
                    <div
                      key={index}
                      className={`${styles.constraint_item} ${check.passed ? styles['constraint_item--pass'] : styles['constraint_item--fail']}`}
                    >
                      <div className={`${styles.constraint_icon} ${check.passed ? styles['constraint_icon--pass'] : styles['constraint_icon--fail']}`}>
                        {check.passed ? '✓' : '✗'}
                      </div>
                      <div className={styles.constraint_text}>
                        <div className={`${styles.constraint_label} ${check.passed ? styles['constraint_label--pass'] : styles['constraint_label--fail']}`}>
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

      <footer className={styles.page_footer}>
        <Button variant="ghost" size="md" onClick={handleCancel}>取消</Button>
        <div className={styles.footer_spacer} />
        <Button
          variant="secondary"
          size="md"
          onClick={handleSaveDraft}
          loading={submitAction === 'draft'}
          disabled={isSubmitting}
        >
          保存草稿
        </Button>
        <Button
          variant={isUrgent ? 'warning' : 'primary'}
          size="lg"
          loading={submitAction === 'submit'}
          disabled={isSubmitting}
          onClick={() => void handleSubmit()}
        >
          {isUrgent ? (urgentAnalysisReady ? '提交插单申请' : '发起影响评估') : '确认订单'}
        </Button>
      </footer>

      <UrgentAnalysisModal
        open={urgentModalOpen}
        onCancel={handleCancelUrgent}
        steps={aiSteps}
        countdown={countdown}
      />
    </div>
  );
}
