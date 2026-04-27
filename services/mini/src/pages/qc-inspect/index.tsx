import { useCallback, useEffect, useMemo, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Image, Input, Picker, Text, Textarea, View } from '@tarojs/components'
import {
  incomingInspectionApi,
  IncomingInspection,
  IncomingInspectionItem,
  inventoryApi,
  LocationOption,
  WarehouseOption,
} from '../../utils/api'
import request from '../../utils/request'
import './index.css'

const RESULT_OPTIONS = [
  { value: 'pass', label: '合格' },
  { value: 'conditional_pass', label: '让步接收' },
  { value: 'fail', label: '不合格' },
] as const

const DISPOSITION_OPTIONS = [
  { value: 'accept', label: '接收入库' },
  { value: 'rework', label: '返工复检' },
  { value: 'return', label: '整批退货' },
  { value: 'scrap', label: '报废隔离' },
] as const

type ResultValue = typeof RESULT_OPTIONS[number]['value']
type DispositionValue = typeof DISPOSITION_OPTIONS[number]['value']

interface ItemDraft {
  id?: number
  label: string
  qtyDelivered: string
  qtySampled: string
  qtyPassed: string
  qtyFailed: string
  acceptedStockQty: string
  dyeLotNo: string
  result: ResultValue | ''
  disposition: DispositionValue | ''
  notes: string
  defectImages: string[]
}

function asText(value: unknown): string {
  if (value == null) return ''
  return String(value)
}

function asNumberString(value: unknown, fallback = '0'): string {
  if (value == null || value === '') return fallback
  const num = Number(value)
  return Number.isFinite(num) ? `${num}` : String(value)
}

function clampDecimal(value: string): string {
  return value.replace(/[^\d.]/g, '')
}

function buildDrafts(items: IncomingInspectionItem[] | undefined): ItemDraft[] {
  return (items ?? []).map((item, index) => ({
    id: item.id,
    label: `${item.skuCode || ''} ${item.skuName || item.name || ''}`.trim() || `明细 ${index + 1}`,
    qtyDelivered: asNumberString(item.qtyDelivered),
    qtySampled: asNumberString(item.qtySampled),
    qtyPassed: asNumberString(item.qtyPassed),
    qtyFailed: asNumberString(item.qtyFailed),
    acceptedStockQty: asNumberString(item.acceptedStockQty ?? item.qtyPassed),
    dyeLotNo: asText(item.dyeLotNo),
    result: (item.result as ResultValue) || '',
    disposition: (item.disposition as DispositionValue) || '',
    notes: asText(item.notes),
    defectImages: Array.isArray(item.defectImages) ? item.defectImages.filter(Boolean) : [],
  }))
}

