import { useEffect } from 'react';
import Button from '@/components/common/Button';
import ConfidenceTag from '@/components/common/ConfidenceTag';
import EmptyState from '@/components/common/EmptyState';
import KpiCard from '@/components/common/KpiCard';
import Skeleton from '@/components/common/Skeleton';
import StatusDot from '@/components/common/StatusDot';
import SummaryStrip from '@/components/common/SummaryStrip';
import Tag from '@/components/common/Tag';
import { useAppStore } from '@/stores/appStore';
import { Confidence } from '@/types/enums';
import styles from './DesignSystemPage.module.css';

const COLOR_SWATCHES = [
  { label: '品牌蓝', token: '--color-primary-500', usage: '主要按钮、关键链接、导航激活' },
  { label: '科技青', token: '--color-info-500', usage: '信息态、图表辅助、数据提示' },
  { label: '成功绿', token: '--color-success-500', usage: '完成、通过、库存健康' },
  { label: '预警橙', token: '--color-warning-500', usage: '待处理、交期风险、注意提示' },
  { label: '风险红', token: '--color-error-500', usage: '错误、异常、阻断问题' },
  { label: '墨蓝灰', token: '--color-slate-900', usage: '标题、关键数字、主信息层级' },
];

const PRINCIPLES = [
  {
    title: '轻科技商务风',
    description: '保留制造业系统的专业感，用干净底色、克制高光和明确状态色构建轻科技氛围。',
  },
  {
    title: '一眼读懂层级',
    description: '页头、筛选条、主工作区、详情面板和表格区采用固定层次，降低学习成本。',
  },
  {
    title: '组件先于页面',
    description: '按钮、标签、状态点、卡片、骨架屏先统一，再让页面自然保持一致，不依赖逐页救火。',
  },
];

const TABLE_COLUMNS = ['组件', '用途', '规格', '建议', '状态'];

const TABLE_ROWS = [
  ['Hero Header', '首页/驾驶舱/大工作台页头', '标题 + 辅助说明 + 操作按钮', '用于一级业务入口', '已统一'],
  ['Filter Bar', '列表页筛选区', '包裹式输入框 + 胶囊下拉', '保持一行优先', '已统一'],
  ['KPI Card', '统计概览', '左侧色条 + 指标 + 趋势/进度', '最多 4~6 张并列', '已统一'],
  ['Panel', '主工作区容器', '大圆角 + 轻描边 + 柔和阴影', '承载表格、明细、图表', '已统一'],
];

