delete (globalThis as any).expect;
import { test, expect, type Page, type Route } from '@playwright/test';

const mockUser = {
  id: 9,
  username: 'salesboss',
  realName: '销售主管A',
  roles: ['boss', 'sales', 'supervisor'],
  tenantId: 1,
  tenantName: '测试工厂',
};

const shippedOrder = {
  id: 201,
  orderNo: 'SO-201',
  customerId: 11,
  customerName: '华北客户',
  orderDate: '2026-03-18',
  deliveryDate: '2026-03-28',
  isUrgent: false,
  status: 'shipped',
  totalAmount: '12800.00',
  notes: '重点客户订单',
  approvalStatus: 'approved',
  approvalNotes: '老板已确认优先生产',
  approvedByName: '老板A',
  approvedAt: '2026-03-18 10:20:00',
  createdAt: '2026-03-18 09:00:00',
  updatedAt: '2026-03-22 18:00:00',
  items: [
    {
      id: 3011,
      orderId: 201,
      productCode: 'FG-901',
      productName: '功能沙发A',
      quantity: '20',
      qtyOrdered: '20',
      qtyDelivered: '20',
      unit: '套',
      unitPrice: '640.00',
      amount: '12800.00',
    },
  ],
  productionOrders: [
    {
      id: 801,
      workOrderNo: 'WO-801',
      status: 'released',
      materialStatus: 'ready',
      createdAt: '2026-03-18 11:00:00',
      plannedEnd: '2026-03-24 18:00:00',
    },
  ],
  deliveries: [
    {
      id: 901,
      deliveryNo: 'DO-901',
      trackingNo: 'SF1234567890',
      status: 'shipped',
      shippedAt: '2026-03-25 09:30:00',
      receivedAt: null,
    },
  ],
  auditLogs: [
    {
      id: 1,
      module: 'sales-order',
      action: 'CREATE',
      targetId: 201,
      targetCode: 'SO-201',
      operatorId: 9,
      operatorName: '销售主管A',
      createdAt: '2026-03-18 09:00:00',
    },
    {
      id: 2,
      module: 'sales-order',
      action: 'CONFIRM',
      targetId: 201,
      targetCode: 'SO-201',
      operatorId: 9,
      operatorName: '销售主管A',
      createdAt: '2026-03-18 10:00:00',
    },
    {
      id: 3,
      module: 'sales-order',
      action: 'SHIP',
      targetId: 201,
      targetCode: 'SO-201',
      operatorId: 9,
      operatorName: '销售主管A',
      createdAt: '2026-03-25 09:30:00',
    },
  ],
};

const inProductionOrderBase = {
  id: 202,
  orderNo: 'SO-202',
  customerId: 12,
  customerName: '华东客户',
  orderDate: '2026-03-20',
  deliveryDate: '2026-03-30',
  isUrgent: false,
  status: 'in_production',
  totalAmount: '4500.00',
  notes: '需分批发货',
  createdAt: '2026-03-20 08:00:00',
  updatedAt: '2026-03-24 12:00:00',
  items: [
    {
      id: 3021,
      orderId: 202,
      productCode: 'FG-902',
      productName: '餐椅B',
      quantity: '10',
      qtyOrdered: '10',
      qtyDelivered: '4',
      unit: '把',
      unitPrice: '450.00',
      amount: '4500.00',
    },
  ],
  productionOrders: [
    {
      id: 802,
      workOrderNo: 'WO-802',
      status: 'processing',
      materialStatus: 'partial',
      createdAt: '2026-03-20 09:00:00',
      plannedEnd: '2026-03-28 18:00:00',
    },
  ],
  deliveries: [],
  auditLogs: [
    {
      id: 11,
      module: 'sales-order',
      action: 'CREATE',
      targetId: 202,
      targetCode: 'SO-202',
      operatorId: 9,
      operatorName: '销售主管A',
      createdAt: '2026-03-20 08:00:00',
    },
    {
      id: 12,
      module: 'sales-order',
      action: 'CONFIRM',
      targetId: 202,
      targetCode: 'SO-202',
      operatorId: 9,
      operatorName: '销售主管A',
      createdAt: '2026-03-20 09:00:00',
    },
  ],
};

