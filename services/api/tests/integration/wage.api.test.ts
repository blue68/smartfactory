import request from 'supertest';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import * as XLSX from 'xlsx';
import { authHeader } from '../helpers/testAuth';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';
const TEST_TENANT_ID = 9999;

const BOSS_ID = 99001;
const WORKER_SKILLED_ID = 99005;
const WORKER_APPRENTICE_ID = 995502;

const STEP_SKILLED_ID = 995801;
const STEP_APPRENTICE_ID = 995802;

const ORDER_SKILLED_ID = 995601;
const ORDER_APPRENTICE_ID = 995602;

const TASK_SKILLED_ID = 995701;
const TASK_APPRENTICE_ID = 995702;

const REPORT_SKILLED_ID = 995901;
const REPORT_APPRENTICE_ID = 995902;
const REPORT_DRAFT_ID = 995903;
const REPORT_SKILLED_DATE = '2026-05-11';
const REPORT_APPRENTICE_DATE = '2026-05-12';

let dbPool: Pool | null = null;

function getDbPool(): Pool {
  if (!dbPool) {
    dbPool = mysql.createPool({
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? '3307'),
      user: process.env.DB_USER ?? 'sf_app',
      password: process.env.DB_PASS ?? process.env.DB_PASSWORD ?? 'TestApp2026!Secure',
      database: process.env.DB_NAME ?? 'smart_factory',
      connectionLimit: 2,
      waitForConnections: true,
    });
  }
  return dbPool;
}

function binaryParser(
  res: NodeJS.ReadableStream & {
    setEncoding: (encoding: BufferEncoding) => void;
    on: (event: string, listener: (...args: any[]) => void) => void;
  },
  callback: (err: Error | null, body: Buffer) => void,
): void {
  res.setEncoding('binary');
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    callback(null, Buffer.from(data, 'binary'));
  });
}

