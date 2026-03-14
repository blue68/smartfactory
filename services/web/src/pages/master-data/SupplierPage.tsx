/**
 * [artifact:前端代码] — 供应商管理页
 * 100% 对齐 web-supplier-manage.html 设计规范
 *
 * 列结构：等级 | 供应商名称+联系人 | 主供品类 | 准时交货率 | 质量异常率 | 账期 | 操作
 * Header 操作区：绩效对比 | 导出 | + 新增供应商
 * 统计摘要栏：总数 | A级(🥇) | B级(🥈) | C级(🥉) | 预警提示
 * 新增供应商 Drawer：分三节（基础信息/合作条款/其他）
 * 绩效对比 Modal：横向柱状图 + AI 建议块
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@/stores/appStore';
import {
  useSupplierList,
  useCreateSupplier,
  useUpdateSupplier,
  useSupplierSkus,
  useSupplierPriceAgreements,
  useSupplierPerformance,
} from '@/api/supplier';
import type {
  Supplier,
  SupplierRating,
  SupplierListQuery,
  CreateSupplierPayload,
  SupplierRelatedSku,
  SupplierPriceAgreement,
  SupplierPerformance,
} from '@/api/supplier';
import { usePriceHistory, useCreatePrice } from '@/api/price';
import type { PriceHistoryItem } from '@/api/price';
import { useSkuList } from '@/api/sku';
import type { Sku } from '@/types/models';
import type { Column } from '@/components/common/Table';
import Table from '@/components/common/Table';
import Drawer from '@/components/common/Drawer';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import styles from './SupplierPage.module.css';

// ─────────────────────────────────────────────
// 常量与辅助类型
// ─────────────────────────────────────────────

type SupplierRecord = Supplier & {
  /** 主供品类（暂 mock，后端返回后直接使用） */
  category?: string;
  /** 质量异常率 0–100，如 1.2 表示 1.2% */
  qualityRate?: number;
  [key: string]: unknown;
};

const RATING_OPTIONS: SupplierRating[] = ['A', 'B', 'C', 'D'];

// CATEGORY_OPTIONS 由实际供应商数据动态生成

// ─────────────────────────────────────────────
// 子组件：等级徽章
// ─────────────────────────────────────────────

function GradeBadge({ rating }: { rating: SupplierRating }) {
  const cls =
    rating === 'A' ? styles.gradeBadgeA
    : rating === 'B' ? styles.gradeBadgeB
    : rating === 'C' ? styles.gradeBadgeC
    : styles.gradeBadgeD;
  return <span className={`${styles.gradeBadge} ${cls}`}>{rating}</span>;
}

// ─────────────────────────────────────────────
// 子组件：准时率进度条
// ─────────────────────────────────────────────

