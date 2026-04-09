/**
 * [artifact:前端代码] — 工资报表页（管理员视角）R-05
 *
 * FE-05-01: 工资汇总 Tab、当月默认日期、表格/图表切换、导出 Excel
 * FE-05-03: 工资字段权限绑定（非管理员不渲染薪资列）
 * FE-05-06: CSS 横向柱状图视图（熟练工蓝色，学徒橙色）
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import Button from '@/components/common/Button';
import { useWageReport, useTaskWageReport, exportWages } from '@/api/wage';
import type {
  WageReportRow,
  WageReportParams,
  WageTaskReportRow,
  WageTaskReportParams,
} from '@/api/wage';
import { useAuthStore } from '@/stores/authStore';
import { UserRole } from '@/types/enums';

const EMPTY_WAGE_ROWS: WageReportRow[] = [];
const EMPTY_WAGE_TASK_ROWS: WageTaskReportRow[] = [];

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
  const hasAnyRole = useAuthStore((s) => s.hasAnyRole);
  return hasAnyRole([UserRole.BOSS, UserRole.SUPERVISOR]);
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

// ─── 月度汇总组件 ──────────────────────────────────────────

interface MonthlySummaryRow {
  userId: number;
  userName: string;
  totalCount: number;
  totalWage: number;
  hasUnconfigured: boolean;
}

interface MonthlySummaryProps {
  list: WageReportRow[];
  isAdmin: boolean;
}

function MonthlySummaryTable({ list, isAdmin }: MonthlySummaryProps) {
  const rows = useMemo<MonthlySummaryRow[]>(() => {
    const map = new Map<number, MonthlySummaryRow>();
    for (const row of list) {
      const existing = map.get(row.userId);
      const subtotal = row.subtotal ? parseFloat(row.subtotal) : 0;
      const hasUnconfigured = row.subtotal === null;
      if (existing) {
        existing.totalCount += row.completedCount;
        existing.totalWage += subtotal;
        if (hasUnconfigured) existing.hasUnconfigured = true;
      } else {
        map.set(row.userId, {
          userId: row.userId,
          userName: row.userName,
          totalCount: row.completedCount,
          totalWage: subtotal,
          hasUnconfigured,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalWage - a.totalWage);
  }, [list]);

  if (rows.length === 0) {
    return (
      <p style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>暂无数据</p>
    );
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
      <thead>
        <tr style={{ background: 'var(--bg-subtle, #f9fafb)', borderBottom: '1px solid var(--border-default)' }}>
          <th style={thStyle}>工人姓名</th>
          <th style={thStyle}>总工时</th>
          <th style={thStyle}>总件数</th>
          {isAdmin && <th style={thStyle}>总工资</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.userId} style={{ borderBottom: '1px solid var(--border-default)' }}>
            <td style={tdStyle}>{row.userName}</td>
            <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>—</td>
            <td style={{ ...tdStyle, fontFamily: 'var(--font-family-number)' }}>{row.totalCount}</td>
            {isAdmin && (
              <td style={{ ...tdStyle, fontWeight: 600, fontFamily: 'var(--font-family-number)' }}>
                {row.hasUnconfigured
                  ? <span title="部分工序未配置单价，工资不完整" style={{ color: 'var(--color-warning)' }}>¥{row.totalWage.toFixed(2)}*</span>
                  : `¥${row.totalWage.toFixed(2)}`}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── 主页面 ───────────────────────────────────────────────

type ViewMode = 'table' | 'chart';
type ReportTab = 'daily' | 'monthly';
type DailyDetailMode = 'wage' | 'task';

const defaultRange = getCurrentMonthRange();

export default function WageReportPage() {
  const { setPageTitle, showToast } = useAppStore();
  const isAdmin = useIsAdmin();

  // FE-05-01: 默认当月日期范围
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);
  const [userId, setUserId] = useState('');
  const [workerGrade, setWorkerGrade] = useState<'' | 'skilled' | 'apprentice'>('');
  const [productionOrderIdInput, setProductionOrderIdInput] = useState('');
  const [taskIdInput, setTaskIdInput] = useState('');
  const [productionOrderId, setProductionOrderId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [exporting, setExporting] = useState(false);

  // FE-05-01: 视图切换（表格 / 图表）
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [detailMode, setDetailMode] = useState<DailyDetailMode>('wage');

  // P1-#15: Tab 切换 — 日工资明细 / 月度汇总
  const [activeTab, setActiveTab] = useState<ReportTab>('daily');

  useEffect(() => { setPageTitle('工资报表'); }, [setPageTitle]);

  const filter: WageReportParams = {
    page,
    pageSize,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    userId: userId ? Number(userId) : undefined,
    workerGrade: workerGrade || undefined,
  };

  const taskFilter: WageTaskReportParams = {
    ...filter,
    productionOrderId: productionOrderId ? Number(productionOrderId) : undefined,
    taskId: taskId ? Number(taskId) : undefined,
  };

  const { data: wageData, isLoading: wageLoading } = useWageReport(filter);
  const { data: taskData, isLoading: taskLoading } = useTaskWageReport(
    taskFilter,
    activeTab === 'daily' && detailMode === 'task',
  );

  const list: WageReportRow[] = wageData?.list ?? EMPTY_WAGE_ROWS;
  const taskList: WageTaskReportRow[] = taskData?.list ?? EMPTY_WAGE_TASK_ROWS;
  const total = detailMode === 'task' ? (taskData?.total ?? 0) : (wageData?.total ?? 0);
  const totalPages = Math.ceil(total / pageSize);
  const isLoading = detailMode === 'task' ? taskLoading : wageLoading;

  const taskSummary = useMemo(() => {
    const totalHours = taskList.reduce((sum, row) => sum + Number(row.workHours || 0), 0);
    const totalQty = taskList.reduce((sum, row) => sum + Number(row.qtyCompleted || 0), 0);
    const totalWage = taskList.reduce((sum, row) => sum + Number(row.subtotal || 0), 0);
    return {
      totalHours: totalHours.toFixed(2),
      totalQty: totalQty.toFixed(4),
      totalWage: totalWage.toFixed(2),
    };
  }, [taskList]);

  const applyTaskSearch = useCallback(() => {
    setProductionOrderId(productionOrderIdInput.trim());
    setTaskId(taskIdInput.trim());
    setPage(1);
  }, [productionOrderIdInput, taskIdInput]);

  const clearTaskSearch = useCallback(() => {
    setProductionOrderIdInput('');
    setTaskIdInput('');
    setProductionOrderId('');
    setTaskId('');
    setPage(1);
  }, []);

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

      {/* P1-#15: Tab 栏 — 日工资明细 / 月度汇总 */}
      <div style={{ display: 'flex', borderBottom: '2px solid var(--border-default, #E2E8F0)', gap: 0 }}>
        {(
          [
            { key: 'daily',   label: '日工资明细' },
            { key: 'monthly', label: '月度汇总' },
          ] as { key: ReportTab; label: string }[]
        ).map(({ key, label }) => (
          <button
            key={key}
            aria-selected={activeTab === key}
            onClick={() => setActiveTab(key)}
            style={{
              padding: '8px 20px',
              fontSize: 14,
              fontWeight: 600,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              borderBottom: activeTab === key ? '2px solid var(--color-primary-500, #3B82F6)' : '2px solid transparent',
              color: activeTab === key ? 'var(--color-primary-600, #2563EB)' : 'var(--text-secondary)',
              marginBottom: -2,
              transition: 'color 150ms ease',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── 日工资明细 Tab 内容 ────────────────────────────── */}
      {activeTab === 'daily' && <>

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

        <div
          style={{
            display: 'flex',
            borderRadius: 6,
            border: '1px solid var(--border-default, #E2E8F0)',
            overflow: 'hidden',
          }}
          role="group"
          aria-label="日报细分视图"
        >
          <button
            onClick={() => {
              setDetailMode('wage');
              setPage(1);
              setViewMode((prev) => prev);
            }}
            aria-pressed={detailMode === 'wage'}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: detailMode === 'wage' ? 'var(--color-primary-500, #3B82F6)' : 'transparent',
              color: detailMode === 'wage' ? '#fff' : 'var(--text-secondary)',
            }}
          >
            工资汇总
          </button>
          <button
            onClick={() => {
              setDetailMode('task');
              setPage(1);
              setViewMode('table');
            }}
            aria-pressed={detailMode === 'task'}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              borderLeft: '1px solid var(--border-default, #E2E8F0)',
              cursor: 'pointer',
              background: detailMode === 'task' ? 'var(--color-primary-500, #3B82F6)' : 'transparent',
              color: detailMode === 'task' ? '#fff' : 'var(--text-secondary)',
            }}
          >
            任务报工
          </button>
        </div>

        {detailMode === 'task' && (
          <>
            <label>
              工单 ID
              <input
                type="number"
                value={productionOrderIdInput}
                placeholder="不限"
                onChange={(e) => setProductionOrderIdInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyTaskSearch()}
                style={{ marginLeft: 4, width: 100, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-default)' }}
              />
            </label>
            <label>
              任务 ID
              <input
                type="number"
                value={taskIdInput}
                placeholder="不限"
                onChange={(e) => setTaskIdInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyTaskSearch()}
                style={{ marginLeft: 4, width: 100, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-default)' }}
              />
            </label>
            <Button variant="ghost" size="sm" onClick={applyTaskSearch}>
              查询
            </Button>
            <Button variant="ghost" size="sm" onClick={clearTaskSearch}>
              清空
            </Button>
          </>
        )}

        {/* FE-05-01: 视图切换按钮组 */}
        {detailMode === 'wage' && (
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
        )}

        {/* FE-05-01: 导出按钮（仅管理员可见，按 FE-05-03 权限规则） */}
        {isAdmin && (
          <Button variant="ghost" onClick={handleExport} disabled={exporting}>
            {exporting ? '导出中…' : '导出 Excel'}
          </Button>
        )}
      </div>

      {/* 汇总信息 */}
      {(detailMode === 'wage' ? wageData : taskData) && (
        <div style={{ display: 'flex', gap: 24, fontSize: 14, color: 'var(--text-secondary)' }}>
          <span>共 {total} 条</span>
          {detailMode === 'wage' ? (
            <>
              {isAdmin && wageData?.totalWage && (
                <span>工资合计: {wageData.totalWage} 元</span>
              )}
              {isAdmin && (wageData?.unconfiguredCount ?? 0) > 0 && (
                <span style={{ color: 'var(--color-warning)' }}>
                  未配置单价: {wageData?.unconfiguredCount} 条
                </span>
              )}
            </>
          ) : (
            <>
              <span>本页工时: {taskSummary.totalHours} h</span>
              <span>本页产量: {taskSummary.totalQty}</span>
              {isAdmin && <span>本页工资: {taskSummary.totalWage} 元</span>}
            </>
          )}
        </div>
      )}
      {detailMode === 'task' && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          任务报工口径来自已确认报工记录
          {productionOrderId || taskId ? `（已筛选：工单 ${productionOrderId || '不限'} / 任务 ${taskId || '不限'}）` : ''}
        </div>
      )}

      {/* FE-05-06: 图表视图 */}
      {detailMode === 'wage' && viewMode === 'chart' && (
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
            <p style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
              {detailMode === 'task' ? '任务报工加载中…' : '加载中…'}
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                {detailMode === 'wage' ? (
                  <tr style={{ background: 'var(--bg-subtle, #f9fafb)', borderBottom: '1px solid var(--border-default)' }}>
                    <th style={thStyle}>工人</th>
                    <th style={thStyle}>技能等级</th>
                    <th style={thStyle}>工序</th>
                    <th style={thStyle}>完成数量</th>
                    {isAdmin && <th style={thStyle}>单价</th>}
                    {isAdmin && <th style={thStyle}>小计</th>}
                  </tr>
                ) : (
                  <tr style={{ background: 'var(--bg-subtle, #f9fafb)', borderBottom: '1px solid var(--border-default)' }}>
                    <th style={thStyle}>日期</th>
                    <th style={thStyle}>工单号</th>
                    <th style={thStyle}>任务号</th>
                    <th style={thStyle}>工人</th>
                    <th style={thStyle}>工序</th>
                    <th style={thStyle}>完成数</th>
                    <th style={thStyle}>合格数</th>
                    <th style={thStyle}>不良数</th>
                    <th style={thStyle}>工时</th>
                    {isAdmin && <th style={thStyle}>单价</th>}
                    {isAdmin && <th style={thStyle}>小计</th>}
                  </tr>
                )}
              </thead>
              <tbody>
                {(detailMode === 'wage' ? list.length === 0 : taskList.length === 0) ? (
                  <tr>
                    <td colSpan={detailMode === 'wage' ? (isAdmin ? 6 : 4) : (isAdmin ? 11 : 9)} style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
                      {detailMode === 'wage' ? '暂无数据' : '暂无任务报工记录'}
                    </td>
                  </tr>
                ) : detailMode === 'wage' ? (
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
                ) : (
                  taskList.map((row) => (
                    <tr key={row.reportId} style={{ borderBottom: '1px solid var(--border-default)' }}>
                      <td style={tdStyle}>{row.reportDate}</td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-family-number)' }}>{row.orderNo ?? '—'}</td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-family-number)' }}>{row.taskNo ?? '—'}</td>
                      <td style={tdStyle}>{row.userName}</td>
                      <td style={tdStyle}>{row.stepName}</td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-family-number)' }}>{row.qtyCompleted}</td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-family-number)' }}>{row.qtyQualified}</td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-family-number)' }}>{row.qtyDefective}</td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-family-number)' }}>{row.workHours}</td>
                      {isAdmin && (
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-family-number)' }}>
                          {row.unitPrice}
                        </td>
                      )}
                      {isAdmin && (
                        <td style={{ ...tdStyle, fontWeight: 600, fontFamily: 'var(--font-family-number)' }}>
                          {row.subtotal}
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
      </>}

      {/* ── 月度汇总 Tab 内容 ────────────────────────────── */}
      {activeTab === 'monthly' && (
        <MonthlySummaryTable list={list} isAdmin={isAdmin} />
      )}

    </div>
  );
}

const thStyle: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', fontWeight: 600, fontSize: 13 };
const tdStyle: React.CSSProperties = { padding: '10px 12px' };
