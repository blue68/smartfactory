import mysql, { type Pool, type RowDataPacket } from '../../services/api/node_modules/mysql2/promise';
import Decimal from '../../services/api/node_modules/decimal.js';
import { APP_BASE_URL, seedAuth } from './purchaseFlow';

export { APP_BASE_URL, seedAuth };

const TEST_TENANT_ID = 9999;
const DB_HOST = process.env.DB_HOST ?? '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT ?? '3307');
const DB_USER = process.env.DB_USER ?? 'sf_app';
const DB_PASS = process.env.DB_PASS ?? process.env.DB_PASSWORD ?? 'TestApp2026!Secure';
const DB_NAME = process.env.DB_NAME ?? 'smart_factory';
const TEST_BOSS_ID = 99001;
const TEST_SUPERVISOR_ID = 99004;
const TEST_WORKER_ID = 99005;

let dbPool: Pool | null = null;

interface WorkReportColumnRow extends RowDataPacket {
  Field: string;
}

interface ProductionScheduleRow extends RowDataPacket {
  id: number;
  planned_qty: string;
  worker_id: number | null;
  workstation_id: number | null;
  status: string;
}

interface ConfirmedScheduleTaskRow extends RowDataPacket {
  id: number;
  task_no: string;
  status: string;
  process_step_id: number;
  output_sku_id: number | null;
  planned_qty: string;
}

interface ProductionTaskStatusRow extends RowDataPacket {
  status: string;
  affects_progress: number | null;
  suspend_reason?: string | null;
}

interface TaskExceptionResolutionRow extends RowDataPacket {
  resolved_at: Date | string | null;
  resolution: string | null;
}

interface TaskMaterialSnapshotRow extends RowDataPacket {
  sku_id?: number;
  planned_qty: string;
  actual_qty: string;
  inventory_tx_id: number | null;
}

interface ProductionOrderStatusRow extends RowDataPacket {
  status: string;
  qty_completed?: string;
}

interface WorkReportSnapshotRow extends RowDataPacket {
  report_no: string;
  qty_qualified: string;
  work_hours: string;
  unit_wage: string;
  wage_amount: string;
}

export interface ProductionTaskScenario {
  customerId: number;
  finishedSkuId: number;
  wipSkuId: number;
  materialSkuId: number;
  templateId: number;
  predecessorStepId: number;
  currentStepId: number;
  workstationId: number;
  salesOrderId: number;
  productionOrderId: number;
  componentId: number;
  predecessorOperationId: number;
  currentOperationId: number;
  scheduleId: number;
  taskId: number;
  inputInventoryTxId: number;
  outputInventoryTxId: number;
  reportId: number;
  exceptionId: number;
  customerName: string;
  orderNo: string;
  taskNo: string;
  predecessorStepName: string;
  currentStepName: string;
  materialSkuName: string;
  outputSkuName: string;
  inputTransactionNo: string;
  outputTransactionNo: string;
  reportNo: string;
  exceptionDescription: string;
  blockingReason: string;
}

export interface ProductionScheduleScenario extends ProductionTaskScenario {
  scheduleDate: string;
}

export interface ProductionOrderRegressionScenario extends ProductionTaskScenario {
  childComponentId: number;
  extraTaskIds: number[];
  extraTaskNos: string[];
  wildcardSourceSkuName: string;
  wildcardResolvedSkuName: string;
}

export interface ProductionOrderCancelScenario extends ProductionTaskScenario {}

export interface ProductionOrderCreateScenario {
  customerId: number;
  finishedSkuId: number;
  materialSkuId: number;
  templateId: number;
  salesOrderId: number;
  salesOrderItemId: number;
  bomId: number;
  salesOrderNo: string;
  finishedSkuName: string;
  expectedMaterialStatus: 'ready';
}

export interface ProductionShortageScenario extends ProductionTaskScenario {
  supplierId: number;
  supplierCode: string;
  materialSkuCode: string;
  bomSnapshotId: number;
  expectedShortageQty: string;
  expectedSuggestedQty: string;
}

export interface ProductionTaskRegressionScenario extends ProductionTaskScenario {
  resolvedExceptionId: number;
  resolvedExceptionDescription: string;
}

export interface ProductionTaskMixedTimelineScenario extends ProductionTaskScenario {
  resolvedExceptionId: number;
  resolvedExceptionDescription: string;
  extraExceptionId: number;
  extraExceptionDescription: string;
  expectedWorkHours: string;
  expectedUnitPrice: string;
  expectedSubtotal: string;
}

export interface ProductionTaskResolveExceptionScenario extends ProductionTaskScenario {
  resolution: string;
}

export interface ProductionTaskSuspendScenario extends ProductionTaskScenario {
  suspendReason: string;
}

export interface ProductionTaskStartScenario extends ProductionTaskScenario {
  expectedInputQty: string;
}

export interface ProductionTaskIssueScenario extends ProductionTaskStartScenario {
  issueQty: string;
  dyeLotNo: string;
  sourceWarehouseId: number;
  sourceLocationId: number;
  sourceWarehouseCode: string;
  sourceWarehouseName: string;
  sourceLocationCode: string;
  sourceLocationName: string;
}

export interface ProductionTaskCompleteScenario extends ProductionTaskScenario {
  completedQty: string;
  actualHours: string;
  scrapQty: string;
  notes: string;
  expectedQualifiedQty: string;
  expectedUnitWage: string;
  expectedSubtotal: string;
}

export interface ProductionScheduleSnapshot {
  scheduleId: number;
  plannedQty: string;
  workerId: number | null;
  workstationId: number | null;
  status: string;
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
    customerId: Number(`71${suffix}`),
    finishedSkuId: Number(`72${suffix}`),
    wipSkuId: Number(`73${suffix}`),
    materialSkuId: Number(`74${suffix}`),
    templateId: Number(`75${suffix}`),
    predecessorStepId: Number(`76${suffix}`),
    currentStepId: Number(`77${suffix}`),
    workstationId: Number(`78${suffix}`),
    salesOrderId: Number(`79${suffix}`),
    productionOrderId: Number(`80${suffix}`),
    componentId: Number(`81${suffix}`),
    predecessorOperationId: Number(`82${suffix}`),
    currentOperationId: Number(`83${suffix}`),
    scheduleId: Number(`84${suffix}`),
    taskId: Number(`85${suffix}`),
    inputInventoryTxId: Number(`86${suffix}`),
    outputInventoryTxId: Number(`87${suffix}`),
    reportId: Number(`88${suffix}`),
    exceptionId: Number(`89${suffix}`),
    suffix,
  };
}

