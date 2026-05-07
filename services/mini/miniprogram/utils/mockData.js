var tenantCode = 'FACTORY001'

var warehouses = [
  { id: 1, code: 'WH-FAB', name: 'FACTORY001 面辅料仓' },
  { id: 2, code: 'WH-FG', name: 'FACTORY001 成品仓' }
]

var locations = [
  { id: 11, warehouseId: 1, code: 'A-03-2', name: '面料区 A-03-2' },
  { id: 12, warehouseId: 1, code: 'B-02-1', name: '海绵区 B-02-1' },
  { id: 21, warehouseId: 2, code: 'FG-01', name: '成品区 FG-01' }
]

var skus = [
  { id: 101, skuId: 101, skuCode: 'FAB-LN-002', code: 'FAB-LN-002', name: '亚麻面料 米白色', stockUnit: 'm', purchaseUnit: 'm', unit: 'm' },
  { id: 102, skuId: 102, skuCode: 'SPG-HD-010', code: 'SPG-HD-010', name: '高密度海绵垫', stockUnit: '块', purchaseUnit: '块', unit: '块' },
  { id: 103, skuId: 103, skuCode: 'ZIP-80-A', code: 'ZIP-80-A', name: '80cm 拉链', stockUnit: '条', purchaseUnit: '条', unit: '条' },
  { id: 201, skuId: 201, skuCode: 'FG-SOFA-002', code: 'FG-SOFA-002', name: '欧式双人沙发', stockUnit: '件', purchaseUnit: '件', unit: '件' }
]

var tasks = [
  {
    id: 1001,
    taskNo: 'TASK-F001-001',
    workOrderNo: 'WO-F001-20260428',
    productionOrderNo: 'ORD-20260428-001',
    stepName: '布料裁剪',
    processName: '开料：01压条',
    skuCode: 'FG-SOFA-002',
    skuName: '欧式双人沙发',
    plannedQty: 12,
    completedQty: 0,
    unit: '件',
    status: 'pending',
    standardHours: 3.5,
    inputMaterials: [
      { skuId: 101, skuCode: 'FAB-LN-002', name: '亚麻面料 米白色', requiredQty: 8.4, qty: 8.4, unit: 'm' },
      { skuId: 102, skuCode: 'SPG-HD-010', name: '高密度海绵垫', requiredQty: 3, qty: 3, unit: '块' }
    ],
    outputMaterials: [
      { skuId: 201, skuCode: 'FG-SOFA-002', name: '欧式双人沙发', qty: 12, unit: '件' }
    ]
  },
  {
    id: 1002,
    taskNo: 'TASK-F001-002',
    workOrderNo: 'WO-F001-20260428',
    productionOrderNo: 'ORD-20260428-002',
    stepName: '沙发组装',
    processName: '组装',
    skuCode: 'FG-SOFA-002',
    skuName: '欧式双人沙发',
    plannedQty: 6,
    completedQty: 2,
    unit: '件',
    status: 'in_progress',
    standardHours: 2,
    inputMaterials: [
      { skuId: 103, skuCode: 'ZIP-80-A', name: '80cm 拉链', requiredQty: 6, qty: 6, unit: '条' }
    ],
    outputMaterials: []
  }
]

var inspections = [
  {
    id: 2001,
    inspectionNo: 'IQC-F001-20260428-001',
    purchaseOrderNo: 'PO-F001-20260428',
    supplierName: 'FACTORY001 供应商样例',
    status: 'pending',
    overallResult: 'pass',
    notes: '',
    items: [
      {
        id: 3001,
        skuId: 101,
        skuCode: 'FAB-LN-002',
        skuName: '亚麻面料 米白色',
        qtyDelivered: 100,
        qtySampled: 10,
        qtyPassed: 10,
        qtyFailed: 0,
        acceptedStockQty: 100,
        dyeLotNo: 'DY-F001-001',
        unit: 'm',
        result: '',
        defectImages: [],
        disposition: '',
        notes: ''
      },
      {
        id: 3002,
        skuId: 102,
        skuCode: 'SPG-HD-010',
        skuName: '高密度海绵垫',
        qtyDelivered: 30,
        qtySampled: 5,
        qtyPassed: 5,
        qtyFailed: 0,
        acceptedStockQty: 30,
        dyeLotNo: '',
        unit: '块',
        result: '',
        defectImages: [],
        disposition: '',
        notes: ''
      }
    ]
  }
]

