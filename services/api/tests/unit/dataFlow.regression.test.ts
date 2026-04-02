import { AppDataSource } from '../../src/config/database';
import { AiService } from '../../src/modules/ai/ai.service';
import { MrpService } from '../../src/modules/mrp/mrp.service';
import { ProductionOrderService } from '../../src/modules/production/production-order.service';
import { SalesService } from '../../src/modules/sales/sales.service';
import { SalesOrderService } from '../../src/modules/sales-order/salesOrder.service';
import { BomSnapshotService } from '../../src/modules/production/bom-snapshot.service';
import * as generateNoModule from '../../src/shared/generateNo';

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: jest.fn(),
    transaction: jest.fn(),
    getRepository: jest.fn(),
  },
}));

const mockRedisDel = jest.fn();

jest.mock('../../src/config/redis', () => ({
  getRedisClient: () => ({
    del: (...args: unknown[]) => mockRedisDel(...args),
  }),
  RedisKeys: {
    inventorySnapshot: (tenantId: number, skuId: number) => `inventory:${tenantId}:${skuId}`,
  },
}));

const mockAppDataSource = AppDataSource as unknown as {
  query: jest.Mock;
  transaction: jest.Mock;
  getRepository: jest.Mock;
};

describe('Data flow regressions', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockRedisDel.mockResolvedValue(1);
  });

  describe('ProductionOrderService.createFromSalesOrder', () => {
    it('only allows confirmed sales order status', async () => {
      const manager = {
        query: jest.fn().mockResolvedValueOnce([
          { id: 1, order_no: 'SO-1', status: 'draft', expected_delivery: '2026-03-30' },
        ]),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      const svc = new ProductionOrderService({ tenantId: 7, userId: 11 });

      await expect(svc.createFromSalesOrder(1)).rejects.toThrow('需为 confirmed');
      expect(manager.query).toHaveBeenCalledTimes(1);
    });

    it('queries sales order items by order_id (not sales_order_id)', async () => {
      const manager = {
        query: jest
          .fn()
          .mockResolvedValueOnce([
            { id: 1, order_no: 'SO-2', status: 'confirmed', expected_delivery: '2026-03-30' },
          ])
          .mockResolvedValueOnce([]),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      const svc = new ProductionOrderService({ tenantId: 8, userId: 12 });
      await expect(svc.createFromSalesOrder(2)).rejects.toThrow('销售订单无明细行');

      const secondSql = String(manager.query.mock.calls[1][0]);
      expect(secondSql).toContain('WHERE soi.order_id = ?');
      expect(secondSql).not.toContain('soi.sales_order_id');
    });

    it('auto-generates purchase suggestions when created work order has shortages', async () => {
      const manager = {
        query: jest
          .fn()
          .mockResolvedValueOnce([
            { id: 1, order_no: 'SO-3', status: 'confirmed', expected_delivery: '2026-03-30' },
          ])
          .mockResolvedValueOnce([
            { id: 11, sku_id: 101, sku_code: 'SKU-101', qty_ordered: '5' },
          ])
          .mockResolvedValueOnce([{ id: 201, version: 'V1' }])
          .mockResolvedValueOnce([{ id: 301 }])
          .mockResolvedValueOnce({ insertId: 401 })
          .mockResolvedValueOnce({ insertId: 501 })
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce({ affectedRows: 1 })
          .mockResolvedValueOnce({ affectedRows: 1 }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      jest.spyOn(BomSnapshotService.prototype, 'createSnapshot').mockResolvedValue({
        snapshotId: 701,
        reused: false,
        expandedItems: [{ skuId: 901, qty: '10' }] as any,
      });
      jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('WO-00001');

      const generateSuggestionsSpy = jest
        .spyOn(MrpService.prototype, 'generateSuggestions')
        .mockResolvedValue({ created: 1, updated: 0, skipped: 0, suggestionIds: [801] });

      const svc = new ProductionOrderService({ tenantId: 7, userId: 11 });
      await svc.createFromSalesOrder(3);

      expect(generateSuggestionsSpy).toHaveBeenCalledWith(401, manager);

      const bomLookupCall = manager.query.mock.calls.find(([sql]) =>
        String(sql).includes('SELECT id, version FROM bom_headers'),
      );
      expect(String(bomLookupCall?.[0])).toContain("status = 'active'");
      expect(String(bomLookupCall?.[0])).not.toContain('is_active = 1');

      const requirementInsertCall = manager.query.mock.calls.find(([sql]) =>
        String(sql).includes('INSERT INTO material_requirements'),
      );
      expect(String(requirementInsertCall?.[0])).not.toContain('created_by');
      expect(String(requirementInsertCall?.[0])).not.toContain('updated_by');
    });

    it('syncs inventory_daily_snapshots after reserving material inventory', async () => {
      const manager = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('FROM sales_orders')) {
            return [{ id: 1, order_no: 'SO-4', status: 'confirmed', expected_delivery: '2026-03-30' }];
          }
          if (sql.includes('FROM sales_order_items')) {
            return [{ id: 11, sku_id: 101, sku_code: 'SKU-101', qty_ordered: '5' }];
          }
          if (sql.includes('FROM bom_headers')) {
            return [{ id: 201, version: 'V1' }];
          }
          if (sql.includes("FROM process_templates") && sql.includes('is_default = 1')) {
            return [{ id: 301 }];
          }
          if (sql.includes('INSERT INTO production_orders')) {
            return { insertId: 401 };
          }
          if (sql.includes('INSERT INTO material_requirements')) {
            return { insertId: 501 };
          }
          if (sql.includes('SELECT qty_on_hand, qty_reserved')) {
            return [{ qty_on_hand: '100', qty_reserved: '20' }];
          }
          if (sql.includes('UPDATE inventory') && sql.includes('qty_on_hand - qty_reserved >= ?')) {
            return { affectedRows: 1 };
          }
          if (sql.includes('INSERT INTO inventory_daily_snapshots')) {
            return { affectedRows: 1 };
          }
          if (sql.includes('UPDATE material_requirements')) {
            return { affectedRows: 1 };
          }
          if (sql.includes('UPDATE production_orders')) {
            return { affectedRows: 1 };
          }
          if (sql.includes('UPDATE sales_orders')) {
            return { affectedRows: 1 };
          }
          return [];
        }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      jest.spyOn(BomSnapshotService.prototype, 'createSnapshot').mockResolvedValue({
        snapshotId: 701,
        reused: false,
        expandedItems: [{ skuId: 901, qty: '10' }] as any,
      });
      jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('WO-00002');

      const svc = new ProductionOrderService({ tenantId: 7, userId: 11 });
      await svc.createFromSalesOrder(4);

      const inventoryLockCall = (manager.query.mock.calls as unknown[][]).find((call) =>
        String(call[0]).includes('SELECT qty_on_hand, qty_reserved')
        && String(call[0]).includes('FOR UPDATE'),
      );
      expect(inventoryLockCall?.[1]).toEqual([901, 7]);

      const snapshotCall = (manager.query.mock.calls as unknown[][]).find((call) =>
        String(call[0]).includes('INSERT INTO inventory_daily_snapshots'),
      );
      expect(snapshotCall?.[1]).toEqual([7, 901]);
      expect(mockRedisDel).toHaveBeenCalledWith('inventory:7:901');
    });

    it('does not invalidate inventory cache when createFromSalesOrder transaction fails', async () => {
      const manager = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('FROM sales_orders')) {
            return [{ id: 1, order_no: 'SO-4', status: 'confirmed', expected_delivery: '2026-03-30' }];
          }
          if (sql.includes('FROM sales_order_items')) {
            return [{ id: 11, sku_id: 101, sku_code: 'SKU-101', qty_ordered: '5' }];
          }
          if (sql.includes('FROM bom_headers')) {
            return [{ id: 201, version: 'V1' }];
          }
          if (sql.includes("FROM process_templates") && sql.includes('is_default = 1')) {
            return [{ id: 301 }];
          }
          if (sql.includes('INSERT INTO production_orders')) {
            return { insertId: 401 };
          }
          if (sql.includes('INSERT INTO material_requirements')) {
            return { insertId: 501 };
          }
          if (sql.includes('SELECT qty_on_hand, qty_reserved')) {
            return [{ qty_on_hand: '100', qty_reserved: '20' }];
          }
          if (sql.includes('UPDATE inventory') && sql.includes('qty_on_hand - qty_reserved >= ?')) {
            return { affectedRows: 1 };
          }
          if (sql.includes('INSERT INTO inventory_daily_snapshots')) {
            return { affectedRows: 1 };
          }
          if (sql.includes('UPDATE material_requirements')) {
            return { affectedRows: 1 };
          }
          if (sql.includes('UPDATE production_orders')) {
            throw new Error('update production order material status failed');
          }
          return [];
        }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      jest.spyOn(BomSnapshotService.prototype, 'createSnapshot').mockResolvedValue({
        snapshotId: 701,
        reused: false,
        expandedItems: [{ skuId: 901, qty: '10' }] as any,
      });
      jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('WO-00003');

      const svc = new ProductionOrderService({ tenantId: 7, userId: 11 });
      await expect(svc.createFromSalesOrder(4)).rejects.toThrow('update production order material status failed');

      expect(mockRedisDel).not.toHaveBeenCalled();
    });

    it('does not invalidate inventory cache when createFromSalesOrder commit fails after snapshot sync', async () => {
      const manager = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('FROM sales_orders')) {
            return [{ id: 1, order_no: 'SO-4', status: 'confirmed', expected_delivery: '2026-03-30' }];
          }
          if (sql.includes('FROM sales_order_items')) {
            return [{ id: 11, sku_id: 101, sku_code: 'SKU-101', qty_ordered: '5' }];
          }
          if (sql.includes('FROM bom_headers')) {
            return [{ id: 201, version: 'V1' }];
          }
          if (sql.includes("FROM process_templates") && sql.includes('is_default = 1')) {
            return [{ id: 301 }];
          }
          if (sql.includes('INSERT INTO production_orders')) {
            return { insertId: 401 };
          }
          if (sql.includes('INSERT INTO material_requirements')) {
            return { insertId: 501 };
          }
          if (sql.includes('SELECT qty_on_hand, qty_reserved')) {
            return [{ qty_on_hand: '100', qty_reserved: '20' }];
          }
          if (sql.includes('UPDATE inventory') && sql.includes('qty_on_hand - qty_reserved >= ?')) {
            return { affectedRows: 1 };
          }
          if (sql.includes('INSERT INTO inventory_daily_snapshots')) {
            return { affectedRows: 1 };
          }
          if (sql.includes('UPDATE material_requirements')) {
            return { affectedRows: 1 };
          }
          if (sql.includes('UPDATE production_orders')) {
            return { affectedRows: 1 };
          }
          if (sql.includes('UPDATE sales_orders')) {
            return { affectedRows: 1 };
          }
          return [];
        }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => {
        await cb(manager);
        throw new Error('createFromSalesOrder commit failed');
      });

      jest.spyOn(BomSnapshotService.prototype, 'createSnapshot').mockResolvedValue({
        snapshotId: 701,
        reused: false,
        expandedItems: [{ skuId: 901, qty: '10' }] as any,
      });
      jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('WO-00004');

      const svc = new ProductionOrderService({ tenantId: 7, userId: 11 });
      await expect(svc.createFromSalesOrder(4)).rejects.toThrow('createFromSalesOrder commit failed');

      const snapshotCall = (manager.query.mock.calls as unknown[][]).find((call) =>
        String(call[0]).includes('INSERT INTO inventory_daily_snapshots'),
      );
      expect(snapshotCall).toBeDefined();
      expect(mockRedisDel).not.toHaveBeenCalled();
    });
  });

  describe('ProductionOrderService.cancel', () => {
    it('syncs inventory_daily_snapshots and invalidates cache after releasing reserved inventory', async () => {
      const manager = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('FROM production_orders')) {
            return [{ id: 9, status: 'pending', bom_snapshot_id: 11 }];
          }
          if (sql.includes('UPDATE production_orders')) return { affectedRows: 1 };
          if (sql.includes('UPDATE production_tasks')) return { affectedRows: 1 };
          if (sql.includes('FROM material_requirements')) {
            return [{ sku_id: 301, qty_reserved: '12.5000' }];
          }
          if (sql.includes('UPDATE inventory')) return { affectedRows: 1 };
          if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
          if (sql.includes('UPDATE material_requirements')) return { affectedRows: 1 };
          return [];
        }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      const svc = new ProductionOrderService({ tenantId: 7, userId: 11 });
      await svc.cancel(9);

      const orderLockCall = (manager.query.mock.calls as unknown[][]).find((call) =>
        String(call[0]).includes('FROM production_orders')
        && String(call[0]).includes('FOR UPDATE'),
      );
      expect(orderLockCall?.[1]).toEqual([9, 7]);

      const snapshotCall = (manager.query.mock.calls as unknown[][]).find((call) =>
        String(call[0]).includes('INSERT INTO inventory_daily_snapshots'),
      );
      expect(snapshotCall?.[1]).toEqual([7, 301]);
      expect(mockRedisDel).toHaveBeenCalledWith('inventory:7:301');
    });

    it('does not invalidate inventory cache when cancel transaction fails', async () => {
      const manager = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('FROM production_orders')) {
            return [{ id: 9, status: 'pending', bom_snapshot_id: 11 }];
          }
          if (sql.includes('UPDATE production_orders')) return { affectedRows: 1 };
          if (sql.includes('UPDATE production_tasks')) return { affectedRows: 1 };
          if (sql.includes('FROM material_requirements')) {
            return [{ sku_id: 301, qty_reserved: '12.5000' }];
          }
          if (sql.includes('UPDATE inventory')) return { affectedRows: 1 };
          if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
          if (sql.includes('UPDATE material_requirements')) {
            throw new Error('reset requirement failed');
          }
          return [];
        }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      const svc = new ProductionOrderService({ tenantId: 7, userId: 11 });
      await expect(svc.cancel(9)).rejects.toThrow('reset requirement failed');

      expect(mockRedisDel).not.toHaveBeenCalled();
    });

    it('does not invalidate inventory cache when cancel commit fails after snapshot sync', async () => {
      const manager = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('FROM production_orders')) {
            return [{ id: 9, status: 'pending', bom_snapshot_id: 11 }];
          }
          if (sql.includes('UPDATE production_orders')) return { affectedRows: 1 };
          if (sql.includes('UPDATE production_tasks')) return { affectedRows: 1 };
          if (sql.includes('FROM material_requirements')) {
            return [{ sku_id: 301, qty_reserved: '12.5000' }];
          }
          if (sql.includes('UPDATE inventory')) return { affectedRows: 1 };
          if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
          if (sql.includes('UPDATE material_requirements')) return { affectedRows: 1 };
          return [];
        }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => {
        await cb(manager);
        throw new Error('cancel commit failed');
      });

      const svc = new ProductionOrderService({ tenantId: 7, userId: 11 });
      await expect(svc.cancel(9)).rejects.toThrow('cancel commit failed');

      const snapshotCall = (manager.query.mock.calls as unknown[][]).find((call) =>
        String(call[0]).includes('INSERT INTO inventory_daily_snapshots'),
      );
      expect(snapshotCall).toBeDefined();
      expect(mockRedisDel).not.toHaveBeenCalled();
    });
  });

  describe('ProductionOrderService.getMaterialRequirements', () => {
    it('returns currentStock as available inventory and inTransit from open purchase orders', async () => {
      mockAppDataSource.query
        .mockResolvedValueOnce([{ id: 3 }])
        .mockResolvedValueOnce([
          {
            id: 91,
            skuId: 301,
            skuCode: 'RM-301',
            skuName: '原料A',
            purchaseUnit: '卷',
            qtyRequired: '100.0000',
            qtyReserved: '0.0000',
            qtyShortage: '0.0000',
            status: 'fulfilled',
            qtyOnHand: '88.0000',
            availableQty: '80.0000',
            currentStock: '80.0000',
            inTransit: '20.0000',
          },
        ]);

      const svc = new ProductionOrderService({ tenantId: 7, userId: 11 });
      const rows = await svc.getMaterialRequirements(3);

      expect(rows).toEqual([
        expect.objectContaining({
          currentStock: '80.0000',
          inTransit: '20.0000',
        }),
      ]);

      const detailQueryCall = mockAppDataSource.query.mock.calls[1];
      expect(String(detailQueryCall[0])).toContain('AS currentStock');
      expect(String(detailQueryCall[0])).toContain('AS inTransit');
      expect(String(detailQueryCall[0])).toContain('FROM purchase_order_items poi');
      expect(detailQueryCall[1]).toEqual([7, 3, 7]);
    });
  });

  describe('MrpService.detectShortage', () => {
    it('preserves reserved quantity on requirement rows instead of overwriting it with current available stock', async () => {
      const manager = {
        query: jest
          .fn()
          .mockResolvedValueOnce([{ id: 1, work_order_no: 'WO-1', material_status: 'partial' }])
          .mockResolvedValueOnce([
            {
              id: 21,
              production_order_id: 1,
              bom_snapshot_id: 9,
              sku_id: 301,
              qty_required: '60',
              qty_reserved: '60',
              qty_shortage: '0',
              status: 'fulfilled',
              suggestion_id: null,
            },
          ])
          .mockResolvedValueOnce([
            { qty_on_hand: '100', qty_reserved: '60', qty_in_transit: '0' },
          ])
          .mockResolvedValueOnce({ affectedRows: 1 })
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              id: 301,
              sku_code: 'RM-301',
              name: '原料A',
              stock_unit: 'kg',
              purchase_unit: 'kg',
              safety_stock: '0',
            },
          ])
          .mockResolvedValueOnce({ affectedRows: 1 }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      const svc = new MrpService({ tenantId: 7, userId: 11 });
      await svc.detectShortage(1);

      const requirementUpdateCall = manager.query.mock.calls.find(([sql]) =>
        String(sql).includes('UPDATE material_requirements'),
      );
      expect(requirementUpdateCall?.[1]).toEqual(['60.0000', '0.0000', 'fulfilled', 21, 7]);
    });
  });

  describe('SalesService.updateOrder', () => {
    function buildConstraintReport(overallResult: 'pass' | 'warning' | 'block' = 'warning') {
      return {
        inventoryTurnoverCheck: { passed: true, currentValue: '1', threshold: '2', message: '' },
        capitalOccupationCheck: { passed: true, currentValue: '1', threshold: '2', message: '' },
        productionCostCheck: { passed: true, currentValue: '1', threshold: '2', message: '' },
        capacityLoadCheck: { passed: true, currentValue: '1', threshold: '2', message: '' },
        overallResult,
        blockedReasons: [],
        impactAnalysis: {
          affectedOrders: [],
          additionalCapital: '0.00',
          additionalProductionCost: '0.00',
        },
      };
    }

    it('uses tenant filter when loading fallback expected_delivery and computes constraints once', async () => {
      const manager = {
        query: jest.fn().mockResolvedValue({ affectedRows: 1, insertId: 1 }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));
      mockAppDataSource.query.mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes('SELECT id, status, order_type, order_no FROM sales_orders')) {
          return [{ id: 10, status: 'confirmed', order_type: 'normal', order_no: 'SO-10' }];
        }
        if (sql.includes('SELECT DATE_FORMAT(expected_delivery')) {
          return [{ expected_delivery: '2026-03-31' }];
        }
        throw new Error(`unexpected query: ${sql} ${JSON.stringify(params)}`);
      });

      const svc = new SalesService({ tenantId: 9, userId: 100, roles: ['sales'] });
      const checkSpy = jest
        .spyOn((svc as any).constraintEngine, 'check')
        .mockResolvedValue(buildConstraintReport());

      await svc.updateOrder(10, {
        items: [{ skuId: 1, bomId: 1, qtyOrdered: '5', unitPrice: '12.30' }],
      });

      expect(checkSpy).toHaveBeenCalledTimes(1);

      const deliveryQueryCall = mockAppDataSource.query.mock.calls.find(
        ([sql]) => String(sql).includes('SELECT DATE_FORMAT(expected_delivery'),
      );
      expect(deliveryQueryCall).toBeTruthy();
      expect(String(deliveryQueryCall![0])).toContain('tenant_id = ?');
      expect(deliveryQueryCall![1]).toEqual([10, 9]);

      const occInserts = manager.query.mock.calls.filter(([sql]) =>
        String(sql).includes('INSERT INTO order_constraint_checks'),
      );
      expect(occInserts).toHaveLength(1);
    });
  });

  describe('SalesService.cancelOrder', () => {
    it('releases material reservations from linked production orders and invalidates cache after commit', async () => {
      mockAppDataSource.query.mockResolvedValueOnce([{ id: 8, status: 'confirmed', order_no: 'SO-8' }]);

      const manager = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('SELECT id') && sql.includes('FROM production_orders')) {
            return [{ id: 901 }];
          }
          if (sql.includes('FROM material_requirements')) {
            return [{ sku_id: 301, qty_reserved: '12.5000' }];
          }
          if (sql.includes('UPDATE sales_orders')) return { affectedRows: 1 };
          if (sql.includes('UPDATE production_orders')) return { affectedRows: 1 };
          if (sql.includes('UPDATE production_tasks')) return { affectedRows: 1 };
          if (sql.includes('UPDATE inventory')) return { affectedRows: 1 };
          if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
          if (sql.includes('UPDATE material_requirements')) return { affectedRows: 1 };
          return { affectedRows: 1 };
        }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => {
        const txManager = manager as typeof manager & { __inventorySnapshotSkuIds?: Set<number> };
        const result = await cb(txManager);
        expect(mockRedisDel).not.toHaveBeenCalled();
        return result;
      });

      const svc = new SalesService({ tenantId: 7, userId: 11 });
      const result = await svc.cancelOrder(8, '客户撤单');

      expect(result).toEqual({
        orderId: 8,
        orderNo: 'SO-8',
        cancelledProductionOrders: 1,
        releasedSkus: 1,
      });

      const inventoryUpdateCall = (manager.query.mock.calls as unknown[][]).find((call) =>
        String(call[0]).includes('UPDATE inventory'),
      );
      expect(inventoryUpdateCall?.[1]).toEqual(['12.5000', 301, 7]);

      const productionOrderLockCall = (manager.query.mock.calls as unknown[][]).find((call) =>
        String(call[0]).includes('FROM production_orders')
        && String(call[0]).includes('FOR UPDATE'),
      );
      expect(productionOrderLockCall?.[1]).toEqual([8, 7]);

      const snapshotCall = (manager.query.mock.calls as unknown[][]).find((call) =>
        String(call[0]).includes('INSERT INTO inventory_daily_snapshots'),
      );
      expect(snapshotCall?.[1]).toEqual([7, 301]);

      const resetRequirementCall = (manager.query.mock.calls as unknown[][]).find((call) =>
        String(call[0]).includes('UPDATE material_requirements'),
      );
      expect(String(resetRequirementCall?.[0])).toContain('qty_shortage = qty_required');

      expect((manager as typeof manager & { __inventorySnapshotSkuIds?: Set<number> }).__inventorySnapshotSkuIds)
        .toBeUndefined();
      expect(mockRedisDel).toHaveBeenCalledWith('inventory:7:301');
    });

    it('does not invalidate inventory cache when cancel-order transaction fails', async () => {
      mockAppDataSource.query.mockResolvedValueOnce([{ id: 8, status: 'confirmed', order_no: 'SO-8' }]);

      const manager = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('SELECT id') && sql.includes('FROM production_orders')) {
            return [{ id: 901 }];
          }
          if (sql.includes('FROM material_requirements')) {
            return [{ sku_id: 301, qty_reserved: '12.5000' }];
          }
          if (sql.includes('UPDATE sales_orders')) return { affectedRows: 1 };
          if (sql.includes('UPDATE production_orders')) return { affectedRows: 1 };
          if (sql.includes('UPDATE production_tasks')) return { affectedRows: 1 };
          if (sql.includes('UPDATE inventory')) {
            throw new Error('release reservation failed');
          }
          return { affectedRows: 1 };
        }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      const svc = new SalesService({ tenantId: 7, userId: 11 });
      await expect(svc.cancelOrder(8, '客户撤单')).rejects.toThrow('release reservation failed');

      expect(mockRedisDel).not.toHaveBeenCalled();
    });

    it('does not invalidate inventory cache when cancel-order fails after snapshot sync', async () => {
      mockAppDataSource.query.mockResolvedValueOnce([{ id: 8, status: 'confirmed', order_no: 'SO-8' }]);

      const manager = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('SELECT id') && sql.includes('FROM production_orders')) {
            return [{ id: 901 }];
          }
          if (sql.includes('FROM material_requirements') && sql.includes('GROUP BY sku_id')) {
            return [{ sku_id: 301, qty_reserved: '12.5000' }];
          }
          if (sql.includes('UPDATE sales_orders')) return { affectedRows: 1 };
          if (sql.includes('UPDATE production_orders')) return { affectedRows: 1 };
          if (sql.includes('UPDATE production_tasks')) return { affectedRows: 1 };
          if (sql.includes('UPDATE inventory')) return { affectedRows: 1 };
          if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
          if (sql.includes('UPDATE material_requirements') && sql.includes('qty_shortage = qty_required')) {
            throw new Error('reset requirements failed after snapshot');
          }
          return { affectedRows: 1 };
        }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      const svc = new SalesService({ tenantId: 7, userId: 11 });
      await expect(svc.cancelOrder(8, '客户撤单')).rejects.toThrow('reset requirements failed after snapshot');

      const snapshotCall = (manager.query.mock.calls as unknown[][]).find((call) =>
        String(call[0]).includes('INSERT INTO inventory_daily_snapshots'),
      );
      expect(snapshotCall).toBeDefined();
      expect(mockRedisDel).not.toHaveBeenCalled();
    });

    it('does not invalidate inventory cache when cancel-order commit fails after snapshot sync', async () => {
      mockAppDataSource.query.mockResolvedValueOnce([{ id: 8, status: 'confirmed', order_no: 'SO-8' }]);

      const manager = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('SELECT id') && sql.includes('FROM production_orders')) {
            return [{ id: 901 }];
          }
          if (sql.includes('FROM material_requirements') && sql.includes('GROUP BY sku_id')) {
            return [{ sku_id: 301, qty_reserved: '12.5000' }];
          }
          if (sql.includes('UPDATE sales_orders')) return { affectedRows: 1 };
          if (sql.includes('UPDATE production_orders')) return { affectedRows: 1 };
          if (sql.includes('UPDATE production_tasks')) return { affectedRows: 1 };
          if (sql.includes('UPDATE inventory')) return { affectedRows: 1 };
          if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
          if (sql.includes('UPDATE material_requirements') && sql.includes('qty_shortage = qty_required')) {
            return { affectedRows: 1 };
          }
          return { affectedRows: 1 };
        }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => {
        await cb(manager);
        throw new Error('cancel-order commit failed');
      });

      const svc = new SalesService({ tenantId: 7, userId: 11 });
      await expect(svc.cancelOrder(8, '客户撤单')).rejects.toThrow('cancel-order commit failed');

      const snapshotCall = (manager.query.mock.calls as unknown[][]).find((call) =>
        String(call[0]).includes('INSERT INTO inventory_daily_snapshots'),
      );
      expect(snapshotCall).toBeDefined();
      expect(mockRedisDel).not.toHaveBeenCalled();
    });
  });

  describe('SalesService create and urgent analysis', () => {
    function buildSalesConstraintReport(overallResult: 'pass' | 'warning' | 'block' = 'pass') {
      return {
        inventoryTurnoverCheck: { passed: overallResult !== 'block', currentValue: '28天', threshold: '45天', detail: '库存周转正常' },
        capitalOccupationCheck: { passed: true, currentValue: '18万', threshold: '25万', detail: '资金占用可控' },
        productionCostCheck: { passed: true, currentValue: '6120', threshold: '7000', detail: '成本增加有限' },
        capacityLoadCheck: { passed: overallResult === 'pass', currentValue: '92%', threshold: '85%', detail: '未来三天产能负荷偏高' },
        overallResult,
        blockedReasons: overallResult === 'block' ? ['未来三天产能负荷偏高'] : [],
        impactAnalysis: {
          affectedOrders: [{ orderId: 202, orderNo: 'SO-202', delayDays: 1 }],
          additionalCapital: '180000.00',
          turnoverDaysChange: '+2',
          additionalProductionCost: '1200.00',
        },
      };
    }

    it('analyzeUrgentOrder delegates to constraint engine with urgent flag', async () => {
      const svc = new SalesService({ tenantId: 9, userId: 100, roles: ['sales'] });
      const report = buildSalesConstraintReport('warning');
      const checkSpy = jest
        .spyOn((svc as any).constraintEngine, 'check')
        .mockResolvedValue(report);

      await expect(
        svc.analyzeUrgentOrder({
          skuId: 901,
          bomId: 11,
          qty: '7',
          expectedDelivery: '2026-03-29',
        }),
      ).resolves.toEqual(report);

      expect(checkSpy).toHaveBeenCalledWith(901, 11, '7', '2026-03-29', true);
    });

    it('createOrder keeps normal orders confirmed when constraints pass', async () => {
      const manager = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ insertId: 501 })
          .mockResolvedValueOnce({ insertId: 601 })
          .mockResolvedValueOnce({ insertId: 701 }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      const svc = new SalesService({ tenantId: 9, userId: 100, roles: ['sales'] });
      jest.spyOn(svc as any, 'generateOrderNo').mockReturnValue('SO-NORMAL-1');
      jest
        .spyOn((svc as any).constraintEngine, 'check')
        .mockResolvedValue(buildSalesConstraintReport('pass'));

      const result = await svc.createOrder({
        customerId: 12,
        orderType: 'normal',
        expectedDelivery: '2026-04-03',
        notes: '常规订单自动确认',
        items: [{ skuId: 901, bomId: 11, qtyOrdered: '9', unitPrice: '680.00' }],
      });

      expect(result).toEqual({
        orderId: 501,
        orderNo: 'SO-NORMAL-1',
        constraintResult: 'pass',
        estimatedDelivery: null,
        requiresApproval: false,
      });
      expect(manager.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('INSERT INTO sales_orders'),
        expect.arrayContaining([9, 'SO-NORMAL-1', 12, 'normal', 'confirmed', '2026-04-03', '6120.00', 1, 'not_required', 100]),
      );
    });

    it('createOrder sends blocked urgent orders into pending approval', async () => {
      const manager = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ insertId: 502 })
          .mockResolvedValueOnce({ insertId: 602 })
          .mockResolvedValueOnce({ insertId: 702 }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      const svc = new SalesService({ tenantId: 9, userId: 100, roles: ['sales'] });
      jest.spyOn(svc as any, 'generateOrderNo').mockReturnValue('SO-URGENT-1');
      jest
        .spyOn((svc as any).constraintEngine, 'check')
        .mockResolvedValue(buildSalesConstraintReport('block'));

      const result = await svc.createOrder({
        customerId: 13,
        orderType: 'urgent',
        expectedDelivery: '2026-03-29',
        notes: '紧急插单评估链路',
        items: [{ skuId: 903, bomId: 15, qtyOrdered: '7', unitPrice: '760.00' }],
      });

      expect(result).toEqual({
        orderId: 502,
        orderNo: 'SO-URGENT-1',
        constraintResult: 'block',
        estimatedDelivery: null,
        requiresApproval: true,
      });
      expect(manager.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('INSERT INTO sales_orders'),
        expect.arrayContaining([9, 'SO-URGENT-1', 13, 'urgent', 'pending_approval', '2026-03-29', '5320.00', 0, 'pending', 100]),
      );
    });
  });

  describe('SalesService settlements', () => {
    it('createSettlement allows partial_shipped orders and inserts pending settlement', async () => {
      const manager = {
        query: jest
          .fn()
          .mockResolvedValueOnce([
            { id: 21, status: 'partial_shipped', total_amount: '5320.00', order_no: 'SO-21' },
          ])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce({ insertId: 801 }),
      };
      mockAppDataSource.transaction.mockImplementationOnce(async (cb: any) => cb(manager));

      const svc = new SalesService({ tenantId: 9, userId: 100, roles: ['sales'] });
      jest.spyOn(svc as any, 'generateSettlementNo').mockReturnValue('ST-0001');

      await expect(
        svc.createSettlement(21, { dueDate: '2026-04-10', notes: '首张结算单' }),
      ).resolves.toEqual({
        settlementId: 801,
        settlementNo: 'ST-0001',
      });

      const lockCall = (manager.query.mock.calls as unknown[][]).find((call) =>
        String(call[0]).includes('FROM sales_orders')
        && String(call[0]).includes('FOR UPDATE'),
      );
      expect(lockCall?.[1]).toEqual([21, 9]);

      expect(manager.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining("INSERT INTO sales_settlements"),
        [9, 21, 'ST-0001', '5320.00', '2026-04-10', '首张结算单', 100, 100],
      );
    });

    it('createSettlement rejects duplicate settlement for the same order', async () => {
      const manager = {
        query: jest
          .fn()
          .mockResolvedValueOnce([
            { id: 21, status: 'shipped', total_amount: '5320.00', order_no: 'SO-21' },
          ])
          .mockResolvedValueOnce([{ id: 801 }]),
      };
      mockAppDataSource.transaction.mockImplementationOnce(async (cb: any) => cb(manager));

      const svc = new SalesService({ tenantId: 9, userId: 100, roles: ['sales'] });
      await expect(
        svc.createSettlement(21, { dueDate: '2026-04-10' }),
      ).rejects.toThrow('该订单已有结算单，请勿重复创建');

      const lockCall = (manager.query.mock.calls as unknown[][]).find((call) =>
        String(call[0]).includes('FROM sales_orders')
        && String(call[0]).includes('FOR UPDATE'),
      );
      expect(lockCall?.[1]).toEqual([21, 9]);
    });

    it('recordPayment transitions settlement to partial_paid then paid', async () => {
      const manager = {
        query: jest
          .fn()
          .mockResolvedValueOnce([
            { id: 31, total_amount: '1000.00', paid_amount: '200.00', status: 'pending' },
          ])
          .mockResolvedValueOnce({ insertId: 901 })
          .mockResolvedValueOnce({ affectedRows: 1 }),
      };
      mockAppDataSource.transaction.mockImplementationOnce(async (cb: any) => cb(manager));

      const svc = new SalesService({ tenantId: 9, userId: 100, roles: ['sales'] });
      await expect(
        svc.recordPayment(31, {
          paymentAmount: '300.00',
          paymentDate: '2026-03-24',
          paymentMethod: 'bank_transfer',
        }),
      ).resolves.toEqual({
        paymentId: 901,
        settlementStatus: 'partial_paid',
      });

      const lockCall = (manager.query.mock.calls as unknown[][]).find((call) =>
        String(call[0]).includes('FROM sales_settlements')
        && String(call[0]).includes('FOR UPDATE'),
      );
      expect(lockCall?.[1]).toEqual([31, 9]);

      expect(manager.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('UPDATE sales_settlements SET paid_amount = ?, status = ?, updated_by = ?'),
        ['500.00', 'partial_paid', 100, 31, 9],
      );

      const manager2 = {
        query: jest
          .fn()
          .mockResolvedValueOnce([
            { id: 31, total_amount: '1000.00', paid_amount: '500.00', status: 'partial_paid' },
          ])
          .mockResolvedValueOnce({ insertId: 902 })
          .mockResolvedValueOnce({ affectedRows: 1 }),
      };
      mockAppDataSource.transaction.mockImplementationOnce(async (cb: any) => cb(manager2));

      await expect(
        svc.recordPayment(31, {
          paymentAmount: '500.00',
          paymentDate: '2026-03-25',
        }),
      ).resolves.toEqual({
        paymentId: 902,
        settlementStatus: 'paid',
      });
    });

    it('recordPayment rejects overpayment', async () => {
      const manager = {
        query: jest.fn().mockResolvedValueOnce([
          { id: 32, total_amount: '1000.00', paid_amount: '900.00', status: 'partial_paid' },
        ]),
      };
      mockAppDataSource.transaction.mockImplementationOnce(async (cb: any) => cb(manager));

      const svc = new SalesService({ tenantId: 9, userId: 100, roles: ['sales'] });
      await expect(
        svc.recordPayment(32, {
          paymentAmount: '200.00',
          paymentDate: '2026-03-24',
        }),
      ).rejects.toThrow('付款总额 1100.00 超过结算金额 1000.00');
    });

    it('recordPayment rejects already paid settlement', async () => {
      const manager = {
        query: jest.fn().mockResolvedValueOnce([
          { id: 33, total_amount: '1000.00', paid_amount: '1000.00', status: 'paid' },
        ]),
      };
      mockAppDataSource.transaction.mockImplementationOnce(async (cb: any) => cb(manager));

      const svc = new SalesService({ tenantId: 9, userId: 100, roles: ['sales'] });
      await expect(
        svc.recordPayment(33, {
          paymentAmount: '10.00',
          paymentDate: '2026-03-24',
        }),
      ).rejects.toThrow('该结算单已全额付清');
    });

    it('updateInvoice rejects missing settlement', async () => {
      mockAppDataSource.query.mockResolvedValueOnce({ affectedRows: 0 });

      const svc = new SalesService({ tenantId: 9, userId: 100, roles: ['sales'] });
      await expect(
        svc.updateInvoice(99, {
          invoiceNo: 'INV-404',
          invoiceDate: '2026-03-24',
        }),
      ).rejects.toThrow('结算单不存在');
    });

    it('getReceivableSummary computes remaining and overdue amounts from open settlements', async () => {
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      mockAppDataSource.query.mockResolvedValueOnce([
        {
          id: 41,
          total_amount: '1000.00',
          paid_amount: '200.00',
          status: 'pending',
          due_date: new Date('2026-03-20T00:00:00Z'),
          order_no: 'SO-41',
          customerName: '华北客户',
        },
        {
          id: 42,
          total_amount: '600.00',
          paid_amount: '100.00',
          status: 'partial_paid',
          due_date: tomorrow,
          order_no: 'SO-42',
          customerName: '华东客户',
        },
      ]);

      const svc = new SalesService({ tenantId: 9, userId: 100, roles: ['sales'] });
      await expect(svc.getReceivableSummary()).resolves.toEqual({
        totalReceivable: '1300.00',
        overdueAmount: '800.00',
        overdueCount: 1,
        settlements: expect.any(Array),
      });
    });
  });

  describe('AiService.queryOrderStatus', () => {
    it('queries sales_order_items.qty_ordered as qty (no legacy soi.qty)', async () => {
      mockAppDataSource.query.mockResolvedValue([]);
      const svc = new AiService({ tenantId: 3, userId: 9, roles: ['boss'] });

      await (svc as any).queryOrderStatus(
        {
          intent: 'order_status',
          confidence: 'high',
          score: 0.9,
          entities: [],
          matchedRules: [],
        },
        { tenantId: 3, userId: 9 },
      );

      const sql = String(mockAppDataSource.query.mock.calls[0][0]);
      expect(sql).toContain('soi.qty_ordered AS qty');
      expect(sql).not.toContain('soi.qty,');
    });
  });

  describe('SalesOrderService production handoff', () => {
    it('getById returns approver and audit operator names for drawer display', async () => {
      mockAppDataSource.query
        .mockResolvedValueOnce([
          {
            id: 7,
            orderNo: 'SO-1007',
            customerId: 3,
            customerName: '测试客户',
            orderDate: '2026-03-24',
            deliveryDate: '2026-03-30',
            isUrgent: true,
            status: 'pending_approval',
            totalAmount: '100.00',
            approvedBy: 88,
            approvedByName: '老板A',
            approvedAt: '2026-03-24 10:00:00',
            approvalStatus: 'approved',
            approvalNotes: '同意',
            createdAt: '2026-03-24 09:00:00',
            updatedAt: '2026-03-24 10:00:00',
          },
        ])
        .mockResolvedValueOnce([
          { id: 1, productName: 'SKU-1', quantity: '5', qtyOrdered: '5', qtyDelivered: '2', unitPrice: '20.00', amount: '100.00' },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: 901, action: 'APPROVE', operatorId: 88, operatorName: '老板A', createdAt: '2026-03-24 10:00:00' },
        ]);

      const svc = new SalesOrderService({ tenantId: 5, userId: 8 });
      const data = await svc.getById(7);

      expect(data).toMatchObject({
        approvedByName: '老板A',
        auditLogs: [
          expect.objectContaining({
            action: 'APPROVE',
            operatorId: 88,
            operatorName: '老板A',
          }),
        ],
      });
    });

    it('getById tolerates missing customer master and production query failures', async () => {
      mockAppDataSource.query
        .mockResolvedValueOnce([
          {
            id: 7,
            orderNo: 'SO-1007',
            customerId: 999,
            customerName: '客户#999',
            orderDate: '2026-03-24',
            deliveryDate: '2026-03-30',
            isUrgent: false,
            status: 'confirmed',
            totalAmount: '100.00',
            createdAt: '2026-03-24 09:00:00',
            updatedAt: '2026-03-24 10:00:00',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 1,
            productCode: 'SKU#12',
            productName: 'SKU#12',
            quantity: '5',
            qtyOrdered: '5',
            qtyDelivered: '0',
            unit: '件',
            unitPrice: '20.00',
            amount: '100.00',
          },
        ])
        .mockRejectedValueOnce(new Error('production query failed'))
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const svc = new SalesOrderService({ tenantId: 5, userId: 8 });
      const data = await svc.getById(7);

      expect(data).toMatchObject({
        customerName: '客户#999',
        productionOrders: [],
        items: [
          expect.objectContaining({
            productCode: 'SKU#12',
            productName: 'SKU#12',
            unit: '件',
          }),
        ],
      });
    });

    it('saveAsDraft keeps urgent orders in draft status', async () => {
      const manager = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ insertId: 301 })
          .mockResolvedValueOnce({ insertId: 401 })
          .mockResolvedValueOnce({ insertId: 501 }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      const svc = new SalesOrderService({ tenantId: 5, userId: 8 });
      jest.spyOn(svc as any, '_generateOrderNo').mockResolvedValue('SO-DRAFT-1');

      await svc.create({
        customerId: 10,
        orderDate: '2026-03-24',
        deliveryDate: '2026-03-30',
        isUrgent: true,
        saveAsDraft: true,
        items: [{ skuId: 1, quantity: '5', unitPrice: '12.50' }],
      });

      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO sales_orders'),
        expect.arrayContaining([5, 'SO-DRAFT-1', 10, '2026-03-30', 'urgent', 'draft']),
      );
    });

    it('confirm delegates to ProductionOrderService.createFromSalesOrder in the same transaction', async () => {
      const manager = {
        query: jest.fn().mockResolvedValue({ affectedRows: 1 }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));
      mockAppDataSource.getRepository.mockReturnValue({
        findOne: jest.fn().mockResolvedValue({
          id: 1,
          tenantId: 5,
          status: 'draft',
          orderNo: 'SO-1001',
          createdBy: 8,
        }),
      });

      const createFromSalesOrderSpy = jest
        .spyOn(ProductionOrderService.prototype, 'createFromSalesOrder')
        .mockResolvedValue([
          { id: 101, workOrderNo: 'WO-101', skuId: 1, qtyPlanned: '8', materialStatus: 'ready' },
        ]);

      const svc = new SalesOrderService({ tenantId: 5, userId: 8 });
      await svc.confirm(1);

      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'confirmed'"),
        [8, 8, 1, 5],
      );
      expect(createFromSalesOrderSpy).toHaveBeenCalledWith(1, manager);
    });

    it('confirm invalidates inventory cache after nested production order reservation commits', async () => {
      const manager = {
        query: jest.fn().mockResolvedValue({ affectedRows: 1 }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));
      mockAppDataSource.getRepository.mockReturnValue({
        findOne: jest.fn().mockResolvedValue({
          id: 1,
          tenantId: 5,
          status: 'draft',
          orderNo: 'SO-1001',
          createdBy: 8,
        }),
      });

      const createFromSalesOrderSpy = jest
        .spyOn(ProductionOrderService.prototype, 'createFromSalesOrder')
        .mockImplementation(async (_id, txManager?: any) => {
          txManager.__inventorySnapshotSkuIds = new Set([301]);
          return [{ id: 101, workOrderNo: 'WO-101', skuId: 1, qtyPlanned: '8', materialStatus: 'ready' }];
        });
      const invalidateSpy = jest
        .spyOn(ProductionOrderService.prototype, 'invalidateInventorySnapshotCaches')
        .mockResolvedValue(undefined);

      const svc = new SalesOrderService({ tenantId: 5, userId: 8 });
      await svc.confirm(1);

      expect(createFromSalesOrderSpy).toHaveBeenCalledWith(1, manager);
      expect(invalidateSpy).toHaveBeenCalledWith([301]);
    });

    it('confirm does not invalidate inventory cache when nested production order transaction fails', async () => {
      const manager = {
        query: jest.fn().mockResolvedValue({ affectedRows: 1 }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));
      mockAppDataSource.getRepository.mockReturnValue({
        findOne: jest.fn().mockResolvedValue({
          id: 1,
          tenantId: 5,
          status: 'draft',
          orderNo: 'SO-1001',
          createdBy: 8,
        }),
      });

      const createFromSalesOrderSpy = jest
        .spyOn(ProductionOrderService.prototype, 'createFromSalesOrder')
        .mockImplementation(async (_id, txManager?: any) => {
          txManager.__inventorySnapshotSkuIds = new Set([301]);
          throw new Error('create production order failed');
        });
      const invalidateSpy = jest
        .spyOn(ProductionOrderService.prototype, 'invalidateInventorySnapshotCaches')
        .mockResolvedValue(undefined);

      const svc = new SalesOrderService({ tenantId: 5, userId: 8 });
      await expect(svc.confirm(1)).rejects.toThrow('create production order failed');

      expect(createFromSalesOrderSpy).toHaveBeenCalledWith(1, manager);
      expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it('confirm does not invalidate inventory cache when outer transaction commit fails after nested reservation', async () => {
      const manager = {
        query: jest.fn().mockResolvedValue({ affectedRows: 1 }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => {
        await cb(manager);
        throw new Error('confirm commit failed');
      });
      mockAppDataSource.getRepository.mockReturnValue({
        findOne: jest.fn().mockResolvedValue({
          id: 1,
          tenantId: 5,
          status: 'draft',
          orderNo: 'SO-1001',
          createdBy: 8,
        }),
      });

      const createFromSalesOrderSpy = jest
        .spyOn(ProductionOrderService.prototype, 'createFromSalesOrder')
        .mockImplementation(async (_id, txManager?: any) => {
          txManager.__inventorySnapshotSkuIds = new Set([301]);
          return [{ id: 101, workOrderNo: 'WO-101', skuId: 1, qtyPlanned: '8', materialStatus: 'ready' }];
        });
      const invalidateSpy = jest
        .spyOn(ProductionOrderService.prototype, 'invalidateInventorySnapshotCaches')
        .mockResolvedValue(undefined);

      const svc = new SalesOrderService({ tenantId: 5, userId: 8 });
      await expect(svc.confirm(1)).rejects.toThrow('confirm commit failed');

      expect(createFromSalesOrderSpy).toHaveBeenCalledWith(1, manager);
      expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it('approve does not invalidate inventory cache when nested production order transaction fails', async () => {
      const manager = {
        query: jest.fn().mockResolvedValue({ affectedRows: 1 }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));
      mockAppDataSource.getRepository.mockReturnValue({
        findOne: jest.fn().mockResolvedValue({
          id: 1,
          tenantId: 5,
          status: 'pending_approval',
          orderNo: 'SO-1001',
          createdBy: 8,
        }),
      });

      const createFromSalesOrderSpy = jest
        .spyOn(ProductionOrderService.prototype, 'createFromSalesOrder')
        .mockImplementation(async (_id, txManager?: any) => {
          txManager.__inventorySnapshotSkuIds = new Set([301]);
          throw new Error('approve create production order failed');
        });
      const invalidateSpy = jest
        .spyOn(ProductionOrderService.prototype, 'invalidateInventorySnapshotCaches')
        .mockResolvedValue(undefined);

      const svc = new SalesOrderService({ tenantId: 5, userId: 8 });
      await expect(svc.approve(1, 9)).rejects.toThrow('approve create production order failed');

      expect(createFromSalesOrderSpy).toHaveBeenCalledWith(1, manager);
      expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it('approve does not invalidate inventory cache when outer transaction commit fails after nested reservation', async () => {
      const manager = {
        query: jest.fn().mockResolvedValue({ affectedRows: 1 }),
      };
      mockAppDataSource.transaction.mockImplementation(async (cb: any) => {
        await cb(manager);
        throw new Error('approve commit failed');
      });
      mockAppDataSource.getRepository.mockReturnValue({
        findOne: jest.fn().mockResolvedValue({
          id: 1,
          tenantId: 5,
          status: 'pending_approval',
          orderNo: 'SO-1001',
          createdBy: 8,
        }),
      });

      const createFromSalesOrderSpy = jest
        .spyOn(ProductionOrderService.prototype, 'createFromSalesOrder')
        .mockImplementation(async (_id, txManager?: any) => {
          txManager.__inventorySnapshotSkuIds = new Set([301]);
          return [{ id: 101, workOrderNo: 'WO-101', skuId: 1, qtyPlanned: '8', materialStatus: 'ready' }];
        });
      const invalidateSpy = jest
        .spyOn(ProductionOrderService.prototype, 'invalidateInventorySnapshotCaches')
        .mockResolvedValue(undefined);

      const svc = new SalesOrderService({ tenantId: 5, userId: 8 });
      await expect(svc.approve(1, 9)).rejects.toThrow('approve commit failed');

      expect(createFromSalesOrderSpy).toHaveBeenCalledWith(1, manager);
      expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it('manual createProductionOrders delegates to ProductionOrderService and returns ids only', async () => {
      mockAppDataSource.getRepository.mockReturnValue({
        findOne: jest.fn().mockResolvedValue({
          id: 2,
          tenantId: 5,
          status: 'confirmed',
          orderNo: 'SO-1002',
          createdBy: 8,
        }),
      });

      const createFromSalesOrderSpy = jest
        .spyOn(ProductionOrderService.prototype, 'createFromSalesOrder')
        .mockResolvedValue([
          { id: 201, workOrderNo: 'WO-201', skuId: 1, qtyPlanned: '5', materialStatus: 'partial' },
          { id: 202, workOrderNo: 'WO-202', skuId: 2, qtyPlanned: '3', materialStatus: 'shortage' },
        ]);

      const svc = new SalesOrderService({ tenantId: 5, userId: 8 });
      await expect(svc.createProductionOrders(2)).resolves.toEqual({
        productionOrderIds: [201, 202],
      });

      expect(createFromSalesOrderSpy).toHaveBeenCalledWith(2);
    });

    it('ship delegates to SalesService.shipOrder with remaining undelivered quantities', async () => {
      mockAppDataSource.getRepository.mockReturnValue({
        findOne: jest.fn().mockResolvedValue({
          id: 3,
          tenantId: 5,
          status: 'in_production',
          orderNo: 'SO-1003',
          createdBy: 8,
        }),
      });
      mockAppDataSource.query.mockResolvedValue([
        { id: 11, qty_ordered: '10', qty_delivered: '4' },
        { id: 12, qty_ordered: '3', qty_delivered: '0' },
      ]);

      const shipOrderSpy = jest
        .spyOn(SalesService.prototype, 'shipOrder')
        .mockResolvedValue({ deliveryId: 1, deliveryNo: 'DO-1', orderStatus: 'shipped' });

      const svc = new SalesOrderService({ tenantId: 5, userId: 8 });
      await svc.ship(3, 'TRACK-001');

      expect(shipOrderSpy).toHaveBeenCalledWith(3, {
        trackingNo: 'TRACK-001',
        shippedItems: [
          { orderItemId: 11, shippedQty: 6 },
          { orderItemId: 12, shippedQty: 3 },
        ],
      });
    });

    it('ship respects manually provided shipped items for partial delivery', async () => {
      mockAppDataSource.getRepository.mockReturnValue({
        findOne: jest.fn().mockResolvedValue({
          id: 13,
          tenantId: 5,
          status: 'partial_shipped',
          orderNo: 'SO-1013',
          createdBy: 8,
        }),
      });
      mockAppDataSource.query.mockResolvedValue([
        { id: 31, qty_ordered: '10', qty_delivered: '4' },
        { id: 32, qty_ordered: '5', qty_delivered: '1' },
      ]);

      const shipOrderSpy = jest
        .spyOn(SalesService.prototype, 'shipOrder')
        .mockResolvedValue({ deliveryId: 3, deliveryNo: 'DO-3', orderStatus: 'partial_shipped' });

      const svc = new SalesOrderService({ tenantId: 5, userId: 8 });
      await svc.ship(13, 'TRACK-013', [
        { orderItemId: 31, shippedQty: 2 },
      ]);

      expect(shipOrderSpy).toHaveBeenCalledWith(13, {
        trackingNo: 'TRACK-013',
        shippedItems: [{ orderItemId: 31, shippedQty: 2 }],
      });
    });

    it('ship accepts DB rows whose order item ids are returned as strings', async () => {
      mockAppDataSource.getRepository.mockReturnValue({
        findOne: jest.fn().mockResolvedValue({
          id: 23,
          tenantId: 5,
          status: 'in_production',
          orderNo: 'SO-1023',
          createdBy: 8,
        }),
      });
      mockAppDataSource.query.mockResolvedValue([
        { id: '41', qty_ordered: '8', qty_delivered: '3' },
      ]);

      const shipOrderSpy = jest
        .spyOn(SalesService.prototype, 'shipOrder')
        .mockResolvedValue({ deliveryId: 4, deliveryNo: 'DO-4', orderStatus: 'shipped' });

      const svc = new SalesOrderService({ tenantId: 5, userId: 8 });
      await svc.ship(23, 'TRACK-023', [
        { orderItemId: 41, shippedQty: 5 },
      ]);

      expect(shipOrderSpy).toHaveBeenCalledWith(23, {
        trackingNo: 'TRACK-023',
        shippedItems: [{ orderItemId: 41, shippedQty: 5 }],
      });
    });

    it('complete delegates to SalesService.confirmReceipt for all pending deliveries', async () => {
      mockAppDataSource.getRepository.mockReturnValue({
        findOne: jest.fn().mockResolvedValue({
          id: 4,
          tenantId: 5,
          status: 'shipped',
          orderNo: 'SO-1004',
          createdBy: 8,
        }),
      });
      mockAppDataSource.query.mockResolvedValue([
        { id: 21 },
        { id: 22 },
      ]);

      const confirmReceiptSpy = jest
        .spyOn(SalesService.prototype, 'confirmReceipt')
        .mockResolvedValue({ deliveryId: 21, orderStatus: 'completed', orderCompleted: true });

      const svc = new SalesOrderService({ tenantId: 5, userId: 8 });
      await svc.complete(4);

      expect(confirmReceiptSpy).toHaveBeenNthCalledWith(1, 4, 21);
      expect(confirmReceiptSpy).toHaveBeenNthCalledWith(2, 4, 22);
    });
  });
});
