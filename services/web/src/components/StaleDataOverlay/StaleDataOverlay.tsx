/**
 * [artifact:前端代码] — StaleDataOverlay
 * Sprint 4 / FE-S4-10
 *
 * 半透明遮罩，叠加在旧数据或错误状态的内容上方。
 * 包含错误信息条 + 重试按钮。
 *
 * 用法：将需要遮罩的内容作为 children 传入，
 * hasError=true 时展示遮罩；hasError=false 时透传渲染 children。
 */

import type { ReactNode } from 'react';
import styles from './StaleDataOverlay.module.css';

export interface StaleDataOverlayProps {
  /** 是否展示遮罩 */
  hasError: boolean;
  /** 错误提示文案 */
  errorMessage?: string;
  /** 重试回调 */
  onRetry?: () => void;
  /** 重试按钮文案 */
  retryLabel?: string;
  /** 被遮罩的内容 */
  children: ReactNode;
}

export default function StaleDataOverlay({
  hasError,
  errorMessage = '数据加载失败',
  onRetry,
  retryLabel = '重试',
  children,
}: StaleDataOverlayProps) {
  return (
    <div className={styles.wrapper}>
      {/* 被遮罩的内容（始终渲染，遮罩时变灰） */}
      <div className={hasError ? styles.content__stale : undefined}>
        {children}
      </div>

      {/* 错误遮罩层 */}
      {hasError && (
        <div
          className={styles.overlay}
          role="alert"
          aria-label="数据加载失败，请重试"
        >
          <div className={styles.overlay__card}>
            {/* 错误图标 */}
            <span className={styles.overlay__icon} aria-hidden="true">
              ⚠
            </span>

            {/* 错误信息 */}
            <p className={styles.overlay__message}>{errorMessage}</p>

            {/* 重试按钮 */}
            {onRetry && (
              <button
                type="button"
                className={styles.overlay__retry}
                onClick={onRetry}
              >
                {retryLabel}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
