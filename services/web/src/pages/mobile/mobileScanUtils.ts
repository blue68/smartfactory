import QrScanner from 'qr-scanner';

export interface ParsedTaskQrPayload {
  taskId: number | null;
  taskNo: string | null;
  raw: string;
}

export interface ParsedWarehouseScanPayload {
  keyword: string;
  skuId: string;
  dyeLotNo: string;
  deliveryNo: string;
  raw: string;
}

export function parseTaskQrPayload(raw: string): ParsedTaskQrPayload | null {
  const payload = raw.trim();
  if (!payload) return null;
  if (/^\d+$/.test(payload)) {
    return {
      taskId: Number(payload),
      taskNo: null,
      raw: payload,
    };
  }

  const segments = payload.split('|');
  if (segments[0] !== 'SMART_FACTORY_TASK') {
    return null;
  }

  const kv = new Map<string, string>();
  segments.slice(1).forEach((segment) => {
    const [key, ...rest] = segment.split('=');
    if (!key) return;
    kv.set(key, rest.join('='));
  });

  const taskIdText = kv.get('TASK_ID') ?? null;
  const taskId = taskIdText && /^\d+$/.test(taskIdText) ? Number(taskIdText) : null;
  return {
    taskId,
    taskNo: kv.get('TASK_NO') ?? null,
    raw: payload,
  };
}

export function parseWarehouseScanPayload(raw: string): ParsedWarehouseScanPayload | null {
  const payload = raw.trim();
  if (!payload) return null;

  const parsed: ParsedWarehouseScanPayload = {
    keyword: payload,
    skuId: '',
    dyeLotNo: '',
    deliveryNo: '',
    raw: payload,
  };

  const segments = payload.split('|');
  if (segments.length === 1) {
    return parsed;
  }

  const kv = new Map<string, string>();
  segments.slice(1).forEach((segment) => {
    const [key, ...rest] = segment.split('=');
    if (!key) return;
    kv.set(key, rest.join('='));
  });

  if (segments[0] === 'SMART_FACTORY_SKU') {
    return {
      keyword: kv.get('SKU_CODE') ?? payload,
      skuId: kv.get('SKU_ID') ?? '',
      dyeLotNo: kv.get('DYE_LOT') ?? kv.get('BATCH') ?? '',
      deliveryNo: '',
      raw: payload,
    };
  }

  if (segments[0] === 'SMART_FACTORY_DELIVERY') {
    const deliveryNo = kv.get('DELIVERY_NO') ?? '';
    return {
      keyword: deliveryNo || kv.get('SKU_CODE') || payload,
      skuId: kv.get('SKU_ID') ?? '',
      dyeLotNo: kv.get('DYE_LOT') ?? kv.get('BATCH') ?? '',
      deliveryNo,
      raw: payload,
    };
  }

  return parsed;
}

export async function decodeQrImage(file: File): Promise<string> {
  const result = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
  return result.data;
}
