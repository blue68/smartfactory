/**
 * [artifact:前端代码] — 缺料看板页面 (R-11)
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useGenerateMrpSuggestions,
  useShortageReport,
  useShortageSummary,
  useSupplyChainDashboard,
  type ShortageItem,
  type ShortageSummaryItem,
} from '@/api/mrp';
import { useWarehouseOptions, useLocationOptions } from '@/api/inventory';
import { useAppStore } from '@/stores/appStore';
import Button from '@/components/common/Button';
import Table from '@/components/common/Table';
import type { Column } from '@/components/common/Table';
import styles from './ShortageBoard.module.css';

type FocusFilter = 'all' | 'critical' | 'transit' | 'multi';
type Severity = 'critical' | 'warning' | 'stable';

type ShortageRow = ShortageSummaryItem & {
  severity: Severity;
  shortageQtyNum: number;
  availableQtyNum: number;
  inTransitQtyNum: number;
  requiredQtyNum: number;
  coverageGapNum: number;
};

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatQty(value: string | number | null | undefined): string {
  const parsed = toNumber(value);
  if (Number.isInteger(parsed)) return String(parsed);
  return parsed.toFixed(4);
}

function getSeverityLabel(severity: Severity): string {
  return {
    critical: '高优先级',
    warning: '需跟进',
    stable: '已覆盖',
  }[severity];
}

function getSeverityNarrative(row: ShortageRow): string {
  if (row.shortageQtyNum <= 0) return '当前库存可覆盖';
  if (row.inTransitQtyNum >= row.shortageQtyNum) return '在途到货可覆盖缺口';
  if (row.affectedOrderCount >= 3) return '影响多张工单，需优先处置';
  return '需补采或调整排产';
}

function getActionHeadline(row: ShortageRow): string {
  if (row.shortageQtyNum <= 0) return '当前无需动作';
  if (row.inTransitQtyNum >= row.shortageQtyNum) return '优先盯收入库';
  if (row.affectedOrderCount >= 3) return '立即生成采购建议';
  return '补采并协调排产';
}

function buildActionCopy(row: ShortageRow): string {
  if (row.shortageQtyNum <= 0) {
    return '库存与在途已能覆盖当前需求，本页更多用于追踪是否存在新的缺口波动。';
  }
  if (row.inTransitQtyNum >= row.shortageQtyNum) {
    return `当前在途 ${formatQty(row.inTransitQtyNum)} ${row.stockUnit} 已覆盖缺口，建议跟进入库与收货时点。`;
  }
  if (row.affectedOrderCount >= 3) {
    return `该物料同时影响 ${row.affectedOrderCount} 张工单，建议立即补采，并同步排产优先级。`;
  }
  return `当前仍有 ${formatQty(row.coverageGapNum)} ${row.stockUnit} 真实缺口，建议补采并关注交期。`;
}

function deriveSeverity(row: ShortageSummaryItem): Severity {
  const shortageQty = toNumber(row.totalQtyShortage);
  const inTransitQty = toNumber(row.totalQtyInTransit);
  if (shortageQty <= 0) return 'stable';
  if (inTransitQty >= shortageQty) return 'warning';
  if (toNumber(row.affectedOrderCount) >= 3 || shortageQty >= 500) return 'critical';
  return 'warning';
}

export default function ShortageBoard() {
  const navigate = useNavigate();
  const setPageTitle = useAppStore((state) => state.setPageTitle);
  const [keyword, setKeyword] = useState('');
  const [focusFilter, setFocusFilter] = useState<FocusFilter>('all');
  const [warehouseId, setWarehouseId] = useState<number | ''>('');
  const [locationId, setLocationId] = useState<number | ''>('');
  const [onlyDefaultLocation, setOnlyDefaultLocation] = useState(false);
  const [governanceRestoreFilter, setGovernanceRestoreFilter] = useState<{
    warehouseId: number | '';
    locationId: number | '';
  } | null>(null);
  const [selectedSkuId, setSelectedSkuId] = useState<number | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const deferredKeyword = useDeferredValue(keyword.trim().toLowerCase());
  const { data: warehouseOptions = [] } = useWarehouseOptions(true);
  const defaultWarehouse = useMemo(
    () => warehouseOptions.find((item) => item.code === 'DEFAULT') ?? null,
    [warehouseOptions],
  );
  const { data: scopedLocationOptions = [] } = useLocationOptions(
    warehouseId === '' ? undefined : Number(warehouseId),
    true,
  );
  const { data: defaultWarehouseLocations = [] } = useLocationOptions(
    defaultWarehouse?.id,
    true,
  );
  const defaultLocation = useMemo(
    () => defaultWarehouseLocations.find((item) => item.code === 'DEFAULT-UNKNOWN') ?? null,
    [defaultWarehouseLocations],
  );
  const defaultWarehouseId = defaultWarehouse?.id;
  const defaultLocationId = defaultLocation?.id;
  const shortageSummaryQuery = useMemo(
    () => ({
      page: 1,
      pageSize: 200,
      warehouseId: warehouseId === '' ? undefined : Number(warehouseId),
      locationId: locationId === '' ? undefined : Number(locationId),
      onlyDefaultLocation: onlyDefaultLocation || undefined,
    }),
    [locationId, onlyDefaultLocation, warehouseId],
  );

  const { data: summaryData, isLoading } = useShortageSummary(shortageSummaryQuery);
  const { data: dashboardData } = useSupplyChainDashboard();
  const generateSuggestions = useGenerateMrpSuggestions();

  const rows = useMemo<ShortageRow[]>(() => {
    const list = summaryData?.list ?? [];
    return list.map((item) => {
      const requiredQtyNum = toNumber(item.totalQtyRequired);
      const availableQtyNum = toNumber(item.totalQtyAvailable);
      const inTransitQtyNum = toNumber(item.totalQtyInTransit);
      const shortageQtyNum = toNumber(item.totalQtyShortage);
      return {
        ...item,
        requiredQtyNum,
        availableQtyNum,
        inTransitQtyNum,
        shortageQtyNum,
        coverageGapNum: Math.max(shortageQtyNum - inTransitQtyNum, 0),
        severity: deriveSeverity(item),
      };
    });
  }, [summaryData?.list]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const matchesFocus = (() => {
        if (focusFilter === 'critical') return row.severity === 'critical';
        if (focusFilter === 'transit') return row.inTransitQtyNum > 0;
        if (focusFilter === 'multi') return row.affectedOrderCount >= 2;
        return true;
      })();

      if (!matchesFocus) return false;
      if (!deferredKeyword) return true;

      const haystack = [
        row.skuCode,
        row.skuName,
        row.stockUnit,
        row.affectedOrderIds.join(' '),
        getSeverityLabel(row.severity),
        getSeverityNarrative(row),
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(deferredKeyword);
    });
  }, [deferredKeyword, focusFilter, rows]);

  useEffect(() => {
    setPageTitle('缺料看板');
  }, [setPageTitle]);

  useEffect(() => {
    if (!onlyDefaultLocation) return;
    if (!defaultWarehouseId && !defaultLocationId) return;
    if (defaultWarehouseId && warehouseId !== defaultWarehouseId) {
      setWarehouseId(defaultWarehouseId);
    }
    if (defaultLocationId && locationId !== defaultLocationId) {
      setLocationId(defaultLocationId);
    }
  }, [
    defaultLocationId,
    defaultWarehouseId,
    locationId,
    onlyDefaultLocation,
    warehouseId,
  ]);

  useEffect(() => {
    if (!filteredRows.length) {
      setSelectedSkuId(null);
      setSelectedOrderId(null);
      return;
    }
    if (!filteredRows.some((row) => Number(row.skuId) === selectedSkuId)) {
      setSelectedSkuId(Number(filteredRows[0].skuId));
    }
  }, [filteredRows, selectedSkuId]);

  const selectedRow = useMemo(
    () => filteredRows.find((row) => Number(row.skuId) === selectedSkuId) ?? filteredRows[0] ?? null,
    [filteredRows, selectedSkuId],
  );

  useEffect(() => {
    if (!selectedRow) {
      setSelectedOrderId(null);
      return;
    }
    const orderIds = (selectedRow.affectedOrderIds ?? []).map(Number).filter(Boolean);
    if (!orderIds.length) {
      setSelectedOrderId(null);
      return;
    }
    if (!selectedOrderId || !orderIds.includes(selectedOrderId)) {
      setSelectedOrderId(orderIds[0]);
    }
  }, [selectedOrderId, selectedRow]);

  const { data: shortageReport, isLoading: reportLoading } = useShortageReport(selectedOrderId);
  const selectedReportItem = useMemo<ShortageItem | null>(() => {
    if (!selectedRow || !shortageReport?.items?.length) return null;
    return shortageReport.items.find((item) => Number(item.skuId) === Number(selectedRow.skuId)) ?? null;
  }, [selectedRow, shortageReport?.items]);
  const hasPendingSuggestion = Boolean(selectedReportItem?.hasPendingSuggestion);

  const dashboard = (dashboardData ?? {}) as Record<string, unknown>;

  const stats = useMemo(() => {
    const totalShortage = filteredRows.reduce((sum, row) => sum + row.shortageQtyNum, 0);
    const totalInTransit = filteredRows.reduce((sum, row) => sum + row.inTransitQtyNum, 0);
    const criticalCount = filteredRows.filter((row) => row.severity === 'critical').length;
    const transitCoverCount = filteredRows.filter((row) => row.inTransitQtyNum >= row.shortageQtyNum && row.shortageQtyNum > 0).length;
    const affectedOrderCount = new Set(filteredRows.flatMap((row) => row.affectedOrderIds.map(Number))).size;
    return {
      totalSku: filteredRows.length,
      totalShortage,
      totalInTransit,
      criticalCount,
      transitCoverCount,
      affectedOrderCount,
    };
  }, [filteredRows]);

  const focusCounts = useMemo(
    () => ({
      all: rows.length,
      critical: rows.filter((row) => row.severity === 'critical').length,
      transit: rows.filter((row) => row.inTransitQtyNum > 0).length,
      multi: rows.filter((row) => row.affectedOrderCount >= 2).length,
    }),
    [rows],
  );

  const handleRiskSignalClick = useCallback((record: ShortageRow) => {
    setSelectedSkuId(Number(record.skuId));
    const firstOrderId = record.affectedOrderIds.map(Number).find(Boolean) ?? null;
    setSelectedOrderId(firstOrderId);

    if (record.severity === 'critical') {
      setFocusFilter('critical');
      return;
    }
    if (record.inTransitQtyNum > 0) {
      setFocusFilter('transit');
      return;
    }
    if (record.affectedOrderCount >= 2) {
      setFocusFilter('multi');
      return;
    }
    setFocusFilter('all');
  }, []);

  const columns: Column<ShortageRow>[] = useMemo(() => [
    {
      key: 'skuCode',
      title: '缺料物料',
      width: 220,
      render: (_value, record) => (
        <div className={styles.identityCell}>
          <button
            type="button"
            className={styles.identityButton}
            onClick={() => setSelectedSkuId(Number(record.skuId))}
          >
            {record.skuCode}
          </button>
          <div className={styles.identityName}>{record.skuName}</div>
          <div className={styles.identityMeta}>库存单位 {record.stockUnit}</div>
        </div>
      ),
    },
    {
      key: 'totalQtyShortage',
      title: '缺口画像',
      width: 250,
      render: (_value, record) => (
        <div className={styles.metricStack}>
          <div className={styles.metricMain}>
            缺口 <strong>{formatQty(record.totalQtyShortage)}</strong> {record.stockUnit}
          </div>
          <div className={styles.metricSub}>
            需求 {formatQty(record.totalQtyRequired)} · 可用 {formatQty(record.totalQtyAvailable)} · 在途 {formatQty(record.totalQtyInTransit)}
          </div>
        </div>
      ),
    },
    {
      key: 'affectedOrderCount',
      title: '影响范围',
      width: 190,
      render: (_value, record) => (
        <div className={styles.impactCell}>
          <strong>{record.affectedOrderCount} 张工单</strong>
          <div className={styles.orderChips}>
            {record.affectedOrderIds.slice(0, 3).map((orderId) => (
              <span key={orderId} className={styles.orderChip}>工单 #{orderId}</span>
            ))}
            {record.affectedOrderIds.length > 3 ? (
              <span className={styles.orderChipMuted}>+{record.affectedOrderIds.length - 3}</span>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: 'severity',
      title: '风险信号',
      width: 180,
      render: (_value, record) => (
        <div className={styles.riskCell}>
          <button
            type="button"
            className={`${styles.riskBadgeButton} ${styles.riskBadge} ${styles[`riskBadge--${record.severity}`]}`}
            onClick={() => handleRiskSignalClick(record)}
          >
            {getSeverityLabel(record.severity)}
          </button>
          <div className={styles.riskCaption}>{getSeverityNarrative(record)}</div>
        </div>
      ),
    },
    {
      key: 'skuId',
      title: '操作',
      width: 180,
      render: (_value, record) => (
        <div className={styles.actionCell}>
          <Button size="sm" variant="text" onClick={() => setSelectedSkuId(Number(record.skuId))}>
            聚焦
          </Button>
          <Button size="sm" variant="text" onClick={() => navigate('/purchase/purchase-suggestions')}>
            采购建议
          </Button>
        </div>
      ),
    },
  ], [handleRiskSignalClick, navigate]);

  const handleGotoDefaultLocationGovernance = useCallback(() => {
    const params = new URLSearchParams();
    params.set('onlyDefaultLocation', 'true');
    if (defaultWarehouseId) params.set('warehouseId', String(defaultWarehouseId));
    if (defaultLocationId) params.set('locationId', String(defaultLocationId));
    navigate(`/inventory?${params.toString()}`);
  }, [defaultLocationId, defaultWarehouseId, navigate]);

  const enterDefaultLocationMode = useCallback(() => {
    setGovernanceRestoreFilter({
      warehouseId,
      locationId,
    });
    setOnlyDefaultLocation(true);
    setWarehouseId(defaultWarehouseId ?? '');
    setLocationId(defaultLocationId ?? '');
  }, [defaultLocationId, defaultWarehouseId, locationId, warehouseId]);

  const exitDefaultLocationMode = useCallback(() => {
    setOnlyDefaultLocation(false);
    setWarehouseId(governanceRestoreFilter?.warehouseId ?? '');
    setLocationId(governanceRestoreFilter?.locationId ?? '');
    setGovernanceRestoreFilter(null);
  }, [governanceRestoreFilter]);

  const resetFilters = useCallback(() => {
    setKeyword('');
    setFocusFilter('all');
    setOnlyDefaultLocation(false);
    setWarehouseId('');
    setLocationId('');
    setGovernanceRestoreFilter(null);
  }, []);

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}>Material Risk Control</div>
          <h1 className={styles.heroTitle}>缺料指挥台</h1>

          <div className={styles.heroMeta}>
            <div className={styles.heroMetaItem}>
              <span>缺料 SKU</span>
              <strong>{stats.totalSku}</strong>
            </div>
            <div className={styles.heroMetaItem}>
              <span>累计缺口</span>
              <strong>{formatQty(stats.totalShortage)}</strong>
            </div>
            <div className={styles.heroMetaItem}>
              <span>受影响工单</span>
              <strong>{stats.affectedOrderCount}</strong>
            </div>
            <div className={styles.heroMetaItem}>
              <span>在途可缓冲</span>
              <strong>{formatQty(stats.totalInTransit)}</strong>
            </div>
          </div>

          <div className={styles.heroActions}>
            <Button
              variant="primary"
              loading={generateSuggestions.isPending}
              onClick={() => void generateSuggestions.mutateAsync({ forceRegenerate: true })}
            >
              一键生成采购建议
            </Button>
            <Button variant="ghost" onClick={() => navigate('/purchase/purchase-suggestions')}>
              查看采购建议
            </Button>
            <Button variant="ghost" onClick={() => navigate('/inventory')}>
              查看库存总览
            </Button>
          </div>
        </div>

        <aside className={styles.heroSpotlight}>
          <div className={styles.spotlightLabel}>处置策略</div>
          <div className={styles.strategyList}>
            <article className={styles.strategyCard}>
              <strong>立即补采</strong>
              <span>真实缺口无法被在途覆盖，且影响多工单时，优先发起采购建议。</span>
            </article>
            <article className={styles.strategyCard}>
              <strong>盯收入库</strong>
              <span>若在途数量足以覆盖缺口，重点跟送货、质检和入库节点。</span>
            </article>
            <article className={styles.strategyCard}>
              <strong>排产协调</strong>
              <span>当同一物料同时影响多工单时，同步调整优先级，避免产线空转。</span>
            </article>
          </div>
        </aside>
      </section>

      <div className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <span>高优先级</span>
          <strong>{stats.criticalCount}</strong>
          <p>真实缺口无法依赖在途消化，需要主管与采购优先处理。</p>
        </article>
        <article className={styles.summaryCard}>
          <span>在途可覆盖</span>
          <strong>{stats.transitCoverCount}</strong>
          <p>缺料存在，但可通过已下单或已发出的在途数量缓冲。</p>
        </article>
        <article className={styles.summaryCard}>
          <span>待收货采购单</span>
          <strong>{String((dashboard.pendingReceiptPOCount ?? dashboard.inProgressPoCount ?? 0) as number)}</strong>
          <p>来自供应链看板，用于判断是否需要催收入库而不是直接补采。</p>
        </article>
        <article className={styles.summaryCard}>
          <span>缺料工单池</span>
          <strong>{String((dashboard.shortageOrderCount ?? 0) as number)}</strong>
          <p>当前仍处于缺料状态的生产工单数量。</p>
        </article>
      </div>

      <div className={styles.workspace}>
        <section className={styles.mainPanel}>
          <div className={styles.panelHeader}>
            <div>
              <div className={styles.panelTitle}>缺料清单</div>
              <div className={styles.panelDesc}>按风险和受影响工单筛选，快速锁定真正需要采购或催收入库的物料。</div>
            </div>
            <div className={styles.resultMeta}>
              当前展示 {filteredRows.length} / {rows.length} 个缺料 SKU
            </div>
          </div>

          <div className={styles.filterBar}>
            <label className={styles.searchBox}>
              <span className={styles.searchIcon}>⌕</span>
              <input
                className={styles.searchInput}
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索 SKU、物料名称、工单号"
              />
            </label>
            <label className={styles.selectField}>
              <span>仓库</span>
              <select
                className={styles.selectInput}
                value={warehouseId === '' ? '' : String(warehouseId)}
                onChange={(event) => {
                  const next = event.target.value;
                  setWarehouseId(next ? Number(next) : '');
                  setLocationId('');
                  setOnlyDefaultLocation(false);
                }}
                disabled={onlyDefaultLocation}
              >
                <option value="">全部仓库</option>
                {warehouseOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} · {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.selectField}>
              <span>库位</span>
              <select
                className={styles.selectInput}
                value={locationId === '' ? '' : String(locationId)}
                onChange={(event) => {
                  const next = event.target.value;
                  setLocationId(next ? Number(next) : '');
                  setOnlyDefaultLocation(false);
                }}
                disabled={warehouseId === '' || onlyDefaultLocation}
              >
                <option value="">{warehouseId === '' ? '请先选择仓库' : '全部库位'}</option>
                {scopedLocationOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} · {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.toggleField}>
              <input
                type="checkbox"
                checked={onlyDefaultLocation}
                onChange={(event) => {
                  const checked = event.target.checked;
                  if (checked) {
                    enterDefaultLocationMode();
                    return;
                  }
                  exitDefaultLocationMode();
                }}
              />
              仅默认仓位
            </label>
            <Button size="sm" variant="ghost" onClick={handleGotoDefaultLocationGovernance}>
              默认仓位治理
            </Button>
            <Button size="sm" variant="ghost" onClick={resetFilters}>
              重置筛选
            </Button>
          </div>

          {onlyDefaultLocation && (
            <div className={styles.governanceHint} role="status" aria-live="polite">
              <span className={styles.governanceHintText}>
                默认仓位治理模式已开启，
                {defaultWarehouse?.id && defaultLocation?.id
                  ? '当前已锁定 DEFAULT / DEFAULT-UNKNOWN。'
                  : '当前未识别 DEFAULT 主数据，请先核对仓位主数据。'}
              </span>
              <Button size="sm" variant="ghost" onClick={exitDefaultLocationMode}>
                退出治理模式
              </Button>
            </div>
          )}

          <div className={styles.focusTabs}>
            {[
              { key: 'all', label: '全部' },
              { key: 'critical', label: '高优先级' },
              { key: 'transit', label: '在途可覆盖' },
              { key: 'multi', label: '多工单影响' },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                className={`${styles.focusTab} ${focusFilter === item.key ? styles['focusTab--active'] : ''}`}
                onClick={() => setFocusFilter(item.key as FocusFilter)}
              >
                <span>{item.label}</span>
                <strong>{focusCounts[item.key as FocusFilter]}</strong>
              </button>
            ))}
          </div>

          <Table<ShortageRow>
            className={styles.table}
            columns={columns}
            dataSource={filteredRows}
            loading={isLoading}
            rowKey={(record) => String(record.skuId)}
            emptyText="当前没有缺料风险"
            rowClassName={(record) => (
              Number(record.skuId) === Number(selectedRow?.skuId)
                ? styles.rowActive
                : styles[`row--${record.severity}`]
            )}
          />
        </section>

        <aside className={styles.sideRail}>
          <section className={styles.sidePanel}>
            <div className={styles.sidePanelHead}>
              <div>
                <div className={styles.panelTitle}>处置建议</div>
                <div className={styles.panelDesc}>聚焦单个缺料 SKU，查看推荐动作和受影响工单。</div>
              </div>
            </div>

            {selectedRow ? (
              <div className={styles.focusCard}>
                <div className={styles.focusTop}>
                  <div>
                    <div className={styles.focusCode}>{selectedRow.skuCode}</div>
                    <div className={styles.focusName}>{selectedRow.skuName}</div>
                  </div>
                  <span className={`${styles.riskBadge} ${styles[`riskBadge--${selectedRow.severity}`]}`}>
                    {getSeverityLabel(selectedRow.severity)}
                  </span>
                </div>

                <div className={styles.focusHeadline}>{getActionHeadline(selectedRow)}</div>
                <div className={styles.focusCopy}>{buildActionCopy(selectedRow)}</div>

                <div className={styles.focusMetrics}>
                  <div className={styles.focusMetric}>
                    <span>缺口</span>
                    <strong>{formatQty(selectedRow.totalQtyShortage)}</strong>
                  </div>
                  <div className={styles.focusMetric}>
                    <span>可用</span>
                    <strong>{formatQty(selectedRow.totalQtyAvailable)}</strong>
                  </div>
                  <div className={styles.focusMetric}>
                    <span>在途</span>
                    <strong>{formatQty(selectedRow.totalQtyInTransit)}</strong>
                  </div>
                  <div className={styles.focusMetric}>
                    <span>真实待补</span>
                    <strong>{formatQty(selectedRow.coverageGapNum)}</strong>
                  </div>
                </div>

                <div className={styles.focusActions}>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={generateSuggestions.isPending}
                    disabled={hasPendingSuggestion}
                    onClick={() => void generateSuggestions.mutateAsync({
                      productionOrderId: selectedOrderId ?? selectedRow.affectedOrderIds[0],
                      forceRegenerate: true,
                    })}
                  >
                    {hasPendingSuggestion ? '该工单已有待处理采购建议' : '生成该工单采购建议'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => navigate('/purchase/purchase-suggestions')}>
                    打开采购建议
                  </Button>
                </div>

                <div className={`${styles.focusHint} ${hasPendingSuggestion ? styles['focusHint--warn'] : ''}`}>
                  {hasPendingSuggestion
                    ? '该工单当前物料已有待处理采购建议，建议直接进入采购建议页跟进审批、下单或执行状态。'
                    : '当前工单下该物料尚未生成待处理采购建议，可从这里直接发起。'}
                </div>
              </div>
            ) : (
              <div className={styles.emptyBox}>暂无缺料数据</div>
            )}
          </section>

          <section className={styles.sidePanel}>
            <div className={styles.sidePanelHead}>
              <div>
                <div className={styles.panelTitle}>受影响工单</div>
                <div className={styles.panelDesc}>选中工单后，会联动展示该工单下当前物料的缺料明细。</div>
              </div>
            </div>

            {selectedRow?.affectedOrderIds?.length ? (
              <>
                <div className={styles.orderChipRow}>
                  {selectedRow.affectedOrderIds.map((orderId) => (
                    <button
                      key={orderId}
                      type="button"
                      className={`${styles.orderSelectChip} ${selectedOrderId === Number(orderId) ? styles['orderSelectChip--active'] : ''}`}
                      onClick={() => setSelectedOrderId(Number(orderId))}
                    >
                      工单 #{orderId}
                    </button>
                  ))}
                </div>

                {reportLoading ? (
                  <div className={styles.emptyBox}>正在加载工单缺料详情...</div>
                ) : selectedReportItem ? (
                  <div className={styles.orderDetail}>
                    <div className={styles.orderDetailHeader}>
                      <strong>{shortageReport?.workOrderNo ?? `工单 #${selectedOrderId}`}</strong>
                      <span className={styles.orderStatus}>
                        {shortageReport?.materialStatus === 'shortage' ? '严重缺料' : shortageReport?.materialStatus ?? '—'}
                      </span>
                    </div>

                    <div className={styles.orderMetricGrid}>
                      <div className={styles.orderMetric}><span>需求数量</span><strong>{formatQty(selectedReportItem.qtyRequired)}</strong></div>
                      <div className={styles.orderMetric}><span>缺口数量</span><strong>{formatQty(selectedReportItem.qtyShortage)}</strong></div>
                      <div className={styles.orderMetric}><span>可用库存</span><strong>{formatQty(selectedReportItem.qtyAvailable)}</strong></div>
                      <div className={styles.orderMetric}><span>采购单位</span><strong>{selectedReportItem.purchaseUnit ?? selectedRow.stockUnit}</strong></div>
                    </div>

                    <div className={styles.orderNarrative}>
                      {selectedReportItem.hasPendingSuggestion
                        ? '该工单下当前物料已有待处理采购建议，建议优先跟进审批与下单。'
                        : '该工单下当前物料尚无待处理采购建议，可从本页直接触发生成。'}
                    </div>

                    <div className={styles.detailActions}>
                      <Button size="sm" variant="text" onClick={() => navigate('/production/orders')}>
                        查看生产工单
                      </Button>
                      <Button size="sm" variant="text" onClick={() => navigate('/purchase/orders')}>
                        查看采购订单
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.emptyBox}>当前工单下暂无该物料的缺料明细。</div>
                )}
              </>
            ) : (
              <div className={styles.emptyBox}>当前物料暂无受影响工单。</div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
