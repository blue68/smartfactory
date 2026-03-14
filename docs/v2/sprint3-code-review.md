# Sprint 3 Code Review 报告

**审查人**：code-reviewer
**审查日期**：2026-03-14
**Sprint 范围**：R-09（采购完整流程）、R-10（销售→生产数据链路）、R-11（采购数据链路闭环）

---

## 一、审查概要

| 维度 | 数值 |
|---|---|
| 审查文件总数 | 19 个（后端 12 + 前端 7） |
| 发现问题总数 | 22 个 |
| Critical | 2 个 |
| High | 6 个 |
| Medium | 9 个 |
| Low | 5 个 |

---

## 二、问题列表

### Critical（阻断级，必须在进入 QA 前修复）

---

#### CR-001 SQL 注入漏洞——批量转 PO 时 supplierId 直接拼接进 SQL

- **文件**：`services/api/src/modules/purchase/purchase-suggestion.service.ts:211`
- **严重程度**：Critical
- **问题描述**

  `batchCreatePOFromSuggestions` 在构造 INSERT 语句时将 `supplierId` 以模板字符串方式直接嵌入 SQL：

  ```typescript
  VALUES (?,?,'${supplierId}','draft',?,?,?,?)
  ```

  `supplierId` 来自数据库查询结果（`suggested_supplier_id`），虽然当前场景下已经过数据库过滤，但绕过了参数化查询的保护机制。若该字段被污染（如在 `purchase_suggestions` 写入阶段已被注入），则可以在此处触发二阶 SQL 注入。此外该写法违反了"所有外部值必须参数化"的团队强制规范，一旦业务逻辑演化极易引发真实漏洞。

