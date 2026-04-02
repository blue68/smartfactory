import mysql, { type Pool, type RowDataPacket } from '../../services/api/node_modules/mysql2/promise';
import { APP_BASE_URL, seedAuth } from './purchaseFlow';

export { APP_BASE_URL, seedAuth };

const TEST_TENANT_ID = 9999;
const DB_HOST = process.env.DB_HOST ?? '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT ?? '3307');
const DB_USER = process.env.DB_USER ?? 'sf_app';
const DB_PASS = process.env.DB_PASS ?? process.env.DB_PASSWORD ?? 'TestApp2026!Secure';
const DB_NAME = process.env.DB_NAME ?? 'smart_factory';
const TEST_USER_ID = 99001;

let dbPool: Pool | null = null;

export interface ProcessConfigScenario {
  skuId: number;
  templateId: number;
  stepId: number;
  existingTypeId: number;
  templateName: string;
  skuName: string;
  stepName: string;
  newTypeName: string;
  newWorkstationName: string;
}

interface StepSnapshotRow extends RowDataPacket {
  workstation_type: string | null;
  workstation_id: number | null;
  max_hours: string | null;
}

interface WageSnapshotRow extends RowDataPacket {
  unit_price: string;
}

export interface ProcessConfigRegressionScenario {
  skuId: number;
  templateId: number;
  stepId: number;
  stepNo: number;
  existingTypeId: number;
  targetTypeId: number;
  existingWorkstationId: number;
  targetWorkstationId: number;
  templateName: string;
  stepName: string;
  existingTypeName: string;
  targetTypeName: string;
  existingWorkstationName: string;
  targetWorkstationName: string;
}

function getDbPool(): Pool {
  if (!dbPool) {
    dbPool = mysql.createPool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASS,
      database: DB_NAME,
      connectionLimit: 4,
      waitForConnections: true,
    });
  }
  return dbPool;
}

function nextScenarioIds() {
  const suffix = `${Date.now().toString().slice(-5)}${Math.floor(Math.random() * 10)}`;
  return {
    skuId: Number(`71${suffix}`),
    templateId: Number(`72${suffix}`),
    stepId: Number(`73${suffix}`),
    existingTypeId: Number(`74${suffix}`),
    targetTypeId: Number(`75${suffix}`),
    existingWorkstationId: Number(`76${suffix}`),
    targetWorkstationId: Number(`77${suffix}`),
    suffix,
  };
}

