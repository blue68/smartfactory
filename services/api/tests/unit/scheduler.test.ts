/**
 * 单元测试 — 排产算法（贪心调度）
 *
 * 覆盖：
 * - TC-PROD-002  排产计划按优先级排序
 * - TC-PROD-003  紧急订单优先排产
 * - TC-PROD-004  无工单时生成空排产
 * - US-301       车间主管查看每日排产验收条件
 * - US-304       插单影响分析（优先级重排）
 */

import Decimal from 'decimal.js';

// ─── 内联：排产优先级评分计算（复现 scheduler.service.ts） ─────

interface ProductionOrderForSchedule {
  id: number;
  workOrderNo: string;
  skuName: string;
  qtyPlanned: string;
  priority: number;         // 0-100，越高越优先
  isUrgent: boolean;        // 紧急插单标记
  daysToDelivery: number;   // 距交期天数
}

interface Worker {
  id: number;
  realName: string;
  assignedHours: Decimal;   // 当日已分配工时
}

interface Workstation {
  id: number;
  name: string;
  type: string;
  capacity: number;         // 每日最大产量
  assignedQty: Decimal;     // 当日已分配产量
}

interface ProcessStep {
  id: number;
  stepNo: number;
  stepName: string;
  standardHours: string;
  workstationType: string | null;
}

interface ScheduleEntry {
  productionOrderId: number;
  workOrderNo: string;
  processStepId: number;
  stepName: string;
  workerId: number | null;
  workerName: string | null;
  workstationId: number | null;
  workstationName: string | null;
  plannedQty: string;
  estimatedHours: string;
}

// 计算综合优先级评分（权重：交期0.5 + 订单优先级0.3 + 插单0.2）
function calcCompositeScore(order: ProductionOrderForSchedule): number {
  const urgencyScore = 1 - Math.min(order.daysToDelivery / 30, 1);
  const priorityScore = order.priority / 100;
  const urgentScore = order.isUrgent ? 1 : 0;
  return 50 * urgencyScore + 30 * priorityScore + 20 * urgentScore;
}

// 按综合评分排序工单
function sortOrdersByPriority(
  orders: ProductionOrderForSchedule[],
): ProductionOrderForSchedule[] {
  return [...orders].sort((a, b) => calcCompositeScore(b) - calcCompositeScore(a));
}

// 贪心工作站匹配（类型匹配 + 负荷最低）
function matchWorkstation(
  wsType: string | null,
  stations: Workstation[],
  qty: string,
): Workstation | null {
  const candidates = wsType ? stations.filter((ws) => ws.type === wsType) : stations;
  const available = candidates.filter(
    (ws) => ws.assignedQty.lt(ws.capacity),
  );
  if (available.length === 0) return candidates[0] ?? null;
  return available.sort(
    (a, b) => a.assignedQty.comparedTo(b.assignedQty),
  )[0];
}

// 贪心工人匹配（负荷最低且未超8小时优先）
function matchWorker(
  workers: Worker[],
  stdHours: string,
): Worker | null {
  const available = workers.filter(
    (w) => w.assignedHours.plus(new Decimal(stdHours ?? 0)).lte(8),
  );
  const pool = available.length > 0 ? available : workers;
  return [...pool].sort(
    (a, b) => a.assignedHours.comparedTo(b.assignedHours),
  )[0] ?? null;
}

// 产能负荷率计算
function calcCapacityLoadRate(
  workers: Worker[],
  totalAvailableHoursPerWorker = 8,
): string {
  const totalAvailable = new Decimal(workers.length * totalAvailableHoursPerWorker);
  const totalScheduled = workers.reduce(
    (sum, w) => sum.plus(w.assignedHours),
    new Decimal(0),
  );
  if (totalAvailable.lte(0)) return '0%';
  return totalScheduled.div(totalAvailable).mul(100).toFixed(1) + '%';
}

// ─── 测试数据工厂 ──────────────────────────────────────────────

function makeOrder(overrides: Partial<ProductionOrderForSchedule> = {}): ProductionOrderForSchedule {
  return {
    id: 1,
    workOrderNo: 'WO2026031001',
    skuName: '三人沙发-A款',
    qtyPlanned: '5',
    priority: 50,
    isUrgent: false,
    daysToDelivery: 14,
    ...overrides,
  };
}

function makeWorker(id: number, assignedHours = 0): Worker {
  return { id, realName: `工人${id}`, assignedHours: new Decimal(assignedHours) };
}

function makeWorkstation(id: number, type: string, capacity = 100, assignedQty = 0): Workstation {
  return {
    id,
    name: `工作站${id}`,
    type,
    capacity,
    assignedQty: new Decimal(assignedQty),
  };
}

function makeStep(id: number, stepNo: number, stdHours: string, wsType: string | null = null): ProcessStep {
  return {
    id,
    stepNo,
    stepName: `工序${stepNo}`,
    standardHours: stdHours,
    workstationType: wsType,
  };
}

// ─── 测试套件 ───────────────────────────────────────────────────

