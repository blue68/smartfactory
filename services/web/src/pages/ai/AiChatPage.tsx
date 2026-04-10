/**
 * [artifact:前端代码] — AI 对话中心页面
 *
 * 视觉 100% 对齐 web-ai-chat.html 设计稿：
 *   - 左侧 300px 会话历史面板（移动端抽屉）
 *   - 右侧主对话区，顶部渐变工具栏
 *   - 消息气泡：AI 头像文字"AI"、用户气泡蓝色无头像
 *   - 思考状态：步骤列表 + 倒计时秒数
 *   - 流式输出：闪烁光标（StreamText）
 *   - 置信度标签（ConfidenceTag）随 AI 回复显示
 *   - 错误气泡：重试 + 手动处理双按钮
 *   - 日期分隔线
 *   - 底部上下文 token 元信息行
 *   - 输入框（单行）+ CSS 箭头发送按钮
 *   - localStorage 消息持久化，导出对话，清除当前会话
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { config } from '@/config';
import { getAccessToken } from '@/utils/request';
import AiThinkingState, { type ThinkingStep } from '@/components/ai/AiThinkingState';
import StreamText from '@/components/ai/StreamText';
import ConfidenceTag from '@/components/common/ConfidenceTag';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import { Confidence } from '@/types/enums';
import { useAppStore } from '@/stores/appStore';
import styles from './AiChatPage.module.css';

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

/** 结构化数据卡片载荷 */
export interface DataCardPayload {
  mode: 'table' | 'kpi';
  title?: string;
  columns?: string[];
  rows?: string[][];
  kpis?: Array<{
    label: string;
    value: string;
    status?: 'warning' | 'error' | 'success';
  }>;
}

interface Message {
  id: string;
  role: 'user' | 'ai' | 'error';
  content: string;
  streaming?: boolean;
  timestamp: Date;
  dataCard?: DataCardPayload;
  /** AI 回复置信度 */
  confidence?: Confidence;
}

const EMPTY_MESSAGES: Message[] = [];

interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
  messages: Message[];
}

interface ChatUiSettings {
  enterToSend: boolean;
  quickRepliesEnabled: boolean;
}

// ─────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────

const STORAGE_KEY = 'sf_ai_conversations';
const SETTINGS_STORAGE_KEY = 'sf_ai_chat_settings';

const QUICK_QUESTIONS = [
  { icon: '⚠', text: '今日库存预警有哪些？' },
  { icon: '📋', text: '本周排产计划进度如何？' },
  { icon: '💰', text: '哪些采购建议需要审批？' },
  { icon: '🔎', text: '最近的质量问题汇总' },
] as const;

const QUICK_REPLY_CHIPS = ['查看详情', '生成报告', '导出数据', '推荐操作'];

const THINKING_STEPS_INIT: ThinkingStep[] = [
  { label: '理解您的问题...', status: 'active' },
  { label: '检索业务数据...', status: 'pending' },
  { label: '生成分析结论...', status: 'pending' },
];

/** 模拟倒计时初始秒数 */
const THINKING_COUNTDOWN_INIT = 8;

let msgCounter = 0;
const newMsgId = () => `msg_${Date.now()}_${++msgCounter}`;

let convCounter = 0;
const newConvId = () => `conv_${Date.now()}_${++convCounter}`;

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