var inboundRecords = []

var stocktakingTasks = [
  {
    id: 4001,
    taskNo: 'ST-F001-20260428-001',
    scope: 'location',
    scopeValue: '11',
    status: 'draft',
    warehouseId: 1,
    locationId: 11,
    warehouseCode: 'WH-FAB',
    warehouseName: 'FACTORY001 面辅料仓',
    locationCode: 'A-03-2',
    locationName: '面料区 A-03-2',
    totalItems: 2,
    diffItems: 0,
    createdAt: '2026-04-28 09:00:00',
    updatedAt: '2026-04-28 09:00:00',
    items: [
      {
        id: 4101,
        skuId: 101,
        skuCode: 'FAB-LN-002',
        skuName: '亚麻面料 米白色',
        stockUnit: 'm',
        warehouseId: 1,
        locationId: 11,
        warehouseCode: 'WH-FAB',
        warehouseName: 'FACTORY001 面辅料仓',
        locationCode: 'A-03-2',
        locationName: '面料区 A-03-2',
        systemQty: '100',
        actualQty: '',
        diffQty: '0',
        notes: ''
      },
      {
        id: 4102,
        skuId: 102,
        skuCode: 'SPG-HD-010',
        skuName: '高密度海绵垫',
        stockUnit: '块',
        warehouseId: 1,
        locationId: 11,
        warehouseCode: 'WH-FAB',
        warehouseName: 'FACTORY001 面辅料仓',
        locationCode: 'A-03-2',
        locationName: '面料区 A-03-2',
        systemQty: '30',
        actualQty: '',
        diffQty: '0',
        notes: ''
      }
    ]
  }
]

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

var defaultTasks = clone(tasks)
var defaultInspections = clone(inspections)
var defaultStocktakingTasks = clone(stocktakingTasks)
var storageKey = 'sf_factory001_mock_state_v1'

function replaceArray(target, source) {
  target.splice(0, target.length)
  source.forEach(function (item) {
    target.push(item)
  })
}

function hasStorageApi() {
  return typeof wx !== 'undefined' && wx.getStorageSync && wx.setStorageSync
}

function restoreState() {
  if (!hasStorageApi()) return
  try {
    var cached = wx.getStorageSync(storageKey)
    if (!cached || cached.tenantCode !== tenantCode) return
    if (Array.isArray(cached.tasks)) tasks = cached.tasks
    if (Array.isArray(cached.inspections)) inspections = cached.inspections
    if (Array.isArray(cached.inboundRecords)) inboundRecords = cached.inboundRecords
    if (Array.isArray(cached.stocktakingTasks)) stocktakingTasks = cached.stocktakingTasks
  } catch (error) {
    // Bad local mock cache must not block the mini program startup.
  }
}

function persistState() {
  if (!hasStorageApi()) return
  try {
    wx.setStorageSync(storageKey, {
      tenantCode: tenantCode,
      tasks: tasks,
      inspections: inspections,
      inboundRecords: inboundRecords,
      stocktakingTasks: stocktakingTasks
    })
  } catch (error) {
    // Local persistence is best effort in mock mode.
  }
}

function resetMockData() {
  replaceArray(tasks, clone(defaultTasks))
  replaceArray(inspections, clone(defaultInspections))
  replaceArray(inboundRecords, [])
  replaceArray(stocktakingTasks, clone(defaultStocktakingTasks))
  persistState()
  return ok({ success: true, tenantCode: tenantCode })
}

restoreState()

function ok(data) {
  return Promise.resolve(clone(data))
}

function page(list, params) {
  var pageNo = Number(params && params.page) || 1
  var pageSize = Number(params && params.pageSize) || list.length || 20
  return {
    list: list.slice((pageNo - 1) * pageSize, pageNo * pageSize),
    total: list.length,
    page: pageNo,
    pageSize: pageSize,
    tenantCode: tenantCode
  }
}

function getTask(id) {
  return tasks.find(function (item) { return Number(item.id) === Number(id) })
}

function getInspection(id) {
  return inspections.find(function (item) { return Number(item.id) === Number(id) })
}

function getStocktakingTask(id) {
  return stocktakingTasks.find(function (item) { return Number(item.id) === Number(id) })
}

