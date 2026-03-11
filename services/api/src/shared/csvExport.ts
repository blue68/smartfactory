/**
 * [artifact:API接口代码] — 通用 CSV 导出工具
 * UTF-8 BOM 保证 Excel 正确打开中文
 */

export function toCSV(headers: string[], rows: string[][]): string {
  const BOM = '\uFEFF';
  const escape = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  return (
    BOM +
    [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n')
  );
}
