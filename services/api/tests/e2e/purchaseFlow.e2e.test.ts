/**
 * E2E 测试 — 采购完整流程
 *
 * 流程链路：
 *   1. 生成采购建议（AI引擎）
 *   2. Boss审批通过
 *   3. 采购员创建采购订单（PO）
 *   4. 供应商送货，录入送货单（Delivery Note）
 *   5. 仓库收货，录入入库单（Receipt）
 *   6. 执行三单匹配
 *   7. （可选）差异确认
 *   8. 验证库存已增加
 *
 * 本测试验证整条业务链路的数据一致性和状态流转。
 * 依赖：TEST_API_URL 指向运行中的测试服务；测试数据库已 seed。
 */

import request from 'supertest';
import { authHeader } from '../helpers/testAuth';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';

// E2E测试使用的SKU（需确保测试DB中存在且安全库存有缺口）
const SKU_FOR_PURCHASE = 30003; // 原材料：红橡实木板材
const SUPPLIER_ID      = 1;

describe('E2E: 采购完整流程', () => {
  // 流程中各步骤生成的实体ID，跨步骤共享
  let suggestionId: number;
  let poId: number;
  let poNo: string;
  let deliveryNoteId: number;
  let receiptId: number;
  let stockQtyBefore: number;

  // ─── Step 1: 记录采购前库存 ───────────────────────────────────

  test('Step 0: 记录采购前的库存数量', async () => {
    const res = await request(BASE_URL)
      .get(`/api/inventory/stock?skuId=${SKU_FOR_PURCHASE}`)
      .set(authHeader('warehouse'));

    expect(res.status).toBe(200);
    const stock = res.body.data?.list?.find((s: any) => s.skuId === SKU_FOR_PURCHASE);
    stockQtyBefore = parseFloat(stock?.availableQty ?? '0');
    // 记录初始库存（可能为0，E2E从头走）
    expect(typeof stockQtyBefore).toBe('number');
  });

  // ─── Step 2: AI生成采购建议 ───────────────────────────────────

  test('Step 1: Boss触发AI生成采购建议', async () => {
    const res = await request(BASE_URL)
      .post('/api/purchase/suggestions/generate')
      .set(authHeader('boss'));

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(Array.isArray(res.body.data)).toBe(true);

    // 建议列表中应包含目标SKU的建议（若库存不足）
    const suggestions: any[] = res.body.data;
    if (suggestions.length > 0) {
      // 验证建议结构完整
      const first = suggestions[0];
      expect(first).toHaveProperty('skuId');
      expect(first).toHaveProperty('suggestedQty');
      expect(first).toHaveProperty('confidence');
      expect(['high', 'medium', 'low']).toContain(first.confidence);

      suggestionId = suggestions.find((s: any) => s.skuId === SKU_FOR_PURCHASE)?.id
        ?? suggestions[0].id;
    }
  });

  // ─── Step 3: Boss审批采购建议 ─────────────────────────────────

  test('Step 2: Boss审批通过采购建议', async () => {
    if (!suggestionId) {
      // 若无建议（库存充足），查询已有pending建议
      const listRes = await request(BASE_URL)
        .get('/api/purchase/suggestions?status=pending')
        .set(authHeader('boss'));
      suggestionId = listRes.body.data?.list?.[0]?.id;
    }
    if (!suggestionId) return; // 无待审批建议时跳过后续步骤

    const res = await request(BASE_URL)
      .post(`/api/purchase/suggestions/${suggestionId}/approve`)
      .set(authHeader('boss'))
      .send({ approved: true });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);

    // 验证建议状态已变更为approved
    const listRes = await request(BASE_URL)
      .get('/api/purchase/suggestions?status=approved')
      .set(authHeader('boss'));
    const found = listRes.body.data?.list?.some((s: any) => s.id === suggestionId);
    expect(found).toBe(true);
  });

  // ─── Step 4: 采购员创建PO ─────────────────────────────────────

  test('Step 3: 采购员创建采购订单（PO）', async () => {
    const expectedDate = new Date();
    expectedDate.setDate(expectedDate.getDate() + 14);

    const res = await request(BASE_URL)
      .post('/api/purchase/orders')
      .set(authHeader('purchaser'))
      .send({
        supplierId: SUPPLIER_ID,
        expectedDate: expectedDate.toISOString().slice(0, 10),
        items: [{
          skuId: SKU_FOR_PURCHASE,
          qtyOrdered: '20',
          purchaseUnit: '张',
          unitPrice: '150.00',
        }],
      });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    expect(res.body.data.poNo).toMatch(/^PO\d+/);

    poId = res.body.data.id;
    poNo = res.body.data.poNo;

    expect(poId).toBeGreaterThan(0);
  });

  // ─── Step 5: 录入送货单 ───────────────────────────────────────

  test('Step 4: 录入供应商送货单（Delivery Note）', async () => {
    if (!poId) return;

    const res = await request(BASE_URL)
      .post('/api/purchase/delivery-notes')
      .set(authHeader('purchaser'))
      .send({
        poId,
        supplierDeliveryNo: `DN-E2E-${Date.now()}`,
        deliveryDate: new Date().toISOString().slice(0, 10),
        items: [{
          skuId: SKU_FOR_PURCHASE,
          qtyDelivered: '20',
          unit: '张',
          unitPrice: '150.00',
        }],
      });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    deliveryNoteId = res.body.data?.id;
    expect(deliveryNoteId).toBeGreaterThan(0);
  });

  // ─── Step 6: 仓库录入入库单 ───────────────────────────────────

  test('Step 5: 仓库录入入库单（Receipt）', async () => {
    if (!poId) return;

    const res = await request(BASE_URL)
      .post('/api/inventory/inbound')
      .set(authHeader('warehouse'))
      .send({
        skuId: SKU_FOR_PURCHASE,
        qty: '20',
        unit: '张',
        unitPrice: '150.00',
        sourceType: 'purchase',
        sourceId: poId,
        warehouseLocation: 'A-01-01',
      });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    receiptId = res.body.data?.id;
    expect(receiptId).toBeGreaterThan(0);
  });

  // ─── Step 7: 执行三单匹配 ─────────────────────────────────────

  test('Step 6: 执行三单匹配（应为matched）', async () => {
    if (!poId || !deliveryNoteId || !receiptId) return;

    const res = await request(BASE_URL)
      .post('/api/purchase/three-way-match')
      .set(authHeader('purchaser'))
      .send({
        poId,
        deliveryNoteId,
        receiptId,
      });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);

    const matchStatus = res.body.data.matchStatus;
    // 数量和价格一致，应为matched
    expect(matchStatus).toBe('matched');
    // qtyDiff应为0
    const diffItems: any[] = res.body.data.diffItems ?? [];
    diffItems.forEach((item) => {
      expect(parseFloat(item.qtyDiff)).toBe(0);
    });
  });

  // ─── Step 8: 验证库存已增加 ───────────────────────────────────

  test('Step 7: 验证入库后库存数量增加20张', async () => {
    const res = await request(BASE_URL)
      .get(`/api/inventory/stock?skuId=${SKU_FOR_PURCHASE}`)
      .set(authHeader('warehouse'));

    expect(res.status).toBe(200);
    const stock = res.body.data?.list?.find((s: any) => s.skuId === SKU_FOR_PURCHASE);
    const stockQtyAfter = parseFloat(stock?.availableQty ?? '0');

    // 入库20张后，库存应增加20
    expect(stockQtyAfter).toBeGreaterThanOrEqual(stockQtyBefore + 20);
  });

  // ─── Step 9: 采购订单状态验证 ─────────────────────────────────

  test('Step 8: 采购订单状态随流程推进正确更新', async () => {
    if (!poId) return;

    const res = await request(BASE_URL)
      .get(`/api/purchase/orders/${poId}`)
      .set(authHeader('purchaser'));

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    // PO应处于received或matched状态
    expect(['received', 'matched', 'closed']).toContain(res.body.data.status);
  });
}, 60000); // E2E测试允许60秒超时
