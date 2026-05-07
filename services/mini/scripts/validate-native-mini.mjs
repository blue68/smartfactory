import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const root = new URL('..', import.meta.url).pathname
const miniRoot = join(root, 'miniprogram')
const requiredFiles = [
  'app.js',
  'app.json',
  'app.wxss',
  'utils/auth.js',
  'utils/navigation.js',
  'utils/config.js',
  'utils/request.js',
  'utils/api.js',
  'utils/contracts.js',
  'utils/mockData.js',
  'utils/interaction.js',
  'pages/login/index.js',
  'pages/login/index.json',
  'pages/login/index.wxml',
  'pages/login/index.wxss',
  'pages/dashboard/index.js',
  'pages/dashboard/index.json',
  'pages/dashboard/index.wxml',
  'pages/dashboard/index.wxss',
  'pages/worker-task/index.js',
  'pages/worker-task/index.json',
  'pages/worker-task/index.wxml',
  'pages/worker-task/index.wxss',
  'pages/warehouse-inbound/index.js',
  'pages/warehouse-inbound/index.json',
  'pages/warehouse-inbound/index.wxml',
  'pages/warehouse-inbound/index.wxss',
  'pages/qc-inspect/index.js',
  'pages/qc-inspect/index.json',
  'pages/qc-inspect/index.wxml',
  'pages/qc-inspect/index.wxss',
  'pages/stocktaking/index.js',
  'pages/stocktaking/index.json',
  'pages/stocktaking/index.wxml',
  'pages/stocktaking/index.wxss'
]

function fail(message) {
  console.error('mini validation failed:', message)
  process.exit(1)
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, files)
    else files.push(path)
  }
  return files
}

const project = JSON.parse(readFileSync(join(root, 'project.config.json'), 'utf8'))
if (project.miniprogramRoot !== 'miniprogram/') {
  fail('project.config.json must point miniprogramRoot to miniprogram/')
}
if (existsSync(join(miniRoot, 'project.config.json'))) {
  fail('do not keep project.config.json under miniprogram/. Import services/mini instead.')
}

for (const file of requiredFiles) {
  if (!existsSync(join(miniRoot, file))) fail(`missing ${file}`)
}

const appJson = JSON.parse(readFileSync(join(miniRoot, 'app.json'), 'utf8'))
if (!Array.isArray(appJson.pages) || appJson.pages.length < 6) {
  fail('app.json pages are incomplete')
}
if (appJson.pages[0] !== 'pages/login/index') {
  fail('login page must be the mini program entry')
}
if (appJson.pages[1] !== 'pages/dashboard/index') {
  fail('dashboard page must be available immediately after login')
}
if (!appJson.pages.includes('pages/stocktaking/index')) {
  fail('app.json must expose stocktaking page')
}
if (appJson.tabBar) {
  fail('bottom tabBar must be removed; navigation goes through dashboard grid')
}

for (const page of appJson.pages) {
  for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
    if (!existsSync(join(miniRoot, page + ext))) fail(`page asset missing: ${page}${ext}`)
  }
}

const files = walk(miniRoot)
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  if (/@tarojs|Taro|React|react-dom/.test(text)) fail(`Taro/React reference found in ${file}`)
  if (/\bprocess\b/.test(text)) fail(`process reference found in ${file}`)
  if (extname(file) === '.wxss' && /(^|\n)\s*\*/.test(text)) fail(`unsupported global selector found in ${file}`)
  if (extname(file) === '.wxss' && /:(first-child|last-child)|\binset\s*:/.test(text)) {
    fail(`unsupported wxss selector/property found in ${file}`)
  }
  if (extname(file) === '.wxml' && /\{\{[^}]*([?:]|\|\||&&|===|!==)[^}]*\}\}/.test(text)) {
    fail(`complex wxml expression found in ${file}; compute it in page js instead`)
  }
  if (extname(file) === '.wxml' && />\s*重置\s+FACTORY001\s+模拟数据\s*</.test(text)) {
    fail(`mock reset button label is too long for mobile: ${file}`)
  }
  if (extname(file) === '.json') JSON.parse(text)
  if (extname(file) === '.js') {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    if (result.status !== 0) fail(result.stderr || `syntax check failed: ${file}`)
  }
}

