/**
 * [artifact:前端代码] — AI 对话中心页面（重构版）
 *
 * T201: 双栏布局（左侧 300px 会话历史 + 右侧弹性对话区，移动端抽屉）
 * T202: WelcomeBanner + 4 个快捷问题卡片
 * T203: DataCard（table / kpi 两种模式，AI 回复内联渲染）
 * T204: Textarea 自动高度（max 5 行） + localStorage 消息持久化
 * T205: 顶部工具栏：导出对话（纯文本下载）+ 清除当前会话
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import { config } from '@/config';
import AiThinkingState, { type ThinkingStep } from '@/components/ai/AiThinkingState';
import StreamText from '@/components/ai/StreamText';
import styles from './AiChatPage.module.css';

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

/** 结构化数据卡片载荷（T203） */
export interface DataCardPayload {
  mode: 'table' | 'kpi';
  title?: string;
  /** table 模式：列名数组 */
  columns?: string[];
  /** table 模式：行数据（string 数组的数组） */
  rows?: string[][];
  /** kpi 模式：指标列表 */
  kpis?: Array<{
    label: string;
    value: string;
    /** 可选：warning | error | success，控制数值颜色 */
    status?: 'warning' | 'error' | 'success';
  }>;
}

interface Message {
  id: string;
  role: 'user' | 'ai' | 'error';
  content: string;
  streaming?: boolean;
  timestamp: Date;
  /** 内联结构化数据卡片（仅 ai 消息） */
  dataCard?: DataCardPayload;
}

interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
  messages: Message[];
}

// ─────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────

const STORAGE_KEY = 'sf_ai_conversations';
const MAX_TEXTAREA_HEIGHT_LINE = 5; // 最大 5 行

const QUICK_QUESTIONS = [
  { icon: '\u26A0', text: '今日库存预警有哪些？' },
  { icon: '\uD83D\uDCCB', text: '本周排产计划进度如何？' },
  { icon: '\uD83D\uDCB0', text: '哪些采购建议需要审批？' },
  { icon: '\uD83D\uDD0E', text: '最近的质量问题汇总' },
] as const;

const QUICK_REPLY_CHIPS = [
  '查看详情',
  '生成报告',
  '导出数据',
  '推荐操作',
];

const THINKING_STEPS_INIT: ThinkingStep[] = [
  { label: '理解您的问题...', status: 'active' },
  { label: '检索业务数据...', status: 'pending' },
  { label: '生成分析结论...', status: 'pending' },
];

let msgCounter = 0;
const newMsgId = () => `msg_${Date.now()}_${++msgCounter}`;

let convCounter = 0;
const newConvId = () => `conv_${Date.now()}_${++convCounter}`;

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

/** 序列化会话到 localStorage（timestamp 转 ISO 字符串） */
function saveConversations(conversations: Conversation[]): void {
  try {
    const serialized = conversations.map((conv) => ({
      ...conv,
      createdAt: conv.createdAt.toISOString(),
      messages: conv.messages.map((m) => ({
        ...m,
        timestamp: m.timestamp.toISOString(),
        // 持久化时去掉流式标记
        streaming: false,
      })),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
  } catch {
    // localStorage 写满时静默忽略
  }
}

/** 从 localStorage 反序列化会话 */
function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed: any[] = JSON.parse(raw);
    return parsed.map((conv) => ({
      ...conv,
      createdAt: new Date(conv.createdAt as string),
      messages: (conv.messages as Array<Record<string, unknown>>).map((m) => ({
        ...m,
        timestamp: new Date(m.timestamp as string),
      })),
    })) as Conversation[];
  } catch {
    return [];
  }
}

/** 取会话标题（以第一条用户消息的前 20 字为标题） */
function deriveTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return '新对话';
  return first.content.slice(0, 20) + (first.content.length > 20 ? '...' : '');
}

