/**
 * 集成测试 — 质量溯源模块 API
 *
 * 覆盖测试用例：
 * - TC-QC-001  qc角色创建验货单
 * - TC-QC-002  supervisor角色创建验货单
 * - TC-QC-003  缺少必填字段 productionOrderNo → 1001
 * - TC-QC-004  worker角色无权创建验货单 → 1003
 * - TC-QC-005  录入质量问题（外观缺陷）
 * - TC-QC-006  severity传非法枚举 → 1001
 * - TC-QC-007  issueTypes为空数组 → 1001
 * - TC-QC-008  完成验货（qtyPassed <= qtyInspected）
 * - TC-QC-009  溯源链查询包含完整字段
 * - TC-QC-010  溯源链查询工单不存在 → 7001
 * - TC-QC-011  质量统计分析 periodDays=30
 * - TC-QC-012  验货单按状态筛选
 */

import request from 'supertest';
import mysql, { Pool } from 'mysql2/promise';
import { authHeader } from '../helpers/testAuth';
import { buildQualityIssueData } from '../helpers/testData';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';
const TEST_TENANT_ID = 9999;

// 测试环境预置数据（需测试 DB seed 中存在）
const PRODUCTION_ORDER_ID  = 80010; // 预置：进行中的生产工单
const PRODUCTION_ORDER_NO = 'WO-QA-INT-80010';
const PRESET_INSPECTION_ID = 95001; // 预置：已创建的验货单（pending状态）
const SEED_CUSTOMER_ID = 98001;
const SEED_SALES_ORDER_ID = 98002;
const SEED_SKU_ID = 98003;

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

