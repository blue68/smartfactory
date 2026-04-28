var request = require('./request')
var config = require('./config')
var mock = require('./mockData')

if (config.useMock) {
  module.exports = mock
} else {
  function unwrapList(res) {
    if (!res) return { list: [] }
    return {
      list: Array.isArray(res.list) ? res.list : [],
      total: res.total || 0,
      page: res.page || 1,
      pageSize: res.pageSize || 0
    }
  }

  var productionTaskApi = {
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
      return request.post('/api/production/tasks/' + id + '/issue-materials', { items: items })
    },
    complete: function (id, payload) {
      return request.post('/api/production/tasks/' + id + '/complete-v2', payload)
    },
    reportException: function (id, payload) {
      return request.post('/api/production/tasks/' + id + '/exception', payload)
    }
  }

  var incomingInspectionApi = {
    list: function (params) {
      return request.get('/api/incoming-inspections', params).then(unwrapList)
    },
    detail: function (id) {
      return request.get('/api/incoming-inspections/' + id)
    },
    updateItems: function (id, items) {
      return request.put('/api/incoming-inspections/' + id + '/items', { items: items })
    },
    submit: function (id, payload) {
      return request.post('/api/incoming-inspections/' + id + '/submit', payload)
    }
  }

  var inventoryApi = {
    warehouses: function () {
      return request.get('/api/inventory/warehouses', { onlyActive: true })
    },
    locations: function (warehouseId) {
      return request.get('/api/inventory/locations', { warehouseId: warehouseId, onlyActive: true })
    },
    inbound: function (payload) {
      return request.postWithLockRetry('/api/inventory/inbound', payload)
    }
  }

  var skuApi = {
    search: function (keyword) {
      return request.get('/api/skus', { page: 1, pageSize: 20, keyword: keyword }).then(unwrapList)
    }
  }

  module.exports = {
    productionTaskApi: productionTaskApi,
    incomingInspectionApi: incomingInspectionApi,
    inventoryApi: inventoryApi,
    skuApi: skuApi,
    upload: request.upload
  }
}
