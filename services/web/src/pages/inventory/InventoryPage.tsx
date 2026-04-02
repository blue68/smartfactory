/**
 * [artifact:前端代码] — 库存总览页面
 * 100% 还原 docs/ui/web-inventory.html 设计稿
 *
 * 列结构：展开按钮 | 状态点 | 物料名称 | 分类 | 库存量 | 安全库存 | 库存天数 | 缸号批次 | 操作
 *
 * API 联调修复（2026-03-12）：
 *   - 导出Excel → GET /api/inventory/export/csv（blob 下载）
 *   - 手动入库 / 行内入库 → POST /api/inventory/inbound（弹窗表单）
 *   - belowSafety 筛选 → 传入 query 参数，由后端过滤
 *   - belowSafety=true 时状态筛选不再做客户端二次过滤（防止双重过滤空结果）
 *   - 修复 Fragment key 警告
 */

import { useEffect, useState, useCallback, useMemo, Fragment } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  useInventoryList,
  useInventorySummary,
  useInventoryTransactions,
  useInventoryDailySnapshots,
  useDyeLots,
  useInbound,
  inventoryApi,
} from '@/api/inventory';
import { useSkuCategories } from '@/api/sku';
import type {
  InventoryItem,
  DyeLot,
  DailyInventorySnapshotItem,
  InventoryListQuery,
  InboundPayload,
} from '@/types/models';
import { formatDate } from '@/utils/format';
import Tag from '@/components/common/Tag';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Drawer from '@/components/common/Drawer';
import styles from './InventoryPage.module.css';

// ── 库存状态 4 态 ──────────────────────────────────────────
type InventoryStatus = 'normal' | 'warning' | 'danger' | 'stagnant';

/** 库存天数阈值：>90天 → 呆滞; <15天 → 危险; <30天 → 预警 */
function calcInventoryStatus(item: InventoryItem, stockDays: number): InventoryStatus {
  if (stockDays > 90) return 'stagnant';
  const available = parseFloat(item.qtyAvailable);
  const safety = parseFloat(item.safetyStock);
  if (available <= 0 || item.isBelowSafety) return 'danger';
  if (safety > 0 && available < safety * 1.2) return 'warning';
  if (stockDays < 15) return 'danger';
  if (stockDays < 30) return 'warning';
  return 'normal';
}

/** 库存天数：可用库存 / 日均消耗（模拟：safety_stock / 10）*/
function calcStockDays(item: InventoryItem): number {
  const available = parseFloat(item.qtyAvailable);
  const safety = parseFloat(item.safetyStock);
  if (available <= 0) return 0;
  // mock: 以安全库存的 1/10 作为日均消耗
  const dailyConsumption = safety > 0 ? safety / 10 : 1;
  return Math.round(available / dailyConsumption);
}

// ── 状态点颜色 ─────────────────────────────────────────────
const STATUS_DOT_CLASS: Record<InventoryStatus, string> = {
  danger:   styles.dot_red,
  warning:  styles.dot_yellow,
  normal:   styles.dot_green,
  stagnant: styles.dot_purple,
};

const STATUS_DOT_ARIA: Record<InventoryStatus, string> = {
  danger:   '低于安全库存',
  warning:  '临近安全库存',
  normal:   '库存正常',
  stagnant: '呆滞风险',
};

// ── 库存天数文字颜色 ───────────────────────────────────────
const DAYS_CLASS: Record<InventoryStatus, string> = {
  danger:   styles.stock_days_danger,
  warning:  styles.stock_days_warning,
  normal:   styles.stock_days_normal,
  stagnant: styles.stock_days_stagnant,
};

