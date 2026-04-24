import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '@/components/common/Button';
import { useAppStore } from '@/stores/appStore';
import { useWarehouseOptions, useLocationOptions } from '@/api/inventory';
import { uploadQualityImage } from '@/api/quality';
import {
  useInspectionList as useIncomingInspectionList,
  useInspectionDetail,
  useUpdateInspectionItems,
  useSubmitInspection,
} from '@/api/incomingInspection';
import styles from './MobileOpsPage.module.css';

type QualityPanelMode = 'list' | 'inspection';

interface MobileQualityOpsProps {
  mode: QualityPanelMode;
  inspectionId?: number | null;
}

interface MobileInspectionItemDraft {
  id?: number;
  label: string;
  qtyDelivered: string;
  qtySampled: string;
  qtyPassed: string;
  qtyFailed: string;
  result: 'pass' | 'fail' | 'conditional_pass' | null;
  disposition: 'accept' | 'return' | 'rework' | 'scrap' | null;
  notes: string;
  defectImages: Array<{ url: string; name: string }>;
}

const INSPECTION_RESULT_OPTIONS = [
  { value: 'pass', label: '合格' },
  { value: 'conditional_pass', label: '让步接收' },
  { value: 'fail', label: '不合格' },
] as const;

const INSPECTION_DISPOSITION_OPTIONS = [
  { value: 'accept', label: '接收入库' },
  { value: 'rework', label: '返工复检' },
  { value: 'return', label: '整批退货' },
  { value: 'scrap', label: '报废隔离' },
] as const;

const INSPECTION_STATUS_LABEL: Record<string, string> = {
  draft: '待质检',
  in_progress: '质检中',
  completed: '已完成',
  submitted: '已提交',
  pass: '合格',
  passed: '已放行',
  conditional_pass: '让步接收',
  fail: '不合格',
  failed: '不合格',
};

function clampPositiveNumberString(value: string): string {
  return value.replace(/[^\d.]/g, '');
}

function formatNumber(value: string | number | null | undefined): string {
  if (value == null) return '0';
  const num = Number(value);
  return Number.isFinite(num) ? `${num}` : String(value);
}

function buildInspectionDrafts(items: Array<Record<string, unknown>> | undefined): MobileInspectionItemDraft[] {
  return (items ?? []).map((item) => ({
    id: item.id ? Number(item.id) : undefined,
    label: `${String(item.skuCode ?? '')} ${String(item.skuName ?? '')}`.trim() || `明细 #${String(item.id ?? '')}`,
    qtyDelivered: formatNumber(item.qtyDelivered as string | number | null | undefined),
    qtySampled: formatNumber(item.qtySampled as string | number | null | undefined),
    qtyPassed: formatNumber(item.qtyPassed as string | number | null | undefined),
    qtyFailed: formatNumber(item.qtyFailed as string | number | null | undefined),
    result: (item.result as MobileInspectionItemDraft['result']) ?? null,
    disposition: (item.disposition as MobileInspectionItemDraft['disposition']) ?? null,
    notes: String(item.notes ?? ''),
    defectImages: Array.isArray(item.defectImages)
      ? item.defectImages
        .filter((image): image is string => typeof image === 'string' && image.trim().length > 0)
        .map((url, index) => ({
          url,
          name: `留证图片${index + 1}`,
        }))
      : [],
  }));
}

function getInspectionStatusLabel(status?: string | null): string {
  if (!status) return '未知状态';
  return INSPECTION_STATUS_LABEL[status] ?? status;
}

