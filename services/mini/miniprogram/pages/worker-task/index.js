var api = require('../../utils/api')
var config = require('../../utils/config')
var ui = require('../../utils/interaction')
var nav = require('../../utils/navigation')

var STATUS_OPTIONS = ['全部', '待开工', '进行中', '异常', '已完成']
var STATUS_VALUES = ['', 'pending', 'in_progress', 'exception', 'completed']
var STATUS_LABELS = {
  pending: '待开工',
  in_progress: '进行中',
  exception: '异常',
  completed: '已完成'
}
var EXCEPTION_TYPES = ['物料缺失', '质量异常', '设备故障', '其他', '其他']
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

function toMaterialOption(source) {
  if (!source) return null
  return {
    id: source.skuId || source.id,
    skuId: source.skuId || source.id,
    skuCode: source.skuCode || source.code || '',
    code: source.skuCode || source.code || '',
    name: source.name || source.skuName || source.skuCode || source.code || '物料',
    unit: source.unit,
    stockUnit: source.unit,
    purchaseUnit: source.unit
  }
}

function recommendedMaterialState(task) {
  var first = task && task.inputMaterials && task.inputMaterials.length ? task.inputMaterials[0] : null
  var option = toMaterialOption(first)
  var qty = first ? (first.requiredQty || first.qty || '') : ''
  return {
    materialOptions: option ? [option] : [],
    materialRange: option ? [ui.formatSku(option)] : [],
    materialIdx: 0,
    selectedMaterialLabel: option ? ui.formatSku(option) : '',
    materialPickerLabel: option ? ui.formatSku(option) : '请选择投料物料',
    issueQty: qty ? String(qty) : ''
  }
}

function remainingQty(task) {
  if (!task) return ''
  var planned = Number(task.plannedQty)
  var completed = Number(task.completedQty || 0)
  if (!Number.isFinite(planned) || planned <= 0) return ''
  var remaining = Math.max(planned - completed, 0)
  return remaining ? String(remaining) : String(task.completedQty || '')
}

function logItem(title, content) {
  return {
    id: String(Date.now()) + '-' + Math.floor(Math.random() * 1000),
    time: ui.nowTimeLabel(),
    title: title,
    content: content
  }
}

function currentUserId() {
  var user = wx.getStorageSync('sf_user') || null
  var id = user && (user.id || user.userId)
  return id ? Number(id) : 0
}

function buildActionState(task, viewData) {
  var status = task ? task.status : ''
  var isCompleted = status === 'completed'
  var material = viewData.materialOptions && viewData.materialOptions[viewData.materialIdx]
  var warehouse = viewData.warehouses && viewData.warehouses[viewData.warehouseIdx]
  var location = viewData.locations && viewData.locations[viewData.locationIdx]
  var issueQty = ui.asNumber(viewData.issueQty)
  var completedQty = ui.asNumber(viewData.completedQty)
  var actualHours = ui.asNumber(viewData.actualHours)
  var hasExceptionText = Boolean(String(viewData.exceptionText || '').trim())
  var issueReady = Boolean(task && !isCompleted && material && ui.getSkuId(material) && Number.isFinite(issueQty) && issueQty > 0 && warehouse && location)
  var completeReady = Boolean(task && !isCompleted && Number.isFinite(completedQty) && completedQty > 0 && Number.isFinite(actualHours) && actualHours > 0)
  var exceptionReady = Boolean(task && !isCompleted && hasExceptionText)
  var startButtonText = '确认开工'
  var flowHint = '选择任务后，按开工、投料、完工推进；遇到现场阻断时立即上报异常。'

  if (!task) {
    startButtonText = '请选择任务'
    flowHint = '当前没有选中的任务，请扫码或从任务列表选择。'
  } else if (status === 'pending') {
    flowHint = '建议先确认开工；如已备料，可直接投料，系统会自动进入进行中。'
  } else if (status === 'in_progress') {
    startButtonText = '已开工'
    flowHint = '任务进行中，请核对投料后提交完工；如遇问题可立即上报。'
  } else if (status === 'exception') {
    startButtonText = '异常处理中'
    flowHint = '当前任务已上报异常，处理后可继续补充投料或提交完工。'
  } else if (isCompleted) {
    startButtonText = '已完工'
    flowHint = '当前任务已完工，投料、完工和异常上报已锁定。'
  }

  return {
    startDisabled: !task || status !== 'pending',
    startButtonText: startButtonText,
    taskFlowHint: flowHint,
    issueDisabled: !issueReady,
    issueHint: issueReady ? '投料信息完整，可提交领料记录。' : '请选择投料物料、填写数量并确认仓库和库位。',
    completeDisabled: !completeReady,
    completeHint: completeReady ? '完工数量和工时已填写，可提交报工。' : '请填写有效完工数量和大于 0 的实际工时。',
    exceptionDisabled: !exceptionReady,
    exceptionHint: exceptionReady ? '异常说明已填写，可立即上报。' : '请填写异常说明，便于班组长定位处理。',
    exceptionTypeLabel: EXCEPTION_LABELS[viewData.exceptionTypeIdx] || EXCEPTION_LABELS[0],
    severityLabel: SEVERITY_LABELS[viewData.severityIdx] || SEVERITY_LABELS[1]
  }
}

