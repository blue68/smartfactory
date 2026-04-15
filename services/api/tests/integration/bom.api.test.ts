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
import mysql, { Pool } from 'mysql2/promise';
import { authHeader } from '../helpers/testAuth';
import { buildBomData, buildMultiLevelBomData } from '../helpers/testData';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';
const TEST_TENANT_ID = 9999;

// 测试环境预置 SKU ID（已在 test DB seed 中创建）
const SKU_PRODUCT_ID = 30001;   // 成品：三人沙发-A款
const SKU_SEMI_ID    = 30002;   // 半成品：沙发框架
const SKU_RAW_ID     = 30003;   // 原材料：红橡实木板材（非面料）
const SKU_FABRIC_ID  = 30004;   // 原材料：仿皮面料（hasDyeLot=true）
const SKU_L3_ID      = SKU_SEMI_ID + 100;
const SKU_L4_ID      = SKU_SEMI_ID + 200;
const SKU_L5_ID      = SKU_SEMI_ID + 300;
const SKU_L6_ID      = SKU_SEMI_ID + 400;
const SKU_PARENT_B_ID = 30501;  // 上层成品B
const SKU_PARENT_C_ID = 30502;  // 上层成品C

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

function shortVersion(prefix: string): string {
  return `${prefix}${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 4)}`;
}

function idEq(value: unknown, expected: number): boolean {
  return Number(value) === expected;
}

