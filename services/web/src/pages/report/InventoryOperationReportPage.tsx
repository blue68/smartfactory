import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useInventoryOperationReport } from '@/api/analytics';
import styles from './InventoryOperationReportPage.module.css';

type RiskLevel = 'high' | 'medium' | 'low' | 'healthy';
type Quadrant = 'core' | 'capital_risk' | 'stagnant_tail' | 'light_fast';
type BubblePoint = {
  skuId: number;
  skuCode: string;
  skuName: string;
  inventoryValue: string;
  turnoverDays: string;
  qtyOnHand: string;
  bubbleSize: number;
  quadrant: Quadrant;
  abcClass: 'A' | 'B' | 'C';
  riskIndex: number;
  riskLevel: RiskLevel;
};

const RISK_LABEL: Record<RiskLevel, string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险',
  healthy: '健康',
};

const RISK_COLOR: Record<RiskLevel, string> = {
  high: '#d9485f',
  medium: '#f59e0b',
  low: '#4f9be6',
  healthy: '#22c55e',
};

const QUADRANT_LABEL: Record<Quadrant, string> = {
  core: '核心动销',
  capital_risk: '资金占压',
  stagnant_tail: '长尾呆滞',
  light_fast: '轻量快动',
};

const QUADRANT_TONE: Record<Quadrant, string> = {
  core: '#e8f4ff',
  capital_risk: '#fff0f0',
  stagnant_tail: '#fff7e8',
  light_fast: '#edfdf2',
};

