#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const {
  parseArgs,
  readSheetRows,
  buildProcedureCatalog,
  parseManualRows,
  buildSummary,
  normalizeText,
} = require('./normalize-process-manual');

const WORKSTATION_TYPE_BY_ACTION = {
  开料: '开料区',
  打孔: '钻孔区',
  钻孔: '钻孔区',
  打爆炸钉: '钉打区',
  打钉: '钉打区',
  钉打: '钉打区',
  钉贴: '钉打区',
  钉架: '钉打区',
  打魔术贴: '钉打区',
  裁剪: '裁剪区',
  车缝: '车缝区',
  绗缝: '车缝区',
  '绗缝+围边': '车缝区',
  围边: '车缝区',
  贴棉: '贴棉区',
  扪制: '扪制区',
  包装: '包装区',
  清洁: '清洁区',
};

function detectAction(stepName) {
  const raw = normalizeText(stepName);
  return raw.split('：')[0] || raw;
}

function secondsToHours(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Number((numeric / 3600).toFixed(4));
}

function serializeGuideText(step) {
  const groupLabels = Array.from(
    new Set(step.materials.map((material) => material.groupLabel).filter(Boolean)),
  );
  const parts = [];
  if (groupLabels.length > 0) parts.push(`关联部位：${groupLabels.join(' / ')}`);
  if (step.sourceProcesses.length > 0) parts.push(`来源工艺：${step.sourceProcesses.join('，')}`);
  if (step.catalogMatch?.description && step.catalogMatch.description !== '-') {
    parts.push(`工艺说明：${step.catalogMatch.description}`);
  }
  return parts.join('\n') || null;
}

