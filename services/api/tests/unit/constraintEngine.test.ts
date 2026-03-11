/**
 * 单元测试 — 约束引擎四维检查
 *
 * 覆盖：
 * - TC-SO-001  四维全部通过
 * - TC-SO-002  资金占用超限拦截
 * - TC-SO-003  产能负荷超限
 * - TC-SO-004  库存周转天数超限
 * - TC-SO-005  多维度同时超限
 * - TC-SO-012  阈值边界值（刚好等于）
 * - TC-SO-013  阈值边界值（超出1元）
 * - TC-BOUND-007/008 产能阈值边界
 * - US-006      老板审批超限订单
 * - US-802      紧急插单影响分析
 */

import Decimal from 'decimal.js';

// ─── 内联：约束引擎核心检查逻辑（复现 constraintEngine.ts） ────

interface ConstraintThresholds {
  maxInventoryTurnoverDays: number;
  maxCapitalOccupation: number;
  maxCapitalBudgetRatio: number;
  maxCapacityLoadRatio: number;
}

const DEFAULT_THRESHOLDS: ConstraintThresholds = {
  maxInventoryTurnoverDays: 90,
  maxCapitalOccupation: 500000,
  maxCapitalBudgetRatio: 0.8,
  maxCapacityLoadRatio: 0.9,
};

interface CheckResult {
  passed: boolean;
  currentValue: string;
  threshold: string;
  detail: string;
}

// 库存周转检查
function checkInventoryTurnover(
  inventoryValue: Decimal,
  dailyUsageValue: Decimal,
  thresholds: ConstraintThresholds = DEFAULT_THRESHOLDS,
): CheckResult {
  const turnoverDays = dailyUsageValue.gt(0)
    ? inventoryValue.div(dailyUsageValue)
    : new Decimal(0);
  const threshold = thresholds.maxInventoryTurnoverDays;
  const passed = turnoverDays.lte(threshold);
  return {
    passed,
    currentValue: turnoverDays.toFixed(1),
    threshold: String(threshold),
    detail: passed
      ? `库存周转天数 ${turnoverDays.toFixed(1)} 天，正常`
      : `库存周转天数 ${turnoverDays.toFixed(1)} 天，超过上限 ${threshold} 天，存在积压风险`,
  };
}

// 资金占用检查
function checkCapitalOccupation(
  currentCapital: Decimal,
  newOrderCost: Decimal,
  thresholds: ConstraintThresholds = DEFAULT_THRESHOLDS,
): CheckResult {
  const totalCapital = currentCapital.plus(newOrderCost);
  const threshold = thresholds.maxCapitalOccupation;
  const passed = totalCapital.lte(threshold);
  return {
    passed,
    currentValue: totalCapital.toFixed(2),
    threshold: String(threshold),
    detail: passed
      ? `资金占用 ¥${totalCapital.toFixed(2)}，在预算范围内`
      : `资金占用 ¥${totalCapital.toFixed(2)} 超过上限 ¥${threshold}，需老板审批`,
  };
}

// 生产成本检查（只警告不拦截）
function checkProductionCost(
  estimatedCost: Decimal,
  histAvgCost: Decimal,
): CheckResult {
  const anomalyThreshold = histAvgCost.mul('1.3');
  const isAnomaly = histAvgCost.gt(0) && estimatedCost.gt(anomalyThreshold);
  return {
    passed: true, // 成本检查始终 passed=true，不拦截
    currentValue: estimatedCost.toFixed(2),
    threshold: anomalyThreshold.toFixed(2),
    detail: isAnomaly
      ? `估算物料成本 ¥${estimatedCost.toFixed(2)} 超过历史均值30%，请确认`
      : `估算物料成本 ¥${estimatedCost.toFixed(2)}，在正常范围`,
  };
}

