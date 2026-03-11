/**
 * [artifact:前端代码] — 通用 CSV/Excel 导出工具
 * T216: Excel 导出功能
 *
 * 不依赖第三方库，使用 Blob + CSV 格式
 * UTF-8 BOM 保证 Excel 正确识别中文
 */

/**
 * 将二维数据导出为 CSV 文件
 * @param filename  导出文件名（不含扩展名和日期，自动追加）
 * @param headers   表头列名数组
 * @param rows      数据行，每行为字符串数组
 */
export function exportToCSV(
  filename: string,
  headers: string[],
  rows: string[][]
): void {
  const BOM = '\uFEFF'; // UTF-8 BOM — Excel 中文兼容必需

  const escape = (cell: string): string =>
    `"${String(cell).replace(/"/g, '""')}"`;

  const lines: string[] = [
    headers.map(escape).join(','),
    ...rows.map((row) => row.map(escape).join(',')),
  ];

  const csvContent = BOM + lines.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 将对象数组导出为 CSV 文件（便捷重载）
 * @param filename   导出文件名
 * @param columns    列定义：{ key: 数据字段名, label: 表头显示名 }
 * @param data       数据对象数组
 */
export function exportObjectsToCSV<T extends Record<string, unknown>>(
  filename: string,
  columns: Array<{ key: keyof T; label: string }>,
  data: T[]
): void {
  const headers = columns.map((col) => col.label);
  const rows = data.map((item) =>
    columns.map((col) => {
      const val = item[col.key];
      if (val === null || val === undefined) return '';
      return String(val);
    })
  );
  exportToCSV(filename, headers, rows);
}
