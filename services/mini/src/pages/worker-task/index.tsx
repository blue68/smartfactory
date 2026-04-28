import { useCallback, useEffect, useMemo, useState } from 'react'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { Button, Input, Picker, Text, Textarea, View } from '@tarojs/components'
import {
  getSkuId,
  inventoryApi,
  LocationOption,
  productionTaskApi,
  ProductionTask,
  SkuOption,
  skuApi,
  WarehouseOption,
} from '../../utils/api'
import { confirmAction, getErrorMessage, nowTimeLabel, showError, showSuccess } from '../../utils/interaction'
import './index.css'

const STATUS_OPTIONS = ['全部', '待开工', '进行中', '异常', '已完成']
const STATUS_VALUES = ['', 'pending', 'in_progress', 'exception', 'completed']
const EXCEPTION_TYPES = ['material_shortage', 'quality_issue', 'equipment_failure', 'process_issue', 'other']
const EXCEPTION_LABELS = ['物料短缺', '质量异常', '设备异常', '工艺异常', '其他']
const SEVERITY_OPTIONS = ['low', 'medium', 'high']
const SEVERITY_LABELS = ['低', '中', '高']
const STATUS_LABELS: Record<string, string> = {
  pending: '待开工',
  in_progress: '进行中',
  exception: '异常',
  completed: '已完成',
}

function toNumber(value: string): number {
  return Number.parseFloat(value)
}

function getTaskTitle(task: ProductionTask): string {
  return task.stepName || task.processName || task.taskNo || `任务 ${task.id}`
}

function getTaskSku(task: ProductionTask): string {
  return [task.skuCode, task.skuName].filter(Boolean).join(' · ') || '未关联产品'
}

function normalizeScanPayload(payload: string): Record<string, string> {
  return payload.split(/[|&\n;,]/).reduce<Record<string, string>>((acc, part) => {
    const [rawKey, ...rest] = part.split('=')
    if (!rawKey || rest.length === 0) return acc
    acc[rawKey.trim().toUpperCase()] = rest.join('=').trim()
    return acc
  }, {})
}

