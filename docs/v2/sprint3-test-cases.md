# Sprint 3 测试用例文档

> **文档版本**: v1.0
> **编写日期**: 2026-03-14
> **负责人**: senior-qa-engineer
> **覆盖范围**: R-09 采购完整流程 / R-10 销售→生产数据链路 / R-11 采购数据链路闭环
> **业务规则**: BD-001 BOM版本快照锁定 / BD-004 不合格品仅允许退货

---

## 目录

1. [R-09 来料质检模块测试用例](#r-09-来料质检模块测试用例)
2. [R-09 退货单模块测试用例](#r-09-退货单模块测试用例)
3. [R-10 销售→生产数据链路测试用例](#r-10-销售生产数据链路测试用例)
4. [R-11 采购数据链路闭环测试用例](#r-11-采购数据链路闭环测试用例)
5. [业务规则专项测试](#业务规则专项测试)
6. [状态机测试](#状态机测试)
7. [事务完整性测试](#事务完整性测试)
8. [前端UI交互测试](#前端ui交互测试)
9. [测试报告模板](#测试报告模板)
10. [上线风险评估](#上线风险评估)

---

## R-09 来料质检模块测试用例

### 功能测试（正常流程）

---

**TC-IQC-001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-IQC-001 |
| 测试标题 | 正常创建来料质检单 |
| 优先级 | P0 |
| 前置条件 | 存在已确认采购订单 PO-001（poId=1），该 PO 下存在送货单 DN-001（deliveryNoteId=1），送货单包含 2 条明细行，且该送货单尚未关联质检单 |
| 测试步骤 | 1. POST /api/incoming-inspections，body: {"poId":1,"deliveryNoteId":1,"inspectionDate":"2026-03-14"} <br> 2. 检查响应 |
| 预期结果 | HTTP 201；返回 {"code":0,"data":{"id":N,"inspectionNo":"IQC-YYYYMMDD-XXXX"}}；数据库 incoming_inspection_records 新增一条 status=draft 记录；incoming_inspection_items 自动生成 2 条明细行，qty_sampled/qty_passed/qty_failed 均为 0，disposition 默认为 accept；delivery_notes.inspection_id 更新为新建记录的 id |

---

**TC-IQC-002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-IQC-002 |
| 测试标题 | 录入质检明细（逐行更新） |
| 优先级 | P0 |
| 前置条件 | 已存在 status=draft 的质检单 IQC-001（id=1），含 2 条质检明细（itemId=1,2） |
| 测试步骤 | 1. PUT /api/incoming-inspections/1/items，body: {"items":[{"id":1,"qtysampled":"10","qtyPassed":"10","qtyFailed":"0","result":"pass","disposition":"accept"},{"id":2,"qtysampled":"5","qtyPassed":"4","qtyFailed":"1","result":"fail","disposition":"return"}]} <br> 2. 查询质检单详情 GET /api/incoming-inspections/1 |
| 预期结果 | HTTP 200；质检单 status 更新为 in_progress；两条明细的 qty_sampled/qty_passed/qty_failed/result/disposition 均按入参正确更新 |

---

**TC-IQC-003**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-IQC-003 |
| 测试标题 | 全部合格品提交质检结论 — 自动触发入库 |
| 优先级 | P0 |
| 前置条件 | 质检单 IQC-001（id=1）status=in_progress，所有明细 result=pass，qty_passed>0，receipt_triggered=0 |
| 测试步骤 | 1. POST /api/incoming-inspections/1/submit，body: {"overallResult":"pass"} <br> 2. 查询 purchase_receipts 表 <br> 3. 查询 inventory_transactions 表 <br> 4. 查询 inventory 表 |
| 预期结果 | HTTP 200；质检单 status=passed，overall_result=pass，completed_at 有值，receipt_triggered=1；purchase_receipts 新增一条 status=confirmed 记录；inventory_transactions 新增 transaction_type=PURCHASE_IN 流水；inventory.qty_on_hand 增加对应合格品数量；purchase_order_items.qty_received 和 qty_passed 相应增加 |

---

**TC-IQC-004**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-IQC-004 |
| 测试标题 | 全部不合格品提交质检结论 — 自动触发退货（BD-004） |
| 优先级 | P0 |
| 前置条件 | 质检单 IQC-002（id=2）status=in_progress，所有明细 result=fail，disposition=return，qty_failed>0，return_triggered=0 |
| 测试步骤 | 1. POST /api/incoming-inspections/2/submit，body: {"overallResult":"fail"} <br> 2. 查询 return_orders 表 <br> 3. 查询 return_order_items 表 |
| 预期结果 | HTTP 200；质检单 status=failed，return_triggered=1；return_orders 新增一条 status=confirmed，return_type=purchase_return，return_reason 包含"BD-004"的记录；return_order_items 行数与不合格明细数一致；purchase_order_items.qty_rejected 相应增加；不创建任何入库单（purchase_receipts 无新增记录） |

---

**TC-IQC-005**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-IQC-005 |
| 测试标题 | 部分合格品提交质检结论 — 同时触发入库和退货 |
| 优先级 | P0 |
| 前置条件 | 质检单 IQC-003（id=3）status=in_progress，含 2 条明细：明细1 result=pass qty_passed=8；明细2 result=fail disposition=return qty_failed=2 |
| 测试步骤 | 1. POST /api/incoming-inspections/3/submit，body: {"overallResult":"conditional_pass"} <br> 2. 查询 purchase_receipts 和 return_orders |
| 预期结果 | HTTP 200；质检单 status=partially_passed；purchase_receipts 新增入库单（含明细1的合格数量）；return_orders 新增退货单（含明细2的不合格数量）；receipt_triggered=1，return_triggered=1 |

---

**TC-IQC-006**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-IQC-006 |
| 测试标题 | 预览入库单 |
| 优先级 | P1 |
| 前置条件 | 质检单 IQC-003（id=3）status=in_progress，含合格品明细，unit_price 有值 |
| 测试步骤 | GET /api/incoming-inspections/3/preview-receipt |
| 预期结果 | HTTP 200；返回 items 列表仅含 qty_passed>0 的行；totalAmount = sum(qty_passed * unit_price)，精度保留 2 位小数；receiptTriggered 字段正确反映当前状态 |

---

**TC-IQC-007**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-IQC-007 |
| 测试标题 | 分页查询质检单列表 — 多条件筛选 |
| 优先级 | P1 |
| 前置条件 | 数据库存在 status=passed、failed、in_progress 的质检单各若干条 |
| 测试步骤 | GET /api/incoming-inspections?status=passed&dateFrom=2026-03-01&dateTo=2026-03-31&page=1&pageSize=10 |
| 预期结果 | 返回 list 仅包含 status=passed 且 inspection_date 在 3 月内的记录；total 与实际数量一致；每条记录包含 poNo、supplierName、deliveryNo、inspectorName 联查字段 |

---

### 边界测试

---

**TC-IQC-B001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-IQC-B001 |
| 测试标题 | 质检单编号格式校验（IQC-YYYYMMDD-NNNN） |
| 优先级 | P1 |
| 前置条件 | 有效的 poId 和 deliveryNoteId |
| 测试步骤 | 调用创建质检单接口 10 次，收集返回的 inspectionNo |
| 预期结果 | 所有编号均符合正则 /^IQC-\d{8}-\d{4}$/；10 次调用中随机部分（NNNN）范围在 0000-9999；编号不重复（概率极大） |

---

**TC-IQC-B002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-IQC-B002 |
| 测试标题 | qty_passed + qty_failed 等于 qty_delivered 边界验证 |
| 优先级 | P1 |
| 前置条件 | 质检单 draft 状态，明细行 qty_delivered=100 |
| 测试步骤 | 1. 更新明细：qtysampled=100，qtyPassed=50，qtyFailed=50（等于 qty_delivered）<br> 2. 更新明细：qtysampled=100，qtyPassed=60，qtyFailed=50（超过 qty_delivered）|
| 预期结果 | 步骤1 HTTP 200 正常更新（注意：当前后端未做 passed+failed<=delivered 校验，属于潜在缺陷，记录到缺陷列表）；步骤2 同样返回 200（确认当前行为，评估是否需要新增业务校验） |

---

**TC-IQC-B003**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-IQC-B003 |
| 测试标题 | 数量字段精度边界（4位小数） |
| 优先级 | P1 |
| 前置条件 | 质检单 draft 状态 |
| 测试步骤 | 更新明细 qtysampled="10.1234"，qtyPassed="10.1234"，qtyFailed="0.0000" |
| 预期结果 | HTTP 200；明细记录正确存储 4 位小数精度的数量值 |

---

**TC-IQC-B004**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-IQC-B004 |
| 测试标题 | notes 最大字符长度边界（500字符） |
| 优先级 | P2 |
| 前置条件 | 有效的质检单创建参数 |
| 测试步骤 | 1. notes 填入 500 个字符的字符串，调用创建接口 <br> 2. notes 填入 501 个字符的字符串，调用创建接口 |
| 预期结果 | 步骤1 HTTP 201 成功；步骤2 HTTP 400，Zod 校验错误提示 |

---

### 异常测试

---

**TC-IQC-E001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-IQC-E001 |
| 测试标题 | 重复创建质检单（同一送货单） |
| 优先级 | P0 |
| 前置条件 | delivery_note_id=1 已存在质检单 |
| 测试步骤 | POST /api/incoming-inspections，body 与已创建的质检单相同（deliveryNoteId=1） |
| 预期结果 | HTTP 409；响应 message 含"已存在质检单"；数据库无新增记录 |

---

**TC-IQC-E002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-IQC-E002 |
| 测试标题 | 送货单不属于指定采购订单 |
| 优先级 | P0 |
| 前置条件 | PO-001 下的 DN-001 存在，PO-002 与 DN-001 不关联 |
| 测试步骤 | POST /api/incoming-inspections，body: {"poId":2,"deliveryNoteId":1,...} |
| 预期结果 | HTTP 400；响应 message 含"送货单不属于该采购订单" |

---

**TC-IQC-E003**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-IQC-E003 |
| 测试标题 | 对已完成质检单重复提交 |
| 优先级 | P0 |
| 前置条件 | 质检单 id=1，status=passed |
| 测试步骤 | POST /api/incoming-inspections/1/submit，body: {"overallResult":"pass"} |
| 预期结果 | HTTP 409；响应 message 含"已完成提交，禁止重复操作"；幂等位保护：receipt_triggered/return_triggered 不重复触发，inventory 不重复增加 |

---

**TC-IQC-E004**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-IQC-E004 |
| 测试标题 | 对已完成质检单修改明细 |
| 优先级 | P0 |
| 前置条件 | 质检单 id=1，status=passed |
| 测试步骤 | PUT /api/incoming-inspections/1/items，body: 任意明细更新数据 |
| 预期结果 | HTTP 409；响应 message 含"已提交，无法修改明细" |

---

**TC-IQC-E005**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-IQC-E005 |
| 测试标题 | 质检单无明细直接提交 |
| 优先级 | P1 |
| 前置条件 | 质检单 id=9 status=draft，incoming_inspection_items 表该 inspection_id 无记录（构造异常数据） |
| 测试步骤 | POST /api/incoming-inspections/9/submit，body: {"overallResult":"pass"} |
| 预期结果 | HTTP 400；响应 message 含"无明细，请先录入质检结果" |

---

**TC-IQC-E006**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-IQC-E006 |
| 测试标题 | 查询不存在的质检单 |
| 优先级 | P1 |
| 前置条件 | id=99999 的质检单不存在 |
| 测试步骤 | GET /api/incoming-inspections/99999 |
| 预期结果 | HTTP 404；响应 message 含"质检单不存在" |

---

**TC-IQC-E007**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-IQC-E007 |
| 测试标题 | 请求参数 Zod 校验失败 — inspectionDate 格式错误 |
| 优先级 | P1 |
| 前置条件 | 无 |
| 测试步骤 | POST /api/incoming-inspections，body: {"poId":1,"deliveryNoteId":1,"inspectionDate":"2026/03/14"} |
| 预期结果 | HTTP 400；Zod 报错提示日期格式须为 YYYY-MM-DD |

---

**TC-IQC-E008**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-IQC-E008 |
| 测试标题 | 跨租户访问防护 |
| 优先级 | P0 |
| 前置条件 | tenantId=1 下存在质检单 id=1，当前请求 tenantId=2 |
| 测试步骤 | 以 tenantId=2 的 token GET /api/incoming-inspections/1 |
| 预期结果 | HTTP 404；tenantId 隔离生效，不暴露其他租户数据 |

---

## R-09 退货单模块测试用例

### 功能测试（正常流程）

---

**TC-RTN-001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-RTN-001 |
| 测试标题 | 手动创建退货单 |
| 优先级 | P1 |
| 前置条件 | 存在 supplierId=1，skuId=101 |
| 测试步骤 | POST /api/return-orders，body: {"returnType":"purchase_return","sourcePoId":1,"supplierId":1,"returnReason":"质量问题","items":[{"skuId":101,"qtyReturn":"10","purchaseUnit":"pcs","unitPrice":"50.00"}]} |
| 预期结果 | HTTP 201；返回 {"id":N,"returnNo":"RTN-YYYYMMDD-XXXX"}；return_orders 新增 status=draft 记录；return_order_items 新增 1 条明细；total_qty=10 |

---

**TC-RTN-002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-RTN-002 |
| 测试标题 | 退货单状态流转：draft → confirmed → shipped → completed |
| 优先级 | P0 |
| 前置条件 | 退货单 id=1，status=draft |
| 测试步骤 | 1. POST /api/return-orders/1/confirm<br>2. POST /api/return-orders/1/ship<br>3. POST /api/return-orders/1/complete |
| 预期结果 | 步骤1: HTTP 200，status=confirmed，confirmed_at 有值；步骤2: HTTP 200，status=shipped，shipped_at 有值；步骤3: HTTP 200，status=completed，completed_at 有值 |

---

**TC-RTN-003**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-RTN-003 |
| 测试标题 | 分页查询退货单 — 按状态和供应商筛选 |
| 优先级 | P1 |
| 前置条件 | 存在多条不同状态、不同供应商的退货单 |
| 测试步骤 | GET /api/return-orders?status=confirmed&supplierId=1&page=1&pageSize=10 |
| 预期结果 | 返回列表仅含 status=confirmed 且 supplier_id=1 的记录；每条记录包含 supplierName、sourcePoNo、sourceInspectionNo 联查字段 |

---

**TC-RTN-004**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-RTN-004 |
| 测试标题 | 质检自动生成退货单 — 验证 source_inspection_id 关联 |
| 优先级 | P0 |
| 前置条件 | 质检单 IQC-003（id=3）含不合格品，disposition=return |
| 测试步骤 | 1. 提交质检结论 POST /api/incoming-inspections/3/submit<br>2. GET /api/return-orders?page=1&pageSize=20，查找自动生成的退货单 |
| 预期结果 | 自动生成的退货单 source_inspection_id=3；return_type=purchase_return；状态直接为 confirmed（非 draft）；return_reason 含"BD-004" |

---

### 边界测试

---

**TC-RTN-B001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-RTN-B001 |
| 测试标题 | 手动创建退货单 — 明细为空数组 |
| 优先级 | P1 |
| 前置条件 | 无 |
| 测试步骤 | POST /api/return-orders，body: {"returnType":"purchase_return","returnReason":"测试","items":[]} |
| 预期结果 | HTTP 400；Zod 校验提示"至少需要一条退货明细" |

---

**TC-RTN-B002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-RTN-B002 |
| 测试标题 | 退货数量格式校验（最多4位小数） |
| 优先级 | P1 |
| 前置条件 | 无 |
| 测试步骤 | 1. qtyReturn="10.12345"（5位小数）<br>2. qtyReturn="abc" |
| 预期结果 | 两种情况均返回 HTTP 400，Zod 正则校验失败 |

---

### 异常测试

---

**TC-RTN-E001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-RTN-E001 |
| 测试标题 | 非法状态跳转 — 直接从 draft 执行 ship |
| 优先级 | P0 |
| 前置条件 | 退货单 id=1，status=draft |
| 测试步骤 | POST /api/return-orders/1/ship（跳过 confirm 步骤） |
| 预期结果 | HTTP 409；message 含"当前状态为 draft，不允许此操作（须为 confirmed）" |

---

**TC-RTN-E002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-RTN-E002 |
| 测试标题 | 非法状态跳转 — 对 completed 再执行 complete |
| 优先级 | P0 |
| 前置条件 | 退货单 id=2，status=completed |
| 测试步骤 | POST /api/return-orders/2/complete |
| 预期结果 | HTTP 409；message 含"当前状态为 completed，不允许此操作（须为 shipped）" |

---

**TC-RTN-E003**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-RTN-E003 |
| 测试标题 | 操作不存在的退货单 |
| 优先级 | P1 |
| 前置条件 | id=99999 不存在 |
| 测试步骤 | POST /api/return-orders/99999/confirm |
| 预期结果 | HTTP 404；message 含"退货单不存在" |

---

## R-10 销售→生产数据链路测试用例

### 功能测试（正常流程）

---

**TC-PROD-001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-PROD-001 |
| 测试标题 | 从销售订单创建生产工单 — 完整正常流程 |
| 优先级 | P0 |
| 前置条件 | 销售订单 SO-001（id=1）status=confirmed，含 2 条明细（sku_id=101,102）；各 SKU 均有激活 BOM 和工艺模板；库存充足（qty_on_hand 大于 BOM 展开后的需求量） |
| 测试步骤 | 1. POST /api/production/orders/from-sales-order，body: {"salesOrderId":1}<br>2. 查询 production_orders 表<br>3. 查询 material_requirements 表<br>4. 查询 bom_version_snapshots 表<br>5. 查询 inventory 表 |
| 预期结果 | HTTP 200；返回 2 个工单数组（每个明细对应一张工单）；每张工单 status=pending，material_status=ready（库存充足时）；每张工单 bom_snapshot_id 有值（快照已创建）；material_requirements 已写入展开后的各原材料行；inventory.qty_reserved 已增加对应预留量；sales_orders.status 更新为 in_production |

---

**TC-PROD-002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-PROD-002 |
| 测试标题 | BOM 展开 — 多层级 BOM 递归展开并合并同类项 |
| 优先级 | P0 |
| 前置条件 | SKU-A 的 BOM 包含：组件B（qty=2）和组件C（qty=1）；组件B 有自己的激活 BOM：原料X（qty=3）和原料Y（qty=1）；组件C 无子BOM（原材料） |
| 测试步骤 | 触发从包含 SKU-A 的销售订单创建工单（qtyPlanned=10） |
| 预期结果 | material_requirements 含：原料X（qty=2*3*10=60，加 scrap_rate）；原料Y（qty=2*1*10=20，加 scrap_rate）；组件C（qty=1*10=10，加 scrap_rate）；无重复 sku_id；相同 sku_id 在多处出现时数量已合并 |

---

**TC-PROD-003**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-PROD-003 |
| 测试标题 | 库存部分满足 — material_status=partial |
| 优先级 | P0 |
| 前置条件 | 销售订单含 SKU-X，BOM 展开需要原料A 100 件，当前可用库存（qty_on_hand - qty_reserved）= 60 件 |
| 测试步骤 | POST /api/production/orders/from-sales-order，body: {"salesOrderId":N} |
| 预期结果 | 工单 material_status=partial；material_requirements 中原料A：qty_reserved=60，qty_shortage=40，status=partial；inventory.qty_reserved 增加 60（按可用量预留） |

---

**TC-PROD-004**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-PROD-004 |
| 测试标题 | 库存完全不足 — material_status=shortage |
| 优先级 | P0 |
| 前置条件 | 销售订单含 SKU-Y，BOM 展开需要原料B 50 件，当前库存 qty_on_hand=0 |
| 测试步骤 | POST /api/production/orders/from-sales-order，body: {"salesOrderId":M} |
| 预期结果 | 工单 material_status=shortage；material_requirements 中原料B：qty_reserved=0，qty_shortage=50，status=shortage；inventory.qty_reserved 不变 |

---

**TC-PROD-005**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-PROD-005 |
| 测试标题 | 取消工单 — 级联释放库存预留 |
| 优先级 | P0 |
| 前置条件 | 工单 WO-001（id=1）status=pending，material_requirements 含 3 条记录（qty_reserved 均>0），production_tasks 含若干 status=pending 任务 |
| 测试步骤 | 1. DELETE /api/production/orders/1（或对应取消接口）<br>2. 查询 inventory 表<br>3. 查询 production_tasks 表<br>4. 查询 material_requirements 表 |
| 预期结果 | HTTP 200；工单 status=cancelled；inventory.qty_reserved 减少对应预留量（GREATEST(qty_reserved-X, 0) 防止负数）；production_tasks 未完成任务 status=cancelled；material_requirements qty_reserved=0，qty_shortage=qty_required，status=shortage |

---

**TC-PROD-006**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-PROD-006 |
| 测试标题 | 工单列表查询 — 多条件筛选 |
| 优先级 | P1 |
| 前置条件 | 存在多张不同状态、不同 sku 的工单 |
| 测试步骤 | GET /api/production/orders?status=pending&page=1&pageSize=20 |
| 预期结果 | 返回 list 仅含 status=pending 工单；每条记录含 skuName、skuCode、salesOrderNo、bomSnapshotNo、progressPct；按 priority DESC, expected_delivery ASC 排序 |

---

**TC-PROD-007**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-PROD-007 |
| 测试标题 | 实时缺料检测（checkMaterialStatus） |
| 优先级 | P1 |
| 前置条件 | 工单 id=1 创建后其他工单消耗了部分库存，导致可用量下降 |
| 测试步骤 | GET /api/production/orders/1/material-status |
| 预期结果 | HTTP 200；返回最新 materialStatus；requirements 列表反映实时 availableQty；production_orders.material_status 同步更新 |

---

### 边界测试

---

**TC-PROD-B001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-PROD-B001 |
| 测试标题 | BOM 最大层级限制（10层） |
| 优先级 | P0 |
| 前置条件 | 构造一个 11 层嵌套的 BOM 结构 |
| 测试步骤 | 触发包含 11 层 BOM 的 SKU 的工单创建 |
| 预期结果 | HTTP 400；错误 code = BOM_CIRCULAR_REF；message 含"BOM 层级超过最大限制（10 层）" |

---

**TC-PROD-B002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-PROD-B002 |
| 测试标题 | BOM 循环引用检测 |
| 优先级 | P0 |
| 前置条件 | 构造循环引用 BOM：A 包含 B，B 包含 A |
| 测试步骤 | 触发包含该 SKU 的工单创建 |
| 预期结果 | HTTP 400；错误 code = BOM_CIRCULAR_REF；message 含"BOM 存在循环引用" |

---

**TC-PROD-B003**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-PROD-B003 |
| 测试标题 | 损耗率（scrap_rate）计算精度 |
| 优先级 | P1 |
| 前置条件 | BOM 明细：quantity=2，scrap_rate=0.05（5%损耗），qtyPlanned=100 |
| 测试步骤 | 触发工单创建，查询 material_requirements.qty_required |
| 预期结果 | qty_required = 100 * 2 * (1+0.05) = 210.000000（精度 6 位小数）；与 Decimal.js 计算结果一致 |

---

**TC-PROD-B004**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-PROD-B004 |
| 测试标题 | 库存并发预留竞争 |
| 优先级 | P1 |
| 前置条件 | 原料X 可用量 = 50，两个工单同时需要预留 50 |
| 测试步骤 | 同时发起两个工单创建请求（模拟并发） |
| 预期结果 | 仅一个工单成功完全预留（material_status=ready），另一个工单因 UPDATE ... WHERE qty_on_hand - qty_reserved >= ? 条件不满足，affectedRows=0，自动降级为 shortage 状态；总 qty_reserved 不超过 qty_on_hand |

---

### 异常测试

---

**TC-PROD-E001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-PROD-E001 |
| 测试标题 | 销售订单状态不满足条件 |
| 优先级 | P0 |
| 前置条件 | 销售订单 id=2，status=draft（非 confirmed 或 approved） |
| 测试步骤 | POST /api/production/orders/from-sales-order，body: {"salesOrderId":2} |
| 预期结果 | HTTP 400；message 含"无法创建工单（需为 confirmed 或 approved）" |

---

**TC-PROD-E002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-PROD-E002 |
| 测试标题 | SKU 无激活 BOM |
| 优先级 | P0 |
| 前置条件 | 销售订单含 SKU-Z，该 SKU 无任何 is_active=1 的 bom_headers 记录 |
| 测试步骤 | POST /api/production/orders/from-sales-order，body: {"salesOrderId":N} |
| 预期结果 | HTTP 400；code = BOM_NOT_FOUND；message 含"无激活 BOM 版本，无法创建工单" |

---

**TC-PROD-E003**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-PROD-E003 |
| 测试标题 | SKU 无工艺模板 |
| 优先级 | P0 |
| 前置条件 | SKU 有激活 BOM 但 process_templates 无对应记录 |
| 测试步骤 | POST /api/production/orders/from-sales-order，body: {"salesOrderId":N} |
| 预期结果 | HTTP 400；message 含"无工艺模板，无法创建工单" |

---

**TC-PROD-E004**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-PROD-E004 |
| 测试标题 | 取消已完工工单 |
| 优先级 | P0 |
| 前置条件 | 工单 id=5，status=completed |
| 测试步骤 | 调用取消工单接口（DELETE /api/production/orders/5 或对应路由） |
| 预期结果 | HTTP 400；message 含"已完工工单无法取消" |

---

**TC-PROD-E005**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-PROD-E005 |
| 测试标题 | 销售订单无明细行 |
| 优先级 | P1 |
| 前置条件 | 销售订单 id=3，status=confirmed，sales_order_items 无记录 |
| 测试步骤 | POST /api/production/orders/from-sales-order，body: {"salesOrderId":3} |
| 预期结果 | HTTP 400；message 含"销售订单无明细行，无法创建工单" |

---

## R-11 采购数据链路闭环测试用例

### 功能测试（正常流程）

---

**TC-MRP-001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-MRP-001 |
| 测试标题 | 单工单缺料检测（detectShortage） |
| 优先级 | P0 |
| 前置条件 | 工单 id=1，含 3 条 material_requirements；原料A 库存充足，原料B 库存部分满足，原料C 无库存 |
| 测试步骤 | POST /api/mrp/detect-shortage，body: {"productionOrderId":1} |
| 预期结果 | 返回 shortageItems：原料A status=fulfilled；原料B status=partial，qtyShortage>0；原料C status=shortage，qtyShortage=qty_required；整体 materialStatus=partial（有 partial 但无全部 shortage）；production_orders.material_status 同步更新 |

---

**TC-MRP-002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-MRP-002 |
| 测试标题 | 全局缺料汇总（getGlobalShortageSummary） |
| 优先级 | P0 |
| 前置条件 | 存在多个 pending/scheduled 状态工单，多工单共用同一种原料A，total_qty_shortage > 0 |
| 测试步骤 | GET /api/mrp/global-shortage?page=1&pageSize=20 |
| 预期结果 | 返回按 total_qty_shortage DESC 排序的汇总列表；原料A 的 affectedOrderCount 等于引用该原料的工单数；affectedOrderIds 包含所有相关工单 ID；totalQtyRequired/totalQtyShortage 为各工单需求量/缺口量之和 |

---

**TC-MRP-003**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-MRP-003 |
| 测试标题 | 基于缺料生成采购建议（generateSuggestions） |
| 优先级 | P0 |
| 前置条件 | 工单 id=1 有缺料原料 skuId=201（qty_shortage=50），supplier_prices 含 skuId=201 的有效报价（status=active，in_date_range） |
| 测试步骤 | POST /api/mrp/generate-suggestions，body: {"productionOrderId":1} |
| 预期结果 | purchase_suggestions 新增一条记录：source=production_shortage，sku_id=201，suggested_qty=50.0000，suggested_supplier_id 为最低报价供应商，status=pending，confidence=high；material_requirements.suggestion_id 更新为新建议 id；返回 {created:1, updated:0, skipped:0} |

---

**TC-MRP-004**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-MRP-004 |
| 测试标题 | 采购建议防重复 — 已有 pending 建议时更新数量 |
| 优先级 | P0 |
| 前置条件 | skuId=201 已存在一条 pending 的 purchase_suggestion（suggested_qty=30）；当前缺口 qty_shortage=50 |
| 测试步骤 | POST /api/mrp/generate-suggestions（全局或指定工单） |
| 预期结果 | 不新增建议记录；现有建议的 suggested_qty 更新为 max(30,50)=50；返回 {created:0, updated:1, skipped:0} |

---

**TC-MRP-005**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-MRP-005 |
| 测试标题 | 采购建议审批通过 |
| 优先级 | P0 |
| 前置条件 | 采购建议 id=1，status=pending |
| 测试步骤 | POST /api/purchase-suggestions/1/approve |
| 预期结果 | HTTP 200；purchase_suggestions.status=approved，approved_by 有值，approved_at 有值 |

---

**TC-MRP-006**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-MRP-006 |
| 测试标题 | 采购建议驳回 |
| 优先级 | P0 |
| 前置条件 | 采购建议 id=2，status=pending |
| 测试步骤 | POST /api/purchase-suggestions/2/reject，body: {"reason":"供应商报价过高"} |
| 预期结果 | HTTP 200；status=rejected，reject_reason="供应商报价过高"，approved_at 有值 |

---

**TC-MRP-007**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-MRP-007 |
| 测试标题 | 批量将采购建议转为采购订单 |
| 优先级 | P0 |
| 前置条件 | 采购建议 id=1（supplierId=1，skuId=101，status=approved）、id=2（supplierId=1，skuId=102，status=approved）、id=3（supplierId=2，skuId=201，status=approved） |
| 测试步骤 | POST /api/purchase-suggestions/batch-to-po，body: {"suggestionIds":[1,2,3]} |
| 预期结果 | 创建 2 张采购订单（按 supplierId 分组）：PO-A 含 2 条明细（id=1,2）；PO-B 含 1 条明细（id=3）；3 条建议 status=executed；返回 {createdPOs:[{poNo,...},{poNo,...}], executedSuggestionIds:[1,2,3]} |

---

**TC-MRP-008**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-MRP-008 |
| 测试标题 | 入库后重新评估缺料（reevaluateAfterReceipt） |
| 优先级 | P0 |
| 前置条件 | skuId=201 的多个工单处于 pending 状态并有缺料需求；该 SKU 新入库 100 件 |
| 测试步骤 | POST /api/mrp/reevaluate-after-receipt，body: {"skuId":201} |
| 预期结果 | 返回 affectedOrderIds 包含所有用到 skuId=201 的 pending/scheduled 工单；updatedRequirements 等于被重新评估的 material_requirements 行数；相关工单 material_status 可能升级为 ready 或 partial |

---

**TC-MRP-009**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-MRP-009 |
| 测试标题 | 供应链看板数据（getSupplyChainDashboard） |
| 优先级 | P1 |
| 前置条件 | 数据库含各种状态的采购订单和采购建议 |
| 测试步骤 | GET /api/mrp/dashboard |
| 预期结果 | 返回 {pendingReceiptPOCount, shortageOrderCount, weeklyReceivedBatchCount, weeklyPendingSuggestionCount} 四个指标；数据与数据库实际数量一致 |

---

### 边界测试

---

**TC-MRP-B001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-MRP-B001 |
| 测试标题 | 缺料净缺口计算 — 在途量抵扣 |
| 优先级 | P1 |
| 前置条件 | 原料X：qty_required=100，qty_on_hand=30，qty_reserved=0，qty_in_transit=80 |
| 测试步骤 | 调用 detectShortage 检测该工单 |
| 预期结果 | qtyAvailable=30；netShortage = max(100-30-80, 0) = 0；itemStatus=fulfilled（在途量足以覆盖缺口） |

---

**TC-MRP-B002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-MRP-B002 |
| 测试标题 | 全局缺料汇总 — 无缺料工单时返回空列表 |
| 优先级 | P2 |
| 前置条件 | 所有 pending 工单 material_status=ready |
| 测试步骤 | GET /api/mrp/global-shortage |
| 预期结果 | 返回 {list:[], total:0} |

---

**TC-MRP-B003**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-MRP-B003 |
| 测试标题 | 采购建议生成 — 无有效供应商报价时仍可创建建议 |
| 优先级 | P1 |
| 前置条件 | 缺料 skuId=999，supplier_prices 无该 SKU 的有效记录 |
| 测试步骤 | 触发 generateSuggestions |
| 预期结果 | 建议仍可创建（suggested_supplier_id=null，estimated_price=null，estimated_amount=null）；不因供应商缺失而报错 |

---

**TC-MRP-B004**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-MRP-B004 |
| 测试标题 | 批量转单 — 空 ID 列表 |
| 优先级 | P1 |
| 前置条件 | 无 |
| 测试步骤 | POST /api/purchase-suggestions/batch-to-po，body: {"suggestionIds":[]} |
| 预期结果 | HTTP 400；message 含"至少选择一条采购建议" |

---

### 异常测试

---

**TC-MRP-E001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-MRP-E001 |
| 测试标题 | 审批非 pending 状态的采购建议 |
| 优先级 | P0 |
| 前置条件 | 采购建议 id=3，status=approved |
| 测试步骤 | POST /api/purchase-suggestions/3/approve |
| 预期结果 | HTTP 400；message 含"当前状态 approved 不允许审批操作" |

---

**TC-MRP-E002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-MRP-E002 |
| 测试标题 | 批量转单 — 包含非 approved 状态的建议 |
| 优先级 | P0 |
| 前置条件 | 建议 id=1 status=approved，id=2 status=pending |
| 测试步骤 | POST /api/purchase-suggestions/batch-to-po，body: {"suggestionIds":[1,2]} |
| 预期结果 | HTTP 400；message 含"以下采购建议未处于审批通过状态"及 id=2 |

---

**TC-MRP-E003**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-MRP-E003 |
| 测试标题 | 批量转单 — 建议无供应商 |
| 优先级 | P0 |
| 前置条件 | 建议 id=4 status=approved，suggested_supplier_id=null |
| 测试步骤 | POST /api/purchase-suggestions/batch-to-po，body: {"suggestionIds":[4]} |
| 预期结果 | HTTP 400；message 含"以下采购建议未指定供应商，无法转单"及 id=4 |

---

**TC-MRP-E004**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-MRP-E004 |
| 测试标题 | 已无缺料工单不生成建议 |
| 优先级 | P1 |
| 前置条件 | 工单 id=10 material_status=ready，所有 material_requirements.qty_shortage=0 |
| 测试步骤 | POST /api/mrp/generate-suggestions，body: {"productionOrderId":10} |
| 预期结果 | HTTP 200；返回 {created:0, updated:0, skipped:N, suggestionIds:[]} |

---

## 业务规则专项测试

### BD-001：BOM 版本快照锁定

---

**TC-BD001-001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-BD001-001 |
| 测试标题 | 工单创建时 BOM 版本快照正确冻结 |
| 优先级 | P0 |
| 前置条件 | SKU-A 激活 BOM version="V2.0"，BOM 含 3 种原料 |
| 测试步骤 | 1. 创建工单 WO-001<br>2. 修改 BOM（升级到 V3.0，增加一种原料）<br>3. 查询 WO-001 的 material_requirements |
| 预期结果 | WO-001 的 bom_snapshot_id 关联的 bom_version_snapshots 记录 bom_version=V2.0；WO-001 的 material_requirements 仍为 V2.0 版本的 3 种原料，不受 BOM 更新影响；新快照 snapshot_data 与 V2.0 BOM 展开结果一致 |

---

**TC-BD001-002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-BD001-002 |
| 测试标题 | 相同 BOM 展开结果复用快照（hash 去重） |
| 优先级 | P1 |
| 前置条件 | SKU-A 的 BOM 未变更，同一天内两次创建工单（相同 qtyPlanned） |
| 测试步骤 | 连续创建 2 张包含 SKU-A 的工单 |
| 预期结果 | 两张工单的 bom_snapshot_id 相同（快照复用）；bom_version_snapshots 表仅新增 1 条记录（非 2 条）；SnapshotResult.reused=true |

---

**TC-BD001-003**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-BD001-003 |
| 测试标题 | 不同生产数量产生不同快照 |
| 优先级 | P1 |
| 前置条件 | SKU-A BOM 相同，但两次创建的 qtyPlanned 不同（100 vs 200） |
| 测试步骤 | 分别创建 qtyPlanned=100 和 qtyPlanned=200 的工单 |
| 预期结果 | 两张工单 bom_snapshot_id 不同（展开结果的数量不同，SHA-256 hash 不同）；分别创建了 2 条快照记录 |

---

**TC-BD001-004**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-BD001-004 |
| 测试标题 | 快照编号格式验证（BS-YYYYMMDD-NNNN） |
| 优先级 | P1 |
| 前置条件 | 新创建工单触发快照创建 |
| 测试步骤 | 查询 bom_version_snapshots.snapshot_no |
| 预期结果 | 快照编号符合正则 /^BS-\d{8}-\d{4}$/ |

---

### BD-004：不合格品仅允许退货

---

**TC-BD004-001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-BD004-001 |
| 测试标题 | 不合格品 disposition=return — 系统自动生成退货单，不入库 |
| 优先级 | P0 |
| 前置条件 | 质检明细：result=fail，disposition=return，qty_failed=10 |
| 测试步骤 | 提交质检结论 overallResult=fail |
| 预期结果 | return_orders 新增退货单，return_type=purchase_return，status=confirmed；purchase_receipts 无新增（不入库）；qty_passed 和 qty_failed 对应的 po_item.qty_passed 不增加，qty_rejected 增加 10 |

---

**TC-BD004-002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-BD004-002 |
| 测试标题 | 不合格品 disposition=accept — 验证系统处理方式 |
| 优先级 | P0 |
| 前置条件 | 质检明细：result=fail，disposition=accept（降级使用场景），qty_failed=5 |
| 测试步骤 | 提交质检结论，观察入库和退货逻辑 |
| 预期结果 | 服务端逻辑（handleFailedItems）仅对 disposition=return 的不合格品生成退货单；disposition=accept 的 fail 明细不生成退货单，也不入库（qty_passed=0，不触发 handlePassedItems）；此为当前实现行为，标注为潜在风险点：BD-004 要求不合格品不可降级，前端需封锁该选项 |

---

**TC-BD004-003**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-BD004-003 |
| 测试标题 | 前端 BD-004 合规提示 — 质检单 failed 状态时显示规则提醒 |
| 优先级 | P1 |
| 前置条件 | 浏览器打开来料质检页面，存在 status=failed 的质检单 |
| 测试步骤 | 点击 status=failed 质检单的"查看详情"按钮，打开 Drawer |
| 预期结果 | Drawer 内显示"BD-004 合规提示：不合格品仅允许退货处置，不可选择降级使用"的提示框；提示框可见，颜色区分醒目 |

---

**TC-BD004-004**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-BD004-004 |
| 测试标题 | 不合格品退货单自动标记为 confirmed（非 draft） |
| 优先级 | P0 |
| 前置条件 | 质检提交触发自动退货 |
| 测试步骤 | 查询自动生成的退货单 status |
| 预期结果 | status=confirmed（自动跳过 draft 审批步骤）；confirmed_at 有值；手动创建的退货单初始 status=draft，两者行为有差异，符合设计 |

---

## 状态机测试

### 质检单状态机

```
draft → in_progress → passed / failed / partially_passed
```

---

**TC-SM-IQC-001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-SM-IQC-001 |
| 测试标题 | 合法状态流转路径全覆盖 |
| 优先级 | P0 |
| 前置条件 | 3 张质检单分别对应全合格、全不合格、部分合格场景 |
| 测试步骤 | 依次执行 updateItems → submit，观察终态 |
| 预期结果 | 全合格：draft → in_progress → passed；全不合格：draft → in_progress → failed；部分合格：draft → in_progress → partially_passed |

---

**TC-SM-IQC-002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-SM-IQC-002 |
| 测试标题 | 终态质检单不可再流转 |
| 优先级 | P0 |
| 前置条件 | 质检单 status=passed/failed/partially_passed（三种终态分别测试） |
| 测试步骤 | 对终态质检单分别调用 updateItems 和 submit |
| 预期结果 | updateItems 返回 HTTP 409；submit 返回 HTTP 409 |

---

### 退货单状态机

```
draft → confirmed → shipped → completed
```

---

**TC-SM-RTN-001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-SM-RTN-001 |
| 测试标题 | 所有合法跳转路径验证 |
| 优先级 | P0 |
| 前置条件 | 退货单 id=1，status=draft |
| 测试步骤 | confirm → ship → complete，每步后验证状态和时间戳 |
| 预期结果 | 状态按顺序正确流转；confirmed_at、shipped_at、completed_at 均有值且时序合理 |

---

**TC-SM-RTN-002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-SM-RTN-002 |
| 测试标题 | 所有非法跳转路径验证 |
| 优先级 | P0 |
| 前置条件 | 退货单在不同状态 |
| 测试步骤 | 分别测试：draft→ship；draft→complete；confirmed→confirm；shipped→confirm；completed→ship |
| 预期结果 | 所有非法跳转均返回 HTTP 409，并携带当前状态和要求状态的错误描述 |

---

### 生产工单状态机

```
pending → scheduled → in_progress → completed
                    ↘ cancelled（任何非终态可取消）
```

---

**TC-SM-WO-001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-SM-WO-001 |
| 测试标题 | 取消 pending 状态工单 |
| 优先级 | P0 |
| 前置条件 | 工单 status=pending |
| 测试步骤 | 调用取消接口 |
| 预期结果 | status=cancelled；关联 production_tasks 中非终态任务变为 cancelled；已预留库存释放 |

---

**TC-SM-WO-002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-SM-WO-002 |
| 测试标题 | 重复取消工单 |
| 优先级 | P0 |
| 前置条件 | 工单 status=cancelled |
| 测试步骤 | 再次调用取消接口 |
| 预期结果 | HTTP 409；message 含"工单已取消" |

---

**TC-SM-WO-003**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-SM-WO-003 |
| 测试标题 | 工序完工触发下道工序解锁 |
| 优先级 | P0 |
| 前置条件 | 工单含 3 道工序（step_no=1,2,3），step=1 的所有任务 status=started |
| 测试步骤 | 调用 WorkflowEngineService.onTaskCompleted（step=1 的 taskId）|
| 预期结果 | step=1 任务状态改为 completed；step=2 任务从非 pending 状态解锁为 pending；step=3 任务不变 |

---

**TC-SM-WO-004**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-SM-WO-004 |
| 测试标题 | 最后一道工序完工触发工单完工 |
| 优先级 | P0 |
| 前置条件 | 工单最后一道工序任务即将完工，其他所有任务已 completed 或 cancelled |
| 测试步骤 | 调用 onTaskCompleted（最后一个任务） |
| 预期结果 | 工单 status=completed；qty_completed = sum(completed_qty)；actual_end = NOW() |

---

### 采购建议状态机

```
pending → approved → executed
       → rejected
```

---

**TC-SM-SUGG-001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-SM-SUGG-001 |
| 测试标题 | 建议所有合法状态流转验证 |
| 优先级 | P0 |
| 前置条件 | pending 状态建议 2 条 |
| 测试步骤 | 建议A：pending → approve → batchToPO（executed）；建议B：pending → reject |
| 预期结果 | 建议A：status=executed；建议B：status=rejected，reject_reason 有值 |

---

**TC-SM-SUGG-002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-SM-SUGG-002 |
| 测试标题 | 非法状态流转 — approved 再 approve |
| 优先级 | P1 |
| 前置条件 | 建议 status=approved |
| 测试步骤 | POST /api/purchase-suggestions/{id}/approve |
| 预期结果 | HTTP 400；message 含"当前状态 approved 不允许审批操作" |

---

## 事务完整性测试

---

**TC-TXN-001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-TXN-001 |
| 测试标题 | 质检提交事务回滚 — 入库单创建后库存更新失败场景 |
| 优先级 | P0 |
| 前置条件 | Mock inventory 表锁定或 UPDATE 失败 |
| 测试步骤 | 触发 submit，使事务中途失败 |
| 预期结果 | purchase_receipts 记录回滚（不残留）；inventory 不被部分更新；质检单 status 保持 in_progress；receipt_triggered 保持 0 |

---

**TC-TXN-002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-TXN-002 |
| 测试标题 | 工单创建事务原子性 — BOM快照创建成功但库存预留失败 |
| 优先级 | P0 |
| 前置条件 | 模拟 inventory UPDATE 失败 |
| 测试步骤 | 触发 createFromSalesOrder，在库存预留步骤前制造错误 |
| 预期结果 | production_orders 不保留新记录；bom_version_snapshots 不保留新记录；material_requirements 不保留新记录；sales_orders.status 不变 |

---

**TC-TXN-003**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-TXN-003 |
| 测试标题 | 批量转单事务原子性 — 部分 PO 创建失败 |
| 优先级 | P0 |
| 前置条件 | 3 条 approved 建议，分属 2 个供应商；Mock 第 2 个 PO 插入失败 |
| 测试步骤 | 调用 batchCreatePOFromSuggestions |
| 预期结果 | 两个 PO 均回滚；所有建议 status 保持 approved（不改为 executed） |

---

**TC-TXN-004**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-TXN-004 |
| 测试标题 | 幂等位保护 — receipt_triggered 防止重复入库 |
| 优先级 | P0 |
| 前置条件 | 质检单 receipt_triggered=1（已触发入库） |
| 测试步骤 | 手动将质检单状态改回 in_progress 后再次调用 submit（模拟异常重试） |
| 预期结果 | handlePassedItems 不再执行（receipt_triggered=1 的判断生效）；inventory 不重复增加；purchase_receipts 不重复创建 |

---

**TC-TXN-005**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-TXN-005 |
| 测试标题 | 取消工单 — 库存释放数量精度验证 |
| 优先级 | P1 |
| 前置条件 | 工单 material_requirements 含原料 qty_reserved="15.123456" |
| 测试步骤 | 取消工单，查询 inventory.qty_reserved |
| 预期结果 | qty_reserved 精确减少 15.123456（GREATEST(qty_reserved - 15.123456, 0)）；不发生浮点精度误差；GREATEST 防止 qty_reserved 为负数 |

---

## 前端 UI 交互测试

### IncomingInspectionPage.tsx

---

**TC-UI-IQC-001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-IQC-001 |
| 测试标题 | 统计卡片数据展示 |
| 优先级 | P1 |
| 前置条件 | 页面加载，使用 Mock 数据（4条：1 passed，1 in_progress，1 failed，1 draft） |
| 测试步骤 | 打开来料质检页面，查看顶部统计卡片 |
| 预期结果 | "全部质检单"=4；"待检/质检中"=2（draft+in_progress）；"合格"=1；"不合格/部分合格"=1 |

---

**TC-UI-IQC-002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-IQC-002 |
| 测试标题 | 状态筛选功能 |
| 优先级 | P1 |
| 前置条件 | 页面已加载含多种状态数据 |
| 测试步骤 | 在状态下拉选择"合格"，观察表格数据变化 |
| 预期结果 | 表格仅显示 status=passed 的记录；page 重置为 1 |

---

**TC-UI-IQC-003**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-IQC-003 |
| 测试标题 | 关键词搜索 — 前端过滤 |
| 优先级 | P1 |
| 前置条件 | 列表含供应商"广州皮革城"和"华森木业" |
| 测试步骤 | 在搜索框输入"广州" |
| 预期结果 | 仅显示 supplierName 或 inspectionNo 或 poNo 中含"广州"的记录；大小写不敏感 |

---

**TC-UI-IQC-004**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-IQC-004 |
| 测试标题 | 清除筛选按钮 |
| 优先级 | P2 |
| 前置条件 | 已设置状态筛选和日期范围 |
| 测试步骤 | 点击"清除筛选"按钮 |
| 预期结果 | 所有筛选条件重置（statusFilter=''，dateFrom=''，dateTo=''，keyword=''）；表格显示全量数据；清除按钮消失 |

---

**TC-UI-IQC-005**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-IQC-005 |
| 测试标题 | Drawer 详情展示 — 状态徽章颜色 |
| 优先级 | P1 |
| 前置条件 | 存在不同状态的质检单 |
| 测试步骤 | 点击各状态质检单的"查看详情"按钮 |
| 预期结果 | draft → 灰色徽章；in_progress → 蓝色；passed → 绿色；partially_passed → 黄色；failed → 红色；颜色通过 CSS class 正确应用（status_gray/blue/green/yellow/red） |

---

**TC-UI-IQC-006**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-IQC-006 |
| 测试标题 | Drawer footer 按钮按状态条件渲染 |
| 优先级 | P1 |
| 前置条件 | 存在 draft/in_progress 和 passed 状态的质检单 |
| 测试步骤 | 1. 点击 draft 或 in_progress 质检单的详情<br>2. 点击 passed 质检单的详情 |
| 预期结果 | 步骤1：Drawer footer 显示"提交质检结论"主按钮；步骤2：footer 仅显示"关闭"按钮，无操作按钮 |

---

**TC-UI-IQC-007**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-IQC-007 |
| 测试标题 | BD-004 合规提示 — 仅在 failed 状态显示 |
| 优先级 | P0 |
| 前置条件 | 存在 status=failed 和 status=passed 的质检单 |
| 测试步骤 | 1. 打开 status=failed 质检单详情<br>2. 打开 status=passed 质检单详情 |
| 预期结果 | 步骤1：Drawer 中显示 BD-004 规则提示框；步骤2：不显示提示框 |

---

**TC-UI-IQC-008**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-IQC-008 |
| 测试标题 | 新建质检单 Modal — 必填字段校验 |
| 优先级 | P1 |
| 前置条件 | 点击"新建质检单"按钮打开 Modal |
| 测试步骤 | 1. 不填任何字段，点击"创建"<br>2. 只填 poId，不填 inspectionDate，点击"创建" |
| 预期结果 | 均触发前端 Toast 警告"请填写必填字段"；不调用 API |

---

**TC-UI-IQC-009**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-IQC-009 |
| 测试标题 | 提交质检结论 Modal — 未选结论不可提交 |
| 优先级 | P1 |
| 前置条件 | 已打开提交结论 Modal |
| 测试步骤 | 不选择 overallResult，点击"提交结论" |
| 预期结果 | Toast 警告"请选择质检结论"；不调用 API |

---

### ReturnOrderPage.tsx

---

**TC-UI-RTN-001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-RTN-001 |
| 测试标题 | 退货单操作按钮按状态条件渲染 |
| 优先级 | P1 |
| 前置条件 | 列表含 draft/confirmed/shipped/completed 各状态退货单 |
| 测试步骤 | 查看表格操作列 |
| 预期结果 | draft → 显示"确认"按钮；confirmed → 显示"发出"按钮；shipped → 显示"完成"按钮（绿色 variant）；completed → 无操作按钮 |

---

**TC-UI-RTN-002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-RTN-002 |
| 测试标题 | 状态筛选功能 |
| 优先级 | P1 |
| 前置条件 | 退货单列表有数据 |
| 测试步骤 | 选择状态筛选"已发出" |
| 预期结果 | API 请求携带 status=shipped 参数；列表刷新；page 重置为 1 |

---

### ProductionOrderPage.tsx

---

**TC-UI-WO-001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-WO-001 |
| 测试标题 | 从销售订单创建工单 Modal 交互 |
| 优先级 | P1 |
| 前置条件 | 生产工单页面已加载 |
| 测试步骤 | 1. 点击"从销售订单创建工单"按钮<br>2. 输入销售订单 ID=0（非正整数）<br>3. 点击确认<br>4. 输入 ID=1，点击确认 |
| 预期结果 | 步骤3：soId=0 不满足 >0 条件，不调用 API（前端卫语句）；步骤4：调用 createFromSalesOrder(1)，显示 loading，成功后关闭 Modal |

---

**TC-UI-WO-002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-WO-002 |
| 测试标题 | 工单详情 Drawer — 基本信息/物料需求 Tab 切换 |
| 优先级 | P1 |
| 前置条件 | 存在 id=1 的工单 |
| 测试步骤 | 1. 点击工单详情按钮<br>2. 点击"物料需求"Tab<br>3. 点击"基本信息"Tab |
| 预期结果 | 步骤2：显示原材料需求表格（skuCode, skuName, qtyRequired, qtyShortage, status）；缺口>0 时用红色显示；步骤3：切回工单基本信息显示 |

---

**TC-UI-WO-003**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-WO-003 |
| 测试标题 | 取消工单确认弹窗 |
| 优先级 | P1 |
| 前置条件 | 工单 status=pending，已打开详情 Drawer |
| 测试步骤 | 1. 点击"取消工单"按钮，弹出确认 Modal<br>2. 点击确认 |
| 预期结果 | Modal 文案含工单号；确认后调用 cancelOrder API，loading 状态正确显示；成功后 Modal 关闭，Drawer 关闭 |

---

**TC-UI-WO-004**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-WO-004 |
| 测试标题 | 工单状态徽章颜色 |
| 优先级 | P2 |
| 前置条件 | 列表存在各状态工单 |
| 测试步骤 | 查看状态列徽章 |
| 预期结果 | pending→badgePending；scheduled→badgeScheduled；in_progress→badgeInProgress；completed→badgeCompleted；cancelled→badgeCancelled；各自 CSS class 正确 |

---

### ShortageBoard.tsx

---

**TC-UI-SB-001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-SB-001 |
| 测试标题 | 缺料看板 severity 颜色标注 |
| 优先级 | P1 |
| 前置条件 | 缺料看板有数据，包含 shortage=0 和 shortage>0 的行 |
| 测试步骤 | 查看缺口数量列和级别列 |
| 预期结果 | shortage=0 → 绿色字体，级别显示"充足"（badgeGreen）；shortage>0 → 红色粗体，级别显示"缺料"（badgeRed） |

---

**TC-UI-SB-002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-SB-002 |
| 测试标题 | 一键生成采购建议按钮 |
| 优先级 | P1 |
| 前置条件 | 缺料看板页面已加载 |
| 测试步骤 | 点击"一键生成采购建议"按钮 |
| 预期结果 | 按钮显示 loading 状态；调用 useGenerateMrpSuggestions（不携带特定工单 ID，全局生成）；成功后 loading 消失 |

---

**TC-UI-SB-003**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-SB-003 |
| 测试标题 | 统计卡片 — 总物料/库存充足/严重缺料 |
| 优先级 | P1 |
| 前置条件 | 看板数据含 5 条记录：3 条 shortage>0，2 条 shortage=0 |
| 测试步骤 | 查看顶部统计卡片 |
| 预期结果 | 总物料=5；库存充足=2（green）；严重缺料=3（red） |

---

### PurchaseSuggestionPage.tsx

---

**TC-UI-SUGG-001**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-SUGG-001 |
| 测试标题 | 复选框 — 仅 approved 状态可选 |
| 优先级 | P1 |
| 前置条件 | 列表含 pending/approved/rejected/executed 各状态建议 |
| 测试步骤 | 尝试勾选不同状态的建议 |
| 预期结果 | approved 状态建议复选框可点击；pending/rejected/executed 状态建议复选框 disabled，无法选中 |

---

**TC-UI-SUGG-002**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-SUGG-002 |
| 测试标题 | 批量转采购订单按钮状态 |
| 优先级 | P1 |
| 前置条件 | 采购建议列表已加载 |
| 测试步骤 | 1. 未选任何记录时观察按钮<br>2. 选中 2 条 approved 建议时观察按钮 |
| 预期结果 | 步骤1：按钮 disabled；步骤2：按钮可点击，显示"已选 2 条"提示 |

---

**TC-UI-SUGG-003**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-SUGG-003 |
| 测试标题 | 驳回建议 Modal — 原因必填校验 |
| 优先级 | P1 |
| 前置条件 | 点击 pending 建议的"驳回"按钮，打开 Modal |
| 测试步骤 | 1. 不填驳回原因，点击确认<br>2. 填写驳回原因后点击确认 |
| 预期结果 | 步骤1：handleReject 内 rejectReason.trim() 为空，不调用 API（前端卫语句生效）；步骤2：调用 reject API，Modal 关闭 |

---

**TC-UI-SUGG-004**

| 字段 | 内容 |
|------|------|
| 测试ID | TC-UI-SUGG-004 |
| 测试标题 | 来源/状态双条件筛选 |
| 优先级 | P1 |
| 前置条件 | 列表含 production_shortage 和 manual 来源的建议 |
| 测试步骤 | 选择来源="生产缺料"，状态="待审批" |
| 预期结果 | API 请求携带 source=production_shortage&status=pending；列表刷新；page 重置为 1 |

---

## 测试报告模板

```
# Sprint 3 测试报告

**测试周期**: YYYY-MM-DD ~ YYYY-MM-DD
**测试负责人**: senior-qa-engineer
**测试版本**: Sprint 3 / Commit [hash]

## 一、测试范围

| Feature | 模块 | 用例总数 | 执行数 | 通过 | 失败 | 阻断 |
|---------|------|---------|--------|------|------|------|
| R-09 | 来料质检 | - | - | - | - | - |
| R-09 | 退货单 | - | - | - | - | - |
| R-10 | 生产工单 | - | - | - | - | - |
| R-11 | MRP/缺料 | - | - | - | - | - |
| R-11 | 采购建议 | - | - | - | - | - |
| 业务规则 | BD-001/BD-004 | - | - | - | - | - |
| 事务完整性 | - | - | - | - | - | - |
| 前端UI | - | - | - | - | - | - |
| **合计** | | - | - | - | - | - |

## 二、缺陷列表

| 缺陷ID | 标题 | 严重程度 | 关联用例 | 状态 | 修复人 | 修复日期 |
|--------|------|---------|---------|------|--------|---------|
| BUG-S3-001 | qty_passed+qty_failed 未校验不超过 qty_delivered | 中 | TC-IQC-B002 | 待修复 | - | - |
| BUG-S3-002 | BD-004：不合格品 disposition=accept 时后端未阻止入库 | 高 | TC-BD004-002 | 待评估 | - | - |
| BUG-S3-003 | 缺料净缺口计算 qty_reserved_other 可能为负数未做保护 | 中 | TC-MRP-B001 | 待评估 | - | - |
| BUG-S3-004 | batchCreatePOFromSuggestions SQL 拼接 supplierId 存在注入风险 | 高 | 安全审查 | 待修复 | - | - |
| BUG-S3-005 | IQC 编号使用 Math.random 存在极低概率重复 | 低 | TC-IQC-B001 | 观察 | - | - |

> 注：BUG-S3-004 来自代码审查：purchase-suggestion.service.ts line 211 存在 supplierId 直接拼接 SQL 的风险，应使用参数化查询。

## 三、修复状态

| 缺陷ID | 修复方案 | 验证结果 |
|--------|---------|---------|
| BUG-S3-001 | 在 updateItems 接口增加 qty_passed + qty_failed <= qty_delivered 业务校验 | - |
| BUG-S3-002 | 方案A：后端在 submit 阶段拦截 result=fail 且 disposition!=return 的明细；方案B：前端限制不合格品 disposition 选项仅为 return | - |
| BUG-S3-003 | qty_reserved_other 使用 GREATEST(val, 0) 处理 | - |
| BUG-S3-004 | 改为参数化查询 VALUES (?,?,?,'${supplierId}',...)  → 使用 ? 占位 | - |
| BUG-S3-005 | 评估是否改为数据库序列保证唯一性 | - |

## 四、风险评估

详见下方"上线风险评估"章节。
```

---

## 上线风险评估

### 风险矩阵

| 风险项 | 风险等级 | 说明 | 缓解措施 |
|--------|---------|------|---------|
| BUG-S3-004 SQL 注入（supplierId 拼接） | 严重 | purchase-suggestion.service.ts line 211 将 supplierId 直接插入 SQL 字符串，攻击者可通过构造 supplierId 注入 SQL | 上线前必须修复，改为参数化查询 |
| BD-004 后端未完全执行 | 高 | 不合格品 disposition=accept 时，后端不生成退货单，也不入库，但无报错提示，导致业务合规风险 | 明确业务边界：由前端彻底封锁此选项，或后端新增校验拦截 |
| BOM 快照 hash 冲突 | 低 | SHA-256 碰撞概率极低，可接受 | 不需要额外措施 |
| IQC/RTN 编号 Math.random 重复 | 低 | 每天 9999 个号段，高并发下可能重复；若发生则插入失败（依赖数据库唯一索引兜底） | 建议升级为数据库自增序列或 Redis INCR，现阶段可接受 |
| 库存并发预留超售 | 中 | UPDATE inventory WHERE qty_on_hand - qty_reserved >= ? 通过条件更新实现乐观锁，但高并发下多工单同时预留时，可能出现总预留量超过实际库存 | 当前实现在极端并发场景下仍有风险，建议加悲观锁或 Redis 分布式锁；MVP 阶段可接受，记录监控告警 |
| 全局缺料汇总查询性能 | 中 | getGlobalShortageSummary 对每个 SKU 额外发起一次 inventory 查询（N+1 问题），数据量大时性能下降 | 优化为 JOIN 一次性查询；上线前若数据量可控则可接受 |
| 工单创建部分失败事务回滚 | 中 | 单张销售订单含多 SKU 时，若第 N 个 SKU 失败，整个事务回滚（符合原子性）但用户体验差（不知道哪个 SKU 有问题） | 改为逐行执行+错误详情列表返回（非 P0，上线后优化） |

### 上线阻断条件

以下条件**必须满足**方可上线：

- [ ] BUG-S3-004（SQL 注入）已修复并通过验证
- [ ] BD-004 业务规则完整落地（前端或后端双重保护）
- [ ] TC-IQC-001 ~ TC-IQC-005（质检核心流程 P0 用例）全部通过
- [ ] TC-PROD-001 ~ TC-PROD-005（工单核心流程 P0 用例）全部通过
- [ ] TC-MRP-001 ~ TC-MRP-007（MRP 核心流程 P0 用例）全部通过
- [ ] TC-BD001-001 ~ TC-BD001-002（BOM 快照锁定 P0 用例）全部通过
- [ ] TC-TXN-001 ~ TC-TXN-004（事务完整性 P0 用例）全部通过
- [ ] 所有 P0 状态机测试用例通过

### 建议上线前额外验证

1. 对 MRP 缺料检测 + 采购建议生成 + 批量转单 执行全链路回归（端到端冒烟测试）
2. 在准生产环境模拟 10 个并发工单创建请求，验证库存预留并发安全性
3. 对 SQL 注入修复后执行安全扫描（OWASP ZAP 或 sqlmap）
4. 验证不同租户（tenantId）数据隔离在所有新接口上的一致性

---

*测试用例文档 — Sprint 3 | 输出人: senior-qa-engineer | 日期: 2026-03-14*
