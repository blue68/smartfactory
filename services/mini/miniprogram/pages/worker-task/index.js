var api = require('../../utils/api')
var ui = require('../../utils/interaction')

var STATUS_OPTIONS = ['全部', '待开工', '进行中', '异常', '已完成']
var STATUS_VALUES = ['', 'pending', 'in_progress', 'exception', 'completed']
var STATUS_LABELS = {
  pending: '待开工',
  in_progress: '进行中',
  exception: '异常',
  completed: '已完成'
}
var EXCEPTION_TYPES = ['material_shortage', 'quality_issue', 'equipment_failure', 'process_issue', 'other']
var EXCEPTION_LABELS = ['物料短缺', '质量异常', '设备异常', '工艺异常', '其他']
var SEVERITY_OPTIONS = ['low', 'medium', 'high']
var SEVERITY_LABELS = ['低', '中', '高']

function titleOf(task) {
  return task ? (task.stepName || task.processName || task.taskNo || ('任务 ' + task.id)) : ''
}

function skuOf(task) {
  if (!task) return ''
  return [task.skuCode, task.skuName].filter(Boolean).join(' · ') || '未关联产品'
}

function normalizeScanPayload(raw) {
  var result = {}
  String(raw || '').split(/[|&\n;,]/).forEach(function (part) {
    var pair = part.split('=')
    if (pair.length < 2) return
    result[String(pair[0]).trim().toUpperCase()] = pair.slice(1).join('=').trim()
  })
  return result
}

