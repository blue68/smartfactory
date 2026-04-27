import { useCallback, useEffect, useMemo, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Input, Picker, Text, View } from '@tarojs/components'
import {
  getSkuId,
  inventoryApi,
  LocationOption,
  SkuOption,
  skuApi,
  WarehouseOption,
} from '../../utils/api'
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
  const [submitting, setSubmitting] = useState(false)

  const selectedSku = skuIdx >= 0 ? skuOptions[skuIdx] : null
  const selectedWarehouse = warehouseIdx >= 0 ? warehouses[warehouseIdx] : null
  const selectedLocation = locationIdx >= 0 ? locations[locationIdx] : null
  const skuRange = useMemo(() => skuOptions.map((item) => `${item.skuCode || item.code} · ${item.name}`), [skuOptions])

  const loadWarehouses = useCallback(async () => {
    try {
      const res = await inventoryApi.warehouses()
      setWarehouses(res)
      if (res.length && warehouseIdx < 0) setWarehouseIdx(0)
    } catch {
      Taro.showToast({ title: '加载仓库失败', icon: 'none' })
    }
  }, [warehouseIdx])

  useDidShow(() => {
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
      Taro.showToast({ title: '加载库位失败', icon: 'none' })
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
      Taro.showToast({ title: error instanceof Error ? error.message : '查询物料失败', icon: 'none' })
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
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '扫码失败', icon: 'none' })
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
      Taro.showToast({ title: '上架入库成功', icon: 'success' })
      setQty('')
      setDyeLotNo('')
      setDeliveryNo('')
      setSkuIdx(-1)
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '入库失败', icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <View className='page'>
      <View className='hero'>
        <View>
          <Text className='eyebrow'>物料库存上架</Text>
          <View className='page__title'>来料入库上架</View>
        </View>
        <Button className='scan-button' onClick={() => void handleScan()}>扫码</Button>
      </View>

      <View className='section'>
        <Text className='section-title'>物料检索</Text>
        <View className='inline-row'>
          <Input className='input flex' value={keyword} placeholder='SKU 编码 / 名称 / 条码' onInput={(event) => setKeyword(event.detail.value)} />
          <Button className='primary-small' loading={loading} onClick={() => void searchSku()}>查询</Button>
        </View>
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
        <Input className='input' value={dyeLotNo} placeholder='缸号/批次，可选' onInput={(event) => setDyeLotNo(event.detail.value)} />
        <Picker mode='selector' range={warehouses.map((item) => item.name)} value={Math.max(warehouseIdx, 0)} onChange={(event) => setWarehouseIdx(Number(event.detail.value))}>
          <View className='picker-box'>{selectedWarehouse?.name || '请选择仓库'}</View>
        </Picker>
        <Picker mode='selector' range={locations.map((item) => `${item.code || ''} ${item.name}`.trim())} value={Math.max(locationIdx, 0)} onChange={(event) => setLocationIdx(Number(event.detail.value))}>
          <View className='picker-box'>{selectedLocation ? `${selectedLocation.code || ''} ${selectedLocation.name}`.trim() : '请选择库位'}</View>
        </Picker>
        <Button className='submit-button' loading={submitting} onClick={() => void handleSubmit()}>确认上架入库</Button>
      </View>
    </View>
  )
}
