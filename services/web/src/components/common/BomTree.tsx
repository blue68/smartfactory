/**
 * [artifact:前端代码] — BomTree 递归树形组件
 *
 * 功能：
 * - 递归渲染 BomItem 多层树结构
 * - 每层左缩进 24px（paddingLeft: level * 24）
 * - 有 children 节点显示展开/收起三角箭头（▶ / ▼）
 * - 选中节点高亮背景
 * - 每行显示：物料名(skuName) | 规格(spec) | 数量(quantity) | 单位(unit) | 损耗率(scrapRate)
 * - 使用 CSS Module（BomTree.module.css）
 */

import { useState, useCallback } from 'react';
import type { BomItem } from '@/types/models';
import styles from './BomTree.module.css';

// ─────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────

export interface BomTreeProps {
  items: BomItem[];
  /** 当前渲染层级，顶层调用时无需传入，默认为 0 */
  level?: number;
  /** 点击行时的回调 */
  onSelect?: (item: BomItem) => void;
  /** 当前选中的 bomItemId */
  selectedId?: number;
  /** 内部透传：已展开节点的 bomItemId 集合 */
  _expandedIds?: Set<number>;
  /** 内部透传：切换展开状态的回调 */
  _onToggle?: (id: number) => void;
}

// ─────────────────────────────────────────────
// 内部单节点组件
// ─────────────────────────────────────────────

interface BomNodeProps {
  item: BomItem;
  level: number;
  selectedId?: number;
  expandedIds: Set<number>;
  onSelect?: (item: BomItem) => void;
  onToggle: (id: number) => void;
}

function BomNode({
  item,
  level,
  selectedId,
  expandedIds,
  onSelect,
  onToggle,
}: BomNodeProps) {
  const hasChildren = item.children && item.children.length > 0;
  const isExpanded = expandedIds.has(item.bomItemId);
  const isSelected = selectedId === item.bomItemId;

  // 数量格式化：去掉末尾多余的 0
  const displayQty = (() => {
    const n = parseFloat(item.quantity);
    return isNaN(n) ? item.quantity : n.toLocaleString('zh-CN', { maximumFractionDigits: 6 });
  })();

  // 损耗率格式化
  const scrapRateNum = parseFloat(item.scrapRate);
  const displayScrapRate = isNaN(scrapRateNum)
    ? item.scrapRate
    : `${(scrapRateNum * 100).toFixed(2)}%`;
  const isNonZeroScrap = !isNaN(scrapRateNum) && scrapRateNum > 0;

  const handleRowClick = useCallback(() => {
    onSelect?.(item);
    // 点击整行同时切换展开状态（若有子节点）
    if (hasChildren) {
      onToggle(item.bomItemId);
    }
  }, [item, hasChildren, onSelect, onToggle]);

  const handleToggleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggle(item.bomItemId);
    },
    [item.bomItemId, onToggle],
  );

  return (
    <div className={styles['bom-tree__node']}>
      {/* 节点行 */}
      <div
        className={[
          styles['bom-tree__row'],
          isSelected ? styles['bom-tree__row--selected'] : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ paddingLeft: `calc(var(--space-3) + ${level * 24}px)` }}
        data-level={level}
        onClick={handleRowClick}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isExpanded : undefined}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleRowClick();
          }
        }}
      >
        {/* 展开/收起按钮 or 占位 */}
        {hasChildren ? (
          <button
            className={[
              styles['bom-tree__toggle'],
              isExpanded ? styles['bom-tree__toggle--expanded'] : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={handleToggleClick}
            aria-label={isExpanded ? '收起' : '展开'}
            type="button"
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className={styles['bom-tree__toggle-placeholder']} aria-hidden="true" />
        )}

        {/* 内容列 */}
        <div className={styles['bom-tree__content']}>
          {/* 物料名 + SKU 编码 */}
          <div className={styles['bom-tree__name']}>
            <span className={styles['bom-tree__sku-name']} title={item.skuName}>
              {item.skuName}
            </span>
            <span className={styles['bom-tree__sku-code']}>{item.skuCode}</span>
          </div>

          {/* 规格 */}
          <span className={styles['bom-tree__spec']} title={item.spec ?? ''}>
            {item.spec || '—'}
          </span>

          {/* 数量 */}
          <span className={styles['bom-tree__quantity']}>{displayQty}</span>

          {/* 单位 */}
          <span className={styles['bom-tree__unit']}>{item.unit}</span>

          {/* 损耗率 */}
          <span
            className={[
              styles['bom-tree__scrap-rate'],
              isNonZeroScrap ? styles['bom-tree__scrap-rate--nonzero'] : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {displayScrapRate}
          </span>
        </div>
      </div>

      {/* 子节点（展开时渲染） */}
      {hasChildren && isExpanded && (
        <div
          className={styles['bom-tree__children']}
          role="group"
          aria-label={`${item.skuName} 的子物料`}
        >
          {item.children.map((child) => (
            <BomNode
              key={child.bomItemId}
              item={child}
              level={level + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 根组件（管理展开状态）
// ─────────────────────────────────────────────

export default function BomTree({
  items,
  level = 0,
  onSelect,
  selectedId,
}: BomTreeProps) {
  // 初始展开第一层（所有顶层节点）
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => {
    const ids = new Set<number>();
    items.forEach((item) => {
      if (item.children && item.children.length > 0) {
        ids.add(item.bomItemId);
      }
    });
    return ids;
  });

  const handleToggle = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  if (!items || items.length === 0) {
    return (
      <div className={styles['bom-tree']}>
        <p className={styles['bom-tree__empty']}>暂无物料明细</p>
      </div>
    );
  }

  return (
    <div className={styles['bom-tree']} role="tree" aria-label="BOM 物料树">
      {/* 表头 */}
      <div className={styles['bom-tree__header']} aria-hidden="true">
        <span className={styles['bom-tree__header-spacer']} />
        <div className={styles['bom-tree__header-cols']}>
          <span>物料名称</span>
          <span>规格</span>
          <span>数量</span>
          <span>单位</span>
          <span>损耗率</span>
        </div>
      </div>

      {/* 节点列表 */}
      {items.map((item) => (
        <BomNode
          key={item.bomItemId}
          item={item}
          level={level}
          selectedId={selectedId}
          expandedIds={expandedIds}
          onSelect={onSelect}
          onToggle={handleToggle}
        />
      ))}
    </div>
  );
}
