/**
 * 单元测试 — 三单匹配逻辑
 *
 * 覆盖：
 * - TC-3WM-001  完全匹配
 * - TC-3WM-002  数量差异（入库少于PO）
 * - TC-3WM-003  价格差异
 * - TC-3WM-004  价格预警（超历史均价20%）
 * - TC-3WM-005  差异确认逻辑
 * - TC-3WM-006  已匹配记录不可再确认
 * - TC-3WM-008  部分到货多次匹配
 * - US-105       三单匹配对账验收条件
 */

import Decimal from 'decimal.js';

// ─── 内联：三单匹配核心逻辑（复现 threeWayMatch.service.ts） ────

type MatchStatus = 'matched' | 'qty_diff' | 'price_diff' | 'price_warning' | 'pending';

interface SingleSkuData {
  skuId: number;
  skuName: string;
  poQty: string;
  poPrice: string;
  dnQty: string;
  dnPrice: string;
  receiptQty: string;
  historicalAvgPrice: string | null;
}

interface MatchDiffItem {
  skuId: number;
  skuName: string;
  poQty: string;
  poPrice: string;
  dnQty: string;
  dnPrice: string;
  receiptQty: string;
  qtyDiff: string;
  priceDiff: string;
  isPriceAnomaly: boolean;
  historicalAvgPrice: string | null;
}

interface MatchResult {
  matchStatus: MatchStatus;
  diffItems: MatchDiffItem[];
}

function runMatchLogic(items: SingleSkuData[]): MatchResult {
  const diffItems: MatchDiffItem[] = [];
  let hasQtyDiff = false;
  let hasPriceDiff = false;
  let hasPriceWarning = false;

  for (const item of items) {
    const poQty = new Decimal(item.poQty);
    const dnQty = new Decimal(item.dnQty);
    const receiptQty = new Decimal(item.receiptQty);
    const poPrice = new Decimal(item.poPrice);
    const dnPrice = new Decimal(item.dnPrice);

    const qtyDiff = receiptQty.minus(poQty);
    const priceDiff = dnPrice.minus(poPrice);

    const isPriceAnomaly =
      item.historicalAvgPrice !== null &&
      dnPrice.gt(new Decimal(item.historicalAvgPrice).mul('1.2'));

    if (!qtyDiff.isZero()) hasQtyDiff = true;
    if (!priceDiff.isZero()) hasPriceDiff = true;
    if (isPriceAnomaly) hasPriceWarning = true;

    diffItems.push({
      skuId: item.skuId,
      skuName: item.skuName,
      poQty: poQty.toFixed(4),
      poPrice: poPrice.toFixed(2),
      dnQty: dnQty.toFixed(4),
      dnPrice: dnPrice.toFixed(2),
      receiptQty: receiptQty.toFixed(4),
      qtyDiff: qtyDiff.toFixed(4),
      priceDiff: priceDiff.toFixed(2),
      isPriceAnomaly,
      historicalAvgPrice: item.historicalAvgPrice
        ? new Decimal(item.historicalAvgPrice).toFixed(2)
        : null,
    });
  }

  let matchStatus: MatchStatus = 'matched';
  if (hasQtyDiff) matchStatus = 'qty_diff';
  else if (hasPriceDiff) matchStatus = 'price_diff';
  else if (hasPriceWarning) matchStatus = 'price_warning';

  return { matchStatus, diffItems };
}

// ─── 差异确认逻辑 ─────────────────────────────────────────────

type DiffReason = 'supplier_short' | 'receipt_miss' | 'price_adjust' | 'other';

interface MatchRecord {
  id: number;
  matchStatus: MatchStatus;
  confirmedAt: Date | null;
  diffReason: DiffReason | null;
  diffNotes: string | null;
}

function confirmDiff(
  record: MatchRecord,
  diffReason: DiffReason,
  diffNotes: string,
): MatchRecord {
  if (record.matchStatus === 'matched' && record.confirmedAt !== null) {
    throw new Error('该记录已匹配，无需确认');
  }
  return {
    ...record,
    matchStatus: 'matched',
    confirmedAt: new Date(),
    diffReason,
    diffNotes,
  };
}

// ─── 测试数据工厂 ──────────────────────────────────────────────

function makeSkuData(overrides: Partial<SingleSkuData> = {}): SingleSkuData {
  return {
    skuId: 200,
    skuName: '红橡实木板材',
    poQty: '5',
    poPrice: '600.00',
    dnQty: '5',
    dnPrice: '600.00',
    receiptQty: '5',
    historicalAvgPrice: '580.00',
    ...overrides,
  };
}

// ─── 测试套件 ───────────────────────────────────────────────────

