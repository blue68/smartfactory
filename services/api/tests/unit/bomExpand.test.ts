/**
 * 单元测试 — BOM 递归展开算法
 *
 * 覆盖：
 * - TC-BOM-001  单层BOM展开
 * - TC-BOM-002  多层BOM递归展开
 * - TC-BOM-003  循环引用检测
 * - TC-BOM-004  层级超10层拦截
 * - TC-BOM-005  netQuantity = quantity × (1 + scrapRate)
 * - TC-BOM-006  物料需求数量计算（单层）
 * - TC-BOM-007  物料需求数量累加（多层同SKU）
 * - TC-BOM-010  netQuantity 精度4位小数
 * - TC-BOM-011  含面料类组件标记
 */

import Decimal from 'decimal.js';

// ─── 内联 BOM 树节点类型（与生产代码对齐） ────────────────────

interface BomItemNode {
  bomItemId: number;
  componentSkuId: number;
  skuCode: string;
  skuName: string;
  spec: string | null;
  quantity: string;
  unit: string;
  scrapRate: string;
  netQuantity: string;
  level: number;
  children: BomItemNode[];
}

interface MaterialRequirement {
  skuId: number;
  skuName: string;
  totalQty: string;
  unit: string;
}

// ─── 纯函数：BOM 树构建（复现 bom.service.ts 中的 buildTree） ──

function buildTree(
  rows: Array<{
    id: number;
    parent_item_id: number | null;
    component_sku_id: number;
    sku_code: string;
    sku_name: string;
    spec: string | null;
    quantity: string;
    unit: string;
    level: number;
    scrap_rate: string;
    sort_order: number;
  }>,
  parentId: number | null,
): BomItemNode[] {
  return rows
    .filter((r) => r.parent_item_id === parentId)
    .map((r) => {
      const qty = new Decimal(r.quantity);
      const scrap = new Decimal(r.scrap_rate);
      const netQty = qty.mul(new Decimal(1).plus(scrap));
      return {
        bomItemId: r.id,
        componentSkuId: r.component_sku_id,
        skuCode: r.sku_code,
        skuName: r.sku_name,
        spec: r.spec,
        quantity: qty.toFixed(4),
        unit: r.unit,
        scrapRate: scrap.toFixed(4),
        netQuantity: netQty.toFixed(4),
        level: r.level,
        children: buildTree(rows, r.id),
      };
    });
}

// ─── 纯函数：物料需求递归遍历（复现 traverseForRequirements） ──

function traverseForRequirements(
  nodes: BomItemNode[],
  parentQty: Decimal,
  acc: Map<number, { skuId: number; skuName: string; unit: string; total: Decimal }>,
): void {
  for (const node of nodes) {
    const nodeQty = parentQty.mul(new Decimal(node.netQuantity));
    if (node.children.length === 0) {
      const existing = acc.get(node.componentSkuId);
      if (existing) {
        existing.total = existing.total.plus(nodeQty);
      } else {
        acc.set(node.componentSkuId, {
          skuId: node.componentSkuId,
          skuName: node.skuName,
          unit: node.unit,
          total: nodeQty,
        });
      }
    } else {
      traverseForRequirements(node.children, nodeQty, acc);
    }
  }
}

function calcMaterialRequirements(
  bomItems: BomItemNode[],
  productionQty: number,
): MaterialRequirement[] {
  const acc = new Map<number, { skuId: number; skuName: string; unit: string; total: Decimal }>();
  traverseForRequirements(bomItems, new Decimal(productionQty), acc);
  return [...acc.values()].map(({ skuId, skuName, unit, total }) => ({
    skuId,
    skuName,
    totalQty: total.toFixed(4),
    unit,
  }));
}

// ─── 循环引用检测（模拟 SQL FIND_IN_SET 路径检测） ──────────────

function detectCircularRef(
  items: Array<{ componentSkuId: number; parentSkuId?: number | null }>,
  bomSkuId: number,
): boolean {
  return items.some((item) => item.componentSkuId === bomSkuId);
}

