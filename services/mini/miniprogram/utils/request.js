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

function clearToken() {
  wx.removeStorageSync(config.tokenKey)
}

function buildUrl(url) {
  if (/^https?:\/\//.test(url)) return url
  return config.apiBaseUrl.replace(/\/$/, '') + url
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
        reject(new ApiError(-1, err.errMsg || '网络连接失败'))
      }
    })
  })
}

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

function get(url, params) {
  return request({ url: url, method: 'GET', data: params })
}

function post(url, data) {
  return request({ url: url, method: 'POST', data: data })
}

function put(url, data) {
  return request({ url: url, method: 'PUT', data: data })
}

function postWithLockRetry(url, data) {
  return post(url, data).catch(function (error) {
    if (error && error.code === ApiCode.INVENTORY_LOCK_FAILED) {
      return delay(800).then(function () {
        return post(url, data)
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
        var parsed
        try {
          parsed = JSON.parse(res.data)
        } catch (error) {
          reject(new ApiError(-1, '上传响应解析失败'))
          return
        }
        if (!parsed || parsed.code !== ApiCode.SUCCESS) {
          reject(new ApiError(parsed && parsed.code ? parsed.code : -1, parsed && parsed.message ? parsed.message : '上传失败'))
          return
        }
        resolve(parsed.data)
      },
      fail: function (err) {
        reject(new ApiError(-1, err.errMsg || '上传失败'))
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
  clearToken: clearToken
}
