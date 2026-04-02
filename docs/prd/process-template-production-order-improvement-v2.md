# [artifact:PRD] 工序配置与生产工单改进方案 V2

- 文档编号: PRD-2026-0324-001
- 版本: 2.0
- 作者: senior-ai-agent-pm
- 日期: 2026-03-24
- 状态: 待评审

---

## 一、背景与问题定义（Why）

### 1.1 业务背景

当前系统已具备工序模板（process_templates / process_steps）、生产工单（production_orders）、BOM、库存等核心数据模型。但在实际生产管理中存在以下问题：

1. **工单创建隐患**：工单创建时隐式取最新模板，无"默认模板"概念，导致工艺选择不可预期、不可追溯。一旦模板被误改，新建工单直接继承错误工艺。
2. **工艺数据无快照**：工单下发后，若模板被修改，已下发工单的工艺标准跟着变化，造成生产执行标准不一致，存在严重的生产安全隐患。
3. **物料信息断裂**：工厂拿到工单后，无法在同一页面看到所需全部物料和产出 SKU，需要跳转多个页面手动核对，效率低下且容易出错。
4. **损耗体系单一**：仅有 BOM 级计划损耗率，缺乏工序级实际损耗记录，无法进行计划成本与实际成本的对比分析，成本优化无数据支撑。

### 1.2 业务约束（已确认）

- 工单下发时必须快照当时的工序模板（完整工艺数据），模板后续修改不影响已有工单
- 工厂拿到工单必须能看到：所需全部物料 + 产出 SKU
- BOM 级损耗用于计划备料，工序级损耗是实际执行记录，计算总成本两者都需要
- 暂无多工厂场景

---

## 二、目标与范围（What）

### 2.1 业务目标

| 编号 | 目标 | 衡量标准 |
|------|------|----------|
| G-01 | 消除工单工艺不确定性 | 每个 SKU 有且仅有一个默认工序模板 |
| G-02 | 确保已下发工单的工艺不可变 | 工单下发后工艺数据与模板完全解耦 |
| G-03 | 提升备料效率 | 备料员在工单详情页一次性获取全部物料需求 |
| G-04 | 建立成本分析基础 | 工序级实际损耗可录入，计划/实际成本可对比 |

### 2.2 用户角色

| 角色 | 职责 | 核心诉求 |
|------|------|----------|
| 生产主管 | 创建/下发工单，管理工序模板 | 工艺选择可预期、可追溯 |
| 工厂管理员 | 执行工单，监控生产进度 | 下发后工艺标准不变 |
| 备料员 | 根据工单准备物料 | 一次看全物料需求和库存状态 |
| 工人 | 执行工序，填报消耗 | 快速填报实际物料消耗 |
| 成本会计 | 核算生产成本 | 对比计划与实际成本，识别异常 |

### 2.3 不在范围内

- 多工厂场景支持
- 工序自动排程
- 物料自动采购触发
- 工序间物料流转追踪

---

## 三、功能方案（How）

---

### 模块一：工序模板默认化

- 优先级: P0
- 工作量估算: 3 天（后端 2 天 + 前端 1 天）
- 前置依赖: 无

#### 3.1.1 问题陈述

当前工单创建时隐式取最新模板，无明确的"默认模板"机制。当同一 SKU 存在多个模板（标准、试制、定制）时，系统无法自动选择正确的模板，依赖人工判断，存在选错风险。

#### 3.1.2 数据模型变更

```sql
ALTER TABLE process_templates
  ADD COLUMN is_default    TINYINT(1)  NOT NULL DEFAULT 0    COMMENT '是否默认模板',
  ADD COLUMN template_type ENUM('standard','custom','trial') NOT NULL DEFAULT 'standard' COMMENT '模板类型',
  ADD COLUMN version       VARCHAR(20) DEFAULT '1.0'         COMMENT '模板版本号';
```

唯一性约束：每个租户下每个 SKU 只能有一个默认模板。

```sql
-- MySQL 8.0+ 方案：使用生成列 + 唯一索引模拟条件唯一约束
ALTER TABLE process_templates
  ADD COLUMN default_flag BIGINT UNSIGNED
    GENERATED ALWAYS AS (CASE WHEN is_default = 1 THEN sku_id ELSE NULL END) STORED;

CREATE UNIQUE INDEX uq_tenant_sku_default
  ON process_templates(tenant_id, default_flag);
```

