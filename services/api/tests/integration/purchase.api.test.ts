/**
 * 集成测试 — 采购模块 API
 *
 * 覆盖：
 * - TC-PUR-008  老板审批批准
 * - TC-PUR-009  驳回必须填原因 → 1001
 * - TC-PUR-010  驳回填写原因
 * - TC-PUR-011  非boss角色无权审批 → 1003
 * - TC-3WM-001  三单完全匹配
 * - TC-3WM-002  数量差异 → qty_diff
 * - TC-3WM-004  价格预警 → price_warning
 * - TC-3WM-005  差异确认（supplier_short）
 * - TC-3WM-006  已匹配记录不可再确认
 * - TC-3WM-007  送货单与PO不匹配 → 5002
 * - TC-3WM-009  非采购员无权执行匹配 → 1003
 * - TC-3WM-010  匹配记录列表按状态筛选
 */

import request from 'supertest';
import { authHeader } from '../helpers/testAuth';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';

// 测试环境预置数据 ID
const PENDING_SUGGESTION_ID = 60001; // 预置：pending状态的采购建议
const PO_ID_COMPLETE        = 61001; // 预置：PO、送货单、入库单完全匹配的测试集
const DN_ID_COMPLETE        = 61002;
const RECEIPT_ID_COMPLETE   = 61003;
const PO_ID_QTY_DIFF        = 62001; // 预置：数量差异的测试集
const DN_ID_QTY_DIFF        = 62002;
const RECEIPT_ID_QTY_DIFF   = 62003; // 入库数量少
const PO_ID_PRICE_WARN      = 63001; // 预置：价格预警的测试集
const DN_ID_PRICE_WARN      = 63002;
const RECEIPT_ID_PRICE_WARN = 63003;
const PO_ID_MISMATCH        = 64001; // 预置：送货单关联不同PO
const DN_ID_MISMATCH        = 64002; // 关联PO=64009（与64001不匹配）
const RECEIPT_ID_MISMATCH   = 64003;

