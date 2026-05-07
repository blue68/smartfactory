import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QrScanner from 'qr-scanner';
import Button from '@/components/common/Button';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import {
  useTaskList,
  useTaskDetail,
  useStartTask,
  useCompleteTask,
  useIssueTaskMaterials,
  useReportException,
  type ProductionTask,
} from '@/api/productionTask';
import { useWarehouseOptions, useLocationOptions } from '@/api/inventory';
import { UserRole } from '@/types/enums';
import styles from './MobileOpsPage.module.css';
import { decodeQrImage, parseTaskQrPayload } from './mobileScanUtils';

type WorkerPanelMode = 'list' | 'detail' | 'scan';

interface WorkerPanelProps {
  mode: WorkerPanelMode;
  taskId?: number | null;
}

interface WorkerCompleteForm {
  completedQty: string;
  actualHours: string;
  scrapQty: string;
  notes: string;
}

interface WorkerIssueForm {
  materialSkuId: string;
  qty: string;
  warehouseId: string;
  locationId: string;
}

interface WorkerExceptionForm {
  type: string;
  severity: 'medium' | 'high';
  description: string;
  affectsProgress: boolean;
}

const EXCEPTION_TYPES = [
  { value: '设备故障', label: '设备故障' },
  { value: '物料缺失', label: '物料缺失' },
  { value: '质量异常', label: '质量异常' },
  { value: '其他', label: '其他' },
];

const TASK_STATUS_LABEL: Record<string, string> = {
  pending: '待开始',
  in_progress: '进行中',
  completed: '已完成',
  exception: '异常处理中',
  suspended: '已挂起',
};

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatNumber(value: string | number | null | undefined): string {
  if (value == null) return '0';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric}` : String(value);
}

function clampPositiveNumberString(value: string): string {
  return value.replace(/[^\d.]/g, '');
}

function formatDateLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()} ${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}`;
}

function getTaskStatusLabel(status?: string | null): string {
  if (!status) return '未知状态';
  return TASK_STATUS_LABEL[status] ?? status;
}

function useWorkerTaskPermissions(task: ProductionTask | null) {
  const user = useAuthStore((state) => state.user);
  const roles = user?.roles ?? [];
  const isWorker = roles.includes(UserRole.WORKER);
  const isElevated = roles.some((role) => [UserRole.ADMIN, UserRole.BOSS, UserRole.SUPERVISOR].includes(role));

  return useMemo(() => {
    if (!task || !user) {
      return {
        canOperate: false,
        ownershipMessage: '任务详情加载中',
      };
    }

    if (task.status === 'completed') {
      return {
        canOperate: false,
        ownershipMessage: '任务已完成，当前页面仅支持查看任务详情。',
      };
    }

    if (isElevated) {
      return {
        canOperate: true,
        ownershipMessage: null,
      };
    }

    if (!isWorker) {
      return {
        canOperate: false,
        ownershipMessage: '当前账号没有任务操作权限。',
      };
    }

    if (task.workerId == null) {
      return {
        canOperate: false,
        ownershipMessage: '任务未绑定到具体工人，当前账号仅可查看，请联系主管确认分派。',
      };
    }

    if (Number(task.workerId) !== Number(user.id)) {
      return {
        canOperate: false,
        ownershipMessage: `该任务分配给 ${task.workerName || '其他工人'}，当前账号仅可查看，不能代报工。`,
      };
    }

    return {
      canOperate: true,
      ownershipMessage: null,
    };
  }, [isElevated, isWorker, task, user]);
}

