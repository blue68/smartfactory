/**
 * [artifact:前端代码] — 工资报表页（管理员视角）
 * 功能：日期范围筛选、工人/等级过滤、分页表格、导出 Excel
 */

import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import Button from '@/components/common/Button';
import { useWageReport, exportWages } from '@/api/wage';
import type { WageReportRow, WageReportParams } from '@/api/wage';

export default function WageReportPage() {
  const { setPageTitle, showToast } = useAppStore();

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [userId, setUserId] = useState('');
  const [workerGrade, setWorkerGrade] = useState<'' | 'skilled' | 'apprentice'>('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [exporting, setExporting] = useState(false);

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
      {/* 筛选栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label>
          起始日期
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            style={{ marginLeft: 4, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-default)' }} />
        </label>
        <label>
          结束日期
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            style={{ marginLeft: 4, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-default)' }} />
        </label>
        <label>
          工人 ID
          <input type="number" value={userId} placeholder="不限"
            onChange={(e) => { setUserId(e.target.value); setPage(1); }}
            style={{ marginLeft: 4, width: 80, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-default)' }} />
        </label>
        <label>
          技能等级
          <select value={workerGrade} onChange={(e) => { setWorkerGrade(e.target.value as '' | 'skilled' | 'apprentice'); setPage(1); }}
            style={{ marginLeft: 4, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-default)' }}>
            <option value="">全部</option>
            <option value="skilled">熟练工</option>
            <option value="apprentice">学徒</option>
          </select>
        </label>
        <div style={{ flex: 1 }} />
        <Button variant="ghost" onClick={handleExport} disabled={exporting}>
          {exporting ? '导出中…' : '导出 Excel'}
        </Button>
      </div>

      {/* 汇总信息 */}
      {data && (
        <div style={{ display: 'flex', gap: 24, fontSize: 14, color: 'var(--text-secondary)' }}>
          <span>共 {total} 条</span>
          {data.totalWage && <span>工资合计: {data.totalWage} 元</span>}
          {data.unconfiguredCount > 0 && <span style={{ color: 'var(--color-warning)' }}>未配置单价: {data.unconfiguredCount} 条</span>}
        </div>
      )}

      {/* 表格 */}
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
                <th style={thStyle}>单价</th>
                <th style={thStyle}>小计</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>暂无数据</td></tr>
              ) : (
                list.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-default)' }}>
                    <td style={tdStyle}>{row.userName}</td>
                    <td style={tdStyle}>{row.workerGrade === 'skilled' ? '熟练工' : row.workerGrade === 'apprentice' ? '学徒' : row.workerGrade}</td>
                    <td style={tdStyle}>{row.stepName}</td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-family-number)' }}>{row.completedCount}</td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-family-number)' }}>{row.unitPrice ?? '—'}</td>
                    <td style={{ ...tdStyle, fontWeight: 600, fontFamily: 'var(--font-family-number)' }}>{row.subtotal ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
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