function RateBar({ pct }: { pct: number }) {
  const tier = pct >= 80 ? 'high' : pct >= 65 ? 'mid' : 'low';
  const fillCls =
    tier === 'high' ? styles.rateBarFillHigh
    : tier === 'mid' ? styles.rateBarFillMid
    : styles.rateBarFillLow;
  const valCls =
    tier === 'high' ? styles.rateValueHigh
    : tier === 'mid' ? styles.rateValueMid
    : styles.rateValueLow;
  return (
    <div className={styles.rateBar}>
      <div className={styles.rateBarTrack}>
        <div className={`${styles.rateBarFill} ${fillCls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`${styles.rateValue} ${valCls}`}>{pct}%</span>
    </div>
  );
}

// ─────────────────────────────────────────────
// 子组件：质量异常率单元格
// ─────────────────────────────────────────────

function QualityRateCell({ rate }: { rate: number }) {
  const isExceed = rate > 5;
  const isWarn = !isExceed && rate > 3;
  const cls = isExceed ? styles.qualityRateBad : isWarn ? styles.qualityRateWarn : styles.qualityRateGood;
  return (
    <span>
      <span className={cls}>{rate.toFixed(1)}%</span>
      {isExceed && <span className={styles.qualityExceedTag}>超预警</span>}
    </span>
  );
}

// ─────────────────────────────────────────────
// FE-02-04: Compare button 3-state
// ─────────────────────────────────────────────

const MAX_COMPARE = 3;

/** Returns which compare-state a supplier row is in */
function getCompareState(
  supplierId: number,
  selectedIds: number[],
): 'not-selected' | 'selected' | 'max-reached' {
  if (selectedIds.includes(supplierId)) return 'selected';
  if (selectedIds.length >= MAX_COMPARE) return 'max-reached';
  return 'not-selected';
}

export function CompareToggleButton({
  supplierId,
  selectedIds,
  onToggle,
}: {
  supplierId: number;
  selectedIds: number[];
  onToggle: (id: number) => void;
}) {
  const state = getCompareState(supplierId, selectedIds);

  if (state === 'selected') {
    return (
      <button
        type="button"
        className={styles.compareBtnSelected}
        onClick={() => onToggle(supplierId)}
        aria-pressed="true"
      >
        ✓ 已加入
      </button>
    );
  }
  if (state === 'max-reached') {
    return (
      <button
        type="button"
        className={styles.compareBtnDisabled}
        disabled
        aria-disabled="true"
      >
        对比已满
      </button>
    );
  }
  return (
    <button
      type="button"
      className={styles.compareBtnDefault}
      onClick={() => onToggle(supplierId)}
      aria-pressed="false"
    >
      加入对比
    </button>
  );
}

// ─────────────────────────────────────────────
// FE-02-05: Data anomaly marker
// ─────────────────────────────────────────────

function AnomalyIcon({ deviationPct }: { deviationPct: number }) {
  const [tooltipVisible, setTooltipVisible] = React.useState(false);
  return (
    <span
      className={styles.anomalyIconWrap}
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
    >
      <span className={styles.anomalyIcon}>⚠</span>
      {tooltipVisible && (
        <span className={styles.anomalyTooltip}>
          价格偏差 {deviationPct.toFixed(0)}%，超过均值 20%
        </span>
      )}
    </span>
  );
}

// ─────────────────────────────────────────────
// FE-02-02: SVG Radar Chart
// ─────────────────────────────────────────────

const RADAR_AXES = ['准时交货率', '价格竞争力', '质量合格率', '响应速度', '订单完成率', '服务评分'];
const COMPARE_COLORS = ['#3B82F6', '#F97316', '#22C55E', '#8B5CF6', '#F43F5E'];
const RADAR_SIZE = 220;
const RADAR_CENTER = RADAR_SIZE / 2;
const RADAR_RADIUS = 88;
const RADAR_LEVELS = 5;

function polarToXY(angleDeg: number, r: number, cx: number, cy: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

interface RadarSupplierData {
  name: string;
  scores: number[]; // 0-100 for each axis
}

function RadarChart({ suppliers }: { suppliers: RadarSupplierData[] }) {
  const n = RADAR_AXES.length;
  const angleStep = 360 / n;

  // Build grid polygon points for each level
  const gridPolygons = Array.from({ length: RADAR_LEVELS }, (_, lvl) => {
    const r = (RADAR_RADIUS * (lvl + 1)) / RADAR_LEVELS;
    const pts = Array.from({ length: n }, (__, i) => {
      const { x, y } = polarToXY(i * angleStep, r, RADAR_CENTER, RADAR_CENTER);
      return `${x},${y}`;
    }).join(' ');
    return pts;
  });

  // Axis lines
  const axisLines = Array.from({ length: n }, (_, i) => {
    const { x, y } = polarToXY(i * angleStep, RADAR_RADIUS, RADAR_CENTER, RADAR_CENTER);
    return { x, y };
  });

  // Labels
  const labels = Array.from({ length: n }, (_, i) => {
    const { x, y } = polarToXY(i * angleStep, RADAR_RADIUS + 22, RADAR_CENTER, RADAR_CENTER);
    return { label: RADAR_AXES[i], x, y };
  });

  // Supplier polygons
  const supplierPolygons = suppliers.map((sup, si) => {
    const pts = sup.scores.map((score, i) => {
      const r = (score / 100) * RADAR_RADIUS;
      const { x, y } = polarToXY(i * angleStep, r, RADAR_CENTER, RADAR_CENTER);
      return `${x},${y}`;
    }).join(' ');
    return { pts, color: COMPARE_COLORS[si % COMPARE_COLORS.length], name: sup.name };
  });

  return (
    <div className={styles.radarWrap}>
      <svg width={RADAR_SIZE} height={RADAR_SIZE} viewBox={`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`} aria-label="供应商雷达图">
        {/* Grid polygons */}
        {gridPolygons.map((pts, lvl) => (
          <polygon
            key={lvl}
            points={pts}
            fill="none"
            stroke="var(--border-default)"
            strokeWidth={0.8}
          />
        ))}

        {/* Axis lines */}
        {axisLines.map(({ x, y }, i) => (
          <line
            key={i}
            x1={RADAR_CENTER} y1={RADAR_CENTER}
            x2={x} y2={y}
            stroke="var(--border-default)"
            strokeWidth={0.8}
          />
        ))}

        {/* Supplier data polygons */}
        {supplierPolygons.map(({ pts, color }, si) => (
          <polygon
            key={si}
            points={pts}
            fill={color}
            fillOpacity={0.15}
            stroke={color}
            strokeWidth={2}
          />
        ))}

        {/* Axis labels */}
        {labels.map(({ label, x, y }, i) => (
          <text
            key={i}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={9}
            fill="var(--text-secondary)"
          >
            {label}
          </text>
        ))}
      </svg>

      {/* Legend */}
      <div className={styles.radarLegend}>
        {suppliers.map((sup, si) => (
          <div key={si} className={styles.radarLegendItem}>
            <span
              className={styles.radarLegendDot}
              style={{ background: COMPARE_COLORS[si % COMPARE_COLORS.length] }}
            />
            <span>{sup.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// FE-02-03: SVG Line Chart (price trend)
// ─────────────────────────────────────────────

interface LineChartSeries {
  name: string;
  data: number[]; // monthly values
}

const CHART_W = 320;
const CHART_H = 160;
const CHART_PAD = { top: 16, right: 16, bottom: 28, left: 44 };

function LineChart({ series, labels }: { series: LineChartSeries[]; labels: string[] }) {
  const allValues = series.flatMap((s) => s.data).filter((v) => v > 0);
  const maxVal = allValues.length > 0 ? Math.ceil(Math.max(...allValues) / 10) * 10 : 100;
  const minVal = 0;

  const innerW = CHART_W - CHART_PAD.left - CHART_PAD.right;
  const innerH = CHART_H - CHART_PAD.top - CHART_PAD.bottom;
  const n = labels.length;

  const toX = (i: number) => CHART_PAD.left + (i / (n - 1)) * innerW;
  const toY = (v: number) => CHART_PAD.top + innerH - ((v - minVal) / (maxVal - minVal)) * innerH;

  const yTicks = 4;

  return (
    <div className={styles.lineChartWrap}>
      <svg width="100%" viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ overflow: 'visible' }} aria-label="价格趋势折线图">
        {/* Y-axis ticks */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const val = minVal + (maxVal - minVal) * (i / yTicks);
          const y = toY(val);
          return (
            <g key={i}>
              <line x1={CHART_PAD.left} y1={y} x2={CHART_PAD.left + innerW} y2={y} stroke="var(--border-default)" strokeWidth={0.5} />
              <text x={CHART_PAD.left - 4} y={y} textAnchor="end" dominantBaseline="middle" fontSize={8} fill="var(--text-secondary)">
                {val.toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* X-axis labels */}
        {labels.map((lbl, i) => (
          <text key={i} x={toX(i)} y={CHART_H - 4} textAnchor="middle" fontSize={8} fill="var(--text-secondary)">
            {lbl}
          </text>
        ))}

        {/* Series lines */}
        {series.map((s, si) => {
          const color = COMPARE_COLORS[si % COMPARE_COLORS.length];
          const points = s.data.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
          const hasData = s.data.some((v) => v > 0);
          return (
            <g key={si}>
              <polyline
                points={points}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeDasharray={hasData ? undefined : '6,4'}
                opacity={hasData ? 1 : 0.5}
              />
              {s.data.map((v, i) => (
                v > 0 && (
                  <circle key={i} cx={toX(i)} cy={toY(v)} r={3} fill={color} />
                )
              ))}
            </g>
          );
        })}
      </svg>

      {/* Line legend */}
      <div className={styles.radarLegend}>
        {series.map((s, si) => (
          <div key={si} className={styles.radarLegendItem}>
            <span className={styles.radarLegendLine} style={{ background: COMPARE_COLORS[si % COMPARE_COLORS.length] }} />
            <span>{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// FE-02-01: Stats Summary Bar (for compare section)
// ─────────────────────────────────────────────

interface CompareSupplier {
  id: number;
  name: string;
  onTime: number;
  quality: number;
  price: number; // lower is better
  scores: number[];
}

function CompareSummaryBar({ suppliers }: { suppliers: CompareSupplier[] }) {
  const highest = suppliers.reduce((best, s) => {
    const scoreA = (s.onTime + (100 - s.quality * 10) + (100 - s.price)) / 3;
    const scoreB = (best.onTime + (100 - best.quality * 10) + (100 - best.price)) / 3;
    return scoreA > scoreB ? s : best;
  }, suppliers[0]);

  const lowestPrice = suppliers.reduce((best, s) => (s.price < best.price ? s : best), suppliers[0]);

  return (
    <div className={styles.compareSummaryBar}>
      <div className={styles.compareSummaryCard}>
        <span className={styles.compareSummaryIcon} style={{ background: 'var(--color-primary-50)', color: 'var(--color-primary-600)' }}>
          🏢
        </span>
        <div>
          <div className={styles.compareSummaryLabel}>选中供应商数</div>
          <div className={styles.compareSummaryValue}>{suppliers.length}</div>
        </div>
      </div>
      <div className={styles.compareSummaryCard}>
        <span className={styles.compareSummaryIcon} style={{ background: 'var(--color-success-50)', color: 'var(--color-success-600)' }}>
          🏆
        </span>
        <div>
          <div className={styles.compareSummaryLabel}>综合评分最高</div>
          <div className={styles.compareSummaryValue}>{highest?.name ?? '—'}</div>
        </div>
      </div>
      <div className={styles.compareSummaryCard}>
        <span className={styles.compareSummaryIcon} style={{ background: 'var(--color-accent-50)', color: 'var(--color-accent-600)' }}>
          💰
        </span>
        <div>
          <div className={styles.compareSummaryLabel}>价格最优</div>
          <div className={styles.compareSummaryValue}>{lowestPrice?.name ?? '—'}</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 子组件：绩效对比 Modal（横向柱状图 + Radar + Line）
// ─────────────────────────────────────────────

type PerfModalProps = {
  open: boolean;
  onClose: () => void;
  compareIds: number[];
  suppliers: SupplierRecord[];
};

const PERF_DATA = [
  { name: '华森木业 (A)', onTime: 96, quality: 1.2 },
  { name: '明辉五金 (A)', onTime: 94, quality: 0.8 },
  { name: '广州板材 (B)', onTime: 82, quality: 3.5 },
  { name: '联鑫材料 (B)', onTime: 78, quality: 6.2 },
  { name: '顺达包材 (C)', onTime: 65, quality: 2.8 },
];

function HBarRow({
  label,
  pct,
  valLabel,
  tier,
  warningAt,
  warningLabel,
  tagLabel,
  valOut,
}: {
  label: string;
  pct: number;
  valLabel: string;
  tier: 'good' | 'mid' | 'warn';
  warningAt?: number;
  warningLabel?: string;
  tagLabel?: string;
  valOut?: boolean;
}) {
  const fillCls =
    tier === 'good' ? styles.hbarFillGood
    : tier === 'mid' ? styles.hbarFillMid
    : styles.hbarFillWarn;

  return (
    <div className={styles.hbarRow}>
      <div className={styles.hbarLabel}>{label}</div>
      <div className={styles.hbarTrack} style={{ position: 'relative' }}>
        {warningAt != null && (
          <div className={styles.hbarWarningLine} style={{ left: `${warningAt}%` }}>
            {warningLabel && (
              <div className={styles.hbarWarningLabel}>{warningLabel}</div>
            )}
          </div>
        )}
        <div className={`${styles.hbarFill} ${fillCls}`} style={{ width: `${pct}%` }}>
          {!valOut && <span className={styles.hbarFillVal}>{valLabel}</span>}
          {valOut && (
            <span
              className={styles.hbarFillValOut}
              style={{ left: `calc(${pct}% + 8px)` }}
            >
              {valLabel}
            </span>
          )}
        </div>
      </div>
      {tagLabel && <span className={styles.hbarTag}>{tagLabel}</span>}
    </div>
  );
}

function PerfModal({ open, onClose, compareIds, suppliers }: PerfModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const [period, setPeriod] = useState('近3个月');

  if (!open) return null;

  // Build compare supplier data: use selected ids if any, otherwise fallback to PERF_DATA
  const compareSuppliers: CompareSupplier[] = compareIds.length > 0
    ? compareIds.slice(0, MAX_COMPARE).map((id, idx) => {
        const s = suppliers.find((sp) => sp.id === id);
        const perfEntry = PERF_DATA[idx % PERF_DATA.length];
        return {
          id,
          name: s?.name ?? perfEntry.name,
          onTime: typeof (s as Record<string, unknown> | undefined)?.['onTimeRate'] === 'number'
            ? ((s as Record<string, unknown>)['onTimeRate'] as number)
            : perfEntry.onTime,
          quality: typeof s?.qualityRate === 'number' ? s.qualityRate : perfEntry.quality,
          price: 100 - idx * 8, // mock relative price score
          scores: [
            perfEntry.onTime,
            100 - idx * 5,
            100 - perfEntry.quality * 10,
            80 + idx * 4,
            perfEntry.onTime - 5,
            90 - idx * 3,
          ],
        };
      })
    : PERF_DATA.slice(0, 3).map((d, idx) => ({
        id: idx,
        name: d.name,
        onTime: d.onTime,
        quality: d.quality,
        price: 100 - idx * 8,
        scores: [d.onTime, 90 - idx * 5, 100 - d.quality * 10, 82, d.onTime - 4, 88 - idx * 3],
      }));

  const radarSuppliers: RadarSupplierData[] = compareSuppliers.map((cs) => ({
    name: cs.name,
    scores: cs.scores,
  }));

  // Mock monthly price trend data (6 months)
  const priceMonths = ['10月', '11月', '12月', '1月', '2月', '3月'];
  const priceSeries: LineChartSeries[] = compareSuppliers.map((cs, idx) => ({
    name: cs.name,
    data: priceMonths.map((_, mi) => {
      const base = 120 - idx * 10;
      return base + (mi % 3 === 0 ? 5 : mi % 3 === 1 ? -3 : 2);
    }),
  }));

  // Price anomaly mock: supplier index 1 has anomaly (>20% from avg)
  const avgPrices = priceSeries[0]?.data ?? [];
  const avgPriceAvg = avgPrices.length > 0
    ? avgPrices.reduce((a, b) => a + b, 0) / avgPrices.length
    : 100;

  return createPortal(
    <div
      className={`${styles.perfOverlay} ${styles.perfOverlayOpen}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="compare-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={styles.perfModal}>
        <div className={styles.perfModalHeader}>
          <div className={styles.perfModalTitle} id="compare-title">
            供应商绩效对比
            <span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 8 }}>
              已选 {compareSuppliers.length} 家
            </span>
          </div>
          <select
            className={styles.perfPeriodSelect}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            <option>近3个月</option>
            <option>近6个月</option>
            <option>近12个月</option>
          </select>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="关闭对比弹框">✕ 关闭</Button>
        </div>

        <div className={styles.perfModalBody}>
          {/* FE-02-01: Stats summary bar */}
          <CompareSummaryBar suppliers={compareSuppliers} />

          {/* Charts: Radar + Line in two columns */}
          <div className={styles.compareChartsGrid}>
            {/* FE-02-02: Radar chart */}
            <div className={styles.compareChartCard}>
              <div className={styles.perfSectionTitle}>多维雷达对比</div>
              <RadarChart suppliers={radarSuppliers} />
            </div>

            {/* FE-02-03: Line chart price trend */}
            <div className={styles.compareChartCard}>
              <div className={styles.perfSectionTitle}>月度采购价格趋势</div>
              <LineChart series={priceSeries} labels={priceMonths} />
            </div>
          </div>

          {/* 准时交货率对比 */}
          <div>
            <div className={styles.perfSectionTitle}>准时交货率对比</div>
            <div className={styles.hbarChart}>
              {compareSuppliers.map((d) => {
                const tier = d.onTime >= 80 ? 'good' : d.onTime >= 65 ? 'mid' : 'warn';
                const isLow = d.onTime < 60;
                // FE-02-05: anomaly check — flag if quality rate is >20% above average
                const avgQuality = compareSuppliers.reduce((s, c) => s + c.quality, 0) / compareSuppliers.length;
                const deviationPct = avgQuality > 0 ? ((d.quality - avgQuality) / avgQuality) * 100 : 0;
                const hasAnomaly = deviationPct > 20;
                return (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <HBarRow
                      label={d.name}
                      pct={d.onTime}
                      valLabel={`${d.onTime}%`}
                      tier={tier}
                      warningAt={isLow ? 60 : undefined}
                      warningLabel={isLow ? '60% 预警线' : undefined}
                      tagLabel={isLow ? '← 低于60%预警线' : undefined}
                    />
                    {hasAnomaly && <AnomalyIcon deviationPct={deviationPct} />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 质量异常率对比 */}
          <div>
            <div className={styles.perfSectionTitle}>质量异常率对比（越低越好）</div>
            <div className={styles.hbarChart}>
              {compareSuppliers.map((d) => {
                const scaledPct = d.quality * 10;
                const isExceed = d.quality > 5;
                const tier: 'good' | 'mid' | 'warn' = isExceed ? 'warn' : d.quality > 3 ? 'mid' : 'good';
                const valOut = scaledPct < 20;
                // FE-02-05: price anomaly in price trend data
                const myAvgPrice = priceSeries.find((ps) => ps.name === d.name)?.data.reduce((a, b) => a + b, 0) ?? 0;
                const myAvg = myAvgPrice / (priceSeries[0]?.data.length ?? 1);
                const priceDeviation = avgPriceAvg > 0 ? Math.abs(((myAvg - avgPriceAvg) / avgPriceAvg) * 100) : 0;
                const hasPriceAnomaly = priceDeviation > 20;
                return (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <HBarRow
                      label={d.name}
                      pct={scaledPct}
                      valLabel={`${d.quality}%`}
                      tier={tier}
                      valOut={valOut}
                      warningAt={isExceed ? 50 : undefined}
                      warningLabel={isExceed ? '5% 预警线' : undefined}
                      tagLabel={isExceed ? '← 超5%预警' : undefined}
                    />
                    {hasPriceAnomaly && <AnomalyIcon deviationPct={priceDeviation} />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* AI 建议 */}
          <div className={styles.aiSuggestion}>
            <div className={styles.aiSuggestionHeader}>
              <span className={styles.aiSuggestionIcon}>🤖</span>
              <span className={styles.aiSuggestionTitle}>AI 供应商评估建议</span>
            </div>
            <div className={styles.aiSuggestionBody}>
              综合对比来看，{compareSuppliers[0]?.name ?? '华森木业'} 在准时交货率和综合评分方面表现最优。建议重点关注质量异常率偏高的供应商，推动整改或寻找替代方案。
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────
// 表单类型与初始值
// ─────────────────────────────────────────────

type PaymentType = 'cod' | 'monthly';

type SupplierFormData = {
  name: string;
  rating: SupplierRating;
  contactName: string;
  contactPhone: string;
  category: string;
  paymentType: PaymentType;
  paymentDays: string;
  leadDays: string;
  startDate: string;
  notes: string;
  /** 编辑专用字段 */
  code: string;
  contactEmail: string;
  address: string;
};

const EMPTY_FORM: SupplierFormData = {
  name: '',
  rating: 'B',
  contactName: '',
  contactPhone: '',
  category: '',
  paymentType: 'monthly',
  paymentDays: '30',
  leadDays: '',
  startDate: new Date().toISOString().slice(0, 10),
  notes: '',
  code: '',
  contactEmail: '',
  address: '',
};

function supplierToForm(s: Supplier): SupplierFormData {
  // 后端返回 rating/contactName/contactPhone（由 controller 做了映射）
  const rec = s as unknown as Record<string, unknown>;
  const rating = (s.rating ?? rec.grade ?? 'B') as SupplierRating;
  const contactName = s.contactName ?? rec.contact as string ?? '';
  const contactPhone = s.contactPhone ?? rec.phone as string ?? '';
  const category = rec.category as string ?? '';
  const leadDays = rec.leadDays;
  return {
    name: s.name,
    rating,
    contactName,
    contactPhone,
    category,
    paymentType: s.paymentDays ? 'monthly' : 'cod',
    paymentDays: s.paymentDays != null ? String(s.paymentDays) : '30',
    leadDays: leadDays != null ? String(leadDays) : '',
    startDate: new Date().toISOString().slice(0, 10),
    notes: s.notes ?? '',
    code: s.code,
    contactEmail: s.contactEmail ?? '',
    address: s.address ?? '',
  };
}

// ─────────────────────────────────────────────
// 子组件：新建/编辑 供应商表单
// ─────────────────────────────────────────────

type SupplierFormFieldsProps = {
  form: SupplierFormData;
  onChange: React.Dispatch<React.SetStateAction<SupplierFormData>>;
  isNew: boolean;
};

function SupplierFormFields({ form, onChange, isNew }: SupplierFormFieldsProps) {
  const set =
    (field: keyof SupplierFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      onChange((f) => ({ ...f, [field]: e.target.value }));

  const setPaymentType = (val: PaymentType) =>
    onChange((f) => ({ ...f, paymentType: val }));

  return (
    <div className={styles.form}>
      {/* ── 基础信息 ── */}
      <div className={styles.formSection}>
        <div className={styles.formSectionTitle}>基础信息</div>

        {/* 新建时显示编码 */}
        {isNew && (
          <div className={styles.formGroup}>
            <label className={`${styles.formLabel} ${styles.formLabelRequired}`}>供应商名称</label>
            <input
              type="text"
              className={styles.formInput}
              placeholder="请输入供应商全称"
              value={form.name}
              onChange={set('name')}
            />
          </div>
        )}

        {/* 编辑时显示名称+编码 */}
        {!isNew && (
          <div className={styles.formRow}>
            <div>
              <label className={styles.formLabel}>供应商编码</label>
              <input
                className={styles.formInput}
                value={form.code}
                disabled
              />
            </div>
            <div>
              <label className={`${styles.formLabel} ${styles.formLabelRequired}`}>供应商名称</label>
              <input
                type="text"
                className={styles.formInput}
                value={form.name}
                onChange={set('name')}
                placeholder="供应商全称"
              />
            </div>
          </div>
        )}

        {/* 供应商级别 */}
        <div className={styles.formGroup}>
          <label className={`${styles.formLabel} ${styles.formLabelRequired}`}>供应商级别</label>
          <div className={styles.radioGroup}>
            {RATING_OPTIONS.filter((r) => r !== 'D').map((r) => {
              const icons: Record<string, string> = { A: '🥇', B: '🥈', C: '🥉' };
              return (
                <label key={r} className={styles.radioItem}>
                  <input
                    type="radio"
                    name={`rating-${isNew ? 'new' : 'edit'}`}
                    value={r}
                    checked={form.rating === r}
                    onChange={() => onChange((f) => ({ ...f, rating: r }))}
                  />
                  <span>{icons[r]} {r}级</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* 联系人 + 电话 */}
        <div className={styles.formRow}>
          <div>
            <label className={styles.formLabel}>主要联系人</label>
            <input
              type="text"
              className={styles.formInput}
              placeholder="联系人姓名"
              value={form.contactName}
              onChange={set('contactName')}
            />
          </div>
          <div>
            <label className={styles.formLabel}>联系电话</label>
            <input
              type="tel"
              className={styles.formInput}
              placeholder="手机号码"
              value={form.contactPhone}
              onChange={set('contactPhone')}
            />
          </div>
        </div>

        {/* 主供品类 */}
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>主供品类</label>
          <input
            type="text"
            className={styles.formInput}
            placeholder="如：木板类、五金类…"
            value={form.category}
            onChange={set('category')}
          />
        </div>
      </div>

      {/* ── 合作条款 ── */}
      <div className={styles.formSection}>
        <div className={styles.formSectionTitle}>合作条款</div>

        {/* 账期 */}
        <div className={styles.formGroup}>
          <label className={`${styles.formLabel} ${styles.formLabelRequired}`}>账期</label>
          <div className={styles.paymentGroup}>
            <label className={styles.radioItem}>
              <input
                type="radio"
                name={`payment-${isNew ? 'new' : 'edit'}`}
                value="cod"
                checked={form.paymentType === 'cod'}
                onChange={() => setPaymentType('cod')}
              />
              <span>货到付款</span>
            </label>
            <label className={styles.radioItem}>
              <input
                type="radio"
                name={`payment-${isNew ? 'new' : 'edit'}`}
                value="monthly"
                checked={form.paymentType === 'monthly'}
                onChange={() => setPaymentType('monthly')}
              />
              <span>月结</span>
            </label>
            {form.paymentType === 'monthly' && (
              <div className={styles.paymentDaysInput}>
                <input
                  type="number"
                  min="1"
                  max="180"
                  value={form.paymentDays}
                  onChange={set('paymentDays')}
                />
                <span className={styles.paymentDaysUnit}>天</span>
              </div>
            )}
          </div>
        </div>

        {/* 平均交货周期 */}
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>平均交货周期（天）</label>
          <input
            type="number"
            className={`${styles.formInput} ${styles.formInputSm}`}
            placeholder="如：3"
            min="1"
            value={form.leadDays}
            onChange={set('leadDays')}
          />
        </div>
      </div>

      {/* ── 其他 ── */}
      <div className={styles.formSection}>
        <div className={styles.formSectionTitle}>其他</div>

        {/* 合作起始时间 */}
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>合作起始时间</label>
          <input
            type="date"
            className={styles.formInput}
            value={form.startDate}
            onChange={set('startDate')}
          />
        </div>

        {/* 备注 */}
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>备注</label>
          <textarea
            className={styles.formTextarea}
            placeholder="供应商特殊说明、注意事项…"
            rows={3}
            value={form.notes}
            onChange={set('notes')}
          />
        </div>
      </div>

      {/* 价格管理提示 */}
      {isNew && (
        <div className={styles.drawerHint}>
          ℹ 保存后请及时前往 <strong>价格管理</strong> 录入该供应商的价格协议，否则 AI 采购建议将无法匹配该供应商。
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 详情视图：Tab 1 基础信息
// ─────────────────────────────────────────────

function SupplierInfoTab({ supplier }: { supplier: SupplierRecord }) {
  const rec = supplier as unknown as Record<string, unknown>;
  const category = (rec.category as string) || '—';
  const leadDays = rec.leadDays != null ? `${rec.leadDays} 天` : '—';
  const startDate = (rec.startDate as string) || (rec.cooperationStartDate as string) || (supplier.createdAt ? String(supplier.createdAt).slice(0, 10) : '—');
  const lastOrderDate = (rec.lastOrderDate as string) || (supplier.updatedAt ? String(supplier.updatedAt).slice(0, 10) : '—');

  const items: { label: string; value: React.ReactNode }[] = [
    { label: '供应商名称', value: supplier.name },
    {
      label: '供应商级别',
      value: (
        <span className={styles.detailItemValueLarge}>
          <GradeBadge rating={supplier.rating} />
          <span>{supplier.rating}级供应商</span>
        </span>
      ),
    },
    { label: '主要联系人', value: supplier.contactName || '—' },
    { label: '联系电话', value: supplier.contactPhone || '—' },
    { label: '联系邮箱', value: supplier.contactEmail || '—' },
    { label: '主供品类', value: category },
    { label: '账期', value: supplier.paymentDays ? `月结 ${supplier.paymentDays} 天` : '货到付款' },
    { label: '平均交货周期', value: leadDays },
    { label: '合作起始时间', value: startDate },
    { label: '最近采购时间', value: lastOrderDate },
    { label: '供应商编码', value: supplier.code || '—' },
    { label: '备注', value: supplier.notes || '—' },
  ];

  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailGrid}>
        {items.map((item) => (
          <div key={item.label} className={styles.detailItem}>
            <span className={styles.detailItemLabel}>{item.label}</span>
            <span className={styles.detailItemValue}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 详情视图：Tab 2 关联SKU
// ─────────────────────────────────────────────

function SupplierSkuTab({
  data,
  isLoading,
  supplierId,
  onToast,
}: {
  data: SupplierRelatedSku[] | undefined;
  isLoading: boolean;
  supplierId: number;
  onToast: (msg: string) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  // ── 价格历史 Modal 状态 ───────────────────────
  const [historySkuId, setHistorySkuId] = useState<number | null>(null);
  const [historySkuName, setHistorySkuName] = useState('');
  const { data: historyData, isLoading: historyLoading } = usePriceHistory(historySkuId, supplierId);

  // ── 新增关联SKU Modal 状态 ────────────────────
  const [addSkuOpen, setAddSkuOpen] = useState(false);
  const [skuSearch, setSkuSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedSku, setSelectedSku] = useState<Pick<Sku, 'id' | 'name' | 'skuCode' | 'purchaseUnit'> | null>(null);
  const [newPrice, setNewPrice] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [newValidFrom, setNewValidFrom] = useState('');
  const [newValidTo, setNewValidTo] = useState('');
  const [saving, setSaving] = useState(false);

  // 搜索防抖
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(skuSearch), 300);
    return () => clearTimeout(t);
  }, [skuSearch]);

  // SKU 搜索结果
  const { data: skuSearchData } = useSkuList({ page: 1, pageSize: 10, keyword: debouncedSearch || undefined });
  const skus = data ?? [];
  const skuOptions = (skuSearchData?.list ?? []).filter((s) => !skus.some((existing) => existing.id === s.id));

  // 创建价格协议
  const createPrice = useCreatePrice();

  const handleAddSku = async () => {
    if (!selectedSku || !newPrice || !newValidFrom) {
      onToast('请填写必填字段');
      return;
    }
    setSaving(true);
    try {
      await createPrice.mutateAsync({
        skuId: Number(selectedSku.id),
        supplierId: Number(supplierId),
        unitPrice: newPrice,
        purchaseUnit: newUnit || selectedSku.purchaseUnit || '件',
        validFrom: newValidFrom,
        validTo: newValidTo || undefined,
      });
      onToast('关联SKU成功');
      setAddSkuOpen(false);
      setSelectedSku(null);
      setNewPrice('');
      setNewUnit('');
      setNewValidFrom('');
      setNewValidTo('');
      setSkuSearch('');
      void qc.invalidateQueries({ queryKey: ['suppliers', 'skus'] });
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className={styles.detailPanel}>
        <div className={styles.detailPanelLoading}>加载中...</div>
      </div>
    );
  }

  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailTableHeader}>
        <span className={styles.detailTableTitle}>共 <strong>{skus.length}</strong> 个关联SKU</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAddSkuOpen(true)}
        >
          + 新增关联SKU
        </Button>
      </div>
      {skus.length === 0 ? (
        <div className={styles.detailTableEmpty}>暂无关联SKU数据</div>
      ) : (
        <table className={styles.detailTable}>
          <thead>
            <tr>
              <th>物料名称</th>
              <th>物料编码</th>
              <th>规格</th>
              <th>是否主供</th>
              <th>当前价格</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {skus.map((sku) => (
              <tr key={sku.id}>
                <td>{sku.name}</td>
                <td style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-family-number, monospace)' }}>{sku.skuCode}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{sku.spec || '—'}</td>
                <td>
                  {sku.isMainSupplier ? (
                    <span className={styles.mainSupplierBadge}>主供</span>
                  ) : (
                    <span className={styles.nonMainSupplierBadge}>备供</span>
                  )}
                </td>
                <td style={{ fontFamily: 'var(--font-family-number, monospace)', fontWeight: 600 }}>
                  ¥{sku.currentPrice} / {sku.priceUnit}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate('/master-data/sku')}
                    >
                      查看物料
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setHistorySkuId(sku.id); setHistorySkuName(sku.name); }}
                    >
                      价格历史
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 价格历史 Modal */}
      <Modal
        open={historySkuId !== null}
        title={`价格历史 — ${historySkuName}`}
        onClose={() => setHistorySkuId(null)}
      >
        {historyLoading ? (
          <div style={{ padding: 'var(--space-4)', textAlign: 'center' }}>加载中...</div>
        ) : (
          historyData && historyData.length > 0 ? (
            <table className={styles.detailTable}>
              <thead>
                <tr>
                  <th>生效日期</th>
                  <th>价格</th>
                  <th>单位</th>
                  <th>供应商</th>
                </tr>
              </thead>
              <tbody>
                {historyData.map((h: PriceHistoryItem, i: number) => (
                  <tr key={i}>
                    <td>{h.effectiveAt?.slice(0, 10) ?? '—'}</td>
                    <td style={{ fontWeight: 600 }}>¥{h.price}</td>
                    <td>{h.unit}</td>
                    <td>{h.supplierName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-secondary)' }}>
              暂无历史数据
            </div>
          )
        )}
      </Modal>

      {/* 新增关联SKU Modal */}
      <Modal
        open={addSkuOpen}
        title="新增关联SKU"
        onClose={() => setAddSkuOpen(false)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-2) 0' }}>
          {/* 物料搜索 */}
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--space-1)', fontSize: '0.8125rem', fontWeight: 500 }}>
              搜索物料 *
            </label>
            <input
              type="text"
              placeholder="输入物料名称或编码..."
              value={selectedSku ? `${selectedSku.name}（${selectedSku.skuCode}）` : skuSearch}
              onChange={(e) => { setSkuSearch(e.target.value); setSelectedSku(null); }}
              style={{ width: '100%', padding: 'var(--space-2)', border: '1px solid var(--border-primary)', borderRadius: 6, fontSize: '0.875rem' }}
            />
            {!selectedSku && debouncedSearch && skuOptions.length > 0 && (
              <div style={{ border: '1px solid var(--border-primary)', borderRadius: 6, maxHeight: 160, overflow: 'auto', marginTop: 4, background: 'var(--bg-primary)' }}>
                {skuOptions.map((s) => (
                  <div
                    key={s.id}
                    style={{ padding: 'var(--space-2)', cursor: 'pointer', fontSize: '0.875rem', borderBottom: '1px solid var(--border-secondary)' }}
                    onClick={() => { setSelectedSku({ id: s.id, name: s.name, skuCode: s.skuCode, purchaseUnit: s.purchaseUnit }); setNewUnit(s.purchaseUnit || ''); }}
                  >
                    <strong>{s.name}</strong>{' '}
                    <span style={{ color: 'var(--text-secondary)' }}>{s.skuCode}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 价格 + 单位 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <div>
              <label style={{ display: 'block', marginBottom: 'var(--space-1)', fontSize: '0.8125rem', fontWeight: 500 }}>
                含税单价 *
              </label>
              <input
                type="text"
                placeholder="0.00"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                style={{ width: '100%', padding: 'var(--space-2)', border: '1px solid var(--border-primary)', borderRadius: 6, fontSize: '0.875rem' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 'var(--space-1)', fontSize: '0.8125rem', fontWeight: 500 }}>
                采购单位
              </label>
              <input
                type="text"
                placeholder="件"
                value={newUnit}
                onChange={(e) => setNewUnit(e.target.value)}
                style={{ width: '100%', padding: 'var(--space-2)', border: '1px solid var(--border-primary)', borderRadius: 6, fontSize: '0.875rem' }}
              />
            </div>
          </div>

          {/* 有效期 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <div>
              <label style={{ display: 'block', marginBottom: 'var(--space-1)', fontSize: '0.8125rem', fontWeight: 500 }}>
                有效期起 *
              </label>
              <input
                type="date"
                value={newValidFrom}
                onChange={(e) => setNewValidFrom(e.target.value)}
                style={{ width: '100%', padding: 'var(--space-2)', border: '1px solid var(--border-primary)', borderRadius: 6, fontSize: '0.875rem' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 'var(--space-1)', fontSize: '0.8125rem', fontWeight: 500 }}>
                有效期止
              </label>
              <input
                type="date"
                value={newValidTo}
                onChange={(e) => setNewValidTo(e.target.value)}
                style={{ width: '100%', padding: 'var(--space-2)', border: '1px solid var(--border-primary)', borderRadius: 6, fontSize: '0.875rem' }}
              />
            </div>
          </div>

          {/* 操作按钮 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <Button variant="ghost" size="sm" onClick={() => setAddSkuOpen(false)}>
              取消
            </Button>
            <Button variant="primary" size="sm" onClick={handleAddSku} disabled={saving}>
              {saving ? '保存中...' : '确认关联'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─────────────────────────────────────────────
// 详情视图：Tab 3 价格协议
// ─────────────────────────────────────────────

function SupplierPriceTab({
  data,
  isLoading,
}: {
  data: SupplierPriceAgreement[] | undefined;
  isLoading: boolean;
}) {
  const navigate = useNavigate();
  if (isLoading) {
    return (
      <div className={styles.detailPanel}>
        <div className={styles.detailPanelLoading}>加载中...</div>
      </div>
    );
  }

  const agreements = data ?? [];
  const validCount = agreements.filter((a) => a.status !== '已过期').length;

  function StatusBadge({ status }: { status: string }) {
    if (status === '有效') return <span className={styles.agreementStatusValid}>有效</span>;
    if (status === '即将到期') return <span className={styles.agreementStatusExpiringSoon}>即将到期</span>;
    return <span className={styles.agreementStatusExpired}>已过期</span>;
  }

  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailTableHeader}>
        <span className={styles.detailTableTitle}>共 <strong>{validCount}</strong> 份有效协议</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/purchase/prices')}
        >
          前往价格管理
        </Button>
      </div>
      {agreements.length === 0 ? (
        <div className={styles.detailTableEmpty}>暂无价格协议数据</div>
      ) : (
        <table className={styles.detailTable}>
          <thead>
            <tr>
              <th>物料名称</th>
              <th>协议价格</th>
              <th>最小起订量</th>
              <th>有效期</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {agreements.map((ag) => (
              <tr key={ag.id}>
                <td>{ag.skuName}</td>
                <td style={{ fontFamily: 'var(--font-family-number, monospace)', fontWeight: 600 }}>
                  ¥{ag.unitPrice} / {ag.purchaseUnit}
                </td>
                <td style={{ color: 'var(--text-secondary)' }}>
                  {ag.moq != null ? `${ag.moq} ${ag.purchaseUnit}` : '—'}
                </td>
                <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                  {String(ag.validFrom).slice(0, 10)} ~ {ag.validTo ? String(ag.validTo).slice(0, 10) : '长期'}
                </td>
                <td><StatusBadge status={ag.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 详情视图：Tab 4 绩效数据
// ─────────────────────────────────────────────

function SupplierPerfTab({
  data,
  isLoading,
  supplier,
}: {
  data: SupplierPerformance | undefined;
  isLoading: boolean;
  supplier: SupplierRecord;
}) {
  if (isLoading) {
    return (
      <div className={styles.detailPanel}>
        <div className={styles.detailPanelLoading}>加载中...</div>
      </div>
    );
  }

  // 从 API 数据或 supplier 字段中取准时率，如没有则显示占位
  const onTimeRateRaw = data?.onTimeRate
    ?? (typeof (supplier as Record<string, unknown>).onTimeRate === 'number'
      ? String((supplier as Record<string, unknown>).onTimeRate)
      : null);

  const qualityRateRaw = data?.qualityRate
    ?? (typeof supplier.qualityRate === 'number' ? String(supplier.qualityRate) : null);

  const avgLeadDays = data?.avgLeadDays
    ?? ((supplier as Record<string, unknown>).leadDays != null
      ? String((supplier as Record<string, unknown>).leadDays)
      : null);

  const onTimePct = onTimeRateRaw != null ? parseFloat(onTimeRateRaw) : null;
  const qualityPct = qualityRateRaw != null ? parseFloat(qualityRateRaw) : null;
  const leadDayNum = avgLeadDays != null ? parseFloat(avgLeadDays) : null;

  const onTimeIsGood = onTimePct != null && onTimePct >= 80;
  const qualityIsGood = qualityPct != null && qualityPct <= 3;

  const deliveries = data?.recentDeliveries ?? [];

  return (
    <div className={styles.detailPanel}>
      {/* KPI Cards */}
      <div className={styles.kpiGrid}>
        {/* 准时交货率 */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiCardLabel}>准时交货率</div>
          {onTimePct != null ? (
            <>
              <div className={`${styles.kpiCardValue} ${onTimeIsGood ? styles.kpiCardValueGood : styles.kpiCardValueWarn}`}>
                {onTimePct.toFixed(1)}%
              </div>
              <div className={styles.kpiCardBar}>
                <div
                  className={`${styles.kpiCardBarFill} ${onTimeIsGood ? styles.kpiCardBarFillGood : styles.kpiCardBarFillWarn}`}
                  style={{ width: `${Math.min(onTimePct, 100)}%` }}
                />
              </div>
              <div className={styles.kpiCardSub}>近3个月</div>
              <div className={`${styles.kpiCardStatus} ${onTimeIsGood ? styles.kpiCardStatusOk : styles.kpiCardStatusWarn}`}>
                {onTimeIsGood ? '表现优秀' : onTimePct >= 65 ? '需关注' : '低于预警线'}
              </div>
            </>
          ) : (
            <div className={`${styles.kpiCardValue} ${styles.kpiCardValueNeutral}`}>—</div>
          )}
        </div>

        {/* 质量异常率 */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiCardLabel}>质量异常率</div>
          {qualityPct != null ? (
            <>
              <div className={`${styles.kpiCardValue} ${qualityIsGood ? styles.kpiCardValueGood : styles.kpiCardValueWarn}`}>
                {qualityPct.toFixed(1)}%
              </div>
              <div className={styles.kpiCardBar}>
                <div
                  className={`${styles.kpiCardBarFill} ${qualityIsGood ? styles.kpiCardBarFillGood : styles.kpiCardBarFillWarn}`}
                  style={{ width: `${Math.min(qualityPct * 10, 100)}%` }}
                />
              </div>
              <div className={styles.kpiCardSub}>越低越好，预警线 5%</div>
              <div className={`${styles.kpiCardStatus} ${qualityIsGood ? styles.kpiCardStatusOk : styles.kpiCardStatusWarn}`}>
                {qualityPct <= 3 ? '质量稳定' : qualityPct <= 5 ? '需关注' : '超预警线'}
              </div>
            </>
          ) : (
            <div className={`${styles.kpiCardValue} ${styles.kpiCardValueNeutral}`}>—</div>
          )}
        </div>

        {/* 平均交货周期 */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiCardLabel}>平均交货周期</div>
          {leadDayNum != null ? (
            <>
              <div className={`${styles.kpiCardValue} ${styles.kpiCardValueNeutral}`}>
                {leadDayNum}<span style={{ fontSize: '1rem', fontWeight: 500, marginLeft: 4 }}>天</span>
              </div>
              <div className={styles.kpiCardBar}>
                <div
                  className={`${styles.kpiCardBarFill} ${styles.kpiCardBarFillNeutral}`}
                  style={{ width: `${Math.min(leadDayNum * 6.67, 100)}%` }}
                />
              </div>
              <div className={styles.kpiCardSub}>标准周期参考</div>
              <div className={`${styles.kpiCardStatus} ${styles.kpiCardStatusOk}`}>
                {leadDayNum <= 3 ? '快速交货' : leadDayNum <= 7 ? '正常' : '周期偏长'}
              </div>
            </>
          ) : (
            <div className={`${styles.kpiCardValue} ${styles.kpiCardValueNeutral}`}>—</div>
          )}
        </div>
      </div>

      {/* 近期交货记录 */}
      <div style={{ marginTop: 8 }}>
        <div className={styles.detailTableHeader}>
          <span className={styles.detailTableTitle} style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9375rem' }}>
            近期交货记录
          </span>
        </div>
        {deliveries.length === 0 ? (
          <div className={styles.detailTableEmpty} style={{ background: 'var(--color-gray-50)', borderRadius: 'var(--radius-md)', padding: '24px' }}>
            暂无交货记录数据
          </div>
        ) : (
          <table className={styles.detailTable}>
            <thead>
              <tr>
                <th>采购单号</th>
                <th>物料名称</th>
                <th>约定日期</th>
                <th>实际日期</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((rec, idx) => (
                <tr key={idx}>
                  <td style={{ fontFamily: 'var(--font-family-number, monospace)', color: 'var(--text-secondary)' }}>{rec.orderId}</td>
                  <td>{rec.skuName}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{rec.scheduledDate}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{rec.actualDate}</td>
                  <td>
                    {rec.remark === '准时' || rec.remark === 'ontime' ? (
                      <span className={styles.deliveryOnTime}>准时</span>
                    ) : (
                      <span className={styles.deliveryLate}>{rec.remark}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 详情视图：根组件
// ─────────────────────────────────────────────

type DetailTab = 'info' | 'sku' | 'price' | 'perf';

const TAB_LABELS: { key: DetailTab; label: string }[] = [
  { key: 'info', label: '基础信息' },
  { key: 'sku', label: '关联SKU' },
  { key: 'price', label: '价格协议' },
  { key: 'perf', label: '绩效数据' },
];

function SupplierDetailView({
  supplier,
  onBack,
  onEdit,
  onToast,
  onGradeChange,
  gradeUpdating,
}: {
  supplier: SupplierRecord;
  onBack: () => void;
  onEdit: (s: Supplier) => void;
  onToast: (msg: string) => void;
  onGradeChange: (id: number, rating: SupplierRating, reason: string) => void;
  gradeUpdating: boolean;
}) {
  const [activeTab, setActiveTab] = useState<DetailTab>('info');

  // 调整级别 Modal 状态
  const [gradeModalOpen, setGradeModalOpen] = useState(false);
  const [targetGrade, setTargetGrade] = useState<SupplierRating>(supplier.rating);
  const [gradeReason, setGradeReason] = useState('');

  const { data: skuData, isLoading: skuLoading } = useSupplierSkus(activeTab === 'sku' ? supplier.id : null);
  const { data: priceData, isLoading: priceLoading } = useSupplierPriceAgreements(activeTab === 'price' ? supplier.id : null);
  const { data: perfData, isLoading: perfLoading } = useSupplierPerformance(activeTab === 'perf' ? supplier.id : null);

  const rec = supplier as unknown as Record<string, unknown>;
  const category = (rec.category as string) || null;
  const startDate = (rec.startDate as string) || (rec.cooperationStartDate as string) || (supplier.createdAt ? String(supplier.createdAt).slice(0, 10) : null);

  const metaParts: string[] = [];
  if (category) metaParts.push(`主供品类: ${category}`);
  if (startDate) metaParts.push(`合作起始: ${startDate}`);
  if (supplier.paymentDays) metaParts.push(`账期: 月结${supplier.paymentDays}天`);
  else metaParts.push('账期: 货到付款');

  const gradeLabel: Record<SupplierRating, string> = { A: 'A级（优质供应商）', B: 'B级（合格供应商）', C: 'C级（待改进）', D: 'D级（高风险）' };

  const handleOpenGradeModal = useCallback(() => {
    setTargetGrade(supplier.rating);
    setGradeReason('');
    setGradeModalOpen(true);
  }, [supplier.rating]);

  const handleSubmitGrade = useCallback(() => {
    if (!gradeReason.trim()) {
      onToast('请填写调整原因');
      return;
    }
    if (targetGrade === supplier.rating) {
      onToast('目标级别与当前级别相同，无需调整');
      return;
    }
    onGradeChange(supplier.id, targetGrade, gradeReason.trim());
    setGradeModalOpen(false);
  }, [targetGrade, gradeReason, supplier.id, supplier.rating, onGradeChange, onToast]);

  return (
    <div className={styles.page} style={{ paddingTop: 'var(--layout-page-padding, 24px)' }}>
      {/* 顶部操作区 */}
      <div className={styles.detailHeader}>
        <div className={styles.detailBreadcrumb}>
          <span
            className={styles.detailBreadcrumbCurrent}
            style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}
            onClick={onBack}
          >
            采购管理
          </span>
          <span className={styles.detailBreadcrumbSep}>›</span>
          <span className={styles.detailBreadcrumbCurrent}>{supplier.name}</span>
        </div>
        <div className={styles.detailHeaderActions}>
          <Button variant="ghost" size="md" onClick={onBack}>
            ← 返回列表
          </Button>
          <Button variant="primary" size="md" onClick={() => onEdit(supplier)}>
            编辑基础信息
          </Button>
        </div>
      </div>

      {/* Summary Card */}
      <div className={styles.detailSummary}>
        <div className={styles.detailSummaryLeft}>
          <div className={styles.detailSupplierIcon}>🏭</div>
          <div>
            <div className={styles.detailSupplierName}>
              {supplier.name}
              <GradeBadge rating={supplier.rating} />
              <span className={styles.detailGradeText}>{gradeLabel[supplier.rating]}</span>
            </div>
            {metaParts.length > 0 && (
              <div className={styles.detailSupplierMeta}>{metaParts.join(' · ')}</div>
            )}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={handleOpenGradeModal}>
          调整级别
        </Button>
      </div>

      {/* Tab 导航 */}
      <div className={styles.detailTabs}>
        {TAB_LABELS.map(({ key, label }) => (
          <button
            key={key}
            className={activeTab === key ? styles.detailTabActive : styles.detailTab}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      {activeTab === 'info' && <SupplierInfoTab supplier={supplier} />}
      {activeTab === 'sku' && (
        <SupplierSkuTab data={skuData} isLoading={skuLoading} supplierId={supplier.id} onToast={onToast} />
      )}
      {activeTab === 'price' && (
        <SupplierPriceTab data={priceData} isLoading={priceLoading} />
      )}
      {activeTab === 'perf' && (
        <SupplierPerfTab data={perfData} isLoading={perfLoading} supplier={supplier} />
      )}

      {/* 调整级别 Modal */}
      <Modal
        open={gradeModalOpen}
        title={`调整供应商级别 — ${supplier.name}`}
        onClose={() => setGradeModalOpen(false)}
        onConfirm={handleSubmitGrade}
        confirmLabel="提交审批"
        confirmLoading={gradeUpdating}
      >
        <div className={styles.gradeModalBody}>
          <div className={styles.gradeModalWarning}>
            ⚠ 调整供应商级别（从 {supplier.rating} 级调整）需要工厂老板审批，操作记录将完整留存。请确认调整原因。
          </div>

          <div className={styles.gradeModalField}>
            <label className={`${styles.formLabel} ${styles.formLabelRequired}`}>调整目标级别</label>
            <div className={styles.radioGroup}>
              {(['A', 'B', 'C'] as SupplierRating[]).map((r) => {
                const icons: Record<string, string> = { A: '🥇', B: '🥈', C: '🥉' };
                return (
                  <label key={r} className={styles.radioItem}>
                    <input
                      type="radio"
                      name="targetGrade"
                      value={r}
                      checked={targetGrade === r}
                      onChange={() => setTargetGrade(r)}
                    />
                    <span>{icons[r]} {r}级</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className={styles.gradeModalField}>
            <label className={`${styles.formLabel} ${styles.formLabelRequired}`}>调整原因</label>
            <textarea
              className={styles.formTextarea}
              value={gradeReason}
              onChange={(e) => setGradeReason(e.target.value)}
              placeholder="请说明调整原因，将随审批流程提交给工厂老板…"
              rows={5}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─────────────────────────────────────────────
// 页面主组件
// ─────────────────────────────────────────────

export default function SupplierPage() {
  const { setPageTitle, showToast } = useAppStore();

  // 分页
  const [page, setPage] = useState(1);

  // 筛选状态
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [ratingFilter, setRatingFilter] = useState<SupplierRating | ''>('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // 详情视图状态
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierRecord | null>(null);

  // Modal 状态
  const [perfModalOpen, setPerfModalOpen] = useState(false);
  const [compareSelectedIds, setCompareSelectedIds] = useState<number[]>([]);
  void setCompareSelectedIds; // will be wired to CompareToggleButton

  // Drawer 状态
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [editDrawer, setEditDrawer] = useState<{ open: boolean; supplier: Supplier | null }>({
    open: false,
    supplier: null,
  });

  // 表单数据
  const [form, setForm] = useState<SupplierFormData>(EMPTY_FORM);

  // 页面标题
  useEffect(() => {
    setPageTitle('供应商管理');
  }, [setPageTitle]);

  // 关键字防抖 350ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedKeyword(keyword);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [keyword]);

  // 构造查询参数
  const query: SupplierListQuery = {
    page,
    pageSize: 20,
    keyword: debouncedKeyword || undefined,
    rating: (ratingFilter || undefined) as SupplierRating | undefined,
  };

  const { data, isLoading, error } = useSupplierList(query);
  const createMutation = useCreateSupplier();
  const updateMutation = useUpdateSupplier();

  // ── 打开新建 Drawer ──
  const openCreate = useCallback(() => {
    setForm(EMPTY_FORM);
    setCreateDrawerOpen(true);
  }, []);

  // ── 提交新建 ──
  const handleCreate = async () => {
    if (!form.name.trim()) {
      showToast({ type: 'warning', message: '请填写供应商名称' });
      return;
    }
    const paymentDays =
      form.paymentType === 'monthly' && form.paymentDays
        ? Number(form.paymentDays)
        : undefined;
    // 自动生成 code（后端可覆盖）
    const code = `SUP-${Date.now().toString().slice(-6)}`;
    const payload: CreateSupplierPayload = {
      code,
      name: form.name.trim(),
      rating: form.rating,
      contactName: form.contactName.trim() || undefined,
      contactPhone: form.contactPhone.trim() || undefined,
      contactEmail: form.contactEmail.trim() || undefined,
      address: form.address.trim() || undefined,
      paymentDays,
      category: form.category.trim() || undefined,
      leadDays: form.leadDays ? Number(form.leadDays) : undefined,
      notes: form.notes.trim() || undefined,
      isActive: true,
    };
    try {
      await createMutation.mutateAsync(payload);
      showToast({ type: 'success', message: '供应商已保存。请及时前往价格管理录入价格协议' });
      setCreateDrawerOpen(false);
      setForm(EMPTY_FORM);
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message ?? '创建失败，请重试' });
    }
  };

  // ── 提交编辑 ──
  const handleUpdate = async () => {
    if (!editDrawer.supplier) return;
    if (!form.name.trim()) {
      showToast({ type: 'warning', message: '请填写供应商名称' });
      return;
    }
    const paymentDays =
      form.paymentType === 'monthly' && form.paymentDays
        ? Number(form.paymentDays)
        : undefined;
    try {
      await updateMutation.mutateAsync({
        id: editDrawer.supplier.id,
        payload: {
          name: form.name.trim(),
          rating: form.rating,
          contactName: form.contactName.trim() || undefined,
          contactPhone: form.contactPhone.trim() || undefined,
          contactEmail: form.contactEmail.trim() || undefined,
          address: form.address.trim() || undefined,
          paymentDays,
          category: form.category.trim() || undefined,
          leadDays: form.leadDays ? Number(form.leadDays) : undefined,
          notes: form.notes.trim() || undefined,
        },
      });
      showToast({ type: 'success', message: '供应商信息更新成功' });
      setEditDrawer({ open: false, supplier: null });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message ?? '更新失败，请重试' });
    }
  };

  // ── 筛选联动 ──
  const handleRatingChange = (val: SupplierRating | '') => {
    setRatingFilter(val);
    setPage(1);
  };
  const handleCategoryChange = (val: string) => {
    setCategoryFilter(val);
    setPage(1);
  };

  // ─────────────────────────────────────────────
  // 列定义（对齐设计稿）
  // ─────────────────────────────────────────────

  const columns: Column<SupplierRecord>[] = [
    {
      key: 'rating',
      title: '级别',
      width: 60,
      render: (_, r) => <GradeBadge rating={r.rating} />,
    },
    {
      key: 'name',
      title: '供应商名称',
      render: (_, r) => {
        const onTime = typeof (r as Record<string, unknown>).onTimeRate === 'number'
          ? ((r as Record<string, unknown>).onTimeRate as number)
          : null;
        const isWarning = onTime !== null && onTime < 65;
        return (
          <div className={styles.nameCell}>
            <span className={styles.namePrimary}>{r.name}</span>
            {r.contactName && (
              <span className={styles.nameContact}>
                {r.contactName}
                {r.contactPhone ? ` ${r.contactPhone}` : ''}
              </span>
            )}
            {isWarning && (
              <span className={styles.nameWarningTag}>⚠ 准时率预警</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'category',
      title: '主供品类',
      width: 110,
      render: (_, r) => {
        const cat = r.category ?? '—';
        if (cat === '—') return <span style={{ color: 'var(--text-disabled)' }}>—</span>;
        return <span className={styles.categoryTag}>{cat}</span>;
      },
    },
    {
      key: 'onTimeRate',
      title: '准时交货率（近3M）',
      width: 180,
      render: (_, r) => {
        const rate = typeof (r as Record<string, unknown>).onTimeRate === 'number'
          ? ((r as Record<string, unknown>).onTimeRate as number)
          : 0;
        return <RateBar pct={Math.round(rate)} />;
      },
    },
    {
      key: 'qualityRate',
      title: '质量异常率',
      width: 120,
      render: (_, r) => {
        const qr = typeof r.qualityRate === 'number' ? r.qualityRate : 0;
        return <QualityRateCell rate={qr} />;
      },
    },
    {
      key: 'paymentDays',
      title: '账期',
      width: 110,
      render: (_, r) => (
        <span className={styles.paymentCell}>
          {r.paymentDays ? `月结 ${r.paymentDays} 天` : '货到付款'}
        </span>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: 72,
      render: (_, r) => (
        <div className={styles.actionCell}>
          <Button variant="ghost" size="sm" onClick={() => setSelectedSupplier(r)}>
            查看
          </Button>
        </div>
      ),
    },
  ];

  const supplierList = (data?.list ?? []) as SupplierRecord[];

  // 动态提取品类选项
  const categoryOptions = useMemo(() => {
    const cats = supplierList
      .map((s) => s.category)
      .filter((c): c is string => !!c);
    return [...new Set(cats)].sort();
  }, [supplierList]);

  // 前端品类过滤
  const filteredList = useMemo(() => {
    if (!categoryFilter) return supplierList;
    return supplierList.filter((s) => s.category === categoryFilter);
  }, [supplierList, categoryFilter]);

  // ── 统计摘要 ──
  const { countA, countB, countC, totalCount, hasLowOnTime } = useMemo(() => {
    const all = supplierList;
    return {
      totalCount: data?.total ?? 0,
      countA: all.filter((s) => s.rating === 'A').length,
      countB: all.filter((s) => s.rating === 'B').length,
      countC: all.filter((s) => s.rating === 'C').length,
      hasLowOnTime: all.some((s) => {
        const r = (s as Record<string, unknown>).onTimeRate;
        return typeof r === 'number' && r < 65;
      }),
    };
  }, [supplierList, data?.total]);

  // ── 行样式辅助（通过 render 中 style 实现预警行高亮） ──
  // Table 组件不支持 rowClassName，改由列 render 内内嵌样式实现。

  // ── 详情视图：编辑回调 ──
  const handleDetailEdit = useCallback((s: Supplier) => {
    setSelectedSupplier(null);
    setForm(supplierToForm(s));
    setEditDrawer({ open: true, supplier: s });
  }, []);

  // ─────────────────────────────────────────────
  // 渲染
  // ─────────────────────────────────────────────

  // ── 调整级别回调 ──
  const handleGradeChange = useCallback(async (id: number, rating: SupplierRating, _reason: string) => {
    try {
      await updateMutation.mutateAsync({ id, payload: { rating } });
      // 更新本地 selectedSupplier 的 rating 以便即时反映
      setSelectedSupplier((prev) => prev ? { ...prev, rating } : null);
      showToast({ type: 'success', message: `供应商级别已调整为 ${rating} 级` });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message ?? '级别调整失败' });
    }
  }, [updateMutation, showToast]);

  // 详情视图模式
  if (selectedSupplier) {
    return (
      <>
        <SupplierDetailView
          supplier={selectedSupplier}
          onBack={() => setSelectedSupplier(null)}
          onEdit={handleDetailEdit}
          onToast={(msg) => showToast({ type: 'info', message: msg })}
          onGradeChange={(id, rating, reason) => void handleGradeChange(id, rating, reason)}
          gradeUpdating={updateMutation.isPending}
        />
        {/* 编辑供应商 Drawer (详情模式下也需要) */}
        <Drawer
          open={editDrawer.open}
          title={`编辑供应商 — ${editDrawer.supplier?.name ?? ''}`}
          width={480}
          onClose={() => setEditDrawer({ open: false, supplier: null })}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
              <Button variant="ghost" onClick={() => setEditDrawer({ open: false, supplier: null })}>取消</Button>
              <Button
                variant="primary"
                onClick={() => void handleUpdate()}
                loading={updateMutation.isPending}
              >
                保存
              </Button>
            </div>
          }
        >
          <SupplierFormFields form={form} onChange={setForm} isNew={false} />
        </Drawer>
      </>
    );
  }

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className="page-header">
        <h1 className="page-header__title">供应商管理</h1>
        <div className="page-header__actions">
          <Button
            variant="ghost"
            size="md"
            onClick={() => setPerfModalOpen(true)}
          >
            📊 绩效对比
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => showToast({ type: 'info', message: '导出功能开发中' })}
          >
            导出
          </Button>
          <Button variant="primary" size="md" onClick={openCreate}>
            + 新增供应商
          </Button>
        </div>
      </div>

      {/* 工具栏（包裹在 card 内） */}
      <div className="card">
        <div className={styles.toolbarCard}>
          <div className={styles.toolbar}>
            {/* 搜索框（带放大镜图标） */}
            <label className={styles.searchWrapper}>
              <span className={styles.searchIcon}>🔍</span>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="搜索供应商名称、联系人…"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                aria-label="搜索供应商"
              />
            </label>

            {/* 级别筛选 */}
            <select
              className={styles.select}
              value={ratingFilter}
              onChange={(e) => handleRatingChange(e.target.value as SupplierRating | '')}
              aria-label="级别筛选"
            >
              <option value="">全部级别</option>
              <option value="A">A级</option>
              <option value="B">B级</option>
              <option value="C">C级</option>
              <option value="D">D级</option>
            </select>

            {/* 品类筛选 */}
            <select
              className={styles.select}
              value={categoryFilter}
              onChange={(e) => handleCategoryChange(e.target.value)}
              aria-label="品类筛选"
            >
              <option value="">全部主供品类</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 统计摘要栏 */}
      <div className={styles.statsStrip}>
        <span className={styles.statsLabel}>
          汇总：共 <strong>{totalCount}</strong> 家
        </span>
        <div className={styles.statsItem}>
          <span className={styles.statsIcon}>🥇</span>
          <span className={styles.statsCount}>{countA}</span>
          <span className={styles.statsName}>A级</span>
        </div>
        <div className={styles.statsDivider} />
        <div className={styles.statsItem}>
          <span className={styles.statsIcon}>🥈</span>
          <span className={styles.statsCount}>{countB}</span>
          <span className={styles.statsName}>B级</span>
        </div>
        <div className={styles.statsDivider} />
        <div className={styles.statsItem}>
          <span className={styles.statsIcon}>🥉</span>
          <span className={styles.statsCount}>{countC}</span>
          <span className={styles.statsName}>C级</span>
        </div>
        {hasLowOnTime && (
          <div className={styles.statsWarning}>
            ⚠ 1家供应商准时率低于预警线
          </div>
        )}
      </div>

      {/* 列表 */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <Table<SupplierRecord>
          columns={columns}
          dataSource={filteredList}
          rowKey="id"
          loading={isLoading}
          error={error ? (error as Error).message : null}
          emptyText="暂无供应商数据"
          pagination={
            data
              ? { page, pageSize: 20, total: data.total, onChange: setPage }
              : undefined
          }
        />
      </div>

      {/* 绩效对比 Modal */}
      <PerfModal open={perfModalOpen} onClose={() => setPerfModalOpen(false)} compareIds={compareSelectedIds} suppliers={supplierList} />

      {/* 新建供应商 Drawer */}
      <Drawer
        open={createDrawerOpen}
        title="新增供应商"
        width={480}
        onClose={() => setCreateDrawerOpen(false)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
            <Button variant="ghost" onClick={() => setCreateDrawerOpen(false)}>取消</Button>
            <Button
              variant="primary"
              onClick={() => void handleCreate()}
              loading={createMutation.isPending}
            >
              保存供应商
            </Button>
          </div>
        }
      >
        <SupplierFormFields form={form} onChange={setForm} isNew />
      </Drawer>

      {/* 编辑供应商 Drawer */}
      <Drawer
        open={editDrawer.open}
        title={`编辑供应商 — ${editDrawer.supplier?.name ?? ''}`}
        width={480}
        onClose={() => setEditDrawer({ open: false, supplier: null })}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
            <Button variant="ghost" onClick={() => setEditDrawer({ open: false, supplier: null })}>取消</Button>
            <Button
              variant="primary"
              onClick={() => void handleUpdate()}
              loading={updateMutation.isPending}
            >
              保存
            </Button>
          </div>
        }
      >
        <SupplierFormFields form={form} onChange={setForm} isNew={false} />
      </Drawer>
    </div>
  );
}
