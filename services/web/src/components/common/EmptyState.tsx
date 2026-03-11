/**
 * [artifact:前端代码] — 空状态组件
 * T218: 空状态页统一增强
 *
 * 新增 props:
 *   icon   - 图标字符串（emoji 或文字，默认 '📭'）
 *   action - 可选操作按钮 { label: string; onClick: () => void; variant?: ButtonVariant }
 *
 * 保留向后兼容：actionLabel / onAction 仍可使用（优先级低于 action）
 */

import styles from './EmptyState.module.css';
import Button from './Button';

/** 操作按钮配置 */
export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  /** 按钮变体，默认 'secondary' */
  variant?: 'primary' | 'secondary' | 'ghost' | 'text';
}

export interface EmptyStateProps {
  /** 图标（emoji 字符串），默认 '📭' */
  icon?: string;
  /** 主标题（必填） */
  title: string;
  /** 描述文字 */
  description?: string;
  /** 操作按钮配置（推荐使用，替代 actionLabel + onAction） */
  action?: EmptyStateAction;
  /** @deprecated 请改用 action.label */
  actionLabel?: string;
  /** @deprecated 请改用 action.onClick */
  onAction?: () => void;
}

export default function EmptyState({
  icon = '📭',
  title,
  description,
  action,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  // 兼容旧用法：若未传 action，降级到 actionLabel + onAction
  const resolvedAction: EmptyStateAction | undefined =
    action ??
    (actionLabel && onAction
      ? { label: actionLabel, onClick: onAction, variant: 'secondary' }
      : undefined);

  return (
    <div className={styles.empty} role="status" aria-label={title}>
      <span className={styles.empty__icon} aria-hidden="true">{icon}</span>
      <h3 className={styles.empty__title}>{title}</h3>
      {description && <p className={styles.empty__desc}>{description}</p>}
      {resolvedAction && (
        <Button
          variant={resolvedAction.variant ?? 'secondary'}
          size="md"
          onClick={resolvedAction.onClick}
          className={styles.empty__action}
        >
          {resolvedAction.label}
        </Button>
      )}
    </div>
  );
}
