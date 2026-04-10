/**
 * 集成测试 — SKU 主数据 API
 *
 * 覆盖：
 * - TC-SKU-001  创建普通SKU
 * - TC-SKU-002  创建面料SKU自动开启缸号
 * - TC-SKU-003  二级分类不属于一级分类
 * - TC-SKU-004  SKU编码重复
 * - TC-SKU-005  关键字搜索
 * - TC-SKU-006  缸号标记筛选
 * - TC-SKU-007  配置单位换算
 * - TC-SKU-008  换算系数6位精度
 * - TC-SKU-010  查询不存在SKU
 * - TC-SKU-011  名称超长校验
 * - TC-BOUND-009 最大分页200条
 */

import request from 'supertest';
import mysql, { Pool } from 'mysql2/promise';
import { authHeader } from '../helpers/testAuth';
import { buildSkuData, buildFabricSkuData } from '../helpers/testData';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';
const TEST_TENANT_ID = 9999;

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

function readBooleanField(row: any, camel: string, snake: string): boolean {
  return Boolean(row?.[camel] ?? row?.[snake]);
}

function readNumberField(row: any, camel: string, snake: string): number {
  return Number(row?.[camel] ?? row?.[snake]);
}

let category1MaterialId = 1;
let category2NormalId = 8;
let category2FabricId = 5;

function buildNormalSkuData(override: Record<string, unknown> = {}) {
  return buildSkuData({
    category1Id: category1MaterialId,
    category2Id: category2NormalId,
    ...override,
  });
}

function buildMaterialFabricSkuData(override: Record<string, unknown> = {}) {
  return buildFabricSkuData({
    category1Id: category1MaterialId,
    category2Id: category2FabricId,
    ...override,
  });
}

