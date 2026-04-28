import { useCallback, useEffect, useMemo, useState } from 'react'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { Button, Input, Picker, Text, View } from '@tarojs/components'
import {
  getSkuId,
  inventoryApi,
  LocationOption,
  SkuOption,
  skuApi,
  WarehouseOption,
} from '../../utils/api'
import { confirmAction, getErrorMessage, nowTimeLabel, showError, showSuccess } from '../../utils/interaction'
import './index.css'

interface ParsedWarehouseScanPayload {
  keyword: string
  skuId: string
  dyeLotNo: string
  deliveryNo: string
}

function clampDecimal(value: string): string {
  return value.replace(/[^\d.]/g, '')
}

function parseWarehouseScanPayload(raw: string): ParsedWarehouseScanPayload | null {
  const payload = raw.trim()
  if (!payload) return null
  const parsed = { keyword: payload, skuId: '', dyeLotNo: '', deliveryNo: '' }
  const segments = payload.split('|')
  if (segments.length === 1) return parsed

  const kv = new Map<string, string>()
  segments.slice(1).forEach((segment) => {
    const [key, ...rest] = segment.split('=')
    if (key) kv.set(key, rest.join('='))
  })

  if (segments[0] === 'SMART_FACTORY_SKU') {
    return {
      keyword: kv.get('SKU_CODE') || payload,
      skuId: kv.get('SKU_ID') || '',
      dyeLotNo: kv.get('DYE_LOT') || kv.get('BATCH') || '',
      deliveryNo: '',
    }
  }

  if (segments[0] === 'SMART_FACTORY_DELIVERY') {
    const deliveryNo = kv.get('DELIVERY_NO') || ''
    return {
      keyword: deliveryNo || kv.get('SKU_CODE') || payload,
      skuId: kv.get('SKU_ID') || '',
      dyeLotNo: kv.get('DYE_LOT') || kv.get('BATCH') || '',
      deliveryNo,
    }
  }

  return parsed
}

