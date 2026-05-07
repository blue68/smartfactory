function getErrorMessage(error, fallback) {
  if (error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

function showError(error, fallback) {
  if (typeof wx === 'undefined' || !wx.showToast) return
  wx.showToast({
    title: getErrorMessage(error, fallback).slice(0, 28),
    icon: 'none',
    duration: 2600
  })
}

function showSuccess(title) {
  if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: title, icon: 'success', duration: 1600 })
  if (typeof wx !== 'undefined' && wx.vibrateShort) wx.vibrateShort({ type: 'light' })
}

function confirmAction(title, content) {
  return new Promise(function (resolve) {
    if (typeof wx === 'undefined' || !wx.showModal) {
      resolve(true)
      return
    }
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
  if (typeof wx !== 'undefined' && wx.stopPullDownRefresh) {
    try {
      wx.stopPullDownRefresh()
    } catch (error) {
      // Some simulator builds throw when no pull-down gesture is active.
    }
  }
}

function decimalInput(value, scale) {
  var maxScale = typeof scale === 'number' ? scale : 4
  var text = String(value || '').replace(/[^\d.]/g, '')
  var firstDot = text.indexOf('.')
  if (firstDot < 0) return text
  return text.slice(0, firstDot + 1) + text.slice(firstDot + 1).replace(/\./g, '').slice(0, maxScale)
}

function asNumber(value) {
  var num = parseFloat(value)
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