export default function QcInspectPage() {
  const [inspections, setInspections] = useState<IncomingInspection[]>([])
  const [inspectionIdx, setInspectionIdx] = useState(-1)
  const [detail, setDetail] = useState<IncomingInspection | null>(null)
  const [drafts, setDrafts] = useState<ItemDraft[]>([])
  const [activeItemIdx, setActiveItemIdx] = useState(0)
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([])
  const [locations, setLocations] = useState<LocationOption[]>([])
  const [warehouseIdx, setWarehouseIdx] = useState(-1)
  const [locationIdx, setLocationIdx] = useState(-1)
  const [overallResultIdx, setOverallResultIdx] = useState(0)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const inspectionRange = useMemo(
    () => inspections.map((item) => `${item.inspectionNo || item.id} · ${item.supplierName || item.purchaseOrderNo || '来料质检'}`),
    [inspections],
  )
  const activeDraft = drafts[activeItemIdx]
  const selectedWarehouse = warehouseIdx >= 0 ? warehouses[warehouseIdx] : null
  const selectedLocation = locationIdx >= 0 ? locations[locationIdx] : null

  const loadInspections = useCallback(async () => {
    setLoading(true)
    try {
      const res = await incomingInspectionApi.list({ page: 1, pageSize: 50 })
      setInspections(res.list ?? [])
      if (!detail && res.list?.[0]) {
        await selectInspectionById(res.list[0].id)
        setInspectionIdx(0)
      }
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '加载质检单失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }, [detail])

  const loadWarehouses = useCallback(async () => {
    try {
      const res = await inventoryApi.warehouses()
      setWarehouses(res)
    } catch {
      Taro.showToast({ title: '加载仓库失败', icon: 'none' })
    }
  }, [])

  useDidShow(() => {
    void loadInspections()
    void loadWarehouses()
  })

  useEffect(() => {
    if (!selectedWarehouse) {
      setLocations([])
      setLocationIdx(-1)
      return
    }
    void inventoryApi.locations(selectedWarehouse.id).then(setLocations).catch(() => {
      setLocations([])
      Taro.showToast({ title: '加载库位失败', icon: 'none' })
    })
  }, [selectedWarehouse])

  async function selectInspectionById(id: number) {
    const loaded = await incomingInspectionApi.detail(id)
    setDetail(loaded)
    setDrafts(buildDrafts(loaded.items))
    setActiveItemIdx(0)
    setNotes(asText((loaded as IncomingInspection & { notes?: string }).notes))
    const overallIndex = RESULT_OPTIONS.findIndex((item) => item.value === loaded.overallResult)
    setOverallResultIdx(overallIndex >= 0 ? overallIndex : 0)
  }

  const handleSelectInspection = async (idx: number) => {
    const selected = inspections[idx]
    if (!selected) return
    setLoading(true)
    try {
      setInspectionIdx(idx)
      await selectInspectionById(selected.id)
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '加载详情失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  const updateDraft = (patch: Partial<ItemDraft>) => {
    setDrafts((current) => current.map((item, index) => (index === activeItemIdx ? { ...item, ...patch } : item)))
  }

  const setDraftResult = (idx: number) => updateDraft({ result: RESULT_OPTIONS[idx]?.value ?? '' })

  const setDraftDisposition = (idx: number) => updateDraft({ disposition: DISPOSITION_OPTIONS[idx]?.value ?? '' })

  const uploadImages = async () => {
    if (!activeDraft) return
    const remaining = 3 - activeDraft.defectImages.length
    if (remaining <= 0) {
      Taro.showToast({ title: '每条明细最多 3 张图片', icon: 'none' })
      return
    }
    try {
      const picked = await Taro.chooseImage({ count: remaining, sizeType: ['compressed'], sourceType: ['camera', 'album'] })
      const uploaded: string[] = []
      for (const filePath of picked.tempFilePaths) {
        const result = await request.upload(filePath)
        uploaded.push(result.url)
      }
      updateDraft({ defectImages: [...activeDraft.defectImages, ...uploaded] })
    } catch (error) {
      if (error instanceof Error) Taro.showToast({ title: error.message, icon: 'none' })
    }
  }

  const removeImage = (url: string) => {
    if (!activeDraft) return
    updateDraft({ defectImages: activeDraft.defectImages.filter((item) => item !== url) })
  }

  const validateDrafts = () => {
    if (!detail) throw new Error('请先选择质检单')
    if (!drafts.length) throw new Error('当前质检单没有明细')
    const missing = drafts.find((item) => !item.result || !item.disposition)
    if (missing) throw new Error('请为每条明细选择结果和处置方式')
  }

  const saveItems = async () => {
    validateDrafts()
    if (!detail) return
    await incomingInspectionApi.updateItems(detail.id, drafts.map((item) => ({
      id: item.id,
      qtyDelivered: item.qtyDelivered,
      qtysampled: item.qtySampled,
      qtyPassed: item.qtyPassed,
      qtyFailed: item.qtyFailed,
      acceptedStockQty: item.acceptedStockQty,
      dyeLotNo: item.dyeLotNo || undefined,
      result: item.result,
      defectImages: item.defectImages,
      disposition: item.disposition,
      notes: item.notes || undefined,
    })))
  }

  const handleSave = async () => {
    setSubmitting(true)
    try {
      await saveItems()
      Taro.showToast({ title: '明细已保存', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '保存失败', icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      await saveItems()
      if (!detail || !selectedWarehouse || !selectedLocation) throw new Error('请选择放行仓库和库位')
      await incomingInspectionApi.submit(detail.id, {
        overallResult: RESULT_OPTIONS[overallResultIdx].value,
        warehouseId: selectedWarehouse.id,
        locationId: selectedLocation.id,
        notes: notes.trim() || undefined,
      })
      Taro.showToast({ title: '质检已提交', icon: 'success' })
      await selectInspectionById(detail.id)
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '提交失败', icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <View className='page'>
      <View className='hero'>
        <View>
          <Text className='eyebrow'>来料验货</Text>
          <View className='page__title'>来料质检任务</View>
        </View>
        <Text className='count-pill'>{inspections.length} 单</Text>
      </View>

      <View className='section'>
        <Text className='section-title'>选择质检单</Text>
        <Picker mode='selector' range={inspectionRange} value={Math.max(inspectionIdx, 0)} onChange={(event) => void handleSelectInspection(Number(event.detail.value))}>
          <View className='picker-box'>{detail ? `${detail.inspectionNo || detail.id} · ${detail.supplierName || '供应商'}` : '请选择质检单'}</View>
        </Picker>
        <Button className='primary-button' loading={loading} onClick={() => void loadInspections()}>刷新质检列表</Button>
      </View>

      {detail && activeDraft ? (
        <>
          <View className='info-grid'>
            <View className='info-card'><Text>质检单</Text><Text>{detail.inspectionNo || detail.id}</Text></View>
            <View className='info-card'><Text>采购单</Text><Text>{detail.purchaseOrderNo || '-'}</Text></View>
            <View className='info-card'><Text>状态</Text><Text>{detail.status}</Text></View>
          </View>

          <View className='section'>
            <Text className='section-title'>抽检明细</Text>
            <Picker mode='selector' range={drafts.map((item) => item.label)} value={activeItemIdx} onChange={(event) => setActiveItemIdx(Number(event.detail.value))}>
              <View className='picker-box'>{activeDraft.label}</View>
            </Picker>
            <View className='form-grid'>
              <Input className='input' type='digit' value={activeDraft.qtyDelivered} placeholder='送货数' onInput={(event) => updateDraft({ qtyDelivered: clampDecimal(event.detail.value) })} />
              <Input className='input' type='digit' value={activeDraft.qtySampled} placeholder='抽检数' onInput={(event) => updateDraft({ qtySampled: clampDecimal(event.detail.value) })} />
              <Input className='input' type='digit' value={activeDraft.qtyPassed} placeholder='合格数' onInput={(event) => updateDraft({ qtyPassed: clampDecimal(event.detail.value) })} />
              <Input className='input' type='digit' value={activeDraft.qtyFailed} placeholder='不良数' onInput={(event) => updateDraft({ qtyFailed: clampDecimal(event.detail.value) })} />
              <Input className='input' type='digit' value={activeDraft.acceptedStockQty} placeholder='接收入库数' onInput={(event) => updateDraft({ acceptedStockQty: clampDecimal(event.detail.value) })} />
              <Input className='input' value={activeDraft.dyeLotNo} placeholder='缸号/批号，可选' onInput={(event) => updateDraft({ dyeLotNo: event.detail.value })} />
            </View>
            <Picker mode='selector' range={RESULT_OPTIONS.map((item) => item.label)} value={Math.max(RESULT_OPTIONS.findIndex((item) => item.value === activeDraft.result), 0)} onChange={(event) => setDraftResult(Number(event.detail.value))}>
              <View className='picker-box'>结果：{RESULT_OPTIONS.find((item) => item.value === activeDraft.result)?.label || '请选择'}</View>
            </Picker>
            <Picker mode='selector' range={DISPOSITION_OPTIONS.map((item) => item.label)} value={Math.max(DISPOSITION_OPTIONS.findIndex((item) => item.value === activeDraft.disposition), 0)} onChange={(event) => setDraftDisposition(Number(event.detail.value))}>
              <View className='picker-box'>处置：{DISPOSITION_OPTIONS.find((item) => item.value === activeDraft.disposition)?.label || '请选择'}</View>
            </Picker>
            <Textarea className='textarea' value={activeDraft.notes} placeholder='明细备注，可选' maxlength={300} onInput={(event) => updateDraft({ notes: event.detail.value })} />

            <View className='image-row'>
              {activeDraft.defectImages.map((url) => (
                <View key={url} className='image-item' onClick={() => removeImage(url)}>
                  <Image className='image' src={url} mode='aspectFill' />
                  <Text className='image-remove'>移除</Text>
                </View>
              ))}
              <View className='image-add' onClick={() => void uploadImages()}>
                <Text>+</Text>
                <Text>留证图</Text>
              </View>
            </View>
          </View>

          <View className='section release-section'>
            <Text className='section-title'>放行入库</Text>
            <Picker mode='selector' range={RESULT_OPTIONS.map((item) => item.label)} value={overallResultIdx} onChange={(event) => setOverallResultIdx(Number(event.detail.value))}>
              <View className='picker-box'>总结果：{RESULT_OPTIONS[overallResultIdx].label}</View>
            </Picker>
            <Picker mode='selector' range={warehouses.map((item) => item.name)} value={Math.max(warehouseIdx, 0)} onChange={(event) => setWarehouseIdx(Number(event.detail.value))}>
              <View className='picker-box'>{selectedWarehouse?.name || '请选择仓库'}</View>
            </Picker>
            <Picker mode='selector' range={locations.map((item) => `${item.code || ''} ${item.name}`.trim())} value={Math.max(locationIdx, 0)} onChange={(event) => setLocationIdx(Number(event.detail.value))}>
              <View className='picker-box'>{selectedLocation ? `${selectedLocation.code || ''} ${selectedLocation.name}`.trim() : '请选择库位'}</View>
            </Picker>
            <Textarea className='textarea' value={notes} placeholder='质检备注，可选' maxlength={500} onInput={(event) => setNotes(event.detail.value)} />
            <View className='action-row'>
              <Button className='secondary-button' loading={submitting} onClick={() => void handleSave()}>保存明细</Button>
              <Button className='success-button' loading={submitting} onClick={() => void handleSubmit()}>提交结论</Button>
            </View>
          </View>
        </>
      ) : (
        <View className='empty-hint'>{loading ? '加载中...' : '暂无待处理质检明细'}</View>
      )}
    </View>
  )
}
