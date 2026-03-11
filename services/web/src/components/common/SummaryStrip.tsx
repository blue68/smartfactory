/**
 * [artifact:前端代码] — 水平统计摘要栏组件
 * 对应设计规范：库存/SKU/BOM 页面顶部汇总栏
 * 用途：多个 stat item 横向并排展示
 */

import styles from './SummaryStrip.module.css';

export interface SummaryStripItem {
  /** 标签名 */
  label: string;
  /** 统计数值 */
  value: string | number;
  /** 单位（可选） */
  unit?: string;
  /** 高亮项，使用强调色 */
  highlight?: boolean;
}

export interface SummaryStripProps {
  items: SummaryStripItem[];
  className?: string;
}

export default function SummaryStrip({ items, className = '' }: SummaryStripProps) {
  return (
    <div className={`${styles.summary_strip} ${className}`} role="region" aria-label="统计摘要">
      {items.map((item, index) => (
        <div
          key={`${item.label}-${index}`}
          className={`${styles.summary_strip__item} ${
            item.highlight ? styles['summary_strip__item--highlight'] : ''
          }`}
        >
          <span className={styles.summary_strip__label}>{item.label}</span>
          <div className={styles.summary_strip__value_row}>
            <span className={styles.summary_strip__value}>{item.value}</span>
            {item.unit && (
              <span className={styles.summary_strip__unit}>{item.unit}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
