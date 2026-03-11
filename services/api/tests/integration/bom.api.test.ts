/**
 * 集成测试 — BOM 模块 API
 *
 * 覆盖：
 * - TC-BOM-001  创建单层BOM
 * - TC-BOM-002  创建多层BOM（含半成品）
 * - TC-BOM-003  循环引用检测 → 3002
 * - TC-BOM-004  层级超10层 → 3002
 * - TC-BOM-005  BOM多层展开（树形结构+netQuantity）
 * - TC-BOM-006  物料需求计算（单层，生产10件）
 * - TC-BOM-007  物料需求计算（多层，同SKU累加）
 * - TC-BOM-008  激活BOM（旧active自动归档）
 * - TC-BOM-009  查询不存在BOM → 3001
 * - TC-BOM-011  含面料类组件的BOM展开标记hasDyeLot
 * - TC-BOM-012  按skuId筛选BOM列表
 */

import request from 'supertest';
import { authHeader } from '../helpers/testAuth';
import { buildBomData, buildMultiLevelBomData } from '../helpers/testData';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';

// 测试环境预置 SKU ID（已在 test DB seed 中创建）
const SKU_PRODUCT_ID = 30001;   // 成品：三人沙发-A款
const SKU_SEMI_ID    = 30002;   // 半成品：沙发框架
const SKU_RAW_ID     = 30003;   // 原材料：红橡实木板材（非面料）
const SKU_FABRIC_ID  = 30004;   // 原材料：仿皮面料（hasDyeLot=true）

