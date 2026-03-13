/**
 * [artifact:前端代码] — 工序配置页
 * 设计稿：docs/ui/web-process-config.html
 *
 * 功能：
 * 1. 标准工序模板列表（搜索 + 类型筛选）
 * 2. 工序模板编辑视图（蛇形流程图 + 颜色说明图例）
 * 3. 节点编辑侧边抽屉（Drawer）
 * 4. 款式差异配置（可展开行 + 差异明细）—— 静态展示，后端暂无对应接口
 * 5. 工作站管理 Modal —— 静态展示，后端暂无对应接口
 *
 * API 联调说明：
 *   - 模板列表：useProcessConfigList  → GET /api/process-configs
 *   - 模板详情：useProcessConfigDetail → GET /api/process-configs/:id
 *   - 创建模板：useCreateProcessConfig → POST /api/process-configs
 *   - 更新模板：useUpdateProcessConfig → PUT /api/process-configs/:id
 *   - 删除模板：useDeleteProcessConfig → DELETE /api/process-configs/:id
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '@/stores/appStore';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import {
  useProcessConfigList,
  useProcessConfigDetail,
  useUpdateProcessConfig,
  useDeleteProcessConfig,
  useCreateProcessConfig,
  type ProcessTemplateListItem,
  type ProcessStep,
  type ProcessStepPayload,
} from '@/api/processConfig';
import styles from './ProcessConfigPage.module.css';

// ─────────────────────────────────────────────
// 页面内部类型定义
// ─────────────────────────────────────────────

type NodeStatus = 'inherit' | 'modified' | 'added' | 'deleted';

interface ProcessNode {
  id: number;
  seq: number;
  name: string;
  workstation: string;
  hours: number;
  status: NodeStatus;
}

/** 页面使用的模板视图模型（由后端数据适配而来） */
interface ProcessTemplate {
  id: number;
  name: string;
  /** 从 skuName 映射，后端无独立 type 字段，此处用 skuName 或"未分类"占位 */
  type: string;
  nodeCount: number;
  /** 后端 list 接口无关联款式数量，显示为 0，详情接口也无此字段 */
  skuCount: number;
  totalHours: number;
  nodes: ProcessNode[];
  /** 原始 skuId，用于 update/create 调用 */
  skuId: number;
}

type DiffRowStatus = 'inherit' | 'added' | 'deleted';

interface DiffProcessRow {
  seq: number;
  name: string;
  status: DiffRowStatus;
  note: string;
}

interface StyleDiff {
  id: string;
  styleName: string;
  baseTemplate: string;
  summaryAdd: number;
  summaryDel: number;
  rows: DiffProcessRow[];
}

type WorkstationRow = {
  name: string;
  worker: string;
  relatedProcess: string;
};

// ─────────────────────────────────────────────
// 后端数据适配函数
// ─────────────────────────────────────────────

/** 将后端 list 记录映射为页面 ProcessTemplate（无步骤数据） */
function mapListItemToTemplate(item: ProcessTemplateListItem): ProcessTemplate {
  return {
    id: item.id,
    name: item.name,
    // 后端 list 接口无独立 type 字段，用 skuName 作为类型标签
    type: item.skuName ?? '未分类',
    nodeCount: 0,        // list 接口不含步骤数量，编辑时从 detail 接口获取
    skuCount: 0,         // 后端暂无关联款式数量字段
    totalHours: 0,       // list 接口不含工时合计，编辑时从 detail 接口计算
    nodes: [],
    skuId: item.skuId,
  };
}

/** 将后端步骤列表映射为页面 ProcessNode[] */
function mapStepsToNodes(steps: ProcessStep[]): ProcessNode[] {
  return steps.map((s) => ({
    id: s.id,
    seq: s.stepNo,
    name: s.stepName,
    workstation: s.workstationType ?? '',
    hours: s.standardHours ? parseFloat(s.standardHours) : 0,
    status: 'inherit' as NodeStatus,
  }));
}

