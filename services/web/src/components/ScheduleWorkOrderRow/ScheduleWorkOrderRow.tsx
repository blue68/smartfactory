/**
 * [artifact:前端代码] — ScheduleWorkOrderRow
 * Sprint 4 / FE-S4-07
 *
 * 排产建议工单行组件。
 *
 * 折叠态：工单号、产品名、总分、排名徽章
 * 展开态：三维得分条形图（交期/优先级/物料就绪度）+ 工人推荐卡片
 * 手风琴：由父组件控制 expanded / onToggle，同时只展开一条。
 */

import styles from './ScheduleWorkOrderRow.module.css';
import type { WorkOrderSuggestionItem } from '@/api/scheduleSuggestion';

// ─── 得分条形图 ────────────────────────────────
interface ScoreBarProps {
  label: string;
  score: number;
  maxScore?: number;
  colorClass?: string;
}

function ScoreBar({ label, score, maxScore = 100, colorClass }: ScoreBarProps) {
  const pct = Math.min(100, Math.round((score / maxScore) * 100));
  return (
    <div className={styles.score_bar_row}>
      <span className={styles.score_bar__label}>{label}</span>
      <div className={styles.score_bar__track} role="meter" aria-valuenow={score} aria-valuemin={0} aria-valuemax={maxScore} aria-label={`${label}：${score}分`}>
        <div
          className={`${styles.score_bar__fill} ${colorClass ?? ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={styles.score_bar__value}>{score}</span>
    </div>
  );
}

// ─── 工人推荐卡片 ──────────────────────────────
interface WorkerCardProps {
  workerName: string | null;
  skill: string | null;
}

function WorkerCard({ workerName, skill }: WorkerCardProps) {
  if (!workerName) {
    return (
      <div className={styles.worker_card__empty}>
        <span aria-hidden="true">👤</span> 暂无推荐工人
      </div>
    );
  }
  return (
    <div className={styles.worker_card}>
      <div className={styles.worker_card__avatar} aria-hidden="true">
        {workerName.charAt(0)}
      </div>
      <div className={styles.worker_card__info}>
        <span className={styles.worker_card__name}>{workerName}</span>
        {skill && <span className={styles.worker_card__skill}>{skill}</span>}
      </div>
      <span className={styles.worker_card__badge}>推荐</span>
    </div>
  );
}

// ─── 排名徽章 ──────────────────────────────────
function RankBadge({ rank }: { rank: number }) {
  const cls =
    rank === 1
      ? styles['rank_badge--gold']
      : rank === 2
        ? styles['rank_badge--silver']
        : rank === 3
          ? styles['rank_badge--bronze']
          : '';
  return (
    <span className={`${styles.rank_badge} ${cls}`} aria-label={`排名第${rank}`}>
      #{rank}
    </span>
  );
}

// ─── 主组件 Props ──────────────────────────────
export interface ScheduleWorkOrderRowProps {
  item: WorkOrderSuggestionItem;
  expanded: boolean;
  onToggle: () => void;
}

export default function ScheduleWorkOrderRow({
  item,
  expanded,
  onToggle,
}: ScheduleWorkOrderRowProps) {
  return (
    <article
      className={`${styles.row} ${expanded ? styles['row--expanded'] : ''}`}
      aria-label={`工单 ${item.workOrderNo}`}
    >
      {/* ── 折叠态头部（始终可见） ── */}
      <button
        type="button"
        className={styles.row__header}
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`work-order-body-${item.id}`}
      >
        {/* 左：排名徽章 */}
        <RankBadge rank={item.rank} />

        {/* 中：工单信息 */}
        <div className={styles.row__info}>
          <span className={styles.row__order_no}>{item.workOrderNo}</span>
          <span className={styles.row__sku_name}>{item.skuName}</span>
        </div>

        {/* 右：总分 + 展开箭头 */}
        <div className={styles.row__right}>
          <span className={styles.row__total_score} aria-label={`综合得分：${item.totalScore}`}>
            <span className={styles.row__total_score_value}>{item.totalScore}</span>
            <span className={styles.row__total_score_label}>分</span>
          </span>
          <span
            className={`${styles.row__chevron} ${expanded ? styles['row__chevron--up'] : ''}`}
            aria-hidden="true"
          >
            ▾
          </span>
        </div>
      </button>

      {/* ── 展开态详情 ── */}
      {expanded && (
        <div
          id={`work-order-body-${item.id}`}
          className={styles.row__body}
        >
          {/* 三维得分条形图 */}
          <section className={styles.scores_section} aria-label="三维得分">
            <h4 className={styles.scores_section__title}>综合评分维度</h4>
            <div className={styles.scores_list}>
              <ScoreBar
                label="交期紧迫度"
                score={item.deadlineScore}
                colorClass={styles['score_bar__fill--deadline']}
              />
              <ScoreBar
                label="订单优先级"
                score={item.priorityScore}
                colorClass={styles['score_bar__fill--priority']}
              />
              <ScoreBar
                label="物料就绪度"
                score={item.materialReadinessScore}
                colorClass={styles['score_bar__fill--material']}
              />
            </div>
          </section>

          {/* 推荐工人 */}
          <section className={styles.worker_section} aria-label="推荐工人">
            <h4 className={styles.worker_section__title}>推荐工人</h4>
            <WorkerCard
              workerName={item.recommendedWorkerName}
              skill={item.recommendedWorkerSkill}
            />
          </section>
        </div>
      )}
    </article>
  );
}
