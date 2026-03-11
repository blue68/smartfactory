/**
 * 单元测试 — 多单位换算精度
 *
 * 覆盖：
 * - TC-BOUND-001 换算系数最小值6位小数精度
 * - TC-BOUND-002 换算后数量四舍五入验证
 * - TC-INV-001   按库存单位入库（无换算）
 * - TC-INV-002   按采购单位换算（箱→张）
 * - US-206       多单位管理验收条件
 */

import Decimal from 'decimal.js';

// ─── 内联 UnitConverter（避免依赖真实数据库，单元测试独立运行） ───

interface UnitConversion {
  fromUnit: string;
  toUnit: string;
  conversionRate: string;
}

interface ConversionResult {
  qty: Decimal;
  stockUnit: string;
  displayText: string;
}

class UnitConverter {
  /**
   * 将 inputUnit 的数量转换为 stockUnit 的数量。
   * 若 inputUnit === stockUnit，直接返回原值（不需要换算）。
   */
  static convert(
    qtyInput: string,
    inputUnit: string,
    conversions: UnitConversion[],
    stockUnit: string,
  ): ConversionResult {
    if (inputUnit === stockUnit) {
      return {
        qty: new Decimal(qtyInput),
        stockUnit,
        displayText: `${qtyInput} ${stockUnit}`,
      };
    }

    const rule = conversions.find(
      (c) => c.fromUnit === inputUnit && c.toUnit === stockUnit,
    );
    if (!rule) {
      throw new Error(`未找到 ${inputUnit} → ${stockUnit} 的换算规则`);
    }

    const qty = new Decimal(qtyInput).mul(new Decimal(rule.conversionRate));
    return {
      qty,
      stockUnit,
      displayText: `1${inputUnit} = ${rule.conversionRate}${stockUnit}，本次 = ${qty.toFixed(4)}${stockUnit}`,
    };
  }

  /**
   * 从库存单位反向换算为采购单位（用于生成采购建议数量）。
   */
  static convertFromStock(
    qtyInStock: string,
    stockUnit: string,
    purchaseUnit: string,
    conversions: UnitConversion[],
  ): Decimal {
    if (stockUnit === purchaseUnit) return new Decimal(qtyInStock);

    const rule = conversions.find(
      (c) => c.fromUnit === purchaseUnit && c.toUnit === stockUnit,
    );
    if (!rule) {
      throw new Error(`未找到 ${purchaseUnit} → ${stockUnit} 的换算规则（反向）`);
    }
    // 反向：stock数量 / conversionRate = purchase数量
    return new Decimal(qtyInStock).div(new Decimal(rule.conversionRate));
  }

  /** 计算金额（数量 × 单价） */
  static calcAmount(qty: string, unitPrice: string): Decimal {
    return new Decimal(qty).mul(new Decimal(unitPrice));
  }
}

// ─── 测试数据 ───────────────────────────────────────────────────

const BOX_TO_SHEET: UnitConversion[] = [
  { fromUnit: '箱', toUnit: '张', conversionRate: '50.000000' },
];

const ROLL_TO_METER: UnitConversion[] = [
  { fromUnit: '卷', toUnit: '米', conversionRate: '100.000000' },
];

const PRECISION_CONVERSION: UnitConversion[] = [
  { fromUnit: '单位A', toUnit: '单位B', conversionRate: '0.000001' },
];

const FRACTION_CONVERSION: UnitConversion[] = [
  { fromUnit: '件', toUnit: '克', conversionRate: '333.333333' },
];

// ─── 测试套件 ───────────────────────────────────────────────────

