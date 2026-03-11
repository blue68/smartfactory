# [artifact:API文档] 智造管家 — API 接口文档

**产品名称**：智造管家（SmartFactory Agent）
**文档版本**：v1.0
**创建日期**：2026-03-11
**Base URL**：`https://api.smartfactory.com`（SaaS）/ `http://localhost:3000`（私有化）
**负责人**：@senior-backend-engineer
**交付给**：@senior-frontend-engineer（联调）、@senior-qa-engineer（测试）

---

## 一、全局约定

### 1.1 统一响应结构

所有接口均返回以下 JSON 结构：

```json
{
  "code": 0,
  "data": { },
  "message": "操作成功"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | number | 0 = 成功；非 0 = 业务错误码 |
| `data` | any | 业务数据，失败时为 `null` |
| `message` | string | 人类可读的结果描述 |

### 1.2 认证方式

除认证模块外，所有接口必须在 Header 中携带：

```
Authorization: Bearer <access_token>
```

Token 有效期 7 天，过期后通过 `/api/auth/refresh` 刷新。

### 1.3 分页参数（公共 Query）

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `page` | integer | 1 | 页码（从 1 开始） |
| `pageSize` | integer | 20 | 每页条数（最大 200） |

分页响应 `data` 结构：

```json
{
  "list": [],
  "total": 100,
  "page": 1,
  "pageSize": 20,
  "totalPages": 5
}
```

### 1.4 全局错误码

| code | HTTP 状态 | 含义 |
|---|---|---|
| `0` | 200/201 | 成功 |
| `1001` | 400 | 参数校验失败 |
| `1002` | 401 | 未认证 / Token 无效或过期 |
| `1003` | 403 | 权限不足 |
| `1004` | 404 | 资源不存在 |
| `1005` | 409 | 数据冲突（重复） |
| `1099` | 500 | 服务内部错误 |

---

## 二、认证模块 `/api/auth`

### 2.1 账号密码登录

```
POST /api/auth/login
```

**无需认证**

**Request Body**

```json
{
  "username": "admin",
  "password": "Admin@123",
  "tenantCode": "FACTORY001"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `username` | string | 是 | 登录账号 |
| `password` | string | 是 | 登录密码 |
| `tenantCode` | string | 是 | 租户唯一编码 |

**Response 200**

```json
{
  "code": 0,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "username": "admin",
      "realName": "张三",
      "roles": ["boss"],
      "tenantId": 1,
      "tenantName": "示范工厂"
    }
  },
  "message": "登录成功"
}
```

**Error Codes**

| code | 说明 |
|---|---|
| `1001` | 参数缺失或格式错误 |
| `1002` | 用户名或密码错误 |
| `1003` | 账号被锁定或已停用 |
| `1004` | 租户不存在 |

---

### 2.2 微信小程序登录

```
POST /api/auth/wechat-login
```

**无需认证**

**Request Body**

```json
{
  "openid": "oXXXXXXXXXXXXXXXXXXXXXXX",
  "tenantCode": "FACTORY001"
}
```

**Response 200** — 结构同 2.1

**Error Codes**

| code | 说明 |
|---|---|
| `1004` | OpenID 未绑定系统用户 |

---

### 2.3 刷新 Access Token

```
POST /api/auth/refresh
```

**无需认证**

**Request Body**

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response 200**

```json
{
  "code": 0,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  },
  "message": "令牌已刷新"
}
```

**Error Codes**

| code | 说明 |
|---|---|
| `1002` | refreshToken 无效或已过期 |

---

## 三、SKU 主数据模块 `/api/skus`

### 3.1 获取 SKU 分类列表

```
GET /api/skus/categories
```

**Response 200**

```json
{
  "code": 0,
  "data": [
    { "id": 1, "level": 1, "parentId": null, "code": "RAW_MATERIAL", "name": "原材料", "sortOrder": 1 },
    { "id": 10, "level": 2, "parentId": 1, "code": "FABRIC", "name": "面料类", "sortOrder": 3 }
  ],
  "message": "操作成功"
}
```

---

### 3.2 SKU 列表查询

```
GET /api/skus
```

**Query Parameters**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `page` | integer | 否 | 页码，默认 1 |
| `pageSize` | integer | 否 | 每页数，默认 20 |
| `category1Id` | integer | 否 | 一级分类 ID 筛选 |
| `category2Id` | integer | 否 | 二级分类 ID 筛选 |
| `keyword` | string | 否 | 关键字（匹配名称/规格，全文搜索） |
| `hasDyeLot` | boolean | 否 | `true`=仅面料类缸号SKU |
| `status` | string | 否 | `active` / `inactive` |

**Response 200**

```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "id": 101,
        "tenantId": 1,
        "skuCode": "FAB00001",
        "barcode": "6901234567890",
        "name": "红橡实木板材",
        "spec": "2440×1220×18mm",
        "category1Id": 1,
        "category2Id": 10,
        "category1Name": "原材料",
        "category2Name": "板材类",
        "stockUnit": "张",
        "purchaseUnit": "张",
        "productionUnit": "张",
        "hasDyeLot": false,
        "safetyStock": "50.0000",
        "status": "active"
      }
    ],
    "total": 128,
    "page": 1,
    "pageSize": 20,
    "totalPages": 7
  },
  "message": "操作成功"
}
```

---

### 3.3 获取单个 SKU（含单位换算）

```
GET /api/skus/:id
```

**Path Parameters**

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | integer | SKU ID |

**Response 200**

```json
{
  "code": 0,
  "data": {
    "id": 101,
    "skuCode": "FAB00001",
    "name": "红橡实木板材",
    "hasDyeLot": false,
    "unitConversions": [
      {
        "fromUnit": "箱",
        "toUnit": "张",
        "conversionRate": "50.000000",
        "description": "1箱=50张"
      }
    ]
  },
  "message": "操作成功"
}
```

**Error Codes**

| code | 说明 |
|---|---|
| `2001` | SKU 不存在 |

---

### 3.4 创建 SKU

```
POST /api/skus
```

**Request Body**

```json
{
  "name": "红橡实木板材",
  "spec": "2440×1220×18mm",
  "category1Id": 1,
  "category2Id": 10,
  "stockUnit": "张",
  "purchaseUnit": "箱",
  "productionUnit": "张",
  "hasDyeLot": false,
  "safetyStock": "50",
  "description": "A级红橡木"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | SKU名称（最长200字符） |
| `category1Id` | integer | 是 | 一级分类ID |
| `category2Id` | integer | 是 | 二级分类ID（须属于category1） |
| `stockUnit` | string | 是 | 库存单位 |
| `purchaseUnit` | string | 是 | 采购单位 |
| `productionUnit` | string | 是 | 生产领用单位 |
| `skuCode` | string | 否 | SKU编码（不填则自动生成） |
| `hasDyeLot` | boolean | 否 | 是否启用缸号（面料类自动强制开启） |
| `safetyStock` | string | 否 | 安全库存数量 |

**Response 201**

```json
{
  "code": 0,
  "data": { "id": 102, "skuCode": "BOA00001", "tenantId": 1, "name": "红橡实木板材" },
  "message": "SKU已创建"
}
```

**Error Codes**

| code | 说明 |
|---|---|
| `2002` | SKU编码已存在 |
| `2003` | 二级分类不属于所选一级分类 |

---

### 3.5 更新 SKU

```
PUT /api/skus/:id
```

**Request Body** — 同 3.4，所有字段可选（部分更新）

**Response 200**

```json
{ "code": 0, "data": { "id": 101, "name": "红橡实木板材（A级）" }, "message": "SKU已更新" }
```

---

### 3.6 配置单位换算关系

```
PUT /api/skus/:id/unit-conversions
```

**Request Body**

```json
{
  "conversions": [
    {
      "fromUnit": "箱",
      "toUnit": "张",
      "conversionRate": "50.000000",
      "description": "1箱=50张"
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `conversions` | array | 是 | 换算关系列表（至少1条） |
| `conversions[].fromUnit` | string | 是 | 来源单位 |
| `conversions[].toUnit` | string | 是 | 目标单位（通常为库存单位） |
| `conversions[].conversionRate` | string | 是 | 换算系数（精度 6 位小数） |

**Response 200**

```json
{ "code": 0, "data": [{ "fromUnit": "箱", "toUnit": "张", "conversionRate": "50.000000" }], "message": "单位换算关系已保存" }
```

---

## 四、BOM 模块 `/api/bom`

### 4.1 BOM 列表

```
GET /api/bom
```

**Query Parameters**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `skuId` | integer | 否 | 按产品 SKU 筛选 |

**Response 200**

```json
{
  "code": 0,
  "data": [
    {
      "id": 1,
      "skuId": 50,
      "skuName": "三人沙发-A款",
      "version": "1.0",
      "status": "active"
    }
  ],
  "message": "操作成功"
}
```

---

### 4.2 BOM 多层展开

```
GET /api/bom/:id/expand
```

**Response 200**

```json
{
  "code": 0,
  "data": {
    "id": 1,
    "skuId": 50,
    "skuName": "三人沙发-A款",
    "version": "1.0",
    "status": "active",
    "items": [
      {
        "bomItemId": 1,
        "componentSkuId": 101,
        "skuCode": "BOA00001",
        "skuName": "沙发框架",
        "spec": null,
        "quantity": "1.0000",
        "unit": "套",
        "scrapRate": "0.0000",
        "netQuantity": "1.0000",
        "level": 1,
        "children": [
          {
            "bomItemId": 10,
            "componentSkuId": 200,
            "skuCode": "FAB00001",
            "skuName": "红橡实木板材",
            "quantity": "3.0000",
            "unit": "张",
            "scrapRate": "0.0500",
            "netQuantity": "3.1500",
            "level": 2,
            "children": []
          }
        ]
      }
    ]
  },
  "message": "操作成功"
}
```

**Error Codes**

| code | 说明 |
|---|---|
| `3001` | BOM 不存在 |

---

### 4.3 物料需求计算

```
GET /api/bom/:id/material-requirements?productionQty=10
```

**Query Parameters**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `productionQty` | number | 是 | 计划生产数量 |

**Response 200**

```json
{
  "code": 0,
  "data": [
    {
      "skuId": 200,
      "skuCode": "FAB00001",
      "skuName": "红橡实木板材",
      "spec": "2440×1220×18mm",
      "stockUnit": "张",
      "purchaseUnit": "箱",
      "hasDyeLot": false,
      "totalQty": "31.5000",
      "unit": "张"
    }
  ],
  "message": "操作成功"
}
```

---

### 4.4 创建 BOM

```
POST /api/bom
```

**Request Body**

```json
{
  "skuId": 50,
  "version": "1.0",
  "description": "标准版BOM",
  "items": [
    {
      "componentSkuId": 101,
      "quantity": "1",
      "unit": "套",
      "scrapRate": "0",
      "sortOrder": 1,
      "children": [
        {
          "componentSkuId": 200,
          "quantity": "3",
          "unit": "张",
          "scrapRate": "0.05",
          "sortOrder": 1
        }
      ]
    }
  ]
}
```

**Response 201**

```json
{ "code": 0, "data": { "id": 5 }, "message": "BOM已创建" }
```

**Error Codes**

| code | 说明 |
|---|---|
| `3002` | 检测到循环引用，或层级超过10层 |

---

### 4.5 激活 BOM

```
POST /api/bom/:id/activate
```

激活后，同一 SKU 的其他 active BOM 自动归档。

**Response 200**

```json
{ "code": 0, "data": null, "message": "BOM已激活" }
```

---

## 五、库存模块 `/api/inventory`

### 5.1 库存总览

```
GET /api/inventory
```

**Query Parameters**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `page` | integer | 否 | 页码 |
| `pageSize` | integer | 否 | 每页数 |
| `category1Id` | integer | 否 | 一级分类筛选 |
| `category2Id` | integer | 否 | 二级分类筛选 |
| `keyword` | string | 否 | 关键字（名称/编码） |
| `belowSafety` | boolean | 否 | `true`=只看低于安全库存 |

**Response 200**

```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "skuId": 200,
        "skuCode": "FAB00001",
        "skuName": "红橡实木板材",
        "stockUnit": "张",
        "safetyStock": "50.0000",
        "qtyOnHand": "120.0000",
        "qtyReserved": "30.0000",
        "qtyInTransit": "50.0000",
        "qtyAvailable": "90.0000",
        "isBelowSafety": false,
        "hasDyeLot": false
      }
    ],
    "total": 45,
    "page": 1,
    "pageSize": 20,
    "totalPages": 3
  },
  "message": "操作成功"
}
```

---

### 5.2 查询 SKU 可用库存

```
GET /api/inventory/:skuId/available
```

**Response 200**

```json
{
  "code": 0,
  "data": {
    "qtyOnHand": "120.0000",
    "qtyReserved": "30.0000",
    "qtyAvailable": "90.0000",
    "stockUnit": "张"
  },
  "message": "操作成功"
}
```

---

### 5.3 缸号批次详情

```
GET /api/inventory/:skuId/dye-lots
```

仅面料/皮料类 SKU（`hasDyeLot=true`）有效。

**Response 200**

```json
{
  "code": 0,
  "data": [
    {
      "dyeLotNo": "DL20260101A",
      "qtyOnHand": "80.0000",
      "qtyReserved": "20.0000",
      "qtyAvailable": "60.0000",
      "firstInAt": "2026-01-01T08:00:00.000Z",
      "lastInAt": "2026-01-15T10:30:00.000Z"
    }
  ],
  "message": "操作成功"
}
```

---

### 5.4 先进先出缸号推荐

```
GET /api/inventory/:skuId/fifo-dye-lot?qty=50
```

**Query Parameters**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `qty` | string | 是 | 所需数量（库存单位） |

**Response 200** — 按 FIFO 顺序返回建议使用的缸号列表，格式同 5.3。

---

### 5.5 采购入库

```
POST /api/inventory/inbound
```

**权限**：`warehouse` / `boss` / `purchaser`

**Request Body**

```json
{
  "skuId": 200,
  "qtyInput": "2",
  "inputUnit": "箱",
  "transactionType": "PURCHASE_IN",
  "dyeLotNo": "DL20260310B",
  "referenceType": "purchase_receipt",
  "referenceId": 15,
  "referenceNo": "RC2026031001",
  "batchCost": "1200.00",
  "notes": "供应商：XX木材"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `skuId` | integer | 是 | SKU ID |
| `qtyInput` | string | 是 | 录入数量（录入单位） |
| `inputUnit` | string | 是 | 录入单位（系统自动换算为库存单位） |
| `transactionType` | string | 是 | `PURCHASE_IN` / `PRODUCTION_IN` / `ADJUSTMENT_IN` |
| `dyeLotNo` | string | 条件必填 | 面料/皮料类 SKU 必填 |
| `referenceType` | string | 否 | 关联单据类型 |
| `referenceId` | integer | 否 | 关联单据 ID |
| `batchCost` | string | 否 | 批次单价（用于成本追踪） |

**Response 201**

```json
{
  "code": 0,
  "data": {
    "transactionNo": "IN20260310123456001",
    "newQtyOnHand": "220.0000"
  },
  "message": "入库成功"
}
```

**Error Codes**

| code | 说明 |
|---|---|
| `4002` | 面料类 SKU 未填写缸号 |
| `4003` | 获取分布式锁失败（并发冲突，稍后重试） |
| `1001` | 单位不存在对应换算规则 |

---

### 5.6 领料出库

```
POST /api/inventory/outbound
```

**权限**：`warehouse` / `supervisor`

**Request Body**

```json
{
  "skuId": 200,
  "qtyInput": "10",
  "inputUnit": "张",
  "transactionType": "MATERIAL_OUT",
  "dyeLotNo": "DL20260101A",
  "productionOrderId": 88,
  "referenceType": "production_order",
  "referenceId": 88,
  "referenceNo": "WO2026031001"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `transactionType` | string | 是 | `MATERIAL_OUT` / `DELIVERY_OUT` / `ADJUSTMENT_OUT` |
| `dyeLotNo` | string | 条件必填 | 面料类必填 |
| `productionOrderId` | integer | 否 | 传入时触发缸号一致性校验 |

**Response 200**

```json
{
  "code": 0,
  "data": {
    "transactionNo": "OUT20260310123456002",
    "newQtyOnHand": "110.0000"
  },
  "message": "出库成功"
}
```

**Error Codes**

| code | 说明 |
|---|---|
| `4001` | 库存不足 |
| `4002` | 面料类 SKU 未填写缸号 |
| `4003` | 获取分布式锁失败 |
| `4004` | 跨缸号操作（已记录警告标记，仍成功） |

---

## 六、采购模块 `/api/purchase`

### 6.1 触发生成采购建议

```
POST /api/purchase/suggestions/generate
```

**权限**：`boss` / `purchaser`

触发 Phase 1 规则引擎，基于当前在产订单 BOM 展开、库存缺口、安全库存计算采购建议。

**Response 200**

```json
{
  "code": 0,
  "data": [
    {
      "skuId": 200,
      "skuCode": "FAB00001",
      "skuName": "红橡实木板材",
      "suggestedSupplierId": 3,
      "supplierName": "XX木材有限公司",
      "suggestedQty": "5.00",
      "purchaseUnit": "箱",
      "estimatedPrice": "600.00",
      "estimatedAmount": "3000.00",
      "shortageQty": "3.00",
      "reason": "当前有2个在产订单共需要315.00张，当前可用库存90.00张，缺口225.00张，建议立即采购",
      "confidence": "high",
      "confidenceDetail": "高置信度：基于近30天15次充足历史数据",
      "dyeLotRequirement": null
    }
  ],
  "message": "已生成 1 条采购建议"
}
```

---

### 6.2 采购建议列表

```
GET /api/purchase/suggestions
```

**Query Parameters**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `status` | string | 否 | `pending` / `approved` / `rejected` / `executed` / `expired` |
| `page` | integer | 否 | 页码 |
| `pageSize` | integer | 否 | 每页数 |

**Response 200** — 分页结构，每条含建议详情。

---

### 6.3 审批采购建议

```
POST /api/purchase/suggestions/:id/approve
```

**权限**：`boss`

**Request Body**

```json
{
  "approved": true,
  "rejectReason": null
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `approved` | boolean | 是 | `true`=批准，`false`=驳回 |
| `rejectReason` | string | 条件必填 | 驳回时必须填写原因 |

**Response 200**

```json
{ "code": 0, "data": null, "message": "审批通过" }
```

---

### 6.4 采购订单列表

```
GET /api/purchase/orders
```

**Query Parameters**：`status`、`supplierId`、`page`、`pageSize`

---

### 6.5 创建采购订单

```
POST /api/purchase/orders
```

**权限**：`purchaser` / `boss`

**Request Body**

```json
{
  "supplierId": 3,
  "suggestionId": 12,
  "expectedDate": "2026-03-20",
  "notes": "加急处理",
  "items": [
    {
      "skuId": 200,
      "qtyOrdered": "5",
      "purchaseUnit": "箱",
      "unitPrice": "600.00"
    }
  ]
}
```

**Response 201**

```json
{
  "code": 0,
  "data": { "id": 25, "poNo": "PO1741680000001" },
  "message": "采购订单已创建"
}
```

**Error Codes**

| code | 说明 |
|---|---|
| `5001` | 关联采购订单不存在 |

---

### 6.6 录入送货单

```
POST /api/purchase/orders/:id/delivery
```

**权限**：`purchaser`

**Request Body**

```json
{
  "poId": 25,
  "deliveryDate": "2026-03-19",
  "notes": "随附质检报告",
  "items": [
    {
      "skuId": 200,
      "qtyDelivered": "5",
      "purchaseUnit": "箱",
      "unitPrice": "600.00"
    }
  ]
}
```

**Response 201**

```json
{ "code": 0, "data": { "id": 30, "deliveryNo": "DN1741680000030" }, "message": "送货单已录入" }
```

---

### 6.7 执行三单匹配

```
POST /api/purchase/three-way-match
```

**权限**：`purchaser`

**Request Body**

```json
{
  "poId": 25,
  "deliveryNoteId": 30,
  "receiptId": 15
}
```

**Response 200**

```json
{
  "code": 0,
  "data": {
    "matchId": 8,
    "poId": 25,
    "poNo": "PO1741680000001",
    "deliveryNoteId": 30,
    "deliveryNo": "DN1741680000030",
    "receiptId": 15,
    "receiptNo": "RC2026031001",
    "matchStatus": "qty_diff",
    "diffItems": [
      {
        "skuId": 200,
        "skuName": "红橡实木板材",
        "poQty": "5.0000",
        "poUnit": "箱",
        "poPrice": "600.00",
        "dnQty": "5.0000",
        "dnPrice": "600.00",
        "receiptQty": "4.0000",
        "qtyDiff": "-1.0000",
        "priceDiff": "0.00",
        "isPriceAnomaly": false,
        "historicalAvgPrice": "580.00"
      }
    ],
    "createdAt": "2026-03-11T07:00:00.000Z",
    "confirmedAt": null,
    "confirmedBy": null,
    "diffReason": null,
    "diffNotes": null
  },
  "message": "操作成功"
}
```

匹配状态说明：

| matchStatus | 含义 |
|---|---|
| `matched` | 三单完全一致，自动完成 |
| `qty_diff` | 数量存在差异，需人工确认 |
| `price_diff` | 价格存在差异，需人工确认 |
| `price_warning` | 数量一致但价格超历史均价 20% |

**Error Codes**

| code | 说明 |
|---|---|
| `5002` | 送货单或入库单与PO不匹配 |

---

### 6.8 三单匹配列表

```
GET /api/purchase/three-way-match
```

**Query Parameters**：`status`、`supplierId`、`page`、`pageSize`

---

### 6.9 确认差异

```
POST /api/purchase/three-way-match/:id/confirm
```

**权限**：`purchaser`

**Request Body**

```json
{
  "diffReason": "supplier_short",
  "diffNotes": "供应商确认少发1箱，下次补货"
}
```

| `diffReason` 枚举值 | 说明 |
|---|---|
| `supplier_short` | 供应商少发 |
| `receipt_miss` | 入库漏录 |
| `price_adjust` | 价格调整 |
| `other` | 其他 |

**Response 200**

```json
{ "code": 0, "data": null, "message": "差异已确认" }
```

---

## 七、销售订单模块 `/api/sales/orders`

### 7.1 销售订单列表

```
GET /api/sales/orders
```

**Query Parameters**：`status`、`customerId`、`page`、`pageSize`

---

### 7.2 获取订单详情（含约束检查结果）

```
GET /api/sales/orders/:id
```

**Response 200**

```json
{
  "code": 0,
  "data": {
    "id": 100,
    "orderNo": "SO1741680000100",
    "customerName": "优品家居有限公司",
    "orderType": "normal",
    "status": "confirmed",
    "priority": 50,
    "expectedDelivery": "2026-03-25",
    "totalAmount": "25000.00",
    "constraintResult": "pass",
    "blockedReasons": [],
    "impactAnalysis": {
      "affectedOrders": [],
      "additionalCapital": "15000.00",
      "turnoverDaysChange": "+0~2",
      "additionalProductionCost": "2250.00"
    },
    "items": [
      {
        "skuId": 50,
        "skuName": "三人沙发-A款",
        "qtyOrdered": "5.0000",
        "unitPrice": "5000.00",
        "amount": "25000.00"
      }
    ]
  },
  "message": "操作成功"
}
```

**Error Codes**

| code | 说明 |
|---|---|
| `6002` | 销售订单不存在 |

---

### 7.3 创建销售订单（含约束引擎检查）

```
POST /api/sales/orders
```

**权限**：`sales` / `boss`

**Request Body**

```json
{
  "customerId": 5,
  "orderType": "normal",
  "expectedDelivery": "2026-03-25",
  "notes": "客户指定A款面料",
  "items": [
    {
      "skuId": 50,
      "bomId": 1,
      "qtyOrdered": "5",
      "unitPrice": "5000.00"
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `orderType` | string | 否 | `normal`（默认）/ `urgent`（触发插单分析） |
| `items[].bomId` | integer | 是 | 关联 BOM ID（用于约束引擎物料计算） |

**约束引擎四维检查**（服务端自动执行）：

| 维度 | 检查内容 | 拦截条件 |
|---|---|---|
| 库存周转天数 | 新增物料占用后的库存周转天数 | 超过90天 |
| 资金占用 | 累计在产资金占用 | 超过50万元（可配置） |
| 生产成本 | 物料成本与历史均值对比 | 仅警告，不拦截 |
| 产能负荷 | 交期前排产工时利用率 | 超过90% |

**Response 201（通过约束）**

```json
{
  "code": 0,
  "data": {
    "orderId": 100,
    "orderNo": "SO1741680000100",
    "constraintResult": "pass",
    "estimatedDelivery": null,
    "requiresApproval": false
  },
  "message": "订单创建成功"
}
```

**Response 201（触发约束，进入审批）**

```json
{
  "code": 0,
  "data": {
    "orderId": 101,
    "orderNo": "SO1741680000101",
    "constraintResult": "block",
    "requiresApproval": true
  },
  "message": "订单已提交，等待审批"
}
```

---

### 7.4 审批超限订单

```
POST /api/sales/orders/:id/approve
```

**权限**：`boss`

**Request Body**

```json
{
  "action": "approved",
  "notes": "特批，需在3月28日前完成"
}
```

| `action` 枚举值 | 说明 |
|---|---|
| `approved` | 批准（直接放行） |
| `rejected` | 驳回（退回销售修改） |
| `conditional` | 附条件批准（notes 中填写调整要求） |

**Response 200**

```json
{ "code": 0, "data": null, "message": "审批操作已完成" }
```

---

### 7.5 紧急插单影响分析

```
POST /api/sales/orders/analyze-urgent
```

**权限**：`sales` / `boss` / `supervisor`

不创建真实订单，仅返回影响分析报告（< 30 秒）。

**Request Body**

```json
{
  "skuId": 50,
  "bomId": 1,
  "qty": "3",
  "expectedDelivery": "2026-03-20"
}
```

**Response 200**

```json
{
  "code": 0,
  "data": {
    "overallResult": "block",
    "inventoryTurnoverCheck": {
      "passed": true,
      "currentValue": "45.2",
      "threshold": "90",
      "detail": "库存周转天数 45.2 天，正常"
    },
    "capitalOccupationCheck": {
      "passed": false,
      "currentValue": "520000.00",
      "threshold": "500000",
      "detail": "资金占用 ¥520000.00 超过上限 ¥500000，需老板审批"
    },
    "productionCostCheck": {
      "passed": true,
      "currentValue": "15000.00",
      "threshold": "18000.00",
      "detail": "估算物料成本 ¥15000.00，在正常范围"
    },
    "capacityLoadCheck": {
      "passed": false,
      "currentValue": "95.0%",
      "threshold": "90%",
      "detail": "产能负荷 95.0% 超过上限 90%，当前排产已满，新订单将延期"
    },
    "blockedReasons": [
      "资金占用 ¥520000.00 超过上限 ¥500000，需老板审批",
      "产能负荷 95.0% 超过上限 90%"
    ],
    "impactAnalysis": {
      "affectedOrders": [
        { "orderId": 95, "orderNo": "SO1741600000095", "delayDays": 2 },
        { "orderId": 97, "orderNo": "SO1741600000097", "delayDays": 1 }
      ],
      "additionalCapital": "15000.00",
      "turnoverDaysChange": "+2~5",
      "additionalProductionCost": "2250.00"
    }
  },
  "message": "插单影响分析完成"
}
```

---

## 八、生产管理模块 `/api/production`

### 8.1 生产工单列表

```
GET /api/production/orders
```

**Query Parameters**：`status`、`salesOrderId`、`page`、`pageSize`

**Response 200** — 含 `progressPct`（完成百分比）字段。

---

### 8.2 生产工单详情

```
GET /api/production/orders/:id
```

**Response 200**

```json
{
  "code": 0,
  "data": {
    "id": 88,
    "workOrderNo": "WO2026031001",
    "skuName": "三人沙发-A款",
    "salesOrderNo": "SO1741680000100",
    "qtyPlanned": "5.0000",
    "qtyCompleted": "2.0000",
    "progressPct": 40.0,
    "status": "in_progress",
    "plannedStart": "2026-03-12",
    "plannedEnd": "2026-03-18",
    "tasks": [
      {
        "id": 1001,
        "workerName": "李工",
        "stepName": "裁切",
        "taskDate": "2026-03-12",
        "plannedQty": "5.0000",
        "completedQty": "5.0000",
        "status": "completed"
      }
    ]
  },
  "message": "操作成功"
}
```

**Error Codes**

| code | 说明 |
|---|---|
| `7001` | 生产工单不存在 |

---

### 8.3 创建生产工单

```
POST /api/production/orders
```

**权限**：`supervisor` / `boss`

**Request Body**

```json
{
  "salesOrderId": 100,
  "salesOrderItemId": 1,
  "skuId": 50,
  "bomHeaderId": 1,
  "processTemplateId": 3,
  "qtyPlanned": "5",
  "priority": 80,
  "plannedStart": "2026-03-12",
  "plannedEnd": "2026-03-18"
}
```

**Response 201**

```json
{ "code": 0, "data": { "id": 88, "workOrderNo": "WO2026031001" }, "message": "生产工单已创建" }
```

---

### 8.4 生成排产计划（AI 贪心调度）

```
GET /api/production/schedule/generate?date=2026-03-12
```

**权限**：`supervisor` / `boss`

**Query Parameters**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `date` | string | 否 | 排产日期 YYYY-MM-DD，默认下一个工作日 |

**Response 200**

```json
{
  "code": 0,
  "data": {
    "date": "2026-03-12",
    "schedules": [
      {
        "productionOrderId": 88,
        "workOrderNo": "WO2026031001",
        "processStepId": 10,
        "stepName": "裁切",
        "workerId": 5,
        "workerName": "李工",
        "workstationId": 2,
        "workstationName": "裁切台A",
        "plannedQty": "5.00",
        "estimatedHours": "4.00"
      }
    ],
    "summary": {
      "totalOrders": 6,
      "totalSteps": 18,
      "capacityLoadRate": "75.0%"
    }
  },
  "message": "排产计划已生成（2026-03-12）"
}
```

---

### 8.5 确认排产计划（下发任务给工人）

```
POST /api/production/schedule/confirm
```

**权限**：`supervisor` / `boss`

**Request Body**

```json
{ "date": "2026-03-12" }
```

**Response 200**

```json
{ "code": 0, "data": null, "message": "排产计划已确认下发" }
```

---

### 8.6 获取工人当日任务

```
GET /api/production/tasks/worker/:workerId?date=2026-03-12
```

**Query Parameters**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `date` | string | 否 | 日期，默认今日 |

**Response 200**

```json
{
  "code": 0,
  "data": [
    {
      "id": 1001,
      "taskNo": "TK1741680001001",
      "workOrderNo": "WO2026031001",
      "skuName": "三人沙发-A款",
      "processStepName": "裁切",
      "salesOrderNo": "SO1741680000100",
      "taskDate": "2026-03-12",
      "plannedQty": "5.0000",
      "completedQty": "0.0000",
      "status": "pending"
    }
  ],
  "message": "操作成功"
}
```

---

### 8.7 工人开始任务

```
POST /api/production/tasks/:id/start
```

**权限**：`worker` / `supervisor`

**Response 200**

```json
{ "code": 0, "data": null, "message": "任务已开始" }
```

---

### 8.8 工人上报完工

```
POST /api/production/tasks/:id/complete
```

**权限**：`worker` / `supervisor`

**Request Body**

```json
{
  "completedQty": "5",
  "scrapQty": "0",
  "scrapReason": null,
  "componentBarcode": "COMP-2026-0312-001",
  "notes": "裁切完成，尺寸正常",
  "images": []
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `completedQty` | string | 是 | 实际完工数量 |
| `scrapQty` | string | 否 | 损耗数量 |
| `scrapReason` | string | 否 | `material_defect` / `operation_error` / `other` |
| `componentBarcode` | string | 否 | 部件条码（扫码溯源，可选） |
| `images` | array | 否 | 图片 URL 列表（最多3张） |

**Response 200**

```json
{ "code": 0, "data": null, "message": "完工已上报" }
```

---

## 九、质量溯源模块 `/api/quality`

### 9.1 验货单列表

```
GET /api/quality/inspections
```

**Query Parameters**：`status`、`productionOrderId`、`page`、`pageSize`

---

### 9.2 创建验货单

```
POST /api/quality/inspections
```

**权限**：`qc` / `supervisor`

**Request Body**

```json
{
  "productionOrderId": 88,
  "inspectionDate": "2026-03-18",
  "qtyInspected": "5"
}
```

**Response 201**

```json
{ "code": 0, "data": { "id": 20, "inspectionNo": "QC1741680000020" }, "message": "验货单已创建" }
```

---

### 9.3 录入质量问题

```
POST /api/quality/inspections/issues
```

**权限**：`qc`

**Request Body**

```json
{
  "inspectionId": 20,
  "componentName": "沙发左扶手",
  "issueTypes": ["appearance", "dimension"],
  "severity": "normal",
  "description": "表面划痕，尺寸偏差2mm",
  "images": [
    "https://storage.example.com/qc/img001.jpg"
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `issueTypes` | array | 是 | `appearance`外观 / `dimension`尺寸 / `function`功能 / `material`材质 |
| `severity` | string | 是 | `minor`轻微 / `normal`一般 / `severe`严重 |

**Response 201**

```json
{ "code": 0, "data": { "issueId": 55 }, "message": "质量问题已记录" }
```

---

### 9.4 完成验货

```
POST /api/quality/inspections/:id/complete
```

**权限**：`qc`

**Request Body**

```json
{ "qtyPassed": "4" }
```

**Response 200**

```json
{ "code": 0, "data": null, "message": "验货已完成" }
```

---

### 9.5 溯源链查询

```
GET /api/quality/traceability/:productionOrderId
```

查询成品完整溯源链：成品 → 部件 → 物料批次/缸号 → 工序 → 工人。

**Response 200**

```json
{
  "code": 0,
  "data": {
    "productionOrderId": 88,
    "workOrderNo": "WO2026031001",
    "skuName": "三人沙发-A款",
    "salesOrderNo": "SO1741680000100",
    "customerName": "优品家居有限公司",
    "components": [
      {
        "componentBarcode": "COMP-2026-0312-001",
        "componentName": "沙发左扶手",
        "processStepName": "裁切",
        "stepNo": 1,
        "workerName": "李工",
        "workerId": 5,
        "operationTime": "2026-03-12T09:30:00.000Z",
        "skuName": "红橡实木板材",
        "dyeLotNo": null,
        "hasScanRecord": true,
        "missingDataNote": null
      },
      {
        "componentBarcode": null,
        "componentName": "沙发面套",
        "processStepName": "面套缝制",
        "stepNo": 3,
        "workerName": "王师傅",
        "workerId": 8,
        "operationTime": "2026-03-14T14:00:00.000Z",
        "skuName": "仿皮面料",
        "dyeLotNo": "DL20260101A",
        "hasScanRecord": false,
        "missingDataNote": "工序数据缺失，仅可追溯至物料批次"
      }
    ],
    "summary": {
      "totalComponents": 8,
      "withScanRecord": 6,
      "dyeLots": ["DL20260101A"]
    }
  },
  "message": "操作成功"
}
```

**Error Codes**

| code | 说明 |
|---|---|
| `7001` | 生产工单不存在 |

---

### 9.6 质量统计分析

```
GET /api/quality/stats?periodDays=30
```

**Query Parameters**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `periodDays` | integer | 否 | 统计周期：`7` / `30` / `90`，默认30 |

**Response 200**

```json
{
  "code": 0,
  "data": {
    "periodDays": 30,
    "totalInspected": 320,
    "totalFailed": 18,
    "failRate": "5.63%",
    "trendData": [
      { "date": "2026-03-01", "failCount": 2, "inspectCount": 40 },
      { "date": "2026-03-08", "failCount": 5, "inspectCount": 60 }
    ],
    "issueTypeBreakdown": [
      { "type": "appearance", "count": 10, "pct": "55.6%" },
      { "type": "dimension",  "count": 6,  "pct": "33.3%" },
      { "type": "material",   "count": 2,  "pct": "11.1%" }
    ],
    "top5Issues": [
      {
        "description": "沙发左扶手",
        "count": 5,
        "orderCount": 3,
        "relatedWorkers": ["李工", "张三"],
        "relatedProcesses": ["裁切", "打磨"]
      }
    ]
  },
  "message": "操作成功"
}
```

---

## 十、错误码速查表

### 10.1 全局错误码

| code | HTTP | 含义 |
|---|---|---|
| `0` | 2xx | 成功 |
| `1001` | 400 | 参数校验失败 |
| `1002` | 401 | 未认证/Token过期 |
| `1003` | 403 | 权限不足 |
| `1004` | 404 | 资源不存在 |
| `1005` | 409 | 数据冲突/重复 |
| `1099` | 500 | 服务内部错误 |

### 10.2 业务模块错误码

| code | 模块 | 含义 |
|---|---|---|
| `2001` | SKU | SKU 不存在 |
| `2002` | SKU | SKU 编码重复 |
| `2003` | SKU | 二级分类不属于所选一级分类 |
| `3001` | BOM | BOM 不存在 |
| `3002` | BOM | 检测到循环引用 / 层级超过10层 |
| `3003` | BOM | BOM 明细重复 |
| `4001` | 库存 | 库存数量不足 |
| `4002` | 库存 | 面料类 SKU 未填写缸号 |
| `4003` | 库存 | 获取分布式锁失败（并发冲突） |
| `4004` | 库存 | 跨缸号操作（记录警告，仍成功） |
| `5001` | 采购 | 采购订单不存在 |
| `5002` | 采购 | 三单关联关系不匹配 |
| `5003` | 采购 | 价格异常（超历史均价20%） |
| `6001` | 销售 | 订单被约束引擎拦截 |
| `6002` | 销售 | 销售订单不存在 |
| `6003` | 销售 | 订单状态不允许该操作 |
| `7001` | 生产 | 生产工单不存在 |
| `7002` | 生产 | 排产冲突（工人/工作站超载） |

---

## 十一、角色权限速查

| 角色 code | 中文名 | 可访问的核心操作 |
|---|---|---|
| `boss` | 工厂老板 | 所有读权限 + 审批采购建议 + 审批超限订单 + 触发采购建议生成 |
| `purchaser` | 采购员 | 采购建议查看 + 创建PO + 录入送货单 + 执行三单匹配 + 确认差异 |
| `warehouse` | 仓库管理员 | 入库 + 出库 + 库存查询 |
| `supervisor` | 车间主管 | 创建生产工单 + 生成/确认排产 + 发起领料 + 创建验货单 |
| `worker` | 生产工人 | 查看自己的任务 + 开始任务 + 完工上报 |
| `qc` | QC验货员 | 创建验货单 + 录入质量问题 + 完成验货 |
| `sales` | 销售人员 | 创建销售订单 + 查看自己的订单 + 插单分析 |

---

## 十二、联调注意事项

供 @senior-frontend-engineer 参考：

1. **Token 管理**：`accessToken` 有效期7天，`refreshToken` 有效期30天。建议前端在 401 响应时自动调用 `/api/auth/refresh`，刷新失败则跳转登录页。

2. **库存单位换算提示**：调用入库/出库接口前，先通过 `GET /api/skus/:id` 获取 `unitConversions`，在前端实时展示换算提示文案（已在 `UnitConverter.convert()` 中计算好 `displayText`）。

3. **面料缸号校验**：SKU 的 `hasDyeLot=true` 时，入库/出库表单需展示缸号必填字段；调用 `/api/inventory/:skuId/fifo-dye-lot` 获取 FIFO 推荐缸号列表。

4. **约束引擎响应时间**：`POST /api/sales/orders` 内部同步执行约束检查，预计响应时间 1-3 秒，前端需展示加载状态。插单分析接口 `/analyze-urgent` 最长 30 秒，需展示"AI正在评估中..."状态（对接 US-502）。

5. **排产计划生成**：`GET /api/production/schedule/generate` 首次生成耗时 3-10 秒（取决于工单数量），有缓存（12小时），再次请求直接返回。

6. **溯源链数据完整度**：`hasScanRecord=false` 的部件显示 `missingDataNote`，前端应以灰色弱化显示并展示缺失提示，对接 US-701 验收条件。

7. **错误处理**：所有非 0 code 均需在 UI 展示 `message` 字段内容；4003（锁冲突）建议自动重试1次（等待500ms），再失败则提示用户。