function QualityListPanel() {
  const navigate = useNavigate();
  const inspectionsQuery = useIncomingInspectionList({ page: 1, pageSize: 12 });
  const inspections = inspectionsQuery.data?.list ?? [];

  return (
    <div className={styles.panelStack}>
      <section className={styles.sectionBand}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>来料质检任务</h2>
            <p className={styles.sectionHint}>验货列表和质检表单分开，移动端操作更容易聚焦。</p>
          </div>
          <span className={styles.metricPill} data-testid="mobile-qc-count">{inspections.length} 单</span>
        </div>
        <div className={styles.listStack}>
          {inspections.map((inspection) => (
            <button
              key={inspection.id}
              type="button"
              className={styles.taskCard}
              data-testid={`mobile-qc-inspection-card-${inspection.id}`}
              onClick={() => navigate(`/m/qc/inspections/${inspection.id}`)}
            >
              <div className={styles.taskCardTop}>
                <strong>{inspection.inspectionNo}</strong>
                <span className={styles.statusTag}>{getInspectionStatusLabel(String(inspection.status ?? 'draft'))}</span>
              </div>
              <div className={styles.taskMetaRow}>
                <span>{String(inspection.poNo ?? '采购单待关联')}</span>
                <span>{String(inspection.supplierName ?? '供应商')}</span>
              </div>
              <div className={styles.inlineMeta}>
                <span>结论 {String(inspection.overallResult ?? '待判定')}</span>
                <span>进入质检页</span>
              </div>
            </button>
          ))}
          {!inspections.length && <div className={styles.emptyBlock}>当前没有待处理的质检单。</div>}
        </div>
      </section>
    </div>
  );
}

