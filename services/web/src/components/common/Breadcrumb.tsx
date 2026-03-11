/**
 * [artifact:前端代码] — 面包屑导航组件
 * T128: 渲染 首页 / 分组名 / 当前页面，末项不可点击
 */

import { Link } from 'react-router-dom';
import styles from './Breadcrumb.module.css';

export interface BreadcrumbItem {
  label: string;
  path?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export default function Breadcrumb({ items }: BreadcrumbProps) {
  if (items.length === 0) return null;

  return (
    <nav className={styles.breadcrumb} aria-label="面包屑导航">
      <ol className={styles.breadcrumb__list}>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className={styles.breadcrumb__item}>
              {/* 分隔符：首项之前不显示 */}
              {index > 0 && (
                <span className={styles.breadcrumb__separator} aria-hidden="true">/</span>
              )}

              {/* 最后一项不可点击 */}
              {isLast || !item.path ? (
                <span
                  className={`${styles.breadcrumb__text} ${isLast ? styles['breadcrumb__text--current'] : ''}`}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link to={item.path} className={styles.breadcrumb__link}>
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