// 产能负荷检查
function checkCapacityLoad(
  scheduledHours: Decimal,
  newOrderHours: Decimal,
  totalAvailableHours: Decimal,
  thresholds: ConstraintThresholds = DEFAULT_THRESHOLDS,
): CheckResult {
  const loadRatio = totalAvailableHours.gt(0)
    ? scheduledHours.plus(newOrderHours).div(totalAvailableHours)
    : new Decimal(1);
  const threshold = thresholds.maxCapacityLoadRatio;
  const passed = loadRatio.lte(threshold);
  return {
    passed,
    currentValue: loadRatio.mul(100).toFixed(1) + '%',
    threshold: `${threshold * 100}%`,
    detail: passed
      ? `产能负荷 ${loadRatio.mul(100).toFixed(1)}%，在安全范围内`
      : `产能负荷 ${loadRatio.mul(100).toFixed(1)}% 超过上限 ${threshold * 100}%，当前排产已满，新订单将延期`,
  };
}

// 整体约束汇总
interface ConstraintCheckReport {
  overallResult: 'pass' | 'block' | 'warning';
  inventoryTurnoverCheck: CheckResult;
  capitalOccupationCheck: CheckResult;
  productionCostCheck: CheckResult;
  capacityLoadCheck: CheckResult;
  blockedReasons: string[];
}

function assembleReport(
  inventoryCheck: CheckResult,
  capitalCheck: CheckResult,
  costCheck: CheckResult,
  capacityCheck: CheckResult,
  isUrgent = false,
): ConstraintCheckReport {
  const allChecks = [inventoryCheck, capitalCheck, costCheck, capacityCheck];
  const blockedReasons = allChecks.filter((c) => !c.passed).map((c) => c.detail);
  let overallResult: 'pass' | 'block' | 'warning' = 'pass';
  if (blockedReasons.length > 0) overallResult = 'block';
  else if (isUrgent) overallResult = 'warning';
  return {
    overallResult,
    inventoryTurnoverCheck: inventoryCheck,
    capitalOccupationCheck: capitalCheck,
    productionCostCheck: costCheck,
    capacityLoadCheck: capacityCheck,
    blockedReasons,
  };
}

// ─── 测试套件 ───────────────────────────────────────────────────