/** 将页面 ProcessNode[] 映射为后端 steps payload */
function mapNodesToStepPayload(nodes: ProcessNode[]): ProcessStepPayload[] {
  return nodes
    .filter((n) => n.status !== 'deleted')
    .map((n) => ({
      stepNo: n.seq,
      stepName: n.name,
      standardHours: n.hours,
      workstationType: n.workstation || undefined,
    }));
}

// ─────────────────────────────────────────────
// 静态展示数据（后端暂无对应接口，保留作展示用途）
// TODO: 后端实现款式差异接口（GET /api/style-diffs）后替换为真实 API 调用
// ─────────────────────────────────────────────
const STATIC_DIFFS: StyleDiff[] = [
  {
    id: 'diff1',
    styleName: '红橡实木书柜 1.8m',
    baseTemplate: '实木家具-标准模板',
    summaryAdd: 1,
    summaryDel: 0,
    rows: [
      { seq: 1, name: '开料',  status: 'inherit', note: '工时 4.0 h' },
      { seq: 2, name: '钻孔',  status: 'inherit', note: '工时 2.0 h' },
      { seq: 3, name: '封边',  status: 'inherit', note: '工时 1.5 h' },
      { seq: 4, name: '开槽',  status: 'added',   note: '此款式专有，工时 1.5 h' },
      { seq: 5, name: '砂光',  status: 'inherit', note: '工时 1.0 h' },
      { seq: 6, name: '涂装',  status: 'inherit', note: '工时 3.0 h' },
      { seq: 7, name: '装配',  status: 'inherit', note: '工时 2.0 h' },
      { seq: 8, name: '质检',  status: 'inherit', note: '工时 0.5 h' },
    ],
  },
  {
    id: 'diff2',
    styleName: '亚麻软包床头柜',
    baseTemplate: '软包家具-标准模板',
    summaryAdd: 1,
    summaryDel: 1,
    rows: [
      { seq: 1, name: '开料',     status: 'inherit', note: '工时 3.0 h' },
      { seq: 2, name: '裁海绵',   status: 'inherit', note: '工时 1.0 h' },
      { seq: 3, name: '内框焊接', status: 'added',   note: '此款式专有，工时 2.0 h' },
      { seq: 4, name: '包布',     status: 'inherit', note: '工时 2.5 h' },
      { seq: 5, name: '表面涂装', status: 'deleted', note: '此款式无需涂装' },
      { seq: 6, name: '装配',     status: 'inherit', note: '工时 1.0 h' },
      { seq: 7, name: '检验',     status: 'inherit', note: '工时 0.5 h' },
    ],
  },
  {
    id: 'diff3',
    styleName: '白色烤漆衣柜 2.0m',
    baseTemplate: '板式家具-标准模板',
    summaryAdd: 0,
    summaryDel: 0,
    rows: [],
  },
];

// TODO: 后端实现工作站接口（GET /api/workstations）后替换为真实 API 调用
const STATIC_WORKSTATIONS: WorkstationRow[] = [
  { name: '开料区', worker: '张工',        relatedProcess: '开料' },
  { name: '钻孔区', worker: '李工',        relatedProcess: '钻孔' },
  { name: '封边区', worker: '王工',        relatedProcess: '封边' },
  { name: '装配区', worker: '赵工 / 孙工', relatedProcess: '装配、五金安装' },
  { name: 'QC区',  worker: '刘工',        relatedProcess: '质检' },
];

// ─────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────

const WORKSTATION_OPTIONS = ['开料区', '钻孔区', '封边区', '砂光区', '涂装间', '装配区', 'QC区'];

const TYPE_OPTIONS = ['全部类型', '板式家具', '软包家具', '实木家具'];

// ─────────────────────────────────────────────
// 工具函数：将节点列表拆成蛇形行（每行 4 个节点）
// ─────────────────────────────────────────────

function chunkNodes(nodes: ProcessNode[], perRow = 4): ProcessNode[][] {
  const rows: ProcessNode[][] = [];
  for (let i = 0; i < nodes.length; i += perRow) {
    rows.push(nodes.slice(i, i + perRow));
  }
  return rows;
}

// ─────────────────────────────────────────────
// 节点编辑抽屉
// ─────────────────────────────────────────────