function loadSkuMap(filePath) {
  if (!filePath) return {};
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveRootSku(product, skuByCode, skuByName, targetSkuCode, skuMap) {
  const mappedTargetSkuCode = skuMap[product.skuCode] || skuMap[product.skuName || ''] || null;
  if (mappedTargetSkuCode && skuByCode.has(mappedTargetSkuCode)) {
    return skuByCode.get(mappedTargetSkuCode);
  }
  if (targetSkuCode) {
    return skuByCode.get(targetSkuCode) || null;
  }
  if (product.skuCode && skuByCode.has(product.skuCode)) {
    return skuByCode.get(product.skuCode);
  }
  const nameMatches = skuByName.get(product.skuName || '') || [];
  return nameMatches.length === 1 ? nameMatches[0] : null;
}

function resolveMaterialSku(material, skuByCode, skuByName) {
  if (material.code && skuByCode.has(material.code)) {
    return { sku: skuByCode.get(material.code), matchType: 'code' };
  }
  const name = material.name || '';
  const nameMatches = skuByName.get(name) || [];
  if (nameMatches.length === 1) {
    return { sku: nameMatches[0], matchType: 'name' };
  }
  return {
    sku: null,
    matchType: nameMatches.length > 1 ? 'ambiguous-name' : 'missing',
    candidates: nameMatches.map((item) => ({ id: item.id, skuCode: item.skuCode, name: item.name })),
  };
}

async function loadTenantAndSkus(conn, tenantCode) {
  const [tenants] = await conn.query(
    'SELECT id, code, name FROM tenants WHERE code = ? LIMIT 1',
    [tenantCode],
  );
  if (!tenants.length) throw new Error(`Tenant not found: ${tenantCode}`);
  const tenant = tenants[0];

  const [skuRows] = await conn.query(
    `SELECT id, sku_code AS skuCode, name
       FROM skus
      WHERE tenant_id = ?
        AND status <> 'inactive'`,
    [tenant.id],
  );
  const skuByCode = new Map();
  const skuByName = new Map();
  for (const row of skuRows) {
    skuByCode.set(row.skuCode, row);
    if (!skuByName.has(row.name)) skuByName.set(row.name, []);
    skuByName.get(row.name).push(row);
  }
  return { tenant, skuByCode, skuByName };
}

async function ensureWorkstationTypes(conn, tenantId, names) {
  if (names.length === 0) return;
  const sql = `INSERT INTO workstation_types (tenant_id, name, sort_order)
               VALUES ${names.map(() => '(?, ?, ?)').join(', ')}
               ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)`;
  const params = [];
  names.forEach((name, index) => {
    params.push(tenantId, name, (index + 1) * 10);
  });
  await conn.query(sql, params);
}

async function upsertTemplate(conn, tenantId, skuId, templateName) {
  const [existingRows] = await conn.query(
    `SELECT id
       FROM process_templates
      WHERE tenant_id = ?
        AND sku_id = ?
      ORDER BY is_default DESC, id DESC
      LIMIT 1`,
    [tenantId, skuId],
  );

  await conn.query(
    'UPDATE process_templates SET is_default = 0 WHERE tenant_id = ? AND sku_id = ?',
    [tenantId, skuId],
  );

  if (existingRows.length > 0) {
    const templateId = Number(existingRows[0].id);
    await conn.query(
      `UPDATE process_templates
          SET name = ?, status = 'active', is_default = 1, template_type = 'standard', updated_at = NOW(3)
        WHERE id = ?`,
      [templateName, templateId],
    );
    return templateId;
  }

  const [result] = await conn.query(
    `INSERT INTO process_templates
       (tenant_id, sku_id, name, status, is_default, template_type, version, created_by, updated_by)
     VALUES (?, ?, ?, 'active', 1, 'standard', '1.0', 0, 0)`,
    [tenantId, skuId, templateName],
  );
  return Number(result.insertId);
}

async function clearTemplateDetail(conn, tenantId, templateId) {
  const [steps] = await conn.query(
    'SELECT id FROM process_steps WHERE tenant_id = ? AND template_id = ?',
    [tenantId, templateId],
  );
  const stepIds = steps.map((row) => Number(row.id));
  if (stepIds.length > 0) {
    await conn.query(
      `DELETE FROM process_wages
        WHERE tenant_id = ?
          AND step_id IN (${stepIds.map(() => '?').join(', ')})`,
      [tenantId, ...stepIds],
    );
  }
  await conn.query(
    'DELETE FROM process_step_materials WHERE tenant_id = ? AND template_id = ?',
    [tenantId, templateId],
  );
  await conn.query(
    'DELETE FROM process_steps WHERE tenant_id = ? AND template_id = ?',
    [tenantId, templateId],
  );
}

async function insertTemplateDetail(conn, tenantId, templateId, preparedSteps) {
  const insertedSteps = [];
  for (const step of preparedSteps) {
    const [stepResult] = await conn.query(
      `INSERT INTO process_steps
         (tenant_id, template_id, step_no, step_name, standard_hours, max_hours, guide_text,
          guide_attachment_url, guide_attachment_name, workstation_type, workstation_id, execution_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, 'internal')`,
      [
        tenantId,
        templateId,
        step.stepNo,
        step.stepName,
        step.standardHours,
        step.maxHours,
        step.guideText,
        step.workstationType,
      ],
    );
    insertedSteps.push({
      stepId: Number(stepResult.insertId),
      ...step,
    });
  }

  for (const step of insertedSteps) {
    if (step.unitPrice !== null && Number(step.unitPrice) > 0) {
      await conn.query(
        `INSERT INTO process_wages
           (tenant_id, step_id, worker_grade, unit_price, created_by, updated_by)
         VALUES (?, ?, 'skilled', ?, 0, 0)
         ON DUPLICATE KEY UPDATE unit_price = VALUES(unit_price), updated_by = VALUES(updated_by), updated_at = NOW(3)`,
        [tenantId, step.stepId, Number(step.unitPrice).toFixed(2)],
      );
    }

    if (step.materials.length > 0) {
      const sql = `INSERT INTO process_step_materials
        (tenant_id, template_id, step_no, input_sku_id, usage_per_unit, loss_rate, consume_timing,
         is_key_material, spec_text, process_params_json, created_by, updated_by)
        VALUES ${step.materials.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)').join(', ')}`;
      const params = [];
      step.materials.forEach((material) => {
        params.push(
          tenantId,
          templateId,
          step.stepNo,
          material.inputSkuId,
          Number(material.usagePerUnit ?? 0).toFixed(4),
          Number(material.lossRate ?? 0).toFixed(4),
          material.consumeTiming || 'start',
          material.isKeyMaterial ? 1 : 0,
          material.specText || null,
          material.processParams ? JSON.stringify(material.processParams) : null,
        );
      });
      await conn.query(sql, params);
    }
  }
}

function prepareImportProducts(products, skuByCode, skuByName, targetSkuCode, skuMap) {
  const unresolvedRoots = [];
  const unresolvedMaterials = [];

  const preparedProducts = products.map((product) => {
    const rootSku = resolveRootSku(product, skuByCode, skuByName, targetSkuCode, skuMap);
    if (!rootSku) {
      unresolvedRoots.push({
        sourceSkuCode: product.skuCode,
        sourceSkuName: product.skuName,
      });
      return { ...product, rootSku: null, preparedSteps: [] };
    }

    const preparedSteps = product.steps.map((step) => {
      const action = detectAction(step.stepName);
      const workstationType = WORKSTATION_TYPE_BY_ACTION[action] || action || null;
      const materialRows = [];

      for (const material of step.materials) {
        const resolved = resolveMaterialSku(material, skuByCode, skuByName);
        if (!resolved.sku) {
          unresolvedMaterials.push({
            rootSkuCode: rootSku.skuCode,
            stepName: step.stepName,
            materialName: material.name,
            materialCode: material.code,
            matchType: resolved.matchType,
            candidates: resolved.candidates || [],
          });
          continue;
        }
        materialRows.push({
          inputSkuId: Number(resolved.sku.id),
          usagePerUnit: Number(material.usageQty ?? 0),
          lossRate: 0,
          consumeTiming: 'start',
          isKeyMaterial: Boolean(material.level <= 2),
          specText: material.specText || null,
          processParams: {
            ...(material.processParams || {}),
            ...(material.groupLabel ? { groupLabel: material.groupLabel } : {}),
            sourceLevel: material.level,
            sourceParentName: material.parentName || null,
          },
        });
      }

      const useCatalog = step.catalogMatch || null;
      return {
        stepNo: step.stepOrder,
        stepName: step.stepName,
        workstationType,
        guideText: serializeGuideText(step),
        unitPrice: useCatalog?.unitPrice ?? null,
        standardHours: secondsToHours(useCatalog?.standardSeconds),
        maxHours: secondsToHours(useCatalog?.maxSeconds),
        materials: materialRows,
      };
    });

    return {
      ...product,
      rootSku,
      preparedSteps,
    };
  });

  return { preparedProducts, unresolvedRoots, unresolvedMaterials };
}

async function applyImport(conn, tenantId, preparedProducts) {
  const workstationTypes = Array.from(
    new Set(
      preparedProducts
        .flatMap((product) => product.preparedSteps.map((step) => step.workstationType))
        .filter(Boolean),
    ),
  );
  await ensureWorkstationTypes(conn, tenantId, workstationTypes);

  const applied = [];
  for (const product of preparedProducts) {
    if (!product.rootSku) continue;
    const templateName = `${product.rootSku.name}-作业说明书模板`;
    const templateId = await upsertTemplate(conn, tenantId, Number(product.rootSku.id), templateName);
    await clearTemplateDetail(conn, tenantId, templateId);
    await insertTemplateDetail(conn, tenantId, templateId, product.preparedSteps);
    applied.push({
      templateId,
      skuId: Number(product.rootSku.id),
      skuCode: product.rootSku.skuCode,
      skuName: product.rootSku.name,
      stepCount: product.preparedSteps.length,
      materialCount: product.preparedSteps.reduce((sum, step) => sum + step.materials.length, 0),
    });
  }
  return applied;
}

function buildResult(normalized, preparedProducts, unresolvedRoots, unresolvedMaterials, dryRun, applied) {
  return {
    generatedAt: new Date().toISOString(),
    dryRun,
    normalizedSummary: buildSummary(normalized.products, normalized.catalog),
    resolvedProducts: preparedProducts
      .filter((product) => product.rootSku)
      .map((product) => ({
        sourceSkuCode: product.skuCode,
        sourceSkuName: product.skuName,
        targetSkuCode: product.rootSku.skuCode,
        targetSkuName: product.rootSku.name,
        stepCount: product.preparedSteps.length,
        resolvedMaterialCount: product.preparedSteps.reduce((sum, step) => sum + step.materials.length, 0),
      })),
    unresolvedRoots,
    unresolvedMaterials,
    applied: applied || [],
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const manual = args.manual;
  const catalog = args.catalog;
  const tenantCode = args['tenant-code'];
  const out = args.out || '/tmp/process-manual-import-report.json';
  const targetSkuCode = args['target-sku-code'] || null;
  const skuMapPath = args['sku-map'] || null;
  const apply = Boolean(args.apply);

  if (!manual || !catalog || !tenantCode) {
    console.error('Usage: node import-process-manual.js --tenant-code FACTORY002 --manual <file.xlsm> --catalog <summary.xlsx> [--target-sku-code Zxxxx] [--sku-map /tmp/sku-map.json] [--apply] [--out /tmp/report.json]');
    process.exit(1);
  }

  const manualRows = readSheetRows(manual);
  const catalogRows = readSheetRows(catalog);
  const catalogInfo = buildProcedureCatalog(catalogRows);
  const products = parseManualRows(manualRows, catalogInfo);
  const normalized = { products, catalog: catalogInfo };
  const skuMap = loadSkuMap(skuMapPath);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3307),
    user: process.env.DB_USER || 'sf_app',
    password: process.env.DB_PASS || 'TestApp2026!Secure',
    database: process.env.DB_NAME || 'smart_factory',
    charset: 'utf8mb4',
  });

  try {
    const { tenant, skuByCode, skuByName } = await loadTenantAndSkus(connection, tenantCode);
    const { preparedProducts, unresolvedRoots, unresolvedMaterials } = prepareImportProducts(
      products,
      skuByCode,
      skuByName,
      targetSkuCode,
      skuMap,
    );

    let applied = [];
    if (apply) {
      await connection.beginTransaction();
      try {
        applied = await applyImport(connection, Number(tenant.id), preparedProducts);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }

    const result = buildResult(normalized, preparedProducts, unresolvedRoots, unresolvedMaterials, !apply, applied);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(`Wrote ${out}`);
    console.log(JSON.stringify({
      tenantCode,
      dryRun: !apply,
      resolvedProducts: result.resolvedProducts.length,
      unresolvedRoots: unresolvedRoots.length,
      unresolvedMaterials: unresolvedMaterials.length,
      appliedTemplates: applied.length,
    }, null, 2));
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
