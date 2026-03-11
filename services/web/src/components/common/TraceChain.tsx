/**
 * [artifact:前端代码] — 溯源链组件
 * 水平滚动展示溯源节点，节点间用箭头连接
 * 支持 5 种节点类型、3 种状态色、缺失节点虚线样式
 */

import type { TraceNode } from '@/types/models';
import { formatDateTime } from '@/utils/format';
import styles from './TraceChain.module.css';

// ─────────────────────────────────────────────
// 节点类型图标映射
// ─────────────────────────────────────────────

const NODE_TYPE_ICON: Record<string, string> = {
  material:   '📦',
  process:    '⚙️',
  worker:     '👷',
  inspection: '🔍',
  output:     '📤',
};

const NODE_TYPE_LABEL: Record<string, string> = {
  material:    '原材料',
  process:     '工序',
  worker:      '工人',
  inspection:  '质检',
  output:      '产出',
  // 兼容 TracePage 现有的节点类型
  raw_material: '原料',
  dye_lot:      '染色批次',
  inbound:      '入库',
  production:   '生产工序',
  outbound:     '出库',
  sales_order:  '销售出货',
};

// ─────────────────────────────────────────────
// 状态样式映射
// ─────────────────────────────────────────────

const STATUS_CLASS: Record<string, string> = {
  ok:      styles['trace-chain__node-card--ok'],
  warning: styles['trace-chain__node-card--warning'],
  error:   styles['trace-chain__node-card--error'],
};

const STATUS_LABEL: Record<string, string> = {
  ok:      '正常',
  warning: '注意',
  error:   '异常',
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  ok:      styles['trace-chain__status-badge--ok'],
  warning: styles['trace-chain__status-badge--warning'],
  error:   styles['trace-chain__status-badge--error'],
};

// ─────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────

export interface TraceChainProps {
  nodes: TraceNode[];
  className?: string;
}

// ─────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────

export default function TraceChain({ nodes, className = '' }: TraceChainProps) {
  if (!nodes || nodes.length === 0) {
    return (
      <div className={`${styles['trace-chain--empty']} ${className}`}>
        <span className={styles['trace-chain__empty-text']}>暂无节点数据</span>
      </div>
    );
  }

  return (
    <div
      className={`${styles['trace-chain']} ${className}`}
      role="list"
      aria-label="溯源链"
    >
      <div className={styles['trace-chain__scroll']}>
        {nodes.map((node, idx) => (
          <div key={node.id ?? idx} className={styles['trace-chain__item']} role="listitem">
            {/* 节点卡片 */}
            <TraceNodeCard node={node} />

            {/* 节点间箭头（最后一个节点不渲染） */}
            {idx < nodes.length - 1 && (
              <div className={styles['trace-chain__arrow']} aria-hidden="true">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M5 12H19M19 12L13 6M19 12L13 18"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 节点卡片子组件
// ─────────────────────────────────────────────

function TraceNodeCard({ node }: { node: TraceNode }) {
  const icon  = NODE_TYPE_ICON[node.type] ?? '🔗';
  const label = NODE_TYPE_LABEL[node.type] ?? node.type;

  // 缺失节点：status 未定义且无 detail/timestamp，视为灰色虚线样式
  const isMissing = !node.status && !node.detail && !node.timestamp;

  const cardClass = [
    styles['trace-chain__node-card'],
    node.status ? STATUS_CLASS[node.status] : '',
    isMissing    ? styles['trace-chain__node-card--missing'] : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cardClass}>
      {/* 顶部：图标 + 类型标签 */}
      <div className={styles['trace-chain__node-header']}>
        <span className={styles['trace-chain__node-icon']} aria-hidden="true">
          {icon}
        </span>
        <span className={styles['trace-chain__node-type']}>{label}</span>
      </div>

      {/* 节点标签（主要名称） */}
      <div className={styles['trace-chain__node-label']}>{node.label}</div>

      {/* 详情（可选） */}
      {node.detail && (
        <div className={styles['trace-chain__node-detail']}>{node.detail}</div>
      )}

      {/* 时间戳（可选） */}
      {node.timestamp && (
        <div className={styles['trace-chain__node-time']}>
          {formatDateTime(node.timestamp)}
        </div>
      )}

      {/* 状态徽标（可选） */}
      {node.status && (
        <div
          className={`${styles['trace-chain__status-badge']} ${STATUS_BADGE_CLASS[node.status]}`}
        >
          {STATUS_LABEL[node.status]}
        </div>
      )}
    </div>
  );
}