说明：当 is_default = 0 时，default_flag 为 NULL，NULL 不参与唯一约束；当 is_default = 1 时，default_flag = sku_id，唯一约束确保同一租户同一 SKU 最多一个默认模板。

#### 3.1.3 API 设计

**设置默认模板**

```
PATCH /api/process-configs/:id/set-default
```

- 请求体: 无（路径参数即为目标模板 ID）
- 业务逻辑（原子操作，需事务）:
  1. 查询目标模板，获取其 tenant_id 和 sku_id
  2. 将同 tenant_id + sku_id 下所有模板的 is_default 置为 0
  3. 将目标模板的 is_default 置为 1
- 响应:

```json
{
  "code": 0,
  "data": {
    "id": 1,
    "skuId": 100,
    "name": "实木餐桌-标准工艺",
    "isDefault": true,
    "version": "1.0",
    "templateType": "standard"
  },
  "message": "success"
}
```

- 错误码:
  - 404: 模板不存在
  - 409: 模板状态为"已停用"，不允许设为默认

**查询 SKU 默认模板**

```
GET /api/process-configs/default?skuId=:skuId
```

- 响应: 返回该 SKU 的默认模板完整信息（含 steps）
- 错误码:
  - 404: 该 SKU 无默认模板

#### 3.1.4 前端交互设计

**SKU 工序配置页改动：**

- 每个模板卡片右上角显示"设为默认"按钮
- 当前默认模板卡片显示蓝色"默认"标签，按钮变为"已是默认"（置灰不可点击）
- 点击"设为默认"后弹出二次确认弹窗："确认将「{模板名称}」设为 SKU「{SKU名称}」的默认工序模板？原默认模板将被替换。"
- 确认后调用 API，成功后刷新列表

**工单创建流程改动：**

- 选择 SKU 后，系统自动填充默认模板（调用 GET /api/process-configs/default）
- 若该 SKU 无默认模板，弹出模态框要求手动选择模板，提示文案："该 SKU 尚未设置默认工序模板，请手动选择或前往工序配置页设置默认模板。"
- 用户可在工单创建时切换为非默认模板（下拉选择），但需记录"非默认模板"标记

#### 3.1.5 User Story

**US-01: 设置 SKU 默认工序模板**

> As a 生产主管
> I want 为每个 SKU 指定一个默认工序模板
> So that 系统自动创建工单时工艺选择可预期、可追溯

验收条件：
1. 工序配置页每个模板可点击"设为默认"
2. 设置成功后，该模板显示"默认"标签
3. 同一 SKU 下不能同时有两个默认模板
4. 已停用模板不允许设为默认
5. 工单创建时自动关联该 SKU 的默认模板
6. 无默认模板时，工单创建弹窗提示手动选择

---

### 模块二：工单工艺快照

- 优先级: P0
- 工作量估算: 2 天（后端 2 天）
- 前置依赖: 模块一（模板默认化）

#### 3.2.1 问题陈述

当前 production_orders 仅通过外键关联 process_templates，工单下发后若模板被修改，工单的工艺标准随之变化，导致生产执行标准不一致。

#### 3.2.2 技术方案选择

**采用方案：JSON 字段快照 + 外键保留**

| 维度 | JSON 快照方案 | 独立快照表方案 |
|------|--------------|---------------|
| 读取复杂度 | 低，工单详情一次查询 | 高，需 JOIN |
| 历史隔离性 | 天然隔离 | 需额外版本控制 |
| 跨工单统计 | 需保留外键辅助 | 原生支持 |
| 存储效率 | 冗余较高 | 较优 |
| 适用场景 | 暂无多工厂、低查询量 | 高频跨工单分析 |

折中方案：同时保留 process_template_id 外键（用于"哪些工单用了模板 A"的统计查询），JSON 快照用于工单详情展示和生产执行。

#### 3.2.3 数据模型变更

```sql
ALTER TABLE production_orders
  ADD COLUMN process_template_id BIGINT UNSIGNED NULL     COMMENT '关联模板ID（用于统计查询）',
  ADD COLUMN process_snapshot    JSON            NULL     COMMENT '工艺快照（下发时冻结，不可变）',
  ADD COLUMN dispatched_at       DATETIME(3)     NULL     COMMENT '工单下发时间';
```

快照 JSON 结构定义：

