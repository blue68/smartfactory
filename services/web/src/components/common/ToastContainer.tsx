/**
 * [artifact:前端代码] — Toast 通知容器
 */

import { useAppStore } from '@/stores/appStore';

const ICONS: Record<string, string> = {
  success: '✅',
  warning: '⚠️',
  error: '❌',
  info: 'ℹ️',
};

export default function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" role="region" aria-label="通知" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.type}`} role="alert">
          <span aria-hidden="true">{ICONS[toast.type]}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            {toast.title && (
              <div style={{ fontWeight: 600, fontSize: 'var(--text-body-m)', marginBottom: 2 }}>
                {toast.title}
              </div>
            )}
            <div style={{ fontSize: 'var(--text-body-m)', color: 'var(--text-secondary)' }}>
              {toast.message}
            </div>
          </div>
          <button
            onClick={() => dismissToast(toast.id)}
            aria-label="关闭通知"
            style={{
              padding: '2px 6px',
              color: 'var(--text-secondary)',
              fontSize: '1rem',
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
