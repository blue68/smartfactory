/**
 * [artifact:前端代码] — 通用表格组件
 * 支持：排序、分页、行展开、loading/error/empty 三态、列配置
 */

import { Fragment, useState } from 'react';
import EmptyState from './EmptyState';
import styles from './Table.module.css';

export type SortOrder = 'asc' | 'desc' | null;

export interface Column<T> {
  key: string;
  title: React.ReactNode;
  width?: number | string;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  render?: (value: unknown, record: T, index: number) => React.ReactNode;
}

export interface TableProps<T extends object> {
  columns: Column<T>[];
  dataSource: T[];
  rowKey: keyof T | ((record: T) => string | number);
  loading?: boolean;
  error?: string | null;
  emptyText?: string;
  /** 可展开行：返回展开内容，null 表示该行不可展开 */
  expandedRowRender?: (record: T) => React.ReactNode;
  /** 受控分页 */
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onChange: (page: number) => void;
  };
  onSort?: (key: string, order: SortOrder) => void;
  className?: string;
  /** 行附加 className，返回空字符串表示无额外样式 */
  rowClassName?: (record: T, index: number) => string;
}

function buildPageItems(current: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, idx) => idx + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, 'ellipsis', totalPages];
  if (current >= totalPages - 3) {
    return [1, 'ellipsis', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, 'ellipsis', current - 1, current, current + 1, 'ellipsis', totalPages];
}

export default function Table<T extends object>({
  columns,
  dataSource,
  rowKey,
  loading = false,
  error,
  emptyText = '暂无数据',
  expandedRowRender,
  pagination,
  onSort,
  className = '',
  rowClassName,
}: TableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string | number>>(new Set());

  const getRowKey = (record: T): string | number =>
    typeof rowKey === 'function' ? rowKey(record) : (record[rowKey] as string | number);

  const handleSort = (key: string) => {
    if (!onSort) return;
    let next: SortOrder = 'asc';
    if (sortKey === key) next = sortOrder === 'asc' ? 'desc' : sortOrder === 'desc' ? null : 'asc';
    setSortKey(next ? key : null);
    setSortOrder(next);
    onSort(key, next);
  };

  const toggleExpand = (key: string | number) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const totalPages = pagination ? Math.ceil(pagination.total / pagination.pageSize) : 1;
  const pageItems = pagination ? buildPageItems(pagination.page, totalPages) : [];
  const getCellValue = (record: T, key: string): unknown => (record as Record<string, unknown>)[key];

  return (
    <div className={`${styles.table_wrap} ${className}`}>
      <div className={styles.table_scroll}>
        <table className={styles.table} aria-busy={loading}>
          <thead>
            <tr>
              {expandedRowRender && <th className={styles.th} style={{ width: 40 }} />}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`${styles.th} ${col.sortable ? styles['th--sortable'] : ''}`}
                  style={{ width: col.width, textAlign: col.align ?? 'left' }}
                  onClick={() => col.sortable && handleSort(col.key)}
                  aria-sort={
                    sortKey === col.key
                      ? sortOrder === 'asc' ? 'ascending' : 'descending'
                      : col.sortable ? 'none' : undefined
                  }
                >
                  {col.title}
                  {col.sortable && (
                    <span className={styles.sort_icon} aria-hidden="true">
                      {sortKey === col.key
                        ? sortOrder === 'asc' ? ' ↑' : ' ↓'
                        : ' ↕'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading ? (
              // 骨架屏
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className={styles.tr}>
                  {expandedRowRender && <td className={styles.td} />}
                  {columns.map((col) => (
                    <td key={col.key} className={styles.td}>
                      <div className={`skeleton ${styles.skeleton_cell}`} />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={columns.length + (expandedRowRender ? 1 : 0)} className={styles.td}>
                  <div className="alert alert--error" style={{ margin: 'var(--space-4)' }}>
                    <span className="alert__icon" aria-hidden="true">❌</span>
                    <div className="alert__body">
                      <div className="alert__title">加载失败</div>
                      <div className="alert__desc">{error}</div>
                    </div>
                  </div>
                </td>
              </tr>
            ) : dataSource.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (expandedRowRender ? 1 : 0)} className={styles.td}>
                  <EmptyState title={emptyText} />
                </td>
              </tr>
            ) : (
              dataSource.map((record, idx) => {
                const key = getRowKey(record);
                const expanded = expandedKeys.has(key);
                const expandContent = expandedRowRender?.(record);
                return (
                  <Fragment key={key}>
                    <tr
                      className={`${styles.tr} ${idx % 2 === 1 ? styles['tr--stripe'] : ''} ${rowClassName ? rowClassName(record, idx) : ''}`}
                    >
                      {expandedRowRender && (
                        <td className={styles.td} style={{ textAlign: 'center' }}>
                          {expandContent !== null && (
                            <button
                              className={styles.expand_btn}
                              onClick={() => toggleExpand(key)}
                              aria-expanded={expanded}
                              aria-label={expanded ? '收起' : '展开'}
                            >
                              {expanded ? '▾' : '▸'}
                            </button>
                          )}
                        </td>
                      )}
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={styles.td}
                          style={{ textAlign: col.align ?? 'left' }}
                        >
                          {col.render
                            ? col.render(getCellValue(record, col.key), record, idx)
                            : (getCellValue(record, col.key) as React.ReactNode) ?? '—'}
                        </td>
                      ))}
                    </tr>
                    {expanded && expandContent && (
                      <tr className={styles['tr--expanded']}>
                        <td
                          colSpan={columns.length + 1}
                          className={`${styles.td} ${styles.td__expand}`}
                        >
                          {expandContent}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {pagination && totalPages > 1 && (
        <div className={styles.pagination}>
          <span className={styles.pagination__info}>
            {(() => {
              const startRecord = (pagination.page - 1) * pagination.pageSize + 1;
              const endRecord = Math.min(pagination.page * pagination.pageSize, pagination.total);
              return `共 ${pagination.total} 条记录，当前第 ${startRecord}-${endRecord} 条`;
            })()}
          </span>
          <div className={styles.pagination__btns}>
            <button
              className={styles.pagination__btn}
              onClick={() => pagination.onChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              aria-label="上一页"
            >
              ‹
            </button>
            {pageItems.map((item, idx) =>
              item === 'ellipsis' ? (
                <span key={`ellipsis-${idx}`} className={styles.pagination__btn} aria-hidden="true">
                  …
                </span>
              ) : (
                <button
                  key={item}
                  className={`${styles.pagination__btn} ${pagination.page === item ? styles['pagination__btn--active'] : ''}`}
                  onClick={() => pagination.onChange(item)}
                  aria-label={`第 ${item} 页`}
                  aria-current={pagination.page === item ? 'page' : undefined}
                >
                  {item}
                </button>
              ),
            )}
            <button
              className={styles.pagination__btn}
              onClick={() => pagination.onChange(pagination.page + 1)}
              disabled={pagination.page >= totalPages}
              aria-label="下一页"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
