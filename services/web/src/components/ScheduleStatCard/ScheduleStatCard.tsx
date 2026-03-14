/**
 * [artifact:前端代码] — ScheduleStatCard
 * Sprint 4 / FE-S4-04
 *
 * 调度模块 KPI 统计卡片。
 * - variant 控制左边框色与数字高亮色（normal / info / warning / danger）
 * - loading 时显示 shimmer 骨架占位动画
 * - 传入 onClick 时整卡可点击，显示 pointer 与 hover 效果
 */

import type { ReactNode } from 'react';
import styles from './ScheduleStatCard.module.css';

// ─── 类型定义 ────────────────────────────────
export type ScheduleStatVariant = 'normal' | 'info' | 'warning' | 'danger';

export interface ScheduleStatCardProps {
  /** 卡片标题（指标名称） */
  title: string;
  /** 核心数值 */
  value: number | string;
  /** 数值单位（可选） */
  unit?: string;
  /** 视觉变体：控制左边框和数字颜色 */
  variant: ScheduleStatVariant;
  /** loading 状态：显示 shimmer 骨架 */
  loading?: boolean;
  /** 右上角图标（可选） */
  icon?: ReactNode;
  /** 点击回调：传入后整卡可点击 */
  onClick?: () => void;
}

// ─── Shimmer 骨架 ─────────────────────────────
function ScheduleStatSkeleton() {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      <div className={styles.skeleton__bar} />
      <div className={styles.skeleton__body}>
        <div className={styles.skeleton__header}>
          <span className={styles.skeleton__label} />
          <span className={styles.skeleton__icon} />
        </div>
        <span className={styles.skeleton__value} />
      </div>
    </div>
  );
}

// ─── 主组件 ──────────────────────────────────
export default function ScheduleStatCard({
  title,
  value,
  unit,
  variant,
  loading = false,
  icon,
  onClick,
}: ScheduleStatCardProps) {
  /** 是否可点击（决定 hover 样式和可访问性属性） */
  const isClickable = typeof onClick === 'function';

  if (loading) {
    return (
      <div role="status" aria-label="数据加载中" aria-busy="true">
        <ScheduleStatSkeleton />
      </div>
    );
  }

  return (
    /* 可点击时渲染为 button，否则渲染为 article */
    isClickable ? (
      <button
        type="button"
        className={[
          styles.card,
          styles[`card--${variant}`],
          styles['card--clickable'],
        ].join(' ')}
        onClick={onClick}
        aria-label={`${title}：${value}${unit ?? ''}`}
      >
        <CardInner
          title={title}
          value={value}
          unit={unit}
          icon={icon}
          variant={variant}
        />
      </button>
    ) : (
      <article
        className={[styles.card, styles[`card--${variant}`]].join(' ')}
        aria-label={`${title}：${value}${unit ?? ''}`}
      >
        <CardInner
          title={title}
          value={value}
          unit={unit}
          icon={icon}
          variant={variant}
        />
      </article>
    )
  );
}

// ─── 内部渲染内容（避免重复） ────────────────
interface CardInnerProps {
  title: string;
  value: number | string;
  unit?: string;
  icon?: ReactNode;
  variant: ScheduleStatVariant;
}

function CardInner({ title, value, unit, icon }: CardInnerProps) {
  return (
    <>
      {/* 左侧色条 */}
      <span className={styles.card__bar} aria-hidden="true" />

      {/* 卡片主体 */}
      <div className={styles.card__body}>
        {/* 顶部：标题 + 图标 */}
        <div className={styles.card__header}>
          <span className={styles.card__label}>{title}</span>
          {icon && (
            <span className={styles.card__icon} aria-hidden="true">
              {icon}
            </span>
          )}
        </div>

        {/* 数值区 */}
        <div className={styles.card__value_row}>
          <span className={styles.card__value}>{value}</span>
          {unit && <span className={styles.card__unit}>{unit}</span>}
        </div>
      </div>
    </>
  );
}
