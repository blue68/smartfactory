/**
 * [artifact:前端代码] — 库存盘点页
 *
 * 功能：
 *   - Tab 筛选：全部 / 草稿 / 盘点中 / 待确认 / 已确认
 *   - 盘点任务列表：task_no / scope / status badge / total_items / diff_items / created_at / 操作
 *   - 点击"查看"展开行内嵌明细表
 *   - 关键操作按钮按 stocktaking:* 权限点控制
 *   - 新建盘点按钮（入口）
 *   - 分页、骨架屏、空态、错误态
 */

import { Fragment, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '@/stores/appStore';
import Button from '@/components/common/Button';
import { ACTION_CODES } from '@/constants/accessControl';
import { usePermission } from '@/hooks/usePermission';
import {
  useStocktakingList,
  useStocktakingItems,
  useCreateStocktaking,
  useSubmitStocktaking,
  useConfirmStocktaking,
  useCreateStocktakingAdjustmentOrder,
  useUpdateStocktakingItems,
  StocktakingStatusLabel,
  StocktakingScopeLabel,
  type StocktakingStatus,
  type StocktakingTask,
} from '@/api/stocktaking';
import { useWarehouseOptions, useLocationOptions } from '@/api/inventory';
import { ApiError } from '@/types/api';
import styles from './StocktakingPage.module.css';

// ── Tab 定义 ────────────────────────────────────────────────

type TabKey = 'all' | StocktakingStatus;

interface TabDef {
  key: TabKey;
  label: string;
}

const TABS: TabDef[] = [
  { key: 'all',             label: '全部' },
  { key: 'draft',           label: '草稿' },
  { key: 'in_progress',     label: '盘点中' },
  { key: 'pending_confirm', label: '待确认' },
  { key: 'confirmed',       label: '已确认' },
];

// ── 状态徽章 ────────────────────────────────────────────────

const BADGE_CLASS: Record<StocktakingStatus, string> = {
  draft:           styles['badge--draft'],
  in_progress:     styles['badge--in_progress'],
  pending_confirm: styles['badge--pending_confirm'],
  confirmed:       styles['badge--confirmed'],
  cancelled:       styles['badge--cancelled'],
};

// ── 日期格式化 ──────────────────────────────────────────────

function formatDate(str: string): string {
  try {
    return new Date(str).toLocaleDateString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
  } catch {
    return str;
  }
}

// ── 内联明细展开组件 ─────────────────────────────────────────

interface DetailRowProps {
  taskId: number;
  colSpan: number;
  canEdit: boolean;
}

function DetailRow({ taskId, colSpan, canEdit }: DetailRowProps) {
  const { data, isLoading } = useStocktakingItems(taskId);
  const updateItems = useUpdateStocktakingItems(taskId);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [saveFeedback, setSaveFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleChange = useCallback((id: number, value: string) => {
    setDrafts((prev) => ({ ...prev, [id]: value }));
    setSaveFeedback(null);
  }, []);

  const handleSave = useCallback(() => {
    const payload = Object.entries(drafts)
      .map(([id, val]) => {
        const detail = data?.find((item) => item.id === Number(id));
        if (!detail) return null;
        return {
          skuId: detail.skuId,
          actualQty: val === '' ? '0' : val,
        };
      })
      .filter((item): item is { skuId: number; actualQty: string } => item !== null);
    if (!payload.length) {
      setSaveFeedback({ type: 'error', message: '请先填写至少一条实盘数量' });
      return;
    }
    updateItems.mutate(
      { items: payload },
      {
        onSuccess: (result) => {
          setDrafts({});
          setSaveFeedback({
            type: 'success',
            message: `实盘数量已保存（${result.updatedCount} 条）`,
          });
        },
        onError: (err) => {
          const message = err instanceof ApiError ? err.message : '保存失败，请稍后重试';
          setSaveFeedback({ type: 'error', message });
        },
      },
    );
  }, [data, drafts, updateItems]);

  return (
    <tr className={styles.detail_row}>
      <td colSpan={colSpan}>
        <div className={styles.detail_inner}>
          <p className={styles.detail_title}>盘点明细</p>
          {isLoading ? (
            <p className={styles.detail_loading}>加载明细中…</p>
          ) : !data?.length ? (
            <p className={styles.detail_loading}>暂无明细数据</p>
          ) : (
            <table className={styles.detail_table}>
              <thead>
                <tr>
                  <th>SKU编码</th>
                  <th>SKU名称</th>
                  <th>仓库/库位</th>
                  <th>单位</th>
                  <th>系统库存</th>
                  <th>实盘数量</th>
                  <th>差异</th>
                </tr>
              </thead>
              <tbody>
                {data.map((item) => {
                  const diff = item.diffQty !== null ? parseFloat(item.diffQty) : null;
                  return (
                    <tr key={item.id}>
                      <td>{item.skuCode}</td>
                      <td>{item.skuName}</td>
                      <td>{item.warehouseCode && item.locationCode ? `${item.warehouseCode}/${item.locationCode}` : '未绑定（需修复）'}</td>
                      <td>{item.stockUnit}</td>
                      <td>{item.systemQty}</td>
                      <td>
                        <input
                          type="number"
                          inputMode="decimal"
                          className={styles.qty_input}
                          defaultValue={item.actualQty ?? ''}
                          disabled={!canEdit}
                          min="0"
                          step="0.0001"
                          onChange={(e) => handleChange(item.id, e.target.value)}
                        />
                      </td>
                      <td
                        className={
                          diff === null
                            ? undefined
                            : diff < 0
                            ? styles.detail_diff_negative
                            : diff > 0
                            ? styles.detail_diff_positive
                            : undefined
                        }
                      >
                        {diff === null ? '—' : diff > 0 ? `+${diff}` : String(diff)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className={styles.detail_actions}>
            {canEdit && (
              <Button
                size="sm"
                variant="primary"
                onClick={handleSave}
                loading={updateItems.isPending}
                disabled={Object.keys(drafts).length === 0}
              >
                保存实盘数量
              </Button>
            )}
            {saveFeedback && (
              <span
                className={saveFeedback.type === 'success' ? styles.detail_save_success : styles.detail_save_error}
                role="status"
              >
                {saveFeedback.message}
              </span>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── 单行组件 ────────────────────────────────────────────────

interface TaskRowProps {
  task: StocktakingTask;
  expanded: boolean;
  onToggle: (id: number) => void;
  onSubmit: (id: number) => void;
  onConfirm: (id: number) => void;
  onCreateAdjustment: (id: number) => void;
  submitting: boolean;
  confirming: boolean;
  creatingAdjustment: boolean;
  canSubmitTask: boolean;
  canConfirmTask: boolean;
}

function TaskRow({
  task,
  expanded,
  onToggle,
  onSubmit,
  onConfirm,
  onCreateAdjustment,
  submitting,
  confirming,
  creatingAdjustment,
  canSubmitTask,
  canConfirmTask,
}: TaskRowProps) {
  const diffColor = task.diffItems > 0 ? styles.cell_diff_positive : styles.cell_diff_zero;
  const canSubmit = canSubmitTask && task.status === 'in_progress';
  const canConfirm = canConfirmTask && task.status === 'pending_confirm';

  return (
    <tr className={expanded ? styles['row--expanded'] : undefined}>
      <td className={styles.cell_mono}>{task.taskNo}</td>
      <td>{StocktakingScopeLabel[task.scope]}</td>
      <td className={styles.cell_secondary}>
        {task.warehouseCode && task.locationCode
          ? `${task.warehouseCode}/${task.locationCode}`
          : '未绑定（需修复）'}
      </td>
      <td>
        <span className={`${styles.badge} ${BADGE_CLASS[task.status]}`}>
          {StocktakingStatusLabel[task.status]}
        </span>
      </td>
      <td className={`${styles.cell_number} ${styles.cell_secondary}`}>{task.totalItems}</td>
      <td className={`${styles.cell_number} ${diffColor}`}>{task.diffItems}</td>
      <td className={styles.cell_secondary}>{formatDate(task.createdAt)}</td>
      <td>
        <div className={styles.action_cell}>
          <button
            className={styles.expand_btn}
            onClick={() => onToggle(task.id)}
            aria-expanded={expanded}
            aria-label={`${expanded ? '收起' : '查看'}盘点明细`}
          >
            {expanded ? '收起' : '查看'}
          </button>
          {canSubmit && (
            <button
              className={styles.adjust_btn}
              onClick={() => onSubmit(task.id)}
              disabled={submitting || creatingAdjustment || confirming}
              aria-label={`提交盘点任务 ${task.taskNo}`}
            >
              {submitting ? '提交中…' : '提交确认'}
            </button>
          )}
          {canConfirm && (
            <button
              className={styles.adjust_btn}
              onClick={() => onCreateAdjustment(task.id)}
              disabled={creatingAdjustment || confirming || submitting}
              aria-label={`生成盘点差异调整单 ${task.taskNo}`}
            >
              {creatingAdjustment ? '生成中…' : '调整单入账'}
            </button>
          )}
          {canConfirm && (
            <button
              className={styles.confirm_btn}
              onClick={() => onConfirm(task.id)}
              disabled={confirming || creatingAdjustment || submitting}
              aria-label={`确认盘点任务 ${task.taskNo}`}
            >
              {confirming ? '确认中…' : '确认'}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── 主页面 ──────────────────────────────────────────────────

const PAGE_SIZE = 20;

export default function StocktakingPage() {
  const { setPageTitle, showToast } = useAppStore();
  const { can } = usePermission();
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [keyword, setKeyword] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createScope, setCreateScope] = useState<'all' | 'category' | 'location'>('all');
  const [createScopeValue, setCreateScopeValue] = useState('');
  const [createNotes, setCreateNotes] = useState('');
  const [createWarehouseId, setCreateWarehouseId] = useState<number | null>(null);
  const [createLocationId, setCreateLocationId] = useState<number | null>(null);

  useEffect(() => { setPageTitle('库存盘点'); }, [setPageTitle]);

  const { data, isLoading, error } = useStocktakingList(page, PAGE_SIZE);
  const createMutation = useCreateStocktaking();
  const submitMutation = useSubmitStocktaking();
  const confirmMutation = useConfirmStocktaking();
  const createAdjustmentMutation = useCreateStocktakingAdjustmentOrder();
  const { data: warehouseOptions } = useWarehouseOptions();
  const { data: locationOptions } = useLocationOptions(createWarehouseId ?? undefined);
  const canCreateTask = can(ACTION_CODES.STOCKTAKING_CREATE);
  const canSubmitTask = can(ACTION_CODES.STOCKTAKING_SUBMIT);
  const canConfirmTask = can(ACTION_CODES.STOCKTAKING_CONFIRM);

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  // Client-side filter by tab + keyword
  const filteredList = (data?.list ?? []).filter((task) => {
    const matchTab = activeTab === 'all' ? true : task.status === activeTab;
    const kw = keyword.trim().toLowerCase();
    const matchKw = !kw || task.taskNo.toLowerCase().includes(kw);
    return matchTab && matchKw;
  });

  const handleTabChange = useCallback((key: TabKey) => {
    setActiveTab(key);
    setPage(1);
    setExpandedId(null);
  }, []);

  const handleToggle = useCallback((id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleConfirm = useCallback((id: number) => {
    confirmMutation.mutate(id, {
      onSuccess: () => {
        showToast({ type: 'success', message: '盘点任务已确认，库存已完成调整' });
      },
      onError: (err) => {
        const message = err instanceof ApiError ? err.message : '确认失败，请稍后重试';
        showToast({ type: 'error', message });
      },
    });
  }, [confirmMutation, showToast]);

  const handleSubmit = useCallback((id: number) => {
    submitMutation.mutate(id, {
      onSuccess: () => {
        showToast({ type: 'success', message: '盘点任务已提交，进入待确认状态' });
      },
      onError: (err) => {
        const message = err instanceof ApiError ? err.message : '提交失败，请稍后重试';
        showToast({ type: 'error', message });
      },
    });
  }, [submitMutation, showToast]);

  const handleCreateAdjustment = useCallback((id: number) => {
    createAdjustmentMutation.mutate(
      { taskId: id, payload: { execute: true } },
      {
        onSuccess: (result) => {
          showToast({
            type: 'success',
            message: `调整单已入账（${result.diffCount} 个差异SKU）`,
          });
        },
        onError: (err) => {
          const message = err instanceof ApiError ? err.message : '调整单入账失败，请稍后重试';
          showToast({ type: 'error', message });
        },
      },
    );
  }, [createAdjustmentMutation, showToast]);

  const handleNewTask = useCallback(() => {
    if (!canCreateTask) return;
    setCreateModalOpen(true);
  }, [canCreateTask]);

  const handleCreateSubmit = useCallback(() => {
    if (!canCreateTask || !createWarehouseId || !createLocationId) return;
    createMutation.mutate(
      {
        scope: createScope,
        scopeValue: createScope === 'all' ? undefined : createScopeValue.trim() || undefined,
        warehouseId: createWarehouseId ?? undefined,
        locationId: createLocationId ?? undefined,
        notes: createNotes.trim() || undefined,
      },
      {
        onSuccess: () => {
          setCreateModalOpen(false);
          setCreateScope('all');
          setCreateScopeValue('');
          setCreateNotes('');
          setCreateWarehouseId(null);
          setCreateLocationId(null);
        },
      },
    );
  }, [canCreateTask, createMutation, createScope, createScopeValue, createNotes, createWarehouseId, createLocationId]);

  const COL_SPAN = 8;

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className={styles.page_header}>
        <h1 className={styles.page_title}>库存盘点</h1>
        {canCreateTask && (
          <Button
            variant="primary"
            size="md"
            onClick={handleNewTask}
            loading={createMutation.isPending}
          >
            + 新建盘点
          </Button>
        )}
      </div>

      {/* Tab 筛选 */}
      <div className={styles.tab_bar} role="tablist" aria-label="盘点任务筛选">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`${styles.tab_item} ${activeTab === tab.key ? styles['tab_item--active'] : ''}`}
            onClick={() => handleTabChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.filter_bar}>
        <input
          className={styles.search_input}
          placeholder="搜索盘点任务号…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      {/* 表格 */}
      <div className={styles.table_wrap}>
        <table className={styles.table} aria-label="盘点任务列表">
          <thead>
            <tr>
              <th>任务编号</th>
              <th>盘点范围</th>
              <th>仓库/库位</th>
              <th>状态</th>
              <th>总SKU数</th>
              <th>差异品项</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className={styles.skeleton_row}>
                  {Array.from({ length: COL_SPAN }).map((__, j) => (
                    <td key={j}>
                      <div
                        className={styles.skeleton_cell}
                        style={{ width: j === 0 ? '120px' : j === COL_SPAN - 1 ? '80px' : '70%' }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={COL_SPAN}>
                  <div className={styles.error_wrap}>
                    <div className="alert alert--error">
                      <span className="alert__icon" aria-hidden="true">X</span>
                      <div className="alert__body">
                        <div className="alert__title">加载失败</div>
                        <div className="alert__desc">{(error as Error).message}</div>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            ) : filteredList.length === 0 ? (
              <tr>
                <td colSpan={COL_SPAN}>
                  <div className={styles.empty_state} role="status">
                    <span className={styles.empty_icon} aria-hidden="true">📋</span>
                    <p className={styles.empty_text}>暂无盘点任务</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredList.map((task) => (
                <Fragment key={task.id}>
                  <TaskRow
                    task={task}
                    expanded={expandedId === task.id}
                    onToggle={handleToggle}
                    onSubmit={handleSubmit}
                    onConfirm={handleConfirm}
                    onCreateAdjustment={handleCreateAdjustment}
                    submitting={submitMutation.isPending}
                    confirming={confirmMutation.isPending}
                    creatingAdjustment={createAdjustmentMutation.isPending}
                    canSubmitTask={canSubmitTask}
                    canConfirmTask={canConfirmTask}
                  />
                  {expandedId === task.id && (
                    <DetailRow
                      taskId={task.id}
                      colSpan={COL_SPAN}
                      canEdit={canCreateTask}
                    />
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {(data?.total ?? 0) > 0 && (
        <div className={styles.pagination}>
          <span className={styles.pagination__info}>
            共 {data?.total ?? 0} 条记录，第 {page} / {totalPages} 页
          </span>
          <div className={styles.pagination__btns}>
            <button
              className={styles.pagination__btn_ghost}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              上一页
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => {
              const p = i + 1;
              const isActive = page === p;
              return (
                <button
                  key={p}
                  className={isActive ? styles.pagination__btn_primary : styles.pagination__btn_ghost}
                  onClick={() => setPage(p)}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {p}
                </button>
              );
            })}
            <button
              className={styles.pagination__btn_ghost}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              下一页
            </button>
          </div>
        </div>
      )}
      {createModalOpen && canCreateTask && createPortal(
        <div className={styles.modal_backdrop} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modal_header}>
              <h2>新建盘点任务</h2>
              <button className={styles.modal_close} onClick={() => setCreateModalOpen(false)}>×</button>
            </div>
            <div className={styles.modal_body}>
              <label className={styles.modal_label}>盘点范围</label>
              <div className={styles.scope_group}>
                {(['all', 'category', 'location'] as const).map((scope) => (
                  <button
                    key={scope}
                    className={`${styles.scope_chip} ${createScope === scope ? styles.scope_chip_active : ''}`}
                    onClick={() => setCreateScope(scope)}
                    type="button"
                  >
                    {StocktakingScopeLabel[scope]}
                  </button>
                ))}
              </div>
              <div className={styles.form_row}>
                <label className={styles.modal_label}>仓库</label>
                <select
                  className={styles.search_input}
                  value={createWarehouseId ?? ''}
                  onChange={(e) => {
                    setCreateWarehouseId(e.target.value ? Number(e.target.value) : null);
                    setCreateLocationId(null);
                  }}
                >
                  <option value="">请选择仓库</option>
                  {(warehouseOptions ?? []).map((w) => (
                    <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                  ))}
                </select>
              </div>
              <div className={styles.form_row}>
                <label className={styles.modal_label}>库位</label>
                <select
                  className={styles.search_input}
                  value={createLocationId ?? ''}
                  onChange={(e) => setCreateLocationId(e.target.value ? Number(e.target.value) : null)}
                  disabled={!createWarehouseId}
                >
                  <option value="">{createWarehouseId ? '请选择库位' : '请先选择仓库'}</option>
                  {(locationOptions ?? []).map((l) => (
                    <option key={l.id} value={l.id}>{l.code} · {l.name}</option>
                  ))}
                </select>
              </div>
              {createScope !== 'all' && (
                <div className={styles.form_row}>
                  <label className={styles.modal_label}>具体范围</label>
                  <input
                    className={styles.search_input}
                    value={createScopeValue}
                    onChange={(e) => setCreateScopeValue(e.target.value)}
                    placeholder={createScope === 'category' ? '输入品类名称/编码' : '输入库位或仓库名称'}
                  />
                </div>
              )}
              <div className={styles.form_row}>
                <label className={styles.modal_label}>备注（可选）</label>
                <textarea
                  className={styles.textarea}
                  value={createNotes}
                  onChange={(e) => setCreateNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <div className={styles.modal_footer}>
              <Button variant="secondary" onClick={() => setCreateModalOpen(false)} disabled={createMutation.isPending}>取消</Button>
              <Button
                variant="primary"
                onClick={handleCreateSubmit}
                loading={createMutation.isPending}
                disabled={createMutation.isPending || !createWarehouseId || !createLocationId}
              >
                创建
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
