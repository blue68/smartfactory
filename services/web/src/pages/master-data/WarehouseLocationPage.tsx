import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload/interface';
import { ACTION_CODES } from '@/constants/accessControl';
import { usePermission } from '@/hooks/usePermission';
import { useAppStore } from '@/stores/appStore';
import {
  inventoryApi,
  useCreateLocation,
  useCreateWarehouse,
  useDeleteLocation,
  useDeleteWarehouse,
  useImportLocationsCsv,
  useImportWarehousesCsv,
  useLocationOptions,
  useUpdateLocation,
  useUpdateWarehouse,
  useWarehouseOptions,
} from '@/api/inventory';
import type { LocationOption, WarehouseOption } from '@/types/models';
import styles from './WarehouseLocationPage.module.css';

type MasterDataTab = 'warehouse' | 'location';
type MasterDataStatus = 'active' | 'inactive' | 'locked' | 'archived';
type LocationType = 'general' | 'zone' | 'rack' | 'shelf' | 'bin';

interface WarehouseFormValues {
  code: string;
  name: string;
  type: string;
  status: MasterDataStatus;
  plantCode?: string;
}

interface LocationFormValues {
  warehouseId: number;
  code: string;
  name: string;
  locationType: LocationType;
  aisleCode?: string;
  rackCode?: string;
  shelfCode?: string;
  binCode?: string;
  level: number;
  status: MasterDataStatus;
}

const STATUS_LABEL: Record<MasterDataStatus, string> = {
  active: '启用',
  inactive: '停用',
  locked: '锁定',
  archived: '归档',
};

const STATUS_COLOR: Record<MasterDataStatus, string> = {
  active: 'success',
  inactive: 'gold',
  locked: 'volcano',
  archived: 'default',
};

const WAREHOUSE_TYPE_LABEL: Record<string, string> = {
  physical: '实体仓',
  raw_material: '原料仓',
  finished: '成品仓',
  virtual: '虚拟仓',
  transit: '在途仓',
};

const WAREHOUSE_TYPE_OPTIONS = [
  { value: 'physical', label: '实体仓' },
  { value: 'raw_material', label: '原料仓' },
  { value: 'finished', label: '成品仓' },
  { value: 'virtual', label: '虚拟仓' },
  { value: 'transit', label: '在途仓' },
];

const LOCATION_TYPE_LABEL: Record<LocationType, string> = {
  general: '通用库位',
  zone: '库区',
  rack: '货架',
  shelf: '货架层',
  bin: '货架格',
};

const LOCATION_TYPE_OPTIONS = [
  { value: 'general', label: '通用库位' },
  { value: 'zone', label: '库区' },
  { value: 'rack', label: '货架' },
  { value: 'shelf', label: '货架层' },
  { value: 'bin', label: '货架格' },
];

