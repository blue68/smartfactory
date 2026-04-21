#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const LEVEL_BLOCKS = [
  { level: 1, process: 2, code: 3, name: 4, size: 5, qty: 6, materialAttr: null },
  { level: 2, process: 7, code: 8, name: 9, size: 11, qty: 10, materialAttr: null },
  { level: 3, process: 19, code: 13, name: 15, size: 18, qty: 16, materialAttr: 17 },
  { level: 4, process: 24, code: 20, name: 21, size: 22, qty: 23, materialAttr: null },
  { level: 5, process: 29, code: 25, name: 26, size: 27, qty: 28, materialAttr: null },
  { level: 6, process: 34, code: 30, name: 31, size: 32, qty: 33, materialAttr: null },
  { level: 7, process: 39, code: 35, name: 36, size: 38, qty: 37, materialAttr: null },
];

function parseArgs(argv) {
  const result = {};
  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    result[key] = next && !next.startsWith('--') ? next : true;
    if (result[key] !== true) i += 1;
  }
  return result;
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\r/g, '').replace(/\n+/g, ' ').trim();
}

function normalizeProcessLabel(value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  return raw
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\s+/g, '')
    .replace(/：+/g, '：')
    .trim();
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readSheetRows(filePath, sheetName) {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const actualSheet = sheetName || workbook.SheetNames[0];
  if (!workbook.Sheets[actualSheet]) {
    throw new Error(`Sheet not found: ${actualSheet}`);
  }
  return XLSX.utils.sheet_to_json(workbook.Sheets[actualSheet], {
    header: 1,
    defval: '',
  });
}

function buildProcedureCatalog(rows) {
  const items = [];
  const exactMap = new Map();
  const actionMap = new Map();

  for (const row of rows.slice(1)) {
    const enabled = normalizeText(row[3]);
    if (enabled && enabled !== '是' && enabled.toLowerCase() !== 'true') continue;
    const procedureName = normalizeText(row[1]);
    if (!procedureName) continue;
    const normalized = normalizeProcessLabel(procedureName);
    const action = normalized.split('：')[0] || normalized;
    const item = {
      procedureCode: normalizeText(row[0]) || null,
      procedureName,
      normalizedName: normalized,
      normalizedAction: action,
      description: normalizeText(row[2]) || null,
      unitPrice: parseNumber(row[4]),
      standardSeconds: parseNumber(row[5]),
      maxSeconds: parseNumber(row[6]),
    };
    items.push(item);
    if (normalized && !exactMap.has(normalized)) exactMap.set(normalized, item);
    if (action && !actionMap.has(action)) actionMap.set(action, item);
  }

  return { items, exactMap, actionMap };
}

function findProcedureMatch(processName, catalog) {
  if (!processName) return null;
  const exact = catalog.exactMap.get(processName);
  if (exact) return { ...exact, matchType: 'exact' };
  const action = processName.split('：')[0] || processName;
  const actionMatch = catalog.actionMap.get(action);
  if (actionMatch) return { ...actionMatch, matchType: 'action' };
  return null;
}