const pendingApprovalOrderBase = {
  id: 203,
  orderNo: 'SO-203',
  customerId: 13,
  customerName: '华南客户',
  orderDate: '2026-03-21',
  deliveryDate: '2026-03-29',
  isUrgent: true,
  status: 'pending_approval',
  totalAmount: '9600.00',
  notes: '紧急插单待审批',
  approvalStatus: 'pending',
  approvalNotes: '需老板确认是否插单',
  approvedByName: null,
  approvedAt: null,
  createdAt: '2026-03-21 08:30:00',
  updatedAt: '2026-03-21 09:00:00',
  items: [
    {
      id: 3031,
      orderId: 203,
      productCode: 'FG-903',
      productName: '休闲椅C',
      quantity: '12',
      qtyOrdered: '12',
      qtyDelivered: '0',
      unit: '把',
      unitPrice: '800.00',
      amount: '9600.00',
    },
  ],
  productionOrders: [],
  deliveries: [],
  auditLogs: [
    {
      id: 21,
      module: 'sales-order',
      action: 'CREATE',
      targetId: 203,
      targetCode: 'SO-203',
      operatorId: 9,
      operatorName: '销售主管A',
      createdAt: '2026-03-21 08:30:00',
    },
    {
      id: 22,
      module: 'sales-order',
      action: 'SUBMIT_APPROVAL',
      targetId: 203,
      targetCode: 'SO-203',
      operatorId: 9,
      operatorName: '销售主管A',
      createdAt: '2026-03-21 09:00:00',
    },
  ],
};

function fulfillJson(route: Route, data: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      code: 0,
      message: 'ok',
      data,
    }),
  });
}

interface MockCreatedOrder extends Record<string, unknown> {
  id: number;
  orderNo: string;
  customerId: number;
  customerName: string;
  customerCode: string;
  orderDate: string;
  deliveryDate: string;
  isUrgent: boolean;
  status: string;
  totalAmount: string;
  notes: string;
  approvalStatus?: string;
  approvalNotes?: string;
  approvedByName?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  items: Array<Record<string, unknown>>;
  productionOrders: Array<Record<string, unknown>>;
  deliveries: Array<Record<string, unknown>>;
  auditLogs: Array<Record<string, unknown>>;
}

