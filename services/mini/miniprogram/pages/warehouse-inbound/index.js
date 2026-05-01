var api = require('../../utils/api')
var ui = require('../../utils/interaction')

function parseWarehouseScanPayload(raw) {
  var payload = String(raw || '').trim()
  var parsed = { keyword: payload, skuId: '', dyeLotNo: '', deliveryNo: '' }
  if (!payload) return null
  var segments = payload.split('|')
  if (segments.length === 1) return parsed
  var kv = {}
  segments.slice(1).forEach(function (segment) {
    var pair = segment.split('=')
    if (pair[0]) kv[pair[0]] = pair.slice(1).join('=')
  })
  if (segments[0] === 'SMART_FACTORY_SKU') {
    parsed.keyword = kv.SKU_CODE || payload
    parsed.skuId = kv.SKU_ID || ''
    parsed.dyeLotNo = kv.DYE_LOT || kv.BATCH || ''
  } else if (segments[0] === 'SMART_FACTORY_DELIVERY') {
    parsed.deliveryNo = kv.DELIVERY_NO || ''
    parsed.keyword = parsed.deliveryNo || kv.SKU_CODE || payload
    parsed.skuId = kv.SKU_ID || ''
    parsed.dyeLotNo = kv.DYE_LOT || kv.BATCH || ''
  }
  return parsed
}

function buildInboundActionState(viewData) {
  var sku = viewData.skuOptions && viewData.skuOptions[viewData.skuIdx]
  var warehouse = viewData.warehouses && viewData.warehouses[viewData.warehouseIdx]
  var location = viewData.locations && viewData.locations[viewData.locationIdx]
  var qty = ui.asNumber(viewData.qty)
  var hasSku = Boolean(sku && ui.getSkuId(sku))
  var hasQty = Number.isFinite(qty) && qty > 0
  var ready = Boolean(hasSku && hasQty && warehouse && location)
  var hint = '扫描或搜索 SKU，填写数量，再确认仓库和库位。'
  if (!hasSku) hint = '请先扫描或搜索并选择入库物料。'
  else if (!hasQty) hint = '请填写大于 0 的入库数量。'
  else if (!warehouse || !location) hint = '请选择上架仓库和库位。'
  else hint = '入库信息完整，可确认上架。'
  return {
    submitDisabled: !ready,
    inboundActionHint: hint,
    inboundSummary: ready
      ? ui.formatSku(sku) + ' · ' + qty + ' ' + (sku.stockUnit || sku.purchaseUnit || sku.unit || '件') + ' · ' + location.name
      : '待补齐入库信息'
  }
}

