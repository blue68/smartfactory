/**
 * [artifact:前端代码] — 通用按钮组件
 * 对应设计规范 4.1 按钮系统
 */

import { forwardRef } from 'react';
import styles from './Button.module.css';

export type ButtonVariant =
  | 'primary' | 'secondary' | 'success' | 'danger'
  | 'warning' | 'ghost' | 'text' | 'ai';

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    iconPosition = 'left',
    fullWidth = false,
    disabled,
    children,
    className = '',
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;

  const cls = [
    styles.btn,
    styles[`btn--${variant}`],
    styles[`btn--${size}`],
    fullWidth ? styles['btn--full'] : '',
    loading ? styles['btn--loading'] : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button ref={ref} className={cls} disabled={isDisabled} aria-busy={loading} {...rest}>
      {loading ? (
        <>
          {variant === 'ai' ? (
            <span className={styles.ai_dots} aria-hidden="true">
              <span /><span /><span />
            </span>
          ) : (
            <span className={`spinner spinner--sm ${styles.btn__spinner}`} aria-hidden="true" />
          )}
          <span>{variant === 'ai' ? 'AI 分析中...' : '处理中...'}</span>
        </>
      ) : (
        <>
          {icon && iconPosition === 'left' && (
            <span className={styles.btn__icon} aria-hidden="true">{icon}</span>
          )}
          {children && <span>{children}</span>}
          {icon && iconPosition === 'right' && (
            <span className={styles.btn__icon} aria-hidden="true">{icon}</span>
          )}
        </>
      )}
    </button>
  );
});

export default Button;