async function mockSalesApis(page: Page) {
  let hasShipped = false;
  let urgentApproved = false;
  let shippedCompleted = false;
  let lastShipPayload: Record<string, unknown> | null = null;
  let createdOrderSeq = 0;
  const createdOrders: MockCreatedOrder[] = [];
  const assessmentCounters = {
    inventoryChecks: 0,
    capacityChecks: 0,
  };

  const customerMap = new Map<number, { name: string; code: string }>([
    [11, { name: '华北客户', code: 'CUST-011' }],
    [12, { name: '华东客户', code: 'CUST-012' }],
    [13, { name: '华南客户', code: 'CUST-013' }],
  ]);

  const skuMap = new Map<number, { skuCode: string; name: string; unit: string }>([
    [901, { skuCode: 'FG-901', name: '功能沙发A', unit: '套' }],
    [902, { skuCode: 'FG-902', name: '餐椅B', unit: '把' }],
    [903, { skuCode: 'FG-903', name: '休闲椅C', unit: '把' }],
  ]);

  const getInProductionOrder = () => ({
    ...inProductionOrderBase,
    status: hasShipped ? 'shipped' : inProductionOrderBase.status,
    deliveries: hasShipped
      ? [
          {
            id: 902,
            deliveryNo: 'DO-902',
            trackingNo: String(lastShipPayload?.trackingNo ?? 'YT20260324001'),
            status: 'shipped',
            shippedAt: '2026-03-24 15:30:00',
            receivedAt: null,
          },
        ]
      : [],
    items: inProductionOrderBase.items.map((item) => ({
      ...item,
      qtyDelivered: hasShipped ? '10' : item.qtyDelivered,
    })),
    auditLogs: hasShipped
      ? [
          ...inProductionOrderBase.auditLogs,
          {
            id: 13,
            module: 'sales-order',
            action: 'SHIP',
            targetId: 202,
            targetCode: 'SO-202',
            operatorId: 9,
            operatorName: '销售主管A',
            createdAt: '2026-03-24 15:30:00',
          },
        ]
      : inProductionOrderBase.auditLogs,
  });

  const getPendingApprovalOrder = () => ({
    ...pendingApprovalOrderBase,
    status: urgentApproved ? 'confirmed' : pendingApprovalOrderBase.status,
    approvalStatus: urgentApproved ? 'approved' : pendingApprovalOrderBase.approvalStatus,
    approvalNotes: urgentApproved ? '同意插单，立即排产' : pendingApprovalOrderBase.approvalNotes,
    approvedByName: urgentApproved ? '老板A' : null,
    approvedAt: urgentApproved ? '2026-03-21 10:00:00' : null,
    updatedAt: urgentApproved ? '2026-03-21 10:00:00' : pendingApprovalOrderBase.updatedAt,
    productionOrders: urgentApproved
      ? [
          {
            id: 803,
            workOrderNo: 'WO-803',
            status: 'released',
            materialStatus: 'partial',
            createdAt: '2026-03-21 10:05:00',
            plannedEnd: '2026-03-27 18:00:00',
          },
        ]
      : [],
    auditLogs: urgentApproved
      ? [
          ...pendingApprovalOrderBase.auditLogs,
          {
            id: 23,
            module: 'sales-order',
            action: 'APPROVE',
            targetId: 203,
            targetCode: 'SO-203',
            operatorId: 1,
            operatorName: '老板A',
            createdAt: '2026-03-21 10:00:00',
          },
        ]
      : pendingApprovalOrderBase.auditLogs,
  });

  const getShippedOrder = () => ({
    ...shippedOrder,
    status: shippedCompleted ? 'completed' : shippedOrder.status,
    deliveries: shippedOrder.deliveries.map((delivery) => ({
      ...delivery,
      status: shippedCompleted ? 'received' : delivery.status,
      receivedAt: shippedCompleted ? '2026-03-26 16:20:00' : delivery.receivedAt,
    })),
    auditLogs: shippedCompleted
      ? [
          ...shippedOrder.auditLogs,
          {
            id: 4,
            module: 'sales-order',
            action: 'COMPLETE',
            targetId: 201,
            targetCode: 'SO-201',
            operatorId: 9,
            operatorName: '销售主管A',
            createdAt: '2026-03-26 16:20:00',
          },
        ]
      : shippedOrder.auditLogs,
  });

  const toListRow = (order: Record<string, unknown>) => ({
    ...order,
    items: undefined,
    productionOrders: undefined,
    deliveries: undefined,
    auditLogs: undefined,
  });

  const getAllOrders = () => [
    ...createdOrders,
    getShippedOrder(),
    getInProductionOrder(),
    getPendingApprovalOrder(),
  ];

  const buildStats = () => {
    const byStatus = {
      draft: 0,
      submitted: 0,
      confirmed: 0,
      produced: 0,
      pending_approval: 0,
      in_production: 0,
      partial_shipped: 0,
      shipped: 0,
      completed: 0,
      closed: 0,
    };

    for (const order of getAllOrders()) {
      const status = String(order.status ?? '');
      if (status in byStatus) {
        byStatus[status as keyof typeof byStatus] += 1;
      }
    }

    return {
      total: getAllOrders().length,
      byStatus,
    };
  };

  await page.route('**/api/sales-orders/stats**', async (route) => {
    await fulfillJson(route, buildStats());
  });

  await page.route('**/api/sales-orders/pending-approvals**', async (route) => {
    await fulfillJson(route, {
      count: getAllOrders().filter((order) => order.status === 'pending_approval').length,
      orders: getAllOrders().filter((order) => order.status === 'pending_approval'),
    });
  });

  await page.route('**/api/sales-orders**', async (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split('/');
    const maybeId = Number(parts.at(-1));
    const isCollectionRoute = parts.at(-1) === 'sales-orders';

    if (route.request().method() === 'POST' && parts.at(-1) === 'ship') {
      return;
    }

    if (route.request().method() === 'POST' && isCollectionRoute) {
      const payload = route.request().postDataJSON() as {
        customerId: number;
        orderDate: string;
        deliveryDate: string;
        isUrgent: boolean;
        saveAsDraft?: boolean;
        items: Array<{
          skuId: number;
          productName: string;
          quantity: number;
          unit?: string;
          unitPrice: string;
        }>;
      };

      createdOrderSeq += 1;
      const orderId = 300 + createdOrderSeq;
      const orderNo = `SO-30${createdOrderSeq}`;
      const customer = customerMap.get(payload.customerId) ?? {
        name: `客户${payload.customerId}`,
        code: `CUST-${payload.customerId}`,
      };
      const status = payload.saveAsDraft ? 'draft' : payload.isUrgent ? 'pending_approval' : 'draft';
      const totalAmount = payload.items
        .reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0)
        .toFixed(2);

      const detail: MockCreatedOrder = {
        id: orderId,
        orderNo,
        customerId: payload.customerId,
        customerName: customer.name,
        customerCode: customer.code,
        orderDate: payload.orderDate,
        deliveryDate: payload.deliveryDate,
        isUrgent: payload.isUrgent,
        status,
        totalAmount,
        notes: '',
        approvalStatus: status === 'pending_approval' ? 'pending' : undefined,
        approvalNotes: status === 'pending_approval' ? '需老板确认是否插单' : undefined,
        approvedByName: null,
        approvedAt: null,
        createdAt: `${payload.orderDate} 09:00:00`,
        updatedAt: `${payload.orderDate} 09:00:00`,
        items: payload.items.map((item, index) => {
          const sku = skuMap.get(item.skuId);
          const amount = (Number(item.quantity) * Number(item.unitPrice)).toFixed(2);
          return {
            id: orderId * 10 + index + 1,
            orderId,
            productCode: sku?.skuCode ?? `SKU-${item.skuId}`,
            productName: item.productName,
            quantity: String(item.quantity),
            qtyOrdered: String(item.quantity),
            qtyDelivered: '0',
            unit: item.unit ?? sku?.unit ?? '件',
            unitPrice: String(item.unitPrice),
            amount,
          };
        }),
        productionOrders: [],
        deliveries: [],
        auditLogs: [
          {
            id: orderId * 100,
            module: 'sales-order',
            action: 'CREATE',
            targetId: orderId,
            targetCode: orderNo,
            operatorId: 9,
            operatorName: '销售主管A',
            createdAt: `${payload.orderDate} 09:00:00`,
          },
        ],
      };

      createdOrders.unshift(detail);
      await fulfillJson(route, detail);
      return;
    }

    if (Number.isFinite(maybeId) && maybeId > 0) {
      const createdOrder = createdOrders.find((order) => Number(order.id) === maybeId);
      const detail = createdOrder
        ?? (maybeId === 201
          ? getShippedOrder()
          : maybeId === 202
          ? getInProductionOrder()
          : getPendingApprovalOrder());
      await fulfillJson(route, detail);
      return;
    }

    await fulfillJson(route, {
      list: getAllOrders().map(toListRow),
      total: getAllOrders().length,
      page: 1,
      pageSize: 20,
    });
  });

  await page.route('**/api/sales-orders/*/confirm', async (route) => {
    const orderId = Number(route.request().url().split('/').at(-2));
    const order = createdOrders.find((item) => item.id === orderId);
    if (order) {
      order.status = 'confirmed';
      order.updatedAt = `${String(order.orderDate)} 10:00:00`;
      order.productionOrders = [
        {
          id: 900 + orderId,
          workOrderNo: `WO-${900 + orderId}`,
          status: 'released',
          materialStatus: 'partial',
          createdAt: `${String(order.orderDate)} 10:05:00`,
          plannedEnd: `${String(order.deliveryDate)} 18:00:00`,
        },
      ];
      order.auditLogs = [
        ...order.auditLogs,
        {
          id: orderId * 100 + 1,
          module: 'sales-order',
          action: 'CONFIRM',
          targetId: orderId,
          targetCode: order.orderNo,
          operatorId: 9,
          operatorName: '销售主管A',
          createdAt: `${String(order.orderDate)} 10:00:00`,
        },
      ];
    }
    await fulfillJson(route, null);
  });

  await page.route('**/api/sales-orders/*/ship', async (route) => {
    lastShipPayload = route.request().postDataJSON() as Record<string, unknown>;
    hasShipped = true;
    await fulfillJson(route, null);
  });

  await page.route('**/api/sales-orders/*/complete', async (route) => {
    shippedCompleted = true;
    await fulfillJson(route, null);
  });

  await page.route('**/api/sales-orders/*/approve', async (route) => {
    urgentApproved = true;
    await fulfillJson(route, getPendingApprovalOrder());
  });

  await page.route('**/api/sales/orders/analyze-urgent', async (route) => {
    await fulfillJson(route, {
      overallResult: 'warn',
      inventoryTurnoverCheck: {
        passed: true,
        currentValue: '28天',
        threshold: '45天',
        detail: '库存周转仍在可接受范围内',
      },
      capitalOccupationCheck: {
        passed: true,
        currentValue: '18万元',
        threshold: '25万元',
        detail: '新增资金占用可控',
      },
      productionCostCheck: {
        passed: true,
        currentValue: '6120元',
        threshold: '7000元',
        detail: '生产成本增加有限',
      },
      capacityLoadCheck: {
        passed: false,
        currentValue: '92%',
        threshold: '85%',
        detail: '插单后未来三天产能负荷偏高',
      },
      blockedReasons: ['未来三天产能负荷偏高'],
      impactAnalysis: {
        affectedOrders: [
          {
            orderId: 202,
            orderNo: 'SO-202',
            delayDays: 1,
          },
        ],
        additionalCapital: '180000',
        turnoverDaysChange: '+2',
        additionalProductionCost: '1200',
      },
    });
  });

  await page.route('**/api/customers/options**', async (route) => {
    await fulfillJson(route, [
      { id: 11, name: '华北客户', code: 'CUST-011' },
      { id: 12, name: '华东客户', code: 'CUST-012' },
      { id: 13, name: '华南客户', code: 'CUST-013' },
    ]);
  });

  await page.route('**/api/skus**', async (route) => {
    await fulfillJson(route, {
      list: [
        { id: 901, skuCode: 'FG-901', name: '功能沙发A', unit: '套', category1Code: 'FINISHED' },
        { id: 902, skuCode: 'FG-902', name: '餐椅B', unit: '把', category1Code: 'FINISHED' },
        { id: 903, skuCode: 'FG-903', name: '休闲椅C', unit: '把', category1Code: 'FINISHED' },
      ],
      total: 3,
      page: 1,
      pageSize: 200,
    });
  });

  await page.route('**/api/inventory/check**', async (route) => {
    assessmentCounters.inventoryChecks += 1;
    await fulfillJson(route, {
      available: 999,
      sufficient: true,
      stockUnit: '件',
    });
  });

  await page.route('**/api/sales-orders/capacity-check**', async (route) => {
    assessmentCounters.capacityChecks += 1;
    const url = new URL(route.request().url());
    const expectedDelivery = String(url.searchParams.get('expectedDelivery') ?? '2026-04-03');
    await fulfillJson(route, {
      available: true,
      currentLoad: 20,
      maxCapacity: 120,
      estimatedCompletionDate: expectedDelivery,
      conflictingOrders: [],
    });
  });

  return assessmentCounters;
}