export default function WarehouseInboundPage() {
  const [keyword, setKeyword] = useState('')
  const [skuOptions, setSkuOptions] = useState<SkuOption[]>([])
  const [skuIdx, setSkuIdx] = useState(-1)
  const [qty, setQty] = useState('')
  const [dyeLotNo, setDyeLotNo] = useState('')
  const [deliveryNo, setDeliveryNo] = useState('')
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([])
  const [locations, setLocations] = useState<LocationOption[]>([])
  const [warehouseIdx, setWarehouseIdx] = useState(-1)
  const [locationIdx, setLocationIdx] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [lastRefreshAt, setLastRefreshAt] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const selectedSku = skuIdx >= 0 ? skuOptions[skuIdx] : null
  const selectedWarehouse = warehouseIdx >= 0 ? warehouses[warehouseIdx] : null
  const selectedLocation = locationIdx >= 0 ? locations[locationIdx] : null
  const skuRange = useMemo(() => skuOptions.map((item) => `${item.skuCode || item.code} · ${item.name}`), [skuOptions])

  const loadWarehouses = useCallback(async () => {
    setLoadError('')
    try {
      const res = await inventoryApi.warehouses()
      setWarehouses(res)
      if (res.length && warehouseIdx < 0) setWarehouseIdx(0)
      setLastRefreshAt(nowTimeLabel())
    } catch (error) {
      setLoadError(getErrorMessage(error, '加载仓库失败'))
      showError(error, '加载仓库失败')
    } finally {
      Taro.stopPullDownRefresh()
    }
  }, [warehouseIdx])

  useDidShow(() => {
    void loadWarehouses()
  })

  usePullDownRefresh(() => {
    void loadWarehouses()
  })

  useEffect(() => {
    if (!selectedWarehouse) {
      setLocations([])
      setLocationIdx(-1)
      return
    }
    void inventoryApi.locations(selectedWarehouse.id).then((res) => {
      setLocations(res)
      setLocationIdx(res.length ? 0 : -1)
    }).catch(() => {
      setLocations([])
      setLocationIdx(-1)
      showError('加载库位失败', '加载库位失败')
    })
  }, [selectedWarehouse])

  const searchSku = async (nextKeyword = keyword): Promise<SkuOption[]> => {
    const text = nextKeyword.trim()
    if (!text) {
      Taro.showToast({ title: '请输入 SKU 编码或名称', icon: 'none' })
      return []
    }
    setLoading(true)
    try {
      const res = await skuApi.search(text)
      const list = res.list ?? []
      setSkuOptions(list)
      setSkuIdx(list.length ? 0 : -1)
      if (!list.length) Taro.showToast({ title: '未找到物料', icon: 'none' })
      return list
    } catch (error) {
      showError(error, '查询物料失败')
      return []
    } finally {
      setLoading(false)
    }
  }

  const handleScan = async () => {
    try {
      const scan = await Taro.scanCode({ scanType: ['qrCode', 'barCode'] })
      const parsed = parseWarehouseScanPayload(scan.result)
      if (!parsed) {
        Taro.showToast({ title: '未识别到物料标签', icon: 'none' })
        return
      }
      setKeyword(parsed.keyword)
      setDyeLotNo(parsed.dyeLotNo)
      setDeliveryNo(parsed.deliveryNo)
      const list = await searchSku(parsed.keyword)
      if (parsed.skuId) {
        const idx = list.findIndex((item) => String(getSkuId(item)) === parsed.skuId)
        if (idx >= 0) setSkuIdx(idx)
      }
      showSuccess('扫码已回填')
    } catch (error) {
      showError(error, '扫码失败')
    }
  }

  const validate = () => {
    const skuId = selectedSku ? getSkuId(selectedSku) : undefined
    const qtyNum = Number.parseFloat(qty)
    if (!skuId) throw new Error('请选择入库物料')
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) throw new Error('请输入有效入库数量')
    if (!selectedWarehouse || !selectedLocation) throw new Error('请选择仓库和库位')
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      validate()
      if (!selectedSku || !selectedWarehouse || !selectedLocation) return
      const confirmed = await confirmAction(
        '确认上架入库',
        `物料：${selectedSku.skuCode || selectedSku.code || selectedSku.name}\n数量：${qty} ${selectedSku.stockUnit || selectedSku.purchaseUnit || selectedSku.unit || '件'}\n库位：${selectedLocation.name}`,
      )
      if (!confirmed) return
      await inventoryApi.inbound({
        skuCode: selectedSku.skuCode || selectedSku.code || '',
        skuId: getSkuId(selectedSku),
        qtyInput: qty,
        inputUnit: selectedSku.stockUnit || selectedSku.purchaseUnit || selectedSku.unit || '件',
        warehouseId: selectedWarehouse.id,
        locationId: selectedLocation.id,
        dyeLotNo: dyeLotNo.trim() || undefined,
        transactionType: 'purchase_in',
      })
      showSuccess('上架入库成功')
      setQty('')
      setDyeLotNo('')
      setDeliveryNo('')
      setSkuIdx(-1)
    } catch (error) {
      showError(error, '入库失败')
    } finally {
      setSubmitting(false)
    }
  }

  const resetForm = async () => {
    const confirmed = await confirmAction('清空表单', '确认清空当前物料、数量和批次信息？')
    if (!confirmed) return
    setKeyword('')
    setSkuOptions([])
    setSkuIdx(-1)
    setQty('')
    setDyeLotNo('')
    setDeliveryNo('')
  }

  const addQuickQty = (value: string) => {
    const current = Number.parseFloat(qty)
    const delta = Number.parseFloat(value)
    setQty(`${(Number.isFinite(current) ? current : 0) + delta}`)
  }

  return (
    <View className='page'>
      <View className='hero'>
        <View>
          <Text className='eyebrow'>物料库存上架</Text>
          <View className='page__title'>来料入库上架</View>
          <Text className='hero-subtitle'>{lastRefreshAt ? `仓库同步 ${lastRefreshAt}` : '扫码或搜索后完成上架'}</Text>
        </View>
        <Button className='scan-button' onClick={() => void handleScan()}>扫码</Button>
      </View>

      <View className='metric-grid'>
        <View className='metric-card'>
          <Text className='metric-value'>{skuOptions.length}</Text>
          <Text className='metric-label'>候选物料</Text>
        </View>
        <View className='metric-card'>
          <Text className='metric-value'>{warehouses.length}</Text>
          <Text className='metric-label'>可用仓库</Text>
        </View>
        <View className='metric-card'>
          <Text className='metric-value'>{locations.length}</Text>
          <Text className='metric-label'>当前库位</Text>
        </View>
      </View>

      {loadError && (
        <View className='alert-card'>
          <Text className='alert-title'>仓库资料同步失败</Text>
          <Text className='alert-text'>{loadError}</Text>
          <Button className='alert-action' onClick={() => void loadWarehouses()}>重试</Button>
        </View>
      )}

      <View className='section'>
        <Text className='section-title'>物料检索</Text>
        <View className='inline-row'>
          <Input className='input flex' value={keyword} placeholder='SKU 编码 / 名称 / 条码' onInput={(event) => setKeyword(event.detail.value)} />
          <Button className='primary-small' loading={loading} onClick={() => void searchSku()}>查询</Button>
        </View>
        <Text className='field-help'>扫码失败时可直接输入 SKU 编码或名称查询。</Text>
        <Picker mode='selector' range={skuRange} value={Math.max(skuIdx, 0)} onChange={(event) => setSkuIdx(Number(event.detail.value))}>
          <View className='picker-box'>{selectedSku ? `${selectedSku.skuCode || selectedSku.code} · ${selectedSku.name}` : '请选择物料'}</View>
        </Picker>
        {selectedSku && (
          <View className='sku-card'>
            <Text className='sku-code'>{selectedSku.skuCode || selectedSku.code}</Text>
            <Text className='sku-name'>{selectedSku.name}</Text>
            <Text className='sku-unit'>默认单位：{selectedSku.stockUnit || selectedSku.purchaseUnit || selectedSku.unit || '件'}</Text>
          </View>
        )}
      </View>

      <View className='section'>
        <Text className='section-title'>上架信息</Text>
        {deliveryNo && <View className='delivery-hint'>已识别送货单：{deliveryNo}</View>}
        <Input className='input' type='digit' value={qty} placeholder='入库数量' onInput={(event) => setQty(clampDecimal(event.detail.value))} />
        <View className='quick-row'>
          {['1', '5', '10', '50'].map((item) => (
            <View key={item} className='quick-chip' onClick={() => addQuickQty(item)}>+{item}</View>
          ))}
        </View>
        <Input className='input' value={dyeLotNo} placeholder='缸号/批次，可选' onInput={(event) => setDyeLotNo(event.detail.value)} />
        <Picker mode='selector' range={warehouses.map((item) => item.name)} value={Math.max(warehouseIdx, 0)} onChange={(event) => setWarehouseIdx(Number(event.detail.value))}>
          <View className='picker-box'>{selectedWarehouse?.name || '请选择仓库'}</View>
        </Picker>
        <Picker mode='selector' range={locations.map((item) => `${item.code || ''} ${item.name}`.trim())} value={Math.max(locationIdx, 0)} onChange={(event) => setLocationIdx(Number(event.detail.value))}>
          <View className='picker-box'>{selectedLocation ? `${selectedLocation.code || ''} ${selectedLocation.name}`.trim() : '请选择库位'}</View>
        </Picker>
        <Text className='field-help'>提交前会二次确认，确认后生成库存入库流水。</Text>
        <View className='action-row'>
          <Button className='secondary-button' disabled={submitting} onClick={() => void resetForm()}>清空</Button>
          <Button className='submit-button' loading={submitting} disabled={submitting} onClick={() => void handleSubmit()}>确认上架</Button>
        </View>
      </View>
    </View>
  )
}
