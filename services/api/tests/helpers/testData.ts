/**
 * 测试数据工厂
 *
 * 提供标准化的测试数据构造器（Builder 模式）
 * 所有测试租户 ID 统一使用 9999，避免与生产数据冲突
 */

import { randomUUID } from 'crypto';

export const TEST_TENANT_ID = 9999;
export const TEST_USER_ID = 99001;
export const TEST_BOSS_USER_ID = 99001;
export const TEST_PURCHASER_USER_ID = 99002;
export const TEST_WAREHOUSE_USER_ID = 99003;
export const TEST_SUPERVISOR_USER_ID = 99004;
export const TEST_WORKER_USER_ID = 99005;
export const TEST_QC_USER_ID = 99006;
export const TEST_SALES_USER_ID = 99007;

// ─── SKU 测试数据工厂 ──────────────────────────────────────────

export interface SkuCreateData {
  tenantId?: number;
  name: string;
  spec?: string;
  category1Id?: number;
  category2Id?: number;
  stockUnit?: string;
  purchaseUnit?: string;
  productionUnit?: string;
  hasDyeLot?: boolean;
  safetyStock?: string;
}

export function buildSkuData(override: Partial<SkuCreateData> = {}): SkuCreateData {
  return {
    tenantId: TEST_TENANT_ID,
    name: `测试SKU-${Date.now()}`,
    spec: '标准规格',
    category1Id: 1,
    category2Id: 10,
    stockUnit: '张',
    purchaseUnit: '箱',
    productionUnit: '张',
    hasDyeLot: false,
    safetyStock: '50',
    ...override,
  };
}

export function buildFabricSkuData(override: Partial<SkuCreateData> = {}): SkuCreateData {
  return buildSkuData({
    name: `测试面料-${Date.now()}`,
    stockUnit: '米',
    purchaseUnit: '卷',
    productionUnit: '平方米',
    hasDyeLot: true,
    category2Id: 20, // 面料类
    ...override,
  });
}

// ─── BOM 测试数据工厂 ──────────────────────────────────────────

export interface BomItemData {
  componentSkuId: number;
  quantity: string;
  unit: string;
  scrapRate?: string;
  sortOrder?: number;
  children?: BomItemData[];
}

export interface BomCreateData {
  skuId: number;
  version?: string;
  description?: string;
  items: BomItemData[];
}

export function buildBomData(skuId: number, componentSkuId: number, override: Partial<BomCreateData> = {}): BomCreateData {
  return {
    skuId,
    version: '1.0',
    description: '测试BOM',
    items: [
      {
        componentSkuId,
        quantity: '3',
        unit: '张',
        scrapRate: '0.05',
        sortOrder: 1,
      },
    ],
    ...override,
  };
}

export function buildMultiLevelBomData(
  skuId: number,
  semiSkuId: number,
  rawSkuId: number,
): BomCreateData {
  return {
    skuId,
    version: '2.0',
    description: '多层BOM测试',
    items: [
      {
        componentSkuId: semiSkuId,
        quantity: '1',
        unit: '套',
        scrapRate: '0',
        sortOrder: 1,
        children: [
          {
            componentSkuId: rawSkuId,
            quantity: '3',
            unit: '张',
            scrapRate: '0.05',
            sortOrder: 1,
          },
        ],
      },
    ],
  };
}

// ─── 库存事务测试数据工厂 ────────────────────────────────────

export interface InboundData {
  skuId: number;
  qtyInput: string;
  inputUnit: string;
  transactionType: 'PURCHASE_IN' | 'PRODUCTION_IN' | 'ADJUSTMENT_IN';
  dyeLotNo?: string;
  referenceType?: string;
  referenceId?: number;
  batchCost?: string;
  notes?: string;
}

export function buildInboundData(skuId: number, override: Partial<InboundData> = {}): InboundData {
  return {
    skuId,
    qtyInput: '100',
    inputUnit: '张',
    transactionType: 'PURCHASE_IN',
    notes: '测试入库',
    ...override,
  };
}

export function buildFabricInboundData(skuId: number, dyeLotNo: string, override: Partial<InboundData> = {}): InboundData {
  return buildInboundData(skuId, {
    inputUnit: '米',
    dyeLotNo,
    ...override,
  });
}

export interface OutboundData {
  skuId: number;
  qtyInput: string;
  inputUnit: string;
  transactionType: 'MATERIAL_OUT' | 'DELIVERY_OUT' | 'ADJUSTMENT_OUT';
  dyeLotNo?: string;
  productionOrderId?: number;
}

export function buildOutboundData(skuId: number, override: Partial<OutboundData> = {}): OutboundData {
  return {
    skuId,
    qtyInput: '10',
    inputUnit: '张',
    transactionType: 'MATERIAL_OUT',
    ...override,
  };
}

// ─── 三单匹配测试数据工厂 ────────────────────────────────────

export interface ThreeWayMatchData {
  poId: number;
  deliveryNoteId: number;
  receiptId: number;
}

export function buildThreeWayMatchData(
  poId: number,
  deliveryNoteId: number,
  receiptId: number,
): ThreeWayMatchData {
  return { poId, deliveryNoteId, receiptId };
}

// ─── 销售订单测试数据工厂 ────────────────────────────────────

export interface SalesOrderData {
  customerId: number;
  orderType?: 'normal' | 'urgent';
  expectedDelivery: string;
  notes?: string;
  items: Array<{
    skuId: number;
    bomId: number;
    qtyOrdered: string;
    unitPrice: string;
  }>;
}

export function buildSalesOrderData(
  skuId: number,
  bomId: number,
  override: Partial<SalesOrderData> = {},
): SalesOrderData {
  const deliveryDate = new Date();
  deliveryDate.setDate(deliveryDate.getDate() + 14);
  return {
    customerId: 1,
    orderType: 'normal',
    expectedDelivery: deliveryDate.toISOString().slice(0, 10),
    items: [
      {
        skuId,
        bomId,
        qtyOrdered: '5',
        unitPrice: '5000.00',
      },
    ],
    ...override,
  };
}

// ─── 质量问题测试数据工厂 ────────────────────────────────────

export interface QualityIssueData {
  inspectionNo: string;
  componentName: string;
  issueTypes: string[];
  severity: 'minor' | 'normal' | 'severe';
  description: string;
  images?: string[];
}

export function buildQualityIssueData(
  inspectionNo: string,
  override: Partial<QualityIssueData> = {},
): QualityIssueData {
  return {
    inspectionNo,
    componentName: '测试部件A',
    issueTypes: ['appearance'],
    severity: 'minor',
    description: '表面轻微划痕',
    images: [],
    ...override,
  };
}

// ─── 通用工具 ─────────────────────────────────────────────────

/** 生成唯一的缸号（测试用） */
export function genDyeLotNo(): string {
  return `DL${Date.now().toString().slice(-8)}`;
}

/** 生成唯一的字符串 ID */
export function genId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase();
}
