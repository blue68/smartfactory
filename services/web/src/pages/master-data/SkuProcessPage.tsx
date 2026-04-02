/**
 * [artifact:前端代码] — SKU 工序配置页
 *
 * 从 SKU 视角管理工序模板：左侧 SKU 列表，右侧展示该 SKU 关联的工序模板列表。
 * 可新建、跳转编辑工序模板。
 */

import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSkuList } from '@/api/sku';
import {
  useProcessConfigList,
  useCreateProcessConfig,
  useSetDefaultProcessConfig,
  type ProcessTemplateListItem,
} from '@/api/processConfig';
import styles from './SkuProcessPage.module.css';

// ── 内联 SVG 图标 ────────────────────────────────────────────────────────────

const IconSearch = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
    <circle cx="8.5" cy="8.5" r="5.5" />
    <path d="M14.5 14.5l3.5 3.5" />
  </svg>
);

const IconLink = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 12a4 4 0 005.66 0l2-2a4 4 0 00-5.66-5.66l-1 1" />
    <path d="M12 8a4 4 0 00-5.66 0l-2 2a4 4 0 005.66 5.66l1-1" />
  </svg>
);

const IconPlus = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M10 4v12M4 10h12" />
  </svg>
);

const IconEdit = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 3l4 4-9 9H4v-4L13 3z" />
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

const IconClose = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M5 5l10 10M15 5L5 15" />
  </svg>
);

const IconStar = ({ filled }: { filled?: boolean }) => (
  <svg viewBox="0 0 20 20" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    <path d="M10 2l2.39 4.84 5.35.78-3.87 3.77.91 5.32L10 14.27l-4.78 2.52.91-5.32L2.26 7.62l5.35-.78L10 2z" />
  </svg>
);

// ── 骨架屏 ───────────────────────────────────────────────────────────────────

function SidebarSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
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

function TemplateSkeleton() {
  return (
    <div className={styles.templateGrid}>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className={styles.templateCard__skeleton} />
      ))}
    </div>
  );
}

// ── 工序模板卡片 ─────────────────────────────────────────────────────────────

interface TemplateCardProps {
  template: ProcessTemplateListItem;
  onEdit: () => void;
  onSetDefault: () => void;
  settingDefault: boolean;
}

