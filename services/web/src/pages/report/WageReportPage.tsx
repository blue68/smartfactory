/**
 * [artifact:前端代码] — 工资报表页（管理员视角）R-05
 *
 * FE-05-01: 工资汇总 Tab、当月默认日期、表格/图表切换、导出 Excel
 * FE-05-03: 工资字段权限绑定（非管理员不渲染薪资列）
 * FE-05-06: CSS 横向柱状图视图（熟练工蓝色，学徒橙色）
 */

import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import Button from '@/components/common/Button';
import { useWageReport, exportWages } from '@/api/wage';
import type { WageReportRow, WageReportParams } from '@/api/wage';
import { useAuthStore } from '@/stores/authStore';
import { UserRole } from '@/types/enums';

// ─── 工具：获取当月起止日期 ───────────────────────────────

function getCurrentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

// ─── 权限 Hook：判断是否为管理员（老板或车间主管） ─────────

function useIsAdmin(): boolean {
  const { user } = useAuthStore();
  if (!user?.roles?.length) return false;
  return user.roles.some((r) =>
    [UserRole.BOSS, UserRole.SUPERVISOR].includes(r as UserRole),
  );
}

// ─── 图表组件 ─────────────────────────────────────────────

interface WageBarChartProps {
  list: WageReportRow[];
}

function WageBarChart({ list }: WageBarChartProps) {
  const maxSubtotal = useMemo(() => {
    const nums = list
      .map((r) => (r.subtotal ? parseFloat(r.subtotal) : 0))
      .filter((n) => !isNaN(n));
    return nums.length > 0 ? Math.max(...nums) : 1;
  }, [list]);

  if (list.length === 0) {
    return (
      <p style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
        暂无数据
      </p>
    );
  }

  return (
    <div style={{ padding: '16px 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {list.map((row, i) => {
        const value = row.subtotal ? parseFloat(row.subtotal) : 0;
        const pct = maxSubtotal > 0 ? Math.max((value / maxSubtotal) * 100, 2) : 2;
        const isSkilled = row.workerGrade === 'skilled';
        const barColor = isSkilled ? '#3B82F6' : '#F97316'; // blue / orange
        const label = `${row.userName} · ${row.stepName} · ${isSkilled ? '熟练工' : '学徒'}`;
        const tooltipText = `${label}: ${value.toFixed(2)} 元`;

        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
            {/* 名称标签 */}
            <div
              style={{
                width: 160,
                flexShrink: 0,
                textOverflow: 'ellipsis',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                color: 'var(--text-primary)',
              }}
              title={label}
            >
              {label}
            </div>

            {/* 横向柱条 */}
            <div style={{ flex: 1, background: 'var(--color-gray-100, #F1F5F9)', borderRadius: 4, height: 20, position: 'relative' }}>
              <div
                title={tooltipText}
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: barColor,
                  borderRadius: 4,
                  transition: 'width 0.4s ease',
                  cursor: 'default',
                }}
              />
            </div>

            {/* 数值 */}
            <div
              style={{
                width: 72,
                flexShrink: 0,
                textAlign: 'right',
                fontFamily: 'var(--font-family-number)',
                fontWeight: 600,
                color: barColor,
              }}
            >
              {row.subtotal ? `¥${parseFloat(row.subtotal).toFixed(2)}` : '—'}
            </div>
          </div>
        );
      })}

      {/* 图例 */}
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: '#3B82F6' }} />
          熟练工
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: '#F97316' }} />
          学徒
        </span>
      </div>
    </div>
  );
}

// ─── 主页面 ───────────────────────────────────────────────

type ViewMode = 'table' | 'chart';

const defaultRange = getCurrentMonthRange();

