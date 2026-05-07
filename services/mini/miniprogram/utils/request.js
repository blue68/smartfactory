var config = require('./config')

var ApiCode = {
  SUCCESS: 0,
  UNAUTHORIZED: 1002,
  INVENTORY_LOCK_FAILED: 4003
}

function ApiError(code, message, data) {
  this.name = 'ApiError'
  this.code = code
  this.message = message || '服务异常，请稍后重试'
  this.data = data
}
ApiError.prototype = Object.create(Error.prototype)
ApiError.prototype.constructor = ApiError

function getToken() {
  return wx.getStorageSync(config.tokenKey) || ''
}

function setToken(token) {
  if (token) wx.setStorageSync(config.tokenKey, token)
}

function clearToken() {
  wx.removeStorageSync(config.tokenKey)
}

function buildUrl(url) {
  if (/^https?:\/\//.test(url)) return url
  var apiBaseUrl = config.getApiBaseUrl ? config.getApiBaseUrl() : config.apiBaseUrl
  return apiBaseUrl.replace(/\/$/, '') + url
}

function networkFailMessage(err, fallback) {
  var raw = err && err.errMsg ? String(err.errMsg) : ''
  if (/not in domain list|合法域名/i.test(raw)) {
    return '后端地址未加入微信 request 合法域名。本地联调请在开发者工具详情中勾选不校验合法域名，或改用已配置 HTTPS 域名。'
  }
  if (/timeout/i.test(raw)) return '请求超时，请检查后端服务和网络连接'
  if (/ERR_CONNECTION_REFUSED|connection refused/i.test(raw)) {
    return '本地后端未启动或端口不可访问。请先启动 API 服务，或保持小程序默认模拟模式进行本地演示。'
  }
  return raw || fallback
}

function request(options) {
  var token = getToken()
  return new Promise(function (resolve, reject) {
    wx.request({
      url: buildUrl(options.url),
      method: options.method || 'GET',
      data: options.data,
      timeout: options.timeout || 15000,
      header: {
        'Content-Type': 'application/json',
        Authorization: token ? 'Bearer ' + token : ''
      },
      success: function (res) {
        var body = res.data || {}
        if (res.statusCode === 401) {
          clearToken()
          reject(new ApiError(ApiCode.UNAUTHORIZED, '登录已过期，请重新登录'))
          return
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new ApiError(res.statusCode, body.message || ('请求失败 (' + res.statusCode + ')'), body.data))
          return
        }
        if (!body || body.code !== ApiCode.SUCCESS) {
          reject(new ApiError(typeof body.code === 'number' ? body.code : -1, body.message || '服务异常，请稍后重试', body.data))
          return
        }
        resolve(body.data)
      },
      fail: function (err) {
        reject(new ApiError(-1, networkFailMessage(err, '网络连接失败')))
      }
    })
  })
}

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

function get(url, params, options) {
  return request(Object.assign({ url: url, method: 'GET', data: params }, options || {}))
}

function post(url, data, options) {
  return request(Object.assign({ url: url, method: 'POST', data: data }, options || {}))
}

function put(url, data, options) {
  return request(Object.assign({ url: url, method: 'PUT', data: data }, options || {}))
}

function postWithLockRetry(url, data, options) {
  return post(url, data, options).catch(function (error) {
    if (error && error.code === ApiCode.INVENTORY_LOCK_FAILED) {
      return delay(800).then(function () {
        return post(url, data, options)
      })
    }
    throw error
  })
}

function upload(localPath, name) {
  var token = getToken()
  return new Promise(function (resolve, reject) {
    wx.uploadFile({
      url: buildUrl('/api/upload'),
      filePath: localPath,
      name: name || 'file',
      header: token ? { Authorization: 'Bearer ' + token } : {},
      success: function (res) {
        var parsed = {}
        try {
          parsed = JSON.parse(res.data)
        } catch (error) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            reject(new ApiError(-1, '上传响应解析失败'))
            return
          }
        }
        if (res.statusCode === 401) {
          clearToken()
          reject(new ApiError(ApiCode.UNAUTHORIZED, '登录已过期，请重新登录'))
          return
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new ApiError(res.statusCode, parsed && parsed.message ? parsed.message : ('上传失败 (' + res.statusCode + ')'), parsed && parsed.data))
          return
        }
        if (!parsed || parsed.code !== ApiCode.SUCCESS) {
          reject(new ApiError(parsed && parsed.code ? parsed.code : -1, parsed && parsed.message ? parsed.message : '上传失败'))
          return
        }
        resolve(parsed.data)
      },
      fail: function (err) {
        reject(new ApiError(-1, networkFailMessage(err, '上传失败')))
      }
    })
  })
}

module.exports = {
  ApiCode: ApiCode,
  ApiError: ApiError,
  get: get,
  post: post,
  put: put,
  postWithLockRetry: postWithLockRetry,
  upload: upload,
  getToken: getToken,
  setToken: setToken,
  clearToken: clearToken
}
