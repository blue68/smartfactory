/**
 * [artifact:前端代码] — T214 QC 检验页
 * 功能：选择待检工单 → 填写检验结果 → 拍照上传 → 提交
 */

import { useState, useCallback } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { View, Text, Input, Textarea, Picker, Image } from '@tarojs/components'
import request from '../../utils/request'
import './index.css'

interface WorkOrder {
  id: number
  workOrderNo: string
  skuName: string
  qtyCompleted: number
  unit: string
}

const RESULT_OPTIONS = ['合格', '不合格', '返工']
const RESULT_MAP: Record<string, string> = { '合格': 'pass', '不合格': 'fail', '返工': 'rework' }

const DEFECT_TYPES = ['尺寸偏差', '色差', '缝线问题', '面料瑕疵', '功能缺陷', '包装破损', '其他']

export default function QcInspectPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [orderIdx, setOrderIdx] = useState<number>(-1)
  const [resultIdx, setResultIdx] = useState<number>(-1)
  const [defectTypes, setDefectTypes] = useState<boolean[]>(new Array(DEFECT_TYPES.length).fill(false))
  const [defectQty, setDefectQty] = useState('')
  const [remark, setRemark] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const res = await request.get<{ list: WorkOrder[] }>('/api/production/orders', {
        status: 'in_progress',
        pageSize: 50,
      })
      setOrders(res.list ?? [])
    } catch {
      Taro.showToast({ title: '加载工单失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }, [])

  useDidShow(() => { fetchOrders() })

  // ── 不良类型多选 ──
  const toggleDefect = (idx: number) => {
    setDefectTypes((prev) => {
      const next = [...prev]
      next[idx] = !next[idx]
      return next
    })
  }

  // ── 拍照/选择图片 ──
  const handleChooseImage = async () => {
    try {
      const res = await Taro.chooseImage({
        count: 3 - images.length,
        sizeType: ['compressed'],
        sourceType: ['camera', 'album'],
      })
      // 上传图片
      const uploaded: string[] = []
      for (const path of res.tempFilePaths) {
        try {
          const result = await request.upload(path)
          uploaded.push(result.url)
        } catch {
          Taro.showToast({ title: '图片上传失败', icon: 'none' })
        }
      }
      setImages((prev) => [...prev, ...uploaded].slice(0, 3))
    } catch {
      // 用户取消选择
    }
  }

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx))
  }

  // ── 表单校验 ──
  const validate = (): boolean => {
    if (orderIdx < 0) {
      Taro.showToast({ title: '请选择待检工单', icon: 'none' })
      return false
    }
    if (resultIdx < 0) {
      Taro.showToast({ title: '请选择检验结果', icon: 'none' })
      return false
    }
    const result = RESULT_OPTIONS[resultIdx]
    if (result !== '合格') {
      const hasDefect = defectTypes.some(Boolean)
      if (!hasDefect) {
        Taro.showToast({ title: '请选择不良类型', icon: 'none' })
        return false
      }
      const qty = parseFloat(defectQty)
      if (!defectQty || isNaN(qty) || qty <= 0) {
        Taro.showToast({ title: '请输入不良数量', icon: 'none' })
        return false
      }
    }
    return true
  }

  // ── 提交检验 ──
  const handleSubmit = async () => {
    if (!validate()) return
    const order = orders[orderIdx]
    const result = RESULT_MAP[RESULT_OPTIONS[resultIdx]]
    const selectedDefects = DEFECT_TYPES.filter((_, i) => defectTypes[i])

    setSubmitting(true)
    try {
      await request.post('/api/quality/inspections', {
        productionOrderId: order.id,
        result,
        issueTypes: selectedDefects,
        defectQty: result !== 'pass' ? parseFloat(defectQty) : 0,
        remark: remark || undefined,
        imageUrls: images.length > 0 ? images : undefined,
      })
      Taro.showToast({ title: '检验提交成功', icon: 'success' })
      // 重置
      setOrderIdx(-1)
      setResultIdx(-1)
      setDefectTypes(new Array(DEFECT_TYPES.length).fill(false))
      setDefectQty('')
      setRemark('')
      setImages([])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '提交失败'
      Taro.showToast({ title: msg, icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }

  const showDefectFields = resultIdx >= 0 && RESULT_OPTIONS[resultIdx] !== '合格'

  return (
    <View className='page'>
      <View className='page__title'>QC 检验</View>

      {loading ? (
        <View className='loading-hint'>加载中...</View>
      ) : (
        <View className='form'>
          {/* 选择工单 */}
          <View className='form__group'>
            <Text className='form__label'>待检工单 *</Text>
            <Picker
              mode='selector'
              range={orders.map((o) => `${o.workOrderNo} - ${o.skuName}`)}
              value={orderIdx}
              onChange={(e) => setOrderIdx(Number(e.detail.value))}
            >
              <View className='form__picker'>
                {orderIdx >= 0
                  ? `${orders[orderIdx].workOrderNo} - ${orders[orderIdx].skuName}`
                  : '请选择工单'}
              </View>
            </Picker>
          </View>

          {/* 检验结果 */}
          <View className='form__group'>
            <Text className='form__label'>检验结果 *</Text>
            <Picker
              mode='selector'
              range={RESULT_OPTIONS}
              value={resultIdx}
              onChange={(e) => setResultIdx(Number(e.detail.value))}
            >
              <View className='form__picker'>
                {resultIdx >= 0 ? RESULT_OPTIONS[resultIdx] : '请选择结果'}
              </View>
            </Picker>
          </View>

          {/* 不良类型（多选） — 仅不合格/返工时显示 */}
          {showDefectFields && (
            <>
              <View className='form__group'>
                <Text className='form__label'>不良类型 *（可多选）</Text>
                <View className='defect-tags'>
                  {DEFECT_TYPES.map((dt, i) => (
                    <View
                      key={dt}
                      className={`defect-tag ${defectTypes[i] ? 'defect-tag--active' : ''}`}
                      onClick={() => toggleDefect(i)}
                    >
                      {dt}
                    </View>
                  ))}
                </View>
              </View>

              <View className='form__group'>
                <Text className='form__label'>不良数量 *</Text>
                <Input
                  className='form__input'
                  type='digit'
                  placeholder='请输入不良品数量'
                  value={defectQty}
                  onInput={(e) => setDefectQty(e.detail.value)}
                />
              </View>
            </>
          )}

          {/* 备注 */}
          <View className='form__group'>
            <Text className='form__label'>备注</Text>
            <Textarea
              className='form__textarea'
              placeholder='检验说明（选填）'
              value={remark}
              onInput={(e) => setRemark(e.detail.value)}
              maxlength={300}
            />
          </View>

          {/* 图片上传 */}
          <View className='form__group'>
            <Text className='form__label'>现场照片（最多3张）</Text>
            <View className='image-list'>
              {images.map((url, i) => (
                <View key={url} className='image-item'>
                  <Image className='image-item__img' src={url} mode='aspectFill' />
                  <View className='image-item__remove' onClick={() => removeImage(i)}>✕</View>
                </View>
              ))}
              {images.length < 3 && (
                <View className='image-add' onClick={handleChooseImage}>
                  <Text className='image-add__icon'>+</Text>
                  <Text className='image-add__text'>拍照</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      )}

      {/* 提交按钮 */}
      <View
        className={`btn-submit ${submitting ? 'btn-submit--disabled' : ''}`}
        onClick={submitting ? undefined : handleSubmit}
      >
        {submitting ? '提交中...' : '提交检验'}
      </View>
    </View>
  )
}
