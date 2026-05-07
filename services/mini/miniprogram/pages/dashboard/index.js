var request = require('../../utils/request')
var auth = require('../../utils/auth')
var nav = require('../../utils/navigation')
var ui = require('../../utils/interaction')

function userName(user) {
  if (!user) return '未登录'
  return user.realName || user.name || user.username || user.account || '当前用户'
}

Page({
  data: {
    userLabel: '未登录',
    tenantLabel: '',
    modules: [],
    hasModules: false
  },

  onLoad: function () {
    this.refreshDashboard()
  },

  onShow: function () {
    this.refreshDashboard()
  },

  refreshDashboard: function () {
    if (!nav.ensureLogin()) return
    var user = auth.readUser()
    var modules = auth.getAllowedModules(user)
    this.setData({
      userLabel: userName(user),
      tenantLabel: user && user.tenantCode ? user.tenantCode : '',
      modules: modules,
      hasModules: modules.length > 0
    })
  },

  handleModuleTap: function (event) {
    var index = Number(event.currentTarget.dataset.index) || 0
    var module = this.data.modules[index]
    if (!module) return
    nav.openModule(module.route)
  },

  handleLogout: function () {
    ui.confirmAction('退出登录', '确认退出当前账号？').then(function (ok) {
      if (!ok) return
      request.clearToken()
      wx.removeStorageSync('sf_user')
      wx.redirectTo({ url: '/pages/login/index' })
    })
  }
})
