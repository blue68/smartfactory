import Decimal from 'decimal.js';
import { AppError } from './AppError';
import { ResponseCode } from './ApiResponse';

/**
 * 单位换算结果
 */
export interface ConversionResult {
  qty: Decimal;
  unit: string;
  displayText: string; // 如 "1箱 = 50个，本次入库 = 150个"
}

/**
 * 单位换算关系
 */
export interface UnitConversionRule {
  fromUnit: string;
  toUnit: string;
  conversionRate: string | number; // DECIMAL(10,6)，使用字符串避免精度丢失
}

/**
 * 多单位换算工具
 *
 * 说明：
 * - 所有金额和数量计算使用 decimal.js 保证精度
 * - conversionRate 表示：fromUnit * rate = toUnit（目标单位通常为库存单位）
 */
export class UnitConverter {
  /**
   * 将输入数量从 fromUnit 换算到 toUnit（库存单位）
   */
  static convert(
    qty: number | string,
    fromUnit: string,
    rules: UnitConversionRule[],
    targetUnit: string,
  ): ConversionResult {
    // 如果单位相同，无需换算
    if (fromUnit === targetUnit) {
      const d = new Decimal(qty);
      return {
        qty: d,
        unit: targetUnit,
        displayText: `${d.toFixed(4)} ${targetUnit}`,
      };
    }

    // 查找换算规则
    const rule = rules.find(
      (r) => r.fromUnit === fromUnit && r.toUnit === targetUnit,
    );

    if (!rule) {
      // 尝试反向换算
      const reverseRule = rules.find(
        (r) => r.fromUnit === targetUnit && r.toUnit === fromUnit,
      );
      if (reverseRule) {
        const rate = new Decimal(reverseRule.conversionRate);
        const inputQty = new Decimal(qty);
        const converted = inputQty.div(rate);
        return {
          qty: converted,
          unit: targetUnit,
          displayText: `1${fromUnit} = ${new Decimal(1).div(rate).toDecimalPlaces(4)} ${targetUnit}，本次 = ${converted.toDecimalPlaces(4)} ${targetUnit}`,
        };
      }
      throw new AppError(
        `未找到从 ${fromUnit} 到 ${targetUnit} 的换算规则`,
        ResponseCode.INVALID_PARAMS,
        400,
      );
    }

    const rate = new Decimal(rule.conversionRate);
    const inputQty = new Decimal(qty);
    const converted = inputQty.mul(rate);

    return {
      qty: converted,
      unit: targetUnit,
      displayText: `1${fromUnit} = ${rate.toFixed(4)} ${targetUnit}，本次 = ${converted.toDecimalPlaces(4)} ${targetUnit}`,
    };
  }

  /**
   * 将库存单位数量反向换算为目标显示单位
   */
  static convertFromStock(
    stockQty: number | string,
    stockUnit: string,
    displayUnit: string,
    rules: UnitConversionRule[],
  ): Decimal {
    if (stockUnit === displayUnit) {
      return new Decimal(stockQty);
    }

    // 查找 displayUnit -> stockUnit 的规则（即 stockUnit / rate = displayUnit）
    const rule = rules.find(
      (r) => r.fromUnit === displayUnit && r.toUnit === stockUnit,
    );
    if (!rule) {
      throw new AppError(
        `未找到从库存单位 ${stockUnit} 到显示单位 ${displayUnit} 的换算规则`,
        ResponseCode.INVALID_PARAMS,
      );
    }

    const rate = new Decimal(rule.conversionRate);
    return new Decimal(stockQty).div(rate);
  }

  /**
   * 计算需要采购的数量（缺口 → 采购单位）
   */
  static stockToPurchaseQty(
    shortageInStockUnit: number | string,
    stockUnit: string,
    purchaseUnit: string,
    rules: UnitConversionRule[],
  ): Decimal {
    return UnitConverter.convertFromStock(shortageInStockUnit, stockUnit, purchaseUnit, rules);
  }

  /**
   * 金额精度计算（价格 × 数量）
   */
  static calcAmount(qty: number | string, unitPrice: number | string): Decimal {
    return new Decimal(qty).mul(new Decimal(unitPrice)).toDecimalPlaces(2);
  }
}
