/**
 * [artifact:前端代码] — 类目管理页 R-01（双面板重构）
 * 功能：左侧一级类目导航面板 / 右侧二级子类目表格
 * 保留：FE-01-01 骨架屏 / FE-01-02 拖拽排序 / FE-01-03 操作日志 Drawer
 *       FE-01-04 四种删除 Modal / FE-01-05 行内编辑 / FE-01-06 PATCH
 */

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
import styles from './CategoryConfigPage.module.css';

// ─────────────────────────────────────────────
// FE-01-01: 骨架屏（双面板结构）
// ─────────────────────────────────────────────

function SkeletonLoading() {
  return (
    <div className={styles.skeletonLayout}>
      {/* 左侧骨架 */}
      <div className={styles.skeletonCat1}>
        <div className={styles.skeletonCat1Header}>
          <div className={`${styles.skeleton} ${styles.skeletonRow}`} style={{ width: 70 }} />
          <div className={`${styles.skeleton}`} style={{ width: 52, height: 28, borderRadius: 6 }} />
        </div>
        <div className={styles.skeletonCat1Search}>
          <div className={`${styles.skeleton}`} style={{ height: 34, borderRadius: 8 }} />
        </div>
        {[80, 65, 90, 70, 60].map((w, i) => (
          <div key={i} className={styles.skeletonCat1Item}>
            <div className={`${styles.skeleton}`} style={{ width: 12, height: 12, borderRadius: '50%', flexShrink: 0 }} />
            <div className={`${styles.skeleton} ${styles.skeletonRow}`} style={{ flex: 1 }} />
            <div className={`${styles.skeleton}`} style={{ width: `${w * 0.4}px`, height: 18, borderRadius: 10 }} />
          </div>
        ))}
      </div>

      {/* 右侧骨架 */}
      <div className={styles.skeletonCat2}>
        <div className={styles.skeletonCat2Header}>
          <div className={`${styles.skeleton} ${styles.skeletonRow}`} style={{ width: 120 }} />
          <div className={`${styles.skeleton}`} style={{ width: 80, height: 28, borderRadius: 6 }} />
        </div>
        <div className={styles.skeletonCat2TH}>
          {[40, 60, 56, 44, 52].map((w, i) => (
            <div key={i} className={`${styles.skeleton}`} style={{ width: w, height: 12, borderRadius: 4 }} />
          ))}
        </div>
        {[75, 60, 85, 70, 65].map((w, i) => (
          <div key={i} className={styles.skeletonCat2Row}>
            <div className={`${styles.skeleton}`} style={{ width: 12, height: 12, borderRadius: '50%', flexShrink: 0 }} />
            <div className={`${styles.skeleton} ${styles.skeletonRow}`} style={{ width: `${w * 1.4}px`, maxWidth: 160 }} />
            <div className={`${styles.skeleton} ${styles.skeletonRow}`} style={{ width: 80 }} />
            <div className={`${styles.skeleton} ${styles.skeletonRow}`} style={{ width: 50 }} />
            <div className={`${styles.skeleton} ${styles.skeletonRow}`} style={{ width: 72 }} />
            <div className={`${styles.skeleton}`} style={{ width: 64, height: 26, borderRadius: 6, marginLeft: 'auto' }} />
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

  // Variant 1: System preset
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

  // Variant 2: Custom, no associations
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

  // Variant 3 & 4: Has associations — requires typing category name
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
  /** 预填层级（新增一级或二级时使用） */
  defaultLevel?: 1 | 2;
  /** 预填父类目（新增二级子类目时使用） */
  defaultParentId?: number | null;
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

function CategoryModal({ open, initial, defaultLevel, defaultParentId, level1List, onClose }: CategoryModalProps) {
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
        setForm({
          ...EMPTY_CREATE,
          level: defaultLevel ?? 1,
          parentId: defaultParentId ?? null,
        });
      }
      setErrors({});
    }
  }, [open, initial, defaultLevel, defaultParentId]);

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
          // eslint-disable-next-line jsx-a11y/no-autofocus
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

// ─── 格式化日期 ──────────────────────────────────────────────

function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ─── 主页面 ──────────────────────────────────────────────────

export default function CategoryConfigPage() {
  const { setPageTitle, showToast } = useAppStore();
  // useNavigate may not always be available in tests, fallback gracefully
  let navigate: ReturnType<typeof useNavigate> | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    navigate = useNavigate();
  } catch {
    navigate = null;
  }

  useEffect(() => {
    setPageTitle('SKU 类目管理');
  }, [setPageTitle]);

  // ─── 选中状态（双面板核心） ──────────────────
  const [selectedCatId, setSelectedCatId] = useState<number | null>(null);

  // ─── 左侧搜索关键词 ──────────────────────────
  const [cat1Keyword, setCat1Keyword] = useState('');

  // ─── Modal 状态 ──────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SkuCategoryFull | null>(null);
  const [modalDefaultLevel, setModalDefaultLevel] = useState<1 | 2>(1);
  const [modalDefaultParentId, setModalDefaultParentId] = useState<number | null>(null);

  // FE-01-04: Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<SkuCategoryFull | null>(null);
  const [deletePreview, setDeletePreview] = useState<DeletePreviewResult | null>(null);
  const [deletePreviewLoading, setDeletePreviewLoading] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  // FE-01-02: Drag-and-drop state
  const [orderedLevel1Ids, setOrderedLevel1Ids] = useState<number[]>([]);
  const [dragSourceId, setDragSourceId] = useState<number | null>(null);
  const [dropInfo, setDropInfo] = useState<{ targetId: number; position: 'before' | 'after' } | null>(null);

  // FE-01-03: Audit log drawer
  const [auditDrawerOpen, setAuditDrawerOpen] = useState(false);

  // FE-01-05: Inline edit state (right panel table)
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

  // Auto-select first category when data loads
  useEffect(() => {
    if (!isLoading && rawList.length > 0 && selectedCatId === null) {
      const first = rawList.find((c) => c.level === 1);
      if (first) setSelectedCatId(first.id);
    }
  }, [isLoading, rawList, selectedCatId]);

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

  // Left panel: filter by keyword
  const filteredLevel1 = useMemo(() => {
    if (!cat1Keyword.trim()) return sortedLevel1;
    const kw = cat1Keyword.toLowerCase();
    return sortedLevel1.filter(
      (c) => c.name.toLowerCase().includes(kw) || c.code.toLowerCase().includes(kw),
    );
  }, [sortedLevel1, cat1Keyword]);

  // Right panel: children of selected category
  const selectedCat1 = useMemo(
    () => level1List.find((c) => c.id === selectedCatId) ?? null,
    [level1List, selectedCatId],
  );

  const level2Rows = useMemo(() => {
    if (selectedCatId === null) return [];
    return rawList.filter((c) => c.level === 2 && c.parentId === selectedCatId);
  }, [rawList, selectedCatId]);

  // ─── Count children of a level-1 category ───
  function childCount(catId: number): number {
    return rawList.filter((c) => c.level === 2 && c.parentId === catId).length;
  }

  // ─── Modal openers ────────────────────────────
  function openCreateCat1() {
    setEditTarget(null);
    setModalDefaultLevel(1);
    setModalDefaultParentId(null);
    setModalOpen(true);
  }

  function openCreateCat2() {
    setEditTarget(null);
    setModalDefaultLevel(2);
    setModalDefaultParentId(selectedCatId);
    setModalOpen(true);
  }

  function openEdit(cat: SkuCategoryFull) {
    setEditTarget(cat);
    setModalDefaultLevel(cat.level as 1 | 2);
    setModalDefaultParentId(cat.parentId ?? null);
    setModalOpen(true);
  }

  // FE-01-04: Click delete — fetch preview first
  async function handleDeleteClick(cat: SkuCategoryFull) {
    setDeleteTarget(cat);
    setDeleteModalOpen(true);
    setDeletePreview(null);
    setDeletePreviewLoading(true);
    try {
      const preview = await fetchDeletePreview(cat.id);
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
      // If deleted category was selected, clear selection
      if (deleteTarget.id === selectedCatId) setSelectedCatId(null);
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

  // ─── FE-01-02: Drag handlers (left panel) ────
  const handleDragStart = useCallback((e: React.DragEvent, id: number) => {
    setDragSourceId(id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOverItem = useCallback((e: React.DragEvent, id: number) => {
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

  const handleDropItem = useCallback(
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

      newOrder.splice(srcIndex, 1);
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

  // ─── FE-01-05: Inline edit handlers (right panel) ──
  function startInlineEdit(row: SkuCategoryFull) {
    setInlineEditId(row.id);
    setInlineEditValue(row.name);
    setTimeout(() => inlineEditInputRef.current?.focus(), 0);
  }

  function cancelInlineEdit() {
    setInlineEditId(null);
    setInlineEditValue('');
  }

  async function saveInlineEdit(row: SkuCategoryFull) {
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

  function handleInlineKeyDown(e: React.KeyboardEvent, row: SkuCategoryFull) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void saveInlineEdit(row);
    } else if (e.key === 'Escape') {
      cancelInlineEdit();
    }
  }

  // ─── Return ───────────────────────────────────

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className={styles.pageHeader}>
        <div>
          <button
            className={styles.backBtn}
            onClick={() => navigate ? navigate(-1) : window.history.back()}
            aria-label="返回 SKU 列表"
            style={{ marginBottom: 8 }}
          >
            ← 返回 SKU 列表
          </button>
          <h1 className={styles.pageTitle}>SKU 类目管理</h1>
          <p className={styles.pageSubtitle}>
            管理 SKU 的一级/二级分类体系，支持自定义类目
          </p>
        </div>
        <div className={styles.pageHeaderActions}>
          <button
            className={styles.auditLogBtn}
            onClick={() => setAuditDrawerOpen(true)}
          >
            📋 操作日志
          </button>
        </div>
      </div>

      {/* FE-01-01: 骨架屏 or 双面板主体 */}
      {isLoading ? (
        <SkeletonLoading />
      ) : isError ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-error-500)' }}>
          类目列表加载失败，请刷新重试
        </div>
      ) : (
        <div className={styles.categoryLayout}>

          {/* ── 左侧：一级类目面板 ── */}
          <div className={styles.cat1Panel}>
            <div className={styles.cat1Header}>
              <span className={styles.cat1Title}>一级类目</span>
              <Button variant="primary" size="sm" onClick={openCreateCat1}>
                + 新增
              </Button>
            </div>

            <div className={styles.cat1SearchWrap}>
              <input
                className={styles.cat1Search}
                type="search"
                placeholder="搜索类目名称..."
                value={cat1Keyword}
                onChange={(e) => setCat1Keyword(e.target.value)}
                aria-label="搜索一级类目"
              />
            </div>

            <ul className={styles.cat1List} role="listbox" aria-label="一级类目列表">
              {filteredLevel1.map((cat) => {
                const isActive = selectedCatId === cat.id;
                const isDragging = dragSourceId === cat.id;
                const isDropTarget = dropInfo?.targetId === cat.id;
                const childrenCount = childCount(cat.id);

                const itemClass = [
                  styles.cat1Item,
                  isActive ? styles.cat1ItemActive : '',
                  isDragging ? styles.cat1ItemDragging : '',
                  isDropTarget && dropInfo?.position === 'before' ? styles.cat1ItemDropBefore : '',
                  isDropTarget && dropInfo?.position === 'after' ? styles.cat1ItemDropAfter : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                return (
                  <li
                    key={cat.id}
                    className={itemClass}
                    role="option"
                    aria-selected={isActive}
                    onClick={() => setSelectedCatId(cat.id)}
                    onDragOver={(e) => handleDragOverItem(e, cat.id)}
                    onDrop={(e) => void handleDropItem(e, cat.id)}
                  >
                    {/* 拖拽手柄 */}
                    <span
                      className={styles.cat1DragHandle}
                      draggable
                      onDragStart={(e) => handleDragStart(e, cat.id)}
                      onDragEnd={handleDragEnd}
                      onClick={(e) => e.stopPropagation()}
                      title="拖拽排序"
                      aria-label="拖拽排序"
                      aria-hidden="true"
                    >
                      ⠿
                    </span>

                    {/* 名称 */}
                    <span className={styles.cat1ItemName} title={cat.name}>
                      {cat.name}
                    </span>

                    {/* 徽章（hover 时隐藏，交由 CSS 控制） */}
                    <div className={styles.cat1ItemMeta}>
                      {cat.isSystem ? (
                        <span className={styles.badgeSystem}>预置</span>
                      ) : (
                        <span className={styles.badgeCustom}>自定义</span>
                      )}
                      <span className={styles.badgeCount}>{childrenCount} 子</span>
                    </div>

                    {/* 操作按钮（hover/active 时显示） */}
                    <div className={styles.cat1ItemActions}>
                      <button
                        className={styles.cat1IconBtn}
                        title="编辑"
                        aria-label={`编辑 ${cat.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(cat);
                        }}
                      >
                        ✏️
                      </button>

                      {cat.isSystem ? (
                        <span className={styles.tooltipWrap}>
                          <button
                            className={`${styles.cat1IconBtn} ${styles.cat1IconBtnDisabled}`}
                            disabled
                            aria-disabled="true"
                            aria-label="系统预置类目不可删除"
                            title="系统预置类目不可删除"
                          >
                            🗑
                          </button>
                          <span className={styles.tooltip}>系统预置类目不可删除</span>
                        </span>
                      ) : (
                        <button
                          className={`${styles.cat1IconBtn} ${styles.cat1IconBtnDelete}`}
                          title={`删除 ${cat.name}`}
                          aria-label={`删除 ${cat.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteClick(cat);
                          }}
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}

              {filteredLevel1.length === 0 && (
                <li style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
                  {cat1Keyword ? '无匹配类目' : '暂无一级类目'}
                </li>
              )}
            </ul>

            {/* 底部快捷新增按钮 */}
            <div className={styles.cat1AddWrap}>
              <button className={styles.cat1AddBtn} onClick={openCreateCat1}>
                + 新增一级类目
              </button>
            </div>
          </div>

          {/* ── 右侧：二级类目面板 ── */}
          <div className={styles.cat2Panel}>
            {selectedCat1 === null ? (
              /* 未选中占位 */
              <div className={styles.cat2Placeholder}>
                <div className={styles.cat2PlaceholderIcon}>🗂</div>
                <div className={styles.cat2PlaceholderTitle}>请选择一级类目</div>
                <div className={styles.cat2PlaceholderDesc}>
                  从左侧列表选择一个一级类目，查看并管理其下的子类目
                </div>
              </div>
            ) : (
              <>
                {/* 右侧面板头 */}
                <div className={styles.cat2Header}>
                  <div className={styles.cat2TitleGroup}>
                    <span className={styles.cat2TitleText}>{selectedCat1.name}</span>
                    {selectedCat1.isSystem ? (
                      <span className={styles.badgeSystem}>预置</span>
                    ) : (
                      <span className={styles.badgeCustom}>自定义</span>
                    )}
                    <span className={styles.cat2Subtitle}>
                      共 {level2Rows.length} 个子类目
                    </span>
                  </div>
                  <Button variant="primary" size="sm" onClick={openCreateCat2}>
                    + 新增子类目
                  </Button>
                </div>

                {/* 二级类目表格 or 空状态 */}
                {level2Rows.length === 0 ? (
                  <div className={styles.cat2EmptyWrap}>
                    <div className={styles.cat2EmptyIcon}>📂</div>
                    <div className={styles.cat2EmptyTitle}>暂无子类目</div>
                    <div className={styles.cat2EmptyDesc}>
                      当前一级类目下尚未创建子类目
                    </div>
                    <Button variant="primary" size="sm" onClick={openCreateCat2}>
                      + 新增子类目
                    </Button>
                  </div>
                ) : (
                  <div className={styles.cat2TableWrap}>
                    <table className={styles.cat2Table} aria-label="二级类目列表">
                      <thead>
                        <tr>
                          <th className={styles.cat2ThDrag} aria-hidden="true" />
                          <th>类目名称</th>
                          <th>类目编码</th>
                          <th>关联 SKU 数</th>
                          <th>创建时间</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {level2Rows.map((row) => {
                          const isEditing = inlineEditId === row.id;

                          return (
                            <tr key={row.id} style={isEditing ? { background: 'var(--color-primary-50)' } : undefined}>
                              {/* 拖拽手柄（二级类目排序预留） */}
                              <td>
                                <span
                                  style={{
                                    color: 'var(--color-gray-300)',
                                    cursor: 'grab',
                                    fontSize: 14,
                                    userSelect: 'none',
                                  }}
                                  aria-hidden="true"
                                  title="拖拽排序"
                                >
                                  ⠿
                                </span>
                              </td>

                              {/* 类目名称 */}
                              <td>
                                <div className={styles.cat2NameCell}>
                                  {row.name}
                                  {row.isSystem && (
                                    <span className={styles.badgeSystem}>系统</span>
                                  )}
                                </div>
                              </td>

                              {/* 类目编码 */}
                              <td>
                                <code className={styles.cat2CodeText}>{row.code}</code>
                              </td>

                              {/* 关联 SKU 数（API 扩展字段，如无则显示"—"） */}
                              <td>
                                {(() => {
                                  const r = row as unknown as Record<string, unknown>;
                                  const count = r['skuCount'];
                                  return (
                                    <span className={styles.cat2SkuCount}>
                                      {count !== undefined ? (
                                        <>
                                          <strong>{count as number}</strong>
                                          <span className={styles.cat2SkuCountUnit}>件</span>
                                        </>
                                      ) : '—'}
                                    </span>
                                  );
                                })()}
                              </td>

                              {/* 创建时间 */}
                              <td>
                                <span className={styles.cat2DateText}>
                                  {formatDate((row as unknown as Record<string, unknown>)['createdAt'] as string | undefined)}
                                </span>
                              </td>

                              {/* 操作列 */}
                              <td>
                                {isEditing ? (
                                  /* FE-01-05: 内联编辑状态 */
                                  <div className={styles.cat2InlineEditCell}>
                                    <input
                                      ref={inlineEditInputRef}
                                      className={styles.cat2InlineInput}
                                      value={inlineEditValue}
                                      onChange={(e) => setInlineEditValue(e.target.value)}
                                      onKeyDown={(e) => handleInlineKeyDown(e, row)}
                                      aria-label={`编辑类目名称：${row.name}`}
                                    />
                                    <button
                                      className={`${styles.actionBtn} ${styles.actionBtnEdit}`}
                                      style={{ background: 'var(--color-primary-600)', color: '#fff', border: 'none' }}
                                      onClick={() => void saveInlineEdit(row)}
                                      title="保存（Enter）"
                                    >
                                      保存
                                    </button>
                                    <button
                                      className={`${styles.actionBtn}`}
                                      style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
                                      onClick={cancelInlineEdit}
                                      title="取消（Esc）"
                                    >
                                      取消
                                    </button>
                                  </div>
                                ) : (
                                  <div className={styles.cat2RowActions}>
                                    {/* 编辑：二级类目用内联编辑 */}
                                    <button
                                      className={`${styles.actionBtn} ${styles.actionBtnEdit}`}
                                      onClick={() => startInlineEdit(row)}
                                      aria-label={`编辑 ${row.name}`}
                                    >
                                      编辑
                                    </button>

                                    {/* 删除 */}
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
                                        aria-label={`删除 ${row.name}`}
                                      >
                                        删除
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>

        </div>
      )}

      {/* 新增/编辑 Modal */}
      <CategoryModal
        open={modalOpen}
        initial={editTarget}
        defaultLevel={modalDefaultLevel}
        defaultParentId={modalDefaultParentId}
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