- **建议修复**

  将 `supplierId` 改为绑定参数：

  ```typescript
  const poResult = await manager.query(
    `INSERT INTO purchase_orders
       (tenant_id, po_no, supplier_id, status, total_amount, notes, created_by, updated_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      this.tenantId,
      poNo,
      supplierId,          // 参数化传入，不再拼接
      'draft',
      totalAmount.toFixed(2),
      `批量转单，来源建议：${group.map((s) => s.suggestion_no).join(', ')}`,
      this.userId,
      this.userId,
    ],
  );
  ```

---

#### CR-002 幂等保护与并发竞态——submit 在事务外读取 record，事务内未重新加锁

- **文件**：`services/api/src/modules/incoming-inspection/incomingInspection.service.ts:316-384`
- **严重程度**：Critical
- **问题描述**

  `submit()` 方法的流程是：
  1. 在**事务外**查询 `record`（含 `receipt_triggered` / `return_triggered`）；
  2. 开启事务；
  3. 在事务内根据 `record.receipt_triggered` 决定是否执行入库/退货。

  从步骤 1 到步骤 2 之间存在时间窗口。若两个并发请求同时通过步骤 1 的状态检查（均读到 `receipt_triggered = 0`），两个事务将各自执行 `handlePassedItems()`，导致**双重入库**——库存被累加两次，入库单生成两张。

  这是一个资金/库存数据错误，属于 Critical 级别缺陷。

- **建议修复**

  将第一次 record 查询移入事务内部，并使用 `SELECT ... FOR UPDATE` 加行锁：

  ```typescript
  async submit(id: number, params: SubmitInspectionParams): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
      // 加排他锁，防止并发重复提交
      const [record] = await manager.query(
        `SELECT id, status, receipt_triggered, return_triggered, po_id, delivery_note_id
         FROM incoming_inspection_records
         WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [id, this.tenantId],
      );
      if (!record) throw AppError.notFound('质检单不存在', ResponseCode.NOT_FOUND);
      if (['passed', 'failed', 'partially_passed'].includes(record.status)) {
        throw AppError.conflict('质检单已完成提交，禁止重复操作');
      }
      // ... 后续逻辑不变
    });
  }
  ```

---

### High（高优先级，强烈建议进入 QA 前修复）

---

#### CR-003 EventBus 异步 handler 异常无法传播——事务失败时事件已发出，副作用无法回滚

- **文件**：`services/api/src/modules/events/event-bus.service.ts:35`
- **严重程度**：High
- **问题描述**

  `subscribe` 的签名接受 `handler: (...) => void | Promise<void>`，但 `EventEmitter.on()` 对 Promise 返回值没有任何感知。如果某个异步 handler 抛出异常，该异常会变成一个未处理的 Promise rejection，不会被 Express 的 asyncHandler 捕获，也不会回滚已经提交的事务。

  实际风险：若未来在 handler 中执行数据库写操作，出错后会出现"主事务成功提交、副作用 handler 写失败"的数据不一致状态，且 Node 进程层面只会产生 `UnhandledPromiseRejection` 警告而不中断请求。

- **建议修复**

  在 `publish` 方法中捕获并记录异步 handler 的异常，或改造为同步链路：

  ```typescript
  publish(event: BusinessEvent, payload: BusinessEventPayload): void {
    // 捕获异步 handler 的异常，防止 UnhandledPromiseRejection
    const listeners = this.listeners(event);
    for (const listener of listeners) {
      const result = (listener as Function)(payload);
      if (result instanceof Promise) {
        result.catch((err) => {
          console.error(`[EventBus] handler error on event "${event}":`, err);
          // 生产环境接入告警系统
        });
      }
    }
  }
  ```

  长期方案：Sprint 4 引入消息队列（如 BullMQ），彻底分离主事务与副作用。

---

#### CR-004 getShortageReport 触发嵌套事务，每次 HTTP GET 会产生大量写操作

- **文件**：`services/api/src/modules/mrp/mrp.service.ts:261-279`
- **严重程度**：High
- **问题描述**

  `getShortageReport()` 在内部调用 `detectShortage()`，而 `detectShortage()` 会：
  1. 开启数据库事务；
  2. 对每一条 `material_requirements` 记录执行 `UPDATE`；
  3. 对 `production_orders` 执行 `UPDATE`。

  这意味着每一次 `GET /mrp/shortage-report/:id` 的 HTTP 请求都会触发数据写操作，这违反了 HTTP GET 的幂等/只读语义，也会造成高频查询场景下的数据库写压力。

  此外，`getShortageReport` 先查询 order 信息，再调用 `detectShortage`（内部又查一次 order），产生重复查询。

- **建议修复**

  将 `getShortageReport` 改为只读查询，从数据库直接读取已有的 `material_requirements` 状态，不触发写操作。另提供单独的 `POST /mrp/detect-shortage/:id` 端点供主动刷新时调用：

  ```typescript
  async getShortageReport(productionOrderId: number): Promise<ShortageReportResult> {
    // 仅读取，不触发检测写操作
    const [order] = await AppDataSource.query(...);
    if (!order) throw AppError.notFound(...);
    const shortageItems = await this._readCurrentShortageItems(productionOrderId);
    return { productionOrderId, workOrderNo: order.work_order_no, materialStatus: order.material_status, items: shortageItems };
  }
  ```

---

#### CR-005 全局缺料汇总存在 N+1 查询问题

- **文件**：`services/api/src/modules/mrp/mrp.service.ts:348-382`
- **严重程度**：High
- **问题描述**

  `getGlobalShortageSummary()` 在查出 `aggregateRows`（N 条 SKU 记录）后，对每一条 SKU 执行一次独立的 inventory 查询：

  ```typescript
  const list = await Promise.all(
    aggregateRows.map(async (row) => {
      const [inv] = await AppDataSource.query(
        `SELECT ... FROM inventory WHERE sku_id = ? AND tenant_id = ? LIMIT 1`,
        [row.sku_id, this.tenantId],
      );
      ...
    }),
  );
  ```

  当缺料 SKU 数量为 N 时，产生 1（聚合查询）+ N（库存查询）次数据库 IO，在 N=50 时即为 51 次串行/并行查询。`Promise.all` 虽然并发执行，但仍会对数据库连接池造成突发冲击。

- **建议修复**

  将 inventory 查询合并到主 SQL，用 LEFT JOIN 或 IN 子查询一次取出所有 SKU 的库存：

  ```sql
  SELECT
    mr.sku_id, s.sku_code, s.name AS sku_name, s.stock_unit,
    SUM(mr.qty_required) AS total_qty_required,
    SUM(mr.qty_shortage) AS total_qty_shortage,
    COUNT(DISTINCT mr.production_order_id) AS affected_order_count,
    GROUP_CONCAT(DISTINCT mr.production_order_id ORDER BY mr.production_order_id) AS order_ids,
    COALESCE(inv.qty_on_hand, 0) AS qty_on_hand,
    COALESCE(inv.qty_reserved, 0) AS qty_reserved,
    COALESCE(inv.qty_in_transit, 0) AS qty_in_transit
  FROM material_requirements mr
  INNER JOIN production_orders po ON ...
  INNER JOIN skus s ON ...
  LEFT JOIN inventory inv ON inv.sku_id = mr.sku_id AND inv.tenant_id = mr.tenant_id
  WHERE ${where}
  GROUP BY mr.sku_id, s.sku_code, s.name, s.stock_unit,
           inv.qty_on_hand, inv.qty_reserved, inv.qty_in_transit
  ```

---

#### CR-006 BOM 快照编号生成存在碰撞风险（所有编号生成器通病）

- **文件**：
  - `services/api/src/modules/incoming-inspection/incomingInspection.service.ts:9-29`
  - `services/api/src/modules/return-order/returnOrder.service.ts:9-18`
  - `services/api/src/modules/production/bom-snapshot.service.ts:91-92`
  - `services/api/src/modules/production/production-order.service.ts:184-191`
  - `services/api/src/modules/production/workflow-engine.service.ts:130-134`
- **严重程度**：High
- **问题描述**

  上述文件均使用 `Math.random() * 9999` 生成 4 位随机数作为编号后缀，格式如 `IQC-20260314-0731`。在同一天高并发场景下（如批量质检），两次调用极有可能生成相同编号，而表中若有 `UNIQUE` 约束则 INSERT 直接报错，若无约束则产生重复编号，影响业务单据追溯。

  同时注意：`generateNo` 工具函数（在 mrp.service 和 purchase-suggestion.service 中使用）相对安全，但本地实现的函数没有使用该统一方案，存在规范不一致。

- **建议修复**

  统一使用已有的 `generateNo('xxx', tenantId)` 工具函数，或改用数据库自增序列：

  ```typescript
  // 替换所有本地 generateXxxNo() 调用
  const inspectionNo = await generateNo('inspection', this.tenantId);
  const receiptNo    = await generateNo('receipt', this.tenantId);
  const snapshotNo   = await generateNo('bom_snapshot', this.tenantId);
  const workOrderNo  = await generateNo('work_order', this.tenantId);
  ```

---

#### CR-007 mrp/reevaluate 路由缺少权限控制

- **文件**：`services/api/src/modules/mrp/mrp.routes.ts:30-33`
- **严重程度**：High
- **问题描述**

  `POST /api/mrp/reevaluate` 端点注册时**未附加 `requireRoles`**，仅有 `authMiddleware`（登录验证）保护。任何登录用户均可调用该接口，触发对所有涉及指定 SKU 的工单进行批量 `UPDATE` 操作（更新 `material_requirements` 和 `production_orders`），存在业务数据被非授权用户篡改的风险。

- **建议修复**

  添加角色限制，与 `generate-suggestions` 保持一致：

  ```typescript
  router.post(
    '/reevaluate',
    requireRoles('purchase', 'supervisor', 'boss'),
    asyncHandler(mrpController.reevaluateAfterReceipt.bind(mrpController)),
  );
  ```

---

#### CR-008 ReturnOrderPage 操作按钮缺少 loading/禁用状态，可被重复点击

- **文件**：`services/web/src/pages/purchase/ReturnOrderPage.tsx:92-101`
- **严重程度**：High
- **问题描述**

  确认、发出、完成三个操作按钮在用户点击后没有任何防抖/禁用保护：

  ```tsx
  {r.status === 'draft' && (
    <Button size="sm" onClick={() => handleConfirm(r.id)}>确认</Button>
  )}
  {r.status === 'confirmed' && (
    <Button size="sm" onClick={() => handleShip(r.id)}>发出</Button>
  )}
  ```

  `useMutation` 的 `isPending` 状态完全未被消费。用户快速双击可在后端接收到两次相同请求。虽然后端 `findAndValidate` 有状态校验，但第一次请求完成状态变更后，列表未立即刷新（`invalidateQueries` 是异步的），用户仍能看到旧状态的按钮并再次点击。

- **建议修复**

  ```tsx
  {r.status === 'draft' && (
    <Button
      size="sm"
      loading={confirmReturn.isPending && confirmReturn.variables === r.id}
      disabled={confirmReturn.isPending}
      onClick={() => handleConfirm(r.id)}
    >
      确认
    </Button>
  )}
  ```

---

### Medium（中等优先级，应在当前 Sprint 结束前修复）

---

#### CR-009 IncomingInspectionPage 使用硬编码 Mock 数据作为 API 降级 Fallback

- **文件**：`services/web/src/pages/purchase/IncomingInspectionPage.tsx:84-186, 259-261`
- **严重程度**：Medium
- **问题描述**

  页面中内置了 `MOCK_INSPECTIONS` 和 `MOCK_ITEMS` 常量，并在 API 返回空列表时直接回退展示 Mock 数据：

  ```typescript
  const allRows = (data?.list && data.list.length > 0)
    ? (data.list as InspectionRow[])
    : MOCK_INSPECTIONS;
  ```

  这一逻辑会在以下场景引发严重误导：
  1. 生产环境数据库中确实没有数据时，用户看到假数据；
  2. API 请求失败时，用户无法感知服务异常；
  3. QA 测试时可能误将 Mock 数据当作真实 API 响应，导致测试结论无效。

- **建议修复**

  删除 Mock 数据常量，改为标准空状态 UI：

  ```typescript
  const allRows = (data?.list ?? []) as InspectionRow[];
  // Table 组件的 emptyText 属性已支持空状态显示
  ```

---

#### CR-010 前端 `CreateInspectionPayload` 包含 `inspectorId` 字段，与后端接口不一致

- **文件**：
  - `services/web/src/api/incomingInspection.ts:50-56`（前端 type）
  - `services/api/src/modules/incoming-inspection/incomingInspection.controller.ts:9-14`（后端 schema）
- **严重程度**：Medium
- **问题描述**

  前端类型定义 `CreateInspectionPayload` 包含 `inspectorId: number` 字段，而后端 `CreateInspectionSchema` 完全没有该字段（inspector_id 在后端通过 `ctx.userId` 注入）。前端在表单中还设置了 `inspectorId: '1'` 的默认值并传给 API。

  这意味着：
  - 前端传递的 `inspectorId` 字段被后端 Zod 静默丢弃；
  - 质检人员始终是请求发起者，无法指定他人，但表单 UI 暗示了可以设置；
  - 前后端 API 契约存在理解偏差。

- **建议修复**

  统一处理：若业务上允许指定质检员，后端接受 `inspectorId` 并覆盖默认值；若不允许，则删除前端 `CreateInspectionPayload` 中的该字段并移除表单输入项。

---

#### CR-011 mrp.ts 前端 API 与后端接口契约不匹配

- **文件**：`services/web/src/api/mrp.ts`
- **严重程度**：Medium
- **问题描述**

  多处前后端契约不一致：

  1. **`generateSuggestions`**：前端发送 `{ productionOrderIds?: number[] }`（复数），后端接受 `{ productionOrderId?: number }`（单数，第 19 行）；
  2. **`reevaluate`**：前端发送 `{ receiptId: number; skuIds?: number[] }`，后端接受 `{ skuId: number }`（单数）；
  3. **`ShortageSummary`**：前端类型期望 `{ items: ShortageSummaryItem[] }`，后端实际返回 `{ list: GlobalShortageItem[]; total: number }`，字段名完全不同。

  `ShortageBoard.tsx` 中 `summaryData?.items` 将在运行时拿到 `undefined`，导致看板渲染为空。

- **建议修复**

  以后端实际响应结构为准，修正前端类型和 API 调用：

  ```typescript
  // mrp.ts
  getShortageSummary: () =>
    request.get<{ list: GlobalShortageItem[]; total: number }>('/api/mrp/shortage-summary'),

  // ShortageBoard.tsx
  const items = summaryData?.list ?? [];
  ```

---

#### CR-012 PurchaseSuggestionPage 使用了错误的 API 路径，与后端路由不匹配

- **文件**：
  - `services/web/src/api/purchaseSuggestion.ts:83,86,89,92`
  - `services/api/src/modules/purchase/purchaseSuggestion.routes.ts`
- **严重程度**：Medium
- **问题描述**

  前端 `purchaseSuggestionApi` 调用的路径为 `/api/purchase-suggestions`（带连字符），而后端 `purchaseSuggestion.routes.ts` 实际注册的根路径需要查看 `app.ts` 挂载点才能确认，但文件注释已明确写到"与旧版 `/api/purchase/suggestions` 并行"，存在路径不确定性。

  此外前端 `PurchaseSuggestionPage.tsx` 使用了 `usePurchaseSuggestionList` / `useApprovePurchaseSuggestion`（来自 `purchaseSuggestion.ts`），而同页面的 `SuggestionRow` 接口字段使用下划线命名（`suggestion_no`, `sku_code`），与 `purchaseSuggestion.ts` 中的驼峰命名 `PurchaseSuggestionV2` 不一致，导致列渲染不匹配。

- **建议修复**

  统一命名风格，确认路由挂载路径，并确保 `SuggestionRow` 与实际 API 响应字段一致。

---

#### CR-013 `incomingInspection.service.ts` 中 `qtysampled` 字段命名不规范

- **文件**：`services/api/src/modules/incoming-inspection/incomingInspection.service.ts:52`
- **严重程度**：Medium
- **问题描述**

  `UpdateInspectionItemInput` 接口中存在 `qtysampled`（全小写，无驼峰），与同接口的 `qtyPassed`、`qtyFailed` 命名风格不一致，违反团队驼峰命名规范。

  ```typescript
  export interface UpdateInspectionItemInput {
    id: number;
    qtysampled: string;   // 不规范
    qtyPassed: string;    // 规范
    qtyFailed: string;    // 规范
  ```

  该错误已从 service 接口传播至 controller Zod schema（第 18 行 `qtysampled`）。

- **建议修复**

  统一改为 `qtySampled`（首字母大写），同步修改 controller schema、service 方法内的 SQL 绑定参数引用。

---

#### CR-014 `cancel()` 方法取消工单后未释放已存在的采购建议关联

- **文件**：`services/api/src/modules/production/production-order.service.ts:463-529`
- **严重程度**：Medium
- **问题描述**

  工单取消时，`material_requirements.suggestion_id` 字段的关联关系未被清理，也没有将对应 `purchase_suggestions` 状态置回或标记为无效。这会导致：
  - 已生成的采购建议仍然有效，可以被审批并转 PO；
  - 但对应工单已取消，该物料需求实际上已不存在；
  - 采购人员无法从建议中得知工单已取消，可能产生多余采购。

- **建议修复**

  在取消工单的事务内，将该工单关联的 pending 采购建议状态置为 `expired`，并清除 `material_requirements.suggestion_id`：

  ```typescript
  // 在 cancel() 事务末尾追加
  await manager.query(
    `UPDATE purchase_suggestions
     SET status = 'expired', updated_by = ?, updated_at = NOW()
     WHERE production_order_id = ? AND tenant_id = ? AND status IN ('pending', 'approved')`,
    [this.userId, id, this.tenantId],
  );
  ```

---

#### CR-015 `checkMaterialStatus()` 在 GET 语义接口中写数据库，与 `detectShortage` 逻辑重复

- **文件**：`services/api/src/modules/production/production-order.service.ts:562-668`
- **严重程度**：Medium
- **问题描述**

  `checkMaterialStatus()` 在最后执行了 `UPDATE production_orders SET material_status = ?`（第 661 行），与 `MrpService.detectShortage()` 职责重叠，系统中存在两套计算物料状态的逻辑，维护时容易产生分歧。同时 `GET /production/orders/:id/material-check` 再次违反了 GET 接口只读的设计原则。

- **建议修复**

  将物料状态更新统一收归 `MrpService.detectShortage()`，`checkMaterialStatus()` 委托调用该方法，或只做只读计算，不写数据库：

  ```typescript
  async checkMaterialStatus(id: number) {
    // 委托给 MrpService，保持单一数据源
    const mrpSvc = new MrpService({ tenantId: this.tenantId, userId: this.userId });
    return mrpSvc.detectShortage(id);
  }
  ```

---

#### CR-016 `workflow-engine.service.ts` 半成品入库的单位硬编码为 '件'

- **文件**：`services/api/src/modules/production/workflow-engine.service.ts:143`
- **严重程度**：Medium
- **问题描述**

  `_handleSemiFinishedInventory` 在写入 `inventory_transactions` 时，`input_unit` 和 `stock_unit` 均硬编码为 `'件'`，完全忽略了 SKU 实际的库存单位（`stock_unit` 字段）：

  ```typescript
  VALUES (?, ?, ?, 'PRODUCTION_IN', 'IN', ?, '件', ?, '件', ...)
  ```

  若生产的半成品单位为 kg、m、套 等，则流水记录单位错误，影响库存账务准确性。

- **建议修复**

  在执行前查询 SKU 的 `stock_unit`，并替换硬编码值：

  ```typescript
  const [sku] = await manager.query(
    `SELECT stock_unit FROM skus WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [outputSkuId, this.tenantId],
  );
  const stockUnit = sku?.stock_unit ?? '件';
  // 使用 stockUnit 代替硬编码 '件'
  ```

---

#### CR-017 `bom-snapshot.service.ts` getSnapshotItems 反序列化无错误处理

- **文件**：`services/api/src/modules/production/bom-snapshot.service.ts:130`
- **严重程度**：Medium
- **问题描述**

  `getSnapshotItems()` 直接对数据库字段执行 `JSON.parse()`，若 `snapshot_data` 字段存储的是非法 JSON（数据库写入异常或手动修改），将导致未捕获的 `SyntaxError` 向上传播，最终响应 500，且日志无法定位到具体 snapshotId：

  ```typescript
  return JSON.parse(rows[0].snapshot_data) as ExpandedMaterial[];
  ```

- **建议修复**

  ```typescript
  try {
    return JSON.parse(rows[0].snapshot_data) as ExpandedMaterial[];
  } catch (e) {
    throw AppError.internal(`BOM 快照数据损坏（snapshotId=${snapshotId}）`);
  }
  ```

---

### Low（低优先级，建议在 Sprint 4 前处理）

---

#### CR-018 `ShortageBoard.tsx` 字段名 `totalShortageQty` 与 API 类型 `totalQtyShortage` 不一致

- **文件**：
  - `services/web/src/pages/production/ShortageBoard.tsx:24`
  - `services/web/src/api/mrp.ts:36`
- **严重程度**：Low
- **问题描述**

  `ShortageBoard.tsx` 中引用 `item.totalShortageQty`，但 `ShortageSummaryItem` 类型定义的字段名为 `totalShortageQty`（前端类型）。然而后端 `getGlobalShortageSummary` 返回的实际字段名为 `totalQtyShortage`（参见 mrp.service.ts:376）。三处命名不统一，运行时字段取值为 `undefined`。

- **建议修复**

  以后端字段名 `totalQtyShortage` 为准，统一前端类型和页面引用。

---

#### CR-019 `ProductionOrderPage.tsx` 关键词搜索仅做前端过滤，未与后端联动

- **文件**：`services/web/src/pages/production/ProductionOrderPage.tsx:148-149, 263-272`
- **严重程度**：Low
- **问题描述**

  `keyword` 状态只用于前端对已加载列表的过滤（`allRows.filter(...)`），未传递给 `useProductionOrderList` 的查询参数。当列表数据超过一页时，关键词搜索只能在当前页范围内生效，用户会误以为搜索覆盖全量数据。

- **建议修复**

  将 `keyword` 作为防抖后的查询参数传入 hook，或明确在 UI 上标注"仅当页搜索"。

---

#### CR-020 多处使用 `(req as any).tenantId` 类型断言，应使用类型扩展

- **文件**：
  - `services/api/src/modules/incoming-inspection/incomingInspection.controller.ts:52`
  - `services/api/src/modules/return-order/returnOrder.controller.ts:39`
  - `services/api/src/modules/purchase/purchaseSuggestion.controller.ts:16,31,38,46`
- **严重程度**：Low
- **问题描述**

  `purchaseSuggestion.controller.ts` 全面使用 `(req as any).tenantId`，而同 Sprint 的 `mrp.controller.ts` 和 `production-order.controller.ts` 已经正确使用 `req.tenantId`（依赖 Express Request 类型扩展）。命名风格不一致，`as any` 会跳过 TypeScript 类型检查，降低代码健壮性。

- **建议修复**

  全部改为 `req.tenantId`，依赖已有的 `express.d.ts` 类型扩展。若不存在该扩展，补充声明：

  ```typescript
  // src/types/express.d.ts
  declare namespace Express {
    interface Request {
      tenantId: number;
      userId: number;
    }
  }
  ```

---

#### CR-021 `ReturnOrderPage.tsx` 无创建退货单入口

- **文件**：`services/web/src/pages/purchase/ReturnOrderPage.tsx`
- **严重程度**：Low
- **问题描述**

  页面仅提供退货单的状态流转操作（确认/发出/完成），没有"手动创建退货单"的按钮，而后端 `POST /api/return-orders` 接口已完整实现。用户只能通过质检单自动触发退货，无法手动创建，与后端能力不对等。

- **建议修复**

  添加"新建退货单"按钮，复用 `useCreateReturnOrder` hook，补充创建表单 Modal。

---

#### CR-022 `mrp.routes.ts` 缺失路由文件注释中文内容存在韩语注释混入

- **文件**：`services/api/src/modules/mrp/mrp.service.ts:8`
- **严重程度**：Low
- **问题描述**

  文件第 8 行出现韩语注释 `// ─── 내부 타입 정의 ──`，与项目中文注释规范不符，明显是代码生成工具产生的遗留问题。

