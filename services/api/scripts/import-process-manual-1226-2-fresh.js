const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const mysql = require('mysql2/promise');

const TENANT_ID = 10000;
const TARGET_SKU_CODE = 'Z070000004';
const WRONG_SKU_CODE = 'Z460000002';
const SOURCE_FILE = '/Users/kongwen/Desktop/数据初始化/作业工序带定尺木材尺寸-12.26-2.xlsm';
const REPORT_FILE = '/tmp/process-manual-1226-2-fresh-import-report.json';

const STEP_DEFS = [
  {
    stepNo: 1,
    stepName: '开料',
    workstationType: '开料区',
    processKeywords: ['开料'],
    sectionKeywords: ['床头', '床侧', '床尾', '护翼', '床头脚', '木架'],
  },
  {
    stepNo: 2,
    stepName: '钻孔',
    workstationType: '钻孔区',
    processKeywords: ['打孔'],
    sectionKeywords: ['床头', '床侧', '床尾', '床头脚', '护翼'],
  },
  {
    stepNo: 3,
    stepName: '钉打贴棉',
    workstationType: '钉打区',
    processKeywords: ['打爆炸钉', '钉架（使用7级物料）-贴棉', '钉架（使用7级物料）-贴棉', '贴棉', '打魔术贴'],
    sectionKeywords: ['床头', '床侧', '床尾', '护翼', '床头脚', '木架'],
  },
  {
    stepNo: 4,
    stepName: '裁剪车缝',
    workstationType: '裁剪区',
    processKeywords: ['裁剪', '绗缝+围边（使用7级物料）', '车缝'],
    sectionKeywords: ['床头', '床侧', '床尾', '护翼', '床头脚'],
  },
  {
    stepNo: 5,
    stepName: '扪制包装',
    workstationType: '扪制区',
    processKeywords: ['扪制', '包装'],
    sectionKeywords: ['床头', '床侧', '床尾', '护翼', '床头脚', '外购1级包装材料'],
  },
];

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/[（）()]/g, '')
    .replace(/[+＋]/g, '+')
    .trim();
}

function ensureArrayMap(map, key, value) {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(value);
}

function parseManualWorkbook(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  let currentRootCode = '';
  let currentSection = '';
  const records = [];
  const sections = new Map();

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (String(row[0] || '').trim()) currentRootCode = String(row[0]).trim();
    if (String(row[1] || '').trim()) currentSection = String(row[1]).trim();

    const levels = [];
    const pairs = [
      { processCol: 2, nameCol: 4, qtyCol: 6, sizeCol: 5, attrCol: null, codeCol: 3 },
      { processCol: 7, nameCol: 9, qtyCol: 10, sizeCol: 11, attrCol: null, codeCol: 8 },
      { processCol: 12, nameCol: 15, qtyCol: 16, sizeCol: 18, attrCol: 17, codeCol: 13 },
      { processCol: 19, nameCol: 21, qtyCol: 23, sizeCol: 22, attrCol: null, codeCol: 20 },
      { processCol: 24, nameCol: 26, qtyCol: 28, sizeCol: 27, attrCol: null, codeCol: 25 },
      { processCol: 29, nameCol: 31, qtyCol: 33, sizeCol: 32, attrCol: null, codeCol: 30 },
      { processCol: null, nameCol: 36, qtyCol: 37, sizeCol: 38, attrCol: null, codeCol: 35 },
    ];

    pairs.forEach((pair, levelIndex) => {
      const name = String(row[pair.nameCol] || '').trim();
      const process = pair.processCol == null ? '' : String(row[pair.processCol] || '').trim();
      const size = String(row[pair.sizeCol] || '').trim();
      const qtyRaw = row[pair.qtyCol];
      const qty = qtyRaw === '' || qtyRaw == null ? null : Number(qtyRaw);
      const materialAttr = pair.attrCol == null ? '' : String(row[pair.attrCol] || '').trim();
      const sourceCode = String(row[pair.codeCol] || '').trim();
      if (!name && !process) return;
      levels.push({
        level: levelIndex + 1,
        process,
        name,
        normalizedName: normalizeText(name),
        size,
        qty,
        materialAttr,
        sourceCode,
      });
    });

    if (!currentRootCode && !currentSection && levels.length === 0) {
      continue;
    }

    const record = {
      rowIndex,
      rootCode: currentRootCode,
      section: currentSection,
      levels,
    };
    records.push(record);
    ensureArrayMap(sections, currentSection || '未分段', record);
  }

  return { rows, records, sections };
}

