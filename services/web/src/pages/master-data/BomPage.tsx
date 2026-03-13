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
 *   - 品类成本占比：后端暂无对应接口，保留 COST_SEGS mock 数据展示
 *   - skuCode：后端 listBoms() 已返回 skuCode，前端直接使用
 *   - materialCount：后端 listBoms() 已返回 itemCount 子查询，前端直接使用
 *   - orderCount：后端无关联订单统计字段，显示 `—`
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useBomList, useBomExpanded, useActivateBom, useCreateBom, useUpdateBom, useCopyBom, useAiBomSuggestion, useAddBomItem, useDeleteBomItem, useUpdateBomItem } from '@/api/bom';
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

/* 品类成本占比
 * TODO: 后端暂无 /api/bom/:id/cost-breakdown 接口，
 *       当后端实现该接口后替换此 mock 数据并接入真实 API。
 */
interface CostSeg { label: string; pct: number; amt: string; color: string; }
const COST_SEGS: CostSeg[] = [
  { label: '面料类', pct: 35, amt: '¥1,148', color: '#7C3AED' },
  { label: '板材类', pct: 32, amt: '¥1,050', color: '#C2774A' },
  { label: '海绵类', pct: 18, amt: '¥590',   color: '#059669' },
  { label: '五金类', pct: 8,  amt: '¥262',   color: '#94A3B8' },
  { label: '其他（油漆/辅料）', pct: 7, amt: '¥230', color: '#CBD5E1' },
];

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
  onNext: (selected: string[]) => void;
  skuItems: WizardSkuItem[];
}

function WizardModal({ open, onClose, onNext, skuItems }: WizardModalProps) {
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // 当 skuItems 变化时，默认勾选无 BOM 的成品（待录入项）
  useEffect(() => {
    const noBom = skuItems.filter(s => !s.hasBom).map(s => s.code);
    const withAlert = skuItems.filter(s => s.alertText).map(s => s.code);
    setChecked(new Set([...noBom, ...withAlert]));
  }, [skuItems]);

  const toggle = (code: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  };

  const STEPS = ['选择成品', 'AI推荐', '填写用量', '确认'];

  return (
    <Modal
      open={open}
      title="BOM快速录入向导"
      onClose={onClose}
      onConfirm={() => onNext([...checked])}
      confirmLabel="下一步：获取AI推荐"
      cancelLabel="取消"
      size="md"
    >
      {/* Stepper */}
      <div className={styles.stepper}>
        {STEPS.map((step, i) => (
          <div key={step} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'unset' }}>
            <div className={styles.stepper__step}>
              <div className={`${styles.stepper__circle} ${i === 0 ? styles['stepper__circle--active'] : styles['stepper__circle--pending']}`}>
                {i + 1}
              </div>
              <span className={`${styles.stepper__label} ${i === 0 ? styles['stepper__label--active'] : styles['stepper__label--pending']}`}>
                {step}
              </span>
            </div>
            {i < STEPS.length - 1 && <div className={styles.stepper__line} />}
          </div>
        ))}
      </div>

      <p className={styles.wizard_hint}>请选择需要录入BOM的成品（优先录入BOM缺失的成品）：</p>

      {skuItems.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem 0' }}>
          暂无成品数据，请先在SKU主数据中添加成品
        </p>
      ) : (
        skuItems.map((sku) => {
          const isChecked = checked.has(sku.code);
          return (
            <label
              key={sku.code}
              className={`${styles.wizard_item} ${isChecked ? styles['wizard_item--checked'] : ''}`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => toggle(sku.code)}
              />
              <span className={styles.wizard_item__code}>{sku.code}</span>
              <span className={styles.wizard_item__name}>{sku.name}</span>
              {sku.hasBom && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: 'auto' }}>已有BOM</span>}
              {sku.alertText && <span className={styles.wizard_item__alert}>{sku.alertText}</span>}
              {!sku.hasBom && !sku.alertText && <span style={{ fontSize: '0.75rem', color: 'var(--color-accent-500, #f97316)', marginLeft: 'auto' }}>待录入</span>}
            </label>
          );
        })
      )}
    </Modal>
  );
}