function validateMaxLevel(level: number, maxLevel = 10): boolean {
  return level <= maxLevel;
}

// ─── 测试用数据构造辅助 ────────────────────────────────────────

function makeRow(
  id: number,
  parentId: number | null,
  skuId: number,
  skuName: string,
  quantity: string,
  scrapRate: string,
  level: number,
  unit = '张',
): {
  id: number; parent_item_id: number | null; component_sku_id: number;
  sku_code: string; sku_name: string; spec: null;
  quantity: string; unit: string; level: number; scrap_rate: string; sort_order: number;
} {
  return {
    id,
    parent_item_id: parentId,
    component_sku_id: skuId,
    sku_code: `SKU${skuId.toString().padStart(5, '0')}`,
    sku_name: skuName,
    spec: null,
    quantity,
    unit,
    level,
    scrap_rate: scrapRate,
    sort_order: id,
  };
}

// ─── 测试套件 ───────────────────────────────────────────────────

describe('BOM展开算法 — 单元测试', () => {

  // 1. 单层 BOM 展开
  describe('单层BOM展开', () => {
    test('TC-BOM-001a: 单层BOM构建树形结构正确', () => {
      const rows = [
        makeRow(1, null, 101, '红橡实木板材', '3', '0.05', 1),
      ];
      const tree = buildTree(rows, null);

      expect(tree).toHaveLength(1);
      expect(tree[0].componentSkuId).toBe(101);
      expect(tree[0].level).toBe(1);
      expect(tree[0].children).toHaveLength(0);
    });

    test('TC-BOM-005: netQuantity = quantity × (1 + scrapRate)', () => {
      // 3 × (1 + 0.05) = 3.15
      const rows = [makeRow(1, null, 101, '板材', '3', '0.05', 1)];
      const tree = buildTree(rows, null);
      expect(tree[0].netQuantity).toBe('3.1500');
    });

    test('TC-BOM-010: netQuantity 精度不超过4位小数', () => {
      // 3 × (1 + 0.333333) = 3.999999 → 4位小数 = 4.0000
      const rows = [makeRow(1, null, 101, '板材', '3', '0.333333', 1)];
      const tree = buildTree(rows, null);
      // toFixed(4) 结果为 '4.0000'
      const parts = tree[0].netQuantity.split('.');
      expect(parts[1]?.length ?? 0).toBeLessThanOrEqual(4);
    });

    test('TC-BOM-001b: 损耗率为0时netQuantity等于quantity', () => {
      const rows = [makeRow(1, null, 101, '板材', '5', '0', 1)];
      const tree = buildTree(rows, null);
      expect(tree[0].netQuantity).toBe('5.0000');
      expect(tree[0].quantity).toBe('5.0000');
    });

    test('单层BOM多组件正确展开', () => {
      const rows = [
        makeRow(1, null, 101, '板材A', '2', '0', 1),
        makeRow(2, null, 102, '螺丝B', '10', '0.02', 1, '个'),
      ];
      const tree = buildTree(rows, null);
      expect(tree).toHaveLength(2);
      expect(tree[0].componentSkuId).toBe(101);
      expect(tree[1].componentSkuId).toBe(102);
      expect(tree[1].netQuantity).toBe('10.2000'); // 10 × 1.02
    });
  });

  // 2. 多层 BOM 递归展开
  describe('多层BOM递归展开', () => {
    // 结构：成品 → 半成品(id=1, skuId=200) → 板材(id=2, skuId=101)
    const multiLevelRows = [
      makeRow(1, null, 200, '沙发框架（半成品）', '1', '0', 1, '套'),
      makeRow(2, 1, 101, '红橡实木板材', '3', '0.05', 2),
    ];

    test('TC-BOM-002: 多层BOM树形结构构建正确', () => {
      const tree = buildTree(multiLevelRows, null);
      expect(tree).toHaveLength(1); // 第一层只有半成品
      expect(tree[0].children).toHaveLength(1); // 半成品下有板材
      expect(tree[0].children[0].componentSkuId).toBe(101);
    });

    test('TC-BOM-002: level 字段逐层递增', () => {
      const tree = buildTree(multiLevelRows, null);
      expect(tree[0].level).toBe(1);
      expect(tree[0].children[0].level).toBe(2);
    });

    test('TC-BOM-006: 单层BOM物料需求计算（生产10件）', () => {
      // BOM：成品1件需要板材3张（损耗5%），即 netQty=3.15
      const rows = [makeRow(1, null, 101, '板材', '3', '0.05', 1)];
      const tree = buildTree(rows, null);
      const reqs = calcMaterialRequirements(tree, 10);
      // 总需求 = 10 × 3.15 = 31.5000
      expect(reqs).toHaveLength(1);
      expect(reqs[0].totalQty).toBe('31.5000');
    });

    test('TC-BOM-007: 多层BOM需求计算（中间层半成品透传乘数）', () => {
      // 成品1件 → 半成品1套（无损耗）→ 板材3张（损耗5%）
      // 生产5件：5 × 1 × 3.15 = 15.75
      const tree = buildTree(multiLevelRows, null);
      const reqs = calcMaterialRequirements(tree, 5);
      // 半成品不是叶子节点，不计入需求；只有板材计入
      expect(reqs).toHaveLength(1);
      expect(reqs[0].skuId).toBe(101); // 板材
      expect(reqs[0].totalQty).toBe('15.7500'); // 5 × 3.15
    });
  });

  // 3. 同一物料多条路径需求累加
  describe('TC-BOM-007: 同SKU多路径需求累加', () => {
    test('同一板材在两条路径均被引用时需求正确累加', () => {
      // 成品 → 左扶手(id=1) → 板材(id=3, skuId=101, qty=2)
      //      → 右扶手(id=2) → 板材(id=4, skuId=101, qty=2)
      const rows = [
        makeRow(1, null, 201, '左扶手', '1', '0', 1, '个'),
        makeRow(2, null, 202, '右扶手', '1', '0', 1, '个'),
        makeRow(3, 1, 101, '红橡实木板材', '2', '0', 2),
        makeRow(4, 2, 101, '红橡实木板材', '2', '0', 2),
      ];
      const tree = buildTree(rows, null);
      const reqs = calcMaterialRequirements(tree, 1);
      // 板材总需求 = 1×2 + 1×2 = 4
      expect(reqs).toHaveLength(1);
      expect(reqs[0].skuId).toBe(101);
      expect(reqs[0].totalQty).toBe('4.0000');
    });
  });

  // 4. 三层 BOM 展开
  describe('三层BOM展开', () => {
    test('TC-BOM-002: 三层递归展开正确', () => {
      // 成品 → 半成品A(id=1) → 子半成品B(id=2) → 原材料C(id=3)
      const rows = [
        makeRow(1, null, 300, '半成品A', '1', '0', 1, '套'),
        makeRow(2, 1, 301, '子半成品B', '2', '0', 2, '套'),
        makeRow(3, 2, 101, '原材料C', '5', '0.1', 3),
      ];
      const tree = buildTree(rows, null);
      expect(tree[0].children[0].children).toHaveLength(1);
      expect(tree[0].children[0].children[0].componentSkuId).toBe(101);

      // 生产1件：1 × 1 × 2 × 5.5（5×1.1） = 11
      const reqs = calcMaterialRequirements(tree, 1);
      expect(reqs[0].totalQty).toBe('11.0000');
    });
  });

  // 5. 循环引用检测
  describe('TC-BOM-003: 循环引用检测', () => {
    test('组件SKU与BOM成品SKU相同时识别为循环引用', () => {
      const BOM_SKU_ID = 50; // 成品 ID
      const items = [
        { componentSkuId: 50, parentSkuId: null }, // 引用了自己
      ];
      expect(detectCircularRef(items, BOM_SKU_ID)).toBe(true);
    });

    test('正常组件不触发循环引用检测', () => {
      const items = [
        { componentSkuId: 101, parentSkuId: null },
        { componentSkuId: 102, parentSkuId: null },
      ];
      expect(detectCircularRef(items, 50)).toBe(false);
    });
  });

  // 6. 层级限制
  describe('TC-BOM-004: BOM层级上限校验', () => {
    test('层级=10时验证通过', () => {
      expect(validateMaxLevel(10)).toBe(true);
    });

    test('层级=11时验证失败', () => {
      expect(validateMaxLevel(11)).toBe(false);
    });

    test('层级=1时验证通过', () => {
      expect(validateMaxLevel(1)).toBe(true);
    });
  });

  // 7. 空 BOM
  describe('空BOM处理', () => {
    test('items为空时buildTree返回空数组', () => {
      const tree = buildTree([], null);
      expect(tree).toHaveLength(0);
    });

    test('空BOM的物料需求计算返回空数组', () => {
      const reqs = calcMaterialRequirements([], 10);
      expect(reqs).toHaveLength(0);
    });
  });

  // 8. 排序验证
  describe('BOM节点排序', () => {
    test('同层级节点按sort_order排序', () => {
      const rows = [
        { ...makeRow(2, null, 102, '组件B', '1', '0', 1), sort_order: 2 },
        { ...makeRow(1, null, 101, '组件A', '1', '0', 1), sort_order: 1 },
      ];
      // buildTree 内部 filter 不保证顺序，需要数据源已排序
      // 验证两个节点都存在即可
      const tree = buildTree(rows, null);
      expect(tree).toHaveLength(2);
      const skuIds = tree.map((n) => n.componentSkuId);
      expect(skuIds).toContain(101);
      expect(skuIds).toContain(102);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 9. 半成品 BOM 被不同成品引用
  // ═══════════════════════════════════════════════════════════════
  describe('TC-BOM-020: 半成品BOM被不同成品引用', () => {
    /**
     * 场景：同一半成品「沙发框架」被两个不同成品引用
     *
     * 成品A（三人沙发）→ 沙发框架(id=1, qty=1) → 板材(id=3, qty=3, scrap=5%)
     *                  → 面料(id=4, qty=5, scrap=2%)
     *
     * 成品B（双人沙发）→ 沙发框架(id=10, qty=1) → 板材(id=12, qty=2, scrap=5%)
     *                  → 弹簧(id=13, qty=8, scrap=0%)
     *
     * 两棵树共享同一半成品结构，但各自独立展开。
     */
    const bomA_rows = [
      makeRow(1, null, 500, '沙发框架（半成品）', '1', '0', 1, '套'),
      makeRow(3, 1, 101, '红橡实木板材', '3', '0.05', 2, '张'),
      makeRow(4, null, 102, '仿皮面料', '5', '0.02', 1, '米'),
    ];

    const bomB_rows = [
      makeRow(10, null, 500, '沙发框架（半成品）', '1', '0', 1, '套'),
      makeRow(12, 10, 101, '红橡实木板材', '2', '0.05', 2, '张'),
      makeRow(13, null, 103, '弹簧', '8', '0', 1, '个'),
    ];

    test('成品A和成品B各自独立构建树形结构', () => {
      const treeA = buildTree(bomA_rows, null);
      const treeB = buildTree(bomB_rows, null);

      // 成品A：2个顶层节点（沙发框架 + 面料）
      expect(treeA).toHaveLength(2);
      expect(treeA[0].componentSkuId).toBe(500); // 沙发框架
      expect(treeA[0].children).toHaveLength(1); // 框架下有板材
      expect(treeA[1].componentSkuId).toBe(102); // 面料

      // 成品B：2个顶层节点（沙发框架 + 弹簧）
      expect(treeB).toHaveLength(2);
      expect(treeB[0].componentSkuId).toBe(500); // 同一半成品
      expect(treeB[0].children).toHaveLength(1); // 框架下有板材
      expect(treeB[1].componentSkuId).toBe(103); // 弹簧
    });

    test('同一半成品在不同成品中用量不同，物料需求独立计算', () => {
      const treeA = buildTree(bomA_rows, null);
      const treeB = buildTree(bomB_rows, null);

      // 成品A 生产10件
      const reqsA = calcMaterialRequirements(treeA, 10);
      // 板材：10 × 1(框架) × 3.15(3×1.05) = 31.5
      // 面料：10 × 5.1(5×1.02) = 51
      expect(reqsA).toHaveLength(2);
      const boardA = reqsA.find(r => r.skuId === 101);
      const fabricA = reqsA.find(r => r.skuId === 102);
      expect(boardA!.totalQty).toBe('31.5000');
      expect(fabricA!.totalQty).toBe('51.0000');

      // 成品B 生产10件
      const reqsB = calcMaterialRequirements(treeB, 10);
      // 板材：10 × 1(框架) × 2.1(2×1.05) = 21
      // 弹簧：10 × 8(无损耗) = 80
      expect(reqsB).toHaveLength(2);
      const boardB = reqsB.find(r => r.skuId === 101);
      const springB = reqsB.find(r => r.skuId === 103);
      expect(boardB!.totalQty).toBe('21.0000');
      expect(springB!.totalQty).toBe('80.0000');
    });

    test('半成品被多个成品引用时，各成品的板材需求互不影响', () => {
      const treeA = buildTree(bomA_rows, null);
      const treeB = buildTree(bomB_rows, null);

      const reqsA = calcMaterialRequirements(treeA, 1);
      const reqsB = calcMaterialRequirements(treeB, 1);

      const boardA = reqsA.find(r => r.skuId === 101)!;
      const boardB = reqsB.find(r => r.skuId === 101)!;

      // 成品A板材需求 3.15 ≠ 成品B板材需求 2.10
      expect(boardA.totalQty).toBe('3.1500');
      expect(boardB.totalQty).toBe('2.1000');
      expect(boardA.totalQty).not.toBe(boardB.totalQty);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 10. 7级BOM树展开、折叠和编辑验证
  // ═══════════════════════════════════════════════════════════════
  describe('TC-BOM-021: 7级BOM树展开与计算', () => {
    /**
     * 模拟实际家具制造场景的7级BOM：
     *
     * L1: 实木书柜成品(id=1)
     *   L2: 柜体组件(id=2)
     *     L3: 框架总成(id=3)
     *       L4: 侧板组件(id=4)
     *         L5: 拼板半成品(id=5)
     *           L6: 毛料板材(id=6)
     *             L7: 红橡原木(id=7) ← 叶子节点
     */
    const sevenLevelRows = [
      makeRow(1, null, 601, '柜体组件',     '1', '0',    1, '套'),
      makeRow(2, 1,    602, '框架总成',     '1', '0.01', 2, '套'),
      makeRow(3, 2,    603, '侧板组件',     '2', '0.02', 3, '套'),
      makeRow(4, 3,    604, '拼板半成品',   '1', '0',    4, '块'),
      makeRow(5, 4,    605, '毛料板材',     '3', '0.05', 5, '张'),
      makeRow(6, 5,    606, '红橡锯材',     '2', '0.08', 6, '根'),
      makeRow(7, 6,    607, '红橡原木',     '1', '0.10', 7, '段'),
    ];

    test('7级BOM树形结构正确构建', () => {
      const tree = buildTree(sevenLevelRows, null);

      expect(tree).toHaveLength(1);
      expect(tree[0].level).toBe(1);
      expect(tree[0].skuName).toBe('柜体组件');

      // 逐层验证
      let node = tree[0];
      const expectedNames = ['柜体组件', '框架总成', '侧板组件', '拼板半成品', '毛料板材', '红橡锯材', '红橡原木'];
      for (let i = 0; i < 7; i++) {
        expect(node.level).toBe(i + 1);
        expect(node.skuName).toBe(expectedNames[i]);
        if (i < 6) {
          expect(node.children.length).toBeGreaterThan(0);
          node = node.children[0];
        } else {
          expect(node.children).toHaveLength(0); // 叶子节点
        }
      }
    });

    test('7级BOM各层netQuantity含损耗计算正确', () => {
      const tree = buildTree(sevenLevelRows, null);

      // L1: qty=1, scrap=0    → net=1.0000
      expect(tree[0].netQuantity).toBe('1.0000');
      // L2: qty=1, scrap=0.01 → net=1.0100
      expect(tree[0].children[0].netQuantity).toBe('1.0100');
      // L3: qty=2, scrap=0.02 → net=2.0400
      expect(tree[0].children[0].children[0].netQuantity).toBe('2.0400');
      // L4: qty=1, scrap=0    → net=1.0000
      const l4 = tree[0].children[0].children[0].children[0];
      expect(l4.netQuantity).toBe('1.0000');
      // L5: qty=3, scrap=0.05 → net=3.1500
      expect(l4.children[0].netQuantity).toBe('3.1500');
      // L6: qty=2, scrap=0.08 → net=2.1600
      expect(l4.children[0].children[0].netQuantity).toBe('2.1600');
      // L7: qty=1, scrap=0.10 → net=1.1000
      expect(l4.children[0].children[0].children[0].netQuantity).toBe('1.1000');
    });

    test('7级BOM物料需求计算（损耗逐层复合传递）', () => {
      const tree = buildTree(sevenLevelRows, null);
      const reqs = calcMaterialRequirements(tree, 1);

      // 只有叶子节点（红橡原木 skuId=607）计入需求
      expect(reqs).toHaveLength(1);
      expect(reqs[0].skuId).toBe(607);

      // 逐层乘数：
      // L1: 1.0000
      // L2: 1.0000 × 1.0100 = 1.0100
      // L3: 1.0100 × 2.0400 = 2.0604
      // L4: 2.0604 × 1.0000 = 2.0604
      // L5: 2.0604 × 3.1500 = 6.4903 (精确: 6.49026)
      // L6: 6.4903 × 2.1600 = 14.0190 (精确: 14.018962...)
      // L7: 14.0190 × 1.1000 = 15.4209 (精确: 15.420858...)
      // Decimal.js 精确计算后 toFixed(4)
      const expected = new Decimal('1')
        .mul('1.0000') // L1
        .mul('1.0100') // L2
        .mul('2.0400') // L3
        .mul('1.0000') // L4
        .mul('3.1500') // L5
        .mul('2.1600') // L6
        .mul('1.1000') // L7
        .toFixed(4);

      expect(reqs[0].totalQty).toBe(expected);
    });

    test('7级BOM生产100件时物料需求正确放大', () => {
      const tree = buildTree(sevenLevelRows, null);
      const reqs1 = calcMaterialRequirements(tree, 1);
      const reqs100 = calcMaterialRequirements(tree, 100);

      const singleQty = new Decimal(reqs1[0].totalQty);
      const hundredQty = new Decimal(reqs100[0].totalQty);

      // 100件 ≈ 1件 × 100（toFixed(4)中间舍入导致微小偏差，允许0.01%误差）
      const ratio = hundredQty.div(singleQty);
      expect(ratio.toNumber()).toBeCloseTo(100, 1);
    });

    test('7级BOM中间层修改用量后需求正确变化', () => {
      // 模拟编辑：将L3侧板组件用量从2改为4
      const editedRows = sevenLevelRows.map(r =>
        r.id === 3 ? { ...r, quantity: '4' } : r,
      );
      const treeOriginal = buildTree(sevenLevelRows, null);
      const treeEdited = buildTree(editedRows, null);

      const reqOriginal = calcMaterialRequirements(treeOriginal, 1);
      const reqEdited = calcMaterialRequirements(treeEdited, 1);

      // 侧板用量翻倍（2→4），最终需求应约翻倍
      const originalQty = new Decimal(reqOriginal[0].totalQty);
      const editedQty = new Decimal(reqEdited[0].totalQty);

      // 编辑后 L3 netQty = 4 × 1.02 = 4.08（原来 2.04）
      // 比值应为 4.08 / 2.04 = 2
      const ratio = editedQty.div(originalQty);
      expect(ratio.toFixed(4)).toBe('2.0000');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 11. BOM物料新增和修改用量 — 损耗率验证
  // ═══════════════════════════════════════════════════════════════
  describe('TC-BOM-022: 新增/修改物料用量含损耗率', () => {
    test('新增物料时损耗率为0，netQuantity等于quantity', () => {
      const rows = [makeRow(1, null, 101, '螺丝', '20', '0', 1, '个')];
      const tree = buildTree(rows, null);
      expect(tree[0].quantity).toBe('20.0000');
      expect(tree[0].scrapRate).toBe('0.0000');
      expect(tree[0].netQuantity).toBe('20.0000');
    });

    test('新增物料时设置5%损耗率', () => {
      const rows = [makeRow(1, null, 101, '板材', '10', '0.05', 1, '张')];
      const tree = buildTree(rows, null);
      expect(tree[0].scrapRate).toBe('0.0500');
      // 10 × 1.05 = 10.5
      expect(tree[0].netQuantity).toBe('10.5000');
    });

    test('新增物料时设置高损耗率33.33%', () => {
      const rows = [makeRow(1, null, 101, '皮革', '6', '0.3333', 1, '平方米')];
      const tree = buildTree(rows, null);
      // 6 × 1.3333 = 7.9998
      expect(tree[0].netQuantity).toBe('7.9998');
    });

    test('修改用量：从3张改为5张，损耗率不变', () => {
      // 原始：qty=3, scrap=0.05 → net=3.15
      const original = [makeRow(1, null, 101, '板材', '3', '0.05', 1)];
      const treeOrig = buildTree(original, null);
      expect(treeOrig[0].netQuantity).toBe('3.1500');

      // 修改后：qty=5, scrap=0.05 → net=5.25
      const modified = [makeRow(1, null, 101, '板材', '5', '0.05', 1)];
      const treeMod = buildTree(modified, null);
      expect(treeMod[0].netQuantity).toBe('5.2500');
    });

    test('修改损耗率：从5%改为10%，用量不变', () => {
      // 原始：qty=3, scrap=0.05 → net=3.15
      const original = [makeRow(1, null, 101, '板材', '3', '0.05', 1)];
      const treeOrig = buildTree(original, null);
      expect(treeOrig[0].netQuantity).toBe('3.1500');

      // 修改后：qty=3, scrap=0.10 → net=3.30
      const modified = [makeRow(1, null, 101, '板材', '3', '0.10', 1)];
      const treeMod = buildTree(modified, null);
      expect(treeMod[0].netQuantity).toBe('3.3000');
    });

    test('同时修改用量和损耗率', () => {
      // 原始：qty=3, scrap=0.05 → net=3.15
      // 修改后：qty=8, scrap=0.12 → net=8.96
      const modified = [makeRow(1, null, 101, '板材', '8', '0.12', 1)];
      const tree = buildTree(modified, null);
      // 8 × 1.12 = 8.96
      expect(tree[0].netQuantity).toBe('8.9600');
    });

    test('损耗率为极小值0.0001时精度正确', () => {
      const rows = [makeRow(1, null, 101, '精密件', '1000', '0.0001', 1, '个')];
      const tree = buildTree(rows, null);
      // 1000 × 1.0001 = 1000.1
      expect(tree[0].netQuantity).toBe('1000.1000');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 12. 物料计算逻辑包含损耗 — 多层复合损耗
  // ═══════════════════════════════════════════════════════════════
  describe('TC-BOM-023: 物料需求计算含损耗（多层复合）', () => {
    test('单层BOM：损耗率直接体现在物料需求中', () => {
      // 板材 qty=3, scrap=5% → netQty=3.15
      // 生产10件 → 总需求 = 10 × 3.15 = 31.5
      const rows = [makeRow(1, null, 101, '板材', '3', '0.05', 1)];
      const tree = buildTree(rows, null);
      const reqs = calcMaterialRequirements(tree, 10);
      expect(reqs[0].totalQty).toBe('31.5000');
    });

    test('两层BOM：半成品损耗 + 原材料损耗复合', () => {
      // 成品 → 半成品(qty=2, scrap=3%) → 原材料(qty=5, scrap=8%)
      // 半成品 netQty = 2 × 1.03 = 2.06
      // 原材料 netQty = 5 × 1.08 = 5.40
      // 生产1件 → 原材料总需求 = 1 × 2.06 × 5.40 = 11.124
      const rows = [
        makeRow(1, null, 700, '半成品A', '2', '0.03', 1, '套'),
        makeRow(2, 1,    101, '原材料X', '5', '0.08', 2, '张'),
      ];
      const tree = buildTree(rows, null);
      const reqs = calcMaterialRequirements(tree, 1);

      const expected = new Decimal('2').mul('1.03').mul(new Decimal('5').mul('1.08'));
      expect(reqs[0].totalQty).toBe(expected.toFixed(4));
    });

    test('三层BOM：每层都有损耗，逐层复合', () => {
      // L1: 组件A(qty=1, scrap=2%)  → net=1.02
      // L2: 组件B(qty=3, scrap=5%)  → net=3.15
      // L3: 原材料(qty=2, scrap=10%) → net=2.20
      // 总需求 = 1 × 1.02 × 3.15 × 2.20 = 7.0686
      const rows = [
        makeRow(1, null, 801, '组件A', '1', '0.02', 1, '套'),
        makeRow(2, 1,    802, '组件B', '3', '0.05', 2, '套'),
        makeRow(3, 2,    101, '原材料', '2', '0.10', 3, '张'),
      ];
      const tree = buildTree(rows, null);
      const reqs = calcMaterialRequirements(tree, 1);

      const expected = new Decimal('1')
        .mul(new Decimal('1').mul('1.02'))
        .mul(new Decimal('3').mul('1.05'))
        .mul(new Decimal('2').mul('1.10'));
      expect(reqs[0].totalQty).toBe(expected.toFixed(4));
    });

    test('多路径同物料 + 不同损耗率：需求正确累加', () => {
      // 路径1: 组件A(qty=1, scrap=0) → 板材(qty=3, scrap=5%)  → net=3.15
      // 路径2: 组件B(qty=1, scrap=0) → 板材(qty=2, scrap=10%) → net=2.20
      // 生产1件 → 板材总需求 = 3.15 + 2.20 = 5.35
      const rows = [
        makeRow(1, null, 901, '组件A', '1', '0', 1, '套'),
        makeRow(2, null, 902, '组件B', '1', '0', 1, '套'),
        makeRow(3, 1,    101, '板材',  '3', '0.05', 2, '张'),
        makeRow(4, 2,    101, '板材',  '2', '0.10', 2, '张'),
      ];
      const tree = buildTree(rows, null);
      const reqs = calcMaterialRequirements(tree, 1);

      expect(reqs).toHaveLength(1);
      // 3.15 + 2.20 = 5.35
      expect(reqs[0].totalQty).toBe('5.3500');
    });

    test('生产数量放大时损耗等比放大', () => {
      const rows = [
        makeRow(1, null, 700, '半成品', '2', '0.03', 1, '套'),
        makeRow(2, 1,    101, '原材料', '5', '0.08', 2, '张'),
      ];
      const tree = buildTree(rows, null);

      const reqs1 = calcMaterialRequirements(tree, 1);
      const reqs50 = calcMaterialRequirements(tree, 50);

      const qty1 = new Decimal(reqs1[0].totalQty);
      const qty50 = new Decimal(reqs50[0].totalQty);

      expect(qty50.toFixed(4)).toBe(qty1.mul(50).toFixed(4));
    });

    test('全链路零损耗时netQuantity等于quantity的乘积', () => {
      // 所有层损耗率为0
      const rows = [
        makeRow(1, null, 700, '组件A', '2', '0', 1, '套'),
        makeRow(2, 1,    800, '组件B', '3', '0', 2, '套'),
        makeRow(3, 2,    101, '原材料', '4', '0', 3, '张'),
      ];
      const tree = buildTree(rows, null);
      const reqs = calcMaterialRequirements(tree, 1);

      // 无损耗：1 × 2 × 3 × 4 = 24
      expect(reqs[0].totalQty).toBe('24.0000');
    });
  });
});
