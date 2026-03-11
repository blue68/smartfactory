/**
 * [artifact:前端代码] — 全局 Loading Skeleton 骨架屏组件
 * T217: 全局 Loading Skeleton
 *
 * Props:
 *   lines   - text/table variant 的行数（默认 3）
 *   width   - 骨架宽度（CSS 值，默认 100%）
 *   height  - 单块骨架高度（CSS 值，默认由 variant 决定）
 *   variant - 'text' | 'card' | 'table'（默认 'text'）
 */

import styles from './Skeleton.module.css';

export interface SkeletonProps {
  /** 显示行数（text / table variant 有效），默认 3 */
  lines?: number;
  /** 骨架宽度，CSS 值，默认 '100%' */
  width?: string;
  /** 骨架高度，CSS 值（text 单行高度 / card 整体高度 / table 忽略） */
  height?: string;
  /** 骨架类型，默认 'text' */
  variant?: 'text' | 'card' | 'table';
  /** 无障碍标签 */
  ariaLabel?: string;
}

// ── 内部辅助：单条骨架块 ─────────────────────
function SkeletonBlock({
  width = '100%',
  height = '0.875rem',
}: {
  width?: string;
  height?: string;
}) {
  return (
    <span
      className={styles.skeleton}
      style={{ width, height, display: 'block' }}
      aria-hidden="true"
    />
  );
}

// ── text variant ─────────────────────────────
function TextSkeleton({ lines, width, height }: Required<Pick<SkeletonProps, 'lines' | 'width' | 'height'>>) {
  return (
    <div className={styles['skeleton--text']} style={{ width }} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <span key={i} className={styles.skeleton__line} style={{ height }} />
      ))}
    </div>
  );
}

// ── card variant ─────────────────────────────
function CardSkeleton({ width, height }: { width: string; height: string }) {
  return (
    <div
      className={styles['skeleton--card']}
      style={{ width, ...(height !== '100%' ? { height } : {}) }}
      aria-hidden="true"
    >
      {/* 卡片头部：头像 + 两行标题 */}
      <div className={styles.skeleton__card_header}>
        <span className={styles.skeleton__avatar} />
        <div className={styles.skeleton__card_title_group}>
          <SkeletonBlock width="60%" height="0.875rem" />
          <SkeletonBlock width="40%" height="0.75rem" />
        </div>
      </div>
      {/* 卡片内容：三行文字 */}
      <div className={styles.skeleton__card_body}>
        <SkeletonBlock width="100%" height="0.875rem" />
        <SkeletonBlock width="90%" height="0.875rem" />
        <SkeletonBlock width="65%" height="0.875rem" />
      </div>
    </div>
  );
}

// ── table variant ────────────────────────────
function TableSkeleton({ lines, width }: { lines: number; width: string }) {
  const COL_COUNT = 5;
  return (
    <div className={styles['skeleton--table']} style={{ width }} aria-hidden="true">
      {/* 表头 */}
      <div className={styles.skeleton__thead}>
        {Array.from({ length: COL_COUNT }).map((_, i) => (
          <span key={i} className={styles.skeleton__th} />
        ))}
      </div>
      {/* 数据行 */}
      {Array.from({ length: lines }).map((_, rowIdx) => (
        <div key={rowIdx} className={styles.skeleton__tr}>
          {Array.from({ length: COL_COUNT }).map((_, colIdx) => (
            <span key={colIdx} className={styles.skeleton__td} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── 主组件 ───────────────────────────────────
export default function Skeleton({
  lines = 3,
  width = '100%',
  height = '0.875rem',
  variant = 'text',
  ariaLabel = '内容加载中',
}: SkeletonProps) {
  return (
    <div role="status" aria-label={ariaLabel} aria-busy="true">
      {variant === 'text' && (
        <TextSkeleton lines={lines} width={width} height={height} />
      )}
      {variant === 'card' && (
        <CardSkeleton width={width} height={height} />
      )}
      {variant === 'table' && (
        <TableSkeleton lines={lines} width={width} />
      )}
      {/* 仅屏幕阅读器可见 */}
      <span className="sr-only">{ariaLabel}</span>
    </div>
  );
}
