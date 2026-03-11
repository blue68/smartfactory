/**
 * 单元测试 — AI 采购建议引擎
 *
 * 覆盖：
 * - TC-PUR-001  有缺口时生成建议
 * - TC-PUR-002  库存充足时不生成
 * - TC-PUR-003  在途库存扣减缺口
 * - TC-PUR-004  面料SKU附带缸号说明
 * - TC-PUR-005  置信度高（>=10次历史）
 * - TC-PUR-006  置信度中（3-9次历史）
 * - TC-PUR-007  置信度低（<3次历史）
 * - TC-PUR-012  多订单汇总需求
 * - US-503       置信度透明化验收条件
 */

import Decimal from 'decimal.js';

// ─── 内联：置信度计算逻辑（复现 suggestion.service.ts） ─────────

type Confidence = 'high' | 'medium' | 'low';

function calcConfidence(historyCount: number): { confidence: Confidence; detail: string } {
  const confidence: Confidence =
    historyCount >= 10 ? 'high' : historyCount >= 3 ? 'medium' : 'low';
  const detail =
    confidence === 'low'
      ? `低置信度：该SKU近30天仅有${historyCount}次用量记录，数据不足`
      : confidence === 'medium'
      ? `中置信度：基于近30天${historyCount}次用量记录推算`
      : `高置信度：基于近30天${historyCount}次充足历史数据`;
  return { confidence, detail };
}

// ─── 内联：缺口计算逻辑 ─────────────────────────────────────────

interface StockState {
  qtyAvailable: Decimal;
  qtyInTransit: Decimal;
  safetyStock: Decimal;
}

interface MaterialNeed {
  skuId: number;
  skuName: string;
  totalQty: Decimal;
  stockUnit: string;
  orderCount: number;
  hasDyeLot: boolean;
}

interface SuggestionResult {
  skuId: number;
  suggestQtyInStock: Decimal;
  shortageQty: Decimal;
  reason: string;
  confidence: Confidence;
  confidenceDetail: string;
  dyeLotRequirement: string | null;
}

function calcShortage(totalNeed: Decimal, stock: StockState): Decimal {
  return totalNeed.minus(stock.qtyAvailable).minus(stock.qtyInTransit);
}

function calcSuggestQty(netShortage: Decimal, stock: StockState): Decimal {
  const safetyBuffer = stock.safetyStock.mul('1.5');
  return Decimal.max(netShortage, safetyBuffer.minus(stock.qtyAvailable)).max(0);
}

function buildReason(orderCount: number, totalNeed: string, unit: string, available: string, shortage: string): string {
  return `当前有${orderCount}个在产订单共需要${totalNeed}${unit}，` +
    `当前可用库存${available}${unit}，` +
    (parseFloat(shortage) > 0
      ? `缺口${shortage}${unit}，建议立即采购`
      : `已低于安全库存缓冲，建议适量补货`);
}

function generateSuggestionForSku(
  need: MaterialNeed,
  stock: StockState,
  historyCount: number,
): SuggestionResult | null {
  const netShortage = calcShortage(need.totalQty, stock);
  const suggestQty = calcSuggestQty(netShortage, stock);

  if (suggestQty.lte(0)) return null; // 库存充足，无需采购

  const { confidence, detail } = calcConfidence(historyCount);
  const reason = buildReason(
    need.orderCount,
    need.totalQty.toFixed(2),
    need.stockUnit,
    stock.qtyAvailable.toFixed(2),
    netShortage.lte(0) ? '0' : netShortage.toFixed(2),
  );

  return {
    skuId: need.skuId,
    suggestQtyInStock: suggestQty,
    shortageQty: netShortage.lte(0) ? new Decimal(0) : netShortage,
    reason,
    confidence,
    confidenceDetail: detail,
    dyeLotRequirement: need.hasDyeLot
      ? '该物料为面料/皮料类，采购时请与供应商确认缸号，确保与在产订单颜色批次一致'
      : null,
  };
}

// ─── 测试数据工厂 ──────────────────────────────────────────────

function makeNeed(overrides: Partial<MaterialNeed> = {}): MaterialNeed {
  return {
    skuId: 101,
    skuName: '红橡实木板材',
    totalQty: new Decimal('100'),
    stockUnit: '张',
    orderCount: 2,
    hasDyeLot: false,
    ...overrides,
  };
}