function buildScenarioScheduleDate(seed: string): string {
  const month = String((Number(seed.slice(0, 2)) % 12) + 1).padStart(2, '0');
  const day = String((Number(seed.slice(2, 4)) % 28) + 1).padStart(2, '0');
  return `2099-${month}-${day}`;
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
      throw new Error('Timed out while polling production flow data');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function resolveWorkReportSchema(pool: Pool): Promise<{
  workerColumn: 'worker_id' | 'user_id';
  stepColumn: 'process_step_id' | 'step_id';
  dateColumn: 'work_date' | 'report_date';
  qtyColumn: 'qty_completed' | 'qty';
}> {
  const [columns] = await pool.query<WorkReportColumnRow[]>('SHOW COLUMNS FROM work_reports');
  const columnNames = new Set(columns.map((column) => String(column.Field)));

  if (columnNames.has('worker_id')) {
    return {
      workerColumn: 'worker_id',
      stepColumn: 'process_step_id',
      dateColumn: 'work_date',
      qtyColumn: 'qty_completed',
    };
  }

  return {
    workerColumn: 'user_id',
    stepColumn: 'step_id',
    dateColumn: 'report_date',
    qtyColumn: 'qty',
  };
}

export async function closeProductionTaskFlowDbPool(): Promise<void> {
  if (dbPool) {
    const pool = dbPool;
    dbPool = null;
    await pool.end();
  }
}

export async function seedProductionTaskScenario(): Promise<ProductionTaskScenario> {
  const pool = getDbPool();
  const schema = await resolveWorkReportSchema(pool);
  const ids = nextScenarioIds();
  const customerName = `Playwright生产客户-${ids.suffix}`;
  const finishedSkuName = `Playwright主柜体-${ids.suffix}`;
  const outputSkuName = `Playwright半成品框架-${ids.suffix}`;
  const materialSkuName = `Playwright橡木板-${ids.suffix}`;
  const orderNo = `WO-TASK-${ids.suffix}`;
  const taskNo = `TASK-PW-${ids.suffix}`;
  const predecessorStepName = '开料';
  const currentStepName = '裁剪';
  const inputTransactionNo = `IT-TASK-IN-${ids.suffix}`;
  const outputTransactionNo = `IT-TASK-OUT-${ids.suffix}`;
  const reportNo = `WR-TASK-${ids.suffix}`;
  const exceptionDescription = `刀片断裂等待更换-${ids.suffix}`;
  const blockingReason = `${predecessorStepName} 未达到可开工数量（需 12.0000，当前 6.0000）`;

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
    `INSERT INTO users
       (id, tenant_id, username, password_hash, real_name, status, skill_level, created_by, updated_by)
     VALUES
       (?, ?, 'test_boss', 'playwright-password', '测试老板', 'active', NULL, 0, 0),
       (?, ?, 'test_supervisor', 'playwright-password', '测试主管', 'active', NULL, 0, 0),
       (?, ?, 'test_worker', 'playwright-password', '测试熟练工', 'active', 'skilled', 0, 0)
     ON DUPLICATE KEY UPDATE
       username = VALUES(username),
       real_name = VALUES(real_name),
       status = VALUES(status),
       skill_level = VALUES(skill_level),
       updated_by = VALUES(updated_by)`,
    [TEST_BOSS_ID, TEST_TENANT_ID, TEST_SUPERVISOR_ID, TEST_TENANT_ID, TEST_WORKER_ID, TEST_TENANT_ID],
  );

  await pool.execute(
    `INSERT IGNORE INTO user_roles (tenant_id, user_id, role_id)
     SELECT ?, ?, id FROM roles WHERE tenant_id = 0 AND code = 'boss'`,
    [TEST_TENANT_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    `INSERT IGNORE INTO user_roles (tenant_id, user_id, role_id)
     SELECT ?, ?, id FROM roles WHERE tenant_id = 0 AND code = 'supervisor'`,
    [TEST_TENANT_ID, TEST_SUPERVISOR_ID],
  );

  await pool.execute(
    `INSERT IGNORE INTO user_roles (tenant_id, user_id, role_id)
     SELECT ?, ?, id FROM roles WHERE tenant_id = 0 AND code = 'worker'`,
    [TEST_TENANT_ID, TEST_WORKER_ID],
  );

  await pool.execute(
    `INSERT INTO customers
       (id, tenant_id, code, name, grade, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'A', 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       code = VALUES(code),
       name = VALUES(name),
       grade = VALUES(grade),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [ids.customerId, TEST_TENANT_ID, `CUS-TASK-${ids.suffix}`, customerName, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    `INSERT INTO skus
       (id, tenant_id, sku_code, name, category1_id, category2_id,
        stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo,
        safety_stock, status, created_by, updated_by)
     VALUES
       (?, ?, ?, ?, 1, 1, '件', '件', '件', 0, 1, 0, 'active', ?, ?),
       (?, ?, ?, ?, 1, 1, '件', '件', '件', 0, 1, 0, 'active', ?, ?),
       (?, ?, ?, ?, 1, 1, '张', '张', '张', 0, 1, 0, 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       sku_code = VALUES(sku_code),
       name = VALUES(name),
       stock_unit = VALUES(stock_unit),
       purchase_unit = VALUES(purchase_unit),
       production_unit = VALUES(production_unit),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [
      ids.finishedSkuId, TEST_TENANT_ID, `FG-TASK-${ids.suffix}`, finishedSkuName, TEST_BOSS_ID, TEST_BOSS_ID,
      ids.wipSkuId, TEST_TENANT_ID, `WIP-TASK-${ids.suffix}`, outputSkuName, TEST_BOSS_ID, TEST_BOSS_ID,
      ids.materialSkuId, TEST_TENANT_ID, `RM-TASK-${ids.suffix}`, materialSkuName, TEST_BOSS_ID, TEST_BOSS_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO workstations
       (id, tenant_id, name, type, capacity, status)
     VALUES (?, ?, ?, 'cut', 80, 'active')
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       type = VALUES(type),
       capacity = VALUES(capacity),
       status = VALUES(status)`,
    [ids.workstationId, TEST_TENANT_ID, `Playwright裁剪台-${ids.suffix}`],
  );

  await pool.execute(
    `INSERT INTO process_templates
       (id, tenant_id, sku_id, name, version, is_default, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, '1.0', 1, 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       sku_id = VALUES(sku_id),
       name = VALUES(name),
       version = VALUES(version),
       is_default = VALUES(is_default),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [ids.templateId, TEST_TENANT_ID, ids.finishedSkuId, `Playwright生产模板-${ids.suffix}`, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    `INSERT INTO process_steps
       (id, tenant_id, template_id, step_no, step_name, standard_hours, max_hours,
        workstation_type, workstation_id, output_type, output_sku_id, created_by, updated_by)
     VALUES
       (?, ?, ?, 1, ?, 0.50, 1.50, 'cut', ?, 'semi_finished', ?, ?, ?),
       (?, ?, ?, 2, ?, 0.80, 3.00, 'cut', ?, 'semi_finished', ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       step_name = VALUES(step_name),
       standard_hours = VALUES(standard_hours),
       max_hours = VALUES(max_hours),
       workstation_type = VALUES(workstation_type),
       workstation_id = VALUES(workstation_id),
       output_type = VALUES(output_type),
       output_sku_id = VALUES(output_sku_id),
       updated_by = VALUES(updated_by)`,
    [
      ids.predecessorStepId, TEST_TENANT_ID, ids.templateId, predecessorStepName, ids.workstationId, ids.wipSkuId, TEST_BOSS_ID, TEST_BOSS_ID,
      ids.currentStepId, TEST_TENANT_ID, ids.templateId, currentStepName, ids.workstationId, ids.wipSkuId, TEST_BOSS_ID, TEST_BOSS_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO sales_orders
       (id, tenant_id, order_no, customer_id, order_type, status, priority,
        expected_delivery, total_amount, constraint_passed, approval_status,
        sales_person_id, notes, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'normal', 'confirmed', 80,
             DATE_ADD(CURDATE(), INTERVAL 7 DAY), 12800.00, 1, 'approved',
             ?, 'Playwright 生产任务详情真实浏览器回归', ?, ?)
     ON DUPLICATE KEY UPDATE
       order_no = VALUES(order_no),
       customer_id = VALUES(customer_id),
       status = VALUES(status),
       priority = VALUES(priority),
       total_amount = VALUES(total_amount),
       approval_status = VALUES(approval_status),
       updated_by = VALUES(updated_by)`,
    [ids.salesOrderId, TEST_TENANT_ID, `SO-TASK-${ids.suffix}`, ids.customerId, TEST_BOSS_ID, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    `INSERT INTO production_orders
       (id, tenant_id, work_order_no, sales_order_id, sku_id, bom_header_id, process_template_id,
        qty_planned, qty_completed, status, priority, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, 1, ?, 12.0000, 6.0000, 'in_progress', 80, ?, ?)
     ON DUPLICATE KEY UPDATE
       work_order_no = VALUES(work_order_no),
       sales_order_id = VALUES(sales_order_id),
       sku_id = VALUES(sku_id),
       process_template_id = VALUES(process_template_id),
       qty_planned = VALUES(qty_planned),
       qty_completed = VALUES(qty_completed),
       status = VALUES(status),
       priority = VALUES(priority),
       updated_by = VALUES(updated_by)`,
    [ids.productionOrderId, TEST_TENANT_ID, orderNo, ids.salesOrderId, ids.finishedSkuId, ids.templateId, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    `INSERT INTO production_order_components
       (id, tenant_id, production_order_id, parent_component_id, sku_id, resolved_sku_id,
        component_type, qty_required, bom_level, bom_path, created_by, updated_by)
     VALUES (?, ?, ?, NULL, ?, ?, 'fg', 12.0000, 0, 'fg', ?, ?)
     ON DUPLICATE KEY UPDATE
       sku_id = VALUES(sku_id),
       resolved_sku_id = VALUES(resolved_sku_id),
       qty_required = VALUES(qty_required),
       updated_by = VALUES(updated_by)`,
    [ids.componentId, TEST_TENANT_ID, ids.productionOrderId, ids.finishedSkuId, ids.finishedSkuId, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    `INSERT INTO production_operations
       (id, tenant_id, production_order_id, component_id, process_step_id, output_sku_id,
        planned_qty, completed_qty, status, created_by, updated_by)
     VALUES
       (?, ?, ?, ?, ?, ?, 12.0000, 6.0000, 'in_progress', ?, ?),
       (?, ?, ?, ?, ?, ?, 12.0000, 6.0000, 'in_progress', ?, ?)
     ON DUPLICATE KEY UPDATE
       process_step_id = VALUES(process_step_id),
       output_sku_id = VALUES(output_sku_id),
       planned_qty = VALUES(planned_qty),
       completed_qty = VALUES(completed_qty),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [
      ids.predecessorOperationId, TEST_TENANT_ID, ids.productionOrderId, ids.componentId, ids.predecessorStepId, ids.wipSkuId, TEST_BOSS_ID, TEST_BOSS_ID,
      ids.currentOperationId, TEST_TENANT_ID, ids.productionOrderId, ids.componentId, ids.currentStepId, ids.wipSkuId, TEST_BOSS_ID, TEST_BOSS_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO production_operation_dependencies
       (tenant_id, operation_id, predecessor_operation_id, required_qty)
     VALUES (?, ?, ?, 12.0000)
     ON DUPLICATE KEY UPDATE
       required_qty = VALUES(required_qty)`,
    [TEST_TENANT_ID, ids.currentOperationId, ids.predecessorOperationId],
  );

  await pool.execute(
    `INSERT INTO production_tasks
       (id, tenant_id, task_no, schedule_id, production_order_id, operation_id, component_id,
        process_step_id, output_sku_id, workstation_id, worker_id, task_date,
        planned_qty, completed_qty, scrap_qty, status, actual_hours, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(),
             12.0000, 6.0000, 1, 'started', 2.50, ?, ?)
     ON DUPLICATE KEY UPDATE
       task_no = VALUES(task_no),
       schedule_id = VALUES(schedule_id),
       operation_id = VALUES(operation_id),
       component_id = VALUES(component_id),
       process_step_id = VALUES(process_step_id),
       output_sku_id = VALUES(output_sku_id),
       workstation_id = VALUES(workstation_id),
       worker_id = VALUES(worker_id),
       planned_qty = VALUES(planned_qty),
       completed_qty = VALUES(completed_qty),
       scrap_qty = VALUES(scrap_qty),
       status = VALUES(status),
       actual_hours = VALUES(actual_hours),
       updated_by = VALUES(updated_by)`,
    [
      ids.taskId, TEST_TENANT_ID, taskNo, ids.scheduleId, ids.productionOrderId, ids.currentOperationId, ids.componentId,
      ids.currentStepId, ids.wipSkuId, ids.workstationId, TEST_WORKER_ID, TEST_BOSS_ID, TEST_BOSS_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO inventory_transactions
       (id, tenant_id, transaction_no, sku_id, transaction_type, direction,
        qty_input, input_unit, qty_stock_unit, stock_unit,
        reference_type, reference_id, reference_no, notes, created_by)
     VALUES
       (?, ?, ?, ?, 'MATERIAL_OUT', 'OUT', 12.0000, '张', 6.0000, '张',
        'production_order', ?, ?, ?, ?),
       (?, ?, ?, ?, 'PRODUCTION_IN', 'IN', 6.0000, '件', 6.0000, '件',
        'production_order', ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       transaction_no = VALUES(transaction_no),
       sku_id = VALUES(sku_id),
       transaction_type = VALUES(transaction_type),
       direction = VALUES(direction),
       qty_input = VALUES(qty_input),
       input_unit = VALUES(input_unit),
       qty_stock_unit = VALUES(qty_stock_unit),
       stock_unit = VALUES(stock_unit),
       reference_no = VALUES(reference_no),
       notes = VALUES(notes),
       created_by = VALUES(created_by)`,
    [
      ids.inputInventoryTxId, TEST_TENANT_ID, inputTransactionNo, ids.materialSkuId, ids.productionOrderId, orderNo, `Playwright 投入流水 ${ids.suffix}`, TEST_BOSS_ID,
      ids.outputInventoryTxId, TEST_TENANT_ID, outputTransactionNo, ids.wipSkuId, ids.productionOrderId, orderNo, `Playwright 产出流水 ${ids.suffix}`, TEST_BOSS_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO task_material_transactions
       (tenant_id, task_id, operation_id, sku_id, io_type, planned_qty, actual_qty, inventory_tx_id, created_by)
     VALUES
       (?, ?, ?, ?, 'input', 12.0000, 6.0000, ?, ?),
       (?, ?, ?, ?, 'output', 12.0000, 6.0000, ?, ?)` ,
    [
      TEST_TENANT_ID, ids.taskId, ids.currentOperationId, ids.materialSkuId, ids.inputInventoryTxId, TEST_BOSS_ID,
      TEST_TENANT_ID, ids.taskId, ids.currentOperationId, ids.wipSkuId, ids.outputInventoryTxId, TEST_BOSS_ID,
    ],
  );

  const workReportColumns = [
    'id',
    'tenant_id',
    'report_no',
    schema.workerColumn,
    'production_order_id',
    'task_id',
    schema.stepColumn,
    schema.dateColumn,
    schema.qtyColumn,
    'qty_qualified',
    'qty_defective',
    'work_hours',
    'unit_wage',
    'wage_amount',
    'status',
    'notes',
    'created_by',
    'updated_by',
  ];

  await pool.execute(
    `INSERT INTO work_reports (${workReportColumns.join(', ')})
     VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE(), 6.0000, 5.0000, 1.0000, 2.50, 8.0000, 40.00, 'confirmed', ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       ${schema.workerColumn} = VALUES(${schema.workerColumn}),
       production_order_id = VALUES(production_order_id),
       task_id = VALUES(task_id),
       ${schema.stepColumn} = VALUES(${schema.stepColumn}),
       ${schema.dateColumn} = VALUES(${schema.dateColumn}),
       ${schema.qtyColumn} = VALUES(${schema.qtyColumn}),
       qty_qualified = VALUES(qty_qualified),
       qty_defective = VALUES(qty_defective),
       work_hours = VALUES(work_hours),
       unit_wage = VALUES(unit_wage),
       wage_amount = VALUES(wage_amount),
       status = VALUES(status),
       notes = VALUES(notes),
       updated_by = VALUES(updated_by)`,
    [
      ids.reportId,
      TEST_TENANT_ID,
      reportNo,
      TEST_WORKER_ID,
      ids.productionOrderId,
      ids.taskId,
      ids.currentStepId,
      `Playwright 工资报工 ${ids.suffix}`,
      TEST_BOSS_ID,
      TEST_BOSS_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO task_exceptions
       (id, tenant_id, task_id, exception_type, description, severity, reported_by, affects_progress)
     VALUES (?, ?, ?, '设备故障', ?, 'high', ?, 1)
     ON DUPLICATE KEY UPDATE
       exception_type = VALUES(exception_type),
       description = VALUES(description),
       severity = VALUES(severity),
       reported_by = VALUES(reported_by),
       affects_progress = VALUES(affects_progress)`,
    [ids.exceptionId, TEST_TENANT_ID, ids.taskId, exceptionDescription, TEST_BOSS_ID],
  );

  return {
    ...ids,
    customerName,
    orderNo,
    taskNo,
    predecessorStepName,
    currentStepName,
    materialSkuName,
    outputSkuName,
    inputTransactionNo,
    outputTransactionNo,
    reportNo,
    exceptionDescription,
    blockingReason,
  };
}

export async function seedProductionScheduleScenario(): Promise<ProductionScheduleScenario> {
  const scenario = await seedProductionTaskScenario();
  return {
    ...scenario,
    scheduleDate: buildScenarioScheduleDate(String(scenario.productionOrderId)),
  };
}

export async function seedProductionOrderRegressionScenario(): Promise<ProductionOrderRegressionScenario> {
  const pool = getDbPool();
  const scenario = await seedProductionTaskScenario();
  const childComponentId = scenario.componentId + 101;
  const extraTaskIds = [scenario.taskId + 101, scenario.taskId + 102, scenario.taskId + 103];
  const extraTaskNos = [
    `${scenario.taskNo}-A`,
    `${scenario.taskNo}-B`,
    `${scenario.taskNo}-C`,
  ];

  await pool.execute(
    `INSERT INTO production_order_components
       (id, tenant_id, production_order_id, parent_component_id, sku_id, resolved_sku_id,
        component_type, qty_required, bom_level, bom_path, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, 'wip', 12.0000, 1, 'fg>wip', ?, ?)
     ON DUPLICATE KEY UPDATE
       parent_component_id = VALUES(parent_component_id),
       sku_id = VALUES(sku_id),
       resolved_sku_id = VALUES(resolved_sku_id),
       component_type = VALUES(component_type),
       qty_required = VALUES(qty_required),
       bom_level = VALUES(bom_level),
       bom_path = VALUES(bom_path),
       updated_by = VALUES(updated_by)`,
    [
      childComponentId,
      TEST_TENANT_ID,
      scenario.productionOrderId,
      scenario.componentId,
      scenario.materialSkuId,
      scenario.wipSkuId,
      TEST_BOSS_ID,
      TEST_BOSS_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO production_tasks
       (id, tenant_id, task_no, schedule_id, production_order_id, operation_id, component_id,
        process_step_id, output_sku_id, workstation_id, worker_id, task_date,
        planned_qty, completed_qty, scrap_qty, status, actual_hours, created_by, updated_by)
     VALUES
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), 3.0000, 0.0000, 0, 'pending', 0.00, ?, ?),
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), 3.0000, 0.0000, 0, 'pending', 0.00, ?, ?),
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), 3.0000, 0.0000, 0, 'pending', 0.00, ?, ?)
     ON DUPLICATE KEY UPDATE
       task_no = VALUES(task_no),
       schedule_id = VALUES(schedule_id),
       production_order_id = VALUES(production_order_id),
       operation_id = VALUES(operation_id),
       component_id = VALUES(component_id),
       process_step_id = VALUES(process_step_id),
       output_sku_id = VALUES(output_sku_id),
       workstation_id = VALUES(workstation_id),
       worker_id = VALUES(worker_id),
       planned_qty = VALUES(planned_qty),
       completed_qty = VALUES(completed_qty),
       scrap_qty = VALUES(scrap_qty),
       status = VALUES(status),
       actual_hours = VALUES(actual_hours),
       updated_by = VALUES(updated_by)`,
    [
      extraTaskIds[0], TEST_TENANT_ID, extraTaskNos[0], scenario.scheduleId, scenario.productionOrderId, scenario.currentOperationId, scenario.componentId,
      scenario.currentStepId, scenario.wipSkuId, scenario.workstationId, TEST_WORKER_ID, TEST_BOSS_ID, TEST_BOSS_ID,
      extraTaskIds[1], TEST_TENANT_ID, extraTaskNos[1], scenario.scheduleId, scenario.productionOrderId, scenario.currentOperationId, scenario.componentId,
      scenario.currentStepId, scenario.wipSkuId, scenario.workstationId, TEST_WORKER_ID, TEST_BOSS_ID, TEST_BOSS_ID,
      extraTaskIds[2], TEST_TENANT_ID, extraTaskNos[2], scenario.scheduleId, scenario.productionOrderId, scenario.currentOperationId, scenario.componentId,
      scenario.currentStepId, scenario.wipSkuId, scenario.workstationId, TEST_WORKER_ID, TEST_BOSS_ID, TEST_BOSS_ID,
    ],
  );

  return {
    ...scenario,
    childComponentId,
    extraTaskIds,
    extraTaskNos,
    wildcardSourceSkuName: scenario.materialSkuName,
    wildcardResolvedSkuName: scenario.outputSkuName,
  };
}

export async function seedProductionOrderCancelScenario(): Promise<ProductionOrderCancelScenario> {
  const pool = getDbPool();
  const scenario = await seedProductionTaskScenario();

  await pool.execute(
    'DELETE FROM task_exceptions WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.exceptionId],
  );
  await pool.execute(
    'DELETE FROM work_reports WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.reportId],
  );
  await pool.execute(
    'DELETE FROM task_material_transactions WHERE tenant_id = ? AND task_id = ?',
    [TEST_TENANT_ID, scenario.taskId],
  );
  await pool.execute(
    'DELETE FROM inventory_transactions WHERE tenant_id = ? AND id IN (?, ?)',
    [TEST_TENANT_ID, scenario.inputInventoryTxId, scenario.outputInventoryTxId],
  );

  await pool.execute(
    `UPDATE production_tasks
     SET status = 'pending',
         completed_qty = 0.0000,
         scrap_qty = 0.0000,
         actual_hours = NULL,
         started_at = NULL,
         completed_at = NULL,
         updated_by = ?
     WHERE tenant_id = ? AND id = ?`,
    [TEST_BOSS_ID, TEST_TENANT_ID, scenario.taskId],
  );

  await pool.execute(
    `UPDATE production_operations
     SET completed_qty = 0.0000,
         status = 'pending',
         updated_by = ?
     WHERE tenant_id = ? AND id IN (?, ?)`,
    [TEST_BOSS_ID, TEST_TENANT_ID, scenario.predecessorOperationId, scenario.currentOperationId],
  );

  await pool.execute(
    `UPDATE production_orders
     SET status = 'pending',
         qty_completed = 0.0000,
         actual_start = NULL,
         actual_end = NULL,
         updated_by = ?
     WHERE tenant_id = ? AND id = ?`,
    [TEST_BOSS_ID, TEST_TENANT_ID, scenario.productionOrderId],
  );

  return {
    ...scenario,
  };
}

export async function seedProductionOrderCreateScenario(): Promise<ProductionOrderCreateScenario> {
  const pool = getDbPool();
  const ids = nextScenarioIds();
  const bomId = Number(`90${ids.suffix}`);
  const salesOrderItemId = Number(`91${ids.suffix}`);
  const finishedSkuName = `Playwright待建工单成品-${ids.suffix}`;
  const materialSkuName = `Playwright待建工单原料-${ids.suffix}`;
  const salesOrderNo = `SO-CREATE-${ids.suffix}`;

  await pool.execute(
    `INSERT INTO customers
       (id, tenant_id, code, name, grade, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'A', 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       code = VALUES(code),
       name = VALUES(name),
       grade = VALUES(grade),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [
      ids.customerId,
      TEST_TENANT_ID,
      `CUS-CREATE-${ids.suffix}`,
      `Playwright建单客户-${ids.suffix}`,
      TEST_BOSS_ID,
      TEST_BOSS_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO skus
       (id, tenant_id, sku_code, name, category1_id, category2_id,
        stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo,
        safety_stock, status, created_by, updated_by)
     VALUES
       (?, ?, ?, ?, 1, 1, '件', '件', '件', 0, 1, 0, 'active', ?, ?),
       (?, ?, ?, ?, 1, 1, '件', '件', '件', 0, 1, 0, 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       sku_code = VALUES(sku_code),
       name = VALUES(name),
       stock_unit = VALUES(stock_unit),
       purchase_unit = VALUES(purchase_unit),
       production_unit = VALUES(production_unit),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [
      ids.finishedSkuId, TEST_TENANT_ID, `FG-CREATE-${ids.suffix}`, finishedSkuName, TEST_BOSS_ID, TEST_BOSS_ID,
      ids.materialSkuId, TEST_TENANT_ID, `RM-CREATE-${ids.suffix}`, materialSkuName, TEST_BOSS_ID, TEST_BOSS_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO inventory
       (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit, last_in_at)
     VALUES (?, ?, 20.0000, 0.0000, 0.0000, NOW(3))
     ON DUPLICATE KEY UPDATE
       qty_on_hand = VALUES(qty_on_hand),
       qty_reserved = 0.0000,
       qty_in_transit = 0.0000,
       last_in_at = VALUES(last_in_at)`,
    [TEST_TENANT_ID, ids.materialSkuId],
  );

  await pool.execute(
    `INSERT INTO bom_headers
       (id, tenant_id, sku_id, version, status, description, is_active, created_by, updated_by)
     VALUES (?, ?, ?, '1.0', 'active', 'Playwright工单创建BOM', 1, ?, ?)
     ON DUPLICATE KEY UPDATE
       sku_id = VALUES(sku_id),
       version = VALUES(version),
       status = VALUES(status),
       description = VALUES(description),
       is_active = VALUES(is_active),
       updated_by = VALUES(updated_by)`,
    [bomId, TEST_TENANT_ID, ids.finishedSkuId, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    `INSERT INTO bom_items
       (tenant_id, bom_header_id, component_sku_id, material_sku_id, quantity, qty_per_unit,
        unit, level, scrap_rate, sort_order, created_by, updated_by)
     VALUES (?, ?, ?, ?, 2.0000, 2.0000, '件', 1, 0.0000, 1, ?, ?)
     ON DUPLICATE KEY UPDATE
       component_sku_id = VALUES(component_sku_id),
       material_sku_id = VALUES(material_sku_id),
       quantity = VALUES(quantity),
       qty_per_unit = VALUES(qty_per_unit),
       unit = VALUES(unit),
       level = VALUES(level),
       scrap_rate = VALUES(scrap_rate),
       sort_order = VALUES(sort_order),
       updated_by = VALUES(updated_by)`,
    [TEST_TENANT_ID, bomId, ids.materialSkuId, ids.materialSkuId, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    `INSERT INTO process_templates
       (id, tenant_id, sku_id, name, version, is_default, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, '1.0', 1, 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       sku_id = VALUES(sku_id),
       name = VALUES(name),
       version = VALUES(version),
       is_default = VALUES(is_default),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [ids.templateId, TEST_TENANT_ID, ids.finishedSkuId, `Playwright建单模板-${ids.suffix}`, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    `INSERT INTO sales_orders
       (id, tenant_id, order_no, customer_id, order_type, status, priority,
        expected_delivery, total_amount, constraint_passed, approval_status,
        sales_person_id, notes, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'normal', 'confirmed', 70,
             DATE_ADD(CURDATE(), INTERVAL 7 DAY), 600.00, 1, 'approved',
             ?, 'Playwright 生产工单手动创建', ?, ?)
     ON DUPLICATE KEY UPDATE
       order_no = VALUES(order_no),
       customer_id = VALUES(customer_id),
       status = VALUES(status),
       priority = VALUES(priority),
       expected_delivery = VALUES(expected_delivery),
       total_amount = VALUES(total_amount),
       approval_status = VALUES(approval_status),
       updated_by = VALUES(updated_by)`,
    [ids.salesOrderId, TEST_TENANT_ID, salesOrderNo, ids.customerId, TEST_BOSS_ID, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    `INSERT INTO sales_order_items
       (id, tenant_id, order_id, sku_id, qty_ordered, qty, qty_delivered,
        unit_price, amount, bom_header_id, created_by, updated_by)
     VALUES (?, ?, ?, ?, 6.0000, 6.0000, 0.0000, 100.0000, 600.00, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       qty_ordered = VALUES(qty_ordered),
       qty = VALUES(qty),
       qty_delivered = VALUES(qty_delivered),
       unit_price = VALUES(unit_price),
       amount = VALUES(amount),
       bom_header_id = VALUES(bom_header_id),
       updated_by = VALUES(updated_by)`,
    [salesOrderItemId, TEST_TENANT_ID, ids.salesOrderId, ids.finishedSkuId, bomId, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  return {
    customerId: ids.customerId,
    finishedSkuId: ids.finishedSkuId,
    materialSkuId: ids.materialSkuId,
    templateId: ids.templateId,
    salesOrderId: ids.salesOrderId,
    salesOrderItemId,
    bomId,
    salesOrderNo,
    finishedSkuName,
    expectedMaterialStatus: 'ready',
  };
}

export async function seedProductionShortageScenario(): Promise<ProductionShortageScenario> {
  const pool = getDbPool();
  const scenario = await seedProductionTaskScenario();
  const supplierId = scenario.productionOrderId + 501;
  const bomSnapshotId = scenario.productionOrderId + 601;
  const supplierCode = `SUP-SHORT-${scenario.productionOrderId}`;
  const snapshotNo = `BVS-SHORT-${scenario.productionOrderId}`;
  const snapshotHash = String(scenario.productionOrderId).padStart(64, '0');

  const [skuRows] = await pool.query<Array<RowDataPacket & { sku_code: string }>>(
    `SELECT sku_code
     FROM skus
     WHERE tenant_id = ? AND id = ?
     LIMIT 1`,
    [TEST_TENANT_ID, scenario.materialSkuId],
  );
  const materialSkuCode = String(skuRows[0]?.sku_code ?? `RM-SHORT-${scenario.productionOrderId}`);

  await pool.execute(
    `INSERT INTO suppliers
       (id, tenant_id, code, name, grade, status, main_skus, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'A', 'active', JSON_ARRAY(?), ?, ?)
     ON DUPLICATE KEY UPDATE
       code = VALUES(code),
       name = VALUES(name),
       grade = VALUES(grade),
       status = VALUES(status),
       main_skus = VALUES(main_skus),
       updated_by = VALUES(updated_by)`,
    [
      supplierId,
      TEST_TENANT_ID,
      supplierCode,
      `Playwright缺料供应商-${scenario.productionOrderId}`,
      scenario.materialSkuId,
      TEST_BOSS_ID,
      TEST_BOSS_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO supplier_prices
       (tenant_id, supplier_id, sku_id, price, unit, is_current, created_by, updated_by)
     VALUES (?, ?, ?, 7.5000, '张', 1, ?, ?)
     ON DUPLICATE KEY UPDATE
       price = VALUES(price),
       unit = VALUES(unit),
       is_current = VALUES(is_current),
       updated_by = VALUES(updated_by)`,
    [TEST_TENANT_ID, supplierId, scenario.materialSkuId, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    `INSERT INTO bom_version_snapshots
       (id, tenant_id, bom_header_id, snapshot_no, bom_version, snapshot_data, snapshot_hash, created_by)
     VALUES (?, ?, 1, ?, '1.0', JSON_OBJECT('items', JSON_ARRAY()), ?, ?)
     ON DUPLICATE KEY UPDATE
       snapshot_no = VALUES(snapshot_no),
       bom_version = VALUES(bom_version),
       snapshot_data = VALUES(snapshot_data),
       snapshot_hash = VALUES(snapshot_hash),
       created_by = VALUES(created_by)`,
    [bomSnapshotId, TEST_TENANT_ID, snapshotNo, snapshotHash, TEST_BOSS_ID],
  );

  await pool.execute(
    `UPDATE production_orders
     SET bom_snapshot_id = ?,
         material_status = 'shortage',
         updated_by = ?
     WHERE tenant_id = ? AND id = ?`,
    [bomSnapshotId, TEST_BOSS_ID, TEST_TENANT_ID, scenario.productionOrderId],
  );

  await pool.execute(
    `DELETE FROM purchase_suggestions
     WHERE tenant_id = ? AND production_order_id = ? AND sku_id = ? AND source = 'production_shortage'`,
    [TEST_TENANT_ID, scenario.productionOrderId, scenario.materialSkuId],
  );

  await pool.execute(
    `DELETE FROM material_requirements
     WHERE tenant_id = ? AND production_order_id = ? AND sku_id = ?`,
    [TEST_TENANT_ID, scenario.productionOrderId, scenario.materialSkuId],
  );

  await pool.execute(
    `INSERT INTO material_requirements
       (tenant_id, production_order_id, bom_snapshot_id, sku_id,
        qty_required, qty_reserved, qty_shortage, status, suggestion_id)
     VALUES (?, ?, ?, ?, 12.0000, 0.0000, 12.0000, 'shortage', NULL)`,
    [TEST_TENANT_ID, scenario.productionOrderId, bomSnapshotId, scenario.materialSkuId],
  );

  return {
    ...scenario,
    supplierId,
    supplierCode,
    materialSkuCode,
    bomSnapshotId,
    expectedShortageQty: '12.0000',
    expectedSuggestedQty: '12.0000',
  };
}

export async function seedProductionTaskRegressionScenario(): Promise<ProductionTaskRegressionScenario> {
  const pool = getDbPool();
  const scenario = await seedProductionTaskScenario();
  const resolvedExceptionId = scenario.exceptionId + 101;
  const resolvedExceptionDescription = `已处理的刀具校准偏差-${scenario.taskId}`;

  await pool.execute(
    'DELETE FROM task_material_transactions WHERE tenant_id = ? AND task_id = ?',
    [TEST_TENANT_ID, scenario.taskId],
  );
  await pool.execute(
    'DELETE FROM inventory_transactions WHERE tenant_id = ? AND id IN (?, ?)',
    [TEST_TENANT_ID, scenario.inputInventoryTxId, scenario.outputInventoryTxId],
  );
  await pool.execute(
    'DELETE FROM work_reports WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.reportId],
  );

  await pool.execute(
    `INSERT INTO task_exceptions
       (id, tenant_id, task_id, exception_type, description, severity, reported_by, affects_progress, resolved_at, resolved_by, resolution, created_at)
     VALUES (?, ?, ?, '质量异常', ?, 'medium', ?, 0, NOW(), ?, '已返工并复检通过', DATE_SUB(NOW(), INTERVAL 1 DAY))
     ON DUPLICATE KEY UPDATE
       exception_type = VALUES(exception_type),
       description = VALUES(description),
       severity = VALUES(severity),
       reported_by = VALUES(reported_by),
       affects_progress = VALUES(affects_progress),
       resolved_at = VALUES(resolved_at),
       resolved_by = VALUES(resolved_by),
       resolution = VALUES(resolution),
       created_at = VALUES(created_at)`,
    [
      resolvedExceptionId,
      TEST_TENANT_ID,
      scenario.taskId,
      resolvedExceptionDescription,
      TEST_BOSS_ID,
      TEST_BOSS_ID,
    ],
  );

  return {
    ...scenario,
    resolvedExceptionId,
    resolvedExceptionDescription,
  };
}

export async function seedProductionTaskDependencyRecoveryScenario(): Promise<ProductionTaskScenario> {
  return seedProductionTaskScenario();
}

export async function unblockProductionTaskDependency(
  scenario: ProductionTaskScenario,
): Promise<void> {
  const pool = getDbPool();

  await pool.execute(
    `UPDATE production_operations
     SET completed_qty = 12.0000,
         status = 'completed',
         updated_by = ?
     WHERE tenant_id = ? AND id = ?`,
    [TEST_BOSS_ID, TEST_TENANT_ID, scenario.predecessorOperationId],
  );
}

export async function seedProductionTaskMixedTimelineScenario(): Promise<ProductionTaskMixedTimelineScenario> {
  const pool = getDbPool();
  const scenario = await seedProductionTaskScenario();
  const resolvedExceptionId = scenario.exceptionId + 201;
  const extraExceptionId = scenario.exceptionId + 202;
  const resolvedExceptionDescription = `已处理的返工复检异常-${scenario.taskId}`;
  const extraExceptionDescription = `待确认的工装偏移-${scenario.taskId}`;
  const expectedWorkHours = '4.20';
  const expectedUnitPrice = '9.50';
  const expectedSubtotal = '52.25';

  await pool.execute(
    `UPDATE production_tasks
     SET actual_hours = 3.80,
         updated_by = ?
     WHERE tenant_id = ? AND id = ?`,
    [TEST_BOSS_ID, TEST_TENANT_ID, scenario.taskId],
  );

  await pool.execute(
    `UPDATE work_reports
     SET work_hours = ?,
         unit_wage = ?,
         wage_amount = ?,
         qty_qualified = 5.5000,
         qty_defective = 0.5000,
         updated_by = ?
     WHERE tenant_id = ? AND id = ?`,
    [expectedWorkHours, expectedUnitPrice, expectedSubtotal, TEST_BOSS_ID, TEST_TENANT_ID, scenario.reportId],
  );

  await pool.execute(
    `INSERT INTO task_exceptions
       (id, tenant_id, task_id, exception_type, description, severity, reported_by, affects_progress, resolved_at, resolved_by, resolution, created_at)
     VALUES (?, ?, ?, '质量异常', ?, 'medium', ?, 0, NOW(), ?, '返工后复检通过', DATE_SUB(NOW(), INTERVAL 2 DAY))
     ON DUPLICATE KEY UPDATE
       exception_type = VALUES(exception_type),
       description = VALUES(description),
       severity = VALUES(severity),
       reported_by = VALUES(reported_by),
       affects_progress = VALUES(affects_progress),
       resolved_at = VALUES(resolved_at),
       resolved_by = VALUES(resolved_by),
       resolution = VALUES(resolution),
       created_at = VALUES(created_at)`,
    [
      resolvedExceptionId,
      TEST_TENANT_ID,
      scenario.taskId,
      resolvedExceptionDescription,
      TEST_BOSS_ID,
      TEST_BOSS_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO task_exceptions
       (id, tenant_id, task_id, exception_type, description, severity, reported_by, affects_progress, created_at)
     VALUES (?, ?, ?, '其他', ?, 'medium', ?, 0, DATE_SUB(NOW(), INTERVAL 1 DAY))
     ON DUPLICATE KEY UPDATE
       exception_type = VALUES(exception_type),
       description = VALUES(description),
       severity = VALUES(severity),
       reported_by = VALUES(reported_by),
       affects_progress = VALUES(affects_progress),
       created_at = VALUES(created_at)`,
    [
      extraExceptionId,
      TEST_TENANT_ID,
      scenario.taskId,
      extraExceptionDescription,
      TEST_BOSS_ID,
    ],
  );

  return {
    ...scenario,
    resolvedExceptionId,
    resolvedExceptionDescription,
    extraExceptionId,
    extraExceptionDescription,
    expectedWorkHours,
    expectedUnitPrice,
    expectedSubtotal,
  };
}

export async function seedProductionTaskResolveExceptionScenario(): Promise<ProductionTaskResolveExceptionScenario> {
  const pool = getDbPool();
  const scenario = await seedProductionTaskScenario();
  const resolution = `已更换刀片并重新校准-${scenario.taskId}`;

  await pool.execute(
    `UPDATE production_tasks
     SET status = 'exception',
         affects_progress = 1,
         updated_by = ?
     WHERE tenant_id = ? AND id = ?`,
    [TEST_BOSS_ID, TEST_TENANT_ID, scenario.taskId],
  );

  return {
    ...scenario,
    resolution,
  };
}

export async function seedProductionTaskStartScenario(): Promise<ProductionTaskStartScenario> {
  const pool = getDbPool();
  const scenario = await seedProductionTaskScenario();
  const expectedInputQty = '12.0000';

  await pool.execute(
    `INSERT INTO process_step_materials
       (tenant_id, template_id, step_no, input_sku_id, usage_per_unit, loss_rate, consume_timing, created_by, updated_by)
     VALUES (?, ?, 2, ?, 1.0000, 0.0000, 'start', ?, ?)
     ON DUPLICATE KEY UPDATE
       usage_per_unit = VALUES(usage_per_unit),
       loss_rate = VALUES(loss_rate),
       consume_timing = VALUES(consume_timing),
       updated_by = VALUES(updated_by)`,
    [TEST_TENANT_ID, scenario.templateId, scenario.materialSkuId, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    'DELETE FROM task_material_transactions WHERE tenant_id = ? AND task_id = ?',
    [TEST_TENANT_ID, scenario.taskId],
  );
  await pool.execute(
    'DELETE FROM inventory_transactions WHERE tenant_id = ? AND id IN (?, ?)',
    [TEST_TENANT_ID, scenario.inputInventoryTxId, scenario.outputInventoryTxId],
  );
  await pool.execute(
    'DELETE FROM work_reports WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.reportId],
  );
  await pool.execute(
    'DELETE FROM task_exceptions WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.exceptionId],
  );

  await pool.execute(
    `UPDATE production_tasks
     SET status = 'pending',
         started_at = NULL,
         completed_qty = 0.0000,
         scrap_qty = 0.0000,
         actual_hours = NULL,
         updated_by = ?
     WHERE tenant_id = ? AND id = ?`,
    [TEST_BOSS_ID, TEST_TENANT_ID, scenario.taskId],
  );

  await pool.execute(
    `UPDATE production_operations
     SET completed_qty = 12.0000,
         status = 'completed',
         updated_by = ?
     WHERE tenant_id = ? AND id = ?`,
    [TEST_BOSS_ID, TEST_TENANT_ID, scenario.predecessorOperationId],
  );

  await pool.execute(
    `UPDATE production_operations
     SET completed_qty = 0.0000,
         status = 'pending',
         updated_by = ?
     WHERE tenant_id = ? AND id = ?`,
    [TEST_BOSS_ID, TEST_TENANT_ID, scenario.currentOperationId],
  );

  await pool.execute(
    `UPDATE production_orders
     SET status = 'pending',
         qty_completed = 0.0000,
         actual_start = NULL,
         actual_end = NULL,
         updated_by = ?
     WHERE tenant_id = ? AND id = ?`,
    [TEST_BOSS_ID, TEST_TENANT_ID, scenario.productionOrderId],
  );

  return {
    ...scenario,
    expectedInputQty,
  };
}

export async function seedProductionTaskIssueScenario(): Promise<ProductionTaskIssueScenario> {
  const pool = getDbPool();
  const scenario = await seedProductionTaskStartScenario();
  const sourceWarehouseId = scenario.taskId + 401;
  const sourceLocationId = scenario.taskId + 402;
  const sourceWarehouseCode = `RM-${scenario.taskId}`;
  const sourceWarehouseName = `Playwright原料仓-${scenario.taskId}`;
  const sourceLocationCode = `RM-${scenario.taskId}-01`;
  const sourceLocationName = `Playwright库位-${scenario.taskId}`;
  const dyeLotNo = `DYE-TASK-${scenario.taskId}`;
  const issueQty = scenario.expectedInputQty;

  await pool.execute(
    `UPDATE skus
     SET has_dye_lot = 1,
         updated_by = ?
     WHERE tenant_id = ? AND id = ?`,
    [TEST_BOSS_ID, TEST_TENANT_ID, scenario.materialSkuId],
  );

  await pool.execute(
    `INSERT INTO warehouses
       (id, tenant_id, code, name, type, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'material', 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       code = VALUES(code),
       name = VALUES(name),
       type = VALUES(type),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [
      sourceWarehouseId,
      TEST_TENANT_ID,
      sourceWarehouseCode,
      sourceWarehouseName,
      TEST_BOSS_ID,
      TEST_BOSS_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO locations
       (id, tenant_id, warehouse_id, code, name, level, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       warehouse_id = VALUES(warehouse_id),
       code = VALUES(code),
       name = VALUES(name),
       level = VALUES(level),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [
      sourceLocationId,
      TEST_TENANT_ID,
      sourceWarehouseId,
      sourceLocationCode,
      sourceLocationName,
      TEST_BOSS_ID,
      TEST_BOSS_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO inventory
       (tenant_id, sku_id, warehouse_id, location_id, source_ref,
        qty_on_hand, qty_reserved, qty_in_transit, last_in_at, updated_by)
     VALUES (?, ?, ?, ?, 'playwright:task:issue:seed', ?, 0.0000, 0.0000, NOW(), ?)
     ON DUPLICATE KEY UPDATE
       qty_on_hand = VALUES(qty_on_hand),
       qty_reserved = VALUES(qty_reserved),
       qty_in_transit = VALUES(qty_in_transit),
       source_ref = VALUES(source_ref),
       last_in_at = VALUES(last_in_at),
       updated_by = VALUES(updated_by)`,
    [
      TEST_TENANT_ID,
      scenario.materialSkuId,
      sourceWarehouseId,
      sourceLocationId,
      issueQty,
      TEST_BOSS_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO inventory_dye_lots
       (tenant_id, sku_id, dye_lot_no, qty_on_hand, qty_reserved, first_in_at, last_in_at)
     VALUES (?, ?, ?, ?, 0.0000, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       qty_on_hand = VALUES(qty_on_hand),
       qty_reserved = VALUES(qty_reserved),
       last_in_at = VALUES(last_in_at)`,
    [TEST_TENANT_ID, scenario.materialSkuId, dyeLotNo, issueQty],
  );

  return {
    ...scenario,
    issueQty,
    dyeLotNo,
    sourceWarehouseId,
    sourceLocationId,
    sourceWarehouseCode,
    sourceWarehouseName,
    sourceLocationCode,
    sourceLocationName,
  };
}

export async function seedProductionTaskCompleteScenario(): Promise<ProductionTaskCompleteScenario> {
  const pool = getDbPool();
  const scenario = await seedProductionTaskScenario();
  const completedQty = '12';
  const actualHours = '2.5';
  const scrapQty = '1';
  const notes = `Playwright 完工上报-${scenario.taskId}`;
  const expectedQualifiedQty = '11.0000';
  const expectedUnitWage = '8.5000';
  const expectedSubtotal = '102.00';

  await pool.execute(
    `INSERT INTO process_wages
       (tenant_id, step_id, worker_grade, unit_price, created_by, updated_by)
     VALUES (?, ?, 'skilled', ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       unit_price = VALUES(unit_price),
       updated_by = VALUES(updated_by)`,
    [TEST_TENANT_ID, scenario.currentStepId, expectedUnitWage, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    'DELETE FROM task_material_transactions WHERE tenant_id = ? AND task_id = ?',
    [TEST_TENANT_ID, scenario.taskId],
  );
  await pool.execute(
    'DELETE FROM inventory_transactions WHERE tenant_id = ? AND id IN (?, ?)',
    [TEST_TENANT_ID, scenario.inputInventoryTxId, scenario.outputInventoryTxId],
  );
  await pool.execute(
    'DELETE FROM work_reports WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.reportId],
  );
  await pool.execute(
    'DELETE FROM task_exceptions WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.exceptionId],
  );

  await pool.execute(
    `UPDATE production_tasks
     SET status = 'started',
         started_at = NOW(),
         completed_qty = 0.0000,
         scrap_qty = 0.0000,
         actual_hours = NULL,
         updated_by = ?
     WHERE tenant_id = ? AND id = ?`,
    [TEST_BOSS_ID, TEST_TENANT_ID, scenario.taskId],
  );

  await pool.execute(
    `UPDATE production_operations
     SET completed_qty = 12.0000,
         status = 'completed',
         updated_by = ?
     WHERE tenant_id = ? AND id = ?`,
    [TEST_BOSS_ID, TEST_TENANT_ID, scenario.predecessorOperationId],
  );

  await pool.execute(
    `UPDATE production_operations
     SET completed_qty = 0.0000,
         status = 'in_progress',
         updated_by = ?
     WHERE tenant_id = ? AND id = ?`,
    [TEST_BOSS_ID, TEST_TENANT_ID, scenario.currentOperationId],
  );

  await pool.execute(
    `UPDATE production_orders
     SET status = 'in_progress',
         qty_completed = 0.0000,
         actual_start = NOW(),
         actual_end = NULL,
         updated_by = ?
     WHERE tenant_id = ? AND id = ?`,
    [TEST_BOSS_ID, TEST_TENANT_ID, scenario.productionOrderId],
  );

  return {
    ...scenario,
    completedQty,
    actualHours,
    scrapQty,
    notes,
    expectedQualifiedQty,
    expectedUnitWage,
    expectedSubtotal,
  };
}

export async function seedProductionTaskSuspendScenario(): Promise<ProductionTaskSuspendScenario> {
  const pool = getDbPool();
  const scenario = await seedProductionTaskScenario();
  const suspendReason = `等待主管复盘-${scenario.taskId}`;

  await pool.execute(
    `UPDATE production_tasks
     SET status = 'exception',
         affects_progress = 1,
         updated_by = ?
     WHERE tenant_id = ? AND id = ?`,
    [TEST_BOSS_ID, TEST_TENANT_ID, scenario.taskId],
  );

  return {
    ...scenario,
    suspendReason,
  };
}

export async function cleanupProductionTaskScenario(scenario: ProductionTaskScenario): Promise<void> {
  const pool = getDbPool();

  await pool.execute(
    'DELETE FROM task_exceptions WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.exceptionId],
  );
  await pool.execute(
    'DELETE FROM work_reports WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.reportId],
  );
  await pool.execute(
    'DELETE FROM task_material_transactions WHERE tenant_id = ? AND task_id = ?',
    [TEST_TENANT_ID, scenario.taskId],
  );
  await pool.execute(
    'DELETE FROM inventory_transactions WHERE tenant_id = ? AND id IN (?, ?)',
    [TEST_TENANT_ID, scenario.inputInventoryTxId, scenario.outputInventoryTxId],
  );
  await pool.execute(
    'DELETE FROM production_tasks WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.taskId],
  );
  await pool.execute(
    'DELETE FROM production_operation_dependencies WHERE tenant_id = ? AND operation_id = ? AND predecessor_operation_id = ?',
    [TEST_TENANT_ID, scenario.currentOperationId, scenario.predecessorOperationId],
  );
  await pool.execute(
    'DELETE FROM production_operations WHERE tenant_id = ? AND id IN (?, ?)',
    [TEST_TENANT_ID, scenario.predecessorOperationId, scenario.currentOperationId],
  );
  await pool.execute(
    'DELETE FROM production_order_components WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.componentId],
  );
  await pool.execute(
    'DELETE FROM production_orders WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.productionOrderId],
  );
  await pool.execute(
    'DELETE FROM sales_orders WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.salesOrderId],
  );
  await pool.execute(
    'DELETE FROM process_steps WHERE tenant_id = ? AND id IN (?, ?)',
    [TEST_TENANT_ID, scenario.predecessorStepId, scenario.currentStepId],
  );
  await pool.execute(
    'DELETE FROM process_step_materials WHERE tenant_id = ? AND template_id = ?',
    [TEST_TENANT_ID, scenario.templateId],
  );
  await pool.execute(
    'DELETE FROM process_templates WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.templateId],
  );
  await pool.execute(
    'DELETE FROM workstations WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.workstationId],
  );
  await pool.execute(
    'DELETE FROM skus WHERE tenant_id = ? AND id IN (?, ?, ?)',
    [TEST_TENANT_ID, scenario.finishedSkuId, scenario.wipSkuId, scenario.materialSkuId],
  );
  await pool.execute(
    'DELETE FROM customers WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.customerId],
  );
}

export async function cleanupProductionScheduleScenario(
  scenario: ProductionScheduleScenario,
): Promise<void> {
  const pool = getDbPool();

  await pool.execute(
    'DELETE FROM production_tasks WHERE tenant_id = ? AND production_order_id = ? AND task_date = ?',
    [TEST_TENANT_ID, scenario.productionOrderId, scenario.scheduleDate],
  );

  await pool.execute(
    'DELETE FROM production_schedules WHERE tenant_id = ? AND schedule_date = ? AND production_order_id = ?',
    [TEST_TENANT_ID, scenario.scheduleDate, scenario.productionOrderId],
  );

  await cleanupProductionTaskScenario(scenario);
}

export async function cleanupProductionOrderRegressionScenario(
  scenario: ProductionOrderRegressionScenario,
): Promise<void> {
  const pool = getDbPool();

  await pool.execute(
    'DELETE FROM production_tasks WHERE tenant_id = ? AND id IN (?, ?, ?)',
    [TEST_TENANT_ID, scenario.extraTaskIds[0], scenario.extraTaskIds[1], scenario.extraTaskIds[2]],
  );
  await pool.execute(
    'DELETE FROM production_order_components WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.childComponentId],
  );

  await cleanupProductionTaskScenario(scenario);
}

export async function cleanupProductionOrderCancelScenario(
  scenario: ProductionOrderCancelScenario,
): Promise<void> {
  await cleanupProductionTaskScenario(scenario);
}

export async function cleanupProductionOrderCreateScenario(
  scenario: ProductionOrderCreateScenario,
): Promise<void> {
  const pool = getDbPool();
  const [orderRows] = await pool.query<Array<RowDataPacket & { id: number; bom_snapshot_id: number | null }>>(
    `SELECT id, bom_snapshot_id
     FROM production_orders
     WHERE tenant_id = ? AND sales_order_id = ?`,
    [TEST_TENANT_ID, scenario.salesOrderId],
  );

  const orderIds = orderRows.map((row) => row.id);
  const snapshotIds = orderRows.map((row) => row.bom_snapshot_id).filter((id): id is number => id !== null);

  if (orderIds.length > 0) {
    const placeholders = orderIds.map(() => '?').join(', ');
    await pool.execute(
      `DELETE FROM material_requirements
       WHERE tenant_id = ? AND production_order_id IN (${placeholders})`,
      [TEST_TENANT_ID, ...orderIds],
    );
    await pool.execute(
      `DELETE FROM production_orders
       WHERE tenant_id = ? AND id IN (${placeholders})`,
      [TEST_TENANT_ID, ...orderIds],
    );
  }

  if (snapshotIds.length > 0) {
    const placeholders = snapshotIds.map(() => '?').join(', ');
    await pool.execute(
      `DELETE FROM bom_version_snapshots
       WHERE tenant_id = ? AND id IN (${placeholders})`,
      [TEST_TENANT_ID, ...snapshotIds],
    );
  }

  await pool.execute(
    'DELETE FROM inventory_daily_snapshots WHERE tenant_id = ? AND sku_id = ?',
    [TEST_TENANT_ID, scenario.materialSkuId],
  );
  await pool.execute(
    'DELETE FROM sales_order_items WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.salesOrderItemId],
  );
  await pool.execute(
    'DELETE FROM sales_orders WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.salesOrderId],
  );
  await pool.execute(
    'DELETE FROM process_templates WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.templateId],
  );
  await pool.execute(
    'DELETE FROM bom_items WHERE tenant_id = ? AND bom_header_id = ?',
    [TEST_TENANT_ID, scenario.bomId],
  );
  await pool.execute(
    'DELETE FROM bom_headers WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.bomId],
  );
  await pool.execute(
    'DELETE FROM inventory WHERE tenant_id = ? AND sku_id = ?',
    [TEST_TENANT_ID, scenario.materialSkuId],
  );
  await pool.execute(
    'DELETE FROM skus WHERE tenant_id = ? AND id IN (?, ?)',
    [TEST_TENANT_ID, scenario.finishedSkuId, scenario.materialSkuId],
  );
  await pool.execute(
    'DELETE FROM customers WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.customerId],
  );
}

export async function cleanupProductionShortageScenario(
  scenario: ProductionShortageScenario,
): Promise<void> {
  const pool = getDbPool();

  await pool.execute(
    `DELETE FROM purchase_suggestions
     WHERE tenant_id = ? AND production_order_id = ? AND sku_id = ? AND source = 'production_shortage'`,
    [TEST_TENANT_ID, scenario.productionOrderId, scenario.materialSkuId],
  );
  await pool.execute(
    'DELETE FROM material_requirements WHERE tenant_id = ? AND production_order_id = ? AND sku_id = ?',
    [TEST_TENANT_ID, scenario.productionOrderId, scenario.materialSkuId],
  );
  await pool.execute(
    'DELETE FROM bom_version_snapshots WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.bomSnapshotId],
  );
  await pool.execute(
    'DELETE FROM supplier_prices WHERE tenant_id = ? AND supplier_id = ? AND sku_id = ?',
    [TEST_TENANT_ID, scenario.supplierId, scenario.materialSkuId],
  );
  await pool.execute(
    'DELETE FROM suppliers WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.supplierId],
  );

  await cleanupProductionTaskScenario(scenario);
}

export async function cleanupProductionTaskRegressionScenario(
  scenario: ProductionTaskRegressionScenario,
): Promise<void> {
  const pool = getDbPool();

  await pool.execute(
    'DELETE FROM task_exceptions WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.resolvedExceptionId],
  );

  await cleanupProductionTaskScenario(scenario);
}

export async function cleanupProductionTaskMixedTimelineScenario(
  scenario: ProductionTaskMixedTimelineScenario,
): Promise<void> {
  const pool = getDbPool();

  await pool.execute(
    'DELETE FROM task_exceptions WHERE tenant_id = ? AND id IN (?, ?)',
    [TEST_TENANT_ID, scenario.resolvedExceptionId, scenario.extraExceptionId],
  );

  await cleanupProductionTaskScenario(scenario);
}

export async function cleanupProductionTaskResolveExceptionScenario(
  scenario: ProductionTaskResolveExceptionScenario,
): Promise<void> {
  await cleanupProductionTaskScenario(scenario);
}

export async function cleanupProductionTaskSuspendScenario(
  scenario: ProductionTaskSuspendScenario,
): Promise<void> {
  await cleanupProductionTaskScenario(scenario);
}

export async function cleanupProductionTaskStartScenario(
  scenario: ProductionTaskStartScenario,
): Promise<void> {
  await cleanupProductionTaskScenario(scenario);
}

export async function cleanupProductionTaskIssueScenario(
  scenario: ProductionTaskIssueScenario,
): Promise<void> {
  const pool = getDbPool();

  await pool.execute(
    'DELETE FROM task_inventory_movements WHERE tenant_id = ? AND task_id = ?',
    [TEST_TENANT_ID, scenario.taskId],
  );
  await pool.execute(
    `DELETE FROM inventory_transactions
     WHERE tenant_id = ?
       AND reference_type = 'production_task'
       AND reference_id = ?`,
    [TEST_TENANT_ID, scenario.taskId],
  );
  await pool.execute(
    'DELETE FROM inventory_dye_lots WHERE tenant_id = ? AND sku_id = ?',
    [TEST_TENANT_ID, scenario.materialSkuId],
  );
  await pool.execute(
    'DELETE FROM inventory WHERE tenant_id = ? AND sku_id = ?',
    [TEST_TENANT_ID, scenario.materialSkuId],
  );
  await pool.execute(
    'DELETE FROM locations WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.sourceLocationId],
  );
  await pool.execute(
    'DELETE FROM warehouses WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.sourceWarehouseId],
  );

  await cleanupProductionTaskScenario(scenario);
}

export async function cleanupProductionTaskCompleteScenario(
  scenario: ProductionTaskCompleteScenario,
): Promise<void> {
  const pool = getDbPool();

  await pool.execute(
    'DELETE FROM process_wages WHERE tenant_id = ? AND step_id = ? AND worker_grade = ?',
    [TEST_TENANT_ID, scenario.currentStepId, 'skilled'],
  );

  await cleanupProductionTaskScenario(scenario);
}

export async function waitForProductionTaskExceptionResolved(
  scenario: ProductionTaskResolveExceptionScenario,
): Promise<{
  taskStatus: string;
  affectsProgress: number | null;
  resolvedAt: string;
  resolution: string;
}> {
  const pool = getDbPool();

  return poll(async () => {
    const [taskRows] = await pool.query<ProductionTaskStatusRow[]>(
      `SELECT status, affects_progress
       FROM production_tasks
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.taskId],
    );

    const [exceptionRows] = await pool.query<TaskExceptionResolutionRow[]>(
      `SELECT resolved_at, resolution
       FROM task_exceptions
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.exceptionId],
    );

    const task = taskRows[0];
    const exception = exceptionRows[0];
    if (!task || !exception?.resolved_at || exception.resolution !== scenario.resolution) {
      return null;
    }

    return {
      taskStatus: String(task.status),
      affectsProgress: task.affects_progress ?? null,
      resolvedAt: String(exception.resolved_at),
      resolution: String(exception.resolution),
    };
  });
}

export async function waitForProductionTaskSuspended(
  scenario: ProductionTaskSuspendScenario,
): Promise<{
  taskStatus: string;
  suspendReason: string;
}> {
  const pool = getDbPool();

  return poll(async () => {
    const [taskRows] = await pool.query<ProductionTaskStatusRow[]>(
      `SELECT status, suspend_reason
       FROM production_tasks
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.taskId],
    );

    const task = taskRows[0];
    if (!task || task.status !== 'suspended' || task.suspend_reason !== scenario.suspendReason) {
      return null;
    }

    return {
      taskStatus: String(task.status),
      suspendReason: String(task.suspend_reason),
    };
  });
}

export async function waitForProductionTaskStarted(
  scenario: ProductionTaskStartScenario,
): Promise<{
  taskStatus: string;
  orderStatus: string;
  plannedQty: string;
  actualQty: string;
  inventoryTxId: number | null;
}> {
  const pool = getDbPool();

  return poll(async () => {
    const [taskRows] = await pool.query<ProductionTaskStatusRow[]>(
      `SELECT status
       FROM production_tasks
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.taskId],
    );

    const [orderRows] = await pool.query<ProductionOrderStatusRow[]>(
      `SELECT status
       FROM production_orders
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.productionOrderId],
    );

    const [materialRows] = await pool.query<TaskMaterialSnapshotRow[]>(
      `SELECT planned_qty, actual_qty, inventory_tx_id
       FROM task_material_transactions
       WHERE tenant_id = ? AND task_id = ? AND io_type = 'input' AND sku_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.taskId, scenario.materialSkuId],
    );

    const task = taskRows[0];
    const order = orderRows[0];
    const material = materialRows[0];
    if (!task || !order || !material || task.status !== 'started' || order.status !== 'in_progress') {
      return null;
    }

    return {
      taskStatus: String(task.status),
      orderStatus: String(order.status),
      plannedQty: String(material.planned_qty),
      actualQty: String(material.actual_qty),
      inventoryTxId: material.inventory_tx_id ?? null,
    };
  });
}

export async function waitForProductionTaskIssued(
  scenario: ProductionTaskIssueScenario,
): Promise<{
  issueQty: string;
  outboundTransactionNo: string;
  inboundTransactionNo: string;
  dyeLotNo: string | null;
  movementInventoryTxId: number;
}> {
  const pool = getDbPool();
  const expectedIssueQty = new Decimal(scenario.issueQty);

  return poll(async () => {
    const [txRows] = await pool.query<Array<RowDataPacket & {
      id: number;
      transactionNo: string | null;
      transactionType: string | null;
      warehouseId: number;
      warehouseCode: string | null;
      locationId: number;
      locationCode: string | null;
      qtyStockUnit: string;
      dyeLotNo: string | null;
    }>>(
      `SELECT
          it.id,
          transaction_no AS transactionNo,
          transaction_type AS transactionType,
          it.warehouse_id AS warehouseId,
          w.code AS warehouseCode,
          it.location_id AS locationId,
          l.code AS locationCode,
          CAST(it.qty_stock_unit AS CHAR) AS qtyStockUnit,
          dye_lot_no AS dyeLotNo
       FROM inventory_transactions it
       LEFT JOIN warehouses w
         ON w.id = it.warehouse_id
        AND w.tenant_id = it.tenant_id
       LEFT JOIN locations l
         ON l.id = it.location_id
        AND l.tenant_id = it.tenant_id
       WHERE it.tenant_id = ?
         AND it.reference_type = 'production_task'
         AND it.reference_id = ?
         AND it.sku_id = ?
         AND it.transaction_type IN ('PRODUCTION_ISSUE_OUT', 'PRODUCTION_ISSUE_IN')
       ORDER BY it.id ASC`,
      [TEST_TENANT_ID, scenario.taskId, scenario.materialSkuId],
    );

    const outboundTx = txRows.find((row) => row.transactionType === 'PRODUCTION_ISSUE_OUT');
    const inboundTx = txRows.find((row) => row.transactionType === 'PRODUCTION_ISSUE_IN');
    if (!outboundTx || !inboundTx) {
      return null;
    }

    const outboundQty = new Decimal(outboundTx.qtyStockUnit ?? 0);
    const inboundQty = new Decimal(inboundTx.qtyStockUnit ?? 0);
    const matchesExpectedQty = outboundQty.eq(expectedIssueQty) && inboundQty.eq(expectedIssueQty);
    const matchesSourceLocation = (
      Number(outboundTx.warehouseId) === scenario.sourceWarehouseId
      && Number(outboundTx.locationId) === scenario.sourceLocationId
    );
    const matchesWipLocation = (
      String(inboundTx.warehouseCode ?? '') === 'PROD-WIP'
      && String(inboundTx.locationCode ?? '') === 'PROD-WIP-LINE'
    );
    const matchesDyeLot = outboundTx.dyeLotNo === scenario.dyeLotNo && inboundTx.dyeLotNo === scenario.dyeLotNo;
    if (!matchesExpectedQty || !matchesSourceLocation || !matchesWipLocation || !matchesDyeLot) {
      return null;
    }

    const [movementRows] = await pool.query<Array<RowDataPacket & {
      qty: string;
      inventoryTxId: number;
    }>>(
      `SELECT
          CAST(qty AS CHAR) AS qty,
          inventory_tx_id AS inventoryTxId
       FROM task_inventory_movements
       WHERE tenant_id = ?
         AND task_id = ?
         AND sku_id = ?
         AND movement_type = 'issue'
       ORDER BY id DESC
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.taskId, scenario.materialSkuId],
    );

    const movement = movementRows[0];
    if (!movement) {
      return null;
    }

    const movementQty = new Decimal(movement.qty ?? 0);
    if (!movementQty.eq(expectedIssueQty) || Number(movement.inventoryTxId) !== Number(inboundTx.id)) {
      return null;
    }

    return {
      issueQty: scenario.issueQty,
      outboundTransactionNo: String(outboundTx.transactionNo ?? ''),
      inboundTransactionNo: String(inboundTx.transactionNo ?? ''),
      dyeLotNo: inboundTx.dyeLotNo ? String(inboundTx.dyeLotNo) : null,
      movementInventoryTxId: Number(movement.inventoryTxId),
    };
  });
}

export async function waitForProductionTaskCompleted(
  scenario: ProductionTaskCompleteScenario,
): Promise<{
  taskStatus: string;
  orderStatus: string;
  orderQtyCompleted: string;
  reportNo: string;
  qtyQualified: string;
  workHours: string;
  unitWage: string;
  wageAmount: string;
  outputSkuId: number | null;
  outputActualQty: string;
  outputInventoryTxId: number | null;
}> {
  const pool = getDbPool();

  return poll(async () => {
    const [taskRows] = await pool.query<ProductionTaskStatusRow[]>(
      `SELECT status
       FROM production_tasks
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.taskId],
    );

    const [orderRows] = await pool.query<ProductionOrderStatusRow[]>(
      `SELECT status, qty_completed
       FROM production_orders
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.productionOrderId],
    );

    const [reportRows] = await pool.query<WorkReportSnapshotRow[]>(
      `SELECT report_no, qty_qualified, work_hours, unit_wage, wage_amount
       FROM work_reports
       WHERE tenant_id = ? AND task_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.taskId],
    );

    const [outputRows] = await pool.query<TaskMaterialSnapshotRow[]>(
      `SELECT sku_id, planned_qty, actual_qty, inventory_tx_id
       FROM task_material_transactions
       WHERE tenant_id = ? AND task_id = ? AND io_type = 'output'
       ORDER BY id DESC
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.taskId],
    );

    const task = taskRows[0];
    const order = orderRows[0];
    const report = reportRows[0];
    const output = outputRows[0];
    if (!task || !order || !report || !output || task.status !== 'completed' || order.status !== 'completed') {
      return null;
    }

    return {
      taskStatus: String(task.status),
      orderStatus: String(order.status),
      orderQtyCompleted: String(order.qty_completed ?? ''),
      reportNo: String(report.report_no),
      qtyQualified: String(report.qty_qualified),
      workHours: String(report.work_hours),
      unitWage: String(report.unit_wage),
      wageAmount: String(report.wage_amount),
      outputSkuId: output.sku_id ?? null,
      outputActualQty: String(output.actual_qty),
      outputInventoryTxId: output.inventory_tx_id ?? null,
    };
  });
}

export async function waitForProductionOrderCancelled(
  scenario: ProductionOrderCancelScenario,
): Promise<{
  orderStatus: string;
  taskStatus: string;
}> {
  const pool = getDbPool();

  return poll(async () => {
    const [orderRows] = await pool.query<ProductionOrderStatusRow[]>(
      `SELECT status
       FROM production_orders
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.productionOrderId],
    );

    const [taskRows] = await pool.query<ProductionTaskStatusRow[]>(
      `SELECT status
       FROM production_tasks
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.taskId],
    );

    const order = orderRows[0];
    const task = taskRows[0];
    if (!order || !task || order.status !== 'cancelled' || task.status !== 'cancelled') {
      return null;
    }

    return {
      orderStatus: String(order.status),
      taskStatus: String(task.status),
    };
  }, 12_000, 300);
}

export async function waitForProductionOrderCreated(
  scenario: ProductionOrderCreateScenario,
): Promise<{
  orderId: number;
  workOrderNo: string;
  orderStatus: string;
  materialStatus: string;
  bomSnapshotId: number | null;
  salesOrderStatus: string;
  qtyReserved: string;
  qtyShortage: string;
  requirementStatus: string;
}> {
  const pool = getDbPool();

  return poll(async () => {
    const [orderRows] = await pool.query<Array<RowDataPacket & {
      id: number;
      work_order_no: string;
      status: string;
      material_status: string;
      bom_snapshot_id: number | null;
    }>>(
      `SELECT id, work_order_no, status, material_status, bom_snapshot_id
       FROM production_orders
       WHERE tenant_id = ? AND sales_order_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.salesOrderId],
    );

    const [salesRows] = await pool.query<Array<RowDataPacket & { status: string }>>(
      `SELECT status
       FROM sales_orders
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.salesOrderId],
    );

    const order = orderRows[0];
    const salesOrder = salesRows[0];
    if (!order || !salesOrder || salesOrder.status !== 'in_production') {
      return null;
    }

    const [materialRows] = await pool.query<Array<RowDataPacket & {
      qty_reserved: string;
      qty_shortage: string;
      status: string;
    }>>(
      `SELECT qty_reserved, qty_shortage, status
       FROM material_requirements
       WHERE tenant_id = ? AND production_order_id = ? AND sku_id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, order.id, scenario.materialSkuId],
    );

    const material = materialRows[0];
    if (!material || order.material_status !== scenario.expectedMaterialStatus) {
      return null;
    }

    return {
      orderId: order.id,
      workOrderNo: String(order.work_order_no),
      orderStatus: String(order.status),
      materialStatus: String(order.material_status),
      bomSnapshotId: order.bom_snapshot_id ?? null,
      salesOrderStatus: String(salesOrder.status),
      qtyReserved: String(material.qty_reserved),
      qtyShortage: String(material.qty_shortage),
      requirementStatus: String(material.status),
    };
  }, 12_000, 300);
}

export async function waitForProductionShortageSuggestionCreated(
  scenario: ProductionShortageScenario,
): Promise<{
  suggestionId: number;
  suggestionStatus: string;
  suggestionSource: string;
  suggestedQty: string;
  shortageQty: string;
  supplierId: number | null;
  productionOrderId: number | null;
  requirementSuggestionId: number | null;
}> {
  const pool = getDbPool();

  return poll(async () => {
    const [suggestionRows] = await pool.query<Array<RowDataPacket & {
      id: number;
      status: string;
      source: string;
      suggested_qty: string;
      shortage_qty: string;
      suggested_supplier_id: number | null;
      production_order_id: number | null;
    }>>(
      `SELECT id, status, source, suggested_qty, shortage_qty, suggested_supplier_id, production_order_id
       FROM purchase_suggestions
       WHERE tenant_id = ? AND production_order_id = ? AND sku_id = ? AND source = 'production_shortage'
       ORDER BY id DESC
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.productionOrderId, scenario.materialSkuId],
    );

    const [requirementRows] = await pool.query<Array<RowDataPacket & {
      suggestion_id: number | null;
    }>>(
      `SELECT suggestion_id
       FROM material_requirements
       WHERE tenant_id = ? AND production_order_id = ? AND sku_id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.productionOrderId, scenario.materialSkuId],
    );

    const suggestion = suggestionRows[0];
    const requirement = requirementRows[0];
    if (!suggestion || !requirement || requirement.suggestion_id !== suggestion.id || suggestion.status !== 'pending') {
      return null;
    }

    return {
      suggestionId: suggestion.id,
      suggestionStatus: String(suggestion.status),
      suggestionSource: String(suggestion.source),
      suggestedQty: String(suggestion.suggested_qty),
      shortageQty: String(suggestion.shortage_qty),
      supplierId: suggestion.suggested_supplier_id ?? null,
      productionOrderId: suggestion.production_order_id ?? null,
      requirementSuggestionId: requirement.suggestion_id ?? null,
    };
  }, 12_000, 300);
}

export async function fetchProductionScheduleSnapshot(
  scheduleDate: string,
  operationId: number,
): Promise<ProductionScheduleSnapshot | null> {
  const pool = getDbPool();
  const [rows] = await pool.query<ProductionScheduleRow[]>(
    `SELECT id, planned_qty, worker_id, workstation_id, status
     FROM production_schedules
     WHERE tenant_id = ? AND schedule_date = ? AND operation_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [TEST_TENANT_ID, scheduleDate, operationId],
  );

  if (!rows[0]) {
    return null;
  }

  return {
    scheduleId: rows[0].id,
    plannedQty: String(rows[0].planned_qty),
    workerId: rows[0].worker_id ?? null,
    workstationId: rows[0].workstation_id ?? null,
    status: String(rows[0].status),
  };
}

export async function waitForProductionSchedulePlannedQty(
  scheduleDate: string,
  operationId: number,
  plannedQty: string,
): Promise<ProductionScheduleSnapshot> {
  const expected = Number(plannedQty);
  return poll(async () => {
    const snapshot = await fetchProductionScheduleSnapshot(scheduleDate, operationId);
    if (!snapshot) return null;
    return Number(snapshot.plannedQty) === expected ? snapshot : null;
  }, 12_000, 300);
}

export async function waitForProductionScheduleConfirmed(
  scenario: ProductionScheduleScenario,
): Promise<{
  scheduleId: number;
  status: string;
  workerId: number | null;
  workstationId: number | null;
  taskId: number;
  taskNo: string;
  taskStatus: string;
  processStepId: number;
  outputSkuId: number | null;
  plannedQty: string;
}> {
  const dateToken = scenario.scheduleDate.replace(/-/g, '');
  const expectedTaskNoPrefix = `TK${dateToken}`;

  return poll(async () => {
    const schedule = await fetchProductionScheduleSnapshot(scenario.scheduleDate, scenario.currentOperationId);
    if (!schedule || schedule.status !== 'confirmed') {
      return null;
    }

    const pool = getDbPool();
    const [taskRows] = await pool.query<ConfirmedScheduleTaskRow[]>(
      `SELECT id, task_no, status, process_step_id, output_sku_id, planned_qty
       FROM production_tasks
       WHERE tenant_id = ? AND schedule_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [TEST_TENANT_ID, schedule.scheduleId],
    );

    const task = taskRows[0];
    if (!task || !String(task.task_no).startsWith(expectedTaskNoPrefix)) {
      return null;
    }

    return {
      scheduleId: schedule.scheduleId,
      status: schedule.status,
      workerId: schedule.workerId,
      workstationId: schedule.workstationId,
      taskId: task.id,
      taskNo: String(task.task_no),
      taskStatus: String(task.status),
      processStepId: task.process_step_id,
      outputSkuId: task.output_sku_id ?? null,
      plannedQty: String(task.planned_qty),
    };
  }, 12_000, 300);
}
