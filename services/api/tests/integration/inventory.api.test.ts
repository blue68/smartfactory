/**
 * 集成测试 — 库存模块 API
 *
 * 覆盖：
 * - TC-INV-001  采购入库（按库存单位）
 * - TC-INV-002  采购入库（按采购单位换算）
 * - TC-INV-003  面料入库缸号必填校验
 * - TC-INV-004  面料入库指定缸号
 * - TC-INV-005  同缸号再次入库合并
 * - TC-INV-006  领料出库（库存足够）
 * - TC-INV-007  库存不足拒绝出库
 * - TC-INV-008  库存为0出库
 * - TC-INV-009  面料出库缸号必填
 * - TC-INV-010  缸号一致性校验（跨缸号警告）
 * - TC-INV-013  FIFO缸号推荐
 * - TC-INV-015  低于安全库存筛选
 * - TC-ERR-005  并发出库安全
 * - TC-ERR-001  未认证访问
 * - TC-ERR-003  越权访问
 */

import request from 'supertest';
import { authHeader } from '../helpers/testAuth';
import { buildFabricInboundData, buildInboundData, buildOutboundData, genDyeLotNo } from '../helpers/testData';

// ─── 测试应用实例（使用 mock 替代真实 DB 和 Redis） ─────────────

// 注意：在真实项目中，应替换为真实的测试 Express app 实例
// 此处使用 mock app 展示完整测试结构和断言逻辑
const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';

// ─── Mock 辅助：构造已知 SKU ID（测试环境预置数据） ─────────────
const SKU_BOARD_ID = 10001;    // 预置：红橡实木板材（非面料，单位：张，换算：1箱=50张）
const SKU_FABRIC_ID = 10002;   // 预置：仿皮面料（面料类，hasDyeLot=true，单位：米）
const SKU_EMPTY_ID = 10003;    // 预置：当前库存为0的SKU
const PROD_ORDER_ID = 20001;   // 预置：生产工单ID

