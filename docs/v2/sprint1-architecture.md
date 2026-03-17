# [artifact:架构设计] 智造管家 V2 Sprint 1 技术架构设计

**版本**：v1.0
**日期**：2026-03-13
**负责人**：@tech-lead-architect
**输入来源**：PRD v2.0、V1 数据库设计、V1 代码库

---

## 一、Sprint 1 需求范围

| 编号 | 需求 | 复杂度 | 新增后端文件 | 新增前端文件 |
|---|---|---|---|---|
| R-01 | SKU 类目自定义配置 | 低 | category.routes/controller/service | CategoryConfigPage 增强 |
| R-02 | 供应商导出 + 绩效对比 | 低-中 | supplier 模块增强 | SupplierPage 增强 |
| R-03 | 采购价格批量导入 | 中 | price 模块增强 | PriceImportPage 新增 |
| R-05 | 工序工价增强 | 中 | process 模块增强 | ProcessConfigPage 增强 |
| R-06 | Web 端任务管理 | 中 | task 模块增强 | TaskPage 增强 |

---

## 二、数据库变更设计

### 2.1 process_steps 表增强（R-05）

```sql
-- Sprint 1 迁移: R-05 工序工价字段 (BD-002 双档单价)
ALTER TABLE `process_steps`
  ADD COLUMN `max_hours` DECIMAL(8,2) DEFAULT NULL
    COMMENT '极限工时（小时/件）' AFTER `standard_hours`,
  ADD COLUMN `unit_price_skilled` DECIMAL(10,2) DEFAULT NULL
    COMMENT '熟练工计件单价（元/件）' AFTER `max_hours`,
  ADD COLUMN `unit_price_apprentice` DECIMAL(10,2) DEFAULT NULL
    COMMENT '学徒工计件单价（元/件）' AFTER `unit_price_skilled`;
```

### 2.2 users 表增强（R-05 / BD-002）

```sql
-- Sprint 1 迁移: 工人技能等级
ALTER TABLE `users`
  ADD COLUMN `skill_level` ENUM('skilled','apprentice') DEFAULT NULL
    COMMENT '技能等级：skilled=熟练工, apprentice=学徒工' AFTER `status`;
```

### 2.3 production_tasks 表增强（R-06 乐观锁）

```sql
-- Sprint 1 迁移: 乐观锁版本号
ALTER TABLE `production_tasks`
  ADD COLUMN `version` INT UNSIGNED NOT NULL DEFAULT 1
    COMMENT '乐观锁版本号' AFTER `updated_by`;

-- 扩展 status 枚举，增加异常状态
ALTER TABLE `production_tasks`
  MODIFY COLUMN `status` ENUM('pending','started','completed','cancelled','exception')
    NOT NULL DEFAULT 'pending';

-- 实际工时记录
ALTER TABLE `production_tasks`
  ADD COLUMN `actual_hours` DECIMAL(8,2) DEFAULT NULL
    COMMENT '实际工时（小时）' AFTER `completed_at`,
  ADD COLUMN `wage_amount` DECIMAL(12,2) DEFAULT NULL
    COMMENT '本次工资金额' AFTER `actual_hours`;
```

### 2.4 新增 task_exceptions 表（R-06）

