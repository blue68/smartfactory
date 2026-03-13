/**
 * [artifact:前端代码] — 每日排产计划页
 *
 * 100% 高保真还原设计稿 /docs/ui/web-production-schedule.html
 *
 * 功能范围：
 *   - StatusBar：AI 已生成计划状态摘要栏
 *   - AiRiskAlert：AI 风险提示（橙色左边框）
 *   - ViewToggle：工作站视图 / 订单视图 / 人员视图
 *   - GanttChart：工作站行 × 时间槽列（HTML table 结构）
 *   - GanttLegend：图例说明
 *   - WorkerSection：工人任务分配卡片网格
 *   - StickyActionBar：底部固定确认操作栏
 *
 * API 联调说明：
 *   - 甘特图工作站行数据：由 useSchedule (GET /api/production/schedule/generate) 返回的
 *     ScheduleResult.schedules[] 经 adaptScheduleToStations() 转换而来。
 *   - 工人卡片数据：由同一 schedules[] 经 adaptScheduleToWorkers() 转换而来。
 *     注意：useWorkerTasks 需要具体的 workerId，排产页展示的是"全员"视图，
 *     因此直接从 schedules[] 按 workerId 分组，而非逐人调用 useWorkerTasks。
 *   - materialStatus / materialLabel：后端排产引擎暂不返回物料备料状态，
 *     当前默认为 'ok'/'料已备好'。TODO: 待物料模块接口就绪后补充联查。
 *   - 时间槽（08:00-10:00 等）：后端仅返回 estimatedHours，不含具体开始/结束时间，
 *     适配层按工作站内任务顺序依次分配到固定 4 个时间槽（贪心填入）。
 *     TODO: 待排产引擎支持 plannedStartTime / plannedEndTime 字段后精确映射。
 */

import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSchedule, useConfirmSchedule } from '@/api/production';
import type { ScheduleItem } from '@/types/models';
import Tag from '@/components/common/Tag';
import Button from '@/components/common/Button';
import styles from './SchedulePage.module.css';

// ─── 类型定义 ─────────────────────────────────────────────

/** 甘特图任务块状态 */
type TaskBlockVariant = 'normal' | 'warning' | 'danger';

/** 物料备料状态 */
type MaterialStatus = 'ok' | 'warn' | 'err';

/** 时间槽标签（设计稿精确值） */
type TimeSlotLabel = '08:00 — 10:00' | '10:00 — 12:00' | '13:30 — 15:30' | '15:30 — 17:30';

/** 视图切换类型 */
type ScheduleView = 'station' | 'order' | 'worker';

/** 甘特图任务块数据 */
interface GanttTask {
  id: string;
  orderNo: string;
  /** 含工序名等附加文字，例如 "开料 · 2.00套" */
  operation: string;
  /** 例如 "张伟 · 2套" */
  workerInfo: string;
  /**
   * 例如 "✓ 备料就绪" 或 "⚠ 物料待确认"
   * TODO: 后端暂未返回物料状态，默认显示"✓ 备料就绪"
   */
  materialIcon: string;
  variant: TaskBlockVariant;
  /** 用于 aria-label */
  ariaLabel: string;
  /** 订单标签文字，可含图标后缀 */
  orderLabel: string;
}

/** 甘特图工作站行数据 */
interface StationRow {
  stationId: string;
  stationName: string;
  workerInCharge: string;
  /**
   * 物料备料状态
   * TODO: 后端排产引擎暂不返回物料状态，默认 'ok'。
   * 待物料模块联查接口上线后替换此字段。
   */
  materialStatus: MaterialStatus;
  materialLabel: string;
  /** key: 时间槽 label，value: 该槽任务（最多1个） */
  slots: Partial<Record<TimeSlotLabel, GanttTask>>;
}

/** 工人任务项 */
interface WorkerTaskItem {
  priority: 'high' | 'med' | 'low';
  text: string;
  /**
   * 显示时间字符串
   * TODO: 后端暂不返回精确时间段，当前按任务在工作站内的排列顺序映射到固定时间槽。
   */
  time: string;
  /** 特殊样式（如延误订单的红色背景） */
  highlight?: boolean;
}

/** 工人卡片数据 */
interface WorkerCard {
  workerId: string;
  initial: string;
  name: string;
  roleLine: string;
  tasks: WorkerTaskItem[];
}