/** 导出对话为纯文本并触发下载 */
function exportConversation(conversation: Conversation): void {
  const lines: string[] = [
    `智造管家 AI 对话导出`,
    `会话：${conversation.title}`,
    `时间：${conversation.createdAt.toLocaleString('zh-CN')}`,
    '─'.repeat(40),
    '',
  ];
  for (const msg of conversation.messages) {
    const who = msg.role === 'user' ? '用户' : msg.role === 'ai' ? 'AI 助手' : '系统';
    const time = msg.timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
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

// ─────────────────────────────────────────────
// DataCard 组件（T203）
// ─────────────────────────────────────────────

function DataCard({ data }: { data: DataCardPayload }) {
  return (
    <div className={styles['data-card']}>
      {/* 卡片头部 */}
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

      {/* table 模式 */}
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

      {/* kpi 模式 */}
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
// 主页面组件
// ─────────────────────────────────────────────

export default function AiChatPage() {
  // ── 会话状态 ──
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const loaded = loadConversations();
    if (loaded.length > 0) return loaded;
    // 默认创建一个空会话
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
  const [sidebarOpen, setSidebarOpen] = useState(false); // 移动端抽屉
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>(THINKING_STEPS_INIT);

  // ── Refs ──
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number>(0);

  // ── 当前活动会话 ──
  const activeConv = conversations.find((c) => c.id === activeConvId) ?? conversations[0];
  const messages = activeConv?.messages ?? [];

  // ── 持久化：消息变化时写 localStorage（T204） ──
  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  // ── 自动滚动 ──
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  // ── Textarea 自动高度（T204） ──
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight || '24');
    const maxH = lineHeight * MAX_TEXTAREA_HEIGHT_LINE + 2; // +2 for padding
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  // ── 计时器 ──
  const startTimer = useCallback(() => {
    setElapsed(0);
    timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    clearInterval(timerRef.current);
    setElapsed(0);
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
    stopTimer();
    updateActiveMessages((prev) => [
      ...prev,
      {
        id: newMsgId(),
        role: 'ai',
        content: '已取消本次请求。有其他问题吗？',
        timestamp: new Date(),
      },
    ]);
  }, [stopTimer, updateActiveMessages]);

  // ── 发送消息 ──
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || thinking) return;

      setInput('');

      // 追加用户消息
      const userMsg: Message = {
        id: newMsgId(),
        role: 'user',
        content: trimmed,
        timestamp: new Date(),
      };
      updateActiveMessages((prev) => [...prev, userMsg]);

      // 进入思考状态
      setThinking(true);
      startTimer();
      setThinkingSteps([
        { label: '理解您的问题...', status: 'active' },
        { label: '检索业务数据...', status: 'pending' },
        { label: '生成分析结论...', status: 'pending' },
      ]);

      const aiMsgId = newMsgId();
      abortRef.current = new AbortController();

      try {
        const token = localStorage.getItem(config.tokenKey);
        const response = await fetch(`${config.apiBaseUrl}/api/ai/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ message: trimmed }),
          signal: abortRef.current.signal,
        });

        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

        // 步骤更新：检索完成，生成中
        setThinkingSteps([
          { label: '理解您的问题...', status: 'done' },
          { label: '检索业务数据...', status: 'done' },
          { label: '生成分析结论...', status: 'active' },
        ]);
        setThinking(false);
        stopTimer();

        // 追加 AI 消息占位
        const aiMsgPlaceholder: Message = {
          id: aiMsgId,
          role: 'ai',
          content: '',
          streaming: true,
          timestamp: new Date(),
        };
        updateActiveMessages((prev) => [...prev, aiMsgPlaceholder]);

        // SSE 流式读取
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
              if (parsed.content) {
                accumulated += parsed.content;
              }
              // 服务端可以在任意 chunk 中下发 dataCard
              if (parsed.dataCard) {
                dataCard = parsed.dataCard;
              }
            } catch {
              // 非 JSON 内容直接追加（纯文本 SSE 兼容）
              accumulated += data;
            }

            setConversations((prevConvs) =>
              prevConvs.map((conv) => {
                if (conv.id !== activeConvId) return conv;
                return {
                  ...conv,
                  messages: conv.messages.map((m) =>
                    m.id === aiMsgId
                      ? { ...m, content: accumulated, dataCard }
                      : m,
                  ),
                };
              }),
            );
          }
        }

        // 流结束，关闭光标
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
        stopTimer();
        if (err instanceof Error && err.name === 'AbortError') return;

        updateActiveMessages((prev) => [
          ...prev,
          {
            id: newMsgId(),
            role: 'error',
            content: '抱歉，AI 服务暂时不可用，请稍后重试。',
            timestamp: new Date(),
          },
        ]);
      }
    },
    [thinking, startTimer, stopTimer, updateActiveMessages, activeConvId],
  );

  // ── 重试（取最后一条用户消息） ──
  const retry = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    setInput(lastUser.content);
    updateActiveMessages((prev) => prev.filter((m) => m.role !== 'error'));
  }, [messages, updateActiveMessages]);

  // ── 键盘：Enter 发送，Shift+Enter 换行 ──
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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

  // ── T205 导出对话 ──
  const handleExport = useCallback(() => {
    if (!activeConv) return;
    exportConversation(activeConv);
  }, [activeConv]);

  // ── T205 清除当前会话 ──
  const handleClear = useCallback(() => {
    if (!window.confirm('确定清除当前会话的所有消息？此操作不可撤销。')) return;
    updateActiveMessages(() => []);
  }, [updateActiveMessages]);

  // ── Textarea onChange ──
  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  const hasMessages = messages.length > 0;

  return (
    <div className={styles['ai-chat']} aria-label="AI 对话中心">

      {/* ── T201 移动端抽屉遮罩 ── */}
      {sidebarOpen && (
        <div
          className={styles['ai-chat__drawer-overlay']}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ══════════════════════════════════════
          T201 左侧会话历史面板
      ══════════════════════════════════════ */}
      <aside
        className={`${styles['ai-chat__sidebar']} ${sidebarOpen ? styles['ai-chat__sidebar--open'] : ''}`}
        aria-label="会话历史"
      >
        {/* 侧边栏头部 */}
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

        {/* 会话列表 */}
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

        {/* 侧边栏底部 */}
        <div className={styles['ai-chat__sidebar-footer']}>
          <button
            className={styles['ai-chat__sidebar-footer-btn']}
            aria-label="帮助"
          >
            ? 帮助
          </button>
          <button
            className={styles['ai-chat__sidebar-footer-btn']}
            aria-label="设置"
          >
            &#9881; 设置
          </button>
        </div>
      </aside>

      {/* ══════════════════════════════════════
          右侧主对话区
      ══════════════════════════════════════ */}
      <main className={styles['ai-chat__main']}>

        {/* ── T205 顶部工具栏 ── */}
        <div className={styles['ai-chat__toolbar']}>
          {/* 移动端侧边栏切换按钮 */}
          <button
            className={styles['ai-chat__toolbar-toggle']}
            onClick={() => setSidebarOpen(true)}
            aria-label="打开会话历史"
          >
            &#9776;
          </button>

          <h1 className={styles['ai-chat__toolbar-title']}>
            {activeConv?.title ?? 'AI 对话中心'}
          </h1>

          <div className={styles['ai-chat__toolbar-actions']}>
            <button
              className={styles['ai-chat__toolbar-btn']}
              onClick={handleExport}
              disabled={!hasMessages}
              aria-label="导出对话"
            >
              &#8659; 导出
            </button>
            <button
              className={`${styles['ai-chat__toolbar-btn']} ${styles['ai-chat__toolbar-btn--danger']}`}
              onClick={handleClear}
              disabled={!hasMessages}
              aria-label="清除会话"
            >
              &#x1F5D1; 清除
            </button>
          </div>
        </div>

        {/* ── 消息列表 ── */}
        <div
          className={styles['ai-chat__messages']}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label="对话消息"
        >

          {/* ── T202 WelcomeBanner（无消息时显示） ── */}
          {!hasMessages && (
            <div className={styles['ai-chat__welcome']} aria-label="欢迎区域">
              <div className={styles['ai-chat__welcome-avatar']} aria-hidden="true">
                &#x1F916;
              </div>
              <h2 className={styles['ai-chat__welcome-title']}>
                你好，我是智造管家 AI 助手
              </h2>
              <p className={styles['ai-chat__welcome-desc']}>
                我可以帮你分析库存预警、排产进度、采购建议等业务数据。
                <br />
                选择下方常见问题快速开始，或直接输入你的问题。
              </p>

              {/* 快捷问题卡片网格（T202） */}
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

          {/* ── 消息气泡列表 ── */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`${styles['ai-chat__bubble-wrap']} ${
                msg.role === 'user' ? styles['ai-chat__bubble-wrap--user'] : ''
              }`}
            >
              {/* 头像 */}
              {msg.role !== 'user' && (
                <div
                  className={styles['ai-chat__bubble-avatar']}
                  aria-hidden="true"
                >
                  &#x1F916;
                </div>
              )}
              {msg.role === 'user' && (
                <div
                  className={`${styles['ai-chat__bubble-avatar']} ${styles['ai-chat__bubble-avatar--user']}`}
                  aria-hidden="true"
                >
                  &#x1F464;
                </div>
              )}

              {/* 消息体 */}
              <div className={styles['ai-chat__bubble-body']}>
                {msg.role === 'error' ? (
                  /* 错误气泡 */
                  <div
                    className={styles['ai-chat__bubble--error']}
                    role="alert"
                  >
                    <i className={styles['ai-chat__bubble-error-icon']} aria-hidden="true">
                      &#10060;
                    </i>
                    <div>
                      <div className={styles['ai-chat__bubble-error-title']}>请求失败</div>
                      <div className={styles['ai-chat__bubble-error-desc']}>{msg.content}</div>
                      <button
                        className={styles['ai-chat__bubble-retry-btn']}
                        onClick={retry}
                        type="button"
                      >
                        &#8635; 重试
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className={`${styles['ai-chat__bubble']} ${
                        msg.role === 'user'
                          ? styles['ai-chat__bubble--user']
                          : styles['ai-chat__bubble--ai']
                      }`}
                    >
                      <StreamText
                        text={msg.content}
                        streaming={msg.streaming}
                        realtime
                      />

                      {/* T203 DataCard 内联渲染 */}
                      {msg.role === 'ai' && msg.dataCard && (
                        <DataCard data={msg.dataCard} />
                      )}
                    </div>
                    <time
                      className={styles['ai-chat__bubble-time']}
                      dateTime={msg.timestamp.toISOString()}
                    >
                      {msg.timestamp.toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </>
                )}
              </div>
            </div>
          ))}

          {/* ── 思考中状态 ── */}
          {thinking && (
            <div className={styles['ai-chat__bubble-wrap']}>
              <div className={styles['ai-chat__bubble-avatar']} aria-hidden="true">
                &#x1F916;
              </div>
              <div className={styles['ai-chat__bubble-body']}>
                <div className={`${styles['ai-chat__bubble']} ${styles['ai-chat__bubble--ai']}`}>
                  <AiThinkingState
                    steps={thinkingSteps}
                    message="AI 正在分析您的问题..."
                    onCancel={cancelRequest}
                    elapsed={elapsed}
                  />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} aria-hidden="true" />
        </div>

        {/* ── 快捷回复 Chips（有消息且不在思考时显示） ── */}
        {hasMessages && !thinking && (
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

        {/* ── T204 底部输入区 ── */}
        <div className={styles['ai-chat__input-area']}>
          <div className={styles['ai-chat__input-box']}>
            <textarea
              ref={textareaRef}
              className={styles['ai-chat__textarea']}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="输入问题，Enter 发送，Shift+Enter 换行..."
              rows={2}
              disabled={thinking}
              aria-label="输入消息"
              aria-multiline="true"
              aria-disabled={thinking}
            />
            <button
              className={styles['ai-chat__send-btn']}
              onClick={() => void sendMessage(input)}
              disabled={!input.trim() || thinking}
              aria-label="发送消息"
            >
              &#10148;
            </button>
          </div>
          <p className={styles['ai-chat__input-hint']}>
            Enter 发送 · Shift+Enter 换行 · AI 回复仅供参考，请结合实际情况判断
          </p>
        </div>
      </main>
    </div>
  );
}
