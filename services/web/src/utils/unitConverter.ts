/**
 * [artifact:前端代码] — 前端多单位换算工具
 * 使用 Decimal.js 保持与后端一致的精度（6位小数）
 */

import Decimal from 'decimal.js';
import type { UnitConversion } from '@/types/models';

// 全局精度设置与后端保持一致
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export interface ConvertResult {
  /** 换算后的数量（字符串，保留4位小数） */
  qty: string;
  /** 换算显示文案，例如："1箱 = 50张，共 600.0000 张" */
  displayText: string;
  /** 目标单位 */
  toUnit: string;
}

/**
 * 将 inputQty（fromUnit）换算为 toUnit
 * conversions 是 SKU 的 unitConversions 数组
 */
export function convert(
  inputQty: string | number,
  fromUnit: string,
  toUnit: string,
  conversions: UnitConversion[],
): ConvertResult | null {
  if (fromUnit === toUnit) {
    const qty = new Decimal(inputQty).toFixed(4);
    return { qty, displayText: `${qty} ${toUnit}`, toUnit };
  }

  // 找到直接换算规则
  const rule = conversions.find(
    (c) =>
      (c.fromUnit === fromUnit && c.toUnit === toUnit) ||
      (c.fromUnit === toUnit && c.toUnit === fromUnit),
  );

  if (!rule) return null;

  let converted: Decimal;
  let ruleDesc: string;

  if (rule.fromUnit === fromUnit) {
    // 正向换算：fromUnit × rate → toUnit
    converted = new Decimal(inputQty).mul(new Decimal(rule.conversionRate));
    ruleDesc = `1${fromUnit} = ${rule.conversionRate}${toUnit}`;
  } else {
    // 反向换算：fromUnit ÷ rate → toUnit
    converted = new Decimal(inputQty).div(new Decimal(rule.conversionRate));
    ruleDesc = `1${toUnit} = ${rule.conversionRate}${fromUnit}`;
  }

  const qty = converted.toFixed(4);
  const displayText = `${ruleDesc}，共 ${qty} ${toUnit}`;

  return { qty, displayText, toUnit };
}

/**
 * 从 fromUnit 换算到库存单位（stockUnit）
 * 这是入库/出库时最常用的场景
 */
export function convertToStockUnit(
  inputQty: string | number,
  fromUnit: string,
  stockUnit: string,
  conversions: UnitConversion[],
): ConvertResult | null {
  return convert(inputQty, fromUnit, stockUnit, conversions);
}

/**
 * 获取某个 SKU 所有可用单位列表（去重，包含库存单位本身）
 */
export function getAvailableUnits(
  stockUnit: string,
  purchaseUnit: string,
  productionUnit: string,
  conversions: UnitConversion[],
): string[] {
  const units = new Set<string>([stockUnit, purchaseUnit, productionUnit]);
  conversions.forEach((c) => {
    units.add(c.fromUnit);
    units.add(c.toUnit);
  });
  return Array.from(units);
}

/**
 * 格式化数量显示，去掉多余小数零
 * "50.0000" → "50"，"1.5000" → "1.5"
 */
export function formatQty(qty: string | number): string {
  return new Decimal(qty).toSignificantDigits(10).toString();
}

/**
 * 验证数量字符串是否合法（正数，最多6位小数）
 */
export function isValidQty(value: string): boolean {
  if (!value || value.trim() === '') return false;
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) return false;
  const parts = value.split('.');
  if (parts[1] && parts[1].length > 6) return false;
  return true;
}

/**
 * 构建换算提示文案（用于 UnitSelector 组件）
 * 例如输入 2 箱，库存单位张，换算系数50：
 * → "1箱 = 50张，共 100.0000 张"
 */
export function buildConversionHint(
  inputQty: string,
  fromUnit: string,
  stockUnit: string,
  conversions: UnitConversion[],
): string | null {
  if (!inputQty || !isValidQty(inputQty)) return null;
  const result = convertToStockUnit(inputQty, fromUnit, stockUnit, conversions);
  if (!result) return null;
  if (fromUnit === stockUnit) return null;
  return result.displayText;
}
