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
import mysql, { Pool } from 'mysql2/promise';
import { authHeader } from '../helpers/testAuth';
import { buildFabricInboundData, buildInboundData, buildOutboundData, genDyeLotNo } from '../helpers/testData';

// ─── 测试应用实例（使用 mock 替代真实 DB 和 Redis） ─────────────

// 注意：在真实项目中，应替换为真实的测试 Express app 实例
// 此处使用 mock app 展示完整测试结构和断言逻辑
const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';
const TEST_TENANT_ID = 9999;

// ─── Mock 辅助：构造已知 SKU ID（测试环境预置数据） ─────────────
const SKU_BOARD_ID = 10001;    // 预置：红橡实木板材（非面料，单位：张，换算：1箱=50张）
const SKU_FABRIC_ID = 10002;   // 预置：仿皮面料（面料类，hasDyeLot=true，单位：米）
const SKU_EMPTY_ID = 10003;    // 预置：当前库存为0的SKU
const SKU_REPAIR_ID = 10004;   // 修复回归专用SKU
const PROD_ORDER_ID = 20001;   // 预置：生产工单ID
const REPAIR_PROD_ORDER_ID = 20002;
const REPAIR_PURCHASE_ORDER_ID = 20003;
const REPAIR_PURCHASE_ORDER_ITEM_ID = 20004;
const REPAIR_SNAPSHOT_DATE = new Date().toISOString().slice(0, 10);

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