describe('UnitConverter — 多单位换算精度测试', () => {

  // 1. 基础换算 — 相同单位无需转换
  describe('相同单位输入（无换算）', () => {
    test('TC-UNIT-001: 库存单位与输入单位相同时直接返回原值', () => {
      const result = UnitConverter.convert('100', '张', BOX_TO_SHEET, '张');
      expect(result.qty.toFixed(4)).toBe('100.0000');
      expect(result.stockUnit).toBe('张');
    });

    test('TC-UNIT-002: 零值输入无换算时返回0', () => {
      const result = UnitConverter.convert('0', '张', BOX_TO_SHEET, '张');
      expect(result.qty.toNumber()).toBe(0);
    });
  });

  // 2. 正向换算（采购单位 → 库存单位）
  describe('正向换算：采购单位 → 库存单位', () => {
    test('TC-UNIT-003: 2箱换算为100张（TC-INV-002 场景）', () => {
      const result = UnitConverter.convert('2', '箱', BOX_TO_SHEET, '张');
      expect(result.qty.toFixed(4)).toBe('100.0000');
      expect(result.stockUnit).toBe('张');
    });

    test('TC-UNIT-004: 0.5箱换算为25张', () => {
      const result = UnitConverter.convert('0.5', '箱', BOX_TO_SHEET, '张');
      expect(result.qty.toFixed(4)).toBe('25.0000');
    });

    test('TC-UNIT-005: 1卷换算为100米', () => {
      const result = UnitConverter.convert('1', '卷', ROLL_TO_METER, '米');
      expect(result.qty.toFixed(4)).toBe('100.0000');
    });

    test('TC-UNIT-006: 显示文本包含换算说明', () => {
      const result = UnitConverter.convert('2', '箱', BOX_TO_SHEET, '张');
      expect(result.displayText).toContain('箱');
      expect(result.displayText).toContain('张');
    });
  });

  // 3. 最小精度 6 位小数（TC-BOUND-001）
  describe('TC-BOUND-001: 6位小数精度换算', () => {
    test('TC-UNIT-007: 换算系数最小值0.000001的精度保持', () => {
      const result = UnitConverter.convert('1', '单位A', PRECISION_CONVERSION, '单位B');
      // 1 × 0.000001 = 0.000001
      expect(result.qty.toFixed(6)).toBe('0.000001');
    });

    test('TC-UNIT-008: 大数量乘以小系数精度不丢失', () => {
      const result = UnitConverter.convert('1000000', '单位A', PRECISION_CONVERSION, '单位B');
      // 1000000 × 0.000001 = 1.000000
      expect(result.qty.toFixed(6)).toBe('1.000000');
    });
  });

  // 4. 小数换算精度（TC-BOUND-002）
  describe('TC-BOUND-002: 换算结果小数精度', () => {
    test('TC-UNIT-009: 333.333333系数换算精度保持4位小数', () => {
      const result = UnitConverter.convert('3', '件', FRACTION_CONVERSION, '克');
      // 3 × 333.333333 = 999.999999 → 保留4位小数
      expect(result.qty.toFixed(4)).toBe('999.9999');
    });

    test('TC-UNIT-010: 使用 Decimal.js 避免浮点精度丢失', () => {
      // 普通 JS 浮点：0.1 + 0.2 !== 0.3
      const conv: UnitConversion[] = [
        { fromUnit: '盒', toUnit: '个', conversionRate: '0.100000' },
      ];
      const result = UnitConverter.convert('3', '盒', conv, '个');
      // 3 × 0.1 应精确等于 0.3，不能是 0.30000000000000004
      expect(result.qty.toFixed(4)).toBe('0.3000');
    });
  });

  // 5. 反向换算（库存单位 → 采购单位）
  describe('反向换算：库存单位 → 采购单位', () => {
    test('TC-UNIT-011: 100张反向换算为2箱', () => {
      const result = UnitConverter.convertFromStock('100', '张', '箱', BOX_TO_SHEET);
      expect(result.toFixed(4)).toBe('2.0000');
    });

    test('TC-UNIT-012: 库存单位与采购单位相同时直接返回', () => {
      const result = UnitConverter.convertFromStock('50', '张', '张', BOX_TO_SHEET);
      expect(result.toFixed(4)).toBe('50.0000');
    });

    test('TC-UNIT-013: 找不到换算规则时抛出异常', () => {
      expect(() =>
        UnitConverter.convertFromStock('100', '张', '箱', ROLL_TO_METER),
      ).toThrow('未找到');
    });
  });

  // 6. 未配置换算规则的异常处理
  describe('异常处理：换算规则缺失', () => {
    test('TC-UNIT-014: 无换算规则时抛出明确错误', () => {
      expect(() =>
        UnitConverter.convert('2', '箱', [], '张'),
      ).toThrow('未找到 箱 → 张 的换算规则');
    });

    test('TC-UNIT-015: 换算规则单位不匹配时抛出错误', () => {
      expect(() =>
        UnitConverter.convert('2', '卷', BOX_TO_SHEET, '张'),
      ).toThrow();
    });
  });

  // 7. 金额计算
  describe('金额计算', () => {
    test('TC-UNIT-016: 数量 × 单价精确计算', () => {
      const amount = UnitConverter.calcAmount('5', '600.00');
      expect(amount.toFixed(2)).toBe('3000.00');
    });

    test('TC-UNIT-017: 小数单价金额精度', () => {
      const amount = UnitConverter.calcAmount('3', '33.333');
      // 3 × 33.333 = 99.999
      expect(amount.toFixed(2)).toBe('100.00');
    });
  });

  // 8. 边界值测试
  describe('边界值测试', () => {
    test('TC-UNIT-018: 输入为0时换算结果为0', () => {
      const result = UnitConverter.convert('0', '箱', BOX_TO_SHEET, '张');
      expect(result.qty.isZero()).toBe(true);
    });

    test('TC-UNIT-019: 输入为极大数（1000000箱）换算不溢出', () => {
      const result = UnitConverter.convert('1000000', '箱', BOX_TO_SHEET, '张');
      expect(result.qty.toFixed(0)).toBe('50000000');
    });

    test('TC-UNIT-020: 换算系数为1时等值输出', () => {
      const conv: UnitConversion[] = [
        { fromUnit: '个', toUnit: '件', conversionRate: '1.000000' },
      ];
      const result = UnitConverter.convert('99', '个', conv, '件');
      expect(result.qty.toFixed(4)).toBe('99.0000');
    });
  });
});