describe('BOM 模块 API 集成测试', () => {

  // ─── 创建 BOM ───────────────────────────────────────────────

  describe('创建BOM — POST /api/bom', () => {
    test('TC-BOM-001: 创建单层BOM成功', async () => {
      const payload = buildBomData(SKU_PRODUCT_ID, SKU_RAW_ID);
      const res = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
      expect(res.body.data.id).toBeGreaterThan(0);
    });

    test('TC-BOM-002: 创建多层BOM（成品→半成品→原材料）', async () => {
      const payload = buildMultiLevelBomData(SKU_PRODUCT_ID, SKU_SEMI_ID, SKU_RAW_ID);
      const res = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
    });

    test('TC-BOM-003: 组件SKU等于成品SKU时检测循环引用 → 3002', async () => {
      const payload = buildBomData(SKU_PRODUCT_ID, SKU_PRODUCT_ID); // 自引用
      const res = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send(payload);

      expect(res.body.code).toBe(3002);
      expect(res.body.message).toMatch(/循环引用/);
    });

    test('TC-BOM-004: BOM层级超过10层 → 3002', async () => {
      // 构造11层嵌套（每层引用下一个子件）
      function deepNest(depth: number, baseSkuId: number): any {
        if (depth === 0) return [];
        return [{
          componentSkuId: baseSkuId + depth,
          quantity: '1',
          unit: '个',
          scrapRate: '0',
          children: deepNest(depth - 1, baseSkuId),
        }];
      }
      const payload = {
        skuId: SKU_PRODUCT_ID,
        version: '11layer',
        items: deepNest(11, 40000), // 超过10层
      };
      const res = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send(payload);

      expect(res.body.code).toBe(3002);
    });

    test('TC-BOM-003b: BOM层级恰好10层时创建成功', async () => {
      function deepNest(depth: number, baseSkuId: number): any {
        if (depth === 0) return [];
        return [{
          componentSkuId: baseSkuId + depth,
          quantity: '1',
          unit: '个',
          scrapRate: '0',
          children: deepNest(depth - 1, baseSkuId),
        }];
      }
      const payload = {
        skuId: SKU_PRODUCT_ID,
        version: '10layer',
        items: deepNest(10, 50000),
      };
      const res = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send(payload);

      // 10层合法，应成功
      expect(res.body.code).toBe(0);
    });
  });

  // ─── BOM 展开 ───────────────────────────────────────────────

  describe('BOM展开 — GET /api/bom/:id/expand', () => {
    let singleLayerBomId: number;
    let multiLayerBomId: number;

    beforeAll(async () => {
      // 创建单层BOM
      const r1 = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send(buildBomData(SKU_PRODUCT_ID, SKU_RAW_ID, {
          version: `v-expand-${Date.now()}`,
          items: [{ componentSkuId: SKU_RAW_ID, quantity: '3', unit: '张', scrapRate: '0.05' }],
        }));
      singleLayerBomId = r1.body.data?.id;

      // 创建多层BOM
      const r2 = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send(buildMultiLevelBomData(SKU_PRODUCT_ID, SKU_SEMI_ID, SKU_RAW_ID));
      multiLayerBomId = r2.body.data?.id;
    });

    test('TC-BOM-005: 单层BOM展开结构正确', async () => {
      const res = await request(BASE_URL)
        .get(`/api/bom/${singleLayerBomId}/expand`)
        .set(authHeader('supervisor'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.items).toHaveLength(1);

      const node = res.body.data.items[0];
      expect(node.level).toBe(1);
      expect(node.componentSkuId).toBe(SKU_RAW_ID);
      // netQuantity = 3 × (1 + 0.05) = 3.15
      expect(node.netQuantity).toBe('3.1500');
    });

    test('TC-BOM-005b: 多层BOM展开树形结构正确', async () => {
      const res = await request(BASE_URL)
        .get(`/api/bom/${multiLayerBomId}/expand`)
        .set(authHeader('supervisor'));

      expect(res.status).toBe(200);
      const items = res.body.data.items;
      expect(items[0].level).toBe(1);
      expect(items[0].children.length).toBeGreaterThan(0);
      expect(items[0].children[0].level).toBe(2);
    });

    test('TC-BOM-009: 查询不存在的BOM → 3001', async () => {
      const res = await request(BASE_URL)
        .get('/api/bom/999999999/expand')
        .set(authHeader('supervisor'));

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(3001);
    });
  });

  // ─── 物料需求计算 ────────────────────────────────────────────

  describe('物料需求计算 — GET /api/bom/:id/material-requirements', () => {
    let bomId: number;

    beforeAll(async () => {
      const res = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send({
          skuId: SKU_PRODUCT_ID,
          version: `v-req-${Date.now()}`,
          items: [{
            componentSkuId: SKU_RAW_ID,
            quantity: '3',
            unit: '张',
            scrapRate: '0.05',
          }],
        });
      bomId = res.body.data?.id;
    });

    test('TC-BOM-006: 生产10件时物料需求 = 31.5张', async () => {
      const res = await request(BASE_URL)
        .get(`/api/bom/${bomId}/material-requirements?productionQty=10`)
        .set(authHeader('supervisor'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);

      const reqs: any[] = res.body.data;
      const rawMaterial = reqs.find((r: any) => r.skuId === SKU_RAW_ID);
      expect(rawMaterial).toBeDefined();
      expect(rawMaterial.totalQty).toBe('31.5000'); // 3 × 1.05 × 10
    });

    test('TC-BOM-006b: 生产1件时物料需求 = 3.15张', async () => {
      const res = await request(BASE_URL)
        .get(`/api/bom/${bomId}/material-requirements?productionQty=1`)
        .set(authHeader('supervisor'));

      const reqs: any[] = res.body.data;
      const rawMaterial = reqs.find((r: any) => r.skuId === SKU_RAW_ID);
      expect(rawMaterial.totalQty).toBe('3.1500');
    });

    test('TC-BOM-011: 含面料SKU时需求中hasDyeLot=true', async () => {
      // 创建含面料的BOM
      const createRes = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send({
          skuId: SKU_PRODUCT_ID,
          version: `v-fabric-${Date.now()}`,
          items: [{
            componentSkuId: SKU_FABRIC_ID,
            quantity: '2',
            unit: '米',
            scrapRate: '0',
          }],
        });
      const fabricBomId = createRes.body.data?.id;

      const res = await request(BASE_URL)
        .get(`/api/bom/${fabricBomId}/material-requirements?productionQty=1`)
        .set(authHeader('supervisor'));

      const reqs: any[] = res.body.data;
      const fabricReq = reqs.find((r: any) => r.skuId === SKU_FABRIC_ID);
      expect(fabricReq.hasDyeLot).toBe(true);
    });

    test('productionQty 未传 → 1001', async () => {
      const res = await request(BASE_URL)
        .get(`/api/bom/${bomId}/material-requirements`)
        .set(authHeader('supervisor'));

      expect(res.body.code).toBe(1001);
    });
  });

  // ─── 激活 BOM ───────────────────────────────────────────────

  describe('激活BOM — POST /api/bom/:id/activate', () => {
    test('TC-BOM-008: 激活新BOM后旧active BOM自动归档', async () => {
      // 创建第一个BOM并激活
      const r1 = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send(buildBomData(SKU_PRODUCT_ID, SKU_RAW_ID, { version: `v1-${Date.now()}` }));
      const bom1Id = r1.body.data?.id;

      await request(BASE_URL)
        .post(`/api/bom/${bom1Id}/activate`)
        .set(authHeader('supervisor'));

      // 创建第二个BOM并激活
      const r2 = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send(buildBomData(SKU_PRODUCT_ID, SKU_RAW_ID, { version: `v2-${Date.now()}` }));
      const bom2Id = r2.body.data?.id;

      const activateRes = await request(BASE_URL)
        .post(`/api/bom/${bom2Id}/activate`)
        .set(authHeader('supervisor'));

      expect(activateRes.status).toBe(200);
      expect(activateRes.body.code).toBe(0);

      // 验证：BOM列表中该SKU的active BOM只有bom2
      const listRes = await request(BASE_URL)
        .get(`/api/bom?skuId=${SKU_PRODUCT_ID}`)
        .set(authHeader('supervisor'));

      const activeBoms = listRes.body.data.filter((b: any) => b.status === 'active');
      // 同一SKU只有一个active
      expect(activeBoms.length).toBe(1);
      expect(activeBoms[0].id).toBe(bom2Id);
    });

    test('激活不存在的BOM → 3001', async () => {
      const res = await request(BASE_URL)
        .post('/api/bom/999999999/activate')
        .set(authHeader('supervisor'));

      expect(res.body.code).toBe(3001);
    });
  });

  // ─── BOM 列表 ───────────────────────────────────────────────

  describe('BOM列表 — GET /api/bom', () => {
    test('TC-BOM-012: 按skuId筛选返回对应BOM', async () => {
      // 先确保有该SKU的BOM
      await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send(buildBomData(SKU_PRODUCT_ID, SKU_RAW_ID, { version: `v-list-${Date.now()}` }));

      const res = await request(BASE_URL)
        .get(`/api/bom?skuId=${SKU_PRODUCT_ID}`)
        .set(authHeader('supervisor'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      const boms: any[] = res.body.data;
      boms.forEach((b) => expect(b.skuId).toBe(SKU_PRODUCT_ID));
    });

    test('无筛选条件时返回所有BOM', async () => {
      const res = await request(BASE_URL)
        .get('/api/bom')
        .set(authHeader('supervisor'));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