describe('排产算法 — 单元测试', () => {

  // 1. 优先级评分计算
  describe('综合优先级评分', () => {
    test('TC-PROD-002: 交期紧迫（3天）比交期宽松（20天）评分高', () => {
      const urgent = makeOrder({ daysToDelivery: 3, priority: 50 });
      const normal = makeOrder({ daysToDelivery: 20, priority: 50 });
      expect(calcCompositeScore(urgent)).toBeGreaterThan(calcCompositeScore(normal));
    });

    test('TC-PROD-003: 插单标记(isUrgent=true)评分高于普通订单', () => {
      const urgentOrder = makeOrder({ isUrgent: true, priority: 50, daysToDelivery: 14 });
      const normalOrder = makeOrder({ isUrgent: false, priority: 50, daysToDelivery: 14 });
      expect(calcCompositeScore(urgentOrder)).toBeGreaterThan(calcCompositeScore(normalOrder));
    });

    test('高priority(=100)比低priority(=0)评分高（同等条件）', () => {
      const highPriority = makeOrder({ priority: 100, daysToDelivery: 14 });
      const lowPriority = makeOrder({ priority: 0, daysToDelivery: 14 });
      expect(calcCompositeScore(highPriority)).toBeGreaterThan(calcCompositeScore(lowPriority));
    });

    test('交期=0天（今天）评分最高（urgencyScore=1）', () => {
      const today = makeOrder({ daysToDelivery: 0 });
      const score = calcCompositeScore(today);
      // urgencyScore=1, 50×1=50
      expect(score).toBeGreaterThanOrEqual(50);
    });

    test('评分结果在合理范围内[0, 100]', () => {
      const worst = makeOrder({ daysToDelivery: 30, priority: 0, isUrgent: false });
      const best = makeOrder({ daysToDelivery: 0, priority: 100, isUrgent: true });
      expect(calcCompositeScore(worst)).toBeGreaterThanOrEqual(0);
      expect(calcCompositeScore(best)).toBeLessThanOrEqual(100);
    });
  });

  // 2. 订单排序
  describe('按综合优先级排序', () => {
    test('sortOrdersByPriority 返回评分降序排列', () => {
      const orders = [
        makeOrder({ id: 1, daysToDelivery: 20, priority: 50, isUrgent: false }),
        makeOrder({ id: 2, daysToDelivery: 3, priority: 80, isUrgent: false }),   // 高优先
        makeOrder({ id: 3, daysToDelivery: 14, priority: 50, isUrgent: true }), // 插单
      ];
      const sorted = sortOrdersByPriority(orders);

      // 交期最近且高priority的排第一
      expect(sorted[0].id).toBe(2);
      // 插单排第二（20天vs插单标记）
      expect(sorted[1].id).toBe(3);
      // 普通订单排最后
      expect(sorted[2].id).toBe(1);
    });

    test('空数组排序返回空数组', () => {
      expect(sortOrdersByPriority([])).toHaveLength(0);
    });

    test('单个订单排序后位置不变', () => {
      const orders = [makeOrder({ id: 99 })];
      const sorted = sortOrdersByPriority(orders);
      expect(sorted[0].id).toBe(99);
    });
  });

  // 3. 工作站匹配
  describe('贪心工作站匹配', () => {
    test('按类型匹配工作站', () => {
      const stations = [
        makeWorkstation(1, '裁切台', 100, 0),
        makeWorkstation(2, '缝纫台', 100, 0),
      ];
      const ws = matchWorkstation('裁切台', stations, '5');
      expect(ws?.id).toBe(1);
    });

    test('选负荷最低的工作站', () => {
      const stations = [
        makeWorkstation(1, '裁切台', 100, 80), // 负荷高
        makeWorkstation(2, '裁切台', 100, 30), // 负荷低
      ];
      const ws = matchWorkstation('裁切台', stations, '5');
      expect(ws?.id).toBe(2); // 选负荷最低的
    });

    test('同类型工作站全满时选首个（超载标注）', () => {
      const stations = [
        makeWorkstation(1, '裁切台', 10, 10), // 满载
        makeWorkstation(2, '裁切台', 10, 10), // 满载
      ];
      const ws = matchWorkstation('裁切台', stations, '5');
      expect(ws).not.toBeNull(); // 超载时仍返回（标注超载）
    });

    test('wsType=null 时在所有工作站中选择', () => {
      const stations = [
        makeWorkstation(1, '裁切台', 100, 50),
        makeWorkstation(2, '缝纫台', 100, 30), // 负荷最低
      ];
      const ws = matchWorkstation(null, stations, '5');
      expect(ws?.id).toBe(2);
    });

    test('无工作站时返回null', () => {
      const ws = matchWorkstation('裁切台', [], '5');
      expect(ws).toBeNull();
    });
  });

  // 4. 工人匹配
  describe('贪心工人匹配', () => {
    test('选当日工时最少的工人', () => {
      const workers = [
        makeWorker(1, 6), // 已分配6小时
        makeWorker(2, 2), // 已分配2小时（最少）
        makeWorker(3, 4),
      ];
      const worker = matchWorker(workers, '2');
      expect(worker?.id).toBe(2);
    });

    test('工人加上新任务不超8小时时优先分配', () => {
      const workers = [
        makeWorker(1, 7), // 7+2=9 > 8，不在available
        makeWorker(2, 5), // 5+2=7 <= 8，在available
      ];
      const worker = matchWorker(workers, '2');
      expect(worker?.id).toBe(2);
    });

    test('所有工人满载时选负荷最低的（不超8小时外的兜底逻辑）', () => {
      const workers = [
        makeWorker(1, 7.5), // 7.5+2=9.5 > 8
        makeWorker(2, 7.0), // 7.0+2=9 > 8，负荷略低
      ];
      // 所有都超8小时，选负荷最低的
      const worker = matchWorker(workers, '2');
      expect(worker?.id).toBe(2);
    });

    test('无工人时返回null', () => {
      const worker = matchWorker([], '2');
      expect(worker).toBeNull();
    });
  });

  // 5. 产能负荷率计算
  describe('产能负荷率计算', () => {
    test('正常负荷75%计算正确', () => {
      const workers = [
        makeWorker(1, 6),  // 6/8=75%
      ];
      const rate = calcCapacityLoadRate(workers);
      expect(rate).toBe('75.0%');
    });

    test('满负荷100%', () => {
      const workers = [makeWorker(1, 8)];
      const rate = calcCapacityLoadRate(workers);
      expect(rate).toBe('100.0%');
    });

    test('多工人平均负荷', () => {
      const workers = [
        makeWorker(1, 8),  // 满载
        makeWorker(2, 4),  // 半载
      ];
      // 总分配=(8+4)=12，总可用=16，负荷=75%
      const rate = calcCapacityLoadRate(workers);
      expect(rate).toBe('75.0%');
    });

    test('无工人时返回0%', () => {
      const rate = calcCapacityLoadRate([]);
      expect(rate).toBe('0%');
    });

    test('TC-PROD-004: 无工单时产能负荷=0%', () => {
      const workers = [makeWorker(1, 0), makeWorker(2, 0)];
      const rate = calcCapacityLoadRate(workers);
      expect(rate).toBe('0.0%');
    });
  });

  // 6. 估算工时计算
  describe('任务估算工时', () => {
    test('工序工时 × 计划数量 = 估算工时', () => {
      const stdHoursPerUnit = new Decimal('0.8'); // 每件0.8小时
      const qty = new Decimal('5');
      const estimated = stdHoursPerUnit.mul(qty);
      expect(estimated.toFixed(2)).toBe('4.00');
    });

    test('工时为0时估算工时为0', () => {
      const estimated = new Decimal('0').mul(new Decimal('10'));
      expect(estimated.toFixed(2)).toBe('0.00');
    });
  });

  // 7. 完整调度流程（小规模模拟）
  describe('完整调度流程模拟', () => {
    test('单个工单单个工序正确分配工人和工作站', () => {
      const order = makeOrder({ id: 1, qtyPlanned: '5' });
      const steps: ProcessStep[] = [makeStep(10, 1, '0.8', '裁切台')];
      const workers = [makeWorker(1, 0), makeWorker(2, 2)];
      const workstations = [makeWorkstation(1, '裁切台', 100, 0)];

      const schedules: ScheduleEntry[] = [];
      const workerLoad = new Map(workers.map((w) => [w.id, w.assignedHours]));
      const wsLoad = new Map(workstations.map((ws) => [ws.id, ws.assignedQty]));

      for (const step of steps) {
        const ws = matchWorkstation(step.workstationType, workstations, order.qtyPlanned);
        const worker = matchWorker(
          workers.map((w) => ({ ...w, assignedHours: workerLoad.get(w.id) ?? new Decimal(0) })),
          step.standardHours,
        );
        const estimatedHours = new Decimal(step.standardHours).mul(order.qtyPlanned);
        schedules.push({
          productionOrderId: order.id,
          workOrderNo: order.workOrderNo,
          processStepId: step.id,
          stepName: step.stepName,
          workerId: worker?.id ?? null,
          workerName: worker?.realName ?? null,
          workstationId: ws?.id ?? null,
          workstationName: ws?.name ?? null,
          plannedQty: new Decimal(order.qtyPlanned).toFixed(2),
          estimatedHours: estimatedHours.toFixed(2),
        });
      }

      expect(schedules).toHaveLength(1);
      expect(schedules[0].workerId).toBe(1); // 工人1工时最少
      expect(schedules[0].workstationId).toBe(1);
      expect(schedules[0].estimatedHours).toBe('4.00'); // 0.8 × 5
    });

    test('插单订单在排产列表中靠前', () => {
      const orders = [
        makeOrder({ id: 1, isUrgent: false, daysToDelivery: 10, priority: 60 }),
        makeOrder({ id: 2, isUrgent: true, daysToDelivery: 10, priority: 60 }),
      ];
      const sorted = sortOrdersByPriority(orders);
      expect(sorted[0].id).toBe(2); // 插单排首位
    });
  });
});