async function resolveWorkReportSchema(pool: Pool): Promise<{
  workerColumn: 'worker_id' | 'user_id';
  stepColumn: 'process_step_id' | 'step_id';
  dateColumn: 'work_date' | 'report_date';
  qtyColumn: 'qty_completed' | 'qty';
}> {
  const [columns] = await pool.query<Array<RowDataPacket & { Field: string }>>('SHOW COLUMNS FROM work_reports');
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

describe('工资报表模块 API 集成测试', () => {
  beforeAll(async () => {
    const pool = getDbPool();
    const schema = await resolveWorkReportSchema(pool);

    await pool.execute(
      `INSERT INTO tenants (id, code, name, status, settings)
       VALUES (?, 'TEST9999', 'E2E测试租户', 'active', JSON_OBJECT())
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
        (?, ?, 'test_boss', 'integration-password', '工资老板', 'active', NULL, 99001, 99001),
        (?, ?, 'test_worker', 'integration-password', '工资熟练工', 'active', 'skilled', 99001, 99001),
        (?, ?, 'wage_apprentice', 'integration-password', '工资学徒工', 'active', 'apprentice', 99001, 99001)
       ON DUPLICATE KEY UPDATE
         username = VALUES(username),
         real_name = VALUES(real_name),
         status = VALUES(status),
         skill_level = VALUES(skill_level),
         updated_by = VALUES(updated_by)`,
      [BOSS_ID, TEST_TENANT_ID, WORKER_SKILLED_ID, TEST_TENANT_ID, WORKER_APPRENTICE_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO process_steps
        (id, tenant_id, template_id, step_no, step_name, standard_hours, workstation_type, created_by, updated_by)
       VALUES
        (?, ?, 995800, 1, '工资熟练工工序', 0.5000, 'default', 99001, 99001),
        (?, ?, 995800, 2, '工资学徒工工序', 0.7500, 'default', 99001, 99001)
       ON DUPLICATE KEY UPDATE
         step_name = VALUES(step_name),
         standard_hours = VALUES(standard_hours),
         workstation_type = VALUES(workstation_type),
         updated_by = VALUES(updated_by)`,
      [STEP_SKILLED_ID, TEST_TENANT_ID, STEP_APPRENTICE_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      'DELETE FROM work_reports WHERE tenant_id = ? AND id IN (?, ?, ?)',
      [TEST_TENANT_ID, REPORT_SKILLED_ID, REPORT_APPRENTICE_ID, REPORT_DRAFT_ID],
    );
    await pool.execute(
      'DELETE FROM production_tasks WHERE tenant_id = ? AND id IN (?, ?)',
      [TEST_TENANT_ID, TASK_SKILLED_ID, TASK_APPRENTICE_ID],
    );
    await pool.execute(
      'DELETE FROM production_orders WHERE tenant_id = ? AND id IN (?, ?)',
      [TEST_TENANT_ID, ORDER_SKILLED_ID, ORDER_APPRENTICE_ID],
    );

    await pool.execute(
      `INSERT INTO production_orders
        (id, tenant_id, work_order_no, sales_order_id, sku_id, bom_header_id, process_template_id, qty_planned, qty_completed, status, priority, created_by, updated_by)
       VALUES
        (?, ?, 'WO-WAGE-SKILLED', 1, 1, 1, 995800, 20.0000, 15.0000, 'in_progress', 50, 99001, 99001),
        (?, ?, 'WO-WAGE-APPRENTICE', 1, 1, 1, 995800, 10.0000, 8.0000, 'in_progress', 50, 99001, 99001)
       ON DUPLICATE KEY UPDATE
         work_order_no = VALUES(work_order_no),
         qty_planned = VALUES(qty_planned),
         qty_completed = VALUES(qty_completed),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [ORDER_SKILLED_ID, TEST_TENANT_ID, ORDER_APPRENTICE_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO production_tasks
        (id, tenant_id, task_no, schedule_id, production_order_id, process_step_id, worker_id, task_date, planned_qty, completed_qty, scrap_qty, status, actual_hours, created_by, updated_by)
       VALUES
        (?, ?, 'TASK-WAGE-SKILLED', 995711, ?, ?, ?, CURDATE(), 20.0000, 15.0000, 1, 'completed', 7.50, 99001, 99001),
        (?, ?, 'TASK-WAGE-APPRENTICE', 995712, ?, ?, ?, CURDATE(), 10.0000, 8.0000, 0, 'started', 4.00, 99001, 99001)
       ON DUPLICATE KEY UPDATE
         task_no = VALUES(task_no),
         completed_qty = VALUES(completed_qty),
         status = VALUES(status),
         actual_hours = VALUES(actual_hours),
         updated_by = VALUES(updated_by)`,
      [
        TASK_SKILLED_ID, TEST_TENANT_ID, ORDER_SKILLED_ID, STEP_SKILLED_ID, WORKER_SKILLED_ID,
        TASK_APPRENTICE_ID, TEST_TENANT_ID, ORDER_APPRENTICE_ID, STEP_APPRENTICE_ID, WORKER_APPRENTICE_ID,
      ],
    );

    const insertColumns = [
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

    const placeholders = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    await pool.execute(
      `INSERT INTO work_reports (${insertColumns.join(', ')})
       VALUES
        ${placeholders},
        ${placeholders},
        ${placeholders}
       ON DUPLICATE KEY UPDATE
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
        REPORT_SKILLED_ID,
        TEST_TENANT_ID,
        'WR-WAGE-SKILLED',
        WORKER_SKILLED_ID,
        ORDER_SKILLED_ID,
        TASK_SKILLED_ID,
        STEP_SKILLED_ID,
        REPORT_SKILLED_DATE,
        '15.0000',
        '14.0000',
        '1.0000',
        '7.50',
        '12.0000',
        '180.00',
        'confirmed',
        '熟练工已确认报工',
        99001,
        99001,

        REPORT_APPRENTICE_ID,
        TEST_TENANT_ID,
        'WR-WAGE-APPRENTICE',
        WORKER_APPRENTICE_ID,
        ORDER_APPRENTICE_ID,
        TASK_APPRENTICE_ID,
        STEP_APPRENTICE_ID,
        REPORT_APPRENTICE_DATE,
        '8.0000',
        '8.0000',
        '0.0000',
        '4.00',
        '9.5000',
        '76.00',
        'settled',
        '学徒工已结算报工',
        99001,
        99001,

        REPORT_DRAFT_ID,
        TEST_TENANT_ID,
        'WR-WAGE-DRAFT',
        WORKER_SKILLED_ID,
        ORDER_SKILLED_ID,
        TASK_SKILLED_ID,
        STEP_SKILLED_ID,
        REPORT_APPRENTICE_DATE,
        '2.0000',
        '2.0000',
        '0.0000',
        '1.00',
        '12.0000',
        '24.00',
        'draft',
        '草稿报工不应进入工资报表',
        99001,
        99001,
      ],
    );
  });

  afterAll(async () => {
    await dbPool?.end();
    dbPool = null;
  });

  describe('管理员工资报表 — GET /api/reports/wages', () => {
    test('boss 可按 workerGrade 查询已确认/已结算工资，草稿不返回', async () => {
      const res = await request(BASE_URL)
        .get(`/api/reports/wages?page=1&pageSize=20&workerGrade=skilled&dateFrom=${REPORT_SKILLED_DATE}&dateTo=${REPORT_SKILLED_DATE}`)
        .set(authHeader('boss'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.pageSize).toBe(20);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.list).toMatchObject([
        {
          userId: WORKER_SKILLED_ID,
          userName: 'test_worker',
          workerGrade: 'skilled',
          stepName: '工资熟练工工序',
          qty: 15,
          unitPrice: '12.0000',
          subtotal: '180.00',
        },
      ]);
    });

    test('sales 无权查看管理员工资报表 -> 403', async () => {
      const res = await request(BASE_URL)
        .get('/api/reports/wages?page=1&pageSize=20')
        .set(authHeader('sales'));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(1003);
    });
  });

  describe('任务工资明细 — GET /api/reports/wages/tasks', () => {
    test('boss 可按 productionOrderId 查询任务级工资明细', async () => {
      const res = await request(BASE_URL)
        .get(`/api/reports/wages/tasks?page=1&pageSize=20&productionOrderId=${ORDER_APPRENTICE_ID}`)
        .set(authHeader('boss'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.total).toBe(1);
      const item = res.body.data.list[0];
      expect(Number(item.reportId)).toBe(REPORT_APPRENTICE_ID);
      expect(item.reportNo).toBe('WR-WAGE-APPRENTICE');
      expect(Number(item.productionOrderId)).toBe(ORDER_APPRENTICE_ID);
      expect(item.orderNo).toBe('WO-WAGE-APPRENTICE');
      expect(Number(item.taskId)).toBe(TASK_APPRENTICE_ID);
      expect(item.taskNo).toBe('TASK-WAGE-APPRENTICE');
      expect(item.taskStatus).toBe('started');
      expect(Number(item.userId)).toBe(WORKER_APPRENTICE_ID);
      expect(item.userName).toBe('wage_apprentice');
      expect(item.workerGrade).toBe('apprentice');
      expect(item.stepName).toBe('工资学徒工工序');
      expect(item.qtyCompleted).toBe('8.0000');
      expect(item.qtyQualified).toBe('8.0000');
      expect(item.qtyDefective).toBe('0.0000');
      expect(item.workHours).toBe('4.00');
      expect(item.unitPrice).toBe('9.5000');
      expect(item.subtotal).toBe('76.00');
    });
  });

  describe('工资导出与个人工资 — GET /api/reports/wages/export | /my', () => {
    test('boss 可导出工资报表 Excel', async () => {
      const res = await request(BASE_URL)
        .get(`/api/reports/wages/export?userId=${WORKER_SKILLED_ID}&dateFrom=${REPORT_SKILLED_DATE}&dateTo=${REPORT_SKILLED_DATE}`)
        .set(authHeader('boss'))
        .buffer(true)
        .parse(binaryParser as any);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(String(res.headers['content-disposition'] ?? '')).toContain('.xlsx');
      expect(Buffer.isBuffer(res.body)).toBe(true);

      const workbook = XLSX.read(res.body, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ''];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as Array<Array<unknown>>;

      expect(rows[0]).toEqual(['工人', '技能等级', '工序', '完成数量', '单价', '小计', '日期']);
      expect(rows[1]?.[0]).toBe('test_worker');
      expect(rows[1]?.[1]).toBe('skilled');
      expect(rows[1]?.[2]).toBe('工资熟练工工序');
    });

    test('worker 仅能查看自己的已确认工资', async () => {
      const res = await request(BASE_URL)
        .get(`/api/reports/wages/my?page=1&pageSize=20&dateFrom=${REPORT_SKILLED_DATE}&dateTo=${REPORT_SKILLED_DATE}`)
        .set(authHeader('worker'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.list).toMatchObject([
        {
          userId: WORKER_SKILLED_ID,
          userName: 'test_worker',
          workerGrade: 'skilled',
          subtotal: '180.00',
        },
      ]);
    });
  });
});