```json
{
  "templateId": 1,
  "templateName": "实木餐桌-标准工艺",
  "templateType": "standard",
  "version": "1.0",
  "snapshotAt": "2026-03-24T10:00:00.000Z",
  "steps": [
    {
      "stepNo": 1,
      "stepName": "开料",
      "standardHours": 2.0,
      "maxHours": 3.0,
      "workstationType": "开料区",
      "unitPrice": 12.00
    },
    {
      "stepNo": 2,
      "stepName": "封边",
      "standardHours": 1.5,
      "maxHours": 2.0,
      "workstationType": "封边区",
      "unitPrice": 8.00
    }
  ]
}
```

#### 3.2.4 快照触发时机与规则

- 触发时机：工单状态变更为"已下发"（dispatched）时
- 不触发：工单处于"草稿"或"待审核"状态时不快照
- 快照操作：
  1. 读取工单关联的 process_template 及其 process_steps
  2. 序列化为 JSON 写入 process_snapshot 字段
  3. 记录 dispatched_at 时间戳
  4. 以上操作与状态变更在同一事务内完成
- 不可变规则：process_snapshot 字段一旦写入，后续任何操作不得修改（代码层面禁止 UPDATE 该字段）

#### 3.2.5 API 设计

**工单下发**

```
POST /api/production-orders/:id/dispatch
```

- 前置校验:
  - 工单状态必须为"待下发"
  - 关联模板必须存在且状态为启用
  - 模板下必须有至少一个工序步骤
- 业务逻辑:
  1. 生成 process_snapshot JSON
  2. 更新工单状态为"已下发"
  3. 记录 dispatched_at
- 响应:

```json
{
  "code": 0,
  "data": {
    "id": 1001,
    "status": "dispatched",
    "dispatchedAt": "2026-03-24T10:00:00.000Z",
    "processSnapshot": { "..." : "..." }
  },
  "message": "success"
}
```

**工单详情（快照读取）**

```
GET /api/production-orders/:id
```

- 响应中包含 processSnapshot 字段
- 若工单未下发，processSnapshot 为 null，前端从关联模板实时读取（标注"当前模板工艺，下发后将冻结"）

#### 3.2.6 前端交互设计

- 已下发工单详情页：工艺信息区块标题显示"工艺快照（冻结于 2026-03-24 10:00）"
- 未下发工单详情页：工艺信息区块标题显示"当前模板工艺（下发后将冻结）"，并以虚线边框暗示"未固化"状态
- 快照数据只读，不提供编辑入口

#### 3.2.7 User Story

**US-02: 工单下发时冻结工艺快照**

> As a 工厂管理员
> I want 工单下发后工艺信息固化不可变
> So that 即使后续修改工序模板，已下发工单的执行标准不受影响

验收条件：
1. 工单下发时，系统自动生成工艺快照写入 process_snapshot
2. 下发后修改原模板，再次查看该工单，工艺详情不变
3. 工单详情页显示"快照时间"标注
4. 未下发工单显示实时模板数据并标注"未冻结"
5. process_snapshot 字段写入后不可被任何操作修改

---

### 模块三：工单物料清单视图

- 优先级: P1
- 工作量估算: 4 天（后端 1 天 + 前端 3 天）
- 前置依赖: 现有 BOM 数据和库存数据

#### 3.3.1 问题陈述

工厂拿到工单后，需要在多个页面之间跳转才能获取物料需求和库存状态，效率低下且容易遗漏，导致备料不足或停工。

#### 3.3.2 API 设计

**获取工单物料需求清单**

```
GET /api/production-orders/:id/material-requirements
```

- 业务逻辑:
  1. 根据工单的 skuId 查询 BOM 获取物料清单
  2. 计算净用量 = BOM 单位用量 x 工单数量
  3. 计算含损耗量 = 净用量 x (1 + BOM 损耗率)
  4. 批量查询 inventory 获取各物料当前库存
  5. 判断库存充足性：含损耗量 > 当前库存 则标记 insufficient

- 响应:

```json
{
  "code": 0,
  "data": {
    "orderId": 1001,
    "skuName": "实木餐桌",
    "quantity": 10,
    "materials": [
      {
        "materialId": 201,
        "materialName": "橡木板",
        "spec": "1200mm",
        "unit": "张",
        "unitUsage": 5.0,
        "netQty": 50.0,
        "lossRate": 0.10,
        "grossQty": 55.0,
        "currentStock": 200.0,
        "sufficient": true
      },
      {
        "materialId": 202,
        "materialName": "螺丝",
        "spec": "M8x30",
        "unit": "颗",
        "unitUsage": 20.0,
        "netQty": 200.0,
        "lossRate": 0.05,
        "grossQty": 210.0,
        "currentStock": 50.0,
        "sufficient": false
      }
    ],
    "hasInsufficientMaterial": true
  },
  "message": "success"
}
```