describe('BOM 模块 API 集成测试', () => {
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

    const seedSkus = [
      { id: SKU_PRODUCT_ID, code: 'SKU-BOM-PROD', name: 'BOM测试成品', stockUnit: '套', purchaseUnit: '套', productionUnit: '套', hasDyeLot: 0 },
      { id: SKU_SEMI_ID, code: 'SKU-BOM-SEMI', name: 'BOM测试半成品', stockUnit: '套', purchaseUnit: '套', productionUnit: '套', hasDyeLot: 0 },
      { id: SKU_RAW_ID, code: 'SKU-BOM-RAW', name: 'BOM测试原材料', stockUnit: '张', purchaseUnit: '张', productionUnit: '张', hasDyeLot: 0 },
      { id: SKU_FABRIC_ID, code: 'SKU-BOM-FABRIC', name: 'BOM测试面料', stockUnit: '米', purchaseUnit: '米', productionUnit: '米', hasDyeLot: 1 },
      { id: SKU_L3_ID, code: 'SKU-BOM-L3', name: 'BOM测试三层组件', stockUnit: '套', purchaseUnit: '套', productionUnit: '套', hasDyeLot: 0 },
      { id: SKU_L4_ID, code: 'SKU-BOM-L4', name: 'BOM测试四层组件', stockUnit: '块', purchaseUnit: '块', productionUnit: '块', hasDyeLot: 0 },
      { id: SKU_L5_ID, code: 'SKU-BOM-L5', name: 'BOM测试五层组件', stockUnit: '张', purchaseUnit: '张', productionUnit: '张', hasDyeLot: 0 },
      { id: SKU_L6_ID, code: 'SKU-BOM-L6', name: 'BOM测试六层组件', stockUnit: '根', purchaseUnit: '根', productionUnit: '根', hasDyeLot: 0 },
      { id: SKU_PARENT_B_ID, code: 'SKU-BOM-PARENT-B', name: 'BOM动态引用父件B', stockUnit: '套', purchaseUnit: '套', productionUnit: '套', hasDyeLot: 0 },
      { id: SKU_PARENT_C_ID, code: 'SKU-BOM-PARENT-C', name: 'BOM动态引用父件C', stockUnit: '套', purchaseUnit: '套', productionUnit: '套', hasDyeLot: 0 },
    ];

    for (const sku of seedSkus) {
      await pool.execute(
        `INSERT INTO skus
          (id, tenant_id, sku_code, name, category1_id, category2_id, stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo, safety_stock, status, created_by, updated_by)
         VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?, 1, 0, 'active', 99004, 99004)
         ON DUPLICATE KEY UPDATE
           tenant_id = VALUES(tenant_id),
           sku_code = VALUES(sku_code),
           name = VALUES(name),
           stock_unit = VALUES(stock_unit),
           purchase_unit = VALUES(purchase_unit),
           production_unit = VALUES(production_unit),
           has_dye_lot = VALUES(has_dye_lot),
           status = VALUES(status),
           updated_by = VALUES(updated_by)`,
        [
          sku.id,
          TEST_TENANT_ID,
          sku.code,
          sku.name,
          sku.stockUnit,
          sku.purchaseUnit,
          sku.productionUnit,
          sku.hasDyeLot,
        ],
      );
    }
  });

  afterAll(async () => {
    if (dbPool) {
      await dbPool.end();
      dbPool = null;
    }
  });

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
      payload.version = shortVersion('m2-');
      const res = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
    });

    test('TC-BOM-003: 组件SKU等于成品SKU时检测循环引用 → 3002', async () => {
      const payload = buildBomData(SKU_PRODUCT_ID, SKU_PRODUCT_ID, { version: shortVersion('cy-') }); // 自引用
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
        version: shortVersion('l11-'),
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
        version: shortVersion('l10-'),
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
          version: shortVersion('exp-'),
          items: [{ componentSkuId: SKU_RAW_ID, quantity: '3', unit: '张', scrapRate: '0.05' }],
        }));
      singleLayerBomId = r1.body.data?.id;

      // 创建多层BOM
      const multiLevelPayload = buildMultiLevelBomData(SKU_PRODUCT_ID, SKU_SEMI_ID, SKU_RAW_ID);
      multiLevelPayload.version = shortVersion('exp2-');
      const r2 = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send(multiLevelPayload);
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
      expect(Number(node.componentSkuId)).toBe(SKU_RAW_ID);
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

  describe('动态引用树展开', () => {
    let semiBomV1Id: number;
    let semiBomV2Id: number;
    let parentBBomId: number;
    let parentCBomId: number;

    beforeAll(async () => {
      const semiV1 = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send({
          skuId: SKU_SEMI_ID,
          version: shortVersion('semi1-'),
          items: [{
            componentSkuId: SKU_RAW_ID,
            quantity: '10',
            unit: '张',
            scrapRate: '0',
          }],
        });
      semiBomV1Id = semiV1.body.data?.id;

      await request(BASE_URL)
        .post(`/api/bom/${semiBomV1Id}/activate`)
        .set(authHeader('supervisor'));

      const parentB = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send({
          skuId: SKU_PARENT_B_ID,
          version: shortVersion('pb-'),
          items: [{
            componentSkuId: SKU_SEMI_ID,
            quantity: '1',
            unit: '套',
            scrapRate: '0',
          }],
        });
      parentBBomId = parentB.body.data?.id;
      await request(BASE_URL)
        .post(`/api/bom/${parentBBomId}/activate`)
        .set(authHeader('supervisor'));

      const parentC = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send({
          skuId: SKU_PARENT_C_ID,
          version: shortVersion('pc-'),
          items: [{
            componentSkuId: SKU_SEMI_ID,
            quantity: '1',
            unit: '套',
            scrapRate: '0',
          }],
        });
      parentCBomId = parentC.body.data?.id;
      await request(BASE_URL)
        .post(`/api/bom/${parentCBomId}/activate`)
        .set(authHeader('supervisor'));

      const semiV2 = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send({
          skuId: SKU_SEMI_ID,
          version: shortVersion('semi2-'),
          items: [{
            componentSkuId: SKU_RAW_ID,
            quantity: '20',
            unit: '张',
            scrapRate: '0',
          }],
        });
      semiBomV2Id = semiV2.body.data?.id;
    });

    test('父件展开优先引用子SKU的active BOM', async () => {
      const [resB, resC] = await Promise.all([
        request(BASE_URL).get(`/api/bom/${parentBBomId}/expand`).set(authHeader('supervisor')),
        request(BASE_URL).get(`/api/bom/${parentCBomId}/expand`).set(authHeader('supervisor')),
      ]);

      expect(resB.body.code).toBe(0);
      expect(resC.body.code).toBe(0);

      const childB = resB.body.data.items[0];
      const childC = resC.body.data.items[0];
      expect(Number(childB.componentSkuId)).toBe(SKU_SEMI_ID);
      expect(Number(childC.componentSkuId)).toBe(SKU_SEMI_ID);
      expect(childB.children[0].quantity).toBe('10.0000');
      expect(childC.children[0].quantity).toBe('10.0000');
    });

    test('子BOM激活新版本后，上层BOM树与物料需求同步反映新用量', async () => {
      await request(BASE_URL)
        .post(`/api/bom/${semiBomV2Id}/activate`)
        .set(authHeader('supervisor'));

      const [resB, resC, reqB, reqC] = await Promise.all([
        request(BASE_URL).get(`/api/bom/${parentBBomId}/expand`).set(authHeader('supervisor')),
        request(BASE_URL).get(`/api/bom/${parentCBomId}/expand`).set(authHeader('supervisor')),
        request(BASE_URL).get(`/api/bom/${parentBBomId}/material-requirements?productionQty=1`).set(authHeader('supervisor')),
        request(BASE_URL).get(`/api/bom/${parentCBomId}/material-requirements?productionQty=1`).set(authHeader('supervisor')),
      ]);

      expect(resB.body.data.items[0].children[0].quantity).toBe('20.0000');
      expect(resC.body.data.items[0].children[0].quantity).toBe('20.0000');

      const rawB = reqB.body.data.find((r: any) => idEq(r.skuId, SKU_RAW_ID));
      const rawC = reqC.body.data.find((r: any) => idEq(r.skuId, SKU_RAW_ID));
      expect(rawB.totalQty).toBe('20.0000');
      expect(rawC.totalQty).toBe('20.0000');
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
          version: shortVersion('req-'),
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
      const rawMaterial = reqs.find((r: any) => idEq(r.skuId, SKU_RAW_ID));
      expect(rawMaterial).toBeDefined();
      expect(rawMaterial.totalQty).toBe('31.5000'); // 3 × 1.05 × 10
    });

    test('TC-BOM-006b: 生产1件时物料需求 = 3.15张', async () => {
      const res = await request(BASE_URL)
        .get(`/api/bom/${bomId}/material-requirements?productionQty=1`)
        .set(authHeader('supervisor'));

      const reqs: any[] = res.body.data;
      const rawMaterial = reqs.find((r: any) => idEq(r.skuId, SKU_RAW_ID));
      expect(rawMaterial.totalQty).toBe('3.1500');
    });

    test('TC-BOM-011: 含面料SKU时需求中hasDyeLot=true', async () => {
      // 创建含面料的BOM
      const createRes = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send({
          skuId: SKU_PRODUCT_ID,
          version: shortVersion('fab-'),
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
      const fabricReq = reqs.find((r: any) => idEq(r.skuId, SKU_FABRIC_ID));
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
        .send(buildBomData(SKU_PRODUCT_ID, SKU_RAW_ID, { version: shortVersion('a1-') }));
      const bom1Id = r1.body.data?.id;

      await request(BASE_URL)
        .post(`/api/bom/${bom1Id}/activate`)
        .set(authHeader('supervisor'));

      // 创建第二个BOM并激活
      const r2 = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send(buildBomData(SKU_PRODUCT_ID, SKU_RAW_ID, { version: shortVersion('a2-') }));
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
      expect(Number(activeBoms[0].id)).toBe(bom2Id);
    });

    test('激活不存在的BOM → 3001', async () => {
      const res = await request(BASE_URL)
        .post('/api/bom/999999999/activate')
        .set(authHeader('supervisor'));

      expect(res.body.code).toBe(3001);
    });
  });

  // ─── 半成品BOM被不同成品引用 ─────────────────────────────────

  describe('TC-BOM-020: 半成品BOM被不同成品引用', () => {
    /**
     * 验证同一半成品（SKU_SEMI_ID）被两个不同成品引用时，
     * 各自的BOM展开和物料需求计算互不干扰。
     */
    let bomA_Id: number;
    let bomB_Id: number;

    beforeAll(async () => {
      // 成品A的BOM：半成品(qty=1) → 原材料(qty=3, scrap=5%)
      const rA = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send({
          skuId: SKU_PRODUCT_ID,
          version: shortVersion('sa-'),
          items: [{
            componentSkuId: SKU_SEMI_ID,
            quantity: '1',
            unit: '套',
            scrapRate: '0',
            children: [{
              componentSkuId: SKU_RAW_ID,
              quantity: '3',
              unit: '张',
              scrapRate: '0.05',
            }],
          }],
        });
      bomA_Id = rA.body.data?.id;

      // 成品B的BOM（使用不同成品SKU或同一成品不同版本）：
      // 半成品(qty=2) → 原材料(qty=5, scrap=10%)
      const rB = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send({
          skuId: SKU_PRODUCT_ID,
          version: shortVersion('sb-'),
          items: [{
            componentSkuId: SKU_SEMI_ID,
            quantity: '2',
            unit: '套',
            scrapRate: '0',
            children: [{
              componentSkuId: SKU_RAW_ID,
              quantity: '5',
              unit: '张',
              scrapRate: '0.10',
            }],
          }],
        });
      bomB_Id = rB.body.data?.id;
    });

    test('两个BOM各自展开结构独立', async () => {
      const [resA, resB] = await Promise.all([
        request(BASE_URL).get(`/api/bom/${bomA_Id}/expand`).set(authHeader('supervisor')),
        request(BASE_URL).get(`/api/bom/${bomB_Id}/expand`).set(authHeader('supervisor')),
      ]);

      expect(resA.body.code).toBe(0);
      expect(resB.body.code).toBe(0);

      // BOM A：半成品下原材料 qty=3, scrap=5%
      const itemsA = resA.body.data.items;
      expect(Number(itemsA[0].componentSkuId)).toBe(SKU_SEMI_ID);
      expect(itemsA[0].children[0].quantity).toBe('3.0000');
      expect(itemsA[0].children[0].scrapRate).toBe('0.0500');

      // BOM B：半成品下原材料 qty=5, scrap=10%
      const itemsB = resB.body.data.items;
      expect(Number(itemsB[0].componentSkuId)).toBe(SKU_SEMI_ID);
      expect(itemsB[0].children[0].quantity).toBe('5.0000');
      expect(itemsB[0].children[0].scrapRate).toBe('0.1000');
    });

    test('两个BOM的物料需求计算互不影响', async () => {
      const [reqA, reqB] = await Promise.all([
        request(BASE_URL).get(`/api/bom/${bomA_Id}/material-requirements?productionQty=10`).set(authHeader('supervisor')),
        request(BASE_URL).get(`/api/bom/${bomB_Id}/material-requirements?productionQty=10`).set(authHeader('supervisor')),
      ]);

      expect(reqA.body.code).toBe(0);
      expect(reqB.body.code).toBe(0);

      const rawA = reqA.body.data.find((r: any) => idEq(r.skuId, SKU_RAW_ID));
      const rawB = reqB.body.data.find((r: any) => idEq(r.skuId, SKU_RAW_ID));

      // BOM A: 10 × 1 × 3.15 = 31.5
      expect(rawA.totalQty).toBe('31.5000');
      // BOM B: 10 × 2 × 5.5 = 110
      expect(rawB.totalQty).toBe('110.0000');
      // 两者不相等
      expect(rawA.totalQty).not.toBe(rawB.totalQty);
    });
  });

  // ─── 7级BOM树展开验证 ─────────────────────────────────────────

  describe('TC-BOM-021: 7级BOM树展开', () => {
    let deepBomId: number;

    beforeAll(async () => {
      // 构造7层嵌套BOM
      const res = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send({
          skuId: SKU_PRODUCT_ID,
          version: shortVersion('d7-'),
          items: [{
            componentSkuId: SKU_SEMI_ID, quantity: '1', unit: '套', scrapRate: '0.01',
            children: [{
              componentSkuId: SKU_L3_ID, quantity: '2', unit: '套', scrapRate: '0.02',
              children: [{
                componentSkuId: SKU_L4_ID, quantity: '1', unit: '块', scrapRate: '0',
                children: [{
                  componentSkuId: SKU_L5_ID, quantity: '3', unit: '张', scrapRate: '0.05',
                  children: [{
                    componentSkuId: SKU_L6_ID, quantity: '2', unit: '根', scrapRate: '0.08',
                    children: [{
                      componentSkuId: SKU_RAW_ID, quantity: '1', unit: '段', scrapRate: '0.10',
                    }],
                  }],
                }],
              }],
            }],
          }],
        });
      deepBomId = res.body.data?.id;
    });

    test('7级BOM创建成功（未超过10层限制）', () => {
      expect(deepBomId).toBeGreaterThan(0);
    });

    test('7级BOM展开后树形结构层级正确', async () => {
      const res = await request(BASE_URL)
        .get(`/api/bom/${deepBomId}/expand`)
        .set(authHeader('supervisor'));

      expect(res.body.code).toBe(0);
      const items = res.body.data.items;

      // 逐层验证深度
      let node = items[0];
      for (let expectedLevel = 1; expectedLevel <= 6; expectedLevel++) {
        expect(node.level).toBe(expectedLevel);
        if (expectedLevel < 6) {
          expect(node.children.length).toBeGreaterThan(0);
          node = node.children[0];
        } else {
          // 第6层是叶子节点
          expect(node.children).toHaveLength(0);
          expect(Number(node.componentSkuId)).toBe(SKU_RAW_ID);
        }
      }
    });

    test('7级BOM物料需求计算含损耗逐层复合', async () => {
      const res = await request(BASE_URL)
        .get(`/api/bom/${deepBomId}/material-requirements?productionQty=1`)
        .set(authHeader('supervisor'));

      expect(res.body.code).toBe(0);
      const reqs: any[] = res.body.data;

      // 只有叶子节点（SKU_RAW_ID）计入需求
      const rawReq = reqs.find((r: any) => idEq(r.skuId, SKU_RAW_ID));
      expect(rawReq).toBeDefined();

      // 总需求 > 0（损耗逐层复合后应大于基础用量）
      expect(Number(rawReq.totalQty)).toBeGreaterThan(0);

      // 验证损耗确实被计入：无损耗时基础用量 = 1×2×1×3×2×1 = 12
      // 有损耗时应 > 12
      expect(Number(rawReq.totalQty)).toBeGreaterThan(12);
    });
  });

  // ─── BOM物料新增/修改含损耗率 ─────────────────────────────────

  describe('TC-BOM-022: 新增/修改物料含损耗率', () => {
    let draftBomId: number;

    beforeAll(async () => {
      const res = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send({
          skuId: SKU_PRODUCT_ID,
          version: shortVersion('sc-'),
          items: [],
        });
      draftBomId = res.body.data?.id;
    });

    test('新增物料时设置损耗率', async () => {
      const res = await request(BASE_URL)
        .post(`/api/bom/${draftBomId}/items`)
        .set(authHeader('supervisor'))
        .send({
          componentSkuId: SKU_RAW_ID,
          quantity: '10',
          unit: '张',
          scrapRate: '0.05',
        });

      expect(res.body.code).toBe(0);
      const itemId = res.body.data?.bomItemId;
      expect(itemId).toBeGreaterThan(0);

      // 验证展开后 netQuantity 含损耗
      const expandRes = await request(BASE_URL)
        .get(`/api/bom/${draftBomId}/expand`)
        .set(authHeader('supervisor'));

      const seededItem = expandRes.body.data.items.find((i: any) => idEq(i.componentSkuId, SKU_RAW_ID));
      expect(seededItem).toBeDefined();
      expect(seededItem.scrapRate).toBe('0.0500');
      // 10 × 1.05 = 10.5
      expect(seededItem.netQuantity).toBe('10.5000');
    });

    test('修改物料用量和损耗率', async () => {
      // 先获取 itemId
      const expandRes = await request(BASE_URL)
        .get(`/api/bom/${draftBomId}/expand`)
        .set(authHeader('supervisor'));
      const item = expandRes.body.data.items.find((i: any) => idEq(i.componentSkuId, SKU_RAW_ID));
      const itemId = item.bomItemId;

      // 修改用量为8，损耗率为12%
      const updateRes = await request(BASE_URL)
        .patch(`/api/bom/${draftBomId}/items/${itemId}`)
        .set(authHeader('supervisor'))
        .send({
          quantity: '8',
          scrapRate: '0.12',
        });

      expect(updateRes.body.code).toBe(0);

      // 验证修改后的展开结果
      const verifyRes = await request(BASE_URL)
        .get(`/api/bom/${draftBomId}/expand`)
        .set(authHeader('supervisor'));

      const updated = verifyRes.body.data.items.find((i: any) => idEq(i.componentSkuId, SKU_RAW_ID));
      expect(updated.quantity).toBe('8.0000');
      expect(updated.scrapRate).toBe('0.1200');
      // 8 × 1.12 = 8.96
      expect(updated.netQuantity).toBe('8.9600');
    });

    test('修改损耗率后物料需求计算正确反映', async () => {
      const res = await request(BASE_URL)
        .get(`/api/bom/${draftBomId}/material-requirements?productionQty=10`)
        .set(authHeader('supervisor'));

      expect(res.body.code).toBe(0);
      const rawReq = res.body.data.find((r: any) => idEq(r.skuId, SKU_RAW_ID));
      // 10件 × 8.96 = 89.6
      expect(rawReq.totalQty).toBe('89.6000');
    });
  });

  // ─── 物料计算逻辑包含损耗 ─────────────────────────────────────

  describe('TC-BOM-023: 物料需求计算含损耗', () => {
    let scrapBomId: number;

    beforeAll(async () => {
      // 创建多层BOM，每层都有损耗
      // 半成品(qty=2, scrap=3%) → 原材料(qty=5, scrap=8%)
      const res = await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send({
          skuId: SKU_PRODUCT_ID,
          version: shortVersion('scl-'),
          items: [{
            componentSkuId: SKU_SEMI_ID,
            quantity: '2',
            unit: '套',
            scrapRate: '0.03',
            children: [{
              componentSkuId: SKU_RAW_ID,
              quantity: '5',
              unit: '张',
              scrapRate: '0.08',
            }],
          }],
        });
      scrapBomId = res.body.data?.id;
    });

    test('多层BOM损耗逐层复合计算', async () => {
      const res = await request(BASE_URL)
        .get(`/api/bom/${scrapBomId}/material-requirements?productionQty=1`)
        .set(authHeader('supervisor'));

      expect(res.body.code).toBe(0);
      const rawReq = res.body.data.find((r: any) => idEq(r.skuId, SKU_RAW_ID));

      // 半成品 netQty = 2 × 1.03 = 2.06
      // 原材料 netQty = 5 × 1.08 = 5.40
      // 总需求 = 1 × 2.06 × 5.40 = 11.124
      expect(rawReq.totalQty).toBe('11.1240');
    });

    test('生产100件时损耗等比放大', async () => {
      const [res1, res100] = await Promise.all([
        request(BASE_URL).get(`/api/bom/${scrapBomId}/material-requirements?productionQty=1`).set(authHeader('supervisor')),
        request(BASE_URL).get(`/api/bom/${scrapBomId}/material-requirements?productionQty=100`).set(authHeader('supervisor')),
      ]);

      const qty1 = Number(res1.body.data.find((r: any) => idEq(r.skuId, SKU_RAW_ID)).totalQty);
      const qty100 = Number(res100.body.data.find((r: any) => idEq(r.skuId, SKU_RAW_ID)).totalQty);

      // 100件 = 1件 × 100（精度允许微小浮点误差）
      expect(Math.abs(qty100 - qty1 * 100)).toBeLessThan(0.001);
    });
  });

  // ─── BOM 列表 ───────────────────────────────────────────────

  describe('BOM列表 — GET /api/bom', () => {
    test('TC-BOM-012: 按skuId筛选返回对应BOM', async () => {
      // 先确保有该SKU的BOM
      await request(BASE_URL)
        .post('/api/bom')
        .set(authHeader('supervisor'))
        .send(buildBomData(SKU_PRODUCT_ID, SKU_RAW_ID, { version: shortVersion('ls-') }));

      const res = await request(BASE_URL)
        .get(`/api/bom?skuId=${SKU_PRODUCT_ID}`)
        .set(authHeader('supervisor'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      const boms: any[] = res.body.data;
      boms.forEach((b) => expect(Number(b.skuId)).toBe(SKU_PRODUCT_ID));
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
