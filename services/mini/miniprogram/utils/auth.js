var request = require('./request')

var MODULES = [
  {
    key: 'workerTask',
    title: '我的任务',
    desc: '开工、投料、报工、异常',
    route: '/pages/worker-task/index',
    marker: '工',
    aliases: ['mini:worker:task', 'mini:task', 'worker:task', 'production:task', 'production:task:view', 'production', 'worker', 'operator', 'task']
  },
  {
    key: 'warehouseInbound',
    title: '仓库入库',
    desc: '来料入库、货架扫码',
    route: '/pages/warehouse-inbound/index',
    marker: '入',
    aliases: ['mini:warehouse:inbound', 'warehouse:inbound', 'inventory:inbound', 'purchase:in', 'warehouse', 'storekeeper', 'inventory', 'inbound']
  },
  {
    key: 'qcInspect',
    title: 'QC检验',
    desc: '验货明细、留证上传',
    route: '/pages/qc-inspect/index',
    marker: '检',
    aliases: ['mini:qc:inspect', 'qc:inspect', 'quality:inspect', 'incoming:inspection', 'incoming:inspection:view', 'iqc', 'qc', 'quality', 'inspection']
  },
  {
    key: 'stocktaking',
    title: '库存盘点',
    desc: '货架盘点、扫码定位',
    route: '/pages/stocktaking/index',
    marker: '盘',
    aliases: ['mini:stocktaking', 'stocktaking', 'inventory:stocktaking', 'inventory:count', 'stock:count', 'warehouse', 'inventory']
  }
]

function readUser() {
  return wx.getStorageSync('sf_user') || null
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[._\s-]+/g, ':')
}

function compactToken(value) {
  return normalizeToken(value).replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '')
}

function pushToken(tokens, value) {
  var token = normalizeToken(value)
  if (token && tokens.indexOf(token) < 0) tokens.push(token)
}

function collectFromList(tokens, value) {
  if (!value) return
  if (typeof value === 'string' || typeof value === 'number') {
    pushToken(tokens, value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach(function (item) { collectFromList(tokens, item) })
    return
  }
  if (typeof value === 'object') {
    ;['code', 'permission', 'permissionCode', 'perms', 'authority', 'name', 'key', 'path'].forEach(function (key) {
      if (value[key]) pushToken(tokens, value[key])
    })
    ;['permissions', 'permissionCodes', 'authorities', 'children', 'menus', 'buttons'].forEach(function (key) {
      collectFromList(tokens, value[key])
    })
  }
}

function getPermissionTokens(user) {
  var tokens = []
  if (!user) return tokens
  ;['permissions', 'permissionCodes', 'authorities', 'scopes', 'scope', 'menus', 'menuCodes', 'buttons', 'modules'].forEach(function (key) {
    collectFromList(tokens, user[key])
  })
  collectFromList(tokens, user.roles)
  collectFromList(tokens, user.roleCodes)
  return tokens
}

function isAdmin(tokens) {
  return tokens.some(function (token) {
    return token === 'admin' || token === 'super:admin' || token === 'administrator' || token === '*:*:*' || token === '*'
  })
}

function tokenMatchesAlias(token, alias) {
  if (!token || !alias) return false
  if (token === alias || token === '*') return true
  if (alias.indexOf(':') >= 0 && token.indexOf(alias + ':') === 0) return true
  var tokenCompact = compactToken(token)
  var aliasCompact = compactToken(alias)
  if (!tokenCompact || !aliasCompact) return false
  if (tokenCompact === aliasCompact) return true
  if (tokenCompact.length > 2 && aliasCompact.indexOf(tokenCompact) >= 0) return true
  return alias.indexOf(':') >= 0 && aliasCompact.length > 2 && tokenCompact.indexOf(aliasCompact) >= 0
}

function canAccessModule(user, module) {
  var tokens = getPermissionTokens(user)
  if (!tokens.length) return true
  if (isAdmin(tokens)) return true
  return module.aliases.some(function (alias) {
    return tokens.some(function (token) { return tokenMatchesAlias(token, alias) })
  })
}

function getAllowedModules(user) {
  var currentUser = user || readUser()
  return MODULES.filter(function (module) {
    return canAccessModule(currentUser, module)
  }).map(function (module, index) {
    return Object.assign({}, module, {
      index: index,
      cardClass: 'dashboard-tile dashboard-tile--' + module.key
    })
  })
}

function normalizeLoginUser(user, fallback) {
  var source = user || {}
  return Object.assign({}, source, {
    username: source.username || source.account || (fallback && fallback.username) || '',
    tenantCode: source.tenantCode || (fallback && fallback.tenantCode) || ''
  })
}

function isLoggedIn() {
  return Boolean(request.getToken())
}

module.exports = {
  modules: MODULES,
  readUser: readUser,
  normalizeLoginUser: normalizeLoginUser,
  getPermissionTokens: getPermissionTokens,
  canAccessModule: canAccessModule,
  getAllowedModules: getAllowedModules,
  isLoggedIn: isLoggedIn
}