Page({
  data: {
    statusOptions: STATUS_OPTIONS,
    exceptionLabels: EXCEPTION_LABELS,
    severityLabels: SEVERITY_LABELS,
    statusIdx: 0,
    tasks: [],
    taskRange: [],
    selectedTask: null,
    selectedTaskIdx: 0,
    selectedTaskLabel: '',
    taskTitle: '',
    taskSkuLabel: '',
    taskStatusLabel: '',
    taskProgress: '-',
    activeTaskCount: 0,
    inputMaterialViews: [],
    warehouses: [],
    warehouseRange: [],
    warehouseIdx: 0,
    selectedWarehouseLabel: '',
    locations: [],
    locationRange: [],
    locationIdx: 0,
    selectedLocationLabel: '',
    materialKeyword: '',
    materialOptions: [],
    materialRange: [],
    materialIdx: 0,
    selectedMaterialLabel: '',
    issueQty: '',
    dyeLotNo: '',
    completedQty: '',
    actualHours: '',
    scrapQty: '',
    completeNotes: '',
    exceptionTypeIdx: 0,
    severityIdx: 1,
    exceptionText: '',
    loading: false,
    materialSearching: false,
    submitting: false,
    loadError: '',
    lastRefreshAt: ''
  },

  onLoad: function () {
    this.loadTasks()
    this.loadWarehouses()
  },

  onPullDownRefresh: function () {
    this.loadTasks()
  },

  buildTaskState: function (tasks, selectedTask) {
    var selectedTaskIdx = 0
    var taskRange = tasks.map(function (task, index) {
      if (selectedTask && task.id === selectedTask.id) selectedTaskIdx = index
      return (task.taskNo || task.workOrderNo || task.productionOrderNo || task.id) + ' · ' + titleOf(task)
    })
    var taskCards = tasks.map(function (task, index) {
      var priority = task.status === 'exception' ? 'urgent' : (index < 2 ? 'high' : 'normal')
      var priorityLabel = priority === 'urgent' ? '紧急' : (priority === 'high' ? '高' : '普通')
      return {
        id: task.id,
        priority: priority,
        priorityLabel: priorityLabel,
        title: titleOf(task),
        sku: skuOf(task),
        orderNo: task.workOrderNo || task.productionOrderNo || task.taskNo || ('#' + task.id),
        qty: (task.completedQty || 0) + '/' + (task.plannedQty || '-') + ' ' + (task.unit || ''),
        status: task.status,
        statusLabel: STATUS_LABELS[task.status] || task.status || '待处理',
        active: Boolean(selectedTask && task.id === selectedTask.id)
      }
    })
    var inputMaterialViews = (selectedTask && selectedTask.inputMaterials ? selectedTask.inputMaterials : []).map(function (item, index) {
      return {
        key: String(item.skuId || item.skuCode || index),
        label: (item.skuCode || item.name || item.skuName || '物料') + ' · ' + (item.requiredQty || item.qty || '-') + ' ' + (item.unit || ''),
        source: item
      }
    })
    return {
      taskRange: taskRange,
      taskCards: taskCards,
      selectedTaskIdx: selectedTaskIdx,
      selectedTaskLabel: selectedTask ? ((selectedTask.taskNo || selectedTask.id) + ' · ' + titleOf(selectedTask)) : '',
      taskTitle: titleOf(selectedTask),
      taskSkuLabel: skuOf(selectedTask),
      taskStatusLabel: selectedTask ? (STATUS_LABELS[selectedTask.status] || selectedTask.status) : '',
      taskProgress: selectedTask ? ((selectedTask.completedQty || 0) + '/' + (selectedTask.plannedQty || '-') + ' ' + (selectedTask.unit || '')) : '-',
      activeTaskCount: tasks.filter(function (task) { return task.status !== 'completed' }).length,
      inputMaterialViews: inputMaterialViews
    }
  },

  setSelectedTask: function (task) {
    this.setData(Object.assign({
      selectedTask: task,
      completedQty: task ? String(task.completedQty || '') : '',
      actualHours: '',
      scrapQty: '',
      completeNotes: ''
    }, this.buildTaskState(this.data.tasks, task)))
  },

  loadTasks: function () {
    var self = this
    var status = STATUS_VALUES[this.data.statusIdx]
    this.setData({ loading: true, loadError: '' })
    api.productionTaskApi.list({ page: 1, pageSize: 50, status: status }).then(function (res) {
      var list = res.list || []
      var preferred = null
      list.forEach(function (task) {
        if (self.data.selectedTask && task.id === self.data.selectedTask.id) preferred = task
      })
      if (!preferred && list.length) preferred = list[0]
      self.setData({ tasks: list, lastRefreshAt: ui.nowTimeLabel() })
      if (!preferred) {
        self.setData(Object.assign({ selectedTask: null }, self.buildTaskState(list, null)))
        return null
      }
      return api.productionTaskApi.detail(preferred.id).then(function (detail) {
        self.setData({ tasks: list })
        self.setSelectedTask(detail)
      })
    }).catch(function (error) {
      self.setData({ loadError: ui.getErrorMessage(error, '加载任务失败') })
      ui.showError(error, '加载任务失败')
    }).finally(function () {
      self.setData({ loading: false })
      ui.stopPullDownRefresh()
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
        selectedWarehouseLabel: list.length ? list[0].name : ''
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
        selectedLocationLabel: list.length ? [list[0].code, list[0].name].filter(Boolean).join(' ') : ''
      })
    }).catch(function (error) {
      self.setData({ locations: [], locationRange: [], selectedLocationLabel: '' })
      ui.showError(error, '加载库位失败')
    })
  },

  handleStatusChange: function (event) {
    this.setData({ statusIdx: Number(event.detail.value) || 0 })
    this.loadTasks()
  },

  handleTaskChange: function (event) {
    var self = this
    var rawIdx = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.index !== undefined
      ? event.currentTarget.dataset.index
      : event.detail.value
    var idx = Number(rawIdx) || 0
    var task = this.data.tasks[idx]
    if (!task) return
    this.setData({ loading: true })
    api.productionTaskApi.detail(task.id).then(function (detail) {
      self.setSelectedTask(detail)
    }).catch(function (error) {
      ui.showError(error, '加载任务详情失败')
    }).finally(function () {
      self.setData({ loading: false })
    })
  },

  handleScanTask: function () {
    var self = this
    wx.scanCode({
      scanType: ['qrCode', 'barCode'],
      success: function (scan) {
        var payload = normalizeScanPayload(scan.result)
        var taskId = Number(payload.TASK_ID || payload.TASKID || scan.result)
        if (!Number.isFinite(taskId) || taskId <= 0) {
          ui.showError('未识别到任务 ID，可手动选择任务', '未识别到任务 ID')
          return
        }
        api.productionTaskApi.detail(taskId).then(function (detail) {
          self.setSelectedTask(detail)
          ui.showSuccess('已定位任务')
        }).catch(function (error) {
          ui.showError(error, '扫码定位失败')
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

  handleMaterialKeywordInput: function (event) { this.setData({ materialKeyword: event.detail.value }) },
  handleIssueQtyInput: function (event) { this.setData({ issueQty: ui.decimalInput(event.detail.value) }) },
  handleDyeLotInput: function (event) { this.setData({ dyeLotNo: event.detail.value }) },
  handleCompletedQtyInput: function (event) { this.setData({ completedQty: ui.decimalInput(event.detail.value) }) },
  handleActualHoursInput: function (event) { this.setData({ actualHours: ui.decimalInput(event.detail.value) }) },
  handleScrapQtyInput: function (event) { this.setData({ scrapQty: ui.decimalInput(event.detail.value) }) },
  handleCompleteNotesInput: function (event) { this.setData({ completeNotes: event.detail.value }) },
  handleExceptionTypeChange: function (event) { this.setData({ exceptionTypeIdx: Number(event.detail.value) || 0 }) },
  handleSeverityChange: function (event) { this.setData({ severityIdx: Number(event.detail.value) || 0 }) },
  handleExceptionTextInput: function (event) { this.setData({ exceptionText: event.detail.value }) },

  searchMaterial: function () {
    var self = this
    var keyword = this.data.materialKeyword.trim()
    if (!keyword) {
      wx.showToast({ title: '请输入物料编码或名称', icon: 'none' })
      return
    }
    this.setData({ materialSearching: true })
    api.skuApi.search(keyword).then(function (res) {
      var list = res.list || []
      self.setData({
        materialOptions: list,
        materialRange: list.map(ui.formatSku),
        materialIdx: 0,
        selectedMaterialLabel: list.length ? ui.formatSku(list[0]) : ''
      })
      if (!list.length) wx.showToast({ title: '未找到物料', icon: 'none' })
    }).catch(function (error) {
      ui.showError(error, '查询物料失败')
    }).finally(function () {
      self.setData({ materialSearching: false })
    })
  },

  handleMaterialChange: function (event) {
    var idx = Number(event.detail.value) || 0
    var item = this.data.materialOptions[idx]
    this.setData({ materialIdx: idx, selectedMaterialLabel: item ? ui.formatSku(item) : '' })
  },

  pickRecommendedMaterial: function (event) {
    var item = this.data.inputMaterialViews[event.currentTarget.dataset.index]
    if (!item || !item.source) return
    var source = item.source
    var option = {
      id: source.skuId,
      skuCode: source.skuCode || '',
      name: source.name || source.skuName || source.skuCode || '物料',
      unit: source.unit,
      stockUnit: source.unit
    }
    this.setData({
      materialOptions: [option],
      materialRange: [ui.formatSku(option)],
      materialIdx: 0,
      selectedMaterialLabel: ui.formatSku(option),
      issueQty: source.requiredQty || source.qty ? String(source.requiredQty || source.qty) : this.data.issueQty
    })
  },

  refreshCurrentTask: function () {
    var self = this
    if (!this.data.selectedTask) return Promise.resolve()
    return api.productionTaskApi.detail(this.data.selectedTask.id).then(function (detail) {
      self.setSelectedTask(detail)
      self.loadTasks()
    })
  },

  handleStart: function () {
    var self = this
    var task = this.data.selectedTask
    if (!task || this.data.submitting) return
    ui.confirmAction('确认开工', '开始执行「' + titleOf(task) + '」？').then(function (ok) {
      if (!ok) return
      self.setData({ submitting: true })
      api.productionTaskApi.start(task.id).then(function () {
        ui.showSuccess('已开工')
        return self.refreshCurrentTask()
      }).catch(function (error) {
        ui.showError(error, '开工失败')
      }).finally(function () {
        self.setData({ submitting: false })
      })
    })
  },

  handleIssue: function () {
    var self = this
    var task = this.data.selectedTask
    var material = this.data.materialOptions[this.data.materialIdx]
    var warehouse = this.data.warehouses[this.data.warehouseIdx]
    var location = this.data.locations[this.data.locationIdx]
    var qty = ui.asNumber(this.data.issueQty)
    var skuId = ui.getSkuId(material)
    if (!task || !material || !skuId || !Number.isFinite(qty) || qty <= 0 || !warehouse) {
      ui.showError('请补齐物料、数量和仓库', '投料信息不完整')
      return
    }
    ui.confirmAction('确认投料', '物料：' + ui.formatSku(material) + '\n数量：' + qty).then(function (ok) {
      if (!ok) return
      self.setData({ submitting: true })
      api.productionTaskApi.issueMaterials(task.id, [{
        skuId: skuId,
        qty: qty,
        unit: material.stockUnit || material.purchaseUnit || material.unit,
        warehouseId: warehouse.id,
        locationId: location ? location.id : undefined,
        dyeLotNo: self.data.dyeLotNo.trim() || undefined
      }]).then(function () {
        self.setData({ issueQty: '', dyeLotNo: '' })
        ui.showSuccess('投料成功')
        return self.refreshCurrentTask()
      }).catch(function (error) {
        ui.showError(error, '投料失败')
      }).finally(function () {
        self.setData({ submitting: false })
      })
    })
  },

  handleComplete: function () {
    var self = this
    var task = this.data.selectedTask
    var qty = ui.asNumber(this.data.completedQty)
    var hours = ui.asNumber(this.data.actualHours)
    var scrap = this.data.scrapQty ? ui.asNumber(this.data.scrapQty) : 0
    if (!task || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(hours) || hours < 0) {
      ui.showError('请填写有效完工数量和工时', '完工信息不完整')
      return
    }
    ui.confirmAction('提交完工', '完工数量 ' + qty + '，实际工时 ' + hours + 'h。').then(function (ok) {
      if (!ok) return
      self.setData({ submitting: true })
      api.productionTaskApi.complete(task.id, {
        completedQty: qty,
        actualHours: hours,
        scrapQty: Number.isFinite(scrap) ? scrap : 0,
        notes: self.data.completeNotes.trim() || undefined
      }).then(function () {
        ui.showSuccess('完工已提交')
        return self.refreshCurrentTask()
      }).catch(function (error) {
        ui.showError(error, '完工失败')
      }).finally(function () {
        self.setData({ submitting: false })
      })
    })
  },

  handleException: function () {
    var self = this
    var task = this.data.selectedTask
    if (!task || !this.data.exceptionText.trim()) {
      ui.showError('请填写异常说明', '异常信息不完整')
      return
    }
    ui.confirmAction('提交异常', '异常类型：' + EXCEPTION_LABELS[this.data.exceptionTypeIdx] + '\n严重程度：' + SEVERITY_LABELS[this.data.severityIdx]).then(function (ok) {
      if (!ok) return
      self.setData({ submitting: true })
      api.productionTaskApi.reportException(task.id, {
        type: EXCEPTION_TYPES[self.data.exceptionTypeIdx],
        severity: SEVERITY_OPTIONS[self.data.severityIdx],
        affectsProgress: true,
        description: self.data.exceptionText.trim()
      }).then(function () {
        self.setData({ exceptionText: '' })
        ui.showSuccess('异常已上报')
        return self.refreshCurrentTask()
      }).catch(function (error) {
        ui.showError(error, '异常上报失败')
      }).finally(function () {
        self.setData({ submitting: false })
      })
    })
  }
})
