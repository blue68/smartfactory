/**
 * [artifact:前端代码] — KPI 统计卡片组件
 * 对应设计规范 4.3 KPI 数字卡片（.card--kpi）
 * 用途：驾驶舱 4 个核心 KPI 展示
 */

import type { ReactNode } from 'react';
import styles from './KpiCard.module.css';
import ProgressBar from './ProgressBar';

export interface KpiCardTrend {
  value: string;
  direction: 'up' | 'down';
}

export interface KpiCardProps {
  /** 卡片标题（指标名称） */
  title: string;
  /** 核心数值（字符串，支持格式化后传入） */
  value: string | number;
  /** 数值单位（可选） */
  unit?: string;
  /** 趋势信息（涨跌箭头） */
  trend?: KpiCardTrend;
  /** 左侧色条颜色（CSS 色值或 var(--xxx)） */
  color: string;
  /** 右上角图标区（ReactNode） */
  icon?: ReactNode;
  /** 进度条数值 0-100（可选，传入则展示进度条） */
  progress?: number;
  className?: string;
}

export default function KpiCard({
  title,
  value,
  unit,
  trend,
  color,
  icon,
  progress,
  className = '',
}: KpiCardProps) {
  return (
    <article
      className={`${styles.kpi_card} ${className}`}
      style={{ '--kpi-color': color } as React.CSSProperties}
    >
      {/* 左侧色条 */}
      <span className={styles.kpi_card__bar} aria-hidden="true" />

      {/* 卡片主体 */}
      <div className={styles.kpi_card__body}>
        {/* 顶部：标题 + 右上角图标 */}
        <div className={styles.kpi_card__header}>
          <span className={styles.kpi_card__label}>{title}</span>
          {icon && (
            <span className={styles.kpi_card__icon} aria-hidden="true">
              {icon}
            </span>
          )}
        </div>

        {/* 核心数值区 */}
        <div className={styles.kpi_card__value_row}>
          <span className={styles.kpi_card__value}>{value}</span>
          {unit && <span className={styles.kpi_card__unit}>{unit}</span>}
        </div>

        {/* 趋势箭头（可选） */}
        {trend && (
          <div
            className={`${styles.kpi_card__trend} ${
              trend.direction === 'up'
                ? styles['kpi_card__trend--up']
                : styles['kpi_card__trend--down']
            }`}
            aria-label={`${trend.direction === 'up' ? '上涨' : '下降'} ${trend.value}`}
          >
            <span className={styles.kpi_card__trend_arrow} aria-hidden="true">
              {trend.direction === 'up' ? '▲' : '▼'}
            </span>
            <span className={styles.kpi_card__trend_value}>{trend.value}</span>
          </div>
        )}

        {/* 进度条（可选） */}
        {progress !== undefined && (
          <div className={styles.kpi_card__progress}>
            <ProgressBar value={progress} showLabel size="sm" />
          </div>
        )}
      </div>
    </article>
  );
}