#### 3.3.3 前端交互设计

**工单详情页信息架构（自上而下）：**

```
+--------------------------------------------------+
|  工单基本信息                                      |
|  工单号: WO-2026-0324-001                         |
|  产出: 实木餐桌 x 10 套  [SKU: TB-001]            |
|  状态: 已下发  下发时间: 2026-03-24 10:00          |
+--------------------------------------------------+
|  [Tab: 物料需求] [Tab: 工艺详情] [Tab: 执行记录]   |
+--------------------------------------------------+
|  物料需求清单                                      |
|  +----------+------+--------+--------+----------+ |
|  | 物料名称 | 规格 | 净用量 | 含损耗 | 当前库存  | |
|  +----------+------+--------+--------+----------+ |
|  | 橡木板   |1200mm| 50张   | 55张   | 200张    | |
|  | 螺丝    |M8x30 | 200颗  | 210颗  | 50颗 [!] | |
|  +----------+------+--------+--------+----------+ |
|  [!] 表示库存不足，行背景色标红                     |
|                                                    |
|  物料总览: 2 种物料，其中 1 种库存不足              |
+--------------------------------------------------+
|  工序物料分配（折叠区域，默认收起）                  |
|  > 开料 (2.0h) -- 橡木板 55张                     |
|  > 封边 (1.5h) -- 封边条 22m                      |
|  > 装配 (3.0h) -- 螺丝 210颗、合页 40个           |
+--------------------------------------------------+
```

**交互细节：**

- 物料需求清单默认展开，工序物料分配默认收起
- 库存不足的物料行：行背景色 #FFF2F0，库存数字颜色 #FF4D4F，行尾显示警告图标
- 库存充足的物料行：库存数字颜色 #52C41A
- 表头支持按"含损耗量"排序
- 右上角提供"打印物料清单"按钮，生成适合 A4 打印的物料清单（含工单号、SKU、物料明细）

**工序物料分配（P1.5，可后期实现）：**

初期工序物料分配区域展示静态信息（来源于 BOM + 快照中的步骤信息），后期若需精确到工序级别的物料分配，需新增 process_step_materials 表。

```sql
-- 预留数据模型，P1.5 实施时启用
CREATE TABLE process_step_materials (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  template_id     BIGINT UNSIGNED NOT NULL,
  step_no         SMALLINT        NOT NULL,
  material_id     BIGINT UNSIGNED NOT NULL,
  usage_per_unit  DECIMAL(12,4)   NOT NULL COMMENT '单位产品该工序物料用量',
  PRIMARY KEY (id),
  KEY idx_template_step (tenant_id, template_id, step_no)
) ENGINE=InnoDB;
```

#### 3.3.4 User Story

**US-03: 工单物料需求清单**

> As a 备料员
> I want 在工单详情页看到完整物料需求（含损耗）和库存状态
> So that 能准确备料，不会因物料不足导致停工

验收条件：
1. 工单详情页展示物料需求清单，包含物料名称、规格、净用量、含损耗量、当前库存
2. 净用量 = BOM 单位用量 x 工单数量（精度到小数点后 2 位）
3. 含损耗量 = 净用量 x (1 + BOM 损耗率)（精度到小数点后 2 位，向上取整到最小单位）
4. 库存不足的物料行标红显示警告
5. 物料清单支持打印（A4 格式，含工单号和 SKU 信息）
6. 库存数据实时查询（页面加载时请求，非缓存）

---

### 模块四：两套损耗体系

- 优先级: P1（录入）/ P2（分析报表）
- 工作量估算: 7 天（录入 4 天 + 报表 3 天）
- 前置依赖: 工单工艺快照（模块二）

#### 3.4.1 损耗体系设计

**计划损耗（BOM 级） -- 已有，需完善展示**

- 数据来源: bom 表的 loss_rate 字段
- 用途: 生成采购需求量、工单备料数量
- 计算公式: 采购需求量 = 净用量 x (1 + loss_rate)
- UI 体现: 工单物料清单"含损耗"列（模块三已覆盖）