function WorkerTaskListPanel() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const today = useMemo(() => getToday(), []);
  const isWorker = user?.roles.includes(UserRole.WORKER) ?? false;
  const tasksQuery = useTaskList({
    page: 1,
    pageSize: 20,
    dateFrom: today,
    dateTo: today,
    workerId: isWorker ? user?.id : undefined,
  });
  const tasks: ProductionTask[] = Array.isArray(tasksQuery.data)
    ? tasksQuery.data
    : tasksQuery.data?.list ?? [];

  return (
    <div className={styles.panelStack}>
      <section className={styles.sectionBand}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>今日任务</h2>
            <p className={styles.sectionHint}>先看任务，再进入单独操作页处理报工、领料和异常。</p>
          </div>
          <span className={styles.metricPill} data-testid="mobile-worker-task-count">{tasks.length} 项</span>
        </div>
        <div className={styles.actionRow}>
          <Button
            variant="primary"
            size="md"
            fullWidth
            data-testid="mobile-scan-entry"
            onClick={() => navigate('/m/scan')}
          >
            扫码报工
          </Button>
        </div>
        <div className={styles.listStack}>
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className={styles.taskCard}
              data-testid={`mobile-task-card-${task.id}`}
              onClick={() => navigate(`/m/tasks/${task.id}`)}
            >
              <div className={styles.taskCardTop}>
                <strong>{task.taskNo || `任务 #${task.id}`}</strong>
                <span className={styles.statusTag} data-testid={`mobile-task-status-${task.id}`}>{getTaskStatusLabel(task.status)}</span>
              </div>
              <div className={styles.taskMetaRow}>
                <span>{task.processName}</span>
                <span>{task.workstationName || '未排站点'}</span>
              </div>
              <div className={styles.taskMetaRow}>
                <span>{task.outputSkuName || task.productName || task.skuName || '未绑定产出'}</span>
                <span>{formatNumber(task.plannedQty)} / 已报 {formatNumber(task.completedQty)}</span>
              </div>
              <div className={styles.inlineMeta}>
                <span>{task.workerName || '未指派工人'}</span>
                <span>{task.status === 'completed' ? '查看详情' : '进入操作页'}</span>
              </div>
            </button>
          ))}
          {!tasks.length && <div className={styles.emptyBlock}>当前没有可执行的生产任务。</div>}
        </div>
      </section>
    </div>
  );
}

