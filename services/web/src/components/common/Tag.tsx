/**
 * [artifact:前端代码] — 标签组件（含17种二级品类颜色）
 * 对应设计规范 4.5
 */

import type { Category2Code } from '@/types/enums';
import styles from './Tag.module.css';

export type TagVariant =
  | 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'stagnant'
  | 'dye-lot' | 'priority-urgent' | 'priority-high' | 'priority-normal';

export interface TagProps {
  variant?: TagVariant;
  /** 二级品类 code，优先于 variant */
  category2Code?: Category2Code;
  children: React.ReactNode;
  className?: string;
}

/** category2Code → CSS 变量前缀映射 */
const CATEGORY2_VAR_MAP: Record<string, string> = {
  BOARD:     'board',
  HARDWARE:  'hardware',
  FABRIC:    'fabric',
  FOAM:      'foam',
  PAINT:     'paint',
  ADHESIVE:  'adhesive',
  PACK:      'pack',
  OTHER_RAW: 'other',
  FRAME:     'frame',
  COVER:     'cover',
  ASSEMBLY:  'assembly',
  SOFA:      'sofa',
  CABINET:   'cabinet',
  TABLE:     'table',
  BED:       'bed',
  CUSTOM:    'custom',
  NONE:      'none',
};

export default function Tag({ variant = 'neutral', category2Code, children, className = '' }: TagProps) {
  if (category2Code) {
    const key = CATEGORY2_VAR_MAP[category2Code] ?? 'none';
    return (
      <span
        className={`${styles.tag} ${className}`}
        style={{
          backgroundColor: `var(--sub-${key}-bg)`,
          color: `var(--sub-${key}-text)`,
        }}
      >
        {children}
      </span>
    );
  }

  return (
    <span className={`${styles.tag} ${styles[`tag--${variant}`]} ${className}`}>
      {variant === 'dye-lot' && <span aria-hidden="true">🧵 </span>}
      {children}
    </span>
  );
}
