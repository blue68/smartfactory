/**
 * [artifact:前端代码] — AI 对话浮层
 * 功能：SSE 流式输出、思考中状态、错误恢复、历史消息
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { config } from '@/config';
import { getAccessToken } from '@/utils/request';
import AiThinkingState, { type ThinkingStep } from './AiThinkingState';
import StreamText from './StreamText';
import Button from '@/components/common/Button';
import styles from './AiChatPanel.module.css';

interface Message {
  id: string;
  role: 'user' | 'ai' | 'error';
  content: string;
  streaming?: boolean;
  timestamp: Date;
}

const THINKING_STEPS: ThinkingStep[] = [
  { label: '理解您的问题...', status: 'done' },
  { label: '检索业务数据...', status: 'active' },
  { label: '生成分析结论...', status: 'pending' },
];

let msgCounter = 0;
const newId = () => `msg_${++msgCounter}`;
const MAX_PANEL_MESSAGES = 80;
const MAX_PANEL_MESSAGE_CONTENT_CHARS = 20_000;

function truncateMessageContent(content: string): string {
  if (content.length <= MAX_PANEL_MESSAGE_CONTENT_CHARS) return content;
  return `${content.slice(0, MAX_PANEL_MESSAGE_CONTENT_CHARS)}\n\n[内容过长，已截断]`;
}

function appendCappedContent(current: string, extra: string): string {
  return truncateMessageContent(`${current}${extra}`);
}

function trimPanelMessages(messages: Message[]): Message[] {
  return messages
    .slice(-MAX_PANEL_MESSAGES)
    .map((message) => ({
      ...message,
      content: truncateMessageContent(message.content),
    }));
}

export default function AiChatPanel() {
  const setAiPanelOpen = useAppStore((s) => s.setAiPanelOpen);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: newId(),
      role: 'ai',
      content: '你好！我是智造管家 AI 助手。你可以问我库存情况、采购建议、订单状态等任何问题。',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>(THINKING_STEPS);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number>(0);

  // 自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  // 计时器
  const startTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = 0;
    }
    setElapsed(0);
    timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = 0;
    }
    setElapsed(0);
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = 0;
    }
  }, []);

  const cancelRequest = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setThinking(false);
    stopTimer();
    setMessages((prev) => trimPanelMessages([
      ...prev,
      { id: newId(), role: 'ai', content: '已取消。有其他问题吗？', timestamp: new Date() },
    ]));
  }, [stopTimer]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || thinking) return;

    setInput('');

    // 追加用户消息
    const userMsg: Message = { id: newId(), role: 'user', content: text, timestamp: new Date() };
    setMessages((prev) => trimPanelMessages([...prev, userMsg]));

    // 进入思考状态
    setThinking(true);
    startTimer();
    setThinkingSteps([
      { label: '理解您的问题...', status: 'active' },
      { label: '检索业务数据...', status: 'pending' },
      { label: '生成分析结论...', status: 'pending' },
    ]);

    const aiMsgId = newId();
    const requestController = new AbortController();
    abortRef.current = requestController;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    try {
      const token = getAccessToken();
      const response = await fetch(`${config.apiBaseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message: text }),
        signal: requestController.signal,
      });

      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      // 步骤更新：数据检索完成
      setThinkingSteps([
        { label: '理解您的问题...', status: 'done' },
        { label: '检索业务数据...', status: 'done' },
        { label: '生成分析结论...', status: 'active' },
      ]);
      setThinking(false);
      stopTimer();

      // 追加 AI 消息占位
      const aiMsg: Message = { id: aiMsgId, role: 'ai', content: '', streaming: true, timestamp: new Date() };
      setMessages((prev) => trimPanelMessages([...prev, aiMsg]));

      // SSE 流式读取
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        // 解析 SSE data: 行
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data) as { content?: string };
              if (parsed.content) {
                accumulated = appendCappedContent(accumulated, parsed.content);
                setMessages((prev) =>
                  trimPanelMessages(prev.map((m) => m.id === aiMsgId ? { ...m, content: accumulated } : m)),
                );
              }
            } catch {
              // 非 JSON 数据直接追加
              accumulated = appendCappedContent(accumulated, data);
              setMessages((prev) =>
                trimPanelMessages(prev.map((m) => m.id === aiMsgId ? { ...m, content: accumulated } : m)),
              );
            }
          }
        }
      }

      // 流结束，关闭光标
      abortRef.current = null;
      setMessages((prev) =>
        trimPanelMessages(prev.map((m) => m.id === aiMsgId ? { ...m, streaming: false } : m)),
      );
    } catch (err: unknown) {
      setThinking(false);
      stopTimer();
      if (err instanceof Error && err.name === 'AbortError') return;

      setMessages((prev) => trimPanelMessages([
        ...prev,
        {
          id: newId(),
          role: 'error',
          content: '抱歉，AI 服务暂时不可用，请稍后重试。',
          timestamp: new Date(),
        },
      ]));
    } finally {
      try {
        reader?.releaseLock();
      } catch {
        // ignore release failures after an already-aborted stream
      }
      if (abortRef.current === requestController) {
        abortRef.current = null;
      }
    }
  }, [input, thinking, startTimer, stopTimer]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const retry = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      setInput(lastUser.content);
      setMessages((prev) => prev.filter((m) => m.role !== 'error'));
    }
  }, [messages]);

  return (
    <div className={styles.panel} role="complementary" aria-label="AI 助手对话">
      {/* 头部 */}
      <div className={styles.panel__header}>
        <div className={styles.panel__header_left}>
          <span className={styles.panel__ai_icon} aria-hidden="true">🤖</span>
          <div>
            <div className={styles.panel__title}>AI 助手</div>
            <div className={styles.panel__subtitle}>智造管家智能分析</div>
          </div>
        </div>
        <button
          className={styles.panel__close}
          onClick={() => setAiPanelOpen(false)}
          aria-label="关闭 AI 助手"
        >
          ×
        </button>
      </div>

      {/* 消息区 */}
      <div className={styles.panel__messages} role="log" aria-live="polite" aria-relevant="additions">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`${styles.bubble_wrap} ${msg.role === 'user' ? styles['bubble_wrap--user'] : ''}`}
          >
            {msg.role !== 'user' && (
              <div className={styles.bubble__ai_icon} aria-hidden="true">🤖</div>
            )}

            {msg.role === 'error' ? (
              <div className={styles.bubble__error} role="alert">
                <span aria-hidden="true">❌</span>
                <div>
                  <div className={styles.bubble__error_title}>请求失败</div>
                  <div className={styles.bubble__error_desc}>{msg.content}</div>
                  <button className={styles.bubble__retry} onClick={retry}>重试</button>
                </div>
              </div>
            ) : (
              <div
                className={`${styles.bubble} ${msg.role === 'user' ? styles['bubble--user'] : styles['bubble--ai']}`}
              >
                <StreamText text={msg.content} streaming={msg.streaming} realtime />
                <time
                  className={styles.bubble__time}
                  dateTime={msg.timestamp.toISOString()}
                >
                  {msg.timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </time>
              </div>
            )}
          </div>
        ))}

        {/* 思考中 */}
        {thinking && (
          <div className={styles.bubble_wrap}>
            <div className={styles.bubble__ai_icon} aria-hidden="true">🤖</div>
            <AiThinkingState
              steps={thinkingSteps}
              message="AI 正在分析您的问题..."
              onCancel={cancelRequest}
              elapsed={elapsed}
            />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* 输入区 */}
      <div className={styles.panel__input_area}>
        <textarea
          ref={inputRef}
          className={styles.panel__input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入问题，Enter 发送，Shift+Enter 换行..."
          rows={2}
          disabled={thinking}
          aria-label="输入消息"
          aria-multiline="true"
        />
        <Button
          variant="ai"
          size="md"
          loading={thinking}
          disabled={!input.trim()}
          onClick={() => void sendMessage()}
          aria-label="发送"
        >
          发送
        </Button>
      </div>
    </div>
  );
}