function QualityInspectionPanel({ inspectionId }: { inspectionId: number }) {
  const navigate = useNavigate();
  const showToast = useAppStore((state) => state.showToast);
  const inspectionDetailQuery = useInspectionDetail(inspectionId);
  const inspectionDetail = inspectionDetailQuery.data ?? null;
  const { data: warehouseOptions = [] } = useWarehouseOptions(true);
  const [warehouseId, setWarehouseId] = useState('');
  const { data: locationOptions = [] } = useLocationOptions(warehouseId ? Number(warehouseId) : undefined, true);
  const [locationId, setLocationId] = useState('');
  const [overallResult, setOverallResult] = useState<'pass' | 'fail' | 'conditional_pass'>('pass');
  const [inspectionNotes, setInspectionNotes] = useState('');
  const [draftItems, setDraftItems] = useState<MobileInspectionItemDraft[]>([]);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const updateInspectionItems = useUpdateInspectionItems();
  const submitInspection = useSubmitInspection();

  useEffect(() => {
    if (!inspectionDetail) return;
    setDraftItems(buildInspectionDrafts(inspectionDetail.items as Array<Record<string, unknown>> | undefined));
    setInspectionNotes(String(inspectionDetail.notes ?? ''));
    if (inspectionDetail.overallResult === 'fail' || inspectionDetail.overallResult === 'conditional_pass' || inspectionDetail.overallResult === 'pass') {
      setOverallResult(inspectionDetail.overallResult);
    } else {
      setOverallResult('pass');
    }
  }, [inspectionDetail]);

  useEffect(() => {
    if (!warehouseOptions.length || warehouseId) return;
    setWarehouseId(String(warehouseOptions[0].id));
  }, [warehouseId, warehouseOptions]);

  useEffect(() => {
    if (!locationOptions.length || locationId) return;
    setLocationId(String(locationOptions[0].id));
  }, [locationId, locationOptions]);

  const updateDraftItem = (index: number, patch: Partial<MobileInspectionItemDraft>) => {
    setDraftItems((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )));
  };

  const handleUploadDefectImages = async (index: number, files: FileList | null) => {
    const uploadQueue = Array.from(files ?? []);
    if (!uploadQueue.length) return;
    const currentItem = draftItems[index];
    if (!currentItem) return;
    const remainingSlots = 3 - currentItem.defectImages.length;
    if (remainingSlots <= 0) {
      showToast({ type: 'warning', message: '每条质检明细最多上传 3 张留证图' });
      return;
    }

    const queue = uploadQueue.slice(0, remainingSlots);
    const oversized = queue.find((file) => file.size > 10 * 1024 * 1024);
    if (oversized) {
      showToast({ type: 'warning', message: `${oversized.name} 超过 10MB，无法上传` });
      return;
    }

    const invalid = queue.find((file) => !file.type.startsWith('image/'));
    if (invalid) {
      showToast({ type: 'warning', message: `${invalid.name} 不是图片文件` });
      return;
    }

    try {
      setUploadingIndex(index);
      const uploaded = [];
      for (const file of queue) {
        const result = await uploadQualityImage(file);
        uploaded.push({ url: result.url, name: file.name });
      }
      updateDraftItem(index, {
        defectImages: [...currentItem.defectImages, ...uploaded],
      });
      showToast({ type: 'success', message: `已上传 ${uploaded.length} 张留证图` });
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message || '上传图片失败' });
    } finally {
      setUploadingIndex((current) => (current === index ? null : current));
    }
  };

  const handleRemoveDefectImage = (index: number, url: string) => {
    const currentItem = draftItems[index];
    if (!currentItem) return;
    updateDraftItem(index, {
      defectImages: currentItem.defectImages.filter((item) => item.url !== url),
    });
  };

  const handleSaveInspection = async () => {
    if (!draftItems.length) {
      showToast({ type: 'warning', message: '没有可保存的质检明细' });
      return;
    }
    if (draftItems.some((item) => !item.result || !item.disposition)) {
      showToast({ type: 'warning', message: '请先为每条明细选择结果和处置方式' });
      return;
    }
    try {
      await updateInspectionItems.mutateAsync({
        id: inspectionId,
        data: {
          items: draftItems.map((item) => ({
            id: item.id,
            qtysampled: item.qtySampled,
            qtyPassed: item.qtyPassed,
            qtyFailed: item.qtyFailed,
            result: item.result,
            defectImages: item.defectImages.map((image) => image.url),
            disposition: item.disposition,
            notes: item.notes || undefined,
          })),
        },
      });
      showToast({ type: 'success', message: '质检明细已保存' });
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message || '保存质检失败' });
    }
  };

  const handleSubmitInspection = async () => {
    if (!warehouseId || !locationId) {
      showToast({ type: 'warning', message: '请选择放行仓库和库位' });
      return;
    }
    try {
      await submitInspection.mutateAsync({
        id: inspectionId,
        data: {
          overallResult,
          warehouseId: Number(warehouseId),
          locationId: Number(locationId),
          notes: inspectionNotes || undefined,
        },
      });
      showToast({ type: 'success', message: '质检结论已提交并放行入库' });
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message || '提交质检失败' });
    }
  };

  if (!inspectionDetail) {
    return (
      <div className={styles.panelStack}>
        <section className={styles.sectionBand}>
          <div className={styles.emptyBlock}>质检详情加载中...</div>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.panelStack}>
      <section className={styles.sectionBand}>
        <div className={styles.detailTopBar}>
          <Button variant="ghost" size="sm" onClick={() => navigate('/m/qc')}>
            返回质检主页
          </Button>
          <span className={styles.metricPill}>{getInspectionStatusLabel(String(inspectionDetail.status ?? 'draft'))}</span>
        </div>
        <div className={styles.infoGrid}>
          <div className={styles.infoCard}>
            <span>质检单</span>
            <strong>{inspectionDetail.inspectionNo}</strong>
          </div>
          <div className={styles.infoCard}>
            <span>采购单</span>
            <strong>{inspectionDetail.poNo || '—'}</strong>
          </div>
          <div className={styles.infoCard}>
            <span>供应商</span>
            <strong>{inspectionDetail.supplierName || '—'}</strong>
          </div>
          <div className={styles.infoCard}>
            <span>当前状态</span>
            <strong>{getInspectionStatusLabel(String(inspectionDetail.status ?? 'draft'))}</strong>
          </div>
        </div>
      </section>

      <section className={styles.sectionBand}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>抽检明细</h2>
            <p className={styles.sectionHint}>逐条录入抽检数、合格数、不良数和处置方式。</p>
          </div>
        </div>
        <div className={styles.panelStack}>
          {draftItems.slice(0, 6).map((item, index) => (
            <div key={`${item.id ?? index}`} className={styles.formBlock}>
              <div className={styles.taskCardTop}>
                <strong>{item.label}</strong>
                <span>送货 {item.qtyDelivered}</span>
              </div>
              <div className={styles.formGrid2}>
                <label className={styles.fieldLabel}>
                  <span>抽检数</span>
                  <input
                    value={item.qtySampled}
                    onChange={(event) => updateDraftItem(index, { qtySampled: clampPositiveNumberString(event.target.value) })}
                    inputMode="decimal"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  <span>合格数</span>
                  <input
                    data-testid={`mobile-qc-passed-${index}`}
                    value={item.qtyPassed}
                    onChange={(event) => updateDraftItem(index, { qtyPassed: clampPositiveNumberString(event.target.value) })}
                    inputMode="decimal"
                  />
                </label>
              </div>
              <div className={styles.formGrid2}>
                <label className={styles.fieldLabel}>
                  <span>不良数</span>
                  <input
                    value={item.qtyFailed}
                    onChange={(event) => updateDraftItem(index, { qtyFailed: clampPositiveNumberString(event.target.value) })}
                    inputMode="decimal"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  <span>处置</span>
                  <select
                    value={item.disposition ?? ''}
                    onChange={(event) => updateDraftItem(index, { disposition: event.target.value as MobileInspectionItemDraft['disposition'] })}
                  >
                    <option value="">请选择</option>
                    {INSPECTION_DISPOSITION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className={styles.segmentedControl}>
                {INSPECTION_RESULT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`${styles.segmentButton} ${item.result === option.value ? styles.segmentButtonActive : ''}`}
                    onClick={() => updateDraftItem(index, { result: option.value })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <label className={styles.fieldLabel}>
                <span>留证图片</span>
                <input
                  data-testid={`mobile-qc-image-input-${index}`}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => {
                    void handleUploadDefectImages(index, event.target.files);
                    event.target.value = '';
                  }}
                />
              </label>
              {item.defectImages.length > 0 && (
                <div className={styles.detailList}>
                  {item.defectImages.map((image) => (
                    <div key={image.url} className={styles.detailListItem}>
                      <strong>{image.name}</strong>
                      <div className={styles.actionRow}>
                        <span>{image.url}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveDefectImage(index, image.url)}
                        >
                          移除
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {uploadingIndex === index && (
                <div className={styles.inlineMeta}>
                  <span>图片上传中</span>
                  <span>请稍候</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.sectionBand}>
        <div className={styles.formBlock}>
          <div className={styles.formTitle}>放行入库</div>
          <div className={styles.segmentedControl}>
            {INSPECTION_RESULT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`${styles.segmentButton} ${overallResult === option.value ? styles.segmentButtonActive : ''}`}
                onClick={() => setOverallResult(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className={styles.formGrid2}>
            <label className={styles.fieldLabel}>
              <span>仓库</span>
              <select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setLocationId(''); }}>
                <option value="">请选择仓库</option>
                {warehouseOptions.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                ))}
              </select>
            </label>
            <label className={styles.fieldLabel}>
              <span>库位</span>
              <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
                <option value="">请选择库位</option>
                {locationOptions.map((location) => (
                  <option key={location.id} value={location.id}>{location.code} · {location.name}</option>
                ))}
              </select>
            </label>
          </div>
          <label className={styles.fieldLabel}>
            <span>质检备注</span>
            <textarea
              data-testid="mobile-qc-notes"
              rows={3}
              value={inspectionNotes}
              onChange={(event) => setInspectionNotes(event.target.value)}
              placeholder="记录关键不良点或放行说明"
            />
          </label>
          <div className={styles.actionRow}>
            <Button
              variant="secondary"
              size="md"
              data-testid="mobile-qc-save"
              loading={updateInspectionItems.isPending}
              onClick={() => void handleSaveInspection()}
            >
              保存明细
            </Button>
            <Button
              variant="primary"
              size="md"
              data-testid="mobile-qc-submit"
              loading={submitInspection.isPending}
              onClick={() => void handleSubmitInspection()}
            >
              提交结论
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function MobileQualityOps({ mode, inspectionId }: MobileQualityOpsProps) {
  if (mode === 'inspection' && inspectionId) return <QualityInspectionPanel inspectionId={inspectionId} />;
  return <QualityListPanel />;
}