test.describe('销售订单管理冒烟', () => {
  let assessmentCounters: Awaited<ReturnType<typeof mockSalesApis>>;

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((user) => {
      window.sessionStorage.setItem('__sf_at', 'playwright-token');
      window.localStorage.setItem('sf_user', JSON.stringify(user));
    }, mockUser);
    assessmentCounters = await mockSalesApis(page);
  });

  test('订单详情展示当前流程进度和状态操作', async ({ page }) => {
    await page.goto('/sales/order-list');

    await expect(page.locator('#main-content').getByRole('heading', { name: '销售订单管理' })).toBeVisible();

    const row = page.locator('tbody tr').filter({ hasText: 'SO-201' }).first();
    await row.getByRole('button', { name: '查看详情' }).click();

    const drawer = page.getByRole('dialog', { name: '订单详情' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('基本信息', { exact: true })).toBeVisible();
    await expect(drawer.getByText('订单进度', { exact: true })).toBeVisible();
    await expect(drawer.getByText('产品明细', { exact: true })).toBeVisible();
    await expect(drawer.getByText('状态操作', { exact: true })).toBeVisible();
    await expect(drawer.getByText('SO-201', { exact: true })).toBeVisible();
    await expect(drawer.getByText('华北客户', { exact: true })).toBeVisible();
    await expect(drawer.getByRole('button', { name: '确认完成' })).toBeVisible();
  });

  test('在产订单可直接标记发货并刷新为已发货状态', async ({ page }) => {
    await page.goto('/sales/order-list');

    const row = page.locator('tbody tr').filter({ hasText: 'SO-202' }).first();
    await row.getByRole('button', { name: '查看详情' }).click();

    const drawer = page.getByRole('dialog', { name: '订单详情' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: '标记发货' }).click();

    await expect(drawer.getByText('已发货').first()).toBeVisible();
    await expect(drawer.getByRole('button', { name: '确认完成' })).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'SO-202' }).first()).toContainText('已发货');
  });

  test('紧急订单可审批通过并切换为已确认状态', async ({ page }) => {
    await page.goto('/sales/order-list');

    const row = page.locator('tbody tr').filter({ hasText: 'SO-203' }).first();
    await row.getByRole('button', { name: '查看详情' }).click();

    const drawer = page.getByRole('dialog', { name: '订单详情' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('待审批').first()).toBeVisible();

    await drawer.getByRole('button', { name: '审批通过' }).click();

    await expect(drawer.getByText('已确认').first()).toBeVisible();
    await expect(drawer.getByRole('button', { name: '触发建工单' })).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'SO-203' }).first()).toContainText('已确认');
  });

  test('已发货订单可确认完成并更新订单状态', async ({ page }) => {
    await page.goto('/sales/order-list');

    const row = page.locator('tbody tr').filter({ hasText: 'SO-201' }).first();
    await row.getByRole('button', { name: '查看详情' }).click();

    const drawer = page.getByRole('dialog', { name: '订单详情' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: '确认完成' }).click();

    await expect(drawer.getByText('已完成').first()).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'SO-201' }).first()).toContainText('已完成');
  });

  test('新建订单弹窗可创建常规草稿订单', async ({ page }) => {
    await page.goto('/sales/order-list');

    await page.getByRole('button', { name: '+ 新建订单' }).click();

    const modal = page.getByRole('dialog', { name: '新建销售订单' });
    await expect(modal).toBeVisible();

    await modal.locator('select').nth(0).selectOption('13');
    await modal.locator('input[type="date"]').nth(0).fill('2026-03-24');
    await modal.locator('input[type="date"]').nth(1).fill('2026-03-31');
    await modal.locator('input[type="checkbox"]').setChecked(true, { force: true });
    await modal.locator('#order-modal-sku-0').fill('休闲椅');
    await page.getByRole('button', { name: /FG-903/ }).click();
    await modal.locator('input[type="number"]').nth(0).fill('5');
    await modal.locator('input[type="number"]').nth(1).fill('700');
    await modal.locator('input[type="checkbox"]').setChecked(false, { force: true });
    await modal.getByRole('button', { name: '创建订单' }).click({ force: true });

    await expect(modal).toHaveCount(0);

    const row = page.locator('tbody tr').filter({ hasText: 'SO-301' }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('华南客户')).toBeVisible();
    await expect(row.getByText('草稿')).toBeVisible();
  });

  test('紧急订单创建后进入待审批', async ({ page }) => {
    await page.goto('/sales/order-list');

    await page.getByRole('button', { name: '+ 新建订单' }).click();

    const modal = page.getByRole('dialog', { name: '新建销售订单' });
    await expect(modal).toBeVisible();

    await modal.locator('select').nth(0).selectOption('11');
    await modal.locator('input[type="date"]').nth(0).fill('2026-03-24');
    await modal.locator('input[type="date"]').nth(1).fill('2026-04-02');
    await modal.locator('input[type="checkbox"]').setChecked(true, { force: true });
    await modal.locator('#order-modal-sku-0').fill('功能沙发');
    await page.getByRole('button', { name: /FG-901/ }).click();
    await modal.locator('input[type="number"]').nth(0).fill('8');
    await modal.locator('input[type="number"]').nth(1).fill('680');
    await modal.getByRole('button', { name: '创建订单' }).click({ force: true });

    await expect(modal).toHaveCount(0);

    const row = page.locator('tbody tr').filter({ hasText: 'SO-301' }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('华北客户')).toBeVisible();
    await expect(row.getByText('待审批')).toBeVisible();
  });

  test('新建订单弹窗的 SKU 检索浮层可正常选中且数量输入保留编辑态', async ({ page }) => {
    await page.goto('/sales/order-list');

    await page.getByRole('button', { name: '+ 新建订单' }).click();

    const modal = page.getByRole('dialog', { name: '新建销售订单' });
    await expect(modal).toBeVisible();

    await modal.locator('select').nth(0).selectOption('11');
    await modal.locator('input[type="date"]').nth(0).fill('2026-03-24');
    await modal.locator('input[type="date"]').nth(1).fill('2026-04-03');

    const skuInput = modal.locator('#order-modal-sku-0');
    await skuInput.fill('功能沙发');
    await expect(page.getByRole('listbox', { name: 'SKU 候选列表' })).toBeVisible();
    await page.getByRole('button', { name: /FG-901/ }).click();

    const qtyInput = modal.getByTestId('modal-line-qty-0');
    await qtyInput.fill('020');
    await expect(qtyInput).toHaveValue('020');

    const priceInput = modal.getByTestId('modal-line-price-0');
    await priceInput.fill('680.50');
    await expect(priceInput).toHaveValue('680.50');

    await expect.poll(() => assessmentCounters.inventoryChecks, { timeout: 5000 }).toBe(1);
    await expect.poll(() => assessmentCounters.capacityChecks, { timeout: 5000 }).toBe(1);

    await modal.getByRole('button', { name: '+ 添加行' }).click();
    await modal.locator('#order-modal-sku-1').fill('休闲椅');
    await page.getByRole('button', { name: /FG-903/ }).click();
    await modal.getByTestId('modal-line-qty-1').fill('4');
    await modal.getByTestId('modal-line-price-1').fill('760');

    await expect.poll(() => assessmentCounters.inventoryChecks, { timeout: 5000 }).toBe(2);
    await expect.poll(() => assessmentCounters.capacityChecks, { timeout: 5000 }).toBe(2);

    await modal.getByTestId('modal-line-qty-1').fill('5');

    await expect.poll(() => assessmentCounters.inventoryChecks, { timeout: 5000 }).toBe(3);
    await expect.poll(() => assessmentCounters.capacityChecks, { timeout: 5000 }).toBe(3);
  });

  test('新建订单页可保存草稿并回到订单列表', async ({ page }) => {
    await page.goto('/sales/orders');

    await page.locator('#customer').selectOption('12');
    await page.locator('#product-search-0').fill('餐椅');
    await page.getByRole('button', { name: /餐椅B/ }).click();
    await page.locator('#qty').fill('6');
    await page.locator('#unitPrice').fill('420');
    await page.locator('#deadline').fill('2026-04-01');
    await page.locator('#notes').fill('门店备货草稿');
    await page.getByRole('button', { name: '保存草稿' }).click();

    await expect(page).toHaveURL(/\/sales\/order-list$/);
    const row = page.locator('tbody tr').filter({ hasText: 'SO-301' }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('华东客户')).toBeVisible();
    await expect(row.getByText('草稿')).toBeVisible();
  });

  test('新建订单页可创建常规订单并自动确认', async ({ page }) => {
    await page.goto('/sales/orders');

    await page.locator('#customer').selectOption('11');
    await page.locator('#product-search-0').fill('功能沙发');
    await page.getByRole('button', { name: /功能沙发A/ }).click();
    await page.locator('#qty').fill('9');
    await page.locator('#unitPrice').fill('680');
    await page.getByRole('button', { name: '+ 添加SKU' }).click();
    await page.locator('#product-search-1').fill('休闲椅');
    await page.getByRole('button', { name: /休闲椅C/ }).click();
    await page.getByTestId('line-qty-1').fill('4');
    await page.getByTestId('line-price-1').fill('760');
    await page.locator('#deadline').fill('2026-04-03');
    await page.locator('#notes').fill('常规订单自动确认');
    await page.getByRole('button', { name: '确认订单' }).click();

    await expect(page).toHaveURL(/\/sales\/order-list$/);
    const row = page.locator('tbody tr').filter({ hasText: 'SO-301' }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('华北客户')).toBeVisible();
    await expect(row.getByText('已确认')).toBeVisible();

    await row.getByRole('button', { name: '查看详情' }).click();
    const drawer = page.getByRole('dialog', { name: '订单详情' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('订单进度', { exact: true })).toBeVisible();
    await expect(drawer.getByText('已确认').first()).toBeVisible();
    await expect(drawer.getByText('休闲椅C')).toBeVisible();
    await expect(drawer.getByRole('button', { name: '触发建工单' })).toBeVisible();
  });

  test('新建订单页可完成紧急插单评估并提交审批', async ({ page }) => {
    await page.addInitScript(() => {
      const originalSetInterval = window.setInterval.bind(window);
      window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
        originalSetInterval(handler, Math.min(Number(timeout ?? 0), 20), ...args)) as typeof window.setInterval;
    });

    await page.goto('/sales/orders');

    await page.locator('#customer').selectOption('13');
    await page.locator('label').filter({ hasText: '紧急插单' }).click();
    await page.locator('#product-search-0').fill('休闲椅');
    await page.getByRole('button', { name: /休闲椅C/ }).click();
    await page.locator('#qty').fill('7');
    await page.locator('#unitPrice').fill('760');
    await page.locator('#deadline').fill('2026-03-29');
    await page.locator('#notes').fill('紧急插单评估链路');

    await page.getByRole('button', { name: '发起影响评估' }).click();

    await expect(page.getByRole('dialog', { name: 'AI 正在评估插单影响…' })).toBeVisible();
    await expect(page.getByText('约束检查结果', { exact: true })).toBeVisible();
    await expect(page.getByText('插单后未来三天产能负荷偏高')).toBeVisible();
    await expect(page.getByRole('button', { name: '提交插单申请' })).toBeVisible();

    await page.getByRole('button', { name: '提交插单申请' }).click();

    await expect(page).toHaveURL(/\/sales\/order-list$/);
    const row = page.locator('tbody tr').filter({ hasText: 'SO-301' }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('华南客户')).toBeVisible();
    await expect(row.getByText('待审批')).toBeVisible();
  });

  test('整单交期评估会复用未变更 SKU 的缓存结果，避免重复请求打满限流', async ({ page }) => {
    await page.goto('/sales/orders');

    await page.locator('#customer').selectOption('11');
    await page.locator('#product-search-0').fill('功能沙发');
    await page.getByRole('button', { name: /功能沙发A/ }).click();
    await page.locator('#qty').fill('9');
    await page.locator('#unitPrice').fill('680');
    await page.getByRole('button', { name: '+ 添加SKU' }).click();
    await page.locator('#product-search-1').fill('餐椅');
    await page.getByRole('button', { name: /餐椅B/ }).click();
    await page.getByTestId('line-qty-1').fill('4');
    await page.getByTestId('line-price-1').fill('420');
    await page.locator('#deadline').fill('2026-04-03');

    await expect.poll(() => assessmentCounters.inventoryChecks, { timeout: 5000 }).toBe(2);
    await expect.poll(() => assessmentCounters.capacityChecks, { timeout: 5000 }).toBe(2);

    await page.getByTestId('line-qty-1').fill('5');

    await expect.poll(() => assessmentCounters.inventoryChecks, { timeout: 5000 }).toBe(3);
    await expect.poll(() => assessmentCounters.capacityChecks, { timeout: 5000 }).toBe(3);
  });
});