var productionTaskApi = {
  list: function (params) {
    var filtered = tasks
    if (params && params.status) {
      filtered = tasks.filter(function (item) { return item.status === params.status })
    }
    return ok(page(filtered, params))
  },
  detail: function (id) {
    var task = getTask(id)
    if (!task) return Promise.reject(new Error('FACTORY001 未找到工单任务'))
    return ok(task)
  },
  start: function (id) {
    var task = getTask(id)
    if (!task) return Promise.reject(new Error('FACTORY001 未找到工单任务'))
    task.status = 'in_progress'
    persistState()
    return ok({ success: true })
  },
  issueMaterials: function (id, items) {
    var task = getTask(id)
    if (!task) return Promise.reject(new Error('FACTORY001 未找到工单任务'))
    task.issueHistory = task.issueHistory || []
    task.lastIssueItems = clone(items || [])
    task.issueHistory.push({ items: clone(items || []), issuedAt: new Date().toISOString() })
    if (task.status === 'pending') task.status = 'in_progress'
    persistState()
    return ok({ success: true })
  },
  complete: function (id, payload) {
    var task = getTask(id)
    if (!task) return Promise.reject(new Error('FACTORY001 未找到工单任务'))
    task.completedQty = Number(payload && payload.completedQty) || task.completedQty || 0
    task.actualHours = Number(payload && payload.actualHours) || 0
    task.scrapQty = Number(payload && payload.scrapQty) || 0
    task.notes = payload && payload.notes ? payload.notes : ''
    task.status = 'completed'
    persistState()
    return ok({ success: true })
  },
  reportException: function (id, payload) {
    var task = getTask(id)
    if (!task) return Promise.reject(new Error('FACTORY001 未找到工单任务'))
    task.status = 'exception'
    task.exception = clone(payload || {})
    task.exception.reportedAt = new Date().toISOString()
    persistState()
    return ok({ success: true })
  }
}

var incomingInspectionApi = {
  list: function (params) {
    return ok(page(inspections, params))
  },
  detail: function (id) {
    var inspection = getInspection(id)
    if (!inspection) return Promise.reject(new Error('FACTORY001 未找到质检单'))
    return ok(inspection)
  },
  updateItems: function (id, items) {
    var inspection = getInspection(id)
    if (!inspection) return Promise.reject(new Error('FACTORY001 未找到质检单'))
    inspection.items = (items || []).map(function (item, index) {
      var old = inspection.items[index] || {}
      return Object.assign({}, old, clone(item), {
        qtySampled: item.qtySampled || item.qtysampled || old.qtySampled
      })
    })
    persistState()
    return ok({ success: true })
  },
  submit: function (id, payload) {
    var inspection = getInspection(id)
    if (!inspection) return Promise.reject(new Error('FACTORY001 未找到质检单'))
    inspection.overallResult = payload && payload.overallResult ? payload.overallResult : inspection.overallResult
    inspection.warehouseId = payload && payload.warehouseId
    inspection.locationId = payload && payload.locationId
    inspection.notes = payload && payload.notes ? payload.notes : ''
    inspection.status = 'submitted'
    inspection.submittedAt = new Date().toISOString()
    inspection.items.forEach(function (item) {
      inboundRecords.push({
        id: inboundRecords.length + 1,
        tenantCode: tenantCode,
        sourceType: 'incoming_inspection',
        sourceId: inspection.id,
        skuId: item.skuId,
        skuCode: item.skuCode,
        qtyInput: Number(item.acceptedStockQty) || 0,
        inputUnit: item.unit || '件',
        warehouseId: inspection.warehouseId,
        locationId: inspection.locationId,
        dyeLotNo: item.dyeLotNo || ''
      })
    })
    persistState()
    return ok({ success: true })
  }
}

var inventoryApi = {
  warehouses: function () {
    return ok(warehouses)
  },
  locations: function (warehouseId) {
    return ok(locations.filter(function (item) { return Number(item.warehouseId) === Number(warehouseId) }))
  },
  inbound: function (payload) {
    inboundRecords.push(Object.assign({ id: inboundRecords.length + 1, tenantCode: tenantCode }, clone(payload || {})))
    persistState()
    return ok({ success: true, id: inboundRecords.length })
  }
}

function mapStocktakingTask(task) {
  var cloneTask = clone(task)
  delete cloneTask.items
  cloneTask.totalItems = task.items ? task.items.length : cloneTask.totalItems
  cloneTask.diffItems = (task.items || []).filter(function (item) {
    return item.actualQty !== '' && String(item.actualQty) !== String(item.systemQty)
  }).length
  return cloneTask
}