describe('三单匹配逻辑 — 单元测试', () => {

  // 1. 完全匹配（TC-3WM-001）
  describe('TC-3WM-001: 完全匹配场景', () => {
    test('PO=5箱、送货=5箱、入库=5箱、价格一致 → matched', () => {
      const result = runMatchLogic([makeSkuData()]);
      expect(result.matchStatus).toBe('matched');
    });

    test('完全匹配时 qtyDiff=0', () => {
      const result = runMatchLogic([makeSkuData()]);
      expect(result.diffItems[0].qtyDiff).toBe('0.0000');
    });

    test('完全匹配时 priceDiff=0', () => {
      const result = runMatchLogic([makeSkuData()]);
      expect(result.diffItems[0].priceDiff).toBe('0.00');
    });

    test('完全匹配时 isPriceAnomaly=false（历史均价580，当前600 < 696）', () => {
      const result = runMatchLogic([makeSkuData()]);
      expect(result.diffItems[0].isPriceAnomaly).toBe(false);
    });
  });

  // 2. 数量差异（TC-3WM-002）
  describe('TC-3WM-002: 数量差异场景', () => {
    test('入库4箱 < PO5箱 → qty_diff，qtyDiff=-1', () => {
      const result = runMatchLogic([makeSkuData({ receiptQty: '4' })]);
      expect(result.matchStatus).toBe('qty_diff');
      expect(result.diffItems[0].qtyDiff).toBe('-1.0000');
    });

    test('入库6箱 > PO5箱 → qty_diff，qtyDiff=+1（超发）', () => {
      const result = runMatchLogic([makeSkuData({ receiptQty: '6' })]);
      expect(result.matchStatus).toBe('qty_diff');
      expect(result.diffItems[0].qtyDiff).toBe('1.0000');
    });

    test('API文档示例：PO=5, 送货=5, 入库=4 → qtyDiff=-1.0000', () => {
      const result = runMatchLogic([
        makeSkuData({ poQty: '5', dnQty: '5', receiptQty: '4' }),
      ]);
      expect(result.diffItems[0].qtyDiff).toBe('-1.0000');
    });
  });

  // 3. 价格差异（TC-3WM-003）
  describe('TC-3WM-003: 价格差异场景', () => {
    test('送货价格650 != PO价格600 → price_diff（数量一致时）', () => {
      const result = runMatchLogic([makeSkuData({ dnPrice: '650.00' })]);
      expect(result.matchStatus).toBe('price_diff');
      expect(result.diffItems[0].priceDiff).toBe('50.00');
    });

    test('价格差异优先级低于数量差异', () => {
      // 数量和价格都有差异时，matchStatus 应为 qty_diff（数量优先）
      const result = runMatchLogic([
        makeSkuData({ receiptQty: '4', dnPrice: '650.00' }),
      ]);
      expect(result.matchStatus).toBe('qty_diff');
    });
  });

  // 4. 价格预警（TC-3WM-004）
  describe('TC-3WM-004: 价格异常（超历史均价20%）', () => {
    test('当前价720 > 历史均价580×1.2=696 → isPriceAnomaly=true', () => {
      const result = runMatchLogic([
        makeSkuData({ dnPrice: '720.00', historicalAvgPrice: '580.00' }),
      ]);
      expect(result.diffItems[0].isPriceAnomaly).toBe(true);
    });

    test('数量匹配但价格异常 → price_warning', () => {
      const result = runMatchLogic([
        makeSkuData({ dnPrice: '720.00', historicalAvgPrice: '580.00' }),
      ]);
      expect(result.matchStatus).toBe('price_warning');
    });

    test('当前价620 <= 历史均价500×1.2=600时不触发预警', () => {
      const result = runMatchLogic([
        makeSkuData({ dnPrice: '600.00', historicalAvgPrice: '500.00' }),
      ]);
      // 600 <= 500*1.2=600 → 不超过，isPriceAnomaly=false
      expect(result.diffItems[0].isPriceAnomaly).toBe(false);
    });

    test('历史均价为null时不触发价格预警', () => {
      const result = runMatchLogic([
        makeSkuData({ dnPrice: '99999.00', historicalAvgPrice: null }),
      ]);
      expect(result.diffItems[0].isPriceAnomaly).toBe(false);
    });

    test('历史均价字段正确保留两位小数', () => {
      const result = runMatchLogic([makeSkuData({ historicalAvgPrice: '580.5' })]);
      expect(result.diffItems[0].historicalAvgPrice).toBe('580.50');
    });
  });

  // 5. 差异确认（TC-3WM-005）
  describe('TC-3WM-005: 差异确认逻辑', () => {
    const pendingRecord: MatchRecord = {
      id: 1,
      matchStatus: 'qty_diff',
      confirmedAt: null,
      diffReason: null,
      diffNotes: null,
    };

    test('确认差异后状态变为matched', () => {
      const updated = confirmDiff(pendingRecord, 'supplier_short', '供应商确认少发1箱');
      expect(updated.matchStatus).toBe('matched');
    });

    test('确认差异后 confirmedAt 有值', () => {
      const updated = confirmDiff(pendingRecord, 'supplier_short', '测试备注');
      expect(updated.confirmedAt).toBeInstanceOf(Date);
    });

    test('确认差异后 diffReason 保存正确', () => {
      const updated = confirmDiff(pendingRecord, 'receipt_miss', '入库漏录');
      expect(updated.diffReason).toBe('receipt_miss');
    });

    test('全部有效的 diffReason 枚举值均可接受', () => {
      const reasons: DiffReason[] = ['supplier_short', 'receipt_miss', 'price_adjust', 'other'];
      for (const reason of reasons) {
        const updated = confirmDiff(pendingRecord, reason, '备注');
        expect(updated.diffReason).toBe(reason);
      }
    });
  });

  // 6. 已匹配记录不可再确认（TC-3WM-006）
  describe('TC-3WM-006: 已匹配记录不可再确认', () => {
    test('matchStatus=matched 且 confirmedAt 有值时再次确认抛出错误', () => {
      const confirmedRecord: MatchRecord = {
        id: 1,
        matchStatus: 'matched',
        confirmedAt: new Date(),
        diffReason: 'supplier_short',
        diffNotes: '已确认',
      };
      expect(() => confirmDiff(confirmedRecord, 'other', '重复确认')).toThrow('已匹配');
    });

    // DEF-004 回归测试用例
    // 缺陷场景：记录初始就是 matched 状态（confirmedAt=null），
    // 当前 confirmDiff 实现仅检查 confirmedAt !== null，
    // 导致该场景不抛出异常直接写入，产生脏数据。
    // 修复预期：只要 matchStatus=matched 即应拒绝确认，无论 confirmedAt 是否为 null。
    test('[DEF-004 回归] matchStatus=matched 但 confirmedAt=null 时调用 confirmDiff 应抛出业务异常', () => {
      // 此场景还原 DEF-004：matched 状态记录未经过确认流程（confirmedAt 为 null），
      // 对其调用 confirmDiff 应视为重复/无效操作，必须抛出错误。
      const matchedWithoutConfirm: MatchRecord = {
        id: 2,
        matchStatus: 'matched',
        confirmedAt: null, // DEF-004 触发点：confirmedAt 为 null
        diffReason: null,
        diffNotes: null,
      };
      expect(() =>
        confirmDiff(matchedWithoutConfirm, 'other', '对已匹配记录重复确认'),
      ).toThrow();
    });

    test('[DEF-004 回归] 已匹配记录确认时抛出的错误信息应包含"已匹配"关键字', () => {
      const matchedRecord: MatchRecord = {
        id: 3,
        matchStatus: 'matched',
        confirmedAt: new Date(),
        diffReason: 'price_adjust',
        diffNotes: '原始确认备注',
      };
      expect(() =>
        confirmDiff(matchedRecord, 'other', '再次提交'),
      ).toThrow(/已匹配/);
    });

    test('[DEF-004 回归] pending 状态记录可正常确认，不抛出异常', () => {
      const pendingRecord: MatchRecord = {
        id: 4,
        matchStatus: 'qty_diff',
        confirmedAt: null,
        diffReason: null,
        diffNotes: null,
      };
      // 非 matched 状态应正常执行，无异常
      expect(() =>
        confirmDiff(pendingRecord, 'supplier_short', '正常首次确认'),
      ).not.toThrow();
    });
  });

  // 7. 部分到货多次匹配（TC-3WM-008）
  describe('TC-3WM-008: 部分到货多次匹配', () => {
    test('第一次入库3箱（PO5箱）→ qty_diff', () => {
      const result = runMatchLogic([makeSkuData({ receiptQty: '3' })]);
      expect(result.matchStatus).toBe('qty_diff');
      expect(result.diffItems[0].qtyDiff).toBe('-2.0000');
    });

    test('两次入库合并后匹配PO量 → matched', () => {
      // 模拟合并入库：3+2=5
      const result = runMatchLogic([makeSkuData({ receiptQty: '5' })]);
      expect(result.matchStatus).toBe('matched');
    });
  });

  // 8. 多SKU匹配
  describe('多SKU场景', () => {
    test('两个SKU均完全匹配 → matched', () => {
      const result = runMatchLogic([
        makeSkuData({ skuId: 200, skuName: '板材' }),
        makeSkuData({ skuId: 201, skuName: '螺丝', poQty: '100', dnQty: '100', receiptQty: '100', poPrice: '5.00', dnPrice: '5.00', historicalAvgPrice: '4.80' }),
      ]);
      expect(result.matchStatus).toBe('matched');
      expect(result.diffItems).toHaveLength(2);
    });

    test('一个SKU有数量差异，整体结果为qty_diff', () => {
      const result = runMatchLogic([
        makeSkuData({ skuId: 200 }),  // 正常
        makeSkuData({ skuId: 201, receiptQty: '3' }),  // 数量少
      ]);
      expect(result.matchStatus).toBe('qty_diff');
    });
  });

  // 9. 精度验证
  describe('数值精度', () => {
    test('qtyDiff保留4位小数精度', () => {
      const result = runMatchLogic([makeSkuData({ receiptQty: '4.5678' })]);
      expect(result.diffItems[0].qtyDiff).toBe('-0.4322'); // 4.5678 - 5 = -0.4322
    });

    test('priceDiff保留2位小数精度', () => {
      const result = runMatchLogic([makeSkuData({ dnPrice: '633.33' })]);
      expect(result.diffItems[0].priceDiff).toBe('33.33');
    });
  });
});