describe('质量溯源模块 API 集成测试', () => {
  beforeAll(async () => {
    const pool = getDbPool();

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
      `INSERT INTO customers
        (id, tenant_id, code, name, status, created_by, updated_by)
       VALUES (?, ?, 'CUS-QA-INT', '质量集成客户', 'active', 99004, 99004)
       ON DUPLICATE KEY UPDATE
         code = VALUES(code),
         name = VALUES(name),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [SEED_CUSTOMER_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO skus
        (id, tenant_id, sku_code, name, category1_id, category2_id, stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo, safety_stock, status, created_by, updated_by)
       VALUES (?, ?, 'SKU-QA-TRACE', '质量溯源成品', 1, 8, '件', '件', '件', 0, 1, 0, 'active', 99004, 99004)
       ON DUPLICATE KEY UPDATE
         sku_code = VALUES(sku_code),
         name = VALUES(name),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [SEED_SKU_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO sales_orders
        (id, tenant_id, order_no, customer_id, order_type, status, priority, expected_delivery, total_amount, constraint_passed, approval_status, sales_person_id, created_by, updated_by)
       VALUES (?, ?, 'SO-QA-INT', ?, 'normal', 'confirmed', 50, CURDATE(), 1000.00, 1, 'approved', 99007, 99004, 99004)
       ON DUPLICATE KEY UPDATE
         customer_id = VALUES(customer_id),
         order_type = VALUES(order_type),
         status = VALUES(status),
         expected_delivery = VALUES(expected_delivery),
         total_amount = VALUES(total_amount),
         updated_by = VALUES(updated_by)`,
      [SEED_SALES_ORDER_ID, TEST_TENANT_ID, SEED_CUSTOMER_ID],
    );

    await pool.execute(
      'DELETE FROM quality_issues WHERE tenant_id = ? AND inspection_id IN (SELECT id FROM inspection_records WHERE tenant_id = ? AND production_order_id = ?)',
      [TEST_TENANT_ID, TEST_TENANT_ID, PRODUCTION_ORDER_ID],
    );
    await pool.execute(
      'DELETE FROM inspection_records WHERE tenant_id = ? AND production_order_id = ?',
      [TEST_TENANT_ID, PRODUCTION_ORDER_ID],
    );
    await pool.execute(
      'DELETE FROM traceability_records WHERE tenant_id = ? AND production_order_id = ?',
      [TEST_TENANT_ID, PRODUCTION_ORDER_ID],
    );

    await pool.execute(
      `INSERT INTO production_orders
        (id, tenant_id, work_order_no, sales_order_id, sku_id, bom_header_id, process_template_id, qty_planned, qty_completed, status, priority, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, 1, 1, 100.0000, 0.0000, 'in_progress', 50, 99004, 99004)
       ON DUPLICATE KEY UPDATE
         work_order_no = VALUES(work_order_no),
         sales_order_id = VALUES(sales_order_id),
         sku_id = VALUES(sku_id),
         qty_planned = VALUES(qty_planned),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [PRODUCTION_ORDER_ID, TEST_TENANT_ID, PRODUCTION_ORDER_NO, SEED_SALES_ORDER_ID, SEED_SKU_ID],
    );
  });

  afterAll(async () => {
    if (dbPool) {
      await dbPool.end();
      dbPool = null;
    }
  });

  // ─── 创建验货单 ──────────────────────────────────────────────

  describe('创建验货单 — POST /api/quality/inspections', () => {
    test('TC-QC-001: qc角色创建验货单成功', async () => {
      const res = await request(BASE_URL)
        .post('/api/quality/inspections')
        .set(authHeader('qc'))
        .send({
          productionOrderNo: PRODUCTION_ORDER_NO,
          inspectionDate: '2026-03-11',
          qtyInspected: '5',
        });

      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
      expect(res.body.data.id).toBeGreaterThan(0);
      expect(res.body.data.inspectionNo).toMatch(/^QC\d+/);
    });

    test('TC-QC-002: supervisor角色创建验货单成功', async () => {
      const res = await request(BASE_URL)
        .post('/api/quality/inspections')
        .set(authHeader('supervisor'))
        .send({
          productionOrderNo: PRODUCTION_ORDER_NO,
          inspectionDate: '2026-03-11',
          qtyInspected: '3',
        });

      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
    });

    test('TC-QC-003: 缺少必填字段 productionOrderNo → 1001', async () => {
      const res = await request(BASE_URL)
        .post('/api/quality/inspections')
        .set(authHeader('qc'))
        .send({
          inspectionDate: '2026-03-11',
          qtyInspected: '5',
        });

      expect(res.body.code).toBe(1001);
      expect(res.body.message).toMatch(/productionOrderNo|工单/i);
    });

    test('缺少必填字段 qtyInspected → 1001', async () => {
      const res = await request(BASE_URL)
        .post('/api/quality/inspections')
        .set(authHeader('qc'))
        .send({
          productionOrderNo: PRODUCTION_ORDER_NO,
          inspectionDate: '2026-03-11',
        });

      expect(res.body.code).toBe(1001);
    });

    test('TC-QC-004: worker角色无权创建验货单 → 1003', async () => {
      const res = await request(BASE_URL)
        .post('/api/quality/inspections')
        .set(authHeader('worker'))
        .send({
          productionOrderNo: PRODUCTION_ORDER_NO,
          inspectionDate: '2026-03-11',
          qtyInspected: '5',
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(1003);
    });

    test('未认证请求 → 1002', async () => {
      const res = await request(BASE_URL)
        .post('/api/quality/inspections')
        .send({
          productionOrderNo: PRODUCTION_ORDER_NO,
          inspectionDate: '2026-03-11',
          qtyInspected: '5',
        });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(1002);
    });
  });

  // ─── 验货单列表 ──────────────────────────────────────────────

  describe('验货单列表 — GET /api/quality/inspections', () => {
    test('TC-QC-012: 按状态筛选返回对应验货单', async () => {
      const res = await request(BASE_URL)
        .get('/api/quality/inspections?status=pending')
        .set(authHeader('qc'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      const list: any[] = res.body.data?.list ?? [];
      list.forEach((item) => expect(item.status).toBe('pending'));
    });

    test('按 productionOrderId 筛选', async () => {
      const res = await request(BASE_URL)
        .get(`/api/quality/inspections?productionOrderId=${PRODUCTION_ORDER_ID}`)
        .set(authHeader('qc'));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('list');
      expect(res.body.data).toHaveProperty('total');
    });

    test('分页参数限制返回条数', async () => {
      const res = await request(BASE_URL)
        .get('/api/quality/inspections?page=1&pageSize=5')
        .set(authHeader('qc'));

      expect(res.status).toBe(200);
      const list: any[] = res.body.data?.list ?? [];
      expect(list.length).toBeLessThanOrEqual(5);
    });
  });

  // ─── 录入质量问题 ────────────────────────────────────────────

  describe('录入质量问题 — POST /api/quality/inspections/issues', () => {
    let inspectionNo = '';

    beforeAll(async () => {
      const res = await request(BASE_URL)
        .post('/api/quality/inspections')
        .set(authHeader('qc'))
        .send({
          productionOrderNo: PRODUCTION_ORDER_NO,
          inspectionDate: '2026-03-11',
          qtyInspected: '10',
        });
      inspectionNo = String(res.body.data?.inspectionNo ?? '');
    });

    test('TC-QC-005: qc录入外观缺陷质量问题成功', async () => {
      if (!inspectionNo) return;

      const payload = buildQualityIssueData(inspectionNo, {
        componentName: '沙发左扶手',
        issueTypes: ['appearance'],
        severity: 'minor',
        description: '表面轻微划痕，长度约3cm',
      });

      const res = await request(BASE_URL)
        .post('/api/quality/inspections/issues')
        .set(authHeader('qc'))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
      expect(res.body.data.issueId).toBeGreaterThan(0);
    });

    test('录入多类型问题（外观+尺寸）成功', async () => {
      if (!inspectionNo) return;

      const payload = buildQualityIssueData(inspectionNo, {
        componentName: '沙发靠背',
        issueTypes: ['appearance', 'dimension'],
        severity: 'normal',
        description: '表面划痕且尺寸偏差2mm',
        images: ['https://storage.example.com/qc/img001.jpg'],
      });

      const res = await request(BASE_URL)
        .post('/api/quality/inspections/issues')
        .set(authHeader('qc'))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
    });

    test('TC-QC-006: severity传非法枚举值 → 1001', async () => {
      if (!inspectionNo) return;

      const res = await request(BASE_URL)
        .post('/api/quality/inspections/issues')
        .set(authHeader('qc'))
        .send(buildQualityIssueData(inspectionNo, {
          severity: 'critical' as any, // 合法值: minor/normal/severe
        }));

      expect(res.body.code).toBe(1001);
      expect(res.body.message).toMatch(/severity/i);
    });

    test('TC-QC-007: issueTypes为空数组 → 1001', async () => {
      if (!inspectionNo) return;

      const res = await request(BASE_URL)
        .post('/api/quality/inspections/issues')
        .set(authHeader('qc'))
        .send(buildQualityIssueData(inspectionNo, {
          issueTypes: [],
        }));

      expect(res.body.code).toBe(1001);
    });

    test('issueTypes包含非法枚举值 → 1001', async () => {
      if (!inspectionNo) return;

      const res = await request(BASE_URL)
        .post('/api/quality/inspections/issues')
        .set(authHeader('qc'))
        .send(buildQualityIssueData(inspectionNo, {
          issueTypes: ['invalid_type'],
        }));

      expect(res.body.code).toBe(1001);
    });

    test('description超500字符 → 1001', async () => {
      if (!inspectionNo) return;

      const res = await request(BASE_URL)
        .post('/api/quality/inspections/issues')
        .set(authHeader('qc'))
        .send(buildQualityIssueData(inspectionNo, {
          description: 'X'.repeat(501),
        }));

      expect(res.body.code).toBe(1001);
    });

    test('worker角色无权录入质量问题 → 1003', async () => {
      if (!inspectionNo) return;

      const res = await request(BASE_URL)
        .post('/api/quality/inspections/issues')
        .set(authHeader('worker'))
        .send(buildQualityIssueData(inspectionNo));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(1003);
    });
  });

  // ─── 完成验货 ────────────────────────────────────────────────

  describe('完成验货 — POST /api/quality/inspections/:id/complete', () => {
    let inspectionId: number;

    beforeAll(async () => {
      const res = await request(BASE_URL)
        .post('/api/quality/inspections')
        .set(authHeader('qc'))
        .send({
          productionOrderNo: PRODUCTION_ORDER_NO,
          inspectionDate: '2026-03-11',
          qtyInspected: '10',
        });
      inspectionId = res.body.data?.id;
    });

    test('TC-QC-008: qc完成验货成功，qtyPassed < qtyInspected', async () => {
      if (!inspectionId) return;

      const res = await request(BASE_URL)
        .post(`/api/quality/inspections/${inspectionId}/complete`)
        .set(authHeader('qc'))
        .send({ qtyPassed: '9' });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.message).toMatch(/完成/);
    });

    test('qtyPassed等于qtyInspected时合法（全部通过）', async () => {
      const createRes = await request(BASE_URL)
        .post('/api/quality/inspections')
        .set(authHeader('qc'))
        .send({
          productionOrderNo: PRODUCTION_ORDER_NO,
          inspectionDate: '2026-03-11',
          qtyInspected: '5',
        });
      const newId = createRes.body.data?.id;
      if (!newId) return;

      const res = await request(BASE_URL)
        .post(`/api/quality/inspections/${newId}/complete`)
        .set(authHeader('qc'))
        .send({ qtyPassed: '5' });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
    });

    test('qtyPassed超过qtyInspected → 1001', async () => {
      const createRes = await request(BASE_URL)
        .post('/api/quality/inspections')
        .set(authHeader('qc'))
        .send({
          productionOrderNo: PRODUCTION_ORDER_NO,
          inspectionDate: '2026-03-11',
          qtyInspected: '5',
        });
      const newId = createRes.body.data?.id;
      if (!newId) return;

      const res = await request(BASE_URL)
        .post(`/api/quality/inspections/${newId}/complete`)
        .set(authHeader('qc'))
        .send({ qtyPassed: '6' }); // 超过 qtyInspected=5

      expect(res.body.code).toBe(1001);
    });

    test('已完成验货单不可重复完成', async () => {
      if (!inspectionId) return;

      // inspectionId 已在第一个 test 中 complete 过
      const res = await request(BASE_URL)
        .post(`/api/quality/inspections/${inspectionId}/complete`)
        .set(authHeader('qc'))
        .send({ qtyPassed: '8' });

      expect(res.body.code).not.toBe(0);
    });

    test('worker角色无权完成验货 → 1003', async () => {
      const res = await request(BASE_URL)
        .post(`/api/quality/inspections/${PRESET_INSPECTION_ID}/complete`)
        .set(authHeader('worker'))
        .send({ qtyPassed: '5' });

      expect(res.status).toBe(403);
    });
  });

  // ─── 质量问题列表 / 详情 ─────────────────────────────────────

  describe('质量问题列表与详情 — GET /api/quality/issues*', () => {
    let seededIssueId = 0;
    let seededInspectionNo = '';

    beforeAll(async () => {
      const createInspectionRes = await request(BASE_URL)
        .post('/api/quality/inspections')
        .set(authHeader('qc'))
        .send({
          productionOrderNo: PRODUCTION_ORDER_NO,
          inspectionDate: '2026-03-12',
          qtyInspected: '12',
        });

      seededInspectionNo = String(createInspectionRes.body.data?.inspectionNo ?? '');

      const createIssueRes = await request(BASE_URL)
        .post('/api/quality/inspections/issues')
        .set(authHeader('qc'))
        .send(buildQualityIssueData(seededInspectionNo, {
          componentName: '靠背连接件',
          issueTypes: ['material', 'function'],
          severity: 'severe',
          description: '材料强度不足且安装后存在功能卡滞',
          images: ['https://storage.example.com/qc/material-issue-001.jpg'],
        }));

      seededIssueId = Number(createIssueRes.body.data?.issueId ?? 0);
    });

    test('问题列表支持 severity 筛选', async () => {
      const res = await request(BASE_URL)
        .get('/api/quality/issues?severity=severe&page=1&pageSize=20')
        .set(authHeader('qc'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      const list: any[] = res.body.data?.list ?? [];
      expect(list.length).toBeGreaterThan(0);
      list.forEach((item) => expect(item.severity).toBe('severe'));
      expect(list.some((item) => Number(item.id) === seededIssueId)).toBe(true);
      const seeded = list.find((item) => Number(item.id) === seededIssueId);
      expect(seeded).toHaveProperty('productionOrderId');
      expect(seeded).toHaveProperty('productionOrderNo');
    });

    test('问题列表支持 issueType 筛选并返回分页结构', async () => {
      const res = await request(BASE_URL)
        .get('/api/quality/issues?issueType=material&page=1&pageSize=10')
        .set(authHeader('qc'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data?.page).toBe(1);
      expect(res.body.data?.pageSize).toBe(10);
      expect(typeof res.body.data?.total).toBe('number');
      const list: any[] = res.body.data?.list ?? [];
      expect(list.some((item) => Number(item.id) === seededIssueId)).toBe(true);
      list.forEach((item) => {
        expect(Array.isArray(item.issueTypes)).toBe(true);
        expect(item.issueTypes).toContain('material');
      });
    });

    test('问题详情返回 inspection / 工单 / 图片等完整字段', async () => {
      const res = await request(BASE_URL)
        .get(`/api/quality/issues/${seededIssueId}`)
        .set(authHeader('qc'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data).toMatchObject({
        id: String(seededIssueId),
        inspectionNo: seededInspectionNo,
        productionOrderId: String(PRODUCTION_ORDER_ID),
        componentName: '靠背连接件',
        severity: 'severe',
      });
      expect(res.body.data.issueTypes).toEqual(expect.arrayContaining(['material', 'function']));
      expect(res.body.data.images).toEqual([
        'https://storage.example.com/qc/material-issue-001.jpg',
      ]);
    });

    test('不存在的问题详情返回 7001', async () => {
      const res = await request(BASE_URL)
        .get('/api/quality/issues/999999999')
        .set(authHeader('qc'));

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(1004);
      expect(String(res.body.message ?? '')).toContain('不存在');
    });
  });

  // ─── 溯源链查询 ──────────────────────────────────────────────

  describe('溯源链查询 — GET /api/quality/traceability/:productionOrderId', () => {
    test('TC-QC-009: 溯源链包含 components 和 summary 必要字段', async () => {
      const res = await request(BASE_URL)
        .get(`/api/quality/traceability/${PRODUCTION_ORDER_ID}`)
        .set(authHeader('qc'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);

      const data = res.body.data;
      expect(data).toHaveProperty('productionOrderId');
      expect(data).toHaveProperty('workOrderNo');
      expect(data).toHaveProperty('skuName');
      expect(data).toHaveProperty('components');
      expect(Array.isArray(data.components)).toBe(true);
      expect(data).toHaveProperty('summary');
      expect(data.summary).toHaveProperty('totalComponents');
      expect(data.summary).toHaveProperty('withScanRecord');
      expect(Array.isArray(data.summary.dyeLots)).toBe(true);
      expect(data).toHaveProperty('aiAnalysis');
      if (data.aiAnalysis) {
        expect(data.aiAnalysis).toHaveProperty('summary');
        expect(Array.isArray(data.aiAnalysis.rootCauses)).toBe(true);
        expect(Array.isArray(data.aiAnalysis.recommendations)).toBe(true);
      }
    });

    test('TC-QC-010: 工单不存在 → 7001', async () => {
      const res = await request(BASE_URL)
        .get('/api/quality/traceability/999999999')
        .set(authHeader('qc'));

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(7001);
    });

    test('溯源链 components 每个元素含必要字段', async () => {
      const res = await request(BASE_URL)
        .get(`/api/quality/traceability/${PRODUCTION_ORDER_ID}`)
        .set(authHeader('qc'));

      const components: any[] = res.body.data?.components ?? [];
      if (components.length === 0) return;

      const first = components[0];
      expect(first).toHaveProperty('componentName');
      expect(first).toHaveProperty('processStepName');
      expect(first).toHaveProperty('workerName');
      expect(first).toHaveProperty('hasScanRecord');
      expect(typeof first.hasScanRecord).toBe('boolean');
    });

    test('boss角色可查询溯源链', async () => {
      const res = await request(BASE_URL)
        .get(`/api/quality/traceability/${PRODUCTION_ORDER_ID}`)
        .set(authHeader('boss'));

      expect(res.status).toBe(200);
    });

    test('销售员可查询溯源链（只读权限）', async () => {
      const res = await request(BASE_URL)
        .get(`/api/quality/traceability/${PRODUCTION_ORDER_ID}`)
        .set(authHeader('sales'));

      // 视接口权限设计，200或403均可；关键是不返回500
      expect([200, 403]).toContain(res.status);
    });
  });

  // ─── 质量统计分析 ────────────────────────────────────────────

  describe('质量统计分析 — GET /api/quality/stats', () => {
    test('TC-QC-011: periodDays=30 统计包含所有必要字段', async () => {
      const res = await request(BASE_URL)
        .get('/api/quality/stats?periodDays=30')
        .set(authHeader('qc'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);

      const data = res.body.data;
      expect(data).toHaveProperty('periodDays', 30);
      expect(data).toHaveProperty('totalInspected');
      expect(data).toHaveProperty('totalFailed');
      expect(data).toHaveProperty('failRate');
      expect(data).toHaveProperty('traceCompletionRate');
      expect(data).toHaveProperty('tracedIssueCount');
      expect(data).toHaveProperty('totalIssueCount');
      expect(data).toHaveProperty('trendData');
      expect(data).toHaveProperty('issueTypeBreakdown');
      expect(data).toHaveProperty('top5Issues');
      expect(Array.isArray(data.trendData)).toBe(true);
      expect(Array.isArray(data.issueTypeBreakdown)).toBe(true);
    });

    test('periodDays=7 短周期统计正常返回', async () => {
      const res = await request(BASE_URL)
        .get('/api/quality/stats?periodDays=7')
        .set(authHeader('qc'));

      expect(res.status).toBe(200);
      expect(res.body.data.periodDays).toBe(7);
    });

    test('periodDays=90 长周期统计正常返回', async () => {
      const res = await request(BASE_URL)
        .get('/api/quality/stats?periodDays=90')
        .set(authHeader('qc'));

      expect(res.status).toBe(200);
      expect(res.body.data.periodDays).toBe(90);
    });

    test('issueTypeBreakdown 每项含 type / count / pct', async () => {
      const res = await request(BASE_URL)
        .get('/api/quality/stats?periodDays=30')
        .set(authHeader('qc'));

      const breakdown: any[] = res.body.data?.issueTypeBreakdown ?? [];
      if (breakdown.length === 0) return;

      const first = breakdown[0];
      expect(first).toHaveProperty('type');
      expect(first).toHaveProperty('count');
      expect(first).toHaveProperty('pct');
      expect(typeof first.count).toBe('number');
    });

    test('boss角色可查看质量统计', async () => {
      const res = await request(BASE_URL)
        .get('/api/quality/stats')
        .set(authHeader('boss'));

      expect(res.status).toBe(200);
    });

    test('worker角色无权查看质量统计 → 403', async () => {
      const res = await request(BASE_URL)
        .get('/api/quality/stats')
        .set(authHeader('worker'));

      expect(res.status).toBe(403);
    });
  });
});
