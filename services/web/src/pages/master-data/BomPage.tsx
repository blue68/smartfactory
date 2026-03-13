/**
 * [artifact:前端代码] — BOM 管理页
 *
 * 100% 还原 docs/ui/web-bom-manage.html 设计稿：
 *   - 列表视图：SKU编码/成品名/BOM完整度(进度条)/物料种数/关联订单/操作
 *   - Summary Strip：全部/已完成/进行中/未开始 + 警告 Banner
 *   - BOM 编辑器视图：左树形面板 + 右物料详情面板(含品类成本占比 & AI建议)
 *   - BOM快速录入向导 Modal (4步骤 Stepper + SKU 选择)
 *
 * API 联调说明：
 *   - 列表：useBomList() → GET /api/bom，返回 BomHeader[]，前端映射为 BomListRow
 *   - 编辑器 BOM 树：useBomExpanded(id) → GET /api/bom/:id/expand（已接入）
 *   - AI 建议：useAiBomSuggestion(skuId) → GET /api/bom/ai-suggestion/:skuId（已接入）
 *   - 新建 BOM：useCreateBom() → POST /api/bom（已接入）
 *   - 品类成本占比：useCostBreakdown(bomId) → GET /api/bom/:id/cost-breakdown（已接入）
 *   - skuCode：后端 listBoms() 已返回 skuCode，前端直接使用
 *   - materialCount：后端 listBoms() 已返回 itemCount 子查询，前端直接使用
 *   - orderCount：后端无关联订单统计字段，显示 `—`
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useBomList, useBomExpanded, useActivateBom, useCreateBom, useUpdateBom, useCopyBom, useAiBomSuggestion, useAddBomItem, useDeleteBomItem, useUpdateBomItem, useMaterialRequirements, useCostBreakdown } from '@/api/bom';
import { useQuery } from '@tanstack/react-query';
import { useSkuCategories, useSkuList, skuApi, skuKeys } from '@/api/sku';
import type { BomHeader, BomItem } from '@/types/models';
import { BomStatus, Category1Code } from '@/types/enums';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import BomTree from '@/components/common/BomTree';
import styles from './BomPage.module.css';

/* ──────────────────────────────────────────────────────────────
   类型定义
────────────────────────────────────────────────────────────── */

interface BomListRow {
  id: number;
  /** skuId 用于 AI 建议等需要 skuId 的 API 调用 */
  skuId: number;
  skuCode: string;
  skuName: string;
  hasAlert: boolean;
  alertText?: string;
  /** 由 BomStatus 映射：active=100, draft=50, archived=0 */
  completionPct: number;
  /** 列表接口不返回明细，故为 null（显示 "—"） */
  materialCount: number | null;
  /** 后端无关联订单统计字段，固定显示 0 */
  orderCount: number;
  /** 原始 BomStatus，供状态标签使用 */
  status: BomStatus;
}

/**
 * 将后端 BomHeader 映射为前端展示用 BomListRow。
 * 映射规则：
 *   - skuCode: 后端已返回，fallback 使用 `SKU-{id}` 占位
 *   - completionPct: active→100, draft→50, archived→0
 *   - materialCount: 列表不含明细，null
 *   - orderCount: 后端无此字段，固定 0
 *   - hasAlert: 仅 draft 状态 BOM 标注提示（可能影响采购建议）
 */
function mapBomHeaderToRow(h: BomHeader): BomListRow {
  const completionPct =
    h.status === BomStatus.ACTIVE   ? 100 :
    h.status === BomStatus.DRAFT    ? 50  :
    /* archived */ 0;

  // draft 状态的 BOM 可能有在产订单依赖，给出提示
  const hasAlert = h.status === BomStatus.DRAFT;

  return {
    id: h.id,
    skuId: h.skuId,
    skuCode: h.skuCode ?? `SKU-${String(h.skuId).padStart(5, '0')}`,
    skuName: h.skuName,
    hasAlert,
    alertText: hasAlert ? 'BOM草稿未激活，影响采购建议' : undefined,
    completionPct,
    materialCount: h.itemCount ?? null,
    orderCount: 0,
    status: h.status as BomStatus,
  };
}

/* 品类成本占比 — 色板（按品类索引循环使用） */
const COST_COLORS = ['#7C3AED', '#C2774A', '#059669', '#94A3B8', '#CBD5E1', '#2563EB', '#D97706', '#DC2626'];

/* AI BOM建议行
 * TODO: 后端 GET /api/bom/ai-suggestion/:skuId 可返回真实数据，
 *       但当前展示格式不同（后端返回 suggestedItems），保留静态 mock 用于编辑器面板展示。
 */
/* AI_BOM_ROWS mock 已替换为 useAiBomSuggestion 真实接口 */

/* ──────────────────────────────────────────────────────────────
   辅助：BOM 完整度进度条
────────────────────────────────────────────────────────────── */

function BomProgress({ pct }: { pct: number }) {
  let fillClass = styles.bom_progress__fill;
  let pctClass  = styles.bom_progress__pct;

  if (pct === 100)        { fillClass += ` ${styles['bom_progress__fill--100']}`;  pctClass += ` ${styles['bom_progress__pct--100']}`; }
  else if (pct >= 60)     { fillClass += ` ${styles['bom_progress__fill--high']}`; pctClass += ` ${styles['bom_progress__pct--high']}`; }
  else if (pct >= 20)     { fillClass += ` ${styles['bom_progress__fill--mid']}`;  pctClass += ` ${styles['bom_progress__pct--mid']}`; }
  else if (pct > 0)       { fillClass += ` ${styles['bom_progress__fill--low']}`;  pctClass += ` ${styles['bom_progress__pct--low']}`; }
  else                    { fillClass += ` ${styles['bom_progress__fill--zero']}`; pctClass += ` ${styles['bom_progress__pct--zero']}`; }

  return (
    <div className={styles.bom_progress}>
      <div className={styles.bom_progress__bar_wrap}>
        <div className={styles.bom_progress__track}>
          <div className={fillClass} style={{ width: `${pct}%` }} />
        </div>
        <span className={pctClass}>{pct}%</span>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   辅助：操作按钮（根据完整度决定样式/文案）
────────────────────────────────────────────────────────────── */

function RowActionBtn({ row, onEdit }: { row: BomListRow; onEdit: (row: BomListRow) => void }) {
  if (row.completionPct === 100) {
    return <Button variant="primary" size="sm" onClick={() => onEdit(row)}>查看/编辑</Button>;
  }
  if (row.completionPct === 0) {
    return <Button variant="primary" size="sm" onClick={() => onEdit(row)}>开始录入</Button>;
  }
  // accent → 用 secondary 配橙色 inline style 替代，因 Button 没有 accent variant
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => onEdit(row)}
      style={{ background: 'var(--color-accent-500, #f97316)', color: '#fff', borderColor: 'transparent' }}
    >
      继续录入
    </Button>
  );
}

/* ──────────────────────────────────────────────────────────────
   BOM-REM-002: 复制按钮 + 复制 Modal（接入 useCopyBom）
────────────────────────────────────────────────────────────── */