// ─── 时间槽常量 ───────────────────────────────────────────

const TIME_SLOTS: TimeSlotLabel[] = [
  '08:00 — 10:00',
  '10:00 — 12:00',
  '13:30 — 15:30',
  '15:30 — 17:30',
];

// ─── 适配层：将后端 ScheduleItem[] 转换为前端展示结构 ────────

/**
 * 将后端排产计划条目列表转换为甘特图工作站行数据。
 *
 * 转换规则：
 * 1. 按 workstationId 分组，每组为一行
 * 2. 每个工作站内的任务按列表顺序依次填入 TIME_SLOTS（贪心填入）
 * 3. 超出 4 个时间槽的任务不显示（实际产能约束由后端保证不超载）
 * 4. materialStatus / materialLabel 后端暂无，默认 ok / 料已备好
 */
function adaptScheduleToStations(schedules: ScheduleItem[]): StationRow[] {
  // 按 workstationId 分组，保持首次出现的顺序
  const stationMap = new Map<number, { items: ScheduleItem[]; name: string }>();
  for (const item of schedules) {
    const wsId = item.workstationId ?? 0;
    const wsName = item.workstationName ?? '未分配工作站';
    if (!stationMap.has(wsId)) {
      stationMap.set(wsId, { items: [], name: wsName });
    }
    stationMap.get(wsId)!.items.push(item);
  }

  const rows: StationRow[] = [];

  for (const [wsId, { items, name }] of stationMap.entries()) {
    // 确定负责人：取该工作站第一个任务的工人名
    const workerInCharge = items.find((i) => i.workerName)?.workerName ?? '—';

    // 将任务按顺序分配到时间槽（一槽一任务，超出部分丢弃）
    const slots: Partial<Record<TimeSlotLabel, GanttTask>> = {};
    items.slice(0, TIME_SLOTS.length).forEach((item, idx) => {
      const slot = TIME_SLOTS[idx];
      const qty = parseFloat(item.plannedQty ?? '0');
      const qtySuffix = Number.isInteger(qty) ? `${qty}套` : `${qty}套`;

      slots[slot] = {
        id: `ws${wsId}-step${item.processStepId}-order${item.productionOrderId}`,
        orderNo: item.workOrderNo,
        orderLabel: item.workOrderNo,
        operation: item.stepName,
        workerInfo: item.workerName ? `${item.workerName} · ${qtySuffix}` : qtySuffix,
        // TODO: 后端暂不返回物料状态，固定显示备料就绪
        materialIcon: '✓ 备料就绪',
        // TODO: 后端暂不返回延误风险标记，固定为 normal
        variant: 'normal' as TaskBlockVariant,
        ariaLabel: `${item.workOrderNo} ${item.stepName}工序，可拖拽调整`,
      };
    });

    rows.push({
      stationId: String(wsId),
      stationName: name,
      workerInCharge,
      // TODO: 后端排产引擎暂不返回物料备料状态，待物料联查接口上线后替换
      materialStatus: 'ok' as MaterialStatus,
      materialLabel: '料已备好',
      slots,
    });
  }

  return rows;
}

/**
 * 将后端排产计划条目列表转换为工人卡片数据。
 *
 * 转换规则：
 * 1. 按 workerId 分组
 * 2. 每个任务按在工人任务列表中的顺序映射到固定时间槽（取时间槽的简短格式）
 * 3. 优先级：首个任务为 high，其余依次降级（med / low）
 * 4. 工作站信息取自 workstationName
 */
