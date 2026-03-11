/**
 * [artifact:前端代码] — T212 仓库入库页
 * 功能：扫码识别物料 → 填写入库数量/缸号/仓位 → 提交入库
 */

import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { View, Text, Input, Picker } from '@tarojs/components'
import request from '../../utils/request'
import './index.css'

interface SkuInfo {
  skuId: number
  skuCode: string
  name: string
  stockUnit: string
}

interface Warehouse {
  id: number
  name: string
}

export default function WarehouseInboundPage() {
  const [sku, setSku] = useState<SkuInfo | null>(null)
  const [qty, setQty] = useState('')
  const [dyeLot, setDyeLot] = useState('')
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [warehouseIdx, setWarehouseIdx] = useState<number>(-1)
  const [loading, setLoading] = useState(false)

  useDidShow(() => {
    // 加载仓库列表
    request.get<Warehouse[]>('/api/inventory/warehouses').then(setWarehouses).catch(() => {})
  })

  // ── 扫码识别物料 ──
  const handleScan = async () => {
    try {
      const res = await Taro.scanCode({ scanType: ['barCode', 'qrCode'] })
      const code = res.result
      Taro.showLoading({ title: '查询物料...' })
      const info = await request.get<SkuInfo>('/api/skus/by-code', { code })
      setSku(info)
      Taro.hideLoading()
    } catch (err: unknown) {
      Taro.hideLoading()
      const msg = err instanceof Error ? err.message : '扫码失败'
      Taro.showToast({ title: msg, icon: 'none' })
    }
  }

  // ── 表单校验 ──
  const validate = (): boolean => {
    if (!sku) {
      Taro.showToast({ title: '请先扫码选择物料', icon: 'none' })
      return false
    }
    const qtyNum = parseFloat(qty)
    if (!qty || isNaN(qtyNum) || qtyNum <= 0) {
      Taro.showToast({ title: '请输入有效入库数量', icon: 'none' })
      return false
    }
    if (warehouseIdx < 0) {
      Taro.showToast({ title: '请选择入库仓位', icon: 'none' })
      return false
    }
    return true
  }

  // ── 提交入库 ──
  const handleSubmit = async () => {
    if (!validate() || !sku) return
    setLoading(true)
    try {
      await request.postWithLockRetry('/api/inventory/inbound', {
        skuId: sku.skuId,
        qty: parseFloat(qty),
        warehouseId: warehouses[warehouseIdx].id,
        dyeLotNo: dyeLot || undefined,
      })
      Taro.showToast({ title: '入库成功', icon: 'success' })
      // 重置表单
      setSku(null)
      setQty('')
      setDyeLot('')
      setWarehouseIdx(-1)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '入库失败'
      Taro.showToast({ title: msg, icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <View className='page'>
      <View className='page__title'>仓库入库</View>

      {/* 扫码区域 */}
      <View className='scan-area' onClick={handleScan}>
        <Text className='scan-area__icon'>📷</Text>
        <Text className='scan-area__text'>
          {sku ? `${sku.name} (${sku.skuCode})` : '点击扫码识别物料'}
        </Text>
      </View>

      {/* 入库表单 */}
      <View className='form'>
        <View className='form__group'>
          <Text className='form__label'>入库数量 *</Text>
          <Input
            className='form__input'
            type='digit'
            placeholder={sku ? `单位：${sku.stockUnit}` : '请先扫码'}
            value={qty}
            onInput={(e) => setQty(e.detail.value)}
            disabled={!sku}
          />
        </View>

        <View className='form__group'>
          <Text className='form__label'>缸号/批号</Text>
          <Input
            className='form__input'
            placeholder='选填，用于染色追溯'
            value={dyeLot}
            onInput={(e) => setDyeLot(e.detail.value)}
          />
        </View>

        <View className='form__group'>
          <Text className='form__label'>入库仓位 *</Text>
          <Picker
            mode='selector'
            range={warehouses.map((w) => w.name)}
            value={warehouseIdx}
            onChange={(e) => setWarehouseIdx(Number(e.detail.value))}
          >
            <View className='form__picker'>
              {warehouseIdx >= 0 ? warehouses[warehouseIdx].name : '请选择仓位'}
            </View>
          </Picker>
        </View>
      </View>

      {/* 提交按钮 */}
      <View
        className={`btn-submit ${loading ? 'btn-submit--disabled' : ''}`}
        onClick={loading ? undefined : handleSubmit}
      >
        {loading ? '提交中...' : '确认入库'}
      </View>
    </View>
  )
}
