import Taro from '@tarojs/taro'

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

export function showError(error: unknown, fallback: string): void {
  Taro.showToast({
    title: getErrorMessage(error, fallback).slice(0, 28),
    icon: 'none',
    duration: 2600,
  })
}

export function showSuccess(title: string): void {
  Taro.showToast({ title, icon: 'success', duration: 1800 })
  void Taro.vibrateShort({ type: 'light' }).catch(() => undefined)
}

export async function confirmAction(title: string, content: string): Promise<boolean> {
  const result = await Taro.showModal({
    title,
    content,
    confirmText: '确认',
    cancelText: '取消',
    confirmColor: '#0f62d6',
  })
  return result.confirm
}

export function nowTimeLabel(): string {
  const date = new Date()
  const hour = `${date.getHours()}`.padStart(2, '0')
  const minute = `${date.getMinutes()}`.padStart(2, '0')
  return `${hour}:${minute}`
}