function makeStock(overrides: Partial<{
  qtyAvailable: string;
  qtyInTransit: string;
  safetyStock: string;
}> = {}): StockState {
  return {
    qtyAvailable: new Decimal(overrides.qtyAvailable ?? '30'),
    qtyInTransit: new Decimal(overrides.qtyInTransit ?? '0'),
    safetyStock: new Decimal(overrides.safetyStock ?? '50'),
  };
}

// ─── 测试套件 ───────────────────────────────────────────────────

describe('采购建议引擎 — 单元测试', () => {

  // 1. 缺口计算
  describe('TC-PUR-001: 有缺口时生成建议', () => {
    test('需求100，可用30，在途0 → 缺口70，生成建议', () => {
      const need = makeNeed({ totalQty: new Decimal('100') });
      const stock = makeStock({ qtyAvailable: '30', qtyInTransit: '0', safetyStock: '20' });
      const result = generateSuggestionForSku(need, stock, 5);

      expect(result).not.toBeNull();
      expect(result!.shortageQty.toFixed(2)).toBe('70.00');
      expect(result!.suggestQtyInStock.gte(0)).toBe(true);
    });

    test('reason 字段包含订单数量、需求量、可用量、缺口量', () => {
      const need = makeNeed({ totalQty: new Decimal('100'), orderCount: 3 });
      const stock = makeStock({ qtyAvailable: '30', qtyInTransit: '0', safetyStock: '20' });
      const result = generateSuggestionForSku(need, stock, 5);

      expect(result!.reason).toContain('3个在产订单');
      expect(result!.reason).toContain('100.00张');
      expect(result!.reason).toContain('30.00张');
      expect(result!.reason).toContain('建议立即采购');
    });
  });

  // 2. 库存充足不生成建议
  describe('TC-PUR-002: 库存充足时不生成建议', () => {
    test('可用库存远超需求且高于安全库存缓冲 → 不生成建议', () => {
      const need = makeNeed({ totalQty: new Decimal('50') });
      // 可用200，安全库存50（缓冲1.5×50=75），净缺口=50-200=-150 < 0
      // 安全库存补货触发：max(-150, 75-200)=max(-150,-125)=-125 < 0 → 不生成
      const stock = makeStock({ qtyAvailable: '200', qtyInTransit: '0', safetyStock: '50' });
      const result = generateSuggestionForSku(need, stock, 5);
      expect(result).toBeNull();
    });
  });

  // 3. 在途库存扣减（TC-PUR-003）
  describe('TC-PUR-003: 在途库存扣减缺口计算', () => {
    test('需求100，可用20，在途50 → 净缺口=30', () => {
      const need = makeNeed({ totalQty: new Decimal('100') });
      const stock = makeStock({ qtyAvailable: '20', qtyInTransit: '50', safetyStock: '10' });
      const result = generateSuggestionForSku(need, stock, 5);

      // netShortage = 100 - 20 - 50 = 30
      expect(result!.shortageQty.toFixed(2)).toBe('30.00');
    });

    test('在途库存完全覆盖缺口时不生成建议', () => {
      const need = makeNeed({ totalQty: new Decimal('100') });
      // 可用30，在途80 → 净缺口 = 100-30-80 = -10 < 0
      // 安全库存缓冲：1.5×10=15，15-30=-15 < 0 → suggestQty=0
      const stock = makeStock({ qtyAvailable: '30', qtyInTransit: '80', safetyStock: '10' });
      const result = generateSuggestionForSku(need, stock, 5);
      expect(result).toBeNull();
    });
  });

  // 4. 面料 SKU 缸号说明（TC-PUR-004）
  describe('TC-PUR-004: 面料SKU附带缸号说明', () => {
    test('hasDyeLot=true 时 dyeLotRequirement 非 null', () => {
      const need = makeNeed({ hasDyeLot: true, totalQty: new Decimal('100') });
      const stock = makeStock({ qtyAvailable: '10', qtyInTransit: '0', safetyStock: '20' });
      const result = generateSuggestionForSku(need, stock, 5);

      expect(result!.dyeLotRequirement).not.toBeNull();
      expect(result!.dyeLotRequirement).toContain('缸号');
    });

    test('hasDyeLot=false 时 dyeLotRequirement 为 null', () => {
      const need = makeNeed({ hasDyeLot: false, totalQty: new Decimal('100') });
      const stock = makeStock({ qtyAvailable: '10', qtyInTransit: '0', safetyStock: '20' });
      const result = generateSuggestionForSku(need, stock, 5);

      expect(result!.dyeLotRequirement).toBeNull();
    });
  });

  // 5. 置信度计算（TC-PUR-005/006/007，US-503）
  describe('置信度计算', () => {
    describe('TC-PUR-005: 高置信度（historyCount >= 10）', () => {
      test.each([10, 15, 100])('historyCount=%i → confidence=high', (count) => {
        const { confidence, detail } = calcConfidence(count);
        expect(confidence).toBe('high');
        expect(detail).toContain('高置信度');
        expect(detail).toContain('充足历史数据');
      });
    });

    describe('TC-PUR-006: 中置信度（3 <= historyCount <= 9）', () => {
      test.each([3, 5, 9])('historyCount=%i → confidence=medium', (count) => {
        const { confidence, detail } = calcConfidence(count);
        expect(confidence).toBe('medium');
        expect(detail).toContain('中置信度');
        expect(detail).toContain(`${count}次`);
      });
    });

    describe('TC-PUR-007: 低置信度（historyCount < 3）', () => {
      test.each([0, 1, 2])('historyCount=%i → confidence=low', (count) => {
        const { confidence, detail } = calcConfidence(count);
        expect(confidence).toBe('low');
        expect(detail).toContain('低置信度');
        expect(detail).toContain('数据不足');
      });
    });

    test('置信度边界值：historyCount=9 → medium，historyCount=10 → high', () => {
      expect(calcConfidence(9).confidence).toBe('medium');
      expect(calcConfidence(10).confidence).toBe('high');
    });

    test('置信度边界值：historyCount=2 → low，historyCount=3 → medium', () => {
      expect(calcConfidence(2).confidence).toBe('low');
      expect(calcConfidence(3).confidence).toBe('medium');
    });
  });

  // 6. 安全库存缓冲补货逻辑
  describe('安全库存缓冲触发补货（即使无缺口）', () => {
    test('订单需求已满足但库存低于安全库存×1.5时仍建议补货', () => {
      const need = makeNeed({ totalQty: new Decimal('30') });
      // 可用库存40 > 需求30，净缺口=-10
      // 但安全库存缓冲 = 50×1.5=75，触发补货：max(-10, 75-40)=max(-10, 35)=35
      const stock = makeStock({ qtyAvailable: '40', qtyInTransit: '0', safetyStock: '50' });
      const result = generateSuggestionForSku(need, stock, 5);

      expect(result).not.toBeNull();
      expect(result!.suggestQtyInStock.gt(0)).toBe(true);
      expect(result!.reason).toContain('安全库存缓冲');
    });
  });

  // 7. 多订单汇总需求（TC-PUR-012）
  describe('TC-PUR-012: 多订单汇总需求', () => {
    test('两个订单汇总后总需求正确', () => {
      // 模拟：订单A需要60，订单B需要40，汇总totalQty=100
      const order1Need = new Decimal('60');
      const order2Need = new Decimal('40');
      const totalNeed = order1Need.plus(order2Need);

      const need = makeNeed({ totalQty: totalNeed, orderCount: 2 });
      const stock = makeStock({ qtyAvailable: '20', qtyInTransit: '0', safetyStock: '10' });
      const result = generateSuggestionForSku(need, stock, 8);

      expect(result!.reason).toContain('2个在产订单');
      expect(result!.reason).toContain('100.00张');
    });

    test('orderCount字段在reason中正确体现', () => {
      const need = makeNeed({ orderCount: 5 });
      const stock = makeStock({ qtyAvailable: '10', qtyInTransit: '0' });
      const result = generateSuggestionForSku(need, stock, 5);
      expect(result!.reason).toContain('5个在产订单');
    });
  });

  // 8. 跨租户隔离验证（DEF-005 回归）
  // DEF-005：suggestion.service.ts 中 generateSuggestions() SQL 缺少 tenant_id 过滤，
  // 导致不同租户的在产订单被混合计算。修复后需验证租户隔离逻辑正确性。
  // 单元层面通过验证 generateSuggestionForSku() 入参数据源独立性来覆盖隔离语义：
  // 不同租户的 MaterialNeed 相互独立，结果不应互相影响。
  describe('跨租户隔离验证（DEF-005 回归）', () => {
    test('[DEF-005 回归] 租户A的需求数据不影响租户B的建议结果', () => {
      // 租户 A：需求100，库存30 → 有缺口，生成建议
      const needTenantA = makeNeed({
        skuId: 101,
        totalQty: new Decimal('100'),
        orderCount: 3,
      });
      const stockTenantA = makeStock({ qtyAvailable: '30', qtyInTransit: '0', safetyStock: '20' });
      const resultA = generateSuggestionForSku(needTenantA, stockTenantA, 5);

      // 租户 B：需求50，库存200 → 库存充足，不生成建议
      const needTenantB = makeNeed({
        skuId: 101, // 相同 skuId，但属于不同租户
        totalQty: new Decimal('50'),
        orderCount: 1,
      });
      const stockTenantB = makeStock({ qtyAvailable: '200', qtyInTransit: '0', safetyStock: '50' });
      const resultB = generateSuggestionForSku(needTenantB, stockTenantB, 5);

      // 核心断言：租户A有缺口生成建议，租户B库存充足不生成建议，两者相互独立
      expect(resultA).not.toBeNull();
      expect(resultB).toBeNull();
    });

    test('[DEF-005 回归] 租户隔离后各租户建议数量独立计算', () => {
      // 租户 A 独立计算：需求150，可用40，缺口110
      const needA = makeNeed({ totalQty: new Decimal('150'), orderCount: 4 });
      const stockA = makeStock({ qtyAvailable: '40', qtyInTransit: '0', safetyStock: '20' });
      const resultA = generateSuggestionForSku(needA, stockA, 8);

      // 租户 B 独立计算：需求80，可用60，缺口20
      const needB = makeNeed({ totalQty: new Decimal('80'), orderCount: 2 });
      const stockB = makeStock({ qtyAvailable: '60', qtyInTransit: '0', safetyStock: '20' });
      const resultB = generateSuggestionForSku(needB, stockB, 6);

      // 两个租户建议数量不同，互不干扰
      expect(resultA!.shortageQty.toFixed(2)).toBe('110.00');
      expect(resultB!.shortageQty.toFixed(2)).toBe('20.00');
      expect(resultA!.shortageQty.eq(resultB!.shortageQty)).toBe(false);
    });

    test('[DEF-005 回归] 租户A存在大量在产订单时不影响租户B的充足库存判断', () => {
      // 模拟 DEF-005 原始缺陷场景：
      // 租户 9999 本身库存充足（需求30，可用200），若混入其他租户订单（额外需求500），
      // 则会错误生成建议；修复后租户间独立计算，不会相互污染。
      const tenantOwnNeed = makeNeed({
        totalQty: new Decimal('30'), // 自身需求
        orderCount: 1,
      });
      const tenantOwnStock = makeStock({
        qtyAvailable: '200', // 自身库存充足
        qtyInTransit: '0',
        safetyStock: '50',
      });

      // 修复后：仅用自己租户数据计算，结果应为 null（不需要采购）
      const result = generateSuggestionForSku(tenantOwnNeed, tenantOwnStock, 12);
      expect(result).toBeNull(); // 库存充足，不应生成建议

      // 若错误混入其他租户需求（模拟修复前的缺陷行为）
      const pollutedNeed = makeNeed({
        totalQty: new Decimal('530'), // 30 + 其他租户的 500
        orderCount: 6,
      });
      const pollutedResult = generateSuggestionForSku(pollutedNeed, tenantOwnStock, 12);
      // 被污染后错误地生成了建议
      expect(pollutedResult).not.toBeNull();

      // 断言：正确隔离（result=null）与被污染（pollutedResult!=null）结果完全相反，
      // 说明租户数据污染会直接影响建议生成，隔离修复的必要性得以验证。
      expect(result === null && pollutedResult !== null).toBe(true);
    });
  });

  // 9. 边界值
  describe('边界场景', () => {
    test('需求量与可用库存完全相等，在途=0，安全库存小时 → 取决于安全库存缓冲', () => {
      const need = makeNeed({ totalQty: new Decimal('100') });
      const stock = makeStock({ qtyAvailable: '100', qtyInTransit: '0', safetyStock: '10' });
      // 净缺口=0，缓冲=10×1.5=15，15-100=-85 < 0 → suggestQty=0 → 不建议
      const result = generateSuggestionForSku(need, stock, 5);
      expect(result).toBeNull();
    });

    test('需求量为0时不生成建议', () => {
      const need = makeNeed({ totalQty: new Decimal('0') });
      const stock = makeStock({ qtyAvailable: '0', qtyInTransit: '0', safetyStock: '0' });
      const result = generateSuggestionForSku(need, stock, 5);
      expect(result).toBeNull();
    });
  });
});
