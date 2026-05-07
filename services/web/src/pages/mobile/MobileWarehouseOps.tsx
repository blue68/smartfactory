import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import QrScanner from 'qr-scanner';
import Button from '@/components/common/Button';
import { useAppStore } from '@/stores/appStore';
import { useWarehouseOptions, useLocationOptions, inventoryApi } from '@/api/inventory';
import { useSkuList } from '@/api/sku';
import { usePurchaseDeliveryList, usePurchaseReceiptList } from '@/api/purchase';
import {
  useStocktakingList,
  useStocktakingDetail,
  useUpdateStocktakingItems,
  useSubmitStocktaking,
} from '@/api/stocktaking';
import { TransactionType } from '@/types/enums';
import styles from './MobileOpsPage.module.css';
import { decodeQrImage, parseWarehouseScanPayload } from './mobileScanUtils';

type WarehousePanelMode = 'list' | 'inbound' | 'stocktaking' | 'scan';

interface MobileWarehouseOpsProps {
  mode: WarehousePanelMode;
  stocktakingId?: number | null;
}

interface WarehouseInboundForm {
  keyword: string;
  skuId: string;
  qty: string;
  warehouseId: string;
  locationId: string;
  dyeLotNo: string;
}

interface StocktakingDraftMap {
  [skuId: number]: string;
}

interface WarehouseScanDraft {
  keyword: string;
  skuId: string;
  dyeLotNo: string;
  deliveryNo: string;
}

const STOCKTAKING_STATUS_LABEL: Record<string, string> = {
  draft: '待开始',
  in_progress: '盘点中',
  submitted: '待确认',
  confirmed: '已确认',
};

function clampPositiveNumberString(value: string): string {
  return value.replace(/[^\d.]/g, '');
}

function formatDateLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()} ${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}`;
}

function getStocktakingStatusLabel(status?: string | null): string {
  if (!status) return '未知状态';
  return STOCKTAKING_STATUS_LABEL[status] ?? status;
}

function WarehouseListPanel() {
  const navigate = useNavigate();
  const deliveriesQuery = usePurchaseDeliveryList({ status: 'pending', page: 1, pageSize: 6 });
  const receiptsQuery = usePurchaseReceiptList({ page: 1, pageSize: 6 });
  const stocktakingListQuery = useStocktakingList(1, 10);
  const deliveries = deliveriesQuery.data?.list ?? [];
  const receipts = receiptsQuery.data?.list ?? [];
  const stocktakingTasks = stocktakingListQuery.data?.list ?? [];

  return (
    <div className={styles.panelStack}>
      <section className={styles.sectionBand}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>仓库快捷入口</h2>
            <p className={styles.sectionHint}>把来料入库和盘点处理拆成独立页面，现场操作更快。</p>
          </div>
          <span className={styles.metricPill}>{deliveries.length + stocktakingTasks.length} 项待办</span>
        </div>
        <div className={styles.actionRow}>
          <Button
            variant="primary"
            size="md"
            fullWidth
            data-testid="mobile-warehouse-inbound-entry"
            onClick={() => navigate('/m/warehouse/inbound')}
          >
            来料入库
          </Button>
          <Button
            variant="secondary"
            size="md"
            fullWidth
            data-testid="mobile-warehouse-scan-entry"
            onClick={() => navigate('/m/warehouse/scan')}
          >
            扫码收货
          </Button>
        </div>
        <div className={styles.listStack}>
          {stocktakingTasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className={styles.taskCard}
              data-testid={`mobile-warehouse-stocktaking-card-${task.id}`}
              onClick={() => navigate(`/m/warehouse/stocktaking/${task.id}`)}
            >
              <div className={styles.taskCardTop}>
                <strong>{task.taskNo}</strong>
                <span className={styles.statusTag}>{getStocktakingStatusLabel(task.status)}</span>
              </div>
              <div className={styles.taskMetaRow}>
                <span>盘点范围 {task.scope || '全仓'}</span>
                <span>{task.totalItems || 0} 项</span>
              </div>
              <div className={styles.inlineMeta}>
                <span>{task.diffItems || 0} 项差异</span>
                <span>进入盘点页</span>
              </div>
            </button>
          ))}
          {!stocktakingTasks.length && <div className={styles.emptyBlock}>当前没有待处理的盘点任务。</div>}
        </div>
      </section>

      <section className={styles.sectionBand}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>待收货来料</h2>
            <p className={styles.sectionHint}>到货后直接进入入库页，快速完成仓位和数量录入。</p>
          </div>
          <span className={styles.metricPill}>{deliveriesQuery.data?.total ?? 0} 单</span>
        </div>
        <div className={styles.listStack}>
          {deliveries.slice(0, 4).map((delivery) => (
            <button
              key={delivery.id}
              type="button"
              className={styles.taskCard}
              data-testid={`mobile-warehouse-delivery-card-${delivery.id}`}
              onClick={() => navigate('/m/warehouse/inbound')}
            >
              <div className={styles.taskCardTop}>
                <strong>{delivery.deliveryNo}</strong>
                <span className={styles.statusTag}>{String(delivery.status ?? '待处理')}</span>
              </div>
              <div className={styles.taskMetaRow}>
                <span>{String(delivery.supplierName ?? '供应商')}</span>
                <span>{formatDateLabel(String(delivery.deliveryDate ?? ''))}</span>
              </div>
              <div className={styles.inlineMeta}>
                <span>进入入库页</span>
                <span>按来料清单录入</span>
              </div>
            </button>
          ))}
          {!deliveries.length && <div className={styles.emptyBlock}>当前没有待收货来料。</div>}
        </div>
      </section>

      <section className={styles.sectionBand}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>最近入库</h2>
            <p className={styles.sectionHint}>快速确认最近一笔收货已进库。</p>
          </div>
        </div>
        <div className={styles.infoGrid}>
          <div className={styles.infoCard}>
            <span>最近入库单</span>
            <strong>{receipts[0]?.receiptNo ?? '—'}</strong>
          </div>
          <div className={styles.infoCard}>
            <span>待质检送货</span>
            <strong>{deliveriesQuery.data?.total ?? 0}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}

function WarehouseInboundPanel({
  initialScanDraft,
}: {
  initialScanDraft?: WarehouseScanDraft | null;
}) {
  const navigate = useNavigate();
  const showToast = useAppStore((state) => state.showToast);
  const { data: warehouseOptions = [] } = useWarehouseOptions(true);
  const [inboundForm, setInboundForm] = useState<WarehouseInboundForm>({
    keyword: '',
    skuId: '',
    qty: '',
    warehouseId: '',
    locationId: '',
    dyeLotNo: '',
  });
  const skuQuery = useSkuList({
    page: 1,
    pageSize: 20,
    keyword: inboundForm.keyword || undefined,
  });
  const { data: locationOptions = [] } = useLocationOptions(
    inboundForm.warehouseId ? Number(inboundForm.warehouseId) : undefined,
    true,
  );
  const deliveriesQuery = usePurchaseDeliveryList({ status: 'pending', page: 1, pageSize: 6 });
  const selectedInboundSku = (skuQuery.data?.list ?? []).find((sku) => String(sku.id) === inboundForm.skuId) ?? null;
  const [submittingInbound, setSubmittingInbound] = useState(false);

  useEffect(() => {
    if (!warehouseOptions.length || inboundForm.warehouseId) return;
    setInboundForm((current) => ({ ...current, warehouseId: String(warehouseOptions[0].id) }));
  }, [inboundForm.warehouseId, warehouseOptions]);

  useEffect(() => {
    if (!locationOptions.length || inboundForm.locationId) return;
    setInboundForm((current) => ({ ...current, locationId: String(locationOptions[0].id) }));
  }, [inboundForm.locationId, locationOptions]);

  useEffect(() => {
    if (!initialScanDraft) return;
    setInboundForm((current) => ({
      ...current,
      keyword: initialScanDraft.keyword || current.keyword,
      skuId: initialScanDraft.skuId || current.skuId,
      dyeLotNo: initialScanDraft.dyeLotNo || current.dyeLotNo,
    }));
    if (initialScanDraft.deliveryNo) {
      showToast({ type: 'info', message: `已识别送货单 ${initialScanDraft.deliveryNo}，请确认物料和仓位后入库` });
    }
  }, [initialScanDraft, showToast]);

  const handleInboundSubmit = async () => {
    if (!inboundForm.skuId || !inboundForm.qty || !inboundForm.warehouseId || !inboundForm.locationId) {
      showToast({ type: 'warning', message: '请先选择物料、数量、仓库和库位' });
      return;
    }
    try {
      setSubmittingInbound(true);
      await inventoryApi.inbound({
        skuCode: selectedInboundSku?.skuCode ?? '',
        skuId: Number(inboundForm.skuId),
        qtyInput: inboundForm.qty,
        inputUnit: selectedInboundSku?.stockUnit ?? selectedInboundSku?.purchaseUnit ?? '件',
        warehouseId: Number(inboundForm.warehouseId),
        locationId: Number(inboundForm.locationId),
        dyeLotNo: inboundForm.dyeLotNo || undefined,
        transactionType: TransactionType.PURCHASE_IN,
      });
      showToast({ type: 'success', message: '移动端入库已提交' });
      setInboundForm((current) => ({
        ...current,
        skuId: '',
        qty: '',
        dyeLotNo: '',
      }));
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message || '入库失败' });
    } finally {
      setSubmittingInbound(false);
    }
  };

  return (
    <div className={styles.panelStack}>
      <section className={styles.sectionBand}>
        <div className={styles.detailTopBar}>
          <Button variant="ghost" size="sm" onClick={() => navigate('/m/warehouse')}>
            返回仓库主页
          </Button>
          <span className={styles.metricPill}>来料入库</span>
        </div>
        <div className={styles.actionRow}>
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            data-testid="mobile-warehouse-scan-inline-entry"
            onClick={() => navigate('/m/warehouse/scan')}
          >
            扫码回填物料
          </Button>
        </div>
        <div className={styles.formBlock}>
          <div className={styles.formTitle}>收货录入</div>
          <label className={styles.fieldLabel}>
            <span>物料检索</span>
            <input
              data-testid="mobile-inbound-keyword"
              value={inboundForm.keyword}
              onChange={(event) => setInboundForm((current) => ({ ...current, keyword: event.target.value }))}
              placeholder="SKU 编码 / 名称"
            />
          </label>
          <label className={styles.fieldLabel}>
            <span>物料</span>
            <select
              data-testid="mobile-inbound-sku"
              value={inboundForm.skuId}
              onChange={(event) => setInboundForm((current) => ({ ...current, skuId: event.target.value }))}
            >
              <option value="">请选择物料</option>
              {(skuQuery.data?.list ?? []).map((sku) => (
                <option key={sku.id} value={sku.id}>
                  {sku.skuCode} · {sku.name}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.formGrid2}>
            <label className={styles.fieldLabel}>
              <span>入库数量</span>
              <input
                data-testid="mobile-inbound-qty"
                value={inboundForm.qty}
                onChange={(event) => setInboundForm((current) => ({ ...current, qty: clampPositiveNumberString(event.target.value) }))}
                inputMode="decimal"
              />
            </label>
            <label className={styles.fieldLabel}>
              <span>缸号/批次</span>
              <input
                value={inboundForm.dyeLotNo}
                onChange={(event) => setInboundForm((current) => ({ ...current, dyeLotNo: event.target.value }))}
                placeholder="可选"
              />
            </label>
          </div>
          <div className={styles.formGrid2}>
            <label className={styles.fieldLabel}>
              <span>仓库</span>
              <select
                value={inboundForm.warehouseId}
                onChange={(event) => setInboundForm((current) => ({
                  ...current,
                  warehouseId: event.target.value,
                  locationId: '',
                }))}
              >
                <option value="">请选择仓库</option>
                {warehouseOptions.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                ))}
              </select>
            </label>
            <label className={styles.fieldLabel}>
              <span>库位</span>
              <select
                value={inboundForm.locationId}
                onChange={(event) => setInboundForm((current) => ({ ...current, locationId: event.target.value }))}
              >
                <option value="">请选择库位</option>
                {locationOptions.map((location) => (
                  <option key={location.id} value={location.id}>{location.code} · {location.name}</option>
                ))}
              </select>
            </label>
          </div>
          <Button
            variant="primary"
            size="md"
            fullWidth
            data-testid="mobile-inbound-submit"
            loading={submittingInbound}
            onClick={() => void handleInboundSubmit()}
          >
            确认入库
          </Button>
        </div>
        <div className={styles.listStack}>
          {(deliveriesQuery.data?.list ?? []).slice(0, 3).map((delivery) => (
            <div key={delivery.id} className={styles.summaryCard}>
              <div className={styles.taskCardTop}>
                <strong>{delivery.deliveryNo}</strong>
                <span className={styles.statusTag}>{String(delivery.status ?? '待处理')}</span>
              </div>
              <div className={styles.taskMetaRow}>
                <span>{String(delivery.supplierName ?? '供应商')}</span>
                <span>{formatDateLabel(String(delivery.deliveryDate ?? ''))}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function WarehouseScanPanel() {
  const navigate = useNavigate();
  const showToast = useAppStore((state) => state.showToast);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handledRef = useRef(false);
  const [manualPayload, setManualPayload] = useState('');
  const [imageDecodeName, setImageDecodeName] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  const resolvePayload = useCallback((payload: string) => {
    if (handledRef.current) return;
    const parsed = parseWarehouseScanPayload(payload);
    if (!parsed) {
      setScanError('未识别到有效的物料标签，请确认二维码或条码内容是否完整。');
      return;
    }
    handledRef.current = true;
    const search = new URLSearchParams();
    if (parsed.keyword) search.set('keyword', parsed.keyword);
    if (parsed.skuId) search.set('skuId', parsed.skuId);
    if (parsed.dyeLotNo) search.set('dyeLotNo', parsed.dyeLotNo);
    if (parsed.deliveryNo) search.set('deliveryNo', parsed.deliveryNo);
    navigate(`/m/warehouse/inbound?${search.toString()}`, { replace: true });
  }, [navigate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    let cancelled = false;
    const scanner = new QrScanner(video, (result) => {
      if (cancelled) return;
      resolvePayload(result.data);
    }, {
      preferredCamera: 'environment',
      highlightScanRegion: true,
      highlightCodeOutline: true,
      returnDetailedScanResult: true,
      onDecodeError: (error) => {
        if (`${error}` === QrScanner.NO_QR_CODE_FOUND) return;
        if (!cancelled) {
          setScanError('扫码失败，请将来料标签移入取景框中心后重试。');
        }
      },
    });

    void (async () => {
      try {
        const hasCamera = await QrScanner.hasCamera();
        if (!hasCamera) {
          setScanError('当前设备未检测到摄像头，可改用拍照识别或手动粘贴标签内容。');
          return;
        }
        await scanner.start();
        if (!cancelled) {
          setCameraReady(true);
          setScanError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setScanError((error as Error).message || '无法打开摄像头，请检查浏览器相机权限。');
        }
      }
    })();

    return () => {
      cancelled = true;
      scanner.destroy();
    };
  }, [resolvePayload]);

  return (
    <div className={styles.panelStack}>
      <section className={styles.sectionBand}>
        <div className={styles.detailTopBar}>
          <Button variant="ghost" size="sm" onClick={() => navigate('/m/warehouse')}>
            返回仓库主页
          </Button>
          <span className={styles.metricPill}>扫码收货</span>
        </div>
        <div className={styles.formBlock}>
          <div className={styles.formTitle}>扫描来料标签</div>
          <p className={styles.sectionHint}>支持识别 SKU 编码、送货单号和自定义二维码键值，识别后自动带入入库页。</p>
          <div className={styles.scanViewport}>
            <video ref={videoRef} className={styles.scanVideo} muted playsInline />
          </div>
          <div className={styles.inlineMeta}>
            <span>{cameraReady ? '摄像头已就绪，请对准来料标签' : '正在尝试打开摄像头'}</span>
            <span>支持二维码与条码文本</span>
          </div>
          {scanError && <div className={styles.inlineWarning} role="alert">{scanError}</div>}
        </div>
        <div className={styles.formBlock}>
          <div className={styles.formTitle}>拍照或手动解析</div>
          <label className={styles.fieldLabel}>
            <span>拍照识别</span>
            <input
              data-testid="mobile-warehouse-scan-image-input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setImageDecodeName(file.name);
                void (async () => {
                  try {
                    const result = await decodeQrImage(file);
                    resolvePayload(result);
                  } catch (error) {
                    setScanError((error as Error).message || '未能识别图片中的来料标签，请换一张更清晰的照片。');
                  } finally {
                    event.target.value = '';
                  }
                })();
              }}
            />
          </label>
          <div className={styles.inlineMeta}>
            <span>{imageDecodeName ? `最近识别图片：${imageDecodeName}` : '支持直接拍照或从相册选择来料标签图片'}</span>
            <span>适用于手机浏览器无摄像头流权限时的兼容兜底</span>
          </div>
          <label className={styles.fieldLabel}>
            <span>标签内容</span>
            <textarea
              data-testid="mobile-warehouse-scan-manual-input"
              rows={3}
              value={manualPayload}
              onChange={(event) => setManualPayload(event.target.value)}
              placeholder="粘贴标签内容，例如 SMART_FACTORY_SKU|SKU_CODE=RM-901|DYE_LOT=LOT-01"
            />
          </label>
          <Button
            variant="secondary"
            size="md"
            fullWidth
            data-testid="mobile-warehouse-scan-manual-submit"
            onClick={() => {
              if (!manualPayload.trim()) {
                showToast({ type: 'warning', message: '请先粘贴标签内容' });
                return;
              }
              resolvePayload(manualPayload);
            }}
          >
            解析标签
          </Button>
        </div>
      </section>
    </div>
  );
}

function WarehouseStocktakingPanel({ stocktakingId }: { stocktakingId: number }) {
  const navigate = useNavigate();
  const showToast = useAppStore((state) => state.showToast);
  const stocktakingDetailQuery = useStocktakingDetail(stocktakingId);
  const stocktakingItems = useMemo(
    () => stocktakingDetailQuery.data?.items ?? [],
    [stocktakingDetailQuery.data?.items],
  );
  const updateStocktakingItems = useUpdateStocktakingItems(stocktakingId);
  const submitStocktaking = useSubmitStocktaking();
  const stocktakingTask = stocktakingDetailQuery.data?.task ?? null;
  const [stocktakingDrafts, setStocktakingDrafts] = useState<StocktakingDraftMap>({});
  const isReadonly = stocktakingTask?.status === 'confirmed' || stocktakingTask?.status === 'cancelled';

  useEffect(() => {
    setStocktakingDrafts((current) => {
      const nextDrafts: StocktakingDraftMap = {};
      stocktakingItems.forEach((item) => {
        nextDrafts[item.skuId] = current[item.skuId] ?? item.actualQty ?? item.systemQty ?? '0';
      });
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(nextDrafts);
      const unchanged = currentKeys.length === nextKeys.length
        && nextKeys.every((key) => current[Number(key)] === nextDrafts[Number(key)]);
      return unchanged ? current : nextDrafts;
    });
  }, [stocktakingItems]);

  const handleSaveStocktaking = async () => {
    if (isReadonly) {
      showToast({ type: 'info', message: '当前盘点任务已锁定，仅支持查看明细' });
      return;
    }
    if (!stocktakingItems.length) {
      showToast({ type: 'warning', message: '当前没有可保存的盘点明细' });
      return;
    }
    try {
      await updateStocktakingItems.mutateAsync({
        items: stocktakingItems.map((item) => ({
          skuId: item.skuId,
          actualQty: stocktakingDrafts[item.skuId] ?? item.actualQty ?? item.systemQty,
        })),
      });
      showToast({ type: 'success', message: '盘点结果已保存' });
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message || '保存盘点失败' });
    }
  };

  const handleSubmitStocktaking = async () => {
    if (isReadonly) {
      showToast({ type: 'info', message: '当前盘点任务已锁定，仅支持查看明细' });
      return;
    }
    try {
      await submitStocktaking.mutateAsync(stocktakingId);
      showToast({ type: 'success', message: '盘点任务已提交确认' });
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message || '提交盘点失败' });
    }
  };

  return (
    <div className={styles.panelStack}>
      <section className={styles.sectionBand}>
        <div className={styles.detailTopBar}>
          <Button variant="ghost" size="sm" onClick={() => navigate('/m/warehouse')}>
            返回仓库主页
          </Button>
          <span className={styles.metricPill}>{getStocktakingStatusLabel(stocktakingTask?.status)}</span>
        </div>
        <div className={styles.detailHero}>
          <div>
            <h2 className={styles.sectionTitle}>{stocktakingTask?.taskNo || `盘点任务 #${stocktakingId}`}</h2>
            <p className={styles.sectionHint}>
              {isReadonly ? '该盘点任务已完成确认，当前仅支持查看明细。' : '手机端录入实盘数量后保存，再提交仓库确认。'}
            </p>
          </div>
        </div>
        <div className={styles.infoGrid}>
          <div className={styles.infoCard}>
            <span>盘点范围</span>
            <strong>{stocktakingTask?.scope || '全仓'}</strong>
          </div>
          <div className={styles.infoCard}>
            <span>盘点项目</span>
            <strong>{stocktakingTask?.totalItems || stocktakingItems.length}</strong>
          </div>
        </div>
      </section>

      <section className={styles.sectionBand}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>盘点明细</h2>
            <p className={styles.sectionHint}>按实际数量逐项录入，支持先保存草稿再提交确认。</p>
          </div>
        </div>
        <div className={styles.panelStack}>
          {stocktakingItems.map((item) => (
            <div key={item.id} className={styles.formBlock}>
              <div className={styles.taskCardTop}>
                <strong>{item.skuCode}</strong>
                <span>{item.stockUnit}</span>
              </div>
              <div className={styles.taskMetaRow}>
                <span>{item.skuName}</span>
                <span>系统 {item.systemQty}</span>
              </div>
              <label className={styles.fieldLabel}>
                <span>实盘数量</span>
                <input
                  data-testid={`mobile-stocktaking-qty-${item.skuId}`}
                  value={stocktakingDrafts[item.skuId] ?? item.actualQty ?? item.systemQty}
                  disabled={isReadonly}
                  onChange={(event) => setStocktakingDrafts((current) => ({
                    ...current,
                    [item.skuId]: clampPositiveNumberString(event.target.value),
                  }))}
                  inputMode="decimal"
                />
              </label>
            </div>
          ))}
          {!stocktakingItems.length && <div className={styles.emptyBlock}>当前盘点任务没有明细项。</div>}
          {!isReadonly && (
            <div className={styles.actionRow}>
              <Button
                variant="secondary"
                size="md"
                data-testid="mobile-stocktaking-save"
                loading={updateStocktakingItems.isPending}
                onClick={() => void handleSaveStocktaking()}
              >
                保存盘点
              </Button>
              <Button
                variant="primary"
                size="md"
                data-testid="mobile-stocktaking-submit"
                loading={submitStocktaking.isPending}
                onClick={() => void handleSubmitStocktaking()}
              >
                提交确认
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default function MobileWarehouseOps({ mode, stocktakingId }: MobileWarehouseOpsProps) {
  const location = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialScanDraft = searchParams ? {
    keyword: searchParams.get('keyword') ?? '',
    skuId: searchParams.get('skuId') ?? '',
    dyeLotNo: searchParams.get('dyeLotNo') ?? '',
    deliveryNo: searchParams.get('deliveryNo') ?? '',
  } : null;

  if (mode === 'scan') return <WarehouseScanPanel />;
  if (mode === 'inbound') return <WarehouseInboundPanel initialScanDraft={initialScanDraft} />;
  if (mode === 'stocktaking' && stocktakingId) return <WarehouseStocktakingPanel stocktakingId={stocktakingId} />;
  return <WarehouseListPanel />;
}
