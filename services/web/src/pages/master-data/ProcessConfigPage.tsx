/**
 * [artifact:前端代码] — 工序配置页（Master-Detail 双栏重设计）
 *
 * 布局：左侧 280px 模板列表 + 右侧编辑器
 * 功能：
 *   1. 模板列表（搜索 + 骨架屏 + 空状态）
 *   2. 右侧横向流程图（节点 → 箭头 → 节点 → [+]）
 *   3. 节点编辑侧边抽屉（内联删除确认）
 *   4. 操作引导蓝色提示条（首次进入，"知道了"关闭）
 *   5. 新建模板、保存模板、删除模板
 */

import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import {
  useProcessConfigList,
  useProcessConfigCatalog,
  useProcessConfigDetail,
  useCreateProcessConfig,
  useUpdateProcessConfig,
  useDeleteProcessConfig,
  useSetWages,
  useWorkstationTypes,
  useCreateWorkstationType,
  useDeleteWorkstationType,
  processConfigApi,
  uploadProcessGuideFile,
  type ProcessTemplateListItem,
  type ProcessStep,
  type ProcessStepMaterial,
  type ProcessStepMaterialPayload,
  type ProcessStepPayload,
  useProcessStepMaterials,
  useSetProcessStepMaterials,
} from '@/api/processConfig';
import {
  useCreateProductionWorkstation,
  useDeleteProductionWorkstation,
  useProductionWorkstations,
  useUpdateProductionWorkstation,
  type WorkstationOption,
} from '@/api/production';
import { skuApi, useSkuList } from '@/api/sku';
import { useBomExpanded, useBomList, useMaterialRequirements } from '@/api/bom';
import type { BomItem } from '@/types/models';
import styles from './ProcessConfigPage.module.css';

// ─────────────────────────────────────────────
// 内部类型
// ─────────────────────────────────────────────

type NodeStatus = 'inherit' | 'modified' | 'added' | 'deleted';

interface ProcessNode {
  /** 页面内部临时 ID（后端已有的节点用真实 id，新增用负数时间戳） */
  _key: number;
  /** 后端步骤 ID，新增节点为 null */
  id: number | null;
  seq: number;
  name: string;
  workstation: string;
  workstationId: number | null;
  workstationName: string;
  executionMode: 'internal' | 'outsource';
  outputType: 'semi_finished' | 'final_product' | 'none';
  outputSkuId: number | null;
  predecessorStepNos: number[];
  routeGroupKey: string;
  routeLevel: number | null;
  hours: number;
  maxHours: number | null;
  guideText: string;
  guideAttachmentUrl: string;
  guideAttachmentName: string;
  unitPrice: number;
  status: NodeStatus;
}

interface InheritedTemplateRef {
  templateId: number;
  templateName: string;
  skuId: number;
  skuCode: string | null;
  skuName: string | null;
}

interface EditorTemplate {
  id: number;
  name: string;
  skuId: number;
  skuName: string;
  skuCode: string | null;
  baseTemplateId: number | null;
  baseTemplateName: string | null;
  templateMode: 'standard' | 'variant' | 'independent';
  version: string;
  nodes: ProcessNode[];
}

interface StepMaterialDraft {
  stepNo: number;
  inputSkuId: number;
  usagePerUnit: number;
  lossRate: number;
  consumeTiming: 'start' | 'complete';
  isKeyMaterial: boolean;
  specText: string;
  processParams: Record<string, unknown> | null;
  processParamsText: string;
  processParamsError: string | null;
  skuCode: string | null;
  skuName: string | null;
}

type BomMaterialSuggestion = {
  skuId: number;
  skuCode: string | null;
  skuName: string;
  totalQty: string | number;
  spec: string | null;
};

interface BomRouteNode {
  skuId: number;
  skuCode: string;
  skuName: string;
  qty: string;
  level: number;
  parentSkuId: number | null;
  topAncestorSkuId: number;
  topAncestorSkuName: string;
  childCount: number;
  hasChildren: boolean;
  pathNames: string[];
}

interface BomRouteLane {
  skuId: number;
  skuName: string;
  items: Array<BomRouteNode & { coveredSteps: ProcessNode[] }>;
}

interface ProcessParamFieldConfig {
  key: string;
  label: string;
  placeholder: string;
  inputMode?: 'decimal' | 'text';
}

type MaterialSkuOption = {
  id: number;
  skuCode: string | null;
  name: string;
  stockUnit?: string | null;
};

type AddProcessMode = 'serial' | 'parallel';

interface AddProcessDraft {
  mode: AddProcessMode;
  name: string;
  executionMode: 'internal' | 'outsource';
  routeGroupKey: string;
  routeLevel: number | '';
  predecessorStepNos: number[];
  isFinal: boolean;
}

const EMPTY_PROCESS_TEMPLATES: ProcessTemplateListItem[] = [];

// 工种选项由 API 动态加载，此处仅作兜底（接口未返回时展示）
const WORKSTATION_FALLBACK = ['开料区', '钻孔区', '封边区', '砂光区', '涂装间', '装配区', 'QC区'];

const STATUS_LABELS: Record<NodeStatus, string> = {
  inherit:  '标准',
  modified: '已调整',
  added:    '新增',
  deleted:  '已停用',
};

const PROCESS_PARAM_FIELDS: ProcessParamFieldConfig[] = [
  { key: 'materialAttr', label: '材料属性', placeholder: '如 面料 / 海绵 / 木料', inputMode: 'text' },
  { key: 'formulaText', label: '公式说明', placeholder: '如 F/右01护翼布-白01，M01，米02', inputMode: 'text' },
  { key: 'doorWidth', label: '门幅', placeholder: '如 1450', inputMode: 'decimal' },
  { key: 'areaMm2', label: '面积平方毫米', placeholder: '如 234360', inputMode: 'decimal' },
  { key: 'cutWidth', label: '裁片宽', placeholder: '如 930', inputMode: 'decimal' },
  { key: 'cutHeight', label: '裁片高', placeholder: '如 252', inputMode: 'decimal' },
  { key: 'length', label: '长度', placeholder: '如 1930', inputMode: 'decimal' },
  { key: 'width', label: '宽度', placeholder: '如 195', inputMode: 'decimal' },
  { key: 'thickness', label: '厚度', placeholder: '如 12', inputMode: 'decimal' },
];

const ROUTE_ACCENT_COLORS = ['#3b82f6', '#ec4899', '#22c55e', '#f59e0b', '#8b5cf6', '#14b8a6'];

function getRouteAlias(index: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return `路线 ${alphabet[index] ?? String(index + 1)}`;
}

interface DrawerErrorBoundaryProps {
  resetKey: string;
  onClose: () => void;
  children: ReactNode;
}

interface DrawerErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class DrawerErrorBoundary extends Component<DrawerErrorBoundaryProps, DrawerErrorBoundaryState> {
  state: DrawerErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): DrawerErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || '工序编辑抽屉渲染失败',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 保留浏览器控制台栈，便于继续定位运行态问题
    console.error('ProcessConfig NodeDrawer render error:', error, info);
  }

  componentDidUpdate(prevProps: DrawerErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, message: '' });
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <>
        <div className={`${styles.drawerOverlay} ${styles['drawerOverlay--on']}`} aria-hidden="true" />
        <aside className={`${styles.drawer} ${styles['drawer--on']}`} role="dialog" aria-modal="true" aria-label="编辑工序失败">
          <header className={styles.drawer__header}>
            <div className={styles.drawer__icon}>
              <IconWarn />
            </div>
            <div className={styles.drawer__titleBlock}>
              <span className={styles.drawer__title}>工序编辑暂时不可用</span>
              <span className={styles.drawer__subtitle}>
                抽屉渲染过程中出现异常，当前页面主体已保留，可关闭后继续操作。
              </span>
            </div>
            <button className={styles.drawer__close} onClick={this.props.onClose} aria-label="关闭">
              <IconClose />
            </button>
          </header>
          <div className={styles.drawer__body}>
            <div className={styles.errorState}>
              <IconWarn />
              <div className={styles.errorState__text}>
                {this.state.message || '工序编辑抽屉渲染失败，请关闭后重试。'}
              </div>
              <button
                type="button"
                className={`${styles.btn} ${styles['btn--ghost']}`}
                onClick={this.props.onClose}
              >
                关闭抽屉
              </button>
            </div>
          </div>
        </aside>
      </>
    );
  }
}

// ─────────────────────────────────────────────
// 数据适配
// ─────────────────────────────────────────────

function mapStepsToNodes(steps: ProcessStep[]): ProcessNode[] {
  return steps.map((s) => ({
    _key: Number(s.id),
    id: Number(s.id),
    seq: Number(s.stepNo),
    name: s.stepName,
    workstation: s.workstationType ?? '',
    workstationId: s.workstationId ? Number(s.workstationId) : null,
    workstationName: '',
    executionMode: s.executionMode ?? 'internal',
    outputType: s.outputType ?? 'none',
    outputSkuId: s.outputSkuId ? Number(s.outputSkuId) : null,
    predecessorStepNos: (s.predecessorStepNosJson ?? []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0),
    routeGroupKey: s.routeGroupKey ?? '',
    routeLevel: s.routeLevel ? Number(s.routeLevel) : null,
    hours: s.standardHours ? parseFloat(s.standardHours) : 0,
    maxHours: s.maxHours ? parseFloat(s.maxHours) : null,
    guideText: s.guideText ?? '',
    guideAttachmentUrl: s.guideAttachmentUrl ?? '',
    guideAttachmentName: s.guideAttachmentName ?? '',
    unitPrice: 0, // unitPrice 通过 wages API 按需加载，初始为 0
    status: 'inherit' as NodeStatus,
  }));
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function formatDecimalDraft(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '';
  return String(value);
}

function normalizeDecimalDraftInput(value: string): string {
  return value.replace(/[。．，,]/g, '.');
}

function isDecimalDraft(value: string): boolean {
  return /^\d*(\.\d*)?$/.test(value);
}

function commitDecimalDraft(value: string, emptyValue: number | null): number | null {
  if (!value || value === '.') return emptyValue;
  const normalized = value.startsWith('.') ? `0${value}` : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : emptyValue;
}

function getSkuDisplayName(skuCode: string | null | undefined, skuName: string | null | undefined, fallback = '未命名对象'): string {
  const normalizedName = normalizeText(skuName);
  if (normalizedName) return normalizedName;
  const normalizedCode = normalizeText(skuCode);
  if (normalizedCode) return normalizedCode;
  return fallback;
}

function formatSkuBadgeLabel(skuCode: string | null | undefined, skuName: string | null | undefined): string {
  const normalizedCode = normalizeText(skuCode);
  const normalizedName = normalizeText(skuName);
  if (normalizedCode && normalizedName && normalizedCode !== normalizedName) {
    return `${normalizedCode} · ${normalizedName}`;
  }
  return normalizedName || normalizedCode || '未关联 SKU';
}

function resolveNodeOutputSkuId(
  node: Pick<ProcessNode, 'outputType' | 'outputSkuId'>,
  template: Pick<EditorTemplate, 'skuId' | 'templateMode'>,
): number | null {
  if (node.outputType === 'none') return null;
  if (node.outputSkuId) return node.outputSkuId;
  if (node.outputType === 'final_product' && template.templateMode !== 'standard' && template.skuId > 0) {
    return template.skuId;
  }
  return null;
}

function mapNodesToPayload(nodes: ProcessNode[], template: Pick<EditorTemplate, 'skuId' | 'templateMode'>): ProcessStepPayload[] {
  return nodes
    .filter((n) => n.status !== 'deleted')
    .map((n) => ({
      stepNo: n.seq,
      stepName: normalizeText(n.name) || `工序 ${n.seq}`,
      standardHours: n.hours || undefined,
      workstationType: normalizeText(n.workstation) || undefined,
      workstationId: n.workstationId || undefined,
      executionMode: n.executionMode,
      outputType: n.outputType,
      outputSkuId: resolveNodeOutputSkuId(n, template),
      predecessorStepNos: n.predecessorStepNos,
      routeGroupKey: normalizeText(n.routeGroupKey) || null,
      routeLevel: n.routeLevel ?? null,
      guideText: normalizeText(n.guideText) || undefined,
      guideAttachmentUrl: normalizeText(n.guideAttachmentUrl) || undefined,
      guideAttachmentName: normalizeText(n.guideAttachmentName) || undefined,
    }));
}

function getDisplayAttachmentName(node: Pick<ProcessNode, 'guideAttachmentName' | 'guideAttachmentUrl'>): string {
  if (node.guideAttachmentName) return node.guideAttachmentName;
  if (!node.guideAttachmentUrl) return '';
  return node.guideAttachmentUrl.split('/').pop() ?? '已上传附件';
}

function serializeProcessParams(params?: Record<string, unknown> | null): string {
  if (!params || Object.keys(params).length === 0) return '';
  return JSON.stringify(params, null, 2);
}

function normalizeProcessParamsObject(params?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!params) return null;
  const entries = Object.entries(params).filter(([, value]) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string' && value.trim() === '') return false;
    return true;
  });
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function parseProcessParamFieldValue(value: string, inputMode: ProcessParamFieldConfig['inputMode']): string | number | null {
  if (!value.trim()) return null;
  if (inputMode === 'decimal') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  }
  return value;
}

function getProcessParamFieldDisplayValue(
  params: Record<string, unknown> | null | undefined,
  key: string,
): string {
  if (!params || !(key in params)) return '';
  const value = params[key];
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function buildStepMaterialDraft(item: ProcessStepMaterial): StepMaterialDraft {
  return {
    stepNo: Number(item.stepNo),
    inputSkuId: Number(item.inputSkuId),
    usagePerUnit: Number(item.usagePerUnit ?? 0),
    lossRate: Number(item.lossRate ?? 0),
    consumeTiming: item.consumeTiming ?? 'start',
    isKeyMaterial: Boolean(item.isKeyMaterial),
    specText: item.specText ?? '',
    processParams: item.processParamsJson ?? null,
    processParamsText: serializeProcessParams(item.processParamsJson),
    processParamsError: null,
    skuCode: item.skuCode ?? null,
    skuName: item.skuName ?? null,
  };
}

function materialDraftToPayload(item: StepMaterialDraft): ProcessStepMaterialPayload {
  return {
    stepNo: item.stepNo,
    inputSkuId: item.inputSkuId,
    usagePerUnit: item.usagePerUnit,
    lossRate: item.lossRate,
    consumeTiming: item.consumeTiming,
    isKeyMaterial: item.isKeyMaterial,
    specText: normalizeText(item.specText) || undefined,
    processParams: normalizeProcessParamsObject(item.processParams),
  };
}

function flattenBomRouteNodes(
  items: BomItem[],
  parentSkuId: number | null = null,
  topAncestor: { skuId: number; skuName: string } | null = null,
  pathNames: string[] = [],
): BomRouteNode[] {
  return items.flatMap((item) => {
    const currentTop = topAncestor ?? {
      skuId: Number(item.componentSkuId),
      skuName: getSkuDisplayName(item.skuCode, item.skuName, `SKU#${item.componentSkuId}`),
    };
    const currentSkuName = getSkuDisplayName(item.skuCode, item.skuName, `SKU#${item.componentSkuId}`);
    const nextPath = [...pathNames, currentSkuName];
    const current: BomRouteNode = {
      skuId: Number(item.componentSkuId),
      skuCode: item.skuCode,
      skuName: currentSkuName,
      qty: item.quantity,
      level: nextPath.length,
      parentSkuId,
      topAncestorSkuId: currentTop.skuId,
      topAncestorSkuName: currentTop.skuName,
      childCount: item.children.length,
      hasChildren: item.children.length > 0,
      pathNames: nextPath,
    };
    return [current, ...flattenBomRouteNodes(item.children, current.skuId, currentTop, nextPath)];
  });
}

function createBomRouteSkeletonNode(item: BomRouteNode, seq: number): ProcessNode {
  const routePrefix = item.level <= 1 ? '一级半成品' : `L${item.level}子半成品`;
  const displayName = getSkuDisplayName(item.skuCode, item.skuName, `SKU#${item.skuId}`);
  const routeGroupKey = normalizeText(item.topAncestorSkuName) || displayName;
  return {
    _key: -Date.now() - item.skuId - seq,
    id: null,
    seq,
    name: `${routePrefix} · ${displayName}`,
    workstation: '',
    workstationId: null,
    workstationName: '',
    executionMode: 'internal',
    outputType: 'semi_finished',
    outputSkuId: item.skuId,
    predecessorStepNos: [],
    routeGroupKey,
    routeLevel: item.level,
    hours: 0,
    maxHours: null,
    guideText: '',
    guideAttachmentUrl: '',
    guideAttachmentName: '',
    unitPrice: 0,
    status: 'added',
  };
}

function getProcessNodeDisplayName(
  node: Pick<ProcessNode, 'name' | 'seq' | 'outputType' | 'outputSkuId' | 'routeLevel'>,
  outputSkuLabelMap: Map<number, string>,
): string {
  const rawName = normalizeText(node.name);
  if (rawName && !rawName.toLowerCase().includes('undefined')) return rawName;
  const outputLabel = node.outputSkuId ? outputSkuLabelMap.get(Number(node.outputSkuId)) : '';
  const outputName = normalizeText(outputLabel?.split('·').pop() ?? outputLabel);
  if (node.outputType === 'semi_finished' && outputName) {
    return `${node.routeLevel && node.routeLevel > 1 ? `L${node.routeLevel}子半成品` : '一级半成品'} · ${outputName}`;
  }
  if (node.outputType === 'final_product' && outputName) {
    return `成品工序 · ${outputName}`;
  }
  return rawName || `工序 ${node.seq}`;
}

function groupProcessNodesByLevel(nodes: ProcessNode[]): Array<{ level: number; nodes: ProcessNode[] }> {
  const grouped = new Map<number, ProcessNode[]>();
  nodes.forEach((node) => {
    const level = node.routeLevel ?? 1;
    const bucket = grouped.get(level) ?? [];
    bucket.push(node);
    grouped.set(level, bucket);
  });
  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, levelNodes]) => ({
      level,
      nodes: [...levelNodes].sort((a, b) => a.seq - b.seq),
    }));
}

function getDependencyModeLabel(node: Pick<ProcessNode, 'predecessorStepNos' | 'routeGroupKey'>): string {
  if (node.predecessorStepNos.length === 0) {
    return node.routeGroupKey ? '并行起步' : '主线起步';
  }
  if (node.predecessorStepNos.length > 1) return '汇合依赖';
  return '串行依赖';
}

// ─────────────────────────────────────────────
// SVG 图标（内联，无外部依赖）
// ─────────────────────────────────────────────

const IconSearch = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
    <circle cx="8.5" cy="8.5" r="5.5" />
    <path d="M14.5 14.5l3.5 3.5" />
  </svg>
);

const IconPlus = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M10 4v12M4 10h12" />
  </svg>
);

const IconClose = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M5 5l10 10M15 5L5 15" />
  </svg>
);

const IconArrowRight = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 10h12M11 5l5 5-5 5" />
  </svg>
);

const IconFlow = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="1" y="6" width="5" height="8" rx="1.5" />
    <rect x="7.5" y="6" width="5" height="8" rx="1.5" />
    <rect x="14" y="6" width="5" height="8" rx="1.5" />
    <path d="M6 10h1.5M12.5 10H14" strokeLinecap="round" />
  </svg>
);

const IconEdit = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 3l4 4-9 9H4v-4L13 3z" />
  </svg>
);

const IconInfo = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="10" cy="10" r="8" />
    <path d="M10 9v5M10 6.5v.5" strokeLinecap="round" />
  </svg>
);

const IconSave = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 5a2 2 0 012-2h9l3 3v9a2 2 0 01-2 2H5a2 2 0 01-2-2V5z" />
    <path d="M7 3v4h7V3M7 13h6" />
  </svg>
);

const IconTrash = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h14M8 6V4h4v2M5 6l1 11h8l1-11" />
  </svg>
);

const IconWarn = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M9 3l-7 13h14L9 3z" strokeLinejoin="round" />
    <path d="M9 8v4M9 14v.5" strokeLinecap="round" />
  </svg>
);

// ─────────────────────────────────────────────
// 骨架屏组件
// ─────────────────────────────────────────────

function SidebarSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className={styles.skeletonItem}>
          <div className={`${styles.skeletonBlock} ${styles['skeletonBlock--circle']}`} />
          <div style={{ flex: 1 }}>
            <div className={`${styles.skeletonBlock} ${styles['skeletonBlock--line']}`} />
            <div className={`${styles.skeletonBlock} ${styles['skeletonBlock--lineShort']}`} />
          </div>
        </div>
      ))}
    </>
  );
}

