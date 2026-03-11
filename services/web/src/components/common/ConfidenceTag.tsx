/**
 * [artifact:前端代码] — AI 置信度标签
 * 对应设计规范 4.5 置信度标签
 */

import { Confidence, ConfidenceLabel } from '@/types/enums';
import styles from './ConfidenceTag.module.css';

interface ConfidenceTagProps {
  confidence: Confidence;
  detail?: string;
  className?: string;
}

const DOT_COLOR: Record<Confidence, string> = {
  [Confidence.HIGH]:   'var(--color-success-500)',
  [Confidence.MEDIUM]: 'var(--color-warning-500)',
  [Confidence.LOW]:    'var(--color-error-500)',
};

export default function ConfidenceTag({ confidence, detail, className = '' }: ConfidenceTagProps) {
  return (
    <span
      className={`${styles.confidence} ${styles[`confidence--${confidence}`]} ${className}`}
      title={detail}
    >
      <span
        className={styles.confidence__dot}
        style={{ background: DOT_COLOR[confidence] }}
        aria-hidden="true"
      />
      {ConfidenceLabel[confidence]}
    </span>
  );
}
