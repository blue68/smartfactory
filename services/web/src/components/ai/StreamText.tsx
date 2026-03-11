/**
 * [artifact:前端代码] — 流式文本输出组件（打字机光标）
 * 对应设计规范 4.7 流式输出光标
 */

import { useEffect, useRef, useState } from 'react';
import styles from './StreamText.module.css';

interface StreamTextProps {
  /** 完整文本内容，组件内部逐字显示 */
  text: string;
  /** 是否仍在流式输出中（true=显示光标动画，false=输出完毕光标消失） */
  streaming?: boolean;
  /** 每字符延迟毫秒（模拟模式用，SSE 实时模式传 streaming=true 直接渲染全文） */
  typingDelay?: number;
  /** SSE 实时模式：直接渲染 text，不做打字机动画 */
  realtime?: boolean;
  className?: string;
}

export default function StreamText({
  text,
  streaming = false,
  typingDelay = 0,
  realtime = true,
  className = '',
}: StreamTextProps) {
  const [displayed, setDisplayed] = useState('');
  const rafRef = useRef<number>(0);
  const indexRef = useRef(0);

  // 实时模式：直接展示全部文本
  useEffect(() => {
    if (realtime) {
      setDisplayed(text);
    }
  }, [text, realtime]);

  // 打字机模式
  useEffect(() => {
    if (realtime || !text) return;
    indexRef.current = 0;
    setDisplayed('');

    const tick = () => {
      if (indexRef.current >= text.length) return;
      indexRef.current++;
      setDisplayed(text.slice(0, indexRef.current));
      rafRef.current = window.setTimeout(tick, typingDelay);
    };

    rafRef.current = window.setTimeout(tick, typingDelay);
    return () => clearTimeout(rafRef.current);
  }, [text, typingDelay, realtime]);

  const showCursor = streaming || (!realtime && displayed.length < text.length);

  // 将换行符转为段落
  const paragraphs = displayed.split('\n');

  return (
    <span className={`${styles.stream_text} ${className}`}>
      {paragraphs.map((para, i) => (
        <span key={i}>
          {para}
          {i < paragraphs.length - 1 && <br />}
        </span>
      ))}
      {showCursor && (
        <span
          className={styles.stream_text__cursor}
          aria-hidden="true"
        />
      )}
    </span>
  );
}
