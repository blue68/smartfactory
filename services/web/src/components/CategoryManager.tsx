/**
 * [artifact:前端代码] — SKU 类目管理组件
 * R-01: SKU 类目自定义配置
 *
 * 布局：左侧一级类目列表（280px）+ 右侧二级类目表格（flex:1）
 * 交互：选中高亮、hover 操作按钮、新增/编辑/删除弹框
 */

import { useState, useMemo, useCallback } from 'react';
import type { SkuCategoryFull, CreateCategoryPayload, UpdateCategoryPayload } from '@/types/models';
import {
  useSkuCategoryList,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
} from '@/api/skuCategory';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import styles from './CategoryManager.module.css';

// ─────────────────────────────────────────────
// 表单状态类型
// ─────────────────────────────────────────────
interface FormState {
  open: boolean;
  mode: 'create' | 'edit';
  level: 1 | 2;
  editingItem: SkuCategoryFull | null;
  code: string;
  name: string;
  sortOrder: string;
  errors: { code?: string; name?: string; sortOrder?: string };
}

interface DeleteState {
  open: boolean;
  item: SkuCategoryFull | null;
}

const EMPTY_FORM: FormState = {
  open: false,
  mode: 'create',
  level: 1,
  editingItem: null,
  code: '',
  name: '',
  sortOrder: '0',
  errors: {},
};

const EMPTY_DELETE: DeleteState = { open: false, item: null };

// ─────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────
export interface CategoryManagerProps {
  /** 关闭类目管理（由外层 Modal 控制） */
  onClose: () => void;
}