Page({
  data: {
    statusOptions: STATUS_OPTIONS,
    exceptionLabels: EXCEPTION_LABELS,
    severityLabels: SEVERITY_LABELS,
    statusIdx: 0,
    isListView: true,
    isDetailView: false,
    tasks: [],
    taskRange: [],
    taskCards: [],
    hasTaskCards: false,
    selectedTask: null,
    selectedTaskIdx: 0,
    selectedTaskLabel: '',
    lastRefreshText: '扫码或下拉刷新任务',
    statusDisplayLabel: '状态：全部',
    assignmentLabel: '当前账号分配任务',
    taskCountLabel: '0 个',
    emptyTaskText: '任务加载中...',
    showTaskRetry: false,
    taskTitle: '',
    taskSkuLabel: '',
    taskStatusLabel: '',
    taskPlanLabel: '',
    taskProgress: '-',
    activeTaskCount: 0,
    inputMaterialViews: [],
    hasNoInputMaterials: true,
    warehouses: [],
    warehouseRange: [],
    warehouseIdx: 0,
    selectedWarehouseLabel: '',
    warehousePickerLabel: '请选择出库仓库',
    locations: [],
    locationRange: [],
    locationIdx: 0,
    selectedLocationLabel: '',
    locationPickerLabel: '请选择库位',
    materialKeyword: '',
    materialOptions: [],
    materialRange: [],
    materialIdx: 0,
    selectedMaterialLabel: '',
    materialPickerLabel: '请选择投料物料',
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
    lastRefreshAt: '',
    startDisabled: true,
    startButtonText: '请选择任务',
    taskFlowHint: '选择任务后，按开工、投料、完工推进；遇到现场阻断时立即上报异常。',
    issueDisabled: true,
    issueHint: '请选择投料物料、填写数量并确认仓库。',
    completeDisabled: true,
    completeHint: '请填写有效完工数量和实际工时。',
    exceptionDisabled: true,
    exceptionHint: '请填写异常说明，便于班组长定位处理。',
    exceptionTypeLabel: EXCEPTION_LABELS[0],
    severityLabel: SEVERITY_LABELS[1],
    canResetMock: Boolean(api.isMockMode && api.isMockMode()),
    runtimeSignature: '',
    operationLogs: [],
    hasOperationLogs: false,
    latestOperationTitle: '等待操作',
    latestOperationText: '开工、投料、完工或异常上报后，会在这里保留操作回执。'
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
        className: 'ops-task ops-task--' + priority + (selectedTask && task.id === selectedTask.id ? ' ops-task--active' : ''),
        dotClass: 'ops-task__dot ops-task__dot--' + (task.status || 'pending'),
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
      hasTaskCards: taskCards.length > 0,
      selectedTaskIdx: selectedTaskIdx,
      selectedTaskLabel: selectedTask ? ((selectedTask.taskNo || selectedTask.id) + ' · ' + titleOf(selectedTask)) : '',
      taskTitle: titleOf(selectedTask),
      taskSkuLabel: skuOf(selectedTask),
      taskStatusLabel: selectedTask ? (STATUS_LABELS[selectedTask.status] || selectedTask.status) : '',
      taskPlanLabel: selectedTask ? ('计划 ' + (selectedTask.plannedQty || '-') + ' ' + (selectedTask.unit || '')) : '',
      taskProgress: selectedTask ? ((selectedTask.completedQty || 0) + '/' + (selectedTask.plannedQty || '-') + ' ' + (selectedTask.unit || '')) : '-',
      activeTaskCount: tasks.filter(function (task) { return task.status !== 'completed' }).length,
      inputMaterialViews: inputMaterialViews,
      hasNoInputMaterials: inputMaterialViews.length === 0,
      taskCountLabel: tasks.length + ' 个'
    }
  },

  applyActionState: function (patch) {
    var nextData = Object.assign({}, this.data, patch || {})
    this.setData(Object.assign({}, patch || {}, buildActionState(nextData.selectedTask, nextData)))
  },

  setSelectedTask: function (task) {
    this.applyActionState(Object.assign({
      selectedTask: task,
      completedQty: remainingQty(task),
      actualHours: task && task.standardHours ? String(task.standardHours) : '',
      scrapQty: '',
      completeNotes: '',
    }, this.buildTaskState(this.data.tasks, task), recommendedMaterialState(task)))
  },

  openTaskDetail: function (taskId) {
    var self = this
    if (!taskId || this.data.loading) return
    this.setData({ loading: true, loadError: '' })
    api.productionTaskApi.detail(taskId).then(function (detail) {
      self.setSelectedTask(detail)
      self.setData({ isListView: false, isDetailView: true })
    }).catch(function (error) {
      ui.showError(error, '加载任务详情失败')
    }).finally(function () {
      self.setData({ loading: false })
    })
  },

  handleBackToList: function () {
    this.setData({ isListView: true, isDetailView: false })
    this.loadTasks()
  },

  handleBackToDashboard: function () {
    nav.backToDashboard()
  },

  handleDetailNav: function (event) {
    var target = event.currentTarget.dataset.target
    var selectors = {
      detail: '#worker-task-detail',
      material: '#worker-task-material',
      complete: '#worker-task-complete',
      exception: '#worker-task-exception',
      receipt: '#worker-task-receipt'
    }
    var selector = selectors[target]
    if (!selector || typeof wx === 'undefined' || !wx.pageScrollTo) return
    wx.pageScrollTo({
      selector: selector,
      duration: 220,
      offsetTop: 8
    })
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
    ui.confirmAction('重置 FACTORY001 数据', '确认恢复工单、质检和入库模拟数据到初始状态？').then(function (ok) {
      if (!ok) return
      self.setData({ submitting: true })
      api.resetMockData().then(function () {
        self.setData({
          operationLogs: [],
          hasOperationLogs: false,
          latestOperationTitle: '模拟数据已重置',
          latestOperationText: 'FACTORY001 工单和质检数据已恢复到初始演示状态。'
        })
        ui.showSuccess('已重置')
        self.loadTasks()
        self.loadWarehouses()
      }).catch(function (error) {
        ui.showError(error, '重置失败')
      }).finally(function () {
        self.setData({ submitting: false })
      })
    })
  },

  loadTasks: function () {
    var self = this
    var status = STATUS_VALUES[this.data.statusIdx]
    var userId = currentUserId()
    var params = { page: 1, pageSize: 50, status: status }
    if (userId) params.workerId = userId
    this.setData({ loading: true, loadError: '' })
    api.productionTaskApi.list(params).then(function (res) {
      var list = res.list || []
      var preferred = null
      list.forEach(function (task) {
        if (self.data.selectedTask && task.id === self.data.selectedTask.id) preferred = task
      })
      var refreshAt = ui.nowTimeLabel()
      var selectedForCards = preferred ? self.data.selectedTask : null
      self.setData(Object.assign({
        tasks: list,
        lastRefreshAt: refreshAt,
        lastRefreshText: '最后同步 ' + refreshAt,
        assignmentLabel: userId ? '仅显示当前账号分配任务' : '未登录时显示可见任务'
      }, self.buildTaskState(list, selectedForCards)))
      if (!list.length) {
        self.setData(Object.assign({
          selectedTask: null,
          isListView: true,
          isDetailView: false,
          showTaskRetry: true,
          emptyTaskText: '暂无符合条件的任务'
        }, self.buildTaskState(list, null)))
        return null
      }
      if (self.data.isDetailView && !preferred) {
        self.setData({ isListView: true, isDetailView: false, selectedTask: null })
      }
      return null
    }).catch(function (error) {
      self.setData({ loadError: ui.getErrorMessage(error, '加载任务失败') })
      ui.showError(error, '加载任务失败')
    }).finally(function () {
      self.setData({ loading: false, showTaskRetry: true, emptyTaskText: '暂无符合条件的任务' })
      ui.stopPullDownRefresh()
    })
  },

  loadWarehouses: function () {
    var self = this
    api.inventoryApi.warehouses().then(function (res) {
      var list = Array.isArray(res) ? res : []
      self.applyActionState({
        warehouses: list,
        warehouseRange: list.map(function (item) { return item.name }),
        warehouseIdx: list.length ? 0 : 0,
        selectedWarehouseLabel: list.length ? list[0].name : '',
        warehousePickerLabel: list.length ? list[0].name : '请选择出库仓库'
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
      self.applyActionState({
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

  handleStatusChange: function (event) {
    var idx = Number(event.detail.value) || 0
    this.setData({ statusIdx: idx, statusDisplayLabel: '状态：' + STATUS_OPTIONS[idx] })
    this.setData({ isListView: true, isDetailView: false })
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
    self.openTaskDetail(task.id)
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
        self.openTaskDetail(taskId)
        ui.showSuccess('已定位任务')
      },
      fail: function (error) {
        ui.showError(error, '扫码失败')
      }
    })
  },

  handleWarehouseChange: function (event) {
    var idx = Number(event.detail.value) || 0
    var warehouse = this.data.warehouses[idx]
    this.applyActionState({ warehouseIdx: idx, selectedWarehouseLabel: warehouse ? warehouse.name : '', warehousePickerLabel: warehouse ? warehouse.name : '请选择出库仓库' })
    if (warehouse) this.loadLocations(warehouse.id)
  },

  handleLocationChange: function (event) {
    var idx = Number(event.detail.value) || 0
    var location = this.data.locations[idx]
    var label = location ? [location.code, location.name].filter(Boolean).join(' ') : ''
    this.applyActionState({ locationIdx: idx, selectedLocationLabel: label, locationPickerLabel: label || '请选择库位' })
  },

  handleMaterialKeywordInput: function (event) { this.applyActionState({ materialKeyword: event.detail.value }) },
  handleIssueQtyInput: function (event) { this.applyActionState({ issueQty: ui.decimalInput(event.detail.value) }) },
  handleDyeLotInput: function (event) { this.setData({ dyeLotNo: event.detail.value }) },
  handleCompletedQtyInput: function (event) { this.applyActionState({ completedQty: ui.decimalInput(event.detail.value) }) },
  handleActualHoursInput: function (event) { this.applyActionState({ actualHours: ui.decimalInput(event.detail.value) }) },
  handleScrapQtyInput: function (event) { this.setData({ scrapQty: ui.decimalInput(event.detail.value) }) },
  handleCompleteNotesInput: function (event) { this.setData({ completeNotes: event.detail.value }) },
  handleExceptionTypeChange: function (event) { this.applyActionState({ exceptionTypeIdx: Number(event.detail.value) || 0 }) },
  handleSeverityChange: function (event) { this.applyActionState({ severityIdx: Number(event.detail.value) || 0 }) },
  handleExceptionTextInput: function (event) { this.applyActionState({ exceptionText: event.detail.value }) },

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
      self.applyActionState({
        materialOptions: list,
        materialRange: list.map(ui.formatSku),
        materialIdx: 0,
        selectedMaterialLabel: list.length ? ui.formatSku(list[0]) : '',
        materialPickerLabel: list.length ? ui.formatSku(list[0]) : '请选择投料物料'
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
    this.applyActionState({ materialIdx: idx, selectedMaterialLabel: item ? ui.formatSku(item) : '', materialPickerLabel: item ? ui.formatSku(item) : '请选择投料物料' })
  },

  pickRecommendedMaterial: function (event) {
    var item = this.data.inputMaterialViews[event.currentTarget.dataset.index]
    if (!item || !item.source) return
    var source = item.source
    var option = toMaterialOption(source)
    if (!option) return
    this.applyActionState({
      materialOptions: [option],
      materialRange: [ui.formatSku(option)],
      materialIdx: 0,
      selectedMaterialLabel: ui.formatSku(option),
      materialPickerLabel: ui.formatSku(option),
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
    if (task.status === 'in_progress') {
      ui.showSuccess('任务已在进行中')
      return
    }
    if (task.status === 'completed') {
      ui.showError('已完工任务不能重复开工', '无法开工')
      return
    }
    ui.confirmAction('确认开工', '开始执行「' + titleOf(task) + '」？').then(function (ok) {
      if (!ok) return
      self.setData({ submitting: true })
      api.productionTaskApi.start(task.id).then(function () {
        self.appendOperationLog('开工成功', (task.taskNo || task.id) + ' · ' + titleOf(task))
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
    if (this.data.submitting) return
    var material = this.data.materialOptions[this.data.materialIdx]
    var warehouse = this.data.warehouses[this.data.warehouseIdx]
    var location = this.data.locations[this.data.locationIdx]
    var qty = ui.asNumber(this.data.issueQty)
    var skuId = ui.getSkuId(material)
    if (task && task.status === 'completed') {
      ui.showError('已完工任务不能继续投料', '无法投料')
      return
    }
    if (!task || !material || !skuId || !Number.isFinite(qty) || qty <= 0 || !warehouse || !location) {
      ui.showError('请补齐物料、数量、仓库和库位', '投料信息不完整')
      return
    }
    ui.confirmAction('确认投料', '物料：' + ui.formatSku(material) + '\n数量：' + qty).then(function (ok) {
      if (!ok) return
      self.setData({ submitting: true })
      var ensureStarted = task.status === 'pending' ? api.productionTaskApi.start(task.id) : Promise.resolve()
      ensureStarted.then(function () {
        return api.productionTaskApi.issueMaterials(task.id, [{
          skuId: skuId,
          qty: qty,
          unit: material.stockUnit || material.purchaseUnit || material.unit,
          warehouseId: warehouse.id,
          locationId: location ? location.id : undefined,
          dyeLotNo: self.data.dyeLotNo.trim() || undefined
        }])
      }).then(function () {
        self.appendOperationLog('投料成功', (task.status === 'pending' ? '已自动开工 · ' : '') + ui.formatSku(material) + ' · ' + qty + ' ' + (material.stockUnit || material.purchaseUnit || material.unit || ''))
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
    if (this.data.submitting) return
    var qty = ui.asNumber(this.data.completedQty)
    var hours = ui.asNumber(this.data.actualHours)
    var scrap = this.data.scrapQty ? ui.asNumber(this.data.scrapQty) : 0
    if (task && task.status === 'completed') {
      ui.showError('当前任务已完工，请勿重复提交', '无法完工')
      return
    }
    if (!task || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(hours) || hours <= 0) {
      ui.showError('请填写有效完工数量和大于 0 的实际工时', '完工信息不完整')
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
        self.appendOperationLog('完工已提交', '完工 ' + qty + ' ' + (task.unit || '') + ' · 工时 ' + hours + 'h')
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
    if (this.data.submitting) return
    if (task && task.status === 'completed') {
      ui.showError('已完工任务不能上报异常', '无法上报')
      return
    }
    if (!task || !this.data.exceptionText.trim()) {
      ui.showError('请填写异常说明', '异常信息不完整')
      return
    }
    ui.confirmAction('提交异常', '异常类型：' + EXCEPTION_LABELS[this.data.exceptionTypeIdx] + '\n严重程度：' + SEVERITY_LABELS[this.data.severityIdx]).then(function (ok) {
      if (!ok) return
      self.setData({ submitting: true })
      var ensureStarted = task.status === 'pending' ? api.productionTaskApi.start(task.id) : Promise.resolve()
      ensureStarted.then(function () {
        return api.productionTaskApi.reportException(task.id, {
          type: EXCEPTION_TYPES[self.data.exceptionTypeIdx],
          severity: SEVERITY_OPTIONS[self.data.severityIdx],
          affectsProgress: true,
          description: self.data.exceptionText.trim()
        })
      }).then(function () {
        self.appendOperationLog('异常已上报', (task.status === 'pending' ? '已自动开工 · ' : '') + EXCEPTION_LABELS[self.data.exceptionTypeIdx] + ' · ' + SEVERITY_LABELS[self.data.severityIdx])
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
