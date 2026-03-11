/**
 * [artifact:前端代码] — AI 思考中状态组件
 * 对应设计规范 4.7、4.8
 */

import styles from './AiThinkingState.module.css';

export interface ThinkingStep {
  label: string;
  status: 'done' | 'active' | 'pending';
}

interface AiThinkingStateProps {
  steps?: ThinkingStep[];
  message?: string;
  onCancel?: () => void;
  elapsed?: number; // 已耗时秒数，超10秒显示
}

export default function AiThinkingState({
  steps,
  message = 'AI 正在分析...',
  onCancel,
  elapsed = 0,
}: AiThinkingStateProps) {
  return (
    <div className={styles.thinking} role="status" aria-live="polite" aria-label={message}>
      {/* 三点跳动 */}
      <div className={styles.thinking__dots} aria-hidden="true">
        <span /><span /><span />
      </div>

      <div className={styles.thinking__content}>
        <p className={styles.thinking__message}>{message}</p>

        {/* 步骤列表 */}
        {steps && steps.length > 0 && (
          <ul className={styles.thinking__steps} aria-label="处理步骤">
            {steps.map((step, i) => (
              <li key={i} className={`${styles.thinking__step} ${styles[`thinking__step--${step.status}`]}`}>
                <span className={styles.thinking__step_icon} aria-hidden="true">
                  {step.status === 'done' ? '✓' : step.status === 'active' ? '⟳' : '○'}
                </span>
                <span>{step.label}</span>
              </li>
            ))}
          </ul>
        )}

        {/* 超时提示 */}
        {elapsed >= 10 && (
          <p className={styles.thinking__elapsed} aria-live="polite">
            已耗时 {elapsed}s，复杂分析请稍候...
          </p>
        )}

        {/* 取消按钮 */}
        {onCancel && (
          <button className={styles.thinking__cancel} onClick={onCancel} type="button">
            取消
          </button>
        )}
      </div>
    </div>
  );
}
