import type { LocationOption } from '@/types/models';

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CODE128_WIDTHS: string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

function normalizeBarcodePayload(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^\x20-\x7E]/g, '-');
}

function encodeCode128B(value: string): number[] {
  if (!value) {
    throw new Error('条码内容为空');
  }
  const payload = normalizeBarcodePayload(value);
  const dataCodes: number[] = [];
  for (const char of payload) {
    const code = char.charCodeAt(0) - 32;
    if (code < 0 || code > 94) {
      throw new Error(`条码内容包含不支持字符: ${char}`);
    }
    dataCodes.push(code);
  }

  const startCodeB = 104;
  let checksum = startCodeB;
  dataCodes.forEach((code, index) => {
    checksum += code * (index + 1);
  });
  const checkCode = checksum % 103;
  return [startCodeB, ...dataCodes, checkCode, 106];
}

function generateCode128SvgDataUrl(value: string): string {
  const codes = encodeCode128B(value);
  const moduleWidth = 2;
  const barHeight = 88;
  const quietZone = 10;
  let cursor = quietZone * moduleWidth;
  let rects = '';

  codes.forEach((code) => {
    const widths = CODE128_WIDTHS[code];
    if (!widths) return;
    for (let i = 0; i < widths.length; i += 1) {
      const width = Number(widths[i]) * moduleWidth;
      if (i % 2 === 0) {
        rects += `<rect x="${cursor}" y="0" width="${width}" height="${barHeight}" fill="#000" />`;
      }
      cursor += width;
    }
  });

  const totalWidth = cursor + quietZone * moduleWidth;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${barHeight}" viewBox="0 0 ${totalWidth} ${barHeight}" preserveAspectRatio="none"><rect width="100%" height="100%" fill="#fff" />${rects}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

interface OpenLocationBarcodePrintWindowParams {
  items: LocationOption[];
  locationWarehouseCodeMap: Map<number, string>;
  existingWindow: Window | null;
}

export function openLocationBarcodePrintWindow({
  items,
  locationWarehouseCodeMap,
  existingWindow,
}: OpenLocationBarcodePrintWindowParams): Window {
  let printWindow = existingWindow;
  if (!printWindow || printWindow.closed) {
    printWindow = window.open('', '_blank', 'width=1100,height=800');
    if (!printWindow) {
      throw new Error('浏览器阻止了打印窗口，请允许弹窗后重试');
    }
  }
  printWindow.focus();

  const loadingHtml = `
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>库位条码打印准备中</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; }
    .wrap { min-height: 100vh; display: grid; place-items: center; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 24px; }
    .title { margin: 0 0 8px; font-size: 18px; }
    .desc { margin: 0; color: #475569; font-size: 14px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1 class="title">正在生成库位条码...</h1>
      <p class="desc">请稍候，生成完成后可点击“立即打印”。</p>
    </div>
  </div>
</body>
</html>`;
  printWindow.document.open();
  printWindow.document.write(loadingHtml);
  printWindow.document.close();

  try {
    const labels = items.map((item) => {
      const warehouseCode = locationWarehouseCodeMap.get(item.warehouseId) ?? String(item.warehouseId);
      const locationCode = normalizeBarcodePayload(item.code || `LOC-${item.id}`);
      const barcodePayload = normalizeBarcodePayload(`LOC|${warehouseCode}|${locationCode}`);
      const displayCode = locationCode.replace(/[_-]/g, '.');
      let barcodeDataUrl = '';
      try {
        barcodeDataUrl = generateCode128SvgDataUrl(barcodePayload);
      } catch {
        barcodeDataUrl = '';
      }
      return {
        displayCode,
        barcodeDataUrl,
      };
    });

    const cardsHtml = labels.map((label) => `
      <article class="label-card">
        ${
          label.barcodeDataUrl
            ? `<img class="linear-barcode" src="${label.barcodeDataUrl}" alt="库位线性条码" />`
            : `<div class="barcode-fallback">条码生成失败，请稍后重试</div>`
        }
        <div class="code-text">${escapeHtml(label.displayCode)}</div>
      </article>
    `).join('');

    const html = `
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>库位条码打印</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; }
    .toolbar { position: sticky; top: 0; z-index: 10; margin: 0 0 14px; display: flex; gap: 10px; align-items: center; background: #f8fafc; padding: 4px 0 10px; }
    .toolbar-btn { border: 1px solid #cbd5e1; background: #fff; border-radius: 8px; padding: 8px 12px; font-size: 13px; cursor: pointer; }
    .toolbar-btn.primary { background: #0f172a; color: #fff; border-color: #0f172a; }
    .toolbar-hint { color: #475569; font-size: 13px; }
    .sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; align-items: start; }
    .label-card { background: #fff; border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 10px 10px; page-break-inside: avoid; }
    .linear-barcode { display: block; width: 100%; height: 74px; background: #fff; image-rendering: pixelated; }
    .code-text { margin-top: 6px; text-align: center; font-family: "SFMono-Regular", "Menlo", "Consolas", monospace; font-size: 30px; font-weight: 800; letter-spacing: 1.4px; color: #0f172a; line-height: 1.15; text-transform: uppercase; }
    .barcode-fallback { margin-top: 10px; min-height: 74px; border: 1px dashed #cbd5e1; display: flex; align-items: center; justify-content: center; color: #64748b; font-size: 12px; text-align: center; padding: 8px; }
    @media print {
      body { background: #fff; padding: 0; }
      .toolbar { display: none; }
      .sheet { gap: 4mm; grid-template-columns: repeat(auto-fill, minmax(72mm, 1fr)); }
      .label-card { border: 0.25mm solid #111827; border-radius: 0; width: 72mm; min-height: 30mm; padding: 2mm 2.4mm; }
      .linear-barcode { height: 13.5mm; }
      .code-text { font-size: 5.8mm; letter-spacing: 0.5mm; margin-top: 1.1mm; font-weight: 800; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="print-now" class="toolbar-btn primary" type="button" onclick="window.print()">立即打印</button>
    <button id="close-now" class="toolbar-btn" type="button" onclick="window.close()">关闭窗口</button>
    <div class="toolbar-hint">若未自动出现打印框，请点击“立即打印”或使用 Ctrl/Cmd + P</div>
  </div>
  <section class="sheet">${cardsHtml}</section>
</body>
</html>`;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    const bindToolbarEvents = () => {
      const doc = printWindow?.document;
      if (!doc) return;
      const printBtn = doc.getElementById('print-now');
      const closeBtn = doc.getElementById('close-now');
      if (printBtn) {
        printBtn.onclick = () => {
          printWindow?.focus();
          printWindow?.print();
        };
      }
      if (closeBtn) {
        closeBtn.onclick = () => {
          printWindow?.close();
        };
      }
    };
    bindToolbarEvents();
    printWindow.addEventListener('load', bindToolbarEvents, { once: true });
    let retryCount = 0;
    const bindRetryTimer = window.setInterval(() => {
      retryCount += 1;
      bindToolbarEvents();
      if (retryCount >= 20) {
        window.clearInterval(bindRetryTimer);
      }
    }, 120);
    window.setTimeout(() => window.clearInterval(bindRetryTimer), 3000);

    return printWindow;
  } catch (err) {
    const errorHtml = `
<!doctype html>
<html lang="zh-CN">
<head><meta charset="UTF-8" /><title>库位条码生成失败</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px;">
  <h2>库位条码生成失败</h2>
  <p>${escapeHtml(getErrorMessage(err, '请稍后重试'))}</p>
</body>
</html>`;
    if (!printWindow.closed) {
      printWindow.document.open();
      printWindow.document.write(errorHtml);
      printWindow.document.close();
    }
    throw err;
  }
}