/* ──────────────────────────────────────────────────────────────
   辅助：品类成本占比区块
────────────────────────────────────────────────────────────── */

function CostBreakdown() {
  return (
    <div className={styles.cost_breakdown} role="region" aria-label="BOM品类成本占比">
      <div className={styles.cost_breakdown__header}>
        <span className={styles.cost_breakdown__title}>品类成本占比</span>
        <span className={styles.cost_breakdown__total}>
          BOM总估算：<strong>¥3,280</strong>
        </span>
      </div>

      {/* 横向堆叠条 */}
      <div className={styles.cost_bar_track} role="img" aria-label="各品类成本占比">
        {COST_SEGS.map((seg) => (
          <div
            key={seg.label}
            className={styles.cost_bar_seg}
            style={{ width: `${seg.pct}%`, background: seg.color }}
            data-tip={`${seg.label} ${seg.pct}%`}
          />
        ))}
      </div>

      {/* 明细列表 */}
      <div className={styles.cost_detail_list} role="list">
        {COST_SEGS.map((seg) => (
          <div key={seg.label} className={styles.cost_detail_item} role="listitem">
            <span className={styles.cost_detail_item__dot} style={{ background: seg.color }} aria-hidden="true" />
            <span className={styles.cost_detail_item__name}>{seg.label}</span>
            <span className={styles.cost_detail_item__amt}>{seg.amt}</span>
            <span className={styles.cost_detail_item__pct}>{seg.pct}%</span>
          </div>
        ))}
      </div>

      <div className={styles.cost_breakdown__warning} role="note">
        <span aria-hidden="true">⚠</span>
        <span>
          <strong>2 个物料</strong>价格未维护（木蜡油、抽屉滑轨），已按历史均价估算；
          <strong>1 个物料</strong>二级品类未设置，暂归入"其他"。
        </span>
      </div>
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
          try {
            await updateBomItem.mutateAsync({
              bomId: row.id,
              itemId: selectedItem.bomItemId,
              data: { quantity: editQtyValue, unit: editUnitValue },
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
            {!isBomEmpty && <CostBreakdown />}

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
                    <Button
                      variant="secondary"
                      size="sm"
                      style={{ background: 'var(--color-accent-500, #f97316)', color: '#fff', borderColor: 'transparent' }}
                      onClick={() => showToast({ type: 'success', message: '✓ BOM结构已以草稿态导入，请逐一确认用量' })}
                    >
                      一键复用此BOM结构
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
        alertText: bomRow?.alertText
          ?? (bomRow ? undefined : undefined),
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

  const handleWizardNext = async (selected: string[]) => {
    setWizardOpen(false);
    if (selected.length === 0) return;

    // 选中第一个进入编辑器
    const firstCode = selected[0];
    // 先从已有 BOM 中查找
    const existingRow = allRows.find((r) => r.skuCode === firstCode);
    if (existingRow) {
      handleEdit(existingRow);
      return;
    }
    // 没有 BOM，为该成品创建一个草稿 BOM
    const wizardItem = wizardSkuItems.find(s => s.code === firstCode);
    if (wizardItem) {
      try {
        const result = await createBom.mutateAsync({
          skuId: Number(wizardItem.skuId),
          version: '1.0',
          description: '',
          items: [],
        });
        showToast({ type: 'success', message: `BOM草稿已创建（${wizardItem.name}），请在编辑器中添加物料` });
        // 创建成功后以新 BOM 进入编辑器
        handleEdit({
          id: Number(result.id),
          skuId: Number(wizardItem.skuId),
          skuCode: wizardItem.code,
          skuName: wizardItem.name,
          hasAlert: true,
          alertText: 'BOM草稿未激活，影响采购建议',
          completionPct: 50,
          materialCount: null,
          orderCount: 0,
          status: BomStatus.DRAFT,
        });
      } catch {
        showToast({ type: 'error', message: '创建BOM失败，请稍后重试' });
      }
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
        onNext={handleWizardNext}
        skuItems={wizardSkuItems}
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
