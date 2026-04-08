import { useEffect, useMemo, useState } from 'react';
import Button from '@/components/common/Button';
import { useAccessAuditLogs, useTenantList } from '@/api/accessControl';
import { useAppStore } from '@/stores/appStore';
import styles from './SystemPageShell.module.css';

function safeJson(value: unknown) {
  if (value == null) return '-';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function SystemAuditPage() {
  const setPageTitle = useAppStore((s) => s.setPageTitle);
  const [tenantId, setTenantId] = useState<number | undefined>(undefined);
  const [keyword, setKeyword] = useState('');
  const [module, setModule] = useState('');
  const [targetType, setTargetType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    setPageTitle('系统管理 · 权限审计');
  }, [setPageTitle]);

  const { data: tenantData } = useTenantList({ page: 1, pageSize: 100 });
  const query = useMemo(() => ({
    page: 1,
    pageSize: 50,
    tenantId,
    keyword: keyword.trim() || undefined,
    module: module || undefined,
    targetType: targetType || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  }), [tenantId, keyword, module, targetType, dateFrom, dateTo]);
  const { data, isLoading, error } = useAccessAuditLogs(query);

  const resetFilters = () => {
    setTenantId(undefined);
    setKeyword('');
    setModule('');
    setTargetType('');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>权限审计</h1>
          <p className={styles.subtitle}>查看租户、角色、人员、授权与功能开关的关键变更记录，支持按对象和时间筛选。</p>
        </div>
      </div>

      <div className={styles.stats}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>当前记录数</div>
          <div className={styles.statValue}>{data?.total ?? 0}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>租户数</div>
          <div className={styles.statValue}>{tenantData?.total ?? 0}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>模块筛选</div>
          <div className={styles.statValue}>{module || '全部'}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>接口状态</div>
          <div className={styles.statValue}>{error ? '异常' : isLoading ? '加载中' : '正常'}</div>
        </div>
      </div>

      <div className={styles.filterBar}>
        <select className={styles.select} value={tenantId ?? ''} onChange={(event) => setTenantId(event.target.value ? Number(event.target.value) : undefined)}>
          <option value="">全部租户</option>
          {(tenantData?.list ?? []).map((tenant) => (
            <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
          ))}
        </select>
        <input className={styles.input} placeholder="搜索对象编码/操作人" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
        <select className={styles.select} value={module} onChange={(event) => setModule(event.target.value)}>
          <option value="">全部模块</option>
          <option value="tenant">租户</option>
          <option value="tenant_feature">租户功能开关</option>
          <option value="role">角色</option>
          <option value="role_permission">角色授权</option>
          <option value="user">人员</option>
          <option value="user_role_assignment">人员角色分配</option>
        </select>
        <select className={styles.select} value={targetType} onChange={(event) => setTargetType(event.target.value)}>
          <option value="">全部对象</option>
          <option value="tenant">租户</option>
          <option value="role">角色</option>
          <option value="user">人员</option>
        </select>
        <input className={styles.input} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        <input className={styles.input} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        <Button variant="ghost" onClick={resetFilters}>重置筛选</Button>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>审计记录</h2>
          <span className={styles.tag}>{data?.list.length ?? 0}</span>
        </div>
        <div className={styles.cardBody}>
          {error && <div className={styles.hint}>审计记录加载失败：{(error as Error).message}</div>}
          {!error && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>模块</th>
                    <th>动作</th>
                    <th>对象</th>
                    <th>操作人</th>
                    <th>差异</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td colSpan={6} className={styles.muted}>加载中...</td>
                    </tr>
                  )}
                  {!isLoading && (data?.list.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={6} className={styles.muted}>暂无审计记录。</td>
                    </tr>
                  )}
                  {!isLoading && (data?.list ?? []).map((item) => (
                    <tr key={item.id}>
                      <td>{item.createdAt ? String(item.createdAt).slice(0, 19).replace('T', ' ') : '-'}</td>
                      <td>{item.module}</td>
                      <td>{item.action}</td>
                      <td>{item.targetType} / {item.targetCode ?? item.targetId ?? '-'}</td>
                      <td>{item.operatorName ?? item.operatorId ?? '-'}</td>
                      <td>
                        <pre className={styles.metaText}>{safeJson(item.diffJson)}</pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