function saveConversations(conversations: Conversation[]): void {
  try {
    const serialized = conversations.map((conv) => ({
      ...conv,
      createdAt: conv.createdAt.toISOString(),
      messages: conv.messages.map((m) => ({
        ...m,
        timestamp: m.timestamp.toISOString(),
        streaming: false,
      })),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
  } catch {
    // localStorage 写满时静默忽略
  }
}

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    const normalized = parsed.map((conv) => {
      const createdAt = new Date(String(conv.createdAt ?? ''));
      const convCreatedAt = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt;
      const rawMessages = Array.isArray(conv.messages) ? conv.messages : [];
      const messages = rawMessages
        .map((m) => {
          const timestamp = new Date(String(m.timestamp ?? ''));
          return {
            ...m,
            timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
          };
        })
        .filter((m) => (m.role === 'user' || m.role === 'ai' || m.role === 'error') && typeof m.content === 'string');

      return {
        id: String(conv.id ?? newConvId()),
        title: typeof conv.title === 'string' && conv.title.trim() ? conv.title : '新对话',
        createdAt: convCreatedAt,
        messages,
      } as Conversation;
    });
    return normalized;
  } catch {
    return [];
  }
}

function loadChatUiSettings(): ChatUiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { enterToSend: true, quickRepliesEnabled: true };
    const parsed = JSON.parse(raw) as Partial<ChatUiSettings>;
    return {
      enterToSend: parsed.enterToSend ?? true,
      quickRepliesEnabled: parsed.quickRepliesEnabled ?? true,
    };
  } catch {
    return { enterToSend: true, quickRepliesEnabled: true };
  }
}

function saveChatUiSettings(settings: ChatUiSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage failures
  }
}

function deriveTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return '新对话';
  return first.content.slice(0, 20) + (first.content.length > 20 ? '...' : '');
}

