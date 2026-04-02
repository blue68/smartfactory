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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import {
  useProcessConfigList,
  useProcessConfigDetail,
  useCreateProcessConfig,
  useUpdateProcessConfig,
  useDeleteProcessConfig,
  useSetMaxHours,
  useSetWages,
  useWorkstationTypes,
  useCreateWorkstationType,
  useDeleteWorkstationType,
  processConfigApi,
  type ProcessTemplateListItem,
  type ProcessStep,
  type ProcessStepPayload,
} from '@/api/processConfig';
import {
  useCreateProductionWorkstation,
  useDeleteProductionWorkstation,
  useProductionWorkstations,
  useUpdateProductionWorkstation,
  type WorkstationOption,
} from '@/api/production';
import { useSkuList } from '@/api/sku';
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
  hours: number;
  maxHours: number;
  unitPrice: number;
  status: NodeStatus;
}

interface EditorTemplate {
  id: number;
  name: string;
  skuId: number;
  skuName: string;
  nodes: ProcessNode[];
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
    hours: s.standardHours ? parseFloat(s.standardHours) : 0,
    maxHours: s.maxHours ? parseFloat(s.maxHours) : 0,
    unitPrice: 0, // unitPrice 通过 wages API 按需加载，初始为 0
    status: 'inherit' as NodeStatus,
  }));
}

function mapNodesToPayload(nodes: ProcessNode[]): ProcessStepPayload[] {
  return nodes
    .filter((n) => n.status !== 'deleted')
    .map((n) => ({
      stepNo: n.seq,
      stepName: n.name,
      standardHours: n.hours || undefined,
      workstationType: n.workstation || undefined,
      workstationId: n.workstationId || undefined,
    }));
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

const IconClock = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="10" cy="10" r="8" />
    <path d="M10 6v4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
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
  onClick: () => void;
}

