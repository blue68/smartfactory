import { useEffect, useMemo, useState } from 'react';
import Button from '@/components/common/Button';
import {
  type SemiFinishedModeReportFilter,
  type SemiFinishedModeTag,
  useSemiFinishedModeReport,
} from '@/api/productionModeReport';
import { useAppStore } from '@/stores/appStore';

const PAGE_SIZE = 20;

const TAG_TEXT: Record<SemiFinishedModeTag, string> = {
  internal_only: '仅厂内',
  outsource_only: '仅外协',
  mixed: '混合',
  no_operation: '无作业',
};

export default function SemiFinishedModeReportPage() {
  const { setPageTitle } = useAppStore();

  const [keyword, setKeyword] = useState('');
  const [modeTag, setModeTag] = useState<SemiFinishedModeTag | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPageTitle('半成品模式报表');
  }, [setPageTitle]);

  const filter = useMemo<SemiFinishedModeReportFilter>(() => ({
    page,
    pageSize: PAGE_SIZE,
    keyword: keyword.trim() || undefined,
    modeTag: modeTag || undefined,
    from: from || undefined,
    to: to || undefined,
  }), [page, keyword, modeTag, from, to]);

  const { data, isLoading } = useSemiFinishedModeReport(filter);
  const list = data?.list ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleSearch = () => {
    setPage(1);
  };

  const handleReset = () => {
    setKeyword('');
    setModeTag('');
    setFrom('');
    setTo('');
    setPage(1);
  };

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="SKU编码 / 名称 / 规格"
          style={{ width: 260, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-default)' }}
        />
        <select
          value={modeTag}
          onChange={(e) => setModeTag(e.target.value as SemiFinishedModeTag | '')}
          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-default)' }}
        >
          <option value="">全部模式</option>
          <option value="internal_only">仅厂内</option>
          <option value="outsource_only">仅外协</option>
          <option value="mixed">混合</option>
          <option value="no_operation">无作业</option>
        </select>
        <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          开始日期
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{ marginLeft: 6, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border-default)' }}
          />
        </label>
        <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          结束日期
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{ marginLeft: 6, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border-default)' }}
          />
        </label>
        <Button variant="primary" size="sm" onClick={handleSearch}>查询</Button>
        <Button variant="ghost" size="sm" onClick={handleReset}>重置</Button>
      </div>

      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        共 {total} 条半成品 SKU 记录
      </div>

      <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 8, border: '1px solid var(--border-default)' }}>
        {isLoading ? (
          <p style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>加载中…</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-subtle, #f9fafb)', borderBottom: '1px solid var(--border-default)' }}>
                <th style={thStyle}>SKU编码</th>
                <th style={thStyle}>SKU名称</th>
                <th style={thStyle}>规格</th>
                <th style={thStyle}>厂内计划</th>
                <th style={thStyle}>外协计划</th>
                <th style={thStyle}>厂内完工</th>
                <th style={thStyle}>外协完工</th>
                <th style={thStyle}>模式标签</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
                    暂无符合条件的数据
                  </td>
                </tr>
              ) : (
                list.map((row) => (
                  <tr key={row.skuId} style={{ borderBottom: '1px solid var(--border-default)' }}>
                    <td style={tdStyle}>{row.skuCode}</td>
                    <td style={tdStyle}>{row.skuName}</td>
                    <td style={tdStyle}>{row.skuSpec || '-'}</td>
                    <td style={numTdStyle}>{row.internalPlannedQty}</td>
                    <td style={numTdStyle}>{row.outsourcePlannedQty}</td>
                    <td style={numTdStyle}>{row.internalCompletedQty}</td>
                    <td style={numTdStyle}>{row.outsourceCompletedQty}</td>
                    <td style={tdStyle}>
                      <span style={tagStyle(row.modeTag)}>{TAG_TEXT[row.modeTag]}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            上一页
          </Button>
          <span style={{ lineHeight: '32px', fontSize: 13 }}>{page} / {totalPages}</span>
          <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 12,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  verticalAlign: 'middle',
};

const numTdStyle: React.CSSProperties = {
  ...tdStyle,
  fontFamily: 'var(--font-family-number)',
};

function tagStyle(modeTag: SemiFinishedModeTag): React.CSSProperties {
  const common: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 12,
    lineHeight: 1.5,
  };
  if (modeTag === 'internal_only') return { ...common, color: '#065f46', background: '#d1fae5' };
  if (modeTag === 'outsource_only') return { ...common, color: '#1e40af', background: '#dbeafe' };
  if (modeTag === 'mixed') return { ...common, color: '#92400e', background: '#fef3c7' };
  return { ...common, color: '#475569', background: '#e2e8f0' };
}
