import QRCode from 'qrcode';
import { exportToCSV } from './exportExcel';

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'exception' | 'suspended';
type TaskType = 'finished' | 'semi_finished';

interface TaskException {
  id: number;
  type: string;
  description: string;
  severity: string;
  createdAt: string;
  resolvedAt?: string | null;
  resolution?: string | null;
  reporterName?: string | null;
  resolverName?: string | null;
}

interface TaskDependency {
  operationId: number;
  stepName: string;
  requiredQty: string;
  completedQty: string;
  status: string;
  skuId: number | null;
  skuCode: string | null;
  skuName: string | null;
  unit: string | null;
}

interface TaskInputItem {
  itemType: 'semi_finished' | 'material';
  sourceLabel: string;
  skuId: number;
  skuCode: string | null;
  skuName: string | null;
  unit: string | null;
  requiredQty: string;
  fulfilledQty: string;
  qtyAvailable: string;
  shortageQty: string;
  isShortage: boolean | 0 | 1 | '0' | '1';
  status: string | null;
  operationId: number | null;
  stepName: string | null;
  warehouseId?: number | null;
  warehouseCode?: string | null;
  warehouseName?: string | null;
  locationId?: number | null;
  locationCode?: string | null;
  locationName?: string | null;
}

interface TaskOutputItem {
  itemType: 'finished' | 'semi_finished';
  skuId: number;
  skuCode: string | null;
  skuName: string | null;
  unit: string | null;
  plannedQty: string;
  actualQty: string;
  processStepId?: number | null;
  processName?: string | null;
  warehouseId?: number | null;
  warehouseCode?: string | null;
  warehouseName?: string | null;
  locationId?: number | null;
  locationCode?: string | null;
  locationName?: string | null;
}

export interface PrintableProductionTask {
  id: number;
  taskNo?: string;
  orderNo: string;
  taskDate?: string;
  plannedFinishTime?: string | null;
  status: TaskStatus;
  taskType?: TaskType;
  processName?: string;
  workstationName?: string;
  workerName?: string;
  skuCode?: string;
  skuName?: string;
  productName?: string;
  outputSkuName?: string | null;
  plannedQty?: string | number;
  completedQty?: string | number;
  createdAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
  dependencySummary?: {
    blocked: boolean;
    blockingReason: string | null;
    predecessors: TaskDependency[];
  };
  inputItems?: TaskInputItem[];
  outputItems?: TaskOutputItem[];
  exceptions?: TaskException[];
}

interface TaskTimelineEntry {
  time: string;
  label: string;
  detail: string;
}

function formatQty(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return '0';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return Number.isInteger(numeric) ? `${numeric}` : numeric.toFixed(2);
}