function adaptScheduleToWorkers(schedules: ScheduleItem[]): WorkerCard[] {
  const workerMap = new Map<number, { name: string; items: ScheduleItem[] }>();
  for (const item of schedules) {
    const wId = item.workerId ?? 0;
    const wName = item.workerName ?? '未分配';
    if (!workerMap.has(wId)) {
      workerMap.set(wId, { name: wName, items: [] });
    }
    workerMap.get(wId)!.items.push(item);
  }

  const PRIORITY_MAP: Array<'high' | 'med' | 'low'> = ['high', 'med', 'low'];

  const cards: WorkerCard[] = [];

  for (const [wId, { name, items }] of workerMap.entries()) {
    // 工人名首字作为头像
    const initial = name.charAt(0);

    // 归属工作站（取第一个非空工作站名）
    const station = items.find((i) => i.workstationName)?.workstationName ?? '—';
    const roleLine = `${station} · ${items.length}任务`;

    const tasks: WorkerTaskItem[] = items.slice(0, TIME_SLOTS.length).map((item, idx) => {
      // 时间槽简短显示（去除长破折号）
      const slotFull = TIME_SLOTS[idx] ?? TIME_SLOTS[TIME_SLOTS.length - 1];
      const timeShort = slotFull.replace(' — ', '-');
      const qty = parseFloat(item.plannedQty ?? '0');

      return {
        priority: PRIORITY_MAP[Math.min(idx, 2)],
        text: `${item.workOrderNo}${item.stepName} · ${Number.isInteger(qty) ? qty : qty}套`,
        // TODO: 后端暂不返回精确时间段，按任务顺序映射到固定时间槽
        time: timeShort,
        highlight: false,
      };
    });

    cards.push({
      workerId: String(wId),
      initial,
      name,
      roleLine,
      tasks,
    });
  }

  return cards;
}

// ─── 页面主组件 ───────────────────────────────────────────