function EditorSkeleton() {
  return (
    <div className={styles.editorSkeleton}>
      <div className={styles.skeletonHeader}>
        <div className={`${styles.skeletonBlock}`} style={{ width: '12rem', height: '1.5rem', borderRadius: '0.375rem' }} />
        <div className={`${styles.skeletonBlock}`} style={{ width: '4rem', height: '1.5rem', borderRadius: '9999px' }} />
      </div>
      <div className={styles.skeletonFlow}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
            <div className={styles.skeletonNode} />
            {i < 3 && <div className={styles.skeletonNodeArrow} />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 节点卡片
// ─────────────────────────────────────────────

interface FlowNodeCardProps {
  node: ProcessNode;
  isSelected: boolean;
  predecessorLabels: string[];
  onClick: () => void;
}

function getOutputTypeLabel(outputType: ProcessNode['outputType']): string {
  switch (outputType) {
    case 'semi_finished': return '半成品';
    case 'final_product': return '成品';
    default: return '过程节点';
  }
}

function FlowNodeCard({ node, isSelected, predecessorLabels, onClick }: FlowNodeCardProps) {
  const statusClass = styles[`flowNode--${node.status}`] ?? '';
  const selectedClass = isSelected ? styles['flowNode--selected'] : '';

  return (
    <div
      className={`${styles.flowNode} ${statusClass} ${selectedClass}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      aria-label={`选中工序 ${node.name}`}
    >
      <div className={`${styles.flowNode__statusTag} ${styles[`flowNode__statusTag--${node.status}`] ?? ''}`}>
        {STATUS_LABELS[node.status]}
      </div>
      <div className={styles.flowNode__seq}>STEP {node.seq}</div>
      <div className={styles.flowNode__name}>{node.name}</div>
      <div className={styles.flowNode__meta}>
        <div>{node.executionMode === 'outsource' ? '外协采购' : '厂内生产'}</div>
        {node.workstationName && <div>{node.workstationName}</div>}
        {!node.workstationName && node.workstation && <div>{node.workstation}</div>}
        {node.hours > 0 && <div>{node.hours}h</div>}
      </div>
      <div className={styles.flowNode__dag}>
        <div className={styles.flowNode__dagRow}>
          <span className={styles.flowNode__dagTag}>{getOutputTypeLabel(node.outputType)}</span>
          {node.routeLevel ? <span className={styles.flowNode__dagTag}>L{node.routeLevel}</span> : null}
        </div>
        {node.routeGroupKey ? (
          <div className={styles.flowNode__dagBranch} title={node.routeGroupKey}>
            分支：{node.routeGroupKey}
          </div>
        ) : (
          <div className={styles.flowNode__dagBranchMuted}>未设分支</div>
        )}
        <div className={styles.flowNode__dagDeps}>
          {predecessorLabels.length > 0 ? `前置：${predecessorLabels.join('、')}` : '前置：并行起步'}
        </div>
      </div>
      <span className={styles.flowNode__editHint}>点击选中</span>
    </div>
  );
}

// ─────────────────────────────────────────────
// 节点编辑抽屉
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// 工种类型管理 Modal
// ─────────────────────────────────────────────

interface WorkstationTypeManagerProps {
  open: boolean;
  onClose: () => void;
  preferredType?: string;
}

function WorkstationTypeManager({ open, onClose, preferredType = '' }: WorkstationTypeManagerProps) {
  const { data: types, isLoading } = useWorkstationTypes();
  const createMut = useCreateWorkstationType();
  const deleteMut = useDeleteWorkstationType();
  const { data: workstations, isLoading: workstationsLoading } = useProductionWorkstations(true);
  const createWorkstationMut = useCreateProductionWorkstation();
  const updateWorkstationMut = useUpdateProductionWorkstation();
  const deleteWorkstationMut = useDeleteProductionWorkstation();
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState('');
  const [stationErr, setStationErr] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [stationName, setStationName] = useState('');
  const [stationType, setStationType] = useState(preferredType);
  const [stationCapacity, setStationCapacity] = useState('100');
  const [stationStatus, setStationStatus] = useState<'active' | 'inactive'>('active');

  useEffect(() => {
    if (!open) return;
    setEditingId(null);
    setErr('');
    setNewName('');
    setStationErr('');
    setStationName('');
    setStationType(preferredType);
    setStationCapacity('100');
    setStationStatus('active');
  }, [open, preferredType]);

  if (!open) return null;

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) { setErr('请输入工作站类型名称'); return; }
    if (types?.some((t) => t.name === name)) { setErr('工作站类型已存在'); return; }
    await createMut.mutateAsync({ name, sortOrder: (types?.length ?? 0) * 10 + 10 });
    setNewName('');
    setErr('');
    if (!stationType) setStationType(name);
  };

  const handleDelete = async (id: number) => {
    await deleteMut.mutateAsync(id);
  };

  const resetStationForm = () => {
    setEditingId(null);
    setStationErr('');
    setStationName('');
    setStationType(preferredType);
    setStationCapacity('100');
    setStationStatus('active');
  };

  const handleEditStation = (workstation: WorkstationOption) => {
    setEditingId(Number(workstation.id));
    setStationErr('');
    setStationName(workstation.name);
    setStationType(workstation.type);
    setStationCapacity(String(workstation.capacity));
    setStationStatus(workstation.status);
  };

  const handleSaveStation = async () => {
    const name = stationName.trim();
    const type = stationType.trim();
    const capacity = Number(stationCapacity);

    if (!name) { setStationErr('请输入工作站名称'); return; }
    if (!type) { setStationErr('请选择工作站类型'); return; }
    if (!Number.isFinite(capacity) || capacity <= 0) {
      setStationErr('请输入有效的日产能');
      return;
    }

    if (editingId) {
      await updateWorkstationMut.mutateAsync({
        id: editingId,
        payload: { name, type, capacity, status: stationStatus },
      });
    } else {
      await createWorkstationMut.mutateAsync({ name, type, capacity, status: stationStatus });
    }
    resetStationForm();
  };

  const handleRemoveStation = async (id: number) => {
    await deleteWorkstationMut.mutateAsync(id);
    if (editingId === id) resetStationForm();
  };

  const typeOptions = types?.map((item) => item.name) ?? [];

  return createPortal(
    <div className={styles.managerOverlay} onClick={onClose}>
      <div
        className={styles.managerModal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="管理工作站"
      >
        <div className={styles.managerModal__header}>
          <span className={styles.managerModal__title}>工作站与类型管理</span>
          <button className={styles.drawer__close} onClick={onClose} aria-label="关闭"><IconClose /></button>
        </div>
        <div className={styles.managerModal__body}>
          <section className={styles.managerSection}>
            <div className={styles.managerSection__title}>工作站类型</div>
            <div className={styles.managerSection__desc}>工序节点按工作站类型关联，排产时再匹配到对应站点。</div>
            <div className={styles.managerAddRow}>
              <input
                className={styles.formInput}
                type="text"
                placeholder="输入新工作站类型"
                value={newName}
                onChange={(e) => { setNewName(e.target.value); setErr(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); }}
              />
              <button
                className={`${styles.btn} ${styles['btn--primary']}`}
                onClick={() => void handleAdd()}
                disabled={createMut.isPending}
              >
                {createMut.isPending ? '…' : '添加类型'}
              </button>
            </div>
            {err && <p className={styles.formError}>{err}</p>}
            <ul className={styles.managerList}>
              {isLoading && <li className={styles.managerList__empty}>加载中…</li>}
              {!isLoading && (!types || types.length === 0) && (
                <li className={styles.managerList__empty}>暂无工作站类型</li>
              )}
              {types?.map((t) => (
                <li key={t.id} className={styles.managerList__item}>
                  <span>{t.name}</span>
                  <button
                    className={styles.managerList__del}
                    onClick={() => void handleDelete(Number(t.id))}
                    disabled={deleteMut.isPending}
                    title="删除"
                  >
                    <IconClose />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.managerSection}>
            <div className={styles.managerSection__title}>实际工作站</div>
            <div className={styles.managerSection__desc}>维护排产可用的站点资源，并归属到某个工作站类型。</div>
            <div className={styles.managerGrid}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>工作站名称</label>
                <input
                  className={styles.formInput}
                  value={stationName}
                  onChange={(e) => { setStationName(e.target.value); setStationErr(''); }}
                  placeholder="如：开料区 A 线"
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>工作站类型</label>
                <select
                  className={styles.formSelect}
                  value={stationType}
                  onChange={(e) => { setStationType(e.target.value); setStationErr(''); }}
                >
                  <option value="">请选择类型</option>
                  {typeOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>日产能</label>
                <input
                  className={styles.formInput}
                  type="number"
                  min="1"
                  value={stationCapacity}
                  onChange={(e) => { setStationCapacity(e.target.value); setStationErr(''); }}
                  placeholder="100"
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>状态</label>
                <select
                  className={styles.formSelect}
                  value={stationStatus}
                  onChange={(e) => setStationStatus(e.target.value as 'active' | 'inactive')}
                >
                  <option value="active">启用</option>
                  <option value="inactive">停用</option>
                </select>
              </div>
            </div>
            <div className={styles.managerActionRow}>
              <div className={styles.managerCurrentHint}>
                {preferredType ? `当前工序类型：${preferredType}` : '可在这里维护排产工作站并关联到工序类型'}
              </div>
              <div className={styles.managerActionBtns}>
                {editingId !== null && (
                  <button className={`${styles.btn} ${styles['btn--ghost']}`} onClick={resetStationForm}>
                    取消编辑
                  </button>
                )}
                <button
                  className={`${styles.btn} ${styles['btn--primary']}`}
                  onClick={() => void handleSaveStation()}
                  disabled={createWorkstationMut.isPending || updateWorkstationMut.isPending}
                >
                  {editingId !== null ? '更新工作站' : '新增工作站'}
                </button>
              </div>
            </div>
            {stationErr && <p className={styles.formError}>{stationErr}</p>}

            <div className={styles.managerTableWrap}>
              <table className={styles.managerTable}>
                <thead>
                  <tr>
                    <th>工作站名称</th>
                    <th>类型</th>
                    <th>日产能</th>
                    <th>状态</th>
                    <th>关联工序</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {workstationsLoading && (
                    <tr><td colSpan={6} className={styles.managerList__empty}>加载中…</td></tr>
                  )}
                  {!workstationsLoading && (!workstations || workstations.length === 0) && (
                    <tr><td colSpan={6} className={styles.managerList__empty}>暂无工作站</td></tr>
                  )}
                  {workstations?.map((workstation) => (
                    <tr key={workstation.id}>
                      <td>{workstation.name}</td>
                      <td>{workstation.type}</td>
                      <td>{workstation.capacity}</td>
                      <td>
                        <span className={`${styles.managerStatusTag} ${styles[`managerStatusTag--${workstation.status}`]}`}>
                          {workstation.status === 'active' ? '启用' : '停用'}
                        </span>
                      </td>
                      <td>{workstation.linkedProcessCount} 个工序</td>
                      <td>
                        <div className={styles.managerTable__actions}>
                          <button
                            className={styles.managerTable__link}
                            onClick={() => handleEditStation(workstation)}
                          >
                            编辑
                          </button>
                          <button
                            className={styles.managerTable__linkDanger}
                            onClick={() => void handleRemoveStation(Number(workstation.id))}
                            disabled={deleteWorkstationMut.isPending || workstation.status === 'inactive'}
                          >
                            停用
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface NodeDrawerProps {
  node: ProcessNode | null;
  nodes: ProcessNode[];
  open: boolean;
  saving: boolean;
  stepMaterials: StepMaterialDraft[];
  bomSuggestions: BomMaterialSuggestion[];
  skuOptions: MaterialSkuOption[];
  materialSkuKeyword: string;
  workstationOptions: string[];
  workstationRecords: WorkstationOption[];
  linkedWorkstationCount: number;
  onManageWorkstations: () => void;
  onClose: () => void;
  onMaterialSkuKeywordChange: (keyword: string) => void;
  onAddStepMaterial: (sku: { id: number; skuCode: string | null; name: string }) => void;
  onImportBomSuggestions: () => void;
  onChange: (updated: ProcessNode) => void;
  onChangeStepMaterial: (inputSkuId: number, patch: Partial<StepMaterialDraft>) => void;
  onRemoveStepMaterial: (inputSkuId: number) => void;
  onDelete: (key: number) => void;
}

function NodeDrawer({
  node,
  nodes,
  open,
  saving,
  stepMaterials,
  bomSuggestions,
  skuOptions,
  materialSkuKeyword,
  workstationOptions,
  workstationRecords,
  linkedWorkstationCount,
  onManageWorkstations,
  onClose,
  onMaterialSkuKeywordChange,
  onAddStepMaterial,
  onImportBomSuggestions,
  onChange,
  onChangeStepMaterial,
  onRemoveStepMaterial,
  onDelete,
}: NodeDrawerProps) {
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [uploadingGuide, setUploadingGuide] = useState(false);
  const [selectedSkuOption, setSelectedSkuOption] = useState<MaterialSkuOption | null>(null);
  const [materialPickerOpen, setMaterialPickerOpen] = useState(false);
  const [hoursDraft, setHoursDraft] = useState('');
  const [maxHoursDraft, setMaxHoursDraft] = useState('');
  const [unitPriceDraft, setUnitPriceDraft] = useState('');
  const materialPickerBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 关闭时重置确认状态
  useEffect(() => {
    if (!open) {
      setDeleteConfirm(false);
      setUploadingGuide(false);
      setSelectedSkuOption(null);
      setMaterialPickerOpen(false);
      onMaterialSkuKeywordChange('');
    }
    return () => {
      if (materialPickerBlurTimerRef.current) {
        clearTimeout(materialPickerBlurTimerRef.current);
        materialPickerBlurTimerRef.current = null;
      }
    };
  }, [onMaterialSkuKeywordChange, open]);

  const draftNodeKey = node?._key ?? null;
  const draftNodeHours = node?.hours;
  const draftNodeMaxHours = node?.maxHours;
  const draftNodeUnitPrice = node?.unitPrice;

  useEffect(() => {
    if (!draftNodeKey) return;
    setHoursDraft(formatDecimalDraft(draftNodeHours));
    setMaxHoursDraft(formatDecimalDraft(draftNodeMaxHours));
    setUnitPriceDraft(formatDecimalDraft(draftNodeUnitPrice));
  }, [draftNodeHours, draftNodeKey, draftNodeMaxHours, draftNodeUnitPrice]);

  if (!open || !node) return null;

  const handleField = <K extends keyof ProcessNode>(field: K, value: ProcessNode[K]) => {
    const updated: ProcessNode = { ...node, [field]: value };
    // 如果原本是 inherit 并且有修改，则标记为 modified
    if (node.status === 'inherit') {
      updated.status = 'modified';
    }
    onChange(updated);
  };

  const scopedWorkstations = node.workstation
    ? workstationRecords.filter((item) => item.type === node.workstation && item.status === 'active')
    : [];
  const predecessorOptions = nodes
    .filter((item) => item._key !== node._key && item.status !== 'deleted' && item.seq < node.seq)
    .sort((a, b) => a.seq - b.seq);
  const executionModeLabel = node.executionMode === 'outsource' ? '外协采购' : '厂内生产';
  const workstationSummary = node.workstationName || node.workstation || '未指定工作站';
  const stepMaterialCount = stepMaterials.length;

  const handleDeleteClick = () => setDeleteConfirm(true);
  const handleDeleteConfirm = () => {
    onDelete(node._key);
    setDeleteConfirm(false);
    onClose();
  };
  const handleDeleteCancel = () => setDeleteConfirm(false);
  const hasGuideFile = Boolean(node.guideAttachmentUrl);
  const displayGuideFileName = getDisplayAttachmentName(node);
  const updateProcessParamField = (material: StepMaterialDraft, config: ProcessParamFieldConfig, rawValue: string) => {
    const nextParams = { ...(material.processParams ?? {}) } as Record<string, unknown>;
    const parsedValue = parseProcessParamFieldValue(rawValue, config.inputMode);
    if (parsedValue === null) {
      delete nextParams[config.key];
    } else {
      nextParams[config.key] = parsedValue;
    }
    const normalized = normalizeProcessParamsObject(nextParams);
    onChangeStepMaterial(material.inputSkuId, {
      processParams: normalized,
      processParamsText: serializeProcessParams(normalized),
      processParamsError: null,
    });
  };

  const formatSkuOptionLabel = (sku: MaterialSkuOption) => (sku.skuCode ? `${sku.skuCode} · ${sku.name}` : sku.name);
  const handleMaterialPickerFocus = () => {
    if (materialPickerBlurTimerRef.current) {
      clearTimeout(materialPickerBlurTimerRef.current);
      materialPickerBlurTimerRef.current = null;
    }
    if (materialSkuKeyword.trim()) {
      setMaterialPickerOpen(true);
    }
  };
  const handleMaterialPickerBlur = () => {
    materialPickerBlurTimerRef.current = setTimeout(() => {
      setMaterialPickerOpen(false);
    }, 120);
  };
  const handleMaterialKeywordChange = (value: string) => {
    onMaterialSkuKeywordChange(value);
    setSelectedSkuOption(null);
    setMaterialPickerOpen(Boolean(value.trim()));
  };
  const handleSelectMaterialSku = (sku: MaterialSkuOption) => {
    setSelectedSkuOption(sku);
    onMaterialSkuKeywordChange(formatSkuOptionLabel(sku));
    setMaterialPickerOpen(false);
  };

  return createPortal(
    <>
      <div
        className={`${styles.drawerOverlay} ${open ? styles['drawerOverlay--on'] : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`${styles.drawer} ${open ? styles['drawer--on'] : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="编辑工序节点"
      >
        <header className={styles.drawer__header}>
          <div className={styles.drawer__icon}>
            <IconEdit />
          </div>
          <div className={styles.drawer__titleBlock}>
            <span className={styles.drawer__title}>编辑工序 · Step {node.seq}</span>
            <span className={styles.drawer__subtitle}>
              调整当前工序的执行方式、工作站、工时、作业说明与步骤投料。
            </span>
          </div>
          <button className={styles.drawer__close} onClick={onClose} aria-label="关闭">
            <IconClose />
          </button>
        </header>

        <div className={styles.drawer__body}>
          <div className={styles.drawerSummary}>
            <div className={styles.drawerSummary__chip}>
              <span className={styles.drawerSummary__label}>执行方式</span>
              <strong>{executionModeLabel}</strong>
            </div>
            <div className={styles.drawerSummary__chip}>
              <span className={styles.drawerSummary__label}>工作站</span>
              <strong>{workstationSummary}</strong>
            </div>
            <div className={styles.drawerSummary__chip}>
              <span className={styles.drawerSummary__label}>标准工时</span>
              <strong>{node.hours || 0} h</strong>
            </div>
            <div className={styles.drawerSummary__chip}>
              <span className={styles.drawerSummary__label}>步骤投料</span>
              <strong>{stepMaterialCount} 项</strong>
            </div>
          </div>

          {/* 基本信息 */}
          <div className={`${styles.formSection} ${styles.formSectionCard}`}>
            <div className={styles.formSectionHeader}>
              <div className={styles.formSection__title}>基本信息</div>
              <div className={styles.formSection__desc}>定义工序名称、执行归属和工作站绑定关系。</div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                工序名称<span className={styles.formLabel__req}>*</span>
              </label>
              <input
                className={styles.formInput}
                type="text"
                value={node.name}
                onChange={(e) => handleField('name', e.target.value)}
                placeholder="请输入工序名称"
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                执行方式<span className={styles.formLabel__req}>*</span>
              </label>
              <select
                className={styles.formSelect}
                value={node.executionMode}
                onChange={(e) => handleField('executionMode', e.target.value as 'internal' | 'outsource')}
              >
                <option value="internal">厂内生产</option>
                <option value="outsource">外协采购</option>
              </select>
              <div className={styles.formHelp}>
                选择“外协采购”后，该工序将通过采购建议流转，不进入车间排产任务。
              </div>
            </div>

            <div className={styles.formGroup}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
                <label className={styles.formLabel} style={{ margin: 0 }}>工作站类型</label>
                <button
                  type="button"
                  className={styles.manageWorkstationBtn}
                  onClick={onManageWorkstations}
                  title="管理工作站"
                >
                  管理工作站
                </button>
              </div>
              <select
                className={styles.formSelect}
                value={node.workstation}
                onChange={(e) => {
                  const nextType = e.target.value;
                  const nextStation = workstationRecords.find(
                    (item) =>
                      item.status === 'active'
                      && item.type === nextType
                      && Number(item.id) === Number(node.workstationId),
                  );
                  onChange({
                    ...node,
                    workstation: nextType,
                    workstationId: nextStation ? Number(nextStation.id) : null,
                    workstationName: nextStation?.name ?? '',
                    status: node.status === 'inherit' ? 'modified' : node.status,
                  });
                }}
              >
                <option value="">-- 请选择 --</option>
                {workstationOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <div className={styles.formHelp}>
                {node.workstation
                  ? `当前类型下已维护 ${linkedWorkstationCount} 个工作站，排产时会按这里的类型匹配站点。`
                  : '先选择工作站类型，再在“管理工作站”里维护实际站点。'}
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>具体工作站</label>
              <select
                className={styles.formSelect}
                value={node.workstationId !== null ? String(node.workstationId) : ''}
                onChange={(e) => {
                  const nextId = e.target.value ? Number(e.target.value) : null;
                  const nextStation = scopedWorkstations.find((item) => Number(item.id) === nextId);
                  onChange({
                    ...node,
                    workstationId: nextStation ? Number(nextStation.id) : null,
                    workstationName: nextStation?.name ?? '',
                    workstation: nextStation?.type ?? node.workstation,
                    status: node.status === 'inherit' ? 'modified' : node.status,
                  });
                }}
                disabled={!node.workstation}
              >
                <option value="">{node.workstation ? '-- 请选择具体工作站 --' : '请先选择工作站类型'}</option>
                {scopedWorkstations.map((item) => (
                  <option key={item.id} value={String(item.id)}>
                    {item.name} · 日产能 {item.capacity}
                  </option>
                ))}
              </select>
              <div className={styles.formHelp}>
                {node.workstationId && node.workstationName
                  ? `已关联具体工作站：${node.workstationName}`
                  : '未指定时，排产会按工作站类型自动匹配。'}
              </div>
            </div>
          </div>

          {/* 工时设置 */}
          <div className={`${styles.formSection} ${styles.formSectionCard}`}>
            <div className={styles.formSectionHeader}>
              <div className={styles.formSection__title}>工时设置</div>
              <div className={styles.formSection__desc}>用于排产节拍、工作站负载和人工时核算。</div>
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>标准工时 (h)</label>
                <input
                  className={styles.formInput}
                  type="text"
                  inputMode="decimal"
                  value={hoursDraft}
                  onChange={(e) => {
                    const nextDraft = normalizeDecimalDraftInput(e.target.value);
                    if (!isDecimalDraft(nextDraft)) return;
                    setHoursDraft(nextDraft);
                  }}
                  onBlur={() => {
                    const nextValue = commitDecimalDraft(hoursDraft, 0) ?? 0;
                    setHoursDraft(formatDecimalDraft(nextValue));
                    handleField('hours', nextValue);
                  }}
                  placeholder="0.0"
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>极限工时 (h)</label>
                <input
                  className={styles.formInput}
                  type="text"
                  inputMode="decimal"
                  value={maxHoursDraft}
                  onChange={(e) => {
                    const nextDraft = normalizeDecimalDraftInput(e.target.value);
                    if (!isDecimalDraft(nextDraft)) return;
                    setMaxHoursDraft(nextDraft);
                  }}
                  onBlur={() => {
                    const nextValue = commitDecimalDraft(maxHoursDraft, null);
                    setMaxHoursDraft(formatDecimalDraft(nextValue));
                    handleField('maxHours', nextValue);
                  }}
                  placeholder="0.0"
                />
                <div className={styles.formHelp}>留空表示无上限</div>
              </div>
            </div>
          </div>

          <div className={`${styles.formSection} ${styles.formSectionCard}`}>
            <div className={styles.formSectionHeader}>
              <div className={styles.formSection__title}>工艺依赖与分支</div>
              <div className={styles.formSection__desc}>显式定义当前工序依赖哪些前置步骤，以及它属于哪条 BOM 半成品分支。</div>
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>工艺分支</label>
                <input
                  className={styles.formInput}
                  type="text"
                  value={node.routeGroupKey}
                  onChange={(e) => handleField('routeGroupKey', e.target.value)}
                  placeholder="如：清：Q01床头-白01 / 主体木架支线"
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>分支层级</label>
                <input
                  className={styles.formInput}
                  type="number"
                  min="1"
                  step="1"
                  value={node.routeLevel ?? ''}
                  onChange={(e) => handleField('routeLevel', e.target.value === '' ? null : Number(e.target.value))}
                  placeholder="1"
                />
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>前置步骤</label>
              {predecessorOptions.length === 0 ? (
                <div className={styles.formHelp}>当前是最前序步骤，可与其他首道工序并行启动。</div>
              ) : (
                <div className={styles.predecessorList}>
                  {predecessorOptions.map((item) => {
                    const checked = node.predecessorStepNos.includes(item.seq);
                    return (
                      <label key={item._key} className={`${styles.predecessorChip} ${checked ? styles['predecessorChip--active'] : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...node.predecessorStepNos, item.seq]
                              : node.predecessorStepNos.filter((stepNo) => stepNo !== item.seq);
                            handleField('predecessorStepNos', [...new Set(next)].sort((a, b) => a - b));
                          }}
                        />
                        <span>Step {item.seq} · {item.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              <div className={styles.formHelp}>
                支持多选。多个前置步骤同时满足后，当前工序才算可执行，可表达并行汇合和子工序 DAG。
              </div>
            </div>
          </div>

          <div className={`${styles.formSection} ${styles.formSectionCard}`}>
            <div className={styles.formSectionHeader}>
              <div className={styles.formSection__title}>操作说明</div>
              <div className={styles.formSection__desc}>维护作业指引、质量要求和现场可下载的附件。</div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>文字说明</label>
              <textarea
                className={styles.formTextarea}
                value={node.guideText}
                onChange={(e) => handleField('guideText', e.target.value)}
                rows={7}
                placeholder="填写该工序的关键动作、质量要求、安全提醒和注意事项。"
              />
              <div className={styles.formHelp}>工人打开任务详情时，可直接查看这段说明。</div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>操作附件</label>
              {hasGuideFile ? (
                <div className={styles.uploadFileCard}>
                  <div className={styles.uploadFileMeta}>
                    <span className={styles.uploadFileIcon}>📎</span>
                    <div className={styles.uploadFileInfo}>
                      <strong>{displayGuideFileName}</strong>
                      <span>支持图片、PDF、Word、Excel，任务详情里可查看</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.uploadFileRemove}
                    onClick={() => onChange({
                      ...node,
                      guideAttachmentUrl: '',
                      guideAttachmentName: '',
                      status: node.status === 'inherit' ? 'modified' : node.status,
                    })}
                  >
                    移除
                  </button>
                </div>
              ) : (
                <label
                  className={`${styles.uploadButton} ${uploadingGuide ? styles['uploadButton--disabled'] : ''}`}
                >
                  {uploadingGuide ? '上传中...' : '上传图片 / PDF / Word / Excel'}
                  <input
                    type="file"
                    className={styles.uploadInput}
                    accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx"
                    disabled={uploadingGuide}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setUploadingGuide(true);
                      try {
                        const result = await uploadProcessGuideFile(file);
                        onChange({
                          ...node,
                          guideAttachmentUrl: result.url,
                          guideAttachmentName: result.originalName,
                          status: node.status === 'inherit' ? 'modified' : node.status,
                        });
                      } finally {
                        setUploadingGuide(false);
                        e.target.value = '';
                      }
                    }}
                  />
                </label>
              )}
            </div>
          </div>

          <div className={`${styles.formSection} ${styles.formSectionCard}`}>
            <div className={styles.formSectionHeader}>
              <div className={styles.formSection__title}>步骤投料与工艺参数</div>
              <div className={styles.formSection__desc}>维护当前工序实际消耗的物料、规格说明和关键工艺参数。</div>
            </div>

            <div className={styles.materialToolbar}>
              <div className={`${styles.formGroup} ${styles.materialPicker}`}>
                <label className={styles.formLabel}>搜索待添加物料</label>
                <input
                  className={`${styles.formInput} ${styles.materialPicker__input}`}
                  type="search"
                  value={materialSkuKeyword}
                  onChange={(e) => handleMaterialKeywordChange(e.target.value)}
                  onFocus={handleMaterialPickerFocus}
                  onBlur={handleMaterialPickerBlur}
                  placeholder="搜索 SKU 名称 / 编码"
                />
                {selectedSkuOption ? (
                  <div className={styles.materialPicker__selection}>
                    <span className={styles.materialPicker__selectionLabel}>已选择：</span>
                    <strong>{formatSkuOptionLabel(selectedSkuOption)}</strong>
                    {selectedSkuOption.stockUnit ? (
                      <span className={styles.materialPicker__selectionMeta}>库存单位：{selectedSkuOption.stockUnit}</span>
                    ) : null}
                  </div>
                ) : null}
                {materialPickerOpen && materialSkuKeyword.trim() ? (
                  skuOptions.length > 0 ? (
                    <div className={styles.materialSearchResults} role="listbox" aria-label="可新增物料候选">
                      {skuOptions.slice(0, 8).map((sku) => {
                        const isSelected = selectedSkuOption?.id === sku.id;
                        return (
                          <button
                            key={sku.id}
                            type="button"
                            className={`${styles.materialSearchResult} ${isSelected ? styles['materialSearchResult--active'] : ''}`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => handleSelectMaterialSku(sku)}
                          >
                            <span className={styles.materialSearchResult__title}>
                              {formatSkuOptionLabel(sku)}
                            </span>
                            {sku.stockUnit ? (
                              <span className={styles.materialSearchResult__meta}>库存单位：{sku.stockUnit}</span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className={styles.formHelp}>没有匹配到可新增的物料，请尝试更完整的 SKU 编码或名称。</div>
                  )
                ) : null}
              </div>
              <button
                type="button"
                className={`${styles.btn} ${styles['btn--ghost']}`}
                disabled={!selectedSkuOption}
                onClick={() => {
                  if (!selectedSkuOption) return;
                  onAddStepMaterial(selectedSkuOption);
                  setSelectedSkuOption(null);
                  onMaterialSkuKeywordChange('');
                  setMaterialPickerOpen(false);
                }}
              >
                新增物料
              </button>
            </div>

            {bomSuggestions.length > 0 ? (
              <div className={styles.materialToolbar__hint}>
                <span>当前模板已命中活动 BOM，可带入 {bomSuggestions.length} 条未添加的 BOM 汇总物料建议。</span>
                <button
                  type="button"
                  className={`${styles.btn} ${styles['btn--ghost']}`}
                  onClick={onImportBomSuggestions}
                >
                  从 BOM 带入未添加物料
                </button>
              </div>
            ) : stepMaterials.length > 0 ? (
              <div className={styles.formHelp}>当前模板没有可新增的 BOM 汇总物料建议，或这些物料已经全部带入当前步骤。</div>
            ) : null}

            {stepMaterials.length === 0 ? (
              <div className={styles.formHelp}>
                当前步骤还没有维护投料清单。先手工新增物料，或从 BOM 带入建议物料；添加后会在每条物料卡片中显示“常用工艺参数”和“JSON 高级编辑”。
              </div>
            ) : (
              stepMaterials.map((material) => (
                <div key={`${material.stepNo}-${material.inputSkuId}`} className={styles.materialCard}>
                  <div className={styles.materialCard__header}>
                    <div>
                      <div className={styles.materialCard__title}>
                        {material.skuName || material.skuCode || `SKU#${material.inputSkuId}`}
                      </div>
                      <div className={styles.materialCard__subtitle}>
                        {material.skuCode || `SKU#${material.inputSkuId}`}
                      </div>
                    </div>
                    {material.isKeyMaterial ? <span className={styles.materialCard__tag}>关键物料</span> : null}
                  </div>
                  <button
                    type="button"
                    className={styles.materialCard__remove}
                    onClick={() => onRemoveStepMaterial(material.inputSkuId)}
                  >
                    移除物料
                  </button>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>单件净用量</label>
                      <input
                        className={styles.formInput}
                        type="number"
                        min="0"
                        step="0.0001"
                        value={material.usagePerUnit || ''}
                        onChange={(e) => onChangeStepMaterial(material.inputSkuId, {
                          usagePerUnit: Number(e.target.value || 0),
                        })}
                        placeholder="0.0000"
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>损耗率</label>
                      <input
                        className={styles.formInput}
                        type="number"
                        min="0"
                        max="1"
                        step="0.0001"
                        value={material.lossRate || ''}
                        onChange={(e) => onChangeStepMaterial(material.inputSkuId, {
                          lossRate: Number(e.target.value || 0),
                        })}
                        placeholder="0.0000"
                      />
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>消耗时点</label>
                      <select
                        className={styles.formSelect}
                        value={material.consumeTiming}
                        onChange={(e) => onChangeStepMaterial(material.inputSkuId, {
                          consumeTiming: e.target.value as 'start' | 'complete',
                        })}
                      >
                        <option value="start">开工时锁料</option>
                        <option value="complete">完工时扣料</option>
                      </select>
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>物料角色</label>
                      <select
                        className={styles.formSelect}
                        value={material.isKeyMaterial ? 'key' : 'normal'}
                        onChange={(e) => onChangeStepMaterial(material.inputSkuId, {
                          isKeyMaterial: e.target.value === 'key',
                        })}
                      >
                        <option value="normal">普通物料</option>
                        <option value="key">关键物料</option>
                      </select>
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>规格说明</label>
                    <input
                      className={styles.formInput}
                      type="text"
                      value={material.specText}
                      onChange={(e) => onChangeStepMaterial(material.inputSkuId, {
                        specText: e.target.value,
                      })}
                      placeholder="如 1930mm x 195mm x 12mm / 门幅 1450"
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>常用工艺参数</label>
                    <div className={styles.parameterGrid}>
                      {PROCESS_PARAM_FIELDS.map((config) => (
                        <div key={`${material.inputSkuId}-${config.key}`} className={styles.parameterField}>
                          <label className={styles.parameterField__label}>{config.label}</label>
                          <input
                            className={styles.formInput}
                            type="text"
                            inputMode={config.inputMode === 'decimal' ? 'decimal' : 'text'}
                            value={getProcessParamFieldDisplayValue(material.processParams, config.key)}
                            onChange={(e) => updateProcessParamField(material, config, e.target.value)}
                            placeholder={config.placeholder}
                          />
                        </div>
                      ))}
                    </div>
                    <div className={styles.formHelp}>
                      优先在这里维护常用参数；只有遇到特殊字段时，再使用下方 JSON 高级编辑。
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>工艺参数(JSON，高级编辑)</label>
                    <textarea
                      className={styles.formTextarea}
                      style={{ minHeight: '5rem' }}
                      value={material.processParamsText}
                      onChange={(e) => {
                        const nextText = e.target.value;
                        const trimmed = nextText.trim();
                        if (!trimmed) {
                          onChangeStepMaterial(material.inputSkuId, {
                            processParamsText: nextText,
                            processParams: null,
                            processParamsError: null,
                          });
                          return;
                        }
                        try {
                          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
                          onChangeStepMaterial(material.inputSkuId, {
                            processParamsText: nextText,
                            processParams: parsed,
                            processParamsError: null,
                          });
                        } catch {
                          onChangeStepMaterial(material.inputSkuId, {
                            processParamsText: nextText,
                            processParamsError: 'JSON 格式无效，请检查括号、引号和逗号。',
                          });
                        }
                      }}
                      placeholder={'例如：{\n  "门幅": 1450,\n  "面积平方毫米": 234360,\n  "裁片宽": 930,\n  "裁片高": 252\n}'}
                    />
                    <div className={styles.formHelp}>
                      用于保存尺寸、门幅、面积、公式等工艺参数，后续会冻结到工单快照并在任务页展示。
                    </div>
                    {material.processParamsError ? (
                      <div className={styles.materialCard__error}>{material.processParamsError}</div>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 计件单价 */}
          <div className={`${styles.formSection} ${styles.formSectionCard}`}>
            <div className={styles.formSectionHeader}>
              <div className={styles.formSection__title}>计件单价</div>
              <div className={styles.formSection__desc}>用于工资核算，未填写时按默认工价规则处理。</div>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>单价 (元/件)</label>
              <input
                className={styles.formInput}
                type="text"
                inputMode="decimal"
                value={unitPriceDraft}
                onChange={(e) => {
                  const nextDraft = normalizeDecimalDraftInput(e.target.value);
                  if (!isDecimalDraft(nextDraft)) return;
                  setUnitPriceDraft(nextDraft);
                }}
                onBlur={() => {
                  const nextValue = commitDecimalDraft(unitPriceDraft, 0) ?? 0;
                  setUnitPriceDraft(formatDecimalDraft(nextValue));
                  handleField('unitPrice', nextValue);
                }}
                placeholder="0.00"
              />
            </div>
          </div>

          {/* 内联删除确认 */}
          {deleteConfirm && (
            <div className={styles.deleteConfirmRow}>
              <IconWarn />
              <span className={styles.deleteConfirmRow__text}>
                确定要停用此工序吗？
              </span>
              <div className={styles.deleteConfirmRow__btns}>
                <button
                  className={`${styles.btn} ${styles['btn--sm']} ${styles['btn--ghost']}`}
                  onClick={handleDeleteCancel}
                >
                  取消
                </button>
                <button
                  className={`${styles.btn} ${styles['btn--sm']} ${styles['btn--dangerSolid']}`}
                  onClick={handleDeleteConfirm}
                >
                  确认停用
                </button>
              </div>
            </div>
          )}
        </div>

        <footer className={styles.drawer__footer}>
          <div className={styles.drawer__footerLeft}>
            {!deleteConfirm && node.status !== 'deleted' && (
              <button
                className={`${styles.btn} ${styles['btn--danger']}`}
                onClick={handleDeleteClick}
              >
                <IconTrash />
                停用
              </button>
            )}
          </div>
          <div className={styles.drawer__footerRight}>
            <button
              className={`${styles.btn} ${styles['btn--ghost']}`}
              onClick={onClose}
            >
              取消
            </button>
            <button
              className={`${styles.btn} ${styles['btn--primary']}`}
              onClick={onClose}
              disabled={saving}
            >
              {saving ? <span className={styles.btn__spinner} /> : <IconSave />}
              完成
            </button>
          </div>
        </footer>
      </aside>
    </>,
    document.body,
  );
}

// ─────────────────────────────────────────────
// 主页面
// ─────────────────────────────────────────────

export default function ProcessConfigPage() {
  const { setPageTitle, showToast } = useAppStore();

  useEffect(() => {
    setPageTitle('工序配置');
  }, [setPageTitle]);

  // ── 列表查询 ──
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeywordChange = (val: string) => {
    setKeyword(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedKeyword(val), 350);
  };

  const { data: listData, isLoading: listLoading, isError: listError } = useProcessConfigList({
    keyword: debouncedKeyword || undefined,
    pageSize: 100,
  });
  const { data: templateCatalogData } = useProcessConfigCatalog(100);

  const templates: ProcessTemplateListItem[] = listData?.list ?? EMPTY_PROCESS_TEMPLATES;
  const templateCatalog: ProcessTemplateListItem[] = templateCatalogData ?? EMPTY_PROCESS_TEMPLATES;

  // ── 当前选中模板 ──
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // ── 从路由 state 自动定位模板（来自 SKU 工序配置页跳转） ──
  const location = useLocation();
  const autoSelectIdRef = useRef<number | null>(
    (location.state as { selectTemplateId?: number } | null)?.selectTemplateId ?? null,
  );
  useEffect(() => {
    const targetId = autoSelectIdRef.current;
    if (!targetId || listLoading || templates.length === 0) return;
    const found = templates.find((t) => Number(t.id) === targetId);
    if (found) {
      // 使用 found.id（运行时可能是字符串）而非 targetId（number），
      // 保证与模板列表 t.id === selectedId 的比较类型一致
      setSelectedId(found.id as unknown as number);
      setEditorTemplate(null);
      autoSelectIdRef.current = null; // 只触发一次
    }
  }, [listLoading, templates]);

  useEffect(() => {
    if (listLoading || templates.length === 0) return;
    const hasCurrent = selectedId !== null && templates.some((t) => Number(t.id) === Number(selectedId));
    if (hasCurrent) return;
    const next = Number(templates[0].id);
    setSelectedId(next);
    setEditorTemplate(null);
    setStepMaterialDrafts([]);
    setDrawerKey(null);
    setActiveCanvasKey(null);
  }, [listLoading, selectedId, templates]);

  // ── 详情查询 ──
  const { data: detailData, isLoading: detailLoading, isError: detailError } =
    useProcessConfigDetail(selectedId);

  // ── 编辑器本地状态 ──
  const [editorTemplate, setEditorTemplate] = useState<EditorTemplate | null>(null);

  // ── 抽屉状态 ──
  const [drawerKey, setDrawerKey] = useState<number | null>(null);
  const [activeCanvasKey, setActiveCanvasKey] = useState<number | null>(null);

  // ── 提示条 ──
  const [hintVisible, setHintVisible] = useState(true);
  const hintShownRef = useRef(false);

  // ── 新建模态 ──
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createSkuId, setCreateSkuId] = useState<number | null>(null);
  const [createMode, setCreateMode] = useState<'standard' | 'independent' | 'variant'>('independent');
  const [createBaseTemplateId, setCreateBaseTemplateId] = useState<number | null>(null);
  const [skuKeyword, setSkuKeyword] = useState('');
  const [baseTemplateKeyword, setBaseTemplateKeyword] = useState('');
  const [materialSkuKeyword, setMaterialSkuKeyword] = useState('');
  const [activeMaterialSelectionId, setActiveMaterialSelectionId] = useState<number | null>(null);
  const [activeCanvasWorkstationKeyword, setActiveCanvasWorkstationKeyword] = useState('');
  const [activeCanvasOutputKeyword, setActiveCanvasOutputKeyword] = useState('');
  const [activeCanvasPredecessorKeyword, setActiveCanvasPredecessorKeyword] = useState('');
  const [activeCanvasHoursDraft, setActiveCanvasHoursDraft] = useState('');
  const [activeCanvasMaxHoursDraft, setActiveCanvasMaxHoursDraft] = useState('');
  const [activeCanvasUnitPriceDraft, setActiveCanvasUnitPriceDraft] = useState('');
  const [addProcessPredecessorKeyword, setAddProcessPredecessorKeyword] = useState('');
  const [showLinearFlowReference, setShowLinearFlowReference] = useState(false);
  const [activeDagBranchKey, setActiveDagBranchKey] = useState<string | null>(null);
  const [showAddProcessModal, setShowAddProcessModal] = useState(false);
  const [addProcessDraft, setAddProcessDraft] = useState<AddProcessDraft | null>(null);
  const appliedStepUnitPricesRef = useRef(new Map<number, number>());

  // SKU 搜索列表（供新建模板时选择）
  const { data: skuListData } = useSkuList({
    keyword: skuKeyword || undefined,
    pageSize: 30,
  });
  const { data: materialSkuCatalogData } = useSkuList({
    keyword: materialSkuKeyword || undefined,
    pageSize: 200,
  });
  const { data: templateBomHeaders } = useBomList(editorTemplate?.skuId || undefined);
  const activeBomHeader = useMemo(
    () => (templateBomHeaders ?? []).find((item) => item.status === 'active') ?? null,
    [templateBomHeaders],
  );
  const { data: bomRequirements } = useMaterialRequirements(activeBomHeader?.id ?? null, 1);
  const { data: expandedBomDetail } = useBomExpanded(activeBomHeader?.id ?? null);

  // ── 删除模板确认 ──
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // ── 保存状态 ──
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const saveSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasFocusFrameRef = useRef<number | null>(null);
  const canvasFocusTimerRef = useRef<number | null>(null);

  const clearCanvasFocusWork = useCallback(() => {
    if (canvasFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(canvasFocusFrameRef.current);
      canvasFocusFrameRef.current = null;
    }
    if (canvasFocusTimerRef.current) {
      clearTimeout(canvasFocusTimerRef.current);
      canvasFocusTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (saveSuccessTimerRef.current) {
        clearTimeout(saveSuccessTimerRef.current);
        saveSuccessTimerRef.current = null;
      }
      clearCanvasFocusWork();
    };
  }, [clearCanvasFocusWork]);

  // ── 工种类型（动态加载） ──
  const { data: workstationData } = useWorkstationTypes();
  const workstationOptions = workstationData?.map((w) => w.name) ?? WORKSTATION_FALLBACK;
  const { data: workstationRecords } = useProductionWorkstations(true);
  const [workstationManagerOpen, setWorkstationManagerOpen] = useState(false);

  const workstationCountByType = useMemo(() => {
    const counter = new Map<string, number>();
    workstationRecords?.forEach((item) => {
      if (item.status !== 'active') return;
      counter.set(item.type, (counter.get(item.type) ?? 0) + 1);
    });
    return counter;
  }, [workstationRecords]);

  useEffect(() => {
    if (!workstationRecords?.length) return;
    setEditorTemplate((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: prev.nodes.map((node) => {
          if (!node.workstationId) return node;
          const linked = workstationRecords.find((item) => Number(item.id) === Number(node.workstationId));
          if (!linked || linked.name === node.workstationName) return node;
          return {
            ...node,
            workstation: linked.type,
            workstationName: linked.name,
          };
        }),
      };
    });
  }, [workstationRecords]);

  // ── React Query Mutations ──
  const createMutation = useCreateProcessConfig();
  const updateMutation = useUpdateProcessConfig();
  const deleteMutation = useDeleteProcessConfig();
  const setWagesMutation = useSetWages();
  const { data: stepMaterialsData } = useProcessStepMaterials(selectedId);
  const setStepMaterialsMutation = useSetProcessStepMaterials();
  const [stepMaterialDrafts, setStepMaterialDrafts] = useState<StepMaterialDraft[]>([]);
  const stepWageQueries = useQueries({
    queries: (detailData?.steps ?? []).map((step) => ({
      queryKey: ['step-wages', Number(step.id)],
      queryFn: () => processConfigApi.getWages(Number(step.id)),
      enabled: Number(step.id) > 0,
      staleTime: 30_000,
    })),
  });
  const stepUnitPriceMap = useMemo(() => {
    const entries = new Map<number, number>();
    (detailData?.steps ?? []).forEach((step, index) => {
      const wages = stepWageQueries[index]?.data ?? [];
      const preferredWage = wages.find((item) => item.workerGrade === 'skilled') ?? wages[0];
      if (!preferredWage) return;
      const unitPrice = Number(preferredWage.unitPrice);
      if (!Number.isFinite(unitPrice)) return;
      entries.set(Number(step.stepNo), unitPrice);
    });
    return entries;
  }, [detailData?.steps, stepWageQueries]);

  // 当详情加载完成时，同步到本地编辑器状态
  useEffect(() => {
    if (!detailData) return;
    const { template, steps } = detailData;
    const matchedTemplateMeta = templates.find((item) => Number(item.id) === Number(template.id)) ?? null;
    const resolvedSkuCode = template.skuCode ?? matchedTemplateMeta?.skuCode ?? null;
    const resolvedSkuName = template.skuName ?? matchedTemplateMeta?.skuName ?? '';
    const templateMode = template.templateMode
      ?? (template.baseTemplateId ? 'variant' : template.skuId ? 'independent' : 'standard');
    const templateSkuId = Number(template.skuId) || 0;
    const nodes = mapStepsToNodes(steps).map((node) => {
      const normalizedNode = node.outputType === 'final_product' && !node.outputSkuId && templateMode !== 'standard' && templateSkuId > 0
        ? { ...node, outputSkuId: templateSkuId }
        : node;
      if (!normalizedNode.workstationId) return normalizedNode;
      const linked = workstationRecords?.find((item) => Number(item.id) === Number(normalizedNode.workstationId));
      return linked ? { ...normalizedNode, workstation: linked.type, workstationName: linked.name } : normalizedNode;
    });
    setEditorTemplate({
      id: Number(template.id),
      name: template.name,
      // TypeORM 对 bigint 字段运行时返回字符串，强制转 number 避免 Zod positive() 报错
      skuId: templateSkuId,
      skuName: getSkuDisplayName(resolvedSkuCode, resolvedSkuName, ''),
      skuCode: resolvedSkuCode,
      baseTemplateId: template.baseTemplateId ? Number(template.baseTemplateId) : null,
      baseTemplateName: template.baseTemplateName ?? null,
      templateMode,
      version: normalizeText(template.version) || '1.0',
      nodes,
    });
    // 首次进入编辑器显示引导提示
    if (!hintShownRef.current) {
      setHintVisible(true);
      hintShownRef.current = true;
    }
    const activeNodes = nodes.filter((node) => node.status !== 'deleted');
    const firstBranchedNode = activeNodes.find((node) => (node.routeGroupKey?.trim() ?? '') !== '');
    setActiveCanvasKey(firstBranchedNode?._key ?? activeNodes[0]?._key ?? null);
    setShowLinearFlowReference(false);
  }, [detailData]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (stepUnitPriceMap.size === 0) return;
    setEditorTemplate((prev) => {
      if (!prev) return prev;
      const previousApplied = appliedStepUnitPricesRef.current;
      let changed = false;
      const nodes = prev.nodes.map((node) => {
        const unitPrice = stepUnitPriceMap.get(node.seq);
        const previousUnitPrice = previousApplied.get(node.seq);
        if (
          unitPrice === undefined
          || (node.unitPrice !== 0 && node.unitPrice !== previousUnitPrice)
        ) {
          return node;
        }
        changed = true;
        return { ...node, unitPrice };
      });
      appliedStepUnitPricesRef.current = new Map(stepUnitPriceMap);
      return changed ? { ...prev, nodes } : prev;
    });
  }, [stepUnitPriceMap]);

  useEffect(() => {
    if (selectedId === null) {
      setStepMaterialDrafts([]);
      return;
    }
    if (!stepMaterialsData) return;
    setStepMaterialDrafts(stepMaterialsData.map(buildStepMaterialDraft));
  }, [selectedId, stepMaterialsData]);

  // 选中模板时清空编辑器，等待详情加载
  const handleSelectTemplate = (id: number) => {
    if (id === selectedId) return;
    setSelectedId(id);
    setEditorTemplate(null);
    setStepMaterialDrafts([]);
    setDrawerKey(null);
    setActiveCanvasKey(null);
  };

  // 获取当前编辑节点
  const editingNode = drawerKey !== null
    ? editorTemplate?.nodes.find((n) => n._key === drawerKey) ?? null
    : null;
  const editingStepMaterials = useMemo(
    () => (editingNode ? stepMaterialDrafts.filter((item) => item.stepNo === editingNode.seq) : []),
    [editingNode, stepMaterialDrafts],
  );
  const getBomSuggestionsForStep = useCallback((stepNo: number): BomMaterialSuggestion[] => {
    if (!bomRequirements) return [];
    const existedSkuIds = new Set(
      stepMaterialDrafts
        .filter((item) => item.stepNo === stepNo)
        .map((item) => Number(item.inputSkuId)),
    );
    return bomRequirements
      .filter((item) => !existedSkuIds.has(Number(item.skuId)))
      .map((item) => ({
        skuId: Number(item.skuId),
        skuCode: item.skuCode,
        skuName: item.skuName,
        totalQty: item.totalQty,
        spec: item.spec ?? null,
      }));
  }, [bomRequirements, stepMaterialDrafts]);

  const editableBomSuggestions = useMemo(() => {
    if (!editingNode) return [];
    return getBomSuggestionsForStep(editingNode.seq);
  }, [editingNode, getBomSuggestionsForStep]);

  const materialSkuOptions = useMemo(() => {
    const items = materialSkuCatalogData?.list ?? [];
    return items.slice(0, 100).map((item) => ({
      id: Number(item.id),
      skuCode: item.skuCode ?? null,
      name: item.name,
      stockUnit: item.stockUnit ?? null,
    }));
  }, [materialSkuCatalogData]);
  const activeMaterialSelection = useMemo(
    () => materialSkuOptions.find((item) => item.id === activeMaterialSelectionId) ?? null,
    [activeMaterialSelectionId, materialSkuOptions],
  );

  const selectedTemplateMeta = useMemo(
    () => templates.find((item) => Number(item.id) === Number(editorTemplate?.id)) ?? null,
    [editorTemplate?.id, templates],
  );
  const selectedTemplateSkuLabel = useMemo(
    () => formatSkuBadgeLabel(
      selectedTemplateMeta?.skuCode ?? editorTemplate?.skuCode,
      selectedTemplateMeta?.skuName ?? editorTemplate?.skuName,
    ),
    [
      editorTemplate?.skuCode,
      editorTemplate?.skuName,
      selectedTemplateMeta?.skuCode,
      selectedTemplateMeta?.skuName,
    ],
  );
  const activeTemplateMode = editorTemplate?.templateMode ?? 'independent';
  const isStandardTemplate = activeTemplateMode === 'standard';
  const isVariantTemplate = activeTemplateMode === 'variant';
  const templateModeLabel = activeTemplateMode === 'standard'
    ? '标准模板'
    : activeTemplateMode === 'variant'
      ? 'SKU 变体'
      : '独立模板';

  const defaultTemplateBySkuId = useMemo(() => {
    const catalog = new Map<number, InheritedTemplateRef>();
    templateCatalog.forEach((item) => {
      const templateId = Number(item.id);
      const skuId = Number(item.skuId ?? 0);
      if (!item.isDefault || !Number.isInteger(skuId) || skuId <= 0) return;
      if (selectedId !== null && templateId === Number(selectedId)) return;
      if (catalog.has(skuId)) return;
      catalog.set(skuId, {
        templateId,
        templateName: item.name,
        skuId,
        skuCode: item.skuCode ?? null,
        skuName: item.skuName ?? null,
      });
    });
    return catalog;
  }, [selectedId, templateCatalog]);

  const inheritedTemplateIds = useMemo(() => {
    const ids = new Set<number>();
    editorTemplate?.nodes.forEach((node) => {
      if (node.status === 'deleted' || node.outputType !== 'semi_finished' || !node.outputSkuId) return;
      const inheritedRef = defaultTemplateBySkuId.get(Number(node.outputSkuId));
      if (inheritedRef) ids.add(inheritedRef.templateId);
    });
    return [...ids];
  }, [defaultTemplateBySkuId, editorTemplate]);

  const inheritedTemplateDetailQueries = useQueries({
    queries: inheritedTemplateIds.map((templateId) => ({
      queryKey: ['process-config-inherited-detail', templateId],
      queryFn: () => processConfigApi.getById(templateId),
      staleTime: 60_000,
    })),
  });

  const inheritedTemplateStepCountMap = useMemo(() => {
    const stepCountMap = new Map<number, number>();
    inheritedTemplateIds.forEach((templateId, index) => {
      const query = inheritedTemplateDetailQueries[index];
      if (!query?.data) return;
      stepCountMap.set(templateId, query.data.steps.length);
    });
    return stepCountMap;
  }, [inheritedTemplateDetailQueries, inheritedTemplateIds]);

  const inheritedTemplateDetailMap = useMemo(() => {
    const detailMap = new Map<number, NonNullable<(typeof inheritedTemplateDetailQueries)[number]['data']>>();
    inheritedTemplateIds.forEach((templateId, index) => {
      const query = inheritedTemplateDetailQueries[index];
      if (!query?.data) return;
      detailMap.set(templateId, query.data);
    });
    return detailMap;
  }, [inheritedTemplateDetailQueries, inheritedTemplateIds]);

  const getInheritedTemplateRef = useCallback((node: ProcessNode | null) => {
    if (!node || node.status === 'deleted' || node.outputType !== 'semi_finished' || !node.outputSkuId) {
      return null;
    }
    return defaultTemplateBySkuId.get(Number(node.outputSkuId)) ?? null;
  }, [defaultTemplateBySkuId]);

  const getInheritedTemplateStepCount = useCallback((templateId: number | null | undefined) => {
    if (!templateId) return 0;
    return inheritedTemplateStepCountMap.get(Number(templateId)) ?? 0;
  }, [inheritedTemplateStepCountMap]);

  const getInheritedTemplateSteps = useCallback((templateId: number | null | undefined) => {
    if (!templateId) return [] as ProcessStep[];
    return inheritedTemplateDetailMap.get(Number(templateId))?.steps ?? [];
  }, [inheritedTemplateDetailMap]);

  const bomRouteLanes = useMemo(() => {
    if (!expandedBomDetail || !editorTemplate) return [] as BomRouteLane[];
    const semiFinishedOutputMap = new Map<number, ProcessNode[]>();
    editorTemplate.nodes.forEach((node) => {
      if (node.status === 'deleted' || node.outputType !== 'semi_finished' || !node.outputSkuId) return;
      const bucket = semiFinishedOutputMap.get(node.outputSkuId) ?? [];
      bucket.push(node);
      semiFinishedOutputMap.set(node.outputSkuId, bucket);
    });

    const routeNodes = flattenBomRouteNodes(expandedBomDetail.items)
      .filter((item) => item.hasChildren);
    const grouped = new Map<number, BomRouteLane>();
    routeNodes.forEach((item) => {
      const lane = grouped.get(item.topAncestorSkuId) ?? {
        skuId: item.topAncestorSkuId,
        skuName: item.topAncestorSkuName,
        items: [],
      };
      lane.items.push({
        ...item,
        coveredSteps: semiFinishedOutputMap.get(item.skuId) ?? [],
      });
      grouped.set(item.topAncestorSkuId, lane);
    });

    return [...grouped.values()].map((lane) => ({
      ...lane,
      items: lane.items.sort((a, b) => {
        if (a.level !== b.level) return a.level - b.level;
        return a.pathNames.join('>').localeCompare(b.pathNames.join('>'), 'zh-CN');
      }),
    }));
  }, [expandedBomDetail, editorTemplate]);

  const uncoveredBomRouteItems = useMemo(
    () => bomRouteLanes.flatMap((lane) => lane.items).filter((item) => item.coveredSteps.length === 0),
    [bomRouteLanes],
  );

  const dagBranchGroups = useMemo(() => {
    if (!editorTemplate) return [] as Array<{
      key: string;
      label: string;
      nodes: ProcessNode[];
    }>;
    const branchMap = new Map<string, ProcessNode[]>();
    editorTemplate.nodes
      .filter((node) => node.status !== 'deleted')
      .forEach((node) => {
        const key = node.routeGroupKey?.trim() || '__unassigned__';
        const bucket = branchMap.get(key) ?? [];
        bucket.push(node);
        branchMap.set(key, bucket);
      });

    return [...branchMap.entries()]
      .map(([key, nodes]) => ({
        key,
        label: key === '__unassigned__' ? '未设分支' : key,
        nodes: nodes.sort((a, b) => {
          const levelDiff = (a.routeLevel ?? 999) - (b.routeLevel ?? 999);
          if (levelDiff !== 0) return levelDiff;
          return a.seq - b.seq;
        }),
      }))
      .sort((a, b) => {
        if (a.key === '__unassigned__') return 1;
        if (b.key === '__unassigned__') return -1;
        return a.label.localeCompare(b.label, 'zh-CN');
      });
  }, [editorTemplate]);

  const dagSummary = useMemo(() => {
    const activeNodes = editorTemplate?.nodes.filter((node) => node.status !== 'deleted') ?? [];
    return {
      branches: dagBranchGroups.length,
      roots: activeNodes.filter((node) => node.predecessorStepNos.length === 0).length,
      finals: activeNodes.filter((node) => node.outputType === 'final_product').length,
      semis: activeNodes.filter((node) => node.outputType === 'semi_finished').length,
    };
  }, [dagBranchGroups, editorTemplate]);

  const activeDagBranchGroup = useMemo(() => {
    if (dagBranchGroups.length === 0) return null;
    return dagBranchGroups.find((group) => group.key === activeDagBranchKey) ?? dagBranchGroups[0];
  }, [activeDagBranchKey, dagBranchGroups]);

  const activeDagNodes = useMemo(
    () => activeDagBranchGroup?.nodes ?? [],
    [activeDagBranchGroup],
  );

  const standaloneDagNodes = useMemo(
    () => dagBranchGroups.find((group) => group.key === '__unassigned__')?.nodes ?? [],
    [dagBranchGroups],
  );

  const branchedDagGroups = useMemo(
    () => dagBranchGroups.filter((group) => group.key !== '__unassigned__'),
    [dagBranchGroups],
  );

  const standaloneSeqSet = useMemo(
    () => new Set(standaloneDagNodes.map((node) => node.seq)),
    [standaloneDagNodes],
  );

  const canvasBranches = useMemo(() => (
    branchedDagGroups.map((group, index) => ({
      ...group,
      alias: getRouteAlias(index),
      accentColor: ROUTE_ACCENT_COLORS[index % ROUTE_ACCENT_COLORS.length],
      routeItems: bomRouteLanes.find((lane) => lane.skuName === group.key)?.items ?? [],
      stage: standaloneSeqSet.size > 0 && group.nodes.some((node) => node.predecessorStepNos.some((stepNo) => standaloneSeqSet.has(stepNo)))
        ? 'postMerge'
        : 'parallel',
    }))
  ), [bomRouteLanes, branchedDagGroups, standaloneSeqSet]);

  const preMergeBranches = useMemo(
    () => canvasBranches.filter((branch) => branch.stage === 'parallel'),
    [canvasBranches],
  );

  const postMergeBranches = useMemo(
    () => canvasBranches.filter((branch) => branch.stage === 'postMerge'),
    [canvasBranches],
  );

  const activeCanvasNode = useMemo(() => {
    if (!editorTemplate) return null;
    if (activeCanvasKey !== null) {
      const selected = editorTemplate.nodes.find((node) => node._key === activeCanvasKey && node.status !== 'deleted') ?? null;
      if (selected) return selected;
    }
    return editorTemplate.nodes.find((node) => node.status !== 'deleted') ?? null;
  }, [activeCanvasKey, editorTemplate]);
  const activeCanvasNodeKey = activeCanvasNode?._key ?? null;
  const activeCanvasRouteGroupKey = activeCanvasNode?.routeGroupKey?.trim() ?? '';
  const activeCanvasOutputKeywordNormalized = activeCanvasOutputKeyword.trim();
  const activeCanvasUsesStandardFinalPlaceholder = isStandardTemplate && activeCanvasNode?.outputType === 'final_product';
  const activeCanvasOutputSkuTypes = activeCanvasNode?.outputType === 'final_product'
    ? 'finished'
    : activeCanvasNode?.outputType === 'semi_finished'
      ? 'semi_finished'
      : 'semi_finished,finished';

  const { data: outputSkuCatalogData } = useQuery({
    queryKey: ['process-config-output-sku-search', activeCanvasOutputSkuTypes, activeCanvasOutputKeywordNormalized],
    enabled: activeCanvasNode?.outputType !== 'none' && !activeCanvasUsesStandardFinalPlaceholder,
    queryFn: async () => {
      const pageSize = 200;
      const merged = new Map<number, Awaited<ReturnType<typeof skuApi.getList>>['list'][number]>();
      let page = 1;
      let totalPages = 1;

      do {
        const response = await skuApi.getList({
          page,
          pageSize,
          keyword: activeCanvasOutputKeywordNormalized || undefined,
          skuTypes: activeCanvasOutputSkuTypes,
        });

        response.list.forEach((item) => {
          merged.set(Number(item.id), item);
        });

        totalPages = Math.max(
          response.totalPages ?? Math.ceil(response.total / Math.max(response.pageSize || pageSize, 1)),
          1,
        );
        page += 1;
      } while (page <= totalPages);

      return [...merged.values()];
    },
    staleTime: 30_000,
  });

  const activeCanvasPredecessorOptions = useMemo(() => {
    if (!activeCanvasNode || !editorTemplate) return [] as ProcessNode[];
    return editorTemplate.nodes
      .filter((node) => node.status !== 'deleted' && node._key !== activeCanvasNode._key && node.seq < activeCanvasNode.seq)
      .sort((a, b) => a.seq - b.seq);
  }, [activeCanvasNode, editorTemplate]);

  const addProcessPredecessorOptions = useMemo(() => {
    if (!editorTemplate) return [] as ProcessNode[];
    return editorTemplate.nodes
      .filter((node) => node.status !== 'deleted')
      .sort((a, b) => a.seq - b.seq);
  }, [editorTemplate]);
  const addProcessPredecessorResults = useMemo(() => {
    const keyword = addProcessPredecessorKeyword.trim().toLowerCase();
    const items = keyword
      ? addProcessPredecessorOptions.filter((item) => {
        const seqText = `step ${item.seq}`;
        return item.name.toLowerCase().includes(keyword) || seqText.includes(keyword);
      })
      : addProcessPredecessorOptions;
    return items.slice(0, 12);
  }, [addProcessPredecessorKeyword, addProcessPredecessorOptions]);
  const addProcessPredecessorSummary = useMemo(() => {
    if (!addProcessDraft) return [] as Array<{ seq: number; name: string }>;
    const selected = new Set(addProcessDraft.predecessorStepNos);
    return addProcessPredecessorOptions
      .filter((item) => selected.has(item.seq))
      .map((item) => ({ seq: item.seq, name: item.name }));
  }, [addProcessDraft, addProcessPredecessorOptions]);

  const activeCanvasStepMaterials = useMemo(
    () => (activeCanvasNode ? stepMaterialDrafts.filter((item) => item.stepNo === activeCanvasNode.seq) : []),
    [activeCanvasNode, stepMaterialDrafts],
  );
  const stepMaterialCountByStepNo = useMemo(() => {
    const counts = new Map<number, number>();
    stepMaterialDrafts.forEach((item) => {
      counts.set(item.stepNo, (counts.get(item.stepNo) ?? 0) + 1);
    });
    return counts;
  }, [stepMaterialDrafts]);

  const activeCanvasBomSuggestions = useMemo(() => {
    if (!activeCanvasNode) return [];
    return getBomSuggestionsForStep(activeCanvasNode.seq);
  }, [activeCanvasNode, getBomSuggestionsForStep]);

  const outputSkuOptions = useMemo(() => {
    const options = new Map<number, { id: number; label: string; type: 'final' | 'semi_finished' }>();
    const pushOption = (option: { id: number; label: string; type: 'final' | 'semi_finished' }) => {
      if (!option.id || options.has(option.id)) return;
      options.set(option.id, option);
    };

    if (editorTemplate?.skuId) {
      const finalId = Number(editorTemplate.skuId);
      pushOption({
        id: finalId,
        label: selectedTemplateMeta?.skuCode
          ? `${selectedTemplateMeta.skuCode} · ${selectedTemplateMeta.skuName ?? editorTemplate.skuName ?? '当前成品'}`
          : (selectedTemplateMeta?.skuName ?? editorTemplate.skuName ?? '当前成品'),
        type: 'final',
      });
    }

    flattenBomRouteNodes(expandedBomDetail?.items ?? []).forEach((item) => {
      pushOption({
        id: item.skuId,
        label: item.skuCode ? `${item.skuCode} · ${item.skuName}` : item.skuName,
        type: 'semi_finished',
      });
    });

    editorTemplate?.nodes.forEach((node) => {
      if (node.status === 'deleted' || !node.outputSkuId || node.outputType === 'none') return;
      const existingLabel = options.get(Number(node.outputSkuId))?.label;
      pushOption({
        id: Number(node.outputSkuId),
        label: existingLabel ?? (normalizeText(node.name) || `SKU#${node.outputSkuId}`),
        type: node.outputType === 'final_product' ? 'final' : 'semi_finished',
      });
    });

    (outputSkuCatalogData ?? []).forEach((sku) => {
      const isFinal = sku.category1Name === '成品';
      const isSemi = sku.category1Name === '半成品';
      if (!isFinal && !isSemi) return;
      pushOption({
        id: Number(sku.id),
        label: sku.skuCode ? `${sku.skuCode} · ${sku.name}` : sku.name,
        type: isFinal ? 'final' : 'semi_finished',
      });
    });

    return [...options.values()].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'final' ? -1 : 1;
      return a.label.localeCompare(b.label, 'zh-CN');
    });
  }, [
    editorTemplate?.nodes,
    editorTemplate?.skuId,
    editorTemplate?.skuName,
    expandedBomDetail?.items,
    outputSkuCatalogData,
    selectedTemplateMeta,
  ]);
  const outputSkuLabelMap = useMemo(
    () => new Map(outputSkuOptions.map((item) => [item.id, item.label])),
    [outputSkuOptions],
  );
  const activeOutputObjectOptions = useMemo(
    () => {
      if (activeCanvasUsesStandardFinalPlaceholder) return [];
      return outputSkuOptions.filter((item) => (
        activeCanvasNode?.outputType === 'final_product'
          ? item.type === 'final'
          : activeCanvasNode?.outputType === 'semi_finished'
            ? item.type === 'semi_finished'
            : false
      ));
    },
    [activeCanvasNode?.outputType, activeCanvasUsesStandardFinalPlaceholder, outputSkuOptions],
  );
  const activeOutputObject = useMemo(
    () => activeOutputObjectOptions.find((item) => item.id === activeCanvasNode?.outputSkuId) ?? null,
    [activeCanvasNode?.outputSkuId, activeOutputObjectOptions],
  );
  const activeOutputObjectResults = useMemo(() => {
    const keyword = activeCanvasOutputKeywordNormalized.toLowerCase();
    const items = keyword
      ? activeOutputObjectOptions.filter((item) => item.label.toLowerCase().includes(keyword))
      : activeOutputObjectOptions;
    return items.slice(0, 8);
  }, [activeCanvasOutputKeywordNormalized, activeOutputObjectOptions]);

  const activeOutputSummary = useMemo(() => {
    if (!activeCanvasNode) return '未定义';
    if (activeCanvasNode.outputType === 'final_product') {
      if (isStandardTemplate) return '标准模板成品占位';
      return selectedTemplateMeta?.skuCode
        ? `${selectedTemplateMeta.skuCode} · ${selectedTemplateMeta.skuName ?? editorTemplate?.skuName ?? '当前成品'}`
        : (selectedTemplateMeta?.skuName ?? editorTemplate?.skuName ?? '当前成品');
    }
    if (activeCanvasNode.outputType === 'semi_finished' && activeCanvasNode.outputSkuId) {
      return outputSkuLabelMap.get(activeCanvasNode.outputSkuId) ?? `SKU#${activeCanvasNode.outputSkuId}`;
    }
    return '无产出';
  }, [activeCanvasNode, editorTemplate?.skuName, isStandardTemplate, outputSkuLabelMap, selectedTemplateMeta]);

  const activeCanvasInheritedRef = useMemo(
    () => getInheritedTemplateRef(activeCanvasNode),
    [activeCanvasNode, getInheritedTemplateRef],
  );

  const activeCanvasInheritedStepCount = useMemo(
    () => getInheritedTemplateStepCount(activeCanvasInheritedRef?.templateId),
    [activeCanvasInheritedRef?.templateId, getInheritedTemplateStepCount],
  );
  const activeCanvasInheritedSteps = useMemo(
    () => getInheritedTemplateSteps(activeCanvasInheritedRef?.templateId),
    [activeCanvasInheritedRef?.templateId, getInheritedTemplateSteps],
  );
  const activeCanvasInheritedReadonly = Boolean(activeCanvasInheritedRef);
  const activeCanvasWorkstationOptions = useMemo(() => {
    return (workstationRecords ?? [])
      .filter((item) => item.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }, [workstationRecords]);
  const activeCanvasWorkstation = useMemo(
    () => activeCanvasWorkstationOptions.find((item) => Number(item.id) === Number(activeCanvasNode?.workstationId ?? 0)) ?? null,
    [activeCanvasNode?.workstationId, activeCanvasWorkstationOptions],
  );
  const activeCanvasWorkstationResults = useMemo(() => {
    const keyword = activeCanvasWorkstationKeyword.trim().toLowerCase();
    const items = keyword
      ? activeCanvasWorkstationOptions.filter((item) => {
        const name = item.name.toLowerCase();
        const type = item.type.toLowerCase();
        return name.includes(keyword) || type.includes(keyword);
      })
      : activeCanvasWorkstationOptions;
    return items.slice(0, 8);
  }, [activeCanvasWorkstationKeyword, activeCanvasWorkstationOptions]);
  const activeCanvasPredecessorSummary = useMemo(() => {
    if (!activeCanvasNode) return [] as Array<{ seq: number; name: string }>;
    const selected = new Set(activeCanvasNode.predecessorStepNos);
    return activeCanvasPredecessorOptions
      .filter((item) => selected.has(item.seq))
      .map((item) => ({ seq: item.seq, name: item.name }));
  }, [activeCanvasNode, activeCanvasPredecessorOptions]);
  const activeCanvasPredecessorResults = useMemo(() => {
    const keyword = activeCanvasPredecessorKeyword.trim().toLowerCase();
    const items = keyword
      ? activeCanvasPredecessorOptions.filter((item) => {
        const seqText = `step ${item.seq}`;
        return item.name.toLowerCase().includes(keyword) || seqText.includes(keyword);
      })
      : activeCanvasPredecessorOptions;
    return items.slice(0, 12);
  }, [activeCanvasPredecessorKeyword, activeCanvasPredecessorOptions]);

  const activeGuideLines = useMemo(() => {
    if (!activeCanvasNode?.guideText?.trim()) return [];
    return activeCanvasNode.guideText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }, [activeCanvasNode]);

  const postMergeNodes = useMemo(
    () => standaloneDagNodes.filter((node) => node.status !== 'deleted'),
    [standaloneDagNodes],
  );

  useEffect(() => {
    setActiveMaterialSelectionId(null);
    setMaterialSkuKeyword('');
    setActiveCanvasWorkstationKeyword('');
    setActiveCanvasOutputKeyword('');
    setActiveCanvasPredecessorKeyword('');
  }, [activeCanvasNode?._key]);

  useEffect(() => {
    setActiveCanvasHoursDraft(formatDecimalDraft(activeCanvasNode?.hours));
    setActiveCanvasMaxHoursDraft(formatDecimalDraft(activeCanvasNode?.maxHours));
    setActiveCanvasUnitPriceDraft(formatDecimalDraft(activeCanvasNode?.unitPrice));
  }, [activeCanvasNode?._key, activeCanvasNode?.hours, activeCanvasNode?.maxHours, activeCanvasNode?.unitPrice]);

  useEffect(() => {
    if (!showAddProcessModal) {
      setAddProcessPredecessorKeyword('');
    }
  }, [showAddProcessModal]);

  useEffect(() => {
    if (dagBranchGroups.length === 0) {
      setActiveDagBranchKey(null);
      return;
    }
    const currentNodeBranch = activeCanvasNode?.routeGroupKey?.trim() || '__unassigned__';
    const preferredGroup = dagBranchGroups.find((group) => group.key !== '__unassigned__') ?? dagBranchGroups[0];

    if (
      currentNodeBranch
      && currentNodeBranch !== '__unassigned__'
      && dagBranchGroups.some((group) => group.key === currentNodeBranch)
    ) {
      setActiveDagBranchKey((prev) => (prev === currentNodeBranch ? prev : currentNodeBranch));
      return;
    }

    if (currentNodeBranch === '__unassigned__' && preferredGroup.key !== '__unassigned__') {
      setActiveDagBranchKey((prev) => (prev === preferredGroup.key ? prev : preferredGroup.key));
      if (!activeCanvasNode || activeCanvasNode.routeGroupKey?.trim()) return;
      setActiveCanvasKey(preferredGroup.nodes[0]?._key ?? activeCanvasNode._key);
      return;
    }

    setActiveDagBranchKey((prev) => {
      if (prev && dagBranchGroups.some((group) => group.key === prev)) return prev;
      return preferredGroup.key;
    });
  }, [dagBranchGroups, activeCanvasNode]);

  const handleCanvasNodeSelect = useCallback((key: number) => {
    const branchKey = editorTemplate?.nodes.find((node) => node._key === key)?.routeGroupKey?.trim() || '__unassigned__';
    setActiveDagBranchKey(branchKey);
    setActiveCanvasKey(key);
    clearCanvasFocusWork();
    canvasFocusFrameRef.current = window.requestAnimationFrame(() => {
      canvasFocusFrameRef.current = null;
      canvasFocusTimerRef.current = window.setTimeout(() => {
        canvasFocusTimerRef.current = null;
        const target = document.querySelector<HTMLElement>(`[data-dag-node-key="${key}"]`);
        target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        target?.focus();
      }, 60);
    });
  }, [clearCanvasFocusWork, editorTemplate]);

  // 节点变更
  const handleNodeChange = useCallback((updated: ProcessNode) => {
    setEditorTemplate((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: prev.nodes.map((n) => n._key === updated._key ? updated : n),
      };
    });
  }, []);

  const handleActiveNodePatch = useCallback((patch: Partial<ProcessNode>) => {
    if (!activeCanvasNode) return;
    handleNodeChange({
      ...activeCanvasNode,
      ...patch,
      status: activeCanvasNode.status === 'inherit' ? 'modified' : activeCanvasNode.status,
    });
  }, [activeCanvasNode, handleNodeChange]);

  const handleActiveGuideLineChange = useCallback((index: number, value: string) => {
    if (!activeCanvasNode) return;
    const lines = [...activeGuideLines];
    lines[index] = value;
    handleActiveNodePatch({
      guideText: lines.map((line) => line.trim()).filter(Boolean).join('\n'),
    });
  }, [activeCanvasNode, activeGuideLines, handleActiveNodePatch]);

  const handleAddGuideLine = useCallback(() => {
    if (!activeCanvasNode) return;
    const lines = [...activeGuideLines, `步骤 ${activeGuideLines.length + 1}`];
    handleActiveNodePatch({
      guideText: lines.join('\n'),
    });
  }, [activeCanvasNode, activeGuideLines, handleActiveNodePatch]);

  const handleRemoveGuideLine = useCallback((index: number) => {
    if (!activeCanvasNode) return;
    const lines = activeGuideLines.filter((_, lineIndex) => lineIndex !== index);
    handleActiveNodePatch({
      guideText: lines.join('\n'),
    });
  }, [activeCanvasNode, activeGuideLines, handleActiveNodePatch]);

  const handleStepMaterialChange = useCallback((stepNo: number, inputSkuId: number, patch: Partial<StepMaterialDraft>) => {
    setStepMaterialDrafts((prev) => prev.map((item) => (
      item.stepNo === stepNo && item.inputSkuId === inputSkuId
        ? { ...item, ...patch }
        : item
    )));
  }, []);

  const handleActiveStepMaterialPatch = useCallback((inputSkuId: number, patch: Partial<StepMaterialDraft>) => {
    if (!activeCanvasNode) return;
    handleStepMaterialChange(activeCanvasNode.seq, inputSkuId, patch);
  }, [activeCanvasNode, handleStepMaterialChange]);

  const handleAddStepMaterial = useCallback((stepNo: number, sku: { id: number; skuCode: string | null; name: string }) => {
    setStepMaterialDrafts((prev) => {
      const existed = prev.find((item) => item.stepNo === stepNo && item.inputSkuId === sku.id);
      if (existed) return prev;
      return [
        ...prev,
        {
          stepNo,
          inputSkuId: sku.id,
          usagePerUnit: 0,
          lossRate: 0,
          consumeTiming: 'start',
          isKeyMaterial: false,
          specText: '',
          processParams: null,
          processParamsText: '',
          processParamsError: null,
          skuCode: sku.skuCode,
          skuName: sku.name,
        },
      ];
    });
  }, []);

  const handleRemoveStepMaterial = useCallback((stepNo: number, inputSkuId: number) => {
    setStepMaterialDrafts((prev) => prev.filter((item) => !(item.stepNo === stepNo && item.inputSkuId === inputSkuId)));
  }, []);

  const handleImportBomSuggestions = useCallback((stepNo: number) => {
    setStepMaterialDrafts((prev) => {
      const existedSkuIds = new Set(
        prev.filter((item) => item.stepNo === stepNo).map((item) => Number(item.inputSkuId)),
      );
      const additions = getBomSuggestionsForStep(stepNo)
        .filter((item) => !existedSkuIds.has(item.skuId))
        .map((item) => ({
          stepNo,
          inputSkuId: item.skuId,
          usagePerUnit: Number(item.totalQty ?? 0),
          lossRate: 0,
          consumeTiming: 'start' as const,
          isKeyMaterial: false,
          specText: item.spec ?? '',
          processParams: null,
          processParamsText: '',
          processParamsError: null,
          skuCode: item.skuCode ?? null,
          skuName: item.skuName,
      }));
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
  }, [getBomSuggestionsForStep]);

  // 节点停用 —— 立即触发保存，确保停用操作实时持久化
  const handleNodeDelete = useCallback((key: number) => {
    if (!editorTemplate) return;
    const updatedNodes = editorTemplate.nodes.map((n) =>
      n._key === key ? { ...n, status: 'deleted' as NodeStatus } : n,
    );
    setEditorTemplate((prev) => prev ? { ...prev, nodes: updatedNodes } : prev);
    void saveTemplate(editorTemplate, updatedNodes);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorTemplate]);

  const buildSuggestedRouteKey = useCallback((mode: AddProcessMode) => {
    if (mode === 'serial') {
      return activeCanvasNode?.routeGroupKey?.trim() || '';
    }
    const activeNodes = editorTemplate?.nodes.filter((node) => node.status !== 'deleted') ?? [];
    const existedRouteKeys = new Set(
      activeNodes
        .map((node) => node.routeGroupKey?.trim())
        .filter((value): value is string => Boolean(value)),
    );
    let routeIndex = existedRouteKeys.size;
    let nextRouteKey = getRouteAlias(routeIndex);
    while (existedRouteKeys.has(nextRouteKey)) {
      routeIndex += 1;
      nextRouteKey = getRouteAlias(routeIndex);
    }
    return nextRouteKey;
  }, [activeCanvasNode, editorTemplate]);

  const openAddProcessConfigurator = useCallback((mode: AddProcessMode) => {
    if (!editorTemplate) return;
    const activeNodes = editorTemplate.nodes.filter((node) => node.status !== 'deleted');
    const nextSeq = activeNodes.reduce((max, node) => Math.max(max, node.seq), 0) + 1;
    const routeGroupKey = buildSuggestedRouteKey(mode);
    const routeLevel = routeGroupKey
      ? (activeCanvasNode?.routeLevel ?? (mode === 'parallel' ? 1 : 1))
      : '';
    const predecessorStepNos = activeCanvasNode ? [activeCanvasNode.seq] : [];
    setAddProcessDraft({
      mode,
      name: routeGroupKey ? `${routeGroupKey} · 工序 ${nextSeq}` : `工序 ${nextSeq}`,
      executionMode: 'internal',
      routeGroupKey,
      routeLevel,
      predecessorStepNos,
      isFinal: false,
    });
    setShowAddProcessModal(true);
  }, [activeCanvasNode, buildSuggestedRouteKey, editorTemplate]);

  const handleAddNode = useCallback(() => {
    openAddProcessConfigurator('serial');
  }, [openAddProcessConfigurator]);

  const handleAddParallelRoute = useCallback(() => {
    openAddProcessConfigurator('parallel');
  }, [openAddProcessConfigurator]);

  const handleCreateProcessNode = useCallback(() => {
    if (!editorTemplate || !addProcessDraft) return;
    const activeNodes = editorTemplate.nodes.filter((node) => node.status !== 'deleted');
    const nextSeq = activeNodes.reduce((max, node) => Math.max(max, node.seq), 0) + 1;
    const newKey = -Date.now() - nextSeq;
    const normalizedRouteKey = addProcessDraft.routeGroupKey.trim();
    const normalizedLevel = normalizedRouteKey
      ? Number(addProcessDraft.routeLevel || 1)
      : null;
    const nextNode: ProcessNode = {
      _key: newKey,
      id: null,
      seq: nextSeq,
      name: addProcessDraft.name.trim() || (normalizedRouteKey ? `${normalizedRouteKey} · 工序 ${nextSeq}` : `工序 ${nextSeq}`),
      workstation: '',
      workstationId: null,
      workstationName: '',
      executionMode: addProcessDraft.executionMode,
      outputType: addProcessDraft.isFinal ? 'final_product' : 'semi_finished',
      outputSkuId: addProcessDraft.isFinal ? (editorTemplate.skuId || null) : null,
      predecessorStepNos: [...new Set(addProcessDraft.predecessorStepNos)].sort((a, b) => a - b),
      routeGroupKey: normalizedRouteKey,
      routeLevel: normalizedLevel,
      hours: 0,
      maxHours: null,
      guideText: '',
      guideAttachmentUrl: '',
      guideAttachmentName: '',
      unitPrice: 0,
      status: 'added',
    };
    setEditorTemplate((prev) => (prev ? { ...prev, nodes: [...prev.nodes, nextNode] } : prev));
    setActiveDagBranchKey(normalizedRouteKey || '__unassigned__');
    setActiveCanvasKey(newKey);
    setShowAddProcessModal(false);
    setAddProcessDraft(null);
    setDrawerKey(newKey);
  }, [addProcessDraft, editorTemplate]);

  const handleImportBomRouteSkeleton = useCallback(() => {
    setEditorTemplate((prev) => {
      if (!prev || uncoveredBomRouteItems.length === 0) return prev;
      const existingOutputSkuIds = new Set(
        prev.nodes
          .filter((node) => node.status !== 'deleted' && node.outputType === 'semi_finished' && node.outputSkuId)
          .map((node) => Number(node.outputSkuId)),
      );
      let nextSeq = prev.nodes.filter((node) => node.status !== 'deleted').length + 1;
      const additions = uncoveredBomRouteItems
        .filter((item) => !existingOutputSkuIds.has(item.skuId))
        .map((item) => createBomRouteSkeletonNode(item, nextSeq++));
      if (additions.length === 0) return prev;
      return {
        ...prev,
        nodes: [...prev.nodes, ...additions],
      };
    });
    showToast({
      type: 'success',
      message: uncoveredBomRouteItems.length > 0
        ? `已按 BOM 半成品补入 ${uncoveredBomRouteItems.length} 个工序骨架，请继续完善工时与工作站。`
        : '当前所有可拆分半成品都已覆盖，无需补入。',
    });
  }, [showToast, uncoveredBomRouteItems]);

  // 核心保存函数 —— 接受显式 nodes，支持停用立即保存 + 手动保存两种调用路径
  const saveTemplate = async (tmpl: EditorTemplate, nodes: ProcessNode[]) => {
    setSaving(true);
    try {
      const invalidMaterial = stepMaterialDrafts.find((item) => item.processParamsError);
      if (invalidMaterial) {
        showToast({ type: 'error', message: `步骤 ${invalidMaterial.stepNo} 的投料参数 JSON 格式无效，请修正后再保存` });
        return;
      }

      // Step 1: 保存模板基本信息 + 工序列表（skuId=0 时不传，避免 Zod positive() 报错）
      await updateMutation.mutateAsync({
        id: tmpl.id,
        payload: {
          name: tmpl.name,
          version: normalizeText(tmpl.version) || '1.0',
          ...(tmpl.skuId > 0 && { skuId: tmpl.skuId }),
          steps: mapNodesToPayload(nodes, tmpl),
        },
      });

      // Step 2: 获取服务端最新步骤列表（获取新增节点的真实 ID + 最新 maxHours）
      const refreshedDetail = await processConfigApi.getById(tmpl.id);
      const { steps: savedSteps } = refreshedDetail;
      const stepIdByNo = new Map(savedSteps.map((s) => [Number(s.stepNo), Number(s.id)]));
      const activeStepNos = new Set(
        nodes.filter((node) => node.status !== 'deleted').map((node) => node.seq),
      );

      await setStepMaterialsMutation.mutateAsync({
        templateId: tmpl.id,
        items: stepMaterialDrafts
          .filter((item) => activeStepNos.has(item.stepNo))
          .map(materialDraftToPayload),
      });

      // Step 3: 工序 PUT 已经包含 maxHours；这里只串行补齐工价，避免和模板/变体同步并发写造成 MySQL deadlock。
      if (tmpl.templateMode !== 'variant') {
        for (const node of nodes) {
          if (node.status === 'deleted') continue;
          const stepId = stepIdByNo.get(node.seq);
          if (!stepId) continue;
          if (node.unitPrice > 0) {
            await setWagesMutation.mutateAsync({
              stepId,
              payload: { workerGrade: 'skilled', unitPrice: node.unitPrice },
            });
          }
        }
      }

      // Step 4: 用服务端数据重新同步编辑器（回填真实 ID，刷新 maxHours），保留 unitPrice 本地值
      const unitPriceBySeq = new Map(nodes.map((n) => [n.seq, n.unitPrice]));
      const freshNodes = mapStepsToNodes(savedSteps).map((n) => ({
        ...n,
        unitPrice: unitPriceBySeq.get(n.seq) ?? 0,
        workstationName: workstationRecords?.find((item) => Number(item.id) === Number(n.workstationId))?.name ?? '',
      }));
      setEditorTemplate((prev) => prev ? {
        ...prev,
        skuId: Number(refreshedDetail.template.skuId ?? prev.skuId) || 0,
        skuName: getSkuDisplayName(
          refreshedDetail.template.skuCode ?? selectedTemplateMeta?.skuCode ?? prev.skuCode,
          refreshedDetail.template.skuName ?? selectedTemplateMeta?.skuName ?? prev.skuName,
          '',
        ),
        skuCode: refreshedDetail.template.skuCode ?? selectedTemplateMeta?.skuCode ?? prev.skuCode,
        baseTemplateId: refreshedDetail.template.baseTemplateId ? Number(refreshedDetail.template.baseTemplateId) : prev.baseTemplateId,
        baseTemplateName: refreshedDetail.template.baseTemplateName ?? prev.baseTemplateName,
        templateMode: refreshedDetail.template.templateMode ?? prev.templateMode,
        version: normalizeText(refreshedDetail.template.version) || prev.version || '1.0',
        nodes: freshNodes,
      } : prev);

      setSaveSuccess(true);
      if (saveSuccessTimerRef.current) {
        clearTimeout(saveSuccessTimerRef.current);
      }
      saveSuccessTimerRef.current = setTimeout(() => {
        setSaveSuccess(false);
        saveSuccessTimerRef.current = null;
      }, 2200);
      showToast({ type: 'success', message: '工序模板已保存' });
    } catch (error) {
      showToast({
        type: 'error',
        message: error instanceof Error ? error.message : '工序模板保存失败，请稍后重试',
      });
    } finally {
      setSaving(false);
    }
  };

  // 手动点击保存按钮
  const handleSave = async () => {
    if (!editorTemplate) return;
    await saveTemplate(editorTemplate, editorTemplate.nodes);
  };

  // 删除模板
  const handleDeleteTemplate = async () => {
    if (!deleteConfirmId) return;
    await deleteMutation.mutateAsync(deleteConfirmId);
    setDeleteConfirmId(null);
    if (selectedId === deleteConfirmId) {
      setSelectedId(null);
      setEditorTemplate(null);
    }
  };

  const standardTemplateCatalog = useMemo(
    () => templates.filter((item) => (item.templateMode ?? (item.baseTemplateId ? 'variant' : item.skuId ? 'independent' : 'standard')) === 'standard'),
    [templates],
  );
  const selectedCreateBaseTemplate = useMemo(
    () => standardTemplateCatalog.find((item) => Number(item.id) === createBaseTemplateId) ?? null,
    [createBaseTemplateId, standardTemplateCatalog],
  );

  // 新建模板
  const handleCreate = async () => {
    if (!createName.trim()) return;
    if (createMode !== 'standard' && !createSkuId) return;
    if (createMode === 'variant' && !createBaseTemplateId) return;
    const result = await createMutation.mutateAsync({
      name: createName.trim(),
      skuId: createMode === 'standard' ? null : createSkuId,
      baseTemplateId: createMode === 'variant' ? createBaseTemplateId : null,
      steps: [],
    });
    setShowCreateModal(false);
    setCreateName('');
    setCreateSkuId(null);
    setSkuKeyword('');
    setCreateMode('independent');
    setCreateBaseTemplateId(null);
    setBaseTemplateKeyword('');
    setSelectedId(result.id);
  };

  // 模板名称修改
  const handleNameChange = (val: string) => {
    setEditorTemplate((prev) => prev ? { ...prev, name: val } : prev);
  };

  const handleVersionChange = (val: string) => {
    setEditorTemplate((prev) => prev ? { ...prev, version: val.slice(0, 20) } : prev);
  };

  // 活跃节点列表（用于渲染，已停用节点仍渲染但带样式）
  const displayNodes = editorTemplate?.nodes ?? [];

  return (
    <div className={styles.page}>
      {/* ===== 左侧面板 ===== */}
      <nav className={styles.sidebar} aria-label="工序模板列表">
        <div className={styles.sidebar__header}>
          <div className={styles.sidebar__title}>工序模板</div>

          {/* 搜索 */}
          <div className={styles.searchBox}>
            <span className={styles.searchBox__icon}><IconSearch /></span>
            <input
              className={styles.searchBox__input}
              type="search"
              placeholder="搜索模板名称..."
              value={keyword}
              onChange={(e) => handleKeywordChange(e.target.value)}
              aria-label="搜索工序模板"
            />
          </div>

          {/* 新建 */}
          <button
            className={styles.sidebar__createBtn}
            onClick={() => {
              setCreateMode('independent');
              setCreateBaseTemplateId(null);
              setBaseTemplateKeyword('');
              setShowCreateModal(true);
            }}
            aria-label="新建工序模板"
          >
            <IconPlus />
            新建模板
          </button>
        </div>

        <div className={styles.sidebar__list} role="list">
          {listLoading && <SidebarSkeleton />}

          {listError && !listLoading && (
            <div className={styles.sidebar__empty}>加载失败，请刷新重试</div>
          )}

          {!listLoading && !listError && templates.length === 0 && (
            <div className={styles.sidebar__empty}>
              {debouncedKeyword ? '未找到匹配的模板' : '暂无工序模板，点击新建'}
            </div>
          )}

          {!listLoading && templates.map((t) => {
            const isActive = t.id === selectedId;
            return (
              <div
                key={t.id}
                ref={(el) => { if (isActive && el) el.scrollIntoView({ block: 'nearest' }); }}
                className={`${styles.templateItem} ${isActive ? styles['templateItem--active'] : ''}`}
                onClick={() => handleSelectTemplate(t.id)}
                role="listitem"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSelectTemplate(t.id); }}
                aria-selected={isActive}
              >
                <div className={styles.templateItem__icon}>
                  {t.name.charAt(0).toUpperCase()}
                </div>
                <div className={styles.templateItem__info}>
                  <div className={styles.templateItem__name}>{t.name}</div>
                  <div className={styles.templateItem__meta}>
                    {t.skuName ?? t.skuCode ?? '未关联SKU'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </nav>

      {/* ===== 右侧内容区 ===== */}
      <main className={styles.detail}>
        {/* 未选中状态 */}
        {!selectedId && (
          <div className={styles.emptyState}>
            <div className={styles.emptyState__icon}>
              <IconFlow />
            </div>
            <div className={styles.emptyState__title}>选择一个工序模板开始编辑</div>
            <p className={styles.emptyState__desc}>
              从左侧列表选择模板，可查看并编辑其工序流程；或点击"新建模板"创建一个新的工序配置。
            </p>
            <button
              className={`${styles.btn} ${styles['btn--primary']}`}
              onClick={() => {
                setCreateMode('independent');
                setCreateBaseTemplateId(null);
                setBaseTemplateKeyword('');
                setShowCreateModal(true);
              }}
            >
              <IconPlus />
              新建模板
            </button>
          </div>
        )}

        {/* 加载中骨架屏 */}
        {selectedId && detailLoading && <EditorSkeleton />}

        {/* 加载失败 */}
        {selectedId && detailError && !detailLoading && (
          <div className={styles.errorState}>
            <IconWarn />
            <div className={styles.errorState__text}>加载模板详情失败，请稍后重试</div>
            <button
              className={`${styles.btn} ${styles['btn--ghost']}`}
              onClick={() => setSelectedId((id) => id)}
            >
              重新加载
            </button>
          </div>
        )}

        {/* 编辑器 */}
        {selectedId && editorTemplate && !detailLoading && (
          <>
            {/* 编辑器头部 */}
            <header className={styles.editorHeader}>
              <div className={styles.editorHeader__nameWrap}>
                <input
                  className={styles.editorHeader__input}
                  type="text"
                  value={editorTemplate.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  aria-label="模板名称"
                />
                {editorTemplate.skuId > 0 ? (
                  <span className={styles.editorHeader__skuTag}>
                    {selectedTemplateSkuLabel}
                  </span>
                ) : (
                  <span className={styles.editorHeader__skuTagMissing}>
                    未关联 SKU（可在保存时绑定）
                  </span>
                )}
                <span className={styles.editorHeader__skuTag}>
                  {templateModeLabel}
                </span>
                <label className={styles.editorHeader__versionField}>
                  <span>版本</span>
                  <input
                    className={styles.editorHeader__versionInput}
                    type="text"
                    value={editorTemplate.version}
                    onChange={(e) => handleVersionChange(e.target.value)}
                    aria-label="模板版本"
                    placeholder="例如 1.0"
                  />
                </label>
                {isVariantTemplate && editorTemplate.baseTemplateName ? (
                  <span className={styles.editorHeader__skuTag}>
                    引用标准模板：{editorTemplate.baseTemplateName}
                  </span>
                ) : null}
              </div>
              <div className={styles.editorHeader__actions}>
                <button
                  className={`${styles.btn} ${styles['btn--danger']}`}
                  onClick={() => setDeleteConfirmId(editorTemplate.id)}
                  aria-label="删除此模板"
                >
                  <IconTrash />
                  删除模板
                </button>
                <button
                  className={`${styles.btn} ${styles['btn--primary']}`}
                  onClick={handleSave}
                  disabled={saving}
                  aria-label="保存模板"
                >
                  {saving ? (
                    <span className={styles.btn__spinner} />
                  ) : saveSuccess ? (
                    '已保存 ✓'
                  ) : (
                    <>
                      <IconSave />
                      保存
                    </>
                  )}
                </button>
              </div>
            </header>

            {/* 编辑器正文 */}
            <div className={styles.editorBody}>
              {/* 操作引导提示条 */}
              {hintVisible && (
                <div className={styles.hintBar} role="status">
                  <span className={styles.hintBar__icon}><IconInfo /></span>
                  <span className={styles.hintBar__text}>
                    {isVariantTemplate
                      ? '当前是 SKU 变体模板：共享工时、工位、路线和作业说明继承自标准模板，这里只维护输入输出差异。'
                      : '点击节点卡片可编辑工序详情；末尾"+"按钮可添加新工序；编辑完成后点击"保存"提交变更。'}
                  </span>
                  <button
                    className={styles.hintBar__close}
                    onClick={() => setHintVisible(false)}
                    aria-label="关闭提示"
                  >
                    <IconClose />
                  </button>
                </div>
              )}

              {editorTemplate && (
                <section className={styles.routeStudio} aria-label="工艺路线配置工作台">
                  <div className={styles.routeStudio__hero}>
                    <div className={styles.routeStudio__heroMain}>
                      <div className={styles.routeStudio__heroIcon}><IconFlow /></div>
                      <div>
                        <div className={styles.routeStudio__eyebrow}>工艺路线配置</div>
                        <h3 className={styles.routeStudio__title}>{editorTemplate.name}</h3>
                        <div className={styles.routeStudio__subtitle}>
                          产品：{editorTemplate.skuId > 0 ? selectedTemplateSkuLabel : '未关联 SKU'} · {templateModeLabel}{isVariantTemplate && editorTemplate.baseTemplateName ? ` · 源模板 ${editorTemplate.baseTemplateName}` : ''} · 版本：{normalizeText(editorTemplate.version) || '1.0'}
                        </div>
                        <div className={styles.routeStudio__stats}>
                          <span className={styles.routeStudio__statChip}>并行分支 {preMergeBranches.length}</span>
                          <span className={styles.routeStudio__statChip}>汇合后分支 {postMergeBranches.length}</span>
                          <span className={styles.routeStudio__statChip}>主工序 {dagSummary.roots}</span>
                          <span className={styles.routeStudio__statChip}>子工序 {activeDagNodes.length}</span>
                          <span className={styles.routeStudio__statChip}>汇合点 {dagSummary.finals}</span>
                        </div>
                      </div>
                    </div>
                    <div className={styles.routeStudio__heroBadge}>DAG 工作台</div>
                  </div>

                  <div className={styles.routeStudio__toolbar}>
                    <div className={styles.routeStudio__toolbarMain}>
                      <div className={styles.routeStudio__toolbarTitle}>路线画布</div>
                      <div className={styles.routeStudio__toolbarDesc}>
                        维护并行工艺、子工序与汇合节点，右侧面板用于配置当前工序的输入、输出和依赖关系。
                      </div>
                    </div>
                    <div className={styles.routeStudio__toolbarMeta}>
                      <div className={styles.routeCanvasLegend}>
                        <span className={styles.routeCanvasLegend__item}><i className={`${styles.routeCanvasLegend__dot} ${styles['routeCanvasLegend__dot--root']}`} />主工序</span>
                        <span className={styles.routeCanvasLegend__item}><i className={`${styles.routeCanvasLegend__dot} ${styles['routeCanvasLegend__dot--branch']}`} />子工序</span>
                        <span className={styles.routeCanvasLegend__item}><i className={`${styles.routeCanvasLegend__dot} ${styles['routeCanvasLegend__dot--merge']}`} />汇合点</span>
                      </div>
                    </div>
                    <div className={styles.routeStudio__toolbarActions}>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles['btn--ghost']}`}
                        onClick={handleAddNode}
                        disabled={isVariantTemplate}
                      >
                        <IconPlus />
                        添加工序
                      </button>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles['btn--ghost']}`}
                        onClick={handleAddParallelRoute}
                        disabled={isVariantTemplate}
                      >
                        <IconPlus />
                        快捷新增并行
                      </button>
                      {activeBomHeader ? (
                        <button
                          type="button"
                          className={`${styles.btn} ${styles['btn--ghost']}`}
                          onClick={handleImportBomRouteSkeleton}
                          disabled={uncoveredBomRouteItems.length === 0}
                        >
                          从 BOM 自动填充
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={`${styles.btn} ${styles['btn--ghost']}`}
                        onClick={() => setShowLinearFlowReference((prev) => !prev)}
                      >
                        {showLinearFlowReference ? '收起线性参考' : '显示线性参考'}
                      </button>
                    </div>
                  </div>

                  <div className={styles.routeStudio__layout}>
                    <div className={styles.routeCanvasBoard}>
                      <div className={styles.routeCanvasProduct}>
                        <div className={styles.routeCanvasProduct__icon}>📦</div>
                        <div className={styles.routeCanvasProduct__main}>
                          <span className={styles.routeCanvasProduct__badge}>产品根节点</span>
                          <strong>{selectedTemplateMeta?.skuName ?? editorTemplate.skuName ?? '当前产品'}</strong>
                          <span>{selectedTemplateMeta?.skuCode ?? '未关联 SKU'}</span>
                        </div>
                      </div>

                      <div className={styles.routeCanvasConnector}>
                        <span>↓</span>
                      </div>

                      <div className={styles.routeCanvasSummary}>
                        <div className={styles.routeCanvasSummary__item}>
                          <span className={styles.routeCanvasSummary__label}>并行路线</span>
                          <strong>{preMergeBranches.length}</strong>
                        </div>
                        <div className={styles.routeCanvasSummary__item}>
                          <span className={styles.routeCanvasSummary__label}>汇合工序</span>
                          <strong>{postMergeNodes.length}</strong>
                        </div>
                        <div className={styles.routeCanvasSummary__item}>
                          <span className={styles.routeCanvasSummary__label}>后置分支</span>
                          <strong>{postMergeBranches.length}</strong>
                        </div>
                        <div className={styles.routeCanvasSummary__item}>
                          <span className={styles.routeCanvasSummary__label}>总工序</span>
                          <strong>{activeDagNodes.length}</strong>
                        </div>
                      </div>

                      {preMergeBranches.length > 0 ? (
                        <section className={`${styles.routeCanvasStage} ${styles['routeCanvasStage--parallel']}`}>
                          <header className={styles.routeCanvasStage__header}>
                            <div className={styles.routeCanvasStage__headline}>
                              <div className={styles.routeCanvasStage__stageNo}>阶段 01</div>
                              <div>
                                <div className={styles.routeCanvasParallelTag}>并行工艺路线</div>
                                <div className={styles.routeCanvasStage__meta}>各泳道表示同一成品下可并行释放的半成品工艺分支</div>
                              </div>
                            </div>
                            <div className={styles.routeCanvasStage__metrics}>
                              <span>{preMergeBranches.length} 条泳道</span>
                              <span>{preMergeBranches.reduce((sum, branch) => sum + branch.nodes.length, 0)} 道工序</span>
                            </div>
                          </header>
                          <div className={styles.routeCanvasBranchGrid}>
                            {preMergeBranches.map((branch) => {
                              const isActiveBranch = activeDagBranchGroup?.key === branch.key;
                              const uncoveredCount = branch.routeItems.filter((item) => item.coveredSteps.length === 0).length;
                              return (
                                <section
                                  key={branch.key}
                                  className={`${styles.routeBranchLane} ${isActiveBranch ? styles['routeBranchLane--active'] : ''}`}
                                  style={{ ['--route-accent' as string]: branch.accentColor }}
                                >
                                  <header className={styles.routeBranchLane__header}>
                                    <div className={styles.routeBranchLane__titleBlock}>
                                      <span className={styles.routeBranchLane__alias}>{branch.alias}</span>
                                      <strong>{branch.label}</strong>
                                      <div className={styles.routeBranchLane__subtitle}>对应 BOM 节点 {branch.routeItems.length} 个，按当前模板映射到本分支工艺路线。</div>
                                    </div>
                                    <div className={styles.routeBranchLane__meta}>
                                      <span>{branch.nodes.length} 道工序</span>
                                      <span>{branch.routeItems.length} 个 BOM 节点</span>
                                      {uncoveredCount > 0 ? <span>待补 {uncoveredCount}</span> : <span>已覆盖</span>}
                                    </div>
                                  </header>
                                  <div className={styles.routeBranchLane__body}>
                                    {groupProcessNodesByLevel(branch.nodes).map((levelGroup) => (
                                      <div key={`${branch.key}-level-${levelGroup.level}`} className={styles.routeBranchLane__levelGroup}>
                                        <div className={styles.routeBranchLane__levelHeader}>
                                          <div className={styles.routeBranchLane__levelBadge}>L{levelGroup.level}</div>
                                          <div className={styles.routeBranchLane__levelHint}>
                                            {levelGroup.level <= 1 ? '起始层，支持并行起步' : `承接 L${levelGroup.level - 1} 推进`}
                                          </div>
                                        </div>
                                        <div className={styles.routeBranchLane__levelNodes}>
                                          {levelGroup.nodes.map((node) => {
                                            const inheritedRef = getInheritedTemplateRef(node);
                                            const inheritedStepCount = getInheritedTemplateStepCount(inheritedRef?.templateId);
                                            const inheritedPreviewSteps = getInheritedTemplateSteps(inheritedRef?.templateId).slice(0, 2);
                                            const predecessorLabels = node.predecessorStepNos
                                              .map((stepNo) => editorTemplate?.nodes.find((item) => item.seq === stepNo && item.status !== 'deleted'))
                                              .filter((item): item is ProcessNode => Boolean(item))
                                              .map((item) => `Step ${item.seq}`);
                                            const guideChips = normalizeText(node.guideText)
                                              .split('\n')
                                              .map((line) => line.trim())
                                              .filter(Boolean);
                                            const stepMaterialCount = stepMaterialCountByStepNo.get(node.seq) ?? 0;
                                            const dependencyModeLabel = getDependencyModeLabel(node);
                                            const outputLabel = node.outputType === 'final_product'
                                              ? (selectedTemplateMeta?.skuCode
                                                ? `${selectedTemplateMeta.skuCode} · ${selectedTemplateMeta.skuName ?? editorTemplate.skuName ?? '当前成品'}`
                                                : (selectedTemplateMeta?.skuName ?? editorTemplate.skuName ?? '当前成品'))
                                              : node.outputType === 'semi_finished' && node.outputSkuId
                                                ? (outputSkuLabelMap.get(node.outputSkuId) ?? `SKU#${node.outputSkuId}`)
                                                : '无产出';
                                            return (
                                              <div
                                                key={node._key}
                                                role="button"
                                                tabIndex={0}
                                                data-dag-node-key={node._key}
                                                className={`${styles.routeProcessCard} ${activeCanvasNodeKey === node._key ? styles['routeProcessCard--active'] : ''} ${inheritedRef ? styles['routeProcessCard--inheritSource'] : ''}`}
                                                onClick={() => handleCanvasNodeSelect(node._key)}
                                                onKeyDown={(event) => {
                                                  if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    handleCanvasNodeSelect(node._key);
                                                  }
                                                }}
                                              >
                                          <div className={styles.routeProcessCard__main}>
                                            <div className={styles.routeProcessCard__header}>
                                              <span className={styles.routeProcessCard__seq}>{node.seq}</span>
                                              <div>
                                                <div className={styles.routeProcessCard__eyebrow}>主工序节点</div>
                                                <strong>{getProcessNodeDisplayName(node, outputSkuLabelMap)}</strong>
                                                <div className={styles.routeProcessCard__sub}>{node.workstationName || node.workstation || '未指定工作站'}</div>
                                                <div className={styles.routeProcessCard__branchMeta}>
                                                  分支 {node.routeGroupKey || '主线'} · 层级 L{node.routeLevel ?? '-'}
                                                </div>
                                                {inheritedRef ? (
                                                  <div className={styles.routeProcessCard__inheritMeta}>
                                                    继承引用 · {inheritedRef.skuCode ? `${inheritedRef.skuCode} · ` : ''}{inheritedRef.skuName ?? `SKU#${inheritedRef.skuId}`} · {inheritedRef.templateName}{inheritedStepCount > 0 ? ` · ${inheritedStepCount} 道工序` : ''}
                                                  </div>
                                                ) : null}
                                              </div>
                                              <div className={styles.routeProcessCard__typeGroup}>
                                                <span className={styles.routeProcessCard__type}>{getOutputTypeLabel(node.outputType)}</span>
                                                {inheritedRef ? (
                                                  <span className={styles.routeProcessCard__inheritBadge}>引用型</span>
                                                ) : null}
                                              </div>
                                              <button
                                                type="button"
                                                className={styles.routeProcessCard__delete}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleNodeDelete(node._key);
                                                }}
                                                aria-label={`删除 ${node.name}`}
                                                title="删除节点"
                                              >
                                                <IconTrash />
                                              </button>
                                            </div>
                                            <div className={styles.routeProcessCard__meta}>
                                              <span>{node.executionMode === 'outsource' ? '外协采购' : '厂内生产'}</span>
                                              <span>{predecessorLabels.length > 0 ? predecessorLabels.join('、') : '并行起步'}</span>
                                            </div>
                                            <div className={styles.routeProcessCard__dependency}>
                                              <span className={styles.routeProcessCard__dependencyMode}>{dependencyModeLabel}</span>
                                              <span className={styles.routeProcessCard__dependencyText}>
                                                {predecessorLabels.length > 0 ? `依赖 ${predecessorLabels.join('、')}` : '当前节点无前置工序，可直接并行启动'}
                                              </span>
                                            </div>
                                          </div>
                                          <div className={styles.routeProcessCard__summary}>
                                            <span className={styles.routeProcessCard__summaryChip}>前置 {predecessorLabels.length}</span>
                                            <span className={styles.routeProcessCard__summaryChip}>子工序 {guideChips.length}</span>
                                            <span className={styles.routeProcessCard__summaryChip}>投料 {stepMaterialCount}</span>
                                            {inheritedRef ? (
                                              <span className={`${styles.routeProcessCard__summaryChip} ${styles['routeProcessCard__summaryChip--inherit']}`}>继承模板</span>
                                            ) : null}
                                          </div>
                                          {guideChips.length > 0 ? (
                                            <div className={styles.routeProcessCard__guideSection}>
                                              <div className={styles.routeProcessCard__guideTitle}>子工序</div>
                                              <div className={styles.routeProcessCard__guideList}>
                                                {guideChips.map((line, index) => (
                                                  <span key={`${node._key}-guide-chip-${index}`} className={styles.routeProcessCard__guideChip}>
                                                    <i className={styles.routeProcessCard__guideChipIndex}>{index + 1}</i>
                                                    <span className={styles.routeProcessCard__guideChipText}>{line}</span>
                                                  </span>
                                                ))}
                                              </div>
                                            </div>
                                          ) : null}
                                          {inheritedRef && inheritedPreviewSteps.length > 0 ? (
                                            <div className={styles.routeProcessCard__inheritSection}>
                                              <div className={styles.routeProcessCard__guideTitle}>继承节点预览</div>
                                              <div className={styles.routeProcessCard__inheritSteps}>
                                                {inheritedPreviewSteps.map((step) => (
                                                  <span key={`${node._key}-inherit-preview-${step.id}`} className={styles.routeProcessCard__inheritStep}>
                                                    Step {step.stepNo} · {step.stepName}
                                                  </span>
                                                ))}
                                                {inheritedStepCount > inheritedPreviewSteps.length ? (
                                                  <span className={styles.routeProcessCard__inheritMore}>+{inheritedStepCount - inheritedPreviewSteps.length} 道</span>
                                                ) : null}
                                              </div>
                                            </div>
                                          ) : null}
                                          <div className={styles.routeProcessCard__footer}>
                                            <div className={styles.routeProcessCard__io}>
                                              <div className={styles.routeProcessCard__ioItem}>
                                                <span className={styles.routeProcessCard__ioLabel}>输入</span>
                                                <span className={`${styles.routeProcessCard__tag} ${styles['routeProcessCard__tag--input']}`}>
                                                  {activeCanvasNodeKey === node._key ? `${activeCanvasStepMaterials.length} 项投料` : '选择后查看投料'}
                                                </span>
                                              </div>
                                              <div className={styles.routeProcessCard__ioItem}>
                                                <span className={styles.routeProcessCard__ioLabel}>输出</span>
                                                <span className={`${styles.routeProcessCard__tag} ${styles['routeProcessCard__tag--output']}`}>
                                                  {outputLabel}
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </section>
                              );
                            })}
                          </div>
                        </section>
                      ) : (
                        <div className={styles.routeStudio__empty}>
                          当前模板还没有可展示的并行分支。先从 BOM 自动填充，或直接新增工序开始配置。
                        </div>
                      )}

                      {preMergeBranches.length > 0 && postMergeNodes.length > 0 ? (
                        <div className={styles.routeCanvasBridge}>
                          <span className={styles.routeCanvasBridge__label}>并行路线汇合</span>
                        </div>
                      ) : null}

                      {postMergeNodes.length > 0 ? (
                        <section className={`${styles.routeCanvasStage} ${styles['routeCanvasStage--merge']}`}>
                          <header className={styles.routeCanvasStage__header}>
                            <div className={styles.routeCanvasStage__headline}>
                              <div className={styles.routeCanvasStage__stageNo}>阶段 02</div>
                              <div>
                                <div className={styles.routeCanvasMergeBadge}>路线汇合点</div>
                                <div className={styles.routeCanvasStage__meta}>并行分支在此汇合，进入总装、包装或最终成品输出工序</div>
                              </div>
                            </div>
                            <div className={styles.routeCanvasStage__metrics}>
                              <span>{postMergeNodes.length} 道汇合工序</span>
                            </div>
                          </header>
                          <div className={styles.routeCanvasFinalRow}>
                            {postMergeNodes.map((node) => {
                              const predecessorLabels = node.predecessorStepNos
                                .map((stepNo) => editorTemplate?.nodes.find((item) => item.seq === stepNo && item.status !== 'deleted'))
                                .filter((item): item is ProcessNode => Boolean(item))
                                .map((item) => `Step ${item.seq}`);
                              const dependencyModeLabel = getDependencyModeLabel(node);
                              const outputLabel = node.outputType === 'final_product'
                                ? (selectedTemplateMeta?.skuCode
                                  ? `${selectedTemplateMeta.skuCode} · ${selectedTemplateMeta.skuName ?? editorTemplate.skuName ?? '当前成品'}`
                                  : (selectedTemplateMeta?.skuName ?? editorTemplate.skuName ?? '当前成品'))
                                : node.outputType === 'semi_finished' && node.outputSkuId
                                  ? (outputSkuLabelMap.get(node.outputSkuId) ?? `SKU#${node.outputSkuId}`)
                                  : '无产出';
                              return (
                                <div
                                  key={node._key}
                                  role="button"
                                  tabIndex={0}
                                  data-dag-node-key={node._key}
                                  className={`${styles.routeFinalCard} ${activeCanvasNodeKey === node._key ? styles['routeFinalCard--active'] : ''}`}
                                  onClick={() => handleCanvasNodeSelect(node._key)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault();
                                      handleCanvasNodeSelect(node._key);
                                    }
                                  }}
                                >
                                  <div className={styles.routeFinalCard__header}>
                                    <div className={styles.routeFinalCard__seq}>Step {node.seq}</div>
                                    <button
                                      type="button"
                                      className={styles.routeProcessCard__delete}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleNodeDelete(node._key);
                                      }}
                                      aria-label={`删除 ${node.name}`}
                                      title="删除节点"
                                    >
                                      <IconTrash />
                                    </button>
                                  </div>
                                  <strong>{getProcessNodeDisplayName(node, outputSkuLabelMap)}</strong>
                                  <span className={`${styles.routeProcessCard__tag} ${styles['routeProcessCard__tag--output']}`}>
                                    ↑ {getOutputTypeLabel(node.outputType)}
                                  </span>
                                  <div className={styles.routeFinalCard__dependency}>
                                    <span className={styles.routeProcessCard__dependencyMode}>{dependencyModeLabel}</span>
                                    <span className={styles.routeFinalCard__dependencyText}>
                                      {predecessorLabels.length > 0 ? `依赖 ${predecessorLabels.join('、')}` : '当前节点无前置工序'}
                                    </span>
                                  </div>
                                  <div className={styles.routeFinalCard__meta}>{outputLabel}</div>
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      ) : null}

                      {postMergeNodes.length > 0 && postMergeBranches.length > 0 ? (
                        <div className={styles.routeCanvasBridge}>
                          <span className={styles.routeCanvasBridge__label}>汇合后再分支</span>
                        </div>
                      ) : null}

                      {postMergeBranches.length > 0 ? (
                        <section className={`${styles.routeCanvasStage} ${styles['routeCanvasStage--postMerge']}`}>
                          <header className={styles.routeCanvasStage__header}>
                            <div className={styles.routeCanvasStage__headline}>
                              <div className={styles.routeCanvasStage__stageNo}>阶段 03</div>
                              <div>
                                <div className={styles.routeCanvasRebranchTag}>汇合后分支</div>
                                <div className={styles.routeCanvasStage__meta}>用于表示汇合节点之后再次分叉出的并行工艺路线，可继续串行推进或再汇合。</div>
                              </div>
                            </div>
                            <div className={styles.routeCanvasStage__metrics}>
                              <span>{postMergeBranches.length} 条后置分支</span>
                              <span>{postMergeBranches.reduce((sum, branch) => sum + branch.nodes.length, 0)} 道工序</span>
                            </div>
                          </header>
                          <div className={styles.routeCanvasBranchGrid}>
                            {postMergeBranches.map((branch) => {
                              const isActiveBranch = activeDagBranchGroup?.key === branch.key;
                              const uncoveredCount = branch.routeItems.filter((item) => item.coveredSteps.length === 0).length;
                              return (
                                <section
                                  key={`${branch.key}-post`}
                                  className={`${styles.routeBranchLane} ${isActiveBranch ? styles['routeBranchLane--active'] : ''}`}
                                  style={{ ['--route-accent' as string]: branch.accentColor }}
                                >
                                  <header className={styles.routeBranchLane__header}>
                                    <div className={styles.routeBranchLane__titleBlock}>
                                      <span className={styles.routeBranchLane__alias}>{branch.alias}</span>
                                      <strong>{branch.label}</strong>
                                      <div className={styles.routeBranchLane__subtitle}>由汇合点或主线再次拆出的后置分支，可自定义继续并行或串行推进。</div>
                                    </div>
                                    <div className={styles.routeBranchLane__meta}>
                                      <span>{branch.nodes.length} 道工序</span>
                                      <span>{branch.routeItems.length} 个 BOM 节点</span>
                                      {uncoveredCount > 0 ? <span>待补 {uncoveredCount}</span> : <span>已覆盖</span>}
                                    </div>
                                  </header>
                                  <div className={styles.routeBranchLane__body}>
                                    {groupProcessNodesByLevel(branch.nodes).map((levelGroup) => (
                                      <div key={`${branch.key}-post-level-${levelGroup.level}`} className={styles.routeBranchLane__levelGroup}>
                                        <div className={styles.routeBranchLane__levelHeader}>
                                          <div className={styles.routeBranchLane__levelBadge}>L{levelGroup.level}</div>
                                          <div className={styles.routeBranchLane__levelHint}>
                                            {levelGroup.level <= 1 ? '后置起始层，可重新分叉' : `承接 L${levelGroup.level - 1} 推进`}
                                          </div>
                                        </div>
                                        <div className={styles.routeBranchLane__levelNodes}>
                                          {levelGroup.nodes.map((node) => {
                                            const inheritedRef = getInheritedTemplateRef(node);
                                            const inheritedStepCount = getInheritedTemplateStepCount(inheritedRef?.templateId);
                                            const inheritedPreviewSteps = getInheritedTemplateSteps(inheritedRef?.templateId).slice(0, 2);
                                            const predecessorLabels = node.predecessorStepNos
                                              .map((stepNo) => editorTemplate?.nodes.find((item) => item.seq === stepNo && item.status !== 'deleted'))
                                              .filter((item): item is ProcessNode => Boolean(item))
                                              .map((item) => `Step ${item.seq}`);
                                            const guideChips = normalizeText(node.guideText)
                                              .split('\n')
                                              .map((line) => line.trim())
                                              .filter(Boolean);
                                            const stepMaterialCount = stepMaterialCountByStepNo.get(node.seq) ?? 0;
                                            const dependencyModeLabel = getDependencyModeLabel(node);
                                            const outputLabel = node.outputType === 'final_product'
                                              ? (selectedTemplateMeta?.skuCode
                                                ? `${selectedTemplateMeta.skuCode} · ${selectedTemplateMeta.skuName ?? editorTemplate.skuName ?? '当前成品'}`
                                                : (selectedTemplateMeta?.skuName ?? editorTemplate.skuName ?? '当前成品'))
                                              : node.outputType === 'semi_finished' && node.outputSkuId
                                                ? (outputSkuLabelMap.get(node.outputSkuId) ?? `SKU#${node.outputSkuId}`)
                                                : '无产出';
                                            return (
                                              <button
                                                key={node._key}
                                                type="button"
                                                data-dag-node-key={node._key}
                                                className={`${styles.routeProcessCard} ${activeCanvasNodeKey === node._key ? styles['routeProcessCard--active'] : ''} ${inheritedRef ? styles['routeProcessCard--inheritSource'] : ''}`}
                                                onClick={() => handleCanvasNodeSelect(node._key)}
                                              >
                                          <div className={styles.routeProcessCard__main}>
                                            <div className={styles.routeProcessCard__header}>
                                              <span className={styles.routeProcessCard__seq}>{node.seq}</span>
                                              <div>
                                                <div className={styles.routeProcessCard__eyebrow}>主工序节点</div>
                                                <strong>{getProcessNodeDisplayName(node, outputSkuLabelMap)}</strong>
                                                <div className={styles.routeProcessCard__sub}>{node.workstationName || node.workstation || '未指定工作站'}</div>
                                                <div className={styles.routeProcessCard__branchMeta}>
                                                  分支 {node.routeGroupKey || '主线'} · 层级 L{node.routeLevel ?? '-'}
                                                </div>
                                                {inheritedRef ? (
                                                  <div className={styles.routeProcessCard__inheritMeta}>
                                                    继承引用 · {inheritedRef.skuCode ? `${inheritedRef.skuCode} · ` : ''}{inheritedRef.skuName ?? `SKU#${inheritedRef.skuId}`} · {inheritedRef.templateName}{inheritedStepCount > 0 ? ` · ${inheritedStepCount} 道工序` : ''}
                                                  </div>
                                                ) : null}
                                              </div>
                                              <div className={styles.routeProcessCard__typeGroup}>
                                                <span className={styles.routeProcessCard__type}>{getOutputTypeLabel(node.outputType)}</span>
                                                {inheritedRef ? (
                                                  <span className={styles.routeProcessCard__inheritBadge}>引用型</span>
                                                ) : null}
                                              </div>
                                              <button
                                                type="button"
                                                className={styles.routeProcessCard__delete}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleNodeDelete(node._key);
                                                }}
                                                aria-label={`删除 ${node.name}`}
                                                title="删除节点"
                                              >
                                                <IconTrash />
                                              </button>
                                            </div>
                                            <div className={styles.routeProcessCard__meta}>
                                              <span>{node.executionMode === 'outsource' ? '外协采购' : '厂内生产'}</span>
                                              <span>{predecessorLabels.length > 0 ? predecessorLabels.join('、') : '并行起步'}</span>
                                            </div>
                                            <div className={styles.routeProcessCard__dependency}>
                                              <span className={styles.routeProcessCard__dependencyMode}>{dependencyModeLabel}</span>
                                              <span className={styles.routeProcessCard__dependencyText}>
                                                {predecessorLabels.length > 0 ? `依赖 ${predecessorLabels.join('、')}` : '当前节点无前置工序，可直接并行启动'}
                                              </span>
                                            </div>
                                          </div>
                                          <div className={styles.routeProcessCard__summary}>
                                            <span className={styles.routeProcessCard__summaryChip}>前置 {predecessorLabels.length}</span>
                                            <span className={styles.routeProcessCard__summaryChip}>子工序 {guideChips.length}</span>
                                            <span className={styles.routeProcessCard__summaryChip}>投料 {stepMaterialCount}</span>
                                            {inheritedRef ? (
                                              <span className={`${styles.routeProcessCard__summaryChip} ${styles['routeProcessCard__summaryChip--inherit']}`}>继承模板</span>
                                            ) : null}
                                          </div>
                                          {guideChips.length > 0 ? (
                                            <div className={styles.routeProcessCard__guideSection}>
                                              <div className={styles.routeProcessCard__guideTitle}>子工序</div>
                                              <div className={styles.routeProcessCard__guideList}>
                                                {guideChips.map((line, index) => (
                                                  <span key={`${node._key}-post-guide-chip-${index}`} className={styles.routeProcessCard__guideChip}>
                                                    <i className={styles.routeProcessCard__guideChipIndex}>{index + 1}</i>
                                                    <span className={styles.routeProcessCard__guideChipText}>{line}</span>
                                                  </span>
                                                ))}
                                              </div>
                                            </div>
                                          ) : null}
                                          {inheritedRef && inheritedPreviewSteps.length > 0 ? (
                                            <div className={styles.routeProcessCard__inheritSection}>
                                              <div className={styles.routeProcessCard__guideTitle}>继承节点预览</div>
                                              <div className={styles.routeProcessCard__inheritSteps}>
                                                {inheritedPreviewSteps.map((step) => (
                                                  <span key={`${node._key}-post-inherit-preview-${step.id}`} className={styles.routeProcessCard__inheritStep}>
                                                    Step {step.stepNo} · {step.stepName}
                                                  </span>
                                                ))}
                                                {inheritedStepCount > inheritedPreviewSteps.length ? (
                                                  <span className={styles.routeProcessCard__inheritMore}>+{inheritedStepCount - inheritedPreviewSteps.length} 道</span>
                                                ) : null}
                                              </div>
                                            </div>
                                          ) : null}
                                          <div className={styles.routeProcessCard__footer}>
                                            <div className={styles.routeProcessCard__io}>
                                              <div className={styles.routeProcessCard__ioItem}>
                                                <span className={styles.routeProcessCard__ioLabel}>输入</span>
                                                <span className={`${styles.routeProcessCard__tag} ${styles['routeProcessCard__tag--input']}`}>
                                                  {activeCanvasNodeKey === node._key ? `${activeCanvasStepMaterials.length} 项投料` : '选择后查看投料'}
                                                </span>
                                              </div>
                                              <div className={styles.routeProcessCard__ioItem}>
                                                <span className={styles.routeProcessCard__ioLabel}>输出</span>
                                                <span className={`${styles.routeProcessCard__tag} ${styles['routeProcessCard__tag--output']}`}>
                                                  {outputLabel}
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </section>
                              );
                            })}
                          </div>
                        </section>
                      ) : null}

                      {showLinearFlowReference && (
                        <div className={styles.routeStudio__reference}>
                          <div className={styles.routeStudio__referenceTitle}>线性参考</div>
                          <div className={styles.flowCanvas} role="region" aria-label="工序流程图">
                            <div className={styles.flowTrack}>
                              {displayNodes.map((node, idx) => (
                                <div key={node._key} style={{ display: 'flex', alignItems: 'center' }}>
                                  {idx > 0 && (
                                    <span className={styles.flowArrow}>
                                      <IconArrowRight />
                                    </span>
                                  )}
                                  <FlowNodeCard
                                    node={node}
                                    isSelected={activeCanvasNode?._key === node._key}
                                    predecessorLabels={node.predecessorStepNos
                                      .map((stepNo) => displayNodes.find((item) => item.seq === stepNo && item.status !== 'deleted'))
                                      .filter((item): item is ProcessNode => Boolean(item))
                                      .map((item) => `Step ${item.seq}`)}
                                    onClick={() => handleCanvasNodeSelect(node._key)}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <aside className={styles.routeStudioPanel}>
                      {activeCanvasNode ? (
                        <>
                      <div className={styles.routeStudioPanel__header}>
                        <div>
                          <div className={styles.routeStudioPanel__eyebrow}>工序配置</div>
                          <h3 className={styles.routeStudioPanel__title}>{getProcessNodeDisplayName(activeCanvasNode, outputSkuLabelMap)}</h3>
                          <div className={styles.routeStudioPanel__subtitle}>Step {activeCanvasNode.seq} · {activeCanvasNode.routeGroupKey || '未设分支'}</div>
                          <div className={styles.routeStudioPanel__headerMeta}>
                            <span className={styles.routeStudioPanel__headerChip}>前置 {activeCanvasNode.predecessorStepNos.length || 0}</span>
                            <span className={styles.routeStudioPanel__headerChip}>子工序 {activeGuideLines.length}</span>
                            <span className={styles.routeStudioPanel__headerChip}>投料 {activeCanvasStepMaterials.length}</span>
                            {activeCanvasInheritedRef ? (
                              <span className={`${styles.routeStudioPanel__headerChip} ${styles['routeStudioPanel__headerChip--inherit']}`}>继承引用</span>
                            ) : null}
                          </div>
                        </div>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles['btn--ghost']}`}
                          onClick={() => setDrawerKey(activeCanvasNode._key)}
                        >
                          完整编辑
                        </button>
                      </div>
                      <div className={styles.routeStudioPanel__headerGrid}>
                        <div className={styles.routeStudioPanel__headerCard}>
                          <span className={styles.routeStudioPanel__headerLabel}>路线模式</span>
                          <strong className={styles.routeStudioPanel__headerValue}>
                            {activeCanvasRouteGroupKey ? `并行 · ${activeCanvasRouteGroupKey}` : '主线串行'}
                          </strong>
                        </div>
                        <div className={styles.routeStudioPanel__headerCard}>
                          <span className={styles.routeStudioPanel__headerLabel}>当前层级</span>
                          <strong className={styles.routeStudioPanel__headerValue}>L{activeCanvasNode.routeLevel ?? '-'}</strong>
                        </div>
                        <div className={styles.routeStudioPanel__headerCard}>
                          <span className={styles.routeStudioPanel__headerLabel}>产出类型</span>
                          <strong className={styles.routeStudioPanel__headerValue}>{getOutputTypeLabel(activeCanvasNode.outputType)}</strong>
                        </div>
                      </div>

                      {activeCanvasInheritedRef ? (
                        <div className={`${styles.routeStudioPanel__section} ${styles['routeStudioPanel__section--inherit']}`}>
                          <div className={styles.routeStudioPanel__sectionHeader}>
                            <div className={styles.routeStudioPanel__sectionTitle}>模板继承引用</div>
                          </div>
                          <div className={styles.routeStudioPanel__sectionDesc}>
                            当前工序输出的半成品已配置默认工序模板。生产释放时会自动继承该模板的下游工艺路线；请到源模板维护继承节点本身。
                          </div>
                          <div className={styles.routeStudioPanel__outputCard}>
                            <span className={`${styles.routeStudioPanel__outputType} ${styles['routeStudioPanel__outputType--inherit']}`}>继承引用</span>
                            <strong>{activeCanvasInheritedRef.templateName}</strong>
                            <div className={styles.routeStudioPanel__outputMeta}>
                              <span className={styles.routeStudioPanel__outputChip}>
                                来源半成品：{activeCanvasInheritedRef.skuCode ? `${activeCanvasInheritedRef.skuCode} · ` : ''}{activeCanvasInheritedRef.skuName ?? `SKU#${activeCanvasInheritedRef.skuId}`}
                              </span>
                              <span className={styles.routeStudioPanel__outputChip}>
                                模板工序：{activeCanvasInheritedStepCount > 0 ? `${activeCanvasInheritedStepCount} 道` : '加载中'}
                              </span>
                              <span className={styles.routeStudioPanel__outputChip}>
                                模板 ID：{activeCanvasInheritedRef.templateId}
                              </span>
                            </div>
                          </div>
                          {activeCanvasInheritedSteps.length > 0 ? (
                            <div className={styles.routeStudioPanel__inheritSteps}>
                              {activeCanvasInheritedSteps.map((step) => (
                                <div key={`inherit-step-${step.id}`} className={styles.routeStudioPanel__inheritStepItem}>
                                  <span className={styles.routeStudioPanel__inheritStepSeq}>Step {step.stepNo}</span>
                                  <strong>{step.stepName}</strong>
                                  <span className={styles.routeStudioPanel__inheritStepMeta}>
                                    {step.outputType === 'semi_finished' ? '半成品输出' : step.outputType === 'final_product' ? '成品输出' : '过程工序'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          <div className={styles.routeStudioPanel__inheritReadonly}>
                            继承节点在当前模板中仅做引用展示，请到源半成品模板中维护具体步骤与投料。
                          </div>
                        </div>
                      ) : null}

                      <div className={`${styles.routeStudioPanel__section} ${styles['routeStudioPanel__section--info']}`}>
                        <div className={styles.routeStudioPanel__sectionHeader}>
                          <div className={styles.routeStudioPanel__sectionTitle}>基本信息</div>
                        </div>
                        <div className={styles.routeStudioPanel__sectionDesc}>维护当前工序的名称、类型、执行方式和目标工作站。</div>
                        <div className={styles.formGroup}>
                          <label className={styles.formLabel}>工序名称</label>
                          <input
                            className={styles.formInput}
                            type="text"
                            value={getProcessNodeDisplayName(activeCanvasNode, outputSkuLabelMap)}
                            disabled={isVariantTemplate}
                            onChange={(e) => handleActiveNodePatch({ name: e.target.value })}
                          />
                        </div>
                        <div className={styles.formRow}>
                          <div className={styles.formGroup}>
                            <label className={styles.formLabel}>工序编号</label>
                            <input className={styles.formInput} type="text" value={`STEP-${String(activeCanvasNode.seq).padStart(2, '0')}`} readOnly />
                          </div>
                          <div className={styles.formGroup}>
                            <label className={styles.formLabel}>工序类型</label>
                            <select
                              className={styles.formSelect}
                              value={activeCanvasNode.outputType}
                              onChange={(e) => handleActiveNodePatch({ outputType: e.target.value as ProcessNode['outputType'] })}
                            >
                              <option value="semi_finished">半成品工序</option>
                              <option value="final_product">成品工序</option>
                              <option value="none">过程工序</option>
                            </select>
                          </div>
                        </div>
                        <div className={styles.formRow}>
                          <div className={styles.formGroup}>
                            <label className={styles.formLabel}>执行方式</label>
                            <select
                              className={styles.formSelect}
                              value={activeCanvasNode.executionMode}
                              disabled={isVariantTemplate}
                              onChange={(e) => handleActiveNodePatch({ executionMode: e.target.value as 'internal' | 'outsource' })}
                            >
                              <option value="internal">厂内生产</option>
                              <option value="outsource">外协加工</option>
                            </select>
                          </div>
                          <div className={styles.formGroup}>
                            <label className={styles.formLabel}>工作站</label>
                            <input
                              className={styles.formInput}
                              type="search"
                              value={activeCanvasWorkstationKeyword}
                              disabled={isVariantTemplate}
                              onChange={(e) => setActiveCanvasWorkstationKeyword(e.target.value)}
                              placeholder="搜索工作站名称 / 类型"
                            />
                            <div className={styles.formHelp}>
                              {activeCanvasNode.workstationId && activeCanvasNode.workstationName
                                ? `当前已绑定：${activeCanvasNode.workstationName}（${activeCanvasNode.workstation || '未分组'}）`
                                : `当前有 ${activeCanvasWorkstationOptions.length} 个可用工作站，排产时会按这里绑定的站点优先匹配。`}
                            </div>
                            {activeCanvasWorkstationResults.length > 0 ? (
                              <div className={styles.routeStudioPanel__searchResults}>
                                {activeCanvasWorkstationResults.map((item) => (
                                  <button
                                    key={`station-result-${item.id}`}
                                    type="button"
                                    className={`${styles.routeStudioPanel__searchItem} ${activeCanvasWorkstation?.id === item.id ? styles['routeStudioPanel__searchItem--active'] : ''}`}
                                    disabled={isVariantTemplate}
                                    onClick={() => {
                                      handleActiveNodePatch({
                                        workstationId: Number(item.id),
                                        workstationName: item.name,
                                        workstation: item.type ?? '',
                                      });
                                      setActiveCanvasWorkstationKeyword('');
                                    }}
                                  >
                                    <strong>{item.name}</strong>
                                    <span>{item.type || '未分组'} · {item.status === 'active' ? '启用' : '停用'}</span>
                                  </button>
                                ))}
                              </div>
                            ) : activeCanvasWorkstationKeyword.trim() ? (
                              <div className={styles.routeStudioPanel__emptyBlock}>没有匹配到工作站，请尝试其他关键字。</div>
                            ) : null}
                            <div className={styles.routeStudioPanel__fieldSummary}>
                              <span className={styles.routeStudioPanel__fieldChip}>
                                当前：{activeCanvasWorkstation ? `${activeCanvasWorkstation.name}` : '未选择'}
                              </span>
                              <span className={styles.routeStudioPanel__fieldChip}>
                                候选：{activeCanvasWorkstationOptions.length} 个
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className={`${styles.routeStudioPanel__section} ${styles['routeStudioPanel__section--time']}`}>
                        <div className={styles.routeStudioPanel__sectionHeader}>
                          <div className={styles.routeStudioPanel__sectionTitle}>工时配置</div>
                        </div>
                        <div className={styles.routeStudioPanel__sectionDesc}>用于排产节拍、产能预估和计件工价测算。</div>
                        <div className={styles.formRow}>
                          <div className={styles.formGroup}>
                            <label className={styles.formLabel}>极限工时 (h)</label>
                            <input
                              className={styles.formInput}
                              type="text"
                              inputMode="decimal"
                              value={activeCanvasMaxHoursDraft}
                              disabled={isVariantTemplate}
                              onChange={(e) => {
                                const nextDraft = normalizeDecimalDraftInput(e.target.value);
                                if (!isDecimalDraft(nextDraft)) return;
                                setActiveCanvasMaxHoursDraft(nextDraft);
                              }}
                              onBlur={() => {
                                const nextValue = commitDecimalDraft(activeCanvasMaxHoursDraft, null);
                                setActiveCanvasMaxHoursDraft(formatDecimalDraft(nextValue));
                                handleActiveNodePatch({ maxHours: nextValue });
                              }}
                            />
                          </div>
                          <div className={styles.formGroup}>
                            <label className={styles.formLabel}>标准工时 (h)</label>
                            <input
                              className={styles.formInput}
                              type="text"
                              inputMode="decimal"
                              value={activeCanvasHoursDraft}
                              disabled={isVariantTemplate}
                              onChange={(e) => {
                                const nextDraft = normalizeDecimalDraftInput(e.target.value);
                                if (!isDecimalDraft(nextDraft)) return;
                                setActiveCanvasHoursDraft(nextDraft);
                              }}
                              onBlur={() => {
                                const nextValue = commitDecimalDraft(activeCanvasHoursDraft, 0) ?? 0;
                                setActiveCanvasHoursDraft(formatDecimalDraft(nextValue));
                                handleActiveNodePatch({ hours: nextValue });
                              }}
                            />
                          </div>
                        </div>
                        <div className={styles.formGroup}>
                          <label className={styles.formLabel}>标准工价(元)</label>
                          <input
                            className={styles.formInput}
                            type="text"
                            inputMode="decimal"
                            value={activeCanvasUnitPriceDraft}
                            disabled={isVariantTemplate}
                            onChange={(e) => {
                              const nextDraft = normalizeDecimalDraftInput(e.target.value);
                              if (!isDecimalDraft(nextDraft)) return;
                              setActiveCanvasUnitPriceDraft(nextDraft);
                            }}
                            onBlur={() => {
                              const nextValue = commitDecimalDraft(activeCanvasUnitPriceDraft, 0) ?? 0;
                              setActiveCanvasUnitPriceDraft(formatDecimalDraft(nextValue));
                              handleActiveNodePatch({ unitPrice: nextValue });
                            }}
                          />
                        </div>
                      </div>

                      <div className={`${styles.routeStudioPanel__section} ${styles['routeStudioPanel__section--route']}`}>
                        <div className={styles.routeStudioPanel__sectionHeader}>
                          <div className={styles.routeStudioPanel__sectionTitle}>路线关系</div>
                        </div>
                        <div className={styles.routeStudioPanel__sectionDesc}>维护工艺分支、分支层级和前置依赖，决定并行与汇合关系。</div>
                        <div className={styles.routeStudioPanel__toggleGrid}>
                          <label className={styles.routeStudioPanel__toggleCard}>
                            <input
                              type="checkbox"
                              checked={Boolean(activeCanvasRouteGroupKey)}
                              disabled={isVariantTemplate}
                              onChange={(e) => {
                                if (!e.target.checked) {
                                  handleActiveNodePatch({ routeGroupKey: '', routeLevel: null });
                                  return;
                                }
                                const nextRouteKey = buildSuggestedRouteKey('parallel');
                                handleActiveNodePatch({
                                  routeGroupKey: nextRouteKey,
                                  routeLevel: activeCanvasNode.routeLevel ?? 1,
                                });
                              }}
                            />
                            <span>
                              <strong>并行工序</strong>
                              <small>勾选后当前工序加入独立分支，可在汇合点之后再次分叉。</small>
                            </span>
                          </label>
                          <label className={styles.routeStudioPanel__toggleCard}>
                            <input
                              type="checkbox"
                              checked={activeCanvasNode.outputType === 'final_product'}
                              disabled={isVariantTemplate}
                              onChange={(e) => {
                                handleActiveNodePatch({
                                  outputType: e.target.checked ? 'final_product' : 'semi_finished',
                                  outputSkuId: e.target.checked
                                    ? (isStandardTemplate ? null : (editorTemplate?.skuId ?? null))
                                    : activeCanvasNode.outputSkuId,
                                });
                              }}
                            />
                            <span>
                              <strong>末道工序</strong>
                              <small>勾选后该工序将作为当前产品的最终产出节点。</small>
                            </span>
                          </label>
                        </div>
                        <div className={styles.formRow}>
                          <div className={styles.formGroup}>
                            <label className={styles.formLabel}>工艺分支</label>
                            <input
                              className={styles.formInput}
                              type="text"
                              value={activeCanvasNode.routeGroupKey}
                              disabled={isVariantTemplate}
                              onChange={(e) => handleActiveNodePatch({ routeGroupKey: e.target.value })}
                              placeholder="如：清：Q01床头-白01"
                            />
                          </div>
                          <div className={styles.formGroup}>
                            <label className={styles.formLabel}>分支层级</label>
                            <input
                              className={styles.formInput}
                              type="number"
                              min="1"
                              step="1"
                              value={activeCanvasNode.routeLevel ?? ''}
                              disabled={isVariantTemplate}
                              onChange={(e) => handleActiveNodePatch({ routeLevel: e.target.value === '' ? null : Number(e.target.value) })}
                            />
                          </div>
                        </div>
                        <div className={styles.formGroup}>
                          <label className={styles.formLabel}>前置步骤</label>
                          {activeCanvasPredecessorOptions.length === 0 ? (
                            <div className={styles.formHelp}>当前节点位于起步位，可与其他首道工序并行启动。</div>
                          ) : (
                            <>
                              <input
                                className={styles.formInput}
                                type="search"
                                value={activeCanvasPredecessorKeyword}
                                disabled={isVariantTemplate}
                                onChange={(e) => setActiveCanvasPredecessorKeyword(e.target.value)}
                                placeholder="搜索 Step 编号 / 工序名称"
                              />
                              <div className={styles.formHelp}>
                                支持多选。多个前置步骤同时完成后，当前工序才可启动，可表达并行汇合和子工序 DAG。
                              </div>
                              <div className={styles.routeStudioPanel__searchResults}>
                                {activeCanvasPredecessorResults.map((item) => {
                                  const checked = activeCanvasNode.predecessorStepNos.includes(item.seq);
                                  return (
                                    <button
                                      key={`pred-result-${item._key}`}
                                      type="button"
                                      className={`${styles.routeStudioPanel__searchItem} ${checked ? styles['routeStudioPanel__searchItem--active'] : ''}`}
                                      disabled={isVariantTemplate}
                                      onClick={() => {
                                        const next = checked
                                          ? activeCanvasNode.predecessorStepNos.filter((stepNo) => stepNo !== item.seq)
                                          : [...activeCanvasNode.predecessorStepNos, item.seq];
                                        handleActiveNodePatch({ predecessorStepNos: [...new Set(next)].sort((a, b) => a - b) });
                                      }}
                                    >
                                      <strong>Step {item.seq} · {item.name}</strong>
                                      <span>{checked ? '已设为前置依赖，点击可移除' : '点击加入前置依赖'}</span>
                                    </button>
                                  );
                                })}
                              </div>
                              {activeCanvasPredecessorResults.length === 0 ? (
                                <div className={styles.routeStudioPanel__emptyBlock}>没有匹配到前置步骤，请尝试其他关键字。</div>
                              ) : null}
                            </>
                          )}
                          {activeCanvasPredecessorSummary.length > 0 ? (
                            <div className={styles.routeStudioPanel__fieldSummary}>
                              {activeCanvasPredecessorSummary.map((item) => (
                                <span key={`pred-summary-${item.seq}`} className={styles.routeStudioPanel__fieldChip}>
                                  Step {item.seq} · {item.name}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className={`${styles.routeStudioPanel__section} ${styles['routeStudioPanel__section--steps']}`}>
                        <div className={styles.routeStudioPanel__sectionHeader}>
                          <div className={styles.routeStudioPanel__sectionTitle}>操作步骤</div>
                          <div className={styles.routeStudioPanel__sectionActions}>
                          <button type="button" className={styles.routeStudioPanel__smallAction} onClick={handleAddGuideLine} disabled={isVariantTemplate}>+ 添加步骤</button>
                          </div>
                        </div>
                        <div className={styles.routeStudioPanel__sectionDesc}>把当前工序拆成现场可执行的子工序或作业要点，供任务页直接展示。</div>
                        {activeGuideLines.length > 0 ? (
                          <div className={styles.routeStudioPanel__stepList}>
                            {activeGuideLines.map((line, index) => (
                              <div key={`${activeCanvasNode._key}-guide-${index}`} className={styles.routeStudioPanel__stepRow}>
                                <span className={styles.routeStudioPanel__stepIndex}>{index + 1}</span>
                                <input
                                  className={styles.formInput}
                                  type="text"
                                  value={line}
                                  disabled={isVariantTemplate}
                                  onChange={(e) => handleActiveGuideLineChange(index, e.target.value)}
                                  placeholder="请输入操作步骤说明"
                                />
                                <button
                                  type="button"
                                  className={styles.routeStudioPanel__stepDelete}
                                  disabled={isVariantTemplate}
                                  onClick={() => handleRemoveGuideLine(index)}
                                >
                                  <IconTrash />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className={styles.routeStudioPanel__emptyBlock}>当前还没有维护操作步骤，点击右上角可快速添加。</div>
                        )}
                      </div>

                      <div className={`${styles.routeStudioPanel__section} ${styles['routeStudioPanel__section--input']}`}>
                        <div className={styles.routeStudioPanel__sectionHeader}>
                          <div className={styles.routeStudioPanel__sectionTitle}>输入参数（原材料/半成品）</div>
                          <div className={styles.routeStudioPanel__sectionActions}>
                            <button
                              type="button"
                              className={styles.routeStudioPanel__smallAction}
                              onClick={() => handleImportBomSuggestions(activeCanvasNode.seq)}
                              disabled={activeCanvasBomSuggestions.length === 0}
                            >
                              从 BOM 填充
                            </button>
                          </div>
                        </div>
                        <div className={styles.routeStudioPanel__sectionDesc}>维护本工序消耗的原材料或半成品输入项，支持从 BOM 快速带入。</div>
                        <div className={styles.routeStudioPanel__inputCard}>
                          <div className={styles.routeStudioPanel__inputCardHeader}>
                            <span className={styles.routeStudioPanel__outputType}>输入汇总</span>
                            <span className={styles.routeStudioPanel__inputCount}>{activeCanvasStepMaterials.length} 项</span>
                          </div>
                          <strong>{activeCanvasStepMaterials.length > 0 ? `已维护 ${activeCanvasStepMaterials.length} 项步骤投料` : '当前工序尚未维护输入项'}</strong>
                          <div className={styles.routeStudioPanel__outputMeta}>
                            <span className={styles.routeStudioPanel__outputChip}>
                              BOM 建议：{activeCanvasBomSuggestions.length} 项
                            </span>
                            <span className={styles.routeStudioPanel__outputChip}>
                              手工补充：支持搜索 SKU 新增
                            </span>
                          </div>
                        </div>
                        <div className={styles.routeStudioPanel__searchToolbar}>
                          <div className={styles.formGroup}>
                            <label className={styles.formLabel}>搜索待添加物料</label>
                            <input
                              className={styles.formInput}
                              type="search"
                              value={materialSkuKeyword}
                              onChange={(e) => {
                                setMaterialSkuKeyword(e.target.value);
                                setActiveMaterialSelectionId(null);
                              }}
                              placeholder="输入 SKU 名称 / 编码"
                            />
                          </div>
                          <div className={styles.routeStudioPanel__sectionActions}>
                            <button
                              type="button"
                              className={styles.routeStudioPanel__smallAction}
                              disabled={!activeMaterialSelection}
                              onClick={() => {
                                if (!activeMaterialSelection) return;
                                handleAddStepMaterial(activeCanvasNode.seq, activeMaterialSelection);
                                setActiveMaterialSelectionId(null);
                                setMaterialSkuKeyword('');
                              }}
                            >
                              + 新增输入项
                            </button>
                          </div>
                        </div>
                        {materialSkuKeyword.trim() ? (
                          <div className={styles.routeStudioPanel__searchResults}>
                            {materialSkuOptions.slice(0, 6).map((sku) => (
                              <button
                                key={sku.id}
                                type="button"
                                className={`${styles.routeStudioPanel__searchItem} ${activeMaterialSelection?.id === sku.id ? styles['routeStudioPanel__searchItem--active'] : ''}`}
                                onClick={() => setActiveMaterialSelectionId(sku.id)}
                              >
                                <strong>{sku.skuCode ? `${sku.skuCode} · ` : ''}{sku.name}</strong>
                                <span>{sku.stockUnit ? `库存单位：${sku.stockUnit}` : '未配置库存单位'}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {activeCanvasStepMaterials.length > 0 ? (
                          <div className={styles.routeStudioPanel__paramList}>
                            {activeCanvasStepMaterials.map((material) => (
                              <div key={`${material.stepNo}-${material.inputSkuId}`} className={styles.routeStudioPanel__paramRow}>
                                <span className={styles.routeStudioPanel__paramType}>原材料</span>
                                <div className={styles.routeStudioPanel__paramValue}>
                                  <strong>{material.skuCode ? `${material.skuCode} · ` : ''}{material.skuName ?? `SKU#${material.inputSkuId}`}</strong>
                                  <span>{material.specText || '未填写规格说明'}</span>
                                </div>
                                <div className={styles.routeStudioPanel__paramQty}>
                                  <span className={styles.routeStudioPanel__paramQtyLabel}>单件用量</span>
                                  <input
                                    className={`${styles.formInput} ${styles.routeStudioPanel__qtyInput}`}
                                    type="number"
                                    min="0"
                                    step="0.0001"
                                    value={material.usagePerUnit || ''}
                                    onChange={(e) => handleActiveStepMaterialPatch(material.inputSkuId, { usagePerUnit: Number(e.target.value || 0) })}
                                  />
                                </div>
                                <button
                                  type="button"
                                  className={styles.routeStudioPanel__stepDelete}
                                  onClick={() => handleRemoveStepMaterial(activeCanvasNode.seq, material.inputSkuId)}
                                >
                                  <IconTrash />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className={styles.routeStudioPanel__emptyBlock}>当前工序还没有维护输入参数，可先从 BOM 带入，再按步骤精细调整。</div>
                        )}
                      </div>

                      <div className={`${styles.routeStudioPanel__section} ${styles['routeStudioPanel__section--output']}`}>
                        <div className={styles.routeStudioPanel__sectionHeader}>
                          <div className={styles.routeStudioPanel__sectionTitle}>输出参数（半成品/成品）</div>
                        </div>
                        <div className={styles.routeStudioPanel__sectionDesc}>定义当前工序的产出对象，用于后续路线汇合、工单快照和任务释放。</div>
                        <div className={styles.formRow}>
                          <div className={styles.formGroup}>
                            <label className={styles.formLabel}>输出类型</label>
                            <select
                              className={styles.formSelect}
                              value={activeCanvasNode.outputType}
                              disabled={activeCanvasInheritedReadonly}
                              onChange={(e) => {
                                const nextType = e.target.value as ProcessNode['outputType'];
                                handleActiveNodePatch({
                                  outputType: nextType,
                                  outputSkuId: nextType === 'final_product'
                                    ? (isStandardTemplate ? null : (editorTemplate?.skuId ?? activeCanvasNode.outputSkuId))
                                    : nextType === 'semi_finished'
                                      ? (activeCanvasNode.outputSkuId ?? outputSkuOptions.find((item) => item.type === 'semi_finished')?.id ?? null)
                                      : null,
                                });
                              }}
                            >
                              <option value="semi_finished">半成品工序</option>
                              <option value="final_product">成品工序</option>
                              <option value="none">过程工序</option>
                            </select>
                          </div>
                          <div className={styles.formGroup}>
                            <label className={styles.formLabel}>输出对象</label>
                            <input
                              className={styles.formInput}
                              type="search"
                              value={activeCanvasOutputKeyword}
                              disabled={activeCanvasNode.outputType === 'none' || activeCanvasInheritedReadonly || activeCanvasUsesStandardFinalPlaceholder}
                              onChange={(e) => setActiveCanvasOutputKeyword(e.target.value)}
                              placeholder={activeCanvasUsesStandardFinalPlaceholder ? '标准模板保存为成品占位' : activeCanvasNode.outputType === 'none' ? '过程工序无需输出对象' : '搜索输出对象'}
                            />
                            <div className={styles.formHelp}>
                              {activeCanvasUsesStandardFinalPlaceholder
                                ? '标准模板不绑定具体成品 SKU，SKU 变体会在自己的模板中维护实际产出对象。'
                                : activeCanvasNode.outputType === 'none'
                                ? '过程工序不需要指定输出对象。'
                                : activeOutputObjectOptions.length > 0
                                  ? `当前可选 ${activeOutputObjectOptions.length} 个${activeCanvasNode.outputType === 'final_product' ? '成品' : '半成品'}对象。`
                                  : '当前没有可用候选，请先绑定模板产品或补齐 BOM 半成品节点。'}
                            </div>
                            {!activeCanvasInheritedReadonly && activeCanvasNode.outputType !== 'none' ? (
                              activeOutputObjectResults.length > 0 ? (
                                <div className={styles.routeStudioPanel__searchResults}>
                                  {activeOutputObjectResults.map((item) => (
                                    <button
                                      key={`output-result-${item.id}`}
                                      type="button"
                                      className={`${styles.routeStudioPanel__searchItem} ${activeOutputObject?.id === item.id ? styles['routeStudioPanel__searchItem--active'] : ''}`}
                                      onClick={() => {
                                        handleActiveNodePatch({ outputSkuId: item.id });
                                        setActiveCanvasOutputKeyword('');
                                      }}
                                    >
                                      <strong>{item.label}</strong>
                                      <span>{item.type === 'final' ? '成品输出' : '半成品输出'}</span>
                                    </button>
                                  ))}
                                </div>
                              ) : activeCanvasOutputKeyword.trim() ? (
                                <div className={styles.routeStudioPanel__emptyBlock}>没有匹配到输出对象，请尝试其他关键字。</div>
                              ) : null
                            ) : null}
                            <div className={styles.routeStudioPanel__fieldSummary}>
                              <span className={styles.routeStudioPanel__fieldChip}>
                                当前：{activeOutputObject ? activeOutputObject.label : (activeCanvasUsesStandardFinalPlaceholder ? '标准模板成品占位' : activeCanvasNode.outputType === 'none' ? '无需输出对象' : '未选择')}
                              </span>
                              {activeCanvasNode.outputType !== 'none' && !activeCanvasUsesStandardFinalPlaceholder ? (
                                <span className={styles.routeStudioPanel__fieldChip}>
                                  候选：{activeOutputObjectOptions.length} 个
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        {activeCanvasInheritedReadonly ? (
                          <div className={styles.routeStudioPanel__inheritReadonly}>
                            当前节点输出的半成品已绑定默认模板，输出类型与输出对象在这里锁定为引用来源；如需调整，请修改该半成品的默认工序模板或变更当前节点的输出半成品。
                          </div>
                        ) : null}
                        <div className={`${styles.routeStudioPanel__outputCard} ${activeCanvasInheritedReadonly ? styles['routeStudioPanel__outputCard--inheritReadonly'] : ''}`}>
                          <span className={styles.routeStudioPanel__outputType}>{getOutputTypeLabel(activeCanvasNode.outputType)}</span>
                          <strong>{activeOutputSummary}</strong>
                          <div className={styles.routeStudioPanel__outputMeta}>
                            <span className={styles.routeStudioPanel__outputChip}>
                              分支：{activeCanvasNode.routeGroupKey || '未设分支'}
                            </span>
                            <span className={styles.routeStudioPanel__outputChip}>
                              层级：L{activeCanvasNode.routeLevel ?? '-'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className={`${styles.routeStudioPanel__section} ${styles['routeStudioPanel__section--quality']}`}>
                        <div className={styles.routeStudioPanel__sectionHeader}>
                          <div className={styles.routeStudioPanel__sectionTitle}>作业附件与补充说明</div>
                        </div>
                        <div className={styles.routeStudioPanel__sectionDesc}>填写质量要求、现场注意事项，或补充需要随任务下发的作业说明。</div>
                        <textarea
                          className={styles.formTextarea}
                          rows={5}
                          value={activeCanvasNode.guideText}
                          disabled={isVariantTemplate}
                          onChange={(e) => handleActiveNodePatch({ guideText: e.target.value })}
                          placeholder="填写质量要求、补充说明或现场注意事项。"
                        />
                      </div>

                      <button
                        type="button"
                        className={styles.routeStudioPanel__saveBtn}
                        onClick={handleSave}
                        disabled={saving}
                      >
                        {saving ? '保存中…' : '保存工序配置'}
                      </button>
                        </>
                      ) : (
                        <>
                          <div className={styles.routeStudioPanel__header}>
                            <div>
                              <div className={styles.routeStudioPanel__eyebrow}>工序配置</div>
                              <h3 className={styles.routeStudioPanel__title}>未选中工序节点</h3>
                              <div className={styles.routeStudioPanel__subtitle}>先在左侧路线图中选择一个节点，或直接新增工序开始配置。</div>
                            </div>
                          </div>

                          <div className={`${styles.routeStudioPanel__section} ${styles['routeStudioPanel__section--info']}`}>
                            <div className={styles.routeStudioPanel__sectionHeader}>
                              <div className={styles.routeStudioPanel__sectionTitle}>开始配置</div>
                            </div>
                            <div className={styles.routeStudioPanel__sectionDesc}>当前模板已加载，但还没有可编辑的工序节点。你可以先新增串行工序、并行分支，或从 BOM 自动补齐骨架。</div>
                            <div className={styles.routeStudioPanel__emptyBlock}>点击上方“添加工序”“快捷新增并行”或“从 BOM 自动填充”，页面会自动选中并打开新节点。</div>
                            <div className={styles.routeStudio__toolbarActions}>
                              <button
                                type="button"
                                className={`${styles.btn} ${styles['btn--ghost']}`}
                                onClick={handleAddNode}
                                disabled={isVariantTemplate}
                              >
                                <IconPlus />
                                添加工序
                              </button>
                              <button
                                type="button"
                                className={`${styles.btn} ${styles['btn--ghost']}`}
                                onClick={handleAddParallelRoute}
                                disabled={isVariantTemplate}
                              >
                                <IconPlus />
                                快捷新增并行
                              </button>
                              {activeBomHeader ? (
                                <button
                                  type="button"
                                  className={`${styles.btn} ${styles['btn--ghost']}`}
                                  onClick={handleImportBomRouteSkeleton}
                                  disabled={uncoveredBomRouteItems.length === 0}
                                >
                                  从 BOM 自动填充
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </>
                      )}
                    </aside>
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </main>

      {/* ===== 节点编辑抽屉 ===== */}
      <DrawerErrorBoundary
        resetKey={`${selectedId ?? 'none'}:${drawerKey ?? 'none'}:${editingNode?._key ?? 'none'}`}
        onClose={() => setDrawerKey(null)}
      >
        <NodeDrawer
          node={editingNode}
          nodes={editorTemplate?.nodes ?? []}
          open={drawerKey !== null && editingNode !== null}
          saving={saving}
          stepMaterials={editingStepMaterials}
          bomSuggestions={editableBomSuggestions}
          skuOptions={materialSkuOptions}
          materialSkuKeyword={materialSkuKeyword}
          workstationOptions={workstationOptions}
          workstationRecords={workstationRecords ?? []}
          linkedWorkstationCount={editingNode?.workstation ? (workstationCountByType.get(editingNode.workstation) ?? 0) : 0}
          onManageWorkstations={() => setWorkstationManagerOpen(true)}
          onClose={() => setDrawerKey(null)}
          onMaterialSkuKeywordChange={setMaterialSkuKeyword}
          onAddStepMaterial={(sku) => {
            if (!editingNode) return;
            handleAddStepMaterial(editingNode.seq, sku);
          }}
          onImportBomSuggestions={() => {
            if (!editingNode) return;
            handleImportBomSuggestions(editingNode.seq);
          }}
          onChange={handleNodeChange}
          onChangeStepMaterial={(inputSkuId, patch) => {
            if (!editingNode) return;
            handleStepMaterialChange(editingNode.seq, inputSkuId, patch);
          }}
          onRemoveStepMaterial={(inputSkuId) => {
            if (!editingNode) return;
            handleRemoveStepMaterial(editingNode.seq, inputSkuId);
          }}
          onDelete={handleNodeDelete}
        />
      </DrawerErrorBoundary>

      {/* ===== 工种类型管理 Modal ===== */}
      <WorkstationTypeManager
        open={workstationManagerOpen}
        onClose={() => setWorkstationManagerOpen(false)}
        preferredType={editingNode?.workstation ?? ''}
      />

      <DrawerErrorBoundary
        resetKey={`add-process:${showAddProcessModal ? 'open' : 'closed'}:${addProcessDraft?.name ?? 'none'}`}
        onClose={() => {
          setShowAddProcessModal(false);
          setAddProcessDraft(null);
        }}
      >
        {showAddProcessModal && addProcessDraft && createPortal(
          <div
            className={`${styles.drawerOverlay} ${styles['drawerOverlay--on']}`}
            onClick={() => {
              setShowAddProcessModal(false);
              setAddProcessDraft(null);
            }}
          >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 'min(38rem, 92vw)',
              maxHeight: '88vh',
              overflow: 'auto',
              background: 'var(--pc-white)',
              borderRadius: '1rem',
              boxShadow: '0 24px 60px rgba(15,23,42,0.18)',
              border: '1px solid var(--pc-neutral-200)',
              padding: '1.25rem 1.25rem 1rem',
              zIndex: 'var(--z-modal, 1300)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
            role="dialog"
            aria-modal="true"
            aria-label="新增工序"
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
              <div>
                <div className={styles.routeStudioPanel__eyebrow}>新增工序</div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--pc-neutral-900)' }}>创建新的串行或并行工序</h3>
                <div className={styles.formHelp}>新增时即可定义路线模式、前置依赖和是否作为末道工序。</div>
              </div>
              <button
                className={styles.drawer__close}
                onClick={() => {
                  setShowAddProcessModal(false);
                  setAddProcessDraft(null);
                }}
                aria-label="关闭"
              >
                <IconClose />
              </button>
            </div>

            <div className={styles.routeStudioPanel__toggleGrid}>
              <label className={styles.routeStudioPanel__toggleCard}>
                <input
                  type="radio"
                  name="add-process-mode"
                  checked={addProcessDraft.mode === 'serial'}
                  onChange={() => setAddProcessDraft((prev) => (prev ? {
                    ...prev,
                    mode: 'serial',
                    routeGroupKey: activeCanvasNode?.routeGroupKey?.trim() || '',
                    routeLevel: activeCanvasNode?.routeGroupKey?.trim() ? (activeCanvasNode.routeLevel ?? 1) : '',
                  } : prev))}
                />
                <span>
                  <strong>串行工序</strong>
                  <small>默认接在当前工序之后，继承当前分支或作为主线继续推进。</small>
                </span>
              </label>
              <label className={styles.routeStudioPanel__toggleCard}>
                <input
                  type="radio"
                  name="add-process-mode"
                  checked={addProcessDraft.mode === 'parallel'}
                  onChange={() => setAddProcessDraft((prev) => (prev ? {
                    ...prev,
                    mode: 'parallel',
                    routeGroupKey: buildSuggestedRouteKey('parallel'),
                    routeLevel: prev.routeLevel || 1,
                  } : prev))}
                />
                <span>
                  <strong>并行工序</strong>
                  <small>创建新的工艺分支，可用于汇合后再次分叉或多个半成品并行推进。</small>
                </span>
              </label>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>工序名称</label>
              <input
                className={styles.formInput}
                type="text"
                value={addProcessDraft.name}
                onChange={(e) => setAddProcessDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                placeholder="请输入工序名称"
              />
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>执行方式</label>
                <select
                  className={styles.formSelect}
                  value={addProcessDraft.executionMode}
                  onChange={(e) => setAddProcessDraft((prev) => (prev ? { ...prev, executionMode: e.target.value as 'internal' | 'outsource' } : prev))}
                >
                  <option value="internal">厂内生产</option>
                  <option value="outsource">外协加工</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>是否为末道工序</label>
                <label className={styles.routeStudioPanel__toggleCard}>
                  <input
                    type="checkbox"
                    checked={addProcessDraft.isFinal}
                    onChange={(e) => setAddProcessDraft((prev) => (prev ? { ...prev, isFinal: e.target.checked } : prev))}
                  />
                  <span>
                    <strong>{addProcessDraft.isFinal ? '是，作为最终产出' : '否，仍为中间工序'}</strong>
                    <small>末道工序会产出当前产品，并作为路线最终节点。</small>
                  </span>
                </label>
              </div>
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>工艺分支</label>
                <input
                  className={styles.formInput}
                  type="text"
                  value={addProcessDraft.routeGroupKey}
                  onChange={(e) => setAddProcessDraft((prev) => (prev ? { ...prev, routeGroupKey: e.target.value } : prev))}
                  placeholder="留空表示主线/串行工序"
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>分支层级</label>
                <input
                  className={styles.formInput}
                  type="number"
                  min="1"
                  step="1"
                  value={addProcessDraft.routeLevel}
                  onChange={(e) => setAddProcessDraft((prev) => (prev ? { ...prev, routeLevel: e.target.value === '' ? '' : Number(e.target.value) } : prev))}
                  placeholder="1"
                />
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>前置依赖工序</label>
              {addProcessPredecessorOptions.length === 0 ? (
                <div className={styles.formHelp}>当前模板还没有其他工序，新工序会作为起始节点。</div>
              ) : (
                <>
                  <input
                    className={styles.formInput}
                    type="search"
                    value={addProcessPredecessorKeyword}
                    onChange={(e) => setAddProcessPredecessorKeyword(e.target.value)}
                    placeholder="搜索 Step 编号 / 工序名称"
                  />
                  <div className={styles.formHelp}>支持多选。多个前置步骤同时完成后，当前工序才可启动。</div>
                  <div className={styles.routeStudioPanel__searchResults}>
                    {addProcessPredecessorResults.map((item) => {
                      const checked = addProcessDraft.predecessorStepNos.includes(item.seq);
                      return (
                        <button
                          key={`add-process-dep-${item._key}`}
                          type="button"
                          className={`${styles.routeStudioPanel__searchItem} ${checked ? styles['routeStudioPanel__searchItem--active'] : ''}`}
                          onClick={() => {
                            const next = checked
                              ? addProcessDraft.predecessorStepNos.filter((stepNo) => stepNo !== item.seq)
                              : [...addProcessDraft.predecessorStepNos, item.seq];
                            setAddProcessDraft((prev) => (prev ? {
                              ...prev,
                              predecessorStepNos: [...new Set(next)].sort((a, b) => a - b),
                            } : prev));
                          }}
                        >
                          <strong>Step {item.seq} · {item.name}</strong>
                          <span>{checked ? '已设为前置依赖，点击可移除' : '点击加入前置依赖'}</span>
                        </button>
                      );
                    })}
                  </div>
                  {addProcessPredecessorResults.length === 0 ? (
                    <div className={styles.routeStudioPanel__emptyBlock}>没有匹配到前置步骤，请尝试其他关键字。</div>
                  ) : null}
                </>
              )}
              {addProcessPredecessorSummary.length > 0 ? (
                <div className={styles.routeStudioPanel__fieldSummary}>
                  {addProcessPredecessorSummary.map((item) => (
                    <span key={`add-pred-summary-${item.seq}`} className={styles.routeStudioPanel__fieldChip}>
                      Step {item.seq} · {item.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', paddingTop: '0.25rem' }}>
              <button
                className={`${styles.btn} ${styles['btn--ghost']}`}
                onClick={() => {
                  setShowAddProcessModal(false);
                  setAddProcessDraft(null);
                }}
              >
                取消
              </button>
              <button
                className={`${styles.btn} ${styles['btn--primary']}`}
                onClick={handleCreateProcessNode}
                disabled={!addProcessDraft.name.trim()}
              >
                <IconPlus />
                创建工序
              </button>
            </div>
          </div>
          </div>,
          document.body,
        )}
      </DrawerErrorBoundary>

      {/* ===== 新建模板 Modal ===== */}
      {showCreateModal && createPortal(
        <div
          className={`${styles.drawerOverlay} ${styles['drawerOverlay--on']}`}
          onClick={() => setShowCreateModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'var(--pc-white)',
              borderRadius: 'var(--pc-radius-xl)',
              boxShadow: 'var(--pc-shadow-lg)',
              width: '26rem',
              padding: '1.5rem',
              zIndex: 'var(--z-modal, 1300)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
            role="dialog"
            aria-modal="true"
            aria-label="新建工序模板"
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--pc-neutral-900)' }}>
                新建工序模板
              </span>
              <button
                className={styles.drawer__close}
                onClick={() => setShowCreateModal(false)}
                aria-label="关闭"
              >
                <IconClose />
              </button>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                模板名称<span className={styles.formLabel__req}>*</span>
              </label>
              <input
                className={styles.formInput}
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="例：实木家具-标准模板"
                autoFocus
              />
            </div>

            <div className={styles.routeStudioPanel__toggleGrid}>
              <label className={styles.routeStudioPanel__toggleCard}>
                <input
                  type="radio"
                  name="create-template-mode"
                  checked={createMode === 'standard'}
                  onChange={() => {
                    setCreateMode('standard');
                    setCreateSkuId(null);
                    setSkuKeyword('');
                    setCreateBaseTemplateId(null);
                    setBaseTemplateKeyword('');
                  }}
                />
                <span>
                  <strong>标准模板</strong>
                  <small>沉淀共享工时、路线和工位，不直接绑定 SKU。</small>
                </span>
              </label>
              <label className={styles.routeStudioPanel__toggleCard}>
                <input
                  type="radio"
                  name="create-template-mode"
                  checked={createMode === 'independent'}
                  onChange={() => {
                    setCreateMode('independent');
                    setCreateBaseTemplateId(null);
                    setBaseTemplateKeyword('');
                  }}
                />
                <span>
                  <strong>独立 SKU 模板</strong>
                  <small>为单个 SKU 维护完整工艺，不继承标准模板。</small>
                </span>
              </label>
              <label className={styles.routeStudioPanel__toggleCard}>
                <input
                  type="radio"
                  name="create-template-mode"
                  checked={createMode === 'variant'}
                  onChange={() => setCreateMode('variant')}
                />
                <span>
                  <strong>SKU 变体模板</strong>
                  <small>继承标准模板的共享配置，仅维护当前 SKU 的输入输出差异。</small>
                </span>
              </label>
            </div>

            {createMode === 'variant' ? (
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  选择标准模板<span className={styles.formLabel__req}>*</span>
                </label>
                <input
                  className={styles.formInput}
                  type="search"
                  value={baseTemplateKeyword}
                  onChange={(e) => {
                    setBaseTemplateKeyword(e.target.value);
                    setCreateBaseTemplateId(null);
                  }}
                  placeholder="输入标准模板名称搜索..."
                />
                {baseTemplateKeyword && (
                  <div className={styles.skuDropdown}>
                    {standardTemplateCatalog.filter((item) => item.name.includes(baseTemplateKeyword)).length === 0 ? (
                      <div className={styles.skuDropdown__empty}>未找到匹配的标准模板</div>
                    ) : (
                      standardTemplateCatalog
                        .filter((item) => item.name.includes(baseTemplateKeyword))
                        .map((template) => (
                          <div
                            key={template.id}
                            className={`${styles.skuDropdown__item} ${createBaseTemplateId === template.id ? styles['skuDropdown__item--selected'] : ''}`}
                            onClick={() => {
                              setCreateBaseTemplateId(Number(template.id));
                              setBaseTemplateKeyword(template.name);
                            }}
                          >
                            <span className={styles.skuDropdown__code}>STD</span>
                            <span className={styles.skuDropdown__name}>{template.name}</span>
                          </div>
                        ))
                    )}
                  </div>
                )}
                {selectedCreateBaseTemplate ? (
                  <div className={styles.formHelp} style={{ color: 'var(--pc-success)' }}>
                    已选择标准模板：{selectedCreateBaseTemplate.name}
                  </div>
                ) : null}
              </div>
            ) : null}

            {createMode !== 'standard' ? (
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  关联 SKU<span className={styles.formLabel__req}>*</span>
                </label>
                <input
                  className={styles.formInput}
                  type="search"
                  value={skuKeyword}
                  onChange={(e) => {
                    setSkuKeyword(e.target.value);
                    setCreateSkuId(null);
                  }}
                  placeholder="输入 SKU 名称或编码搜索..."
                />
                {skuKeyword && (
                  <div className={styles.skuDropdown}>
                    {(skuListData?.list ?? []).length === 0 ? (
                      <div className={styles.skuDropdown__empty}>未找到匹配 SKU</div>
                    ) : (
                      (skuListData?.list ?? []).map((sku) => (
                        <div
                          key={sku.id}
                          className={`${styles.skuDropdown__item} ${createSkuId === sku.id ? styles['skuDropdown__item--selected'] : ''}`}
                          onClick={() => {
                            setCreateSkuId(Number(sku.id));
                            setSkuKeyword(`${sku.skuCode} · ${sku.name}`);
                          }}
                        >
                          <span className={styles.skuDropdown__code}>{sku.skuCode}</span>
                          <span className={styles.skuDropdown__name}>{sku.name}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
                {createSkuId ? (
                  <div className={styles.formHelp} style={{ color: 'var(--pc-success)' }}>
                    已选择 SKU ID: {createSkuId}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className={styles.formHelp}>
                标准模板不绑定 SKU，可被多个 SKU 变体复用。
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', paddingTop: '0.25rem' }}>
              <button
                className={`${styles.btn} ${styles['btn--ghost']}`}
                onClick={() => {
                  setShowCreateModal(false);
                  setSkuKeyword('');
                  setCreateSkuId(null);
                  setCreateMode('independent');
                  setCreateBaseTemplateId(null);
                  setBaseTemplateKeyword('');
                }}
              >
                取消
              </button>
              <button
                className={`${styles.btn} ${styles['btn--primary']}`}
                onClick={handleCreate}
                disabled={
                  !createName.trim()
                  || (createMode !== 'standard' && !createSkuId)
                  || (createMode === 'variant' && !createBaseTemplateId)
                  || createMutation.isPending
                }
              >
                {createMutation.isPending ? <span className={styles.btn__spinner} /> : <IconPlus />}
                创建
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ===== 删除模板确认 Modal ===== */}
      {deleteConfirmId !== null && createPortal(
        <div
          className={`${styles.drawerOverlay} ${styles['drawerOverlay--on']}`}
          onClick={() => setDeleteConfirmId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'var(--pc-white)',
              borderRadius: 'var(--pc-radius-xl)',
              boxShadow: 'var(--pc-shadow-lg)',
              width: '22rem',
              padding: '1.5rem',
              zIndex: 'var(--z-modal, 1300)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
            role="alertdialog"
            aria-modal="true"
            aria-label="确认删除模板"
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
              <div style={{ color: 'var(--pc-danger)', flexShrink: 0 }}>
                <IconWarn />
              </div>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--pc-neutral-900)', marginBottom: '0.375rem' }}>
                  确认删除此模板？
                </div>
                <div style={{ fontSize: '0.875rem', color: 'var(--pc-neutral-500)' }}>
                  删除后工序配置将不可恢复，已关联的款式将失去对应工序。
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                className={`${styles.btn} ${styles['btn--ghost']}`}
                onClick={() => setDeleteConfirmId(null)}
              >
                取消
              </button>
              <button
                className={`${styles.btn} ${styles['btn--dangerSolid']}`}
                onClick={handleDeleteTemplate}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? <span className={styles.btn__spinner} /> : <IconTrash />}
                确认删除
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