export default function DesignSystemPage() {
  const setPageTitle = useAppStore((s) => s.setPageTitle);

  useEffect(() => {
    setPageTitle('设计系统');
  }, [setPageTitle]);

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>COMMERCIAL DESIGN SYSTEM</span>
          <h1 className={styles.title}>项目设计系统</h1>
          <p className={styles.subtitle}>
            当前系统的视觉基线、组件语言和页面结构规范都集中在这里。
            后续新增模块应优先复用现有 token 与组件，而不是继续分散定义局部样式。
          </p>
          <div className={styles.heroActions}>
            <Button variant="primary" size="lg">主按钮</Button>
            <Button variant="secondary" size="lg">次按钮</Button>
            <Button variant="ghost" size="lg">幽灵按钮</Button>
          </div>
        </div>
        <div className={styles.heroAside}>
          <div className={styles.heroAsideCard}>
            <span className={styles.heroAsideLabel}>统一方向</span>
            <strong className={styles.heroAsideValue}>轻科技 · 商务 · 制造</strong>
            <p className={styles.heroAsideDesc}>风格要求克制、专业、可长期维护，避免页面之间像不同产品拼接。</p>
          </div>
          <SummaryStrip
            items={[
              { label: '共享 Token', value: '60+', highlight: true },
              { label: '通用组件', value: '12' },
              { label: '已收口页面', value: '30+' },
            ]}
          />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.sectionEyebrow}>Design Principles</span>
            <h2 className={styles.sectionTitle}>统一设计原则</h2>
          </div>
        </div>
        <div className={styles.principleGrid}>
          {PRINCIPLES.map((item, index) => (
            <article key={item.title} className={styles.principleCard}>
              <span className={styles.principleIndex}>0{index + 1}</span>
              <h3 className={styles.principleTitle}>{item.title}</h3>
              <p className={styles.principleDesc}>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.sectionEyebrow}>Palette</span>
            <h2 className={styles.sectionTitle}>品牌色板与状态色</h2>
          </div>
        </div>
        <div className={styles.swatchGrid}>
          {COLOR_SWATCHES.map((swatch) => (
            <article key={swatch.token} className={styles.swatchCard}>
              <span
                className={styles.swatchPreview}
                style={{ background: `var(${swatch.token})` }}
                aria-hidden="true"
              />
              <div className={styles.swatchMeta}>
                <strong>{swatch.label}</strong>
                <span>{swatch.token}</span>
                <p>{swatch.usage}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.sectionEyebrow}>Components</span>
            <h2 className={styles.sectionTitle}>核心组件示例</h2>
          </div>
        </div>
        <div className={styles.componentGrid}>
          <article className={styles.showcaseCard}>
            <h3 className={styles.showcaseTitle}>按钮体系</h3>
            <div className={styles.buttonMatrix}>
              <Button variant="primary">保存变更</Button>
              <Button variant="secondary">查看详情</Button>
              <Button variant="success">审批通过</Button>
              <Button variant="warning">待确认</Button>
              <Button variant="danger">删除</Button>
              <Button variant="ai">AI 分析</Button>
            </div>
          </article>

          <article className={styles.showcaseCard}>
            <h3 className={styles.showcaseTitle}>标签与状态</h3>
            <div className={styles.inlineGroup}>
              <Tag variant="success">已完成</Tag>
              <Tag variant="warning">待审批</Tag>
              <Tag variant="error">缺料</Tag>
              <Tag variant="info">进行中</Tag>
              <Tag variant="priority-urgent">紧急</Tag>
            </div>
            <div className={styles.inlineGroup}>
              <StatusDot status="success" label="生产稳定" />
              <StatusDot status="warning" label="交期风险" />
              <StatusDot status="danger" label="库存异常" />
            </div>
            <div className={styles.inlineGroup}>
              <ConfidenceTag confidence={Confidence.HIGH} />
              <ConfidenceTag confidence={Confidence.MEDIUM} />
              <ConfidenceTag confidence={Confidence.LOW} />
            </div>
          </article>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.sectionEyebrow}>Data Presentation</span>
            <h2 className={styles.sectionTitle}>指标卡与业务面板</h2>
          </div>
        </div>
        <div className={styles.kpiGrid}>
          <KpiCard title="订单履约率" value="96.4" unit="%" color="var(--color-primary-500)" trend={{ value: '+2.4%', direction: 'up' }} icon="📈" />
          <KpiCard title="当日排产工序" value="128" color="var(--color-info-500)" progress={78} icon="🏭" />
          <KpiCard title="库存健康度" value="89" unit="分" color="var(--color-success-500)" trend={{ value: '-1.2%', direction: 'down' }} icon="📦" />
        </div>
        <div className={styles.panelGrid}>
          <article className={styles.panel}>
            <div className={styles.panelTop}>
              <div>
                <span className={styles.panelEyebrow}>Workbench Layout</span>
                <h3 className={styles.panelTitle}>标准工作区结构</h3>
              </div>
              <Tag variant="info">推荐模板</Tag>
            </div>
            <div className={styles.filterBar}>
              <div className={styles.filterInput}>搜索订单号 / SKU / 客户</div>
              <div className={styles.filterChip}>全部状态</div>
              <div className={styles.filterChip}>本周</div>
            </div>
            <div className={styles.mockTable}>
              <div className={styles.mockTableHead}>
                {TABLE_COLUMNS.map((column) => (
                  <span key={column}>{column}</span>
                ))}
              </div>
              {TABLE_ROWS.map((row) => (
                <div key={row[0]} className={styles.mockTableRow}>
                  {row.map((cell) => (
                    <span key={cell}>{cell}</span>
                  ))}
                </div>
              ))}
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelTop}>
              <div>
                <span className={styles.panelEyebrow}>Feedback States</span>
                <h3 className={styles.panelTitle}>空态与加载态</h3>
              </div>
              <Tag variant="neutral">全局复用</Tag>
            </div>
            <div className={styles.feedbackStack}>
              <EmptyState
                icon="🛰️"
                title="暂无数据"
                description="当筛选条件没有命中结果时，优先使用这一类空态，而不是留白。"
                action={{ label: '重置筛选', onClick: () => undefined, variant: 'secondary' }}
              />
              <div className={styles.skeletonWrap}>
                <Skeleton variant="table" lines={4} ariaLabel="表格骨架示例" />
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
