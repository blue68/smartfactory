import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = new URL('..', import.meta.url).pathname
const miniRoot = join(root, 'miniprogram')
const requiredFiles = [
  'app.js',
  'app.json',
  'app.wxss',
  'utils/config.js',
  'utils/request.js',
  'utils/api.js',
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
  if (extname(file) === '.json') JSON.parse(text)
  if (extname(file) === '.js') {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    if (result.status !== 0) fail(result.stderr || `syntax check failed: ${file}`)
  }
}

console.log('mini validation passed')
