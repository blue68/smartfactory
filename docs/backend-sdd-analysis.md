# 智造管家 — 后端 SDD 分析文档

**文档版本**：v1.0
**创建日期**：2026-03-11
**分析人**：@senior-backend-engineer
**分析范围**：PRD v1.4、API 文档 v1.0、全部 UI 设计稿（15 页）、现有后端代码全量
**交付给**：@senior-frontend-engineer（联调依据）、@senior-qa-engineer（测试覆盖依据）

---

## 目录

1. [总体评估](#一总体评估)
2. [API 端点完整性审计](#二api-端点完整性审计)
3. [数据库设计审计](#三数据库设计审计)
4. [Service 层设计审计](#四service-层设计审计)
5. [代码质量问题清单](#五代码质量问题清单)
6. [后端开发任务拆解](#六后端开发任务拆解)

---

## 一、总体评估

### 1.1 整体完成度评分

| 维度 | 评分 | 说明 |
|---|---|---|
| API 端点覆盖率 | 72% | 核心 CRUD 基本完整，分析类/报表类端点大量缺失 |
| 数据库设计完整性 | 65% | 核心业务表已建立，报表支撑表、盘点表、Excel导入表缺失 |
| Service 层代码质量 | 78% | 架构合理，存在局部性能问题和缺失的事务边界 |
| 安全性 | 85% | JWT 机制健全，部分接口缺少权限校验中间件 |
| 测试覆盖 | 0% | 当前代码库无任何单元测试或集成测试 |

### 1.2 关键风险识别

**高风险（必须在 Phase 1 上线前修复）**：

1. `inventory.controller.ts` 中 `outbound` 接口未传递 `roles` 到 InventoryService，导致跨缸号授权校验链路断裂
2. `sales.service.ts` 约束引擎仅对 `items[0]` 做检查，多品订单只检查第一个产品，存在漏检
3. `constraintEngine.ts` 插单延期天数使用 `Math.random()` 随机估算，是生产级代码中不可接受的占位逻辑
4. `ai.service.ts` 中 `queryInventory` 查询的是 `inventory_balances` 表，但该表为非实时同步的冗余汇总表，未建立触发器/定时同步机制，数据将长期滞后
5. `skuCode` 生成逻辑使用 `COUNT(*) + 1` 方式，在高并发创建场景下存在竞态条件导致编码重复

**中风险（Phase 1 期间应修复）**：

6. 采购建议 `persistSuggestions` 每条记录单独 INSERT，无批量写入，百条建议性能极差
7. 质量统计 `getQualityStats` 中 `top5Issues` 使用 `Promise.all` 串联多个 N+1 子查询
8. `BomService` 的 `calcMaterialRequirements` 没有循环引用检测（虽然创建时校验，但直接调用计算方法绕过了校验）

---

## 二、API 端点完整性审计

### 2.1 认证模块 `/api/auth`

| 端点 | 方法 | API文档要求 | 实现状态 | 说明 |
|---|---|---|---|---|
| `/api/auth/login` | POST | 是 | 已实现 | 完整，含 bcrypt + JWT + Redis jti |
| `/api/auth/wechat-login` | POST | 是 | 已实现 | 完整 |
| `/api/auth/refresh` | POST | 是 | 已实现 | 完整，含 token rotation |
| `/api/auth/logout` | POST | 否（文档未列） | 已实现 | 功能完整，API 文档需补充 |
| `/api/auth/change-password` | POST | 否（文档未列） | 已实现 | 功能完整，API 文档需补充 |

**缺失端点**：

```
GET  /api/auth/me              — 获取当前登录用户信息（前端 UI 驾驶舱页需要）
POST /api/users                — 用户管理：创建用户（管理员功能，PRD 未明确但运营必需）
PUT  /api/users/:id            — 用户管理：更新用户信息
POST /api/users/:id/bind-wechat — 绑定微信 OpenID（小程序上线必需）
```

---

### 2.2 SKU 主数据模块 `/api/skus`

| 端点 | 方法 | API文档要求 | 实现状态 | 说明 |
|---|---|---|---|---|
| `GET /api/skus/categories` | GET | 是 | 已实现 | 完整 |
| `GET /api/skus` | GET | 是 | 已实现 | 完整，含全文检索 |
| `GET /api/skus/:id` | GET | 是 | 已实现 | 完整，含单位换算 |
| `POST /api/skus` | POST | 是 | 已实现 | 完整，自动生成编码 |
| `PUT /api/skus/:id` | PUT | 是 | 已实现 | 部分，category 字段不可单独更新（见问题清单） |
| `PUT /api/skus/:id/unit-conversions` | PUT | 是 | 已实现 | 完整 |

**缺失端点**：

```
DELETE /api/skus/:id                — 软删除 SKU（PRD F-002，设置 status=inactive）
POST   /api/skus/import             — Excel 批量导入（PRD F-001，Phase 1 核心功能）
GET    /api/skus/import/template    — 下载 Excel 导入模板
GET    /api/skus/:id/barcode        — 获取条码标签（打印场景，PRD F-002）
POST   /api/skus/batch-update-category — 批量补录二级分类（历史导入数据，PRD F-002）
```

**缺失接口详细设计**：

```
POST /api/skus/import
权限: boss / purchaser
Content-Type: multipart/form-data

Request:
  file: Excel 文件（.xlsx）
  fieldMapping: JSON 字符串，字段映射关系（前端字段映射向导提交）

Response 200:
{
  "code": 0,
  "data": {
    "total": 1000,
    "success": 985,
    "failed": 15,
    "duplicates": 8,
    "failedRows": [
      { "row": 12, "reason": "二级分类不存在：木料类" },
      { "row": 45, "reason": "SKU编码重复：BOA00023" }
    ],
    "importJobId": "IMP20260311001"
  },
  "message": "导入完成，成功985条，失败15条"
}

Error Codes:
2010 - 文件格式错误（非 xlsx）
2011 - 文件超过大小限制（> 5MB）
2012 - 字段映射缺少必填字段
```

---

### 2.3 BOM 模块 `/api/bom`

| 端点 | 方法 | API文档要求 | 实现状态 | 说明 |
|---|---|---|---|---|
| `GET /api/bom` | GET | 是 | 已实现 | 完整 |
| `GET /api/bom/:id/expand` | GET | 是 | 已实现 | 完整，含递归展开 |
| `GET /api/bom/:id/material-requirements` | GET | 是 | 已实现 | 完整 |
| `POST /api/bom` | POST | 是 | 已实现 | 完整 |
| `POST /api/bom/:id/activate` | POST | 是 | 已实现 | 完整 |

**缺失端点**：

```
PUT    /api/bom/:id                   — 更新 BOM 基本信息（版本号、描述）
DELETE /api/bom/:id                   — 归档/删除 draft 状态 BOM
POST   /api/bom/:id/items             — 追加 BOM 明细行（不替换全部）
PUT    /api/bom/:id/items/:itemId     — 更新单条 BOM 明细
DELETE /api/bom/:id/items/:itemId     — 删除单条 BOM 明细
POST   /api/bom/import                — Excel 批量导入 BOM（PRD F-005 BOM快速录入向导）
GET    /api/bom/ai-suggestion/:skuId  — AI 辅助 BOM 建议（PRD F-005，基于相似产品推荐）
POST   /api/bom/:id/copy              — 复制 BOM（从相似产品复制后修改，PRD F-005）
```

**缺失接口详细设计（AI BOM 建议）**：

```
GET /api/bom/ai-suggestion/:skuId
权限: boss / supervisor
说明: 基于同一二级分类的其他成品BOM，推荐物料构成建议

Response 200:
{
  "code": 0,
  "data": {
    "skuId": 51,
    "skuName": "三人沙发-B款",
    "suggestions": [
      {
        "componentSkuId": 101,
        "skuName": "沙发框架",
        "referenceBomId": 1,
        "referenceBomSku": "三人沙发-A款",
        "suggestedQty": "1.0000",
        "unit": "套",
        "confidence": 0.92,
        "reason": "同类产品100%使用此物料"
      }
    ],
    "basedOnBoms": [1, 3, 7]
  },
  "message": "操作成功"
}
```

---

### 2.4 库存模块 `/api/inventory`

| 端点 | 方法 | API文档要求 | 实现状态 | 说明 |
|---|---|---|---|---|
| `GET /api/inventory` | GET | 是 | 已实现 | 完整 |
| `GET /api/inventory/:skuId/available` | GET | 是 | 已实现 | 完整 |
| `GET /api/inventory/:skuId/dye-lots` | GET | 是 | 已实现 | 完整 |
| `GET /api/inventory/:skuId/fifo-dye-lot` | GET | 是 | 已实现 | 完整 |
| `POST /api/inventory/inbound` | POST | 是 | 已实现 | 完整，含分布式锁 |
| `POST /api/inventory/outbound` | POST | 是 | 已实现 | 有缺陷，见问题清单 |

**缺失端点**（PRD F-105、F-106、F-107）：

```
GET  /api/inventory/transactions          — 库存流水查询（按SKU/时间/类型筛选，盘点和审计必需）
GET  /api/inventory/transactions/:id      — 流水详情

POST /api/inventory/stocktake/start       — 开始盘点（F-105）
GET  /api/inventory/stocktake/:id         — 获取盘点单（含导出列表）
POST /api/inventory/stocktake/:id/submit  — 提交盘点结果
GET  /api/inventory/stocktake/:id/diff    — 盘点差异分析

POST /api/inventory/waste                 — 录入物料损耗（F-106）
GET  /api/inventory/waste                 — 损耗记录查询

GET  /api/inventory/summary               — 库存结构汇总（按一级/二级分类聚合，F-402/F-405用）
GET  /api/inventory/turnover-stats        — 库存周转率统计（老板驾驶舱，F-401）
```

**缺失接口详细设计（库存流水）**：

```
GET /api/inventory/transactions
权限: boss / purchaser / warehouse / supervisor
Query:
  skuId: integer        — 按SKU筛选
  direction: IN | OUT   — 出入库方向
  transactionType: string — 流水类型
  dateFrom: YYYY-MM-DD
  dateTo: YYYY-MM-DD
  page: integer
  pageSize: integer

Response 200:
{
  "code": 0,
  "data": {
    "list": [
      {
        "id": 1001,
        "transactionNo": "IN20260310123456001",
        "skuId": 200,
        "skuCode": "FAB00001",
        "skuName": "红橡实木板材",
        "transactionType": "PURCHASE_IN",
        "direction": "IN",
        "qtyInput": "2.0000",
        "inputUnit": "箱",
        "qtyStockUnit": "100.0000",
        "stockUnit": "张",
        "dyeLotNo": null,
        "referenceNo": "PO1741680000001",
        "createdAt": "2026-03-10T08:00:00.000Z",
        "createdByName": "张采购"
      }
    ],
    "total": 500,
    "page": 1,
    "pageSize": 20,
    "totalPages": 25
  }
}
```

---

### 2.5 采购模块 `/api/purchase`

| 端点 | 方法 | API文档要求 | 实现状态 | 说明 |
|---|---|---|---|---|
| `POST /api/purchase/suggestions/generate` | POST | 是 | 已实现 | 完整，规则引擎 |
| `GET /api/purchase/suggestions` | GET | 是 | 已实现 | 完整 |
| `POST /api/purchase/suggestions/:id/approve` | POST | 是 | 已实现 | 完整 |
| `GET /api/purchase/orders` | GET | 是 | 已实现 | 完整 |
| `POST /api/purchase/orders` | POST | 是 | 已实现 | 完整 |
| `POST /api/purchase/orders/:id/delivery` | POST | 是 | 已实现 | 完整 |
| `POST /api/purchase/three-way-match` | POST | 是 | 已实现 | 完整 |
| `GET /api/purchase/three-way-match` | GET | 是 | 已实现 | 完整 |
| `POST /api/purchase/three-way-match/:id/confirm` | POST | 是 | 已实现 | 完整 |

**缺失端点**（PRD F-204、F-205、F-207、F-208）：

```
GET  /api/purchase/orders/:id              — 采购订单详情（含明细、送货单关联）
PUT  /api/purchase/orders/:id/status       — 更新采购订单状态（确认/取消）
GET  /api/purchase/orders/:id/delivery     — 查询该PO的送货单列表
GET  /api/purchase/delivery-notes          — 送货单列表（独立查询）
GET  /api/purchase/delivery-notes/:id      — 送货单详情

POST /api/purchase/receipts                — 独立录入入库单（purchase_receipts 表，当前缺少此接口）
GET  /api/purchase/receipts                — 入库单列表

GET  /api/purchase/supplier-performance    — 供应商绩效分析（F-205）
                                            按时率、质量异常率、价格稳定性

GET  /api/prices                           — 价格列表（已有 price 模块但未文档化）
POST /api/prices                           — 新增价格
PUT  /api/prices/:id                       — 更新价格
GET  /api/prices/history/:skuId            — 某SKU价格历史（F-208 按批次/时间段维护）
GET  /api/prices/anomaly                   — 价格异常预警（F-208，超历史均价20%）

GET  /api/purchase/monthly-statement       — 按供应商月度对账单汇总（F-207）
```

**缺失接口详细设计（供应商绩效）**：

```
GET /api/purchase/supplier-performance
权限: boss / purchaser
Query:
  supplierId: integer   — 可选，不传则返回全部
  months: integer       — 统计月数，默认3

Response 200:
{
  "code": 0,
  "data": [
    {
      "supplierId": 3,
      "supplierName": "XX木材有限公司",
      "grade": "A",
      "onTimeRate": "92.5%",       — 准时交货率
      "qualityPassRate": "98.1%",  — 质量合格率（基于三单匹配记录）
      "avgPriceDeviation": "1.2%", — 平均价格偏差率
      "deliveryCount": 24,         — 统计期内送货次数
      "totalAmount": "125000.00",  — 统计期内采购金额
      "anomalyCount": 2            — 价格异常次数
    }
  ],
  "message": "操作成功"
}
```

---

### 2.6 销售订单模块 `/api/sales/orders`

| 端点 | 方法 | API文档要求 | 实现状态 | 说明 |
|---|---|---|---|---|
| `GET /api/sales/orders` | GET | 是 | 已实现 | 完整 |
| `GET /api/sales/orders/:id` | GET | 是 | 已实现 | 完整，含约束检查结果 |
| `POST /api/sales/orders` | POST | 是 | 已实现 | 有缺陷（仅检查第一条明细） |
| `POST /api/sales/orders/:id/approve` | POST | 是 | 已实现 | 完整 |
| `POST /api/sales/orders/analyze-urgent` | POST | 是 | 已实现 | 有缺陷（随机延期天数） |

**缺失端点**（PRD F-701、F-704、F-706、F-707）：

```
PUT  /api/sales/orders/:id              — 修改订单（数量/交期，PRD F-704）
                                          修改前需返回影响分析，已领料部分不可取消
POST /api/sales/orders/:id/cancel       — 取消订单（PRD F-704）
GET  /api/sales/orders/:id/change-impact — 修改影响分析预览（不实际修改）

POST /api/sales/orders/:id/deliver      — 确认出库发货（PRD F-706）
POST /api/sales/orders/:id/confirm-receipt — 客户签收确认（PRD F-706）

GET  /api/sales/statements              — 销售结算单列表（F-707）
POST /api/sales/statements              — 生成结算单
GET  /api/sales/statements/:id          — 结算单详情
PUT  /api/sales/statements/:id/invoice  — 更新开票状态（F-707）

GET  /api/customers                     — 客户列表（已有 customer 模块）
POST /api/customers                     — 创建客户（PRD F-701）
GET  /api/customers/:id                 — 客户详情（含历史订单汇总）
PUT  /api/customers/:id                 — 更新客户信息
GET  /api/customers/:id/credit          — 客户信用额度查询（PRD F-701）
```

**缺失接口详细设计（订单修改影响分析）**：

```
GET /api/sales/orders/:id/change-impact
权限: sales / boss
Query:
  newQty: string        — 新数量（可选）
  newDelivery: string   — 新交期 YYYY-MM-DD（可选）
  action: modify | cancel

Response 200:
{
  "code": 0,
  "data": {
    "orderId": 100,
    "action": "modify",
    "materialImpact": {
      "alreadyConsumed": [
        { "skuId": 200, "skuName": "红橡实木板材", "consumedQty": "30.0000", "unit": "张",
          "note": "已领料，无法退回，将标记为损耗" }
      ],
      "canCancel": [
        { "skuId": 201, "skuName": "五金铰链", "reservedQty": "20.0000", "unit": "个",
          "note": "已预留但未领料，可释放" }
      ]
    },
    "capitalImpact": {
      "releasedCapital": "5000.00",
      "writeOffLoss": "800.00"
    },
    "productionImpact": {
      "completedSteps": ["裁切", "打磨"],
      "pendingSteps": ["组装", "面套缝制"],
      "note": "已完成工序不可取消，将产生人工成本损失"
    }
  },
  "message": "影响分析完成"
}
```

---

### 2.7 生产管理模块 `/api/production`

| 端点 | 方法 | API文档要求 | 实现状态 | 说明 |
|---|---|---|---|---|
| `GET /api/production/orders` | GET | 是 | 已实现 | 完整 |
| `GET /api/production/orders/:id` | GET | 是 | 已实现 | 完整 |
| `POST /api/production/orders` | POST | 是 | 已实现 | 完整 |
| `GET /api/production/schedule/generate` | GET | 是 | 已实现 | 完整，贪心算法 |
| `POST /api/production/schedule/confirm` | POST | 是 | 已实现 | 完整 |
| `GET /api/production/tasks/worker/:workerId` | GET | 是 | 已实现 | 完整 |
| `POST /api/production/tasks/:id/start` | POST | 是 | 已实现 | 完整 |
| `POST /api/production/tasks/:id/complete` | POST | 是 | 已实现 | 完整 |

**缺失端点**（PRD F-306、F-307）：

```
GET  /api/production/dashboard            — 生产进度看板（F-306）
                                            各订单进度百分比、预计完工时间、延误预警
GET  /api/production/orders/:id/progress  — 单工单详细进度（含各工序状态）

POST /api/production/orders/:id/urgent-insert-analysis — 插单影响分析（F-307）
                                                         对已排产计划的影响

GET  /api/production/schedule/:date       — 查询指定日期已确认排产计划
PUT  /api/production/schedule/:date/adjust — 手动调整已确认排产（F-303）

GET  /api/production/workers              — 工人列表（排产需要）
GET  /api/production/workstations         — 工作站列表（排产需要）
POST /api/production/workstations         — 创建工作站
PUT  /api/production/workstations/:id     — 更新工作站

GET  /api/production/capacity-stats       — 产能统计分析（F-403）
```

**缺失接口详细设计（生产进度看板）**：

```
GET /api/production/dashboard
权限: boss / supervisor
Query:
  status: in_progress | pending | delayed  — 可选

Response 200:
{
  "code": 0,
  "data": {
    "summary": {
      "totalOrders": 12,
      "inProgress": 8,
      "delayed": 3,
      "completedToday": 1
    },
    "orders": [
      {
        "productionOrderId": 88,
        "workOrderNo": "WO2026031001",
        "skuName": "三人沙发-A款",
        "salesOrderNo": "SO1741680000100",
        "customerName": "优品家居",
        "qtyPlanned": "5.0000",
        "qtyCompleted": "3.0000",
        "progressPct": 60.0,
        "plannedEnd": "2026-03-18",
        "estimatedEnd": "2026-03-19",
        "isDelayed": true,
        "delayDays": 1,
        "currentStep": "面套缝制",
        "blockedByMaterial": false
      }
    ]
  },
  "message": "操作成功"
}
```

---

### 2.8 质量溯源模块 `/api/quality`

| 端点 | 方法 | API文档要求 | 实现状态 | 说明 |
|---|---|---|---|---|
| `GET /api/quality/inspections` | GET | 是 | 已实现 | 完整 |
| `POST /api/quality/inspections` | POST | 是 | 已实现 | 完整 |
| `POST /api/quality/inspections/issues` | POST | 是 | 已实现 | 完整 |
| `POST /api/quality/inspections/:id/complete` | POST | 是 | 已实现 | 完整 |
| `GET /api/quality/traceability/:productionOrderId` | GET | 是 | 已实现 | 完整 |
| `GET /api/quality/stats` | GET | 是 | 已实现 | 有 N+1 性能问题 |

**缺失端点**：

```
GET /api/quality/inspections/:id         — 验货单详情（含质量问题列表）
GET /api/quality/issues                  — 质量问题列表（跨验货单查询）
PUT /api/quality/issues/:id              — 更新质量问题（补充图片/描述）
GET /api/quality/issues/:id              — 质量问题详情

GET /api/quality/traceability/by-component — 按部件/缸号反向查溯源（F-603）
                                             输入问题部件名，找出所有使用该批次的订单
```

---

### 2.9 AI 对话模块 `/api/ai`

| 端点 | 方法 | 实现状态 | 说明 |
|---|---|---|---|
| `POST /api/ai/chat` | POST | 已实现 | SSE 流式，完整 |
| `GET /api/ai/suggestions` | GET | 已实现 | 主动建议列表 |
| `PUT /api/ai/suggestions/:id/status` | PUT | 已实现 | 状态更新 |
| `POST /api/ai/feedback` | POST | 已实现 | 用户反馈 |

**缺失端点**（PRD F-504）：

```
GET /api/ai/chat/history              — 对话历史记录（F-504）
                                       按会话ID/时间范围查询历史对话
GET /api/ai/chat/sessions             — 会话列表
DELETE /api/ai/chat/sessions/:id      — 清除某会话历史
```

---

### 2.10 供应商模块 `/api/suppliers`

**已实现**（代码中存在 `supplier.service.ts`、`supplier.routes.ts`），但 API 文档未覆盖。

需要文档化的端点：

```
GET    /api/suppliers              — 供应商列表（含等级筛选）
POST   /api/suppliers              — 创建供应商
GET    /api/suppliers/:id          — 供应商详情
PUT    /api/suppliers/:id          — 更新供应商
DELETE /api/suppliers/:id          — 停用供应商
GET    /api/suppliers/:id/skus     — 该供应商的主供SKU列表
```

---

### 2.11 工序配置模块 `/api/process-configs`

**已实现**（代码中存在），但 API 文档未覆盖且未验证完整性。

需要确认/补充的端点：

```
GET    /api/process-configs              — 工序模板列表（F-007）
POST   /api/process-configs             — 创建标准工序模板（含基础工序链）
GET    /api/process-configs/:id         — 工序模板详情（含工序步骤）
PUT    /api/process-configs/:id         — 更新工序模板
POST   /api/process-configs/:id/steps   — 为模板新增工序步骤
PUT    /api/process-configs/:id/steps/:stepId — 更新工序步骤（标准工时等）
DELETE /api/process-configs/:id/steps/:stepId — 删除工序步骤
POST   /api/process-configs/:id/copy    — 从模板复制（款式差异增减，PRD F-007）
```

---

### 2.12 经营分析看板（全部缺失）

PRD F-401 至 F-406 均无对应后端接口，UI 设计稿已完成（`web-dashboard.html`）。

**需新增全部端点**：

```
GET /api/analytics/dashboard              — 老板驾驶舱核心 KPI（F-401）
  Response:
  {
    "activeOrderCount": 12,
    "monthlyOutput": "280000.00",
    "inventoryValue": "520000.00",
    "turnoverDays": 45.2,
    "lowStockCount": 8,
    "delayedOrderCount": 3
  }

GET /api/analytics/inventory-structure    — 库存结构分析（F-402）
  Query: dateFrom, dateTo, granularity(day|week|month)
  返回：原材料/半成品/成品占比趋势 + 原材料内各二级品类分布

GET /api/analytics/material-category-ratio — 物料品类占比分析（F-405）
  Query: skuId(成品ID), compareSkuIds(多品对比), orderId
  返回：BOM展开后各二级品类物料成本占比，饼图+明细

GET /api/analytics/purchase-category      — 采购品类分布分析（F-406）
  Query: period(month|quarter|year), dateFrom, dateTo
  返回：各二级品类采购金额/频次/供应商集中度

GET /api/analytics/production-efficiency  — 生产效率分析（F-403）
  Query: dateFrom, dateTo, workerId, processStepId
  返回：各工序产能利用率、工人效率对比

GET /api/analytics/purchase-cost          — 采购成本分析（F-404）
  Query: dateFrom, dateTo, supplierId, category2Id
  返回：各类物料采购金额趋势、价格波动预警
```

---

## 三、数据库设计审计

### 3.1 现有表结构完整性评估

经过 `init.sql` 全量审计，现已建立的表：

| 表名 | 用途 | 状态 |
|---|---|---|
| `tenants` | 租户表 | 完整 |
| `roles` | 角色表 | 完整 |
| `users` | 用户表 | 完整 |
| `user_roles` | 用户角色关联 | 完整 |
| `sku_categories` | SKU分类 | 完整 |
| `skus` | SKU主数据 | 完整 |
| `sku_unit_conversions` | 单位换算 | 完整 |
| `bom_headers` | BOM表头 | 完整 |
| `bom_items` | BOM明细 | 完整，有冗余字段（`material_sku_id`, `qty_per_unit`） |
| `inventory` | 库存快照 | 完整 |
| `inventory_balances` | 库存余额冗余表 | 存在数据一致性风险（AI模块用但无同步机制） |
| `inventory_dye_lots` | 缸号批次库存 | 完整 |
| `inventory_transactions` | 库存流水 | 完整 |
| `order_dye_lot_bindings` | 生产订单缸号绑定 | 完整 |
| `suppliers` | 供应商表 | 完整，`main_skus` 用 JSON 存储有查询性能问题 |
| `supplier_prices` | 供应商报价 | 完整 |
| `purchase_orders` | 采购订单 | 完整 |
| `purchase_order_items` | 采购订单明细 | 完整 |
| `delivery_notes` | 送货单 | 完整（在SQL末尾，只读到前半部分） |

---

### 3.2 缺失的表

#### 3.2.1 `purchase_receipts` — 独立入库单表（高优先级缺失）

**问题**：三单匹配服务（`ThreeWayMatchService`）引用了 `purchase_receipts` 表（查询 `receipt_no`），但 SQL 中仅依赖 `inventory_transactions` 的 `reference_id` 来找入库数据，没有独立的入库单表。这导致无法建立完整的 PO → 送货单 → 入库单 三单显式关联关系。

**建议新增**：

```sql
CREATE TABLE IF NOT EXISTS `purchase_receipts` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`    BIGINT UNSIGNED NOT NULL,
  `receipt_no`   VARCHAR(50)     NOT NULL COMMENT '入库单号',
  `po_id`        BIGINT UNSIGNED NOT NULL COMMENT '关联采购订单ID',
  `dn_id`        BIGINT UNSIGNED DEFAULT NULL COMMENT '关联送货单ID',
  `warehouse_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '入库仓库（后期扩展多仓）',
  `receipt_date` DATE            NOT NULL,
  `status`       ENUM('pending','confirmed','cancelled') NOT NULL DEFAULT 'pending',
  `notes`        VARCHAR(500)    DEFAULT NULL,
  `created_at`   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_receipt_no` (`tenant_id`, `receipt_no`),
  KEY `idx_tenant_po` (`tenant_id`, `po_id`),
  KEY `idx_tenant_dn` (`tenant_id`, `dn_id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购入库单表';
```

#### 3.2.2 `inventory_stocktakes` — 盘点单表（PRD F-105）

```sql
CREATE TABLE IF NOT EXISTS `inventory_stocktakes` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`    BIGINT UNSIGNED NOT NULL,
  `stocktake_no` VARCHAR(50)     NOT NULL,
  `status`       ENUM('in_progress','completed','cancelled') NOT NULL DEFAULT 'in_progress',
  `stocktake_date` DATE          NOT NULL,
  `notes`        VARCHAR(500)    DEFAULT NULL,
  `created_at`   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_no` (`tenant_id`, `stocktake_no`),
  KEY `idx_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存盘点单';

CREATE TABLE IF NOT EXISTS `inventory_stocktake_items` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT UNSIGNED NOT NULL,
  `stocktake_id`    BIGINT UNSIGNED NOT NULL,
  `sku_id`          BIGINT UNSIGNED NOT NULL,
  `system_qty`      DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '系统账面数量（盘点时快照）',
  `actual_qty`      DECIMAL(16,4)   DEFAULT NULL COMMENT '实盘数量（NULL=未盘）',
  `diff_qty`        DECIMAL(16,4)   DEFAULT NULL COMMENT '差异数量 = actual - system',
  `diff_reason`     VARCHAR(200)    DEFAULT NULL,
  `created_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_stocktake` (`tenant_id`, `stocktake_id`),
  KEY `idx_sku` (`tenant_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存盘点明细';
```

#### 3.2.3 `inventory_waste_records` — 物料损耗记录表（PRD F-106）

```sql
CREATE TABLE IF NOT EXISTS `inventory_waste_records` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `sku_id`              BIGINT UNSIGNED NOT NULL,
  `production_order_id` BIGINT UNSIGNED DEFAULT NULL,
  `process_step_id`     BIGINT UNSIGNED DEFAULT NULL,
  `worker_id`           BIGINT UNSIGNED DEFAULT NULL,
  `waste_qty`           DECIMAL(16,4)   NOT NULL,
  `stock_unit`          VARCHAR(20)     NOT NULL,
  `waste_reason`        ENUM('material_defect','operation_error','design_change','other') NOT NULL,
  `description`         VARCHAR(500)    DEFAULT NULL,
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`),
  KEY `idx_tenant_order` (`tenant_id`, `production_order_id`),
  KEY `idx_created_at` (`tenant_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='物料损耗记录';
```

#### 3.2.4 `sku_import_jobs` — Excel 导入任务表（PRD F-001）

```sql
CREATE TABLE IF NOT EXISTS `sku_import_jobs` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`     BIGINT UNSIGNED NOT NULL,
  `job_no`        VARCHAR(50)     NOT NULL,
  `status`        ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
  `total_rows`    INT UNSIGNED    NOT NULL DEFAULT 0,
  `success_rows`  INT UNSIGNED    NOT NULL DEFAULT 0,
  `failed_rows`   INT UNSIGNED    NOT NULL DEFAULT 0,
  `error_detail`  JSON            DEFAULT NULL COMMENT '失败行详情，含行号和原因',
  `file_path`     VARCHAR(500)    DEFAULT NULL COMMENT '原始文件存储路径',
  `created_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_job_no` (`tenant_id`, `job_no`),
  KEY `idx_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='SKU批量导入任务';
```

#### 3.2.5 `sales_delivery_records` — 销售出库发货记录（PRD F-706）

```sql
CREATE TABLE IF NOT EXISTS `sales_delivery_records` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT UNSIGNED NOT NULL,
  `delivery_no`       VARCHAR(50)     NOT NULL,
  `sales_order_id`    BIGINT UNSIGNED NOT NULL,
  `delivery_date`     DATE            NOT NULL,
  `status`            ENUM('shipped','received','returned') NOT NULL DEFAULT 'shipped',
  `qty_shipped`       DECIMAL(16,4)   NOT NULL,
  `stock_unit`        VARCHAR(20)     NOT NULL,
  `logistics_no`      VARCHAR(100)    DEFAULT NULL,
  `receiver_name`     VARCHAR(100)    DEFAULT NULL,
  `received_at`       DATETIME(3)     DEFAULT NULL,
  `notes`             VARCHAR(500)    DEFAULT NULL,
  `created_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_delivery_no` (`tenant_id`, `delivery_no`),
  KEY `idx_tenant_order` (`tenant_id`, `sales_order_id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='销售出库发货记录';
```

#### 3.2.6 `ai_chat_sessions` / `ai_chat_messages` — AI 对话历史（PRD F-504）

```sql
CREATE TABLE IF NOT EXISTS `ai_chat_sessions` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT UNSIGNED NOT NULL,
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `session_id` VARCHAR(64)     NOT NULL,
  `title`      VARCHAR(200)    DEFAULT NULL COMMENT '会话标题（取第一条消息摘要）',
  `created_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_session_id` (`session_id`),
  KEY `idx_tenant_user` (`tenant_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI对话会话表';

CREATE TABLE IF NOT EXISTS `ai_chat_messages` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT UNSIGNED NOT NULL,
  `session_id`  VARCHAR(64)     NOT NULL,
  `role`        ENUM('user','assistant') NOT NULL,
  `content`     TEXT            NOT NULL,
  `intent`      VARCHAR(50)     DEFAULT NULL COMMENT '识别的意图类型',
  `created_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_session` (`session_id`),
  KEY `idx_tenant_created` (`tenant_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI对话消息记录';
```

#### 3.2.7 `tenant_constraint_configs` — 约束引擎阈值配置表

当前阈值存储在 `tenants.settings` JSON 字段中，缺乏结构化管理和变更历史。

```sql
CREATE TABLE IF NOT EXISTS `tenant_constraint_configs` (
  `id`                           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`                    BIGINT UNSIGNED NOT NULL,
  `max_inventory_turnover_days`  INT UNSIGNED    NOT NULL DEFAULT 90,
  `max_capital_occupation`       DECIMAL(16,2)   NOT NULL DEFAULT 500000,
  `max_capacity_load_ratio`      DECIMAL(5,2)    NOT NULL DEFAULT 0.90,
  `price_anomaly_threshold`      DECIMAL(5,2)    NOT NULL DEFAULT 0.20 COMMENT '价格异常阈值（0.20=20%）',
  `updated_at`                   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `updated_by`                   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户约束引擎配置';
```

---

### 3.3 现有表缺失字段

#### 3.3.1 `suppliers` 表

| 缺失字段 | 类型 | 说明 |
|---|---|---|
| `payment_terms` | VARCHAR(50) | 账期，PRD F-003 明确要求 |
| `lead_time_days` | TINYINT UNSIGNED | 交货周期（天），PRD F-003 明确要求，采购建议生成时用于计算预计到货日期 |
| `bank_account` | VARCHAR(200) | 银行账户（对账单生成用），建议加密存储 |

**迁移 SQL**：

```sql
ALTER TABLE `suppliers`
  ADD COLUMN `payment_terms`   VARCHAR(50)      DEFAULT NULL COMMENT '账期，如：月结30天' AFTER `address`,
  ADD COLUMN `lead_time_days`  TINYINT UNSIGNED NOT NULL DEFAULT 7 COMMENT '交货周期（天）' AFTER `payment_terms`;
```

#### 3.3.2 `sales_orders` 表

| 缺失字段 | 类型 | 说明 |
|---|---|---|
| `approval_notes` | VARCHAR(500) | 审批备注（`approveOrder` 方法中已使用但字段未声明） |
| `approved_by` | BIGINT UNSIGNED | 审批人ID（代码中已 UPDATE 但字段需确认存在） |
| `approved_at` | DATETIME(3) | 审批时间 |
| `cancel_reason` | VARCHAR(500) | 取消原因（F-704 改单管控） |
| `original_snapshot` | JSON | 订单原始数据快照（F-704 完整可追溯要求） |

#### 3.3.3 `bom_items` 表

| 问题 | 说明 |
|---|---|
| `material_sku_id` 与 `component_sku_id` 冗余 | 两个字段语义相同，AI 成本分析模块使用 `material_sku_id`，其他模块使用 `component_sku_id`，需统一为一个字段，另一个改为生成列或删除 |
| `qty_per_unit` 与 `quantity` 冗余 | 同上，应删除冗余字段，在 DAO 层做别名映射 |

**清理建议**（需协调 AI 模块重构后执行）：

```sql
-- 1. 将 ai.service.ts 中的 bom_items 查询改用 component_sku_id 和 quantity
-- 2. 删除冗余字段（需数据迁移确认后执行）
ALTER TABLE `bom_items`
  DROP COLUMN `material_sku_id`,
  DROP COLUMN `qty_per_unit`;
```

#### 3.3.4 `inventory_transactions` 表

| 缺失字段 | 类型 | 说明 |
|---|---|---|
| `cross_dye_lot_authorize_id` | BIGINT UNSIGNED | 跨缸号授权记录ID（`DyeLotAuthorizeService` 校验通过后应记录授权ID以备溯源，当前仅记录 `is_cross_dye_lot` 标记，缺少指向具体授权记录的外键） |

---

### 3.4 索引优化建议

#### 3.4.1 高频查询缺失索引

```sql
-- 采购建议查询（suggestion.service.ts calcTotalMaterialNeeds 高频）
-- 现有：无专用索引覆盖 status + tenant_id 组合
ALTER TABLE `purchase_suggestions`
  ADD INDEX `idx_tenant_status_expired` (`tenant_id`, `status`, `expired_at`);

-- 库存流水按时间范围查询（约束引擎、日均用量计算 高频）
-- 现有：idx_created_at 覆盖但缺少 direction 列
ALTER TABLE `inventory_transactions`
  ADD INDEX `idx_tenant_sku_dir_time` (`tenant_id`, `sku_id`, `direction`, `created_at`);

-- 供应商价格查询（约束引擎内每个 BOM 物料都要查一次，极高频）
-- 现有：idx_tenant_sku_current 已存在，建议改为覆盖索引
ALTER TABLE `supplier_prices`
  ADD INDEX `idx_tenant_sku_current_price` (`tenant_id`, `sku_id`, `is_current`, `price`);

-- 生产工单状态查询（采购建议生成时全量扫描，高频）
-- 建议：添加状态联合索引
ALTER TABLE `production_orders`
  ADD INDEX `idx_tenant_status` (`tenant_id`, `status`);
```

#### 3.4.2 `suppliers.main_skus` JSON 字段问题

当前 `suggestion.service.ts` 使用：

```sql
AND JSON_CONTAINS(s.main_skus, CAST(? AS JSON))
```

此查询无法使用常规 B-Tree 索引，在供应商数量较大时（当前规划35家，未来扩展）会造成全表扫描。

**建议方案**：新增 `supplier_sku_mappings` 关联表替代 JSON 字段：

```sql
CREATE TABLE IF NOT EXISTS `supplier_sku_mappings` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT UNSIGNED NOT NULL,
  `supplier_id` BIGINT UNSIGNED NOT NULL,
  `sku_id`      BIGINT UNSIGNED NOT NULL,
  `is_primary`  TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '是否主供',
  `created_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_supplier_sku` (`tenant_id`, `supplier_id`, `sku_id`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`)    -- 反向查询：某SKU有哪些供应商
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='供应商-SKU关联表';
```

#### 3.4.3 `inventory_balances` 表一致性风险

该表当前是独立的冗余汇总表，`ai.service.ts` 查询它获取可用库存，但没有任何触发器或定时任务来同步 `inventory` 表的变更。这会导致 AI 查询到的库存数据与实际库存产生偏差。

**建议方案（二选一）**：

方案 A（推荐）：将 `inventory_balances` 改为 MySQL VIEW：

```sql
CREATE OR REPLACE VIEW `inventory_balances` AS
SELECT
  inv.id,
  inv.tenant_id,
  inv.sku_id,
  inv.qty_on_hand - inv.qty_reserved AS qty_available,
  inv.qty_on_hand,
  inv.qty_reserved,
  inv.updated_at
FROM inventory inv;
```

方案 B：保留物理表，在 `inventory` 表写入操作后通过 AFTER UPDATE 触发器同步。

---

## 四、Service 层设计审计

### 4.1 各模块职责评审

| Service | 职责清晰度 | 问题描述 |
|---|---|---|
| `AuthService` | 高 | 职责单一，JWT + bcrypt + Redis jti 管理清晰 |
| `SkuService` | 高 | 职责单一，但 `getCategories` 直接用 `AppDataSource.query` 绕过 TenantContext 模式 |
| `InventoryService` | 中 | 职责较重，既做库存快照维护，又处理分布式锁、缸号一致性校验；建议拆出 `DyeLotService` |
| `PurchaseService` | 高 | 职责清晰，PO 和送货单创建封装完整 |
| `SuggestionService` | 中 | 算法逻辑与持久化混在同一方法（`generateSuggestions` 尾部调用 `persistSuggestions`）；建议职责分离 |
| `ThreeWayMatchService` | 高 | 职责清晰，匹配逻辑完整 |
| `SalesService` | 低 | 约束引擎仅检查 `items[0]`，多品订单漏检为严重业务缺陷 |
| `ConstraintEngine` | 中 | 四维检查逻辑正确，但插单延期天数使用 `Math.random()` 不可接受；产能计算假设所有天数为工作日 |
| `ProductionService` | 高 | 职责单一，基本为 SchedulerService 的委托层，无问题 |
| `SchedulerService` | 未读完整 | 需进一步审计贪心算法实现 |
| `QualityService` | 中 | `getQualityStats` 中 `top5Issues` 存在 N+1 子查询 |
| `AiService` | 低 | 查询 `inventory_balances` 非实时表；`cost_analysis` 中引用了 `bom_items.material_sku_id` 别名字段 |
| `BomService` | 未直接审计 | 被多个模块调用，需确认递归展开无栈溢出保护 |

---

### 4.2 跨模块耦合问题

#### 4.2.1 `ConstraintEngine` 直接实例化 `BomService` 和 `InventoryService`

```typescript
// constraintEngine.ts
constructor(ctx: TenantContext) {
  this.bomSvc = new BomService(ctx);
  this.invSvc = new InventoryService(ctx);
}
```

问题：在 `checkCapitalOccupation`、`checkProductionCost`、`calcImpactAnalysis` 三个方法中，均独立调用 `bomSvc.calcMaterialRequirements(bomId, orderQty)`，导致同一次约束检查会对数据库执行 3 次相同的 BOM 物料计算查询。

**修复方案**：在 `check()` 入口一次性计算 BOM 物料需求，结果传递给各子检查方法：

```typescript
async check(skuId, bomId, orderQty, expectedDelivery, isUrgent): Promise<ConstraintCheckReport> {
  await this.loadThresholds();

  // 一次性计算 BOM 物料需求，避免重复查询
  const materials = await this.bomSvc.calcMaterialRequirements(bomId, orderQty);

  const [inventoryCheck, capitalCheck, costCheck, capacityCheck, impact] = await Promise.all([
    this.checkInventoryTurnover(skuId, materials),
    this.checkCapitalOccupation(materials),
    this.checkProductionCost(materials),
    this.checkCapacityLoad(bomId, orderQty, expectedDelivery),
    this.calcImpactAnalysis(materials, orderQty, expectedDelivery, isUrgent),
  ]);
  // ...
}
```

#### 4.2.2 `AiService` 直接实例化 `SuggestionService` 和 `SchedulerService`

当 AI 对话路由到采购建议查询时，`AiService.queryPurchaseSuggestions` 会调用 `SuggestionService.generateSuggestions()`，触发完整的 BOM 展开计算和数据库写入，响应时间可能超过 30 秒 SSE 超时。

**建议**：AI 模块应仅读取已生成的建议列表，不触发生成；或使用异步任务队列（Bull）后台生成后通过 SSE 推送结果。

---

### 4.3 事务边界问题

#### 4.3.1 `SuggestionService.persistSuggestions` 非事务写入

```typescript
// suggestion.service.ts
for (const item of items) {
  await AppDataSource.query(`INSERT INTO purchase_suggestions ...`);
  // 若中途失败，前面已插入的建议无法回滚
}
```

**修复**：包裹在 `AppDataSource.transaction()` 中，同时改为批量 INSERT。

#### 4.3.2 `QualityService.recordQualityIssue` 事务不完整

`recordQualityIssue` 先 INSERT quality_issues，再 UPDATE inspection_records qty_failed，两步操作非事务，若 UPDATE 失败会导致数据不一致。

**修复**：

```typescript
async recordQualityIssue(params): Promise<{ issueId: number }> {
  return AppDataSource.transaction(async (manager) => {
    const result = await manager.query(`INSERT INTO quality_issues ...`);
    await manager.query(`UPDATE inspection_records SET qty_failed = qty_failed + 1 ...`);
    return { issueId: Number(result.insertId) };
  });
}
```

#### 4.3.3 `SalesService.approveOrder` 审批成功后未触发生产工单状态更新

当销售订单从 `pending_approval` 变更为 `confirmed` 时，对应的生产工单（如有）应同步更新优先级或触发排产信号，当前实现仅更新 `sales_orders` 表，无后续联动。

---

### 4.4 错误处理不完善

#### 4.4.1 `InventoryController.outbound` 未传递 `roles`

```typescript
// inventory.controller.ts
private svc(req: Request): InventoryService {
  return new InventoryService({ tenantId: req.tenantId, userId: req.userId });
  // 缺少 roles: req.userRoles
}
```

`InventoryService.outbound` 的 `DyeLotAuthorizeService` 依赖 `this.roles` 来校验授权者是否有 `supervisor` 权限，但 `roles` 始终为空数组 `[]`，导致跨缸号授权校验永远通过或失败（取决于 `DyeLotAuthorizeService` 的实现逻辑）。

**修复**：

```typescript
private svc(req: Request): InventoryService {
  return new InventoryService({
    tenantId: req.tenantId,
    userId: req.userId,
    roles: req.userRoles ?? [],
  });
}
```

同时需要在 `auth.middleware.ts` 中将 `roles` 注入到 `req.userRoles`。

#### 4.4.2 `SkuService.updateSku` 分类变更不完整

```typescript
// sku.service.ts
async updateSku(id: number, params: Partial<CreateSkuParams>) {
  if (params.category1Id && params.category2Id) {
    await this.validateCategories(params.category1Id, params.category2Id);
  }
  const updated = await this.repo.update(id, {
    ...(params.name ? { name: params.name } : {}),
    // category1Id 和 category2Id 未在 update 数据中包含！
  });
}
```

`updateSku` 验证了分类合法性，但实际写入时没有更新 `category1Id` 和 `category2Id` 字段。

---

## 五、代码质量问题清单

### 5.1 严重问题（必须重写）

#### P0-BUG-001：约束引擎多品订单漏检

**文件**：`services/api/src/modules/sales/sales.service.ts`，第 44-51 行

```typescript
// 当前错误实现：
const firstItem = params.items[0];
const constraintReport = await this.constraintEngine.check(
  firstItem.skuId, firstItem.bomId, firstItem.qtyOrdered, ...
);
```

**影响**：多产品订单（如同时下单沙发+柜子）只检查第一个产品的约束，其余产品的物料成本、产能占用均被忽略，可能导致资金超限订单未被拦截。

**修复方案**：

```typescript
// 修复：对每个明细做约束检查，取最严格的综合结果
const reports = await Promise.all(
  params.items.map(item =>
    this.constraintEngine.check(item.skuId, item.bomId, item.qtyOrdered, params.expectedDelivery, isUrgent)
  )
);

// 合并多项检查结果（各维度取最严格的）
const constraintReport = this.constraintEngine.mergeReports(reports);
```

#### P0-BUG-002：插单延期分析使用随机数

**文件**：`services/api/src/modules/sales/constraintEngine.ts`，第 368-370 行

```typescript
// 当前错误实现：
const delayDays = Math.floor(Math.random() * 3) + 1;
```

**影响**：插单影响分析结果完全随机，不反映真实排产情况，老板/车间主管看到的延期天数毫无参考价值，严重损害系统可信度。

**修复方案**：基于实际已排产工时计算延期：

```typescript
private async calcDelayDays(
  existingOrderId: number,
  newOrderHours: Decimal,
  availableCapacity: Decimal,
): Promise<number> {
  // 查询该订单剩余未完成工时
  const [remaining] = await AppDataSource.query<Array<{ hours: string }>>(
    `SELECT COALESCE(SUM(ps.standard_hours * (pt.planned_qty - pt.completed_qty)), 0) AS hours
     FROM production_tasks pt
     INNER JOIN process_steps ps ON ps.id = pt.process_step_id
     WHERE pt.production_order_id = ? AND pt.status IN ('pending', 'in_progress')`,
    [existingOrderId],
  );
  const remainingHours = new Decimal(remaining?.hours ?? 0);
  // 基于新增负荷与剩余容量计算延期天数
  if (availableCapacity.lte(0)) return 1;
  return Math.ceil(newOrderHours.div(availableCapacity).mul(8).toNumber());
}
```

#### P0-BUG-003：SKU 编码并发生成竞态

**文件**：`services/api/src/modules/sku/sku.service.ts`，第 118-131 行

```typescript
// 当前实现（存在竞态）：
const [row] = await AppDataSource.query(
  `SELECT COUNT(*) + 1 AS seq FROM skus WHERE tenant_id = ? AND category2_id = ?`,
  [this.repo.tenantId, cat2Id],
);
return `${prefix}${String(row?.seq ?? 1).padStart(5, '0')}`;
```

两个并发请求可能查到相同的 `seq`，生成相同编码，后续由 `UNIQUE KEY` 抛出重复键错误，但这会导致用户创建 SKU 失败且无法区分是参数错误还是并发问题。

**修复方案**：使用专用序列表或 Redis INCR：

```typescript
private async generateSkuCode(cat2Id: number): Promise<string> {
  const [cat] = await AppDataSource.query<Array<{ code: string }>>(
    'SELECT code FROM sku_categories WHERE id = ? LIMIT 1', [cat2Id],
  );
  const prefix = cat?.code?.slice(0, 3).toUpperCase() ?? 'SKU';

  // 使用 Redis INCR 原子递增，避免并发竞态
  const counterKey = `sku:seq:${this.repo.tenantId}:${cat2Id}`;
  const seq = await getRedisClient().incr(counterKey);
  return `${prefix}${String(seq).padStart(5, '0')}`;
}
```

---

### 5.2 重要问题（需修复但不阻塞上线）

#### P1-PERF-001：采购建议批量写入改造

**文件**：`services/api/src/modules/purchase/suggestion.service.ts`，第 313-329 行

当前逐条 INSERT，100 条建议需要 100 次数据库往返。

**修复**：使用批量 INSERT：

```typescript
private async persistSuggestions(items: SuggestionItem[]): Promise<void> {
  if (items.length === 0) return;

  return AppDataSource.transaction(async (manager) => {
    const expiredAt = new Date(Date.now() + 24 * 3600 * 1000);

    // 先清除本租户当天已过期或 pending 的旧建议（避免重复）
    await manager.query(
      `DELETE FROM purchase_suggestions WHERE tenant_id = ? AND status = 'pending'`,
      [this.tenantId],
    );

    // 批量 INSERT（单次执行）
    const placeholders = items.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const values = items.flatMap(item => [
      this.tenantId, `SG${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      item.skuId, item.suggestedSupplierId, item.suggestedQty, item.purchaseUnit,
      item.estimatedPrice, item.estimatedAmount, item.shortageQty, item.reason,
      item.confidence, item.confidenceDetail, item.dyeLotRequirement,
      'pending', expiredAt, this.userId, this.userId,
    ]);

    await manager.query(
      `INSERT INTO purchase_suggestions
         (tenant_id, suggestion_no, sku_id, suggested_supplier_id, suggested_qty,
          purchase_unit, estimated_price, estimated_amount, shortage_qty, reason,
          confidence, confidence_detail, dye_lot_requirement, status, expired_at,
          created_by, updated_by)
       VALUES ${placeholders}`,
      values,
    );
  });
}
```

#### P1-PERF-002：质量统计 N+1 查询修复

**文件**：`services/api/src/modules/quality/quality.service.ts`，第 293-323 行

`getQualityStats` 中 `top5Issues` 的工人和工序查询使用了串行 `Promise.all` + 多个子查询，实质是 N+1：5 个 top issue × 2 个子查询 = 10 次额外查询。

**修复**：合并为单次 JOIN 查询：

```typescript
// 用单次查询获取 top5 及其关联工人和工序
const top5Rows = await AppDataSource.query(
  `SELECT
     qi.component_name,
     COUNT(*) AS cnt,
     COUNT(DISTINCT po.sales_order_id) AS order_cnt,
     GROUP_CONCAT(DISTINCT u.real_name ORDER BY u.real_name SEPARATOR ',') AS workers,
     GROUP_CONCAT(DISTINCT ps.step_name ORDER BY ps.step_name SEPARATOR ',') AS processes
   FROM quality_issues qi
   INNER JOIN inspection_records ir ON ir.id = qi.inspection_id
   INNER JOIN production_orders po ON po.id = ir.production_order_id
   LEFT JOIN traceability_records tr ON tr.production_order_id = po.id
   LEFT JOIN users u ON u.id = tr.worker_id
   LEFT JOIN process_steps ps ON ps.id = tr.process_step_id
   WHERE qi.tenant_id = ?
     AND qi.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
   GROUP BY qi.component_name
   ORDER BY cnt DESC LIMIT 5`,
  [this.tenantId, periodDays],
);
```

#### P1-TYPE-001：多处 `any` 类型需要强类型化

**位置**：

1. `inventory.service.ts` 中 `listInventory` 的 `AppDataSource.query<any[]>` — 应定义 `InventoryRow` 接口
2. `production.service.ts` 中 `listProductionOrders`、`getProductionOrderDetail` — 大量 `any[]`
3. `sales.service.ts` 中 `listOrders`、`getOrderWithConstraint` — 返回 `any`
4. `ai.service.ts` 中大量 `BusinessData` 的 `Record<string, unknown>` 返回，下游使用时缺乏类型安全

**原则**：所有数据库查询结果必须有对应的接口定义，不允许使用裸 `any`。

#### P1-SEC-001：`inventory_transactions` 中 `production_order_id` 字段写入缺失

**文件**：`services/api/src/modules/inventory/inventory.service.ts`，第 451-464 行

出库流水 INSERT 语句列表中包含 `production_order_id` 字段的位置，但仔细核查发现 INSERT 的列列表实际上没有 `production_order_id`（只有 `is_cross_dye_lot`），而 `OutboundParams` 中的 `productionOrderId` 仅用于缸号一致性校验，并未写入流水记录。这会导致：

- 无法通过流水记录反查某生产工单领了哪些物料（溯源链数据缺失）
- `ThreeWayMatchService.getReceiptItems` 依赖 `reference_id = receiptId`，但出库流水未关联入库单ID

**修复**：在 INSERT 语句中补充 `production_order_id` 写入。

---

### 5.3 一般问题（可在迭代中修复）

| 编号 | 文件 | 问题描述 | 修复建议 |
|---|---|---|---|
| P2-CODE-001 | `purchase.service.ts` `generateNo` | 使用 `Date.now() + random` 生成单号，多节点部署时可能重复 | 改为 Redis INCR 或 Snowflake ID |
| P2-CODE-002 | `sales.service.ts` `generateOrderNo` | 同上 | 同上 |
| P2-CODE-003 | `quality.service.ts` `createInspection` | `inspectionNo` 生成方式同上 | 同上 |
| P2-CODE-004 | `inventory.service.ts` `generateTxNo` | 使用 `Math.random() * 9999`，4位随机数碰撞概率高 | 改为 Redis INCR + 时间戳 |
| P2-CODE-005 | `constraintEngine.ts` `checkCapacityLoad` | 产能计算假设所有天数都是工作日，没有排除周末节假日 | 新增工作日历表或按 5/7 系数折算 |
| P2-CODE-006 | `sku.service.ts` `getCategories` | 直接使用 `AppDataSource.query` 绕过 `TenantContext` 注入模式，`tenant_id IN (0, ?)` 硬编码逻辑混入 Service | 移入 `SkuRepository` 统一管理 |
| P2-CODE-007 | `ai.service.ts` `queryCostAnalysis` | 查询 `bom_items.material_sku_id` 和 `bi.qty_per_unit`（冗余字段），与其他模块使用 `component_sku_id` / `quantity` 不一致 | 统一字段引用，待冗余字段清理后修复 |
| P2-CODE-008 | `threeWayMatch.service.ts` `getReceiptItems` | 通过 `inventory_transactions` 汇总入库数量，而非独立入库单表，与送货单比对精度不足（同一PO多次入库会合并） | 待 `purchase_receipts` 表建立后重构 |
| P2-LOG-001 | 全局 | 所有业务日志使用 `console.log/warn/error`，无结构化日志、无 traceId、无请求上下文 | 引入 `pino` 或 `winston`，注入 requestId |
| P2-CACHE-001 | `inventory.service.ts` | `inventory_balances` 无同步机制（详见数据库审计 3.4.3） | 改为 View 或触发器同步 |

---

## 六、后端开发任务拆解

### 6.1 P0 任务（Phase 1 上线前必须完成）

| 任务ID | 任务名称 | 模块 | 工时估算 | 优先顺序 | 备注 |
|---|---|---|---|---|---|
| BE-P0-001 | 修复多品订单约束引擎漏检（BUG） | sales | 4h | 1 | 阻塞销售下单核心流程 |
| BE-P0-002 | 修复插单延期天数随机数（BUG） | sales/constraintEngine | 8h | 1 | 数据正确性问题 |
| BE-P0-003 | 修复 InventoryController 未传 roles（BUG） | inventory | 2h | 1 | 跨缸号授权失效 |
| BE-P0-004 | 修复 SkuService.updateSku 分类字段未更新（BUG） | sku | 2h | 1 | |
| BE-P0-005 | 新增 `purchase_receipts` 表及 `POST /api/purchase/receipts` 接口 | purchase/db | 6h | 2 | 三单匹配前置依赖 |
| BE-P0-006 | 修复 outbound 流水未写入 production_order_id（BUG） | inventory | 2h | 2 | 溯源链完整性 |
| BE-P0-007 | `inventory_balances` 表改造为 VIEW | db | 3h | 2 | 数据一致性风险 |
| BE-P0-008 | `ConstraintEngine` BOM 重复计算优化 | sales/constraintEngine | 4h | 3 | 约束检查由3次BOM查询降为1次 |
| BE-P0-009 | `SuggestionService.persistSuggestions` 批量INSERT + 事务 | purchase | 3h | 3 | |
| BE-P0-010 | `QualityService.recordQualityIssue` 事务完整性修复 | quality | 1h | 3 | |
| BE-P0-011 | SKU 编码生成改用 Redis INCR，修复并发竞态 | sku | 3h | 3 | |
| BE-P0-012 | SKU Excel 批量导入接口 `POST /api/skus/import` | sku | 16h | 4 | PRD F-001 核心功能，需依赖 xlsx 解析库 |
| BE-P0-013 | 库存流水查询接口 `GET /api/inventory/transactions` | inventory | 6h | 4 | 运营必需 |
| BE-P0-014 | `suppliers` 表补充 `payment_terms`、`lead_time_days` 字段及迁移 | db/supplier | 4h | 4 | PRD F-003 明确要求 |
| BE-P0-015 | `supplier_sku_mappings` 表替换 `suppliers.main_skus` JSON字段 | db/supplier | 8h | 4 | 推荐供应商查询性能 |
| BE-P0-016 | 采购订单详情接口 `GET /api/purchase/orders/:id` | purchase | 4h | 4 | |
| BE-P0-017 | `tenant_constraint_configs` 表及配置读取接口 | db/sales | 4h | 4 | 约束阈值可配置化 |
| BE-P0-018 | API 文档补充：auth/logout、change-password、supplier、process-config 接口 | docs | 4h | 5 | 联调前提交给前端 |

**P0 工时合计**：约 84 人时（约 2.1 人周）

---

### 6.2 P1 任务（Phase 2 核心功能）

| 任务ID | 任务名称 | 模块 | 工时估算 | PRD功能ID | 备注 |
|---|---|---|---|---|---|
| BE-P1-001 | BOM 操作接口补全（更新/删除明细/复制）| bom | 10h | F-005 | |
| BE-P1-002 | AI 辅助 BOM 建议接口 `GET /api/bom/ai-suggestion/:skuId` | bom | 12h | F-005 | 基于相似产品分析 |
| BE-P1-003 | 库存盘点接口组（开始/提交/差异分析）| inventory | 16h | F-105 | 含新增表 |
| BE-P1-004 | 物料损耗录入接口 `POST /api/inventory/waste` | inventory | 6h | F-106 | 含新增表 |
| BE-P1-005 | 库存结构汇总接口 `GET /api/inventory/summary` | inventory | 8h | F-402 | |
| BE-P1-006 | 销售订单修改接口及影响分析 `PUT /api/sales/orders/:id` | sales | 16h | F-704 | 已领料不可取消逻辑复杂 |
| BE-P1-007 | 销售订单取消接口 `POST /api/sales/orders/:id/cancel` | sales | 6h | F-704 | |
| BE-P1-008 | 生产进度看板接口 `GET /api/production/dashboard` | production | 10h | F-306 | |
| BE-P1-009 | 生产排产手动调整接口 `PUT /api/production/schedule/:date/adjust` | production | 8h | F-303 | |
| BE-P1-010 | 质量统计 N+1 查询优化（重构 `getQualityStats`）| quality | 4h | F-604 | 当前有性能问题 |
| BE-P1-011 | 质量问题详情及列表接口补全 | quality | 6h | F-602/F-603 | |
| BE-P1-012 | 供应商绩效分析接口 `GET /api/purchase/supplier-performance` | purchase | 10h | F-205 | |
| BE-P1-013 | 供应商月度对账单接口 `GET /api/purchase/monthly-statement` | purchase | 8h | F-207 | |
| BE-P1-014 | 采购价格管理接口补全（历史记录/异常预警）| price | 8h | F-208 | |
| BE-P1-015 | 客户管理接口补全（CRUD + 信用额度）| customer | 8h | F-701 | |
| BE-P1-016 | AI 对话历史接口组（会话列表/消息历史/清除）| ai | 10h | F-504 | 含新增2张表 |
| BE-P1-017 | `bom_items` 冗余字段清理（`material_sku_id`, `qty_per_unit`）| db/bom | 4h | — | 需同步修改 ai.service.ts |
| BE-P1-018 | 结构化日志改造（引入 `pino`，注入 requestId）| infra | 8h | — | 生产环境运维必需 |
| BE-P1-019 | 单号生成器统一改造（Redis INCR 方案）| shared | 4h | — | 多处单号生成逻辑统一 |
| BE-P1-020 | 工人/工作站管理接口（排产依赖）| production | 8h | F-302 | |

**P1 工时合计**：约 170 人时（约 4.25 人周）

---

### 6.3 P2 任务（Phase 3 精细化运营）

| 任务ID | 任务名称 | 模块 | 工时估算 | PRD功能ID | 备注 |
|---|---|---|---|---|---|
| BE-P2-001 | 老板驾驶舱 KPI 接口 `GET /api/analytics/dashboard` | analytics | 12h | F-401 | 聚合查询需要索引优化 |
| BE-P2-002 | 库存结构分析接口（含二级品类趋势）| analytics | 12h | F-402 | |
| BE-P2-003 | 物料品类占比分析接口 `GET /api/analytics/material-category-ratio` | analytics | 12h | F-405 | BOM展开 + 价格关联计算 |
| BE-P2-004 | 采购品类分布分析接口 | analytics | 10h | F-406 | |
| BE-P2-005 | 生产效率分析接口 | analytics | 10h | F-403 | |
| BE-P2-006 | 采购成本分析接口 | analytics | 8h | F-404 | |
| BE-P2-007 | 销售出库发货/签收接口（交付确认闭环）| sales | 12h | F-706 | 含新增表 |
| BE-P2-008 | 销售财务结算接口（结算单 + 开票跟踪）| sales | 16h | F-707 | 含应收账款管理 |
| BE-P2-009 | 产能工作日历（排除周末/节假日）| production | 8h | F-302 | 当前排产假设所有天为工作日 |
| BE-P2-010 | 安全库存预警实时推送（Bull 队列接入）| inventory/infra | 12h | F-104/F-502 | 当前仅 console.info 占位 |
| BE-P2-011 | 插单影响分析接口完善（真实延期天数计算）| production | 12h | F-307 | 依赖 BE-P0-002 修复 |
| BE-P2-012 | 应用性能监控接入（P95 响应时间告警）| infra | 8h | 非功能 | 满足 PRD 4.1 性能要求 |
| BE-P2-013 | 私有化部署配置（离线模式、AI 降级策略）| infra | 16h | 非功能 4.6 | SaaS/私有化双模式 |
| BE-P2-014 | 数据导出接口（库存/采购/销售 Excel/CSV 导出）| shared | 12h | 非功能 4.5 | |
| BE-P2-015 | 全量接口压测 + 慢查询优化 | infra | 16h | 非功能 4.1 | 目标 P95 < 2秒 |

**P2 工时合计**：约 176 人时（约 4.4 人周）

---

### 6.4 总工时汇总

| 优先级 | 任务数 | 工时估算 | 折合人周（按40h/周） |
|---|---|---|---|
| P0（Phase 1 上线前必须） | 18 项 | 84h | 2.1 人周 |
| P1（Phase 2 核心功能） | 20 项 | 170h | 4.25 人周 |
| P2（Phase 3 精细化） | 15 项 | 176h | 4.4 人周 |
| **合计** | **53 项** | **430h** | **10.75 人周** |

---

### 6.5 立即启动建议（本周内）

按紧迫程度排序，建议本周优先处理：

1. **今天**：修复 BE-P0-001（多品订单漏检）、BE-P0-003（roles 未传递）、BE-P0-006（production_order_id 未写入流水）—— 三个 BUG 均为逻辑错误，修复成本极低（合计 < 8h）
2. **本周内**：完成 BE-P0-007（inventory_balances 改为 VIEW）、BE-P0-009（批量写入建议）、BE-P0-010（事务修复）
3. **本周内启动**：BE-P0-012（Excel 导入，工期最长 16h，Phase 1 验收标准要求）和 BE-P0-005（purchase_receipts 表，三单匹配完整性前提）

---

*本文档基于代码库截至 2026-03-11 的快照分析生成。后续每次架构变更后需同步更新本文档。*
*@senior-frontend-engineer：联调请以本文档 Section 2 的"缺失端点详细设计"为接口规范，在后端实现前可 mock 数据联调。*
*@senior-qa-engineer：Section 五"代码质量问题清单"中标记 P0 的所有 BUG 均需有对应测试用例覆盖。*