async function buildDynamicBomTree(connection, skuId) {
  const bomCache = new Map();
  const visited = new Set();
  const occurrences = [];
  const topLevelNodes = [];

  async function getActiveBomHeader(targetSkuId) {
    if (bomCache.has(`header:${targetSkuId}`)) return bomCache.get(`header:${targetSkuId}`);
    const [rows] = await connection.query(
      `SELECT id, sku_id FROM bom_headers WHERE tenant_id=? AND sku_id=? AND status='active' ORDER BY id DESC LIMIT 1`,
      [TENANT_ID, targetSkuId],
    );
    const header = rows[0] || null;
    bomCache.set(`header:${targetSkuId}`, header);
    return header;
  }

  async function getBomItems(bomId) {
    if (bomCache.has(`items:${bomId}`)) return bomCache.get(`items:${bomId}`);
    const [rows] = await connection.query(
      `SELECT bi.id, bi.parent_item_id, bi.component_sku_id, bi.quantity, bi.scrap_rate, bi.sort_order,
              s.sku_code, s.name, s.spec, s.business_class
         FROM bom_items bi
         JOIN skus s ON s.id = bi.component_sku_id
        WHERE bi.bom_header_id = ?
        ORDER BY COALESCE(bi.sort_order, 0), bi.id`,
      [bomId],
    );
    bomCache.set(`items:${bomId}`, rows);
    return rows;
  }

  async function walkBySku(targetSkuId, multiplier, level, path, topLevelRef = null) {
    const header = await getActiveBomHeader(targetSkuId);
    if (!header) return;
    const visitKey = `${targetSkuId}:${header.id}:${multiplier.toFixed(8)}:${path.join('>')}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);

    const allItems = await getBomItems(header.id);
    const roots = allItems.filter((item) => item.parent_item_id == null);
    for (const root of roots) {
      await walkItem(root, allItems, multiplier, level, path, topLevelRef);
    }
  }

  async function walkItem(item, allItems, parentMultiplier, level, path, inheritedTopLevelRef = null) {
    const quantity = Number(item.quantity || 0);
    const scrapRate = Number(item.scrap_rate || 0);
    const cumulativeQty = parentMultiplier * quantity * (1 + scrapRate);
    const children = allItems.filter((candidate) => String(candidate.parent_item_id) === String(item.id));
    const childHeader = await getActiveBomHeader(item.component_sku_id);
    const currentPath = [...path, item.name];
    const topLevelRef = level === 1
      ? {
        skuId: Number(item.component_sku_id),
        skuCode: item.sku_code,
        name: item.name,
        sortOrder: Number(item.sort_order || 0),
      }
      : inheritedTopLevelRef;
    const isLeaf = children.length === 0 && !childHeader;
    const occurrence = {
      skuId: Number(item.component_sku_id),
      skuCode: item.sku_code,
      name: item.name,
      normalizedName: normalizeText(item.name),
      spec: item.spec,
      level,
      cumulativeQty,
      scrapRate,
      path: currentPath.join(' > '),
      isLeaf,
      isTopLevel: level === 1,
      topLevelSkuId: topLevelRef?.skuId ?? null,
      topLevelSkuCode: topLevelRef?.skuCode ?? null,
      topLevelSkuName: topLevelRef?.name ?? null,
      topLevelSortOrder: topLevelRef?.sortOrder ?? 0,
      hasChildBom: Boolean(childHeader),
    };
    occurrences.push(occurrence);
    if (level === 1) topLevelNodes.push(occurrence);

    if (children.length > 0) {
      for (const child of children) {
        await walkItem(child, allItems, cumulativeQty, level + 1, currentPath, topLevelRef);
      }
      return;
    }

    if (childHeader) {
      await walkBySku(item.component_sku_id, cumulativeQty, level + 1, currentPath, topLevelRef);
    }
  }

  await walkBySku(skuId, 1, 1, []);

  return { occurrences, topLevelNodes };
}

function aggregateOccurrences(occurrences) {
  const map = new Map();
  for (const item of occurrences) {
    const current = map.get(item.skuId) || {
      skuId: item.skuId,
      skuCode: item.skuCode,
      name: item.name,
      spec: item.spec,
      totalQty: 0,
      levels: new Set(),
      paths: [],
      isLeaf: item.isLeaf,
      isTopLevel: item.isTopLevel,
    };
    current.totalQty += Number(item.cumulativeQty || 0);
    current.levels.add(item.level);
    if (current.paths.length < 5) current.paths.push(item.path);
    current.isLeaf = current.isLeaf && item.isLeaf;
    current.isTopLevel = current.isTopLevel || item.isTopLevel;
    map.set(item.skuId, current);
  }
  return [...map.values()].map((item) => ({
    ...item,
    levels: [...item.levels].sort((a, b) => a - b),
  }));
}

function aggregateOccurrencesByTopLevel(occurrences) {
  const map = new Map();
  for (const item of occurrences) {
    const topLevelSkuId = Number(item.topLevelSkuId || 0);
    if (!topLevelSkuId) continue;
    const key = `${topLevelSkuId}:${item.skuId}`;
    const current = map.get(key) || {
      topLevelSkuId,
      topLevelSkuCode: item.topLevelSkuCode,
      topLevelSkuName: item.topLevelSkuName,
      topLevelSortOrder: Number(item.topLevelSortOrder || 0),
      skuId: item.skuId,
      skuCode: item.skuCode,
      name: item.name,
      spec: item.spec,
      totalQty: 0,
      levels: new Set(),
      paths: [],
      isLeaf: item.isLeaf,
      isTopLevel: item.isTopLevel,
      hasChildBom: Boolean(item.hasChildBom),
    };
    current.totalQty += Number(item.cumulativeQty || 0);
    current.levels.add(item.level);
    if (current.paths.length < 5) current.paths.push(item.path);
    current.isLeaf = current.isLeaf && item.isLeaf;
    current.isTopLevel = current.isTopLevel || item.isTopLevel;
    current.hasChildBom = current.hasChildBom || Boolean(item.hasChildBom);
    map.set(key, current);
  }
  return [...map.values()].map((item) => ({
    ...item,
    levels: [...item.levels].sort((a, b) => a - b),
  }));
}

function isSemiFinishedTopLevel(item) {
  if (!item.hasChildBom) return false;
  if (Number(item.totalQty || 0) <= 0) return false;
  return !/配件包|内盒包|32\*16|42\*40|说明书|纸护角|保丽龙|胶带|天盖|地盖/.test(item.name);
}

function belongsToStage(stepNo, item) {
  const code = item.skuCode || '';
  const name = item.name || '';
  if (item.isTopLevel) return false;
  if (stepNo === 1) {
    return item.isLeaf && (/^Z280/.test(code) || /多层板|LVL|排骨条|横管|竖管|下横杆/.test(name));
  }
  if (stepNo === 2) {
    return /\+孔|已打孔/.test(name);
  }
  if (stepNo === 3) {
    return /\+爪钉|框\+侧海绵|海绵|胶水|枪钉|魔术贴/.test(name) || /^Z240/.test(code) || /^SPO/.test(code);
  }
  if (stepNo === 4) {
    return /布套|面布|围布|底布|面海绵/.test(name) || /^FAB/.test(code) || /^Z250/.test(code);
  }
  return false;
}

function buildProcessSteps(topLevelComponents, aggregatedByTopLevel, targetSku) {
  const semiCandidates = topLevelComponents
    .filter((item) => isSemiFinishedTopLevel(item))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const byStepAndTopLevel = new Map();

  const pushStageMaterial = (stepNo, topLevelSkuId, item, options = {}) => {
    if (Number(item.totalQty || 0) <= 0) return;
    const stepKey = `${stepNo}:${topLevelSkuId}`;
    if (!byStepAndTopLevel.has(stepKey)) byStepAndTopLevel.set(stepKey, []);
    const bucket = byStepAndTopLevel.get(stepKey);
    if (bucket.some((existing) => existing.skuId === item.skuId)) return;
    bucket.push({
      skuId: item.skuId,
      skuCode: item.skuCode,
      name: item.name,
      spec: item.spec,
      usagePerUnit: Number(item.totalQty.toFixed(4)),
      lossRate: options.lossRate ?? null,
      consumeTiming: options.consumeTiming ?? 'start',
      isKeyMaterial: Boolean(options.isKeyMaterial),
      specText: item.spec || null,
      processParamsJson: options.processParamsJson || null,
    });
  };

  for (const item of aggregatedByTopLevel) {
    for (const stepNo of [1, 2, 3, 4]) {
      if (!belongsToStage(stepNo, item)) continue;
      pushStageMaterial(stepNo, item.topLevelSkuId, item, {
        isKeyMaterial: stepNo === 1 || /^FAB/.test(item.skuCode || '') || /海绵|胶水/.test(item.name || ''),
        processParamsJson: stepNo === 1
          ? { materialGroup: 'board_or_frame_raw' }
          : stepNo === 2
            ? { materialGroup: 'drill_input' }
            : stepNo === 3
              ? { materialGroup: 'nailing_or_padding' }
              : { materialGroup: 'fabric_or_thread' },
      });
    }
  }

  const resultSteps = [];
  let nextStepNo = 1;

  for (const stage of STEP_DEFS.filter((item) => item.stepNo <= 4)) {
    for (const semi of semiCandidates) {
      const materials = byStepAndTopLevel.get(`${stage.stepNo}:${semi.skuId}`) || [];
      if (materials.length === 0) continue;
      resultSteps.push({
        stepNo: nextStepNo,
        stepName: `${stage.stepName} · ${semi.name}`,
        workstationType: stage.workstationType,
        outputType: 'semi_finished',
        outputSkuId: semi.skuId,
        materials,
      });
      nextStepNo += 1;
    }
  }

  const finalMaterialsMap = new Map();
  const pushFinalMaterial = (item, options = {}) => {
    if (Number(item.totalQty || 0) <= 0) return;
    if (finalMaterialsMap.has(item.skuId)) return;
    finalMaterialsMap.set(item.skuId, {
      skuId: item.skuId,
      skuCode: item.skuCode,
      name: item.name,
      spec: item.spec,
      usagePerUnit: Number(item.totalQty.toFixed(4)),
      lossRate: options.lossRate ?? null,
      consumeTiming: options.consumeTiming ?? 'complete',
      isKeyMaterial: Boolean(options.isKeyMaterial),
      specText: item.spec || null,
      processParamsJson: options.processParamsJson || null,
    });
  };

  for (const semi of semiCandidates) {
    pushFinalMaterial(semi, {
      consumeTiming: 'start',
      isKeyMaterial: true,
      processParamsJson: { materialGroup: 'top_level_semi_finished' },
    });
  }

  for (const item of topLevelComponents) {
    if (semiCandidates.some((semi) => semi.skuId === item.skuId)) continue;
    pushFinalMaterial(item, {
      consumeTiming: 'complete',
      isKeyMaterial: /^CAR/.test(item.skuCode || '') || /^Z470/.test(item.skuCode || ''),
      processParamsJson: { materialGroup: 'top_level_component_or_packaging' },
    });
  }

  resultSteps.push({
    stepNo: nextStepNo,
    stepName: '总装包装 · 成品完成',
    workstationType: '扪制区',
    outputType: 'final_product',
    outputSkuId: Number(targetSku.id),
    materials: [...finalMaterialsMap.values()],
  });

  return { semiCandidates, resultSteps };
}

function buildGuideText(stepDef, parsedManual, outputLabel = '') {
  const matchedSections = [];
  const matchedProcesses = new Set();
  for (const [section, rows] of parsedManual.sections.entries()) {
    if (!stepDef.sectionKeywords.includes(section)) continue;
    const hit = rows.some((record) =>
      record.levels.some((level) =>
        stepDef.processKeywords.some((keyword) => level.process.includes(keyword)),
      ),
    );
    if (!hit) continue;
    matchedSections.push(section);
    rows.forEach((record) => {
      record.levels.forEach((level) => {
        if (stepDef.processKeywords.some((keyword) => level.process.includes(keyword))) {
          matchedProcesses.add(level.process);
        }
      });
    });
  }
  return [
    `来源文件：${path.basename(SOURCE_FILE)}`,
    outputLabel ? `当前工序产出：${outputLabel}` : null,
    `来源工艺：${[...matchedProcesses].join(' / ') || '未直接命中具体工艺列'}`,
    `覆盖段落：${matchedSections.join(' / ') || '未分段'}`,
    '导入策略：基于 FACTORY002 当前 SKU 主数据与活动 BOM 动态引用树重新解析；仅保留高置信命中的步骤投料。',
  ].filter(Boolean).join('\n');
}

async function fetchSku(connection, skuCode) {
  const [rows] = await connection.query(
    `SELECT id, sku_code, name, spec FROM skus WHERE tenant_id=? AND sku_code=? LIMIT 1`,
    [TENANT_ID, skuCode],
  );
  return rows[0] || null;
}

async function cleanupOldTemplates(connection, skuIds) {
  if (!skuIds.length) return [];
  const [templates] = await connection.query(
    `SELECT id, sku_id, name FROM process_templates
      WHERE tenant_id=? AND sku_id IN (${skuIds.map(() => '?').join(',')})
        AND name LIKE '%作业说明书%'`,
    [TENANT_ID, ...skuIds],
  );
  if (!templates.length) return [];
  const templateIds = templates.map((row) => row.id);
  const [steps] = await connection.query(
    `SELECT id FROM process_steps WHERE tenant_id=? AND template_id IN (${templateIds.map(() => '?').join(',')})`,
    [TENANT_ID, ...templateIds],
  );
  const stepIds = steps.map((row) => row.id);
  await connection.query(`DELETE FROM process_step_materials WHERE tenant_id=? AND template_id IN (${templateIds.map(() => '?').join(',')})`, [TENANT_ID, ...templateIds]);
  if (stepIds.length) {
    await connection.query(
      `DELETE FROM process_wages WHERE tenant_id=? AND step_id IN (${stepIds.map(() => '?').join(',')})`,
      [TENANT_ID, ...stepIds],
    );
  }
  await connection.query(`DELETE FROM process_steps WHERE tenant_id=? AND template_id IN (${templateIds.map(() => '?').join(',')})`, [TENANT_ID, ...templateIds]);
  await connection.query(`DELETE FROM process_templates WHERE tenant_id=? AND id IN (${templateIds.map(() => '?').join(',')})`, [TENANT_ID, ...templateIds]);
  return templates;
}

async function main() {
  const connection = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3307,
    user: 'sf_app',
    password: 'TestApp2026!Secure',
    database: 'smart_factory',
  });

  const report = {
    sourceFile: SOURCE_FILE,
    tenantId: TENANT_ID,
    rootCode: null,
    targetSku: null,
    removedTemplates: [],
    stepSummary: [],
    materialSummary: {},
  };

  try {
    const parsedManual = parseManualWorkbook(SOURCE_FILE);
    report.rootCode = parsedManual.records[0]?.rootCode || null;

    const targetSku = await fetchSku(connection, TARGET_SKU_CODE);
    const wrongSku = await fetchSku(connection, WRONG_SKU_CODE);
    if (!targetSku) {
      throw new Error(`未找到目标 SKU: ${TARGET_SKU_CODE}`);
    }
    report.targetSku = targetSku;

    const { occurrences, topLevelNodes } = await buildDynamicBomTree(connection, Number(targetSku.id));
    const aggregated = aggregateOccurrences(occurrences);
    const aggregatedByTopLevel = aggregateOccurrencesByTopLevel(occurrences);
    const topLevelComponents = topLevelNodes
      .filter((item) => Number(item.cumulativeQty || 0) > 0)
      .map((item) => ({
        skuId: Number(item.skuId),
        skuCode: item.skuCode,
        name: item.name,
        spec: item.spec,
        totalQty: Number(item.cumulativeQty || 0),
        sortOrder: Number(item.topLevelSortOrder || 0),
        hasChildBom: Boolean(item.hasChildBom),
      }));
    const { semiCandidates, resultSteps } = buildProcessSteps(topLevelComponents, aggregatedByTopLevel, targetSku);

    await connection.beginTransaction();

    const removed = await cleanupOldTemplates(
      connection,
      [Number(targetSku.id), wrongSku ? Number(wrongSku.id) : null].filter(Boolean),
    );
    report.removedTemplates = removed;

    const [insertTemplate] = await connection.query(
      `INSERT INTO process_templates
       (tenant_id, sku_id, name, status, is_default, template_type, version, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 1, 'standard', '1.0', 0, 0, NOW(3), NOW(3))`,
      [TENANT_ID, targetSku.id, `${targetSku.name}-作业说明书模板`],
    );
    const templateId = insertTemplate.insertId;

    for (const stepDef of resultSteps) {
      const guideText = buildGuideText(
        STEP_DEFS.find((item) => stepDef.stepName.startsWith(item.stepName)) || STEP_DEFS[STEP_DEFS.length - 1],
        parsedManual,
        stepDef.outputType === 'semi_finished'
          ? `${stepDef.stepName.replace(/^.* · /, '')}（半成品）`
          : `${targetSku.name}（成品）`,
      );
      await connection.query(
        `INSERT INTO process_steps
         (tenant_id, template_id, step_no, step_name, standard_hours, max_hours, guide_text, guide_attachment_url, guide_attachment_name, workstation_type, workstation_id, execution_mode, output_type, output_sku_id, created_at)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?, NULL, 'internal', ?, ?, NOW(3))`,
        [
          TENANT_ID,
          templateId,
          stepDef.stepNo,
          stepDef.stepName,
          guideText,
          path.basename(SOURCE_FILE),
          stepDef.workstationType,
          stepDef.outputType,
          stepDef.outputSkuId,
        ],
      );

      const materials = stepDef.materials || [];
      for (const material of materials) {
        await connection.query(
          `INSERT INTO process_step_materials
           (tenant_id, template_id, step_no, input_sku_id, usage_per_unit, loss_rate, consume_timing, is_key_material, spec_text, process_params_json, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NOW(3), NOW(3))`,
          [
            TENANT_ID,
            templateId,
            stepDef.stepNo,
            material.skuId,
            material.usagePerUnit.toFixed(4),
            (material.lossRate ?? 0).toFixed(4),
            material.consumeTiming,
            material.isKeyMaterial ? 1 : 0,
            material.specText ?? null,
            material.processParamsJson ? JSON.stringify(material.processParamsJson) : null,
          ],
        );
      }

      report.stepSummary.push({
        stepNo: stepDef.stepNo,
        stepName: stepDef.stepName,
        workstationType: stepDef.workstationType,
        outputType: stepDef.outputType,
        outputSkuId: stepDef.outputSkuId,
        materialCount: materials.length,
      });
      report.materialSummary[stepDef.stepName] = materials.map((item) => ({
        skuCode: item.skuCode,
        name: item.name,
        usagePerUnit: item.usagePerUnit,
        consumeTiming: item.consumeTiming,
      }));
    }

    report.semiCandidates = semiCandidates.map((item) => ({
      skuId: item.skuId,
      skuCode: item.skuCode,
      name: item.name,
      totalQty: item.totalQty,
    }));

    await connection.commit();
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