Page({
  data: {
    quickQty: ['1', '5', '10', '50'],
    keyword: '',
    skuOptions: [],
    skuRange: [],
    skuIdx: 0,
    selectedSkuLabel: '',
    skuPickerLabel: '请选择候选物料',
    selectedSkuCode: '',
    selectedSkuName: '',
    selectedSkuUnit: '件',
    qty: '',
    dyeLotNo: '',
    deliveryNo: '',
    warehouses: [],
    warehouseRange: [],
    warehouseIdx: 0,
    selectedWarehouseLabel: '',
    warehousePickerLabel: '请选择仓库',
    locations: [],
    locationRange: [],
    locationIdx: 0,
    selectedLocationLabel: '',
    locationPickerLabel: '请选择库位',
    loading: false,
    loadError: '',
    lastRefreshAt: '',
    syncLabel: '待同步',
    skuCandidateCount: 0,
    submitting: false,
    canResetMock: Boolean(api.resetMockData),
    submitDisabled: true,
    inboundActionHint: '扫描或搜索 SKU，填写数量，再确认仓库和库位。',
    inboundSummary: '待补齐入库信息',
    successVisible: false,
    successQtyLabel: '',
    successSkuLabel: '',
    successDyeLot: ''
  },

  onLoad: function () {
    this.loadWarehouses()
  },

  onPullDownRefresh: function () {
    this.loadWarehouses()
  },

  applyInboundState: function (patch) {
    var nextData = Object.assign({}, this.data, patch || {})
    this.setData(Object.assign({}, patch || {}, buildInboundActionState(nextData)))
  },

  setSkuSelection: function (list, idx) {
    var sku = list[idx]
    this.applyInboundState({
      skuOptions: list,
      skuRange: list.map(ui.formatSku),
      skuIdx: idx || 0,
      selectedSkuLabel: sku ? ui.formatSku(sku) : '',
      skuPickerLabel: sku ? ui.formatSku(sku) : '请选择候选物料',
      selectedSkuCode: sku ? (sku.skuCode || sku.code || '') : '',
      selectedSkuName: sku ? (sku.name || sku.skuName || '') : '',
      selectedSkuUnit: sku ? (sku.stockUnit || sku.purchaseUnit || sku.unit || '件') : '件'
    })
  },

  loadWarehouses: function () {
    var self = this
    this.setData({ loadError: '' })
    api.inventoryApi.warehouses().then(function (res) {
      var list = Array.isArray(res) ? res : []
      self.applyInboundState({
        warehouses: list,
        warehouseRange: list.map(function (item) { return item.name }),
        warehouseIdx: list.length ? 0 : 0,
        selectedWarehouseLabel: list.length ? list[0].name : '',
        warehousePickerLabel: list.length ? list[0].name : '请选择仓库',
        lastRefreshAt: ui.nowTimeLabel(),
        syncLabel: ui.nowTimeLabel()
      })
      if (list.length) self.loadLocations(list[0].id)
    }).catch(function (error) {
      self.setData({ loadError: ui.getErrorMessage(error, '加载仓库失败') })
      ui.showError(error, '加载仓库失败')
    }).finally(function () {
      ui.stopPullDownRefresh()
    })
  },

  loadLocations: function (warehouseId) {
    var self = this
    api.inventoryApi.locations(warehouseId).then(function (res) {
      var list = Array.isArray(res) ? res : []
      self.applyInboundState({
        locations: list,
        locationRange: list.map(function (item) { return [item.code, item.name].filter(Boolean).join(' ') }),
        locationIdx: list.length ? 0 : 0,
        selectedLocationLabel: list.length ? [list[0].code, list[0].name].filter(Boolean).join(' ') : '',
        locationPickerLabel: list.length ? [list[0].code, list[0].name].filter(Boolean).join(' ') : '请选择库位'
      })
    }).catch(function (error) {
      self.setData({ locations: [], locationRange: [], selectedLocationLabel: '', locationPickerLabel: '请选择库位' })
      ui.showError(error, '加载库位失败')
    })
  },

  handleKeywordInput: function (event) { this.applyInboundState({ keyword: event.detail.value }) },
  handleQtyInput: function (event) { this.applyInboundState({ qty: ui.decimalInput(event.detail.value) }) },
  handleDyeLotInput: function (event) { this.setData({ dyeLotNo: event.detail.value }) },

  searchSku: function (nextKeyword) {
    var self = this
    var keyword = typeof nextKeyword === 'string' ? nextKeyword : this.data.keyword
    keyword = keyword.trim()
    if (!keyword) {
      wx.showToast({ title: '请输入 SKU 编码或名称', icon: 'none' })
      return Promise.resolve([])
    }
    this.setData({ loading: true })
    return api.skuApi.search(keyword).then(function (res) {
      var list = res.list || []
      self.setSkuSelection(list, list.length ? 0 : 0)
      self.setData({ skuCandidateCount: list.length })
      if (!list.length) wx.showToast({ title: '未找到物料', icon: 'none' })
      return list
    }).catch(function (error) {
      ui.showError(error, '查询物料失败')
      return []
    }).finally(function () {
      self.setData({ loading: false })
    })
  },

  handleSkuChange: function (event) {
    this.setSkuSelection(this.data.skuOptions, Number(event.detail.value) || 0)
  },

  handleScan: function () {
    var self = this
    wx.scanCode({
      scanType: ['qrCode', 'barCode'],
      success: function (scan) {
        var parsed = parseWarehouseScanPayload(scan.result)
        if (!parsed) {
          wx.showToast({ title: '未识别到物料标签', icon: 'none' })
          return
        }
        self.setData({
          keyword: parsed.keyword,
          dyeLotNo: parsed.dyeLotNo,
          deliveryNo: parsed.deliveryNo
        })
        self.searchSku(parsed.keyword).then(function (list) {
          if (parsed.skuId) {
            list.forEach(function (item, index) {
              if (String(ui.getSkuId(item)) === parsed.skuId) self.setSkuSelection(list, index)
            })
          }
          ui.showSuccess('扫码已回填')
        })
      },
      fail: function (error) {
        ui.showError(error, '扫码失败')
      }
    })
  },

  handleWarehouseChange: function (event) {
    var idx = Number(event.detail.value) || 0
    var warehouse = this.data.warehouses[idx]
    this.applyInboundState({ warehouseIdx: idx, selectedWarehouseLabel: warehouse ? warehouse.name : '', warehousePickerLabel: warehouse ? warehouse.name : '请选择仓库' })
    if (warehouse) this.loadLocations(warehouse.id)
  },

  handleLocationChange: function (event) {
    var idx = Number(event.detail.value) || 0
    var location = this.data.locations[idx]
    var label = location ? [location.code, location.name].filter(Boolean).join(' ') : ''
    this.applyInboundState({ locationIdx: idx, selectedLocationLabel: label, locationPickerLabel: label || '请选择库位' })
  },

  addQuickQty: function (event) {
    var current = ui.asNumber(this.data.qty)
    var delta = ui.asNumber(event.currentTarget.dataset.value)
    this.applyInboundState({ qty: String((Number.isFinite(current) ? current : 0) + delta) })
  },

  resetForm: function () {
    var self = this
    ui.confirmAction('清空表单', '确认清空当前物料、数量和批次信息？').then(function (ok) {
      if (!ok) return
      self.setSkuSelection([], 0)
      self.applyInboundState({ keyword: '', qty: '', dyeLotNo: '', deliveryNo: '', successVisible: false, skuCandidateCount: 0 })
    })
  },

  handleResetMockData: function () {
    var self = this
    if (!api.resetMockData) return
    ui.confirmAction('重置 FACTORY001 数据', '确认恢复工单、质检和入库模拟数据到初始状态？').then(function (ok) {
      if (!ok) return
      self.setData({ submitting: true })
      api.resetMockData().then(function () {
        self.setSkuSelection([], 0)
        self.applyInboundState({
          keyword: '',
          qty: '',
          dyeLotNo: '',
          deliveryNo: '',
          skuCandidateCount: 0,
          successVisible: false,
          successQtyLabel: '',
          successSkuLabel: '',
          successDyeLot: ''
        })
        ui.showSuccess('已重置')
        self.loadWarehouses()
      }).catch(function (error) {
        ui.showError(error, '重置失败')
      }).finally(function () {
        self.setData({ submitting: false })
      })
    })
  },

  handleSubmit: function () {
    var self = this
    var sku = this.data.skuOptions[this.data.skuIdx]
    var warehouse = this.data.warehouses[this.data.warehouseIdx]
    var location = this.data.locations[this.data.locationIdx]
    var skuId = ui.getSkuId(sku)
    var qty = ui.asNumber(this.data.qty)
    if (this.data.submitting) return
    if (this.data.submitDisabled) {
      ui.showError(this.data.inboundActionHint, '入库信息不完整')
      return
    }
    if (!skuId || !Number.isFinite(qty) || qty <= 0 || !warehouse || !location) {
      ui.showError('请补齐物料、数量、仓库和库位', '入库信息不完整')
      return
    }
    ui.confirmAction('确认上架入库', '物料：' + ui.formatSku(sku) + '\n数量：' + qty + ' ' + (sku.stockUnit || sku.purchaseUnit || sku.unit || '件') + '\n库位：' + location.name).then(function (ok) {
      if (!ok) return
      self.setData({ submitting: true })
      api.inventoryApi.inbound({
        skuCode: sku.skuCode || sku.code || '',
        skuId: skuId,
        qtyInput: qty,
        inputUnit: sku.stockUnit || sku.purchaseUnit || sku.unit || '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        dyeLotNo: self.data.dyeLotNo.trim() || undefined,
        transactionType: 'purchase_in'
      }).then(function () {
        ui.showSuccess('上架入库成功')
        self.setData({
          successVisible: true,
          successQtyLabel: '+' + qty + ' ' + (sku.stockUnit || sku.purchaseUnit || sku.unit || '件'),
          successSkuLabel: ui.formatSku(sku),
          successDyeLot: self.data.dyeLotNo.trim() || '未填写'
        })
        self.setSkuSelection([], 0)
        self.applyInboundState({ keyword: '', qty: '', dyeLotNo: '', deliveryNo: '', skuCandidateCount: 0 })
      }).catch(function (error) {
        ui.showError(error, '入库失败')
      }).finally(function () {
        self.setData({ submitting: false })
      })
    })
  },

  closeSuccess: function () {
    this.setData({ successVisible: false })
  }
})