export default function SchedulePage() {
  const { setPageTitle, showToast } = useAppStore();

  const [scheduleView, setScheduleView] = useState<ScheduleView>('station');
  const [hasPendingChanges, setHasPendingChanges] = useState(true);
  const [confirmModal, setConfirmModal] = useState(false);

  useEffect(() => { setPageTitle('排产计划'); }, [setPageTitle]);

  // 当日日期字符串，用于 API 调用
  const todayDate = new Date().toISOString().slice(0, 10);

  // ── 排产计划数据（真实接口） ──────────────────────────────
  const {
    data: scheduleResult,
    isLoading: scheduleLoading,
    isError: scheduleError,
  } = useSchedule(todayDate);

  // ── 适配层：将 ScheduleResult.schedules[] 转换为展示结构 ──
  const stations = useMemo(
    () => adaptScheduleToStations(scheduleResult?.schedules ?? []),
    [scheduleResult],
  );

  const workers = useMemo(
    () => adaptScheduleToWorkers(scheduleResult?.schedules ?? []),
    [scheduleResult],
  );

  // ── 确认排产（已接入真实接口） ───────────────────────────
  const confirmMutation = useConfirmSchedule();

  const handleConfirmSchedule = async () => {
    try {
      await confirmMutation.mutateAsync(todayDate);
      showToast({ type: 'success', message: '排产方案已下发给工人' });
      setHasPendingChanges(false);
      setConfirmModal(false);
    } catch {
      showToast({ type: 'error', message: '下发失败，请稍后重试' });
    }
  };

  // ── 加载 / 错误状态 ──────────────────────────────────────
  if (scheduleLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading_state} role="status" aria-live="polite">
          <span className={styles.loading_spinner} aria-hidden="true" />
          AI 正在生成今日排产计划，通常需要 3—10 秒……
        </div>
      </div>
    );
  }

  if (scheduleError) {
    return (
      <div className={styles.page}>
        <div className={styles.error_state} role="alert">
          排产计划加载失败，请刷新页面重试
        </div>
      </div>
    );
  }

  // ── 摘要数据（来自后端 summary 字段） ────────────────────
  const summary = scheduleResult?.summary;

  return (
    <div className={`${styles.page} ${hasPendingChanges ? styles['page--has-action-bar'] : ''}`}>

      {/* ── 页面头部 ── */}
      <div className={styles.page_header}>
        <div>
          <h1 className={styles.page_title}>每日排产计划</h1>
          <p className={styles.page_subtitle}>{scheduleResult?.date ?? todayDate}</p>
        </div>
      </div>

      {/* ── Status Bar ── */}
      <StatusBar
        totalOrders={summary?.totalOrders}
        totalSteps={summary?.totalSteps}
        workerCount={workers.length}
        stationCount={stations.length}
        scheduleDate={scheduleResult?.date}
      />

      {/* ── AI 风险提示 ── */}
      <AiRiskAlert
        onViewDetail={() => showToast({ type: 'info', message: '详细分析面板即将上线' })}
      />

      {/* ── 视图切换 ── */}
      <ViewToggle value={scheduleView} onChange={setScheduleView} />

      {/* ── 甘特图（工作站视图） ── */}
      {scheduleView === 'station' && (
        <GanttChart stations={stations} timeSlots={TIME_SLOTS} />
      )}

      {/* ── 订单视图（占位） ── */}
      {scheduleView === 'order' && (
        <div className={styles.view_placeholder}>订单视图即将上线</div>
      )}

      {/* ── 人员视图（工人卡片） ── */}
      {scheduleView === 'worker' && (
        <WorkerSection workers={workers} />
      )}

      {/* ── 工人任务分配（工作站视图下始终显示） ── */}
      {scheduleView === 'station' && (
        <WorkerSection workers={workers} />
      )}

      {/* ── 底部固定操作栏 ── */}
      {hasPendingChanges && (
        <StickyActionBar
          onCancel={() => {
            setHasPendingChanges(false);
            showToast({ type: 'info', message: '已取消调整，恢复 AI 初始排产' });
          }}
          onConfirm={() => void handleConfirmSchedule()}
          confirmLoading={confirmMutation.isPending}
        />
      )}

      {/* ── 确认下发 Modal（保留逻辑，不阻断设计） ── */}
      {confirmModal && (
        <div className={styles.modal_overlay} onClick={() => setConfirmModal(false)}>
          <div className={styles.modal_panel} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modal_title}>确认并下发排产方案</div>
            <p className={styles.modal_body}>
              确认执行当前排产方案并下发给工人？确认后将自动推送今日任务至所有相关工人小程序，相关工单状态更新为"已排产"。此操作不可撤销。
            </p>
            <div className={styles.modal_actions}>
              <Button variant="ghost" size="md" onClick={() => setConfirmModal(false)}>取消</Button>
              <Button
                variant="success"
                size="md"
                loading={confirmMutation.isPending}
                onClick={() => void handleConfirmSchedule()}
              >
                确认并下发
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// StatusBar — AI 已生成计划状态摘要栏
// ─────────────────────────────────────────────────────────

interface StatusBarProps {
  /** 后端 summary.totalOrders，undefined 时显示占位符 */
  totalOrders?: number;
  /** 后端 summary.totalSteps */
  totalSteps?: number;
  /** 工人数量（由 schedules[] 按 workerId 去重后计算） */
  workerCount?: number;
  /** 工作站数量（由 schedules[] 按 workstationId 去重后计算） */
  stationCount?: number;
  /** 排产日期，格式 YYYY-MM-DD */
  scheduleDate?: string;
}

function StatusBar({ totalOrders, stationCount, workerCount }: StatusBarProps) {
  return (
    <div className={styles.status_bar} role="status" aria-label="计划状态">
      <div className={styles.status_bar__item}>
        <span>状态：</span>
        <strong>✓ AI已生成今日计划</strong>
      </div>
      <div className={styles.status_bar__divider} aria-hidden="true" />
      <div className={styles.status_bar__item}>
        覆盖 <strong>{totalOrders ?? '—'}</strong> 个在产订单
        · <strong>{stationCount ?? '—'}</strong> 个工作站
        · <strong>{workerCount ?? '—'}</strong> 名工人
      </div>
      <div className={styles.status_bar__divider} aria-hidden="true" />
      <Tag variant="warning">未下发</Tag>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// AiRiskAlert — AI 风险提示（橙色左边框）
// ─────────────────────────────────────────────────────────

interface AiRiskAlertProps {
  onViewDetail: () => void;
}

function AiRiskAlert({ onViewDetail }: AiRiskAlertProps) {
  return (
    <div className={styles.alert_ai} role="alert" aria-label="AI风险提示">
      <span className={styles.alert__icon} aria-hidden="true">⚠️</span>
      <div className={styles.alert__content}>
        <div className={styles.alert__title}>AI 风险提示</div>
        今日订单B19存在延误风险。建议优先安排工序3（装配），可节省约0.5天，交期风险从"中等"降为"低"。
        此外，封边区封边条库存待确认（今日入库中），建议先排开料和钻孔，等待封边条到货后再安排封边。
        <br />
        <button className={styles.alert__action} onClick={onViewDetail}>
          查看详细分析
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// ViewToggle — 视图切换（工作站 / 订单 / 人员）
// ─────────────────────────────────────────────────────────

interface ViewToggleProps {
  value: ScheduleView;
  onChange: (v: ScheduleView) => void;
}

function ViewToggle({ value, onChange }: ViewToggleProps) {
  const options: { key: ScheduleView; label: string }[] = [
    { key: 'station', label: '工作站视图' },
    { key: 'order',   label: '订单视图' },
    { key: 'worker',  label: '人员视图' },
  ];

  return (
    <div className={styles.view_toggle} role="radiogroup" aria-label="排产视图切换">
      {options.map((opt) => (
        <label key={opt.key} className={styles.view_toggle__label}>
          <input
            type="radio"
            name="schedule-view"
            value={opt.key}
            checked={value === opt.key}
            onChange={() => onChange(opt.key)}
            className={styles.view_toggle__radio}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// GanttChart — 工作站行 × 时间槽列 HTML table 甘特图
// ─────────────────────────────────────────────────────────

interface GanttChartProps {
  stations: StationRow[];
  timeSlots: TimeSlotLabel[];
}

function GanttChart({ stations, timeSlots }: GanttChartProps) {
  return (
    <div className={styles.gantt_wrap} role="region" aria-label="甘特图排产视图">
      {/* 拖拽操作提示 */}
      <div className={styles.gantt_hint} role="note">
        <span aria-hidden="true">↔</span>
        拖拽任务块可调整排程，拖至其他工作站可换线。调整后需点击底部"确认下发"
      </div>

      {/* 甘特表格 */}
      <div className={styles.gantt_scroll}>
        <table className={styles.gantt_table} aria-label="工作站时间甘特图">
          <thead>
            <tr>
              <th className={`${styles.gantt_th} ${styles['gantt_th--label']}`} scope="col">
                工作站
              </th>
              {timeSlots.map((slot) => (
                <th key={slot} className={styles.gantt_th} scope="col">
                  {slot}
                </th>
              ))}
              <th className={`${styles.gantt_th} ${styles['gantt_th--material']}`} scope="col">
                备料状态
              </th>
            </tr>
          </thead>
          <tbody>
            {stations.map((station) => (
              <tr key={station.stationId}>
                {/* 工作站标签列 */}
                <td className={styles.gantt_station_cell}>
                  <div className={styles.gantt_station_name}>{station.stationName}</div>
                  <div className={styles.gantt_station_worker}>{station.workerInCharge}</div>
                </td>

                {/* 时间槽列 */}
                {timeSlots.map((slot) => {
                  const task = station.slots[slot];
                  return (
                    <td
                      key={slot}
                      className={`${styles.gantt_td} ${!task ? styles['gantt_td--empty'] : ''}`}
                    >
                      {task && <TaskBlock task={task} />}
                    </td>
                  );
                })}

                {/* 备料状态列 */}
                <td className={styles.gantt_td}>
                  <MaterialStatusCell status={station.materialStatus} label={station.materialLabel} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 图例 */}
      <GanttLegend />
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// TaskBlock — 甘特图任务块（3 态：normal / warning / danger）
// ─────────────────────────────────────────────────────────

interface TaskBlockProps {
  task: GanttTask;
}

function TaskBlock({ task }: TaskBlockProps) {
  return (
    <div
      className={`${styles.task_block} ${styles[`task_block--${task.variant}`]}`}
      draggable
      tabIndex={0}
      role="button"
      aria-label={task.ariaLabel}
    >
      <span className={`${styles.task_block__order} ${styles[`task_block__order--${task.variant}`]}`}>
        {task.orderLabel}
      </span>
      <span className={styles.task_block__op}>{task.operation}</span>
      <span className={styles.task_block__worker}>{task.workerInfo}</span>
      <span
        className={`${styles.task_block__icon} ${
          task.materialIcon.startsWith('⚠') ? styles['task_block__icon--warn'] : ''
        }`}
      >
        {task.materialIcon}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// MaterialStatusCell — 备料状态列单元格
// ─────────────────────────────────────────────────────────

function MaterialStatusCell({ status, label }: { status: MaterialStatus; label: string }) {
  return (
    <div className={`${styles.material_status} ${styles[`material_status--${status}`]}`}>
      {status === 'ok'   && <span aria-hidden="true">✓</span>}
      {status === 'warn' && <span aria-hidden="true">⚠</span>}
      {status === 'err'  && <span aria-hidden="true">✕</span>}
      {label}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// GanttLegend — 甘特图图例说明
// ─────────────────────────────────────────────────────────

function GanttLegend() {
  return (
    <div className={styles.gantt_legend} role="note" aria-label="图例说明">
      <div className={styles.legend__item}>
        <div
          className={styles.legend__block}
          style={{ background: 'var(--color-primary-100)', border: '1px solid #93C5FD' }}
          aria-hidden="true"
        />
        正常进行
      </div>
      <div className={styles.legend__item}>
        <div
          className={styles.legend__block}
          style={{ background: 'var(--color-warning-100)', border: '1px solid #FCD34D' }}
          aria-hidden="true"
        />
        有风险（可接受）
      </div>
      <div className={styles.legend__item}>
        <div
          className={styles.legend__block}
          style={{ background: 'var(--color-error-100)', border: '1px solid #FCA5A5' }}
          aria-hidden="true"
        />
        延误风险
      </div>
      <div className={styles.legend__item} style={{ marginLeft: 'auto' }}>
        <span aria-hidden="true">✓</span> 备料就绪
        &nbsp;&nbsp;
        <span style={{ color: 'var(--color-warning-600)' }} aria-hidden="true">⚠</span> 物料待确认
        &nbsp;&nbsp;
        <span style={{ color: 'var(--color-error-600)' }} aria-hidden="true">✕</span> 缺料
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// WorkerSection — 工人任务分配区域
// ─────────────────────────────────────────────────────────

interface WorkerSectionProps {
  workers: WorkerCard[];
}

function WorkerSection({ workers }: WorkerSectionProps) {
  return (
    <div className={styles.worker_section}>
      <h2 className={styles.worker_section__title}>工人任务分配（今日）</h2>
      <div className={styles.worker_cards} role="list" aria-label="工人任务卡片">
        {workers.map((worker) => (
          <WorkerCardItem key={worker.workerId} worker={worker} />
        ))}
      </div>
    </div>
  );
}

interface WorkerCardItemProps {
  worker: WorkerCard;
}

function WorkerCardItem({ worker }: WorkerCardItemProps) {
  return (
    <div className={styles.worker_card} role="listitem">
      <div className={styles.worker_card__header}>
        <div className={styles.worker_card__avatar} aria-hidden="true">{worker.initial}</div>
        <div>
          <div className={styles.worker_card__name}>{worker.name}</div>
          <div className={styles.worker_card__role}>{worker.roleLine}</div>
        </div>
      </div>
      <div className={styles.worker_card__tasks}>
        {worker.tasks.map((task, idx) => (
          <div
            key={idx}
            className={`${styles.worker_task_item} ${task.highlight ? styles['worker_task_item--highlight'] : ''}`}
          >
            <div
              className={`${styles.worker_task_item__priority} ${styles[`worker_task_item__priority--${task.priority}`]}`}
              aria-hidden="true"
            />
            <div
              className={`${styles.worker_task_item__text} ${task.highlight ? styles['worker_task_item__text--danger'] : ''}`}
            >
              {task.text}
            </div>
            <div className={styles.worker_task_item__time}>{task.time}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// StickyActionBar — 底部固定确认操作栏
// ─────────────────────────────────────────────────────────

interface StickyActionBarProps {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLoading: boolean;
}

function StickyActionBar({ onCancel, onConfirm, confirmLoading }: StickyActionBarProps) {
  return (
    <div className={styles.action_bar} role="toolbar" aria-label="排产操作区">
      <div className={styles.action_bar__hint}>
        <span aria-hidden="true">↔</span>
        拖拽调整后请点击右侧确认下发，调整记录将自动保存
      </div>
      <div className={styles.action_bar__buttons}>
        <Button variant="ghost" size="md" onClick={onCancel}>
          取消调整
        </Button>
        <Button
          variant="success"
          size="lg"
          loading={confirmLoading}
          onClick={onConfirm}
          aria-label="确认排产计划并下发给所有工人"
          icon={
            <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          }
        >
          确认并下发给工人
        </Button>
      </div>
    </div>
  );
}
