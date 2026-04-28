function getErrorMessage(error, fallback) {
  if (error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

function showError(error, fallback) {
  wx.showToast({
    title: getErrorMessage(error, fallback).slice(0, 28),
    icon: 'none',
    duration: 2600
  })
}

function showSuccess(title) {
  wx.showToast({ title: title, icon: 'success', duration: 1600 })
  wx.vibrateShort({ type: 'light' })
}

function confirmAction(title, content) {
  return new Promise(function (resolve) {
    wx.showModal({
      title: title,
      content: content,
      confirmText: '确认',
      cancelText: '取消',
      confirmColor: '#0f62d6',
      success: function (res) {
        resolve(Boolean(res.confirm))
      },
      fail: function () {
        resolve(false)
      }
    })
  })
}

function nowTimeLabel() {
  var date = new Date()
  var hour = String(date.getHours()).padStart(2, '0')
  var minute = String(date.getMinutes()).padStart(2, '0')
  return hour + ':' + minute
}

function stopPullDownRefresh() {
  wx.stopPullDownRefresh()
}

function decimalInput(value) {
  var text = String(value || '').replace(/[^\d.]/g, '')
  var firstDot = text.indexOf('.')
  if (firstDot < 0) return text
  return text.slice(0, firstDot + 1) + text.slice(firstDot + 1).replace(/\./g, '')
}

function asNumber(value) {
  var num = Number.parseFloat(value)
  return Number.isFinite(num) ? num : NaN
}

function formatSku(item) {
  if (!item) return ''
  return [item.skuCode || item.code || '', item.name || item.skuName || ''].filter(Boolean).join(' · ')
}

function getSkuId(item) {
  return item ? item.id || item.skuId : undefined
}

module.exports = {
  getErrorMessage: getErrorMessage,
  showError: showError,
  showSuccess: showSuccess,
  confirmAction: confirmAction,
  nowTimeLabel: nowTimeLabel,
  stopPullDownRefresh: stopPullDownRefresh,
  decimalInput: decimalInput,
  asNumber: asNumber,
  formatSku: formatSku,
  getSkuId: getSkuId
}