const LOCATION_TYPE_GUIDE: Record<LocationType, string> = {
  general: '通用库位：不做货架细分时使用，可只维护库位编码与名称。',
  zone: '库区：建议作为区域级节点（如 A 区、B 区），通常不填货架坐标。',
  rack: '货架：建议至少填写巷道编码 + 货架编码。',
  shelf: '货架层：建议填写巷道编码 + 货架编码 + 层编码。',
  bin: '货架格：建议填写完整坐标（巷道 + 货架 + 层 + 格）。',
};

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function formatRackCoordinate(item: LocationOption): string {
  const tokens = [
    item.aisleCode ? `巷道:${item.aisleCode}` : null,
    item.rackCode ? `架:${item.rackCode}` : null,
    item.shelfCode ? `层:${item.shelfCode}` : null,
    item.binCode ? `格:${item.binCode}` : null,
  ].filter(Boolean);
  return tokens.length > 0 ? tokens.join(' / ') : '-';
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

export default function WarehouseLocationPage() {
  const { setPageTitle } = useAppStore();
  const { can } = usePermission();
  const [messageApi, contextHolder] = message.useMessage();
  const [activeTab, setActiveTab] = useState<MasterDataTab>('warehouse');
  const [onlyActive, setOnlyActive] = useState(true);
  const [locationWarehouseId, setLocationWarehouseId] = useState<number | undefined>(undefined);
  const [warehouseModalOpen, setWarehouseModalOpen] = useState(false);
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<WarehouseOption | null>(null);
  const [editingLocation, setEditingLocation] = useState<LocationOption | null>(null);
  const [warehouseUploadFiles, setWarehouseUploadFiles] = useState<UploadFile[]>([]);
  const [locationUploadFiles, setLocationUploadFiles] = useState<UploadFile[]>([]);
  const [selectedLocationRowKeys, setSelectedLocationRowKeys] = useState<number[]>([]);
  const [isBarcodePrinting, setIsBarcodePrinting] = useState(false);
  const printWindowRef = useRef<Window | null>(null);

  const [warehouseForm] = Form.useForm<WarehouseFormValues>();
  const [locationForm] = Form.useForm<LocationFormValues>();
  const currentLocationType = (Form.useWatch('locationType', locationForm) ?? 'general') as LocationType;
  const needAisle = currentLocationType === 'rack' || currentLocationType === 'shelf' || currentLocationType === 'bin';
  const needRack = currentLocationType === 'rack' || currentLocationType === 'shelf' || currentLocationType === 'bin';
  const needShelf = currentLocationType === 'shelf' || currentLocationType === 'bin';
  const needBin = currentLocationType === 'bin';

  const { data: warehouseOptions = [] } = useWarehouseOptions(onlyActive);
  const { data: allWarehouseOptions = [] } = useWarehouseOptions(false);
  const { data: locationOptions = [] } = useLocationOptions(locationWarehouseId, onlyActive);

  const importWarehouses = useImportWarehousesCsv();
  const importLocations = useImportLocationsCsv();
  const createWarehouse = useCreateWarehouse();
  const updateWarehouse = useUpdateWarehouse();
  const deleteWarehouse = useDeleteWarehouse();
  const createLocation = useCreateLocation();
  const updateLocation = useUpdateLocation();
  const deleteLocation = useDeleteLocation();

  const canManage = useMemo(
    () => can(ACTION_CODES.WAREHOUSE_LOCATION_MANAGE),
    [can],
  );

  const canImport = useMemo(
    () => can(ACTION_CODES.WAREHOUSE_LOCATION_IMPORT),
    [can],
  );

  const isBusy = importWarehouses.isPending
    || importLocations.isPending
    || createWarehouse.isPending
    || updateWarehouse.isPending
    || deleteWarehouse.isPending
    || createLocation.isPending
    || updateLocation.isPending
    || deleteLocation.isPending;

  useEffect(() => {
    setPageTitle('仓库库位配置');
  }, [setPageTitle]);

  useEffect(() => {
    if (activeTab !== 'location') {
      setSelectedLocationRowKeys([]);
    }
  }, [activeTab]);

  const locationWarehouseCodeMap = useMemo(() => {
    return new Map(allWarehouseOptions.map((item) => [item.id, item.code]));
  }, [allWarehouseOptions]);

  const selectedLocations = useMemo(() => {
    if (selectedLocationRowKeys.length === 0) return [];
    const keySet = new Set(selectedLocationRowKeys);
    return locationOptions.filter((item) => keySet.has(item.id));
  }, [locationOptions, selectedLocationRowKeys]);

  const openCreateWarehouse = () => {
    setEditingWarehouse(null);
    warehouseForm.setFieldsValue({
      code: '',
      name: '',
      type: 'physical',
      status: 'active',
      plantCode: '',
    });
    setWarehouseModalOpen(true);
  };

  const openEditWarehouse = (item: WarehouseOption) => {
    setEditingWarehouse(item);
    warehouseForm.setFieldsValue({
      code: item.code,
      name: item.name,
      type: item.type ?? 'physical',
      status: (item.status as MasterDataStatus) ?? 'active',
      plantCode: item.plantCode ?? '',
    });
    setWarehouseModalOpen(true);
  };

  const openCreateLocation = () => {
    setEditingLocation(null);
    locationForm.setFieldsValue({
      warehouseId: allWarehouseOptions[0]?.id,
      code: '',
      name: '',
      locationType: 'general',
      aisleCode: '',
      rackCode: '',
      shelfCode: '',
      binCode: '',
      level: 1,
      status: 'active',
    });
    setLocationModalOpen(true);
  };

  const openEditLocation = (item: LocationOption) => {
    setEditingLocation(item);
    locationForm.setFieldsValue({
      warehouseId: item.warehouseId,
      code: item.code,
      name: item.name,
      locationType: item.locationType ?? 'general',
      aisleCode: item.aisleCode ?? '',
      rackCode: item.rackCode ?? '',
      shelfCode: item.shelfCode ?? '',
      binCode: item.binCode ?? '',
      level: item.level,
      status: (item.status as MasterDataStatus) ?? 'active',
    });
    setLocationModalOpen(true);
  };

  const handleWarehouseSubmit = async () => {
    if (!canManage) {
      messageApi.error('当前账号无编辑权限');
      return;
    }
    try {
      const values = await warehouseForm.validateFields();
      const payload = {
        code: values.code.trim().toUpperCase(),
        name: values.name.trim(),
        type: values.type?.trim() || undefined,
        status: values.status,
        plantCode: values.plantCode?.trim() || undefined,
      };
      if (editingWarehouse) {
        await updateWarehouse.mutateAsync({ id: editingWarehouse.id, payload });
        messageApi.success('仓库更新成功');
      } else {
        await createWarehouse.mutateAsync(payload);
        messageApi.success('仓库新增成功');
      }
      setWarehouseModalOpen(false);
      setEditingWarehouse(null);
      warehouseForm.resetFields();
    } catch (err) {
      if (err instanceof Error && err.message.includes('validation')) return;
      messageApi.error(getErrorMessage(err, '保存仓库失败'));
    }
  };

  const handleLocationSubmit = async () => {
    if (!canManage) {
      messageApi.error('当前账号无编辑权限');
      return;
    }
    try {
      const values = await locationForm.validateFields();
      const payload = {
        warehouseId: Number(values.warehouseId),
        code: values.code.trim().toUpperCase(),
        name: values.name.trim(),
        locationType: values.locationType,
        aisleCode: values.aisleCode?.trim().toUpperCase() || undefined,
        rackCode: values.rackCode?.trim().toUpperCase() || undefined,
        shelfCode: values.shelfCode?.trim().toUpperCase() || undefined,
        binCode: values.binCode?.trim().toUpperCase() || undefined,
        level: Number(values.level || 1),
        status: values.status,
      };
      if (editingLocation) {
        await updateLocation.mutateAsync({ id: editingLocation.id, payload });
        messageApi.success('库位更新成功');
      } else {
        await createLocation.mutateAsync(payload);
        messageApi.success('库位新增成功');
      }
      setLocationModalOpen(false);
      setEditingLocation(null);
      locationForm.resetFields();
    } catch (err) {
      if (err instanceof Error && err.message.includes('validation')) return;
      messageApi.error(getErrorMessage(err, '保存库位失败'));
    }
  };

  const handleDeleteWarehouse = async (item: WarehouseOption) => {
    if (!canManage) {
      messageApi.error('当前账号无编辑权限');
      return;
    }
    try {
      await deleteWarehouse.mutateAsync(item.id);
      messageApi.success(`仓库 ${item.code} 已删除`);
    } catch (err) {
      messageApi.error(getErrorMessage(err, '删除仓库失败'));
    }
  };

  const handleDeleteLocation = async (item: LocationOption) => {
    if (!canManage) {
      messageApi.error('当前账号无编辑权限');
      return;
    }
    try {
      await deleteLocation.mutateAsync(item.id);
      messageApi.success(`库位 ${item.code} 已删除`);
    } catch (err) {
      messageApi.error(getErrorMessage(err, '删除库位失败'));
    }
  };

  const handleImport = async () => {
    const fileObj = activeTab === 'warehouse'
      ? warehouseUploadFiles[0]?.originFileObj
      : locationUploadFiles[0]?.originFileObj;
    const file = fileObj instanceof File ? fileObj : null;
    if (!file) {
      messageApi.warning('请先选择 CSV 文件');
      return;
    }
    if (!canImport) {
      messageApi.error('导入权限仅限老板/主管');
      return;
    }
    try {
      const result = activeTab === 'warehouse'
        ? await importWarehouses.mutateAsync(file)
        : await importLocations.mutateAsync(file);
      messageApi.success(`导入完成：成功 ${result.successCount} 条，失败 ${result.failCount} 条`);
      if (activeTab === 'warehouse') {
        setWarehouseUploadFiles([]);
      } else {
        setLocationUploadFiles([]);
      }
    } catch (err) {
      messageApi.error(getErrorMessage(err, '导入失败'));
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      if (activeTab === 'warehouse') {
        await inventoryApi.downloadWarehouseImportTemplateCsv();
      } else {
        await inventoryApi.downloadLocationImportTemplateCsv();
      }
      messageApi.success('模板下载完成');
    } catch (err) {
      messageApi.error(getErrorMessage(err, '模板下载失败'));
    }
  };

  const handlePrintLocationBarcodes = async (items: LocationOption[]) => {
    if (isBarcodePrinting) {
      messageApi.info('条码正在生成，请稍候');
      return;
    }
    if (items.length === 0) {
      messageApi.warning('请先选择需要打印条码的库位');
      return;
    }

    let printWindow = printWindowRef.current;
    if (!printWindow || printWindow.closed) {
      printWindow = window.open('', '_blank', 'width=1100,height=800');
      if (!printWindow) {
        messageApi.warning('浏览器阻止了打印窗口，请允许弹窗后重试');
        return;
      }
      printWindowRef.current = printWindow;
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

    setIsBarcodePrinting(true);
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
          warehouseCode,
          locationCode,
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
      // Safari/WebView may resolve document after a short delay; retry a few times.
      let retryCount = 0;
      const bindRetryTimer = window.setInterval(() => {
        retryCount += 1;
        bindToolbarEvents();
        if (retryCount >= 20) {
          window.clearInterval(bindRetryTimer);
        }
      }, 120);
      window.setTimeout(() => window.clearInterval(bindRetryTimer), 3000);
      messageApi.success(`已打开 ${items.length} 条库位条码打印页，请在页面中点击“立即打印”`);
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
      messageApi.error(getErrorMessage(err, '生成库位条码失败'));
    } finally {
      setIsBarcodePrinting(false);
    }
  };

  const warehouseColumns: ColumnsType<WarehouseOption> = [
    { title: '编码', dataIndex: 'code', key: 'code', width: 160 },
    { title: '名称', dataIndex: 'name', key: 'name', width: 220 },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 160,
      render: (value: string | null) => (value ? (WAREHOUSE_TYPE_LABEL[value] ?? value) : '-'),
    },
    { title: '厂区编码', dataIndex: 'plantCode', key: 'plantCode', width: 160 },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (value: string) => {
        const status = (value as MasterDataStatus) ?? 'active';
        return <Tag color={STATUS_COLOR[status]}>{STATUS_LABEL[status] ?? value}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      fixed: 'right',
      render: (_: unknown, record) => (
        <Space>
          <Button size="small" onClick={() => openEditWarehouse(record)} disabled={!canManage}>
            编辑
          </Button>
          <Popconfirm
            title={`确认删除仓库 ${record.code} 吗？`}
            description="删除前会校验引用关系。"
            okText="确认"
            cancelText="取消"
            onConfirm={() => void handleDeleteWarehouse(record)}
            disabled={!canManage || record.code === 'DEFAULT'}
          >
            <Button size="small" danger disabled={!canManage || record.code === 'DEFAULT'}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const locationColumns: ColumnsType<LocationOption> = [
    {
      title: '仓库',
      key: 'warehouse',
      width: 180,
      render: (_: unknown, record) => locationWarehouseCodeMap.get(record.warehouseId) ?? `#${record.warehouseId}`,
    },
    { title: '库位编码', dataIndex: 'code', key: 'code', width: 170 },
    { title: '库位名称', dataIndex: 'name', key: 'name', width: 220 },
    {
      title: '库位类型',
      dataIndex: 'locationType',
      key: 'locationType',
      width: 130,
      render: (value: LocationType) => LOCATION_TYPE_LABEL[value] ?? value,
    },
    {
      title: '货架坐标',
      key: 'rackCoordinate',
      width: 260,
      render: (_: unknown, record) => formatRackCoordinate(record),
    },
    { title: '层级', dataIndex: 'level', key: 'level', width: 100 },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (value: string) => {
        const status = (value as MasterDataStatus) ?? 'active';
        return <Tag color={STATUS_COLOR[status]}>{STATUS_LABEL[status] ?? value}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 270,
      fixed: 'right',
      render: (_: unknown, record) => (
        <Space>
          <Button size="small" disabled={isBarcodePrinting} onClick={() => void handlePrintLocationBarcodes([record])}>
            打印条码
          </Button>
          <Button size="small" onClick={() => openEditLocation(record)} disabled={!canManage}>
            编辑
          </Button>
          <Popconfirm
            title={`确认删除库位 ${record.code} 吗？`}
            description="删除前会校验引用关系。"
            okText="确认"
            cancelText="取消"
            onConfirm={() => void handleDeleteLocation(record)}
            disabled={!canManage || record.code === 'DEFAULT-UNKNOWN'}
          >
            <Button size="small" danger disabled={!canManage || record.code === 'DEFAULT-UNKNOWN'}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      {contextHolder}

      <div className={styles.pageHeader}>
        <Typography.Title level={3} className={styles.title}>
          仓库与库位配置
        </Typography.Title>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as MasterDataTab)}
        items={[
          { key: 'warehouse', label: '仓库主数据' },
          { key: 'location', label: '库位主数据' },
        ]}
      />

      <Card className={styles.guideCard} title="库位/货架配置规则（固定说明）" size="small">
        <Alert
          type="info"
          showIcon
          message="关系：库位（总称） > 库区（zone） > 货架（rack） > 货架层（shelf） > 货架格（bin）"
          description="巷道是坐标维度，不是独立层级节点。建议维护顺序：先建库区，再建货架，再建货架层/货架格。"
        />
        <div className={styles.guideList}>
          <Typography.Text>具体规则：</Typography.Text>
          <ol>
            <li>类型=库区（zone）：坐标可留空。</li>
            <li>类型=货架（rack）：巷道编码、货架编码必填。</li>
            <li>类型=货架层（shelf）：巷道编码、货架编码、货架层编码必填。</li>
            <li>类型=货架格（bin）：巷道编码、货架编码、货架层编码、货架格编码全部必填。</li>
            <li>编码建议统一大写，例如 A / 01 / 02 / 03；可拼为库位编码 A-01-02-03。</li>
          </ol>
        </div>
      </Card>

      <Card className={styles.toolbarCard}>
        <Space wrap size={12}>
          <Radio.Group
            value={onlyActive ? 'active' : 'all'}
            onChange={(e) => setOnlyActive(e.target.value === 'active')}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="active">仅启用</Radio.Button>
            <Radio.Button value="all">全部状态</Radio.Button>
          </Radio.Group>

          {activeTab === 'location' && (
            <>
              <Select
                allowClear
                placeholder="筛选仓库"
                style={{ width: 240 }}
                value={locationWarehouseId}
                onChange={(value) => setLocationWarehouseId(value)}
                options={allWarehouseOptions.map((w) => ({
                  value: w.id,
                  label: `${w.code} · ${w.name}`,
                }))}
              />
              <Button
                loading={isBarcodePrinting}
                disabled={selectedLocations.length === 0 || isBarcodePrinting}
                onClick={() => void handlePrintLocationBarcodes(selectedLocations)}
              >
                批量打印条码
              </Button>
            </>
          )}

          {activeTab === 'warehouse' ? (
            <Button type="primary" onClick={openCreateWarehouse} disabled={!canManage}>
              新增仓库
            </Button>
          ) : (
            <Button type="primary" onClick={openCreateLocation} disabled={!canManage}>
              新增库位
            </Button>
          )}
        </Space>
      </Card>

      <Card title={activeTab === 'warehouse' ? '仓库 CSV 导入' : '库位 CSV 导入'}>
        <Space wrap size={12}>
          <Upload
            accept=".csv,text/csv"
            maxCount={1}
            beforeUpload={() => false}
            fileList={activeTab === 'warehouse' ? warehouseUploadFiles : locationUploadFiles}
            onChange={(info) => {
              if (activeTab === 'warehouse') {
                setWarehouseUploadFiles(info.fileList.slice(-1));
              } else {
                setLocationUploadFiles(info.fileList.slice(-1));
              }
            }}
          >
            <Button>选择 CSV</Button>
          </Upload>
          <Button onClick={() => void handleDownloadTemplate()}>下载模板</Button>
          <Button type="primary" loading={isBusy} onClick={() => void handleImport()} disabled={!canImport}>
            上传导入
          </Button>
        </Space>
        {!canManage && (
          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            message="当前账号仅可查看，不可新增/编辑/删除。"
          />
        )}
      </Card>

      <Card bodyStyle={{ padding: 0 }}>
        {activeTab === 'warehouse' ? (
          <Table
            rowKey="id"
            columns={warehouseColumns}
            dataSource={warehouseOptions}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            scroll={{ x: 900 }}
          />
        ) : (
          <Table
            rowKey="id"
            columns={locationColumns}
            dataSource={locationOptions}
            rowSelection={{
              selectedRowKeys: selectedLocationRowKeys,
              onChange: (keys) => setSelectedLocationRowKeys(keys.map((key) => Number(key))),
            }}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            scroll={{ x: 1320 }}
          />
        )}
      </Card>

      <Modal
        open={warehouseModalOpen}
        title={editingWarehouse ? '编辑仓库' : '新增仓库'}
        onCancel={() => {
          setWarehouseModalOpen(false);
          setEditingWarehouse(null);
        }}
        onOk={() => void handleWarehouseSubmit()}
        okText={editingWarehouse ? '保存修改' : '确认新增'}
        cancelText="取消"
        confirmLoading={createWarehouse.isPending || updateWarehouse.isPending}
      >
        <Form form={warehouseForm} layout="vertical" initialValues={{ type: 'physical', status: 'active' }}>
          <Form.Item label="仓库编码" name="code" rules={[{ required: true, message: '请填写仓库编码' }]}>
            <Input placeholder="如：WH-MAIN" />
          </Form.Item>
          <Form.Item label="仓库名称" name="name" rules={[{ required: true, message: '请填写仓库名称' }]}>
            <Input placeholder="如：主仓库" />
          </Form.Item>
          <Form.Item label="仓库类型" name="type">
            <Select options={WAREHOUSE_TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select
              options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item label="厂区编码" name="plantCode">
            <Input placeholder="可选，如：PLANT-01" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={locationModalOpen}
        title={editingLocation ? '编辑库位' : '新增库位'}
        onCancel={() => {
          setLocationModalOpen(false);
          setEditingLocation(null);
        }}
        onOk={() => void handleLocationSubmit()}
        okText={editingLocation ? '保存修改' : '确认新增'}
        cancelText="取消"
        confirmLoading={createLocation.isPending || updateLocation.isPending}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="库位层级建议：库区 -> 货架 -> 货架层 -> 货架格"
          description={`当前类型说明：${LOCATION_TYPE_GUIDE[currentLocationType]}`}
        />
        <Form form={locationForm} layout="vertical" initialValues={{ level: 1, locationType: 'general', status: 'active' }}>
          <Form.Item label="所属仓库" name="warehouseId" rules={[{ required: true, message: '请选择仓库' }]}>
            <Select
              options={allWarehouseOptions.map((item) => ({
                value: item.id,
                label: `${item.code} · ${item.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item label="库位编码" name="code" rules={[{ required: true, message: '请填写库位编码' }]}>
            <Input placeholder="如：A-01" />
          </Form.Item>
          <Form.Item label="库位名称" name="name" rules={[{ required: true, message: '请填写库位名称' }]}>
            <Input placeholder="如：A区-01货架" />
          </Form.Item>
          <Form.Item label="库位类型" name="locationType" extra="按实际粒度选择，建议与层级关系保持一致。">
            <Select options={LOCATION_TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item
            label="巷道编码"
            name="aisleCode"
            extra="示例：A、B、C；货架/层/格必填。"
            rules={needAisle ? [{ required: true, message: '当前库位类型要求填写巷道编码' }] : []}
          >
            <Input placeholder="可选，如：A" />
          </Form.Item>
          <Form.Item
            label="货架编码"
            name="rackCode"
            extra="示例：01、R01；货架/层/格必填。"
            rules={needRack ? [{ required: true, message: '当前库位类型要求填写货架编码' }] : []}
          >
            <Input placeholder="可选，如：01" />
          </Form.Item>
          <Form.Item
            label="货架层编码"
            name="shelfCode"
            extra="示例：01、02；货架层/货架格必填。"
            rules={needShelf ? [{ required: true, message: '当前库位类型要求填写货架层编码' }] : []}
          >
            <Input placeholder="可选，如：02" />
          </Form.Item>
          <Form.Item
            label="货架格编码"
            name="binCode"
            extra="示例：001、A01；货架格必填。"
            rules={needBin ? [{ required: true, message: '当前库位类型要求填写货架格编码' }] : []}
          >
            <Input placeholder="可选，如：03" />
          </Form.Item>
          <Form.Item label="层级" name="level">
            <InputNumber min={1} max={9} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select
              options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