describe('SKU 主数据 API 集成测试', () => {
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

    const [rows] = await pool.query<any[]>(
      `SELECT id, code, level, parent_id
       FROM sku_categories
       WHERE tenant_id IN (0, ?) AND code IN ('MATERIAL', 'WOOD', 'FABRIC') AND is_active = 1`,
      [TEST_TENANT_ID],
    );
    const material = rows.find((r) => r.code === 'MATERIAL' && Number(r.level) === 1);
    const normal = rows.find((r) => r.code === 'WOOD' && Number(r.level) === 2 && Number(r.parent_id) === Number(material?.id));
    const fabric = rows.find((r) => r.code === 'FABRIC' && Number(r.level) === 2 && Number(r.parent_id) === Number(material?.id));
    if (!material || !normal || !fabric) {
      throw new Error('缺少SKU分类基础数据：MATERIAL/WOOD/FABRIC');
    }
    category1MaterialId = Number(material.id);
    category2NormalId = Number(normal.id);
    category2FabricId = Number(fabric.id);
  });

  afterAll(async () => {
    if (dbPool) {
      await dbPool.end();
      dbPool = null;
    }
  });

  // ─── 创建 SKU ───────────────────────────────────────────────

  describe('创建SKU — POST /api/skus', () => {
    test('TC-SKU-001: 创建普通SKU成功', async () => {
      const payload = buildNormalSkuData({ name: `红橡实木板材-${Date.now()}` });
      const res = await request(BASE_URL)
        .post('/api/skus')
        .set(authHeader('boss'))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
      expect(Number(res.body.data.id)).toBeGreaterThan(0);
      expect(res.body.data.skuCode).toMatch(/^[A-Z]+\d{7}$/);
    });

    test('TC-SKU-002: 创建面料SKU时hasDyeLot自动强制为true', async () => {
      const payload = buildMaterialFabricSkuData({
        name: `仿皮面料-${Date.now()}`,
        hasDyeLot: false, // 传入false，系统应强制为true
      });
      const res = await request(BASE_URL)
        .post('/api/skus')
        .set(authHeader('boss'))
        .send(payload);

      expect(res.status).toBe(201);

      // 读取创建的SKU验证hasDyeLot
      const getRes = await request(BASE_URL)
        .get(`/api/skus/${res.body.data.id}`)
        .set(authHeader('boss'));
      expect(readBooleanField(getRes.body.data, 'hasDyeLot', 'has_dye_lot')).toBe(true);
    });

    test('TC-SKU-003: 二级分类不属于一级分类 → 2003', async () => {
      const payload = buildNormalSkuData({
        category1Id: category1MaterialId,
        category2Id: 10, // 10 在默认数据中属于一级分类 2（SEMIFIN）
      });
      const res = await request(BASE_URL)
        .post('/api/skus')
        .set(authHeader('boss'))
        .send(payload);

      expect(res.body.code).toBe(2003);
    });

    test('TC-SKU-004: SKU编码重复 → 2002', async () => {
      // 第一次创建
      const payload = buildNormalSkuData({ name: `测试SKU-first-${Date.now()}` });
      const firstRes = await request(BASE_URL)
        .post('/api/skus')
        .set(authHeader('boss'))
        .send(payload);
      const createdCode = firstRes.body.data?.skuCode;

      // 第二次用同一编码创建
      const res = await request(BASE_URL)
        .post('/api/skus')
        .set(authHeader('boss'))
        .send({ ...buildNormalSkuData(), skuCode: createdCode });

      expect(res.body.code).toBe(2002);
    });

    test('TC-SKU-011: SKU名称超过200字符 → 1001', async () => {
      const payload = buildNormalSkuData({ name: 'A'.repeat(201) });
      const res = await request(BASE_URL)
        .post('/api/skus')
        .set(authHeader('boss'))
        .send(payload);

      expect(res.body.code).toBe(1001);
    });

    test('缺少必填字段 category1Id → 1001', async () => {
      const { category1Id, ...payload } = buildNormalSkuData() as any;
      const res = await request(BASE_URL)
        .post('/api/skus')
        .set(authHeader('boss'))
        .send(payload);
      expect(res.body.code).toBe(1001);
    });
  });

  // ─── 查询 SKU ───────────────────────────────────────────────

  describe('SKU查询 — GET /api/skus', () => {
    test('TC-SKU-005: 关键字搜索返回匹配结果', async () => {
      // 先创建含"测试关键词"的SKU
      const keyword = `UniqueKW${Date.now()}`;
      await request(BASE_URL)
        .post('/api/skus')
        .set(authHeader('boss'))
        .send(buildNormalSkuData({ name: `${keyword}板材` }));

      const res = await request(BASE_URL)
        .get(`/api/skus?keyword=${keyword}`)
        .set(authHeader('boss'));

      expect(res.status).toBe(200);
      expect(res.body.data.list.length).toBeGreaterThan(0);
      res.body.data.list.forEach((item: any) => {
        const matched =
          item.name?.includes(keyword) || item.spec?.includes(keyword);
        expect(matched).toBe(true);
      });
    });

    test('TC-SKU-006: hasDyeLot=true 只返回面料类SKU', async () => {
      const res = await request(BASE_URL)
        .get('/api/skus?hasDyeLot=true')
        .set(authHeader('boss'));

      expect(res.status).toBe(200);
      res.body.data.list.forEach((item: any) => {
        expect(readBooleanField(item, 'hasDyeLot', 'has_dye_lot')).toBe(true);
      });
    });

    test('TC-SKU-012: 按一级和二级分类联动筛选', async () => {
      const res = await request(BASE_URL)
        .get(`/api/skus?category1Id=${category1MaterialId}&category2Id=${category2NormalId}`)
        .set(authHeader('boss'));

      expect(res.status).toBe(200);
      res.body.data.list.forEach((item: any) => {
        expect(readNumberField(item, 'category1Id', 'category1_id')).toBe(category1MaterialId);
        expect(readNumberField(item, 'category2Id', 'category2_id')).toBe(category2NormalId);
      });
    });

    test('TC-BOUND-009: pageSize=200 不报错', async () => {
      const res = await request(BASE_URL)
        .get('/api/skus?page=1&pageSize=200')
        .set(authHeader('boss'));

      expect(res.status).toBe(200);
      expect(res.body.data.pageSize).toBeLessThanOrEqual(200);
    });

    test('分页响应结构正确', async () => {
      const res = await request(BASE_URL)
        .get('/api/skus?page=1&pageSize=10')
        .set(authHeader('boss'));

      expect(res.body.data).toHaveProperty('list');
      expect(res.body.data).toHaveProperty('total');
      expect(res.body.data).toHaveProperty('page');
      expect(res.body.data).toHaveProperty('pageSize');
      expect(res.body.data).toHaveProperty('totalPages');
    });
  });

  describe('获取单个SKU — GET /api/skus/:id', () => {
    test('TC-SKU-010: 查询不存在的SKU → 2001', async () => {
      const res = await request(BASE_URL)
        .get('/api/skus/999999999')
        .set(authHeader('boss'));

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(2001);
    });

    test('获取SKU包含单位换算信息', async () => {
      // 先创建SKU
      const createRes = await request(BASE_URL)
        .post('/api/skus')
        .set(authHeader('boss'))
        .send(buildNormalSkuData({ name: `单位测试SKU-${Date.now()}` }));
      const skuId = createRes.body.data?.id;

      // 配置换算
      await request(BASE_URL)
        .put(`/api/skus/${skuId}/unit-conversions`)
        .set(authHeader('boss'))
        .send({
          conversions: [
            { fromUnit: '箱', toUnit: '张', conversionRate: '50.000000', description: '1箱=50张' },
          ],
        });

      // 读取
      const res = await request(BASE_URL)
        .get(`/api/skus/${skuId}`)
        .set(authHeader('boss'));

      expect(res.status).toBe(200);
      expect(res.body.data.unitConversions).toBeDefined();
      expect(res.body.data.unitConversions.length).toBeGreaterThan(0);
      expect(Number(res.body.data.unitConversions[0].conversionRate)).toBeCloseTo(50, 6);
    });
  });

  // ─── 单位换算配置 ────────────────────────────────────────────

  describe('配置单位换算 — PUT /api/skus/:id/unit-conversions', () => {
    let testSkuId: number;

    beforeAll(async () => {
      const res = await request(BASE_URL)
        .post('/api/skus')
        .set(authHeader('boss'))
        .send(buildNormalSkuData({ name: `换算测试SKU-${Date.now()}` }));
      testSkuId = res.body.data?.id;
    });

    test('TC-SKU-007: 配置换算关系成功', async () => {
      const res = await request(BASE_URL)
        .put(`/api/skus/${testSkuId}/unit-conversions`)
        .set(authHeader('boss'))
        .send({
          conversions: [
            { fromUnit: '箱', toUnit: '张', conversionRate: '50.000000', description: '1箱=50张' },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data[0].fromUnit).toBe('箱');
      expect(res.body.data[0].toUnit).toBe('张');
    });

    test('TC-SKU-008: 换算系数保留6位小数精度', async () => {
      const res = await request(BASE_URL)
        .put(`/api/skus/${testSkuId}/unit-conversions`)
        .set(authHeader('boss'))
        .send({
          conversions: [
            { fromUnit: '个', toUnit: '千克', conversionRate: '0.000001' },
          ],
        });

      expect(res.status).toBe(200);
      expect(Number(res.body.data[0].conversionRate)).toBeCloseTo(0.000001, 8);
    });

    test('conversions为空数组时返回错误', async () => {
      const res = await request(BASE_URL)
        .put(`/api/skus/${testSkuId}/unit-conversions`)
        .set(authHeader('boss'))
        .send({ conversions: [] });

      expect(res.body.code).toBe(1001);
    });
  });

  // ─── 更新 SKU ───────────────────────────────────────────────

  describe('更新SKU — PUT /api/skus/:id', () => {
    test('TC-SKU-009: 更新SKU名称成功', async () => {
      const createRes = await request(BASE_URL)
        .post('/api/skus')
        .set(authHeader('boss'))
        .send(buildNormalSkuData({ name: `原始名称-${Date.now()}` }));
      const skuId = createRes.body.data?.id;
      const newName = `更新名称-${Date.now()}`;

      const res = await request(BASE_URL)
        .put(`/api/skus/${skuId}`)
        .set(authHeader('boss'))
        .send({ name: newName });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.name).toBe(newName);
    });
  });

  // ─── SKU 分类列表 ────────────────────────────────────────────

  describe('SKU分类列表 — GET /api/skus/categories', () => {
    test('返回包含一级和二级分类的列表', async () => {
      const res = await request(BASE_URL)
        .get('/api/skus/categories')
        .set(authHeader('boss'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(Array.isArray(res.body.data)).toBe(true);

      const hasLevel1 = res.body.data.some((c: any) => c.level === 1);
      const hasLevel2 = res.body.data.some((c: any) => c.level === 2);
      expect(hasLevel1).toBe(true);
      expect(hasLevel2).toBe(true);
    });
  });
});