function exportConversation(conversation: Conversation): void {
  const lines: string[] = [
    '智造管家 AI 对话导出',
    `会话：${conversation.title}`,
    `时间：${conversation.createdAt.toLocaleString('zh-CN')}`,
    '─'.repeat(40),
    '',
  ];
  for (const msg of conversation.messages) {
    const who = msg.role === 'user' ? '用户' : msg.role === 'ai' ? 'AI 助手' : '系统';
    const time = msg.timestamp.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
    lines.push(`[${time}] ${who}：`);
    lines.push(msg.content);
    lines.push('');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `AI对话_${conversation.title}_${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 估算上下文 token（粗略：每个汉字≈1 token，英文每词≈1 token） */
function estimateTokens(messages: Message[]): number {
  return messages.reduce((acc, m) => acc + Math.ceil(m.content.length * 0.9), 0);
}

/** 格式化日期分隔线标签 */
function formatDateDivider(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return '今天';
  if (date.toDateString() === yesterday.toDateString()) return '昨天';
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

// ─────────────────────────────────────────────
// DataCard 组件
// ─────────────────────────────────────────────

function DataCard({ data }: { data: DataCardPayload }) {
  return (
    <div className={styles['data-card']}>
      <div className={styles['data-card__header']}>
        <span
          className={`${styles['data-card__type-badge']} ${
            data.mode === 'table'
              ? styles['data-card__type-badge--table']
              : styles['data-card__type-badge--kpi']
          }`}
        >
          {data.mode === 'table' ? 'TABLE' : 'KPI'}
        </span>
        {data.title && (
          <span className={styles['data-card__title']}>{data.title}</span>
        )}
      </div>

      {data.mode === 'table' && data.columns && data.rows && (
        <div style={{ overflowX: 'auto' }}>
          <table className={styles['data-card__table']} aria-label={data.title ?? '数据表格'}>
            <thead>
              <tr>
                {data.columns.map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.mode === 'kpi' && data.kpis && (
        <div className={styles['data-card__kpi-grid']}>
          {data.kpis.map((kpi, i) => (
            <div key={i} className={styles['data-card__kpi-item']}>
              <span
                className={`${styles['data-card__kpi-value']} ${
                  kpi.status ? styles[`data-card__kpi-value--${kpi.status}`] : ''
                }`}
              >
                {kpi.value}
              </span>
              <span className={styles['data-card__kpi-label']}>{kpi.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 日期分隔线
// ─────────────────────────────────────────────

function DateDivider({ label }: { label: string }) {
  return (
    <div className={styles['chat-divider']} aria-label={label}>
      {label}
    </div>
  );
}

// ─────────────────────────────────────────────
// 主页面组件
// ─────────────────────────────────────────────

export default function AiChatPage() {
  const navigate = useNavigate();
  const showToast = useAppStore((state) => state.showToast);
  // ── 会话状态 ──
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const loaded = loadConversations();
    if (loaded.length > 0) return loaded;
    return [
      {
        id: newConvId(),
        title: '新对话',
        createdAt: new Date(),
        messages: [],
      },
    ];
  });
  const [activeConvId, setActiveConvId] = useState<string>(
    () => conversations[0]?.id ?? newConvId(),
  );

  // ── UI 状态 ──
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [countdown, setCountdown] = useState(THINKING_COUNTDOWN_INIT);
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>(THINKING_STEPS_INIT);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatSettings, setChatSettings] = useState<ChatUiSettings>(loadChatUiSettings);

  // ── Refs ──
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const countdownRef = useRef<number>(0);

  // ── 当前活动会话 ──
  const activeConv = conversations.find((c) => c.id === activeConvId) ?? conversations[0];
  const messages = useMemo(() => activeConv?.messages ?? EMPTY_MESSAGES, [activeConv?.messages]);

  // ── 持久化 ──
  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    saveChatUiSettings(chatSettings);
  }, [chatSettings]);

  // ── 自动滚动 ──
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  // ── 倒计时（思考状态） ──
  const startCountdown = useCallback(() => {
    setCountdown(THINKING_COUNTDOWN_INIT);
    countdownRef.current = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const stopCountdown = useCallback(() => {
    clearInterval(countdownRef.current);
    setCountdown(THINKING_COUNTDOWN_INIT);
  }, []);

  // ── 更新当前会话消息 ──
  const updateActiveMessages = useCallback(
    (updater: (prev: Message[]) => Message[]) => {
      setConversations((prevConvs) =>
        prevConvs.map((conv) => {
          if (conv.id !== activeConvId) return conv;
          const newMessages = updater(conv.messages);
          return {
            ...conv,
            messages: newMessages,
            title: deriveTitle(newMessages),
          };
        }),
      );
    },
    [activeConvId],
  );

  // ── 取消请求 ──
  const cancelRequest = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setThinking(false);
    stopCountdown();
    updateActiveMessages((prev) => [
      ...prev,
      {
        id: newMsgId(),
        role: 'ai',
        content: '已取消本次请求。有其他问题吗？',
        timestamp: new Date(),
        confidence: Confidence.LOW,
      },
    ]);
  }, [stopCountdown, updateActiveMessages]);

  // ── 发送消息 ──
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || thinking) return;

      setInput('');

      const userMsg: Message = {
        id: newMsgId(),
        role: 'user',
        content: trimmed,
        timestamp: new Date(),
      };
      updateActiveMessages((prev) => [...prev, userMsg]);

      setThinking(true);
      startCountdown();
      setThinkingSteps([
        { label: '理解您的问题...', status: 'active' },
        { label: '检索业务数据...', status: 'pending' },
        { label: '生成分析结论...', status: 'pending' },
      ]);

      const aiMsgId = newMsgId();
      abortRef.current = new AbortController();
      // 客户端 30 秒超时（SEC HF-004），与服务端超时对齐
      const timeoutId = setTimeout(() => abortRef.current?.abort(), 30_000);

      try {
        const token = getAccessToken();
        const response = await fetch(`${config.apiBaseUrl}/api/ai/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ message: trimmed }),
          signal: abortRef.current.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

        setThinkingSteps([
          { label: '理解您的问题...', status: 'done' },
          { label: '检索业务数据...', status: 'done' },
          { label: '生成分析结论...', status: 'active' },
        ]);
        setThinking(false);
        stopCountdown();

        const aiMsgPlaceholder: Message = {
          id: aiMsgId,
          role: 'ai',
          content: '',
          streaming: true,
          timestamp: new Date(),
          confidence: Confidence.HIGH,
        };
        updateActiveMessages((prev) => [...prev, aiMsgPlaceholder]);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';
        let dataCard: DataCardPayload | undefined;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') break;

            try {
              const parsed = JSON.parse(data) as {
                content?: string;
                dataCard?: DataCardPayload;
              };
              if (parsed.content) accumulated += parsed.content;
              if (parsed.dataCard) dataCard = parsed.dataCard;
            } catch {
              accumulated += data;
            }

            setConversations((prevConvs) =>
              prevConvs.map((conv) => {
                if (conv.id !== activeConvId) return conv;
                return {
                  ...conv,
                  messages: conv.messages.map((m) =>
                    m.id === aiMsgId ? { ...m, content: accumulated, dataCard } : m,
                  ),
                };
              }),
            );
          }
        }

        setConversations((prevConvs) =>
          prevConvs.map((conv) => {
            if (conv.id !== activeConvId) return conv;
            return {
              ...conv,
              messages: conv.messages.map((m) =>
                m.id === aiMsgId ? { ...m, streaming: false } : m,
              ),
            };
          }),
        );
      } catch (err: unknown) {
        setThinking(false);
        stopCountdown();
        if (err instanceof Error && err.name === 'AbortError') return;

        updateActiveMessages((prev) => [
          ...prev,
          {
            id: newMsgId(),
            role: 'error',
            content: '抱歉，排产分析请求超时。可能是当前订单数据量较大，服务器响应超过 30 秒限制。请稍后重试，或手动查看报表页面。',
            timestamp: new Date(),
          },
        ]);
      }
    },
    [thinking, startCountdown, stopCountdown, updateActiveMessages, activeConvId],
  );

  // ── 重试 ──
  const retry = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    setInput(lastUser.content);
    updateActiveMessages((prev) => prev.filter((m) => m.role !== 'error'));
  }, [messages, updateActiveMessages]);

  // ── 手动处理（跳转报表页面） ──
  const handleManual = useCallback(() => {
    navigate('/dashboard');
  }, [navigate]);

  // ── 键盘：Enter 发送 ──
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;

    if (chatSettings.enterToSend && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
      return;
    }

    if (!chatSettings.enterToSend && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  // ── 新建会话 ──
  const createConversation = useCallback(() => {
    const newConv: Conversation = {
      id: newConvId(),
      title: '新对话',
      createdAt: new Date(),
      messages: [],
    };
    setConversations((prev) => [newConv, ...prev]);
    setActiveConvId(newConv.id);
    setSidebarOpen(false);
  }, []);

  // ── 切换会话 ──
  const switchConversation = useCallback((id: string) => {
    setActiveConvId(id);
    setSidebarOpen(false);
  }, []);

  // ── 导出对话 ──
  const handleExport = useCallback(() => {
    if (!activeConv) return;
    exportConversation(activeConv);
  }, [activeConv]);

  // ── 清除当前会话 ──
  const handleClear = useCallback(() => {
    if (!window.confirm('确定清除当前会话的所有消息？此操作不可撤销。')) return;
    updateActiveMessages(() => []);
  }, [updateActiveMessages]);

  // ── 清空上下文（仅清除，不删除本地存储） ──
  const handleClearContext = useCallback(() => {
    updateActiveMessages(() => []);
  }, [updateActiveMessages]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  const handleOpenHelp = useCallback(() => {
    setHelpOpen(true);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const handleApplySettings = useCallback(() => {
    setSettingsOpen(false);
    showToast({ type: 'success', message: 'AI 助手设置已保存' });
  }, [showToast]);

  const hasMessages = messages.length > 0;
  const contextTokens = estimateTokens(messages);
  const maxTokens = 4096;

  // ── 渲染消息列表（带日期分隔线） ──
  const renderMessages = () => {
    const elements: React.ReactNode[] = [];
    let lastDateStr = '';

    messages.forEach((msg) => {
      const dateStr = msg.timestamp.toDateString();
      if (dateStr !== lastDateStr) {
        lastDateStr = dateStr;
        elements.push(
          <DateDivider
            key={`divider-${dateStr}`}
            label={formatDateDivider(msg.timestamp)}
          />,
        );
      }

      if (msg.role === 'user') {
        elements.push(
          <div key={msg.id} className={`${styles['msg']} ${styles['msg--user']}`} aria-label="用户消息">
            <div className={styles['msg__bubble']}>
              <StreamText text={msg.content} streaming={false} realtime />
            </div>
          </div>,
        );
      } else if (msg.role === 'error') {
        elements.push(
          <div key={msg.id} className={`${styles['msg']} ${styles['msg--ai']} ${styles['msg--error']}`} aria-label="AI 错误响应">
            <div
              className={styles['msg__avatar']}
              style={{ background: 'var(--color-error-100)', color: 'var(--color-error-600)' }}
              aria-hidden="true"
            >
              !
            </div>
            <div>
              <div className={styles['msg__bubble']} role="alert">
                <span className={styles['error-message-text']}>{msg.content}</span>
                <div className={styles['error-actions']}>
                  <button
                    className={styles['error-actions__retry']}
                    onClick={retry}
                    aria-label="重试请求"
                    type="button"
                  >
                    ↻ 重试
                  </button>
                  <button
                    className={styles['error-actions__manual']}
                    onClick={handleManual}
                    aria-label="手动处理"
                    type="button"
                  >
                    手动处理
                  </button>
                </div>
              </div>
            </div>
          </div>,
        );
      } else {
        // AI message
        elements.push(
          <div key={msg.id} className={`${styles['msg']} ${styles['msg--ai']}`} aria-label="AI 回复">
            <div className={styles['msg__avatar']} aria-hidden="true">AI</div>
            <div>
              <div className={styles['msg__bubble']}>
                <StreamText text={msg.content} streaming={msg.streaming} realtime />
                {msg.dataCard && <DataCard data={msg.dataCard} />}
              </div>
              {msg.confidence && !msg.streaming && (
                <ConfidenceTag confidence={msg.confidence} />
              )}
            </div>
          </div>,
        );
      }
    });

    return elements;
  };

  return (
    <div className={styles['ai-chat']} aria-label="AI 对话中心">

      {/* 移动端抽屉遮罩 */}
      {sidebarOpen && (
        <div
          className={styles['ai-chat__drawer-overlay']}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ══ 左侧会话历史面板 ══ */}
      <aside
        className={`${styles['ai-chat__sidebar']} ${sidebarOpen ? styles['ai-chat__sidebar--open'] : ''}`}
        aria-label="会话历史"
      >
        <div className={styles['ai-chat__sidebar-header']}>
          <span className={styles['ai-chat__sidebar-title']}>会话历史</span>
          <button
            className={styles['ai-chat__new-btn']}
            onClick={createConversation}
            aria-label="新建对话"
          >
            <i className={styles['ai-chat__new-btn-icon']} aria-hidden="true">+</i>
            新对话
          </button>
        </div>

        <nav
          className={styles['ai-chat__conv-list']}
          role="navigation"
          aria-label="历史会话列表"
        >
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`${styles['ai-chat__conv-item']} ${
                conv.id === activeConvId ? styles['ai-chat__conv-item--active'] : ''
              }`}
              onClick={() => switchConversation(conv.id)}
              role="button"
              tabIndex={0}
              aria-current={conv.id === activeConvId ? 'true' : undefined}
              onKeyDown={(e) => e.key === 'Enter' && switchConversation(conv.id)}
            >
              <span className={styles['ai-chat__conv-item-title']}>{conv.title}</span>
              <div className={styles['ai-chat__conv-item-meta']}>
                <span className={styles['ai-chat__conv-item-time']}>
                  {conv.createdAt.toLocaleDateString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                  })}
                </span>
                {conv.messages.length > 0 && (
                  <span className={styles['ai-chat__conv-item-preview']}>
                    {conv.messages[conv.messages.length - 1]?.content.slice(0, 20) ?? ''}
                  </span>
                )}
              </div>
            </div>
          ))}
        </nav>

        <div className={styles['ai-chat__sidebar-footer']}>
          <button
            className={styles['ai-chat__sidebar-footer-btn']}
            aria-label="帮助"
            type="button"
            onClick={handleOpenHelp}
          >
            ? 帮助
          </button>
          <button
            className={styles['ai-chat__sidebar-footer-btn']}
            aria-label="设置"
            type="button"
            onClick={handleOpenSettings}
          >
            ⚙ 设置
          </button>
        </div>
      </aside>

      {/* ══ 右侧主对话区 ══ */}
      <main className={styles['ai-chat__main']}>

        {/* 顶部工具栏（渐变蓝色，对齐设计稿 chat-panel__header 风格） */}
        <header className={styles['ai-chat__toolbar']}>
          {/* 移动端侧边栏切换 */}
          <button
            className={styles['ai-chat__toolbar-toggle']}
            onClick={() => setSidebarOpen(true)}
            aria-label="打开会话历史"
          >
            ☰
          </button>

          {/* AI 头像 */}
          <div className={styles['chat-avatar']} aria-hidden="true">🤖</div>

          {/* 标题区 */}
          <div className={styles['ai-chat__toolbar-title-block']}>
            <span className={styles['ai-chat__toolbar-title']}>
              {activeConv?.title ?? '智造管家AI助手'}
            </span>
            <span className={styles['ai-chat__toolbar-subtitle']}>在线 · 响应迅速</span>
          </div>

          {/* 操作按钮 */}
          <div className={styles['ai-chat__toolbar-actions']}>
            <button
              className={styles['ai-chat__toolbar-btn']}
              onClick={handleExport}
              disabled={!hasMessages}
              aria-label="导出对话"
              title="导出对话"
            >
              —
            </button>
            <button
              className={styles['ai-chat__toolbar-btn']}
              onClick={handleClear}
              disabled={!hasMessages}
              aria-label="清除会话"
              title="关闭 / 清除"
            >
              ✕
            </button>
          </div>
        </header>

        {/* 消息列表 */}
        <div
          className={styles['chat-messages']}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label="对话消息"
        >
          {/* WelcomeBanner（无消息时） */}
          {!hasMessages && (
            <div className={styles['ai-chat__welcome']} aria-label="欢迎区域">
              <div className={styles['ai-chat__welcome-avatar']} aria-hidden="true">🤖</div>
              <h2 className={styles['ai-chat__welcome-title']}>
                你好，我是智造管家 AI 助手
              </h2>
              <p className={styles['ai-chat__welcome-desc']}>
                我可以帮你分析库存预警、排产进度、采购建议等业务数据。
                <br />
                选择下方常见问题快速开始，或直接输入你的问题。
              </p>
              <div className={styles['ai-chat__quick-grid']} role="list">
                {QUICK_QUESTIONS.map((q) => (
                  <button
                    key={q.text}
                    className={styles['ai-chat__quick-card']}
                    onClick={() => void sendMessage(q.text)}
                    role="listitem"
                    aria-label={`快捷问题：${q.text}`}
                  >
                    <i className={styles['ai-chat__quick-card-icon']} aria-hidden="true">
                      {q.icon}
                    </i>
                    <span className={styles['ai-chat__quick-card-text']}>{q.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 消息列表（含日期分隔线） */}
          {renderMessages()}

          {/* 思考中状态 */}
          {thinking && (
            <div className={`${styles['msg']} ${styles['msg--ai']}`} aria-label="AI 正在思考">
              <div className={styles['msg__avatar']} aria-hidden="true">AI</div>
              <div>
                <div className={`${styles['msg__bubble']} ${styles['msg__bubble--thinking']}`}>
                  <AiThinkingState
                    steps={thinkingSteps}
                    message="AI 正在分析您的问题..."
                    onCancel={cancelRequest}
                    elapsed={countdown}
                  />
                  <div className={styles['thinking-countdown']} aria-live="polite">
                    <span>预计还需约</span>
                    <span className={styles['thinking-countdown__timer']}>
                      {countdown}
                    </span>
                    <span>秒</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} aria-hidden="true" />
        </div>

        {/* 上下文 token 元信息行（对齐设计稿 chat-footer-meta） */}
        <div className={styles['chat-footer-meta']}>
          <span>
            上下文 {contextTokens.toLocaleString()} / {maxTokens.toLocaleString()} tokens
          </span>
          <span
            className={styles['chat-footer-meta__clear']}
            role="button"
            tabIndex={0}
            onClick={handleClearContext}
            onKeyDown={(e) => e.key === 'Enter' && handleClearContext()}
          >
            清空上下文
          </span>
        </div>

        {/* 快捷回复 Chips */}
        {hasMessages && !thinking && chatSettings.quickRepliesEnabled && (
          <div className={styles['ai-chat__quick-replies']} aria-label="快捷回复建议">
            {QUICK_REPLY_CHIPS.map((chip) => (
              <button
                key={chip}
                className={styles['ai-chat__quick-chip']}
                onClick={() => void sendMessage(chip)}
                aria-label={`快捷回复：${chip}`}
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        {/* 底部输入区（对齐设计稿 chat-input-area） */}
        <div className={styles['chat-input-area']}>
          <input
            ref={inputRef}
            className={styles['chat-input']}
            type="text"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={chatSettings.enterToSend ? '输入问题，如：当前缺料情况…' : '输入问题，按 Ctrl/Cmd + Enter 发送'}
            maxLength={500}
            disabled={thinking}
            aria-label="向 AI 助手提问"
          />
          <button
            className={styles['chat-send']}
            onClick={() => void sendMessage(input)}
            disabled={!input.trim() || thinking}
            aria-label="发送"
            type="button"
          >
            <span className={styles['chat-send__arrow']} aria-hidden="true" />
          </button>
        </div>
      </main>

      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="AI 助手帮助"
        hideFooter
        size="md"
      >
        <div className={styles['ai-chat__modal-content']}>
          <section className={styles['ai-chat__modal-section']}>
            <h3>使用说明</h3>
            <ul>
              <li>可直接输入库存、采购、排产、质检等业务问题。</li>
              <li>支持点击常见问题卡片快速发起提问。</li>
              <li>支持导出对话结果，便于留存分析记录。</li>
            </ul>
          </section>
          <section className={styles['ai-chat__modal-section']}>
            <h3>快捷键</h3>
            <ul>
              <li>{chatSettings.enterToSend ? 'Enter 发送消息' : 'Ctrl/Cmd + Enter 发送消息'}</li>
              <li>Esc 关闭弹窗</li>
            </ul>
          </section>
          <div className={styles['ai-chat__modal-actions']}>
            <Button
              variant="primary"
              onClick={() => {
                setHelpOpen(false);
                setInput('请给我一份今日库存预警与采购动作建议');
                inputRef.current?.focus();
              }}
            >
              插入示例问题
            </Button>
            <Button variant="ghost" onClick={() => setHelpOpen(false)}>
              关闭
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="AI 助手设置"
        onConfirm={handleApplySettings}
        confirmLabel="保存设置"
        size="md"
      >
        <div className={styles['ai-chat__modal-content']}>
          <section className={styles['ai-chat__modal-section']}>
            <label className={styles['ai-chat__setting-row']}>
              <input
                type="checkbox"
                checked={chatSettings.enterToSend}
                onChange={(e) => setChatSettings((prev) => ({ ...prev, enterToSend: e.target.checked }))}
              />
              <span>启用 Enter 发送消息（关闭后使用 Ctrl/Cmd + Enter）</span>
            </label>
            <label className={styles['ai-chat__setting-row']}>
              <input
                type="checkbox"
                checked={chatSettings.quickRepliesEnabled}
                onChange={(e) =>
                  setChatSettings((prev) => ({ ...prev, quickRepliesEnabled: e.target.checked }))
                }
              />
              <span>显示快捷回复建议</span>
            </label>
          </section>
        </div>
      </Modal>
    </div>
  );
}
