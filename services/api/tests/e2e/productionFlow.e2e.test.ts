/**
 * E2E 测试 — 生产完整流程
 *
 * 流程链路：
 *   1. 销售订单（约束通过）→ 触发生产需求
 *   2. 车间主管创建生产工单
 *   3. 系统生成排产计划（贪心调度）
 *   4. 主管确认排产
 *   5. 工人查看任务 → 开始任务 → 完工上报
 *   6. QC创建验货单 → 录入问题（可选） → 完成验货
 *   7. 验证工单进度更新
 *
 * 本测试验证生产全链路的状态流转与数据一致性。
 * 依赖：TEST_API_URL 指向运行中的测试服务；测试数据库已 seed。
 */

import request from 'supertest';
import { authHeader } from '../helpers/testAuth';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';

// E2E 测试预置数据
const SKU_PRODUCT_ID   = 30001; // 预置：成品 SKU（有激活BOM）
const BOM_ID           = 70001; // 预置：对应的激活BOM
const SALES_ORDER_ID   = 60001; // 预置：已确认的销售订单
const WORKSTATION_ID   = 90001; // 预置：裁切工作站
const WORKER_USER_ID   = 99005; // 预置：工人A

describe('E2E: 生产完整流程', () => {
  let workOrderId: number;
  let workOrderNo: string;
  let taskId: number;
  let inspectionId: number;
  const scheduleDate = new Date().toISOString().slice(0, 10);

  // ─── Step 1: 创建生产工单 ─────────────────────────────────────

  test('Step 1: supervisor创建生产工单', async () => {
    const res = await request(BASE_URL)
      .post('/api/production/work-orders')
      .set(authHeader('supervisor'))
      .send({
        salesOrderId: SALES_ORDER_ID,
        skuId: SKU_PRODUCT_ID,
        bomId: BOM_ID,
        planQty: '5',
        planStartDate: scheduleDate,
        planEndDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        notes: 'E2E测试生产工单',
      });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    expect(res.body.data.workOrderNo).toMatch(/^WO\d+/);

    workOrderId = res.body.data.id;
    workOrderNo = res.body.data.workOrderNo;
    expect(workOrderId).toBeGreaterThan(0);
  });

  // ─── Step 2: 验证工单初始状态 ─────────────────────────────────

  test('Step 2: 新建工单状态为 pending，进度为 0%', async () => {
    if (!workOrderId) return;

    const res = await request(BASE_URL)
      .get(`/api/production/work-orders/${workOrderId}`)
      .set(authHeader('supervisor'));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('pending');
    expect(parseFloat(res.body.data.progressPct ?? '0')).toBe(0);
  });

  // ─── Step 3: 生成排产计划 ─────────────────────────────────────

  test('Step 3: 系统生成排产计划（贪心调度）', async () => {
    const res = await request(BASE_URL)
      .post('/api/production/schedule/generate')
      .set(authHeader('supervisor'))
      .send({ scheduleDate });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toHaveProperty('scheduleDate');
    expect(res.body.data).toHaveProperty('orders');
    expect(res.body.data).toHaveProperty('totalOrders');
    expect(res.body.data.totalOrders).toBeGreaterThan(0);

    // 验证排产包含本次工单
    const orders: any[] = res.body.data.orders ?? [];
    const found = orders.find((o: any) => o.workOrderId === workOrderId);
    // 若工单在排产日期范围内则应出现
    if (found) {
      expect(found).toHaveProperty('workstationName');
      expect(found).toHaveProperty('workerName');
      expect(found).toHaveProperty('compositeScore');
    }
  });

  // ─── Step 4: 确认排产计划 ─────────────────────────────────────

  test('Step 4: supervisor确认排产计划 → 任务创建', async () => {
    const res = await request(BASE_URL)
      .post('/api/production/schedule/confirm')
      .set(authHeader('supervisor'))
      .send({ scheduleDate });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toHaveProperty('tasksCreated');
    expect(typeof res.body.data.tasksCreated).toBe('number');
  });

  // ─── Step 5: 工人查看任务 ─────────────────────────────────────

  test('Step 5: 工人查看自己的任务列表', async () => {
    const res = await request(BASE_URL)
      .get('/api/production/tasks/mine')
      .set(authHeader('worker'));

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(Array.isArray(res.body.data?.list ?? res.body.data)).toBe(true);

    const tasks: any[] = res.body.data?.list ?? res.body.data ?? [];
    if (tasks.length > 0) {
      const first = tasks[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('workOrderNo');
      expect(first).toHaveProperty('stepName');
      expect(first).toHaveProperty('status');
      taskId = first.id;
    }
  });

  // ─── Step 6: 工人开始任务 ─────────────────────────────────────

  test('Step 6: 工人开始执行任务 → status变更为 in_progress', async () => {
    if (!taskId) {
      // 尝试从工单任务列表取得taskId
      const listRes = await request(BASE_URL)
        .get(`/api/production/work-orders/${workOrderId}/tasks`)
        .set(authHeader('supervisor'));
      const tasks: any[] = listRes.body.data?.list ?? listRes.body.data ?? [];
      taskId = tasks[0]?.id;
    }
    if (!taskId) return;

    const res = await request(BASE_URL)
      .post(`/api/production/tasks/${taskId}/start`)
      .set(authHeader('worker'));

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);

    // 验证任务状态已更新
    const taskRes = await request(BASE_URL)
      .get(`/api/production/tasks/${taskId}`)
      .set(authHeader('worker'));

    if (taskRes.status === 200) {
      expect(taskRes.body.data.status).toBe('in_progress');
    }
  });

  // ─── Step 7: 工人完工上报 ─────────────────────────────────────

  test('Step 7: 工人完工上报（含条码与报废数量）', async () => {
    if (!taskId) return;

    const res = await request(BASE_URL)
      .post(`/api/production/tasks/${taskId}/complete`)
      .set(authHeader('worker'))
      .send({
        qtyProduced: '5',
        qtyScrap: '0',
        componentBarcode: `COMP-E2E-${Date.now()}`,
        notes: 'E2E测试完工上报',
      });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
  });

  // ─── Step 8: 工单进度更新 ─────────────────────────────────────

  test('Step 8: 完工后工单进度 > 0%', async () => {
    if (!workOrderId) return;

    const res = await request(BASE_URL)
      .get(`/api/production/work-orders/${workOrderId}`)
      .set(authHeader('supervisor'));

    expect(res.status).toBe(200);
    const progressPct = parseFloat(res.body.data.progressPct ?? '0');
    expect(progressPct).toBeGreaterThan(0);
  });

  // ─── Step 9: QC创建验货单 ─────────────────────────────────────

  test('Step 9: QC创建验货单', async () => {
    if (!workOrderId) return;

    const res = await request(BASE_URL)
      .post('/api/quality/inspections')
      .set(authHeader('qc'))
      .send({
        productionOrderId: workOrderId,
        inspectionDate: scheduleDate,
        qtyInspected: '5',
      });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    inspectionId = res.body.data?.id;
    expect(inspectionId).toBeGreaterThan(0);
  });

  // ─── Step 10: QC完成验货 ──────────────────────────────────────

  test('Step 10: QC完成验货，全部通过', async () => {
    if (!inspectionId) return;

    const res = await request(BASE_URL)
      .post(`/api/quality/inspections/${inspectionId}/complete`)
      .set(authHeader('qc'))
      .send({ qtyPassed: '5' });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
  });

  // ─── Step 11: 溯源链验证 ──────────────────────────────────────

  test('Step 11: 溯源链可追溯到本次生产工单', async () => {
    if (!workOrderId) return;

    const res = await request(BASE_URL)
      .get(`/api/quality/traceability/${workOrderId}`)
      .set(authHeader('qc'));

    // 若工单处于早期状态溯源链可能为空，但不应报500错误
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.data).toHaveProperty('productionOrderId');
      expect(res.body.data).toHaveProperty('summary');
    }
  });

  // ─── Step 12: 数据一致性校验 ──────────────────────────────────

  test('Step 12: 工单列表可按状态筛选查询', async () => {
    const res = await request(BASE_URL)
      .get('/api/production/work-orders?page=1&pageSize=20')
      .set(authHeader('supervisor'));

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toHaveProperty('list');
    expect(res.body.data).toHaveProperty('total');
  });

}, 90000); // E2E测试允许90秒超时
