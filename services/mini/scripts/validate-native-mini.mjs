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
global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => undefined,
  removeStorageSync: () => undefined,
  showToast: () => undefined,
  vibrateShort: () => undefined
}
global.App = (definition) => definition
global.Page = (definition) => {
  if (!definition || typeof definition !== 'object') fail('Page definition must be an object')
  if (!definition.data || typeof definition.data !== 'object') fail('Page data must be an object')
  return definition
}

for (const jsFile of [
  'app.js',
  'pages/worker-task/index.js',
  'pages/warehouse-inbound/index.js',
  'pages/qc-inspect/index.js'
]) {
  require(join(miniRoot, jsFile))
}

const api = require(join(miniRoot, 'utils/api.js'))
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

console.log('mini validation passed')