const require = createRequire(import.meta.url)
const pageDefinitions = {}
let currentPageFile = ''
let nextScanResult = '1001'
const wxStorage = {}
wxStorage.sf_mini_runtime_config = {
  apiBaseUrl: 'http://localhost:3000',
  tenantCode: 'FACTORY001',
  useMock: true
}
const requestLog = []
const uploadLog = []
const pageScrollLog = []
const redirectLog = []
const navigateToLog = []
const navigateBackLog = []
global.wx = {
  getStorageSync: (key) => wxStorage[key] || '',
  setStorageSync: (key, value) => {
    wxStorage[key] = value
  },
  removeStorageSync: (key) => {
    delete wxStorage[key]
  },
  request: (options) => {
    requestLog.push(options)
    if (!options || !options.url) fail('wx.request requires url')
    const parsedUrl = new URL(options.url)
    const path = parsedUrl.pathname
    const method = options.method || 'GET'
    const data = options.data || {}
    const send = (responseData, message = 'ok') => {
      options.success({
        statusCode: 200,
        data: {
          code: 0,
          message,
          data: responseData
        }
      })
    }
    const expectActionTimeout = () => {
      if (options.timeout !== 120000) fail(`long-running mobile action must use 120s timeout: ${path}`)
    }
    if (path !== '/api/auth/login' && (!options.header || options.header.Authorization !== 'Bearer mock-access-token-abcdef')) {
      fail(`real API request must carry persisted access token: ${path}`)
    }
    if (path === '/api/domain-error') {
      options.fail({ errMsg: 'request:fail url not in domain list' })
      return
    }
    if (path === '/api/auth/login') {
      if (method !== 'POST') fail('login request must use POST')
      if (!options.data || options.data.username !== 'mini.worker' || options.data.password !== 'mini-pass' || options.data.tenantCode !== 'FACTORY001') {
        fail('login request must send web account, password and tenant code')
      }
      send({
        accessToken: 'mock-access-token-abcdef',
        user: { id: 18, username: 'mini.worker', realName: '小程序工人' }
      }, '登录成功')
      return
    }
    if (path === '/api/production/tasks' && method === 'GET') {
      if (String(data.workerId) !== '18') fail('real production task list must filter by logged-in workerId')
      send({
        list: [{
          id: 501,
          taskNo: 'PT-REAL-501',
          stepName: '裁片',
          skuCode: 'FAB-LN-002',
          skuName: '亚麻面料',
          status: 'pending',
          plannedQty: '10.0000',
          completedQty: '0.0000',
          unit: 'm',
          inputMaterials: [{ skuId: 101, skuCode: 'FAB-LN-002', name: '亚麻面料', requiredQty: '1.0000', unit: 'm' }]
        }],
        total: 1,
        page: 1,
        pageSize: 20
      })
      return
    }
    if (path === '/api/production/tasks/501' && method === 'GET') {
      send({ id: 501, taskNo: 'PT-REAL-501', status: 'pending', plannedQty: '10.0000', completedQty: '0.0000' })
      return
    }
    if (path === '/api/production/tasks/501/start' && method === 'POST') {
      send(null, '任务已开始')
      return
    }
    if (path === '/api/production/tasks/501/issue-materials' && method === 'POST') {
      expectActionTimeout()
      if (!Array.isArray(data.items) || data.items[0].skuId !== 101 || data.items[0].qty !== '1.25') {
        fail('real task issue payload must match backend issue-materials schema')
      }
      send({ success: true }, '任务领料已完成')
      return
    }
    if (path === '/api/production/tasks/501/complete-v2' && method === 'POST') {
      expectActionTimeout()
      if (data.completedQty !== '1' || data.actualHours !== 0.5 || data.scrapQty !== '0') {
        fail('real task complete-v2 payload must match backend schema')
      }
      send(null, '完工已上报')
      return
    }
    if (path === '/api/production/tasks/501/exception' && method === 'POST') {
      if (data.type !== '设备故障' || data.severity !== 'high' || data.affectsProgress !== true) {
        fail('real task exception payload must match backend enum schema')
      }
      send(null, '异常已上报')
      return
    }
    if (path === '/api/inventory/warehouses' && method === 'GET') {
      if (!(data.onlyActive === true || data.onlyActive === 'true')) fail('real warehouses request must filter active warehouses')
      send([{ id: 1, code: 'WH-A', name: '原料仓' }])
      return
    }
    if (path === '/api/inventory/locations' && method === 'GET') {
      if (String(data.warehouseId) !== '1') fail('real locations request must send warehouseId')
      send([{ id: 11, warehouseId: 1, code: 'A-03-2', name: 'A区03架2层' }])
      return
    }
    if (path === '/api/skus' && method === 'GET') {
      if (data.keyword !== 'FAB') fail('real sku search must send keyword')
      send({ list: [{ id: 101, skuCode: 'FAB-LN-002', name: '亚麻面料', stockUnit: 'm' }], total: 1, page: 1, pageSize: 20 })
      return
    }
    if (path === '/api/inventory/inbound' && method === 'POST') {
      expectActionTimeout()
      if (data.skuId !== 101 || data.qtyInput !== '2.5' || data.transactionType !== 'PURCHASE_IN' || data.locationId !== 11) {
        fail('real inbound payload must match backend inventory inbound schema')
      }
      send({ transactionNo: 'TX-REAL-IN-001', qty: '2.5000' }, 'ok')
      return
    }
    if (path === '/api/incoming-inspections' && method === 'GET') {
      send({ list: [{ id: 3001, inspectionNo: 'IQC-REAL-3001', status: 'pending' }], total: 1, page: 1, pageSize: 20 })
      return
    }
    if (path === '/api/incoming-inspections/3001' && method === 'GET') {
      send({
        id: 3001,
        inspectionNo: 'IQC-REAL-3001',
        status: 'pending',
        items: [{ id: 300101, skuCode: 'FAB-LN-002', skuName: '亚麻面料', qtyDelivered: '10.0000', qtySampled: '1.0000' }]
      })
      return
    }
    if (path === '/api/incoming-inspections/3001/items' && method === 'PUT') {
      if (!Array.isArray(data.items) || data.items[0].qtysampled !== '1' || Object.prototype.hasOwnProperty.call(data.items[0], 'qtySampled')) {
        fail('real inspection update payload must use backend qtysampled field')
      }
      send(null, '质检明细已更新')
      return
    }
    if (path === '/api/incoming-inspections/3001/submit' && method === 'POST') {
      expectActionTimeout()
      if (data.overallResult !== 'pass' || data.warehouseId !== 1 || data.locationId !== 11) {
        fail('real inspection submit payload must include result and release location')
      }
      send(null, '质检结论已提交')
      return
    }
    if (path === '/api/stocktaking' && method === 'GET') {
      send({
        list: [{ id: 4001, taskNo: 'ST-REAL-4001', status: 'draft', scope: 'location', totalItems: 1, diffItems: 0 }],
        total: 1,
        page: 1,
        pageSize: 20
      })
      return
    }
    if (path === '/api/stocktaking/4001' && method === 'GET') {
      send({
        task: { id: 4001, taskNo: 'ST-REAL-4001', status: 'draft', scope: 'location', totalItems: 1, diffItems: 0 },
        items: [{ id: 400101, taskId: 4001, skuId: 101, skuCode: 'FAB-LN-002', skuName: '亚麻面料', stockUnit: 'm', systemQty: '100.0000', actualQty: null }]
      })
      return
    }
    if (path === '/api/stocktaking' && method === 'POST') {
      expectActionTimeout()
      if (data.scope !== 'location' || data.scopeValue !== '11' || data.warehouseId !== 1 || data.locationId !== 11) {
        fail('real stocktaking create payload must target selected location')
      }
      send({ id: 4002, taskNo: 'ST-REAL-4002', status: 'draft', scope: 'location', totalItems: 1, diffItems: 0 }, '盘点任务创建成功')
      return
    }
    if (path === '/api/stocktaking/4001/items' && method === 'PUT') {
      expectActionTimeout()
      if (!Array.isArray(data) || data[0].skuId !== 101 || data[0].actualQty !== '99') {
        fail('real stocktaking update payload must be backend item array')
      }
      send({ updatedCount: 1 }, '盘点结果录入成功')
      return
    }
    if (path === '/api/stocktaking/4001/submit' && method === 'POST') {
      expectActionTimeout()
      send({ submittedAt: '2026-05-04T00:00:00.000Z' }, '盘点任务已提交待确认')
      return
    }
    options.fail({ errMsg: 'mock wx.request route not found: ' + options.url })
  },
  uploadFile: (options) => {
    uploadLog.push(options)
    if (!options || !options.url || !options.filePath) fail('wx.uploadFile requires url and filePath')
    options.success({
      statusCode: 200,
      data: JSON.stringify({
        code: 0,
        message: '上传成功',
        data: { url: '/api/upload/files/mock-proof/content' }
      })
    })
  },
  showToast: () => undefined,
  showModal: (options) => {
    if (options && options.success) options.success({ confirm: true, cancel: false })
  },
  chooseImage: (options) => {
    if (options && options.success) options.success({ tempFilePaths: ['/tmp/factory001-qc-proof.jpg'] })
  },
  scanCode: (options) => {
    if (options && options.success) options.success({ result: nextScanResult })
  },
  pageScrollTo: (options) => {
    pageScrollLog.push(options)
  },
  redirectTo: (options) => {
    redirectLog.push(options)
  },
  navigateTo: (options) => {
    navigateToLog.push(options)
  },
  navigateBack: (options) => {
    navigateBackLog.push(options || {})
  },
  stopPullDownRefresh: () => undefined,
  vibrateShort: () => undefined
}
global.App = (definition) => definition
global.Page = (definition) => {
  if (!definition || typeof definition !== 'object') fail('Page definition must be an object')
  if (!definition.data || typeof definition.data !== 'object') fail('Page data must be an object')
  pageDefinitions[currentPageFile] = definition
  return definition
}
global.getCurrentPages = () => [{ route: 'pages/dashboard/index' }, { route: currentPageFile.replace(/\.js$/, '') }]