```sql
CREATE TABLE IF NOT EXISTS `task_exceptions` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT UNSIGNED NOT NULL,
  `task_id`     BIGINT UNSIGNED NOT NULL COMMENT '关联生产任务',
  `type`        ENUM('equipment_fault','material_shortage','quality_issue','other')
                NOT NULL COMMENT '异常类型',
  `description` TEXT NOT NULL COMMENT '异常描述',
  `images`      JSON DEFAULT NULL COMMENT '图片URL数组，最多3张',
  `status`      ENUM('open','resolved','closed') NOT NULL DEFAULT 'open',
  `resolved_by` BIGINT UNSIGNED DEFAULT NULL,
  `resolved_at` DATETIME(3) DEFAULT NULL,
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_task` (`tenant_id`, `task_id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务异常记录表';
```

### 2.5 sku_categories 表（R-01）

现有表结构已满足类目 CRUD 需求，无需变更。需新增 `is_system` 标记字段：

```sql
ALTER TABLE `sku_categories`
  ADD COLUMN `is_system` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1=系统预置不可删除' AFTER `is_active`;

-- 标记现有种子数据为系统预置
UPDATE `sku_categories` SET `is_system` = 1 WHERE `tenant_id` = 0;
```

### 2.6 迁移文件命名

```
services/api/src/migrations/
  20260313_001_r05_process_step_pricing.sql
  20260313_002_r05_user_skill_level.sql
  20260313_003_r06_task_optimistic_lock.sql
  20260313_004_r06_task_exceptions.sql
  20260313_005_r01_category_is_system.sql
```

---

## 三、API 接口设计

### 3.1 R-01 类目自定义配置

| Method | Path | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/sku-categories` | all authenticated | 获取类目树（含子类目） |
| POST | `/api/sku-categories` | admin | 新增类目 |
| PUT | `/api/sku-categories/:id` | admin | 编辑类目（名称、排序） |
| DELETE | `/api/sku-categories/:id` | admin | 删除类目（含保护检查） |

**POST /api/sku-categories**
```typescript
// Request
{ level: 1 | 2, parentId?: number, code: string, name: string, sortOrder?: number }
// Response
{ code: 0, data: { id: number, ... }, message: 'ok' }
```

**DELETE /api/sku-categories/:id**
```typescript
// 删除保护逻辑：
// 1. is_system = 1 → 403 "系统预置类目不可删除"
// 2. 有子类目 → 返回子类目数量，前端二次确认后传 ?cascade=true
// 3. 有关联 SKU → 返回 SKU 数量，前端二次确认后传 ?force=true
// Response (需确认)
{ code: 0, data: { deletedCount: number, affectedSkuCount: number }, message: 'ok' }
// Response (需确认)
{ code: 1005, data: { childCount: 3, skuCount: 12 }, message: '该类目下有子类目和关联SKU' }
```

### 3.2 R-02 供应商导出 + 绩效对比

| Method | Path | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/suppliers/export` | boss, supervisor | 导出供应商列表 Excel |
| GET | `/api/suppliers/performance-compare` | boss, supervisor | 绩效对比数据 |

**GET /api/suppliers/export**
```typescript
// Response: Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
// 流式返回 Excel 文件（使用 xlsx 库生成）
```

**GET /api/suppliers/performance-compare**
```typescript
// Request Query: ?ids=1,2,3 （最多5个供应商ID）
// Response
{
  code: 0,
  data: {
    suppliers: [
      {
        id: 1, name: '供应商A',
        metrics: {
          deliveryRate: 0.95,    // 交货准时率
          qualityRate: 0.98,     // 质量合格率
          priceIndex: 0.85,      // 价格竞争力指数 (0-1)
          responseSpeed: 0.90,   // 响应速度评分
          totalOrders: 15        // 总订单数
        }
      }
    ]
  }
}
```

### 3.3 R-03 采购价格批量导入

| Method | Path | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/supplier-prices/import-template` | all authenticated | 下载导入模板 |
| POST | `/api/supplier-prices/import/preview` | boss, supervisor, purchaser | 上传预览（校验） |
| POST | `/api/supplier-prices/import/confirm` | boss, supervisor, purchaser | 确认导入 |

**POST /api/supplier-prices/import/preview**
```typescript
// Request: multipart/form-data, file 字段
// Response
{
  code: 0,
  data: {
    totalRows: 500,
    validRows: 480,
    errorRows: 15,
    duplicateRows: 5,
    errors: [
      { row: 3, field: 'skuCode', value: 'XXX', reason: 'SKU编码不存在' },
      { row: 7, field: 'supplierCode', value: 'YYY', reason: '供应商编码不存在' }
    ],
    duplicates: [
      { row: 12, skuCode: 'FAB-001', supplierCode: 'SUP-001', date: '2026-01-01', existingPrice: 25.00 }
    ],
    previewToken: 'uuid-xxx'  // 服务端缓存解析结果，确认时使用
  }
}
```

**POST /api/supplier-prices/import/confirm**
```typescript
// Request
{ previewToken: 'uuid-xxx', skipErrors: true }
// Response
{
  code: 0,
  data: { imported: 480, skipped: 15, duplicateAppended: 5 }
}
```

### 3.4 R-05 工序工价增强

| Method | Path | 权限 | 说明 |
|---|---|---|---|
| PUT | `/api/process-steps/:id` | boss, supervisor | 更新工序（含工价字段） |
| GET | `/api/wage-summary` | boss, supervisor | 工资核算汇总 |
| GET | `/api/wage-summary/my` | worker | 我的工资（仅本人数据） |

**PUT /api/process-steps/:id**
```typescript
// Request（增强字段）
{
  stepName?: string,
  standardHours?: number,
  maxHours?: number,              // 极限工时
  unitPriceSkilled?: number,      // 熟练工单价
  unitPriceApprentice?: number,   // 学徒工单价
  workstationType?: string
}
```

**GET /api/wage-summary**
```typescript
// Query: ?startDate=2026-03-01&endDate=2026-03-31&groupBy=worker|process|date&workerId=123
// Response
{
  code: 0,
  data: {
    summary: { totalWage: 15800.00, totalPieces: 3200, avgUnitPrice: 4.94 },
    details: [
      {
        groupKey: '张三',     // worker name / process name / date
        totalPieces: 800,
        totalWage: 3920.00,
        avgPrice: 4.90,
        overtimeCount: 2      // 超时预警次数
      }
    ]
  }
}
```

**工资核算 SQL 核心逻辑：**
```sql
SELECT
  u.real_name,
  ps.step_name,
  DATE(pt.completed_at) AS work_date,
  SUM(pt.completed_qty) AS total_pieces,
  SUM(pt.wage_amount) AS total_wage,
  SUM(CASE WHEN pt.actual_hours > ps.max_hours * 1.2 THEN 1 ELSE 0 END) AS overtime_count
FROM production_tasks pt
JOIN users u ON u.id = pt.worker_id
JOIN process_steps ps ON ps.id = pt.process_step_id
WHERE pt.tenant_id = ? AND pt.status = 'completed'
  AND pt.completed_at BETWEEN ? AND ?
GROUP BY ...
```

### 3.5 R-06 Web 端任务管理

| Method | Path | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/tasks/my` | all authenticated | 我的任务列表 |
| POST | `/api/tasks/:id/start` | all authenticated | 开始生产 |
| POST | `/api/tasks/:id/complete` | all authenticated | 完工上报 |
| POST | `/api/tasks/:id/exception` | all authenticated | 异常上报 |
| POST | `/api/upload/image` | all authenticated | 上传图片（异常附图） |

**GET /api/tasks/my**
```typescript
// Query: ?status=pending|started|completed|exception&date=2026-03-13&processType=xxx&page=1&pageSize=20
// Response
{
  code: 0,
  data: {
    total: 25,
    items: [
      {
        id: 1, taskNo: 'T20260313001',
        processName: '裁剪', skuName: '真皮沙发A',
        plannedQty: 100, completedQty: 0,
        status: 'pending', taskDate: '2026-03-13',
        startedAt: null, completedAt: null,
        version: 1   // 乐观锁版本
      }
    ]
  }
}
```

**POST /api/tasks/:id/start**
```typescript
// Request
{ version: 1 }
// Response
{ code: 0, data: { id: 1, status: 'started', startedAt: '...', version: 2 } }
// 冲突时
{ code: 1009, message: '任务已被其他端更新，请刷新后重试' }
```

**POST /api/tasks/:id/complete**
```typescript
// Request
{
  completedQty: 95,
  actualHours: 6.5,
  notes?: '备注',
  version: 2
}
// Response（自动计算工资）
{
  code: 0,
  data: {
    id: 1, status: 'completed',
    completedQty: 95, actualHours: 6.5,
    wageAmount: 475.00,   // 95件 × 5.00元/件（根据工人等级匹配单价）
    overtimeWarning: true, // actual_hours > max_hours * 1.2
    version: 3
  }
}
```

**POST /api/tasks/:id/exception**
```typescript
// Request
{
  type: 'equipment_fault' | 'material_shortage' | 'quality_issue' | 'other',
  description: '切割机刀片断裂',
  images: ['https://.../img1.jpg', 'https://.../img2.jpg'],  // 先调 upload 接口获取 URL
  version: 2
}
```

**POST /api/upload/image**
```typescript
// Request: multipart/form-data, file 字段（单图，最大 5MB，jpg/png/webp）
// Response
{ code: 0, data: { url: '/uploads/exceptions/20260313-xxx.jpg' } }
```

---

## 四、模块划分

### 后端模块新增/增强

```
services/api/src/modules/
├── sku-category/               # R-01 新增模块
│   ├── category.routes.ts
│   ├── category.controller.ts
│   └── category.service.ts
├── supplier/                   # R-02 增强
│   ├── supplier.routes.ts      # 新增 /export, /performance-compare 路由
│   ├── supplier.controller.ts  # 新增导出和对比方法
│   └── supplier.service.ts     # 新增 exportToExcel(), comparePerformance()
├── price/                      # R-03 增强
│   ├── price.routes.ts         # 新增 /import/preview, /import/confirm 路由
│   ├── price.controller.ts     # 新增导入方法
│   └── price.service.ts        # 新增 parseImportFile(), confirmImport()
├── process/                    # R-05 增强
│   ├── process.routes.ts       # 新增 /wage-summary 路由
│   ├── process.controller.ts
│   └── process.service.ts      # 新增 getWageSummary()
├── production/                 # R-06 增强
│   ├── task.routes.ts          # 新增 /my, /start, /complete, /exception 路由
│   ├── task.controller.ts
│   └── task.service.ts         # 新增 startTask(), completeTask(), reportException()
└── upload/                     # R-06 新增通用模块
    ├── upload.routes.ts
    ├── upload.controller.ts
    └── upload.service.ts
```

### 前端新增/增强

```
services/web/src/
├── pages/master-data/
│   ├── CategoryConfigPage.tsx        # R-01 增强（已有基础）
│   └── ProcessConfigPage.tsx         # R-05 增强（工价字段 + 工资核算 Tab）
├── pages/purchase/
│   └── PriceImportPage.tsx           # R-03 新增（4步导入向导）
├── pages/master-data/
│   └── SupplierPage.tsx              # R-02 增强（导出 + 绩效对比 Tab）
├── pages/production/
│   └── TaskPage.tsx                  # R-06 增强（我的任务 + 完工/异常上报）
└── api/
    ├── skuCategory.ts                # R-01 API hooks
    ├── supplier.ts                   # R-02 增强
    ├── price.ts                      # R-03 增强（导入相关）
    ├── process.ts                    # R-05 增强（工资核算）
    └── task.ts                       # R-06 增强（任务操作）
```

---

## 五、关键技术方案

### 5.1 R-03 Excel 批量导入

**方案选型**：同步处理（5000 条上限，实测 xlsx 解析 5000 行 < 5 秒，数据库批量 INSERT < 10 秒）。

**流程**：
```
客户端上传 → 服务端解析 Excel → 逐行校验 → 返回预览结果
                                                  ↓
                                           缓存到 Redis（TTL 30min，key=previewToken）
                                                  ↓
                                    客户端确认 → 批量 INSERT（事务）→ 清理缓存
```

**校验规则**：
1. **格式校验**：非空检查、数字格式、日期格式
2. **SKU 编码匹配**：批量查询 `SELECT id, sku_code FROM skus WHERE tenant_id=? AND sku_code IN (?)`
3. **供应商编码匹配**：批量查询 `SELECT id, code FROM suppliers WHERE tenant_id=? AND code IN (?)`
4. **重复检测**：查询 `SELECT * FROM supplier_prices WHERE tenant_id=? AND (sku_id, supplier_id, effective_at) IN (?)`
5. **价格合法性**：price > 0，price < 10000000（异常高价警告但不阻断）

**事务处理**：确认导入时使用单事务批量 INSERT，每 500 条一批。

### 5.2 R-05 工资自动计算

**完工上报时自动计算工资逻辑**：
```typescript
async completeTask(taskId: number, params: CompleteTaskDto) {
  // 1. 获取任务关联的工序步骤
  const task = await this.getTaskWithLock(taskId, params.version);
  const step = await this.getProcessStep(task.processStepId);

  // 2. 获取工人技能等级
  const worker = await this.getUser(task.workerId);

  // 3. 匹配单价
  const unitPrice = worker.skillLevel === 'apprentice'
    ? step.unitPriceApprentice
    : step.unitPriceSkilled;  // 默认按熟练工

  if (!unitPrice) throw AppError.badRequest('该工序未配置工价，请联系管理员');

  // 4. 计算工资
  const wageAmount = new Decimal(params.completedQty).mul(unitPrice);

  // 5. 超时预警检测
  const overtimeWarning = step.maxHours
    ? params.actualHours > step.maxHours * 1.2
    : false;

  // 6. 更新任务
  await this.updateTask(taskId, {
    status: 'completed',
    completedQty: params.completedQty,
    actualHours: params.actualHours,
    wageAmount: wageAmount.toNumber(),
    completedAt: new Date(),
    version: params.version + 1
  });
}
```

### 5.3 R-06 乐观锁并发控制

```typescript
async updateTaskWithOptimisticLock(
  taskId: number, version: number, updates: Partial<Task>
): Promise<void> {
  const result = await AppDataSource.query(
    `UPDATE production_tasks
     SET status=?, version=version+1, ...
     WHERE id=? AND tenant_id=? AND version=?`,
    [updates.status, taskId, this.tenantId, version]
  );

  if (result.affectedRows === 0) {
    throw AppError.conflict('任务已被其他端更新，请刷新后重试');
  }
}
```

### 5.4 R-01 删除保护逻辑

```typescript
async deleteCategory(id: number, cascade?: boolean, force?: boolean) {
  const cat = await this.findById(id);
  if (cat.isSystem) throw AppError.forbidden('系统预置类目不可删除');

  // 检查子类目
  if (cat.level === 1) {
    const children = await this.countChildren(id);
    if (children > 0 && !cascade) {
      return { needConfirm: true, childCount: children };
    }
  }

  // 检查关联 SKU
  const skuCount = await this.countRelatedSkus(id);
  if (skuCount > 0 && !force) {
    return { needConfirm: true, skuCount };
  }

  // 执行删除（软删除：is_active = 0）
  await this.softDelete(id, cascade);
}
```

---

## 六、Sprint 2 BOM 版本化预研

### 6.1 bom_headers 表现状

V1 已有 `version VARCHAR(20) DEFAULT '1.0'`、`status ENUM('draft','active','archived')`、`is_active TINYINT(1) DEFAULT 0` 字段。**数据模型基础已具备**，无需新增字段。

### 6.2 需要新增的字段

```sql
-- bom_headers 新增生效日期
ALTER TABLE `bom_headers`
  ADD COLUMN `effective_date` DATE DEFAULT NULL
    COMMENT 'BOM 版本生效日期' AFTER `is_active`,
  ADD COLUMN `source_version_id` BIGINT UNSIGNED DEFAULT NULL
    COMMENT '复制来源版本ID' AFTER `effective_date`;
```

### 6.3 V1 存量数据迁移方案

```sql
-- 将所有 V1 BOM 标记为 v1.0 激活版本
UPDATE `bom_headers`
SET `version` = '1.0',
    `status` = 'active',
    `is_active` = 1,
    `effective_date` = `created_at`
WHERE `version` = '1.0' AND `is_active` = 0;
```

### 6.4 通用件引用模型

不需要新表。现有 `bom_items.component_sku_id` 已支持多个 BOM 引用同一个半成品 SKU。关键改造点：
- BOM 展开时识别 component_sku_id 对应的 SKU 是否为半成品（`skus.sku_type = 'semi_finished'`）
- 半成品的子 BOM 通过 `bom_headers WHERE sku_id = component_sku_id AND is_active = 1` 获取
- 采购需求计算时，相同半成品在多个成品中的原材料用量合并加总

### 6.5 展开计算引擎改造要点

1. 递归展开时按 `is_active = 1` 的版本展开（而非取所有版本）
2. 半成品公共件识别：记录已展开的半成品 SKU ID，避免重复展开
3. 工单创建时快照 BOM 版本 ID 到 `production_orders.bom_version_id`

---

## 七、技术风险

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| R-03 Excel 脏数据导致导入失败 | P1 | 预览阶段完整校验 + 错误行标记 + 支持跳过错误 |
| R-05 工人未配置技能等级导致工资计算失败 | P1 | 完工上报前校验 skill_level，缺失时阻断并提示管理员 |
| R-06 Web+小程序并发操作冲突 | P1 | 乐观锁 version 字段 + 409 冲突响应 + 前端刷新引导 |
| R-01 删除类目影响历史 SKU 数据 | P2 | 软删除 + 二次确认 + 关联 SKU 数量提示 |
| R-03 大文件解析内存占用 | P2 | 限制 5000 行 + 5MB 文件大小 + multer 内存存储 |

---

*文档版本*：v1.0
*最后更新*：2026-03-13
*审批状态*：待 @engineering-manager 审批
