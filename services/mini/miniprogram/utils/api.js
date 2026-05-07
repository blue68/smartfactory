var request = require('./request')
var config = require('./config')
var mock = require('./mockData')
var contracts = require('./contracts')

var ACTION_TIMEOUT_MS = 120000

function unwrapList(res) {
  if (!res) return { list: [] }
  return {
    list: Array.isArray(res.list) ? res.list : [],
    total: res.total || 0,
    page: res.page || 1,
    pageSize: res.pageSize || 0
  }
}

var real = {
  productionTaskApi: {
    list: function (params) {
      return request.get('/api/production/tasks', params).then(unwrapList)
    },
    detail: function (id) {
      return request.get('/api/production/tasks/' + id)
    },
    start: function (id) {
      return request.post('/api/production/tasks/' + id + '/start')
    },
    issueMaterials: function (id, items) {
      return request.post('/api/production/tasks/' + id + '/issue-materials', contracts.normalizeTaskIssuePayload(items), { timeout: ACTION_TIMEOUT_MS })
    },
    complete: function (id, payload) {
      return request.post('/api/production/tasks/' + id + '/complete-v2', contracts.normalizeTaskCompletePayload(payload), { timeout: ACTION_TIMEOUT_MS })
    },
    reportException: function (id, payload) {
      return request.post('/api/production/tasks/' + id + '/exception', contracts.normalizeExceptionPayload(payload))
    }
  },

  incomingInspectionApi: {
    list: function (params) {
      return request.get('/api/incoming-inspections', params).then(unwrapList)
    },
    detail: function (id) {
      return request.get('/api/incoming-inspections/' + id)
    },
    updateItems: function (id, items) {
      return request.put('/api/incoming-inspections/' + id + '/items', { items: contracts.normalizeInspectionItems(items) })
    },
    submit: function (id, payload) {
      return request.post('/api/incoming-inspections/' + id + '/submit', payload, { timeout: ACTION_TIMEOUT_MS })
    }
  },

  inventoryApi: {
    warehouses: function () {
      return request.get('/api/inventory/warehouses', { onlyActive: true })
    },
    locations: function (warehouseId) {
      return request.get('/api/inventory/locations', { warehouseId: warehouseId, onlyActive: true })
    },
    inbound: function (payload) {
      return request.postWithLockRetry('/api/inventory/inbound', contracts.normalizeInboundPayload(payload), { timeout: ACTION_TIMEOUT_MS })
    }
  },

  stocktakingApi: {
    list: function (params) {
      return request.get('/api/stocktaking', params).then(unwrapList)
    },
    detail: function (id) {
      return request.get('/api/stocktaking/' + id)
    },
    create: function (payload) {
      return request.post('/api/stocktaking', payload, { timeout: ACTION_TIMEOUT_MS })
    },
    updateItems: function (id, items) {
      return request.put('/api/stocktaking/' + id + '/items', contracts.normalizeStocktakingItems(items), { timeout: ACTION_TIMEOUT_MS })
    },
    submit: function (id) {
      return request.post('/api/stocktaking/' + id + '/submit', undefined, { timeout: ACTION_TIMEOUT_MS })
    }
  },

  skuApi: {
    search: function (keyword) {
      return request.get('/api/skus', { page: 1, pageSize: 20, keyword: keyword }).then(unwrapList)
    }
  },

  upload: request.upload
}

function isMockMode() {
  return config.getUseMock ? config.getUseMock() : Boolean(config.useMock)
}

function active() {
  return isMockMode() ? mock : real
}

function call(group, method, args) {
  return active()[group][method].apply(null, args)
}

module.exports = {
  isMockMode: isMockMode,
  resetMockData: function () {
    return mock.resetMockData()
  },
  productionTaskApi: {
    list: function () { return call('productionTaskApi', 'list', arguments) },
    detail: function () { return call('productionTaskApi', 'detail', arguments) },
    start: function () { return call('productionTaskApi', 'start', arguments) },
    issueMaterials: function () { return call('productionTaskApi', 'issueMaterials', arguments) },
    complete: function () { return call('productionTaskApi', 'complete', arguments) },
    reportException: function () { return call('productionTaskApi', 'reportException', arguments) }
  },
  incomingInspectionApi: {
    list: function () { return call('incomingInspectionApi', 'list', arguments) },
    detail: function () { return call('incomingInspectionApi', 'detail', arguments) },
    updateItems: function () { return call('incomingInspectionApi', 'updateItems', arguments) },
    submit: function () { return call('incomingInspectionApi', 'submit', arguments) }
  },
  inventoryApi: {
    warehouses: function () { return call('inventoryApi', 'warehouses', arguments) },
    locations: function () { return call('inventoryApi', 'locations', arguments) },
    inbound: function () { return call('inventoryApi', 'inbound', arguments) }
  },
  stocktakingApi: {
    list: function () { return call('stocktakingApi', 'list', arguments) },
    detail: function () { return call('stocktakingApi', 'detail', arguments) },
    create: function () { return call('stocktakingApi', 'create', arguments) },
    updateItems: function () { return call('stocktakingApi', 'updateItems', arguments) },
    submit: function () { return call('stocktakingApi', 'submit', arguments) }
  },
  skuApi: {
    search: function () { return call('skuApi', 'search', arguments) }
  },
  upload: function () {
    return active().upload.apply(null, arguments)
  }
}
