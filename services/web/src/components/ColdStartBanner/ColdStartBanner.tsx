/**
 * [artifact:前端代码] — ColdStartBanner
 * Sprint 4 / FE-S4-09
 *
 * 黄色警示横幅，提示系统数据积累不足、AI 建议仅供参考。
 * 同一会话（sessionStorage）内关闭后不再展示。
 */

import { useState } from 'react';
import styles from './ColdStartBanner.module.css';

const SESSION_KEY = 'cold_start_banner_dismissed';

export interface ColdStartBannerProps {
  /** 自定义提示文案，不传则使用默认文案 */
  message?: string;
}

export default function ColdStartBanner({ message }: ColdStartBannerProps) {
  const [visible, setVisible] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY) !== 'true';
    } catch {
      // 无法访问 sessionStorage（如隐私模式部分浏览器）时默认展示
      return true;
    }
  });

  if (!visible) return null;

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(SESSION_KEY, 'true');
    } catch {
      // 忽略存储异常
    }
    setVisible(false);
  };

  return (
    <div
      className={styles.banner}
      role="alert"
      aria-live="polite"
    >
      {/* 左侧图标 */}
      <span className={styles.banner__icon} aria-hidden="true">
        ⚠
      </span>

      {/* 文案区 */}
      <div className={styles.banner__content}>
        <span className={styles.banner__title}>数据积累不足，建议仅供参考</span>
        <span className={styles.banner__desc}>
          {message ??
            '系统检测到历史数据较少，AI 计算置信度偏低。建议在积累更多订单和库存数据后，再参考调度建议进行决策。'}
        </span>
      </div>

      {/* 关闭按钮 */}
      <button
        type="button"
        className={styles.banner__close}
        onClick={handleDismiss}
        aria-label="关闭提示"
      >
        ×
      </button>
    </div>
  );
}