**实际损耗（工序级） -- 需新建**

- 数据来源: 工人完工时填报
- 用途: 实际成本核算、工艺优化分析
- 粒度: 每张工单每道工序每种物料

#### 3.4.2 数据模型变更

```sql
CREATE TABLE process_step_losses (
  id              BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  tenant_id       BIGINT UNSIGNED   NOT NULL,
  order_id        BIGINT UNSIGNED   NOT NULL  COMMENT '生产工单ID',
  step_no         SMALLINT          NOT NULL  COMMENT '工序步骤号',
  material_id     BIGINT UNSIGNED   NULL      COMMENT '消耗物料ID',
  planned_qty     DECIMAL(12,4)     NULL      COMMENT '计划用量',
  actual_qty      DECIMAL(12,4)     NULL      COMMENT '实际用量',
  loss_qty        DECIMAL(12,4)     GENERATED ALWAYS AS (actual_qty - planned_qty) STORED
                                              COMMENT '损耗量（正=超耗,负=节约）',
  loss_rate       DECIMAL(8,4)      GENERATED ALWAYS AS (
                    CASE WHEN planned_qty > 0 THEN (actual_qty - planned_qty) / planned_qty
                    ELSE NULL END
                  ) STORED                    COMMENT '损耗率',
  remark          VARCHAR(500)      NULL      COMMENT '备注（异常原因等）',
  recorded_by     BIGINT UNSIGNED   NULL      COMMENT '记录人',
  recorded_at     DATETIME(3)       NULL      COMMENT '记录时间',
  created_at      DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_order     (tenant_id, order_id),
  KEY idx_material  (tenant_id, material_id, recorded_at)
) ENGINE=InnoDB COMMENT='工序级实际损耗记录';
```

#### 3.4.3 API 设计

**提交工序实际损耗**

```
POST /api/production-orders/:orderId/steps/:stepNo/losses
```

请求体:

```json
{
  "materials": [
    {
      "materialId": 201,
      "plannedQty": 55.0,
      "actualQty": 58.0,
      "remark": "板材有瑕疵，多切了3张"
    }
  ]
}
```

业务规则:
- 仅允许已下发且未完工的工单提交损耗
- plannedQty 由系统预填（来源于 BOM 含损耗量按工序拆分），工人可修正
- actualQty 必须 >= 0
- 同一工单同一工序同一物料可多次提交（追加记录，取最新一条用于统计）

响应:

```json
{
  "code": 0,
  "data": {
    "orderId": 1001,
    "stepNo": 1,
    "losses": [
      {
        "materialId": 201,
        "materialName": "橡木板",
        "plannedQty": 55.0,
        "actualQty": 58.0,
        "lossQty": 3.0,
        "lossRate": 0.0545
      }
    ]
  },
  "message": "success"
}
```

**获取工单成本对比**

```
GET /api/production-orders/:orderId/cost-analysis
```

响应:

```json
{
  "code": 0,
  "data": {
    "orderId": 1001,
    "plannedCost": 5200.00,
    "actualCost": 5460.00,
    "variance": 260.00,
    "varianceRate": 0.05,
    "alert": true,
    "details": [
      {
        "materialId": 201,
        "materialName": "橡木板",
        "unitPrice": 80.00,
        "plannedQty": 55.0,
        "actualQty": 58.0,
        "plannedCost": 4400.00,
        "actualCost": 4640.00,
        "variance": 240.00,
        "varianceRate": 0.0545
      }
    ]
  },
  "message": "success"
}
```

#### 3.4.4 前端交互设计

**工序完工填报页（P1）：**

```
+--------------------------------------------------+
|  工单 WO-2026-0324-001 > 工序 1: 开料 > 完工填报  |
+--------------------------------------------------+
|  物料消耗填报                                      |
|  +----------+--------+-----------+-------+------+ |
|  | 物料名称 | 计划量 | 实际用量  | 差异  | 备注 | |
|  +----------+--------+-----------+-------+------+ |
|  | 橡木板   | 55张   | [  58  ]  | +3张  |[   ]| |
|  | 封边条   | 22m    | [  22  ]  |  0m   |[   ]| |
|  +----------+--------+-----------+-------+------+ |
|                                                    |
|  [提交] [暂存]                                     |
+--------------------------------------------------+
```

