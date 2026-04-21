#!/usr/bin/env node

const { execFileSync } = require('child_process');

const TENANT_ID = 1;
const ACTOR_ID = 5;
const DEFAULT_WAREHOUSE_ID = 1;
const DEFAULT_LOCATION_ID = 1;
const MYSQL_ARGS = [
  'exec',
  '-i',
  'sf_mysql',
  'mysql',
  '--default-character-set=utf8mb4',
  '-N',
  '-B',
  '-uroot',
  "-pTestRoot2026!Secure",
  'smart_factory',
];

function mysql(sql) {
  return execFileSync('docker', [...MYSQL_ARGS, '-e', sql], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function escapeSql(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function scalar(sql) {
  const out = mysql(sql);
  if (!out) return null;
  return out.split('\n')[0].split('\t')[0];
}

function row(sql) {
  const out = mysql(sql);
  if (!out) return null;
  return out.split('\n')[0].split('\t');
}

function ensureCategory({ code, name, level, parentId, remark = null }) {
  const existing = scalar(
    `SELECT id FROM sku_categories WHERE tenant_id=${TENANT_ID} AND code=${escapeSql(code)} LIMIT 1`,
  );
  if (existing) return Number(existing);
  mysql(
    `INSERT INTO sku_categories (tenant_id, level, parent_id, code, name, sort_order, is_active, created_by, updated_by, remark)
     VALUES (${TENANT_ID}, ${level}, ${parentId ?? 'NULL'}, ${escapeSql(code)}, ${escapeSql(name)}, 0, 1, ${ACTOR_ID}, ${ACTOR_ID}, ${escapeSql(remark)})`,
  );
  return Number(
    scalar(`SELECT id FROM sku_categories WHERE tenant_id=${TENANT_ID} AND code=${escapeSql(code)} LIMIT 1`),
  );
}

function ensureCustomer({ code, name }) {
  const existing = scalar(
    `SELECT id FROM customers WHERE tenant_id=${TENANT_ID} AND code=${escapeSql(code)} LIMIT 1`,
  );
  if (existing) return Number(existing);
  mysql(
    `INSERT INTO customers (tenant_id, code, name, status, contact, phone, address, region, email, grade, credit_limit, payment_days, notes, created_by, updated_by)
     VALUES (${TENANT_ID}, ${escapeSql(code)}, ${escapeSql(name)}, 'active', ${escapeSql('模拟销售客户')}, ${escapeSql('13800000000')}, ${escapeSql('模拟地址')}, ${escapeSql('华东')}, NULL, 'A', 500000, 30, ${escapeSql('FACTORY001 成品床全链路验证客户')}, ${ACTOR_ID}, ${ACTOR_ID})`,
  );
  return Number(
    scalar(`SELECT id FROM customers WHERE tenant_id=${TENANT_ID} AND code=${escapeSql(code)} LIMIT 1`),
  );
}

function ensureWorkstationType(name) {
  const existing = scalar(
    `SELECT id FROM workstation_types WHERE tenant_id=${TENANT_ID} AND name=${escapeSql(name)} LIMIT 1`,
  );
  if (existing) return Number(existing);
  mysql(
    `INSERT INTO workstation_types (tenant_id, name, sort_order) VALUES (${TENANT_ID}, ${escapeSql(name)}, 0)`,
  );
  return Number(
    scalar(`SELECT id FROM workstation_types WHERE tenant_id=${TENANT_ID} AND name=${escapeSql(name)} LIMIT 1`),
  );
}

function ensureWorkstation({ name, type, capacity = 500 }) {
  const existing = scalar(
    `SELECT id FROM workstations WHERE tenant_id=${TENANT_ID} AND name=${escapeSql(name)} LIMIT 1`,
  );
  if (existing) return Number(existing);
  mysql(
    `INSERT INTO workstations (tenant_id, name, type, capacity, status)
     VALUES (${TENANT_ID}, ${escapeSql(name)}, ${escapeSql(type)}, ${capacity}, 'active')`,
  );
  return Number(
    scalar(`SELECT id FROM workstations WHERE tenant_id=${TENANT_ID} AND name=${escapeSql(name)} LIMIT 1`),
  );
}

function ensureSku(sku) {
  const existing = scalar(
    `SELECT id FROM skus WHERE tenant_id=${TENANT_ID} AND sku_code=${escapeSql(sku.code)} LIMIT 1`,
  );
  if (existing) return Number(existing);
  mysql(
    `INSERT INTO skus (
       tenant_id, sku_code, name, spec, category1_id, category2_id,
       stock_unit, purchase_unit, production_unit,
       brand_scope, stock_conv_factor, production_conv_factor, prod_conv_note,
       has_dye_lot, use_fifo, safety_stock, status, description,
       created_by, updated_by, business_class, control_mode,
       allow_bom_component, allow_purchase, allow_inventory, allow_production_issue,
       requires_asset_acceptance, default_warehouse_type, approval_policy_code, asset_tracking_mode
     ) VALUES (
       ${TENANT_ID}, ${escapeSql(sku.code)}, ${escapeSql(sku.name)}, ${escapeSql(sku.spec ?? null)}, ${sku.category1Id}, ${sku.category2Id},
       ${escapeSql(sku.stockUnit)}, ${escapeSql(sku.purchaseUnit)}, ${escapeSql(sku.productionUnit)},
       'factory', 1.0000, NULL, NULL,
       0, 1, ${Number(sku.safetyStock ?? 0).toFixed(4)}, 'active', ${escapeSql(sku.description ?? null)},
       ${ACTOR_ID}, ${ACTOR_ID}, ${escapeSql(sku.businessClass)}, ${escapeSql(sku.controlMode)},
       ${sku.allowBomComponent ? 1 : 0}, ${sku.allowPurchase ? 1 : 0}, ${sku.allowInventory ? 1 : 0}, ${sku.allowProductionIssue ? 1 : 0},
       0, ${escapeSql(sku.defaultWarehouseType ?? null)}, NULL, 'none'
     )`,
  );
  return Number(
    scalar(`SELECT id FROM skus WHERE tenant_id=${TENANT_ID} AND sku_code=${escapeSql(sku.code)} LIMIT 1`),
  );
}

function ensureInventory(skuId, qty, unit, notes) {
  const existing = scalar(
    `SELECT id FROM inventory WHERE tenant_id=${TENANT_ID} AND sku_id=${skuId} AND warehouse_id=${DEFAULT_WAREHOUSE_ID} AND location_id=${DEFAULT_LOCATION_ID} LIMIT 1`,
  );
  if (existing) {
    mysql(
      `UPDATE inventory
       SET qty_on_hand=${Number(qty).toFixed(4)}, qty_reserved=0, qty_in_transit=0, updated_by=${ACTOR_ID}
       WHERE id=${existing}`,
    );
  } else {
    mysql(
      `INSERT INTO inventory (
         tenant_id, sku_id, warehouse_id, location_id,
         qty_on_hand, qty_reserved, qty_in_transit, source_ref, updated_by
       ) VALUES (
         ${TENANT_ID}, ${skuId}, ${DEFAULT_WAREHOUSE_ID}, ${DEFAULT_LOCATION_ID},
         ${Number(qty).toFixed(4)}, 0, 0, ${escapeSql('seed:factory001-bed-scenario')}, ${ACTOR_ID}
       )`,
    );
  }

  mysql(
    `INSERT INTO inventory_transactions (
       tenant_id, transaction_no, sku_id, business_class, warehouse_id, location_id,
       transaction_type, direction, qty_input, input_unit, qty_stock_unit, stock_unit,
       reference_type, reference_id, reference_no, source_ref, production_order_id,
       is_cross_dye_lot, batch_cost, notes, created_by, updated_by
     )
     SELECT
       ${TENANT_ID},
       CONCAT('INIT-SIMBED-', LPAD(FLOOR(RAND() * 1000000), 6, '0')),
       ${skuId},
       business_class,
       ${DEFAULT_WAREHOUSE_ID},
       ${DEFAULT_LOCATION_ID},
       'excel_init',
       'in',
       ${Number(qty).toFixed(4)},
       ${escapeSql(unit)},
       ${Number(qty).toFixed(4)},
       ${escapeSql(unit)},
       'seed',
       NULL,
       NULL,
       ${escapeSql('seed:factory001-bed-scenario')},
       NULL,
       0,
       NULL,
       ${escapeSql(notes || 'FACTORY001 床产品场景初始化库存')},
       ${ACTOR_ID},
       ${ACTOR_ID}
     FROM skus WHERE id=${skuId} LIMIT 1`,
  );
}

function createBom(skuId, version, description, items) {
  mysql(`DELETE FROM bom_items WHERE tenant_id=${TENANT_ID} AND bom_header_id IN (SELECT id FROM bom_headers WHERE tenant_id=${TENANT_ID} AND sku_id=${skuId})`);
  mysql(`DELETE FROM bom_headers WHERE tenant_id=${TENANT_ID} AND sku_id=${skuId}`);
  mysql(
    `INSERT INTO bom_headers (tenant_id, sku_id, version, status, description, is_active, created_by, updated_by)
     VALUES (${TENANT_ID}, ${skuId}, ${escapeSql(version)}, 'active', ${escapeSql(description)}, 1, ${ACTOR_ID}, ${ACTOR_ID})`,
  );
  const bomHeaderId = Number(
    scalar(`SELECT id FROM bom_headers WHERE tenant_id=${TENANT_ID} AND sku_id=${skuId} ORDER BY id DESC LIMIT 1`),
  );
  items.forEach((item, index) => {
    mysql(
      `INSERT INTO bom_items (
         tenant_id, bom_header_id, parent_item_id, component_sku_id, material_sku_id,
         quantity, qty_per_unit, unit, level, scrap_rate, sort_order, notes, created_by, updated_by
       ) VALUES (
         ${TENANT_ID}, ${bomHeaderId}, NULL, ${item.componentSkuId}, ${item.componentSkuId},
         ${Number(item.qty).toFixed(6)}, ${Number(item.qty).toFixed(6)}, ${escapeSql(item.unit)},
         1, ${Number(item.scrapRate ?? 0).toFixed(4)}, ${index + 1}, ${escapeSql(item.notes ?? null)}, ${ACTOR_ID}, ${ACTOR_ID}
       )`,
    );
  });
  return bomHeaderId;
}

function createTemplate({ skuId, name, version = '1.0', steps }) {
  mysql(`DELETE FROM process_step_materials WHERE tenant_id=${TENANT_ID} AND template_id IN (SELECT id FROM process_templates WHERE tenant_id=${TENANT_ID} AND sku_id=${skuId})`);
  mysql(`DELETE FROM process_wages WHERE tenant_id=${TENANT_ID} AND step_id IN (
    SELECT id FROM process_steps WHERE tenant_id=${TENANT_ID} AND template_id IN (
      SELECT id FROM process_templates WHERE tenant_id=${TENANT_ID} AND sku_id=${skuId}
    )
  )`);
  mysql(`DELETE FROM process_steps WHERE tenant_id=${TENANT_ID} AND template_id IN (SELECT id FROM process_templates WHERE tenant_id=${TENANT_ID} AND sku_id=${skuId})`);
  mysql(`DELETE FROM process_templates WHERE tenant_id=${TENANT_ID} AND sku_id=${skuId}`);
  mysql(
    `INSERT INTO process_templates (
       tenant_id, sku_id, name, status, is_default, template_type, version, created_by, updated_by
     ) VALUES (
       ${TENANT_ID}, ${skuId}, ${escapeSql(name)}, 'active', 1, 'standard', ${escapeSql(version)}, ${ACTOR_ID}, ${ACTOR_ID}
     )`,
  );
  const templateId = Number(
    scalar(`SELECT id FROM process_templates WHERE tenant_id=${TENANT_ID} AND sku_id=${skuId} ORDER BY id DESC LIMIT 1`),
  );
  steps.forEach((step) => {
    mysql(
      `INSERT INTO process_steps (
         tenant_id, template_id, step_no, step_name, standard_hours, max_hours,
         guide_text, guide_attachment_url, guide_attachment_name,
         workstation_type, workstation_id, created_by, updated_by,
         output_type, output_sku_id, predecessor_step_nos_json, route_group_key, route_level, execution_mode
       ) VALUES (
         ${TENANT_ID}, ${templateId}, ${step.stepNo}, ${escapeSql(step.stepName)},
         ${Number(step.standardHours).toFixed(4)}, ${Number(step.maxHours ?? step.standardHours).toFixed(2)},
         ${escapeSql(step.guideText ?? null)}, NULL, NULL,
         ${escapeSql(step.workstationType ?? null)}, ${step.workstationId ?? 'NULL'}, ${ACTOR_ID}, ${ACTOR_ID},
         ${escapeSql(step.outputType)}, ${step.outputSkuId ?? 'NULL'},
         ${step.predecessorStepNos && step.predecessorStepNos.length > 0 ? escapeSql(JSON.stringify(step.predecessorStepNos)) : 'NULL'},
         ${escapeSql(step.routeGroupKey ?? null)}, ${step.routeLevel ?? 'NULL'}, ${escapeSql(step.executionMode ?? 'internal')}
       )`,
    );
    if (Array.isArray(step.stepMaterials) && step.stepMaterials.length > 0) {
      step.stepMaterials.forEach((material) => {
        mysql(
          `INSERT INTO process_step_materials (
             tenant_id, template_id, step_no, input_sku_id, usage_per_unit, loss_rate,
             consume_timing, is_key_material, spec_text, process_params_json, created_by, updated_by
           ) VALUES (
             ${TENANT_ID}, ${templateId}, ${step.stepNo}, ${material.inputSkuId},
             ${Number(material.usagePerUnit).toFixed(4)}, ${Number(material.lossRate ?? 0).toFixed(4)},
             ${escapeSql(material.consumeTiming ?? 'start')}, ${material.isKeyMaterial ? 1 : 0},
             ${escapeSql(material.specText ?? null)}, ${material.processParamsJson ? escapeSql(JSON.stringify(material.processParamsJson)) : 'NULL'},
             ${ACTOR_ID}, ${ACTOR_ID}
           )`,
        );
      });
    }
  });
  return templateId;
}

function cleanupScenario() {
  const customerId = scalar(
    `SELECT id FROM customers WHERE tenant_id=${TENANT_ID} AND code='SIMBED-CUST-01' LIMIT 1`,
  );
  const salesOrderIds = customerId
    ? mysql(
        `SELECT id
           FROM sales_orders
          WHERE tenant_id=${TENANT_ID}
            AND (
              customer_id=${customerId}
              OR notes LIKE 'FACTORY001 %UI %'
              OR notes LIKE 'FACTORY001 模拟床%'
            )`,
      )
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map(Number)
    : mysql(
        `SELECT id
           FROM sales_orders
          WHERE tenant_id=${TENANT_ID}
            AND (notes LIKE 'FACTORY001 %UI %' OR notes LIKE 'FACTORY001 模拟床%')`,
      )
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map(Number);
  const salesOrderIdList = salesOrderIds.length > 0 ? salesOrderIds.join(',') : null;
  const productionOrderIds = salesOrderIdList
    ? mysql(
        `SELECT id FROM production_orders WHERE tenant_id=${TENANT_ID} AND sales_order_id IN (${salesOrderIdList})`,
      )
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map(Number)
    : [];
  const productionOrderIdList = productionOrderIds.length > 0 ? productionOrderIds.join(',') : null;
  const inspectionIds = productionOrderIdList
    ? mysql(
        `SELECT id FROM inspection_records WHERE tenant_id=${TENANT_ID} AND production_order_id IN (${productionOrderIdList})`,
      )
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map(Number)
    : [];
  const inspectionIdList = inspectionIds.length > 0 ? inspectionIds.join(',') : null;
  const skuIds = mysql(
    `SELECT id FROM skus WHERE tenant_id=${TENANT_ID} AND sku_code LIKE 'SIMBED-%'`,
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(Number);
  const skuIdList = skuIds.length > 0 ? skuIds.join(',') : null;
  const templateIds = mysql(
    `SELECT id FROM process_templates
      WHERE tenant_id=${TENANT_ID}
        AND (
          sku_id IN (SELECT id FROM skus WHERE tenant_id=${TENANT_ID} AND sku_code LIKE 'SIMBED-%')
          OR name LIKE '模拟床-%'
        )`,
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(Number);
  const templateIdList = templateIds.length > 0 ? templateIds.join(',') : null;

  if (inspectionIdList) {
    mysql(`DELETE FROM quality_issues WHERE tenant_id=${TENANT_ID} AND inspection_id IN (${inspectionIdList})`);
    mysql(`DELETE FROM inspection_records WHERE tenant_id=${TENANT_ID} AND id IN (${inspectionIdList})`);
  }

  if (productionOrderIdList) {
    mysql(`DELETE FROM task_material_transactions WHERE tenant_id=${TENANT_ID} AND task_id IN (SELECT id FROM production_tasks WHERE tenant_id=${TENANT_ID} AND production_order_id IN (${productionOrderIdList}))`);
    mysql(`DELETE FROM production_tasks WHERE tenant_id=${TENANT_ID} AND production_order_id IN (${productionOrderIdList})`);
    mysql(`DELETE FROM production_operation_dependencies WHERE tenant_id=${TENANT_ID} AND operation_id IN (SELECT id FROM production_operations WHERE tenant_id=${TENANT_ID} AND production_order_id IN (${productionOrderIdList}))`);
    mysql(`DELETE FROM production_operations WHERE tenant_id=${TENANT_ID} AND production_order_id IN (${productionOrderIdList})`);
    mysql(`DELETE FROM production_schedules WHERE tenant_id=${TENANT_ID} AND production_order_id IN (${productionOrderIdList})`);
    mysql(`DELETE FROM production_order_components WHERE tenant_id=${TENANT_ID} AND production_order_id IN (${productionOrderIdList})`);
    mysql(`DELETE FROM production_order_sku_resolutions WHERE tenant_id=${TENANT_ID} AND production_order_id IN (${productionOrderIdList})`);
    mysql(`DELETE FROM material_requirements WHERE tenant_id=${TENANT_ID} AND production_order_id IN (${productionOrderIdList})`);
    mysql(`DELETE FROM production_orders WHERE tenant_id=${TENANT_ID} AND id IN (${productionOrderIdList})`);
  }

  if (salesOrderIdList) {
    mysql(`DELETE FROM sales_order_items WHERE tenant_id=${TENANT_ID} AND order_id IN (${salesOrderIdList})`);
    mysql(`DELETE FROM sales_orders WHERE tenant_id=${TENANT_ID} AND id IN (${salesOrderIdList})`);
  }

  if (templateIdList) {
    mysql(`DELETE FROM process_step_materials WHERE tenant_id=${TENANT_ID} AND template_id IN (${templateIdList})`);
    mysql(`DELETE FROM process_wages WHERE tenant_id=${TENANT_ID} AND step_id IN (
      SELECT id FROM process_steps WHERE tenant_id=${TENANT_ID} AND template_id IN (${templateIdList})
    )`);
    mysql(`DELETE FROM process_steps WHERE tenant_id=${TENANT_ID} AND template_id IN (${templateIdList})`);
    mysql(`DELETE FROM process_templates WHERE tenant_id=${TENANT_ID} AND id IN (${templateIdList})`);
  }

  if (skuIdList) {
    mysql(`DELETE FROM bom_items WHERE tenant_id=${TENANT_ID} AND bom_header_id IN (SELECT id FROM bom_headers WHERE tenant_id=${TENANT_ID} AND sku_id IN (${skuIdList}))`);
    mysql(`DELETE FROM bom_headers WHERE tenant_id=${TENANT_ID} AND sku_id IN (${skuIdList})`);
    mysql(`DELETE FROM inventory_transactions WHERE tenant_id=${TENANT_ID} AND sku_id IN (${skuIdList}) AND source_ref='seed:factory001-bed-scenario'`);
    mysql(`DELETE FROM inventory WHERE tenant_id=${TENANT_ID} AND sku_id IN (${skuIdList})`);
    mysql(`DELETE FROM skus WHERE tenant_id=${TENANT_ID} AND id IN (${skuIdList})`);
  }

  mysql(`DELETE FROM customers WHERE tenant_id=${TENANT_ID} AND code LIKE 'SIMBED-%'`);
  mysql(`DELETE FROM workstations WHERE tenant_id=${TENANT_ID} AND name LIKE 'SIMBED-%'`);
  mysql(`DELETE FROM workstation_types WHERE tenant_id=${TENANT_ID} AND name LIKE 'SIMBED-%'`);
  mysql(`DELETE FROM sku_categories WHERE tenant_id=${TENANT_ID} AND code IN ('SIMBED_FIN','SIMBED_SEMI','SIMBED_PACK')`);
}

function seedScenario() {
  cleanupScenario();

  const semiCat = ensureCategory({
    code: 'SIMBED_SEMI',
    name: '模拟床半成品',
    level: 2,
    parentId: 2,
    remark: 'FACTORY001 床产品验证半成品类目',
  });
  const finishedCat = ensureCategory({
    code: 'SIMBED_FIN',
    name: '模拟床成品',
    level: 2,
    parentId: 3,
    remark: 'FACTORY001 床产品验证成品类目',
  });
  const packCat = ensureCategory({
    code: 'SIMBED_PACK',
    name: '模拟床包材',
    level: 2,
    parentId: 4,
    remark: 'FACTORY001 床产品验证包材类目',
  });

  ensureCustomer({ code: 'SIMBED-CUST-01', name: '模拟床验证客户' });

  ensureWorkstationType('SIMBED-开料');
  ensureWorkstationType('SIMBED-钻孔');
  ensureWorkstationType('SIMBED-预埋');
  ensureWorkstationType('SIMBED-组装');
  ensureWorkstationType('SIMBED-包装');

  const stations = {
    cutting: ensureWorkstation({ name: 'SIMBED-开料站', type: 'cutting' }),
    drilling: ensureWorkstation({ name: 'SIMBED-钻孔站', type: 'drilling' }),
    embedding: ensureWorkstation({ name: 'SIMBED-预埋站', type: 'embedding' }),
    assembly: ensureWorkstation({ name: 'SIMBED-组装站', type: 'assembly' }),
    packaging: ensureWorkstation({ name: 'SIMBED-包装站', type: 'packaging' }),
  };

  const skus = {};

  const skuDefs = [
    { key: 'fgBed', code: 'SIMBED-FG-01', name: '模拟床-成品床', category1Id: 3, category2Id: finishedCat, stockUnit: '张', purchaseUnit: '张', productionUnit: '张', businessClass: 'finished_goods', controlMode: 'stock_only', allowBomComponent: false, allowPurchase: false, allowInventory: true, allowProductionIssue: false, defaultWarehouseType: 'finished' },
    { key: 'sfHead', code: 'SIMBED-SF-HEAD', name: '模拟床-床头', category1Id: 2, category2Id: semiCat, stockUnit: '件', purchaseUnit: '件', productionUnit: '件', businessClass: 'production_material', controlMode: 'mrp', allowBomComponent: true, allowPurchase: false, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'semi_finished' },
    { key: 'sfSide', code: 'SIMBED-SF-SIDE', name: '模拟床-床侧', category1Id: 2, category2Id: semiCat, stockUnit: '件', purchaseUnit: '件', productionUnit: '件', businessClass: 'production_material', controlMode: 'mrp', allowBomComponent: true, allowPurchase: false, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'semi_finished' },
    { key: 'sfEnd', code: 'SIMBED-SF-END', name: '模拟床-床尾', category1Id: 2, category2Id: semiCat, stockUnit: '件', purchaseUnit: '件', productionUnit: '件', businessClass: 'production_material', controlMode: 'mrp', allowBomComponent: true, allowPurchase: false, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'semi_finished' },
    { key: 'sfWing', code: 'SIMBED-SF-WING', name: '模拟床-护翼', category1Id: 2, category2Id: semiCat, stockUnit: '件', purchaseUnit: '件', productionUnit: '件', businessClass: 'production_material', controlMode: 'mrp', allowBomComponent: true, allowPurchase: false, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'semi_finished' },
    { key: 'sfSlat', code: 'SIMBED-SF-SLAT', name: '模拟床-排骨条组', category1Id: 2, category2Id: semiCat, stockUnit: '组', purchaseUnit: '组', productionUnit: '组', businessClass: 'production_material', controlMode: 'mrp', allowBomComponent: true, allowPurchase: false, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'semi_finished' },
    { key: 'sfHeadTop', code: 'SIMBED-SF-H-TOP', name: '模拟床-床头顶板', category1Id: 2, category2Id: semiCat, stockUnit: '件', purchaseUnit: '件', productionUnit: '件', businessClass: 'production_material', controlMode: 'mrp', allowBomComponent: true, allowPurchase: false, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'semi_finished' },
    { key: 'sfHeadBeam', code: 'SIMBED-SF-H-BEAM', name: '模拟床-床头下梁', category1Id: 2, category2Id: semiCat, stockUnit: '件', purchaseUnit: '件', productionUnit: '件', businessClass: 'production_material', controlMode: 'mrp', allowBomComponent: true, allowPurchase: false, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'semi_finished' },
    { key: 'sfHeadPanel', code: 'SIMBED-SF-H-PANEL', name: '模拟床-床头面板', category1Id: 2, category2Id: semiCat, stockUnit: '件', purchaseUnit: '件', productionUnit: '件', businessClass: 'production_material', controlMode: 'mrp', allowBomComponent: true, allowPurchase: false, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'semi_finished' },
    { key: 'sfHeadPost', code: 'SIMBED-SF-H-POST', name: '模拟床-床头立柱', category1Id: 2, category2Id: semiCat, stockUnit: '件', purchaseUnit: '件', productionUnit: '件', businessClass: 'production_material', controlMode: 'mrp', allowBomComponent: true, allowPurchase: false, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'semi_finished' },

    { key: 'rmTopBoard', code: 'SIMBED-RM-TOPBOARD', name: '模拟床-顶板原板', category1Id: 1, category2Id: 14, stockUnit: '张', purchaseUnit: '张', productionUnit: '张', businessClass: 'production_material', controlMode: 'mrp', allowBomComponent: true, allowPurchase: true, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'raw_material' },
    { key: 'rmBeamBoard', code: 'SIMBED-RM-BEAMBOARD', name: '模拟床-下梁原板', category1Id: 1, category2Id: 14, stockUnit: '张', purchaseUnit: '张', productionUnit: '张', businessClass: 'production_material', controlMode: 'mrp', allowBomComponent: true, allowPurchase: true, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'raw_material' },
    { key: 'rmPanelBoard', code: 'SIMBED-RM-PANELBOARD', name: '模拟床-面板原板', category1Id: 1, category2Id: 14, stockUnit: '张', purchaseUnit: '张', productionUnit: '张', businessClass: 'production_material', controlMode: 'mrp', allowBomComponent: true, allowPurchase: true, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'raw_material' },
    { key: 'rmHeadPostBoard', code: 'SIMBED-RM-HPOSTBOARD', name: '模拟床-立柱原板', category1Id: 1, category2Id: 14, stockUnit: '张', purchaseUnit: '张', productionUnit: '张', businessClass: 'production_material', controlMode: 'mrp', allowBomComponent: true, allowPurchase: true, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'raw_material' },
    { key: 'rmSideBoard', code: 'SIMBED-RM-SIDEBOARD', name: '模拟床-床侧原板', category1Id: 1, category2Id: 14, stockUnit: '张', purchaseUnit: '张', productionUnit: '张', businessClass: 'production_material', controlMode: 'mrp', allowBomComponent: true, allowPurchase: true, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'raw_material' },
    { key: 'rmEndBoard', code: 'SIMBED-RM-ENDBOARD', name: '模拟床-床尾原板', category1Id: 1, category2Id: 14, stockUnit: '张', purchaseUnit: '张', productionUnit: '张', businessClass: 'production_material', controlMode: 'mrp', allowBomComponent: true, allowPurchase: true, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'raw_material' },
    { key: 'rmWingBoard', code: 'SIMBED-RM-WINGBOARD', name: '模拟床-护翼原板', category1Id: 1, category2Id: 14, stockUnit: '张', purchaseUnit: '张', productionUnit: '张', businessClass: 'production_material', controlMode: 'mrp', allowBomComponent: true, allowPurchase: true, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'raw_material' },
    { key: 'rmSlatBoard', code: 'SIMBED-RM-SLATBOARD', name: '模拟床-排骨条原板', category1Id: 1, category2Id: 14, stockUnit: '张', purchaseUnit: '张', productionUnit: '张', businessClass: 'production_material', controlMode: 'mrp', allowBomComponent: true, allowPurchase: true, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'raw_material' },
    { key: 'rmEmbedPart', code: 'SIMBED-RM-EMBED', name: '模拟床-预埋件', category1Id: 1, category2Id: 15, stockUnit: '个', purchaseUnit: '个', productionUnit: '个', businessClass: 'production_material', controlMode: 'mrp', allowBomComponent: true, allowPurchase: true, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'raw_material' },
    { key: 'rmFoam', code: 'SIMBED-RM-FOAM', name: '模拟床-泡沫', category1Id: 1, category2Id: 7, stockUnit: '件', purchaseUnit: '件', productionUnit: '件', businessClass: 'production_material', controlMode: 'mrp', allowBomComponent: true, allowPurchase: true, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'raw_material' },
    { key: 'pkCarton', code: 'SIMBED-PK-CARTON', name: '模拟床-纸箱', category1Id: 4, category2Id: packCat, stockUnit: '个', purchaseUnit: '个', productionUnit: '个', businessClass: 'production_material', controlMode: 'stock_only', allowBomComponent: true, allowPurchase: true, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'packing' },
    { key: 'pkManual', code: 'SIMBED-PK-MANUAL', name: '模拟床-说明书', category1Id: 4, category2Id: packCat, stockUnit: '本', purchaseUnit: '本', productionUnit: '本', businessClass: 'production_material', controlMode: 'stock_only', allowBomComponent: true, allowPurchase: true, allowInventory: true, allowProductionIssue: true, defaultWarehouseType: 'packing' },
  ];

  for (const def of skuDefs) {
    skus[def.key] = ensureSku(def);
  }

  [
    ['rmTopBoard', 50, '张'],
    ['rmBeamBoard', 50, '张'],
    ['rmPanelBoard', 50, '张'],
    ['rmHeadPostBoard', 80, '张'],
    ['rmSideBoard', 80, '张'],
    ['rmEndBoard', 80, '张'],
    ['rmWingBoard', 80, '张'],
    ['rmSlatBoard', 200, '张'],
    ['rmEmbedPart', 1000, '个'],
    ['rmFoam', 20, '件'],
    ['pkCarton', 20, '个'],
    ['pkManual', 50, '本'],
  ].forEach(([key, qty, unit]) => ensureInventory(skus[key], qty, unit, `${key} 初始库存`));

  createBom(skus.sfHeadTop, '1.0', '床头顶板 BOM', [
    { componentSkuId: skus.rmTopBoard, qty: 1, unit: '张' },
    { componentSkuId: skus.rmEmbedPart, qty: 4, unit: '个' },
  ]);
  createBom(skus.sfHeadBeam, '1.0', '床头下梁 BOM', [
    { componentSkuId: skus.rmBeamBoard, qty: 1, unit: '张' },
    { componentSkuId: skus.rmEmbedPart, qty: 4, unit: '个' },
  ]);
  createBom(skus.sfHeadPanel, '1.0', '床头面板 BOM', [
    { componentSkuId: skus.rmPanelBoard, qty: 1, unit: '张' },
  ]);
  createBom(skus.sfHeadPost, '1.0', '床头立柱 BOM', [
    { componentSkuId: skus.rmHeadPostBoard, qty: 1, unit: '张' },
    { componentSkuId: skus.rmEmbedPart, qty: 2, unit: '个' },
  ]);
  createBom(skus.sfSide, '1.0', '床侧 BOM', [
    { componentSkuId: skus.rmSideBoard, qty: 1, unit: '张' },
    { componentSkuId: skus.rmEmbedPart, qty: 6, unit: '个' },
  ]);
  createBom(skus.sfEnd, '1.0', '床尾 BOM', [
    { componentSkuId: skus.rmEndBoard, qty: 1, unit: '张' },
    { componentSkuId: skus.rmEmbedPart, qty: 4, unit: '个' },
  ]);
  createBom(skus.sfWing, '1.0', '护翼 BOM', [
    { componentSkuId: skus.rmWingBoard, qty: 1, unit: '张' },
    { componentSkuId: skus.rmEmbedPart, qty: 4, unit: '个' },
  ]);
  createBom(skus.sfSlat, '1.0', '排骨条组 BOM', [
    { componentSkuId: skus.rmSlatBoard, qty: 5, unit: '张' },
  ]);
  createBom(skus.sfHead, '1.0', '床头总成 BOM', [
    { componentSkuId: skus.sfHeadTop, qty: 1, unit: '件' },
    { componentSkuId: skus.sfHeadBeam, qty: 1, unit: '件' },
    { componentSkuId: skus.sfHeadPanel, qty: 1, unit: '件' },
    { componentSkuId: skus.sfHeadPost, qty: 1, unit: '件' },
  ]);
  createBom(skus.fgBed, '1.0', '成品床 BOM', [
    { componentSkuId: skus.sfHead, qty: 1, unit: '件' },
    { componentSkuId: skus.sfSide, qty: 2, unit: '件' },
    { componentSkuId: skus.sfEnd, qty: 1, unit: '件' },
    { componentSkuId: skus.sfWing, qty: 2, unit: '件' },
    { componentSkuId: skus.sfSlat, qty: 1, unit: '组' },
    { componentSkuId: skus.rmFoam, qty: 1, unit: '件' },
    { componentSkuId: skus.pkCarton, qty: 1, unit: '个' },
    { componentSkuId: skus.pkManual, qty: 1, unit: '本' },
  ]);

  const threeStep = (label, outputSkuId, groupKey, boardSkuId, embedQty) => ([
    {
      stepNo: 1,
      stepName: `开料 · ${label}`,
      standardHours: 0.5,
      workstationType: 'cutting',
      workstationId: stations.cutting,
      outputType: 'semi_finished',
      outputSkuId,
      routeGroupKey: groupKey,
      routeLevel: 1,
      guideText: `${label} 开料`,
      executionMode: 'internal',
      stepMaterials: [
        { inputSkuId: boardSkuId, usagePerUnit: 1, consumeTiming: 'start', isKeyMaterial: true },
      ],
    },
    {
      stepNo: 2,
      stepName: `钻孔 · ${label}`,
      standardHours: 0.4,
      maxHours: 0.6,
      workstationType: 'drilling',
      workstationId: stations.drilling,
      outputType: 'semi_finished',
      outputSkuId,
      predecessorStepNos: [1],
      routeGroupKey: groupKey,
      routeLevel: 2,
      guideText: `${label} 钻孔`,
      executionMode: 'internal',
    },
    {
      stepNo: 3,
      stepName: `预埋 · ${label}`,
      standardHours: 0.4,
      maxHours: 0.6,
      workstationType: 'embedding',
      workstationId: stations.embedding,
      outputType: 'semi_finished',
      outputSkuId,
      predecessorStepNos: [2],
      routeGroupKey: groupKey,
      routeLevel: 3,
      guideText: `${label} 预埋`,
      executionMode: 'internal',
      stepMaterials: [
        { inputSkuId: skus.rmEmbedPart, usagePerUnit: embedQty, consumeTiming: 'complete', isKeyMaterial: true },
      ],
    },
  ]);

  createTemplate({
    skuId: skus.sfHeadTop,
    name: '模拟床-床头顶板默认工艺',
    steps: threeStep('床头顶板', skus.sfHeadTop, 'head-top', skus.rmTopBoard, 4),
  });
  createTemplate({
    skuId: skus.sfHeadBeam,
    name: '模拟床-床头下梁默认工艺',
    steps: threeStep('床头下梁', skus.sfHeadBeam, 'head-beam', skus.rmBeamBoard, 4),
  });
  createTemplate({
    skuId: skus.sfHeadPost,
    name: '模拟床-床头立柱默认工艺',
    steps: threeStep('床头立柱', skus.sfHeadPost, 'head-post', skus.rmHeadPostBoard, 2),
  });
  createTemplate({
    skuId: skus.sfSide,
    name: '模拟床-床侧默认工艺',
    steps: threeStep('床侧', skus.sfSide, 'bed-side', skus.rmSideBoard, 6),
  });
  createTemplate({
    skuId: skus.sfEnd,
    name: '模拟床-床尾默认工艺',
    steps: threeStep('床尾', skus.sfEnd, 'bed-end', skus.rmEndBoard, 4),
  });
  createTemplate({
    skuId: skus.sfWing,
    name: '模拟床-护翼默认工艺',
    steps: threeStep('护翼', skus.sfWing, 'wing', skus.rmWingBoard, 4),
  });
  createTemplate({
    skuId: skus.sfHeadPanel,
    name: '模拟床-床头面板默认工艺',
    steps: [
      {
        stepNo: 1,
        stepName: '开料 · 床头面板',
        standardHours: 0.4,
        workstationType: 'cutting',
        workstationId: stations.cutting,
        outputType: 'semi_finished',
        outputSkuId: skus.sfHeadPanel,
        routeGroupKey: 'head-panel',
        routeLevel: 1,
        guideText: '床头面板开料',
        executionMode: 'internal',
        stepMaterials: [
          { inputSkuId: skus.rmPanelBoard, usagePerUnit: 1, consumeTiming: 'start', isKeyMaterial: true },
        ],
      },
    ],
  });
  createTemplate({
    skuId: skus.sfSlat,
    name: '模拟床-排骨条组默认工艺',
    steps: [
      {
        stepNo: 1,
        stepName: '开料 · 排骨条组',
        standardHours: 0.6,
        workstationType: 'cutting',
        workstationId: stations.cutting,
        outputType: 'semi_finished',
        outputSkuId: skus.sfSlat,
        routeGroupKey: 'slat',
        routeLevel: 1,
        guideText: '排骨条组开料',
        executionMode: 'internal',
        stepMaterials: [
          { inputSkuId: skus.rmSlatBoard, usagePerUnit: 5, consumeTiming: 'start', isKeyMaterial: true },
        ],
      },
    ],
  });
  createTemplate({
    skuId: skus.sfHead,
    name: '模拟床-床头默认工艺',
    steps: [
      { stepNo: 1, stepName: '组装 · 床头', standardHours: 0.8, workstationType: 'assembly', workstationId: stations.assembly, outputType: 'semi_finished', outputSkuId: skus.sfHead, routeGroupKey: 'head', routeLevel: 1, guideText: '床头总成组装', executionMode: 'internal' },
    ],
  });
  createTemplate({
    skuId: skus.fgBed,
    name: '模拟床-成品床默认工艺',
    steps: [
      {
        stepNo: 1,
        stepName: '包装 · 成品床',
        standardHours: 0.7,
        workstationType: 'packaging',
        workstationId: stations.packaging,
        outputType: 'final_product',
        outputSkuId: skus.fgBed,
        routeGroupKey: 'final-pack',
        routeLevel: 1,
        guideText: '包装一级半成品与泡沫/纸箱/说明书，输出成品床',
        executionMode: 'internal',
        stepMaterials: [
          { inputSkuId: skus.rmFoam, usagePerUnit: 1, consumeTiming: 'start', isKeyMaterial: true },
          { inputSkuId: skus.pkCarton, usagePerUnit: 1, consumeTiming: 'start', isKeyMaterial: true },
          { inputSkuId: skus.pkManual, usagePerUnit: 1, consumeTiming: 'start', isKeyMaterial: false },
        ],
      },
    ],
  });

  return {
    tenantCode: 'FACTORY001',
    customerCode: 'SIMBED-CUST-01',
    productCode: 'SIMBED-FG-01',
    productName: '模拟床-成品床',
  };
}

function main() {
  const cleanupOnly = process.argv.includes('--cleanup');
  if (cleanupOnly) {
    cleanupScenario();
    console.log(JSON.stringify({ status: 'cleaned', tenantCode: 'FACTORY001' }, null, 2));
    return;
  }
  const result = seedScenario();
  console.log(JSON.stringify({ status: 'seeded', ...result }, null, 2));
}

main();
