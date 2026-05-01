var api = require('../../utils/api')
var ui = require('../../utils/interaction')

var RESULT_OPTIONS = [
  { value: 'pass', label: '合格' },
  { value: 'conditional_pass', label: '让步接收' },
  { value: 'fail', label: '不合格' }
]
var DISPOSITION_OPTIONS = [
  { value: 'accept', label: '接收入库' },
  { value: 'rework', label: '返工复检' },
  { value: 'return', label: '整批退货' },
  { value: 'scrap', label: '报废隔离' }
]

function asText(value) {
  return value === undefined || value === null ? '' : String(value)
}

function numberText(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback || '0'
  return String(value)
}

function buildDrafts(items) {
  return (items || []).map(function (item, index) {
    return {
      id: item.id,
      sourceItemIds: item.sourceItemIds || [],
      label: [item.skuCode || '', item.skuName || item.name || ''].filter(Boolean).join(' ') || ('明细 ' + (index + 1)),
      qtyDelivered: numberText(item.qtyDelivered),
      qtySampled: numberText(item.qtySampled),
      qtyPassed: numberText(item.qtyPassed),
      qtyFailed: numberText(item.qtyFailed),
      acceptedStockQty: numberText(item.acceptedStockQty !== undefined ? item.acceptedStockQty : item.qtyPassed),
      dyeLotNo: asText(item.dyeLotNo),
      result: asText(item.result),
      disposition: asText(item.disposition),
      notes: asText(item.notes),
      defectImages: Array.isArray(item.defectImages) ? item.defectImages.filter(Boolean) : []
    }
  })
}

function resultLabel(value) {
  var idx = RESULT_OPTIONS.findIndex(function (item) { return item.value === value })
  return idx >= 0 ? RESULT_OPTIONS[idx].label : '待判定'
}

function logItem(title, content) {
  return {
    id: String(Date.now()) + '-' + Math.floor(Math.random() * 1000),
    time: ui.nowTimeLabel(),
    title: title,
    content: content
  }
}

