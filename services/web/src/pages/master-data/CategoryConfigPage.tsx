/**
 * [artifact:前端代码] — 类目管理页 R-01
 * 功能：树形列表（扁平展示一级/二级）/ 新增 Modal / 编辑 Modal / 删除确认 Modal / 搜索筛选
 */

import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  useSkuCategoryList,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
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
}

// ─── 新增/编辑 Modal ─────────────────────────────────────────

interface CategoryModalProps {
  open: boolean;
  initial?: SkuCategoryFull | null;
  /** 当前已有的一级类目列表（用于选择父级） */
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

  // 每次 open 时重置表单
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

// ─── 删除确认 Modal ──────────────────────────────────────────

interface DeleteModalProps {
  open: boolean;
  target: SkuCategoryFull | null;
  childCount: number;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}

function DeleteModal({ open, target, childCount, onClose, onConfirm, loading }: DeleteModalProps) {
  if (!target) return null;
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
            即将删除类目 <strong>{target.name}</strong>（{target.code}）
          </p>
          <div className={styles.deleteImpact}>
            <div className={styles.deleteImpactItem}>
              <span className={styles.deleteImpactLabel}>类目层级</span>
              <span className={styles.deleteImpactValue}>
                {target.level === 1 ? '一级类目' : '二级类目'}
              </span>
            </div>
            {target.level === 1 && (
              <div className={styles.deleteImpactItem}>
                <span className={styles.deleteImpactLabel}>包含子类目</span>
                <span className={`${styles.deleteImpactValue} ${childCount > 0 ? styles.deleteImpactWarn : ''}`}>
                  {childCount} 个
                </span>
              </div>
            )}
            {target.isSystem && (
              <div className={styles.deleteImpactItem}>
                <span className={styles.deleteImpactLabel}>类型</span>
                <span className={`${styles.deleteImpactValue} ${styles.deleteImpactWarn}`}>
                  系统预置（不建议删除）
                </span>
              </div>
            )}
          </div>
          {childCount > 0 && (
            <p className={styles.deleteHint}>
              删除后，该类目下的 {childCount} 个子类目将同步被软删除，且相关 SKU 的类目关联将失效。
            </p>
          )}
          {childCount === 0 && (
            <p className={styles.deleteHint}>此操作不可恢复，请谨慎确认。</p>
          )}
        </div>
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
  const [deleteTarget, setDeleteTarget] = useState<SkuCategoryFull | null>(null);

  const { data: rawList = [], isLoading, isError } = useSkuCategoryList();
  const deleteMut = useDeleteCategory();

  // 一级类目列表（用于新增二级时选父）
  const level1List = useMemo(
    () => rawList.filter((c) => c.level === 1),
    [rawList],
  );

  // 展平树形为扁平行（一级行 + 缩进二级子行）
  const flatRows = useMemo((): FlatRow[] => {
    const rows: FlatRow[] = [];
    const kw = keyword.toLowerCase();
    for (const cat of rawList) {
      if (cat.level !== 1) continue;
      const nameMatch = cat.name.toLowerCase().includes(kw) || cat.code.toLowerCase().includes(kw);
      const children = cat.children ?? rawList.filter((c) => c.parentId === cat.id);
      const matchedChildren = children.filter(
        (c) => !kw || c.name.toLowerCase().includes(kw) || c.code.toLowerCase().includes(kw),
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
  }, [rawList, keyword]);

  function getChildCount(cat: SkuCategoryFull): number {
    return (cat.children ?? rawList.filter((c) => c.parentId === cat.id)).length;
  }

  function handleCreate() {
    setEditTarget(null);
    setModalOpen(true);
  }

  function handleEdit(row: FlatRow) {
    setEditTarget(row);
    setModalOpen(true);
  }

  function handleDeleteClick(row: FlatRow) {
    setDeleteTarget(row);
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync(deleteTarget.id);
      showToast({ type: 'success', message: `已删除类目：${deleteTarget.name}` });
      setDeleteTarget(null);
    } catch {
      showToast({ type: 'error', message: '删除失败，请稍后重试' });
    }
  }

  const columns: Column<FlatRow>[] = [
    {
      key: 'name',
      title: '类目名称',
      render: (_, row) => (
        <div className={row._isChild ? styles.childNameCell : styles.parentNameCell}>
          {row._isChild && <span className={styles.childIndent} aria-hidden="true" />}
          <span className={row._isChild ? styles.childName : styles.parentName}>
            {row.name}
          </span>
          {row.isSystem && (
            <span className={styles.systemBadge}>系统</span>
          )}
        </div>
      ),
    },
    {
      key: 'code',
      title: '编码',
      width: 160,
      render: (_, row) => (
        <code className={`${styles.codeText} ${row._isChild ? styles.codeChild : styles.codeParent}`}>
          {row.code}
        </code>
      ),
    },
    {
      key: 'level',
      title: '层级',
      width: 80,
      render: (_, row) => (
        <span className={`${styles.levelBadge} ${row.level === 1 ? styles.levelBadge1 : styles.levelBadge2}`}>
          {row.level === 1 ? '一级' : '二级'}
        </span>
      ),
    },
    {
      key: 'sortOrder',
      title: '排序',
      width: 70,
      align: 'right',
      render: (v) => <span style={{ color: 'var(--text-secondary, #64748B)', fontSize: 13 }}>{v as number}</span>,
    },
    {
      key: 'isActive',
      title: '状态',
      width: 80,
      render: (v) => (
        <span className={`${styles.statusBadge} ${v ? styles.statusActive : styles.statusInactive}`}>
          {v ? '启用' : '停用'}
        </span>
      ),
    },
    {
      key: 'id',
      title: '操作',
      width: 130,
      render: (_, row) => (
        <div className={styles.actions}>
          <button
            className={`${styles.actionBtn} ${styles.actionBtnEdit}`}
            onClick={() => handleEdit(row)}
          >
            编辑
          </button>
          {!row.isSystem && (
            <button
              className={`${styles.actionBtn} ${styles.actionBtnDelete}`}
              onClick={() => handleDeleteClick(row)}
            >
              删除
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>类目管理</h1>
          <p className={styles.pageSubtitle}>管理 SKU 的一级/二级分类体系，支持自定义类目</p>
        </div>
        <Button variant="primary" size="sm" onClick={handleCreate}>
          + 新增类目
        </Button>
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

      {/* 表格 */}
      <div className={styles.tableCard}>
        <Table<FlatRow>
          columns={columns}
          dataSource={flatRows}
          rowKey={(r) => r.id}
          loading={isLoading}
          error={isError ? '类目列表加载失败，请刷新重试' : null}
          emptyText="暂无类目数据"
        />
      </div>

      {/* 新增/编辑 Modal */}
      <CategoryModal
        open={modalOpen}
        initial={editTarget}
        level1List={level1List}
        onClose={() => setModalOpen(false)}
      />

      {/* 删除确认 Modal */}
      <DeleteModal
        open={deleteTarget !== null}
        target={deleteTarget}
        childCount={deleteTarget ? getChildCount(deleteTarget) : 0}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteConfirm()}
        loading={deleteMut.isPending}
      />
    </div>
  );
}