- **建议修复**

  改为中文：`// ─── 内部类型定义 ──`

---

## 三、架构评价

### 整体评分：7.5 / 10

**优点**

1. **模块职责清晰**：Service / Controller / Routes 三层分离执行良好，业务逻辑集中在 Service 层，Controller 只做参数解析和格式化，Routes 只做路由注册和权限声明，架构分层执行到位。

2. **事务安全意识良好**：绝大部分跨表写操作（质检提交、批量转 PO、BOM 快照创建、工单创建）均在 `AppDataSource.transaction()` 内完成，原子性有保障。CR-002 是少数例外。

3. **BD-001 BOM 快照锁定逻辑正确**：`BomSnapshotService.createSnapshot()` 在工单创建事务内生成 SHA-256 hash 进行去重，展开后的物料清单永久冻结在 `bom_version_snapshots.snapshot_data` 中，工单生产过程中 BOM 变更不会影响进行中的工单，业务规则实现正确。

4. **BD-004 不合格品退货规则实现正确**：`handleFailedItems()` 严格限定仅处理 `disposition === 'return'` 的明细，`receipt_triggered` / `return_triggered` 幂等位防止重复触发，业务规则实现正确（尽管有 CR-002 的并发漏洞）。

5. **参数校验使用 Zod**：所有接口入参均使用 Zod schema 进行校验，类型安全。`PaginationSchema` 复用，`coerce` 类型转换规范。