function formatQtyWithUnit(value: string | number | undefined | null, unit?: string | null): string {
  const text = formatQty(value);
  return unit ? `${text} ${unit}` : text;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  const seconds = `${date.getSeconds()}`.padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatWarehouseLocation(value: {
  warehouseCode?: string | null;
  warehouseName?: string | null;
  locationCode?: string | null;
  locationName?: string | null;
} | null | undefined): string {
  if (!value) return '未绑定';
  const warehouse = value.warehouseName || value.warehouseCode || null;
  const location = value.locationName || value.locationCode || null;
  if (warehouse && location) return `${warehouse}-${location}`;
  if (warehouse) return warehouse;
  if (location) return location;
  return '未绑定';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getTaskTypeLabel(task: PrintableProductionTask): string {
  return task.taskType === 'semi_finished' ? '半成品任务' : '成品任务';
}

function getTaskStatusLabel(status: TaskStatus): string {
  switch (status) {
    case 'pending': return '待开始';
    case 'in_progress': return '进行中';
    case 'completed': return '已完成';
    case 'exception': return '异常处理中';
    case 'suspended': return '已挂起';
    default: return status;
  }
}

function getTaskPrimaryName(task: PrintableProductionTask): string {
  return task.outputSkuName || task.productName || task.skuName || '—';
}

function getTaskSecondaryName(task: PrintableProductionTask): string {
  return task.productName || task.skuName || '—';
}

function isShortage(item: Pick<TaskInputItem, 'isShortage'>): boolean {
  return item.isShortage === true || item.isShortage === 1 || item.isShortage === '1';
}

function getInventoryStatus(item: TaskInputItem): string {
  if (isShortage(item)) return '缺料';
  const required = Number(item.requiredQty ?? 0);
  const available = Number(item.qtyAvailable ?? 0);
  if (required > 0 && available <= required * 1.2) return '紧张';
  return '充足';
}

function getDependencyStatusLabel(status?: string | null): string {
  switch (status) {
    case 'pending':
      return '待开始';
    case 'in_progress':
    case 'started':
      return '进行中';
    case 'completed':
      return '已完成';
    case 'blocked':
      return '已阻塞';
    case 'ready':
      return '已就绪';
    case 'not_ready':
      return '未就绪';
    default:
      return status || '—';
  }
}

function renderInputItemRows(inputItems: TaskInputItem[]): string {
  if (inputItems.length === 0) {
    return '<tr><td colspan="8">当前任务没有输入项配置</td></tr>';
  }

  const orderedItems = [...inputItems].sort((left, right) => {
    if (left.itemType === right.itemType) return 0;
    return left.itemType === 'semi_finished' ? -1 : 1;
  });

  return orderedItems.map((item, index) => {
    const currentType = item.itemType === 'semi_finished' ? '半成品输入' : '原材料输入';
    const previousType = index > 0
      ? (orderedItems[index - 1].itemType === 'semi_finished' ? '半成品输入' : '原材料输入')
      : null;
    const showTypeCell = currentType !== previousType;
    const rowspan = showTypeCell
      ? orderedItems.slice(index).findIndex((nextItem) => {
        const nextType = nextItem.itemType === 'semi_finished' ? '半成品输入' : '原材料输入';
        return nextType !== currentType;
      })
      : -1;
    const mergedRows = rowspan === -1 ? orderedItems.length - index : rowspan;
    const stockStatus = getInventoryStatus(item);

    return `
      <tr>
        ${showTypeCell ? `<td rowspan="${mergedRows}">${currentType}</td>` : ''}
        <td>${escapeHtml(item.skuCode || `SKU#${item.skuId}`)}</td>
        <td>${escapeHtml(item.skuName || '—')}</td>
        <td>${escapeHtml(formatQtyWithUnit(item.requiredQty, item.unit))}</td>
        <td>${escapeHtml(formatQtyWithUnit(item.qtyAvailable, item.unit))}</td>
        <td><span class="badge badge-${stockStatus === '缺料' ? 'danger' : stockStatus === '紧张' ? 'warning' : 'healthy'}">${stockStatus}</span></td>
        <td>${escapeHtml(item.stepName ? `来源工序 ${item.stepName}` : item.sourceLabel)}</td>
        <td>${escapeHtml(formatWarehouseLocation(item))}</td>
      </tr>
    `;
  }).join('');
}

function buildTaskTimeline(task: PrintableProductionTask): TaskTimelineEntry[] {
  const timeline: TaskTimelineEntry[] = [];

  if (task.createdAt) {
    timeline.push({
      time: task.createdAt,
      label: '任务创建',
      detail: `任务进入系统，当前工序为 ${task.processName || '—'}`,
    });
  }

  if (task.startedAt) {
    timeline.push({
      time: task.startedAt,
      label: '开始生产',
      detail: `任务开始执行，工作站 ${task.workstationName || '—'}`,
    });
  }

  for (const item of task.exceptions ?? []) {
    timeline.push({
      time: item.createdAt,
      label: `异常上报 · ${item.type}`,
      detail: item.description || '异常已上报',
    });
    if (item.resolvedAt) {
      timeline.push({
        time: item.resolvedAt,
        label: `异常处理 · ${item.type}`,
        detail: item.resolution || `${item.resolverName || '系统'} 已处理异常`,
      });
    }
  }

  if (task.completedAt) {
    timeline.push({
      time: task.completedAt,
      label: '完工上报',
      detail: `累计产出 ${formatQty(task.completedQty ?? 0)}`,
    });
  }

  if (task.updatedAt && task.updatedAt !== task.completedAt) {
    timeline.push({
      time: task.updatedAt,
      label: '最近更新',
      detail: `当前状态：${getTaskStatusLabel(task.status)}`,
    });
  }

  if (timeline.length === 0) {
    timeline.push({
      time: task.taskDate || '',
      label: '当前状态',
      detail: getTaskStatusLabel(task.status),
    });
  }

  return timeline.sort((a, b) => {
    const left = new Date(a.time).getTime();
    const right = new Date(b.time).getTime();
    if (Number.isNaN(left) && Number.isNaN(right)) return 0;
    if (Number.isNaN(left)) return 1;
    if (Number.isNaN(right)) return -1;
    return left - right;
  });
}

function buildQrPayload(task: PrintableProductionTask): string {
  return [
    'SMART_FACTORY_TASK',
    `TASK_ID=${task.id}`,
    `TASK_NO=${task.taskNo || task.id}`,
    `ORDER_NO=${task.orderNo || 'NA'}`,
    `TASK_DATE=${task.taskDate || 'NA'}`,
  ].join('|');
}

function buildCsvRows(task: PrintableProductionTask): string[][] {
  const rows: string[][] = [];
  const inputItems = task.inputItems ?? [];
  const outputItems = task.outputItems ?? [];
  const predecessors = task.dependencySummary?.predecessors ?? [];
  const timeline = buildTaskTimeline(task);

  rows.push(['基础信息', '任务编号', task.taskNo || String(task.id), '', '']);
  rows.push(['基础信息', '工单号', task.orderNo || '—', '', '']);
  rows.push(['基础信息', '任务日期', task.taskDate || '—', '', '']);
  rows.push(['基础信息', '期望完成时间', formatDateTime(task.plannedFinishTime), '', '']);
  rows.push(['基础信息', '任务类型', getTaskTypeLabel(task), '', '']);
  rows.push(['基础信息', '工序', task.processName || '—', '', '']);
  rows.push(['基础信息', '工作站', task.workstationName || '—', '', '']);
  rows.push(['基础信息', '分配工人', task.workerName || '—', '', '']);
  rows.push(['基础信息', '当前状态', getTaskStatusLabel(task.status), '', '']);
  rows.push(['基础信息', '所属成品', getTaskSecondaryName(task), '', '']);
  rows.push(['基础信息', '当前产出', getTaskPrimaryName(task), '', '']);
  rows.push(['基础信息', '唯一二维码载荷', buildQrPayload(task), '', '']);

  if (inputItems.length === 0) {
    rows.push(['输入项', '无', '', '', '当前任务没有输入项配置']);
  } else {
    inputItems.forEach((item) => {
      rows.push([
        '输入项',
        item.itemType === 'semi_finished' ? '半成品输入' : '原材料输入',
        item.skuCode || `SKU#${item.skuId}`,
        `${item.skuName || '—'} / ${formatQtyWithUnit(item.requiredQty, item.unit)}`,
        `库存${getInventoryStatus(item)}，可用 ${formatQtyWithUnit(item.qtyAvailable, item.unit)}，库位 ${formatWarehouseLocation(item)}`,
      ]);
    });
  }

  if (outputItems.length === 0) {
    rows.push(['输出项', '无', '', '', '当前任务没有输出项配置']);
  } else {
    outputItems.forEach((item) => {
      rows.push([
        '输出项',
        item.itemType === 'semi_finished' ? '半成品输出' : '成品输出',
        item.skuCode || `SKU#${item.skuId}`,
        `${item.skuName || '—'} / 计划 ${formatQtyWithUnit(item.plannedQty, item.unit)}`,
        `当前实际 ${formatQtyWithUnit(item.actualQty, item.unit)}，工序 ${item.processName || task.processName || '—'}，库位 ${formatWarehouseLocation(item)}`,
      ]);
    });
  }

  if (predecessors.length === 0) {
    rows.push(['依赖与阻塞', '无前置依赖', '', '', task.dependencySummary?.blockingReason || '']);
  } else {
    predecessors.forEach((item) => {
      rows.push([
        '依赖与阻塞',
        item.stepName,
        item.skuCode || `OP#${item.operationId}`,
        `需求 ${formatQtyWithUnit(item.requiredQty, item.unit)} / 已完成 ${formatQtyWithUnit(item.completedQty, item.unit)}`,
        getDependencyStatusLabel(item.status),
      ]);
    });
  }

  timeline.forEach((item) => {
    rows.push(['任务变化', item.label, '', formatDateTime(item.time), item.detail]);
  });

  return rows;
}