var stocktakingApi = {
  list: function (params) {
    var filtered = stocktakingTasks
    if (params && params.status) {
      filtered = filtered.filter(function (item) { return item.status === params.status })
    }
    return ok(page(filtered.map(mapStocktakingTask), params))
  },
  detail: function (id) {
    var task = getStocktakingTask(id)
    if (!task) return Promise.reject(new Error('FACTORY001 未找到盘点任务'))
    return ok({ task: mapStocktakingTask(task), items: task.items || [] })
  },
  create: function (payload) {
    payload = payload || {}
    var warehouse = warehouses.find(function (item) { return Number(item.id) === Number(payload.warehouseId) }) || warehouses[0]
    var location = locations.find(function (item) { return Number(item.id) === Number(payload.locationId) }) || locations.find(function (item) { return Number(item.warehouseId) === Number(warehouse.id) })
    var id = 4001 + stocktakingTasks.length
    var scopedSkus = skus.filter(function (sku) { return sku.id !== 201 }).slice(0, 3)
    var task = {
      id: id,
      taskNo: 'ST-F001-MINI-' + id,
      scope: payload.scope || 'location',
      scopeValue: payload.scopeValue || (location ? String(location.id) : ''),
      status: 'draft',
      warehouseId: warehouse ? warehouse.id : undefined,
      locationId: location ? location.id : undefined,
      warehouseCode: warehouse ? warehouse.code : '',
      warehouseName: warehouse ? warehouse.name : '',
      locationCode: location ? location.code : '',
      locationName: location ? location.name : '',
      totalItems: scopedSkus.length,
      diffItems: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: scopedSkus.map(function (sku, index) {
        return {
          id: id * 10 + index,
          skuId: sku.id,
          skuCode: sku.skuCode,
          skuName: sku.name,
          stockUnit: sku.stockUnit,
          warehouseId: warehouse ? warehouse.id : undefined,
          locationId: location ? location.id : undefined,
          warehouseCode: warehouse ? warehouse.code : '',
          warehouseName: warehouse ? warehouse.name : '',
          locationCode: location ? location.code : '',
          locationName: location ? location.name : '',
          systemQty: index === 0 ? '100' : '30',
          actualQty: '',
          diffQty: '0',
          notes: ''
        }
      })
    }
    stocktakingTasks.unshift(task)
    persistState()
    return ok(mapStocktakingTask(task))
  },
  updateItems: function (id, items) {
    var task = getStocktakingTask(id)
    if (!task) return Promise.reject(new Error('FACTORY001 未找到盘点任务'))
    var updatedCount = 0
    ;(items || []).forEach(function (input) {
      var target = (task.items || []).find(function (item) { return Number(item.skuId) === Number(input.skuId) })
      if (!target) return
      target.actualQty = String(input.actualQty)
      target.diffQty = String(Number(input.actualQty) - Number(target.systemQty || 0))
      target.notes = input.notes || ''
      updatedCount += 1
    })
    if (task.status === 'draft') task.status = 'in_progress'
    task.diffItems = (task.items || []).filter(function (item) { return Number(item.diffQty || 0) !== 0 }).length
    persistState()
    return ok({ updatedCount: updatedCount })
  },
  submit: function (id) {
    var task = getStocktakingTask(id)
    if (!task) return Promise.reject(new Error('FACTORY001 未找到盘点任务'))
    task.status = 'completed'
    task.submittedAt = new Date().toISOString()
    persistState()
    return ok({ submittedAt: task.submittedAt })
  }
}

var skuApi = {
  search: function (keyword) {
    var text = String(keyword || '').toLowerCase()
    var filtered = skus.filter(function (item) {
      return !text ||
        String(item.skuCode || '').toLowerCase().indexOf(text) >= 0 ||
        String(item.name || '').toLowerCase().indexOf(text) >= 0
    })
    return ok(page(filtered, { page: 1, pageSize: 20 }))
  }
}

function upload(localPath) {
  return ok({ url: localPath || '/mock/factory001-upload.jpg' })
}

module.exports = {
  productionTaskApi: productionTaskApi,
  incomingInspectionApi: incomingInspectionApi,
  inventoryApi: inventoryApi,
  stocktakingApi: stocktakingApi,
  skuApi: skuApi,
  upload: upload,
  resetMockData: resetMockData,
  __mockState: {
    tasks: tasks,
    inspections: inspections,
    inboundRecords: inboundRecords,
    stocktakingTasks: stocktakingTasks
  }
}
