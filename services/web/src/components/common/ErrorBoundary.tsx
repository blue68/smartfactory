/**
 * [artifact:前端代码] — 错误边界组件
 * T219: 网络异常统一提示
 *
 * 捕获子组件渲染期间抛出的错误，显示友好降级 UI：
 *   - 图标 + "出了点问题" 标题 + 描述文字
 *   - 重试按钮（调用 onRetry 或刷新页面）
 *   - 开发环境展示错误堆栈详情
 *
 * Props:
 *   fallback  - 自定义降级 UI（传入则完全替换默认 UI）
 *   onRetry   - 重试回调；未传则 window.location.reload()
 *   children  - 被保护的子树
 */

import { Component, ErrorInfo, ReactNode } from 'react';
import styles from './ErrorBoundary.module.css';

export interface ErrorBoundaryProps {
  /** 自定义降级 UI，覆盖默认错误页 */
  fallback?: ReactNode;
  /** 点击"重试"时的回调；不传则刷新整页 */
  onRetry?: () => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
    this.handleRetry = this.handleRetry.bind(this);
  }

  // ── 生命周期 ────────────────────────────────
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    // 生产环境可在此上报错误监控（Sentry / 自建日志等）
    console.error('[ErrorBoundary] 捕获渲染错误:', error, errorInfo);
  }

  handleRetry(): void {
    if (this.props.onRetry) {
      // 先重置状态，再执行外部重试逻辑
      this.setState({ hasError: false, error: null, errorInfo: null }, () => {
        this.props.onRetry!();
      });
    } else {
      window.location.reload();
    }
  }

  // ── 渲染 ────────────────────────────────────
  render() {
    const { hasError, error, errorInfo } = this.state;
    const { fallback, children } = this.props;
    const isDev = import.meta.env.DEV;

    if (!hasError) {
      return children;
    }

    // 优先渲染自定义 fallback
    if (fallback) {
      return fallback;
    }

    return (
      <div className={styles['error-boundary']} role="alert" aria-live="assertive">
        {/* 图标 */}
        <div className={styles['error-boundary__icon-wrap']} aria-hidden="true">
          <span className={styles['error-boundary__icon']}>⚠️</span>
        </div>

        {/* 标题 */}
        <h2 className={styles['error-boundary__title']}>出了点问题</h2>

        {/* 描述 */}
        <p className={styles['error-boundary__desc']}>
          页面遇到了意外错误，请尝试刷新重试。若问题持续出现，请联系技术支持。
        </p>

        {/* 操作按钮 */}
        <div className={styles['error-boundary__actions']}>
          <button
            className={styles['error-boundary__retry-btn']}
            onClick={this.handleRetry}
            type="button"
          >
            {/* 刷新图标 */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
              style={{ flexShrink: 0 }}
            >
              <path
                d="M13.65 2.35A8 8 0 1 0 15 8h-1.5a6.5 6.5 0 1 1-1.14-3.73L10 6.5h5V1.5l-1.35.85Z"
                fill="currentColor"
              />
            </svg>
            重新加载
          </button>
        </div>

        {/* 开发环境展示错误详情 */}
        {isDev && error && (
          <details className={styles['error-boundary__detail']}>
            <summary>
              <span>展开错误详情</span>
            </summary>
            <pre className={styles['error-boundary__stack']}>
              {error.toString()}
              {errorInfo?.componentStack ?? ''}
            </pre>
          </details>
        )}
      </div>
    );
  }
}