for (const jsFile of [
  'app.js',
  'pages/login/index.js',
  'pages/dashboard/index.js',
  'pages/worker-task/index.js',
  'pages/warehouse-inbound/index.js',
  'pages/qc-inspect/index.js',
  'pages/stocktaking/index.js'
]) {
  currentPageFile = jsFile
  require(join(miniRoot, jsFile))
}

const api = require(join(miniRoot, 'utils/api.js'))
const contracts = require(join(miniRoot, 'utils/contracts.js'))
const interaction = require(join(miniRoot, 'utils/interaction.js'))
const config = require(join(miniRoot, 'utils/config.js'))
const requestUtil = require(join(miniRoot, 'utils/request.js'))
const authUtil = require(join(miniRoot, 'utils/auth.js'))
const initialRuntimeConfig = wxStorage.sf_mini_runtime_config
delete wxStorage.sf_mini_runtime_config
if (!config.getUseMock()) fail('mini program must default to mock mode to avoid localhost domain-list requests on first launch')
wxStorage.sf_mini_runtime_config = initialRuntimeConfig
if (api.resetMockData) await api.resetMockData()
const clone = (value) => JSON.parse(JSON.stringify(value))
const settle = async (cycles = 12) => {
  for (let i = 0; i < cycles; i += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}
const makeEvent = (payload = {}) => ({
  detail: payload.detail || { value: payload.value },
  currentTarget: { dataset: payload.dataset || {} }
})
const createPageInstance = (pageFile) => {
  const definition = pageDefinitions[pageFile]
  if (!definition) fail(`missing captured Page definition: ${pageFile}`)
  const instance = {
    data: clone(definition.data || {}),
    setData(patch) {
      this.data = Object.assign({}, this.data, clone(patch || {}))
    }
  }
  for (const [key, value] of Object.entries(definition)) {
    if (key === 'data') continue
    instance[key] = typeof value === 'function' ? value.bind(instance) : value
  }
  return instance
}

if (interaction.decimalInput('12.345678') !== '12.3456') fail('decimal input must align with backend 4-decimal contract')
if (contracts.decimalString('12.') !== '12' || contracts.decimalString('.5') !== '0.5') {
  fail('backend decimal string must be regex-safe for trailing-dot and leading-dot input')
}
const issueContract = contracts.normalizeTaskIssuePayload([{ skuId: '101', qty: 1.23456, warehouseId: '1', locationId: '11' }])
if (issueContract.items[0].qty !== '1.2345' || issueContract.items[0].skuId !== 101) {
  fail('task issue payload must use backend decimal string and numeric ids')
}
const completeContract = contracts.normalizeTaskCompletePayload({ completedQty: 2, actualHours: '0.5', scrapQty: 0 })
if (completeContract.completedQty !== '2' || completeContract.scrapQty !== '0' || completeContract.actualHours !== 0.5) {
  fail('task complete payload must match backend complete-v2 schema')
}
const exceptionContract = contracts.normalizeExceptionPayload({ type: 'material_shortage', severity: 'high', description: '缺料' })
if (exceptionContract.type !== '物料缺失' || exceptionContract.severity !== 'high') {
  fail('task exception payload must map mini type to backend enum')
}
const inboundContract = contracts.normalizeInboundPayload({ skuId: '101', qtyInput: 3.14159, inputUnit: 'm', transactionType: 'purchase_in' })
if (inboundContract.qtyInput !== '3.1415' || inboundContract.transactionType !== 'PURCHASE_IN') {
  fail('inventory inbound payload must use backend decimal string and transaction enum')
}
const inspectionContract = contracts.normalizeInspectionItems([{ id: 3001, qtySampled: 10, qtyPassed: 9, qtyFailed: 1, result: 'pass', disposition: 'accept' }])
if (inspectionContract[0].qtysampled !== '10' || Object.prototype.hasOwnProperty.call(inspectionContract[0], 'qtySampled')) {
  fail('inspection item payload must use backend qtysampled field')
}
const stocktakingContract = contracts.normalizeStocktakingItems([{ skuId: '101', actualQty: '6.12345' }])
if (stocktakingContract[0].skuId !== 101 || stocktakingContract[0].actualQty !== '6.1234') {
  fail('stocktaking payload must use backend decimal string and numeric sku id')
}
const locationScan = contracts.parseLocationScanPayload('SMART_FACTORY_LOCATION|WAREHOUSE_ID=1|LOCATION_ID=11|LOCATION_CODE=A-03-2')
if (locationScan.warehouseId !== '1' || locationScan.locationId !== '11') fail('location scan payload must parse warehouse and location ids')
const printedLocationScan = contracts.parseLocationScanPayload('LOC|WH-FAB|A-03-2')
if (printedLocationScan.warehouseCode !== 'WH-FAB' || printedLocationScan.locationCode !== 'A-03-2') {
  fail('location scan payload must parse web printed LOC|warehouse|location barcodes')
}
const skuScan = contracts.parseSkuScanPayload('SMART_FACTORY_SKU|SKU_ID=101|SKU_CODE=FAB-LN-002')
if (skuScan.skuId !== '101' || skuScan.skuCode !== 'FAB-LN-002') fail('sku scan payload must parse sku id and code')
const guardedDashboardPage = createPageInstance('pages/dashboard/index.js')
guardedDashboardPage.onLoad()
if (!redirectLog.length || redirectLog[redirectLog.length - 1].url !== '/pages/login/index') fail('dashboard must redirect anonymous users to login')
const loginPage = createPageInstance('pages/login/index.js')
loginPage.onLoad()
if (!loginPage.data.tenantCode || !loginPage.data.loginDisabled) fail('login page must load tenant and require account/password')
loginPage.handleTenantInput(makeEvent({ value: 'FACTORY001' }))
loginPage.handleUsernameInput(makeEvent({ value: 'mini.worker' }))
loginPage.handlePasswordInput(makeEvent({ value: 'mini-pass' }))
if (loginPage.data.loginDisabled) fail('login page must enable submit after tenant/account/password are filled')
const localMockLoginRequestCount = requestLog.length
loginPage.handleLogin()
await settle()
if (requestLog.length !== localMockLoginRequestCount) fail('default local mini login must not request localhost backend in mock mode')
if (requestUtil.getToken() !== 'mock-access-token-abcdef') fail('login page must persist local mock access token in dev mode')
if (!wxStorage.sf_user || wxStorage.sf_user.id !== 18) fail('login page must persist current user for assigned task filtering in mock mode')
if (loginPage.data.password) fail('login page must clear password after success')
if (!api.isMockMode()) fail('default local mini login must keep mock mode enabled')
if (!redirectLog.length || redirectLog[redirectLog.length - 1].url !== '/pages/dashboard/index') fail('login page must enter dashboard after success')
const dashboardPage = createPageInstance('pages/dashboard/index.js')
dashboardPage.onLoad()
if (!dashboardPage.data.hasModules || dashboardPage.data.modules.length !== 4) fail('dashboard must show all modules when backend user has no explicit mobile permissions')
dashboardPage.handleModuleTap(makeEvent({ dataset: { index: 0 } }))
if (!navigateToLog.length || navigateToLog[navigateToLog.length - 1].url !== '/pages/worker-task/index') fail('dashboard module tap must navigate to worker task page')
wx.setStorageSync('sf_user', authUtil.normalizeLoginUser({
  id: 19,
  username: 'warehouse.only',
  tenantCode: 'FACTORY001',
  permissions: ['warehouse:inbound']
}))
dashboardPage.refreshDashboard()
if (dashboardPage.data.modules.length !== 1 || dashboardPage.data.modules[0].key !== 'warehouseInbound') {
  fail('dashboard must filter grid modules by explicit account permissions')
}
requestUtil.clearToken()
config.setRuntimeConfig({ apiBaseUrl: 'http://localhost:3000', tenantCode: 'FACTORY001', useMock: false })
const localRealLoginPage = createPageInstance('pages/login/index.js')
localRealLoginPage.onLoad()
localRealLoginPage.handleTenantInput(makeEvent({ value: 'FACTORY001' }))
localRealLoginPage.handleUsernameInput(makeEvent({ value: 'mini.worker' }))
localRealLoginPage.handlePasswordInput(makeEvent({ value: 'mini-pass' }))
const localRealLoginRequestCount = requestLog.length
localRealLoginPage.handleLogin()
await settle()
if (requestLog.length !== localRealLoginRequestCount + 1 || requestLog[requestLog.length - 1].url !== 'http://localhost:3000/api/auth/login') {
  fail('local real backend login must honor runtime useMock=false instead of forcing mock mode')
}
if (api.isMockMode()) fail('local real backend login must keep runtime mock mode disabled')
wx.setStorageSync('sf_user', { id: 18, username: 'mini.worker', realName: '小程序工人', tenantCode: 'FACTORY001' })
requestUtil.clearToken()
config.setRuntimeConfig({ apiBaseUrl: 'https://factory001.example.com', tenantCode: 'FACTORY001', useMock: false })
const realLoginPage = createPageInstance('pages/login/index.js')
realLoginPage.onLoad()
realLoginPage.handleTenantInput(makeEvent({ value: 'FACTORY001' }))
realLoginPage.handleUsernameInput(makeEvent({ value: 'mini.worker' }))
realLoginPage.handlePasswordInput(makeEvent({ value: 'mini-pass' }))
realLoginPage.handleLogin()
await settle()
if (requestUtil.getToken() !== 'mock-access-token-abcdef') fail('real backend login must persist access token from web account login')
if (!wxStorage.sf_user || wxStorage.sf_user.id !== 18) fail('real backend login must persist backend user')
if (realLoginPage.data.password) fail('real backend login must clear password after success')
if (api.isMockMode()) fail('real backend login must switch runtime to real backend mode')
if (!requestLog.some((item) => item.url === 'https://factory001.example.com/api/auth/login')) fail('real backend login must use configured backend URL')
await requestUtil.get('/api/domain-error').then(
  () => fail('domain list request should fail'),
  (error) => {
    if (!/合法域名/.test(error.message)) fail('domain list request must show actionable Chinese message')
  }
)
config.setRuntimeConfig({ apiBaseUrl: 'http://127.0.0.1:3000', tenantCode: 'FACTORY001', useMock: false })
if (api.isMockMode()) fail('api runtime mode must switch to real backend when mock is disabled')
await api.upload('/tmp/factory001-proof.jpg')
if (!uploadLog.length || uploadLog[0].url !== 'http://127.0.0.1:3000/api/upload') fail('request upload must use runtime backend URL')
const realTaskPage = await api.productionTaskApi.list({ page: 1, pageSize: 20, workerId: 18 })
if (!realTaskPage.list.length || realTaskPage.list[0].id !== 501) fail('real task API wrapper must unwrap backend paginated response')
await api.productionTaskApi.detail(501)
await api.productionTaskApi.start(501)
await api.productionTaskApi.issueMaterials(501, [{ skuId: '101', qty: '1.25', warehouseId: '1', locationId: '11' }])
await api.productionTaskApi.complete(501, { completedQty: 1, actualHours: '0.5', scrapQty: 0 })
await api.productionTaskApi.reportException(501, { type: 'equipment_failure', severity: 'high', description: '设备异常', affectsProgress: true })
const realWarehouses = await api.inventoryApi.warehouses()
if (!realWarehouses.length || realWarehouses[0].id !== 1) fail('real inventory warehouses API must unwrap option list')
const realLocations = await api.inventoryApi.locations(realWarehouses[0].id)
if (!realLocations.length || realLocations[0].id !== 11) fail('real inventory locations API must unwrap option list')
const realSkuPage = await api.skuApi.search('FAB')
if (!realSkuPage.list.length || realSkuPage.list[0].id !== 101) fail('real SKU search API must unwrap paginated response')
await api.inventoryApi.inbound({ skuId: 101, qtyInput: '2.5', inputUnit: 'm', transactionType: 'purchase_in', warehouseId: 1, locationId: 11 })
const realInspectionPage = await api.incomingInspectionApi.list({ page: 1, pageSize: 20 })
if (!realInspectionPage.list.length || realInspectionPage.list[0].id !== 3001) fail('real incoming inspection API must unwrap list response')
const realInspection = await api.incomingInspectionApi.detail(3001)
await api.incomingInspectionApi.updateItems(3001, realInspection.items.map((item) => Object.assign({}, item, {
  qtySampled: 1,
  qtyPassed: 1,
  qtyFailed: 0,
  result: 'pass',
  disposition: 'accept'
})))
await api.incomingInspectionApi.submit(3001, { overallResult: 'pass', warehouseId: 1, locationId: 11 })
const realStocktakingPage = await api.stocktakingApi.list({ page: 1, pageSize: 20 })
if (!realStocktakingPage.list.length || realStocktakingPage.list[0].id !== 4001) fail('real stocktaking API must unwrap list response')
await api.stocktakingApi.detail(4001)
await api.stocktakingApi.create({ scope: 'location', scopeValue: '11', warehouseId: 1, locationId: 11 })
await api.stocktakingApi.updateItems(4001, [{ skuId: 101, actualQty: '99' }])
await api.stocktakingApi.submit(4001)
config.setRuntimeConfig({ apiBaseUrl: 'http://127.0.0.1:3000', tenantCode: 'FACTORY001', useMock: true })
if (!api.isMockMode()) fail('api runtime mode must switch back to mock when enabled')
requestUtil.setToken('access-token-123456')
wx.setStorageSync('sf_user', { id: 18, username: 'mini.worker', realName: '小程序工人' })

const workerPage = createPageInstance('pages/worker-task/index.js')
if (!workerPage.data.canResetMock) fail('worker task page must expose FACTORY001 reset action in mock mode')
wx.setStorageSync('sf_user', { id: 18, username: 'mini.worker', realName: '小程序工人' })
workerPage.onLoad()
await settle()
var navBackCount = navigateBackLog.length
workerPage.handleBackToDashboard()
if (navigateBackLog.length !== navBackCount + 1) fail('worker task page must return to dashboard')
if (!workerPage.data.hasTaskCards || workerPage.data.selectedTask) fail('worker task page must keep operations out of the first-level list')
if (workerPage.data.assignmentLabel !== '仅显示当前账号分配任务') fail('worker task page must indicate assigned task filtering after login')
workerPage.handleTaskChange(makeEvent({ dataset: { index: 0 }, value: 0 }))
await settle()
if (!workerPage.data.selectedTask || !workerPage.data.isDetailView || workerPage.data.isListView) fail('worker task tap must enter second-level task detail')
workerPage.handleDetailNav(makeEvent({ dataset: { target: 'material' } }))
if (!pageScrollLog.length || pageScrollLog[pageScrollLog.length - 1].selector !== '#worker-task-material') {
  fail('worker detail quick navigation must scroll to material section')
}
if (workerPage.data.startDisabled) fail('worker pending task should allow start action')
workerPage.handleStart()
await settle()
if (workerPage.data.selectedTask.status !== 'in_progress') fail('worker start action must move task to in_progress')
if (!workerPage.data.hasOperationLogs) fail('worker start action must write an operation receipt')
workerPage.pickRecommendedMaterial(makeEvent({ dataset: { index: 0 } }))
workerPage.handleIssue()
await settle()
if (!workerPage.data.selectedTask.lastIssueItems || !workerPage.data.selectedTask.lastIssueItems.length) fail('worker issue action must write issue materials')
if (!/投料/.test(workerPage.data.latestOperationTitle)) fail('worker issue action must update latest operation receipt')
workerPage.setData({ completedQty: '2', actualHours: '0.5', scrapQty: '0' })
workerPage.handleComplete()
await settle()
if (workerPage.data.selectedTask.status !== 'completed') fail('worker complete action must move task to completed')
if (!/完工/.test(workerPage.data.latestOperationTitle)) fail('worker complete action must update latest operation receipt')
if (!workerPage.data.completeDisabled) fail('worker completed task should disable complete action')
workerPage.handleBackToList()
await settle()
if (!workerPage.data.isListView || workerPage.data.isDetailView || !workerPage.data.hasTaskCards) fail('worker detail back action must return to first-level task list')
workerPage.handleTaskChange(makeEvent({ dataset: { index: 1 }, value: 1 }))
await settle()
if (!workerPage.data.isDetailView || workerPage.data.isListView) fail('worker second task must open in second-level detail')
workerPage.setData({ exceptionText: 'FACTORY001 设备噪音偏大，需要班组长确认。' })
workerPage.handleException()
await settle()
if (workerPage.data.selectedTask.status !== 'exception') fail('worker exception action must move task to exception')
if (!/异常/.test(workerPage.data.latestOperationTitle)) fail('worker exception action must update latest operation receipt')

const inboundPage = createPageInstance('pages/warehouse-inbound/index.js')
if (!inboundPage.data.canResetMock) fail('warehouse inbound page must expose FACTORY001 reset action in mock mode')
if (!inboundPage.data.submitDisabled) fail('warehouse inbound submit should be disabled before selecting sku')
inboundPage.onLoad()
await settle()
navBackCount = navigateBackLog.length
inboundPage.handleBackToDashboard()
if (navigateBackLog.length !== navBackCount + 1) fail('warehouse inbound page must return to dashboard')
inboundPage.handleKeywordInput(makeEvent({ value: 'FAB' }))
await new Promise((resolve) => setTimeout(resolve, 380))
await settle()
if (!inboundPage.data.hasKeyword || inboundPage.data.queryDisabled || !inboundPage.data.skuCandidateCount) fail('warehouse inbound search input must support automatic keyword search')
inboundPage.queueKeywordSearch('ZIP')
if (!inboundPage.keywordSearchTimer) fail('warehouse inbound automatic search must debounce keyword input')
inboundPage.onUnload()
if (inboundPage.keywordSearchTimer) fail('warehouse inbound page must clear automatic search timer on unload')
inboundPage.clearKeyword()
await settle()
if (inboundPage.data.keyword || !inboundPage.data.queryDisabled || !inboundPage.data.selectedSkuLabel) fail('warehouse inbound search clear must clear text without losing selected sku')
inboundPage.adjustQty(makeEvent({ dataset: { value: '1' } }))
await settle()
if (inboundPage.data.qty !== '1' || !inboundPage.data.hasQty) fail('warehouse inbound qty stepper must increment from empty state')
inboundPage.adjustQty(makeEvent({ dataset: { value: '-1' } }))
await settle()
if (inboundPage.data.qty || inboundPage.data.hasQty) fail('warehouse inbound qty stepper must clear at zero')
inboundPage.addQuickQty(makeEvent({ dataset: { value: '5' } }))
await settle()
if (inboundPage.data.qty !== '5') fail('warehouse inbound quick qty must add common quantities')
inboundPage.clearQty()
await settle()
if (inboundPage.data.qty || inboundPage.data.hasQty) fail('warehouse inbound qty clear must reset quantity')
inboundPage.handleQtyInput(makeEvent({ value: '1' }))
await settle()
if (inboundPage.data.submitDisabled) fail('warehouse inbound submit should be enabled after sku, qty and location are ready')
inboundPage.selectLocationFromScan('SMART_FACTORY_LOCATION|WAREHOUSE_ID=1|LOCATION_ID=11|LOCATION_CODE=A-03-2')
await settle()
if (inboundPage.data.locationPickerLabel.indexOf('A-03-2') < 0) fail('warehouse inbound shelf scan must select scanned location')
nextScanResult = 'LOC|WH-FAB|B-02-1'
inboundPage.handleShelfScan()
await settle()
if (inboundPage.data.locationPickerLabel.indexOf('B-02-1') < 0) fail('warehouse inbound shelf scan action must select web printed shelf barcode')
inboundPage.handleSubmit()
await settle()
if (!inboundPage.data.successVisible) fail('warehouse inbound submit must show success state')
inboundPage.handleResetMockData()
await settle()
if (inboundPage.data.successVisible) fail('warehouse inbound reset must clear success state')

const qcPage = createPageInstance('pages/qc-inspect/index.js')
if (!qcPage.data.canResetMock) fail('QC page must expose FACTORY001 reset action in mock mode')
qcPage.onLoad()
await settle()
navBackCount = navigateBackLog.length
qcPage.handleBackToDashboard()
if (navigateBackLog.length !== navBackCount + 1) fail('QC page must return to dashboard')
if (!qcPage.data.hasActiveDraft || !qcPage.data.drafts.length) fail('QC page must load FACTORY001 inspection drafts')
if (!qcPage.data.submitDisabled) fail('QC submit should be disabled before all drafts are judged')
qcPage.uploadImages()
await settle()
if (!qcPage.data.activeDefectImages.length || !qcPage.data.drafts[qcPage.data.activeItemIdx].defectImages.length) {
  fail('QC uploadImages must attach proof image to active draft')
}
qcPage.markDraftPass(makeEvent({ dataset: { index: 0 } }))
await settle()
if (qcPage.data.drafts[0].acceptedStockQty !== qcPage.data.drafts[0].qtyDelivered) {
  fail('QC pass action must release delivered quantity, not only sampled quantity')
}
qcPage.markDraftFail(makeEvent({ dataset: { index: 1 } }))
await settle()
if (qcPage.data.drafts[1].acceptedStockQty !== '0' || qcPage.data.drafts[1].qtyPassed !== '0' || qcPage.data.drafts[1].qtyFailed !== qcPage.data.drafts[1].qtySampled || qcPage.data.drafts[1].disposition !== 'return') {
  fail('QC fail action must block stock release and record failed sampled quantity')
}
qcPage.markAllPass()
await settle()
if (qcPage.data.completedItemCount !== qcPage.data.drafts.length) fail('QC markAllPass must complete all drafts')
if (!qcPage.data.hasOperationLogs) fail('QC markAllPass must write an operation receipt')
if (qcPage.data.saveDisabled || qcPage.data.submitDisabled) fail('QC save and submit should be enabled after all drafts are judged')
qcPage.handleSave()
await settle()
if (!/保存/.test(qcPage.data.latestOperationTitle)) fail('QC save must update latest operation receipt')
qcPage.handleSubmit()
await settle()
if (!qcPage.data.detail || qcPage.data.detail.status !== 'submitted') fail('QC submit must move inspection to submitted')
if (!/提交/.test(qcPage.data.latestOperationTitle)) fail('QC submit must update latest operation receipt')
if (!qcPage.data.submitDisabled || qcPage.data.submitButtonText !== '已提交') fail('QC submitted inspection must lock submit action')

const stocktakingPage = createPageInstance('pages/stocktaking/index.js')
if (!stocktakingPage.data.canResetMock) fail('stocktaking page must expose FACTORY001 reset action in mock mode')
stocktakingPage.onLoad()
await settle()
navBackCount = navigateBackLog.length
stocktakingPage.handleBackToDashboard()
if (navigateBackLog.length !== navBackCount + 1) fail('stocktaking page must return to dashboard')
if (!stocktakingPage.data.selectedTask || !stocktakingPage.data.visibleItems.length) fail('stocktaking page must load selected task with items')
stocktakingPage.selectLocationFromScan('SMART_FACTORY_LOCATION|WAREHOUSE_ID=1|LOCATION_ID=11|LOCATION_CODE=A-03-2')
await settle()
if (stocktakingPage.data.locationPickerLabel.indexOf('A-03-2') < 0) fail('stocktaking shelf scan must select scanned location')
nextScanResult = 'LOC|WH-FAB|B-02-1'
stocktakingPage.handleShelfScan()
await settle()
if (stocktakingPage.data.locationPickerLabel.indexOf('B-02-1') < 0) fail('stocktaking shelf scan action must select web printed shelf barcode')
stocktakingPage.handleCreateLocationTask()
await settle()
if (!/创建/.test(stocktakingPage.data.latestOperationTitle) || !stocktakingPage.data.tasks.length) {
  fail('stocktaking page must create location task from selected shelf')
}
stocktakingPage.selectLocationFromScan('SMART_FACTORY_LOCATION|WAREHOUSE_ID=1|LOCATION_ID=11|LOCATION_CODE=A-03-2')
await settle()
nextScanResult = 'SMART_FACTORY_SKU|SKU_ID=101|SKU_CODE=FAB-LN-002'
stocktakingPage.handleSkuScan()
await settle()
if (stocktakingPage.data.itemKeyword !== 'FAB-LN-002') fail('stocktaking sku scan must set parsed sku keyword')
if (!stocktakingPage.data.visibleItems.length || stocktakingPage.data.visibleItems[0].skuId !== 101) fail('stocktaking sku scan must filter to scanned sku')
stocktakingPage.handleKeywordInput(makeEvent({ value: '' }))
stocktakingPage.handleActualInput(makeEvent({ dataset: { skuId: 101 }, value: '106' }))
await settle()
if (!stocktakingPage.data.visibleItems.find((item) => item.skuId === 101 && item.actualQty === '106')) {
  fail('stocktaking actual input must update visible item draft')
}
stocktakingPage.handleSave()
await settle()
if (!/保存/.test(stocktakingPage.data.latestOperationTitle)) fail('stocktaking save must update operation receipt')
stocktakingPage.handleSubmit()
await settle()
if (!stocktakingPage.data.selectedTask || stocktakingPage.data.selectedTask.status !== 'completed') fail('stocktaking submit must move task to completed')
if (stocktakingPage.data.canOperate) fail('submitted stocktaking task must become readonly')

const taskPage = await api.productionTaskApi.list({ page: 1, pageSize: 10 })
if (!taskPage.list.length) fail('mock production tasks must not be empty')
await api.productionTaskApi.start(taskPage.list[0].id)
await api.productionTaskApi.issueMaterials(taskPage.list[0].id, [{ skuId: 101, qty: 1, warehouseId: 1 }])
await api.productionTaskApi.complete(taskPage.list[0].id, { completedQty: 1, actualHours: 0.5, scrapQty: 0 })

const skuPage = await api.skuApi.search('FAB')
if (!skuPage.list.length) fail('mock SKU search must return data')
const warehouseList = await api.inventoryApi.warehouses()
if (!warehouseList.length) fail('mock warehouses must not be empty')
const locationList = await api.inventoryApi.locations(warehouseList[0].id)
if (!locationList.length) fail('mock locations must not be empty')
await api.inventoryApi.inbound({ skuId: skuPage.list[0].id, skuCode: skuPage.list[0].skuCode, qtyInput: 1, inputUnit: 'm', warehouseId: warehouseList[0].id, locationId: locationList[0].id })

const inspectionPage = await api.incomingInspectionApi.list({ page: 1, pageSize: 10 })
if (!inspectionPage.list.length) fail('mock inspections must not be empty')
const inspection = await api.incomingInspectionApi.detail(inspectionPage.list[0].id)
await api.incomingInspectionApi.updateItems(inspection.id, inspection.items.map((item) => Object.assign({}, item, { result: 'pass', disposition: 'accept' })))
await api.incomingInspectionApi.submit(inspection.id, { overallResult: 'pass', warehouseId: warehouseList[0].id, locationId: locationList[0].id })

const stocktakingPageApi = await api.stocktakingApi.list({ page: 1, pageSize: 10 })
if (!stocktakingPageApi.list.length) fail('mock stocktaking tasks must not be empty')
const stocktakingDetail = await api.stocktakingApi.detail(stocktakingPageApi.list[0].id)
if (!stocktakingDetail.items.length) fail('mock stocktaking detail must include items')
await api.stocktakingApi.updateItems(stocktakingDetail.task.id, [{ skuId: stocktakingDetail.items[0].skuId, actualQty: '99' }])
await api.stocktakingApi.submit(stocktakingDetail.task.id)
if (api.resetMockData) {
  await api.resetMockData()
  const resetInspection = await api.incomingInspectionApi.detail(inspection.id)
  if (resetInspection.status !== 'pending') fail('mock reset must restore incoming inspection to pending')
}

console.log('mini validation passed')
