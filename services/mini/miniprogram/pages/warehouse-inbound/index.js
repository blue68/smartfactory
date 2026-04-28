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

Page({
  data: {
    quickQty: ['1', '5', '10', '50'],
    keyword: '',
    skuOptions: [],
    skuRange: [],
    skuIdx: 0,
    selectedSkuLabel: '',
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
    locations: [],
    locationRange: [],
    locationIdx: 0,
    selectedLocationLabel: '',
    loading: false,
    loadError: '',
    lastRefreshAt: '',
    submitting: false,
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

  setSkuSelection: function (list, idx) {
    var sku = list[idx]
    this.setData({
      skuOptions: list,
      skuRange: list.map(ui.formatSku),
      skuIdx: idx || 0,
      selectedSkuLabel: sku ? ui.formatSku(sku) : '',
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
      self.setData({
        warehouses: list,
        warehouseRange: list.map(function (item) { return item.name }),
        warehouseIdx: list.length ? 0 : 0,
        selectedWarehouseLabel: list.length ? list[0].name : '',
        lastRefreshAt: ui.nowTimeLabel()
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
      self.setData({
        locations: list,
        locationRange: list.map(function (item) { return [item.code, item.name].filter(Boolean).join(' ') }),
        locationIdx: list.length ? 0 : 0,
        selectedLocationLabel: list.length ? [list[0].code, list[0].name].filter(Boolean).join(' ') : ''
      })
    }).catch(function (error) {
      self.setData({ locations: [], locationRange: [], selectedLocationLabel: '' })
      ui.showError(error, '加载库位失败')
    })
  },

  handleKeywordInput: function (event) { this.setData({ keyword: event.detail.value }) },
  handleQtyInput: function (event) { this.setData({ qty: ui.decimalInput(event.detail.value) }) },
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
    this.setData({ warehouseIdx: idx, selectedWarehouseLabel: warehouse ? warehouse.name : '' })
    if (warehouse) this.loadLocations(warehouse.id)
  },

  handleLocationChange: function (event) {
    var idx = Number(event.detail.value) || 0
    var location = this.data.locations[idx]
    this.setData({ locationIdx: idx, selectedLocationLabel: location ? [location.code, location.name].filter(Boolean).join(' ') : '' })
  },

  addQuickQty: function (event) {
    var current = ui.asNumber(this.data.qty)
    var delta = ui.asNumber(event.currentTarget.dataset.value)
    this.setData({ qty: String((Number.isFinite(current) ? current : 0) + delta) })
  },

  resetForm: function () {
    var self = this
    ui.confirmAction('清空表单', '确认清空当前物料、数量和批次信息？').then(function (ok) {
      if (!ok) return
      self.setSkuSelection([], 0)
      self.setData({ keyword: '', qty: '', dyeLotNo: '', deliveryNo: '', successVisible: false })
    })
  },

  handleSubmit: function () {
    var self = this
    var sku = this.data.skuOptions[this.data.skuIdx]
    var warehouse = this.data.warehouses[this.data.warehouseIdx]
    var location = this.data.locations[this.data.locationIdx]
    var skuId = ui.getSkuId(sku)
    var qty = ui.asNumber(this.data.qty)
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
        self.setData({ keyword: '', qty: '', dyeLotNo: '', deliveryNo: '' })
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
