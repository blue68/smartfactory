var runtimeConfigKey = 'sf_mini_runtime_config'
var tokenKey = 'sf_access_token'

function getRuntimeConfig() {
  if (typeof wx === 'undefined' || !wx.getStorageSync) return {}
  try {
    return wx.getStorageSync(runtimeConfigKey) || {}
  } catch (error) {
    return {}
  }
}

function setRuntimeConfig(patch) {
  if (typeof wx === 'undefined' || !wx.setStorageSync) return {}
  var nextConfig = Object.assign({}, getRuntimeConfig(), patch || {})
  wx.setStorageSync(runtimeConfigKey, nextConfig)
  return nextConfig
}

function getApiBaseUrl() {
  return getRuntimeConfig().apiBaseUrl || module.exports.apiBaseUrl
}

function getUseMock() {
  var runtimeConfig = getRuntimeConfig()
  if (runtimeConfig.useMock !== undefined) return Boolean(runtimeConfig.useMock)
  return Boolean(module.exports.useMock)
}

function isLocalApiBaseUrl(apiBaseUrl) {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(String(apiBaseUrl || getApiBaseUrl()).trim())
}

function getRuntimeSignature() {
  if (typeof wx === 'undefined' || !wx.getStorageSync) {
    return [getApiBaseUrl(), getUseMock() ? 'mock' : 'real'].join('|')
  }
  var runtimeConfig = getRuntimeConfig()
  var user = wx.getStorageSync('sf_user') || {}
  var token = wx.getStorageSync(tokenKey) || ''
  return [
    getApiBaseUrl(),
    runtimeConfig.tenantCode || module.exports.tenantCode,
    getUseMock() ? 'mock' : 'real',
    token ? String(token).slice(-12) : '',
    user.id || user.userId || ''
  ].join('|')
}

module.exports = {
  apiBaseUrl: 'http://localhost:3000',
  tokenKey: tokenKey,
  tenantCode: 'FACTORY001',
  useMock: true,
  runtimeConfigKey: runtimeConfigKey,
  getRuntimeConfig: getRuntimeConfig,
  setRuntimeConfig: setRuntimeConfig,
  getApiBaseUrl: getApiBaseUrl,
  getUseMock: getUseMock,
  isLocalApiBaseUrl: isLocalApiBaseUrl,
  getRuntimeSignature: getRuntimeSignature
}
