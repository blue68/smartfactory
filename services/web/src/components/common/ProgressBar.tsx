/**
 * [artifact:前端代码] — 通用进度条组件
 * 对应设计规范：4 态颜色阈值
 *   0–30%  → danger（红色）
 *   30–60% → warning（黄色）
 *   60–90% → primary（蓝色）
 *   90–100%→ success（绿色）
 */

import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  /** 进度值 0-100 */
  value: number;
  /** 是否显示百分比标签（默认 false） */
  showLabel?: boolean;
  /** 尺寸：sm = 4px 高度，md = 8px 高度（默认 md） */
  size?: 'sm' | 'md';
  className?: string;
}

/** 根据进度值计算语义色阶 */
function resolveColorClass(value: number): string {
  if (value < 30) return styles['progress__fill--danger'];
  if (value < 60) return styles['progress__fill--warning'];
  if (value < 90) return styles['progress__fill--primary'];
  return styles['progress__fill--success'];
}

export default function ProgressBar({
  value,
  showLabel = false,
  size = 'md',
  className = '',
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const colorClass = resolveColorClass(clamped);

  return (
    <div className={`${styles.progress} ${className}`}>
      <div
        className={`${styles.progress__track} ${styles[`progress__track--${size}`]}`}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`进度 ${clamped}%`}
      >
        <div
          className={`${styles.progress__fill} ${colorClass}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && (
        <span className={styles.progress__label} aria-hidden="true">
          {clamped}%
        </span>
      )}
    </div>
  );
}