交互细节:
- "计划量"列预填系统计算值（只读）
- "实际用量"列可编辑，默认值等于计划量
- "差异"列实时计算（实际 - 计划），正值标红，负值标绿
- 差异率 > 10% 时弹出确认提示："差异率较大，请确认实际用量是否正确"
- 支持填写备注说明异常原因
- 提交前校验：实际用量不能为空或负数

**成本差异分析页（P2）：**

```
+--------------------------------------------------+
|  成本差异分析                                      |
|                                                    |
|  筛选: [日期范围] [SKU] [工单号]                   |
|                                                    |
|  汇总卡片:                                         |
|  +------------+  +------------+  +--------------+  |
|  | 计划总成本 |  | 实际总成本 |  | 总差异率     |  |
|  | 52,000     |  | 54,600     |  | +5.0% [!]   |  |
|  +------------+  +------------+  +--------------+  |
|                                                    |
|  工单明细表:                                       |
|  +--------+--------+--------+--------+---------+  |
|  | 工单号 | 计划成本| 实际成本| 差异率 | 操作    |  |
|  +--------+--------+--------+--------+---------+  |
|  | WO-001 | 5,200  | 5,460  | +5.0%  | [详情]  |  |
|  | WO-002 | 3,800  | 3,700  | -2.6%  | [详情]  |  |
|  +--------+--------+--------+--------+---------+  |
|                                                    |
|  预警规则: 差异率 > 5% 标红                        |
+--------------------------------------------------+
```

成本计算公式:
- 计划成本 = SUM(物料单价 x BOM 用量 x (1 + BOM 损耗率)) x 工单数量
- 实际成本 = SUM(物料单价 x 实际用量)
- 差异率 = (实际成本 - 计划成本) / 计划成本 x 100%
- 预警线: 差异率 > 5% 时触发标红提醒

#### 3.4.5 User Stories

**US-04: 成本差异分析**

> As a 成本会计
> I want 对比每张工单的计划成本与实际成本
> So that 快速识别高损耗工序并推动工艺优化

验收条件：
1. 工单完工后，成本分析页显示计划成本、实际成本、差异率
2. 差异率 > 5% 时行标红显示
3. 点击工单可下钻查看各物料的计划/实际用量对比
4. 支持按日期范围、SKU、工单号筛选
5. 汇总卡片显示选定范围内的总计划成本、总实际成本、总差异率

**US-05: 工序完工物料消耗填报**

> As a 工人
> I want 完工时填报实际物料消耗
> So that 系统能准确记录真实损耗用于成本核算

验收条件：
1. 生产任务完工确认页包含物料消耗填报表单
2. 计划用量字段预填系统计算值（只读）
3. 实际用量字段可编辑，默认等于计划量
4. 差异量实时计算显示
5. 差异率 > 10% 时弹出二次确认
6. 实际用量不能为负数
7. 提交后数据不可删除（可追加修正记录）

---

## 四、非功能需求

| 编号 | 类别 | 要求 | 优先级 |
|------|------|------|--------|
| NFR-01 | 性能 | 工单详情页（含物料清单）加载时间 < 2s | P0 |
| NFR-02 | 性能 | 工艺快照写入不增加工单下发接口响应时间超过 500ms | P0 |
| NFR-03 | 数据完整性 | 设置默认模板为原子操作，不允许出现"0个默认"或"2个默认"的中间态 | P0 |
| NFR-04 | 数据完整性 | 工艺快照一旦写入不可修改，代码层面禁止 UPDATE process_snapshot 字段 | P0 |
| NFR-05 | 兼容性 | 历史工单（无快照字段）正常显示，快照区域显示"该工单创建于快照功能上线前" | P1 |
| NFR-06 | 打印 | 物料清单打印适配 A4 纸张，Chrome/Edge 浏览器 | P1 |
| NFR-07 | 数据精度 | 所有金额精度到分（2位小数），数量精度到 4 位小数 | P1 |
| NFR-08 | 审计 | 默认模板变更记录操作日志（谁在什么时间将哪个模板设为默认） | P1 |

---

## 五、数据模型变更汇总