function FlowNodeCard({ node, isSelected, onClick }: FlowNodeCardProps) {
  const statusClass = styles[`flowNode--${node.status}`] ?? '';
  const selectedClass = isSelected ? styles['flowNode--selected'] : '';

  return (
    <div
      className={`${styles.flowNode} ${statusClass} ${selectedClass}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      aria-label={`编辑工序 ${node.name}`}
    >
      <div className={`${styles.flowNode__statusTag} ${styles[`flowNode__statusTag--${node.status}`] ?? ''}`}>
        {STATUS_LABELS[node.status]}
      </div>
      <div className={styles.flowNode__seq}>STEP {node.seq}</div>
      <div className={styles.flowNode__name}>{node.name}</div>
      <div className={styles.flowNode__meta}>
        {node.workstationName && <div>{node.workstationName}</div>}
        {!node.workstationName && node.workstation && <div>{node.workstation}</div>}
        {node.hours > 0 && <div>{node.hours}h</div>}
      </div>
      <span className={styles.flowNode__editHint}>点击编辑</span>
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

  return (
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
    </div>
  );
}

interface NodeDrawerProps {
  node: ProcessNode | null;
  open: boolean;
  saving: boolean;
  workstationOptions: string[];
  workstationRecords: WorkstationOption[];
  linkedWorkstationCount: number;
  onManageWorkstations: () => void;
  onClose: () => void;
  onChange: (updated: ProcessNode) => void;
  onDelete: (key: number) => void;
}

function NodeDrawer({
  node,
  open,
  saving,
  workstationOptions,
  workstationRecords,
  linkedWorkstationCount,
  onManageWorkstations,
  onClose,
  onChange,
  onDelete,
}: NodeDrawerProps) {
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // 关闭时重置确认状态
  useEffect(() => {
    if (!open) setDeleteConfirm(false);
  }, [open]);

  if (!node) return null;

  const handleField = (field: keyof ProcessNode, value: string | number | null) => {
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

  const handleDeleteClick = () => setDeleteConfirm(true);
  const handleDeleteConfirm = () => {
    onDelete(node._key);
    setDeleteConfirm(false);
    onClose();
  };
  const handleDeleteCancel = () => setDeleteConfirm(false);

  return (
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
          <span className={styles.drawer__title}>编辑工序 · Step {node.seq}</span>
          <button className={styles.drawer__close} onClick={onClose} aria-label="关闭">
            <IconClose />
          </button>
        </header>

        <div className={styles.drawer__body}>
          {/* 基本信息 */}
          <div className={styles.formSection}>
            <div className={styles.formSection__title}>基本信息</div>

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
          <div className={styles.formSection}>
            <div className={styles.formSection__title}>工时设置</div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>标准工时 (h)</label>
                <input
                  className={styles.formInput}
                  type="number"
                  min="0"
                  step="0.5"
                  value={node.hours || ''}
                  onChange={(e) => handleField('hours', parseFloat(e.target.value) || 0)}
                  placeholder="0.0"
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>最大工时 (h)</label>
                <input
                  className={styles.formInput}
                  type="number"
                  min="0"
                  step="0.5"
                  value={node.maxHours || ''}
                  onChange={(e) => handleField('maxHours', parseFloat(e.target.value) || 0)}
                  placeholder="0.0"
                />
                <div className={styles.formHelp}>留空表示无上限</div>
              </div>
            </div>
          </div>

          {/* 计件单价 */}
          <div className={styles.formSection}>
            <div className={styles.formSection__title}>计件单价</div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>单价 (元/件)</label>
              <input
                className={styles.formInput}
                type="number"
                min="0"
                step="0.01"
                value={node.unitPrice || ''}
                onChange={(e) => handleField('unitPrice', parseFloat(e.target.value) || 0)}
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
    </>
  );
}

// ─────────────────────────────────────────────
// 主页面
// ─────────────────────────────────────────────

export default function ProcessConfigPage() {
  const { setPageTitle } = useAppStore();

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

  const templates: ProcessTemplateListItem[] = listData?.list ?? EMPTY_PROCESS_TEMPLATES;

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

  // ── 详情查询 ──
  const { data: detailData, isLoading: detailLoading, isError: detailError } =
    useProcessConfigDetail(selectedId);

  // ── 编辑器本地状态 ──
  const [editorTemplate, setEditorTemplate] = useState<EditorTemplate | null>(null);

  // ── 抽屉状态 ──
  const [drawerKey, setDrawerKey] = useState<number | null>(null);

  // ── 提示条 ──
  const [hintVisible, setHintVisible] = useState(true);
  const hintShownRef = useRef(false);

  // ── 新建模态 ──
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createSkuId, setCreateSkuId] = useState<number | null>(null);
  const [skuKeyword, setSkuKeyword] = useState('');

  // SKU 搜索列表（供新建模板时选择）
  const { data: skuListData } = useSkuList({
    keyword: skuKeyword || undefined,
    pageSize: 30,
  });

  // ── 删除模板确认 ──
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // ── 保存状态 ──
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

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
  const setMaxHoursMutation = useSetMaxHours();
  const setWagesMutation = useSetWages();

  // 当详情加载完成时，同步到本地编辑器状态
  useEffect(() => {
    if (!detailData) return;
    const { template, steps } = detailData;
    const nodes = mapStepsToNodes(steps).map((node) => {
      if (!node.workstationId) return node;
      const linked = workstationRecords?.find((item) => Number(item.id) === Number(node.workstationId));
      return linked ? { ...node, workstation: linked.type, workstationName: linked.name } : node;
    });
    setEditorTemplate({
      id: Number(template.id),
      name: template.name,
      // TypeORM 对 bigint 字段运行时返回字符串，强制转 number 避免 Zod positive() 报错
      skuId: Number(template.skuId) || 0,
      skuName: templates.find((t) => t.id === Number(template.id))?.skuName ?? '',
      nodes,
    });
    // 首次进入编辑器显示引导提示
    if (!hintShownRef.current) {
      setHintVisible(true);
      hintShownRef.current = true;
    }
  }, [detailData]); // eslint-disable-line react-hooks/exhaustive-deps

  // 选中模板时清空编辑器，等待详情加载
  const handleSelectTemplate = (id: number) => {
    if (id === selectedId) return;
    setSelectedId(id);
    setEditorTemplate(null);
    setDrawerKey(null);
  };

  // 获取当前编辑节点
  const editingNode = drawerKey !== null
    ? editorTemplate?.nodes.find((n) => n._key === drawerKey) ?? null
    : null;

  // 节点点击
  const handleNodeClick = useCallback((key: number) => {
    setDrawerKey(key);
  }, []);

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

  // 添加新节点
  const handleAddNode = () => {
    if (!editorTemplate) return;
    const activeNodes = editorTemplate.nodes.filter((n) => n.status !== 'deleted');
    const newKey = -Date.now();
    const newNode: ProcessNode = {
      _key: newKey,
      id: null,
      seq: activeNodes.length + 1,
      name: `工序 ${activeNodes.length + 1}`,
      workstation: '',
      workstationId: null,
      workstationName: '',
      hours: 0,
      maxHours: 0,
      unitPrice: 0,
      status: 'added',
    };
    setEditorTemplate((prev) => prev ? { ...prev, nodes: [...prev.nodes, newNode] } : prev);
    setDrawerKey(newKey);
  };

  // 核心保存函数 —— 接受显式 nodes，支持停用立即保存 + 手动保存两种调用路径
  const saveTemplate = async (tmpl: EditorTemplate, nodes: ProcessNode[]) => {
    setSaving(true);
    try {
      // Step 1: 保存模板基本信息 + 工序列表（skuId=0 时不传，避免 Zod positive() 报错）
      await updateMutation.mutateAsync({
        id: tmpl.id,
        payload: {
          name: tmpl.name,
          ...(tmpl.skuId > 0 && { skuId: tmpl.skuId }),
          steps: mapNodesToPayload(nodes),
        },
      });

      // Step 2: 获取服务端最新步骤列表（获取新增节点的真实 ID + 最新 maxHours）
      const { steps: savedSteps } = await processConfigApi.getById(tmpl.id);
      const stepIdByNo = new Map(savedSteps.map((s) => [Number(s.stepNo), Number(s.id)]));

      // Step 3: 并行保存 maxHours 和 unitPrice
      const patches: Promise<unknown>[] = [];
      for (const node of nodes) {
        if (node.status === 'deleted') continue;
        const stepId = stepIdByNo.get(node.seq);
        if (!stepId) continue;
        if (node.maxHours >= 0) {
          patches.push(setMaxHoursMutation.mutateAsync({ stepId, maxHours: node.maxHours }));
        }
        if (node.unitPrice > 0) {
          patches.push(setWagesMutation.mutateAsync({
            stepId,
            payload: { workerGrade: 'skilled', unitPrice: node.unitPrice },
          }));
        }
      }
      await Promise.all(patches);

      // Step 4: 用服务端数据重新同步编辑器（回填真实 ID，刷新 maxHours），保留 unitPrice 本地值
      const unitPriceBySeq = new Map(nodes.map((n) => [n.seq, n.unitPrice]));
      const freshNodes = mapStepsToNodes(savedSteps).map((n) => ({
        ...n,
        unitPrice: unitPriceBySeq.get(n.seq) ?? 0,
        workstationName: workstationRecords?.find((item) => Number(item.id) === Number(n.workstationId))?.name ?? '',
      }));
      setEditorTemplate((prev) => prev ? { ...prev, nodes: freshNodes } : prev);

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2200);
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

  // 新建模板
  const handleCreate = async () => {
    if (!createName.trim() || !createSkuId) return;
    const result = await createMutation.mutateAsync({
      name: createName.trim(),
      skuId: createSkuId,
      steps: [],
    });
    setShowCreateModal(false);
    setCreateName('');
    setCreateSkuId(null);
    setSkuKeyword('');
    setSelectedId(result.id);
  };

  // 模板名称修改
  const handleNameChange = (val: string) => {
    setEditorTemplate((prev) => prev ? { ...prev, name: val } : prev);
  };

  // 计算总工时
  const totalHours = editorTemplate?.nodes
    .filter((n) => n.status !== 'deleted')
    .reduce((sum, n) => sum + n.hours, 0) ?? 0;

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
            onClick={() => setShowCreateModal(true)}
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
              onClick={() => setShowCreateModal(true)}
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
                {editorTemplate.skuName ? (
                  <span className={styles.editorHeader__skuTag}>
                    {editorTemplate.skuName}
                  </span>
                ) : (
                  <span className={styles.editorHeader__skuTagMissing}>
                    未关联 SKU（可在保存时绑定）
                  </span>
                )}
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
                    点击节点卡片可编辑工序详情；末尾"+"按钮可添加新工序；编辑完成后点击"保存"提交变更。
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

              {/* 横向流程画布 */}
              <div className={styles.flowCanvas} role="region" aria-label="工序流程图">
                <div className={styles.flowTrack}>
                  {displayNodes.map((node, idx) => (
                    <div key={node._key} style={{ display: 'flex', alignItems: 'center' }}>
                      {/* 节点间箭头 */}
                      {idx > 0 && (
                        <span className={styles.flowArrow}>
                          <IconArrowRight />
                        </span>
                      )}
                      <FlowNodeCard
                        node={node}
                        isSelected={drawerKey === node._key}
                        onClick={() => handleNodeClick(node._key)}
                      />
                    </div>
                  ))}

                  {/* 添加节点按钮 */}
                  {displayNodes.length > 0 && (
                    <span className={styles.flowArrow}>
                      <IconArrowRight />
                    </span>
                  )}
                  <button
                    className={styles.flowAddBtn}
                    onClick={handleAddNode}
                    aria-label="添加新工序节点"
                  >
                    <IconPlus />
                    添加工序
                  </button>
                </div>

                {/* 统计栏 */}
                {displayNodes.filter((n) => n.status !== 'deleted').length > 0 && (
                  <div className={styles.flowStats}>
                    <span className={styles.flowStats__item}>
                      <IconFlow />
                      {displayNodes.filter((n) => n.status !== 'deleted').length} 道工序
                    </span>
                    {totalHours > 0 && (
                      <span className={styles.flowStats__item}>
                        <IconClock />
                        总工时 {totalHours.toFixed(1)} h
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* 图例 */}
              <div className={styles.legend} aria-label="节点状态图例">
                <span className={styles.legend__label}>图例</span>
                {(
                  [
                    ['inherit',  '标准工序'],
                    ['modified', '已调整'],
                    ['added',    '新增工序'],
                    ['deleted',  '已停用'],
                  ] as const
                ).map(([status, label]) => (
                  <span key={status} className={styles.legendItem}>
                    <span className={`${styles.legendDot} ${styles[`legendDot--${status}`]}`} />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </main>

      {/* ===== 节点编辑抽屉 ===== */}
      <NodeDrawer
        node={editingNode}
        open={drawerKey !== null && editingNode !== null}
        saving={saving}
        workstationOptions={workstationOptions}
        workstationRecords={workstationRecords ?? []}
        linkedWorkstationCount={editingNode?.workstation ? (workstationCountByType.get(editingNode.workstation) ?? 0) : 0}
        onManageWorkstations={() => setWorkstationManagerOpen(true)}
        onClose={() => setDrawerKey(null)}
        onChange={handleNodeChange}
        onDelete={handleNodeDelete}
      />

      {/* ===== 工种类型管理 Modal ===== */}
      <WorkstationTypeManager
        open={workstationManagerOpen}
        onClose={() => setWorkstationManagerOpen(false)}
        preferredType={editingNode?.workstation ?? ''}
      />

      {/* ===== 新建模板 Modal ===== */}
      {showCreateModal && (
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
              zIndex: 202,
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

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                关联 SKU<span className={styles.formLabel__req}>*</span>
              </label>
              {/* SKU 搜索下拉 */}
              <input
                className={styles.formInput}
                type="search"
                value={skuKeyword}
                onChange={(e) => {
                  setSkuKeyword(e.target.value);
                  setCreateSkuId(null); // 重新输入时清空已选
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
              {createSkuId && (
                <div className={styles.formHelp} style={{ color: 'var(--pc-success)' }}>
                  已选择 SKU ID: {createSkuId}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', paddingTop: '0.25rem' }}>
              <button
                className={`${styles.btn} ${styles['btn--ghost']}`}
                onClick={() => { setShowCreateModal(false); setSkuKeyword(''); setCreateSkuId(null); }}
              >
                取消
              </button>
              <button
                className={`${styles.btn} ${styles['btn--primary']}`}
                onClick={handleCreate}
                disabled={!createName.trim() || !createSkuId || createMutation.isPending}
              >
                {createMutation.isPending ? <span className={styles.btn__spinner} /> : <IconPlus />}
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 删除模板确认 Modal ===== */}
      {deleteConfirmId !== null && (
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
              zIndex: 202,
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
        </div>
      )}
    </div>
  );
}
