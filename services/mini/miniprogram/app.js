function installCompatibilityPolyfills() {
  if (!Promise.prototype.finally) {
    Promise.prototype.finally = function (callback) {
      var PromiseCtor = this.constructor
      return this.then(
        function (value) {
          return PromiseCtor.resolve(callback()).then(function () { return value })
        },
        function (reason) {
          return PromiseCtor.resolve(callback()).then(function () { throw reason })
        }
      )
    }
  }
  if (!Number.isFinite) {
    Number.isFinite = function (value) {
      return typeof value === 'number' && isFinite(value)
    }
  }
  if (!Array.prototype.findIndex) {
    Array.prototype.findIndex = function (predicate, thisArg) {
      for (var i = 0; i < this.length; i += 1) {
        if (predicate.call(thisArg, this[i], i, this)) return i
      }
      return -1
    }
  }
  if (!Array.prototype.find) {
    Array.prototype.find = function (predicate, thisArg) {
      var index = this.findIndex(predicate, thisArg)
      return index >= 0 ? this[index] : undefined
    }
  }
  if (!String.prototype.padStart) {
    String.prototype.padStart = function (targetLength, padString) {
      var target = Number(targetLength) || 0
      var pad = padString === undefined ? ' ' : String(padString)
      var text = String(this)
      while (text.length < target) text = pad + text
      return text.slice(-target)
    }
  }
}

installCompatibilityPolyfills()

App({
  onError: function (error) {
    console.error('[mini-app-error]', error)
    wx.showToast({ title: '页面初始化异常，请重新编译', icon: 'none' })
  },
  globalData: {
    appName: '智造管家'
  }
})
