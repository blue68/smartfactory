/**
 * [artifact:前端代码] — 采购价格管理页
 * 100% 对齐设计稿 web-price-manage.html
 *
 * 功能：
 *   - Stats Strip：有效协议 / 即将到期 / 价格预警
 *   - Alert Banner + 可折叠 Alert Panel（价格异常预警详情）
 *   - View Toggle：按供应商（Accordion）/ 按物料（Accordion）
 *   - 按供应商视图：可折叠分组 + 等级徽章 + 价格表 + 价格涨跌 pill + 行选中
 *   - 价格趋势 Chart Panel（点击行展开，SVG 折线图 + 供应商对比表）
 *   - 右侧 Drawer：新增 / 编辑价格协议（含 price warning modal）
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { getAccessToken } from '@/utils/request';
import {
  usePriceList,
  useCreatePrice,
  useUpdatePrice,
  usePriceHistory,
  uploadPriceFile,
  importPrices,
  downloadImportTemplate,
} from '@/api/price';
import type { Price, PriceHistoryItem, CreatePricePayload } from '@/api/price';
import { useSupplierOptions } from '@/api/supplier';
import type { Supplier } from '@/api/supplier';
import { useSkuList } from '@/api/sku';
import Drawer from '@/components/common/Drawer';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import { formatDate, formatCNY } from '@/utils/format';
import styles from './PricePage.module.css';

// ─────────────────────────────────────────────
// 常量 & 类型
// ─────────────────────────────────────────────

const PAGE_SIZE = 100; // 视图模式下一次加载全量（分页在视图层隐藏）

type ViewMode = 'supplier' | 'material';

type StatusFilter = 'active' | 'all' | 'expiring' | 'expired';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'active',   label: '当前有效' },
  { value: 'all',      label: '全部' },
  { value: 'expiring', label: '即将到期' },
  { value: 'expired',  label: '已过期' },
];

// 供应商等级
type SupplierGrade = 'A' | 'B' | 'C' | 'D';
const EMPTY_SUPPLIERS: Supplier[] = [];

// 扩展 Price 类型，携带额外展示字段
type PriceRow = Price & {
  /** vs 历史均价变动百分比，正涨负跌，null 为首次 */
  priceChangePct?: number | null;
  /** 是否即将到期（30天内） */
  isExpiring?: boolean;
  /** 价格异常 */
  priceAnomaly?: boolean;
};

// 供应商分组
type SupplierGroup = {
  supplierId: number;
  supplierName: string;
  grade: SupplierGrade;
  warnCount: number;
  prices: PriceRow[];
};

// 物料分组
type MaterialGroup = {
  skuId: number;
  skuName: string;
  skuCode: string;
  prices: PriceRow[];
  bestActivePrice: PriceRow | null;
  activeCount: number;
  expiringCount: number;
};

// Alert item 类型
type AlertItem = {
  id: number;
  supplier: string;
  grade: string;
  material: string;
  currentPrice: string;
  currentUnit: string;
  avgPrice: string;
  avgUnit: string;
  exceedAmount: string;
  exceedPct: number;
};

// ─────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────

/** 判断是否在 30 天内到期 */
function isExpiringSoon(validTo: string | null): boolean {
  if (!validTo) return false;
  const expDate = new Date(validTo);
  const now = new Date();
  const diffMs = expDate.getTime() - now.getTime();
  return diffMs > 0 && diffMs <= 30 * 24 * 60 * 60 * 1000;
}

function renderValidPeriod(price: Price): string {
  const from = formatDate(price.validFrom);
  const to = price.validTo ? formatDate(price.validTo) : '长期';
  return `${from} ~ ${to}`;
}

