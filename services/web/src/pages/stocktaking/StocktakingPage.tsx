/**
 * [artifact:前端代码] — 库存盘点页
 *
 * 功能：
 *   - Tab 筛选：全部 / 草稿 / 盘点中 / 待确认 / 已确认
 *   - 盘点任务列表：task_no / scope / status badge / total_items / diff_items / created_at / 操作
 *   - 点击"查看"展开行内嵌明细表
 *   - boss 可确认 pending_confirm 任务
 *   - 新建盘点按钮（入口）
 *   - 分页、骨架屏、空态、错误态
 */

import { Fragment, useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import Button from '@/components/common/Button';
import {
  useStocktakingList,
  useStocktakingItems,
  useCreateStocktaking,
  useConfirmStocktaking,
  StocktakingStatusLabel,
  StocktakingScopeLabel,
  type StocktakingStatus,
  type StocktakingTask,
} from '@/api/stocktaking';
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
}

function DetailRow({ taskId, colSpan }: DetailRowProps) {
  const { data, isLoading } = useStocktakingItems(taskId);

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
                      <td>{item.stockUnit}</td>
                      <td>{item.systemQty}</td>
                      <td>{item.actualQty ?? '—'}</td>
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
  onConfirm: (id: number) => void;
  confirming: boolean;
}

function TaskRow({ task, expanded, onToggle, onConfirm, confirming }: TaskRowProps) {
  const diffColor = task.diffItems > 0 ? styles.cell_diff_positive : styles.cell_diff_zero;
  const canConfirm = task.status === 'in_progress' || task.status === 'pending_confirm';

  return (
    <tr className={expanded ? styles['row--expanded'] : undefined}>
      <td className={styles.cell_mono}>{task.taskNo}</td>
      <td>{StocktakingScopeLabel[task.scope]}</td>
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
          {canConfirm && (
            <button
              className={styles.confirm_btn}
              onClick={() => onConfirm(task.id)}
              disabled={confirming}
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
  const { setPageTitle } = useAppStore();
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => { setPageTitle('库存盘点'); }, [setPageTitle]);

  const { data, isLoading, error } = useStocktakingList(page, PAGE_SIZE);
  const createMutation = useCreateStocktaking();
  const confirmMutation = useConfirmStocktaking();

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  // Client-side filter by tab (server doesn't expose status filter in the hook,
  // so we filter the current page result — acceptable for MVP list page)
  const filteredList = (data?.list ?? []).filter((task) =>
    activeTab === 'all' ? true : task.status === activeTab,
  );

  const handleTabChange = useCallback((key: TabKey) => {
    setActiveTab(key);
    setPage(1);
    setExpandedId(null);
  }, []);

  const handleToggle = useCallback((id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleConfirm = useCallback((id: number) => {
    confirmMutation.mutate(id);
  }, [confirmMutation]);

  const handleNewTask = useCallback(() => {
    createMutation.mutate({ scope: 'all' });
  }, [createMutation]);

  const COL_SPAN = 7;

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className={styles.page_header}>
        <h1 className={styles.page_title}>库存盘点</h1>
        <Button
          variant="primary"
          size="md"
          onClick={handleNewTask}
          loading={createMutation.isPending}
        >
          + 新建盘点
        </Button>
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

      {/* 表格 */}
      <div className={styles.table_wrap}>
        <table className={styles.table} aria-label="盘点任务列表">
          <thead>
            <tr>
              <th>任务编号</th>
              <th>盘点范围</th>
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
                    onConfirm={handleConfirm}
                    confirming={confirmMutation.isPending}
                  />
                  {expandedId === task.id && (
                    <DetailRow
                      taskId={task.id}
                      colSpan={COL_SPAN}
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
    </div>
  );
}