function WorkerTaskScannerPanel() {
  const navigate = useNavigate();
  const showToast = useAppStore((state) => state.showToast);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const handledRef = useRef(false);
  const [manualPayload, setManualPayload] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [imageDecodeName, setImageDecodeName] = useState('');

  const handleResolvedPayload = useCallback((payload: string) => {
    if (handledRef.current) return;
    const parsed = parseTaskQrPayload(payload);
    if (!parsed?.taskId) {
      setScanError('未识别到有效的任务二维码，请确认纸质工单二维码是否完整。');
      return;
    }
    handledRef.current = true;
    navigate(`/m/tasks/${parsed.taskId}?entry=scan`, { replace: true });
  }, [navigate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    let cancelled = false;
    const scanner = new QrScanner(video, (result) => {
      if (cancelled) return;
      handleResolvedPayload(result.data);
    }, {
      preferredCamera: 'environment',
      highlightScanRegion: true,
      highlightCodeOutline: true,
      returnDetailedScanResult: true,
      onDecodeError: (error) => {
        if (`${error}` === QrScanner.NO_QR_CODE_FOUND) return;
        if (!cancelled) {
          setScanError('扫码失败，请将二维码移入取景框中心后重试。');
        }
      },
    });
    scannerRef.current = scanner;

    void (async () => {
      try {
        const hasCamera = await QrScanner.hasCamera();
        if (!hasCamera) {
          setScanError('当前设备未检测到摄像头，可改用手动输入二维码内容。');
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
      scannerRef.current = null;
    };
  }, [handleResolvedPayload]);

  return (
    <div className={styles.panelStack}>
      <section className={styles.sectionBand}>
        <div className={styles.detailTopBar}>
          <Button variant="ghost" size="sm" onClick={() => navigate('/m')}>
            返回任务列表
          </Button>
          <span className={styles.metricPill}>扫码报工</span>
        </div>
        <div className={styles.formBlock}>
          <div className={styles.formTitle}>扫描纸质工单二维码</div>
          <p className={styles.sectionHint}>系统会按任务二维码解析任务号，再依据当前登录账号与任务绑定工人做操作校验。</p>
          <div className={styles.scanViewport}>
            <video ref={videoRef} className={styles.scanVideo} muted playsInline />
          </div>
          <div className={styles.inlineMeta}>
            <span>{cameraReady ? '摄像头已就绪，请对准二维码' : '正在尝试打开摄像头'}</span>
            <span>支持直接扫码进入任务页</span>
          </div>
          {scanError && (
            <div className={styles.inlineWarning} role="alert">{scanError}</div>
          )}
        </div>
        <div className={styles.formBlock}>
          <div className={styles.formTitle}>手动解析二维码</div>
          <label className={styles.fieldLabel}>
            <span>拍照识别</span>
            <input
              data-testid="mobile-scan-image-input"
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
                    handleResolvedPayload(result);
                  } catch (error) {
                    setScanError((error as Error).message || '未能识别图片中的二维码，请换一张更清晰的照片。');
                  } finally {
                    event.target.value = '';
                  }
                })();
              }}
            />
          </label>
          <div className={styles.inlineMeta}>
            <span>{imageDecodeName ? `最近识别图片：${imageDecodeName}` : '支持直接拍照或从相册选择工单二维码图片'}</span>
            <span>适用于手机浏览器无摄像头流权限时的兼容兜底</span>
          </div>
          <label className={styles.fieldLabel}>
            <span>二维码内容</span>
            <textarea
              data-testid="mobile-scan-manual-input"
              rows={3}
              value={manualPayload}
              onChange={(event) => setManualPayload(event.target.value)}
              placeholder="粘贴二维码内容，例如 SMART_FACTORY_TASK|TASK_ID=501|TASK_NO=TK20260424..."
            />
          </label>
          <Button
            variant="secondary"
            size="md"
            fullWidth
            data-testid="mobile-scan-manual-submit"
            onClick={() => {
              if (!manualPayload.trim()) {
                showToast({ type: 'warning', message: '请先粘贴二维码内容' });
                return;
              }
              handleResolvedPayload(manualPayload);
            }}
          >
            解析任务码
          </Button>
        </div>
      </section>
    </div>
  );
}

