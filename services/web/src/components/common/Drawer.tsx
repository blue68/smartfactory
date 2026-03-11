/**
 * [artifact:前端代码] — 右侧抽屉组件
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './Drawer.module.css';

export interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  width?: number | string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export default function Drawer({
  open,
  title,
  onClose,
  width = 480,
  children,
  footer,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      panelRef.current?.focus();
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return createPortal(
    <div
      className={`${styles.overlay} ${open ? styles['overlay--open'] : ''}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      aria-hidden={!open}
    >
      <div
        ref={panelRef}
        className={`${styles.drawer} ${open ? styles['drawer--open'] : ''}`}
        style={{ width: typeof width === 'number' ? `${width}px` : width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
      >
        <div className={styles.drawer__header}>
          <h2 id="drawer-title" className={styles.drawer__title}>{title}</h2>
          <button className={styles.drawer__close} onClick={onClose} aria-label="关闭抽屉">
            ×
          </button>
        </div>

        <div className={styles.drawer__body}>{children}</div>

        {footer && <div className={styles.drawer__footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
