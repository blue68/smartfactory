var api = require('../../utils/api')
var config = require('../../utils/config')
var ui = require('../../utils/interaction')
var contracts = require('../../utils/contracts')
var nav = require('../../utils/navigation')

var STATUS_LABELS = {
  draft: '草稿',
  in_progress: '盘点中',
  completed: '待确认',
  confirmed: '已确认',
  cancelled: '已取消'
}

function locationLabel(location) {
  return location ? [location.code, location.name].filter(Boolean).join(' ') : ''
}

function isReadonlyTask(task) {
  return Boolean(task && (task.status === 'completed' || task.status === 'confirmed' || task.status === 'cancelled'))
}

function taskTitle(task) {
  return task ? (task.taskNo || ('盘点任务 ' + task.id)) : '请选择盘点任务'
}

Page({
  data: {
    tasks: [],
    taskCards: [],
    selectedTask: null,
    selectedTaskIdx: 0,
    selectedTaskTitle: '请选择盘点任务',
    selectedTaskStatusLabel: '',
    taskCountLabel: '0 个',
    items: [],
    visibleItems: [],
    itemKeyword: '',
    completedItemCount: 0,
    diffItemCount: 0,
    progressLabel: '0/0',
    emptyText: '盘点任务加载中...',
    showRetry: false,
    warehouses: [],
    warehouseRange: [],
    warehouseIdx: 0,
    warehousePickerLabel: '请选择仓库',
    locations: [],
    locationRange: [],
    locationIdx: 0,
    locationPickerLabel: '请选择货架/库位',
    loading: false,
    submitting: false,
    loadError: '',
    canResetMock: Boolean(api.isMockMode && api.isMockMode()),
    runtimeSignature: '',
    canOperate: true,
    inputDisabled: false,
    actionHint: '选择盘点任务后录入实盘数量，支持扫码货架和物料编码。',
    latestOperationTitle: '等待盘点',
    latestOperationText: '保存盘点或提交后，会在这里显示操作回执。'
  },

  onLoad: function () {
    if (!nav.ensureLogin()) return
    this.syncRuntimeState(false)
    this.loadTasks()
    this.loadWarehouses()
  },

  onShow: function () {
    if (!nav.ensureLogin()) return
    this.syncRuntimeState(true)
  },

  onPullDownRefresh: function () {
    this.loadTasks()
  },

  syncRuntimeState: function (reloadOnChange) {
    var signature = config.getRuntimeSignature ? config.getRuntimeSignature() : ''
    var changed = Boolean(this.data.runtimeSignature && this.data.runtimeSignature !== signature)
    this.setData({
      runtimeSignature: signature,
      canResetMock: Boolean(api.isMockMode && api.isMockMode())
    })
    if (changed && reloadOnChange) {
      this.loadTasks()
      this.loadWarehouses()
    }
  },

  buildTaskCards: function (tasks, selectedTask) {
    return tasks.map(function (task, index) {
      var active = selectedTask && Number(selectedTask.id) === Number(task.id)
      return {
        id: task.id,
        index: index,
        className: 'stocktaking-task' + (active ? ' stocktaking-task--active' : ''),
        title: taskTitle(task),
        statusLabel: STATUS_LABELS[task.status] || task.status || '待处理',
        scopeLabel: [task.warehouseName, task.locationCode || task.locationName].filter(Boolean).join(' / ') || '全仓',
        countLabel: (task.totalItems || 0) + ' 项'
      }
    })
  },

  buildVisibleItems: function (items, keyword) {
    var text = String(keyword || '').trim().toLowerCase()
    var filtered = text
      ? items.filter(function (item) {
        return String(item.skuCode || '').toLowerCase().indexOf(text) >= 0 ||
          String(item.skuName || '').toLowerCase().indexOf(text) >= 0
      })
      : items
    return filtered.map(function (item) {
      var actual = item.actualQty === undefined || item.actualQty === null || item.actualQty === '' ? item.systemQty : item.actualQty
      var diff = Number(actual || 0) - Number(item.systemQty || 0)
      return {
        id: item.id,
        skuId: item.skuId,
        skuCode: item.skuCode,
        skuName: item.skuName,
        stockUnit: item.stockUnit || '',
        locationText: [item.warehouseName, item.locationCode || item.locationName].filter(Boolean).join(' / '),
        systemQty: item.systemQty || '0',
        actualQty: String(actual || ''),
        diffLabel: diff === 0 ? '无差异' : (diff > 0 ? '+' + diff : String(diff)),
        diffClass: diff === 0 ? 'stocktaking-item__diff' : 'stocktaking-item__diff stocktaking-item__diff--warn'
      }
    })
  },

  applyItems: function (items, keyword) {
    var completed = items.filter(function (item) { return item.actualQty !== undefined && item.actualQty !== null && item.actualQty !== '' }).length
    var diffCount = items.filter(function (item) {
      var actual = item.actualQty === undefined || item.actualQty === null || item.actualQty === '' ? item.systemQty : item.actualQty
      return Number(actual || 0) !== Number(item.systemQty || 0)
    }).length
    this.setData({
      items: items,
      visibleItems: this.buildVisibleItems(items, keyword),
      completedItemCount: completed,
      diffItemCount: diffCount,
      progressLabel: completed + '/' + items.length
    })
  },

  applyTaskState: function (task, items) {
    this.setData({
      selectedTask: task,
      selectedTaskTitle: taskTitle(task),
      selectedTaskStatusLabel: task ? (STATUS_LABELS[task.status] || task.status) : '',
      canOperate: !isReadonlyTask(task),
      inputDisabled: isReadonlyTask(task),
      actionHint: isReadonlyTask(task)
        ? '该盘点任务已提交或确认，当前仅支持查看。'
        : '录入实盘数量后先保存，确认无误后提交。'
    })
    this.applyItems(items || [], this.data.itemKeyword)
  },

  loadTasks: function () {
    var self = this
    this.setData({ loading: true, loadError: '' })
    api.stocktakingApi.list({ page: 1, pageSize: 20 }).then(function (res) {
      var list = res.list || []
      var preferred = null
      list.forEach(function (task) {
        if (self.data.selectedTask && Number(task.id) === Number(self.data.selectedTask.id)) preferred = task
      })
      if (!preferred && list.length) preferred = list[0]
      self.setData({
        tasks: list,
        taskCards: self.buildTaskCards(list, preferred),
        taskCountLabel: list.length + ' 个'
      })
      if (!preferred) {
        self.applyTaskState(null, [])
        self.setData({ emptyText: '暂无盘点任务，可扫码货架后创建库位盘点。' })
        return null
      }
      return self.loadTaskDetail(preferred.id)
    }).catch(function (error) {
      self.setData({ loadError: ui.getErrorMessage(error, '加载盘点任务失败') })
      ui.showError(error, '加载盘点任务失败')
    }).finally(function () {
      self.setData({ loading: false, showRetry: true })
      ui.stopPullDownRefresh()
    })
  },

  loadTaskDetail: function (id) {
    var self = this
    return api.stocktakingApi.detail(id).then(function (detail) {
      var task = detail.task
      var items = detail.items || []
      var taskIdx = 0
      self.data.tasks.forEach(function (item, index) {
        if (Number(item.id) === Number(id)) taskIdx = index
      })
      self.setData({
        selectedTaskIdx: taskIdx,
        taskCards: self.buildTaskCards(self.data.tasks, task)
      })
      self.applyTaskState(task, items)
    })
  },

  handleTaskChange: function (event) {
    var idx = Number(event.currentTarget.dataset.index) || 0
    var task = this.data.tasks[idx]
    if (!task) return
    this.loadTaskDetail(task.id).catch(function (error) {
      ui.showError(error, '加载盘点详情失败')
    })
  },

  loadWarehouses: function () {
    var self = this
    api.inventoryApi.warehouses().then(function (res) {
      var list = Array.isArray(res) ? res : []
      self.setData({
        warehouses: list,
        warehouseRange: list.map(function (item) { return item.name }),
        warehouseIdx: 0,
        warehousePickerLabel: list.length ? list[0].name : '请选择仓库'
      })
      if (list.length) self.loadLocations(list[0].id)
    }).catch(function (error) {
      ui.showError(error, '加载仓库失败')
    })
  },

  loadLocations: function (warehouseId) {
    var self = this
    return api.inventoryApi.locations(warehouseId).then(function (res) {
      var list = Array.isArray(res) ? res : []
      self.setData({
        locations: list,
        locationRange: list.map(locationLabel),
        locationIdx: 0,
        locationPickerLabel: list.length ? locationLabel(list[0]) : '请选择货架/库位'
      })
      return list
    }).catch(function (error) {
      self.setData({ locations: [], locationRange: [], locationPickerLabel: '请选择货架/库位' })
      ui.showError(error, '加载库位失败')
      return []
    })
  },

  handleWarehouseChange: function (event) {
    var idx = Number(event.detail.value) || 0
    var warehouse = this.data.warehouses[idx]
    this.setData({ warehouseIdx: idx, warehousePickerLabel: warehouse ? warehouse.name : '请选择仓库' })
    if (warehouse) this.loadLocations(warehouse.id)
  },

  handleLocationChange: function (event) {
    var idx = Number(event.detail.value) || 0
    var location = this.data.locations[idx]
    this.setData({ locationIdx: idx, locationPickerLabel: location ? locationLabel(location) : '请选择货架/库位' })
  },

  selectLocationFromScan: function (raw) {
    var self = this
    var parsed = contracts.parseLocationScanPayload(raw)
    var warehouseIdx = this.data.warehouseIdx
    var warehouse = this.data.warehouses[warehouseIdx]
    this.data.warehouses.forEach(function (item, index) {
      if ((parsed.warehouseId && String(item.id) === String(parsed.warehouseId)) ||
        (parsed.warehouseCode && String(item.code || '').toUpperCase() === String(parsed.warehouseCode).toUpperCase())) {
        warehouseIdx = index
        warehouse = item
      }
    })
    if (!warehouse) {
      ui.showError('未加载仓库资料，请先刷新', '无法选择货架')
      return
    }
    this.setData({ warehouseIdx: warehouseIdx, warehousePickerLabel: warehouse.name })
    this.loadLocations(warehouse.id).then(function (list) {
      var locationIdx = 0
      var location = null
      list.forEach(function (item, index) {
        if ((parsed.locationId && String(item.id) === String(parsed.locationId)) ||
          (parsed.locationCode && String(item.code || '').toUpperCase() === String(parsed.locationCode).toUpperCase())) {
          locationIdx = index
          location = item
        }
      })
      if (!location && list.length === 1) location = list[0]
      self.setData({
        locationIdx: locationIdx,
        locationPickerLabel: location ? locationLabel(location) : '请选择货架/库位'
      })
      if (location) ui.showSuccess('已选择货架')
      else ui.showError('未匹配到货架条码', '货架未找到')
    })
  },

  handleShelfScan: function () {
    var self = this
    wx.scanCode({
      scanType: ['qrCode', 'barCode'],
      success: function (scan) {
        self.selectLocationFromScan(scan.result)
      },
      fail: function (error) {
        ui.showError(error, '扫描货架失败')
      }
    })
  },

  handleSkuScan: function () {
    var self = this
    wx.scanCode({
      scanType: ['qrCode', 'barCode'],
      success: function (scan) {
        var parsed = contracts.parseSkuScanPayload(scan.result)
        var keyword = parsed.skuCode || parsed.skuId || parsed.raw
        self.setData({ itemKeyword: keyword })
        self.applyItems(self.data.items, keyword)
        ui.showSuccess('已定位物料')
      },
      fail: function (error) {
        ui.showError(error, '扫描物料失败')
      }
    })
  },

  handleKeywordInput: function (event) {
    var keyword = event.detail.value
    this.setData({ itemKeyword: keyword })
    this.applyItems(this.data.items, keyword)
  },

  handleActualInput: function (event) {
    if (!this.data.canOperate) return
    var skuId = Number(event.currentTarget.dataset.skuId)
    var actualQty = ui.decimalInput(event.detail.value)
    var items = this.data.items.map(function (item) {
      if (Number(item.skuId) !== skuId) return item
      return Object.assign({}, item, { actualQty: actualQty })
    })
    this.applyItems(items, this.data.itemKeyword)
  },

  handleCreateLocationTask: function () {
    var self = this
    var warehouse = this.data.warehouses[this.data.warehouseIdx]
    var location = this.data.locations[this.data.locationIdx]
    if (!warehouse || !location) {
      ui.showError('请先选择仓库和货架库位', '无法创建盘点')
      return
    }
    ui.confirmAction('创建库位盘点', '按 ' + warehouse.name + ' / ' + locationLabel(location) + ' 创建盘点任务？').then(function (ok) {
      if (!ok) return
      self.setData({ submitting: true })
      api.stocktakingApi.create({
        scope: 'location',
        scopeValue: String(location.id),
        warehouseId: warehouse.id,
        locationId: location.id
      }).then(function (task) {
        self.setData({
          latestOperationTitle: '盘点任务已创建',
          latestOperationText: task.taskNo || ('任务 #' + task.id)
        })
        ui.showSuccess('已创建盘点')
        return self.loadTasks()
      }).catch(function (error) {
        ui.showError(error, '创建盘点失败')
      }).finally(function () {
        self.setData({ submitting: false })
      })
    })
  },

  saveStocktaking: function () {
    var task = this.data.selectedTask
    if (!task) return Promise.reject(new Error('请先选择盘点任务'))
    var items = this.data.items.map(function (item) {
      return {
        skuId: item.skuId,
        actualQty: item.actualQty === undefined || item.actualQty === null || item.actualQty === '' ? item.systemQty : item.actualQty
      }
    })
    if (!items.length) return Promise.reject(new Error('当前盘点任务没有明细'))
    return api.stocktakingApi.updateItems(task.id, items)
  },

  handleSave: function () {
    var self = this
    if (!this.data.canOperate || this.data.submitting) return
    this.setData({ submitting: true })
    this.saveStocktaking().then(function (res) {
      self.setData({
        latestOperationTitle: '盘点已保存',
        latestOperationText: '已保存 ' + (res.updatedCount || self.data.items.length) + ' 条实盘数量。'
      })
      ui.showSuccess('盘点已保存')
      return self.loadTaskDetail(self.data.selectedTask.id)
    }).catch(function (error) {
      ui.showError(error, '保存盘点失败')
    }).finally(function () {
      self.setData({ submitting: false })
    })
  },

  handleSubmit: function () {
    var self = this
    var task = this.data.selectedTask
    if (!task || !this.data.canOperate || this.data.submitting) return
    ui.confirmAction('提交盘点', '提交后等待主管确认，当前手机端将转为只读。').then(function (ok) {
      if (!ok) return
      self.setData({ submitting: true })
      self.saveStocktaking().then(function () {
        return api.stocktakingApi.submit(task.id)
      }).then(function () {
        self.setData({
          latestOperationTitle: '盘点已提交',
          latestOperationText: taskTitle(task) + ' 已提交待确认。'
        })
        ui.showSuccess('盘点已提交')
        return self.loadTasks()
      }).catch(function (error) {
        ui.showError(error, '提交盘点失败')
      }).finally(function () {
        self.setData({ submitting: false })
      })
    })
  },

  handleResetMockData: function () {
    var self = this
    if (!api.resetMockData) return
    api.resetMockData().then(function () {
      ui.showSuccess('已重置')
      return self.loadTasks()
    }).catch(function (error) {
      ui.showError(error, '重置失败')
    })
  },

  handleBackToDashboard: function () {
    nav.backToDashboard()
  }
})