export function exportProductionTaskDocument(task: PrintableProductionTask): void {
  exportToCSV(
    `生产任务工单_${task.taskNo || task.id}`,
    ['分组', '字段', '编码', '数量/值', '说明'],
    buildCsvRows(task),
  );
}

function writePrintLoadingState(targetWindow: Window): void {
  targetWindow.document.open();
  targetWindow.document.write(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>正在生成打印工单</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
        background: linear-gradient(180deg, #f8fafc 0%, #eff6ff 100%);
        color: #0f172a;
      }
      .panel {
        width: min(460px, calc(100vw - 48px));
        padding: 28px 32px;
        border-radius: 20px;
        background: #ffffff;
        border: 1px solid #dbeafe;
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.12);
      }
      h1 { margin: 0 0 10px; font-size: 22px; }
      p { margin: 0; color: #475569; line-height: 1.7; }
    </style>
  </head>
  <body>
    <div class="panel">
      <h1>正在生成打印工单</h1>
      <p>系统正在整理输入项、输出项、依赖与二维码，请稍候，打印预览会自动打开。</p>
    </div>
  </body>
</html>`);
  targetWindow.document.close();
}

export function openPrintWindow(): Window | null {
  const targetWindow = window.open('', '_blank', 'width=1100,height=860');
  if (!targetWindow) {
    return null;
  }
  writePrintLoadingState(targetWindow);
  return targetWindow;
}

export async function printProductionTaskDocument(
  task: PrintableProductionTask,
  targetWindow?: Window | null,
): Promise<void> {
  const qrDataUrl = await QRCode.toDataURL(buildQrPayload(task), {
    width: 180,
    margin: 1,
    errorCorrectionLevel: 'M',
  });

  const timeline = buildTaskTimeline(task);
  const inputItems = task.inputItems ?? [];
  const outputItems = task.outputItems ?? [];
  const predecessors = task.dependencySummary?.predecessors ?? [];

  const printWindow = targetWindow ?? openPrintWindow();
  if (!printWindow) {
    throw new Error('打印窗口被浏览器拦截');
  }

  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(`生产任务工单 ${task.taskNo || task.id}`)}</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #0f172a; background: #f8fafc; }
      .page {
        width: 100%;
        max-width: 194mm;
        margin: 0 auto;
        padding: 5mm 5.5mm 6.5mm;
        background: #ffffff;
        overflow: hidden;
      }
      .header {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 33mm;
        gap: 3.5mm;
        align-items: start;
        padding-bottom: 3.5mm;
        border-bottom: 0.5mm solid #e2e8f0;
      }
      .title { min-width: 0; }
      .title h1 { margin: 0; font-size: 20px; line-height: 1.2; }
      .title p { margin: 4px 0 0; color: #475569; line-height: 1.45; font-size: 10px; }
      .qr {
        width: 33mm;
        padding: 2mm;
        border: 0.4mm solid #cbd5e1;
        border-radius: 3mm;
        background: #f8fafc;
        text-align: center;
      }
      .qr img {
        width: 24mm;
        height: 24mm;
        display: block;
        margin: 0 auto 1.2mm;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 2.2mm;
        margin-top: 3.5mm;
      }
      .card {
        display: flex;
        align-items: center;
        gap: 1.2mm;
        padding: 2.2mm 2.6mm;
        border: 0.4mm solid #e2e8f0;
        border-radius: 2.6mm;
        background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        min-width: 0;
      }
      .card .label {
        font-size: 8px;
        color: #64748b;
        white-space: nowrap;
        flex: 0 0 auto;
      }
      .card .label::after { content: '：'; }
      .card .value {
        font-size: 10px;
        font-weight: 700;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1 1 auto;
        min-width: 0;
      }
      .section { margin-top: 4mm; }
      .section h2 { margin: 0 0 2mm; font-size: 14px; }
      .banner {
        padding: 2.5mm 3mm;
        border-radius: 3mm;
        border: 0.4mm solid #fed7aa;
        background: #fff7ed;
        color: #c2410c;
        margin-bottom: 2.5mm;
        font-size: 11px;
        line-height: 1.5;
      }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td {
        border: 0.3mm solid #e2e8f0;
        padding: 2mm 2.3mm;
        font-size: 10px;
        text-align: left;
        vertical-align: middle;
        word-break: break-word;
      }
      th { background: #f8fafc; color: #334155; font-weight: 700; }
      .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; }
      .badge-healthy { background: #dcfce7; color: #15803d; }
      .badge-warning { background: #fef3c7; color: #b45309; }
      .badge-danger { background: #fee2e2; color: #b91c1c; }
      .timeline { display: grid; gap: 2.5mm; }
      .timeline-item {
        display: grid;
        grid-template-columns: 33mm 30mm 1fr;
        gap: 2.5mm;
        padding: 2.5mm 3mm;
        border: 0.3mm solid #e2e8f0;
        border-radius: 3mm;
        background: #ffffff;
        font-size: 10px;
      }
      .muted { color: #64748b; }
      @page { size: A4 portrait; margin: 8mm; }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="header">
        <div class="title">
          <h1>生产任务工单</h1>
          <p>请按本工单完成当前任务的投入、产出与依赖核对。打印时间：${escapeHtml(formatDateTime(new Date().toISOString()))}</p>
        </div>
        <div class="qr">
          <img src="${qrDataUrl}" alt="任务二维码" />
          <div class="muted">唯一二维码</div>
        </div>
      </div>

      <div class="summary">
        <div class="card"><div class="label">任务编号</div><div class="value">${escapeHtml(task.taskNo || String(task.id))}</div></div>
        <div class="card"><div class="label">工单号</div><div class="value">${escapeHtml(task.orderNo || '—')}</div></div>
        <div class="card"><div class="label">任务类型</div><div class="value">${escapeHtml(getTaskTypeLabel(task))}</div></div>
        <div class="card"><div class="label">任务日期</div><div class="value">${escapeHtml(task.taskDate ? formatDateTime(task.taskDate) : '—')}</div></div>
        <div class="card"><div class="label">期望完成时间</div><div class="value">${escapeHtml(formatDateTime(task.plannedFinishTime))}</div></div>
        <div class="card"><div class="label">当前工序</div><div class="value">${escapeHtml(task.processName || '—')}</div></div>
        <div class="card"><div class="label">分配工人</div><div class="value">${escapeHtml(task.workerName || '—')}</div></div>
        <div class="card"><div class="label">工作站</div><div class="value">${escapeHtml(task.workstationName || '—')}</div></div>
        <div class="card"><div class="label">所属成品</div><div class="value">${escapeHtml(getTaskSecondaryName(task))}</div></div>
        <div class="card"><div class="label">预期输出</div><div class="value">${escapeHtml(getTaskPrimaryName(task))}</div></div>
      </div>

      <div class="section">
        <h2>输入项</h2>
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>SKU 编码</th>
              <th>SKU 名称</th>
              <th>用量</th>
              <th>可用库存</th>
              <th>库存状态</th>
              <th>来源</th>
              <th>仓库/库位</th>
            </tr>
          </thead>
          <tbody>
            ${renderInputItemRows(inputItems)}
          </tbody>
        </table>
      </div>

      <div class="section">
        <h2>输出项</h2>
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>SKU 编码</th>
              <th>SKU 名称</th>
              <th>对应工序</th>
              <th>预期产出</th>
              <th>当前已报工</th>
              <th>仓库/库位</th>
            </tr>
          </thead>
          <tbody>
            ${outputItems.length === 0 ? '<tr><td colspan="7">当前任务没有输出项配置</td></tr>' : outputItems.map((item) => `
              <tr>
                <td>${item.itemType === 'semi_finished' ? '半成品输出' : '成品输出'}</td>
                <td>${escapeHtml(item.skuCode || `SKU#${item.skuId}`)}</td>
                <td>${escapeHtml(item.skuName || '—')}</td>
                <td>${escapeHtml(item.processName || task.processName || '—')}</td>
                <td>${escapeHtml(formatQtyWithUnit(item.plannedQty, item.unit))}</td>
                <td>${escapeHtml(formatQtyWithUnit(item.actualQty, item.unit))}</td>
                <td>${escapeHtml(formatWarehouseLocation(item))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="section">
        <h2>依赖与阻塞</h2>
        ${task.dependencySummary?.blockingReason ? `<div class="banner">${escapeHtml(task.dependencySummary.blockingReason)}</div>` : ''}
        <table>
          <thead>
            <tr>
              <th>前置工序</th>
              <th>依赖 SKU</th>
              <th>需求数量</th>
              <th>已完成数量</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            ${predecessors.length === 0 ? '<tr><td colspan="5">当前任务没有前置工序依赖</td></tr>' : predecessors.map((item) => `
              <tr>
                <td>${escapeHtml(item.stepName)}</td>
                <td>${escapeHtml(item.skuCode || item.skuName || `OP#${item.operationId}`)}</td>
                <td>${escapeHtml(formatQtyWithUnit(item.requiredQty, item.unit))}</td>
                <td>${escapeHtml(formatQtyWithUnit(item.completedQty, item.unit))}</td>
                <td>${escapeHtml(getDependencyStatusLabel(item.status))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="section">
        <h2>任务变化</h2>
        <div class="timeline">
          ${timeline.map((item) => `
            <div class="timeline-item">
              <div class="muted">${escapeHtml(formatDateTime(item.time))}</div>
              <div>${escapeHtml(item.label)}</div>
              <div>${escapeHtml(item.detail)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  </body>
</html>`;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => {
    printWindow.print();
  };
}