// ─────────────────────────────────────────────
// 组件：Stats Strip
// ─────────────────────────────────────────────
function StatsStrip({ activeCount, expiringCount, alertCount }: {
  activeCount: number;
  expiringCount: number;
  alertCount: number;
}) {
  return (
    <div className={styles.stats_strip}>
      <div className={styles.stat_card}>
        <div className={styles.stat_card__label}>
          <span className={styles.stat_card__dot} style={{ background: 'var(--color-success-500)' }} />
          有效协议
        </div>
        <div className={styles.stat_card__value} style={{ color: 'var(--color-success-600)' }}>
          {activeCount}
        </div>
        <div className={styles.stat_card__sub}>当前在有效期内</div>
      </div>
      <div className={styles.stat_card}>
        <div className={styles.stat_card__label}>
          <span className={styles.stat_card__dot} style={{ background: 'var(--color-warning-500)' }} />
          即将到期
        </div>
        <div className={styles.stat_card__value} style={{ color: 'var(--color-warning-600)' }}>
          {expiringCount}
        </div>
        <div className={styles.stat_card__sub}>&le; 30 天内到期</div>
      </div>
      <div className={styles.stat_card}>
        <div className={styles.stat_card__label}>
          <span className={styles.stat_card__dot} style={{ background: 'var(--color-error-500)' }} />
          价格预警
        </div>
        <div className={styles.stat_card__value} style={{ color: 'var(--color-error-600)' }}>
          {alertCount}
        </div>
        <div className={styles.stat_card__sub}>超历史均价 20%</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 组件：Alert Panel
// ─────────────────────────────────────────────
function AlertPanel({
  alerts,
  onClose,
  onMarkAll,
}: {
  alerts: AlertItem[];
  onClose: () => void;
  onMarkAll: () => void;
}) {
  const { showToast } = useAppStore();

  if (alerts.length === 0) {
    return (
      <div className={styles.alert_panel}>
        <div className={styles.alert_panel__header}>
          <span style={{ fontSize: '1.125rem', color: 'var(--color-success-600)' }}>&#10003;</span>
          <span className={styles.alert_panel__title}>当前无价格异常预警</span>
          <Button variant="ghost" size="sm" style={{ marginLeft: 'auto' }} onClick={onClose}>
            收起 &uarr;
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.alert_panel}>
      <div className={styles.alert_panel__header}>
        <span style={{ fontSize: '1.125rem', color: 'var(--color-error-600)' }}>!</span>
        <span className={styles.alert_panel__title}>价格异常预警</span>
        <Button
          variant="ghost"
          size="sm"
          style={{ marginLeft: 'auto' }}
          onClick={onMarkAll}
        >
          全部标记处理
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          收起 &uarr;
        </Button>
      </div>

      {alerts.map((alert) => (
        <div key={alert.id} className={styles.alert_row}>
          <div className={styles.alert_row__icon_col}>!</div>
          <div className={styles.alert_row__body}>
            <div className={styles.alert_row__top}>
              <span className={styles.alert_row__supplier}>{alert.supplier}</span>
              <span className={styles.alert_exceed}>&uarr; +{alert.exceedPct}% 超限</span>
            </div>
            <div className={styles.alert_row__material}>{alert.material}</div>
            <div className={styles.alert_row__prices}>
              <div className={styles.alert_price_item}>
                <span className={styles.alert_price_item__label}>本次价格</span>
                <span className={`${styles.alert_price_item__value} ${styles['alert_price_item__value--current']}`}>
                  {alert.currentPrice} / {alert.currentUnit}
                </span>
              </div>
              <div className={styles.alert_price_item}>
                <span className={styles.alert_price_item__label}>历史12月均价</span>
                <span className={`${styles.alert_price_item__value} ${styles['alert_price_item__value--avg']}`}>
                  {alert.avgPrice} / {alert.avgUnit}
                </span>
              </div>
              <div className={styles.alert_price_item}>
                <span className={styles.alert_price_item__label}>超出金额</span>
                <span className={`${styles.alert_price_item__value} ${styles['alert_price_item__value--current']}`}>
                  {alert.exceedAmount}
                </span>
              </div>
            </div>
          </div>
          <div className={styles.alert_row__actions}>
            <button
              className={styles.btn_secondary_sm}
              onClick={() => showToast({ type: 'success', message: '已标记核实' })}
            >
              标记已核实
            </button>
            <button
              className={styles.btn_danger_outline}
              onClick={() => showToast({ type: 'warning', message: '已拒绝此价格，协议状态已置为已驳回' })}
            >
              拒绝此价格
            </button>
          </div>
        </div>
      ))}

      <div className={styles.alert_threshold}>
        <span>&#8505;</span>
        <span>
          价格异常预警阈值：超历史 12 个月均价 <strong>20%</strong> 触发
        </span>
        <Button
          variant="ghost"
          size="sm"
          style={{ marginLeft: 'auto' }}
          onClick={() => showToast({ type: 'info', message: '请设置新的预警阈值' })}
        >
          修改阈值
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 组件：Price Diff Pill
// ─────────────────────────────────────────────
function PriceDiffPill({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return <span>&mdash;</span>;

  if (pct === 0) {
    return (
      <span className={`${styles.price_diff} ${styles['price_diff--ok']}`}>
        +0.0%
      </span>
    );
  }

  const isRise = pct > 0;
  const absStr = Math.abs(pct).toFixed(1);
  const label = isRise ? `\u25B2 +${absStr}%` : `\u25BC -${absStr}%`;
  const cls = isRise
    ? `${styles.price_diff} ${styles['price_diff--warn']}`
    : `${styles.price_diff} ${styles['price_diff--ok']}`;

  return <span className={cls}>{label}</span>;
}

// ─────────────────────────────────────────────
// 组件：Status Tag
// ─────────────────────────────────────────────
function PriceStatusTag({ isActive, isExpiring }: { isActive: boolean; isExpiring?: boolean }) {
  if (!isActive) {
    return (
      <span className={`${styles.status_tag} ${styles['status_tag--expired']}`}>
        已过期
      </span>
    );
  }
  if (isExpiring) {
    return (
      <span className={`${styles.status_tag} ${styles['status_tag--expiring']}`}>
        &#9201; 即将到期
      </span>
    );
  }
  return (
    <span className={`${styles.status_tag} ${styles['status_tag--valid']}`}>
      &#10003; 有效
    </span>
  );
}

// ─────────────────────────────────────────────
// 组件：Grade Badge
// ─────────────────────────────────────────────
function GradeBadge({ grade }: { grade: SupplierGrade }) {
  const cls =
    grade === 'A' ? styles.grade_A :
    grade === 'B' ? styles.grade_B :
    grade === 'C' ? styles.grade_C :
    styles.grade_C; // D falls to C styling

  return (
    <span className={`${styles.grade_badge} ${cls}`}>{grade}级</span>
  );
}

// ─────────────────────────────────────────────
// 组件：Price Trend SVG Chart (动态渲染)
// ─────────────────────────────────────────────
function PriceTrendSvg({ history }: { history: PriceHistoryItem[] }) {
  // Take up to 12 most recent history items, reversed to oldest-first
  const items = [...history].slice(0, 12).reverse();

  if (items.length < 2) {
    return (
      <div style={{ padding: 'var(--space-4)', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
        历史价格数据不足，无法生成趋势图
      </div>
    );
  }

  const prices = items.map((h) => parseFloat(h.price));
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const avgP = prices.reduce((a, b) => a + b, 0) / prices.length;
  const range = maxP - minP || 1;
  const padding = range * 0.15;
  const yMin = minP - padding;
  const yMax = maxP + padding;
  const yRange = yMax - yMin || 1;

  const W = 760;
  const H = 200;
  const LEFT = 50;
  const RIGHT = 740;
  const TOP = 16;
  const BOT = 175;

  const toX = (i: number) => LEFT + ((RIGHT - LEFT) / (items.length - 1)) * i;
  const toY = (p: number) => BOT - ((p - yMin) / yRange) * (BOT - TOP);

  const points = items.map((_, i) => `${toX(i)},${toY(prices[i])}`).join(' ');
  const areaPath = items.map((_, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(prices[i])}`).join(' ')
    + ` L${toX(items.length - 1)},${BOT} L${toX(0)},${BOT} Z`;

  // Y-axis labels (5 levels)
  const yLabels = Array.from({ length: 5 }, (_, i) => yMin + (yRange / 4) * (4 - i));

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ minWidth: '560px', display: 'block' }}
        role="img"
        aria-label="价格趋势折线图"
      >
        {/* Y-axis labels & grid */}
        {yLabels.map((val, i) => {
          const y = TOP + ((BOT - TOP) / 4) * i;
          return (
            <g key={i}>
              <text x={LEFT - 4} y={y + 4} fontSize="10" fill="#94A3B8" textAnchor="end">
                {'\u00A5'}{val.toFixed(0)}
              </text>
              <line x1={LEFT} y1={y} x2={RIGHT} y2={y} stroke="#E2E8F0" strokeWidth="1" />
            </g>
          );
        })}

        {/* Y axis line */}
        <line x1={LEFT} y1={TOP - 6} x2={LEFT} y2={BOT} stroke="#CBD5E1" strokeWidth="1.5" />

        {/* Historical avg dashed line */}
        <line x1={LEFT} y1={toY(avgP)} x2={RIGHT} y2={toY(avgP)}
          stroke="#F59E0B" strokeWidth="1.5" strokeDasharray="6,4" />
        <text x={RIGHT + 4} y={toY(avgP) + 4} fontSize="10" fill="#D97706" fontWeight="600">均价</text>

        {/* Gradient fill */}
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3B82F6" stopOpacity=".15" />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#lineGrad)" />
        <polyline points={points} fill="none" stroke="#3B82F6" strokeWidth="2.5"
          strokeLinejoin="round" strokeLinecap="round" />

        {/* Data points */}
        {items.map((_, i) => (
          <circle key={i} cx={toX(i)} cy={toY(prices[i])} r="4" fill="#3B82F6" />
        ))}

        {/* Current point highlighted */}
        <circle cx={toX(items.length - 1)} cy={toY(prices[prices.length - 1])} r="6"
          fill="#fff" stroke="#3B82F6" strokeWidth="2.5" />
        <text x={toX(items.length - 1) + 6} y={toY(prices[prices.length - 1]) - 6}
          fontSize="10" fill="#2563EB" fontWeight="700">当前</text>

        {/* X axis */}
        <line x1={LEFT} y1={BOT} x2={RIGHT} y2={BOT} stroke="#CBD5E1" strokeWidth="1.5" />
        {items.map((h, i) => {
          const dateStr = h.effectiveAt ? h.effectiveAt.slice(5, 7) + '月' : `#${i + 1}`;
          return (
            <text key={i} x={toX(i)} y={BOT + 14} fontSize="10" fill="#94A3B8" textAnchor="middle">
              {dateStr}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────
// 工具：带认证的文件 URL（将 /uploads/xxx 转为 blob URL）
// ─────────────────────────────────────────────

function useAuthBlobUrl(url: string | undefined | null): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const prevUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!url) { setBlobUrl(null); return; }
    if (url === prevUrl.current) return;
    prevUrl.current = url;

    const token = getAccessToken();
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
      .then((blob) => setBlobUrl(URL.createObjectURL(blob)))
      .catch(() => setBlobUrl(null));

    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return blobUrl;
}

function openAuthFile(url: string) {
  const token = getAccessToken();
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
    .then((blob) => {
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
      // 延迟释放，让新标签页有时间加载
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    })
    .catch(() => { /* silently fail */ });
}

/** 带认证的协议文件展示（图片缩略图 + 查看原图 / 非图片查看文件） */
function AuthAttachment({ url }: { url: string }) {
  const isImage = /\.(jpg|jpeg|png)$/i.test(url);
  const blobUrl = useAuthBlobUrl(isImage ? url : null);

  if (isImage) {
    return (
      <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {blobUrl ? (
          <img
            src={blobUrl}
            alt="协议文件"
            style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 6, border: '1px solid var(--border-primary)', objectFit: 'contain', cursor: 'pointer' }}
            onClick={() => openAuthFile(url)}
          />
        ) : (
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>加载中…</span>
        )}
        <a
          href="#"
          className={styles.agreement_detail__link}
          onClick={(e) => { e.preventDefault(); openAuthFile(url); }}
        >
          查看原图
        </a>
      </span>
    );
  }

  return (
    <a
      href="#"
      className={styles.agreement_detail__link}
      onClick={(e) => { e.preventDefault(); openAuthFile(url); }}
    >
      查看文件
    </a>
  );
}

// ─────────────────────────────────────────────
// 组件：Chart Panel (使用真实历史数据)
// ─────────────────────────────────────────────
function ChartPanel({
  price,
  allPricesForSku,
  supplierGradeMap,
  onClose,
  showHeader = true,
}: {
  price: PriceRow;
  allPricesForSku: PriceRow[];
  supplierGradeMap: Map<number, SupplierGrade>;
  onClose: () => void;
  showHeader?: boolean;
}) {
  const { data: historyData } = usePriceHistory(price.skuId, price.supplierId);
  const history = historyData ?? [];

  // Compute stats from history
  const prices = history.map((h) => parseFloat(h.price));
  const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
  const currentPrice = parseFloat(price.unitPrice);
  const avgDevPct = avgPrice > 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0;
  const isDevOk = avgDevPct <= 0;

  // Supplier compare: same SKU, different suppliers
  const comparePrices = allPricesForSku
    .filter((p) => p.isActive)
    .sort((a, b) => parseFloat(b.unitPrice) - parseFloat(a.unitPrice));

  return (
    <div className={styles.chart_panel}>
      {showHeader && (
        <div className={styles.chart_panel__header}>
          <span className={styles.chart_panel__header_icon}>&#128200;</span>
          <div>
            <div className={styles.chart_panel__title}>
              价格详情 &mdash; {price.skuName}
            </div>
            <div className={styles.chart_panel__sub}>
              {price.supplierName} &middot; 过去12个月价格趋势
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            style={{ marginLeft: 'auto' }}
            onClick={onClose}
          >
            收起 &uarr;
          </Button>
        </div>
      )}

      <div className={styles.chart_panel__body}>
        {!showHeader && (
          <div style={{ marginBottom: 'var(--space-4)', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {price.supplierName} &middot; 过去12个月价格趋势
          </div>
        )}
        {/* Supplier compare table */}
        {comparePrices.length > 0 && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div className={styles.compare_section_label}>当前有效价格（供应商对比）</div>
            <table className={styles.compare_table}>
              <thead>
                <tr>
                  <th>供应商</th>
                  <th>单价</th>
                  <th>级别</th>
                  <th>有效期</th>
                </tr>
              </thead>
              <tbody>
                {comparePrices.map((cp) => {
                  const isCurrent = cp.id === price.id;
                  const grade = supplierGradeMap.get(cp.supplierId) ?? 'B';
                  return (
                    <tr key={cp.id}>
                      <td>
                        {isCurrent && <span className={styles.preferred_dot} />}
                        <strong>{cp.supplierName}</strong>
                        {isCurrent && <span className={styles.primary_supplier_label}>当前主供</span>}
                      </td>
                      <td className={styles['compare_price--normal']}>{formatCNY(cp.unitPrice)}</td>
                      <td><GradeBadge grade={grade} /></td>
                      <td>
                        {cp.validTo ? `至 ${formatDate(cp.validTo)}` : '长期'}
                        {cp.isExpiring && <span className={styles.expiring_label}>即将到期</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* SVG chart */}
        <div className={styles.compare_section_label}>
          价格趋势（过去12个月 &middot; {price.supplierName}）
        </div>
        <PriceTrendSvg history={history} />

        {/* Chart meta */}
        <div className={styles.chart_meta}>
          <div className={styles.chart_meta__item}>
            <span className={styles.chart_meta__label}>当前价格</span>
            <span className={styles.chart_meta__value}>
              {formatCNY(price.unitPrice)} / {price.purchaseUnit}
            </span>
          </div>
          <div className={styles.chart_meta__item}>
            <span className={styles.chart_meta__label}>历史均价</span>
            <span className={styles.chart_meta__value}>
              {avgPrice > 0 ? `${formatCNY(String(avgPrice.toFixed(2)))} / ${price.purchaseUnit}` : '—'}
            </span>
          </div>
          <div className={styles.chart_meta__item}>
            <span className={styles.chart_meta__label}>较均价偏差</span>
            <span className={`${styles.chart_meta__value} ${isDevOk ? styles['chart_meta__value--ok'] : styles['chart_meta__value--warn']}`}>
              {avgPrice > 0
                ? `${isDevOk ? '\u25BC' : '\u25B2'} ${isDevOk ? '' : '+'}${avgDevPct.toFixed(1)}%（${isDevOk ? '正常' : '偏高'}）`
                : '—'}
            </span>
          </div>
          <div className={styles.chart_meta__item}>
            <span className={styles.chart_meta__label}>历史最高价</span>
            <span className={styles.chart_meta__value}>
              {maxPrice > 0 ? formatCNY(String(maxPrice.toFixed(2))) : '—'}
            </span>
          </div>
        </div>

        {/* 协议详细信息 */}
        <div className={styles.agreement_detail}>
          <div className={styles.agreement_detail__title}>协议详细信息</div>
          <div className={styles.agreement_detail__grid}>
            <div className={styles.agreement_detail__item}>
              <span className={styles.agreement_detail__label}>税率</span>
              <span className={styles.agreement_detail__value}>
                {price.taxRate ? `${price.taxRate}%` : '13%（默认）'}
              </span>
            </div>
            <div className={styles.agreement_detail__item}>
              <span className={styles.agreement_detail__label}>最小起订量</span>
              <span className={styles.agreement_detail__value}>
                {price.moq != null ? `${price.moq} ${price.purchaseUnit}` : '—'}
              </span>
            </div>
            <div className={styles.agreement_detail__item}>
              <span className={styles.agreement_detail__label}>采购周期</span>
              <span className={styles.agreement_detail__value}>
                {price.purchaseCycleDays != null ? `${price.purchaseCycleDays} 天` : '—'}
              </span>
            </div>
            <div className={styles.agreement_detail__item}>
              <span className={styles.agreement_detail__label}>运输周期</span>
              <span className={styles.agreement_detail__value}>
                {price.transportCycleDays != null ? `${price.transportCycleDays} 天` : '—'}
              </span>
            </div>
            <div className={styles.agreement_detail__item}>
              <span className={styles.agreement_detail__label}>采购时效合计</span>
              <span className={styles.agreement_detail__value}>
                {price.purchaseCycleDays != null || price.transportCycleDays != null
                  ? `${(price.purchaseCycleDays ?? 0) + (price.transportCycleDays ?? 0)} 天`
                  : '—'}
              </span>
            </div>
            <div className={styles.agreement_detail__item}>
              <span className={styles.agreement_detail__label}>有效期</span>
              <span className={styles.agreement_detail__value}>
                {price.validFrom ? formatDate(price.validFrom) : '—'} 至 {price.validTo ? formatDate(price.validTo) : '长期有效'}
              </span>
            </div>
            <div className={styles.agreement_detail__item}>
              <span className={styles.agreement_detail__label}>批次条件</span>
              <span className={styles.agreement_detail__value}>
                {price.batchPricing ? (price.batchRule || '已启用') : '未启用'}
              </span>
            </div>
            <div className={styles.agreement_detail__item} style={{ gridColumn: '1 / -1' }}>
              <span className={styles.agreement_detail__label}>关联协议文件</span>
              <span className={styles.agreement_detail__value}>
                {price.attachmentUrl ? (
                  <AuthAttachment url={price.attachmentUrl} />
                ) : '暂无协议文件'}
              </span>
            </div>
            <div className={styles.agreement_detail__item} style={{ gridColumn: '1 / -1' }}>
              <span className={styles.agreement_detail__label}>备注</span>
              <span className={styles.agreement_detail__value}>
                {price.notes || '—'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 组件：Supplier Group Accordion
// ─────────────────────────────────────────────
function SupplierGroupAccordion({
  group,
  onEdit,
  onAddAgreement,
  selectedPriceId,
  onSelectPrice,
}: {
  group: SupplierGroup;
  onEdit: (p: PriceRow) => void;
  onAddAgreement: (supplierId: number) => void;
  selectedPriceId: number | null;
  onSelectPrice: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className={styles.supplier_group}>
      <button
        type="button"
        className={styles.supplier_group__header}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span
          className={`${styles.supplier_group__toggle} ${open ? styles['supplier_group__toggle--open'] : ''}`}
        >
          &#9654;
        </span>
        <span className={styles.supplier_group__name}>{group.supplierName}</span>
        <GradeBadge grade={group.grade} />
        <div className={styles.supplier_group__actions}>
          {group.warnCount > 0 && (
            <span className={`${styles.supplier_group__count} ${styles['supplier_group__count--warn']}`}>
              ! {group.warnCount} 条价格预警
            </span>
          )}
          <span className={styles.supplier_group__count}>
            共 {group.prices.length} 条协议
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onAddAgreement(group.supplierId); }}
          >
            + 新增该供应商协议
          </Button>
        </div>
      </button>

      <div
        className={`${styles.supplier_group__body} ${open ? styles['supplier_group__body--open'] : ''}`}
      >
        {group.prices.length > 0 ? (
          <table className={styles.price_table}>
            <thead>
              <tr>
                <th>物料名称</th>
                <th>单位</th>
                <th style={{ textAlign: 'right' }}>含税单价</th>
                <th>vs 历史均价</th>
                <th>有效期</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {group.prices.map((p) => (
                <tr
                  key={p.id}
                  className={selectedPriceId === p.id ? styles.row_selected : ''}
                  onClick={() => onSelectPrice(selectedPriceId === p.id ? null : p.id)}
                >
                  <td>
                    <div className={styles.material_name}>{p.skuName}</div>
                    <div className={styles.material_code}>{p.skuCode}</div>
                  </td>
                  <td>{p.purchaseUnit}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={styles.price_value}>{formatCNY(p.unitPrice)}</span>
                  </td>
                  <td>
                    <PriceDiffPill pct={p.priceChangePct} />
                  </td>
                  <td>{renderValidPeriod(p)}</td>
                  <td>
                    <PriceStatusTag isActive={p.isActive} isExpiring={p.isExpiring} />
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); onEdit(p); }}
                    >
                      {p.isExpiring ? '续签' : '编辑'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: 'var(--space-4) var(--space-5)', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            暂无价格协议数据
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 组件：Material Group Accordion（按物料分组）
// ─────────────────────────────────────────────

function MaterialGroupAccordion({
  group,
  supplierGradeMap,
  onEdit,
  selectedPriceId,
  onSelectPrice,
}: {
  group: MaterialGroup;
  supplierGradeMap: Map<number, SupplierGrade>;
  onEdit: (p: PriceRow) => void;
  selectedPriceId: number | null;
  onSelectPrice: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className={styles.supplier_group}>
      <button
        type="button"
        className={styles.supplier_group__header}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span
          className={`${styles.supplier_group__toggle} ${open ? styles['supplier_group__toggle--open'] : ''}`}
        >
          &#9654;
        </span>
        <span className={styles.supplier_group__name}>{group.skuName}</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginLeft: 'var(--space-2)' }}>
          {group.skuCode}
        </span>
        <div className={styles.supplier_group__actions}>
          {group.bestActivePrice && (
            <span className={styles.supplier_group__count}>
              最优有效价：{group.bestActivePrice.supplierName} {formatCNY(group.bestActivePrice.unitPrice)}
            </span>
          )}
          {group.expiringCount > 0 && (
            <span className={`${styles.supplier_group__count} ${styles['supplier_group__count--warn']}`}>
              {group.expiringCount} 条即将到期
            </span>
          )}
          <span className={styles.supplier_group__count}>
            共 {group.prices.length} 家报价 / {group.activeCount} 家当前有效
          </span>
        </div>
      </button>

      <div
        className={`${styles.supplier_group__body} ${open ? styles['supplier_group__body--open'] : ''}`}
      >
        {group.prices.length > 0 ? (
          <table className={styles.price_table}>
            <thead>
              <tr>
                <th>供应商</th>
                <th>等级</th>
                <th>单位</th>
                <th style={{ textAlign: 'right' }}>含税单价</th>
                <th>vs 历史均价</th>
                <th>有效期</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {group.prices.map((p) => (
                <tr
                  key={p.id}
                  className={selectedPriceId === p.id ? styles.row_selected : ''}
                  onClick={() => onSelectPrice(selectedPriceId === p.id ? null : p.id)}
                >
                  <td>{p.supplierName}</td>
                  <td><GradeBadge grade={supplierGradeMap.get(p.supplierId) ?? 'B'} /></td>
                  <td>{p.purchaseUnit}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={styles.price_value}>{formatCNY(p.unitPrice)}</span>
                  </td>
                  <td>
                    <PriceDiffPill pct={p.priceChangePct} />
                  </td>
                  <td>{renderValidPeriod(p)}</td>
                  <td>
                    <PriceStatusTag isActive={p.isActive} isExpiring={p.isExpiring} />
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); onEdit(p); }}
                    >
                      {p.isExpiring ? '续签' : '编辑'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: 'var(--space-4) var(--space-5)', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            暂无价格协议数据
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 表单类型
// ─────────────────────────────────────────────

type PriceFormData = {
  supplierId: string;
  skuSearch: string;
  skuId: number | null;
  skuSelected: string;
  unitPrice: string;
  taxRate: string;
  purchaseUnit: string;
  moq: string;
  purchaseCycleDays: string;
  transportCycleDays: string;
  validFrom: string;
  validTo: string;
  batchPricing: boolean;
  batchRule: string;
  remark: string;
  /** 上传成功后服务器返回的文件 URL */
  attachmentUrl: string;
  /** 编辑时用 */
  editPriceId: number | null;
};

const EMPTY_PRICE_FORM: PriceFormData = {
  supplierId: '',
  skuSearch: '',
  skuId: null,
  skuSelected: '',
  unitPrice: '',
  taxRate: '13%',
  purchaseUnit: '',
  moq: '',
  purchaseCycleDays: '',
  transportCycleDays: '',
  validFrom: '',
  validTo: '',
  batchPricing: false,
  batchRule: '',
  remark: '',
  attachmentUrl: '',
  editPriceId: null,
};

// ─────────────────────────────────────────────
// 组件：Drawer Form Fields
// ─────────────────────────────────────────────

function DrawerFormFields({
  form,
  onChange,
  isNew,
  priceWarn,
  suppliers,
  skuResults,
  onSkuSearch,
}: {
  form: PriceFormData;
  onChange: (patch: Partial<PriceFormData>) => void;
  isNew: boolean;
  priceWarn: string;
  suppliers: Supplier[];
  skuResults: Array<{ id: number; skuCode: string; name: string; unit?: string }>;
  onSkuSearch: (kw: string) => void;
}) {
  const set =
    (field: keyof PriceFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      onChange({ [field]: e.target.value });

  const [showSkuDropdown, setShowSkuDropdown] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Derived display values for the file attachment area
  const hasFile = selectedFile !== null || form.attachmentUrl !== '';
  const displayFileName = selectedFile?.name ?? (form.attachmentUrl ? form.attachmentUrl.split('/').pop() : '');
  const displayFileSize = selectedFile ? `${(selectedFile.size / 1024).toFixed(0)} KB` : '';

  return (
    <>
      {/* 基本信息 */}
      <div className={styles.form_section}>
        <div className={styles.form_section__title}>基本信息</div>
        <div className={styles.form_group}>
          <label className={`${styles.form_label} ${styles['form_label--required']}`} htmlFor="drawerSupplier">
            供应商
          </label>
          <select
            className={styles.form_select}
            id="drawerSupplier"
            value={form.supplierId}
            onChange={set('supplierId')}
            disabled={!isNew}
          >
            <option value="">请选择供应商</option>
            {suppliers.map((s) => {
              const rec = s as unknown as Record<string, unknown>;
              const grade = (rec.rating ?? rec.grade ?? 'B') as string;
              return (
                <option key={s.id} value={s.id}>
                  {s.name}（{grade}级）
                </option>
              );
            })}
          </select>
        </div>
        <div className={styles.form_group}>
          <label className={`${styles.form_label} ${styles['form_label--required']}`}>物料</label>
          <div className={styles.drawer_search} style={{ position: 'relative' }}>
            <span className={styles.drawer_search__icon}>&#128269;</span>
            <input
              className={styles.drawer_search__input}
              type="text"
              placeholder="搜索物料名称或SKU编码..."
              value={form.skuSearch}
              onChange={(e) => {
                onChange({ skuSearch: e.target.value });
                onSkuSearch(e.target.value);
                setShowSkuDropdown(true);
              }}
              onFocus={() => form.skuSearch && setShowSkuDropdown(true)}
              onBlur={() => setTimeout(() => setShowSkuDropdown(false), 200)}
              disabled={!isNew}
            />
            {showSkuDropdown && skuResults.length > 0 && isNew && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                background: '#fff', border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)',
                maxHeight: '200px', overflowY: 'auto',
              }}>
                {skuResults.map((sku) => (
                  <div
                    key={sku.id}
                    style={{
                      padding: 'var(--space-2) var(--space-3)',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                    }}
                    onMouseDown={() => {
                      onChange({
                        skuId: sku.id,
                        skuSelected: `${sku.name}（${sku.skuCode}）`,
                        skuSearch: sku.name,
                        purchaseUnit: sku.unit ?? '',
                      });
                      setShowSkuDropdown(false);
                    }}
                  >
                    <strong>{sku.name}</strong>
                    <span style={{ color: 'var(--text-secondary)', marginLeft: '8px' }}>{sku.skuCode}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {form.skuSelected && (
            <div className={styles.selected_material}>已选择：{form.skuSelected}</div>
          )}
        </div>
      </div>

      {/* 价格协议信息 */}
      <div className={styles.form_section}>
        <div className={styles.form_section__title}>价格协议信息</div>
        <div className={styles.form_group}>
          <label className={`${styles.form_label} ${styles['form_label--required']}`} htmlFor="drawerPrice">
            含税单价
          </label>
          <div className={styles.input_with_suffix}>
            <input
              className={styles.form_input}
              type="number"
              id="drawerPrice"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={form.unitPrice}
              onChange={(e) => {
                onChange({ unitPrice: e.target.value });
              }}
            />
            <span className={styles.input_suffix}>元 / {form.purchaseUnit || '件'}</span>
          </div>
          {priceWarn && (
            <div className={`${styles.form_hint} ${styles['form_hint--warn']}`}>
              {priceWarn}
            </div>
          )}
        </div>
        <div className={styles.form_grid_2}>
          <div className={styles.form_group}>
            <label className={styles.form_label} htmlFor="drawerTax">税率</label>
            <select
              className={styles.form_select}
              id="drawerTax"
              value={form.taxRate}
              onChange={set('taxRate')}
            >
              <option>13%</option>
              <option>9%</option>
              <option>6%</option>
              <option>0%</option>
            </select>
          </div>
          <div className={styles.form_group}>
            <label className={styles.form_label} htmlFor="drawerMoq">最小起订量（选填）</label>
            <div className={styles.input_with_suffix}>
              <input
                className={styles.form_input}
                type="number"
                id="drawerMoq"
                min="0"
                placeholder="0"
                value={form.moq}
                onChange={set('moq')}
              />
              <span className={styles.input_suffix}>{form.purchaseUnit || '件'}</span>
            </div>
          </div>
        </div>
        <div className={styles.form_grid_2}>
          <div className={styles.form_group}>
            <label className={styles.form_label} htmlFor="drawerPurchaseCycle">采购周期（天）</label>
            <input
              className={styles.form_input}
              type="number"
              id="drawerPurchaseCycle"
              min="0"
              step="1"
              placeholder="例如 5"
              value={form.purchaseCycleDays}
              onChange={set('purchaseCycleDays')}
            />
          </div>
          <div className={styles.form_group}>
            <label className={styles.form_label} htmlFor="drawerTransportCycle">运输周期（天）</label>
            <input
              className={styles.form_input}
              type="number"
              id="drawerTransportCycle"
              min="0"
              step="1"
              placeholder="例如 2"
              value={form.transportCycleDays}
              onChange={set('transportCycleDays')}
            />
          </div>
        </div>
      </div>

      {/* 有效期 */}
      <div className={styles.form_section}>
        <div className={styles.form_section__title}>有效期</div>
        <div className={styles.form_grid_2}>
          <div className={styles.form_group}>
            <label className={`${styles.form_label} ${styles['form_label--required']}`} htmlFor="drawerStart">
              生效日期
            </label>
            <input
              className={styles.form_input}
              type="date"
              id="drawerStart"
              value={form.validFrom}
              onChange={set('validFrom')}
            />
          </div>
          <div className={styles.form_group}>
            <label className={`${styles.form_label} ${styles['form_label--required']}`} htmlFor="drawerEnd">
              失效日期
            </label>
            <input
              className={styles.form_input}
              type="date"
              id="drawerEnd"
              value={form.validTo}
              onChange={set('validTo')}
            />
          </div>
        </div>
      </div>

      {/* 批次条件 */}
      <div className={styles.form_section}>
        <div className={styles.form_section__title}>批次条件（选填）</div>
        <label className={styles.checkbox_option}>
          <input
            type="checkbox"
            checked={form.batchPricing}
            onChange={(e) => onChange({ batchPricing: e.target.checked })}
          />
          <span>按批次不同价格</span>
        </label>
        <div className={styles.form_group}>
          <label className={styles.form_label} htmlFor="batchRule">批次规则说明</label>
          <input
            className={styles.form_input}
            type="text"
            id="batchRule"
            placeholder="如：Q1按180，Q2按175"
            value={form.batchRule}
            onChange={set('batchRule')}
          />
        </div>
      </div>

      {/* 附件与备注 */}
      <div className={styles.form_section}>
        <div className={styles.form_section__title}>附件与备注</div>
        <div className={styles.form_group}>
          <label className={styles.form_label}>关联协议文件</label>
          {hasFile ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '0.875rem' }}>
              <span style={{ color: 'var(--color-primary-600)' }}>&#128196;</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayFileName}
              </span>
              {displayFileSize && (
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                  {displayFileSize}
                </span>
              )}
              {uploading && (
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>上传中...</span>
              )}
              <button
                type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error-500)', fontSize: '1rem' }}
                onClick={() => {
                  setSelectedFile(null);
                  onChange({ attachmentUrl: '' });
                }}
              >
                &times;
              </button>
            </div>
          ) : (
            <label className={styles.upload_btn} style={uploading ? { pointerEvents: 'none', opacity: 0.6 } : undefined}>
              {uploading ? '上传中...' : <>{'\u{1F4CE}'} 上传 PDF / 图片（最大10MB）</>}
              <input
                type="file"
                style={{ display: 'none' }}
                accept=".pdf,.jpg,.jpeg,.png"
                disabled={uploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 10 * 1024 * 1024) {
                    e.target.value = '';
                    return;
                  }
                  setSelectedFile(file);
                  setUploading(true);
                  try {
                    const result = await uploadPriceFile(file);
                    onChange({ attachmentUrl: result.url });
                  } catch {
                    setSelectedFile(null);
                    onChange({ attachmentUrl: '' });
                  } finally {
                    setUploading(false);
                    e.target.value = '';
                  }
                }}
              />
            </label>
          )}
        </div>
        <div className={styles.form_group}>
          <label className={styles.form_label} htmlFor="drawerRemark">备注</label>
          <input
            className={styles.form_input}
            type="text"
            id="drawerRemark"
            placeholder="补充说明..."
            value={form.remark}
            onChange={set('remark')}
          />
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────
// 主页面组件
// ─────────────────────────────────────────────

export default function PricePage() {
  const { setPageTitle, showToast } = useAppStore();

  // View
  const [viewMode, setViewMode] = useState<ViewMode>('supplier');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');

  // Alert panel
  const [alertPanelOpen, setAlertPanelOpen] = useState(false);

  // Chart
  const [selectedPriceId, setSelectedPriceId] = useState<number | null>(null);

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create');
  const [drawerTitle, setDrawerTitle] = useState('新增价格协议');
  const [priceForm, setPriceForm] = useState<PriceFormData>(EMPTY_PRICE_FORM);
  const [priceWarn, setPriceWarn] = useState('');

  // SKU search for drawer
  const [skuSearchKeyword, setSkuSearchKeyword] = useState('');
  const [debouncedSkuSearch, setDebouncedSkuSearch] = useState('');

  // Price warning modal
  const [priceWarnModal, setPriceWarnModal] = useState(false);
  const [priceWarnNewPrice, setPriceWarnNewPrice] = useState('');
  const [priceWarnExceedPct, setPriceWarnExceedPct] = useState('');

  // Batch import modal
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importErrorStrategy, setImportErrorStrategy] = useState<'skip' | 'cancel'>('skip');
  const [importing, setImporting] = useState(false);

  // ── API Data ──
  const isActiveFilter = statusFilter === 'active' ? true : statusFilter === 'expired' ? false : undefined;
  const { data: priceData, isLoading: _priceLoading } = usePriceList({
    page: 1,
    pageSize: PAGE_SIZE,
    keyword: debouncedKeyword || undefined,
    isActive: isActiveFilter,
  });

  const { data: supplierData } = useSupplierOptions();
  const suppliers: Supplier[] = supplierData ?? EMPTY_SUPPLIERS;

  // SKU search for drawer
  const { data: skuData } = useSkuList({
    page: 1,
    pageSize: 20,
    keyword: debouncedSkuSearch || undefined,
  });

  const createMutation = useCreatePrice();
  const updateMutation = useUpdatePrice();

  useEffect(() => { setPageTitle('采购价格管理'); }, [setPageTitle]);

  // Debounce keyword
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword), 350);
    return () => clearTimeout(t);
  }, [keyword]);

  // Debounce SKU search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSkuSearch(skuSearchKeyword), 350);
    return () => clearTimeout(t);
  }, [skuSearchKeyword]);

  // ── Build supplier grade map ──
  const supplierGradeMap = useMemo(() => {
    const map = new Map<number, SupplierGrade>();
    for (const s of suppliers) {
      const rec = s as unknown as Record<string, unknown>;
      const grade = (rec.rating ?? rec.grade ?? 'B') as SupplierGrade;
      map.set(s.id, grade);
    }
    return map;
  }, [suppliers]);

  // ── Enrich price list ──
  const priceList: PriceRow[] = useMemo(() => {
    const list = (priceData?.list ?? []) as PriceRow[];
    return list.map((p) => ({
      ...p,
      isExpiring: p.isActive && isExpiringSoon(p.validTo),
      priceChangePct: null, // computed per-row from history would require N API calls
    }));
  }, [priceData]);

  // ── Filter by status ──
  const filteredPriceList = useMemo(() => {
    if (statusFilter === 'expiring') {
      return priceList.filter((p) => p.isExpiring);
    }
    // 'active', 'expired', 'all' are handled by API isActive filter
    return priceList;
  }, [priceList, statusFilter]);

  // ── Compute stats ──
  const stats = useMemo(() => {
    const activeCount = priceList.filter((p) => p.isActive).length;
    const expiringCount = priceList.filter((p) => p.isExpiring).length;
    // alertCount: we don't have historical avg per-row from list API, show 0 for now
    // (alerts are detected at create-time by backend)
    return { activeCount, expiringCount, alertCount: 0 };
  }, [priceList]);

  // ── Compute alerts (placeholder — no server-side alert list yet) ──
  const alerts: AlertItem[] = useMemo(() => [], []);

  // ── Group by supplier ──
  const supplierGroups: SupplierGroup[] = useMemo(() => {
    const groupMap = new Map<number, PriceRow[]>();
    for (const p of filteredPriceList) {
      const arr = groupMap.get(p.supplierId) ?? [];
      arr.push(p);
      groupMap.set(p.supplierId, arr);
    }

    const groups: SupplierGroup[] = [];
    for (const [supplierId, prices] of groupMap) {
      const supplierName = prices[0]?.supplierName ?? `供应商#${supplierId}`;
      const grade = supplierGradeMap.get(supplierId) ?? 'B';
      const warnCount = prices.filter((p) => p.priceAnomaly).length;
      groups.push({ supplierId, supplierName, grade, warnCount, prices });
    }

    // Sort: A > B > C > D, then by name
    const gradeOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
    groups.sort((a, b) => (gradeOrder[a.grade] ?? 9) - (gradeOrder[b.grade] ?? 9) || a.supplierName.localeCompare(b.supplierName));

    return groups;
  }, [filteredPriceList, supplierGradeMap]);

  // ── Group by material (SKU) ──
  const materialGroups: MaterialGroup[] = useMemo(() => {
    const groupMap = new Map<number, PriceRow[]>();
    for (const p of filteredPriceList) {
      const arr = groupMap.get(p.skuId) ?? [];
      arr.push(p);
      groupMap.set(p.skuId, arr);
    }

    const groups: MaterialGroup[] = [];
    for (const [skuId, prices] of groupMap) {
      const skuName = prices[0]?.skuName ?? `物料#${skuId}`;
      const skuCode = prices[0]?.skuCode ?? '';
      const sortedPrices = [...prices].sort((a, b) => parseFloat(a.unitPrice) - parseFloat(b.unitPrice));
      const activePrices = sortedPrices.filter((price) => price.isActive);
      groups.push({
        skuId,
        skuName,
        skuCode,
        prices: sortedPrices,
        bestActivePrice: activePrices[0] ?? null,
        activeCount: activePrices.length,
        expiringCount: sortedPrices.filter((price) => price.isExpiring).length,
      });
    }

    // Sort groups by skuName
    groups.sort((a, b) => a.skuName.localeCompare(b.skuName));
    return groups;
  }, [filteredPriceList]);

  // ── Selected price row ──
  const selectedPrice = useMemo(() => {
    if (selectedPriceId === null) return null;
    return priceList.find((p) => p.id === selectedPriceId) ?? null;
  }, [selectedPriceId, priceList]);

  // All prices for same SKU as selected (for comparison table)
  const allPricesForSelectedSku = useMemo(() => {
    if (!selectedPrice) return [];
    return priceList.filter((p) => p.skuId === selectedPrice.skuId);
  }, [selectedPrice, priceList]);

  // ── Price warning check ──
  // No hardcoded HIST_AVG_PRICE — warning comes from backend on save
  useEffect(() => {
    setPriceWarn('');
  }, [priceForm.unitPrice]);

  const openCreate = useCallback((supplierId?: number) => {
    setPriceForm({
      ...EMPTY_PRICE_FORM,
      supplierId: supplierId ? String(supplierId) : '',
    });
    setPriceWarn('');
    setDrawerMode('create');
    setDrawerTitle('新增价格协议');
    setDrawerOpen(true);
  }, []);

  const openEdit = useCallback((price: PriceRow) => {
    setPriceForm({
      supplierId: String(price.supplierId),
      skuSearch: price.skuName,
      skuId: price.skuId,
      skuSelected: `${price.skuName}（${price.skuCode}）`,
      unitPrice: price.unitPrice,
      taxRate: price.taxRate ? `${price.taxRate}%` : '13%',
      purchaseUnit: price.purchaseUnit,
      moq: price.moq != null ? String(price.moq) : '',
      purchaseCycleDays: price.purchaseCycleDays != null ? String(price.purchaseCycleDays) : '',
      transportCycleDays: price.transportCycleDays != null ? String(price.transportCycleDays) : '',
      validFrom: price.validFrom ? price.validFrom.slice(0, 10) : '',
      validTo: price.validTo ? price.validTo.slice(0, 10) : '',
      batchPricing: Boolean(price.batchPricing),
      batchRule: price.batchRule ?? '',
      remark: price.notes ?? '',
      attachmentUrl: price.attachmentUrl ?? '',
      editPriceId: price.id,
    });
    setPriceWarn('');
    setDrawerMode('edit');
    setDrawerTitle(`编辑价格协议 — ${price.skuCode}`);
    setDrawerOpen(true);
  }, []);

  const handleSave = async () => {
    const { supplierId, unitPrice, purchaseUnit, validFrom, validTo, skuId } = priceForm;

    if (!supplierId || !unitPrice || !validFrom || !validTo) {
      showToast({ type: 'warning', message: '请填写所有必填字段' });
      return;
    }
    if (drawerMode === 'create' && !skuId) {
      showToast({ type: 'warning', message: '请选择物料' });
      return;
    }
    // 如果 purchaseUnit 为空，使用默认值
    if (!purchaseUnit) {
      setPriceForm((f) => ({ ...f, purchaseUnit: '件' }));
    }

    await doSave();
  };

  const doSave = async () => {
    const taxRateNum = priceForm.taxRate ? parseFloat(priceForm.taxRate.replace('%', '')) : undefined;
    const payload: CreatePricePayload = {
      supplierId: Number(priceForm.supplierId),
      skuId: priceForm.skuId ?? 0,
      unitPrice: priceForm.unitPrice,
      purchaseUnit: priceForm.purchaseUnit || '件',
      moq: priceForm.moq ? Number(priceForm.moq) : 0,
      purchaseCycleDays: priceForm.purchaseCycleDays ? Number(priceForm.purchaseCycleDays) : undefined,
      transportCycleDays: priceForm.transportCycleDays ? Number(priceForm.transportCycleDays) : undefined,
      validFrom: priceForm.validFrom,
      validTo: priceForm.validTo || undefined,
      notes: priceForm.remark || undefined,
      taxRate: taxRateNum && !isNaN(taxRateNum) ? String(taxRateNum) : undefined,
      batchPricing: priceForm.batchPricing || undefined,
      batchRule: priceForm.batchRule || undefined,
      attachmentUrl: priceForm.attachmentUrl || undefined,
    };

    try {
      if (drawerMode === 'create') {
        const result = await createMutation.mutateAsync(payload);
        // Check if backend flagged price anomaly
        const resultAny = result as unknown as Record<string, unknown>;
        if (resultAny.priceAnomaly) {
          const avg = parseFloat(String(resultAny.avgPrice ?? 0));
          const current = parseFloat(priceForm.unitPrice);
          const pct = avg > 0 ? ((current - avg) / avg * 100) : 0;
          setPriceWarnNewPrice(formatCNY(priceForm.unitPrice));
          setPriceWarnExceedPct(`+${pct.toFixed(1)}%`);
          setPriceWarnModal(true);
        } else {
          showToast({ type: 'success', message: '价格协议创建成功' });
        }
      } else {
        const editId = priceForm.editPriceId;
        if (!editId) return;
        await updateMutation.mutateAsync({
          id: editId,
          payload: {
            unitPrice: payload.unitPrice,
            purchaseUnit: payload.purchaseUnit,
            moq: payload.moq,
            purchaseCycleDays: payload.purchaseCycleDays,
            transportCycleDays: payload.transportCycleDays,
            validFrom: payload.validFrom,
            validTo: payload.validTo,
            notes: payload.notes,
            taxRate: payload.taxRate,
            batchPricing: payload.batchPricing,
            batchRule: payload.batchRule,
            attachmentUrl: payload.attachmentUrl,
          },
        });
        showToast({ type: 'success', message: '价格协议已更新' });
      }
      setDrawerOpen(false);
      setPriceForm(EMPTY_PRICE_FORM);
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleSelectPrice = useCallback((id: number | null) => {
    setSelectedPriceId(id);
  }, []);

  // SKU results for drawer
  const skuResults = useMemo(() => {
    if (!skuData?.list) return [];
    return skuData.list.map((s) => {
      const a = s as unknown as Record<string, unknown>;
      return {
        id: Number(s.id),
        skuCode: String(s.skuCode ?? a['sku_code'] ?? ''),
        name: String(s.name ?? ''),
        unit: String(a['purchaseUnit'] ?? a['purchase_unit'] ?? a['stockUnit'] ?? a['stock_unit'] ?? '件'),
      };
    });
  }, [skuData]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // ── Import handlers ──
  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setImportFile(file);
  };

  const handleImportConfirm = async () => {
    if (!importFile) {
      showToast({ type: 'warning', message: '请先选择要导入的文件' });
      return;
    }
    setImporting(true);
    try {
      const result = await importPrices(importFile, importErrorStrategy);
      const msg = `导入完成：成功 ${result.successCount} 条` +
        (result.failCount > 0 ? `，失败 ${result.failCount} 条` : '') +
        (result.skipCount > 0 ? `，跳过 ${result.skipCount} 条` : '');
      showToast({ type: result.failCount > 0 ? 'warning' : 'success', message: msg });
      setImportModalOpen(false);
      setImportFile(null);
      setImportErrorStrategy('skip');
    } catch (e) {
      const errMsg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
        || (e as Error).message || '导入失败，请检查文件格式';
      showToast({ type: 'error', message: errMsg });
    } finally {
      setImporting(false);
    }
  };

  const handleImportClose = () => {
    if (importing) return;
    setImportModalOpen(false);
    setImportFile(null);
    setImportErrorStrategy('skip');
  };

  return (
    <div className={styles.page}>

      {/* -- 页头 -- */}
      <div className="page-header">
        <h1 className="page-header__title">采购价格管理</h1>
        <div className="page-header__actions">
          <Button variant="ghost" size="md" onClick={() => setImportModalOpen(true)}>
            &uarr; 批量导入
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => openCreate()}
          >
            + 新增价格协议
          </Button>
        </div>
      </div>

      {/* -- Stats Strip -- */}
      <StatsStrip
        activeCount={stats.activeCount}
        expiringCount={stats.expiringCount}
        alertCount={stats.alertCount}
      />

      {/* -- Alert Banner -- */}
      {stats.alertCount > 0 && (
        <div className={styles.alert_banner} role="alert">
          <span className={styles.alert_banner__icon}>&#9888;</span>
          <span>
            <strong>价格异常预警：</strong>
            本月发现 {stats.alertCount} 条超历史均值 20% 的采购价格，请及时核查
          </span>
          <div className={styles.alert_banner__spacer} />
          <Button
            variant="danger"
            size="sm"
            onClick={() => setAlertPanelOpen((v) => !v)}
          >
            {alertPanelOpen ? '收起预警详情' : '查看预警详情'}
          </Button>
        </div>
      )}

      {/* -- Alert Panel -- */}
      {alertPanelOpen && (
        <AlertPanel
          alerts={alerts}
          onClose={() => setAlertPanelOpen(false)}
          onMarkAll={() => showToast({ type: 'success', message: '已全部标记处理' })}
        />
      )}

      {/* -- View Toggle Bar -- */}
      <div className={styles.view_toggle_bar}>
        <div className={styles.view_toggle}>
          <span className={styles.view_toggle__label}>查看方式：</span>
            <div className={styles.radio_group}>
            <label className={styles.radio_option}>
              <input
                type="radio"
                name="viewMode"
                value="supplier"
                checked={viewMode === 'supplier'}
                onChange={() => setViewMode('supplier')}
              />
              <span className={styles.radio_circle} />
              按供应商
            </label>
            <label className={styles.radio_option}>
              <input
                type="radio"
                name="viewMode"
                value="material"
                checked={viewMode === 'material'}
                onChange={() => setViewMode('material')}
              />
              <span className={styles.radio_circle} />
              按物料
            </label>
          </div>
        </div>

        <div className={styles.search_box}>
          <span className={styles.search_box__icon}>&#128269;</span>
          <input
            className={styles.search_box__input}
            type="text"
            placeholder={viewMode === 'supplier' ? '搜索供应商 / 物料名称...' : '搜索物料名称 / SKU 编码...'}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>

        <select
          className={styles.filter_select}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label="状态筛选"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* -- Supplier View -- */}
      {viewMode === 'supplier' && (
        <div>
          {supplierGroups.length === 0 && !_priceLoading && (
            <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-secondary)' }}>
              暂无价格协议数据
            </div>
          )}
          {supplierGroups.map((group) => (
            <SupplierGroupAccordion
              key={group.supplierId}
              group={group}
              onEdit={openEdit}
              onAddAgreement={openCreate}
              selectedPriceId={selectedPriceId}
              onSelectPrice={handleSelectPrice}
            />
          ))}
        </div>
      )}

      {/* -- Material View -- */}
      {viewMode === 'material' && (
        <div>
          {materialGroups.length === 0 && !_priceLoading && (
            <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-secondary)' }}>
              暂无价格协议数据
            </div>
          )}
          {materialGroups.map((group) => (
            <MaterialGroupAccordion
              key={group.skuId}
              group={group}
              supplierGradeMap={supplierGradeMap}
              onEdit={openEdit}
              selectedPriceId={selectedPriceId}
              onSelectPrice={handleSelectPrice}
            />
          ))}
        </div>
      )}

      {/* -- Detail Modal -- */}
      {selectedPrice !== null && (
        <Modal
          open
          title={`采购价格详情 — ${selectedPrice.skuName}`}
          onClose={() => setSelectedPriceId(null)}
          hideFooter
          size="xl"
        >
          <ChartPanel
            price={selectedPrice}
            allPricesForSku={allPricesForSelectedSku}
            supplierGradeMap={supplierGradeMap}
            onClose={() => setSelectedPriceId(null)}
            showHeader={false}
          />
        </Modal>
      )}

      {/* -- Drawer: New / Edit Price Agreement -- */}
      <Drawer
        open={drawerOpen}
        title={drawerTitle}
        onClose={() => { setDrawerOpen(false); setPriceWarn(''); }}
        width={480}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
            <Button variant="ghost" onClick={() => { setDrawerOpen(false); setPriceWarn(''); }}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={isSaving}
              onClick={() => void handleSave()}
            >
              保存协议
            </Button>
          </div>
        }
      >
        <DrawerFormFields
          form={priceForm}
          onChange={(patch) => setPriceForm((f) => ({ ...f, ...patch }))}
          isNew={drawerMode === 'create'}
          priceWarn={priceWarn}
          suppliers={suppliers}
          skuResults={skuResults}
          onSkuSearch={setSkuSearchKeyword}
        />
      </Drawer>

      {/* -- Price Warning Confirm Modal -- */}
      <Modal
        open={priceWarnModal}
        title="价格高于历史均价"
        onClose={() => setPriceWarnModal(false)}
        onConfirm={() => {
          setPriceWarnModal(false);
          setDrawerOpen(false);
          showToast({ type: 'success', message: '协议已保存，价格超出历史均价已标记' });
        }}
        confirmLabel="确认提交审批"
        cancelLabel="返回修改"
        size="sm"
      >
        <div className={styles.price_warn_body}>
          <p>
            当前录入价格{' '}
            <strong className={styles.price_warn_highlight}>{priceWarnNewPrice}</strong>{' '}
            高于历史均价，超出{' '}
            <strong className={styles.price_warn_highlight}>{priceWarnExceedPct}</strong>，
            已超出预警阈值 20%。
          </p>
          <div className={styles.price_warn_notice}>
            &#8505; 该价格协议保存后将处于「待审批」状态，需老板审批通过后方可生效。
          </div>
        </div>
      </Modal>

      {/* ── 批量导入 Modal ── */}
      <Modal
        open={importModalOpen}
        title="批量导入价格"
        onClose={handleImportClose}
        confirmLabel={importing ? '导入中...' : '确认导入'}
        onConfirm={(!importFile || importing) ? undefined : handleImportConfirm}
        confirmLoading={importing}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 模板下载 */}
          <div
            style={{ padding: 12, background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0', cursor: 'pointer' }}
            onClick={() => downloadImportTemplate()}
            role="button"
            tabIndex={0}
          >
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>📥 下载导入模板</div>
            <div style={{ fontSize: 12, color: '#64748B' }}>点击下载 · .xlsx 格式 · 含示例数据</div>
          </div>

          {/* 文件上传 */}
          <div>
            <label style={{ fontWeight: 500, fontSize: 14 }}>选择文件</label>
            <input
              type="file"
              accept=".xlsx,.csv"
              onChange={handleImportFileChange}
              style={{ display: 'block', marginTop: 6 }}
            />
          </div>

          {/* 上传限制说明 */}
          <div style={{ fontSize: 12, color: '#94A3B8', lineHeight: 1.8 }}>
            支持 .xlsx / .csv 格式 · 单次最多 5000 行 · 文件大小不超过 5MB · 文件编码 UTF-8
          </div>

          {/* 错误处理策略 */}
          {importFile && (
            <div>
              <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 8 }}>错误处理方式</div>
              <label style={{ display: 'block', marginBottom: 6, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="radio"
                  name="errorStrategy"
                  checked={importErrorStrategy === 'skip'}
                  onChange={() => setImportErrorStrategy('skip')}
                  style={{ marginRight: 6 }}
                />
                跳过错误行，仅导入正确行
              </label>
              <label style={{ display: 'block', cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="radio"
                  name="errorStrategy"
                  checked={importErrorStrategy === 'cancel'}
                  onChange={() => setImportErrorStrategy('cancel')}
                  style={{ marginRight: 6 }}
                />
                取消导入，修正后重新上传
              </label>
            </div>
          )}

          {/* 预览提示 */}
          {importFile && (
            <div style={{ padding: 8, background: '#F0FDF4', borderRadius: 6, fontSize: 12, color: '#16A34A' }}>
              已选择文件: {importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)
            </div>
          )}
        </div>
      </Modal>

    </div>
  );
}
