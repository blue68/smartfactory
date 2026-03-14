/**
 * [artifact:前端代码] — StepCalculationCard
 * Sprint 4 / FE-S4-03
 *
 * 多步骤 AI 计算过程展示卡片。
 * - 每步独立卡片，支持展开/收起（默认第1步和第4步展开）
 * - loading 时显示骨架屏
 * - 数字值点击可弹出 Popover 展示数据来源
 */

import { useState, useRef, useCallback } from 'react';
import styles from './StepCalculationCard.module.css';
import PulseWaveIndicator from '@/components/PulseWaveIndicator/PulseWaveIndicator';

// ─── 类型定义 ────────────────────────────────
export interface CalcStep {
  stepNo: number;
  title: string;
  description: string;
  inputs: Array<{ label: string; value: string | number; unit?: string }>;
  formula?: string;
  result: { label: string; value: string | number; unit?: string };
}

export interface StepCalculationCardProps {
  steps: CalcStep[];
  loading?: boolean;
}

// ─── 数字 Popover（来源说明气泡） ───────────
interface ValueWithPopoverProps {
  value: string | number;
  unit?: string;
  source?: string;
}

function ValueWithPopover({ value, unit, source }: ValueWithPopoverProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(false), 120);
  }, []);

  return (
    <span className={styles.value_popover_wrapper}>
      <button
        type="button"
        className={styles.value_popover_trigger}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-describedby={visible ? 'calc-popover' : undefined}
      >
        <span className={styles.value_number}>{value}</span>
        {unit && <span className={styles.value_unit}>{unit}</span>}
      </button>

      {visible && source && (
        <span
          id="calc-popover"
          role="tooltip"
          className={styles.value_popover}
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          <span className={styles.value_popover__label}>数据来源</span>
          <span className={styles.value_popover__content}>{source}</span>
        </span>
      )}
    </span>
  );
}

// ─── 骨架屏 ──────────────────────────────────
function StepSkeleton() {
  return (
    <div className={styles.skeleton_wrapper} aria-hidden="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className={styles.skeleton_card}>
          {/* 步骤头部 */}
          <div className={styles.skeleton_header}>
            <span className={styles.skeleton_badge} />
            <span className={styles.skeleton_title} />
            <span className={styles.skeleton_chevron} />
          </div>
          {/* 展开内容（仅第1个显示） */}
          {i === 0 && (
            <div className={styles.skeleton_body}>
              <span className={styles.skeleton_line} style={{ width: '80%' }} />
              <span className={styles.skeleton_line} style={{ width: '60%' }} />
              <span className={styles.skeleton_line} style={{ width: '70%' }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── 单步骤卡片 ──────────────────────────────
interface StepCardProps {
  step: CalcStep;
  expanded: boolean;
  onToggle: () => void;
}

function StepCard({ step, expanded, onToggle }: StepCardProps) {
  return (
    <article
      className={`${styles.step_card} ${expanded ? styles['step_card--expanded'] : ''}`}
    >
      {/* 卡片头部（点击展开/收起） */}
      <button
        type="button"
        className={styles.step_card__header}
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`step-body-${step.stepNo}`}
      >
        {/* 步骤序号徽标 */}
        <span className={styles.step_card__badge} aria-hidden="true">
          {step.stepNo}
        </span>

        {/* 标题区 */}
        <span className={styles.step_card__title_group}>
          <span className={styles.step_card__title}>{step.title}</span>
          {!expanded && (
            <span className={styles.step_card__result_preview}>
              {step.result.label}：
              <span className={styles.step_card__result_preview_value}>
                {step.result.value}
                {step.result.unit && ` ${step.result.unit}`}
              </span>
            </span>
          )}
        </span>

        {/* 展开箭头 */}
        <span
          className={`${styles.step_card__chevron} ${expanded ? styles['step_card__chevron--up'] : ''}`}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>

      {/* 卡片主体（展开时显示） */}
      {expanded && (
        <div
          id={`step-body-${step.stepNo}`}
          className={styles.step_card__body}
        >
          {/* 描述 */}
          <p className={styles.step_card__description}>{step.description}</p>

          {/* 输入参数列表 */}
          <div className={styles.step_card__inputs}>
            <span className={styles.step_card__section_label}>输入参数</span>
            <ul className={styles.step_card__input_list} role="list">
              {step.inputs.map((inp, idx) => (
                <li key={idx} className={styles.step_card__input_item}>
                  <span className={styles.step_card__input_label}>{inp.label}</span>
                  <ValueWithPopover
                    value={inp.value}
                    unit={inp.unit}
                    source={`${inp.label} 取自系统主数据，实时拉取`}
                  />
                </li>
              ))}
            </ul>
          </div>

          {/* 公式（可选） */}
          {step.formula && (
            <div className={styles.step_card__formula_wrapper}>
              <span className={styles.step_card__section_label}>计算公式</span>
              <code className={styles.step_card__formula}>{step.formula}</code>
            </div>
          )}

          {/* 结果 */}
          <div className={styles.step_card__result}>
            <span className={styles.step_card__result_label}>{step.result.label}</span>
            <ValueWithPopover
              value={step.result.value}
              unit={step.result.unit}
              source={`由第 ${step.stepNo} 步公式计算得出`}
            />
          </div>
        </div>
      )}
    </article>
  );
}

// ─── 主组件 ──────────────────────────────────
export default function StepCalculationCard({
  steps,
  loading = false,
}: StepCalculationCardProps) {
  // 默认展开第1步和第4步（按 stepNo）
  const defaultExpanded = new Set(
    steps.filter((s) => s.stepNo === 1 || s.stepNo === 4).map((s) => s.stepNo),
  );
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(defaultExpanded);

  const toggle = useCallback((stepNo: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepNo)) {
        next.delete(stepNo);
      } else {
        next.add(stepNo);
      }
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div role="status" aria-label="计算步骤加载中" aria-busy="true">
        <StepSkeleton />
        <span className="sr-only">计算步骤加载中</span>
      </div>
    );
  }

  return (
    <section className={styles.step_calc_card} aria-label="AI 计算步骤">
      {/* 顶部标识栏 */}
      <div className={styles.step_calc_card__header}>
        <PulseWaveIndicator size="sm" />
        <span className={styles.step_calc_card__header_text}>AI 调度计算过程</span>
        <span className={styles.step_calc_card__steps_count}>
          共 {steps.length} 步
        </span>
      </div>

      {/* 步骤列表 */}
      <div className={styles.step_calc_card__list}>
        {steps.map((step) => (
          <StepCard
            key={step.stepNo}
            step={step}
            expanded={expandedSteps.has(step.stepNo)}
            onToggle={() => toggle(step.stepNo)}
          />
        ))}
      </div>
    </section>
  );
}
