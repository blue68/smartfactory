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
  'utils/config.js',
  'utils/request.js',
  'utils/api.js',
  'utils/mockData.js',
  'utils/interaction.js',
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
  'pages/qc-inspect/index.wxss'
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
if (existsSync(join(miniRoot, 'project.config.json')) || existsSync(join(miniRoot, 'project.private.config.json'))) {
  fail('do not keep project config files under miniprogram/. Import services/mini instead.')
}

for (const file of requiredFiles) {
  if (!existsSync(join(miniRoot, file))) fail(`missing ${file}`)
}

const appJson = JSON.parse(readFileSync(join(miniRoot, 'app.json'), 'utf8'))
if (!Array.isArray(appJson.pages) || appJson.pages.length < 3) {
  fail('app.json pages are incomplete')
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
  if (extname(file) === '.json') JSON.parse(text)
  if (extname(file) === '.js') {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    if (result.status !== 0) fail(result.stderr || `syntax check failed: ${file}`)
  }
}

const require = createRequire(import.meta.url)
const pageDefinitions = {}
let currentPageFile = ''
const wxStorage = {}
global.wx = {
  getStorageSync: (key) => wxStorage[key] || '',
  setStorageSync: (key, value) => {
    wxStorage[key] = value
  },
  removeStorageSync: () => undefined,
  showToast: () => undefined,
  showModal: (options) => {
    if (options && options.success) options.success({ confirm: true, cancel: false })
  },
  chooseImage: (options) => {
    if (options && options.success) options.success({ tempFilePaths: ['/tmp/factory001-qc-proof.jpg'] })
  },
  scanCode: (options) => {
    if (options && options.success) options.success({ result: '1001' })
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

for (const jsFile of [
  'app.js',
  'pages/worker-task/index.js',
  'pages/warehouse-inbound/index.js',
  'pages/qc-inspect/index.js'
]) {
  currentPageFile = jsFile
  require(join(miniRoot, jsFile))
}

const api = require(join(miniRoot, 'utils/api.js'))
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

const workerPage = createPageInstance('pages/worker-task/index.js')
if (!workerPage.data.canResetMock) fail('worker task page must expose FACTORY001 reset action in mock mode')
workerPage.onLoad()
await settle()
if (!workerPage.data.selectedTask) fail('worker task page must load a selected task')
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
workerPage.handleTaskChange(makeEvent({ dataset: { index: 1 }, value: 1 }))
await settle()
workerPage.setData({ exceptionText: 'FACTORY001 设备噪音偏大，需要班组长确认。' })
workerPage.handleException()
await settle()
if (workerPage.data.selectedTask.status !== 'exception') fail('worker exception action must move task to exception')
if (!/异常/.test(workerPage.data.latestOperationTitle)) fail('worker exception action must update latest operation receipt')

const inboundPage = createPageInstance('pages/warehouse-inbound/index.js')
if (!inboundPage.data.canResetMock) fail('warehouse inbound page must expose FACTORY001 reset action in mock mode')
inboundPage.onLoad()
await settle()
await inboundPage.searchSku('FAB')
await settle()
inboundPage.setData({ qty: '1' })
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
if (!qcPage.data.hasActiveDraft || !qcPage.data.drafts.length) fail('QC page must load FACTORY001 inspection drafts')
qcPage.markAllPass()
await settle()
if (qcPage.data.completedItemCount !== qcPage.data.drafts.length) fail('QC markAllPass must complete all drafts')
if (!qcPage.data.hasOperationLogs) fail('QC markAllPass must write an operation receipt')
qcPage.handleSave()
await settle()
if (!/保存/.test(qcPage.data.latestOperationTitle)) fail('QC save must update latest operation receipt')
qcPage.handleSubmit()
await settle()
if (!qcPage.data.detail || qcPage.data.detail.status !== 'submitted') fail('QC submit must move inspection to submitted')
if (!/提交/.test(qcPage.data.latestOperationTitle)) fail('QC submit must update latest operation receipt')

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
if (api.resetMockData) {
  await api.resetMockData()
  const resetInspection = await api.incomingInspectionApi.detail(inspection.id)
  if (resetInspection.status !== 'pending') fail('mock reset must restore incoming inspection to pending')
}

console.log('mini validation passed')