6. **Decimal.js 精确计算**：数量和金额全部使用 `Decimal.js`，无浮点精度问题。

7. **前端 React Query 使用规范**：`queryKey` 分层合理，`invalidateQueries` 覆盖正确，`enabled` 条件控制准确，`staleTime` 和 `refetchInterval` 按场景配置。

**不足**

1. 编号生成器逻辑重复实现 5 次，未统一使用 `generateNo` 工具（CR-006）；
2. 物料状态计算逻辑存在两套实现（`ProductionOrderService.checkMaterialStatus` 和 `MrpService.detectShortage`），维护风险高（CR-015）；
3. `EventBus` 的设计无法保证副作用与主事务的一致性（CR-003），需要在 Sprint 4 引入消息队列根治；
4. 前后端 API 契约有多处偏差，缺乏自动化契约测试（Zod schema 与前端 TypeScript types 未共享）。

---

## 四、安全评价

### 整体评分：7 / 10

| 检查项 | 状态 | 说明 |
|---|---|---|
| SQL 注入（参数化查询） | 部分通过 | 99% 使用占位符 `?`，但 CR-001 存在字符串拼接漏洞 |
| XSS 防护 | 通过 | 后端无 HTML 输出，前端 React 自动转义，无 `dangerouslySetInnerHTML` |
| 权限控制（路由层） | 部分通过 | 绝大部分接口有 `requireRoles`，但 `POST /mrp/reevaluate` 缺失（CR-007） |
| 权限控制（数据层） | 通过 | 所有 SQL 查询均携带 `tenant_id = ?` 条件，多租户隔离正确 |
| 幂等性防重 | 部分通过 | `receipt_triggered` / `return_triggered` 位设计良好，但并发窗口未加锁（CR-002） |
| 敏感字段暴露 | 通过 | 响应中未包含密码、token 等敏感信息 |
| 输入验证 | 通过 | Zod 全覆盖，日期格式、数量格式均有正则校验 |
| CSRF | 需确认 | 未在本次审查范围内，应确认 `authMiddleware` 是否有 CSRF 防护 |

