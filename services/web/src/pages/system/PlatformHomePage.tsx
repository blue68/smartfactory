import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccessAuditLogs, useTenantList } from '@/api/accessControl';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import styles from './PlatformHomePage.module.css';

function formatTime(value?: string) {
  if (!value) return '-';
  return String(value).slice(0, 16).replace('T', ' ');
}

function renderStatusLabel(status?: string) {
  if (status === 'active') return '启用';
  if (status === 'suspended') return '暂停';
  if (status === 'cancelled') return '已注销';
  return status || '-';
}

export default function PlatformHomePage() {
  const navigate = useNavigate();
  const setPageTitle = useAppStore((s) => s.setPageTitle);
  const user = useAuthStore((s) => s.user);
  const { data: tenantData, isLoading: tenantLoading } = useTenantList({ page: 1, pageSize: 100 });
  const { data: auditData, isLoading: auditLoading } = useAccessAuditLogs({ page: 1, pageSize: 8 });

  useEffect(() => {
    setPageTitle('平台工作台');
  }, [setPageTitle]);

  const tenantSummary = useMemo(() => {
    const tenants = tenantData?.list ?? [];
    return {
      total: tenantData?.total ?? tenants.length,
      active: tenants.filter((item) => item.status === 'active').length,
      suspended: tenants.filter((item) => item.status === 'suspended').length,
      cancelled: tenants.filter((item) => item.status === 'cancelled').length,
      recent: tenants.slice(0, 6),
    };
  }, [tenantData]);

  const recentAudits = auditData?.list ?? [];

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCard}>
          <div className={styles.eyebrow}>平台态登录中</div>
          <h1 className={styles.title}>平台工作台</h1>
          <p className={styles.subtitle}>
            这里是平台超级管理员的独立首页，用于处理跨租户治理动作。
            平台态下不再落到业务 Dashboard，也不展示 AI 助手入口，避免和租户经营视角混在一起。
          </p>
          <div className={styles.heroActions}>
            <button
              type="button"
              className={styles.primaryAction}
              onClick={() => navigate('/system/tenants')}
            >
              进入租户治理
            </button>
            <button
              type="button"
              className={styles.secondaryAction}
              onClick={() => navigate('/system/audit-logs')}
            >
              查看权限审计
            </button>
          </div>
        </div>

        <aside className={`${styles.heroCard} ${styles.summaryCard}`}>
          <h2 className={styles.summaryTitle}>当前上下文</h2>
          <div className={styles.summaryList}>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>登录账号</span>
              <span className={styles.summaryValue}>{user?.username ?? '-'}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>当前范围</span>
              <span className={styles.summaryValue}>平台态</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>原始租户</span>
              <span className={styles.summaryValue}>{String(user?.originTenantId ?? '-')}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>代管租户上下文</span>
              <span className={styles.summaryValue}>
                {user?.contextTenantId == null ? '未进入租户' : String(user.contextTenantId)}
              </span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>治理租户总数</span>
              <span className={styles.summaryValue}>{tenantLoading ? '加载中' : tenantSummary.total}</span>
            </div>
          </div>
        </aside>
      </section>

      <section className={styles.kpiGrid}>
        <article className={styles.kpiCard}>
          <span className={styles.kpiLabel}>启用租户</span>
          <strong className={styles.kpiValue}>{tenantLoading ? '-' : tenantSummary.active}</strong>
          <span className={styles.kpiHint}>当前可直接进入并治理的租户数量</span>
        </article>
        <article className={styles.kpiCard}>
          <span className={styles.kpiLabel}>暂停租户</span>
          <strong className={styles.kpiValue}>{tenantLoading ? '-' : tenantSummary.suspended}</strong>
          <span className={styles.kpiHint}>建议优先检查权限误配置和续费状态</span>
        </article>
        <article className={styles.kpiCard}>
          <span className={styles.kpiLabel}>已注销租户</span>
          <strong className={styles.kpiValue}>{tenantLoading ? '-' : tenantSummary.cancelled}</strong>
          <span className={styles.kpiHint}>确认是否仍存在残留授权与审计数据</span>
        </article>
        <article className={styles.kpiCard}>
          <span className={styles.kpiLabel}>最近审计记录</span>
          <strong className={styles.kpiValue}>{auditLoading ? '-' : auditData?.total ?? 0}</strong>
          <span className={styles.kpiHint}>平台侧最近一次治理动作的审计总量</span>
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <h2 className={styles.panelTitle}>平台治理动作</h2>
          <p className={styles.panelDesc}>
            平台态建议先从租户配置进入目标租户，再处理该租户下的角色、人员与功能开关治理。
          </p>
          <div className={styles.actionList}>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => navigate('/system/tenants')}
            >
              <span className={styles.actionButtonTitle}>租户配置</span>
              <span className={styles.actionButtonDesc}>查看租户状态、功能开关并进入指定租户。</span>
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => navigate('/system/audit-logs')}
            >
              <span className={styles.actionButtonTitle}>权限审计</span>
              <span className={styles.actionButtonDesc}>检查跨租户治理操作和平台态切换痕迹。</span>
            </button>
          </div>
        </article>

        <article className={styles.panel}>
          <h2 className={styles.panelTitle}>使用约束</h2>
          <p className={styles.panelDesc}>
            平台管理员只负责平台治理入口，不直接承载租户业务驾驶舱与 AI 助手交互。
          </p>
          <ul className={styles.tips}>
            <li>进入租户后再处理角色、菜单、人员和授权明细。</li>
            <li>完成代管操作后从右上角返回平台态，避免上下文混淆。</li>
            <li>平台态首页只保留治理入口，不承接租户经营指标。</li>
          </ul>
        </article>

        <article className={styles.panel}>
          <h2 className={styles.panelTitle}>建议验收路径</h2>
          <p className={styles.panelDesc}>
            可按下面顺序验收本次版本线，确认“平台超级管理员”与“普通系统管理员”权限边界已经分离。
          </p>
          <ul className={styles.tips}>
            <li>平台登录后默认落到本页，而不是业务 Dashboard。</li>
            <li>顶部搜索、AI 助手按钮、右下角悬浮 AI 按钮均不显示。</li>
            <li>从租户配置进入任一租户，再从右上角返回平台态。</li>
          </ul>
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2 className={styles.panelTitle}>最近租户</h2>
              <p className={styles.panelDesc}>优先展示最近同步到平台首页的租户，便于快速进入治理。</p>
            </div>
          </div>
          <div className={styles.entityList}>
            {tenantLoading && <div className={styles.empty}>租户数据加载中...</div>}
            {!tenantLoading && tenantSummary.recent.length === 0 && <div className={styles.empty}>暂无租户数据。</div>}
            {!tenantLoading && tenantSummary.recent.map((tenant) => (
              <button
                key={tenant.id}
                type="button"
                className={styles.entityCard}
                onClick={() => navigate('/system/tenants')}
              >
                <div className={styles.entityMain}>
                  <span className={styles.entityTitle}>{tenant.name}</span>
                  <span className={styles.entityMeta}>{tenant.code}</span>
                </div>
                <span className={`${styles.statusPill} ${styles[`statusPill--${tenant.status}`] ?? ''}`}>
                  {renderStatusLabel(tenant.status)}
                </span>
              </button>
            ))}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2 className={styles.panelTitle}>最近审计</h2>
              <p className={styles.panelDesc}>平台态下最近发生的权限与租户治理动作。</p>
            </div>
          </div>
          <div className={styles.auditList}>
            {auditLoading && <div className={styles.empty}>审计记录加载中...</div>}
            {!auditLoading && recentAudits.length === 0 && <div className={styles.empty}>暂无审计记录。</div>}
            {!auditLoading && recentAudits.map((item) => (
              <div key={item.id} className={styles.auditItem}>
                <div className={styles.auditTop}>
                  <span className={styles.auditModule}>{item.module}</span>
                  <span className={styles.auditTime}>{formatTime(item.createdAt)}</span>
                </div>
                <div className={styles.auditAction}>{item.action}</div>
                <div className={styles.auditMeta}>
                  {item.targetType} / {item.targetCode ?? item.targetId ?? '-'} / {item.operatorName ?? item.operatorId ?? '-'}
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2 className={styles.panelTitle}>平台守则</h2>
              <p className={styles.panelDesc}>把平台态约束直接放在首页，降低误操作概率。</p>
            </div>
          </div>
          <ul className={styles.ruleList}>
            <li>平台态只承担跨租户治理，不承担租户经营看板。</li>
            <li>普通系统管理员仍应被限制在当前租户内，不能天然跨租户。</li>
            <li>所有跨租户切换动作都应留痕到权限审计。</li>
            <li>处理完代管事项后，优先从右上角返回平台态再继续下一租户。</li>
          </ul>
        </article>
      </section>
    </div>
  );
}
