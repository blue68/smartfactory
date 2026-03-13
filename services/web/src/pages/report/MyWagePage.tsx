/**
 * [artifact:前端代码] — 我的工资页（工人自查视角）
 * 功能：日期范围筛选、分页表格
 */

import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import Button from '@/components/common/Button';
import { useMyWages } from '@/api/wage';
import type { WageReportRow } from '@/api/wage';

export default function MyWagePage() {
  const { setPageTitle } = useAppStore();

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  useEffect(() => { setPageTitle('我的工资'); }, [setPageTitle]);

  const { data, isLoading } = useMyWages({
    page,
    pageSize,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const list: WageReportRow[] = data?.list ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

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
      </div>

      {/* 表格 */}
      <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 8, border: '1px solid var(--border-default)' }}>
        {isLoading ? (
          <p style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>加载中…</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--bg-subtle, #f9fafb)', borderBottom: '1px solid var(--border-default)' }}>
                <th style={thStyle}>工序</th>
                <th style={thStyle}>完成数量</th>
                <th style={thStyle}>单价</th>
                <th style={thStyle}>小计</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>暂无工资记录</td></tr>
              ) : (
                list.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-default)' }}>
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