export default function InventoryOperationReportPage() {
  const { setPageTitle } = useAppStore();
  const [periodDays, setPeriodDays] = useState(90);
  const [quadrantKeyword, setQuadrantKeyword] = useState('');
  const { data, isLoading } = useInventoryOperationReport(periodDays);

  useEffect(() => {
    setPageTitle('库存经营');
  }, [setPageTitle]);

  const donutStyle = useMemo(() => {
    const breakdown = data?.categoryValueBreakdown ?? [];
    if (breakdown.length === 0) {
      return { background: 'conic-gradient(#e2e8f0 0 100%)' };
    }
    const colors = ['#5aa4e8', '#f38b7c', '#f7c85d', '#78b7f7', '#9f8df2', '#44c4a1', '#94a3b8'];
    let cursor = 0;
    const segments = breakdown.slice(0, 7).map((item, idx) => {
      const pct = Number(String(item.pct).replace('%', '')) || 0;
      const start = cursor;
      const end = Math.min(100, cursor + pct);
      cursor = end;
      return `${colors[idx % colors.length]} ${start}% ${end}%`;
    });
    if (cursor < 100) {
      segments.push(`#e2e8f0 ${cursor}% 100%`);
    }
    return { background: `conic-gradient(${segments.join(',')})` };
  }, [data?.categoryValueBreakdown]);

  const filteredQuadrantBubble = useMemo(() => {
    const points = data?.quadrantBubble ?? [];
    const keyword = quadrantKeyword.trim().toLowerCase();
    if (!keyword) return points;
    return points.filter((point) => {
      const skuCode = point.skuCode.toLowerCase();
      const skuName = point.skuName.toLowerCase();
      return skuCode.includes(keyword) || skuName.includes(keyword);
    });
  }, [data?.quadrantBubble, quadrantKeyword]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>库存经营报表</h1>
          <p className={styles.subtitle}>围绕库存资金、周转天数与结构健康度做管理层分析</p>
        </div>
        <div className={styles.filterBar}>
          <label className={styles.filterLabel}>
            统计周期
            <select
              className={styles.select}
              value={periodDays}
              onChange={(e) => setPeriodDays(Number(e.target.value))}
            >
              <option value={30}>近30天</option>
              <option value={60}>近60天</option>
              <option value={90}>近90天</option>
              <option value={180}>近180天</option>
            </select>
          </label>
        </div>
      </div>

      {isLoading ? (
        <div className={styles.loading}>加载中...</div>
      ) : (
        <>
          <div className={styles.kpiGrid}>
            <KpiCard label="库存总价值" value={`¥${Number(data?.summary.totalInventoryValue ?? 0).toLocaleString()}`} />
            <KpiCard label="平均周转天数" value={`${data?.summary.avgTurnoverDays ?? '--'} 天`} />
            <KpiCard label="高风险SKU" value={`${data?.summary.highRiskSkuCount ?? 0}`} />
            <KpiCard label="结构健康度" value={`${data?.structureHealth.score ?? '--'} 分`} />
          </div>

          <div className={styles.gridMajor}>
            <section className={`${styles.panel} ${styles.panelTall}`}>
              <div className={styles.sectionToolbar}>
                <h3 className={styles.panelTitle}>库存资金四象限（气泡｜SKU级）</h3>
                <div className={styles.sectionToolbarActions}>
                  <input
                    className={styles.searchInput}
                    value={quadrantKeyword}
                    onChange={(e) => setQuadrantKeyword(e.target.value)}
                    placeholder="筛选 SKU 编码或名称"
                  />
                  <span className={styles.toolbarMeta}>
                    已显示 {filteredQuadrantBubble.length} / {data?.quadrantBubble?.length ?? 0}
                  </span>
                </div>
              </div>
              <BubbleQuadrantChart
                points={filteredQuadrantBubble}
                thresholdValue={Number(data?.quadrantThresholds.inventoryValue ?? 0)}
                thresholdDays={Number(data?.quadrantThresholds.turnoverDays ?? 0)}
              />
            </section>

            <section className={`${styles.panel} ${styles.panelTall}`}>
              <h3 className={styles.panelTitle}>四象限金额汇总（管理层视角）</h3>
              <div className={styles.quadrantCards}>
                {(data?.quadrantAmountSummary ?? []).map((item) => (
                  <div
                    key={item.quadrant}
                    className={styles.quadrantCard}
                    style={{ background: QUADRANT_TONE[item.quadrant] }}
                  >
                    <div className={styles.quadrantName}>{item.label}</div>
                    <div className={styles.quadrantValue}>¥{Number(item.inventoryValue).toLocaleString()}</div>
                    <div className={styles.quadrantMeta}>{item.pct} · {item.skuCount} SKU</div>
                  </div>
                ))}
              </div>
              <div className={styles.thresholdHint}>
                切分阈值：库存金额中位数 ¥{Number(data?.quadrantThresholds.inventoryValue ?? 0).toLocaleString()}，
                周转天数中位数 {data?.quadrantThresholds.turnoverDays ?? '--'} 天
              </div>
            </section>
          </div>

          <div className={styles.gridThree}>
            <section className={styles.panel}>
              <h3 className={styles.panelTitle}>结构健康度</h3>
              <HealthBars
                rows={[
                  { label: '健康资金占比', value: data?.structureHealth.healthyAmountPct ?? '0%', tone: '#22c55e' },
                  { label: '观察资金占比', value: data?.structureHealth.warningAmountPct ?? '0%', tone: '#f59e0b' },
                  { label: '占压资金占比', value: data?.structureHealth.dangerousAmountPct ?? '0%', tone: '#d9485f' },
                  { label: 'A类风险占比', value: data?.structureHealth.highValueRiskPct ?? '0%', tone: '#7c3aed' },
                ]}
              />
            </section>

            <section className={styles.panel}>
              <h3 className={styles.panelTitle}>风险等级分布</h3>
              <HealthBars
                rows={(data?.riskDistribution ?? []).map((item) => ({
                  label: RISK_LABEL[item.riskLevel],
                  value: item.pct,
                  note: `${item.count} SKU`,
                  tone: RISK_COLOR[item.riskLevel],
                }))}
              />
            </section>

            <section className={styles.panel}>
              <h3 className={styles.panelTitle}>库存价值结构</h3>
              <div className={styles.donutWrap}>
                <div className={styles.donut} style={donutStyle}>
                  <div className={styles.donutCenter}>
                    <span>总价值</span>
                    <strong>¥{Number(data?.summary.totalInventoryValue ?? 0).toLocaleString()}</strong>
                  </div>
                </div>
                <div className={styles.legend}>
                  {(data?.categoryValueBreakdown ?? []).slice(0, 8).map((item) => (
                    <div key={item.categoryName} className={styles.legendItem}>
                      <span>{item.categoryName}</span>
                      <span>{item.pct}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <section className={styles.panel}>
            <h3 className={styles.panelTitle}>风险排行 TOP50榜</h3>
            <RiskTable
              rows={data?.riskLeaderboard ?? []}
              showRank
              showRiskIndex
              showAbc
              showQuadrant
              outboundLabel={`近${periodDays}天出库`}
            />
          </section>

          <div className={styles.gridTwo}>
            <section className={styles.panel}>
              <h3 className={styles.panelTitle}>各品类周转天数</h3>
              <SimpleBars
                rows={(data?.categoryTurnover ?? []).slice(0, 8).map((item) => ({
                  name: item.categoryName,
                  value: Number(item.turnoverDays),
                }))}
                unit="天"
              />
            </section>

            <section className={styles.panel}>
              <h3 className={styles.panelTitle}>核心指标口径说明</h3>
              <ul className={styles.defList}>
                <li>库存总价值 = 库存数量 × 当前采购单价。</li>
                <li>周转天数 = 当前库存量 / 近周期日均出库量；无出库按 999 天处理。</li>
                <li>ABC = 按库存金额累计占比分层：A 前80%，B 80%-95%，C 其余。</li>
                <li>四象限 = 金额高低 × 周转天数高低，切分线采用当前周期 SKU 中位数。</li>
                <li>风险指数 = 周转压力 + 金额权重 + ABC权重 + 象限权重，满分 100。</li>
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.kpiCard}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue}>{value}</div>
    </div>
  );
}

function HealthBars({
  rows,
}: {
  rows: Array<{ label: string; value: string; note?: string; tone: string }>;
}) {
  return (
    <div className={styles.healthBars}>
      {rows.map((row) => {
        const pct = Math.max(0, Math.min(100, Number(row.value.replace('%', '')) || 0));
        return (
          <div key={row.label} className={styles.healthRow}>
            <div className={styles.healthLabel}>{row.label}</div>
            <div className={styles.healthTrack}>
              <div className={styles.healthFill} style={{ width: `${pct}%`, background: row.tone }} />
            </div>
            <div className={styles.healthValue}>
              {row.value}
              {row.note ? ` · ${row.note}` : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SimpleBars({ rows, unit }: { rows: Array<{ name: string; value: number }>; unit: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (rows.length === 0) return <div className={styles.loading}>暂无数据</div>;
  return (
    <div className={styles.barChart}>
      {rows.map((row) => (
        <div key={row.name} className={styles.barRow}>
          <div className={styles.barName}>{row.name}</div>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
          <div className={styles.barVal}>{row.value.toFixed(1)}{unit}</div>
        </div>
      ))}
    </div>
  );
}

function BubbleQuadrantChart({
  points,
  thresholdValue,
  thresholdDays,
}: {
  points: BubblePoint[];
  thresholdValue: number;
  thresholdDays: number;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<BubblePoint | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ left: 0, top: 0 });

  useEffect(() => {
    if (hoveredPoint && !points.some((point) => point.skuId === hoveredPoint.skuId)) {
      setHoveredPoint(null);
    }
  }, [hoveredPoint, points]);

  if (points.length === 0) return <div className={styles.loading}>没有匹配的 SKU</div>;

  const maxX = Math.max(...points.map((point) => Number(point.turnoverDays)), thresholdDays || 1);
  const maxY = Math.max(...points.map((point) => Number(point.inventoryValue)), thresholdValue || 1);
  const visiblePoints = points.slice(0, 140);

  const showTooltipAt = (clientX: number, clientY: number, point: BubblePoint) => {
    const chartRect = chartRef.current?.getBoundingClientRect();
    if (!chartRect) return;

    const tooltipWidth = 240;
    const tooltipHeight = 112;
    const padding = 12;
    const desiredLeft = clientX - chartRect.left + 16;
    const desiredTop = clientY - chartRect.top - tooltipHeight - 12;

    setTooltipPosition({
      left: Math.min(Math.max(padding, desiredLeft), chartRect.width - tooltipWidth - padding),
      top: Math.min(Math.max(padding, desiredTop), chartRect.height - tooltipHeight - padding),
    });
    setHoveredPoint(point);
  };

  const showTooltip = (event: React.MouseEvent<HTMLButtonElement>, point: BubblePoint) => {
    showTooltipAt(event.clientX, event.clientY, point);
  };

  const showTooltipFromBubble = (bubble: HTMLButtonElement, point: BubblePoint) => {
    const rect = bubble.getBoundingClientRect();
    showTooltipAt(rect.left + rect.width / 2, rect.top, point);
  };

  return (
    <div
      ref={chartRef}
      className={styles.bubbleChart}
      onMouseLeave={() => setHoveredPoint(null)}
    >
      <div className={styles.quadrantLabelTl}>核心动销</div>
      <div className={styles.quadrantLabelTr}>资金占压</div>
      <div className={styles.quadrantLabelBl}>轻量快动</div>
      <div className={styles.quadrantLabelBr}>长尾呆滞</div>
      <div
        className={styles.thresholdVertical}
        style={{ left: `${(thresholdDays / maxX) * 100}%` }}
      />
      <div
        className={styles.thresholdHorizontal}
        style={{ bottom: `${(thresholdValue / maxY) * 100}%` }}
      />
      {visiblePoints.map((point) => (
        <button
          key={`${point.skuId}-${point.skuCode}`}
          type="button"
          className={styles.bubble}
          style={{
            left: `${(Number(point.turnoverDays) / maxX) * 100}%`,
            bottom: `${(Number(point.inventoryValue) / maxY) * 100}%`,
            width: `${point.bubbleSize}px`,
            height: `${point.bubbleSize}px`,
            background: `${RISK_COLOR[point.riskLevel]}55`,
            borderColor: RISK_COLOR[point.riskLevel],
          }}
          aria-label={`${point.skuCode} ${point.skuName}`}
          title={`${point.skuCode} | ${point.skuName}`}
          onMouseEnter={(event) => showTooltip(event, point)}
          onMouseMove={(event) => showTooltip(event, point)}
          onFocus={(event) => showTooltipFromBubble(event.currentTarget, point)}
          onBlur={() => setHoveredPoint(null)}
        />
      ))}
      {hoveredPoint ? (
        <div
          className={styles.bubbleTooltip}
          style={{ left: tooltipPosition.left, top: tooltipPosition.top }}
          role="tooltip"
        >
          <div className={styles.bubbleTooltipCode}>{hoveredPoint.skuCode}</div>
          <div className={styles.bubbleTooltipName}>{hoveredPoint.skuName}</div>
          <div className={styles.bubbleTooltipMeta}>
            <span>库存价值 ¥{Number(hoveredPoint.inventoryValue).toLocaleString()}</span>
            <span>周转 {hoveredPoint.turnoverDays} 天</span>
            <span>库存 {hoveredPoint.qtyOnHand}</span>
          </div>
        </div>
      ) : null}
      <div className={styles.axisX}>周转天数</div>
      <div className={styles.axisY}>库存金额</div>
    </div>
  );
}

function RiskTable({
  rows,
  outboundLabel,
  showRank,
  showQuadrant,
  showAbc,
  showRiskIndex,
}: {
  rows: Array<{
    skuId: number;
    skuCode: string;
    skuName: string;
    categoryName: string;
    qtyOnHand: string;
    inventoryValue: string;
    outboundPeriodQty: string;
    lastOutboundDate: string | null;
    stagnantDays: string;
    turnoverDays: string;
    quadrant: Quadrant;
    abcClass: 'A' | 'B' | 'C';
    riskIndex: number;
    riskLevel: RiskLevel;
  }>;
  outboundLabel: string;
  showRank?: boolean;
  showQuadrant?: boolean;
  showAbc?: boolean;
  showRiskIndex?: boolean;
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {showRank ? <th>#</th> : null}
            <th>SKU编码</th>
            <th>SKU名称</th>
            <th>品类</th>
            <th>库存数量</th>
            <th>库存价值</th>
            <th>{outboundLabel}</th>
            <th>最后出库日期</th>
            <th>呆滞天数</th>
            <th>周转天数</th>
            {showQuadrant ? <th>象限</th> : null}
            {showAbc ? <th>ABC</th> : null}
            {showRiskIndex ? <th>风险指数</th> : null}
            <th>风险等级</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={
                  10
                  + (showRank ? 1 : 0)
                  + (showQuadrant ? 1 : 0)
                  + (showAbc ? 1 : 0)
                  + (showRiskIndex ? 1 : 0)
                }
                className={styles.emptyCell}
              >
                暂无数据
              </td>
            </tr>
          ) : rows.map((row, idx) => (
            <tr key={`${row.skuId}-${idx}`}>
              {showRank ? <td>{idx + 1}</td> : null}
              <td>{row.skuCode}</td>
              <td>{row.skuName}</td>
              <td>{row.categoryName}</td>
              <td>{row.qtyOnHand}</td>
              <td>¥{Number(row.inventoryValue).toLocaleString()}</td>
              <td>{row.outboundPeriodQty}</td>
              <td>{row.lastOutboundDate ?? '--'}</td>
              <td>{row.stagnantDays}</td>
              <td>{row.turnoverDays}</td>
              {showQuadrant ? <td>{QUADRANT_LABEL[row.quadrant]}</td> : null}
              {showAbc ? <td>{row.abcClass}</td> : null}
              {showRiskIndex ? <td>{row.riskIndex}</td> : null}
              <td>
                <span
                  className={styles.riskBadge}
                  style={{ background: `${RISK_COLOR[row.riskLevel]}22`, color: RISK_COLOR[row.riskLevel] }}
                >
                  {RISK_LABEL[row.riskLevel]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