async function poll<T>(
  fn: () => Promise<T | null>,
  timeoutMs = 12_000,
  intervalMs = 300,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() >= deadline) {
      throw new Error('Timed out while polling process config flow data');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function closeProcessConfigFlowDbPool(): Promise<void> {
  if (dbPool) {
    const pool = dbPool;
    dbPool = null;
    await pool.end();
  }
}

export async function seedProcessConfigScenario(): Promise<ProcessConfigScenario> {
  const pool = getDbPool();
  const { skuId, templateId, stepId, existingTypeId, suffix } = nextScenarioIds();
  const templateName = `Playwright工序模板-${suffix}`;
  const skuName = `Playwright成品-${suffix}`;
  const stepName = '开料';
  const newTypeName = `包装区-${suffix}`;
  const newWorkstationName = `包装站-${suffix}`;

  await pool.execute(
    `INSERT INTO tenants (id, code, name, status, settings)
     VALUES (?, 'TEST9999', 'Playwright QA Tenant', 'active', JSON_OBJECT())
     ON DUPLICATE KEY UPDATE
       code = VALUES(code),
       name = VALUES(name),
       status = VALUES(status),
       settings = VALUES(settings)`,
    [TEST_TENANT_ID],
  );

  await pool.execute(
    `INSERT INTO skus
       (id, tenant_id, sku_code, name, category1_id, category2_id,
        stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo,
        safety_stock, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, 1, 1, '件', '件', '件', 0, 1, 0, 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       sku_code = VALUES(sku_code),
       name = VALUES(name),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [skuId, TEST_TENANT_ID, `SKU-PC-${suffix}`, skuName, TEST_USER_ID, TEST_USER_ID],
  );

  await pool.execute(
    `INSERT INTO workstation_types
       (id, tenant_id, name, sort_order)
     VALUES (?, ?, '开料区', 10)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       sort_order = VALUES(sort_order)`,
    [existingTypeId, TEST_TENANT_ID],
  );

  await pool.execute(
    `INSERT INTO process_templates
       (id, tenant_id, sku_id, name, status, is_default, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'active', 0, ?, ?)
     ON DUPLICATE KEY UPDATE
       sku_id = VALUES(sku_id),
       name = VALUES(name),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [templateId, TEST_TENANT_ID, skuId, templateName, TEST_USER_ID, TEST_USER_ID],
  );

  await pool.execute(
    `INSERT INTO process_steps
       (id, tenant_id, template_id, step_no, step_name, standard_hours, max_hours, workstation_type, workstation_id, created_at)
     VALUES (?, ?, ?, 1, ?, 1.5000, 2.0000, '开料区', NULL, NOW(3))
     ON DUPLICATE KEY UPDATE
       step_name = VALUES(step_name),
       standard_hours = VALUES(standard_hours),
       max_hours = VALUES(max_hours),
       workstation_type = VALUES(workstation_type)`,
    [stepId, TEST_TENANT_ID, templateId, stepName],
  );

  return {
    skuId,
    templateId,
    stepId,
    existingTypeId,
    templateName,
    skuName,
    stepName,
    newTypeName,
    newWorkstationName,
  };
}

export async function seedProcessConfigRegressionScenario(): Promise<ProcessConfigRegressionScenario> {
  const pool = getDbPool();
  const {
    skuId,
    templateId,
    stepId,
    existingTypeId,
    targetTypeId,
    existingWorkstationId,
    targetWorkstationId,
    suffix,
  } = nextScenarioIds();
  const templateName = `Playwright工序回归模板-${suffix}`;
  const stepName = '打磨';
  const stepNo = 1;
  const existingTypeName = `开料区回归-${suffix}`;
  const targetTypeName = `装配区回归-${suffix}`;
  const existingWorkstationName = `开料站回归-${suffix}`;
  const targetWorkstationName = `装配站回归-${suffix}`;

  await pool.execute(
    `INSERT INTO tenants (id, code, name, status, settings)
     VALUES (?, 'TEST9999', 'Playwright QA Tenant', 'active', JSON_OBJECT())
     ON DUPLICATE KEY UPDATE
       code = VALUES(code),
       name = VALUES(name),
       status = VALUES(status),
       settings = VALUES(settings)`,
    [TEST_TENANT_ID],
  );

  await pool.execute(
    `INSERT INTO skus
       (id, tenant_id, sku_code, name, category1_id, category2_id,
        stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo,
        safety_stock, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, 1, 1, '件', '件', '件', 0, 1, 0, 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       sku_code = VALUES(sku_code),
       name = VALUES(name),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [skuId, TEST_TENANT_ID, `SKU-PCR-${suffix}`, `Playwright工序成品-${suffix}`, TEST_USER_ID, TEST_USER_ID],
  );

  await pool.execute(
    `INSERT INTO workstation_types
       (id, tenant_id, name, sort_order)
     VALUES (?, ?, ?, 10),
            (?, ?, ?, 20)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       sort_order = VALUES(sort_order)`,
    [
      existingTypeId, TEST_TENANT_ID, existingTypeName,
      targetTypeId, TEST_TENANT_ID, targetTypeName,
    ],
  );

  await pool.execute(
    `INSERT INTO workstations
       (id, tenant_id, name, type, capacity, status)
     VALUES (?, ?, ?, ?, 60, 'active'),
            (?, ?, ?, ?, 88, 'active')
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       type = VALUES(type),
       capacity = VALUES(capacity),
       status = VALUES(status)`,
    [
      existingWorkstationId, TEST_TENANT_ID, existingWorkstationName, existingTypeName,
      targetWorkstationId, TEST_TENANT_ID, targetWorkstationName, targetTypeName,
    ],
  );

  await pool.execute(
    `INSERT INTO process_templates
       (id, tenant_id, sku_id, name, status, is_default, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'active', 0, ?, ?)
     ON DUPLICATE KEY UPDATE
       sku_id = VALUES(sku_id),
       name = VALUES(name),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [templateId, TEST_TENANT_ID, skuId, templateName, TEST_USER_ID, TEST_USER_ID],
  );

  await pool.execute(
    `INSERT INTO process_steps
       (id, tenant_id, template_id, step_no, step_name, standard_hours, max_hours, workstation_type, workstation_id, created_at, updated_by, created_by)
     VALUES (?, ?, ?, ?, ?, 1.5000, 2.00, ?, ?, NOW(3), ?, ?)
     ON DUPLICATE KEY UPDATE
       step_name = VALUES(step_name),
       standard_hours = VALUES(standard_hours),
       max_hours = VALUES(max_hours),
       workstation_type = VALUES(workstation_type),
       workstation_id = VALUES(workstation_id),
       updated_by = VALUES(updated_by)`,
    [stepId, TEST_TENANT_ID, templateId, stepNo, stepName, existingTypeName, existingWorkstationId, TEST_USER_ID, TEST_USER_ID],
  );

  return {
    skuId,
    templateId,
    stepId,
    stepNo,
    existingTypeId,
    targetTypeId,
    existingWorkstationId,
    targetWorkstationId,
    templateName,
    stepName,
    existingTypeName,
    targetTypeName,
    existingWorkstationName,
    targetWorkstationName,
  };
}

export async function cleanupProcessConfigScenario(scenario: ProcessConfigScenario): Promise<void> {
  const pool = getDbPool();

  await pool.execute(
    'DELETE FROM workstations WHERE tenant_id = ? AND name IN (?, ?)',
    [TEST_TENANT_ID, scenario.newWorkstationName, `开料站-${scenario.templateId}`],
  );
  await pool.execute(
    'DELETE FROM workstation_types WHERE tenant_id = ? AND (id = ? OR name = ?)',
    [TEST_TENANT_ID, scenario.existingTypeId, scenario.newTypeName],
  );
  await pool.execute(
    'DELETE FROM process_steps WHERE tenant_id = ? AND template_id = ?',
    [TEST_TENANT_ID, scenario.templateId],
  );
  await pool.execute(
    'DELETE FROM process_templates WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.templateId],
  );
  await pool.execute(
    'DELETE FROM skus WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.skuId],
  );
}

export async function cleanupProcessConfigRegressionScenario(
  scenario: ProcessConfigRegressionScenario,
): Promise<void> {
  const pool = getDbPool();

  await pool.execute(
    'DELETE FROM process_wages WHERE tenant_id = ? AND step_id = ?',
    [TEST_TENANT_ID, scenario.stepId],
  );
  await pool.execute(
    'DELETE FROM process_steps WHERE tenant_id = ? AND template_id = ?',
    [TEST_TENANT_ID, scenario.templateId],
  );
  await pool.execute(
    'DELETE FROM process_templates WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.templateId],
  );
  await pool.execute(
    'DELETE FROM workstations WHERE tenant_id = ? AND id IN (?, ?)',
    [TEST_TENANT_ID, scenario.existingWorkstationId, scenario.targetWorkstationId],
  );
  await pool.execute(
    'DELETE FROM workstation_types WHERE tenant_id = ? AND id IN (?, ?)',
    [TEST_TENANT_ID, scenario.existingTypeId, scenario.targetTypeId],
  );
  await pool.execute(
    'DELETE FROM skus WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.skuId],
  );
}

export async function waitForProcessStepSnapshot(
  templateId: number,
  stepNo: number,
  expected: { workstationType: string; workstationId: number; maxHours: string },
  timeoutMs = 12_000,
): Promise<StepSnapshotRow & { id: number }> {
  return poll(async () => {
    const pool = getDbPool();
    const [rows] = await pool.query<Array<StepSnapshotRow & { id: number }>>(
      `SELECT id, workstation_type, workstation_id, CAST(max_hours AS CHAR) AS max_hours
       FROM process_steps
       WHERE tenant_id = ? AND template_id = ? AND step_no = ?
       LIMIT 1`,
      [TEST_TENANT_ID, templateId, stepNo],
    );
    const row = rows[0];
    if (!row) return null;
    return row.workstation_type === expected.workstationType
      && Number(row.workstation_id) === expected.workstationId
      && row.max_hours === expected.maxHours
      ? row
      : null;
  }, timeoutMs);
}

export async function waitForProcessWage(
  stepId: number,
  expectedUnitPrice: string,
  timeoutMs = 12_000,
): Promise<WageSnapshotRow> {
  return poll(async () => {
    const pool = getDbPool();
    const [rows] = await pool.query<WageSnapshotRow[]>(
      `SELECT CAST(unit_price AS CHAR) AS unit_price
       FROM process_wages
       WHERE tenant_id = ? AND step_id = ? AND worker_grade = 'skilled'
       LIMIT 1`,
      [TEST_TENANT_ID, stepId],
    );
    const row = rows[0];
    return row?.unit_price === expectedUnitPrice ? row : null;
  }, timeoutMs);
}
