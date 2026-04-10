/**
 * [artifact:前端代码] — 主布局（侧边栏 + 顶栏 + 内容区 + Toast + AI面板）
 */

import { Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import AiChatPanel from '@/components/ai/AiChatPanel';
import ToastContainer from '@/components/common/ToastContainer';
import AiFloatButton from '@/components/common/AiFloatButton';

export default function AppLayout() {
  const { sidebarCollapsed, aiPanelOpen, setAiPanelOpen } = useAppStore();
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const hideAiEntry = user?.scopeLevel === 'platform';

  // 移动端：屏宽小于768时自动折叠侧边栏
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        useAppStore.getState().setSidebarCollapsed(true);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 进入完整 AI 页面时，确保关闭右下角浮层面板，避免遮挡与状态残留。
  useEffect(() => {
    if (location.pathname === '/ai-chat' && aiPanelOpen) {
      setAiPanelOpen(false);
    }
  }, [location.pathname, aiPanelOpen, setAiPanelOpen]);

  return (
    <div className="app-layout">
      {/* 侧边栏 */}
      <div className={`app-layout__sidebar ${sidebarCollapsed ? 'app-layout__sidebar--collapsed' : ''}`}>
        <Sidebar />
      </div>

      {/* 主区域 */}
      <div className="app-layout__main">
        {/* 顶部导航 */}
        <div className="app-layout__header">
          <Header />
        </div>

        {/* 内容区 */}
        <main className="app-layout__content" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      {/* AI 对话浮层 */}
      {!hideAiEntry && aiPanelOpen && <AiChatPanel />}

      {/* AI 浮动按钮 */}
      {!hideAiEntry && <AiFloatButton />}

      {/* Toast 通知 */}
      <ToastContainer />
    </div>
  );
}