function parseManualRows(rows, catalog) {
  const products = [];
  let currentProduct = null;
  let currentGroup = null;
  let nodeId = 0;

  for (const row of rows.slice(1)) {
    const rootCode = normalizeText(row[0]);
    const rootSection = normalizeText(row[1]);

    if (rootCode) {
      currentProduct = {
        skuCode: rootCode,
        section: rootSection || null,
        skuName: normalizeText(row[4]) || null,
        rootSize: normalizeText(row[5]) || null,
        rootUsageQty: parseNumber(row[6]),
        nodes: [],
        stepsMap: new Map(),
        stack: new Map(),
      };
      currentGroup = rootSection || null;
      products.push(currentProduct);
    } else if (!currentProduct) {
      continue;
    } else if (rootSection) {
      currentGroup = rootSection;
    }

    for (const block of LEVEL_BLOCKS) {
      const name = normalizeText(row[block.name]);
      const code = normalizeText(row[block.code]);
      const size = normalizeText(row[block.size]);
      const qty = parseNumber(row[block.qty]);
      const materialAttr = block.materialAttr === null ? '' : normalizeText(row[block.materialAttr]);
      const processRaw = normalizeText(row[block.process]);
      const processName = normalizeProcessLabel(processRaw);

      if (!name && !code) {
        continue;
      }

      for (const level of Array.from(currentProduct.stack.keys())) {
        if (level >= block.level) currentProduct.stack.delete(level);
      }

      const parentNode = currentProduct.stack.get(block.level - 1) || null;
      const parentName = parentNode ? parentNode.name : currentProduct.skuName;
      const parentCode = parentNode ? parentNode.code : currentProduct.skuCode;

      const node = {
        id: ++nodeId,
        level: block.level,
        code: code || null,
        name: name || null,
        size: size || null,
        usageQty: qty,
        materialAttr: materialAttr || null,
        processRaw: processRaw || null,
        processName: processName || null,
        parentCode: parentCode || null,
        parentName: parentName || null,
        groupLabel: currentGroup,
      };
      currentProduct.nodes.push(node);
      currentProduct.stack.set(block.level, node);

      if (!processName) continue;
      if (!currentProduct.stepsMap.has(processName)) {
        currentProduct.stepsMap.set(processName, {
          stepName: processName,
          sourceProcesses: new Set(),
          firstSeenOrder: node.id,
          catalogMatch: findProcedureMatch(processName, catalog),
          materials: [],
        });
      }
      const step = currentProduct.stepsMap.get(processName);
      step.sourceProcesses.add(processRaw || processName);
      step.materials.push({
        level: node.level,
        code: node.code,
        name: node.name,
        size: node.size,
        usageQty: node.usageQty,
        materialAttr: node.materialAttr,
        parentCode: node.parentCode,
        parentName: node.parentName,
        groupLabel: node.groupLabel,
        specText: node.size,
        processParams: node.materialAttr ? { materialAttr: node.materialAttr } : null,
      });
    }
  }

  return products.map((product) => ({
    skuCode: product.skuCode,
    skuName: product.skuName,
    section: product.section,
    rootSize: product.rootSize,
    rootUsageQty: product.rootUsageQty,
    stepCount: product.stepsMap.size,
    nodeCount: product.nodes.length,
    steps: Array.from(product.stepsMap.values())
      .sort((a, b) => a.firstSeenOrder - b.firstSeenOrder)
      .map((step, index) => ({
        stepOrder: index + 1,
        stepName: step.stepName,
        sourceProcesses: Array.from(step.sourceProcesses),
        catalogMatch: step.catalogMatch,
        materialCount: step.materials.length,
        materials: step.materials,
      })),
  }));
}

function buildSummary(products, catalog) {
  const unmatched = new Map();
  let totalSteps = 0;
  let totalMaterials = 0;

  for (const product of products) {
    totalSteps += product.steps.length;
    for (const step of product.steps) {
      totalMaterials += step.materialCount;
      if (!step.catalogMatch) {
        unmatched.set(step.stepName, (unmatched.get(step.stepName) || 0) + 1);
      }
    }
  }

  return {
    productCount: products.length,
    totalSteps,
    totalMaterials,
    catalogProcedureCount: catalog.items.length,
    unmatchedStepNames: Array.from(unmatched.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([stepName, occurrences]) => ({ stepName, occurrences })),
  };
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function main() {
  const args = parseArgs(process.argv);
  const manual = args.manual;
  const catalog = args.catalog;
  const out = args.out;

  if (!manual || !catalog || !out) {
    console.error('Usage: node normalize-process-manual.js --manual <manual.xlsm> --catalog <summary.xlsx> --out <output.json>');
    process.exit(1);
  }

  const manualRows = readSheetRows(manual);
  const catalogRows = readSheetRows(catalog);
  const procedureCatalog = buildProcedureCatalog(catalogRows);
  const products = parseManualRows(manualRows, procedureCatalog);
  const payload = {
    generatedAt: new Date().toISOString(),
    sourceFiles: {
      manual,
      catalog,
    },
    summary: buildSummary(products, procedureCatalog),
    products,
  };

  ensureDir(out);
  fs.writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${out}`);
  console.log(JSON.stringify(payload.summary, null, 2));
}

module.exports = {
  LEVEL_BLOCKS,
  parseArgs,
  normalizeText,
  normalizeProcessLabel,
  parseNumber,
  readSheetRows,
  buildProcedureCatalog,
  findProcedureMatch,
  parseManualRows,
  buildSummary,
  main,
};

if (require.main === module) {
  main();
}