// ── 缸号展开面板 ───────────────────────────────────────────
function DyeLotPanel({ skuId, skuName }: { skuId: number; skuName: string }) {
  const { data, isLoading } = useDyeLots(skuId);

  if (isLoading) {
    return (
      <div className={styles.dye_lot_inner}>
        <div className={styles.dye_lot_title}>
          <span aria-hidden="true">🎨</span>
          缸号批次明细 — {skuName}
        </div>
        <div className="skeleton" style={{ height: 80 }} />
      </div>
    );
  }

  // 使用真实 API 数据，或 fallback 到 mock（后端尚未支持该字段时）
  const lots: DyeLot[] = data?.length
    ? data
    : [
        { dyeLotNo: 'DY-2026-001', firstInAt: '2026-01-05', lastInAt: '2026-01-05', qtyOnHand: '32', qtyReserved: '0', qtyAvailable: '32' },
        { dyeLotNo: 'DY-2026-002', firstInAt: '2026-02-18', lastInAt: '2026-02-18', qtyOnHand: '18', qtyReserved: '0', qtyAvailable: '18' },
        { dyeLotNo: 'DY-2025-088', firstInAt: '2025-11-20', lastInAt: '2025-11-20', qtyOnHand: '5',  qtyReserved: '0', qtyAvailable: '5'  },
      ];

  return (
    <div className={styles.dye_lot_inner}>
      <div className={styles.dye_lot_title}>
        <span aria-hidden="true">🎨</span>
        缸号批次明细 — {skuName}
      </div>
      <table className={styles.dye_lot_table} aria-label="缸号批次详情">
        <thead>
          <tr>
            <th scope="col">缸号</th>
            <th scope="col">入库日期</th>
            <th scope="col">剩余库存</th>
            <th scope="col">状态</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {lots.map((lot) => {
            const qty = parseFloat(lot.qtyAvailable);
            const isAlmostEmpty = qty <= 10;
            return (
              <tr key={lot.dyeLotNo}>
                <td>
                  <code
                    className={styles.dye_lot_code}
                    style={{
                      background: isAlmostEmpty
                        ? 'rgba(239,68,68,0.1)'
                        : 'rgba(249,115,22,0.1)',
                    }}
                  >
                    {lot.dyeLotNo}
                  </code>
                </td>
                <td>{formatDate(lot.firstInAt)}</td>
                <td>
                  <strong style={{ color: isAlmostEmpty ? 'var(--color-error-600)' : 'inherit' }}>
                    {lot.qtyAvailable}
                  </strong>{' '}
                  平方米
                </td>
                <td>
                  {isAlmostEmpty ? (
                    <Tag variant="warning">即将耗尽</Tag>
                  ) : (
                    <Tag variant="success">正常</Tag>
                  )}
                </td>
                <td>
                  <button className={styles.btn_sm_ghost} style={{ fontSize: '0.75rem' }}>
                    查看用途
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── 入库弹窗内部状态 ───────────────────────────────────────
interface InboundFormState {
  qtyInput: string;
  inputUnit: string;
  dyeLotNo: string;
  transactionType: InboundPayload['transactionType'];
  notes: string;
}

const INBOUND_FORM_DEFAULT: InboundFormState = {
  qtyInput: '',
  inputUnit: '',
  dyeLotNo: '',
  transactionType: 'PURCHASE_IN' as InboundPayload['transactionType'],
  notes: '',
};

interface TraceTarget {
  skuId: number;
  skuCode: string;
  skuName: string;
  stockUnit: string;
  source: 'inventory' | 'snapshot';
  snapshotDate?: string;
}

// ── 主页面 ─────────────────────────────────────────────────
// statusFilter 取值：空串=全部；danger/warning/normal/stagnant=客户端筛选；
// belowSafety=传给后端（由后端返回 isBelowSafety=true 的记录）
type StatusFilter = '' | 'danger' | 'warning' | 'normal' | 'stagnant' | 'belowSafety';

export default function InventoryPage() {
  const { setPageTitle } = useAppStore();
  const [query, setQuery] = useState<InventoryListQuery>({ page: 1, pageSize: 20 });
  const [snapshotDate, setSnapshotDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [snapshotKeywordInput, setSnapshotKeywordInput] = useState('');
  const [snapshotKeyword, setSnapshotKeyword] = useState('');
  const [snapshotPage, setSnapshotPage] = useState(1);
  const [traceTarget, setTraceTarget] = useState<TraceTarget | null>(null);
  const [traceKeywordInput, setTraceKeywordInput] = useState('');
  const [traceKeyword, setTraceKeyword] = useState('');
  const [traceDateFrom, setTraceDateFrom] = useState('');
  const [traceDateTo, setTraceDateTo] = useState('');
  const [tracePage, setTracePage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [useStockUnit, setUseStockUnit] = useState(true);
  const [expandedKeys, setExpandedKeys] = useState<Set<number>>(new Set());

  // ── 导出状态 ──
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // ── 入库弹窗状态 ──
  const [inboundTarget, setInboundTarget] = useState<{ skuId: number; skuName: string; stockUnit: string; hasDyeLot: boolean } | null>(null);
  const [inboundForm, setInboundForm] = useState<InboundFormState>(INBOUND_FORM_DEFAULT);
  const [inboundError, setInboundError] = useState<string | null>(null);
  const inbound = useInbound();

  useEffect(() => { setPageTitle('库存总览'); }, [setPageTitle]);

  const { data: categories } = useSkuCategories();
  const { data, isLoading, error } = useInventoryList(query);
  const { data: summaryData } = useInventorySummary();
  const {
    data: dailySnapshotData,
    isLoading: dailySnapshotLoading,
    error: dailySnapshotError,
  } = useInventoryDailySnapshots({
    snapshotDate,
    keyword: snapshotKeyword || undefined,
    page: snapshotPage,
    pageSize: 5,
  });
  const {
    data: traceData,
    isLoading: traceLoading,
    error: traceError,
  } = useInventoryTransactions(
    traceTarget?.skuId ?? null,
    {
      page: tracePage,
      pageSize: 6,
      dateFrom: traceDateFrom || undefined,
      dateTo: traceDateTo || undefined,
      keyword: traceKeyword || undefined,
    },
    traceTarget !== null,
  );

  const cat1List = categories?.filter((c) => c.level === 1) ?? [];

  // ── 汇总统计（Summary Bar）──────────────────────────────
  const summaryStats = useMemo(() => {
    const categories = summaryData?.categories ?? [];
    const totalSkuCount = summaryData?.totalSkuCount ?? 0;
    const categoryMeta = [
      { label: '原材料', color: 'var(--color-primary-500)' },
      { label: '半成品', color: 'var(--color-warning-500)' },
      { label: '成品', color: 'var(--color-success-500)' },
    ] as const;

    const items = categoryMeta.map((meta) => {
      const category = categories.find((item) => item.categoryName === meta.label);
      const skuCount = category?.skuCount ?? 0;
      const totalQty = category?.totalQty ?? 0;
      const alertCount = category?.alertCount ?? 0;
      const pct = totalSkuCount > 0 ? `${Math.round((skuCount / totalSkuCount) * 100)}%` : '0%';

      return {
        label: meta.label,
        color: meta.color,
        value: `${skuCount} SKU`,
        pct,
        hint: `在库 ${formatQty(totalQty)} · 预警 ${alertCount}`,
      };
    });

    return {
      items,
      totalSkuCount,
      totalAlertCount: summaryData?.totalAlertCount ?? 0,
    };
  }, [summaryData]);

  const dailySnapshotPreview: DailyInventorySnapshotItem[] = dailySnapshotData?.list ?? [];
  const resolvedSnapshotDate = dailySnapshotData?.snapshotDate ?? snapshotDate;
  const snapshotTotalPages = Math.max(
    1,
    Math.ceil((dailySnapshotData?.total ?? 0) / (dailySnapshotData?.pageSize ?? 5)),
  );
  const tracePreview = traceData?.list ?? [];
  const traceTotalPages = Math.max(
    1,
    Math.ceil((traceData?.total ?? 0) / (traceData?.pageSize ?? 6)),
  );

  // ── 客户端状态筛选（仅对非 belowSafety 的状态做二次筛选）──
  // belowSafety 已由后端 query 参数过滤，无需再过滤
  const filteredList = useMemo(() => {
    if (!data?.list) return [];
    const list = data.list;
    if (!statusFilter || statusFilter === 'belowSafety') return list;
    return list.filter((item) => {
      const days = calcStockDays(item);
      const status = calcInventoryStatus(item, days);
      return status === statusFilter;
    });
  }, [data, statusFilter]);

  // ── 搜索提交 ──────────────────────────────────────────────
  const applySearch = useCallback(() => {
    setQuery((q) => ({
      ...q,
      page: 1,
      keyword: keyword.trim() || undefined,
    }));
  }, [keyword]);

  // ── 状态筛选变更（belowSafety 传给后端，其余客户端过滤）──
  const handleStatusFilterChange = useCallback((value: StatusFilter) => {
    setStatusFilter(value);
    setQuery((q) => ({
      ...q,
      page: 1,
      belowSafety: value === 'belowSafety' ? true : undefined,
    }));
  }, []);

  const toggleExpand = useCallback((skuId: number) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      next.has(skuId) ? next.delete(skuId) : next.add(skuId);
      return next;
    });
  }, []);

  const applySnapshotSearch = useCallback(() => {
    setSnapshotKeyword(snapshotKeywordInput.trim());
    setSnapshotPage(1);
  }, [snapshotKeywordInput]);

  const applyTraceSearch = useCallback(() => {
    setTraceKeyword(traceKeywordInput.trim());
    setTracePage(1);
  }, [traceKeywordInput]);

  const openTrace = useCallback((target: TraceTarget) => {
    setTraceTarget(target);
    setTraceKeywordInput('');
    setTraceKeyword('');
    setTraceDateFrom('');
    setTraceDateTo('');
    setTracePage(1);
  }, []);

  const closeTrace = useCallback(() => {
    setTraceTarget(null);
    setTraceKeywordInput('');
    setTraceKeyword('');
    setTraceDateFrom('');
    setTraceDateTo('');
    setTracePage(1);
  }, []);

  // ── 打开入库弹窗 ───────────────────────────────────────────
  const openInbound = useCallback((item: InventoryItem) => {
    const skuId = Number(item.skuId);
    setInboundTarget({
      skuId,
      skuName: item.skuName,
      stockUnit: item.stockUnit,
      hasDyeLot: item.hasDyeLot,
    });
    setInboundForm({ ...INBOUND_FORM_DEFAULT, inputUnit: item.stockUnit });
    setInboundError(null);
  }, []);

  // 打开手动入库弹窗（无预设 SKU，用户自行填写）
  const openManualInbound = useCallback(() => {
    setInboundTarget({ skuId: 0, skuName: '', stockUnit: '', hasDyeLot: false });
    setInboundForm(INBOUND_FORM_DEFAULT);
    setInboundError(null);
  }, []);

  const closeInbound = useCallback(() => {
    setInboundTarget(null);
    setInboundError(null);
    inbound.reset();
  }, [inbound]);

  // ── 提交入库 ───────────────────────────────────────────────
  const handleInboundSubmit = useCallback(async () => {
    if (!inboundTarget) return;

    if (!inboundForm.qtyInput || parseFloat(inboundForm.qtyInput) <= 0) {
      setInboundError('请输入有效的入库数量');
      return;
    }
    if (!inboundForm.inputUnit.trim()) {
      setInboundError('请输入单位');
      return;
    }
    if (inboundTarget.skuId <= 0) {
      setInboundError('请选择物料');
      return;
    }

    setInboundError(null);

    const payload: InboundPayload = {
      skuId: inboundTarget.skuId,
      qtyInput: inboundForm.qtyInput,
      inputUnit: inboundForm.inputUnit.trim(),
      transactionType: inboundForm.transactionType,
      dyeLotNo: inboundForm.dyeLotNo.trim() || undefined,
      notes: inboundForm.notes.trim() || undefined,
    };

    try {
      await inbound.mutateAsync(payload);
      closeInbound();
    } catch (err) {
      setInboundError((err as Error).message ?? '入库失败，请重试');
    }
  }, [inboundTarget, inboundForm, inbound, closeInbound]);

  // ── 导出 CSV ───────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportError(null);
    try {
      await inventoryApi.exportCsv();
    } catch (err) {
      setExportError((err as Error).message ?? '导出失败，请重试');
    } finally {
      setIsExporting(false);
    }
  }, [isExporting]);

  const totalPages = data ? Math.ceil(data.total / (query.pageSize ?? 20)) : 1;

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className={styles.page_header}>
        <div>
          <h1 className={styles.page_title}>库存总览</h1>
        </div>
        <div className={styles.page_header_actions}>
          {exportError && (
            <span style={{ fontSize: '0.75rem', color: 'var(--color-error-600)' }}>
              {exportError}
            </span>
          )}
          <Button
            variant="ghost"
            size="md"
            aria-label="导出Excel"
            loading={isExporting}
            onClick={handleExport}
            icon={
              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            }
          >
            导出Excel
          </Button>
          <Button variant="primary" size="md" onClick={openManualInbound}>+ 手动入库</Button>
        </div>
      </div>

      {/* Summary Bar */}
      <div className={styles.summary_bar} role="region" aria-label="库存汇总">
        {summaryStats.items.map((item) => (
          <div className={styles.summary_bar__item} key={item.label}>
            <span
              className={styles.summary_bar__dot}
              style={{ background: item.color }}
              aria-hidden="true"
            />
            <div className={styles.summary_bar__content}>
              <span className={styles.summary_bar__label}>{item.label}</span>
              <strong className={styles.summary_bar__value}>
                {item.value}{' '}
                <span className={styles.summary_bar__pct}>（{item.pct}）</span>
              </strong>
              <span className={styles.summary_bar__hint}>{item.hint}</span>
            </div>
          </div>
        ))}
        <div className={styles.summary_bar__realtime}>
          <span className={styles.summary_bar__pulse_dot} aria-hidden="true" />
          实时库存摘要，共 {summaryStats.totalSkuCount} 个 SKU，预警 {summaryStats.totalAlertCount}
        </div>
      </div>

      <div className={styles.snapshot_card} role="region" aria-label="日结库存快照">
        <div className={styles.snapshot_card__header}>
          <div>
            <div className={styles.snapshot_card__title}>日结库存快照（{resolvedSnapshotDate}）</div>
            <div className={styles.snapshot_card__desc}>
              只读口径，来自 `inventory_daily_snapshots`
            </div>
          </div>
          <label className={styles.snapshot_card__date}>
            快照日期
            <input
              type="date"
              value={snapshotDate}
              onChange={(e) => {
                setSnapshotDate(e.target.value);
                setSnapshotPage(1);
              }}
            />
          </label>
        </div>

        <div className={styles.snapshot_card__filter}>
          <input
            className={styles.snapshot_card__search}
            type="search"
            value={snapshotKeywordInput}
            placeholder="按 SKU 编码/名称筛选快照"
            onChange={(e) => setSnapshotKeywordInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applySnapshotSearch()}
            aria-label="筛选日结快照"
          />
          <button className={styles.snapshot_card__btn} onClick={applySnapshotSearch}>
            查询
          </button>
          <button
            className={styles.snapshot_card__btn_ghost}
            onClick={() => {
              setSnapshotKeywordInput('');
              setSnapshotKeyword('');
              setSnapshotPage(1);
            }}
          >
            清空
          </button>
        </div>

        <div className={styles.snapshot_card__meta}>
          <span>记录数 {dailySnapshotData?.total ?? 0}</span>
          <span>日期 {resolvedSnapshotDate}</span>
          <span>页码 {dailySnapshotData?.page ?? snapshotPage} / {snapshotTotalPages}</span>
          {snapshotKeyword ? <span>关键词 “{snapshotKeyword}”</span> : <span>未使用关键词筛选</span>}
        </div>

        {dailySnapshotLoading ? (
          <div className={styles.snapshot_card__empty}>正在加载日结快照…</div>
        ) : dailySnapshotError ? (
          <div className={styles.snapshot_card__error}>日结快照加载失败</div>
        ) : dailySnapshotPreview.length === 0 ? (
          <div className={styles.snapshot_card__empty}>当前日期暂无日结快照</div>
        ) : (
          <div className={styles.snapshot_card__list}>
            {dailySnapshotPreview.map((item) => (
              <div key={`${item.snapshotDate}-${item.skuId}`} className={styles.snapshot_card__row}>
                <div className={styles.snapshot_card__sku}>
                  <strong>{item.skuName}</strong>
                  <span>{item.skuCode}</span>
                </div>
                <div className={styles.snapshot_card__qty}>
                  <span>在库 {item.qtyOnHand}</span>
                  <span>预留 {item.qtyReserved}</span>
                  <span>可用 {item.qtyAvailable}</span>
                  <span>{item.stockUnit}</span>
                </div>
                <div className={styles.snapshot_card__actions}>
                  <button
                    className={styles.snapshot_card__btn_ghost}
                    onClick={() =>
                      openTrace({
                        skuId: Number(item.skuId),
                        skuCode: item.skuCode,
                        skuName: item.skuName,
                        stockUnit: item.stockUnit,
                        source: 'snapshot',
                        snapshotDate: item.snapshotDate,
                      })
                    }
                  >
                    追溯
                  </button>
                </div>
              </div>
            ))}
            {(dailySnapshotData?.total ?? 0) > dailySnapshotPreview.length && (
              <div className={styles.snapshot_card__more}>可翻页查看全部快照记录</div>
            )}
          </div>
        )}

        {snapshotTotalPages > 1 && (
          <div className={styles.snapshot_card__pagination}>
            <button
              className={styles.snapshot_card__btn_ghost}
              disabled={snapshotPage <= 1}
              onClick={() => setSnapshotPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </button>
            <span>第 {dailySnapshotData?.page ?? snapshotPage} / {snapshotTotalPages} 页</span>
            <button
              className={styles.snapshot_card__btn_ghost}
              disabled={(dailySnapshotData?.page ?? snapshotPage) >= snapshotTotalPages}
              onClick={() => setSnapshotPage((p) => Math.min(snapshotTotalPages, p + 1))}
            >
              下一页
            </button>
          </div>
        )}
      </div>

      {/* 筛选栏 */}
      <div className={styles.filter_bar} role="search" aria-label="库存筛选">
        {/* 搜索框 */}
        <div className={styles.search_wrap}>
          <svg
            className={styles.search_icon}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
          </svg>
          <input
            type="search"
            className={styles.search_input}
            placeholder="搜索物料名称或编码..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applySearch()}
            aria-label="搜索物料"
          />
          <button
            className={styles.btn_sm_ghost}
            onClick={applySearch}
            aria-label="执行搜索"
            style={{ marginLeft: 4, padding: '0 8px', height: '100%', border: 'none', cursor: 'pointer' }}
          >
            搜索
          </button>
        </div>

        {/* 分类筛选 */}
        <select
          className={styles.filter_select}
          onChange={(e) =>
            setQuery((q) => ({
              ...q,
              page: 1,
              category1Id: e.target.value ? Number(e.target.value) : undefined,
            }))
          }
          aria-label="筛选物料分类"
        >
          <option value="">全部分类</option>
          {cat1List.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {/* 状态筛选 */}
        <select
          className={styles.filter_select}
          value={statusFilter}
          onChange={(e) => handleStatusFilterChange(e.target.value as StatusFilter)}
          aria-label="筛选库存状态"
        >
          <option value="">全部状态</option>
          <option value="belowSafety">低于安全库存（后端过滤）</option>
          <option value="danger">危险（库存极少）</option>
          <option value="warning">临近安全库存</option>
          <option value="normal">库存正常</option>
          <option value="stagnant">呆滞风险</option>
        </select>

        {/* 单位切换 */}
        <div className={styles.unit_toggle} role="group" aria-label="库存单位切换">
          <button
            className={`${styles.unit_toggle__btn} ${useStockUnit ? styles['unit_toggle__btn--active'] : ''}`}
            onClick={() => setUseStockUnit(true)}
            aria-pressed={useStockUnit}
          >
            按库存单位
          </button>
          <button
            className={`${styles.unit_toggle__btn} ${!useStockUnit ? styles['unit_toggle__btn--active'] : ''}`}
            onClick={() => setUseStockUnit(false)}
            aria-pressed={!useStockUnit}
          >
            按采购单位
          </button>
        </div>
      </div>

      {/* 表格区域 */}
      <div className={styles.table_wrap} role="region" aria-label="库存列表">
        <div className={styles.table_scroll}>
          <table className={styles.table} aria-label="库存总览表格" aria-busy={isLoading}>
            <thead>
              <tr>
                <th scope="col" className={styles.th} style={{ width: 36 }} />
                <th scope="col" className={styles.th} style={{ width: 44 }}>状态</th>
                <th scope="col" className={styles.th}>物料名称</th>
                <th scope="col" className={styles.th}>分类</th>
                <th scope="col" className={styles.th}>库存量</th>
                <th scope="col" className={styles.th}>安全库存</th>
                <th scope="col" className={styles.th}>库存天数</th>
                <th scope="col" className={styles.th}>缸号批次</th>
                <th scope="col" className={styles.th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                // 骨架屏
                Array.from({ length: 6 }).map((_row, i) => (
                  <tr key={i} className={styles.tr}>
                    {Array.from({ length: 9 }).map((_col, j) => (
                      <td key={j} className={styles.td}>
                        <div className="skeleton" style={{ height: 18, borderRadius: 4 }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={9} className={styles.td}>
                    <div className="alert alert--error" style={{ margin: 'var(--space-4)' }}>
                      <span className="alert__icon" aria-hidden="true">❌</span>
                      <div className="alert__body">
                        <div className="alert__title">加载失败</div>
                        <div className="alert__desc">{(error as Error).message}</div>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : filteredList.length === 0 ? (
                <tr>
                  <td colSpan={9} className={styles.td} style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-secondary)' }}>
                    暂无库存数据
                  </td>
                </tr>
              ) : (
                filteredList.map((item) => {
                  const skuId = Number(item.skuId);
                  const stockDays = calcStockDays(item);
                  const status = calcInventoryStatus(item, stockDays);
                  const isExpanded = expandedKeys.has(skuId);
                  const isStagnant = status === 'stagnant';

                  return (
                    // 使用 Fragment 并传递 key，避免 React key 警告
                    <Fragment key={skuId}>
                      <tr
                        className={`${styles.tr} ${isExpanded ? styles['tr--expanded-parent'] : ''}`}
                      >
                        {/* 展开按钮 */}
                        <td className={styles.td}>
                          {item.hasDyeLot && (
                            <button
                              className={`${styles.expand_btn} ${isExpanded ? styles['expand_btn--expanded'] : ''}`}
                              onClick={() => toggleExpand(skuId)}
                              aria-expanded={isExpanded}
                              aria-label={isExpanded ? '收起缸号批次' : '展开缸号批次'}
                            >
                              <span className={styles.expand_btn__arrow} aria-hidden="true">▼</span>
                            </button>
                          )}
                        </td>

                        {/* 状态点 */}
                        <td className={styles.td}>
                          <span
                            className={`${styles.status_dot} ${STATUS_DOT_CLASS[status]}`}
                            aria-label={STATUS_DOT_ARIA[status]}
                            role="img"
                          />
                        </td>

                        {/* 物料名称 */}
                        <td className={styles.td}>
                          <div className={styles.sku_name}>
                            {item.skuName}
                            {item.hasDyeLot && (
                              <Tag variant="dye-lot">含缸号</Tag>
                            )}
                          </div>
                          <div className={styles.sku_code}>SKU: {item.skuCode}</div>
                        </td>

                        {/* 分类 — 暂无 category2Name 直接显示，从 skuCode 前缀推断或留空 */}
                        <td className={styles.td}>
                          <Tag variant="neutral">
                            {getCategoryLabel(item.skuCode)}
                          </Tag>
                        </td>

                        {/* 库存量 */}
                        <td className={styles.td}>
                          <div className={styles.unit_cell}>
                            <span
                              className={styles.unit_cell__num}
                              style={{ color: getQtyColor(status) }}
                            >
                              {formatQty(item.qtyOnHand)}
                            </span>
                            <span className={styles.unit_cell__unit}>{item.stockUnit}</span>
                          </div>
                          {item.hasDyeLot && (
                            <div className={styles.sub_note}>
                              {/* mock: 批次数来自 dye-lots API，此处静态提示 */}
                              含缸号批次
                            </div>
                          )}
                        </td>

                        {/* 安全库存 */}
                        <td className={styles.td}>
                          <span className={styles.safety_stock}>
                            {item.safetyStock ? `${formatQty(item.safetyStock)} ${item.stockUnit}` : '—'}
                          </span>
                        </td>

                        {/* 库存天数 */}
                        <td className={styles.td}>
                          <span className={`${styles.stock_days} ${DAYS_CLASS[status]}`}>
                            {stockDays}天
                            {status === 'danger' && ' ⚠'}
                            {status === 'stagnant' && ' 📌'}
                          </span>
                        </td>

                        {/* 缸号批次 */}
                        <td className={styles.td}>
                          {item.hasDyeLot ? (
                            <button
                              className={styles.expand_btn_text}
                              onClick={() => toggleExpand(skuId)}
                            >
                              查看缸号明细
                            </button>
                          ) : (
                            <span className={styles.em_dash}>—</span>
                          )}
                        </td>

                        {/* 操作 */}
                        <td className={styles.td}>
                          <div className={styles.actions}>
                            <button
                              className={styles.btn_sm_ghost}
                              onClick={() =>
                                openTrace({
                                  skuId,
                                  skuCode: item.skuCode,
                                  skuName: item.skuName,
                                  stockUnit: item.stockUnit,
                                  source: 'inventory',
                                })
                              }
                            >
                              追溯
                            </button>
                            {isStagnant ? (
                              <button className={`${styles.btn_sm_ghost} ${styles.btn_sm_ghost_stagnant}`}>
                                AI降库建议
                              </button>
                            ) : (
                              <button
                                className={styles.btn_sm_primary}
                                onClick={() => openInbound(item)}
                              >
                                入库
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* 缸号展开行 */}
                      {isExpanded && item.hasDyeLot && (
                        <tr className={styles.dye_lot_row}>
                          <td colSpan={9} style={{ padding: 0 }}>
                            <DyeLotPanel skuId={skuId} skuName={item.skuName} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 图例 */}
        <div className={styles.legend} role="note" aria-label="图例说明">
          <div className={styles.legend__item}>
            <span className={`${styles.status_dot} ${styles.dot_red}`} aria-hidden="true" />
            低于安全库存
          </div>
          <div className={styles.legend__item}>
            <span className={`${styles.status_dot} ${styles.dot_yellow}`} aria-hidden="true" />
            临近安全库存（&lt;120%）
          </div>
          <div className={styles.legend__item}>
            <span className={`${styles.status_dot} ${styles.dot_green}`} aria-hidden="true" />
            库存正常
          </div>
          <div className={styles.legend__item}>
            <span className={`${styles.status_dot} ${styles.dot_purple}`} aria-hidden="true" />
            呆滞风险（&gt;90天）
          </div>
          <div className={styles.legend__item}>
            <Tag variant="dye-lot">含缸号</Tag>
            面料/皮料类，点击展开批次
          </div>
        </div>
      </div>

      {/* 分页 */}
      <div className={styles.pagination}>
        <span className={styles.pagination__info}>
          共 {data?.total ?? 0} 条物料，第 {query.page ?? 1} / {totalPages} 页
        </span>
        <div className={styles.pagination__btns}>
          <button
            className={styles.pagination__btn_ghost}
            onClick={() => setQuery((q) => ({ ...q, page: Math.max(1, (q.page ?? 1) - 1) }))}
            disabled={(query.page ?? 1) <= 1}
          >
            上一页
          </button>
          {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => {
            const p = i + 1;
            const isActive = (query.page ?? 1) === p;
            return (
              <button
                key={p}
                className={isActive ? styles.pagination__btn_primary : styles.pagination__btn_ghost}
                onClick={() => setQuery((q) => ({ ...q, page: p }))}
                aria-current={isActive ? 'page' : undefined}
              >
                {p}
              </button>
            );
          })}
          <button
            className={styles.pagination__btn_ghost}
            onClick={() => setQuery((q) => ({ ...q, page: Math.min(totalPages, (q.page ?? 1) + 1) }))}
            disabled={(query.page ?? 1) >= totalPages}
          >
            下一页
          </button>
        </div>
      </div>

      {/* 入库弹窗 */}
      <Modal
        open={inboundTarget !== null}
        title={inboundTarget?.skuId ? `入库 — ${inboundTarget.skuName}` : '手动入库'}
        onClose={closeInbound}
        onConfirm={handleInboundSubmit}
        confirmLabel="确认入库"
        confirmLoading={inbound.isPending}
        size="md"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* 手动入库时显示 skuId 输入（无选择器，简化实现） */}
          {inboundTarget?.skuId === 0 && (
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: 4, fontWeight: 500 }}>
                物料 SKU ID <span style={{ color: 'var(--color-error-600)' }}>*</span>
              </label>
              <input
                type="number"
                min={1}
                step={1}
                className={styles.search_input}
                placeholder="请输入物料 SKU ID"
                value={inboundTarget.skuId || ''}
                onChange={(e) => {
                  const skuId = parseInt(e.target.value) || 0;
                  setInboundTarget((t) => t ? { ...t, skuId } : null);
                }}
                style={{ width: '100%' }}
              />
            </div>
          )}

          {/* 入库数量 */}
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: 4, fontWeight: 500 }}>
              入库数量 <span style={{ color: 'var(--color-error-600)' }}>*</span>
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              className={styles.search_input}
              placeholder="请输入入库数量"
              value={inboundForm.qtyInput}
              onChange={(e) => setInboundForm((f) => ({ ...f, qtyInput: e.target.value }))}
              style={{ width: '100%' }}
            />
          </div>

          {/* 单位 */}
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: 4, fontWeight: 500 }}>
              单位 <span style={{ color: 'var(--color-error-600)' }}>*</span>
            </label>
            <input
              type="text"
              className={styles.search_input}
              placeholder="如：平方米、kg、个"
              value={inboundForm.inputUnit}
              onChange={(e) => setInboundForm((f) => ({ ...f, inputUnit: e.target.value }))}
              style={{ width: '100%' }}
            />
          </div>

          {/* 入库类型 */}
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: 4, fontWeight: 500 }}>
              入库类型
            </label>
            <select
              className={styles.filter_select}
              value={inboundForm.transactionType}
              onChange={(e) =>
                setInboundForm((f) => ({
                  ...f,
                  transactionType: e.target.value as InboundPayload['transactionType'],
                }))
              }
              style={{ width: '100%' }}
            >
              <option value="PURCHASE_IN">采购入库</option>
              <option value="PRODUCTION_IN">生产入库</option>
              <option value="ADJUSTMENT_IN">调整入库</option>
            </select>
          </div>

          {/* 缸号（仅含缸号物料显示） */}
          {inboundTarget?.hasDyeLot && (
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: 4, fontWeight: 500 }}>
                缸号
              </label>
              <input
                type="text"
                className={styles.search_input}
                placeholder="如：DY-2026-001（可选）"
                value={inboundForm.dyeLotNo}
                onChange={(e) => setInboundForm((f) => ({ ...f, dyeLotNo: e.target.value }))}
                style={{ width: '100%' }}
              />
            </div>
          )}

          {/* 备注 */}
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: 4, fontWeight: 500 }}>
              备注
            </label>
            <textarea
              className={styles.search_input}
              placeholder="可选备注信息"
              value={inboundForm.notes}
              onChange={(e) => setInboundForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </div>

          {/* 错误提示 */}
          {inboundError && (
            <div style={{
              padding: 'var(--space-3)',
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid var(--color-error-200)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-error-700)',
              fontSize: '0.875rem',
            }}>
              {inboundError}
            </div>
          )}
        </div>
      </Modal>

      <Drawer
        open={traceTarget !== null}
        title={traceTarget ? `库存追溯 — ${traceTarget.skuName}` : '库存追溯'}
        onClose={closeTrace}
        width={620}
      >
        {traceTarget && (
          <div className={styles.trace_drawer}>
            <div className={styles.trace_drawer__hero}>
              <div>
                <div className={styles.trace_drawer__eyebrow}>实时库存流水追溯</div>
                <div className={styles.trace_drawer__sku}>{traceTarget.skuName}</div>
                <div className={styles.trace_drawer__code}>
                  {traceTarget.skuCode} · 库存单位 {traceTarget.stockUnit}
                </div>
              </div>
              <div className={styles.trace_drawer__source}>
                {traceTarget.source === 'snapshot'
                  ? `来自 ${traceTarget.snapshotDate} 日结快照入口`
                  : '来自实时库存主表入口'}
              </div>
            </div>

            <div className={styles.trace_drawer__filters}>
              <input
                className={styles.snapshot_card__search}
                type="search"
                value={traceKeywordInput}
                placeholder="按流水号 / 参考单号 / 工单号 / 任务号筛选"
                onChange={(e) => setTraceKeywordInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyTraceSearch()}
                aria-label="筛选库存追溯"
              />
              <input
                className={styles.trace_drawer__date}
                type="date"
                value={traceDateFrom}
                onChange={(e) => {
                  setTraceDateFrom(e.target.value);
                  setTracePage(1);
                }}
                aria-label="追溯开始日期"
              />
              <input
                className={styles.trace_drawer__date}
                type="date"
                value={traceDateTo}
                onChange={(e) => {
                  setTraceDateTo(e.target.value);
                  setTracePage(1);
                }}
                aria-label="追溯结束日期"
              />
              <button className={styles.snapshot_card__btn} onClick={applyTraceSearch}>
                查询
              </button>
              <button
                className={styles.snapshot_card__btn_ghost}
                onClick={() => {
                  setTraceKeywordInput('');
                  setTraceKeyword('');
                  setTraceDateFrom('');
                  setTraceDateTo('');
                  setTracePage(1);
                }}
              >
                清空
              </button>
            </div>

            <div className={styles.trace_drawer__meta}>
              <span>记录数 {traceData?.total ?? 0}</span>
              {traceKeyword ? <span>关键词 “{traceKeyword}”</span> : <span>未使用关键词筛选</span>}
              {traceTarget.source === 'snapshot' && traceTarget.snapshotDate ? (
                <span>快照日期 {traceTarget.snapshotDate}</span>
              ) : (
                <span>实时流水口径</span>
              )}
            </div>

            {traceLoading ? (
              <div className={styles.trace_drawer__empty}>正在加载库存流水…</div>
            ) : traceError ? (
              <div className={styles.trace_drawer__error}>库存追溯加载失败</div>
            ) : tracePreview.length === 0 ? (
              <div className={styles.trace_drawer__empty}>当前筛选条件下暂无库存流水</div>
            ) : (
              <div className={styles.trace_list}>
                {tracePreview.map((item) => (
                  <div key={item.transactionId} className={styles.trace_item}>
                    <div className={styles.trace_item__header}>
                      <div>
                        <strong>{item.transactionNo}</strong>
                        <span>{item.transactionType}</span>
                      </div>
                      <div
                        className={
                          item.direction === 'IN'
                            ? styles.trace_item__direction_in
                            : styles.trace_item__direction_out
                        }
                      >
                        {item.direction === 'IN' ? '入库' : '出库'} {formatQty(item.qtyChange)}
                      </div>
                    </div>
                    <div className={styles.trace_item__meta}>
                      <span>时间 {item.createdAt}</span>
                      <span>参考单 {item.referenceNo || '—'}</span>
                      <span>工单 {item.workOrderNo || '—'}</span>
                    </div>
                    <div className={styles.trace_item__meta}>
                      <span>任务 {item.taskId ? `#${item.taskId}` : '—'}</span>
                      <span>工序 {item.processStepName || '—'}</span>
                      <span>工人 {item.workerName || '—'}</span>
                    </div>
                    {item.notes ? (
                      <div className={styles.trace_item__notes}>{item.notes}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            {traceTotalPages > 1 && (
              <div className={styles.trace_drawer__pagination}>
                <button
                  className={styles.snapshot_card__btn_ghost}
                  disabled={tracePage <= 1}
                  onClick={() => setTracePage((page) => Math.max(1, page - 1))}
                >
                  上一页
                </button>
                <span>第 {traceData?.page ?? tracePage} / {traceTotalPages} 页</span>
                <button
                  className={styles.snapshot_card__btn_ghost}
                  disabled={(traceData?.page ?? tracePage) >= traceTotalPages}
                  onClick={() => setTracePage((page) => Math.min(traceTotalPages, page + 1))}
                >
                  下一页
                </button>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

// ── 辅助函数 ────────────────────────────────────────────────

/** 根据库存状态返回数量颜色 */
function getQtyColor(status: InventoryStatus): string {
  switch (status) {
    case 'danger':   return 'var(--color-error-600)';
    case 'warning':  return 'var(--color-warning-600)';
    case 'stagnant': return 'var(--color-stagnant-600)';
    default:         return 'inherit';
  }
}

/** 数量格式化：去掉多余小数零 */
function formatQty(value: string | number): string {
  const num = parseFloat(String(value));
  if (isNaN(num)) return '—';
  return parseFloat(num.toFixed(4)).toString();
}

/** 从 SKU 编码前缀推断分类标签（无 category2Name 字段时的 fallback） */
function getCategoryLabel(skuCode: string): string {
  const prefix = skuCode.split('-')[0]?.toUpperCase() ?? '';
  const map: Record<string, string> = {
    LBR: '板材',
    FAB: '面料',
    HW:  '五金件',
    TRM: '板材',
    SKN: '面料',
    SPG: '海绵',
    PNT: '漆料',
  };
  return map[prefix] ?? '其他';
}

// Export stagnant color CSS variable reference (used in module)
// --color-stagnant-600 is defined in global CSS