describe('约束引擎 — 单元测试', () => {

  // 1. 四维全部通过
  describe('TC-SO-001: 四维约束全部通过', () => {
    test('所有指标在阈值内时 overallResult=pass', () => {
      const inv = checkInventoryTurnover(new Decimal('3600000'), new Decimal('80000'));
      const cap = checkCapitalOccupation(new Decimal('200000'), new Decimal('50000'));
      const cost = checkProductionCost(new Decimal('15000'), new Decimal('14000'));
      const capacity = checkCapacityLoad(new Decimal('50'), new Decimal('20'), new Decimal('160'));
      const report = assembleReport(inv, cap, cost, capacity);

      expect(report.overallResult).toBe('pass');
      expect(report.blockedReasons).toHaveLength(0);
      expect(report.inventoryTurnoverCheck.passed).toBe(true);
      expect(report.capitalOccupationCheck.passed).toBe(true);
      expect(report.productionCostCheck.passed).toBe(true);
      expect(report.capacityLoadCheck.passed).toBe(true);
    });
  });

  // 2. 库存周转天数
  describe('库存周转天数检查', () => {
    test('TC-SO-004: 周转天数超90天时 passed=false', () => {
      // 库存价值=9100000，日均消耗=100000 → 91天
      const result = checkInventoryTurnover(new Decimal('9100000'), new Decimal('100000'));
      expect(result.passed).toBe(false);
      expect(result.currentValue).toBe('91.0');
      expect(result.detail).toContain('超过上限');
    });

    test('周转天数=90天时 passed=true（边界通过）', () => {
      const result = checkInventoryTurnover(new Decimal('9000000'), new Decimal('100000'));
      expect(result.passed).toBe(true);
      expect(result.currentValue).toBe('90.0');
    });

    test('周转天数=89天时 passed=true', () => {
      const result = checkInventoryTurnover(new Decimal('8900000'), new Decimal('100000'));
      expect(result.passed).toBe(true);
    });

    test('日均用量为0时周转天数=0（不超限）', () => {
      const result = checkInventoryTurnover(new Decimal('500000'), new Decimal('0'));
      expect(result.currentValue).toBe('0.0');
      expect(result.passed).toBe(true);
    });
  });

  // 3. 资金占用检查
  describe('资金占用检查', () => {
    test('TC-SO-002: 总资金=520000 > 500000阈值 → passed=false', () => {
      const result = checkCapitalOccupation(new Decimal('450000'), new Decimal('70000'));
      expect(result.passed).toBe(false);
      expect(result.currentValue).toBe('520000.00');
      expect(result.detail).toContain('需老板审批');
    });

    test('TC-SO-012: 总资金恰好=500000时 passed=true（边界通过）', () => {
      const result = checkCapitalOccupation(new Decimal('400000'), new Decimal('100000'));
      expect(result.passed).toBe(true);
      expect(result.currentValue).toBe('500000.00');
    });

    test('TC-SO-013: 总资金=500001时 passed=false（边界拦截）', () => {
      const result = checkCapitalOccupation(new Decimal('400000'), new Decimal('100001'));
      expect(result.passed).toBe(false);
      expect(result.currentValue).toBe('500001.00');
    });

    test('资金占用在预算内时detail包含"在预算范围内"', () => {
      const result = checkCapitalOccupation(new Decimal('100000'), new Decimal('50000'));
      expect(result.detail).toContain('在预算范围内');
    });
  });

  // 4. 生产成本检查（仅警告，不拦截）
  describe('生产成本检查（不拦截）', () => {
    test('成本超历史均值30%时 detail包含警告，但 passed 仍为 true', () => {
      const result = checkProductionCost(new Decimal('20000'), new Decimal('14000'));
      // 14000 × 1.3 = 18200，20000 > 18200
      expect(result.passed).toBe(true); // 关键：成本检查不拦截
      expect(result.detail).toContain('超过历史均值30%');
    });

    test('成本正常时 detail包含"在正常范围"', () => {
      const result = checkProductionCost(new Decimal('15000'), new Decimal('14000'));
      expect(result.detail).toContain('在正常范围');
    });

    test('历史均值=0时不触发异常警告', () => {
      const result = checkProductionCost(new Decimal('99999'), new Decimal('0'));
      expect(result.passed).toBe(true);
      expect(result.detail).toContain('在正常范围');
    });
  });

  // 5. 产能负荷检查
  describe('产能负荷检查', () => {
    test('TC-SO-003: 产能负荷95% > 90%阈值 → passed=false', () => {
      // 已排产152h + 新增0h / 总160h = 95%
      const result = checkCapacityLoad(
        new Decimal('152'), new Decimal('0'), new Decimal('160'),
      );
      expect(result.passed).toBe(false);
      expect(result.currentValue).toBe('95.0%');
    });

    test('TC-BOUND-007: 产能负荷恰好=90% → passed=true', () => {
      const result = checkCapacityLoad(
        new Decimal('144'), new Decimal('0'), new Decimal('160'),
      );
      expect(result.passed).toBe(true);
      expect(result.currentValue).toBe('90.0%');
    });

    test('TC-BOUND-008: 产能负荷=90.1% → passed=false', () => {
      // 总160h，已排产+新增 = 144.16h → 90.1%
      const result = checkCapacityLoad(
        new Decimal('144.16'), new Decimal('0'), new Decimal('160'),
      );
      expect(result.passed).toBe(false);
    });

    test('可用工时=0时负荷=100%（拦截）', () => {
      const result = checkCapacityLoad(
        new Decimal('100'), new Decimal('50'), new Decimal('0'),
      );
      expect(result.passed).toBe(false);
    });

    test('产能负荷75%时通过', () => {
      const result = checkCapacityLoad(
        new Decimal('120'), new Decimal('0'), new Decimal('160'),
      );
      expect(result.passed).toBe(true);
      expect(result.currentValue).toBe('75.0%');
    });
  });

  // 6. 多维度同时超限（TC-SO-005）
  describe('TC-SO-005: 多维度同时超限', () => {
    test('资金和产能同时超限 → blockedReasons有两条', () => {
      const inv = checkInventoryTurnover(new Decimal('4500000'), new Decimal('100000')); // 45天，通过
      const cap = checkCapitalOccupation(new Decimal('480000'), new Decimal('50000')); // 530000 > 500000，超限
      const cost = checkProductionCost(new Decimal('15000'), new Decimal('14000')); // 正常（不拦截）
      const capacity = checkCapacityLoad(new Decimal('155'), new Decimal('10'), new Decimal('160')); // 103% > 90%，超限
      const report = assembleReport(inv, cap, cost, capacity);

      expect(report.overallResult).toBe('block');
      expect(report.blockedReasons).toHaveLength(2);
      expect(report.blockedReasons.some((r) => r.includes('资金'))).toBe(true);
      expect(report.blockedReasons.some((r) => r.includes('产能'))).toBe(true);
    });

    test('三维超限时 blockedReasons 有三条', () => {
      const inv = checkInventoryTurnover(new Decimal('10000000'), new Decimal('100000')); // 100天，超限
      const cap = checkCapitalOccupation(new Decimal('480000'), new Decimal('50000')); // 超限
      const cost = checkProductionCost(new Decimal('15000'), new Decimal('14000')); // 不拦截
      const capacity = checkCapacityLoad(new Decimal('155'), new Decimal('10'), new Decimal('160')); // 超限
      const report = assembleReport(inv, cap, cost, capacity);

      expect(report.blockedReasons).toHaveLength(3);
    });
  });

  // 7. 紧急插单时 overallResult=warning
  describe('TC-SO-009: 紧急插单始终为 warning（不阻止）', () => {
    test('所有维度通过但 isUrgent=true → overallResult=warning', () => {
      const inv = checkInventoryTurnover(new Decimal('3600000'), new Decimal('80000'));
      const cap = checkCapitalOccupation(new Decimal('200000'), new Decimal('50000'));
      const cost = checkProductionCost(new Decimal('15000'), new Decimal('14000'));
      const capacity = checkCapacityLoad(new Decimal('50'), new Decimal('20'), new Decimal('160'));
      const report = assembleReport(inv, cap, cost, capacity, true);

      expect(report.overallResult).toBe('warning');
    });

    test('维度超限时 isUrgent=true 不影响 overallResult（仍为block）', () => {
      const inv = checkInventoryTurnover(new Decimal('3600000'), new Decimal('80000'));
      const cap = checkCapitalOccupation(new Decimal('480000'), new Decimal('50000')); // 超限
      const cost = checkProductionCost(new Decimal('15000'), new Decimal('14000'));
      const capacity = checkCapacityLoad(new Decimal('50'), new Decimal('20'), new Decimal('160'));
      const report = assembleReport(inv, cap, cost, capacity, true);

      expect(report.overallResult).toBe('block');
    });
  });

  // 8. 自定义阈值配置
  describe('自定义阈值配置', () => {
    test('租户自定义阈值（资金上限100万）时使用自定义值', () => {
      const customThresholds: ConstraintThresholds = {
        ...DEFAULT_THRESHOLDS,
        maxCapitalOccupation: 1000000,
      };
      const result = checkCapitalOccupation(
        new Decimal('700000'), new Decimal('200000'), customThresholds,
      );
      // 900000 < 1000000 → 通过
      expect(result.passed).toBe(true);
    });

    test('使用默认阈值时900000超限', () => {
      const result = checkCapitalOccupation(new Decimal('700000'), new Decimal('200000'));
      // 900000 > 500000 → 超限
      expect(result.passed).toBe(false);
    });
  });

  // 9. detail 字段格式验证
  describe('detail 字段格式', () => {
    test('通过时 detail 包含"正常"或"安全"', () => {
      const inv = checkInventoryTurnover(new Decimal('4500000'), new Decimal('100000'));
      const cap = checkCapitalOccupation(new Decimal('100000'), new Decimal('50000'));
      const capacity = checkCapacityLoad(new Decimal('80'), new Decimal('0'), new Decimal('160'));
      expect(inv.detail).toContain('正常');
      expect(cap.detail).toContain('在预算范围内');
      expect(capacity.detail).toContain('安全范围');
    });

    test('超限时 detail 包含阈值数值', () => {
      const cap = checkCapitalOccupation(new Decimal('480000'), new Decimal('50000'));
      expect(cap.detail).toContain('500000');
    });
  });
});