function WorkerTaskDetailPanel({ taskId }: { taskId: number }) {
  const navigate = useNavigate();
  const showToast = useAppStore((state) => state.showToast);
  const user = useAuthStore((state) => state.user);
  const canBrowseInventoryDirectory = useMemo(
    () => (user?.roles ?? []).some((role) => [UserRole.ADMIN, UserRole.BOSS, UserRole.SUPERVISOR, UserRole.WAREHOUSE].includes(role)),
    [user?.roles],
  );
  const taskDetailQuery = useTaskDetail(taskId);
  const selectedTask = taskDetailQuery.data ?? null;
  const startTask = useStartTask();
  const completeTask = useCompleteTask();
  const issueMaterials = useIssueTaskMaterials();
  const reportException = useReportException();
  const { canOperate, ownershipMessage } = useWorkerTaskPermissions(selectedTask);
  const { data: warehouseOptions = [] } = useWarehouseOptions(
    true,
    canBrowseInventoryDirectory && canOperate && selectedTask?.status !== 'completed',
  );
  const [completeForm, setCompleteForm] = useState<WorkerCompleteForm>({
    completedQty: '',
    actualHours: '',
    scrapQty: '0',
    notes: '',
  });
  const [issueForm, setIssueForm] = useState<WorkerIssueForm>({
    materialSkuId: '',
    qty: '',
    warehouseId: '',
    locationId: '',
  });
  const [exceptionForm, setExceptionForm] = useState<WorkerExceptionForm>({
    type: EXCEPTION_TYPES[0].value,
    severity: 'medium',
    description: '',
    affectsProgress: true,
  });

  const issueWarehouseId = issueForm.warehouseId ? Number(issueForm.warehouseId) : undefined;
  const { data: locationOptions = [] } = useLocationOptions(
    issueWarehouseId,
    true,
    canBrowseInventoryDirectory && canOperate && issueWarehouseId !== undefined,
  );
  const taskMaterials = selectedTask?.inputMaterials ?? [];
  const selectedMaterial = taskMaterials.find((item) => String(item.skuId) === issueForm.materialSkuId) ?? taskMaterials[0] ?? null;

  useEffect(() => {
    if (!selectedTask) return;
    setCompleteForm({
      completedQty: String(Math.max(1, Number(selectedTask.plannedQty ?? 1) - Number(selectedTask.completedQty ?? 0)) || 1),
      actualHours: selectedTask.actualHours ? String(selectedTask.actualHours) : '',
      scrapQty: selectedTask.scrapQty ? String(selectedTask.scrapQty) : '0',
      notes: '',
    });
    const firstMaterial = selectedTask.inputMaterials?.[0];
    setIssueForm({
      materialSkuId: firstMaterial?.skuId ? String(firstMaterial.skuId) : '',
      qty: firstMaterial ? String(Math.max(0, Number(firstMaterial.requiredQty) - Number(firstMaterial.issuedQty))) : '',
      warehouseId: firstMaterial?.warehouseId ? String(firstMaterial.warehouseId) : '',
      locationId: firstMaterial?.locationId ? String(firstMaterial.locationId) : '',
    });
  }, [selectedTask]);

  useEffect(() => {
    if (!issueForm.warehouseId || locationOptions.length === 0 || issueForm.locationId) return;
    setIssueForm((current) => ({
      ...current,
      locationId: String(locationOptions[0]?.id ?? ''),
    }));
  }, [issueForm.locationId, issueForm.warehouseId, locationOptions]);

  const guardEditableAction = (): boolean => {
    if (!selectedTask) {
      showToast({ type: 'warning', message: '任务详情尚未加载完成' });
      return false;
    }
    if (!canOperate) {
      showToast({ type: 'warning', message: ownershipMessage || '当前账号不能操作该任务' });
      return false;
    }
    return true;
  };

  const handleStartTask = async () => {
    if (!selectedTask || !guardEditableAction()) return;
    try {
      await startTask.mutateAsync(selectedTask.id);
      showToast({ type: 'success', message: '任务已开工' });
      await taskDetailQuery.refetch();
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message || '开工失败' });
    }
  };

  const handleIssueMaterial = async () => {
    if (!selectedTask || !selectedMaterial || !issueForm.qty || !guardEditableAction()) {
      if (!selectedMaterial || !issueForm.qty) {
        showToast({ type: 'warning', message: '请选择物料并填写领料数量' });
      }
      return;
    }
    try {
      await issueMaterials.mutateAsync({
        taskId: selectedTask.id,
        data: {
          items: [{
            skuId: selectedMaterial.skuId,
            qty: issueForm.qty,
            unit: selectedMaterial.unit ?? undefined,
            warehouseId: issueForm.warehouseId ? Number(issueForm.warehouseId) : undefined,
            locationId: issueForm.locationId ? Number(issueForm.locationId) : undefined,
          }],
        },
      });
      showToast({ type: 'success', message: '领料申请已提交' });
      await taskDetailQuery.refetch();
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message || '领料失败' });
    }
  };

  const handleCompleteTask = async () => {
    if (!selectedTask || !completeForm.completedQty || !completeForm.actualHours || !guardEditableAction()) {
      if (!completeForm.completedQty || !completeForm.actualHours) {
        showToast({ type: 'warning', message: '请填写报工数量和实际工时' });
      }
      return;
    }
    try {
      await completeTask.mutateAsync({
        taskId: selectedTask.id,
        data: {
          completedQty: completeForm.completedQty,
          actualHours: completeForm.actualHours,
          notes: completeForm.notes || undefined,
          scrapQty: completeForm.scrapQty || undefined,
        },
      });
      showToast({ type: 'success', message: '报工已提交' });
      await taskDetailQuery.refetch();
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message || '报工失败' });
    }
  };

  const handleExceptionSubmit = async () => {
    if (!selectedTask || !guardEditableAction()) return;
    if (exceptionForm.description.trim().length < 6) {
      showToast({ type: 'warning', message: '请填写至少 6 个字的异常说明' });
      return;
    }
    try {
      await reportException.mutateAsync({
        taskId: selectedTask.id,
        data: {
          type: exceptionForm.type,
          severity: exceptionForm.severity,
          description: exceptionForm.description.trim(),
          affectsProgress: exceptionForm.affectsProgress,
        },
      });
      showToast({ type: 'success', message: '异常已上报' });
      setExceptionForm((current) => ({ ...current, description: '' }));
      await taskDetailQuery.refetch();
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message || '异常上报失败' });
    }
  };

  if (taskDetailQuery.isLoading || !selectedTask) {
    return (
      <div className={styles.panelStack}>
        <section className={styles.sectionBand}>
          <div className={styles.emptyBlock}>任务详情加载中...</div>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.panelStack}>
      <section className={styles.sectionBand}>
        <div className={styles.detailTopBar}>
          <Button variant="ghost" size="sm" onClick={() => navigate('/m')}>
            返回任务列表
          </Button>
          <span className={styles.metricPill}>{getTaskStatusLabel(selectedTask.status)}</span>
        </div>
        <div className={styles.detailHero}>
          <div>
            <h2 className={styles.sectionTitle}>{selectedTask.taskNo || `任务 #${selectedTask.id}`}</h2>
            <p className={styles.sectionHint}>{selectedTask.processName} · {selectedTask.workstationName || '未排工作站'}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate('/m/scan')}
          >
            重新扫码
          </Button>
        </div>
        <div className={styles.infoGrid}>
          <div className={styles.infoCard}>
            <span>状态</span>
            <strong>{getTaskStatusLabel(selectedTask.status)}</strong>
          </div>
          <div className={styles.infoCard}>
            <span>绑定工人</span>
            <strong>{selectedTask.workerName || '未绑定'}</strong>
          </div>
          <div className={styles.infoCard}>
            <span>计划数量</span>
            <strong>{formatNumber(selectedTask.plannedQty)}</strong>
          </div>
          <div className={styles.infoCard}>
            <span>已完工</span>
            <strong>{formatNumber(selectedTask.completedQty)}</strong>
          </div>
        </div>
        {ownershipMessage && (
          <div className={styles.inlineWarning} role="alert">{ownershipMessage}</div>
        )}
      </section>

      <section className={styles.sectionBand}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>任务说明</h2>
            <p className={styles.sectionHint}>如果任务已经完成，这里仍可以回看工艺说明、物料需求和异常记录。</p>
          </div>
        </div>
        <div className={styles.formBlock}>
          <div className={styles.formTitle}>工艺描述</div>
          <p className={styles.detailParagraph}>
            {selectedTask.processGuideText || '当前任务暂无维护工艺说明，可结合工序名称、物料要求和异常时间线查看上下文。'}
          </p>
          <div className={styles.inlineMeta}>
            <span>生产工单：{selectedTask.orderNo || '—'}</span>
            <span>计划完成：{formatDateLabel(selectedTask.plannedFinishTime)}</span>
          </div>
        </div>
        <div className={styles.formBlock}>
          <div className={styles.formTitle}>投料与产出</div>
          <div className={styles.detailList}>
            {(selectedTask.inputMaterials ?? []).map((item) => (
              <div key={`input-${item.skuId}`} className={styles.detailListItem}>
                <strong>{item.skuCode || '物料'} {item.skuName || ''}</strong>
                <span>需求 {formatNumber(item.requiredQty)} {item.unit || ''} / 已发 {formatNumber(item.issuedQty)} {item.unit || ''}</span>
              </div>
            ))}
            {(selectedTask.inputMaterials ?? []).length === 0 && (
              <div className={styles.emptyBlock}>当前任务没有配置物料投料项。</div>
            )}
          </div>
        </div>
        {(selectedTask.exceptions ?? []).length > 0 && (
          <div className={styles.formBlock}>
            <div className={styles.formTitle}>异常记录</div>
            <div className={styles.detailList}>
              {selectedTask.exceptions?.map((exception) => (
                <div key={exception.id} className={styles.detailListItem}>
                  <strong>{exception.type}</strong>
                  <span>{exception.description}</span>
                  <span>{formatDateLabel(exception.createdAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {selectedTask.status !== 'completed' && canOperate && (
        <section className={styles.sectionBand}>
          <div className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle}>任务操作</h2>
              <p className={styles.sectionHint}>操作页独立展示，避免在任务列表里堆叠过多表单内容。</p>
            </div>
          </div>
          <div className={styles.panelStack}>
            <div className={styles.actionRow}>
              <Button
                variant="primary"
                size="md"
                data-testid="mobile-start-task"
                loading={startTask.isPending}
                onClick={() => void handleStartTask()}
              >
                开工
              </Button>
            </div>

            <div className={styles.formBlock}>
              <div className={styles.formTitle}>领料确认</div>
              <label className={styles.fieldLabel}>
                <span>物料</span>
                <select
                  value={issueForm.materialSkuId}
                  onChange={(event) => {
                    const skuId = event.target.value;
                    const material = taskMaterials.find((item) => String(item.skuId) === skuId);
                    setIssueForm({
                      materialSkuId: skuId,
                      qty: material ? String(Math.max(0, Number(material.requiredQty) - Number(material.issuedQty))) : '',
                      warehouseId: material?.warehouseId ? String(material.warehouseId) : '',
                      locationId: material?.locationId ? String(material.locationId) : '',
                    });
                  }}
                >
                  <option value="">请选择物料</option>
                  {taskMaterials.map((item) => (
                    <option key={item.skuId} value={item.skuId}>
                      {item.skuCode || ''} {item.skuName || ''}
                    </option>
                  ))}
                </select>
              </label>
              {selectedMaterial && (
                <div className={styles.inlineMeta}>
                  <span>需求 {formatNumber(selectedMaterial.requiredQty)} {selectedMaterial.unit || ''}</span>
                  <span>已发 {formatNumber(selectedMaterial.issuedQty)} {selectedMaterial.unit || ''}</span>
                  <span>可用 {formatNumber(selectedMaterial.qtyAvailable)} {selectedMaterial.unit || ''}</span>
                </div>
              )}
              <div className={styles.formGrid2}>
                <label className={styles.fieldLabel}>
                  <span>数量</span>
                  <input
                    data-testid="mobile-issue-qty"
                    value={issueForm.qty}
                    onChange={(event) => setIssueForm((current) => ({ ...current, qty: clampPositiveNumberString(event.target.value) }))}
                    inputMode="decimal"
                    placeholder="领料数量"
                  />
                </label>
                {canBrowseInventoryDirectory ? (
                  <label className={styles.fieldLabel}>
                    <span>仓库</span>
                    <select
                      value={issueForm.warehouseId}
                      onChange={(event) => setIssueForm((current) => ({
                        ...current,
                        warehouseId: event.target.value,
                        locationId: '',
                      }))}
                    >
                      <option value="">未指定</option>
                      {warehouseOptions.map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className={styles.fieldLabel}>
                    <span>发料仓位</span>
                    <input
                      value={issueForm.warehouseId || issueForm.locationId ? '按任务默认仓位发料' : '按现场默认仓位发料'}
                      readOnly
                    />
                  </label>
                )}
              </div>
              {canBrowseInventoryDirectory && (
                <label className={styles.fieldLabel}>
                  <span>库位</span>
                  <select
                    value={issueForm.locationId}
                    onChange={(event) => setIssueForm((current) => ({ ...current, locationId: event.target.value }))}
                  >
                    <option value="">未指定</option>
                    {locationOptions.map((location) => (
                      <option key={location.id} value={location.id}>{location.code} · {location.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <Button
                variant="secondary"
                size="md"
                fullWidth
                loading={issueMaterials.isPending}
                onClick={() => void handleIssueMaterial()}
              >
                确认领料
              </Button>
            </div>

            <div className={styles.formBlock}>
              <div className={styles.formTitle}>报工提交</div>
              <div className={styles.formGrid2}>
                <label className={styles.fieldLabel}>
                  <span>完成数量</span>
                  <input
                    data-testid="mobile-complete-qty"
                    value={completeForm.completedQty}
                    onChange={(event) => setCompleteForm((current) => ({ ...current, completedQty: clampPositiveNumberString(event.target.value) }))}
                    inputMode="decimal"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  <span>实际工时</span>
                  <input
                    data-testid="mobile-complete-hours"
                    value={completeForm.actualHours}
                    onChange={(event) => setCompleteForm((current) => ({ ...current, actualHours: clampPositiveNumberString(event.target.value) }))}
                    inputMode="decimal"
                  />
                </label>
              </div>
              <div className={styles.formGrid2}>
                <label className={styles.fieldLabel}>
                  <span>报废数量</span>
                  <input
                    value={completeForm.scrapQty}
                    onChange={(event) => setCompleteForm((current) => ({ ...current, scrapQty: clampPositiveNumberString(event.target.value) }))}
                    inputMode="decimal"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  <span>备注</span>
                  <input
                    value={completeForm.notes}
                    onChange={(event) => setCompleteForm((current) => ({ ...current, notes: event.target.value }))}
                    placeholder="可选"
                  />
                </label>
              </div>
              <Button
                variant="primary"
                size="md"
                fullWidth
                data-testid="mobile-complete-submit"
                loading={completeTask.isPending}
                onClick={() => void handleCompleteTask()}
              >
                提交报工
              </Button>
            </div>

            <div className={styles.formBlock}>
              <div className={styles.formTitle}>异常上报</div>
              <div className={styles.formGrid2}>
                <label className={styles.fieldLabel}>
                  <span>异常类型</span>
                  <select
                    value={exceptionForm.type}
                    onChange={(event) => setExceptionForm((current) => ({ ...current, type: event.target.value }))}
                  >
                    {EXCEPTION_TYPES.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.fieldLabel}>
                  <span>严重度</span>
                  <select
                    value={exceptionForm.severity}
                    onChange={(event) => setExceptionForm((current) => ({ ...current, severity: event.target.value as 'medium' | 'high' }))}
                  >
                    <option value="medium">一般</option>
                    <option value="high">严重</option>
                  </select>
                </label>
              </div>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={exceptionForm.affectsProgress}
                  onChange={(event) => setExceptionForm((current) => ({ ...current, affectsProgress: event.target.checked }))}
                />
                <span>影响进度，需要主管跟进</span>
              </label>
              <label className={styles.fieldLabel}>
                <span>异常说明</span>
                <textarea
                  data-testid="mobile-exception-desc"
                  value={exceptionForm.description}
                  onChange={(event) => setExceptionForm((current) => ({ ...current, description: event.target.value }))}
                  rows={4}
                  placeholder="填写问题现象、影响范围和现场处理情况"
                />
              </label>
              <Button
                variant="warning"
                size="md"
                fullWidth
                data-testid="mobile-exception-submit"
                loading={reportException.isPending}
                onClick={() => void handleExceptionSubmit()}
              >
                上报异常
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

export default function MobileWorkerOps({ mode, taskId }: WorkerPanelProps) {
  if (mode === 'scan') return <WorkerTaskScannerPanel />;
  if (mode === 'detail' && taskId) return <WorkerTaskDetailPanel taskId={taskId} />;
  return <WorkerTaskListPanel />;
}
