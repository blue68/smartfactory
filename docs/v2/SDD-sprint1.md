# SDD — Sprint 1 技术设计规范文档

**版本**: 1.0.0
**日期**: 2026-03-12
**作者**: tech-lead-architect
**状态**: 待工程经理审批

---

## 目录

1. [文档说明](#1-文档说明)
2. [架构约束与前置条件](#2-架构约束与前置条件)
3. [R-01: SKU 类目自定义配置](#3-r-01-sku-类目自定义配置)
4. [R-02: 供应商导出与绩效对比](#4-r-02-供应商导出与绩效对比)
5. [R-03: 采购价格批量导入](#5-r-03-采购价格批量导入)
6. [R-05: 工序极限工时与工价计算](#6-r-05-工序极限工时与工价计算)
7. [R-06: Web 端任务管理](#7-r-06-web-端任务管理)
8. [数据库变更汇总 DDL](#8-数据库变更汇总-ddl)
9. [风险评估](#9-风险评估)
10. [技术规范附录](#10-技术规范附录)

---

## 1. 文档说明

### 1.1 编写目的

本文档为 Sprint 1 五项需求（R-01、R-02、R-03、R-05、R-06）的 Specification Driven Development 设计规范。所有后端工程师、前端工程师在进入编码阶段前必须以本文档为唯一技术输入。

### 1.2 范围

| 需求编号 | 需求名称 | 涉及服务 |
|---------|---------|---------|
| R-01 | SKU 一级/二级类目自定义配置 | API: sku-category, Web: SKU 配置页 |
| R-02 | 供应商导出 + 绩效对比 | API: supplier, Web: 供应商列表/详情页 |
| R-03 | 采购价格批量导入 | API: price, Web: 价格管理页 |
| R-05 | 工序极限工时 + 工价计算 | API: process-config, Web: 工序配置页 |
| R-06 | Web 端任务管理 | API: production (已有), Web: 任务管理新增页 |

### 1.3 术语

| 术语 | 含义 |
|-----|-----|
| tenant_id | 多租户隔离键，所有业务表必携带 |
| is_system | 0=系统预置、1=租户自定义，用于保护预置数据不被删除 |
| process_steps | 工艺步骤，隶属于 process_templates |
| worker_grade | 工人等级：skilled=熟练工，apprentice=学徒工 |

---

## 2. 架构约束与前置条件

### 2.1 现有技术栈

```
后端:  Node.js 18 + TypeScript + Express + TypeORM + MySQL 8.0 + Redis 7
前端:  React + TypeScript（具体版本由 senior-frontend-engineer 确认）
部署:  Docker Compose，Nginx 反向代理，API 仅暴露内部网络
```

### 2.2 现有模块边界

```
services/api/src/modules/
  sku/                  SKU 主数据（含 categories 查询）
  supplier/             供应商（含 getPerformance 单个绩效）
  price/                采购价格（supplier_prices 表）
  process-config/       工序模板（process_templates + process_steps）
  production/           生产工单 + 调度（scheduler.service.ts 含 startTask/completeTask）
  purchase/             采购单
  inventory/            库存
```

### 2.3 统一响应格式

所有接口必须使用已有 `success()` / `created()` helper，返回结构：

```json
{
  "code": 0,
  "data": {},
  "message": "操作成功"
}
```

错误响应由 `AppError` 统一抛出，全局 error handler 捕获：

```json
{
  "code": 40400,
  "data": null,
  "message": "供应商不存在"
}
```

### 2.4 多租户约束

- 所有查询必须携带 `tenant_id = :tenantId` 条件
- 系统预置数据（`tenant_id = 0`）对所有租户只读可见，不允许删除或修改
- 租户自定义数据（`tenant_id = 当前租户`）允许增删改

---

## 3. R-01: SKU 类目自定义配置

### 3.1 业务背景

`sku_categories` 表现有 5 个系统预置一级类目（FINISHED 等），字段已包含 `tenant_id`（0 = 预置）。需要开放给租户进行增删改操作，但系统预置类目不可删除，删除前需检查 SKU 引用。

### 3.2 数据库变更

#### 3.2.1 sku_categories 表补充字段

现有表结构已满足存储需求，无需新增字段。但需确认 `is_active` 字段用于软删除逻辑（已存在）。

**补充：`is_system` 语义由 `tenant_id = 0` 代替**，无需新增字段，查询时以 `tenant_id = 0` 标识系统预置。

#### 3.2.2 DDL（无结构变更，仅补充索引）

```sql
-- 补充联合唯一索引，防止同租户下同级别重复编码
-- 注意：现有 idx_code 是单列索引，不足以防重复
ALTER TABLE `sku_categories`
  ADD UNIQUE KEY `uk_tenant_level_code` (`tenant_id`, `level`, `code`);
```

### 3.3 API 设计

#### 接口列表

| # | Method | Path | 描述 |
|--|--------|------|------|
| 1 | GET | `/api/sku-categories` | 查询类目树（含系统预置+租户自定义） |
| 2 | POST | `/api/sku-categories` | 新增类目（仅租户自定义） |
| 3 | PATCH | `/api/sku-categories/:id` | 修改类目名称/排序 |
| 4 | DELETE | `/api/sku-categories/:id` | 删除类目（软删除，检查引用） |

#### 3.3.1 GET /api/sku-categories

**Query Parameters**

| 参数 | 类型 | 必填 | 说明 |
|-----|------|-----|------|
| level | number | 否 | 1=只返回一级，2=只返回二级，不传=全部 |
| parentId | number | 否 | 指定父类目 ID，返回其下二级类目 |
| includeInactive | boolean | 否 | 默认 false，是否包含已停用 |

**Response 200**

```json
{
  "code": 0,
  "data": [
    {
      "id": 1,
      "level": 1,
      "parentId": null,
      "code": "FINISHED",
      "name": "成品",
      "sortOrder": 1,
      "isActive": true,
      "isSystem": true,
      "children": [
        {
          "id": 10,
          "level": 2,
          "parentId": 1,
          "code": "FINISHED_CLOTH",
          "name": "成品布料",
          "sortOrder": 1,
          "isActive": true,
          "isSystem": false
        }
      ]
    }
  ],
  "message": "success"
}
```

**说明**: `isSystem = true` 时前端禁用编辑/删除按钮。

#### 3.3.2 POST /api/sku-categories

**Request Body**

```json
{
  "level": 1,
  "parentId": null,
  "code": "CUSTOM_CAT",
  "name": "自定义类目",
  "sortOrder": 99
}
```

**Validation Schema（Zod）**

```typescript
const CreateCategorySchema = z.object({
  level: z.literal(1).or(z.literal(2)),
  parentId: z.number().int().positive().nullable(),
  code: z.string().min(1).max(50).regex(/^[A-Z0-9_]+$/, 'code 只允许大写字母、数字、下划线'),
  name: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
```

**业务规则**

- `level=2` 时 `parentId` 必须指定且对应的一级类目必须存在
- `level=1` 时 `parentId` 必须为 null
- 同一租户同 level 下 `code` 唯一（含系统预置，即租户不能创建与系统预置 code 同名的类目）
- 创建后 `tenant_id` 自动设置为当前租户 ID

**Response 201**

```json
{
  "code": 0,
  "data": { "id": 101, "code": "CUSTOM_CAT", "name": "自定义类目", ... },
  "message": "类目已创建"
}
```

#### 3.3.3 PATCH /api/sku-categories/:id

**Request Body**（部分更新）

```json
{
  "name": "新名称",
  "sortOrder": 5,
  "isActive": true
}
```

**业务规则**

- 系统预置类目（`tenant_id = 0`）禁止修改，返回 `403 Forbidden`
- `code` 字段不允许修改（编码一旦创建不变，防止历史数据引用断裂）

**Response 200**

```json
{ "code": 0, "data": { ...updatedCategory }, "message": "类目已更新" }
```

#### 3.3.4 DELETE /api/sku-categories/:id

**业务规则（关键）**

```
1. 系统预置（tenant_id = 0）禁止删除 → 403
2. 检查 skus.category1_id 或 skus.category2_id 是否引用该类目
   SELECT COUNT(*) FROM skus WHERE tenant_id=? AND (category1_id=? OR category2_id=?)
3. 若引用数 > 0 → 400 业务错误，返回引用 SKU 数量
4. 检查该一级类目下是否有二级子类目（level=1 时）
   SELECT COUNT(*) FROM sku_categories WHERE tenant_id IN (0, ?) AND parent_id=?
5. 若有子类目 → 400，提示先删除子类目
6. 通过所有检查 → 执行软删除（is_active = 0），不物理删除
```

**Response 200**

```json
{ "code": 0, "data": null, "message": "类目已删除" }
```

**Error Response 400**

```json
{
  "code": 40001,
  "data": { "referencedSkuCount": 12 },
  "message": "该类目下有 12 个 SKU 正在使用，无法删除"
}
```

### 3.4 前端页面设计

#### 3.4.1 页面位置

路由: `/settings/sku-categories`
挂载位置: 系统设置 > SKU 类目管理

#### 3.4.2 页面结构

```
SkuCategoryPage
├── PageHeader（标题 + 新增一级类目按钮）
├── CategoryTree（左侧面板，树形结构）
│   ├── Level1Item（系统预置 - 灰色锁图标，不可操作）
│   │   └── Level2Item（系统预置 - 同上）
│   ├── Level1Item（租户自定义 - 编辑/删除操作）
│   │   ├── Level2Item（租户自定义 - 编辑/删除）
│   │   └── AddLevel2Button（新增二级类目）
│   └── AddLevel1Button（底部新增入口）
└── CategoryFormDrawer（右侧抽屉，新增/编辑表单）
    ├── FormField: 分类编码（仅新增时可填，编辑时只读）
    ├── FormField: 分类名称
    ├── FormField: 排序号
    └── ActionBar: 取消 / 保存
```

#### 3.4.3 状态管理

```typescript
interface SkuCategoryState {
  tree: CategoryTreeNode[];          // 完整树结构
  loading: boolean;
  drawerOpen: boolean;
  drawerMode: 'create-l1' | 'create-l2' | 'edit';
  editingNode: CategoryTreeNode | null;
  parentForCreate: CategoryTreeNode | null;  // create-l2 时指定父节点
}
```

#### 3.4.4 关键交互

- 点击系统预置类目：展开子列表，不显示操作按钮
- 点击删除（租户类目）：弹出二次确认 Modal，显示"该操作将软删除类目，已引用的 SKU 需要先重新分类"
- 删除失败（引用中）：Toast 显示具体错误信息，提供"查看引用 SKU"跳转链接

---

## 4. R-02: 供应商导出与绩效对比

### 4.1 业务背景

- **导出**：供应商列表页需支持将当前筛选结果导出为 Excel 文件，使用 `exceljs` 库生成。
- **绩效对比**：支持勾选 2-4 个供应商，在对比面板中展示准时率、订单总数、月度金额趋势的横向对比。

### 4.2 数据库变更

无新增表。绩效数据来源于现有 `purchase_orders` 表，现有 `getPerformance()` 方法已验证查询可行性。

**绩效对比需新增联合索引（优化多供应商并发查询）：**

```sql
-- 优化绩效对比查询性能
ALTER TABLE `purchase_orders`
  ADD KEY `idx_tenant_supplier_status_date`
    (`tenant_id`, `supplier_id`, `status`, `actual_delivery_date`, `expected_date`),
  ADD KEY `idx_tenant_supplier_created`
    (`tenant_id`, `supplier_id`, `created_at`);
```

### 4.3 API 设计

#### 接口列表

| # | Method | Path | 描述 |
|--|--------|------|------|
| 1 | GET | `/api/suppliers/export` | 供应商列表 Excel 导出 |
| 2 | POST | `/api/suppliers/compare` | 多供应商绩效对比 |

#### 4.3.1 GET /api/suppliers/export

**Query Parameters**（与现有 list 接口保持一致，支持相同筛选条件）

| 参数 | 类型 | 必填 | 说明 |
|-----|------|-----|------|
| keyword | string | 否 | 名称/编码模糊搜索 |
| rating | string | 否 | A/B/C/D 等级筛选 |
| isActive | boolean | 否 | 状态筛选 |
| ids | string | 否 | 逗号分隔的 ID 列表，指定导出行（勾选导出场景） |

**Response**

- Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Content-Disposition: `attachment; filename="suppliers_20260312.xlsx"`
- 响应体: Excel 文件二进制流

**Excel 列定义**

| 列名 | 字段 | 格式 |
|-----|-----|------|
| 供应商编码 | code | 文本 |
| 供应商名称 | name | 文本 |
| 等级 | grade | 文本 |
| 联系人 | contact | 文本 |
| 联系电话 | phone | 文本 |
| 邮箱 | contactEmail | 文本 |
| 地址 | address | 文本 |
| 账期（天） | paymentDays | 数字 |
| 交货周期（天） | leadDays | 数字 |
| 状态 | status | 文本：active=启用/inactive=停用 |
| 创建时间 | createdAt | YYYY-MM-DD HH:mm |

**实现要点**

```typescript
// 使用 exceljs 构建 workbook
import ExcelJS from 'exceljs';

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet('供应商列表');

// 设置列宽与标题样式
sheet.columns = [...columnDefs];
sheet.getRow(1).font = { bold: true };
sheet.getRow(1).fill = {
  type: 'pattern', pattern: 'solid',
  fgColor: { argb: 'FFD9E1F2' }
};

// 写入数据
suppliers.forEach(s => sheet.addRow([...]));

// 流式响应（避免大文件内存溢出）
res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
res.setHeader('Content-Disposition', `attachment; filename="suppliers_${dateStr}.xlsx"`);
await workbook.xlsx.write(res);
res.end();
```

**数量限制**: 单次最多导出 5000 条，超出时返回 400 提示分批导出。

#### 4.3.2 POST /api/suppliers/compare

**Request Body**

```json
{
  "supplierIds": [1, 2, 3],
  "months": 6
}
```

**Validation**

```typescript
const CompareSchema = z.object({
  supplierIds: z.array(z.number().int().positive()).min(2).max(4),
  months: z.number().int().min(1).max(12).default(6),
});
```

**Response 200**

```json
{
  "code": 0,
  "data": {
    "suppliers": [
      {
        "id": 1,
        "code": "SUP001",
        "name": "供应商A",
        "grade": "A",
        "metrics": {
          "onTimeRate": "92.5%",
          "totalOrders": 48,
          "avgLeadDays": 5.2,
          "monthlyAmounts": [
            { "month": "2026-02", "amount": "128500.00" },
            { "month": "2026-01", "amount": "96300.00" }
          ]
        }
      },
      {
        "id": 2,
        "code": "SUP002",
        "name": "供应商B",
        "grade": "B",
        "metrics": {
          "onTimeRate": "78.0%",
          "totalOrders": 25,
          "avgLeadDays": 7.8,
          "monthlyAmounts": [...]
        }
      }
    ],
    "comparedAt": "2026-03-12T08:00:00.000Z"
  },
  "message": "success"
}
```

**查询优化策略**

绩效对比涉及多个供应商的并发聚合查询，需做以下优化：

```
1. 使用 Promise.all 并发查询各供应商绩效，不串行
2. 月度金额查询限制 months 参数范围（最多 12 个月）
3. 结果按 Redis 缓存 5 分钟（key: supplier:compare:{tenantId}:{sortedIds}:{months}）
4. 月度金额趋势补全缺失月份（无订单月份填 0），保证前端折线图坐标连续
```

**Redis 缓存 Key 设计**

```
supplier:compare:{tenantId}:{ids_sorted_joined}:{months}
例: supplier:compare:1001:1_2_3:6
TTL: 300 秒
```

### 4.4 前端页面设计

#### 4.4.1 导出功能

在现有供应商列表页（`/suppliers`）增加：

```
SupplierListPage
├── ToolBar
│   ├── [已有] 新增按钮
│   ├── [新增] 导出按钮（下拉菜单）
│   │   ├── 导出当前筛选结果
│   │   └── 导出已勾选（n 条）
│   └── [新增] 对比按钮（勾选 2-4 条后激活）
├── [已有] FilterBar
├── [新增] SupplierTable（增加 rowSelection 多选）
└── [新增] CompareDrawer（绩效对比面板，右侧抽屉）
```

#### 4.4.2 绩效对比面板 CompareDrawer

```
CompareDrawer（宽度 800px）
├── Header: 供应商绩效对比（选中数量 badge）+ 关闭按钮
├── SummaryTable（横向对比表格）
│   ├── 行: 供应商名称
│   ├── 行: 等级
│   ├── 行: 准时率（高亮最佳值绿色）
│   ├── 行: 订单总数
│   └── 行: 平均交货天数
└── MonthlyTrendChart（折线图，多供应商月度金额趋势）
    ├── X轴: 月份
    ├── Y轴: 金额（元）
    └── Legend: 各供应商名称
```

#### 4.4.3 状态管理

```typescript
interface SupplierCompareState {
  selectedIds: number[];          // 勾选的供应商 ID（2-4 个）
  compareData: CompareResult | null;
  compareLoading: boolean;
  drawerOpen: boolean;
  exportLoading: boolean;
}
```

---

## 5. R-03: 采购价格批量导入

### 5.1 业务背景

现有 `supplier_prices` 表（对应 `PriceEntity`）支持单条创建。需要支持通过 Excel 模板批量导入采购价格，参考 SKU 导入实现（`sku.controller.ts` 中 `importSkus` 方法）。

### 5.2 数据库变更

无新增表。现有 `supplier_prices` 表已满足需求。

**补充索引（用于导入时快速校验供应商编码和 SKU 编码）：**

```sql
-- 供应商编码查询（导入校验）
ALTER TABLE `suppliers`
  ADD KEY `idx_tenant_code` (`tenant_id`, `code`);

-- SKU 编码查询（导入校验，通常已存在，确认无缺失）
-- skus 表已有 UNIQUE KEY uk_tenant_sku_code (tenant_id, sku_code)，无需重复添加
```

### 5.3 API 设计

#### 接口列表

| # | Method | Path | 描述 |
|--|--------|------|------|
| 1 | GET | `/api/prices/import-template` | 下载导入模板 |
| 2 | POST | `/api/prices/import` | 批量导入价格 |

#### 5.3.1 GET /api/prices/import-template

**Response**

- Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Content-Disposition: `attachment; filename="price_import_template.xlsx"`

**模板结构（第一行为列头，第二行为示例数据，第三行起为填写区）**

| 列名 | 字段 | 必填 | 格式说明 |
|-----|-----|-----|---------|
| 供应商编码 | supplierCode | 是 | 必须是系统中已存在的供应商编码 |
| SKU编码 | skuCode | 是 | 必须是系统中已存在的 SKU 编码 |
| 采购单价 | unitPrice | 是 | 数字，保留4位小数，如 12.5000 |
| 采购单位 | purchaseUnit | 是 | 如：个、米、kg |
| 最小起订量 | moq | 否 | 整数，如 100 |
| 生效日期 | validFrom | 否 | 格式 YYYY-MM-DD |
| 失效日期 | validTo | 否 | 格式 YYYY-MM-DD |
| 税率(%) | taxRate | 否 | 如 13 表示 13% |
| 备注 | notes | 否 | 最多200字 |

**模板附加说明 Sheet**：第二个 Sheet 页命名为"填写说明"，包含字段约束和示例。

#### 5.3.2 POST /api/prices/import

**Request**

- Content-Type: `multipart/form-data`
- 字段: `file`（xlsx 文件），最大 5MB

**处理流程**

```
1. 文件校验（魔数检测，仅接受 xlsx）
2. 解析 Excel 第一 Sheet，提取数据行（跳过第一行标题、第二行示例）
3. 批量预加载校验数据
   - 查询租户下所有供应商编码 → Map<code, id>
   - 查询租户下所有 SKU 编码 → Map<skuCode, id>
4. 逐行校验（不中断，累积错误）
   - supplierCode 存在性
   - skuCode 存在性
   - unitPrice 格式（正数，最多4位小数）
   - purchaseUnit 非空
   - validFrom/validTo 日期格式
   - validFrom <= validTo（若两者均填写）
5. 分类：合法行 / 错误行
6. 事务写入合法行（调用现有 PriceService.create 逻辑）
   - 每条价格写入前自动将同 supplier+sku 的旧价格标记为 is_current=false
7. 返回汇总结果
```

**Response 200**

```json
{
  "code": 0,
  "data": {
    "totalRows": 50,
    "imported": 47,
    "failed": 3,
    "errors": [
      {
        "row": 5,
        "supplierCode": "SUP999",
        "skuCode": "SKU001",
        "reason": "供应商编码 SUP999 不存在"
      },
      {
        "row": 12,
        "supplierCode": "SUP001",
        "skuCode": "RAW-002",
        "reason": "采购单价格式错误，请填写正数（如：12.5000）"
      },
      {
        "row": 23,
        "supplierCode": "SUP002",
        "skuCode": "SKU-033",
        "reason": "生效日期 2026-13-01 格式无效"
      }
    ],
    "anomalies": [
      {
        "row": 8,
        "skuCode": "SKU-010",
        "supplierCode": "SUP001",
        "message": "导入价格 180.00 高于历史均价 150.00 的 20%，请确认"
      }
    ]
  },
  "message": "导入完成，成功 47 条，失败 3 条"
}
```

**性能约束**

- 单次导入最多 500 行，超出返回 400
- 采用先批量预加载校验字典（一次查库），再逐行映射，避免 N+1 查询
- 事务写入：所有合法行在单个数据库事务内提交，失败时回滚

### 5.4 前端页面设计

#### 5.4.1 页面位置

在现有价格管理页（`/purchase/prices`）增加导入入口。

#### 5.4.2 导入流程 UI

```
PriceImportModal（步骤式对话框）
├── Step 1: 上传文件
│   ├── 下载模板按钮（调用 GET /api/prices/import-template）
│   ├── Dragger（拖拽/点击上传，限制 .xlsx，5MB）
│   └── 下一步按钮
├── Step 2: 导入进度（上传中 loading）
└── Step 3: 导入结果
    ├── 结果统计卡片（成功 N 条 / 失败 N 条）
    ├── ErrorTable（失败明细，含行号、原因）
    │   └── 导出错误报告按钮（前端生成 CSV）
    ├── AnomalyAlert（价格异常提示列表，警告色）
    └── 完成按钮（关闭并刷新列表）
```

#### 5.4.3 状态管理

```typescript
interface PriceImportState {
  step: 1 | 2 | 3;
  file: File | null;
  uploading: boolean;
  result: ImportResult | null;
  error: string | null;
}
```

---

## 6. R-05: 工序极限工时与工价计算

### 6.1 业务背景

现有工序步骤表 `process_steps` 已有 `standard_hours`（标准工时），需新增 `max_hours`（极限工时）字段。同时需建立工价表，支持按工人等级（熟练工/学徒工）配置不同计件单价，用于工资核算。

**业务数据流闭环**：
```
工序配置（max_hours + process_wages）
       ↓
排产调度（scheduler.service.ts）引用标准工时/极限工时
       ↓
完工上报（completeTask）记录实际工时
       ↓
工资核算：实际完成数量 × 对应等级单价 = 应付工资
```

### 6.2 数据库变更

#### 6.2.1 process_steps 表新增字段

```sql
ALTER TABLE `process_steps`
  ADD COLUMN `max_hours` DECIMAL(8,4) NULL DEFAULT NULL
    COMMENT '极限工时（小时），超出则标记产能预警'
    AFTER `standard_hours`;
```

**业务约束**：`max_hours >= standard_hours`，在应用层校验。

#### 6.2.2 新增工人等级枚举（应用层常量，无需建表）

```typescript
// 工人等级定义（应用层常量）
export const WORKER_GRADE = {
  SKILLED: 'skilled',       // 熟练工
  APPRENTICE: 'apprentice', // 学徒工
} as const;
export type WorkerGrade = typeof WORKER_GRADE[keyof typeof WORKER_GRADE];
```

#### 6.2.3 新建工价表 process_wages

```sql
CREATE TABLE IF NOT EXISTS `process_wages` (
  `id`           BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `tenant_id`    BIGINT UNSIGNED  NOT NULL COMMENT '租户ID',
  `step_id`      BIGINT UNSIGNED  NOT NULL COMMENT '工序步骤ID，关联 process_steps.id',
  `worker_grade` ENUM('skilled','apprentice') NOT NULL COMMENT '工人等级：skilled=熟练工，apprentice=学徒工',
  `piece_rate`   DECIMAL(10,4)    NOT NULL DEFAULT 0.0000 COMMENT '计件单价（元/件）',
  `hour_rate`    DECIMAL(10,4)    NULL DEFAULT NULL COMMENT '计时单价（元/小时），可选',
  `effective_at` DATE             NULL DEFAULT NULL COMMENT '生效日期，NULL=立即生效',
  `expired_at`   DATE             NULL DEFAULT NULL COMMENT '失效日期，NULL=长期有效',
  `notes`        VARCHAR(200)     NULL DEFAULT NULL COMMENT '备注',
  `created_at`   DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`   BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  `updated_by`   BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_step_grade` (`tenant_id`, `step_id`, `worker_grade`),
  KEY `idx_tenant_step` (`tenant_id`, `step_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='工序工价表：按工人等级配置计件/计时单价';
```

**设计决策说明**：
- `uk_tenant_step_grade` 唯一约束：同一工序同一等级只存一条当前生效工价，不做历史版本，更新时直接 REPLACE
- `piece_rate` 为主要计算字段（计件工厂），`hour_rate` 作为可选补充（计时场景）
- 未来如需工价历史记录，可新增 `process_wage_history` 表，当前 MVP 不包含

### 6.3 API 设计

#### 接口列表

| # | Method | Path | 描述 |
|--|--------|------|------|
| 1 | PATCH | `/api/process-configs/steps/:stepId/max-hours` | 更新工序步骤极限工时 |
| 2 | GET | `/api/process-configs/steps/:stepId/wages` | 查询工序工价配置 |
| 3 | PUT | `/api/process-configs/steps/:stepId/wages` | 全量更新工序工价（双等级） |
| 4 | GET | `/api/process-configs/:templateId/wage-summary` | 工序模板工价汇总 |

#### 6.3.1 PATCH /api/process-configs/steps/:stepId/max-hours

**Request Body**

```json
{
  "maxHours": 10.5,
  "standardHours": 8.0
}
```

**Validation**

```typescript
const MaxHoursSchema = z.object({
  maxHours: z.number().positive().max(24).nullable(),
  standardHours: z.number().positive().max(24).optional(),
}).refine(
  (d) => d.maxHours === null || d.standardHours === undefined || d.maxHours >= d.standardHours,
  { message: '极限工时必须大于等于标准工时' }
);
```

**Response 200**

```json
{
  "code": 0,
  "data": {
    "stepId": 101,
    "stepName": "裁剪",
    "standardHours": "8.0000",
    "maxHours": "10.5000"
  },
  "message": "极限工时已更新"
}
```

#### 6.3.2 GET /api/process-configs/steps/:stepId/wages

**Response 200**

```json
{
  "code": 0,
  "data": {
    "stepId": 101,
    "stepName": "裁剪",
    "wages": [
      {
        "id": 1,
        "workerGrade": "skilled",
        "workerGradeLabel": "熟练工",
        "pieceRate": "2.5000",
        "hourRate": null,
        "effectiveAt": null,
        "expiredAt": null
      },
      {
        "id": 2,
        "workerGrade": "apprentice",
        "workerGradeLabel": "学徒工",
        "pieceRate": "1.8000",
        "hourRate": null,
        "effectiveAt": null,
        "expiredAt": null
      }
    ]
  },
  "message": "success"
}
```

#### 6.3.3 PUT /api/process-configs/steps/:stepId/wages

全量覆盖当前工序两个等级的工价配置（UPSERT 语义）。

**Request Body**

```json
{
  "wages": [
    {
      "workerGrade": "skilled",
      "pieceRate": "2.5000",
      "hourRate": null,
      "effectiveAt": null,
      "expiredAt": null,
      "notes": "2026年标准"
    },
    {
      "workerGrade": "apprentice",
      "pieceRate": "1.8000",
      "hourRate": null,
      "effectiveAt": null,
      "expiredAt": null
    }
  ]
}
```

**Validation**

```typescript
const WageItemSchema = z.object({
  workerGrade: z.enum(['skilled', 'apprentice']),
  pieceRate: z.string().regex(/^\d+(\.\d{1,4})?$/).refine(v => parseFloat(v) >= 0),
  hourRate: z.string().regex(/^\d+(\.\d{1,4})?$/).nullable().optional(),
  effectiveAt: z.string().date().nullable().optional(),
  expiredAt: z.string().date().nullable().optional(),
  notes: z.string().max(200).optional(),
});

const PutWagesSchema = z.object({
  wages: z.array(WageItemSchema).min(1).max(2),
});
```

**实现（UPSERT）**

```sql
INSERT INTO process_wages
  (tenant_id, step_id, worker_grade, piece_rate, hour_rate, effective_at, expired_at, notes, created_by, updated_by)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  piece_rate   = VALUES(piece_rate),
  hour_rate    = VALUES(hour_rate),
  effective_at = VALUES(effective_at),
  expired_at   = VALUES(expired_at),
  notes        = VALUES(notes),
  updated_by   = VALUES(updated_by),
  updated_at   = CURRENT_TIMESTAMP(3);
```

**Response 200**

```json
{
  "code": 0,
  "data": { "stepId": 101, "updatedCount": 2 },
  "message": "工价配置已保存"
}
```

#### 6.3.4 GET /api/process-configs/:templateId/wage-summary

返回整个工序模板各步骤的工价汇总，用于前端展示工价总览。

**Response 200**

```json
{
  "code": 0,
  "data": {
    "templateId": 10,
    "templateName": "T恤标准工艺",
    "steps": [
      {
        "stepId": 101,
        "stepNo": 1,
        "stepName": "裁剪",
        "standardHours": "8.0000",
        "maxHours": "10.5000",
        "wages": {
          "skilled": { "pieceRate": "2.5000", "hourRate": null },
          "apprentice": { "pieceRate": "1.8000", "hourRate": null }
        }
      },
      {
        "stepId": 102,
        "stepNo": 2,
        "stepName": "缝制",
        "standardHours": "6.0000",
        "maxHours": null,
        "wages": {
          "skilled": null,
          "apprentice": null
        }
      }
    ]
  },
  "message": "success"
}
```

### 6.4 工价计算规则

工价计算不单独提供 API，由调用方在业务层执行：

```typescript
// 工价计算公式（应用层，非数据库计算）
function calcWage(params: {
  completedQty: number;    // 完成数量
  actualHours: number;     // 实际工时
  grade: WorkerGrade;      // 工人等级
  wage: ProcessWage;       // 工价配置
}): number {
  // 优先使用计件单价
  if (params.wage.pieceRate && parseFloat(params.wage.pieceRate) > 0) {
    return params.completedQty * parseFloat(params.wage.pieceRate);
  }
  // 兜底使用计时单价
  if (params.wage.hourRate && parseFloat(params.wage.hourRate) > 0) {
    return params.actualHours * parseFloat(params.wage.hourRate);
  }
  return 0;
}
```

### 6.5 前端页面设计

#### 6.5.1 页面位置

路由: `/production/process-configs/:templateId`（工序模板详情页）

#### 6.5.2 工序步骤配置增强

在现有工序步骤编辑 Form 中新增：

```
ProcessStepForm
├── [已有] 步骤序号
├── [已有] 步骤名称
├── [已有] 标准工时
├── [新增] 极限工时（数字输入，校验 >= 标准工时）
│   └── 辅助文本: "超出极限工时将触发产能预警"
└── [新增] 工价配置区块 WageConfigSection
    ├── 熟练工
    │   ├── 计件单价（元/件）输入框
    │   └── 计时单价（元/小时）输入框（可选）
    └── 学徒工
        ├── 计件单价（元/件）输入框
        └── 计时单价（元/小时）输入框（可选）
```

#### 6.5.3 工价汇总视图

在工序模板详情页底部增加"工价总览"Tab：

```
WageSummaryTab
└── WageSummaryTable（紧凑表格）
    ├── 列: 步骤 | 标准工时 | 极限工时 | 熟练工单价 | 学徒工单价 | 操作
    └── 行内编辑：点击单价单元格直接编辑并保存
```

---

## 7. R-06: Web 端任务管理

### 7.1 业务背景

小程序端已有任务功能（我的任务、完工上报、异常上报、开始生产）。后端 `production.service.ts` 已实现 `startTask()` 和 `completeTask()`，`scheduler.service.ts` 已实现 `getWorkerTasks()`。Web 端需要新增对应页面，复用这些 API。

### 7.2 数据库变更

无结构变更。所有所需数据已在现有表中（`production_orders`、`worker_schedules` 或等价表）。

**确认现有 API 路由**：需后端工程师确认 `production.routes.ts` 中以下路由是否已暴露：

- `GET /api/production/worker-tasks?workerId=&date=`
- `POST /api/production/tasks/:taskId/start`
- `POST /api/production/tasks/:taskId/complete`

如未暴露，需补充路由注册，不需要新增 service 方法。

### 7.3 API 设计

以下接口基于现有实现确认，仅补充 Web 端所需的补充接口。

#### 接口列表

| # | Method | Path | 描述 | 状态 |
|--|--------|------|------|------|
| 1 | GET | `/api/production/tasks` | 任务列表（Web 端，支持按状态/日期筛选） | 新增 |
| 2 | GET | `/api/production/tasks/:taskId` | 任务详情 | 新增 |
| 3 | POST | `/api/production/tasks/:taskId/start` | 开始生产 | 已有（确认暴露） |
| 4 | POST | `/api/production/tasks/:taskId/complete` | 完工上报 | 已有（确认暴露） |
| 5 | POST | `/api/production/tasks/:taskId/exception` | 异常上报 | 新增 |

#### 7.3.1 GET /api/production/tasks

Web 端任务列表，支持管理员视角（可查所有工人）和工人视角（仅查自己）。

**Query Parameters**

| 参数 | 类型 | 必填 | 说明 |
|-----|------|-----|------|
| workerId | number | 否 | 工人 ID，不传则按当前登录用户角色决策 |
| date | string | 否 | 日期 YYYY-MM-DD，默认今日 |
| status | string | 否 | pending/in_progress/completed/excepted |
| page | number | 否 | 默认 1 |
| pageSize | number | 否 | 默认 20 |

**Response 200**

```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "taskId": 1001,
        "workOrderNo": "WO-20260312-001",
        "productionOrderId": 50,
        "skuCode": "FIN-001",
        "skuName": "T恤（白色M码）",
        "stepNo": 2,
        "stepName": "缝制",
        "workstationName": "缝纫机-A组",
        "workerName": "张三",
        "plannedQty": "100.0000",
        "completedQty": "0.0000",
        "estimatedHours": "6.0000",
        "status": "pending",
        "plannedDate": "2026-03-12",
        "startedAt": null,
        "completedAt": null
      }
    ],
    "total": 15,
    "page": 1,
    "pageSize": 20
  },
  "message": "success"
}
```

#### 7.3.2 GET /api/production/tasks/:taskId

**Response 200**（含完工/异常历史记录）

```json
{
  "code": 0,
  "data": {
    "taskId": 1001,
    "workOrderNo": "WO-20260312-001",
    "skuName": "T恤（白色M码）",
    "stepName": "缝制",
    "plannedQty": "100.0000",
    "completedQty": "80.0000",
    "scrapQty": "2.0000",
    "status": "in_progress",
    "startedAt": "2026-03-12T08:00:00.000Z",
    "completedAt": null,
    "notes": "",
    "images": [],
    "exceptions": [
      {
        "id": 1,
        "type": "machine_fault",
        "description": "缝纫机卡针",
        "reportedAt": "2026-03-12T10:30:00.000Z",
        "resolvedAt": null,
        "resolvedBy": null
      }
    ]
  },
  "message": "success"
}
```

#### 7.3.3 POST /api/production/tasks/:taskId/start

复用现有 `ProductionService.startTask()` 方法，仅确认路由已注册。

**Request Body**: 无（幂等操作）

**Response 200**

```json
{ "code": 0, "data": { "taskId": 1001, "status": "in_progress", "startedAt": "..." }, "message": "已开始生产" }
```

**业务规则**：任务状态必须为 `pending`，否则返回 400。

#### 7.3.4 POST /api/production/tasks/:taskId/complete

复用现有 `ProductionService.completeTask()` 方法。

**Request Body**

```json
{
  "completedQty": "98",
  "scrapQty": "2",
  "scrapReason": "operation_error",
  "componentBarcode": "",
  "notes": "完工，轻微损耗",
  "images": []
}
```

**Response 200**

```json
{ "code": 0, "data": { "taskId": 1001, "status": "completed", "completedAt": "..." }, "message": "完工上报成功" }
```

#### 7.3.5 POST /api/production/tasks/:taskId/exception（新增）

**Request Body**

```json
{
  "exceptionType": "machine_fault",
  "description": "缝纫机卡针，无法继续生产",
  "images": ["https://..."]
}
```

**Validation**

```typescript
const ExceptionSchema = z.object({
  exceptionType: z.enum([
    'machine_fault',     // 设备故障
    'material_shortage', // 物料短缺
    'quality_issue',     // 质量问题
    'other'              // 其他
  ]),
  description: z.string().min(1).max(500),
  images: z.array(z.string().url()).max(5).optional().default([]),
});
```

**实现**：向 `task_exceptions` 表插入记录（若表不存在需新建，见 DDL 章节）。

**Response 201**

```json
{ "code": 0, "data": { "exceptionId": 5, "taskId": 1001 }, "message": "异常已上报" }
```

### 7.4 task_exceptions 表 DDL

```sql
CREATE TABLE IF NOT EXISTS `task_exceptions` (
  `id`             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `tenant_id`      BIGINT UNSIGNED  NOT NULL,
  `task_id`        BIGINT UNSIGNED  NOT NULL COMMENT '关联任务ID（worker_schedule 或等价表的行ID）',
  `exception_type` ENUM('machine_fault','material_shortage','quality_issue','other')
                   NOT NULL DEFAULT 'other',
  `description`    VARCHAR(500)     NOT NULL COMMENT '异常描述',
  `images`         JSON             DEFAULT NULL COMMENT '图片URL数组',
  `reported_by`    BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '上报人用户ID',
  `resolved_at`    DATETIME(3)      DEFAULT NULL COMMENT '解决时间，NULL=未解决',
  `resolved_by`    BIGINT UNSIGNED  DEFAULT NULL COMMENT '解决人用户ID',
  `resolve_notes`  VARCHAR(500)     DEFAULT NULL COMMENT '解决备注',
  `created_at`     DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`     DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tenant_task` (`tenant_id`, `task_id`),
  KEY `idx_tenant_resolved` (`tenant_id`, `resolved_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务异常上报记录表';
```

### 7.5 前端页面设计

#### 7.5.1 页面路由规划

```
/production/tasks              → 任务列表页（管理员视角：全部工人）
/production/tasks/my           → 我的任务页（工人视角：自己的任务）
/production/tasks/:taskId      → 任务详情页（含操作按钮）
```

#### 7.5.2 任务列表页 TaskListPage

```
TaskListPage (/production/tasks)
├── PageHeader: 任务管理
├── FilterBar
│   ├── DatePicker: 日期选择（默认今日）
│   ├── Select: 工人筛选（管理员可选所有工人，工人仅看自己）
│   └── Select: 状态筛选（全部/待开始/进行中/已完成/异常）
├── StatsRow（当日汇总卡片）
│   ├── 待开始任务数
│   ├── 进行中任务数
│   └── 今日完成任务数
└── TaskTable
    ├── 列: 工单号 | SKU名称 | 工序 | 工作站 | 工人 | 计划量 | 完成量 | 状态 | 操作
    └── 操作: 查看详情 / 开始生产（状态=pending 时显示）
```

#### 7.5.3 任务详情页 TaskDetailPage

```
TaskDetailPage (/production/tasks/:taskId)
├── PageHeader: 工单号 + 状态 Badge + 返回按钮
├── BaseInfoCard（基础信息：SKU、工序、工作站、计划量、标准工时）
├── ProgressCard（进度：已完成量 / 计划量，进度条）
├── ActionBar（操作区，按状态显示不同按钮）
│   ├── [pending]     → 开始生产按钮
│   ├── [in_progress] → 完工上报按钮 + 异常上报按钮
│   └── [completed]   → 查看完工记录（只读）
├── CompleteReportDrawer（完工上报抽屉）
│   ├── 完成数量输入（必填）
│   ├── 报废数量输入（选填）
│   ├── 报废原因 Select（报废数量>0 时必填）
│   ├── 备注文本域
│   ├── 图片上传（最多5张）
│   └── 提交按钮
├── ExceptionReportModal（异常上报弹窗）
│   ├── 异常类型 Select
│   ├── 描述文本域（必填）
│   ├── 图片上传（最多5张）
│   └── 提交按钮
└── ExceptionHistoryList（异常历史记录，已上报的异常列表）
    └── ExceptionItem: 类型 + 时间 + 描述 + 解决状态
```

#### 7.5.4 状态管理

```typescript
interface TaskDetailState {
  task: TaskDetail | null;
  loading: boolean;
  completeDrawerOpen: boolean;
  exceptionModalOpen: boolean;
  submitting: boolean;
  completeForm: {
    completedQty: string;
    scrapQty: string;
    scrapReason: string;
    notes: string;
    images: string[];
  };
  exceptionForm: {
    exceptionType: string;
    description: string;
    images: string[];
  };
}
```

#### 7.5.5 权限控制

```
管理员 (boss/supervisor): 可查所有工人任务，可操作所有任务
工人 (worker):            只能查看和操作分配给自己的任务
```

权限判断基于现有 JWT 中携带的 role 信息，前端路由守卫和 API 层双重校验。

---

## 8. 数据库变更汇总 DDL

以下为 Sprint 1 全部数据库变更的完整 DDL，按执行顺序排列。

```sql
-- ═══════════════════════════════════════════════════════════════════
-- Sprint 1 数据库迁移脚本
-- 执行时机: 部署前由 DBA / DevOps 执行，或通过 TypeORM Migration 运行
-- 文件路径建议: infra/db/migrations/sprint1_v1.0.0.sql
-- ═══════════════════════════════════════════════════════════════════

USE `smart_factory`;
SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────
-- M-01: sku_categories 补充唯一索引
-- 防止同租户同级别重复 code
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE `sku_categories`
  ADD UNIQUE KEY `uk_tenant_level_code` (`tenant_id`, `level`, `code`);

-- ─────────────────────────────────────────────────────────────────
-- M-02: purchase_orders 绩效查询优化索引
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE `purchase_orders`
  ADD KEY `idx_tenant_supplier_status_date`
    (`tenant_id`, `supplier_id`, `status`, `actual_delivery_date`, `expected_date`),
  ADD KEY `idx_tenant_supplier_created`
    (`tenant_id`, `supplier_id`, `created_at`);

-- ─────────────────────────────────────────────────────────────────
-- M-03: suppliers 导入校验索引
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE `suppliers`
  ADD KEY `idx_tenant_code` (`tenant_id`, `code`);

-- ─────────────────────────────────────────────────────────────────
-- M-04: process_steps 新增极限工时字段
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE `process_steps`
  ADD COLUMN `max_hours` DECIMAL(8,4) NULL DEFAULT NULL
    COMMENT '极限工时（小时），超出则标记产能预警'
    AFTER `standard_hours`;

-- ─────────────────────────────────────────────────────────────────
-- M-05: 新建工价表 process_wages
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `process_wages` (
  `id`           BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `tenant_id`    BIGINT UNSIGNED  NOT NULL COMMENT '租户ID',
  `step_id`      BIGINT UNSIGNED  NOT NULL COMMENT '工序步骤ID，关联 process_steps.id',
  `worker_grade` ENUM('skilled','apprentice') NOT NULL COMMENT '工人等级：skilled=熟练工，apprentice=学徒工',
  `piece_rate`   DECIMAL(10,4)    NOT NULL DEFAULT 0.0000 COMMENT '计件单价（元/件）',
  `hour_rate`    DECIMAL(10,4)    NULL DEFAULT NULL COMMENT '计时单价（元/小时），可选',
  `effective_at` DATE             NULL DEFAULT NULL COMMENT '生效日期，NULL=立即生效',
  `expired_at`   DATE             NULL DEFAULT NULL COMMENT '失效日期，NULL=长期有效',
  `notes`        VARCHAR(200)     NULL DEFAULT NULL,
  `created_at`   DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`   BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  `updated_by`   BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_step_grade` (`tenant_id`, `step_id`, `worker_grade`),
  KEY `idx_tenant_step` (`tenant_id`, `step_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='工序工价表：按工人等级配置计件/计时单价';

-- ─────────────────────────────────────────────────────────────────
-- M-06: 新建任务异常上报表 task_exceptions
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `task_exceptions` (
  `id`             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `tenant_id`      BIGINT UNSIGNED  NOT NULL,
  `task_id`        BIGINT UNSIGNED  NOT NULL COMMENT '关联任务ID',
  `exception_type` ENUM('machine_fault','material_shortage','quality_issue','other')
                   NOT NULL DEFAULT 'other',
  `description`    VARCHAR(500)     NOT NULL,
  `images`         JSON             DEFAULT NULL COMMENT '图片URL数组，最多5张',
  `reported_by`    BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  `resolved_at`    DATETIME(3)      DEFAULT NULL,
  `resolved_by`    BIGINT UNSIGNED  DEFAULT NULL,
  `resolve_notes`  VARCHAR(500)     DEFAULT NULL,
  `created_at`     DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`     DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tenant_task` (`tenant_id`, `task_id`),
  KEY `idx_tenant_unresolved` (`tenant_id`, `resolved_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='任务异常上报记录表';

-- ─────────────────────────────────────────────────────────────────
-- 迁移完成验证
-- ─────────────────────────────────────────────────────────────────
SELECT
  TABLE_NAME,
  TABLE_COMMENT,
  TABLE_ROWS
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'smart_factory'
  AND TABLE_NAME IN ('process_wages', 'task_exceptions')
ORDER BY TABLE_NAME;

SELECT
  TABLE_NAME,
  COLUMN_NAME,
  COLUMN_TYPE,
  COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'smart_factory'
  AND TABLE_NAME = 'process_steps'
  AND COLUMN_NAME = 'max_hours';
```

---

## 9. 风险评估

### 9.1 技术风险矩阵

| 风险编号 | 风险描述 | 影响需求 | 概率 | 影响 | 风险等级 | 缓解措施 |
|---------|---------|---------|-----|-----|---------|---------|
| T-01 | `sku_categories` 唯一索引变更失败（已存重复数据） | R-01 | 中 | 高 | 高 | 执行 DDL 前先检查重复数据：`SELECT tenant_id, level, code, COUNT(*) FROM sku_categories GROUP BY tenant_id, level, code HAVING COUNT(*) > 1`，有则先清理 |
| T-02 | exceljs 导出大文件内存溢出 | R-02 | 低 | 中 | 中 | 流式写入（`workbook.xlsx.write(res)`），单次限制 5000 条，超出提示分批导出 |
| T-03 | Excel 导入价格时 N+1 查询导致超时 | R-03 | 高 | 中 | 高 | 批量预加载供应商/SKU 编码字典，一次查询全部，逐行映射，避免循环查库 |
| T-04 | `purchase_orders` 表 `actual_delivery_date`/`expected_date` 字段不存在 | R-02 | 中 | 高 | 高 | 后端工程师确认字段名称，`supplier.service.ts` 现有 `getPerformance()` 已使用这两个字段，以现有代码为准 |
| T-05 | 任务模块 `task_id` 与现有生产调度 ID 语义对齐 | R-06 | 高 | 中 | 高 | 后端工程师阅读 `scheduler.service.ts` 确认任务 ID 对应的表和字段，本文档的 `task_id` 指向该表主键 |
| T-06 | 工价计算精度：DECIMAL 乘法精度丢失 | R-05 | 低 | 中 | 低 | 应用层使用 `decimal.js`（已引入项目，见 `scheduler.service.ts`）进行精确乘法运算 |
| T-07 | 多供应商绩效对比并发查询超时 | R-02 | 低 | 低 | 低 | Promise.all 并发 + Redis 缓存 5 分钟 |

### 9.2 数据迁移风险

| 风险 | 影响 | 处理方案 |
|-----|-----|---------|
| `process_steps.max_hours` 字段新增，历史数据为 NULL | R-05 | 允许 NULL，前端展示"未设置"，不影响现有排产逻辑 |
| `task_exceptions` 表新建，无历史数据 | R-06 | 新功能，无历史数据问题 |
| `sku_categories` 唯一索引变更 | R-01 | 见 T-01 缓解措施 |

### 9.3 接口兼容性风险

| 接口 | 兼容性风险 | 处理方案 |
|-----|---------|---------|
| `GET /api/sku-categories`（现有） | 现有接口返回平铺列表，新需求要求树形结构 | 新接口保持原有路由，但增加 `tree` 格式响应；或通过 `format=tree` query param 区分，不破坏小程序端现有调用 |
| `GET /api/production/worker-tasks`（现有小程序端路由） | Web 端复用 | 确认路由是否已存在，若不存在则新增 `/api/production/tasks` 路由，与小程序端路由并存 |

### 9.4 Excel 导入安全风险

| 风险 | 缓解措施 |
|-----|---------|
| 恶意 Excel 文件（Macro、XXE） | 使用 exceljs 而非 xlsx 库（exceljs 不执行宏）；文件大小限制 5MB；魔数检测 |
| CSV 注入攻击（在字段中嵌入 `=` 公式） | 导出时对以 `=`, `+`, `-`, `@` 开头的字段值添加单引号前缀 |
| 文件上传路径穿越 | 使用 multer 内存存储（`storage: multer.memoryStorage()`），不写磁盘 |

---

## 10. 技术规范附录

### 10.1 新模块目录结构规范

```
services/api/src/modules/
├── sku-category/           # R-01 新增（从 sku 模块拆分）
│   ├── skuCategory.entity.ts
│   ├── skuCategory.service.ts
│   ├── skuCategory.controller.ts
│   └── skuCategory.routes.ts
├── process-config/         # R-05 扩展现有模块
│   ├── processConfig.entity.ts     （扩展 ProcessStepEntity 新增 max_hours）
│   ├── processWage.entity.ts       （新增）
│   ├── processConfig.service.ts    （扩展）
│   ├── processWage.service.ts      （新增）
│   ├── processConfig.controller.ts （扩展）
│   └── processConfig.routes.ts     （扩展）
├── supplier/               # R-02 扩展现有模块
│   ├── supplier.service.ts         （新增 export/compare 方法）
│   ├── supplier.controller.ts      （新增 export/compare handler）
│   └── supplier.routes.ts          （新增路由）
├── price/                  # R-03 扩展现有模块
│   ├── price.service.ts            （新增 importPrices/downloadTemplate 方法）
│   ├── price.controller.ts         （新增 import/template handler）
│   └── price.routes.ts             （新增路由）
└── production/             # R-06 扩展现有模块
    ├── production.service.ts       （新增 listTasks/getTaskDetail/reportException）
    ├── production.controller.ts    （新增 handler）
    └── production.routes.ts        （新增路由）
```

### 10.2 命名规范

| 类型 | 规范 | 示例 |
|-----|-----|------|
| 数据库表 | snake_case | `process_wages` |
| 数据库列 | snake_case | `worker_grade`, `piece_rate` |
| TypeORM Entity 类 | PascalCase + Entity 后缀 | `ProcessWageEntity` |
| Service 方法 | camelCase 动词开头 | `updateMaxHours`, `importPrices` |
| Controller 方法 | camelCase 动词开头 | `getWages`, `putWages` |
| Zod Schema | PascalCase + Schema 后缀 | `PutWagesSchema` |
| 路由路径 | kebab-case | `/process-configs/steps/:stepId/wages` |
| 前端组件 | PascalCase | `TaskDetailPage`, `WageConfigSection` |
| 前端 State Interface | PascalCase + State 后缀 | `TaskDetailState` |

### 10.3 错误码规范

| 错误码 | 含义 | 使用场景 |
|-------|-----|---------|
| 40001 | 业务规则校验失败 | 删除被引用的类目、极限工时 < 标准工时 |
| 40003 | 禁止操作系统预置数据 | 修改/删除 tenant_id=0 的类目 |
| 40010 | 导入文件格式错误 | 非 xlsx 文件、文件超大 |
| 40011 | 导入数据校验失败 | 部分行存在错误（返回错误详情） |
| 40400 | 资源不存在 | 标准 404 |
| 40900 | 唯一性冲突 | 类目编码重复 |

### 10.4 日志规范

所有新增接口必须在关键操作节点打印结构化日志：

```typescript
// 导入完成日志示例
console.info('[PriceImport] 批量导入完成', {
  tenantId: this.tenantId,
  userId: this.userId,
  totalRows: result.totalRows,
  imported: result.imported,
  failed: result.failed,
  durationMs: Date.now() - startTime,
});

// 删除类目日志示例
console.info('[SKUCategory] 类目软删除', {
  tenantId: this.tenantId,
  userId: this.userId,
  categoryId: id,
  categoryCode: category.code,
});
```

### 10.5 Redis 缓存 Key 规范

Sprint 1 新增缓存 Key 汇总：

| Key 模板 | TTL | 用途 | 失效时机 |
|---------|-----|-----|---------|
| `sku:categories:{tenantId}` | 600s | 类目树缓存 | 创建/更新/删除类目后主动删除 |
| `supplier:compare:{tenantId}:{ids}:{months}` | 300s | 绩效对比结果 | 只读缓存，自然过期 |

---

**文档状态**: 待 Engineering Manager 执行 SDD 审批后方可进入编码阶段。

**交付给**:
- senior-backend-engineer: 第 3、4、5、6、7、8 章全部 API 设计 + DDL
- senior-frontend-engineer: 第 3.4、4.4、5.4、6.5、7.5 章全部前端页面设计
- senior-qa-engineer: 本文档作为测试用例编写的输入
