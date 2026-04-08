/**
 * [artifact:前端代码] — AI 助手浮动按钮
 * 固定在右下角，点击跳转 /ai-chat 页面
 */

import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import styles from './AiFloatButton.module.css';

export default function AiFloatButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);

  // 在 AI 聊天页面和平台态不显示浮动按钮
  if (location.pathname === '/ai-chat' || user?.scopeLevel === 'platform') return null;

  return (
    <button
      className={styles.ai_float}
      onClick={() => navigate('/ai-chat')}
      aria-label="打开 AI 助手"
      title="AI 助手"
    >
      <span className={styles.ai_float__icon} aria-hidden="true">
        AI
      </span>
      <span className={styles.ai_float__pulse} aria-hidden="true" />
    </button>
  );
}