export default function WorkerTaskPage() {
  const [statusIdx, setStatusIdx] = useState(0)
  const [tasks, setTasks] = useState<ProductionTask[]>([])
  const [selectedTask, setSelectedTask] = useState<ProductionTask | null>(null)
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([])
  const [locations, setLocations] = useState<LocationOption[]>([])
  const [warehouseIdx, setWarehouseIdx] = useState(-1)
  const [locationIdx, setLocationIdx] = useState(-1)
  const [materialKeyword, setMaterialKeyword] = useState('')
  const [materialOptions, setMaterialOptions] = useState<SkuOption[]>([])
  const [materialIdx, setMaterialIdx] = useState(-1)
  const [issueQty, setIssueQty] = useState('')
  const [dyeLotNo, setDyeLotNo] = useState('')
  const [completedQty, setCompletedQty] = useState('')
  const [actualHours, setActualHours] = useState('')
  const [scrapQty, setScrapQty] = useState('')
  const [completeNotes, setCompleteNotes] = useState('')
  const [exceptionTypeIdx, setExceptionTypeIdx] = useState(0)
  const [severityIdx, setSeverityIdx] = useState(1)
  const [exceptionText, setExceptionText] = useState('')
  const [loading, setLoading] = useState(false)
  const [materialSearching, setMaterialSearching] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [lastRefreshAt, setLastRefreshAt] = useState('')

  const selectedWarehouse = warehouseIdx >= 0 ? warehouses[warehouseIdx] : null
  const selectedLocation = locationIdx >= 0 ? locations[locationIdx] : null
  const selectedMaterial = materialIdx >= 0 ? materialOptions[materialIdx] : null

  const taskRange = useMemo(
    () => tasks.map((task) => `${task.taskNo || task.workOrderNo || task.productionOrderNo || task.id} · ${getTaskTitle(task)}`),
    [tasks],
  )
  const selectedTaskIdx = useMemo(
    () => tasks.findIndex((task) => task.id === selectedTask?.id),
    [selectedTask, tasks],
  )
  const activeTaskCount = useMemo(
    () => tasks.filter((task) => task.status !== 'completed').length,
    [tasks],
  )
  const taskProgress = selectedTask
    ? `${selectedTask.completedQty ?? 0}/${selectedTask.plannedQty ?? '-'} ${selectedTask.unit || ''}`
    : '-'

  const loadTasks = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const status = STATUS_VALUES[statusIdx]
      const res = await productionTaskApi.list({ page: 1, pageSize: 50, ...(status ? { status } : {}) })
      setTasks(res.list ?? [])
      const preferred = selectedTask
        ? res.list?.find((item) => item.id === selectedTask.id) ?? res.list?.[0]
        : res.list?.[0]
      if (preferred) {
        const detail = await productionTaskApi.detail(preferred.id)
        setSelectedTask(detail)
      } else {
        setSelectedTask(null)
      }
      setLastRefreshAt(nowTimeLabel())
    } catch (error) {
      setLoadError(getErrorMessage(error, '加载任务失败'))
      showError(error, '加载任务失败')
    } finally {
      setLoading(false)
      Taro.stopPullDownRefresh()
    }
  }, [selectedTask, statusIdx])

  const loadWarehouses = useCallback(async () => {
    try {
      const res = await inventoryApi.warehouses()
      setWarehouses(res)
      if (res.length && warehouseIdx < 0) setWarehouseIdx(0)
    } catch {
      showError('加载仓库失败', '加载仓库失败')
    }
  }, [warehouseIdx])

  useDidShow(() => {
    void loadTasks()
    void loadWarehouses()
  })

  usePullDownRefresh(() => {
    void loadTasks()
  })

  useEffect(() => {
    if (!selectedWarehouse) {
      setLocations([])
      setLocationIdx(-1)
      return
    }
    void inventoryApi.locations(selectedWarehouse.id).then((res) => {
      setLocations(res)
      setLocationIdx((current) => (current >= 0 && current < res.length ? current : (res.length ? 0 : -1)))
    }).catch(() => {
      setLocations([])
      setLocationIdx(-1)
      showError('加载库位失败', '加载库位失败')
    })
  }, [selectedWarehouse])

  const selectTask = async (idx: number) => {
    const task = tasks[idx]
    if (!task) return
    setLoading(true)
    try {
      const detail = await productionTaskApi.detail(task.id)
      setSelectedTask(detail)
      setCompletedQty(String(detail.completedQty ?? ''))
      setActualHours('')
      setScrapQty('')
      setCompleteNotes('')
    } catch (error) {
      showError(error, '加载任务详情失败')
    } finally {
      setLoading(false)
    }
  }

  const handleScanTask = async () => {
    try {
      const scan = await Taro.scanCode({ scanType: ['qrCode', 'barCode'] })
      const payload = normalizeScanPayload(scan.result)
      const taskId = Number(payload.TASK_ID || payload.TASKID || scan.result)
      if (!Number.isFinite(taskId) || taskId <= 0) {
        showError('未识别到任务 ID，可手动选择任务', '未识别到任务 ID')
        return
      }
      const detail = await productionTaskApi.detail(taskId)
      setSelectedTask(detail)
      showSuccess('已定位任务')
    } catch (error) {
      showError(error, '扫码失败')
    }
  }

  const searchMaterial = async () => {
    if (!materialKeyword.trim()) {
      Taro.showToast({ title: '请输入物料编码或名称', icon: 'none' })
      return
    }
    setMaterialSearching(true)
    try {
      const res = await skuApi.search(materialKeyword.trim())
      setMaterialOptions(res.list ?? [])
      setMaterialIdx(res.list?.length ? 0 : -1)
      if (!res.list?.length) Taro.showToast({ title: '未找到物料', icon: 'none' })
    } catch (error) {
      showError(error, '查询物料失败')
    } finally {
      setMaterialSearching(false)
    }
  }

  const pickRecommendedMaterial = (skuId?: number, skuCode?: string, name?: string, unit?: string) => {
    if (!skuId && !skuCode) return
    setMaterialOptions([{ id: skuId, skuCode: skuCode || '', name: name || skuCode || '物料', unit, stockUnit: unit }])
    setMaterialIdx(0)
  }

  const withSubmitting = async (fn: () => Promise<boolean | void>) => {
    if (submitting || !selectedTask) return
    setSubmitting(true)
    try {
      const committed = await fn()
      if (committed === false) return
      const detail = await productionTaskApi.detail(selectedTask.id)
      setSelectedTask(detail)
      showSuccess('操作成功')
      void loadTasks()
    } catch (error) {
      showError(error, '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleStart = () => withSubmitting(async () => {
    if (!selectedTask) return
    const confirmed = await confirmAction('确认开工', `开始执行「${getTaskTitle(selectedTask)}」？`)
    if (!confirmed) return false
    await productionTaskApi.start(selectedTask.id)
  })

  const handleIssue = () => withSubmitting(async () => {
    if (!selectedTask || !selectedMaterial) {
      throw new Error('请选择投料物料')
    }
    const qty = toNumber(issueQty)
    const skuId = getSkuId(selectedMaterial)
    if (!skuId || !Number.isFinite(qty) || qty <= 0 || !selectedWarehouse) {
      throw new Error('请补齐物料、数量和仓库')
    }
    const confirmed = await confirmAction(
      '确认投料',
      `物料：${selectedMaterial.skuCode || selectedMaterial.code || selectedMaterial.name}\n数量：${qty} ${selectedMaterial.stockUnit || selectedMaterial.purchaseUnit || selectedMaterial.unit || ''}`,
    )
    if (!confirmed) return false
    await productionTaskApi.issueMaterials(selectedTask.id, [{
      skuId,
      qty,
      unit: selectedMaterial.stockUnit || selectedMaterial.purchaseUnit || selectedMaterial.unit,
      warehouseId: selectedWarehouse.id,
      locationId: selectedLocation?.id,
      dyeLotNo: dyeLotNo.trim() || undefined,
    }])
    setIssueQty('')
    setDyeLotNo('')
  })

  const handleComplete = () => withSubmitting(async () => {
    if (!selectedTask) return
    const qty = toNumber(completedQty)
    const hours = toNumber(actualHours)
    const scrap = scrapQty ? toNumber(scrapQty) : 0
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(hours) || hours < 0) {
      throw new Error('请填写有效完工数量和工时')
    }
    const confirmed = await confirmAction('提交完工', `完工数量 ${qty}，实际工时 ${hours}h。提交后将进入后续流转。`)
    if (!confirmed) return false
    await productionTaskApi.complete(selectedTask.id, {
      completedQty: qty,
      actualHours: hours,
      scrapQty: Number.isFinite(scrap) ? scrap : 0,
      notes: completeNotes.trim() || undefined,
    })
  })

  const handleException = () => withSubmitting(async () => {
    if (!selectedTask) return
    if (!exceptionText.trim()) {
      throw new Error('请填写异常说明')
    }
    const confirmed = await confirmAction('提交异常', `异常类型：${EXCEPTION_LABELS[exceptionTypeIdx]}\n严重程度：${SEVERITY_LABELS[severityIdx]}`)
    if (!confirmed) return false
    await productionTaskApi.reportException(selectedTask.id, {
      type: EXCEPTION_TYPES[exceptionTypeIdx],
      severity: SEVERITY_OPTIONS[severityIdx],
      affectsProgress: true,
      description: exceptionText.trim(),
    })
    setExceptionText('')
  })

  return (
    <View className='page'>
      <View className='hero'>
        <View>
          <Text className='eyebrow'>工单操作</Text>
          <View className='page__title'>我的生产任务</View>
          <Text className='hero-subtitle'>{lastRefreshAt ? `最后同步 ${lastRefreshAt}` : '下拉可刷新任务'}</Text>
        </View>
        <Button className='ghost-button' onClick={handleScanTask}>扫码</Button>
      </View>

      <View className='metric-grid'>
        <View className='metric-card'>
          <Text className='metric-value'>{tasks.length}</Text>
          <Text className='metric-label'>当前列表</Text>
        </View>
        <View className='metric-card'>
          <Text className='metric-value'>{activeTaskCount}</Text>
          <Text className='metric-label'>待处理</Text>
        </View>
        <View className='metric-card'>
          <Text className='metric-value'>{taskProgress}</Text>
          <Text className='metric-label'>当前进度</Text>
        </View>
      </View>

      {loadError && (
        <View className='alert-card'>
          <Text className='alert-title'>任务同步失败</Text>
          <Text className='alert-text'>{loadError}</Text>
          <Button className='alert-action' onClick={() => void loadTasks()}>重试</Button>
        </View>
      )}

      <View className='toolbar'>
        <Picker mode='selector' range={STATUS_OPTIONS} value={statusIdx} onChange={(event) => setStatusIdx(Number(event.detail.value))}>
          <View className='picker-box'>状态：{STATUS_OPTIONS[statusIdx]}</View>
        </Picker>
        <Button className='primary-small' loading={loading} onClick={() => void loadTasks()}>刷新</Button>
      </View>

      <View className='section'>
        <Text className='section-title'>选择任务</Text>
        <Picker mode='selector' range={taskRange} value={Math.max(selectedTaskIdx, 0)} onChange={(event) => void selectTask(Number(event.detail.value))}>
          <View className='picker-box'>{selectedTask ? `${selectedTask.taskNo || selectedTask.id} · ${getTaskTitle(selectedTask)}` : '请选择任务'}</View>
        </Picker>
        <Text className='field-help'>现场可扫码定位任务；扫码失败时从列表手动选择。</Text>
      </View>

      {selectedTask ? (
        <>
          <View className='task-card'>
            <View className='task-card__header'>
              <Text className='task-card__title'>{getTaskTitle(selectedTask)}</Text>
              <Text className='status-pill'>{STATUS_LABELS[selectedTask.status] ?? selectedTask.status}</Text>
            </View>
            <Text className='muted'>{getTaskSku(selectedTask)}</Text>
            <Text className='muted'>计划：{selectedTask.plannedQty ?? '-'} {selectedTask.unit || ''}</Text>
            <Button className='primary-button' loading={submitting} disabled={submitting || selectedTask.status === 'completed'} onClick={handleStart}>确认开工</Button>
          </View>

          <View className='section'>
            <Text className='section-title'>投料</Text>
            <View className='chips'>
              {(selectedTask.inputMaterials ?? []).map((item) => (
                <View
                  key={`${item.skuId || item.skuCode}`}
                  className='chip'
                  onClick={() => pickRecommendedMaterial(item.skuId, item.skuCode, item.name || item.skuName, item.unit)}
                >
                  {item.skuCode || item.name || item.skuName} · {item.requiredQty ?? item.qty ?? '-'} {item.unit || ''}
                </View>
              ))}
            </View>
            {(selectedTask.inputMaterials ?? []).length === 0 && (
              <View className='inline-empty'>暂无 BOM 推荐投料，可手动搜索 SKU。</View>
            )}
            <View className='inline-row'>
              <Input className='input flex' value={materialKeyword} placeholder='物料编码/名称' onInput={(event) => setMaterialKeyword(event.detail.value)} />
              <Button className='primary-small' loading={materialSearching} disabled={materialSearching} onClick={() => void searchMaterial()}>查询</Button>
            </View>
            <Picker mode='selector' range={materialOptions.map((item) => `${item.skuCode || item.code} · ${item.name}`)} value={Math.max(materialIdx, 0)} onChange={(event) => setMaterialIdx(Number(event.detail.value))}>
              <View className='picker-box'>{selectedMaterial ? `${selectedMaterial.skuCode || selectedMaterial.code} · ${selectedMaterial.name}` : '请选择投料物料'}</View>
            </Picker>
            <Input className='input' type='digit' value={issueQty} placeholder='投料数量' onInput={(event) => setIssueQty(event.detail.value)} />
            <Input className='input' value={dyeLotNo} placeholder='缸号/批号，可选' onInput={(event) => setDyeLotNo(event.detail.value)} />
            <Picker mode='selector' range={warehouses.map((item) => item.name)} value={Math.max(warehouseIdx, 0)} onChange={(event) => setWarehouseIdx(Number(event.detail.value))}>
              <View className='picker-box'>{selectedWarehouse?.name || '请选择出库仓库'}</View>
            </Picker>
            <Picker mode='selector' range={locations.map((item) => item.name)} value={Math.max(locationIdx, 0)} onChange={(event) => setLocationIdx(Number(event.detail.value))}>
              <View className='picker-box'>{selectedLocation?.name || '请选择库位，可选'}</View>
            </Picker>
            <Text className='field-help'>投料会写入当前任务领料记录，请核对 SKU、数量和库位。</Text>
            <Button className='primary-button' loading={submitting} disabled={submitting} onClick={handleIssue}>确认投料</Button>
          </View>

          <View className='section'>
            <Text className='section-title'>完工报工</Text>
            <Input className='input' type='digit' value={completedQty} placeholder={`完工数量 ${selectedTask.unit || ''}`} onInput={(event) => setCompletedQty(event.detail.value)} />
            <Input className='input' type='digit' value={actualHours} placeholder='实际工时(h)，支持小数' onInput={(event) => setActualHours(event.detail.value)} />
            <Input className='input' type='digit' value={scrapQty} placeholder='报废数量，可选' onInput={(event) => setScrapQty(event.detail.value)} />
            <Textarea className='textarea' value={completeNotes} placeholder='完工备注，可选' maxlength={300} onInput={(event) => setCompleteNotes(event.detail.value)} />
            <Text className='field-help'>提交完工前会二次确认，避免现场误触。</Text>
            <Button className='success-button' loading={submitting} disabled={submitting} onClick={handleComplete}>提交完工</Button>
          </View>

          <View className='section danger-section'>
            <Text className='section-title'>异常上报</Text>
            <Picker mode='selector' range={EXCEPTION_LABELS} value={exceptionTypeIdx} onChange={(event) => setExceptionTypeIdx(Number(event.detail.value))}>
              <View className='picker-box'>异常类型：{EXCEPTION_LABELS[exceptionTypeIdx]}</View>
            </Picker>
            <Picker mode='selector' range={SEVERITY_LABELS} value={severityIdx} onChange={(event) => setSeverityIdx(Number(event.detail.value))}>
              <View className='picker-box'>严重程度：{SEVERITY_LABELS[severityIdx]}</View>
            </Picker>
            <Textarea className='textarea' value={exceptionText} placeholder='描述异常现象、影响范围和需要支持的事项' maxlength={500} onInput={(event) => setExceptionText(event.detail.value)} />
            <Text className='field-help danger-help'>异常会上报并影响任务进度，请写清影响范围和所需支持。</Text>
            <Button className='danger-button' loading={submitting} disabled={submitting} onClick={handleException}>提交异常</Button>
          </View>
        </>
      ) : (
        <View className='empty-hint'>
          <Text>{loading ? '任务加载中...' : '暂无符合条件的任务'}</Text>
          {!loading && <Button className='empty-action' onClick={() => void loadTasks()}>重新同步</Button>}
        </View>
      )}
    </View>
  )
}