**重点风险**：CR-001（SQL 注入）和 CR-002（并发竞态导致双重入库）是安全性和数据完整性的核心风险，必须在进入 QA 前修复。

---

## 五、整体结论

### 当前状态：**暂不建议进入 QA 阶段**

需要满足以下条件后方可进入 QA：

#### 阻断项（必须修复，否则 QA 无法开展）

| 编号 | 问题 | 负责模块 |
|---|---|---|
| CR-001 | SQL 注入漏洞——supplierId 字符串拼接 | 后端 purchase |
| CR-002 | submit 并发竞态导致双重入库 | 后端 incoming-inspection |
| CR-011 | 前后端 API 契约不匹配，ShortageBoard 渲染为空 | 前端 mrp + 后端 mrp |

#### 强烈建议修复项（影响 QA 测试准确性）

| 编号 | 问题 |
|---|---|
| CR-007 | `/mrp/reevaluate` 缺少权限控制 |
| CR-008 | ReturnOrderPage 操作按钮无防重复点击保护 |
| CR-009 | IncomingInspectionPage 生产环境使用 Mock 数据 |
| CR-012 | PurchaseSuggestionPage API 路径与字段命名不一致 |
| CR-013 | `qtysampled` 命名不规范（接口契约层面错误） |

#### 建议在 QA 阶段并行修复的项

CR-003、CR-004、CR-005、CR-006、CR-014、CR-015、CR-016、CR-017

---

**修复 CR-001、CR-002、CR-011 并完成 QA 环境重新部署后，可开启 QA 回归测试。**

---

*本报告由 code-reviewer 角色基于源代码静态分析生成，不替代 QA 功能验收和安全渗透测试。*
