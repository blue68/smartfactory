/**
 * [artifact:前端代码] — 状态圆点组件
 * 用途：库存状态、生产任务状态等场景的圆点 + 文字标识
 */

import styles from './StatusDot.module.css';

export type DotStatus = 'success' | 'warning' | 'danger' | 'info' | 'stagnant';

export interface StatusDotProps {
  status: DotStatus;
  label?: string;
  className?: string;
}

export default function StatusDot({ status, label, className = '' }: StatusDotProps) {
  return (
    <span className={`${styles.status_dot} ${className}`}>
      <span
        className={`${styles.status_dot__dot} ${styles[`status_dot__dot--${status}`]}`}
        aria-hidden="true"
      />
      {label && <span className={styles.status_dot__label}>{label}</span>}
    </span>
  );
}
