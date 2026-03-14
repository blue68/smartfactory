/**
 * [artifact:前端代码] — PulseWaveIndicator
 * Sprint 4 / FE-S4-02
 *
 * 三根竖条错位波浪动画，用于 AI "计算中" 状态。
 * Props:
 *   size - 'sm' | 'md' | 'lg'，默认 'md'
 *   text - 可选附带文字，如 "计算中..."
 */

import styles from './PulseWaveIndicator.module.css';

export interface PulseWaveIndicatorProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
}

export default function PulseWaveIndicator({
  size = 'md',
  text,
}: PulseWaveIndicatorProps) {
  return (
    <span
      className={`${styles.pulse_wave} ${styles[`pulse_wave--${size}`]}`}
      role="status"
      aria-label={text ?? 'AI 计算中'}
    >
      {/* 三根竖条，通过 CSS animation-delay 错位 */}
      <span className={styles.pulse_wave__bar} aria-hidden="true" />
      <span className={styles.pulse_wave__bar} aria-hidden="true" />
      <span className={styles.pulse_wave__bar} aria-hidden="true" />

      {text && (
        <span className={styles.pulse_wave__text}>{text}</span>
      )}
    </span>
  );
}