function TemplateCard({ template, onEdit, onSetDefault, settingDefault }: TemplateCardProps) {
  const statusLabel = template.status === 'active' ? '启用' : '停用';
  const isActive = template.status === 'active';

  return (
    <div className={`${styles.templateCard} ${template.isDefault ? styles['templateCard--default'] : ''}`}>
      <div className={styles.templateCard__header}>
        <div className={styles.templateCard__icon}>
          <IconFlow />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          {template.isDefault && (
            <span className={styles.templateCard__defaultBadge}>
              <IconStar filled />
              默认
            </span>
          )}
          <span className={`${styles.templateCard__status} ${isActive ? styles['templateCard__status--active'] : styles['templateCard__status--inactive']}`}>
            {statusLabel}
          </span>
        </div>
      </div>
      <div className={styles.templateCard__name}>{template.name}</div>
      <div className={styles.templateCard__meta}>
        创建于 {new Date(template.createdAt).toLocaleDateString('zh-CN')}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button className={styles.templateCard__editBtn} onClick={onEdit} style={{ flex: 1 }}>
          <IconEdit />
          查看 / 编辑
        </button>
        {!template.isDefault && (
          <button
            className={`${styles.templateCard__editBtn} ${styles['templateCard__editBtn--star']}`}
            onClick={onSetDefault}
            disabled={settingDefault}
            title="设为该 SKU 的默认工序模板"
          >
            <IconStar />
            {settingDefault ? '…' : '设为默认'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── 主页面 ───────────────────────────────────────────────────────────────────

export default function SkuProcessPage() {
  const navigate = useNavigate();

  // 左侧 SKU 搜索
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeywordChange = (val: string) => {
    setKeyword(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedKeyword(val), 350);
  };

  const { data: skuListData, isLoading: skuLoading } = useSkuList({
    keyword: debouncedKeyword || undefined,
    pageSize: 200,
    skuTypes: 'semi_finished,finished',
  });
  const skus = skuListData?.list ?? [];

  // 当前选中 SKU
  const [selectedSkuId, setSelectedSkuId] = useState<number | null>(null);
  const selectedSku = skus.find((s) => Number(s.id) === selectedSkuId);

  // 工序模板列表（全量拉取，前端过滤 skuId）
  const { data: templateListData, isLoading: templateLoading } = useProcessConfigList({
    pageSize: 200,
  });
  const allTemplates = templateListData?.list ?? [];
  const skuTemplates = selectedSkuId !== null
    ? allTemplates.filter((t) => Number(t.skuId) === selectedSkuId)
    : [];

  // 新建模板 Modal
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const createMutation = useCreateProcessConfig();
  const setDefaultMutation = useSetDefaultProcessConfig();

  const handleCreate = async () => {
    if (!newName.trim() || selectedSkuId === null) return;
    const result = await createMutation.mutateAsync({
      name: newName.trim(),
      skuId: selectedSkuId,
      steps: [],
    });
    setShowModal(false);
    setNewName('');
    // 跳转到工序配置页编辑新建的模板
    navigate('/master-data/process-config', { state: { selectTemplateId: result.id } });
  };

  return (
    <div className={styles.page}>
      {/* ===== 左侧 SKU 列表 ===== */}
      <nav className={styles.sidebar} aria-label="SKU 列表">
        <div className={styles.sidebar__header}>
          <div className={styles.sidebar__title}>SKU 列表</div>
          <div className={styles.searchBox}>
            <span className={styles.searchBox__icon}><IconSearch /></span>
            <input
              className={styles.searchBox__input}
              type="search"
              placeholder="搜索 SKU 名称或编码..."
              value={keyword}
              onChange={(e) => handleKeywordChange(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.sidebar__list} role="list">
          {skuLoading && <SidebarSkeleton />}

          {!skuLoading && skus.length === 0 && (
            <div className={styles.sidebar__empty}>
              {debouncedKeyword ? '未找到匹配的 SKU' : '暂无 SKU 数据'}
            </div>
          )}

          {!skuLoading && skus.map((sku) => {
            const isActive = Number(sku.id) === selectedSkuId;
            return (
              <div
                key={sku.id}
                className={`${styles.skuItem} ${isActive ? styles['skuItem--active'] : ''}`}
                onClick={() => setSelectedSkuId(Number(sku.id))}
                role="listitem"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') setSelectedSkuId(Number(sku.id)); }}
              >
                <div className={styles.skuItem__icon}>
                  {sku.skuCode?.charAt(0)?.toUpperCase() ?? 'S'}
                </div>
                <div className={styles.skuItem__info}>
                  <div className={styles.skuItem__name}>{sku.name}</div>
                  <div className={styles.skuItem__code}>{sku.skuCode}</div>
                </div>
              </div>
            );
          })}
        </div>
      </nav>

      {/* ===== 右侧内容区 ===== */}
      <main className={styles.detail}>
        {/* 未选中状态 */}
        {selectedSkuId === null && (
          <div className={styles.emptyState}>
            <div className={styles.emptyState__icon}><IconLink /></div>
            <div className={styles.emptyState__title}>选择左侧 SKU 查看工序配置</div>
            <p className={styles.emptyState__desc}>
              每个 SKU 可关联一个或多个工序模板，用于指导生产工序的执行顺序与标准工时。
            </p>
          </div>
        )}

        {/* 已选中 SKU */}
        {selectedSkuId !== null && (
          <>
            {/* 头部 */}
            <header className={styles.detailHeader}>
              <div className={styles.detailHeader__info}>
                <div className={styles.detailHeader__name}>
                  {selectedSku?.name ?? '加载中…'}
                </div>
                {selectedSku?.skuCode && (
                  <span className={styles.detailHeader__code}>{selectedSku.skuCode}</span>
                )}
              </div>
              <button
                className={`${styles.btn} ${styles['btn--primary']}`}
                onClick={() => setShowModal(true)}
              >
                <IconPlus />
                新建工序模板
              </button>
            </header>

            {/* 模板列表 */}
            {templateLoading && <TemplateSkeleton />}

            {!templateLoading && skuTemplates.length === 0 && (
              <div className={styles.emptyTemplates}>
                <div className={styles.emptyTemplates__icon}><IconFlow /></div>
                <div className={styles.emptyTemplates__text}>该 SKU 暂无工序模板</div>
                <button
                  className={`${styles.btn} ${styles['btn--primary']}`}
                  onClick={() => setShowModal(true)}
                >
                  <IconPlus />
                  新建第一个工序模板
                </button>
              </div>
            )}

            {!templateLoading && skuTemplates.length > 0 && (
              <div className={styles.templateGrid}>
                {skuTemplates.map((t) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    onEdit={() =>
                      navigate('/master-data/process-config', {
                        state: { selectTemplateId: Number(t.id) },
                      })
                    }
                    onSetDefault={() => void setDefaultMutation.mutateAsync(Number(t.id))}
                    settingDefault={setDefaultMutation.isPending && setDefaultMutation.variables === Number(t.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* ===== 新建模板 Modal ===== */}
      {showModal && (
        <div
          className={styles.modalOverlay}
          onClick={() => { setShowModal(false); setNewName(''); }}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modal__header}>
              <span className={styles.modal__title}>新建工序模板</span>
              <button
                className={styles.modal__close}
                onClick={() => { setShowModal(false); setNewName(''); }}
              >
                <IconClose />
              </button>
            </div>
            <div className={styles.modal__body}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  模板名称<span className={styles.formLabel__req}>*</span>
                </label>
                <input
                  className={styles.formInput}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例：标准工序模板"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>关联 SKU</label>
                <div className={styles.skuPreview}>
                  {selectedSku?.skuCode && (
                    <span className={styles.skuPreview__code}>{selectedSku.skuCode}</span>
                  )}
                  <span>{selectedSku?.name}</span>
                </div>
              </div>
            </div>
            <div className={styles.modal__footer}>
              <button
                className={`${styles.btn} ${styles['btn--ghost']}`}
                onClick={() => { setShowModal(false); setNewName(''); }}
              >
                取消
              </button>
              <button
                className={`${styles.btn} ${styles['btn--primary']}`}
                onClick={handleCreate}
                disabled={!newName.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? <span className={styles.btn__spinner} /> : <IconPlus />}
                创建并编辑
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