interface NodeDrawerProps {
  open: boolean;
  node: ProcessNode | null;
  onClose: () => void;
  onSave: (node: ProcessNode) => void;
  onDelete: (node: ProcessNode) => void;
}

function NodeDrawer({ open, node, onClose, onSave, onDelete }: NodeDrawerProps) {
  const [name, setName] = useState('');
  const [workstation, setWorkstation] = useState('');
  const [hours, setHours] = useState('');
  const [prev, setPrev] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (node) {
      setName(node.name);
      setWorkstation(node.workstation);
      setHours(String(node.hours));
      setPrev('');
      setNote('');
    }
  }, [node]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open, onClose]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!node) return null;

  return createPortal(
    <>
      <div
        className={`${styles.drawerOverlay} ${open ? styles['drawerOverlay--on'] : ''}`}
        onClick={onClose}
      />
      <div
        className={`${styles.drawer} ${open ? styles['drawer--on'] : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        <div className={styles.drawer__header}>
          <span id="drawer-title" className={styles.drawer__title}>编辑工序节点</span>
          <button className={styles.drawer__close} onClick={onClose} aria-label="关闭">✕</button>
        </div>

        <div className={styles.drawer__body}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="nodeName">工序名称</label>
            <input
              className={styles.formInput}
              id="nodeName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="nodeStation">工作站</label>
            <select
              className={styles.formSelect}
              id="nodeStation"
              value={workstation}
              onChange={(e) => setWorkstation(e.target.value)}
            >
              {WORKSTATION_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="nodeHours">标准工时（小时/套）</label>
            <input
              className={styles.formInput}
              id="nodeHours"
              type="number"
              min="0.1"
              step="0.5"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="nodePrev">前置工序</label>
            <select
              className={styles.formSelect}
              id="nodePrev"
              value={prev}
              onChange={(e) => setPrev(e.target.value)}
            >
              <option value="">无（此为首道工序）</option>
              <option>开料（工序 1）</option>
              <option>钻孔（工序 2）</option>
              <option>封边（工序 3）</option>
              <option>砂光（工序 4）</option>
              <option>涂装（工序 5）</option>
              <option>装配（工序 6）</option>
            </select>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="nodeNote">工序说明</label>
            <input
              className={styles.formInput}
              id="nodeNote"
              type="text"
              placeholder="可选，工序操作要点说明…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.drawer__footer}>
          <button
            className={`${styles.btn} ${styles['btn--dangerOutline']} ${styles['btn--sm']}`}
            onClick={() => { onDelete(node); onClose(); }}
          >
            删除此工序
          </button>
          <button
            className={`${styles.btn} ${styles['btn--primary']}`}
            onClick={() => {
              onSave({ ...node, name, workstation, hours: Number(hours) });
              onClose();
            }}
          >
            保存
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

// ─────────────────────────────────────────────
// 流程图编辑视图
// ─────────────────────────────────────────────

interface FlowEditorProps {
  template: ProcessTemplate;
  onBack: () => void;
  onSaved: (updatedTemplate: ProcessTemplate) => void;
}

function FlowEditor({ template, onBack, onSaved }: FlowEditorProps) {
  const { showToast } = useAppStore();
  const updateMutation = useUpdateProcessConfig();

  const [nodes, setNodes] = useState<ProcessNode[]>(template.nodes);
  const [drawerNode, setDrawerNode] = useState<ProcessNode | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 当模板传入后重新同步节点（切换编辑对象时）
  useEffect(() => {
    setNodes(template.nodes);
  }, [template.id, template.nodes]);

  const totalHours = nodes
    .filter((n) => n.status !== 'deleted')
    .reduce((sum, n) => sum + n.hours, 0);

  const rows = chunkNodes(nodes, 4);

  const openNodeDrawer = (node: ProcessNode) => {
    setDrawerNode(node);
    setDrawerOpen(true);
  };

  const handleNodeSave = (updated: ProcessNode) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === updated.id ? { ...updated, status: 'modified' } : n)),
    );
    showToast({ type: 'success', message: '工序节点已更新（未提交）' });
  };

  const handleNodeDelete = (target: ProcessNode) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === target.id ? { ...n, status: 'deleted' } : n)),
    );
    showToast({ type: 'success', message: '已标记删除该工序（未提交）' });
  };

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        id: template.id,
        payload: {
          name: template.name,
          skuId: template.skuId,
          steps: mapNodesToStepPayload(nodes),
        },
      });
      const savedTemplate: ProcessTemplate = {
        ...template,
        nodes,
        totalHours,
        nodeCount: nodes.filter((n) => n.status !== 'deleted').length,
      };
      onSaved(savedTemplate);
      showToast({ type: 'success', message: '模板已保存' });
    } catch {
      showToast({ type: 'error', message: '保存失败，请重试' });
    }
  };

  return (
    <>
      <div className={`${styles.card} ${styles.editorCard}`}>
        {/* 编辑器头部 */}
        <div className={styles.card__header}>
          <button
            className={`${styles.btn} ${styles['btn--ghost']} ${styles['btn--sm']}`}
            onClick={onBack}
          >
            ← 返回列表
          </button>
          <span className={styles.card__title}>
            工序模板编辑 — {template.name}
          </span>
          <div className={styles.headerRight}>
            <button
              className={`${styles.btn} ${styles['btn--ghost']}`}
              onClick={onBack}
            >
              取消
            </button>
            <button
              className={`${styles.btn} ${styles['btn--primary']}`}
              onClick={handleSave}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? '保存中…' : '保存'}
            </button>
          </div>
        </div>

        <div className={styles.card__body}>
          <p className={styles.flowHint}>工序流程图（横向展示，可左右滚动）</p>

          {/* 蛇形流程图 */}
          <div className={styles.flowCanvas}>
            <div className={styles.flowRows}>
              {rows.map((rowNodes, rowIdx) => {
                const isEvenRow = rowIdx % 2 === 1; // 偶数行（0-indexed）反向
                return (
                  <div
                    key={rowIdx}
                    className={`${styles.flowRow} ${isEvenRow ? styles['flowRow--reverse'] : ''}`}
                  >
                    {rowNodes.map((node, nodeIdx) => {
                      const isLastInRow = nodeIdx === rowNodes.length - 1;
                      const isLastRow = rowIdx === rows.length - 1;
                      const isLastNode = isLastInRow && isLastRow;
                      // 最后一个节点在非最后行时显示向下箭头
                      const showDownArrow = isLastInRow && !isLastRow;

                      return (
                        <div key={node.id} className={styles.flowNodeWrap}>
                          <div
                            className={`${styles.flowNode} ${styles[`flowNode--${node.status}`]}`}
                            onClick={() => openNodeDrawer(node)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === 'Enter' && openNodeDrawer(node)}
                          >
                            <div className={styles.flowNode__num}>{node.seq}.</div>
                            <div className={styles.flowNode__name}>{node.name}</div>
                            <div className={styles.flowNode__meta}>
                              工作站：{node.workstation}<br />工时：{node.hours.toFixed(1)} h
                            </div>
                            <div className={styles.flowNode__edit}>
                              <button
                                onClick={(e) => { e.stopPropagation(); openNodeDrawer(node); }}
                              >
                                编辑
                              </button>
                            </div>
                          </div>

                          {/* 同行箭头 */}
                          {!isLastNode && !showDownArrow && (
                            <span className={styles.flowArrow}>▶</span>
                          )}
                          {/* 行末向下指示（非最后行） */}
                          {showDownArrow && (
                            <span
                              className={styles.flowArrow}
                              style={{ color: 'var(--color-gray-300)' }}
                            >
                              ↓
                            </span>
                          )}
                        </div>
                      );
                    })}

                    {/* 行首/行尾占位（反向行需要在右侧留空以对齐下方向） */}
                    {isEvenRow && <div className={styles.flowPlaceholder} />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 底部操作 + 工时合计 */}
          <div className={styles.flowActions}>
            <button
              className={`${styles.btn} ${styles['btn--ghost']} ${styles['btn--sm']}`}
              onClick={() => showToast({ type: 'info', message: '请在末尾添加工序' })}
            >
              ＋ 在末尾添加工序
            </button>
            <button className={`${styles.btn} ${styles['btn--ghost']} ${styles['btn--sm']}`}>
              调整工序顺序
            </button>
            <div className={styles.totalHours}>
              ⏱ 总标准工时：{totalHours.toFixed(1)} 小时 / 套
            </div>
          </div>

          {/* 图例 */}
          <div className={styles.legend}>
            <span className={styles.legend__label}>颜色说明：</span>
            <LegendItem dotClass={styles['legendDot--inherit']}>继承（灰色）</LegendItem>
            <LegendItem dotClass={styles['legendDot--modified']}>已修改工时/工作站（蓝色）</LegendItem>
            <LegendItem dotClass={styles['legendDot--added']}>款式新增（绿色）</LegendItem>
            <LegendItem dotClass={styles['legendDot--deleted']}>款式删除（红色）</LegendItem>
          </div>
        </div>
      </div>

      <NodeDrawer
        open={drawerOpen}
        node={drawerNode}
        onClose={() => setDrawerOpen(false)}
        onSave={handleNodeSave}
        onDelete={handleNodeDelete}
      />
    </>
  );
}

function LegendItem({ dotClass, children }: { dotClass: string; children: React.ReactNode }) {
  return (
    <div className={styles.legendItem}>
      <div className={`${styles.legendDot} ${dotClass}`} />
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────
// 编辑器容器：负责加载详情数据后交给 FlowEditor 渲染
// ─────────────────────────────────────────────

interface FlowEditorContainerProps {
  baseTemplate: ProcessTemplate;
  onBack: () => void;
  onSaved: (updated: ProcessTemplate) => void;
}

function FlowEditorContainer({ baseTemplate, onBack, onSaved }: FlowEditorContainerProps) {
  const { data: detail, isLoading, isError } = useProcessConfigDetail(baseTemplate.id);

  if (isLoading) {
    return (
      <div className={styles.card}>
        <div className={styles.card__body}>
          <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '40px 0' }}>
            加载工序步骤中…
          </p>
        </div>
      </div>
    );
  }

  if (isError || !detail) {
    return (
      <div className={styles.card}>
        <div className={styles.card__body}>
          <p style={{ textAlign: 'center', color: 'var(--color-danger)', padding: '40px 0' }}>
            工序步骤加载失败，请重试
          </p>
          <div style={{ textAlign: 'center' }}>
            <button className={`${styles.btn} ${styles['btn--ghost']}`} onClick={onBack}>
              ← 返回列表
            </button>
          </div>
        </div>
      </div>
    );
  }

  const nodes = mapStepsToNodes(detail.steps);
  const totalHours = nodes.reduce((sum, n) => sum + n.hours, 0);

  const fullTemplate: ProcessTemplate = {
    ...baseTemplate,
    nodes,
    nodeCount: nodes.length,
    totalHours,
  };

  return <FlowEditor template={fullTemplate} onBack={onBack} onSaved={onSaved} />;
}

// ─────────────────────────────────────────────
// 款式差异配置行（可展开）
// ─────────────────────────────────────────────

interface DiffRowProps {
  diff: StyleDiff;
}

function DiffRow({ diff }: DiffRowProps) {
  const { showToast } = useAppStore();
  const [expanded, setExpanded] = useState(false);
  const hasDiff = diff.summaryAdd > 0 || diff.summaryDel > 0;

  return (
    <>
      <tr
        className={styles.diffRow}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <td className={styles.td} style={{ fontWeight: 600 }}>{diff.styleName}</td>
        <td className={styles.td} style={{ color: 'var(--text-secondary)' }}>{diff.baseTemplate}</td>
        <td className={styles.td}>
          {!hasDiff ? (
            <span className={`${styles.diffBadge} ${styles['diffBadge--none']}`}>无差异</span>
          ) : (
            <>
              {diff.summaryAdd > 0 && (
                <span className={`${styles.diffBadge} ${styles['diffBadge--add']}`}>
                  +{diff.summaryAdd} 新增{diff.summaryDel > 0 ? '工序' : ''}
                </span>
              )}
              {diff.summaryDel > 0 && (
                <span
                  className={`${styles.diffBadge} ${styles['diffBadge--del']}`}
                  style={{ marginLeft: 'var(--space-2)' }}
                >
                  -{diff.summaryDel} 删除
                </span>
              )}
            </>
          )}
        </td>
        <td className={styles.td}>
          <button
            className={`${styles.btn} ${styles['btn--ghost']} ${styles['btn--sm']}`}
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          >
            配置差异 {expanded ? '▲' : '▼'}
          </button>
        </td>
      </tr>

      {/* 展开详情行 */}
      <tr>
        <td colSpan={4} style={{ padding: 0 }}>
          <div className={`${styles.diffDetail} ${expanded ? styles['diffDetail--open'] : ''}`}>
            <div className={styles.diffDetail__inner}>
              <div className={styles.diffDetailHeader}>
                <strong className={styles.diffDetailTitle}>
                  款式差异配置 — {diff.styleName}（基础：{diff.baseTemplate}）
                </strong>
                <div className={styles.diffDetailActions}>
                  <button className={`${styles.btn} ${styles['btn--ghost']} ${styles['btn--sm']}`}>
                    ＋ 新增专属工序
                  </button>
                  <button
                    className={`${styles.btn} ${styles['btn--success']} ${styles['btn--sm']}`}
                    onClick={() => showToast({ type: 'success', message: '差异已保存' })}
                  >
                    保存差异
                  </button>
                </div>
              </div>

              <table className={styles.diffProcessTable}>
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>序号</th>
                    <th>工序名称</th>
                    <th>本款式配置</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.rows.map((row) => (
                    <tr
                      key={row.seq}
                      className={
                        row.status === 'added'
                          ? styles['diffProcessRow--added']
                          : row.status === 'deleted'
                          ? styles['diffProcessRow--deleted']
                          : styles['diffProcessRow--inherit']
                      }
                    >
                      <td>{row.seq}</td>
                      <td style={row.status === 'deleted' ? { textDecoration: 'line-through', color: 'var(--text-disabled)' } : {}}>
                        {row.name}
                      </td>
                      <td>
                        {row.status === 'inherit' && (
                          <><span className={`${styles.diffRowIndicator} ${styles['diffRowIndicator--inherit']}`}>继承</span> {row.note}</>
                        )}
                        {row.status === 'added' && (
                          <><span className={`${styles.diffRowIndicator} ${styles['diffRowIndicator--added']}`}>🟢 新增</span> {row.note}</>
                        )}
                        {row.status === 'deleted' && (
                          <><span className={`${styles.diffRowIndicator} ${styles['diffRowIndicator--deleted']}`}>🔴 已删除</span> {row.note}</>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </td>
      </tr>
    </>
  );
}

// ─────────────────────────────────────────────
// 工作站管理 Modal 内容（静态展示，后端暂无接口）
// ─────────────────────────────────────────────

function WorkstationTable() {
  return (
    <table className={styles.wsTable}>
      <thead>
        <tr>
          <th>工作站名称</th>
          <th>负责工人</th>
          <th>关联工序</th>
        </tr>
      </thead>
      <tbody>
        {STATIC_WORKSTATIONS.map((ws) => (
          <tr key={ws.name}>
            <td style={{ fontWeight: 600 }}>{ws.name}</td>
            <td style={{ color: 'var(--text-secondary)' }}>{ws.worker}</td>
            <td>{ws.relatedProcess}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─────────────────────────────────────────────
// 新建模板 Modal
// ─────────────────────────────────────────────

interface CreateTemplateModalProps {
  open: boolean;
  onClose: () => void;
}

function CreateTemplateModal({ open, onClose }: CreateTemplateModalProps) {
  const { showToast } = useAppStore();
  const createMutation = useCreateProcessConfig();
  const [name, setName] = useState('');
  const [skuId, setSkuId] = useState('');

  const handleSubmit = async () => {
    const parsedSkuId = parseInt(skuId, 10);
    if (!name.trim()) {
      showToast({ type: 'error', message: '请输入模板名称' });
      return;
    }
    if (!skuId.trim() || isNaN(parsedSkuId)) {
      showToast({ type: 'error', message: '请输入有效的 SKU ID' });
      return;
    }
    try {
      await createMutation.mutateAsync({ name: name.trim(), skuId: parsedSkuId });
      showToast({ type: 'success', message: '工序模板已创建' });
      setName('');
      setSkuId('');
      onClose();
    } catch {
      showToast({ type: 'error', message: '创建失败，请重试' });
    }
  };

  return (
    <Modal
      open={open}
      title="新建工序模板"
      onClose={onClose}
      hideFooter={false}
      footer={
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? '创建中…' : '确认创建'}
          </Button>
        </div>
      }
      size="sm"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div className={styles.formGroup}>
          <label className={styles.formLabel} htmlFor="newTplName">模板名称</label>
          <input
            className={styles.formInput}
            id="newTplName"
            type="text"
            placeholder="例：板式家具-标准模板"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel} htmlFor="newTplSkuId">关联 SKU ID</label>
          <input
            className={styles.formInput}
            id="newTplSkuId"
            type="number"
            placeholder="请输入 SKU ID"
            value={skuId}
            onChange={(e) => setSkuId(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// 主页面组件
// ─────────────────────────────────────────────

export default function ProcessConfigPage() {
  const { setPageTitle, showToast } = useAppStore();

  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState('全部类型');
  const [page] = useState(1);
  const pageSize = 50; // 一次加载足量数据，支持前端筛选

  // 编辑器视图
  const [editingTemplate, setEditingTemplate] = useState<ProcessTemplate | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  // 工作站 Modal
  const [workstationModal, setWorkstationModal] = useState(false);

  // 新建模板 Modal
  const [createModal, setCreateModal] = useState(false);

  // 删除确认
  const deleteMutation = useDeleteProcessConfig();

  useEffect(() => {
    setPageTitle('工序配置');
  }, [setPageTitle]);

  // ── 获取模板列表（前端搜索关键词通过 API 透传，类型筛选在前端过滤）
  const listQuery = useProcessConfigList({ page, pageSize, keyword: keyword.trim() || undefined });

  const templates: ProcessTemplate[] = (listQuery.data?.list ?? []).map(mapListItemToTemplate);

  // 前端按 type 筛选（后端 list 接口返回 skuName 作为 type 标签）
  const filtered = templates.filter((tpl) => {
    const matchType = typeFilter === '全部类型' || tpl.type === typeFilter;
    return matchType;
  });

  const openEditor = useCallback(
    (tpl: ProcessTemplate) => {
      setEditingTemplate(tpl);
      setTimeout(() => {
        editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    },
    [],
  );

  const closeEditor = useCallback(() => {
    setEditingTemplate(null);
  }, []);

  const handleSavedTemplate = useCallback((updated: ProcessTemplate) => {
    // 保存成功后关闭编辑器，列表由 React Query 自动刷新
    setEditingTemplate(null);
    // 若需要保持编辑器打开可将上行改为 setEditingTemplate(updated)
    void updated; // 当前策略是关闭，suppressing unused-var lint
  }, []);

  const handleDelete = useCallback(async (id: number, name: string) => {
    if (!window.confirm(`确定删除工序模板「${name}」？此操作不可撤销。`)) return;
    try {
      await deleteMutation.mutateAsync(id);
      showToast({ type: 'success', message: `已删除模板「${name}」` });
      if (editingTemplate?.id === id) setEditingTemplate(null);
    } catch {
      showToast({ type: 'error', message: '删除失败，请重试' });
    }
  }, [deleteMutation, showToast, editingTemplate]);

  return (
    <div className={styles.page}>

      {/* ── 工具栏 ── */}
      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <span className={styles.searchBox__icon} aria-hidden="true">🔍</span>
          <input
            className={styles.searchBox__input}
            type="text"
            placeholder="搜索模板名称…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            aria-label="搜索模板名称"
          />
        </div>

        <select
          className={styles.filterSelect}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="工序类型筛选"
        >
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>

        <div className={styles.toolbar__spacer} />

        <button
          className={`${styles.btn} ${styles['btn--ghost']}`}
          onClick={() => setWorkstationModal(true)}
        >
          🏭 工作站管理
        </button>
        <button
          className={`${styles.btn} ${styles['btn--primary']}`}
          onClick={() => setCreateModal(true)}
        >
          ＋ 新建模板
        </button>
      </div>

      {/* ── 标准工序模板列表 ── */}
      <div className={styles.card}>
        <div className={styles.card__header}>
          <span className={styles.card__headerIcon}>📄</span>
          <span className={styles.card__title}>标准工序模板</span>
        </div>
        <div className={styles.tableScroll}>
          {listQuery.isLoading ? (
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '40px 0' }}>
              加载中…
            </p>
          ) : listQuery.isError ? (
            <p style={{ textAlign: 'center', color: 'var(--color-danger)', padding: '40px 0' }}>
              数据加载失败，请刷新重试
            </p>
          ) : (
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>模板名称</th>
                  <th>工序数量</th>
                  <th>关联款式</th>
                  <th>总标准工时</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className={styles.emptyCell}>暂无工序模板</td>
                  </tr>
                ) : (
                  filtered.map((tpl) => (
                    <tr key={tpl.id}>
                      <td className={styles.td} style={{ fontWeight: 700 }}>{tpl.name}</td>
                      <td className={styles.td}>
                        {/* nodeCount 在 list 接口中不含步骤，编辑后会更新 */}
                        <span className={styles.countBadge}>
                          {tpl.nodeCount > 0 ? `${tpl.nodeCount} 道` : '—'}
                        </span>
                      </td>
                      <td className={styles.td}>
                        {/* 后端暂无关联款式数量，显示 SKU 名称 */}
                        <span style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                          {tpl.type}
                        </span>
                      </td>
                      <td className={styles.td} style={{ fontFamily: 'var(--font-family-number)', fontWeight: 600 }}>
                        {tpl.totalHours > 0 ? `${tpl.totalHours.toFixed(1)} h/套` : '—'}
                      </td>
                      <td className={styles.td}>
                        <div className={styles.actionGroup}>
                          <button
                            className={`${styles.btn} ${styles['btn--primary']} ${styles['btn--sm']}`}
                            onClick={() => openEditor(tpl)}
                          >
                            编辑
                          </button>
                          <button
                            className={`${styles.btn} ${styles['btn--secondary']} ${styles['btn--sm']}`}
                            onClick={() => showToast({ type: 'success', message: '已复制模板' })}
                          >
                            复制
                          </button>
                          <button
                            className={`${styles.btn} ${styles['btn--ghost']} ${styles['btn--sm']}`}
                            onClick={() => handleDelete(tpl.id, tpl.name)}
                            disabled={deleteMutation.isPending}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── 工序模板编辑视图（条件渲染） ── */}
      <div ref={editorRef}>
        {editingTemplate && (
          <FlowEditorContainer
            baseTemplate={editingTemplate}
            onBack={closeEditor}
            onSaved={handleSavedTemplate}
          />
        )}
      </div>

      {/* ── 款式差异配置（静态数据展示，后端暂无接口） ── */}
      <div className={styles.card}>
        <div className={styles.card__header}>
          <span className={styles.card__headerIcon}>⚙</span>
          <span className={styles.card__title}>款式差异配置</span>
          <span className={styles.card__headerSub}>在模板基础上的增减</span>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.diffTable}>
            <thead>
              <tr>
                <th>款式 / 产品名称</th>
                <th>基础模板</th>
                <th>差异摘要</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {STATIC_DIFFS.map((diff) => (
                <DiffRow key={diff.id} diff={diff} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 工作站管理 Modal（静态数据，后端暂无接口） ── */}
      <Modal
        open={workstationModal}
        title="工作站管理"
        onClose={() => setWorkstationModal(false)}
        hideFooter={false}
        footer={
          <Button variant="primary" onClick={() => setWorkstationModal(false)}>
            关闭
          </Button>
        }
        size="md"
      >
        <div className={styles.wsModalHeader}>
          <Button
            variant="primary"
            size="sm"
            onClick={() => showToast({ type: 'info', message: '请填写新工作站信息' })}
          >
            ＋ 新增工作站
          </Button>
        </div>
        <WorkstationTable />
      </Modal>

      {/* ── 新建模板 Modal ── */}
      <CreateTemplateModal open={createModal} onClose={() => setCreateModal(false)} />
    </div>
  );
}