function CopyBomBtn({ row }: { row: BomListRow }) {
  const { showToast } = useAppStore();
  const [open, setOpen] = useState(false);
  const [newVersion, setNewVersion] = useState('');
  const copyBom = useCopyBom();

  const handleOpen = () => {
    setNewVersion('');
    setOpen(true);
  };

  const handleConfirm = async () => {
    const trimmed = newVersion.trim();
    if (!trimmed) {
      showToast({ type: 'error', message: '请输入新版本号' });
      return;
    }
    try {
      await copyBom.mutateAsync({ id: row.id, newVersion: trimmed });
      showToast({ type: 'success', message: `BOM 已复制为新草稿（版本 ${trimmed}）` });
      setOpen(false);
    } catch {
      showToast({ type: 'error', message: '复制BOM失败，请稍后重试' });
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={handleOpen}>
        复制
      </Button>
      <Modal
        open={open}
        title="复制 BOM"
        onClose={() => setOpen(false)}
        onConfirm={handleConfirm}
        confirmLabel={copyBom.isPending ? '复制中...' : '确认复制'}
        cancelLabel="取消"
        size="sm"
      >
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          将在「{row.skuName}」下创建一个新草稿版本，不影响现有 BOM。
        </p>
        <div>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.875rem' }}>
            新版本号
          </label>
          <input
            type="text"
            value={newVersion}
            onChange={(e) => setNewVersion(e.target.value)}
            placeholder="例如：1.1、v2.0"
            autoFocus
            style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', boxSizing: 'border-box' }}
          />
        </div>
      </Modal>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────
   辅助：向导 Modal（4步骤 + SKU 选择）
────────────────────────────────────────────────────────────── */

interface WizardSkuItem {
  code: string;
  name: string;
  skuId: number;
  alertText?: string;
  hasBom?: boolean;
  bomStatus?: BomStatus;
}

interface WizardModalProps {
  open: boolean;
  onClose: () => void;
  onComplete: (data: {
    skuId: number;
    skuCode: string;
    skuName: string;
    version: string;
    items: Array<{ componentSkuId: number; quantity: string; unit: string }>;
  }) => void;
  skuItems: WizardSkuItem[];
  submitting?: boolean;
}

/** Step 2 中 AI 建议条目（可勾选 / 可编辑用量） */
interface AiWizardItem {
  skuId: number;
  skuName: string;
  quantity: string;
  unit: string;
  confidence: number;
  checked: boolean;
}

/** Step 2 中手动追加的物料条目 */
interface ManualWizardItem {
  componentSkuId: number;
  skuCode: string;
  skuName: string;
  quantity: string;
  unit: string;
}

const WIZARD_STEPS = ['选择成品', 'AI推荐', '填写用量', '确认'];
const UNIT_OPTIONS = ['个', '张', '米', '套', '副', '瓶', '桶', '卷', '块'];

function WizardModal({ open, onClose, onComplete, skuItems, submitting }: WizardModalProps) {
  /* ── Step 0 状态（单选） ── */
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  /* ── 多步流程状态 ── */
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedSkuId, setSelectedSkuId] = useState<number | null>(null);
  const [selectedSkuCode, setSelectedSkuCode] = useState('');
  const [selectedSkuName, setSelectedSkuName] = useState('');
  /* ── Step 1 AI 建议列表 ── */
  const [aiItems, setAiItems] = useState<AiWizardItem[]>([]);
  /* ── Step 2 手动追加列表 ── */
  const [manualItems, setManualItems] = useState<ManualWizardItem[]>([]);
  const [manualSearch, setManualSearch] = useState('');
  const [manualQty, setManualQty] = useState('1');
  const [manualUnit, setManualUnit] = useState('个');
  const [manualSelectedSku, setManualSelectedSku] = useState<{ id: number; skuCode: string; name: string; stockUnit: string } | null>(null);
  /* ── Step 3 版本号 ── */
  const [version, setVersion] = useState('1.0');

  /* ── 手动搜索 SKU ── */
  const manualSkuQuery = useSkuList({ keyword: manualSearch, pageSize: 20 });
  const manualSkuList = manualSearch.trim().length >= 1 ? (manualSkuQuery.data?.list ?? []) : [];

  /* ── AI 建议（仅 Step 1 时触发） ── */
  const { data: wizardAiSuggestion, isLoading: wizardAiLoading } = useAiBomSuggestion(
    currentStep >= 1 ? selectedSkuId : null,
  );

  /* ── 当 AI 建议返回时，初始化 aiItems（全部默认勾选） ── */
  useEffect(() => {
    if (wizardAiSuggestion) {
      setAiItems(
        wizardAiSuggestion.suggestedItems.map((s) => ({
          skuId: s.skuId,
          skuName: s.skuName,
          quantity: s.quantity,
          unit: s.unit,
          confidence: s.confidence,
          checked: true,
        })),
      );
    }
  }, [wizardAiSuggestion]);

  /* ── 当 open 变化时，重置向导状态 ── */
  useEffect(() => {
    if (!open) {
      setCurrentStep(0);
      setSelectedSkuId(null);
      setSelectedSkuCode('');
      setSelectedSkuName('');
      setAiItems([]);
      setManualItems([]);
      setManualSearch('');
      setManualSelectedSku(null);
      setManualQty('1');
      setManualUnit('个');
      setVersion('1.0');
      setConfirmError('');
    }
  }, [open]);

  /* ── 当 skuItems 变化时，默认选中第一个无 BOM 的成品 ── */
  useEffect(() => {
    const noBom = skuItems.find(s => !s.hasBom);
    setSelectedCode(noBom ? noBom.code : (skuItems[0]?.code ?? null));
  }, [skuItems]);

  /* ── Step 1：切换 AI 建议项勾选 ── */
  const toggleAiItem = (skuId: number) => {
    setAiItems(prev => prev.map(item => item.skuId === skuId ? { ...item, checked: !item.checked } : item));
  };

  /* ── Step 1：修改 AI 建议项用量 ── */
  const updateAiItemQty = (skuId: number, qty: string) => {
    setAiItems(prev => prev.map(item => item.skuId === skuId ? { ...item, quantity: qty } : item));
  };

  /* ── Step 2：添加手动物料 ── */
  const addManualItem = () => {
    if (!manualSelectedSku) return;
    const exists = manualItems.some(m => m.componentSkuId === manualSelectedSku.id);
    if (!exists) {
      setManualItems(prev => [...prev, {
        componentSkuId: manualSelectedSku.id,
        skuCode: manualSelectedSku.skuCode,
        skuName: manualSelectedSku.name,
        quantity: manualQty || '1',
        unit: manualUnit,
      }]);
    }
    setManualSelectedSku(null);
    setManualSearch('');
    setManualQty('1');
    setManualUnit('个');
  };

  /* ── Step 2：删除手动物料 ── */
  const removeManualItem = (componentSkuId: number) => {
    setManualItems(prev => prev.filter(m => m.componentSkuId !== componentSkuId));
  };

  /* ── Step 2：修改手动物料用量/单位 ── */
  const updateManualItem = (componentSkuId: number, field: 'quantity' | 'unit', value: string) => {
    setManualItems(prev => prev.map(m => m.componentSkuId === componentSkuId ? { ...m, [field]: value } : m));
  };

  /* ── Step 2：同步来自 Step 1 勾选项的用量（在 Step 3 确认时合并） ── */
  const QTY_REGEX = /^\d+(\.\d{1,4})?$/;
  const getFinalItems = (): Array<{ componentSkuId: number; quantity: string; unit: string }> | null => {
    const aiSelected = aiItems
      .filter(item => item.checked)
      .map(item => ({ componentSkuId: item.skuId, quantity: item.quantity, unit: item.unit }));
    // 手动追加：去重（以 componentSkuId 为 key，手动优先）
    const aiSkuIds = new Set(aiSelected.map(a => a.componentSkuId));
    const manualFiltered = manualItems.filter(m => !aiSkuIds.has(m.componentSkuId));
    const all = [...aiSelected, ...manualFiltered.map(m => ({
      componentSkuId: m.componentSkuId,
      quantity: m.quantity,
      unit: m.unit,
    }))];
    // P0-3: 校验所有数量格式
    const invalid = all.some(it => !QTY_REGEX.test(it.quantity) || Number(it.quantity) <= 0);
    if (invalid) return null;
    return all;
  };

  /* ── 下一步逻辑 ── */
  const handleNext = () => {
    if (currentStep === 0) {
      if (!selectedCode) return;
      const wizardItem = skuItems.find(s => s.code === selectedCode);
      if (!wizardItem) return;
      setSelectedSkuId(wizardItem.skuId);
      setSelectedSkuCode(wizardItem.code);
      setSelectedSkuName(wizardItem.name);
      setAiItems([]); // P1-1: 重置 AI 建议，防止缓存数据对应错误 SKU
      setCurrentStep(1);
    } else if (currentStep === 1) {
      setCurrentStep(2);
    } else if (currentStep === 2) {
      setCurrentStep(3);
    }
  };

  /* ── 上一步 ── */
  const handlePrev = () => {
    if (currentStep === 1) {
      setAiItems([]); // 回到 Step 0 时清空 AI 建议，防止缓存错误
    }
    if (currentStep > 0) setCurrentStep(prev => prev - 1);
  };

  /* ── 最终确认 ── */
  const [confirmError, setConfirmError] = useState('');
  const handleConfirm = () => {
    if (!selectedSkuId) return;
    const items = getFinalItems();
    if (!items) {
      setConfirmError('存在用量格式错误，请检查（数字，最多4位小数，必须大于0）');
      return;
    }
    setConfirmError('');
    onComplete({
      skuId: selectedSkuId,
      skuCode: selectedSkuCode,
      skuName: selectedSkuName,
      version: version.trim() || '1.0',
      items,
    });
  };

  /* ── Stepper 样式帮助函数 ── */
  const stepCircleClass = (i: number) => {
    if (i < currentStep) return `${styles.stepper__circle} ${styles['stepper__circle--completed']}`;
    if (i === currentStep) return `${styles.stepper__circle} ${styles['stepper__circle--active']}`;
    return `${styles.stepper__circle} ${styles['stepper__circle--pending']}`;
  };
  const stepLabelClass = (i: number) => {
    if (i <= currentStep) return `${styles.stepper__label} ${styles['stepper__label--active']}`;
    return `${styles.stepper__label} ${styles['stepper__label--pending']}`;
  };

  /* ── 当前步骤按钮组 ── */
  const renderFooterButtons = () => {
    const canNext0 = currentStep === 0 && selectedCode !== null;
    if (currentStep === 0) {
      return (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '1rem', borderTop: '1px solid var(--border-default)' }}>
          <button onClick={onClose} style={{ padding: '0.5rem 1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'white', cursor: 'pointer', fontSize: '0.875rem' }}>
            取消
          </button>
          <button
            onClick={handleNext}
            disabled={!canNext0}
            style={{ padding: '0.5rem 1.25rem', borderRadius: 'var(--radius-md)', border: 'none', background: canNext0 ? 'var(--color-primary-600, #2563eb)' : 'var(--color-disabled, #d1d5db)', color: 'white', cursor: canNext0 ? 'pointer' : 'not-allowed', fontSize: '0.875rem', fontWeight: 600 }}
          >
            下一步：获取AI推荐
          </button>
        </div>
      );
    }
    if (currentStep === 1) {
      return (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', paddingTop: '1rem', borderTop: '1px solid var(--border-default)' }}>
          <button onClick={handlePrev} style={{ padding: '0.5rem 1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'white', cursor: 'pointer', fontSize: '0.875rem' }}>
            上一步
          </button>
          <button
            onClick={handleNext}
            style={{ padding: '0.5rem 1.25rem', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-primary-600, #2563eb)', color: 'white', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 }}
          >
            下一步：确认用量
          </button>
        </div>
      );
    }
    if (currentStep === 2) {
      return (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', paddingTop: '1rem', borderTop: '1px solid var(--border-default)' }}>
          <button onClick={handlePrev} style={{ padding: '0.5rem 1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'white', cursor: 'pointer', fontSize: '0.875rem' }}>
            上一步
          </button>
          <button
            onClick={handleNext}
            style={{ padding: '0.5rem 1.25rem', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-primary-600, #2563eb)', color: 'white', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 }}
          >
            下一步：确认创建
          </button>
        </div>
      );
    }
    // Step 3
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', paddingTop: '1rem', borderTop: '1px solid var(--border-default)' }}>
        <button onClick={handlePrev} style={{ padding: '0.5rem 1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'white', cursor: 'pointer', fontSize: '0.875rem' }}>
          上一步
        </button>
        <button
          onClick={handleConfirm}
          disabled={submitting}
          style={{ padding: '0.5rem 1.25rem', borderRadius: 'var(--radius-md)', border: 'none', background: submitting ? 'var(--color-disabled, #d1d5db)' : 'var(--color-success-600, #059669)', color: 'white', cursor: submitting ? 'not-allowed' : 'pointer', fontSize: '0.875rem', fontWeight: 600 }}
        >
          {submitting ? '创建中...' : '确认创建 BOM'}
        </button>
      </div>
    );
  };

  return (
    <Modal
      open={open}
      title="BOM快速录入向导"
      onClose={onClose}
      size="lg"
    >
      {/* Stepper */}
      <div className={styles.stepper}>
        {WIZARD_STEPS.map((step, i) => (
          <div key={step} style={{ display: 'flex', alignItems: 'center', flex: i < WIZARD_STEPS.length - 1 ? 1 : 'unset' }}>
            <div className={styles.stepper__step}>
              <div className={stepCircleClass(i)}>
                {i < currentStep ? '✓' : i + 1}
              </div>
              <span className={stepLabelClass(i)}>{step}</span>
            </div>
            {i < WIZARD_STEPS.length - 1 && <div className={styles.stepper__line} />}
          </div>
        ))}
      </div>

      {/* ── Step 0：选择成品 ── */}
      {currentStep === 0 && (
        <>
          <p className={styles.wizard_hint}>请选择需要录入BOM的成品（优先录入BOM缺失的成品）：</p>
          {skuItems.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem 0' }}>
              暂无成品数据，请先在SKU主数据中添加成品
            </p>
          ) : (
            <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
              {skuItems.map((sku) => {
                const isSelected = selectedCode === sku.code;
                return (
                  <label
                    key={sku.code}
                    className={`${styles.wizard_item} ${isSelected ? styles['wizard_item--checked'] : ''}`}
                  >
                    <input
                      type="radio"
                      name="wizard-sku"
                      checked={isSelected}
                      onChange={() => setSelectedCode(sku.code)}
                    />
                    <span className={styles.wizard_item__code}>{sku.code}</span>
                    <span className={styles.wizard_item__name}>{sku.name}</span>
                    {sku.hasBom && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: 'auto' }}>已有BOM</span>}
                    {sku.alertText && <span className={styles.wizard_item__alert}>{sku.alertText}</span>}
                    {!sku.hasBom && !sku.alertText && <span style={{ fontSize: '0.75rem', color: 'var(--color-accent-500, #f97316)', marginLeft: 'auto' }}>待录入</span>}
                  </label>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Step 1：AI 推荐 ── */}
      {currentStep === 1 && (
        <div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            基于「<strong style={{ color: 'var(--text-primary)' }}>{selectedSkuName}</strong>」同品类已有BOM，AI 推荐以下物料：
          </p>
          {wizardAiLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '2rem 0', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              <div className="spinner" role="status" aria-label="AI分析中" />
              <span>AI 正在分析同品类BOM，请稍候...</span>
            </div>
          ) : aiItems.length === 0 ? (
            <div style={{ padding: '1.5rem', background: 'var(--color-bg-subtle, #f8fafc)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
              暂无AI建议，请在下一步手动填写物料
            </div>
          ) : (
            <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg-subtle, #f8fafc)' }}>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border-default)', fontWeight: 600, width: 36 }}></th>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border-default)', fontWeight: 600 }}>物料名称</th>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', borderBottom: '1px solid var(--border-default)', fontWeight: 600, width: 100 }}>用量</th>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', borderBottom: '1px solid var(--border-default)', fontWeight: 600, width: 80 }}>单位</th>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', borderBottom: '1px solid var(--border-default)', fontWeight: 600, width: 60 }}>置信度</th>
                  </tr>
                </thead>
                <tbody>
                  {aiItems.map((item) => {
                    const conf = item.confidence >= 70 ? 'high' : item.confidence >= 40 ? 'medium' : 'low';
                    const confLabel = item.confidence >= 70 ? '高' : item.confidence >= 40 ? '中' : '低';
                    return (
                      <tr key={item.skuId} style={{ borderBottom: '1px solid var(--border-subtle, #e5e7eb)', opacity: item.checked ? 1 : 0.45 }}>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                          <input type="checkbox" checked={item.checked} onChange={() => toggleAiItem(item.skuId)} />
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem', fontWeight: 500 }}>{item.skuName}</td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                          <input
                            type="number"
                            min="0.0001"
                            step="0.01"
                            value={item.quantity}
                            onChange={(e) => updateAiItemQty(item.skuId, e.target.value)}
                            disabled={!item.checked}
                            style={{ width: '80px', padding: '0.25rem 0.5rem', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm, 4px)', fontSize: '0.875rem', textAlign: 'right' }}
                          />
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{item.unit}</td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                          <span className={`${styles.confidence} ${styles[`confidence--${conf}`]}`}>
                            <span className={styles.confidence__dot} />{confLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary, #9ca3af)', marginTop: '0.5rem' }}>
                已勾选 {aiItems.filter(i => i.checked).length} / {aiItems.length} 项，可直接修改用量
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Step 2：填写用量 ── */}
      {currentStep === 2 && (
        <div>
          {/* 来自 AI 建议的已勾选物料 */}
          {aiItems.filter(i => i.checked).length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>AI推荐物料</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg-subtle, #f8fafc)' }}>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border-default)', fontWeight: 600 }}>物料名称</th>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', borderBottom: '1px solid var(--border-default)', fontWeight: 600, width: 100 }}>用量</th>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', borderBottom: '1px solid var(--border-default)', fontWeight: 600, width: 80 }}>单位</th>
                  </tr>
                </thead>
                <tbody>
                  {aiItems.filter(i => i.checked).map((item) => (
                    <tr key={item.skuId} style={{ borderBottom: '1px solid var(--border-subtle, #e5e7eb)' }}>
                      <td style={{ padding: '0.5rem 0.75rem', fontWeight: 500 }}>{item.skuName}</td>
                      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                        <input
                          type="number"
                          min="0.0001"
                          step="0.01"
                          value={item.quantity}
                          onChange={(e) => updateAiItemQty(item.skuId, e.target.value)}
                          style={{ width: '80px', padding: '0.25rem 0.5rem', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm, 4px)', fontSize: '0.875rem', textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{item.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 手动追加物料 */}
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>手动追加物料</div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 160, position: 'relative' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>搜索物料</label>
                {manualSelectedSku ? (
                  <div style={{ padding: '0.4rem 0.625rem', background: 'var(--bg-secondary, #f1f5f9)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontWeight: 500 }}>{manualSelectedSku.skuCode}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{manualSelectedSku.name}</span>
                    <button onClick={() => setManualSelectedSku(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1 }}>×</button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      placeholder="输入名称或编码搜索..."
                      value={manualSearch}
                      onChange={(e) => setManualSearch(e.target.value)}
                      style={{ width: '100%', padding: '0.4rem 0.625rem', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', boxSizing: 'border-box' }}
                    />
                    {manualSkuList.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: 'white', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', maxHeight: 160, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                        {manualSkuList.map(sku => (
                          <div
                            key={String(sku.id)}
                            onClick={() => { setManualSelectedSku({ id: Number(sku.id), skuCode: sku.skuCode, name: sku.name, stockUnit: sku.stockUnit }); setManualUnit(sku.stockUnit || '个'); setManualSearch(''); }}
                            style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid var(--border-default)', fontSize: '0.875rem' }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-secondary, #f1f5f9)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                          >
                            <span style={{ color: 'var(--color-primary-600)', marginRight: '0.5rem' }}>{sku.skuCode}</span>
                            {sku.name}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div style={{ width: 80 }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>用量</label>
                <input
                  type="number"
                  min="0.0001"
                  step="0.01"
                  value={manualQty}
                  onChange={(e) => setManualQty(e.target.value)}
                  style={{ width: '100%', padding: '0.4rem 0.5rem', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}
                />
              </div>
              <div style={{ width: 80 }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>单位</label>
                <select
                  value={manualUnit}
                  onChange={(e) => setManualUnit(e.target.value)}
                  style={{ width: '100%', padding: '0.4rem 0.5rem', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}
                >
                  {UNIT_OPTIONS.map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
              <button
                onClick={addManualItem}
                disabled={!manualSelectedSku}
                style={{ padding: '0.4rem 0.875rem', borderRadius: 'var(--radius-md)', border: 'none', background: manualSelectedSku ? 'var(--color-primary-600, #2563eb)' : 'var(--color-disabled, #d1d5db)', color: 'white', cursor: manualSelectedSku ? 'pointer' : 'not-allowed', fontSize: '0.875rem', whiteSpace: 'nowrap', alignSelf: 'flex-end' }}
              >
                + 添加
              </button>
            </div>
          </div>

          {/* 已手动添加的物料列表 */}
          {manualItems.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', marginTop: '0.5rem' }}>
              <thead>
                <tr style={{ background: 'var(--color-bg-subtle, #f8fafc)' }}>
                  <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border-default)', fontWeight: 600 }}>物料名称</th>
                  <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', borderBottom: '1px solid var(--border-default)', fontWeight: 600, width: 100 }}>用量</th>
                  <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', borderBottom: '1px solid var(--border-default)', fontWeight: 600, width: 80 }}>单位</th>
                  <th style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-default)', width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {manualItems.map((item) => (
                  <tr key={item.componentSkuId} style={{ borderBottom: '1px solid var(--border-subtle, #e5e7eb)' }}>
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      <div style={{ fontWeight: 500 }}>{item.skuName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.skuCode}</div>
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                      <input
                        type="number"
                        min="0.0001"
                        step="0.01"
                        value={item.quantity}
                        onChange={(e) => updateManualItem(item.componentSkuId, 'quantity', e.target.value)}
                        style={{ width: '80px', padding: '0.25rem 0.5rem', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm, 4px)', fontSize: '0.875rem', textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                      <select
                        value={item.unit}
                        onChange={(e) => updateManualItem(item.componentSkuId, 'unit', e.target.value)}
                        style={{ padding: '0.25rem 0.375rem', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm, 4px)', fontSize: '0.875rem' }}
                      >
                        {UNIT_OPTIONS.map(u => <option key={u}>{u}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                      <button
                        onClick={() => removeManualItem(item.componentSkuId)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger-600, #dc2626)', fontSize: '1rem', lineHeight: 1 }}
                        title="删除"
                      >×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {aiItems.filter(i => i.checked).length === 0 && manualItems.length === 0 && (
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '1rem 0' }}>
              暂无物料，请手动搜索添加
            </p>
          )}
        </div>
      )}

      {/* ── Step 3：确认 ── */}
      {currentStep === 3 && (
        <div>
          {/* BOM 基本信息 */}
          <div style={{ background: 'var(--color-bg-subtle, #f8fafc)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>成品名称</div>
                <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{selectedSkuName}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>SKU编码</div>
                <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--color-primary-600)' }}>{selectedSkuCode}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>版本号</div>
                <input
                  type="text"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="1.0"
                  style={{ padding: '0.25rem 0.5rem', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm, 4px)', fontSize: '0.875rem', width: '80px' }}
                />
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>物料总数</div>
                <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{(getFinalItems() ?? []).length} 种</div>
              </div>
            </div>
          </div>

          {/* 物料明细预览 */}
          <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.5rem' }}>物料明细（只读预览）</div>
          {confirmError && (
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-error-600, #dc2626)', marginBottom: '0.5rem' }}>{confirmError}</p>
          )}
          {(getFinalItems() ?? []).length === 0 ? (
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', padding: '0.75rem 0' }}>
              暂无物料，创建后可在编辑器中继续添加
            </p>
          ) : (
            <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg-subtle, #f8fafc)', position: 'sticky', top: 0 }}>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border-default)', fontWeight: 600 }}>物料</th>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', borderBottom: '1px solid var(--border-default)', fontWeight: 600, width: 80 }}>用量</th>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', borderBottom: '1px solid var(--border-default)', fontWeight: 600, width: 60 }}>单位</th>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', borderBottom: '1px solid var(--border-default)', fontWeight: 600, width: 60 }}>来源</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const aiSkuIds = new Set(aiItems.filter(i => i.checked).map(i => i.skuId));
                    return (getFinalItems() ?? []).map((item) => {
                      const isAi = aiSkuIds.has(item.componentSkuId);
                      const nameInfo = isAi
                        ? aiItems.find(a => a.skuId === item.componentSkuId)?.skuName
                        : manualItems.find(m => m.componentSkuId === item.componentSkuId)?.skuName;
                      return (
                        <tr key={item.componentSkuId} style={{ borderBottom: '1px solid var(--border-subtle, #e5e7eb)' }}>
                          <td style={{ padding: '0.5rem 0.75rem', fontWeight: 500 }}>{nameInfo ?? `SKU-${item.componentSkuId}`}</td>
                          <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: 'var(--text-secondary)' }}>{item.quantity}</td>
                          <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{item.unit}</td>
                          <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                            <span style={{ fontSize: '0.75rem', padding: '0.125rem 0.375rem', borderRadius: 'var(--radius-sm, 4px)', background: isAi ? 'var(--color-primary-50, #eff6ff)' : 'var(--color-accent-50, #fff7ed)', color: isAi ? 'var(--color-primary-700, #1d4ed8)' : 'var(--color-accent-700, #c2410c)' }}>
                              {isAi ? 'AI' : '手动'}
                            </span>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 步骤导航按钮 */}
      {renderFooterButtons()}
    </Modal>
  );
}

/* ──────────────────────────────────────────────────────────────
   辅助：品类成本占比区块
────────────────────────────────────────────────────────────── */

function CostBreakdown({ bomId }: { bomId: number }) {
  const { data, isLoading } = useCostBreakdown(bomId);

  if (isLoading) {
    return (
      <div className={styles.cost_breakdown} role="region" aria-label="BOM品类成本占比">
        <div className={styles.cost_breakdown__header}>
          <span className={styles.cost_breakdown__title}>品类成本占比</span>
        </div>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', padding: '1rem 0' }}>正在计算成本...</p>
      </div>
    );
  }

  if (!data || data.segments.length === 0) {
    return (
      <div className={styles.cost_breakdown} role="region" aria-label="BOM品类成本占比">
        <div className={styles.cost_breakdown__header}>
          <span className={styles.cost_breakdown__title}>品类成本占比</span>
        </div>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', padding: '1rem 0' }}>暂无成本数据（物料未关联报价）</p>
      </div>
    );
  }

  return (
    <div className={styles.cost_breakdown} role="region" aria-label="BOM品类成本占比">
      <div className={styles.cost_breakdown__header}>
        <span className={styles.cost_breakdown__title}>品类成本占比</span>
        <span className={styles.cost_breakdown__total}>
          BOM总估算：<strong>¥{data.bomTotal}</strong>
        </span>
      </div>

      {/* 横向堆叠条 */}
      <div className={styles.cost_bar_track} role="img" aria-label="各品类成本占比">
        {data.segments.map((seg, i) => (
          <div
            key={seg.categoryName}
            className={styles.cost_bar_seg}
            style={{ width: `${seg.percentage}%`, background: COST_COLORS[i % COST_COLORS.length] }}
            data-tip={`${seg.categoryName} ${seg.percentage}%`}
          />
        ))}
      </div>

      {/* 明细列表 */}
      <div className={styles.cost_detail_list} role="list">
        {data.segments.map((seg, i) => (
          <div key={seg.categoryName} className={styles.cost_detail_item} role="listitem">
            <span className={styles.cost_detail_item__dot} style={{ background: COST_COLORS[i % COST_COLORS.length] }} aria-hidden="true" />
            <span className={styles.cost_detail_item__name}>{seg.categoryName}</span>
            <span className={styles.cost_detail_item__amt}>¥{seg.totalCost}</span>
            <span className={styles.cost_detail_item__pct}>{seg.percentage}%</span>
          </div>
        ))}
      </div>

      {data.missingPriceCount > 0 && (
        <div className={styles.cost_breakdown__warning} role="note">
          <span aria-hidden="true">⚠</span>
          <span>
            <strong>{data.missingPriceCount} 个物料</strong>价格未维护，成本按 ¥0 计算，实际总成本可能更高。
          </span>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   辅助：BOM 编辑器视图（左树 + 右详情）
────────────────────────────────────────────────────────────── */

interface EditorViewProps {
  row: BomListRow;
  onBack: () => void;
}

function EditorView({ row, onBack }: EditorViewProps) {
  const { showToast } = useAppStore();

  // 树形数据：通过真实 API 获取展开 BOM（id 用 row.id）
  const { data: detailData, isLoading: detailLoading } = useBomExpanded(row.id);

  // AI 建议：根据 skuId 获取同品类 BOM 物料推荐
  const { data: aiSuggestion, isLoading: aiLoading } = useAiBomSuggestion(row.skuId);

  // BOM 是否为空（新建草稿）
  const isBomEmpty = !detailLoading && (!detailData || detailData.items.length === 0);

  // 树节点选中
  const [selectedItem, setSelectedItem] = useState<BomItem | null>(null);

  const handleSelectItem = useCallback((item: BomItem) => {
    setSelectedItem((prev) => (prev?.bomItemId === item.bomItemId ? null : item));
  }, []);

  // 新增物料弹框状态
  const [addMatOpen, setAddMatOpen] = useState(false);
  const [matSearch, setMatSearch] = useState('');
  const [matCategoryId, setMatCategoryId] = useState<number | undefined>(undefined);
  const [matQty, setMatQty] = useState('1');
  const [matUnit, setMatUnit] = useState('个');
  const [matScrapRate, setMatScrapRate] = useState('0');
  const [matSelectedSku, setMatSelectedSku] = useState<{ id: number; skuCode: string; name: string; stockUnit: string } | null>(null);

  // 物料分类列表（level 1）
  const { data: matCategories } = useSkuCategories();
  const matLevel1Cats = useMemo(() => (matCategories ?? []).filter(c => c.level === 1), [matCategories]);

  // 搜索物料（支持分类筛选）
  const matSkuQuery = useSkuList({ keyword: matSearch, category1Id: matCategoryId, pageSize: 20 });
  const matSkuList = (matSearch.trim().length >= 1 || matCategoryId) ? (matSkuQuery.data?.list ?? []) : [];

  const addBomItem = useAddBomItem();
  const deleteBomItem = useDeleteBomItem();
  const activateBom = useActivateBom();
  const updateBomItem = useUpdateBomItem();

  // 激活确认对话框状态
  const [activateConfirmOpen, setActivateConfirmOpen] = useState(false);

  // 删除物料确认弹框状态
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // 修改用量弹框状态
  const [editQtyOpen, setEditQtyOpen] = useState(false);
  const [editQtyValue, setEditQtyValue] = useState('');
  const [editUnitValue, setEditUnitValue] = useState('');

  // BOM-REM-001: 编辑信息弹框状态（版本号 / 描述，接入 useUpdateBom）
  const [editInfoOpen, setEditInfoOpen] = useState(false);
  const [editVersion, setEditVersion] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const updateBom = useUpdateBom();

  // TASK-BOM-03: 物料需求计算弹框状态
  const [calcReqOpen, setCalcReqOpen] = useState(false);
  const [calcReqQty, setCalcReqQty] = useState('100');
  const [calcReqSubmitted, setCalcReqSubmitted] = useState(false);
  const { data: reqData, isLoading: reqLoading } = useMaterialRequirements(
    calcReqSubmitted ? row.id : null,
    calcReqSubmitted ? Number(calcReqQty) : 0,
  );

  // TASK-BOM-04: AI 批量导入状态
  const [batchImporting, setBatchImporting] = useState(false);

  // TASK-BOM-04: 提取为命名函数
  const handleBatchImport = async () => {
    if (!aiSuggestion) return;
    if (row.status !== BomStatus.DRAFT) {
      showToast({ type: 'error', message: '仅草稿状态的 BOM 可批量导入物料' });
      return;
    }
    // 按 skuId 去重，防止重复物料并发写入
    const seen = new Set<number>();
    const uniqueItems = aiSuggestion.suggestedItems.filter((r) => {
      if (seen.has(r.skuId)) return false;
      seen.add(r.skuId);
      return true;
    });
    setBatchImporting(true);
    try {
      const results = await Promise.allSettled(
        uniqueItems.map((r) =>
          addBomItem.mutateAsync({
            bomId: row.id,
            item: { componentSkuId: r.skuId, quantity: r.quantity, unit: r.unit },
          })
        )
      );
      const succeeded = results.filter((res) => res.status === 'fulfilled').length;
      const failed = results.filter((res) => res.status === 'rejected').length;
      showToast({
        type: failed === 0 ? 'success' : 'error',
        message: `成功添加 ${succeeded} 项${failed > 0 ? `，失败 ${failed} 项` : ''}`,
      });
    } finally {
      setBatchImporting(false);
    }
  };

  const handleOpenEditInfo = () => {
    setEditVersion(detailData?.version ?? '');
    setEditDesc(detailData?.description ?? '');
    setEditInfoOpen(true);
  };

  const handleSaveInfo = async () => {
    try {
      await updateBom.mutateAsync({ id: row.id, data: { version: editVersion, description: editDesc } });
      showToast({ type: 'success', message: 'BOM信息已更新' });
      setEditInfoOpen(false);
    } catch {
      showToast({ type: 'error', message: '保存失败，请稍后重试' });
    }
  };

  const handleAddMaterial = async () => {
    if (!matSelectedSku) { showToast({ type: 'error', message: '请先选择物料' }); return; }
    if (!matQty || Number(matQty) <= 0) { showToast({ type: 'error', message: '请输入有效用量' }); return; }
    try {
      await addBomItem.mutateAsync({
        bomId: row.id,
        item: {
          componentSkuId: Number(matSelectedSku.id),
          quantity: matQty,
          unit: matUnit,
          scrapRate: matScrapRate && Number(matScrapRate) > 0 ? (Number(matScrapRate) / 100).toFixed(4) : undefined,
        },
      });
      showToast({ type: 'success', message: `物料「${matSelectedSku.name}」已添加` });
      setAddMatOpen(false);
      setMatSearch('');
      setMatCategoryId(undefined);
      setMatSelectedSku(null);
      setMatQty('1');
      setMatUnit('个');
      setMatScrapRate('0');
    } catch {
      showToast({ type: 'error', message: '添加物料失败' });
    }
  };

  const handleDeleteItem = () => {
    if (!selectedItem) return;
    setDeleteConfirmOpen(true);
  };

  const confirmDeleteItem = async () => {
    if (!selectedItem) return;
    try {
      await deleteBomItem.mutateAsync({ bomId: row.id, itemId: selectedItem.bomItemId });
      showToast({ type: 'success', message: `已删除物料「${selectedItem.skuName}」` });
      setSelectedItem(null);
      setDeleteConfirmOpen(false);
    } catch {
      showToast({ type: 'error', message: '删除物料失败，请稍后重试' });
    }
  };

  const handleActivate = async () => {
    try {
      await activateBom.mutateAsync(row.id);
      showToast({ type: 'success', message: 'BOM已激活，采购建议将使用最新BOM' });
      setActivateConfirmOpen(false);
    } catch {
      showToast({ type: 'error', message: '激活失败，请稍后重试' });
    }
  };

  void AddMaterialPanel; // reserved for future editor integration
  void MockBomTree; // reserved for demo/fallback mode

  return (
    <>
      {/* BOM-REM-001: 编辑信息弹框（版本号 / 描述） */}
      <Modal
        open={editInfoOpen}
        title="编辑 BOM 信息"
        onClose={() => setEditInfoOpen(false)}
        onConfirm={handleSaveInfo}
        confirmLabel={updateBom.isPending ? '保存中...' : '确认保存'}
        cancelLabel="取消"
        size="sm"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.875rem' }}>
              版本号
            </label>
            <input
              type="text"
              value={editVersion}
              onChange={(e) => setEditVersion(e.target.value)}
              placeholder="例如：1.0、v2.1"
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.875rem' }}>
              描述
            </label>
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              placeholder="BOM版本说明（可选）"
              rows={3}
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', resize: 'vertical', boxSizing: 'border-box' }}
            />
          </div>
        </div>
      </Modal>

      {/* 激活确认弹框 */}
      <Modal
        open={activateConfirmOpen}
        title="确认激活 BOM"
        onClose={() => setActivateConfirmOpen(false)}
        onConfirm={handleActivate}
        confirmLabel={activateBom.isPending ? '激活中...' : '确认激活'}
        cancelLabel="取消"
        size="sm"
      >
        <p style={{ fontSize: '0.9375rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>
          激活后 BOM 将进入<strong>生产就绪状态</strong>，AI 采购建议将基于此版本生成。
        </p>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
          激活后不可回退到草稿态，请确认物料信息无误。
        </p>
      </Modal>

      {/* 删除物料确认弹框 */}
      <Modal
        open={deleteConfirmOpen}
        title="确认删除物料"
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={confirmDeleteItem}
        confirmLabel={deleteBomItem.isPending ? '删除中...' : '确认删除'}
        cancelLabel="取消"
        size="sm"
      >
        <p style={{ fontSize: '0.9375rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>
          确定要删除物料「<strong>{selectedItem?.skuName}</strong>」吗？此操作不可撤销。
        </p>
      </Modal>

      {/* 修改用量弹框 */}
      <Modal
        open={editQtyOpen}
        title="修改物料用量"
        onClose={() => setEditQtyOpen(false)}
        onConfirm={async () => {
          if (!selectedItem) return;
          const qtyRegex = /^\d+(\.\d{1,4})?$/;
          const trimmedQty = editQtyValue.trim();
          if (!qtyRegex.test(trimmedQty) || Number(trimmedQty) <= 0) {
            showToast({ type: 'error', message: '用量格式不正确，请输入大于0的正数（最多4位小数）' });
            return;
          }
          if (!editUnitValue.trim()) {
            showToast({ type: 'error', message: '单位不能为空' });
            return;
          }
          try {
            await updateBomItem.mutateAsync({
              bomId: row.id,
              itemId: selectedItem.bomItemId,
              data: { quantity: editQtyValue.trim(), unit: editUnitValue.trim() },
            });
            showToast({ type: 'success', message: '用量已更新' });
            setEditQtyOpen(false);
          } catch {
            showToast({ type: 'error', message: '修改用量失败' });
          }
        }}
        confirmLabel={updateBomItem.isPending ? '保存中...' : '确认修改'}
        cancelLabel="取消"
        size="sm"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.875rem' }}>
              用量
            </label>
            <input
              type="text"
              value={editQtyValue}
              onChange={(e) => setEditQtyValue(e.target.value)}
              placeholder="请输入用量"
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.875rem' }}>
              单位
            </label>
            <input
              type="text"
              value={editUnitValue}
              onChange={(e) => setEditUnitValue(e.target.value)}
              placeholder="请输入单位"
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', boxSizing: 'border-box' }}
            />
          </div>
        </div>
      </Modal>

      {/* TASK-BOM-03: 物料需求计算弹框 */}
      <Modal
        open={calcReqOpen}
        title="物料需求计算"
        onClose={() => { setCalcReqOpen(false); setCalcReqSubmitted(false); setCalcReqQty('100'); }}
        onConfirm={() => {
          const qty = Number(calcReqQty);
          if (!calcReqQty || qty <= 0 || qty > 1000000 || !Number.isFinite(qty)) {
            showToast({ type: 'error', message: '请输入有效的生产数量（1 ~ 1,000,000）' });
            return;
          }
          setCalcReqSubmitted(true);
        }}
        confirmLabel="计算"
        cancelLabel="关闭"
        size="md"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.875rem' }}>
              生产数量
            </label>
            <input
              type="number"
              min={1}
              max={1000000}
              value={calcReqQty}
              onChange={(e) => { setCalcReqQty(e.target.value); setCalcReqSubmitted(false); }}
              placeholder="默认 100"
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', boxSizing: 'border-box' }}
            />
          </div>
          {calcReqSubmitted && (
            <>
              {reqLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                  <div className="spinner" role="status" aria-label="计算中" />
                  <span>正在计算物料需求...</span>
                </div>
              ) : reqData && reqData.length > 0 ? (
                <div>
                  <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.875rem' }}>需求清单（生产数量：{calcReqQty}）</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg-subtle, #f8fafc)' }}>
                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border-default)', fontWeight: 600 }}>物料名称</th>
                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', borderBottom: '1px solid var(--border-default)', fontWeight: 600 }}>单位用量</th>
                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', borderBottom: '1px solid var(--border-default)', fontWeight: 600 }}>总需求量</th>
                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', borderBottom: '1px solid var(--border-default)', fontWeight: 600 }}>单位</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reqData.map((r) => (
                        <tr key={r.skuId} style={{ borderBottom: '1px solid var(--border-subtle, #e5e7eb)' }}>
                          <td style={{ padding: '0.5rem 0.75rem' }}>
                            <div style={{ fontWeight: 500 }}>{r.skuName}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{r.skuCode}</div>
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: 'var(--text-secondary)' }}>—</td>
                          <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 600 }}>{r.totalQty}</td>
                          <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{r.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : reqData && reqData.length === 0 ? (
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>暂无物料需求数据，请先为BOM添加物料</p>
              ) : null}
            </>
          )}
        </div>
      </Modal>

      {/* 新增物料弹框 */}
      <Modal
        open={addMatOpen}
        title="新增物料"
        onClose={() => setAddMatOpen(false)}
        onConfirm={handleAddMaterial}
        confirmLabel={addBomItem.isPending ? '添加中...' : '确认添加'}
        cancelLabel="取消"
        size="md"
      >
        {/* 物料分类筛选 */}
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ width: 160 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.875rem' }}>物料分类</label>
            <select
              value={matCategoryId ?? ''}
              onChange={(e) => { setMatCategoryId(e.target.value ? Number(e.target.value) : undefined); setMatSelectedSku(null); }}
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}
            >
              <option value="">全部分类</option>
              {matLevel1Cats.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.875rem' }}>搜索物料</label>
            <input
              type="text"
              placeholder="输入物料名称或编码搜索..."
              value={matSearch}
              onChange={(e) => { setMatSearch(e.target.value); setMatSelectedSku(null); }}
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}
            />
          </div>
        </div>
        {/* 搜索结果下拉 */}
        {(matSearch.trim() || matCategoryId) && matSkuList.length > 0 && !matSelectedSku && (
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', marginBottom: '1rem' }}>
            {matSkuList.map(sku => (
              <div
                key={String(sku.id)}
                onClick={() => { setMatSelectedSku({ id: Number(sku.id), skuCode: sku.skuCode, name: sku.name, stockUnit: sku.stockUnit }); setMatUnit(sku.stockUnit || '个'); }}
                style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid var(--border-default)', fontSize: '0.875rem' }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'var(--bg-secondary)'; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.background = ''; }}
              >
                <span style={{ color: 'var(--color-primary-600)', marginRight: '0.5rem' }}>{sku.skuCode}</span>
                {sku.name}
                {sku.spec && <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>{sku.spec}</span>}
                <span style={{ color: 'var(--text-tertiary)', marginLeft: '0.5rem', fontSize: '0.75rem' }}>{sku.stockUnit}</span>
              </div>
            ))}
          </div>
        )}
        {(matSearch.trim() || matCategoryId) && matSkuList.length === 0 && !matSelectedSku && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>未找到匹配的物料</p>
        )}
        {/* 已选物料 */}
        {matSelectedSku && (
          <div style={{ padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', marginBottom: '1rem', fontSize: '0.875rem' }}>
            已选择：<strong>{matSelectedSku.skuCode}</strong> — {matSelectedSku.name}
            <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>（单位：{matSelectedSku.stockUnit || '个'}）</span>
            <button onClick={() => setMatSelectedSku(null)} style={{ marginLeft: '0.5rem', color: 'var(--color-primary-600)', background: 'none', border: 'none', cursor: 'pointer' }}>更换</button>
          </div>
        )}
        {/* 用量 / 单位 / 损耗率 */}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.875rem' }}>用量</label>
            <input
              type="number"
              min="0.0001"
              step="0.01"
              value={matQty}
              onChange={(e) => setMatQty(e.target.value)}
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}
            />
          </div>
          <div style={{ width: 100 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.875rem' }}>单位</label>
            <select
              value={matUnit}
              onChange={(e) => setMatUnit(e.target.value)}
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}
            >
              <option>个</option>
              <option>张</option>
              <option>米</option>
              <option>套</option>
              <option>副</option>
              <option>瓶</option>
              <option>桶</option>
              <option>卷</option>
              <option>块</option>
              {matSelectedSku?.stockUnit && !['个','张','米','套','副','瓶','桶','卷','块'].includes(matSelectedSku.stockUnit) && (
                <option>{matSelectedSku.stockUnit}</option>
              )}
            </select>
          </div>
          <div style={{ width: 120 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.875rem' }}>损耗率（%）</label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={matScrapRate}
              onChange={(e) => setMatScrapRate(e.target.value)}
              placeholder="0"
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}
            />
          </div>
        </div>
      </Modal>

      {/* 编辑器顶部导航 */}
      <div className={styles.editor_bar}>
        <Button variant="ghost" size="sm" onClick={onBack}>← 返回列表</Button>
        <div>
          <div className={styles.editor_meta__name}>{row.skuName}（{row.skuCode}）</div>
          <div className={styles.editor_meta__sub}>BOM版本：{detailData?.version ?? row.status} &nbsp;·&nbsp; 状态：{row.status === BomStatus.ACTIVE ? '已激活' : row.status === BomStatus.DRAFT ? '草稿' : '已归档'}</div>
        </div>
        <div className={styles.editor_actions}>
          {row.status === BomStatus.DRAFT && (
            <Button
              variant="secondary"
              onClick={() => setActivateConfirmOpen(true)}
              disabled={activateBom.isPending}
              style={{ background: 'var(--color-success-600)', color: '#fff', borderColor: 'transparent' }}
            >
              {activateBom.isPending ? '激活中...' : '激活'}
            </Button>
          )}
          <Button variant="primary" onClick={() => setAddMatOpen(true)}>
            + 新增物料
          </Button>
          {/* BOM-REM-001: 编辑信息入口，调用 useUpdateBom */}
          <Button variant="secondary" onClick={handleOpenEditInfo} disabled={updateBom.isPending}>
            编辑信息
          </Button>
          {/* TASK-BOM-03: 物料需求计算入口 */}
          <Button
            variant="secondary"
            onClick={() => setCalcReqOpen(true)}
          >
            需求计算
          </Button>
          {/* TASK-BOM-06: 导出 Excel */}
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                const res = await fetch(`/api/bom/${row.id}/export`, {
                  headers: { Authorization: `Bearer ${localStorage.getItem('sf_access_token') ?? ''}` },
                });
                if (!res.ok) throw new Error('导出失败');
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `bom-${row.skuCode}-${detailData?.version ?? row.id}.xlsx`;
                a.click();
                URL.revokeObjectURL(url);
                showToast({ type: 'success', message: 'BOM 导出成功' });
              } catch {
                showToast({ type: 'error', message: '导出失败，请稍后重试' });
              }
            }}
          >
            导出 Excel
          </Button>
        </div>
      </div>

      {/* 左右分栏 */}
      <div className={styles.bom_editor}>
        {/* ── 左：BOM 树形面板 ── */}
        <div className={styles.tree_panel}>
          <div className={styles.tree_panel__header}>
            <span className={styles.tree_panel__title}>BOM树形结构</span>
          </div>
          <div className={styles.tree_panel__body}>
            {detailLoading ? (
              <div className={styles.table_loading}>
                <div className="spinner" role="status" aria-label="加载中" />
                <div style={{ marginTop: '0.5rem' }}>加载BOM树...</div>
              </div>
            ) : detailData && detailData.items.length > 0 ? (
              <BomTree
                items={detailData.items}
                selectedId={selectedItem?.bomItemId}
                onSelect={handleSelectItem}
              />
            ) : (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📋</div>
                <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>BOM 暂无物料</div>
                <div style={{ fontSize: '0.875rem' }}>请点击右上角「+ 新增物料」添加，或参考右侧 AI 建议</div>
              </div>
            )}
          </div>
          <div className={styles.tree_panel__actions}>
            <Button variant="ghost" size="sm">展开全部</Button>
            <Button variant="ghost" size="sm">折叠全部</Button>
          </div>
        </div>

        {/* ── 右：物料详情面板 ── */}
        <div className={styles.detail_panel}>
          <div className={styles.detail_panel__header}>
            <span className={styles.detail_panel__title}>物料详情</span>
            {selectedItem && (
              <span className={styles.detail_panel__selected}>已选中：{selectedItem.skuName}</span>
            )}
          </div>
          <div className={styles.detail_panel__body}>
            {selectedItem ? (
              <>
                {/* 物料信息区域 */}
                <div className={styles.detail_section_title}>物料信息</div>
                <div className={styles.detail_row}>
                  <span className={styles.detail_row__label}>SKU编码</span>
                  <span className={`${styles.detail_row__value} ${styles['detail_row__value--code']}`}>
                    {selectedItem.skuCode}
                  </span>
                </div>
                <div className={styles.detail_row}>
                  <span className={styles.detail_row__label}>用量</span>
                  <span className={styles.detail_row__value}>
                    {selectedItem.quantity} {selectedItem.unit}（采购单位）
                  </span>
                </div>
                <div className={styles.detail_row}>
                  <span className={styles.detail_row__label}>规格</span>
                  <span className={styles.detail_row__value}>
                    {selectedItem.spec ?? '—'}
                  </span>
                </div>
                <div className={styles.detail_actions}>
                  <Button variant="secondary" size="sm" onClick={() => {
                    if (selectedItem) {
                      setEditQtyValue(selectedItem.quantity);
                      setEditUnitValue(selectedItem.unit);
                      setEditQtyOpen(true);
                    }
                  }}>
                    修改用量
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={styles.btn_delete}
                    disabled={deleteBomItem.isPending}
                    onClick={handleDeleteItem}
                  >
                    {deleteBomItem.isPending ? '删除中...' : '删除此物料'}
                  </Button>
                </div>
              </>
            ) : isBomEmpty ? (
              <div style={{ padding: '1.5rem 0', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                请通过「+ 新增物料」按钮添加物料，或参考下方 AI 建议快速构建 BOM。
              </div>
            ) : (
              <div style={{ padding: '1.5rem 0', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                请在左侧 BOM 树中选择一个物料节点查看详情。
              </div>
            )}

            {/* 品类成本占比（仅有物料时显示） */}
            {!isBomEmpty && <CostBreakdown bomId={row.id} />}

            {/* AI BOM 建议 */}
            <div className={styles.ai_panel}>
              <div className={styles.ai_panel__header}>
                <span className={styles.ai_panel__icon} aria-hidden="true">🤖</span>
                <span className={styles.ai_panel__title}>AI BOM建议</span>
              </div>
              {aiLoading ? (
                <p className={styles.ai_panel__sub}>AI 正在分析同品类BOM，请稍候...</p>
              ) : aiSuggestion && aiSuggestion.suggestedItems.length > 0 ? (
                <>
                  <p className={styles.ai_panel__sub}>
                    基于同品类已有BOM的物料使用频次，推荐以下物料构成：
                  </p>
                  <table className={styles.ai_bom_table}>
                    <thead>
                      <tr>
                        <th>物料名称</th>
                        <th>建议用量</th>
                        <th>置信度</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aiSuggestion.suggestedItems.map((r) => {
                        const conf = r.confidence >= 70 ? 'high' : r.confidence >= 40 ? 'medium' : 'low';
                        const confLabel = r.confidence >= 70 ? '高' : r.confidence >= 40 ? '中' : '低';
                        return (
                          <tr key={r.skuId}>
                            <td>{r.skuName}</td>
                            <td>{r.quantity} {r.unit}</td>
                            <td>
                              <span className={`${styles.confidence} ${styles[`confidence--${conf}`]}`}>
                                <span className={styles.confidence__dot} />
                                {confLabel}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className={styles.ai_panel__actions}>
                    {/* TASK-BOM-04: 一键批量导入 AI 建议 */}
                    <Button
                      variant="secondary"
                      size="sm"
                      style={{ background: 'var(--color-accent-500, #f97316)', color: '#fff', borderColor: 'transparent' }}
                      disabled={batchImporting}
                      onClick={handleBatchImport}
                    >
                      {batchImporting ? '导入中...' : '一键复用此BOM结构'}
                    </Button>
                    <Button variant="ghost" size="sm">忽略建议</Button>
                  </div>
                </>
              ) : (
                <p className={styles.ai_panel__sub} style={{ padding: '1rem 0' }}>
                  暂无AI建议（同品类下没有已激活的BOM可供参考）
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────
   辅助：添加物料面板
────────────────────────────────────────────────────────────── */

function AddMaterialPanel({ onConfirm }: { onConfirm: () => void }) {
  const [qty, setQty] = useState('4');
  const [unit, setUnit] = useState('副');
  const [search, setSearch] = useState('');

  return (
    <div className={styles.add_mat_panel}>
      <div className={styles.add_mat_panel__title}>+ 添加物料到：门板组件</div>
      <div className={styles.add_mat_search}>
        <div className={styles.add_mat_search_wrap}>
          <span className={styles.add_mat_search_icon} aria-hidden="true">🔍</span>
          <input
            className={styles.add_mat_search_input}
            type="text"
            placeholder="搜索物料名称或编码…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className={styles.add_mat_selected}>已选择：五金滑轨 500mm</span>
      </div>
      <div className={styles.add_mat_form}>
        <div className={styles.form_group}>
          <label className={styles.form_label}>用量</label>
          <input
            className={styles.form_input}
            type="number"
            value={qty}
            min="0.01"
            step="0.01"
            onChange={(e) => setQty(e.target.value)}
          />
        </div>
        <div className={styles.form_group}>
          <label className={styles.form_label}>单位</label>
          <select className={styles.form_select} value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option>副</option>
            <option>个</option>
            <option>套</option>
          </select>
        </div>
        <div className={styles.add_mat_btn_group}>
          <Button variant="ghost" size="sm">取消</Button>
          <Button
            variant="success"
            size="sm"
            onClick={onConfirm}
          >
            确认添加
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   辅助：Mock BOM 树（当 API 无数据时展示设计稿树结构）
────────────────────────────────────────────────────────────── */

interface MockBomTreeProps {
  onSelect: (name: string) => void;
}

function MockBomTree({ onSelect }: MockBomTreeProps) {
  const [selected, setSelected] = useState('rm12');
  const [open, setOpen] = useState<Record<string, boolean>>({
    root: true, cabinet: true, door: true,
  });

  const toggle = (key: string) => setOpen((p) => ({ ...p, [key]: !p[key] }));
  const select = (key: string, name: string) => { setSelected(key); onSelect(name); };

  const rowCls = (key: string) =>
    `${styles.tree_node_row} ${selected === key ? styles.tree_node_row_selected : ''}`;

  return (
    <div role="tree" aria-label="BOM 物料树">
      {/* Root */}
      <div>
        <div className={rowCls('root')} onClick={() => { toggle('root'); select('root', '红橡实木书柜 1.8m'); }} style={ROW_STYLE(0)}>
          <span style={TOGGLE_STYLE(open['root'])}>▶</span>
          <span style={{ fontSize: '1rem' }}>📦</span>
          <span style={LABEL_STYLE(false)}>红橡实木书柜 1.8m</span>
          <span style={QTY_STYLE}>[1 套]</span>
        </div>

        {open['root'] && (
          <div style={CHILDREN_STYLE}>
            {/* 柜体组件 */}
            <div>
              <div className={rowCls('cabinet')} onClick={() => { toggle('cabinet'); select('cabinet', '柜体组件'); }} style={ROW_STYLE(0)}>
                <span style={TOGGLE_STYLE(open['cabinet'])}>▶</span>
                <span>📦</span>
                <span style={LABEL_STYLE(false)}>柜体组件</span>
                <span style={QTY_STYLE}>[1 套]</span>
              </div>
              {open['cabinet'] && (
                <div style={CHILDREN_STYLE}>
                  {[
                    { key: 'rm12', name: 'RM-00012 红橡木板', qty: '×8 张', dot: true },
                    { key: 'rm33', name: 'RM-00033 木工板',   qty: '×2 张', dot: false },
                    { key: 'wip21',name: 'WIP-0021 侧板（半成品）', qty: '×2 套', dot: false },
                  ].map((item) => (
                    <div key={item.key} className={rowCls(item.key)} onClick={() => select(item.key, item.name)} style={ROW_STYLE(0)}>
                      <span style={{ width: 16 }} />
                      <span>💾</span>
                      <span style={LABEL_STYLE(true)}>{item.name}</span>
                      <span style={QTY_STYLE}>{item.qty}</span>
                      {item.dot && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-primary-500)', flexShrink: 0 }} title="已选中" />}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 门板组件 */}
            <div>
              <div className={rowCls('door')} onClick={() => { toggle('door'); select('door', '门板组件'); }} style={ROW_STYLE(0)}>
                <span style={TOGGLE_STYLE(open['door'])}>▶</span>
                <span>📦</span>
                <span style={LABEL_STYLE(false)}>门板组件</span>
                <span style={QTY_STYLE}>[1 套]</span>
              </div>
              {open['door'] && (
                <div style={CHILDREN_STYLE}>
                  {[
                    { key: 'rm12b', name: 'RM-00012 红橡木板', qty: '×4 张' },
                    { key: 'rm89',  name: 'RM-00089 铰链全盖', qty: '×4 个' },
                  ].map((item) => (
                    <div key={item.key} className={rowCls(item.key)} onClick={() => select(item.key, item.name)} style={ROW_STYLE(0)}>
                      <span style={{ width: 16 }} />
                      <span>💾</span>
                      <span style={LABEL_STYLE(true)}>{item.name}</span>
                      <span style={QTY_STYLE}>{item.qty}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 叶节点 */}
            <div className={rowCls('rm201')} onClick={() => select('rm201', 'RM-00201 木蜡油 0.5L')} style={ROW_STYLE(0)}>
              <span style={{ width: 16 }} />
              <span>💾</span>
              <span style={LABEL_STYLE(true)}>RM-00201 木蜡油 0.5L</span>
              <span style={QTY_STYLE}>×1 瓶</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const ROW_STYLE = (_level: number): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.5rem 0.75rem',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  transition: 'background var(--transition-fast)',
});

const TOGGLE_STYLE = (open: boolean): React.CSSProperties => ({
  fontSize: '0.625rem',
  color: 'var(--text-disabled)',
  width: 16,
  textAlign: 'center',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transform: open ? 'rotate(90deg)' : 'none',
  transition: 'transform var(--transition-fast)',
});

const LABEL_STYLE = (dim: boolean): React.CSSProperties => ({
  fontSize: '0.9375rem',
  fontWeight: dim ? 400 : 600,
  color: dim ? 'var(--text-secondary)' : 'var(--text-primary)',
  flex: 1,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
});

const QTY_STYLE: React.CSSProperties = {
  fontSize: '0.8125rem',
  color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
};

const CHILDREN_STYLE: React.CSSProperties = {
  marginLeft: '1.5rem',
  borderLeft: '2px solid var(--border-default)',
  paddingLeft: '0.75rem',
};

/* Pseudo-class selection styles handled by data-attribute + CSS module */

/* ──────────────────────────────────────────────────────────────
   主页面组件
────────────────────────────────────────────────────────────── */

type CompletionFilter = '' | '100' | 'mid' | '0';

export default function BomPage() {
  const { setPageTitle, showToast } = useAppStore();
  const [view, setView] = useState<'list' | 'editor'>('list');
  const [editingRow, setEditingRow] = useState<BomListRow | null>(null);
  const [keyword, setKeyword] = useState('');
  const [completionFilter, setCompletionFilter] = useState<CompletionFilter>('');
  const [page, setPage] = useState(1);
  const [wizardOpen, setWizardOpen] = useState(false);

  const PAGE_SIZE = 20;

  useEffect(() => { setPageTitle('BOM 管理'); }, [setPageTitle]);

  // ── 真实 API 数据 ──
  const { data: bomHeaders, isLoading: bomListLoading } = useBomList();
  const allRows: BomListRow[] = (bomHeaders ?? []).map(mapBomHeaderToRow);

  // ── 获取所有成品 SKU（用于新建BOM和向导选择）──
  const { data: categories } = useSkuCategories();
  const finishedCatId = useMemo(() => {
    if (!categories) return undefined;
    const cat = categories.find(c => c.code === Category1Code.FINISHED && c.level === 1);
    return cat?.id;
  }, [categories]);
  const { data: finishedSkuData } = useQuery({
    queryKey: skuKeys.list({ category1Id: finishedCatId!, pageSize: 200 }),
    queryFn: () => skuApi.getList({ category1Id: finishedCatId!, pageSize: 200 }),
    enabled: !!finishedCatId,
  });

  // 构建向导可选项：所有成品 SKU，标注已有 BOM 的状态
  const wizardSkuItems: WizardSkuItem[] = useMemo(() => {
    const skus = finishedSkuData?.list ?? [];
    if (skus.length === 0) return allRows.map(r => ({ code: r.skuCode, name: r.skuName, skuId: r.skuId, alertText: r.alertText }));
    // 建立已有 BOM 的 skuId 集合
    const bomSkuMap = new Map(allRows.map(r => [r.skuId, r]));
    return skus.map(sku => {
      const bomRow = bomSkuMap.get(sku.id);
      return {
        code: sku.skuCode,
        name: sku.name,
        skuId: sku.id,
        alertText: bomRow?.alertText,
        hasBom: !!bomRow,
        bomStatus: bomRow?.status,
      };
    });
  }, [finishedSkuData, allRows]);

  const createBom = useCreateBom();

  /* 客户端过滤 */
  const filtered = allRows.filter((row) => {
    const kw = keyword.trim().toLowerCase();
    if (kw && !row.skuCode.toLowerCase().includes(kw) && !row.skuName.toLowerCase().includes(kw)) return false;
    if (completionFilter === '100' && row.completionPct !== 100) return false;
    if (completionFilter === 'mid' && (row.completionPct === 0 || row.completionPct === 100)) return false;
    if (completionFilter === '0' && row.completionPct !== 0) return false;
    return true;
  });

  /* 汇总统计（从真实数据计算） */
  const SUMMARY = {
    total: allRows.length,
    done: allRows.filter(r => r.completionPct === 100).length,
    wip: allRows.filter(r => r.completionPct > 0 && r.completionPct < 100).length,
    none: allRows.filter(r => r.completionPct === 0).length,
  };

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleEdit = (row: BomListRow) => {
    setEditingRow(row);
    setView('editor');
  };

  const handleBack = () => {
    setView('list');
    setEditingRow(null);
  };

  const handleWizardComplete = async (data: {
    skuId: number;
    skuCode: string;
    skuName: string;
    version: string;
    items: Array<{ componentSkuId: number; quantity: string; unit: string }>;
  }) => {
    try {
      const result = await createBom.mutateAsync({
        skuId: data.skuId,
        version: data.version,
        description: '',
        items: data.items,
      });
      setWizardOpen(false);
      const itemCount = data.items.length;
      showToast({
        type: 'success',
        message: `BOM草稿已创建（${data.skuName}），包含 ${itemCount} 种物料，请在编辑器中继续完善`,
      });
      handleEdit({
        id: Number(result.id),
        skuId: data.skuId,
        skuCode: data.skuCode,
        skuName: data.skuName,
        hasAlert: true,
        alertText: 'BOM草稿未激活，影响采购建议',
        completionPct: 50,
        materialCount: itemCount > 0 ? itemCount : null,
        orderCount: 0,
        status: BomStatus.DRAFT,
      });
    } catch {
      showToast({ type: 'error', message: '创建BOM失败，请稍后重试' });
    }
  };

  /* ── 编辑器视图 ── */
  if (view === 'editor' && editingRow) {
    return (
      <div className={styles.page}>
        <EditorView row={editingRow} onBack={handleBack} />
      </div>
    );
  }

  /* ── 列表视图 ── */
  return (
    <div className={styles.page}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.search_box}>
          <span className={styles.search_icon} aria-hidden="true">🔍</span>
          <input
            className={styles.search_input}
            type="text"
            placeholder="搜索成品名称 / 编码…"
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
            aria-label="搜索 BOM"
          />
        </div>

        <select
          className={styles.filter_select}
          value={completionFilter}
          onChange={(e) => { setCompletionFilter(e.target.value as CompletionFilter); setPage(1); }}
          aria-label="BOM完整度筛选"
        >
          <option value="">全部完整度</option>
          <option value="100">已完成 (100%)</option>
          <option value="mid">进行中 (40–99%)</option>
          <option value="0">未开始 (0%)</option>
        </select>

        <div className={styles.toolbar_spacer} />

        <Button variant="primary" onClick={() => setWizardOpen(true)}>+ 新建BOM</Button>
        <Button variant="secondary" onClick={() => setWizardOpen(true)}>⚡ BOM快速录入向导</Button>
      </div>

      {/* Summary Strip */}
      <div className={styles.summary_strip}>
        <div>
          <div className={styles.summary_item__label}>全部成品</div>
          <div className={styles.summary_item__value}>{SUMMARY.total}</div>
        </div>
        <div className={styles.summary_divider} />
        <div>
          <div className={styles.summary_item__label}>已完成BOM</div>
          <div className={`${styles.summary_item__value} ${styles['summary_item__value--done']}`}>
            {SUMMARY.done}
          </div>
        </div>
        <div>
          <div className={styles.summary_item__label}>进行中</div>
          <div className={`${styles.summary_item__value} ${styles['summary_item__value--wip']}`}>
            {SUMMARY.wip}
          </div>
        </div>
        <div>
          <div className={styles.summary_item__label}>未开始</div>
          <div className={`${styles.summary_item__value} ${styles['summary_item__value--none']}`}>
            {SUMMARY.none}
          </div>
        </div>
        <div className={styles.warn_banner}>
          <span aria-hidden="true">⚠</span>
          未完成BOM将导致AI采购建议覆盖不全
        </div>
      </div>

      {/* Table Card */}
      <div className={styles.table_card}>
        <div className={styles.table_scroll}>
          <table className={styles.data_table}>
            <thead>
              <tr>
                <th>SKU编码</th>
                <th>成品名称</th>
                <th style={{ minWidth: 200 }}>BOM完整度</th>
                <th>物料种数</th>
                <th>关联订单</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {bomListLoading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                    加载中...
                  </td>
                </tr>
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={6} className={styles.table_empty}>暂无 BOM 数据</td>
                </tr>
              ) : (
                paged.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className={styles.sku_code}>{row.skuCode}</span>
                    </td>
                    <td style={{ fontWeight: row.hasAlert ? 400 : 600 }}>
                      {row.hasAlert ? (
                        <div>
                          <div>{row.skuName}</div>
                          <span className={styles.tag_danger}>
                            ⚠ {row.alertText}
                          </span>
                        </div>
                      ) : (
                        row.skuName
                      )}
                    </td>
                    <td>
                      <BomProgress pct={row.completionPct} />
                    </td>
                    <td style={{ color: row.materialCount === null ? 'var(--text-disabled)' : undefined }}>
                      {row.materialCount !== null ? `${row.materialCount} 种` : '—'}
                    </td>
                    <td style={{ color: row.orderCount === 0 ? 'var(--text-disabled)' : undefined }}>
                      {row.orderCount === 0 ? '—' : `${row.orderCount} 单`}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <RowActionBtn row={row} onEdit={handleEdit} />
                        <CopyBomBtn row={row} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer / Pagination */}
        <div className={styles.table_footer}>
          <span>共 {filtered.length} 条记录</span>
          <div className={styles.pagination}>
            <button
              className={styles.page_btn}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="上一页"
            >
              ‹
            </button>
            {buildPageNums(page, totalPages).map((item, i) =>
              item === '…' ? (
                <span key={`ellipsis-${i}`} className={styles.pagination_ellipsis}>…</span>
              ) : (
                <button
                  key={item}
                  className={`${styles.page_btn} ${page === item ? styles['page_btn--active'] : ''}`}
                  onClick={() => setPage(item as number)}
                  aria-label={`第 ${item} 页`}
                  aria-current={page === item ? 'page' : undefined}
                >
                  {item}
                </button>
              )
            )}
            <button
              className={styles.page_btn}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              aria-label="下一页"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {/* 向导 Modal */}
      <WizardModal
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onComplete={handleWizardComplete}
        skuItems={wizardSkuItems}
        submitting={createBom.isPending}
      />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   工具函数：生成分页数字序列（含省略号）
────────────────────────────────────────────────────────────── */

function buildPageNums(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | '…')[] = [1];
  if (current > 3) pages.push('…');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < total - 2) pages.push('…');
  pages.push(total);
  return pages;
}