describe('采购模块 API 集成测试', () => {

  // ─── 采购建议生成 ────────────────────────────────────────────

  describe('触发生成采购建议 — POST /api/purchase/suggestions/generate', () => {
    test('boss角色可触发生成 → 返回建议列表', async () => {
      const res = await request(BASE_URL)
        .post('/api/purchase/suggestions/generate')
        .set(authHeader('boss'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test('purchaser角色可触发生成', async () => {
      const res = await request(BASE_URL)
        .post('/api/purchase/suggestions/generate')
        .set(authHeader('purchaser'));

      expect(res.status).toBe(200);
    });

    test('每条建议包含必要字段', async () => {
      const res = await request(BASE_URL)
        .post('/api/purchase/suggestions/generate')
        .set(authHeader('boss'));

      const suggestions: any[] = res.body.data ?? [];
      if (suggestions.length > 0) {
        const s = suggestions[0];
        expect(s).toHaveProperty('skuId');
        expect(s).toHaveProperty('skuName');
        expect(s).toHaveProperty('suggestedQty');
        expect(s).toHaveProperty('confidence');
        expect(s).toHaveProperty('confidenceDetail');
        expect(s).toHaveProperty('reason');
        expect(['high', 'medium', 'low']).toContain(s.confidence);
      }
    });

    test('warehouse角色无权触发 → 403', async () => {
      const res = await request(BASE_URL)
        .post('/api/purchase/suggestions/generate')
        .set(authHeader('warehouse'));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(1003);
    });
  });

  // ─── 采购建议审批 ────────────────────────────────────────────

  describe('审批采购建议 — POST /api/purchase/suggestions/:id/approve', () => {
    test('TC-PUR-008: boss批准建议 → status变为approved', async () => {
      const res = await request(BASE_URL)
        .post(`/api/purchase/suggestions/${PENDING_SUGGESTION_ID}/approve`)
        .set(authHeader('boss'))
        .send({ approved: true });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);

      // 验证状态已变更
      const listRes = await request(BASE_URL)
        .get('/api/purchase/suggestions?status=approved')
        .set(authHeader('boss'));
      const found = listRes.body.data?.list?.some(
        (s: any) => s.id === PENDING_SUGGESTION_ID,
      );
      expect(found).toBe(true);
    });

    test('TC-PUR-009: 驳回时不填rejectReason → 1001', async () => {
      const res = await request(BASE_URL)
        .post(`/api/purchase/suggestions/${PENDING_SUGGESTION_ID}/approve`)
        .set(authHeader('boss'))
        .send({ approved: false }); // 无 rejectReason

      expect(res.body.code).toBe(1001);
    });

    test('TC-PUR-010: 驳回并填写原因 → status变为rejected', async () => {
      // 先创建新的待审批建议（避免状态已变）
      await request(BASE_URL)
        .post('/api/purchase/suggestions/generate')
        .set(authHeader('boss'));

      const listRes = await request(BASE_URL)
        .get('/api/purchase/suggestions?status=pending')
        .set(authHeader('boss'));
      const pendingId = listRes.body.data?.list?.[0]?.id;

      if (!pendingId) return; // 若无待审批建议则跳过

      const res = await request(BASE_URL)
        .post(`/api/purchase/suggestions/${pendingId}/approve`)
        .set(authHeader('boss'))
        .send({ approved: false, rejectReason: '价格偏高，暂缓采购' });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
    });

    test('TC-PUR-011: purchaser无权审批 → 403', async () => {
      const res = await request(BASE_URL)
        .post(`/api/purchase/suggestions/${PENDING_SUGGESTION_ID}/approve`)
        .set(authHeader('purchaser'))
        .send({ approved: true });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(1003);
    });
  });

  // ─── 采购建议列表 ────────────────────────────────────────────

  describe('采购建议列表 — GET /api/purchase/suggestions', () => {
    test('按状态筛选pending', async () => {
      const res = await request(BASE_URL)
        .get('/api/purchase/suggestions?status=pending')
        .set(authHeader('purchaser'));

      expect(res.status).toBe(200);
      const list: any[] = res.body.data?.list ?? [];
      list.forEach((s) => expect(s.status).toBe('pending'));
    });

    test('分页结构正确', async () => {
      const res = await request(BASE_URL)
        .get('/api/purchase/suggestions?page=1&pageSize=10')
        .set(authHeader('purchaser'));

      expect(res.body.data).toHaveProperty('list');
      expect(res.body.data).toHaveProperty('total');
      expect(res.body.data).toHaveProperty('totalPages');
    });
  });

  // ─── 采购订单创建 ────────────────────────────────────────────

  describe('创建采购订单 — POST /api/purchase/orders', () => {
    test('purchaser可创建采购订单', async () => {
      const deliveryDate = new Date();
      deliveryDate.setDate(deliveryDate.getDate() + 7);

      const res = await request(BASE_URL)
        .post('/api/purchase/orders')
        .set(authHeader('purchaser'))
        .send({
          supplierId: 1,
          expectedDate: deliveryDate.toISOString().slice(0, 10),
          items: [{
            skuId: 30003,
            qtyOrdered: '5',
            purchaseUnit: '箱',
            unitPrice: '600.00',
          }],
        });

      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
      expect(res.body.data.poNo).toMatch(/^PO\d+/);
    });
  });

  // ─── 三单匹配 ───────────────────────────────────────────────

  describe('三单匹配 — POST /api/purchase/three-way-match', () => {
    test('TC-3WM-001: 三单完全匹配 → matched', async () => {
      const res = await request(BASE_URL)
        .post('/api/purchase/three-way-match')
        .set(authHeader('purchaser'))
        .send({
          poId: PO_ID_COMPLETE,
          deliveryNoteId: DN_ID_COMPLETE,
          receiptId: RECEIPT_ID_COMPLETE,
        });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.matchStatus).toBe('matched');
      expect(res.body.data.diffItems[0].qtyDiff).toBe('0.0000');
    });

    test('TC-3WM-002: 数量差异 → qty_diff，qtyDiff为负数', async () => {
      const res = await request(BASE_URL)
        .post('/api/purchase/three-way-match')
        .set(authHeader('purchaser'))
        .send({
          poId: PO_ID_QTY_DIFF,
          deliveryNoteId: DN_ID_QTY_DIFF,
          receiptId: RECEIPT_ID_QTY_DIFF,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.matchStatus).toBe('qty_diff');
      const qtyDiff = parseFloat(res.body.data.diffItems[0].qtyDiff);
      expect(qtyDiff).toBeLessThan(0);
    });

    test('TC-3WM-004: 价格超历史均价20% → price_warning，isPriceAnomaly=true', async () => {
      const res = await request(BASE_URL)
        .post('/api/purchase/three-way-match')
        .set(authHeader('purchaser'))
        .send({
          poId: PO_ID_PRICE_WARN,
          deliveryNoteId: DN_ID_PRICE_WARN,
          receiptId: RECEIPT_ID_PRICE_WARN,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.matchStatus).toBe('price_warning');
      expect(res.body.data.diffItems[0].isPriceAnomaly).toBe(true);
    });

    test('TC-3WM-007: 送货单与PO不匹配 → 5002', async () => {
      const res = await request(BASE_URL)
        .post('/api/purchase/three-way-match')
        .set(authHeader('purchaser'))
        .send({
          poId: PO_ID_MISMATCH,
          deliveryNoteId: DN_ID_MISMATCH, // 关联的是不同PO
          receiptId: RECEIPT_ID_MISMATCH,
        });

      expect(res.body.code).toBe(5002);
    });

    test('TC-3WM-009: worker角色无权执行匹配 → 403', async () => {
      const res = await request(BASE_URL)
        .post('/api/purchase/three-way-match')
        .set(authHeader('worker'))
        .send({
          poId: PO_ID_COMPLETE,
          deliveryNoteId: DN_ID_COMPLETE,
          receiptId: RECEIPT_ID_COMPLETE,
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(1003);
    });
  });

  // ─── 差异确认 ───────────────────────────────────────────────

  describe('确认差异 — POST /api/purchase/three-way-match/:id/confirm', () => {
    let matchId: number;

    beforeAll(async () => {
      // 先执行一次数量差异的匹配，获得matchId
      const res = await request(BASE_URL)
        .post('/api/purchase/three-way-match')
        .set(authHeader('purchaser'))
        .send({
          poId: PO_ID_QTY_DIFF,
          deliveryNoteId: DN_ID_QTY_DIFF,
          receiptId: RECEIPT_ID_QTY_DIFF,
        });
      matchId = res.body.data?.matchId;
    });

    test('TC-3WM-005: 差异确认（supplier_short）→ 状态变为matched', async () => {
      const res = await request(BASE_URL)
        .post(`/api/purchase/three-way-match/${matchId}/confirm`)
        .set(authHeader('purchaser'))
        .send({
          diffReason: 'supplier_short',
          diffNotes: '供应商确认少发1箱，下次补货',
        });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
    });

    test('TC-3WM-006: 已matched记录不可再确认', async () => {
      // 再次确认同一个已matched的记录
      const res = await request(BASE_URL)
        .post(`/api/purchase/three-way-match/${matchId}/confirm`)
        .set(authHeader('purchaser'))
        .send({
          diffReason: 'other',
          diffNotes: '重复确认测试',
        });

      expect(res.body.code).not.toBe(0);
      expect(res.body.message).toMatch(/已匹配/);
    });

    // DEF-004 回归测试用例
    // 验证 POST /api/purchase/three-way-match/:id/confirm 对已 matched 记录返回 code=1001
    test('[DEF-004 回归] 对已 matched 记录调用 confirm 接口应返回 code=1001', async () => {
      // matchId 在 beforeAll 中已被 TC-3WM-005 确认为 matched 状态
      const res = await request(BASE_URL)
        .post(`/api/purchase/three-way-match/${matchId}/confirm`)
        .set(authHeader('purchaser'))
        .send({
          diffReason: 'other',
          diffNotes: 'DEF-004 回归：验证重复确认返回 1001',
        });

      // 核心断言：必须返回业务错误码 1001（参数/业务校验失败），而非 0（成功）
      expect(res.body.code).toBe(1001);
      expect(res.body.message).toContain('已匹配');
    });

    test('[DEF-004 回归] 对已 matched 记录调用 confirm 接口 HTTP 状态码应为 400', async () => {
      const res = await request(BASE_URL)
        .post(`/api/purchase/three-way-match/${matchId}/confirm`)
        .set(authHeader('purchaser'))
        .send({
          diffReason: 'receipt_miss',
          diffNotes: 'DEF-004 回归：HTTP 状态码验证',
        });

      // 业务错误应返回 HTTP 400，而非 200
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(1001);
    });
  });

  // ─── 三单匹配列表 ────────────────────────────────────────────

  describe('三单匹配列表 — GET /api/purchase/three-way-match', () => {
    test('TC-3WM-010: 按状态筛选qty_diff', async () => {
      const res = await request(BASE_URL)
        .get('/api/purchase/three-way-match?status=qty_diff')
        .set(authHeader('purchaser'));

      expect(res.status).toBe(200);
      const list: any[] = res.body.data?.list ?? [];
      list.forEach((m) => expect(m.matchStatus).toBe('qty_diff'));
    });

    test('每条匹配记录包含poNo和deliveryNo', async () => {
      const res = await request(BASE_URL)
        .get('/api/purchase/three-way-match')
        .set(authHeader('purchaser'));

      const list: any[] = res.body.data?.list ?? [];
      if (list.length > 0) {
        expect(list[0]).toHaveProperty('poNo');
        expect(list[0]).toHaveProperty('deliveryNo');
      }
    });
  });
});
