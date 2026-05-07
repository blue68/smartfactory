var config = require('../../utils/config')
var request = require('../../utils/request')
var auth = require('../../utils/auth')
var ui = require('../../utils/interaction')

var LOCAL_MOCK_TOKEN = 'mock-access-token-abcdef'

function buildActionState(data) {
  var tenantCode = String(data.tenantCode || '').trim()
  var username = String(data.username || '').trim()
  var password = String(data.password || '')
  var ready = Boolean(tenantCode && username && password)
  return {
    loginDisabled: !ready || Boolean(data.loggingIn),
    loginHint: ready ? '登录后进入控制面板。' : '请填写租户、账号和密码。'
  }
}

Page({
  data: {
    tenantCode: '',
    username: '',
    password: '',
    loggingIn: false,
    loginDisabled: true,
    loginHint: '请填写租户、账号和密码。'
  },

  onLoad: function () {
    var runtimeConfig = config.getRuntimeConfig ? config.getRuntimeConfig() : {}
    this.applyState({
      tenantCode: runtimeConfig.tenantCode || config.tenantCode || '',
      username: ''
    })
    if (request.getToken()) {
      wx.redirectTo({ url: '/pages/dashboard/index' })
    }
  },

  applyState: function (patch) {
    var nextData = Object.assign({}, this.data, patch || {})
    this.setData(Object.assign({}, patch || {}, buildActionState(nextData)))
  },

  handleTenantInput: function (event) {
    this.applyState({ tenantCode: event.detail.value })
  },

  handleUsernameInput: function (event) {
    this.applyState({ username: event.detail.value })
  },

  handlePasswordInput: function (event) {
    this.applyState({ password: event.detail.value })
  },

  handleLogin: function () {
    var self = this
    var tenantCode = this.data.tenantCode.trim()
    var username = this.data.username.trim()
    var password = this.data.password
    if (this.data.loginDisabled || this.data.loggingIn) {
      ui.showError(this.data.loginHint, '登录信息不完整')
      return
    }
    if (config.isLocalApiBaseUrl && config.isLocalApiBaseUrl() && config.getUseMock && config.getUseMock()) {
      this.applyState({ loggingIn: true })
      request.setToken(LOCAL_MOCK_TOKEN)
      wx.setStorageSync('sf_user', auth.normalizeLoginUser({
        id: 18,
        username: username,
        realName: username,
        tenantCode: tenantCode
      }, {
        tenantCode: tenantCode,
        username: username
      }))
      wx.setStorageSync('sf_login_account', {
        tenantCode: tenantCode,
        username: username
      })
      config.setRuntimeConfig({
        tenantCode: tenantCode,
        useMock: true
      })
      this.applyState({ password: '', loggingIn: false })
      ui.showSuccess('登录成功')
      wx.redirectTo({ url: '/pages/dashboard/index' })
      return
    }
    config.setRuntimeConfig({
      tenantCode: tenantCode,
      useMock: false
    })
    this.applyState({ loggingIn: true })
    request.post('/api/auth/login', {
      loginMode: 'tenant',
      tenantCode: tenantCode,
      username: username,
      password: password
    }).then(function (data) {
      if (!data || !data.accessToken) throw new Error('登录响应缺少 accessToken')
      request.setToken(data.accessToken)
      wx.setStorageSync('sf_user', auth.normalizeLoginUser(data.user, {
        tenantCode: tenantCode,
        username: username
      }))
      wx.setStorageSync('sf_login_account', {
        tenantCode: tenantCode,
        username: username
      })
      self.applyState({ password: '' })
      ui.showSuccess('登录成功')
      wx.redirectTo({ url: '/pages/dashboard/index' })
    }).catch(function (error) {
      ui.showError(error, '登录失败')
    }).finally(function () {
      self.applyState({ loggingIn: false })
    })
  }
})
