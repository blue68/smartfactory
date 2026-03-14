/**
 * [artifact:前端代码] — 类目管理页 R-01
 * 功能：树形列表（扁平展示一级/二级）/ 新增 Modal / 编辑 Modal / 删除确认 Modal / 搜索筛选
 * Batch-2 新增：FE-01-01 骨架屏 / FE-01-02 拖拽排序 / FE-01-03 操作日志 Drawer
 *               FE-01-04 四种删除 Modal / FE-01-05 行内编辑 / FE-01-06 PATCH
 */

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  useSkuCategoryList,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useReorderCategories,
  useAuditLogs,
  fetchDeletePreview,
} from '@/api/skuCategory';
import type {
  AuditLogEntry,
  AuditLogParams,
  DeletePreviewResult,
} from '@/api/skuCategory';
import type { SkuCategoryFull, CreateCategoryPayload, UpdateCategoryPayload } from '@/types/models';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import Table from '@/components/common/Table';
import type { Column } from '@/components/common/Table';
import styles from './CategoryConfigPage.module.css';

// ─── 扁平行类型（含层级信息，用于树形渲染） ─────────────────
interface FlatRow extends SkuCategoryFull {
  _isChild: boolean;
  _parentName?: string;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────
// FE-01-01: 骨架屏组件
// ─────────────────────────────────────────────

function SkeletonLoading() {
  const listWidths = [80, 65, 90, 70, 60];
  const tableWidths = [75, 60, 85, 70, 65];

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      {/* Left skeleton list */}
      <div
        style={{
          width: 240,
          flexShrink: 0,
          background: 'var(--bg-card, #fff)',
          border: '1px solid var(--border-default, #E2E8F0)',
          borderRadius: 'var(--radius-md, 8px)',
          padding: 16,
        }}
      >
        {listWidths.map((w, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div
              className={`${styles.skeleton} ${styles.skeletonRow}`}
              style={{ width: `${w}%` }}
            />
          </div>
        ))}
      </div>

      {/* Right skeleton table */}
      <div
        style={{
          flex: 1,
          background: 'var(--bg-card, #fff)',
          border: '1px solid var(--border-default, #E2E8F0)',
          borderRadius: 'var(--radius-md, 8px)',
          overflow: 'hidden',
        }}
      >
        {tableWidths.map((w, i) => (
          <div key={i} className={styles.skeletonTableRow}>
            <div
              className={`${styles.skeleton} ${styles.skeletonTableCell}`}
              style={{ width: `${w}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// FE-01-03: 审计日志 Drawer
// ─────────────────────────────────────────────

interface AuditLogDrawerProps {
  open: boolean;
  onClose: () => void;
}

const LOG_TYPE_LABEL: Record<string, string> = {
  create: '新增',
  update: '修改',
  delete: '删除',
};

function AuditLogDrawer({ open, onClose }: AuditLogDrawerProps) {
  const [filterType, setFilterType] = useState<AuditLogParams['type']>('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const params: AuditLogParams = useMemo(
    () => ({
      type: filterType || undefined,
      from: filterFrom || undefined,
      to: filterTo || undefined,
    }),
    [filterType, filterFrom, filterTo],
  );

  const { data: logs = [], isLoading } = useAuditLogs(open ? params : undefined);

  if (!open) return null;

  function formatDateTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getDotClass(type: AuditLogEntry['type']) {
    if (type === 'create') return styles.timelineDotCreate;
    if (type === 'update') return styles.timelineDotUpdate;
    return styles.timelineDotDelete;
  }

  return (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>操作日志</h2>
          <button className={styles.drawerCloseBtn} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {/* Filters */}
        <div className={styles.drawerFilters}>
          <select
            className={styles.drawerFilterSelect}
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as AuditLogParams['type'])}
          >
            <option value="">全部操作</option>
            <option value="create">新增</option>
            <option value="update">修改</option>
            <option value="delete">删除</option>
          </select>
          <input
            type="date"
            className={styles.drawerFilterInput}
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            title="开始日期"
          />
          <input
            type="date"
            className={styles.drawerFilterInput}
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            title="结束日期"
          />
        </div>

        {/* Body */}
        <div className={styles.drawerBody}>
          {isLoading ? (
            <div className={styles.drawerLoading}>加载中...</div>
          ) : logs.length === 0 ? (
            <div className={styles.drawerEmpty}>
              <span style={{ fontSize: 32 }}>📋</span>
              <span>暂无操作日志</span>
            </div>
          ) : (
            <div className={styles.timeline}>
              {logs.map((log) => (
                <div key={log.id} className={styles.timelineItem}>
                  <div className={`${styles.timelineDot} ${getDotClass(log.type)}`} />
                  <div className={styles.timelineContent}>
                    <div className={styles.timelineHeader}>
                      <span className={styles.timelineAction}>
                        {LOG_TYPE_LABEL[log.type] ?? log.type}
                      </span>
                      <span className={styles.timelineTime}>
                        {formatDateTime(log.operatedAt)}
                      </span>
                    </div>
                    <div className={styles.timelineCategory}>
                      类目：<strong>{log.categoryName}</strong>
                    </div>
                    {log.diff && log.diff.length > 0 && (
                      <div className={styles.timelineDiff}>
                        {log.diff.map((d, i) => (
                          <div key={i} className={styles.timelineDiffItem}>
                            {d.field}：
                            <span className={styles.timelineDiffOld}>{d.oldValue}</span>
                            {' → '}
                            <span className={styles.timelineDiffNew}>{d.newValue}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className={styles.timelineOperator}>
                      操作人：{log.operatorName}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// FE-01-04: 四种删除 Modal
// ─────────────────────────────────────────────

interface DeleteModalV2Props {
  open: boolean;
  target: SkuCategoryFull | null;
  preview: DeletePreviewResult | null;
  previewLoading: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}

function DeleteModalV2({ open, target, preview, previewLoading, onClose, onConfirm, loading }: DeleteModalV2Props) {
  const [confirmInput, setConfirmInput] = useState('');

  useEffect(() => {
    if (open) setConfirmInput('');
  }, [open]);

  if (!target || !open) return null;

  // Loading preview state — show a waiting modal
  if (previewLoading) {
    return (
      <Modal
        open={open}
        title="查询关联数据中..."
        onClose={onClose}
        size="sm"
        hideFooter
      >
        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-secondary)' }}>
          正在获取关联数据，请稍候...
        </div>
      </Modal>
    );
  }

  if (!preview) return null;

  // Variant 1: System preset — button is disabled upstream, but guard here too
  if (preview.isSystem) {
    return (
      <Modal
        open={open}
        title="无法删除类目"
        onClose={onClose}
        onConfirm={onClose}
        confirmLabel="知道了"
        size="sm"
      >
        <div className={styles.deletePreview}>
          <div className={styles.deleteWarningIcon}>!</div>
          <div className={styles.deleteBody}>
            <p className={styles.deleteTitle}>
              系统预置类目 <strong>{target.name}</strong> 不可删除。
            </p>
            <p className={styles.deleteHint}>
              仅允许修改系统预置类目的名称和备注。
            </p>
          </div>
        </div>
      </Modal>
    );
  }

  // Variant 2: Custom, no associations — simple confirm
  if (preview.childCount === 0 && preview.skuCount === 0) {
    return (
      <Modal
        open={open}
        title="确认删除类目"
        onClose={onClose}
        onConfirm={onConfirm}
        confirmLabel="确认删除"
        confirmVariant="danger"
        confirmLoading={loading}
        size="sm"
      >
        <div className={styles.deletePreview}>
          <div className={styles.deleteWarningIcon}>!</div>
          <div className={styles.deleteBody}>
            <p className={styles.deleteTitle}>
              确定删除类目 <strong>{target.name}</strong>（{target.code}）？
            </p>
            <p className={styles.deleteHint}>
              该类目下无子类目及关联 SKU，删除后不可恢复。
            </p>
          </div>
        </div>
      </Modal>
    );
  }

  // Variant 3 & 4: Has associations — requires typing category name to confirm
  const nameMatched = confirmInput.trim() === target.name;

  return (
    <Modal
      open={open}
      title="⚠ 确认级联删除"
      onClose={onClose}
      confirmVariant="danger"
      confirmLoading={loading}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            variant="danger"
            disabled={!nameMatched}
            loading={loading}
            onClick={nameMatched ? onConfirm : undefined}
          >
            确认级联删除
          </Button>
        </>
      }
    >
      <div className={styles.dangerModalAlert}>
        <span className={styles.dangerModalAlertIcon}>⚠</span>
        <div className={styles.dangerModalAlertText}>
          此操作将同时删除该类目下的所有子类目，且关联 SKU 将变为未分类，
          <strong>不可恢复</strong>。
        </div>
      </div>

      {/* Stats */}
      <div className={styles.deleteStatsGrid}>
        <div className={styles.deleteStatCard}>
          <div className={styles.deleteStatValue}>{preview.childCount}</div>
          <div className={styles.deleteStatLabel}>子类目</div>
        </div>
        <div className={styles.deleteStatCard}>
          <div className={styles.deleteStatValue}>{preview.skuCount}</div>
          <div className={styles.deleteStatLabel}>关联 SKU</div>
        </div>
      </div>

      {/* Name confirm input */}
      <div className={styles.deleteConfirmInputWrap}>
        <label className={styles.deleteConfirmInputLabel}>
          请输入类目名称 <strong>{target.name}</strong> 以确认删除：
        </label>
        <input
          className={`${styles.deleteConfirmInput} ${nameMatched ? styles.deleteConfirmInputMatched : ''}`}
          value={confirmInput}
          onChange={(e) => setConfirmInput(e.target.value)}
          placeholder={`输入「${target.name}」`}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
      </div>
    </Modal>
  );
}

// ─── 新增/编辑 Modal ─────────────────────────────────────────

interface CategoryModalProps {
  open: boolean;
  initial?: SkuCategoryFull | null;
  level1List: SkuCategoryFull[];
  onClose: () => void;
}

const EMPTY_CREATE: CreateCategoryPayload = {
  level: 1,
  parentId: null,
  code: '',
  name: '',
  sortOrder: undefined,
};

function CategoryModal({ open, initial, level1List, onClose }: CategoryModalProps) {
  const isEdit = Boolean(initial);
  const createMut = useCreateCategory();
  const updateMut = useUpdateCategory();

  const [form, setForm] = useState<CreateCategoryPayload>({ ...EMPTY_CREATE });
  const [errors, setErrors] = useState<{ name?: string; code?: string }>({});

  useEffect(() => {
    if (open) {
      if (initial) {
        setForm({
          level: initial.level,
          parentId: initial.parentId ?? null,
          code: initial.code,
          name: initial.name,
          sortOrder: initial.sortOrder,
        });
      } else {
        setForm({ ...EMPTY_CREATE });
      }
      setErrors({});
    }
  }, [open, initial]);

  function set<K extends keyof CreateCategoryPayload>(key: K, value: CreateCategoryPayload[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === 'name' || key === 'code') {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  }

  function validate(): boolean {
    const errs: { name?: string; code?: string } = {};
    if (!form.name.trim()) errs.name = '名称为必填项';
    if (!isEdit && !form.code.trim()) errs.code = '编码为必填项';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleConfirm() {
    if (!validate()) return;
    if (isEdit && initial) {
      const payload: UpdateCategoryPayload = {
        name: form.name,
        sortOrder: form.sortOrder,
      };
      await updateMut.mutateAsync({ id: initial.id, payload });
    } else {
      await createMut.mutateAsync(form);
    }
    onClose();
  }

  const loading = createMut.isPending || updateMut.isPending;
  const showParentSelect = !isEdit && form.level === 2;

  return (
    <Modal
      open={open}
      title={isEdit ? '编辑类目' : '新增类目'}
      onClose={onClose}
      onConfirm={() => void handleConfirm()}
      confirmLabel={isEdit ? '保存' : '创建'}
      confirmLoading={loading}
      size="sm"
    >
      <div className={styles.formGroup}>
        <label className={styles.formLabel}>
          类目层级 <span className={styles.formRequired}>*</span>
        </label>
        {isEdit ? (
          <div className={styles.formReadonly}>
            {initial?.level === 1 ? '一级类目' : '二级类目'}
          </div>
        ) : (
          <select
            className={styles.formSelect}
            value={form.level}
            onChange={(e) => {
              const v = Number(e.target.value) as 1 | 2;
              set('level', v);
              if (v === 1) set('parentId', null);
            }}
          >
            <option value={1}>一级类目</option>
            <option value={2}>二级类目</option>
          </select>
        )}
      </div>

      {showParentSelect && (
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>所属一级类目</label>
          <select
            className={styles.formSelect}
            value={form.parentId ?? ''}
            onChange={(e) => set('parentId', e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— 请选择 —</option>
            {level1List.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}（{cat.code}）
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.formGroup}>
        <label className={styles.formLabel}>
          类目编码 {!isEdit && <span className={styles.formRequired}>*</span>}
        </label>
        {isEdit ? (
          <div className={styles.formReadonly}>
            <code>{initial?.code}</code>
          </div>
        ) : (
          <>
            <input
              className={`${styles.formInput} ${errors.code ? styles.formInputError : ''}`}
              value={form.code}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              placeholder="如：SOFA_2（大写英文+数字）"
            />
            {errors.code && <p className={styles.formError}>{errors.code}</p>}
          </>
        )}
      </div>

      <div className={styles.formGroup}>
        <label className={styles.formLabel}>
          类目名称 <span className={styles.formRequired}>*</span>
        </label>
        <input
          className={`${styles.formInput} ${errors.name ? styles.formInputError : ''}`}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="如：真皮沙发类"
          autoFocus
        />
        {errors.name && <p className={styles.formError}>{errors.name}</p>}
      </div>

      <div className={styles.formGroup}>
        <label className={styles.formLabel}>排序值</label>
        <input
          className={styles.formInput}
          type="number"
          min="0"
          value={form.sortOrder ?? ''}
          onChange={(e) => set('sortOrder', e.target.value ? Number(e.target.value) : undefined)}
          placeholder="数字越小越靠前，默认 0"
        />
      </div>
    </Modal>
  );
}

// ─── 主页面 ──────────────────────────────────────────────────

export default function CategoryConfigPage() {
  const { setPageTitle, showToast } = useAppStore();

  useEffect(() => {
    setPageTitle('类目管理');
  }, [setPageTitle]);

  const [keyword, setKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SkuCategoryFull | null>(null);

  // FE-01-04: Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<SkuCategoryFull | null>(null);
  const [deletePreview, setDeletePreview] = useState<DeletePreviewResult | null>(null);
  const [deletePreviewLoading, setDeletePreviewLoading] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  // FE-01-02: Drag-and-drop state
  const [orderedLevel1Ids, setOrderedLevel1Ids] = useState<number[]>([]);
  const [dragSourceId, setDragSourceId] = useState<number | null>(null);
  // dropInfo: { targetId, position } — position is 'before' or 'after'
  const [dropInfo, setDropInfo] = useState<{ targetId: number; position: 'before' | 'after' } | null>(null);

  // FE-01-03: Audit log drawer
  const [auditDrawerOpen, setAuditDrawerOpen] = useState(false);

  // FE-01-05: Inline edit state
  const [inlineEditId, setInlineEditId] = useState<number | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState('');
  const inlineEditInputRef = useRef<HTMLInputElement>(null);

  const { data: rawList = [], isLoading, isError } = useSkuCategoryList();
  const deleteMut = useDeleteCategory();
  const reorderMut = useReorderCategories();
  const updateMut = useUpdateCategory();

  // Sync orderedLevel1Ids when data arrives
  useEffect(() => {
    const ids = rawList.filter((c) => c.level === 1).map((c) => c.id);
    setOrderedLevel1Ids(ids);
  }, [rawList]);

  const level1List = useMemo(
    () => rawList.filter((c) => c.level === 1),
    [rawList],
  );

  // Build sorted level1 based on drag ordering
  const sortedLevel1 = useMemo(() => {
    if (orderedLevel1Ids.length === 0) return level1List;
    const map = new Map(level1List.map((c) => [c.id, c]));
    const result: SkuCategoryFull[] = [];
    for (const id of orderedLevel1Ids) {
      const cat = map.get(id);
      if (cat) result.push(cat);
    }
    for (const cat of level1List) {
      if (!orderedLevel1Ids.includes(cat.id)) result.push(cat);
    }
    return result;
  }, [level1List, orderedLevel1Ids]);

  const flatRows = useMemo((): FlatRow[] => {
    const rows: FlatRow[] = [];
    const kw = keyword.toLowerCase();
    for (const cat of sortedLevel1) {
      const nameMatch =
        cat.name.toLowerCase().includes(kw) || cat.code.toLowerCase().includes(kw);
      const children = cat.children ?? rawList.filter((c) => c.parentId === cat.id);
      const matchedChildren = children.filter(
        (c) =>
          !kw ||
          c.name.toLowerCase().includes(kw) ||
          c.code.toLowerCase().includes(kw),
      );
      if (!kw || nameMatch || matchedChildren.length > 0) {
        rows.push({ ...cat, _isChild: false });
        const childrenToShow = kw && !nameMatch ? matchedChildren : children;
        for (const child of childrenToShow) {
          rows.push({ ...child, _isChild: true, _parentName: cat.name });
        }
      }
    }
    return rows;
  }, [sortedLevel1, rawList, keyword]);

  function handleCreate() {
    setEditTarget(null);
    setModalOpen(true);
  }

  function handleEdit(row: FlatRow) {
    setEditTarget(row);
    setModalOpen(true);
  }

  // FE-01-04: Click delete — fetch preview first
  async function handleDeleteClick(row: FlatRow) {
    setDeleteTarget(row);
    setDeleteModalOpen(true);
    setDeletePreview(null);
    setDeletePreviewLoading(true);
    try {
      const preview = await fetchDeletePreview(row.id);
      setDeletePreview(preview);
    } catch {
      showToast({ type: 'error', message: '获取关联数据失败，请刷新后重试' });
      setDeleteModalOpen(false);
    } finally {
      setDeletePreviewLoading(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync(deleteTarget.id);
      showToast({ type: 'success', message: `已删除类目：${deleteTarget.name}` });
      setDeleteModalOpen(false);
      setDeleteTarget(null);
      setDeletePreview(null);
    } catch {
      showToast({ type: 'error', message: '删除失败，请稍后重试' });
    }
  }

  function closeDeleteModal() {
    setDeleteModalOpen(false);
    setDeleteTarget(null);
    setDeletePreview(null);
    setDeletePreviewLoading(false);
  }

  // ─── FE-01-02: Drag handlers ───────────────────────────────
  const handleDragStart = useCallback((e: React.DragEvent, id: number) => {
    setDragSourceId(id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOverCell = useCallback((e: React.DragEvent, id: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position: 'before' | 'after' = e.clientY < midY ? 'before' : 'after';
    setDropInfo((prev) => {
      if (prev?.targetId === id && prev.position === position) return prev;
      return { targetId: id, position };
    });
  }, []);

  const handleDropCell = useCallback(
    async (e: React.DragEvent, targetId: number) => {
      e.preventDefault();
      setDropInfo(null);
      if (!dragSourceId || dragSourceId === targetId) {
        setDragSourceId(null);
        return;
      }

      const prev = [...orderedLevel1Ids];
      const newOrder = [...orderedLevel1Ids];
      const srcIndex = newOrder.indexOf(dragSourceId);
      const tgtIndex = newOrder.indexOf(targetId);
      if (srcIndex === -1 || tgtIndex === -1) {
        setDragSourceId(null);
        return;
      }

      // Remove source from its position
      newOrder.splice(srcIndex, 1);
      // Find new target index after removal
      const newTgtIndex = newOrder.indexOf(targetId);
      const insertAt = dropInfo?.position === 'after' ? newTgtIndex + 1 : newTgtIndex;
      newOrder.splice(insertAt, 0, dragSourceId);

      setOrderedLevel1Ids(newOrder);
      setDragSourceId(null);

      try {
        await reorderMut.mutateAsync({ ids: newOrder });
      } catch {
        setOrderedLevel1Ids(prev);
        showToast({ type: 'warning', message: '排序保存失败，已恢复原顺序' });
      }
    },
    [dragSourceId, dropInfo, orderedLevel1Ids, reorderMut, showToast],
  );

  const handleDragEnd = useCallback(() => {
    setDragSourceId(null);
    setDropInfo(null);
  }, []);

  // ─── FE-01-05: Inline edit handlers ──────────────────────
  function startInlineEdit(row: FlatRow) {
    setInlineEditId(row.id);
    setInlineEditValue(row.name);
    setTimeout(() => inlineEditInputRef.current?.focus(), 0);
  }

  function cancelInlineEdit() {
    setInlineEditId(null);
    setInlineEditValue('');
  }

  async function saveInlineEdit(row: FlatRow) {
    const trimmed = inlineEditValue.trim();
    if (!trimmed || trimmed === row.name) {
      cancelInlineEdit();
      return;
    }
    try {
      const payload: UpdateCategoryPayload = { name: trimmed };
      await updateMut.mutateAsync({ id: row.id, payload });
      showToast({ type: 'success', message: '修改成功' });
    } catch {
      showToast({ type: 'error', message: '保存失败，请重试' });
    }
    cancelInlineEdit();
  }

  function handleInlineKeyDown(e: React.KeyboardEvent, row: FlatRow) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void saveInlineEdit(row);
    } else if (e.key === 'Escape') {
      cancelInlineEdit();
    }
  }

  // ─── Table columns ─────────────────────────────────────────
  const columns: Column<FlatRow>[] = [
    {
      key: 'name',
      title: '类目名称',
      render: (_, row) => {
        const isEditing = inlineEditId === row.id;

        // FE-01-05: Inline edit for level-2 rows
        if (row._isChild && isEditing) {
          return (
            <div className={styles.inlineEditCell}>
              <span className={styles.childIndent} aria-hidden="true" />
              <input
                ref={inlineEditInputRef}
                className={styles.inlineEditInput}
                value={inlineEditValue}
                onChange={(e) => setInlineEditValue(e.target.value)}
                onKeyDown={(e) => handleInlineKeyDown(e, row)}
              />
              <div className={styles.inlineEditActions}>
                <button
                  className={styles.inlineSaveBtn}
                  onClick={() => void saveInlineEdit(row)}
                  title="保存（Enter）"
                >
                  ✓
                </button>
                <button
                  className={styles.inlineCancelBtn}
                  onClick={cancelInlineEdit}
                  title="取消（Esc）"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        }

        // FE-01-02: Level-1 rows get drag handle + drop indicator
        if (!row._isChild) {
          const isBeingDragged = dragSourceId === row.id;
          const isDropTarget = dropInfo?.targetId === row.id;

          return (
            <div
              className={[
                styles.parentNameCell,
                isBeingDragged ? styles.draggingRow : '',
                isDropTarget && dropInfo?.position === 'before' ? styles.dropIndicator : '',
                isDropTarget && dropInfo?.position === 'after' ? styles.dropIndicatorBottom : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onDragOver={(e) => handleDragOverCell(e, row.id)}
              onDrop={(e) => void handleDropCell(e, row.id)}
            >
              <span
                className={styles.dragHandle}
                draggable
                onDragStart={(e) => handleDragStart(e, row.id)}
                onDragEnd={handleDragEnd}
                title="拖拽排序"
                aria-label="拖拽排序"
              >
                ⠿
              </span>
              <span className={styles.parentName}>{row.name}</span>
              {row.isSystem && <span className={styles.systemBadge}>系统</span>}
            </div>
          );
        }

        // Level-2 normal display
        return (
          <div className={styles.childNameCell}>
            <span className={styles.childIndent} aria-hidden="true" />
            <span className={styles.childName}>{row.name}</span>
            {row.isSystem && <span className={styles.systemBadge}>系统</span>}
          </div>
        );
      },
    },
    {
      key: 'code',
      title: '编码',
      width: 160,
      render: (_, row) => (
        <code
          className={`${styles.codeText} ${row._isChild ? styles.codeChild : styles.codeParent}`}
        >
          {row.code}
        </code>
      ),
    },
    {
      key: 'level',
      title: '层级',
      width: 80,
      render: (_, row) => (
        <span
          className={`${styles.levelBadge} ${row.level === 1 ? styles.levelBadge1 : styles.levelBadge2}`}
        >
          {row.level === 1 ? '一级' : '二级'}
        </span>
      ),
    },
    {
      key: 'sortOrder',
      title: '排序',
      width: 70,
      align: 'right',
      render: (v) => (
        <span style={{ color: 'var(--text-secondary, #64748B)', fontSize: 13 }}>
          {v as number}
        </span>
      ),
    },
    {
      key: 'isActive',
      title: '状态',
      width: 80,
      render: (v) => (
        <span
          className={`${styles.statusBadge} ${v ? styles.statusActive : styles.statusInactive}`}
        >
          {v ? '启用' : '停用'}
        </span>
      ),
    },
    {
      key: 'id',
      title: '操作',
      width: 160,
      render: (_, row) => {
        // Hide action column when in inline edit mode
        if (inlineEditId === row.id) return null;

        return (
          <div className={styles.actions}>
            {/* FE-01-05: Inline edit for level-2, modal edit for level-1 */}
            <button
              className={`${styles.actionBtn} ${styles.actionBtnEdit}`}
              onClick={() => {
                if (row._isChild) {
                  startInlineEdit(row);
                } else {
                  handleEdit(row);
                }
              }}
            >
              编辑
            </button>

            {/* FE-01-04: System preset delete is disabled with tooltip */}
            {row.isSystem ? (
              <span className={styles.tooltipWrap}>
                <button
                  className={`${styles.actionBtn} ${styles.actionBtnDeleteDisabled}`}
                  disabled
                  aria-disabled="true"
                >
                  删除
                </button>
                <span className={styles.tooltip}>系统预置类目不可删除</span>
              </span>
            ) : (
              <button
                className={`${styles.actionBtn} ${styles.actionBtnDelete}`}
                onClick={() => void handleDeleteClick(row)}
              >
                删除
              </button>
            )}
          </div>
        );
      },
    },
  ];

  // Row class for inline editing (applied via CSS by checking editingRow on name cell wrapper)
  // The Table component doesn't support rowClassName, so we use inline style within the cell render.

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>类目管理</h1>
          <p className={styles.pageSubtitle}>
            管理 SKU 的一级/二级分类体系，支持自定义类目
          </p>
        </div>
        {/* FE-01-03: Audit log + create buttons */}
        <div className={styles.pageHeaderActions}>
          <button
            className={styles.auditLogBtn}
            onClick={() => setAuditDrawerOpen(true)}
          >
            📋 操作日志
          </button>
          <Button variant="primary" size="sm" onClick={handleCreate}>
            + 新增类目
          </Button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className={styles.filterBar}>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}>&#x1F50D;</span>
          <input
            className={styles.searchInput}
            placeholder="搜索类目名称或编码..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <span className={styles.filterTip}>
          共 {level1List.length} 个一级类目，
          {rawList.filter((c) => c.level === 2).length} 个二级类目
        </span>
      </div>

      {/* FE-01-01: Skeleton loading OR table */}
      {isLoading ? (
        <SkeletonLoading />
      ) : (
        <div className={styles.tableCard}>
          <Table<FlatRow>
            columns={columns}
            dataSource={flatRows}
            rowKey={(r) => r.id}
            loading={false}
            error={isError ? '类目列表加载失败，请刷新重试' : null}
            emptyText="暂无类目数据"
          />
        </div>
      )}

      {/* 新增/编辑 Modal */}
      <CategoryModal
        open={modalOpen}
        initial={editTarget}
        level1List={level1List}
        onClose={() => setModalOpen(false)}
      />

      {/* FE-01-04: 删除 Modal（四种变体） */}
      <DeleteModalV2
        open={deleteModalOpen}
        target={deleteTarget}
        preview={deletePreview}
        previewLoading={deletePreviewLoading}
        onClose={closeDeleteModal}
        onConfirm={() => void handleDeleteConfirm()}
        loading={deleteMut.isPending}
      />

      {/* FE-01-03: 操作日志 Drawer */}
      <AuditLogDrawer
        open={auditDrawerOpen}
        onClose={() => setAuditDrawerOpen(false)}
      />
    </div>
  );
}
