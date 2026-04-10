/**
 * [artifact:前端代码] — AI 助手浮动按钮
 * 可拖拽浮动，点击跳转 /ai-chat 页面
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import styles from './AiFloatButton.module.css';

const BUTTON_SIZE = 52;
const EDGE_GAP = 24;
const DRAG_THRESHOLD = 6;
const POSITION_STORAGE_KEY = 'sf_ai_float_button_position_v1';

interface FloatPosition {
  x: number;
  y: number;
}

function getDefaultPosition(): FloatPosition {
  return {
    x: window.innerWidth - BUTTON_SIZE - EDGE_GAP,
    y: window.innerHeight - BUTTON_SIZE - EDGE_GAP,
  };
}

function clampPosition(position: FloatPosition): FloatPosition {
  const maxX = Math.max(EDGE_GAP, window.innerWidth - BUTTON_SIZE - EDGE_GAP);
  const maxY = Math.max(EDGE_GAP, window.innerHeight - BUTTON_SIZE - EDGE_GAP);
  return {
    x: Math.min(Math.max(position.x, EDGE_GAP), maxX),
    y: Math.min(Math.max(position.y, EDGE_GAP), maxY),
  };
}

export default function AiFloatButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const [position, setPosition] = useState<FloatPosition | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startPointerX: number;
    startPointerY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  // 在 AI 聊天页面和平台态不显示浮动按钮
  if (location.pathname === '/ai-chat' || user?.scopeLevel === 'platform') return null;

  useEffect(() => {
    let next = getDefaultPosition();
    const raw = window.localStorage.getItem(POSITION_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<FloatPosition>;
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          next = { x: parsed.x, y: parsed.y };
        }
      } catch {
        // ignore invalid localStorage payload
      }
    }
    setPosition(clampPosition(next));
  }, []);

  useEffect(() => {
    const onResize = () => {
      setPosition((current) => (current ? clampPosition(current) : current));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (position == null) return;
    dragStateRef.current = {
      pointerId: e.pointerId,
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      startX: position.x,
      startY: position.y,
      moved: false,
    };
    (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== e.pointerId) return;

    const dx = e.clientX - dragState.startPointerX;
    const dy = e.clientY - dragState.startPointerY;
    if (!dragState.moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
      dragState.moved = true;
    }
    if (!dragState.moved) return;

    setPosition(clampPosition({
      x: dragState.startX + dx,
      y: dragState.startY + dy,
    }));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== e.pointerId) return;

    (e.currentTarget as HTMLButtonElement).releasePointerCapture(e.pointerId);
    dragStateRef.current = null;
    if (position) {
      window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
    }
    if (!dragState.moved) {
      navigate('/ai-chat');
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== e.pointerId) return;
    dragStateRef.current = null;
    if ((e.currentTarget as HTMLButtonElement).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as HTMLButtonElement).releasePointerCapture(e.pointerId);
    }
  };

  return (
    <button
      className={styles.ai_float}
      style={position ? { left: `${position.x}px`, top: `${position.y}px` } : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
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