// ─────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────
export default function CategoryManager({ onClose: _onClose }: CategoryManagerProps) {
  // ── 服务端数据 ──
  const { data: rawData, isLoading } = useSkuCategoryList();
  const createMutation = useCreateCategory();
  const updateMutation = useUpdateCategory();
  const deleteMutation = useDeleteCategory();

  // ── 本地状态 ──
  const [selectedCat1Id, setSelectedCat1Id] = useState<number | null>(null);
  const [cat1Search, setCat1Search] = useState('');
  const [formState, setFormState] = useState<FormState>(EMPTY_FORM);
  const [deleteState, setDeleteState] = useState<DeleteState>(EMPTY_DELETE);

  // ── 派生数据 ──
  const cat1List: SkuCategoryFull[] = useMemo(
    () => (rawData ?? []).filter((c) => c.level === 1),
    [rawData],
  );

  const filteredCat1List = useMemo(() => {
    if (!cat1Search.trim()) return cat1List;
    const kw = cat1Search.trim().toLowerCase();
    return cat1List.filter(
      (c) => c.name.toLowerCase().includes(kw) || c.code.toLowerCase().includes(kw),
    );
  }, [cat1List, cat1Search]);

  const selectedCat1 = useMemo(
    () => cat1List.find((c) => c.id === selectedCat1Id) ?? null,
    [cat1List, selectedCat1Id],
  );

  const cat2List: SkuCategoryFull[] = useMemo(() => {
    if (!selectedCat1Id) return [];
    return (rawData ?? []).filter((c) => c.level === 2 && c.parentId === selectedCat1Id);
  }, [rawData, selectedCat1Id]);

  // ── 表单辅助 ──
  const openCreateForm = useCallback((level: 1 | 2) => {
    setFormState({
      ...EMPTY_FORM,
      open: true,
      mode: 'create',
      level,
      sortOrder: '0',
    });
  }, []);

  const openEditForm = useCallback((item: SkuCategoryFull) => {
    setFormState({
      open: true,
      mode: 'edit',
      level: item.level,
      editingItem: item,
      code: item.code,
      name: item.name,
      sortOrder: String(item.sortOrder),
      errors: {},
    });
  }, []);

  const closeForm = useCallback(() => {
    setFormState(EMPTY_FORM);
  }, []);

  const setFormField = useCallback(
    (field: 'code' | 'name' | 'sortOrder', value: string) => {
      setFormState((prev) => ({
        ...prev,
        [field]: value,
        errors: { ...prev.errors, [field]: undefined },
      }));
    },
    [],
  );

  // ── 表单校验 ──
  const validateForm = useCallback((): boolean => {
    const errors: FormState['errors'] = {};
    if (!formState.name.trim()) errors.name = '名称不能为空';
    if (formState.mode === 'create' && !formState.code.trim()) errors.code = '编码不能为空';
    const sortNum = Number(formState.sortOrder);
    if (formState.sortOrder !== '' && (isNaN(sortNum) || !Number.isInteger(sortNum) || sortNum < 0)) {
      errors.sortOrder = '排序号须为非负整数';
    }
    if (Object.keys(errors).length > 0) {
      setFormState((prev) => ({ ...prev, errors }));
      return false;
    }
    return true;
  }, [formState]);

  // ── 提交表单 ──
  const handleFormSubmit = useCallback(async () => {
    if (!validateForm()) return;

    try {
      if (formState.mode === 'create') {
        const payload: CreateCategoryPayload = {
          level: formState.level,
          code: formState.code.trim().toUpperCase(),
          name: formState.name.trim(),
          sortOrder: formState.sortOrder !== '' ? Number(formState.sortOrder) : 0,
          ...(formState.level === 2 && selectedCat1Id ? { parentId: selectedCat1Id } : {}),
        };
        await createMutation.mutateAsync(payload);
      } else {
        if (!formState.editingItem) return;
        const payload: UpdateCategoryPayload = {
          name: formState.name.trim(),
          sortOrder: formState.sortOrder !== '' ? Number(formState.sortOrder) : 0,
        };
        await updateMutation.mutateAsync({ id: formState.editingItem.id, payload });
      }
      closeForm();
    } catch {
      // 错误由 request 层统一 toast 处理
    }
  }, [validateForm, formState, selectedCat1Id, createMutation, updateMutation, closeForm]);

  // ── 删除操作 ──
  const openDeleteConfirm = useCallback((item: SkuCategoryFull) => {
    setDeleteState({ open: true, item });
  }, []);

  const closeDeleteConfirm = useCallback(() => {
    setDeleteState(EMPTY_DELETE);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!deleteState.item) return;
    try {
      await deleteMutation.mutateAsync(deleteState.item.id);
      // 若删除的是当前选中的一级类目，清空选中
      if (deleteState.item.level === 1 && deleteState.item.id === selectedCat1Id) {
        setSelectedCat1Id(null);
      }
      closeDeleteConfirm();
    } catch {
      // 错误由 request 层统一 toast 处理
    }
  }, [deleteState.item, deleteMutation, selectedCat1Id, closeDeleteConfirm]);

  // ── 计算派生状态 ──
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDeleting = deleteMutation.isPending;

  // ── 表单弹框标题 ──
  const formTitle = useMemo(() => {
    const levelLabel = formState.level === 1 ? '一级类目' : '二级类目';
    return formState.mode === 'create' ? `新增${levelLabel}` : `编辑${levelLabel}`;
  }, [formState.level, formState.mode]);

  // ── 渲染 ──
  return (
    <div className={styles.layout}>
      {/* ══════════════════════════════════════
          左侧面板：一级类目列表
      ══════════════════════════════════════ */}
      <div className={styles.cat1Panel}>
        {/* 搜索框 */}
        <div className={styles.cat1PanelSearchWrap}>
          <input
            type="search"
            className={styles.cat1PanelSearch}
            placeholder="搜索类目名称 / 编码..."
            value={cat1Search}
            onChange={(e) => setCat1Search(e.target.value)}
            aria-label="搜索一级类目"
          />
        </div>

        {/* 列表主体 */}
        {isLoading ? (
          <SkeletonCat1List />
        ) : filteredCat1List.length === 0 ? (
          <div className={styles.cat1PanelEmpty}>
            <div className={styles.cat1PanelEmptyIcon}>
              {cat1Search ? '🔍' : '📂'}
            </div>
            <div className={styles.cat1PanelEmptyTitle}>
              {cat1Search ? '未找到匹配类目' : '暂无一级类目'}
            </div>
            <div className={styles.cat1PanelEmptyDesc}>
              {cat1Search ? '请尝试其他关键词' : '点击下方按钮新增第一个一级类目'}
            </div>
          </div>
        ) : (
          <ul className={styles.cat1List} role="listbox" aria-label="一级类目列表">
            {filteredCat1List.map((cat1) => {
              const isActive = cat1.id === selectedCat1Id;
              const childCount = (rawData ?? []).filter(
                (c) => c.level === 2 && c.parentId === cat1.id,
              ).length;

              return (
                <li
                  key={cat1.id}
                  role="option"
                  aria-selected={isActive}
                  className={`${styles.cat1Item} ${isActive ? styles['cat1Item--active'] : ''}`}
                  onClick={() => setSelectedCat1Id(cat1.id)}
                >
                  <span className={styles.cat1ItemName} title={cat1.name}>
                    {cat1.name}
                  </span>

                  {/* 计数（hover/active 时隐藏） */}
                  <span className={styles.cat1ItemMeta}>
                    {cat1.isSystem && (
                      <span className={styles.cat1ItemSystemBadge}>预置</span>
                    )}
                    <span className={styles.cat1ItemCount}>{childCount}</span>
                  </span>

                  {/* 操作（hover/active 时显示） */}
                  <span className={styles.cat1ItemActions}>
                    {cat1.isSystem && (
                      <span className={styles.cat1ItemSystemBadge}>预置</span>
                    )}
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="编辑类目"
                      aria-label={`编辑 ${cat1.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditForm(cat1);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className={`${styles.iconBtn} ${styles['iconBtn--danger']}`}
                      title={cat1.isSystem ? '系统预置类目不可删除' : '删除类目'}
                      aria-label={`删除 ${cat1.name}`}
                      disabled={cat1.isSystem}
                      onClick={(e) => {
                        e.stopPropagation();
                        openDeleteConfirm(cat1);
                      }}
                    >
                      🗑
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {/* 底部新增按钮 */}
        <div className={styles.cat1PanelFooter}>
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            icon={<span>+</span>}
            onClick={() => openCreateForm(1)}
          >
            新增一级类目
          </Button>
        </div>
      </div>

      {/* ══════════════════════════════════════
          右侧面板：二级类目表格
      ══════════════════════════════════════ */}
      <div className={styles.cat2Panel}>
        {selectedCat1 ? (
          <>
            {/* 面板头 */}
            <div className={styles.cat2PanelHeader}>
              <div className={styles.cat2PanelTitleGroup}>
                <span className={styles.cat2PanelTitle}>{selectedCat1.name}</span>
                <span className={styles.cat2PanelSubtitle}>
                  共 {cat2List.length} 个二级类目
                </span>
              </div>
              <div className={styles.cat2PanelActions}>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<span>+</span>}
                  onClick={() => openCreateForm(2)}
                >
                  新增二级类目
                </Button>
              </div>
            </div>

            {/* 表格 or 空状态 */}
            {isLoading ? (
              <div className={styles.cat2TableWrap}>
                <SkeletonCat2Table />
              </div>
            ) : cat2List.length === 0 ? (
              <div className={styles.cat2PanelEmpty}>
                <div className={styles.cat2PanelEmptyIcon}>📋</div>
                <div className={styles.cat2PanelEmptyTitle}>暂无二级类目</div>
                <div className={styles.cat2PanelEmptyDesc}>
                  为「{selectedCat1.name}」添加二级类目，以便对 SKU 进行更精细的分类管理
                </div>
                <Button
                  variant="primary"
                  size="md"
                  icon={<span>+</span>}
                  onClick={() => openCreateForm(2)}
                >
                  新增第一个二级类目
                </Button>
              </div>
            ) : (
              <div className={styles.cat2TableWrap}>
                <table className={styles.cat2Table} aria-label={`${selectedCat1.name} 的二级类目`}>
                  <thead>
                    <tr>
                      <th style={{ width: 200 }}>类目名称</th>
                      <th style={{ width: 140 }}>编码</th>
                      <th style={{ width: 80, textAlign: 'center' }}>排序号</th>
                      <th style={{ width: 100 }}>类型</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cat2List
                      .slice()
                      .sort((a, b) => a.sortOrder - b.sortOrder)
                      .map((cat2) => (
                        <tr key={cat2.id}>
                          {/* 名称 */}
                          <td>
                            <div className={styles.cat2NameCell}>
                              {cat2.name}
                            </div>
                          </td>

                          {/* 编码 */}
                          <td>
                            <span className={styles.cat2Code}>{cat2.code}</span>
                          </td>

                          {/* 排序号 */}
                          <td style={{ textAlign: 'center' }}>
                            <span className={styles.cat2SortOrder}>{cat2.sortOrder}</span>
                          </td>

                          {/* 系统预置标记 */}
                          <td>
                            {cat2.isSystem ? (
                              <span className={styles.badgeSystem}>系统预置</span>
                            ) : (
                              <span className={styles.badgeCustom}>自定义</span>
                            )}
                          </td>

                          {/* 操作 */}
                          <td>
                            <div className={styles.cat2RowActions}>
                              <button
                                type="button"
                                className={styles.iconBtn}
                                title="编辑"
                                aria-label={`编辑 ${cat2.name}`}
                                onClick={() => openEditForm(cat2)}
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                className={`${styles.iconBtn} ${styles['iconBtn--danger']}`}
                                title={cat2.isSystem ? '系统预置类目不可删除' : '删除'}
                                aria-label={`删除 ${cat2.name}`}
                                disabled={cat2.isSystem}
                                onClick={() => openDeleteConfirm(cat2)}
                              >
                                🗑
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          /* 未选一级时的占位提示 */
          <div className={styles.cat2PanelPlaceholder}>
            <div className={styles.cat2PanelPlaceholderIcon}>👈</div>
            <div className={styles.cat2PanelPlaceholderText}>
              请从左侧选择一个一级类目，查看并管理其二级类目
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════
          新增 / 编辑弹框
      ══════════════════════════════════════ */}
      <Modal
        open={formState.open}
        title={formTitle}
        size="sm"
        onClose={closeForm}
        onConfirm={() => void handleFormSubmit()}
        confirmLabel={formState.mode === 'create' ? '新增' : '保存'}
        confirmLoading={isSaving}
      >
        <CategoryForm
          formState={formState}
          onFieldChange={setFormField}
        />
      </Modal>

      {/* ══════════════════════════════════════
          删除确认弹框
      ══════════════════════════════════════ */}
      <Modal
        open={deleteState.open}
        title="删除类目"
        size="sm"
        onClose={closeDeleteConfirm}
        onConfirm={() => void handleDelete()}
        confirmLabel="确认删除"
        confirmVariant="danger"
        confirmLoading={isDeleting}
      >
        <DeleteConfirmContent item={deleteState.item} />
      </Modal>
    </div>
  );
}

// ─────────────────────────────────────────────
// 内部子组件：表单内容
// ─────────────────────────────────────────────
interface CategoryFormProps {
  formState: FormState;
  onFieldChange: (field: 'code' | 'name' | 'sortOrder', value: string) => void;
}

function CategoryForm({ formState, onFieldChange }: CategoryFormProps) {
  const isEdit = formState.mode === 'edit';
  const isSystem = formState.editingItem?.isSystem ?? false;

  return (
    <>
      {/* 编码（新增可编辑，编辑只读） */}
      <div className={styles.formGroup}>
        <label className={styles.formLabel}>
          类目编码
          {!isEdit && <span className={styles.formLabelRequired}>*</span>}
          {isEdit && (
            <span className={styles.formLabelHint}>（编码创建后不可修改）</span>
          )}
        </label>
        {isEdit ? (
          <div className={styles.formReadonly}>{formState.code}</div>
        ) : (
          <>
            <input
              type="text"
              className={`${styles.formInput} ${formState.errors.code ? styles['formInput--error'] : ''}`}
              placeholder="如：BOARD、HARDWARE（建议全大写英文）"
              value={formState.code}
              onChange={(e) => onFieldChange('code', e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-required="true"
              aria-invalid={!!formState.errors.code}
            />
            {formState.errors.code && (
              <div className={styles.formError}>
                <span>✕</span>
                <span>{formState.errors.code}</span>
              </div>
            )}
            <div className={styles.formHint}>建议使用全大写英文缩写，创建后不可修改</div>
          </>
        )}
      </div>

      {/* 名称 */}
      <div className={styles.formGroup}>
        <label className={styles.formLabel}>
          类目名称
          <span className={styles.formLabelRequired}>*</span>
        </label>
        <input
          type="text"
          className={`${styles.formInput} ${formState.errors.name ? styles['formInput--error'] : ''}`}
          placeholder="请输入类目名称"
          value={formState.name}
          onChange={(e) => onFieldChange('name', e.target.value)}
          disabled={isSystem}
          autoComplete="off"
          aria-required="true"
          aria-invalid={!!formState.errors.name}
        />
        {formState.errors.name && (
          <div className={styles.formError}>
            <span>✕</span>
            <span>{formState.errors.name}</span>
          </div>
        )}
        {isSystem && (
          <div className={styles.formHint}>系统预置类目名称不可修改</div>
        )}
      </div>

      {/* 排序号 */}
      <div className={styles.formGroup}>
        <label className={styles.formLabel}>
          排序号
          <span className={styles.formLabelHint}>（数值越小越靠前，默认 0）</span>
        </label>
        <input
          type="number"
          className={`${styles.formInput} ${formState.errors.sortOrder ? styles['formInput--error'] : ''}`}
          placeholder="0"
          value={formState.sortOrder}
          onChange={(e) => onFieldChange('sortOrder', e.target.value)}
          min={0}
          step={1}
        />
        {formState.errors.sortOrder && (
          <div className={styles.formError}>
            <span>✕</span>
            <span>{formState.errors.sortOrder}</span>
          </div>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────
// 内部子组件：删除确认内容
// ─────────────────────────────────────────────
interface DeleteConfirmContentProps {
  item: SkuCategoryFull | null;
}

function DeleteConfirmContent({ item }: DeleteConfirmContentProps) {
  if (!item) return null;

  const levelLabel = item.level === 1 ? '一级类目' : '二级类目';
  const cascadeWarning = item.level === 1
    ? '删除后，该类目下所有二级类目也将被同步删除，且已关联该类目的 SKU 将失去分类信息。'
    : '删除后，已关联该类目的 SKU 将失去二级品类信息。';

  return (
    <div>
      <div className={styles.dangerAlert}>
        <div className={styles.dangerAlertIcon}>⚠️</div>
        <div className={styles.dangerAlertBody}>
          <div className={styles.dangerAlertTitle}>
            确认删除此{levelLabel}？
          </div>
          <div className={styles.dangerAlertDesc}>
            您即将删除{levelLabel}{' '}
            <span className={styles.dangerAlertTarget}>「{item.name}」</span>。
            {cascadeWarning}
            <strong>此操作不可撤销。</strong>
          </div>
        </div>
      </div>

      <div className={styles.deleteMetaRow}>
        <div className={styles.deleteMetaItem}>
          <span className={styles.deleteMetaLabel}>类目编码</span>
          <span className={styles.deleteMetaValue}>{item.code}</span>
        </div>
        <div className={styles.deleteMetaItem}>
          <span className={styles.deleteMetaLabel}>类目名称</span>
          <span className={styles.deleteMetaValue}>{item.name}</span>
        </div>
        <div className={styles.deleteMetaItem}>
          <span className={styles.deleteMetaLabel}>层级</span>
          <span className={styles.deleteMetaValue}>{levelLabel}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 内部子组件：骨架屏
// ─────────────────────────────────────────────
function SkeletonCat1List() {
  return (
    <div className={styles.skeletonWrap}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <div className={styles.skeleton} style={{ flex: 1, opacity: 1 - i * 0.1 }} />
          <div className={styles.skeleton} style={{ width: 28, flexShrink: 0 }} />
        </div>
      ))}
    </div>
  );
}

function SkeletonCat2Table() {
  return (
    <div className={styles.skeletonWrap}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={styles.skeletonRow} style={{ gap: 24 }}>
          <div className={styles.skeleton} style={{ width: 120, opacity: 1 - i * 0.15 }} />
          <div className={styles.skeleton} style={{ width: 80, opacity: 1 - i * 0.15 }} />
          <div className={styles.skeleton} style={{ width: 40, opacity: 1 - i * 0.15 }} />
          <div className={styles.skeleton} style={{ width: 60, opacity: 1 - i * 0.15 }} />
          <div className={styles.skeleton} style={{ width: 60, marginLeft: 'auto', opacity: 1 - i * 0.15 }} />
        </div>
      ))}
    </div>
  );
}
