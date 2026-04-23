/**
 * [artifact:前端代码] — 模态框组件
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Button from './Button';
import styles from './Modal.module.css';

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'primary' | 'danger' | 'success';
  confirmLoading?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
  children: React.ReactNode;
  footer?: React.ReactNode;
  hideFooter?: boolean;
  bodyOverflow?: 'auto' | 'visible';
}

export default function Modal({
  open,
  title,
  onClose,
  onConfirm,
  confirmLabel = '确认',
  cancelLabel = '取消',
  confirmVariant = 'primary',
  confirmLoading = false,
  size = 'md',
  children,
  footer,
  hideFooter = false,
  bodyOverflow = 'auto',
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // 键盘 Esc 关闭
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // 锁定 body 滚动
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // 焦点捕获
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className={`${styles.modal} ${styles[`modal--${size}`]}`}
        tabIndex={-1}
      >
        {/* 头部 */}
        <div className={styles.modal__header}>
          <h2 id="modal-title" className={styles.modal__title}>{title}</h2>
          <button className={styles.modal__close} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {/* 内容 */}
        <div
          className={`${styles.modal__body} ${
            bodyOverflow === 'visible' ? styles['modal__body--visible'] : ''
          }`}
        >
          {children}
        </div>

        {/* 底部 */}
        {!hideFooter && (
          <div className={styles.modal__footer}>
            {footer ?? (
              <>
                <Button variant="ghost" onClick={onClose}>{cancelLabel}</Button>
                {onConfirm && (
                  <Button
                    variant={confirmVariant}
                    onClick={onConfirm}
                    loading={confirmLoading}
                  >
                    {confirmLabel}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