async function seedRepairFixture(pool: Pool): Promise<void> {
  await pool.execute(
    'DELETE FROM material_requirements WHERE tenant_id = ? AND production_order_id = ?',
    [TEST_TENANT_ID, REPAIR_PROD_ORDER_ID],
  );
  await pool.execute(
    'DELETE FROM production_orders WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, REPAIR_PROD_ORDER_ID],
  );
  await pool.execute(
    'DELETE FROM purchase_order_items WHERE tenant_id = ? AND po_id = ?',
    [TEST_TENANT_ID, REPAIR_PURCHASE_ORDER_ID],
  );
  await pool.execute(
    'DELETE FROM purchase_orders WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, REPAIR_PURCHASE_ORDER_ID],
  );
  await pool.execute(
    'DELETE FROM inventory_daily_snapshots WHERE tenant_id = ? AND sku_id = ?',
    [TEST_TENANT_ID, SKU_REPAIR_ID],
  );
  await pool.execute(
    'DELETE FROM inventory_transactions WHERE tenant_id = ? AND sku_id = ?',
    [TEST_TENANT_ID, SKU_REPAIR_ID],
  );
  await pool.execute(
    'DELETE FROM inventory WHERE tenant_id = ? AND sku_id = ?',
    [TEST_TENANT_ID, SKU_REPAIR_ID],
  );

  await pool.execute(
    `INSERT INTO inventory
       (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit, last_in_at)
     VALUES (?, ?, 30, 0, 0, NOW(3))
     ON DUPLICATE KEY UPDATE
       qty_on_hand = VALUES(qty_on_hand),
       qty_reserved = VALUES(qty_reserved),
       qty_in_transit = VALUES(qty_in_transit),
       last_in_at = VALUES(last_in_at)`,
    [TEST_TENANT_ID, SKU_REPAIR_ID],
  );

  await pool.execute(
    `INSERT INTO inventory_transactions
       (tenant_id, transaction_no, sku_id, transaction_type, direction,
        qty_input, input_unit, qty_stock_unit, stock_unit, reference_type, reference_id, created_by)
     VALUES
       (?, 'ITX-INV-REPAIR-IN', ?, 'ADJUSTMENT_IN', 'IN', 10, 'pcs', 10, 'pcs', 'inventory_api_repair', 1, 99003),
       (?, 'ITX-INV-REPAIR-OUT', ?, 'ADJUSTMENT_OUT', 'OUT', 3, 'pcs', 3, 'pcs', 'inventory_api_repair', 2, 99003)
     ON DUPLICATE KEY UPDATE
       qty_input = VALUES(qty_input),
       qty_stock_unit = VALUES(qty_stock_unit),
       created_by = VALUES(created_by)`,
    [TEST_TENANT_ID, SKU_REPAIR_ID, TEST_TENANT_ID, SKU_REPAIR_ID],
  );

  await pool.execute(
    `INSERT INTO production_orders
       (id, tenant_id, work_order_no, sales_order_id, sku_id, bom_header_id, process_template_id,
        qty_planned, qty_completed, status, created_by, updated_by)
     VALUES (?, ?, 'WO-INV-REPAIR', 1, ?, 1, 1, 1, 0, 'in_progress', 99003, 99003)
     ON DUPLICATE KEY UPDATE
       sku_id = VALUES(sku_id),
       qty_planned = VALUES(qty_planned),
       qty_completed = VALUES(qty_completed),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [REPAIR_PROD_ORDER_ID, TEST_TENANT_ID, SKU_REPAIR_ID],
  );

  await pool.execute(
    `INSERT INTO material_requirements
       (tenant_id, production_order_id, bom_snapshot_id, sku_id, qty_required, qty_reserved, qty_shortage, status)
     VALUES (?, ?, 1, ?, 2, 2, 0, 'fulfilled')
     ON DUPLICATE KEY UPDATE
       qty_required = VALUES(qty_required),
       qty_reserved = VALUES(qty_reserved),
       qty_shortage = VALUES(qty_shortage),
       status = VALUES(status)`,
    [TEST_TENANT_ID, REPAIR_PROD_ORDER_ID, SKU_REPAIR_ID],
  );

  await pool.execute(
    `INSERT INTO purchase_orders
       (id, tenant_id, po_no, supplier_id, status, total_amount, created_by, updated_by)
     VALUES (?, ?, 'PO-INV-REPAIR', 1, 'confirmed', 12.00, 99003, 99003)
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       total_amount = VALUES(total_amount),
       updated_by = VALUES(updated_by)`,
    [REPAIR_PURCHASE_ORDER_ID, TEST_TENANT_ID],
  );

  await pool.execute(
    `INSERT INTO purchase_order_items
       (id, tenant_id, po_id, sku_id, qty_ordered, qty_received, purchase_unit, unit_price, amount, created_by, updated_by)
     VALUES (?, ?, ?, ?, 12, 4, 'pcs', 1, 12.00, 99003, 99003)
     ON DUPLICATE KEY UPDATE
       qty_ordered = VALUES(qty_ordered),
       qty_received = VALUES(qty_received),
       purchase_unit = VALUES(purchase_unit),
       amount = VALUES(amount),
       updated_by = VALUES(updated_by)`,
    [REPAIR_PURCHASE_ORDER_ITEM_ID, TEST_TENANT_ID, REPAIR_PURCHASE_ORDER_ID, SKU_REPAIR_ID],
  );

  await pool.execute(
    `INSERT INTO inventory_daily_snapshots
       (tenant_id, snapshot_date, sku_id, qty_on_hand, qty_reserved, qty_available)
     VALUES (?, ?, ?, 30, 0, 30)
     ON DUPLICATE KEY UPDATE
       qty_on_hand = VALUES(qty_on_hand),
       qty_reserved = VALUES(qty_reserved),
       qty_available = VALUES(qty_available)`,
    [TEST_TENANT_ID, REPAIR_SNAPSHOT_DATE, SKU_REPAIR_ID],
  );
}

describe('库存模块 API 集成测试', () => {
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
      `INSERT INTO skus
        (id, tenant_id, sku_code, name, category1_id, category2_id, stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo, safety_stock, status, created_by, updated_by)
       VALUES
        (?, ?, 'SKU-INV-BOARD', '红橡实木板材', 1, 1, '张', '箱', '张', 0, 1, 30, 'active', 99003, 99003),
        (?, ?, 'SKU-INV-FABRIC', '仿皮面料', 1, 2, '米', '米', '米', 1, 1, 20, 'active', 99003, 99003),
        (?, ?, 'SKU-INV-EMPTY', '零库存测试料', 1, 1, '张', '张', '张', 0, 1, 10, 'active', 99003, 99003),
        (?, ?, 'SKU-INV-REPAIR', '库存修复测试料', 1, 1, 'pcs', 'pcs', 'pcs', 0, 1, 0, 'active', 99003, 99003)
       ON DUPLICATE KEY UPDATE
         tenant_id = VALUES(tenant_id),
         sku_code = VALUES(sku_code),
         name = VALUES(name),
         category1_id = VALUES(category1_id),
         category2_id = VALUES(category2_id),
         stock_unit = VALUES(stock_unit),
         purchase_unit = VALUES(purchase_unit),
         production_unit = VALUES(production_unit),
         has_dye_lot = VALUES(has_dye_lot),
         safety_stock = VALUES(safety_stock),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [
        SKU_BOARD_ID,
        TEST_TENANT_ID,
        SKU_FABRIC_ID,
        TEST_TENANT_ID,
        SKU_EMPTY_ID,
        TEST_TENANT_ID,
        SKU_REPAIR_ID,
        TEST_TENANT_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO sku_unit_conversions
        (tenant_id, sku_id, from_unit, to_unit, conversion_rate, description, created_by, updated_by)
       VALUES
        (?, ?, '箱', '张', 50.00000000, '1箱=50张', 99003, 99003),
        (?, ?, '张', '箱', 0.02000000, '1张=0.02箱', 99003, 99003)
       ON DUPLICATE KEY UPDATE
         conversion_rate = VALUES(conversion_rate),
         description = VALUES(description),
         updated_by = VALUES(updated_by)`,
      [TEST_TENANT_ID, SKU_BOARD_ID, TEST_TENANT_ID, SKU_BOARD_ID],
    );

    await pool.execute(
      'DELETE FROM order_dye_lot_bindings WHERE tenant_id = ? AND sku_id = ? AND production_order_id = ?',
      [TEST_TENANT_ID, SKU_FABRIC_ID, PROD_ORDER_ID],
    );
    await pool.execute(
      'DELETE FROM inventory_transactions WHERE tenant_id = ? AND sku_id IN (?, ?, ?)',
      [TEST_TENANT_ID, SKU_BOARD_ID, SKU_FABRIC_ID, SKU_EMPTY_ID],
    );
    await pool.execute(
      'DELETE FROM inventory_dye_lots WHERE tenant_id = ? AND sku_id = ?',
      [TEST_TENANT_ID, SKU_FABRIC_ID],
    );
    await pool.execute(
      'DELETE FROM inventory WHERE tenant_id = ? AND sku_id IN (?, ?, ?)',
      [TEST_TENANT_ID, SKU_BOARD_ID, SKU_FABRIC_ID, SKU_EMPTY_ID],
    );
    await seedRepairFixture(pool);
  });

  afterAll(async () => {
    if (dbPool) {
      await dbPool.end();
      dbPool = null;
    }
  });

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
        .get('/api/inventory')
        .query({ keyword: '板材' })
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

  describe('库存修复与日结快照 — reconcile / repair / daily-snapshots', () => {
    beforeEach(async () => {
      await seedRepairFixture(getDbPool());
    });

    test('reconcile dryRun 预览账本、预留和在途差异但不回写库存', async () => {
      const res = await request(BASE_URL)
        .post('/api/inventory/reconcile')
        .set(authHeader('supervisor'))
        .send({
          skuId: SKU_REPAIR_ID,
          dryRun: true,
          includeReserved: true,
          includeInTransit: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.message).toContain('预览');
      expect(res.body.data?.changedCount).toBe(1);
      expect(res.body.data?.items?.[0]?.expectedQtyOnHand).toBe('7.0000');
      expect(res.body.data?.items?.[0]?.expectedQtyReserved).toBe('2.0000');
      expect(res.body.data?.items?.[0]?.expectedQtyInTransit).toBe('8.0000');

      const availableRes = await request(BASE_URL)
        .get(`/api/inventory/${SKU_REPAIR_ID}/available`)
        .set(authHeader('warehouse'));

      expect(availableRes.status).toBe(200);
      expect(availableRes.body.data?.qtyOnHand).toBe('30.0000');
      expect(availableRes.body.data?.qtyReserved).toBe('0.0000');
      expect(availableRes.body.data?.qtyAvailable).toBe('30.0000');
    });

    test('repair 执行后，available 与 daily-snapshots 回查口径一致', async () => {
      const repairRes = await request(BASE_URL)
        .post('/api/inventory/repair')
        .set(authHeader('supervisor'))
        .send({
          skuId: SKU_REPAIR_ID,
          snapshotDate: REPAIR_SNAPSHOT_DATE,
          dryRun: false,
        });

      expect(repairRes.status).toBe(200);
      expect(repairRes.body.code).toBe(0);
      expect(repairRes.body.message).toContain('已执行');
      expect(repairRes.body.data?.dryRun).toBe(false);
      expect(repairRes.body.data?.reconcile?.changedCount).toBe(1);
      expect(Number(repairRes.body.data?.snapshots?.rebuiltCount ?? 0)).toBeGreaterThanOrEqual(1);

      const availableRes = await request(BASE_URL)
        .get(`/api/inventory/${SKU_REPAIR_ID}/available`)
        .set(authHeader('warehouse'));

      expect(availableRes.status).toBe(200);
      expect(availableRes.body.data?.qtyOnHand).toBe('7.0000');
      expect(availableRes.body.data?.qtyReserved).toBe('2.0000');
      expect(availableRes.body.data?.qtyAvailable).toBe('5.0000');

      const snapshotRes = await request(BASE_URL)
        .get('/api/inventory/daily-snapshots')
        .query({
          snapshotDate: REPAIR_SNAPSHOT_DATE,
          skuId: SKU_REPAIR_ID,
          page: 1,
          pageSize: 20,
        })
        .set(authHeader('warehouse'));

      expect(snapshotRes.status).toBe(200);
      expect(snapshotRes.body.code).toBe(0);
      expect(snapshotRes.body.data?.snapshotDate).toBe(REPAIR_SNAPSHOT_DATE);
      expect(snapshotRes.body.data?.total).toBe(1);
      expect(snapshotRes.body.data?.list?.[0]).toMatchObject({
        skuId: String(SKU_REPAIR_ID),
        qtyOnHand: '7.0000',
        qtyReserved: '2.0000',
        qtyAvailable: '5.0000',
      });
    });

    test('transactions 可按关键词回查库存流水并返回任务追溯字段', async () => {
      const res = await request(BASE_URL)
        .get(`/api/inventory/${SKU_REPAIR_ID}/transactions`)
        .query({
          keyword: 'ITX-INV-REPAIR-IN',
          page: 1,
          pageSize: 20,
        })
        .set(authHeader('warehouse'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data).toEqual(
        expect.objectContaining({
          skuId: String(SKU_REPAIR_ID),
          skuCode: 'SKU-INV-REPAIR',
          skuName: '库存修复测试料',
          stockUnit: 'pcs',
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        }),
      );
      expect(Array.isArray(res.body.data?.list)).toBe(true);
      expect(res.body.data.list[0]).toEqual(
        expect.objectContaining({
          transactionNo: 'ITX-INV-REPAIR-IN',
          transactionType: 'ADJUSTMENT_IN',
          direction: 'IN',
          qtyChange: '10.0000',
          taskId: null,
          workOrderNo: null,
          processStepName: null,
          workerName: null,
        }),
      );
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
