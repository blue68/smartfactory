/**
 * [artifact:前端代码] — T213 工人任务页
 * 功能：查看待办任务列表 → 填写完工数量 → 提交完成
 */

import { useState, useCallback } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { View, Text, Input, Textarea } from '@tarojs/components'
import request from '../../utils/request'
import './index.css'

interface TaskItem {
  id: number
  workOrderNo: string
  stepName: string
  plannedQty: number
  unit: string
  status: string
  skuName: string
}

export default function WorkerTaskPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [completedQty, setCompletedQty] = useState('')
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await request.get<{ list: TaskItem[] }>('/api/production/tasks', {
        workerId: 'me',
        status: 'pending',
      })
      setTasks(res.list ?? [])
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }, [])

  useDidShow(() => { fetchTasks() })

  // ── 打开完工表单 ──
  const openComplete = (taskId: number) => {
    setActiveId(taskId)
    setCompletedQty('')
    setRemark('')
  }

  // ── 提交完成 ──
  const handleSubmit = async () => {
    if (activeId === null) return
    const qtyNum = parseFloat(completedQty)
    if (!completedQty || isNaN(qtyNum) || qtyNum <= 0) {
      Taro.showToast({ title: '请输入有效完成数量', icon: 'none' })
      return
    }

    setSubmitting(true)
    try {
      await request.post(`/api/production/tasks/${activeId}/complete`, {
        completedQty: qtyNum,
        remark: remark || undefined,
      })
      Taro.showToast({ title: '提交成功', icon: 'success' })
      setActiveId(null)
      fetchTasks()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '提交失败'
      Taro.showToast({ title: msg, icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }

  const statusLabel: Record<string, string> = {
    pending: '待完成', in_progress: '进行中', completed: '已完成',
  }

  return (
    <View className='page'>
      <View className='page__title'>我的任务</View>

      {loading ? (
        <View className='loading-hint'>加载中...</View>
      ) : tasks.length === 0 ? (
        <View className='empty-hint'>暂无待办任务，休息一下吧</View>
      ) : (
        <View className='task-list'>
          {tasks.map((task) => (
            <View key={task.id} className='task-card'>
              <View className='task-card__header'>
                <Text className='task-card__order-no'>{task.workOrderNo}</Text>
                <Text className='task-card__status'>{statusLabel[task.status] ?? task.status}</Text>
              </View>
              <View className='task-card__body'>
                <Text className='task-card__sku'>{task.skuName}</Text>
                <Text className='task-card__step'>{task.stepName}</Text>
                <Text className='task-card__qty'>计划：{task.plannedQty} {task.unit}</Text>
              </View>

              {activeId === task.id ? (
                <View className='complete-form'>
                  <View className='complete-form__group'>
                    <Text className='complete-form__label'>完成数量 *</Text>
                    <Input
                      className='complete-form__input'
                      type='digit'
                      placeholder={`单位：${task.unit}`}
                      value={completedQty}
                      onInput={(e) => setCompletedQty(e.detail.value)}
                    />
                  </View>
                  <View className='complete-form__group'>
                    <Text className='complete-form__label'>备注</Text>
                    <Textarea
                      className='complete-form__textarea'
                      placeholder='选填'
                      value={remark}
                      onInput={(e) => setRemark(e.detail.value)}
                      maxlength={200}
                    />
                  </View>
                  <View className='complete-form__actions'>
                    <View className='btn-cancel' onClick={() => setActiveId(null)}>取消</View>
                    <View
                      className={`btn-confirm ${submitting ? 'btn-confirm--disabled' : ''}`}
                      onClick={submitting ? undefined : handleSubmit}
                    >
                      {submitting ? '提交中...' : '确认完成'}
                    </View>
                  </View>
                </View>
              ) : (
                <View className='task-card__action' onClick={() => openComplete(task.id)}>
                  报工完成
                </View>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  )
}