Page({
  data: {
    resultLabels: RESULT_OPTIONS.map(function (item) { return item.label }),
    dispositionLabels: DISPOSITION_OPTIONS.map(function (item) { return item.label }),
    inspections: [],
    inspectionRange: [],
    inspectionIdx: 0,
    inspectionLabel: '',
    inspectionPickerLabel: '请选择质检单',
    detail: null,
    drafts: [],
    draftRange: [],
    activeItemIdx: 0,
    activeDraft: null,
    hasActiveDraft: false,
    activeLabel: '',
    activeQtyDelivered: '',
    activeQtySampled: '',
    activeQtyPassed: '',
    activeQtyFailed: '',
    activeAcceptedStockQty: '',
    activeDyeLotNo: '',
    activeNotes: '',
    activeDefectImages: [],
    activeResultIdx: 0,
    activeResultLabel: '',
    activeResultPickerLabel: '请选择',
    activeDispositionIdx: 0,
    activeDispositionLabel: '',
    activeDispositionPickerLabel: '请选择',
    completedItemCount: 0,
    pendingCount: 0,
    progressPercent: 0,
    progressStyle: 'width: 0%;',
    draftCountLabel: '0',
    syncLabel: '--:--',
    uploadText: '留证图',
    emptyText: '质检数据加载中...',
    showRetry: false,
    unitOrderLabel: '请选择质检单',
    unitPurchaseLabel: '待加载',
    unitProductLabel: '来料质检任务',
    inspectionStatusLabel: '待加载',
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
    overallResultIdx: 0,
    overallResultLabel: '合格',
    notes: '',
    loading: false,
    uploading: false,
    submitting: false,
    loadError: '',
    lastRefreshAt: '',
    canResetMock: Boolean(api.resetMockData),
    operationLogs: [],
    hasOperationLogs: false,
    latestOperationTitle: '等待检验',
    latestOperationText: '完成判定、保存或提交后，会在这里显示质检回执。'
  },

  onLoad: function () {
    this.loadInspections()
    this.loadWarehouses()
  },

  onPullDownRefresh: function () {
    this.loadInspections()
  },

  deriveDraftState: function (drafts, idx) {
    var active = drafts[idx] || null
    var resultIdx = active ? RESULT_OPTIONS.findIndex(function (item) { return item.value === active.result }) : -1
    var dispositionIdx = active ? DISPOSITION_OPTIONS.findIndex(function (item) { return item.value === active.disposition }) : -1
    var draftCards = drafts.map(function (item, index) {
      var state = item.result === 'fail' ? 'fail' : (item.result ? 'pass' : 'pending')
      var activeClass = index === idx ? ' inspect-card--active' : ''
      return {
        index: index,
        cardClass: 'inspect-card inspect-card--' + state + activeClass,
        passButtonClass: 'inspect-btn inspect-btn--pass' + (state === 'pass' ? ' inspect-btn--pass-active' : ''),
        failButtonClass: 'inspect-btn inspect-btn--fail' + (state === 'fail' ? ' inspect-btn--fail-active' : ''),
        label: item.label,
        desc: '抽检 ' + (item.qtySampled || 0) + ' / 送货 ' + (item.qtyDelivered || 0),
        state: state,
        badge: state === 'pass' ? '合格' : (state === 'fail' ? '不合格' : '待检'),
        marker: state === 'pass' ? '✓' : (state === 'fail' ? '×' : String(index + 1)),
        active: index === idx
      }
    })
    return {
      draftRange: drafts.map(function (item) { return item.label }),
      draftCards: draftCards,
      activeItemIdx: idx || 0,
      activeDraft: active,
      hasActiveDraft: Boolean(active),
      activeLabel: active ? active.label : '',
      activeQtyDelivered: active ? active.qtyDelivered : '',
      activeQtySampled: active ? active.qtySampled : '',
      activeQtyPassed: active ? active.qtyPassed : '',
      activeQtyFailed: active ? active.qtyFailed : '',
      activeAcceptedStockQty: active ? active.acceptedStockQty : '',
      activeDyeLotNo: active ? active.dyeLotNo : '',
      activeNotes: active ? active.notes : '',
      activeDefectImages: active ? active.defectImages : [],
      activeResultIdx: resultIdx >= 0 ? resultIdx : 0,
      activeResultLabel: resultIdx >= 0 ? RESULT_OPTIONS[resultIdx].label : '',
      activeResultPickerLabel: resultIdx >= 0 ? RESULT_OPTIONS[resultIdx].label : '请选择',
      activeDispositionIdx: dispositionIdx >= 0 ? dispositionIdx : 0,
      activeDispositionLabel: dispositionIdx >= 0 ? DISPOSITION_OPTIONS[dispositionIdx].label : '',
      activeDispositionPickerLabel: dispositionIdx >= 0 ? DISPOSITION_OPTIONS[dispositionIdx].label : '请选择',
      completedItemCount: drafts.filter(function (item) { return item.result && item.disposition }).length,
      pendingCount: drafts.length - drafts.filter(function (item) { return item.result && item.disposition }).length,
      progressPercent: drafts.length ? Math.round(drafts.filter(function (item) { return item.result && item.disposition }).length * 100 / drafts.length) : 0,
      progressStyle: 'width: ' + (drafts.length ? Math.round(drafts.filter(function (item) { return item.result && item.disposition }).length * 100 / drafts.length) : 0) + '%;',
      draftCountLabel: String(drafts.length)
    }
  },

  setDrafts: function (drafts, idx) {
    this.setData(Object.assign({ drafts: drafts }, this.deriveDraftState(drafts, idx || 0)))
  },

  appendOperationLog: function (title, content) {
    var logs = [logItem(title, content)].concat(this.data.operationLogs || []).slice(0, 6)
    this.setData({
      operationLogs: logs,
      hasOperationLogs: logs.length > 0,
      latestOperationTitle: logs[0].title,
      latestOperationText: logs[0].content
    })
  },

  handleResetMockData: function () {
    var self = this
    if (!api.resetMockData) return
    ui.confirmAction('重置 FACTORY001 数据', '确认恢复质检、工单和入库模拟数据到初始状态？').then(function (ok) {
      if (!ok) return
      self.setData({ submitting: true })
      api.resetMockData().then(function () {
        self.setData({
          operationLogs: [],
          hasOperationLogs: false,
          latestOperationTitle: '模拟数据已重置',
          latestOperationText: 'FACTORY001 质检数据已恢复到待检状态。'
        })
        ui.showSuccess('已重置')
        self.loadInspections()
        self.loadWarehouses()
      }).catch(function (error) {
        ui.showError(error, '重置失败')
      }).finally(function () {
        self.setData({ submitting: false })
      })
    })
  },

  loadInspections: function () {
    var self = this
    this.setData({ loading: true, loadError: '' })
    api.incomingInspectionApi.list({ page: 1, pageSize: 50 }).then(function (res) {
      var list = res.list || []
      self.setData({
        inspections: list,
        inspectionRange: list.map(function (item) {
          return (item.inspectionNo || item.id) + ' · ' + (item.supplierName || item.purchaseOrderNo || '来料质检')
        }),
        lastRefreshAt: ui.nowTimeLabel(),
        syncLabel: ui.nowTimeLabel()
      })
      if (!list.length) {
        self.setData({
          detail: null,
          inspectionLabel: '',
          inspectionPickerLabel: '请选择质检单',
          unitOrderLabel: '请选择质检单',
          unitPurchaseLabel: '待加载',
          unitProductLabel: '来料质检任务',
          inspectionStatusLabel: '待加载'
        })
        self.setDrafts([], 0)
        return null
      }
      var idx = self.data.inspectionIdx < list.length ? self.data.inspectionIdx : 0
      return self.selectInspectionByIndex(idx)
    }).catch(function (error) {
      self.setData({ loadError: ui.getErrorMessage(error, '加载质检单失败') })
      ui.showError(error, '加载质检单失败')
    }).finally(function () {
      self.setData({ loading: false, showRetry: true, emptyText: '暂无待处理质检明细' })
      ui.stopPullDownRefresh()
    })
  },

  selectInspectionByIndex: function (idx) {
    var self = this
    var item = this.data.inspections[idx]
    if (!item) return Promise.resolve()
    this.setData({ inspectionIdx: idx, inspectionLabel: this.data.inspectionRange[idx] || '', inspectionPickerLabel: this.data.inspectionRange[idx] || '请选择质检单' })
    return api.incomingInspectionApi.detail(item.id).then(function (detail) {
      self.setData({
        detail: detail,
        notes: asText(detail.notes),
        overallResultIdx: Math.max(0, RESULT_OPTIONS.findIndex(function (option) { return option.value === detail.overallResult })),
        overallResultLabel: RESULT_OPTIONS[Math.max(0, RESULT_OPTIONS.findIndex(function (option) { return option.value === detail.overallResult }))].label,
        unitOrderLabel: detail.inspectionNo || String(detail.id),
        unitPurchaseLabel: detail.purchaseOrderNo || '-',
        unitProductLabel: detail.supplierName || '来料质检',
        inspectionStatusLabel: detail.status === 'submitted' ? '已提交' : (detail.status === 'pending' ? '待检' : (detail.status || '待检'))
      })
      self.setDrafts(buildDrafts(detail.items), 0)
    })
  },

  handleInspectionChange: function (event) {
    var self = this
    this.setData({ loading: true })
    this.selectInspectionByIndex(Number(event.detail.value) || 0).catch(function (error) {
      ui.showError(error, '加载详情失败')
    }).finally(function () {
      self.setData({ loading: false })
    })
  },

  loadWarehouses: function () {
    var self = this
    api.inventoryApi.warehouses().then(function (res) {
      var list = Array.isArray(res) ? res : []
      self.setData({
        warehouses: list,
        warehouseRange: list.map(function (item) { return item.name }),
        warehouseIdx: list.length ? 0 : 0,
        selectedWarehouseLabel: list.length ? list[0].name : '',
        warehousePickerLabel: list.length ? list[0].name : '请选择仓库'
      })
      if (list.length) self.loadLocations(list[0].id)
    }).catch(function (error) {
      ui.showError(error, '加载仓库失败')
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
        selectedLocationLabel: list.length ? [list[0].code, list[0].name].filter(Boolean).join(' ') : '',
        locationPickerLabel: list.length ? [list[0].code, list[0].name].filter(Boolean).join(' ') : '请选择库位'
      })
    }).catch(function (error) {
      self.setData({ locations: [], locationRange: [], selectedLocationLabel: '', locationPickerLabel: '请选择库位' })
      ui.showError(error, '加载库位失败')
    })
  },

  handleWarehouseChange: function (event) {
    var idx = Number(event.detail.value) || 0
    var warehouse = this.data.warehouses[idx]
    this.setData({ warehouseIdx: idx, selectedWarehouseLabel: warehouse ? warehouse.name : '', warehousePickerLabel: warehouse ? warehouse.name : '请选择仓库' })
    if (warehouse) this.loadLocations(warehouse.id)
  },

  handleLocationChange: function (event) {
    var idx = Number(event.detail.value) || 0
    var location = this.data.locations[idx]
    var label = location ? [location.code, location.name].filter(Boolean).join(' ') : ''
    this.setData({ locationIdx: idx, selectedLocationLabel: label, locationPickerLabel: label || '请选择库位' })
  },

  handleActiveItemChange: function (event) {
    var rawIdx = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.index !== undefined
      ? event.currentTarget.dataset.index
      : event.detail.value
    this.setDrafts(this.data.drafts, Number(rawIdx) || 0)
  },

  updateActiveDraft: function (patch) {
    var drafts = this.data.drafts.slice()
    var current = Object.assign({}, drafts[this.data.activeItemIdx] || {}, patch)
    drafts[this.data.activeItemIdx] = current
    this.setDrafts(drafts, this.data.activeItemIdx)
  },

  handleDraftInput: function (event) {
    if (!this.data.hasActiveDraft) return
    var patch = {}
    patch[event.currentTarget.dataset.field] = ui.decimalInput(event.detail.value)
    this.updateActiveDraft(patch)
  },

  handleDraftTextInput: function (event) {
    if (!this.data.hasActiveDraft) return
    var patch = {}
    patch[event.currentTarget.dataset.field] = event.detail.value
    this.updateActiveDraft(patch)
  },

  handleDraftResultChange: function (event) {
    if (!this.data.hasActiveDraft) return
    var idx = Number(event.detail.value) || 0
    this.updateActiveDraft({ result: RESULT_OPTIONS[idx].value })
  },

  handleDraftDispositionChange: function (event) {
    if (!this.data.hasActiveDraft) return
    var idx = Number(event.detail.value) || 0
    this.updateActiveDraft({ disposition: DISPOSITION_OPTIONS[idx].value })
  },

  markDraftPass: function (event) {
    var idx = Number(event.currentTarget.dataset.index) || 0
    var drafts = this.data.drafts.slice()
    var current = Object.assign({}, drafts[idx] || {})
    current.result = 'pass'
    current.disposition = current.disposition || 'accept'
    current.qtyFailed = current.qtyFailed || '0'
    if (!current.qtyPassed || current.qtyPassed === '0') current.qtyPassed = current.qtySampled || current.qtyDelivered || '0'
    if (!current.acceptedStockQty || current.acceptedStockQty === '0') current.acceptedStockQty = current.qtyPassed
    drafts[idx] = current
    this.setDrafts(drafts, idx)
  },

  markDraftFail: function (event) {
    var idx = Number(event.currentTarget.dataset.index) || 0
    var drafts = this.data.drafts.slice()
    var current = Object.assign({}, drafts[idx] || {})
    current.result = 'fail'
    current.disposition = current.disposition || 'return'
    drafts[idx] = current
    this.setDrafts(drafts, idx)
  },

  markAllPass: function () {
    if (!this.data.drafts.length) {
      ui.showError('当前没有可判定明细', '无法判定')
      return
    }
    var drafts = this.data.drafts.map(function (item) {
      var current = Object.assign({}, item)
      current.result = 'pass'
      current.disposition = 'accept'
      current.qtyFailed = '0'
      if (!current.qtyPassed || current.qtyPassed === '0') current.qtyPassed = current.qtySampled || current.qtyDelivered || '0'
      if (!current.acceptedStockQty || current.acceptedStockQty === '0') current.acceptedStockQty = current.qtyDelivered || current.qtyPassed || '0'
      return current
    })
    this.setData({ overallResultIdx: 0, overallResultLabel: resultLabel('pass') })
    this.setDrafts(drafts, this.data.activeItemIdx)
    this.appendOperationLog('全部合格', '已将 ' + drafts.length + ' 条明细标记为合格并设为接收入库。')
    ui.showSuccess('已全部标记合格')
  },

  handleOverallResultChange: function (event) {
    var idx = Number(event.detail.value) || 0
    this.setData({ overallResultIdx: idx, overallResultLabel: RESULT_OPTIONS[idx].label })
  },

  handleNotesInput: function (event) {
    this.setData({ notes: event.detail.value })
  },

  uploadImages: function () {
    var self = this
    var active = this.data.activeDraft
    if (!active) return
    var remaining = 3 - active.defectImages.length
    if (remaining <= 0) {
      wx.showToast({ title: '每条明细最多 3 张图片', icon: 'none' })
      return
    }
    this.setData({ uploading: true, uploadText: '上传中' })
    wx.chooseImage({
      count: remaining,
      sizeType: ['compressed'],
      sourceType: ['camera', 'album'],
      success: function (picked) {
        var files = picked.tempFilePaths || []
        var chain = Promise.resolve([])
        files.forEach(function (filePath) {
          chain = chain.then(function (uploaded) {
            return api.upload(filePath).then(function (result) {
              uploaded.push(result.url)
              return uploaded
            })
          })
        })
        chain.then(function (uploaded) {
          self.updateActiveDraft({ defectImages: active.defectImages.concat(uploaded) })
          ui.showSuccess('留证图已上传')
        }).catch(function (error) {
          ui.showError(error, '图片上传失败')
        }).finally(function () {
          self.setData({ uploading: false, uploadText: '留证图' })
        })
      },
      fail: function (error) {
        self.setData({ uploading: false, uploadText: '留证图' })
        if (error && error.errMsg && error.errMsg.indexOf('cancel') >= 0) return
        ui.showError(error, '选择图片失败')
      }
    })
  },

  removeImage: function (event) {
    var self = this
    var url = event.currentTarget.dataset.url
    if (!url || !this.data.activeDraft) return
    ui.confirmAction('移除留证图', '确认从当前质检明细中移除这张图片？').then(function (ok) {
      if (!ok) return
      self.updateActiveDraft({
        defectImages: self.data.activeDraft.defectImages.filter(function (item) { return item !== url })
      })
    })
  },

  validateDrafts: function () {
    if (!this.data.detail) throw new Error('请先选择质检单')
    if (!this.data.drafts.length) throw new Error('当前质检单没有明细')
    var missing = this.data.drafts.find(function (item) { return !item.result || !item.disposition })
    if (missing) throw new Error('请为每条明细选择结果和处置方式')
    var invalidQty = this.data.drafts.find(function (item) {
      var sampled = ui.asNumber(item.qtySampled)
      var passed = ui.asNumber(item.qtyPassed)
      var failed = ui.asNumber(item.qtyFailed)
      var accepted = ui.asNumber(item.acceptedStockQty)
      return !Number.isFinite(sampled) || !Number.isFinite(passed) || !Number.isFinite(failed) || !Number.isFinite(accepted) || sampled < passed + failed
    })
    if (invalidQty) throw new Error('抽检数不能小于合格数与不良数之和')
  },

  saveItems: function () {
    var detail = this.data.detail
    this.validateDrafts()
    return api.incomingInspectionApi.updateItems(detail.id, this.data.drafts.map(function (item) {
      return {
        id: item.id,
        sourceItemIds: item.sourceItemIds,
        qtyDelivered: item.qtyDelivered,
        qtySampled: item.qtySampled,
        qtyPassed: item.qtyPassed,
        qtyFailed: item.qtyFailed,
        acceptedStockQty: item.acceptedStockQty,
        dyeLotNo: item.dyeLotNo || undefined,
        result: item.result,
        defectImages: item.defectImages,
        disposition: item.disposition,
        notes: item.notes || undefined
      }
    }))
  },

  handleSave: function () {
    var self = this
    this.setData({ submitting: true })
    this.saveItems().then(function () {
      self.appendOperationLog('明细已保存', '已保存 ' + self.data.drafts.length + ' 条 QC 明细。')
      ui.showSuccess('明细已保存')
    }).catch(function (error) {
      ui.showError(error, '保存失败')
    }).finally(function () {
      self.setData({ submitting: false })
    })
  },

  handleSubmit: function () {
    var self = this
    var detail = this.data.detail
    var warehouse = this.data.warehouses[this.data.warehouseIdx]
    var location = this.data.locations[this.data.locationIdx]
    if (!detail || !warehouse || !location) {
      ui.showError('请选择放行仓库和库位', '放行信息不完整')
      return
    }
    if (detail.status === 'submitted') {
      ui.showSuccess('质检单已提交')
      return
    }
    try {
      this.validateDrafts()
    } catch (error) {
      ui.showError(error, '提交失败')
      return
    }
    ui.confirmAction('提交质检结论', '结论：' + RESULT_OPTIONS[this.data.overallResultIdx].label + '\n提交后将按明细放行入库。').then(function (ok) {
      if (!ok) return
      self.setData({ submitting: true })
      self.saveItems().then(function () {
        return api.incomingInspectionApi.submit(detail.id, {
          overallResult: RESULT_OPTIONS[self.data.overallResultIdx].value,
          warehouseId: warehouse.id,
          locationId: location.id,
          notes: self.data.notes.trim() || undefined
        })
      }).then(function () {
        self.appendOperationLog('质检已提交', '放行至 ' + warehouse.name + ' / ' + location.name)
        ui.showSuccess('质检已提交')
        return self.selectInspectionByIndex(self.data.inspectionIdx)
      }).catch(function (error) {
        ui.showError(error, '提交失败')
      }).finally(function () {
        self.setData({ submitting: false })
      })
    })
  }
})