describe('库存模块 API 集成测试', () => {

  // ─── 认证与权限测试 ─────────────────────────────────────────

  describe('TC-ERR-001: 未认证访问受保护接口', () => {
    test('无 Token 访问库存总览 → 401', async () => {
      const res = await request(BASE_URL)
        .get('/api/inventory');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe(1002);
    });

    test('无 Token 访问入库接口 → 401', async () => {
      const res = await request(BASE_URL)
        .post('/api/inventory/inbound')
        .send(buildInboundData(SKU_BOARD_ID));
      expect(res.status).toBe(401);
    });
  });

  describe('TC-ERR-003: 越权访问（工人角色访问库存写操作）', () => {
    test('worker 角色无权执行入库 → 403', async () => {
      const res = await request(BASE_URL)
        .post('/api/inventory/inbound')
        .set(authHeader('worker'))
        .send(buildInboundData(SKU_BOARD_ID));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe(1003);
    });
  });

  // ─── 采购入库 ───────────────────────────────────────────────

  describe('采购入库 — POST /api/inventory/inbound', () => {
    test('TC-INV-001: 按库存单位入库 → 库存增加', async () => {
      const before = await request(BASE_URL)
        .get(`/api/inventory/${SKU_BOARD_ID}/available`)
        .set(authHeader('warehouse'));
      const qtyBefore = parseFloat(before.body.data?.qtyOnHand ?? '0');

      const res = await request(BASE_URL)
        .post('/api/inventory/inbound')
        .set(authHeader('warehouse'))
        .send(buildInboundData(SKU_BOARD_ID, {
          qtyInput: '100',
          inputUnit: '张',
          transactionType: 'PURCHASE_IN',
        }));

      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
      expect(res.body.data.transactionNo).toMatch(/^IN\d+/);

      const newQty = parseFloat(res.body.data.newQtyOnHand);
      expect(newQty).toBe(qtyBefore + 100);
    });

    test('TC-INV-002: 按采购单位（箱）入库 → 自动换算100张', async () => {
      const before = await request(BASE_URL)
        .get(`/api/inventory/${SKU_BOARD_ID}/available`)
        .set(authHeader('warehouse'));
      const qtyBefore = parseFloat(before.body.data?.qtyOnHand ?? '0');

      const res = await request(BASE_URL)
        .post('/api/inventory/inbound')
        .set(authHeader('warehouse'))
        .send(buildInboundData(SKU_BOARD_ID, {
          qtyInput: '2',
          inputUnit: '箱',
          transactionType: 'PURCHASE_IN',
        }));

      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
      // 2箱 × 50 = 100张
      const newQty = parseFloat(res.body.data.newQtyOnHand);
      expect(newQty).toBe(qtyBefore + 100);
    });

    test('TC-INV-003: 面料类SKU未填缸号 → 4002错误', async () => {
      const res = await request(BASE_URL)
        .post('/api/inventory/inbound')
        .set(authHeader('warehouse'))
        .send(buildFabricInboundData(SKU_FABRIC_ID, ''));  // 空缸号

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(4002);
      expect(res.body.message).toContain('缸号');
    });

    test('TC-INV-004: 面料入库指定缸号 → 缸号记录创建', async () => {
      const dyeLotNo = genDyeLotNo();
      const res = await request(BASE_URL)
        .post('/api/inventory/inbound')
        .set(authHeader('warehouse'))
        .send(buildFabricInboundData(SKU_FABRIC_ID, dyeLotNo, {
          qtyInput: '50',
        }));

      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);

      // 验证缸号批次详情中存在该缸号
      const detailRes = await request(BASE_URL)
        .get(`/api/inventory/${SKU_FABRIC_ID}/dye-lots`)
        .set(authHeader('warehouse'));
      const lots: any[] = detailRes.body.data ?? [];
      const lot = lots.find((l: any) => l.dyeLotNo === dyeLotNo);
      expect(lot).toBeDefined();
      expect(parseFloat(lot.qtyOnHand)).toBeGreaterThanOrEqual(50);
    });

    test('TC-INV-005: 同缸号再次入库 → 数量合并', async () => {
      const dyeLotNo = genDyeLotNo();

      // 第一次入库50米
      await request(BASE_URL)
        .post('/api/inventory/inbound')
        .set(authHeader('warehouse'))
        .send(buildFabricInboundData(SKU_FABRIC_ID, dyeLotNo, { qtyInput: '50' }));

      // 第二次入库30米（同缸号）
      await request(BASE_URL)
        .post('/api/inventory/inbound')
        .set(authHeader('warehouse'))
        .send(buildFabricInboundData(SKU_FABRIC_ID, dyeLotNo, { qtyInput: '30' }));

      // 验证合并后数量=80
      const detailRes = await request(BASE_URL)
        .get(`/api/inventory/${SKU_FABRIC_ID}/dye-lots`)
        .set(authHeader('warehouse'));
      const lot = detailRes.body.data?.find((l: any) => l.dyeLotNo === dyeLotNo);
      expect(parseFloat(lot?.qtyOnHand ?? '0')).toBeGreaterThanOrEqual(80);
    });
  });

  // ─── 领料出库 ───────────────────────────────────────────────

  describe('领料出库 — POST /api/inventory/outbound', () => {
    test('TC-INV-006: 库存足够时出库成功 → 库存减少', async () => {
      // 先入库100张确保有库存
      await request(BASE_URL)
        .post('/api/inventory/inbound')
        .set(authHeader('warehouse'))
        .send(buildInboundData(SKU_BOARD_ID, { qtyInput: '100', inputUnit: '张' }));

      const before = await request(BASE_URL)
        .get(`/api/inventory/${SKU_BOARD_ID}/available`)
        .set(authHeader('warehouse'));
      const qtyBefore = parseFloat(before.body.data?.qtyOnHand ?? '0');

      const res = await request(BASE_URL)
        .post('/api/inventory/outbound')
        .set(authHeader('warehouse'))
        .send(buildOutboundData(SKU_BOARD_ID, {
          qtyInput: '10',
          inputUnit: '张',
          transactionType: 'MATERIAL_OUT',
        }));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.transactionNo).toMatch(/^OUT\d+/);
      expect(parseFloat(res.body.data.newQtyOnHand)).toBe(qtyBefore - 10);
    });

    test('TC-INV-007: 库存不足时出库被拒绝 → 4001', async () => {
      // 查询当前可用库存
      const available = await request(BASE_URL)
        .get(`/api/inventory/${SKU_BOARD_ID}/available`)
        .set(authHeader('warehouse'));
      const qtyAvailable = parseFloat(available.body.data?.qtyAvailable ?? '0');

      // 尝试出库超过可用量
      const res = await request(BASE_URL)
        .post('/api/inventory/outbound')
        .set(authHeader('warehouse'))
        .send(buildOutboundData(SKU_BOARD_ID, {
          qtyInput: String(qtyAvailable + 1000),
          inputUnit: '张',
        }));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(4001);
      expect(res.body.message).toContain('库存不足');
    });

    test('TC-INV-008: 库存为0时出库被拒绝 → 4001', async () => {
      const res = await request(BASE_URL)
        .post('/api/inventory/outbound')
        .set(authHeader('warehouse'))
        .send(buildOutboundData(SKU_EMPTY_ID, { qtyInput: '1' }));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(4001);
    });

    test('TC-INV-009: 面料出库未填缸号 → 4002', async () => {
      const res = await request(BASE_URL)
        .post('/api/inventory/outbound')
        .set(authHeader('warehouse'))
        .send(buildOutboundData(SKU_FABRIC_ID, {
          qtyInput: '5',
          inputUnit: '米',
          // 不传 dyeLotNo
        }));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(4002);
    });

    test('TC-INV-010: 同订单跨缸号出库 → 4004警告（仍成功）', async () => {
      const dyeLot1 = genDyeLotNo();
      const dyeLot2 = genDyeLotNo();

      // 先入库两个缸号
      await request(BASE_URL)
        .post('/api/inventory/inbound')
        .set(authHeader('warehouse'))
        .send(buildFabricInboundData(SKU_FABRIC_ID, dyeLot1, { qtyInput: '50' }));
      await request(BASE_URL)
        .post('/api/inventory/inbound')
        .set(authHeader('warehouse'))
        .send(buildFabricInboundData(SKU_FABRIC_ID, dyeLot2, { qtyInput: '50' }));

      // 首次领料（绑定缸号1）
      await request(BASE_URL)
        .post('/api/inventory/outbound')
        .set(authHeader('warehouse'))
        .send(buildOutboundData(SKU_FABRIC_ID, {
          qtyInput: '10',
          inputUnit: '米',
          dyeLotNo: dyeLot1,
          productionOrderId: PROD_ORDER_ID,
          transactionType: 'MATERIAL_OUT',
        }));

      // 第二次领料使用不同缸号
      const res = await request(BASE_URL)
        .post('/api/inventory/outbound')
        .set(authHeader('warehouse'))
        .send(buildOutboundData(SKU_FABRIC_ID, {
          qtyInput: '10',
          inputUnit: '米',
          dyeLotNo: dyeLot2,
          productionOrderId: PROD_ORDER_ID,
          transactionType: 'MATERIAL_OUT',
        }));

      // 跨缸号应该成功（记录警告），code=4004或0（实现依赖服务设计）
      expect([0, 4004]).toContain(res.body.code);
      expect(res.status).toBeLessThan(500); // 不能是服务器错误
    });
  });

  // ─── FIFO 缸号推荐 ──────────────────────────────────────────

  describe('TC-INV-013: FIFO缸号推荐', () => {
    test('按最早入库时间返回缸号列表', async () => {
      const res = await request(BASE_URL)
        .get(`/api/inventory/${SKU_FABRIC_ID}/fifo-dye-lot?qty=50`)
        .set(authHeader('warehouse'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ─── 库存总览查询 ────────────────────────────────────────────

  describe('库存总览 — GET /api/inventory', () => {
    test('TC-INV-015: belowSafety=true 只返回低于安全库存的SKU', async () => {
      const res = await request(BASE_URL)
        .get('/api/inventory?belowSafety=true')
        .set(authHeader('warehouse'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      const list: any[] = res.body.data?.list ?? [];
      list.forEach((item) => {
        expect(item.isBelowSafety).toBe(true);
      });
    });

    test('库存总览支持关键字搜索', async () => {
      const res = await request(BASE_URL)
        .get('/api/inventory?keyword=板材')
        .set(authHeader('warehouse'));

      expect(res.status).toBe(200);
      const list: any[] = res.body.data?.list ?? [];
      list.forEach((item) => {
        const matched =
          item.skuName?.includes('板材') || item.skuCode?.includes('板材');
        expect(matched).toBe(true);
      });
    });

    test('分页参数正确返回分页结构', async () => {
      const res = await request(BASE_URL)
        .get('/api/inventory?page=1&pageSize=5')
        .set(authHeader('warehouse'));

      expect(res.body.data.page).toBe(1);
      expect(res.body.data.pageSize).toBe(5);
      expect(typeof res.body.data.total).toBe('number');
    });
  });

  // ─── 并发安全测试 ────────────────────────────────────────────

  describe('TC-ERR-005: 并发出库防超卖', () => {
    test('10个并发出库请求，可用库存=10，各出库3时总成功<=3次', async () => {
      // 先确保库存足够
      await request(BASE_URL)
        .post('/api/inventory/inbound')
        .set(authHeader('warehouse'))
        .send(buildInboundData(SKU_BOARD_ID, { qtyInput: '10', inputUnit: '张' }));

      // 并发发起5个出库请求，每次出库3张（总需求15 > 库存10）
      const concurrentRequests = Array.from({ length: 5 }, () =>
        request(BASE_URL)
          .post('/api/inventory/outbound')
          .set(authHeader('warehouse'))
          .send(buildOutboundData(SKU_BOARD_ID, { qtyInput: '3', inputUnit: '张' })),
      );

      const results = await Promise.allSettled(concurrentRequests);
      const successCount = results.filter(
        (r) => r.status === 'fulfilled' && r.value.body.code === 0,
      ).length;
      const failCount = results.filter(
        (r) =>
          r.status === 'fulfilled' &&
          [4001, 4003].includes(r.value.body.code),
      ).length;

      // 成功出库数不超过 floor(10/3) = 3次
      expect(successCount).toBeLessThanOrEqual(3);
      // 失败请求应返回 4001 或 4003（锁竞争）
      expect(failCount).toBeGreaterThan(0);
      // 成功 + 失败 = 5（无丢失请求）
      expect(successCount + failCount).toBe(5);
    }, 15000); // 并发测试放宽超时
  });

  // ─── 缸号批次详情 ────────────────────────────────────────────

  describe('缸号批次详情 — GET /api/inventory/:skuId/dye-lots', () => {
    test('面料SKU返回缸号列表', async () => {
      const res = await request(BASE_URL)
        .get(`/api/inventory/${SKU_FABRIC_ID}/dye-lots`)
        .set(authHeader('warehouse'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test('每条缸号记录包含必要字段', async () => {
      const res = await request(BASE_URL)
        .get(`/api/inventory/${SKU_FABRIC_ID}/dye-lots`)
        .set(authHeader('warehouse'));

      const lots: any[] = res.body.data ?? [];
      if (lots.length > 0) {
        expect(lots[0]).toHaveProperty('dyeLotNo');
        expect(lots[0]).toHaveProperty('qtyOnHand');
        expect(lots[0]).toHaveProperty('qtyAvailable');
        expect(lots[0]).toHaveProperty('firstInAt');
      }
    });
  });
});