export default function WageReportPage() {
  const { setPageTitle, showToast } = useAppStore();
  const isAdmin = useIsAdmin();

  // FE-05-01: 默认当月日期范围
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);
  const [userId, setUserId] = useState('');
  const [workerGrade, setWorkerGrade] = useState<'' | 'skilled' | 'apprentice'>('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [exporting, setExporting] = useState(false);

  // FE-05-01: 视图切换（表格 / 图表）
  const [viewMode, setViewMode] = useState<ViewMode>('table');

  // 当前 Tab（为将来扩展预留，当前只有"工资核算"）
  const [activeTab] = useState<'wage'>('wage');

  useEffect(() => { setPageTitle('工资报表'); }, [setPageTitle]);

  const filter: WageReportParams = {
    page,
    pageSize,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    userId: userId ? Number(userId) : undefined,
    workerGrade: workerGrade || undefined,
  };

  const { data, isLoading } = useWageReport(filter);
  const list: WageReportRow[] = data?.list ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await exportWages({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        userId: userId ? Number(userId) : undefined,
        workerGrade: workerGrade || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `工资报表_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      showToast({ type: 'success', message: '导出成功' });
    } catch {
      showToast({ type: 'error', message: '导出失败' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* FE-05-01: Tab 栏 */}
      <div style={{ display: 'flex', borderBottom: '2px solid var(--border-default, #E2E8F0)', gap: 0 }}>
        <button
          aria-selected={activeTab === 'wage'}
          style={{
            padding: '8px 20px',
            fontSize: 14,
            fontWeight: 600,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            borderBottom: activeTab === 'wage' ? '2px solid var(--color-primary-500, #3B82F6)' : '2px solid transparent',
            color: activeTab === 'wage' ? 'var(--color-primary-600, #2563EB)' : 'var(--text-secondary)',
            marginBottom: -2,
            transition: 'color 150ms ease',
          }}
        >
          工资核算
        </button>
      </div>

      {/* 筛选栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label>
          起始日期
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            style={{ marginLeft: 4, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-default)' }}
          />
        </label>
        <label>
          结束日期
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            style={{ marginLeft: 4, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-default)' }}
          />
        </label>
        <label>
          工人 ID
          <input
            type="number"
            value={userId}
            placeholder="不限"
            onChange={(e) => { setUserId(e.target.value); setPage(1); }}
            style={{ marginLeft: 4, width: 80, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-default)' }}
          />
        </label>
        <label>
          技能等级
          <select
            value={workerGrade}
            onChange={(e) => { setWorkerGrade(e.target.value as '' | 'skilled' | 'apprentice'); setPage(1); }}
            style={{ marginLeft: 4, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-default)' }}
          >
            <option value="">全部</option>
            <option value="skilled">熟练工</option>
            <option value="apprentice">学徒</option>
          </select>
        </label>

        <div style={{ flex: 1 }} />

        {/* FE-05-01: 视图切换按钮组 */}
        <div
          style={{
            display: 'flex',
            borderRadius: 6,
            border: '1px solid var(--border-default, #E2E8F0)',
            overflow: 'hidden',
          }}
          role="group"
          aria-label="视图切换"
        >
          <button
            onClick={() => setViewMode('table')}
            aria-pressed={viewMode === 'table'}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: viewMode === 'table' ? 'var(--color-primary-500, #3B82F6)' : 'transparent',
              color: viewMode === 'table' ? '#fff' : 'var(--text-secondary)',
              transition: 'background 150ms ease, color 150ms ease',
            }}
          >
            表格
          </button>
          <button
            onClick={() => setViewMode('chart')}
            aria-pressed={viewMode === 'chart'}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              borderLeft: '1px solid var(--border-default, #E2E8F0)',
              cursor: 'pointer',
              background: viewMode === 'chart' ? 'var(--color-primary-500, #3B82F6)' : 'transparent',
              color: viewMode === 'chart' ? '#fff' : 'var(--text-secondary)',
              transition: 'background 150ms ease, color 150ms ease',
            }}
          >
            图表
          </button>
        </div>

        {/* FE-05-01: 导出按钮（仅管理员可见，按 FE-05-03 权限规则） */}
        {isAdmin && (
          <Button variant="ghost" onClick={handleExport} disabled={exporting}>
            {exporting ? '导出中…' : '导出 Excel'}
          </Button>
        )}
      </div>

      {/* 汇总信息 */}
      {data && (
        <div style={{ display: 'flex', gap: 24, fontSize: 14, color: 'var(--text-secondary)' }}>
          <span>共 {total} 条</span>
          {/* FE-05-03: 工资合计仅管理员可见 */}
          {isAdmin && data.totalWage && (
            <span>工资合计: {data.totalWage} 元</span>
          )}
          {isAdmin && data.unconfiguredCount > 0 && (
            <span style={{ color: 'var(--color-warning)' }}>
              未配置单价: {data.unconfiguredCount} 条
            </span>
          )}
        </div>
      )}

      {/* FE-05-06: 图表视图 */}
      {viewMode === 'chart' && (
        <div style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--border-default)', padding: 16 }}>
          {isLoading ? (
            <p style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>加载中…</p>
          ) : (
            <WageBarChart list={list} />
          )}
        </div>
      )}

      {/* FE-05-01 表格视图 */}
      {viewMode === 'table' && (
        <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 8, border: '1px solid var(--border-default)' }}>
          {isLoading ? (
            <p style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>加载中…</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: 'var(--bg-subtle, #f9fafb)', borderBottom: '1px solid var(--border-default)' }}>
                  <th style={thStyle}>工人</th>
                  <th style={thStyle}>技能等级</th>
                  <th style={thStyle}>工序</th>
                  <th style={thStyle}>完成数量</th>
                  {/* FE-05-03: 工价/小计列仅管理员渲染（不用 CSS 隐藏，直接不渲染） */}
                  {isAdmin && <th style={thStyle}>单价</th>}
                  {isAdmin && <th style={thStyle}>小计</th>}
                </tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 6 : 4} style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  list.map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-default)' }}>
                      <td style={tdStyle}>{row.userName}</td>
                      <td style={tdStyle}>
                        {row.workerGrade === 'skilled' ? '熟练工' : row.workerGrade === 'apprentice' ? '学徒' : row.workerGrade}
                      </td>
                      <td style={tdStyle}>{row.stepName}</td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-family-number)' }}>{row.completedCount}</td>
                      {/* FE-05-03: 工价/小计：非管理员不渲染这些 td */}
                      {isAdmin && (
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-family-number)' }}>
                          {row.unitPrice ?? '—'}
                        </td>
                      )}
                      {isAdmin && (
                        <td style={{ ...tdStyle, fontWeight: 600, fontFamily: 'var(--font-family-number)' }}>
                          {row.subtotal ?? '—'}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 分页（仅表格模式显示） */}
      {viewMode === 'table' && totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
          <span style={{ lineHeight: '32px', fontSize: 14 }}>{page} / {totalPages}</span>
          <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</Button>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', fontWeight: 600, fontSize: 13 };
const tdStyle: React.CSSProperties = { padding: '10px 12px' };