| 表名 | 变更类型 | 变更内容 |
|------|----------|----------|
| process_templates | ALTER - 新增字段 | is_default (TINYINT), template_type (ENUM), version (VARCHAR) |
| process_templates | ALTER - 新增索引 | uq_tenant_sku_default（条件唯一约束） |
| production_orders | ALTER - 新增字段 | process_template_id (BIGINT), process_snapshot (JSON), dispatched_at (DATETIME) |
| process_step_losses | CREATE TABLE | 工序级实际损耗记录（完整建表 SQL 见模块四） |
| process_step_materials | CREATE TABLE（P1.5 预留） | 工序物料分配（预留，暂不实施） |

---

## 六、实施路线图

| 阶段 | 优先级 | 模块 | 工作量 | 依赖 | 负责角色 |
|------|--------|------|--------|------|----------|
| Sprint 1 | P0 | 工序模板默认化 - 后端 | 2d | 无 | @senior-backend-engineer |
| Sprint 1 | P0 | 工序模板默认化 - 前端 | 1d | 后端 API 就绪 | @senior-frontend-engineer |
| Sprint 1 | P0 | 工单工艺快照 - 后端 | 2d | 模板默认化 | @senior-backend-engineer |
| Sprint 2 | P1 | 工单物料清单视图 - 后端 | 1d | 无 | @senior-backend-engineer |
| Sprint 2 | P1 | 工单物料清单视图 - 前端 | 3d | 后端 API 就绪 | @senior-frontend-engineer |
| Sprint 2 | P1 | 库存不足预警 | 1d | 物料清单视图 | @senior-frontend-engineer |
| Sprint 3 | P1 | 工序级实际损耗录入 | 4d | 工单快照 | @senior-backend-engineer + @senior-frontend-engineer |
| Sprint 4 | P2 | 计划 vs 实际成本分析报表 | 3d | 实际损耗数据 | @senior-backend-engineer + @senior-frontend-engineer |

总计: 约 17 人天，分 4 个 Sprint 迭代交付。

---

## 七、验收标准总览

| 编号 | 验收项 | 通过标准 |
|------|--------|----------|
| AC-01 | 默认模板设置 | 同一 SKU 设置默认模板后，其他模板自动取消默认；并发请求不产生多默认 |
| AC-02 | 工单自动关联默认模板 | 创建工单选择 SKU 后，默认模板自动填充；无默认模板时弹窗提示 |
| AC-03 | 工艺快照不可变 | 工单下发后修改原模板，再查看工单详情，工艺数据不变 |
| AC-04 | 物料需求准确性 | 含损耗量 = 净用量 x (1 + 损耗率)，与 BOM 数据一致 |
| AC-05 | 库存预警 | 库存不足物料标红，数据实时 |
| AC-06 | 损耗填报 | 工人提交实际用量后，系统正确计算损耗量和损耗率 |
| AC-07 | 成本分析 | 差异率 > 5% 标红，计划成本和实际成本计算公式正确 |
| AC-08 | 历史兼容 | 快照上线前的历史工单正常显示，无报错 |

---

## 八、风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| JSON 快照数据量增长导致查询变慢 | 工单列表页性能下降 | 低 | 工单列表不查 process_snapshot 字段，仅详情页加载 |
| 工人填报实际用量不准确 | 成本分析数据失真 | 中 | 差异率 > 10% 二次确认；后期可引入称重/扫码自动记录 |
| 默认模板并发设置竞争 | 数据库唯一约束冲突 | 低 | 事务 + 唯一索引兜底，前端捕获冲突后提示刷新 |
| 历史工单无快照数据 | 展示不一致 | 确定 | 前端兼容处理，显示"快照功能上线前创建" |

---

## 九、任务分发

### @senior-ui-designer

请基于本 PRD 中模块三（物料清单视图）和模块四（损耗填报页、成本分析页）的页面结构描述，产出以下交付物：
1. [artifact:设计规范] -- 物料清单表格、库存预警状态、损耗填报表单的视觉规范
2. [artifact:UI代码] -- 关键页面的 HTML/CSS 效果图
3. [artifact:交互说明] -- 库存不足预警动效、差异率超限弹窗确认、折叠展开动画

### @tech-lead-architect

请基于本 PRD 产出以下交付物：
1. [artifact:架构设计] -- 快照方案的技术详设（事务边界、JSON schema 校验、不可变约束实现方式）
2. [artifact:数据库设计] -- 完整的变更 SQL（含索引、约束、迁移脚本）
3. [artifact:API文档] -- 全部新增/变更 API 的完整接口文档
4. [artifact:技术任务拆解] -- 按 Sprint 拆解的工程任务卡（含验收标准和估时）

---

文档结束。
