var request = require('./request')

function currentPages() {
  return typeof getCurrentPages === 'function' ? getCurrentPages() : []
}

function goLogin() {
  wx.redirectTo({ url: '/pages/login/index' })
}

function ensureLogin() {
  if (request.getToken()) return true
  goLogin()
  return false
}

function backToDashboard() {
  var pages = currentPages()
  var previous = pages.length > 1 ? pages[pages.length - 2] : null
  if (previous && previous.route === 'pages/dashboard/index') {
    wx.navigateBack()
    return
  }
  wx.redirectTo({ url: '/pages/dashboard/index' })
}

function openModule(url) {
  wx.navigateTo({ url: url })
}

module.exports = {
  ensureLogin: ensureLogin,
  goLogin: goLogin,
  backToDashboard: backToDashboard,
  openModule: openModule
}
