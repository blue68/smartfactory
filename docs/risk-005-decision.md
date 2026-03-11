# [artifact:PRD] RISK-005 产品决策文档
# 跨色号出库主管二次审批机制

**文档编号**：RISK-005-DECISION
**决策日期**：2026-03-11
**决策人**：@senior-ai-agent-pm
**状态**：已决策，待实现
**关联风险项**：acceptance-report.md § 6.2 RISK-005

---

## 一、背景

### 当前系统行为（问题根源）

通过阅读 `services/api/src/modules/inventory/inventory.service.ts` 的 `outbound()` 方法，发现以下关键事实：

1. `checkDyeLotConsistency()` 已正确检测跨色号行为，并将结果写入 `inventory_transactions.is_cross_dye_lot` 字段
2. `ResponseCode.INVENTORY_CROSS_DYE_LOT = 4004` 已在 `ApiResponse.ts` 中定义
3. **但 `isCrossDyeLot = true` 时，函数不抛出任何错误，出库流程照常完成**
4. 结果：跨色号出库被静默记录，操作人员无任何感知

这意味着：色号一致性校验只做了"记录"，没有做"管控"。4004 错误码定义了但从未被使用。

### 纺织行业色号管理的重要性

色号（Dye Lot）在纺织面料生产中是核心质量维度：

- 同一色号内，纤维染色批次、色牢度、色深完全一致
- 不同色号之间存在肉眼可见的色差（即使颜色编码相同）
- 将不同色号的面料用于同一件成品，会导致色差投诉、退货、品牌声誉损失
- 在行业实践中，跨色号混用属于严重质量事故，客户普遍不接受（高端客户尤为严格）

### 当前 PRD 与用户故事中的相关约束

用户故事 US-305（车间主管）已明确要求：
- 跨缸号时强警告弹窗且需填原因
- 首次领料自由选择并设为基准
- 验收报告评定该故事状态为"已通过"

但 US-305 针对的是**领料场景（工序内部物料流转）**，而 RISK-005 涉及的是**出库到外部或跨订单的出库场景**，两者的风险等级和处理方式应有所区分。

---

## 二、Why（为什么需要决策）

### 问题定义

当前系统的跨色号出库行为存在以下漏洞：

| 维度 | 现状 | 风险 |
|---|---|---|
| 系统管控 | 静默记录，无拦截 | 操作人员不知情完成跨色号出库 |
| 质量追溯 | is_cross_dye_lot 字段已记录 | 但事后追溯不能挽回色差损失 |
| 责任归属 | 无审批记录 | 发生纠纷时无法证明决策链路 |
| 客户场景 | 未区分客户要求 | 部分客户接受混色号，一刀切拦截损害效率 |

### 核心矛盾

质量保障（强拦截）vs 生产效率（弱管控）之间需要产品做出明确取舍。

---

## 三、What（决策结论）

**采用分级管控策略，而非一刀切强拦截，也非完全放任。**

### 决策结论

**实施"强制阻断 + 主管授权放行"的双轨机制**：

1. 跨色号出库时，系统**默认阻断**，不允许操作人员自行完成
2. 需要车间主管（Workshop Supervisor）在系统内完成**实名授权**，填写放行原因后方可出库
3. 针对"客户已书面确认接受混色号"这一合理业务场景，在放行原因中提供标准选项，主管选择后系统记录存档
4. 出库完成后，生成跨色号出库记录，推送给老板驾驶舱的质量预警模块

---

## 四、How（具体产品方案）

### 4.1 功能清单

#### F-NEW-001 跨色号出库拦截（P1，核心）

**触发条件**：
`outbound()` 中 `checkDyeLotConsistency()` 返回 `true` 时

**系统行为**：
- 抛出业务错误，HTTP 200 + code=4004（激活已定义但未使用的错误码）
- 响应体携带当前绑定色号、本次请求色号、跨色号预警详情

**前端表现**：
- 出库操作中断
- 弹出"跨色号预警"强提示弹窗（不可绕过）
- 弹窗展示：当前绑定色号 / 本次申请色号 / 色差风险说明
- 提供两个操作选项：取消出库 | 申请主管授权

**错误响应格式**：
```json
{
  "code": 4004,
  "message": "检测到跨色号出库风险，需要主管授权",
  "data": {
    "boundDyeLotNo": "A2024-0312",
    "requestedDyeLotNo": "A2024-0318",
    "skuName": "精梳棉面料-米白色",
    "productionOrderId": 10086,
    "riskLevel": "high"
  }
}
```

---

#### F-NEW-002 主管授权放行接口（P1，核心）

**新增 API 端点**：
`POST /api/inventory/outbound/cross-dye-lot-authorize`

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| outboundRequestId | string | 是 | 待放行的出库申请ID（由拦截时生成） |
| supervisorId | number | 是 | 授权主管用户ID |
| reason | string | 是 | 放行原因（见标准选项） |
| customReason | string | 否 | 自定义说明（reason=OTHER时必填） |

**放行原因标准选项**：

| 选项值 | 说明 |
|---|---|
| CUSTOMER_APPROVED | 客户已书面确认接受混色号出货 |
| STOCK_SHORTAGE | 同色号库存不足，紧急生产需求 |
| QUALITY_VERIFIED | 经实物比对色差在容忍范围内 |
| SAMPLE_ORDER | 样品订单，客户知悉 |
| OTHER | 其他（需填写自定义说明） |

**权限控制**：
- 仅 ROLE = supervisor / admin 可调用此接口
- 当前登录用户为操作员（worker/warehouse）时调用返回 403

**授权完成后**：
- 系统继续执行原出库流程
- `inventory_transactions` 记录中增加：`cross_dye_lot_authorize_by`、`cross_dye_lot_reason`、`cross_dye_lot_authorized_at` 字段
- 触发通知推送（见 F-NEW-004）

---

#### F-NEW-003 主管授权入口（前端，P1）

**操作路径 1：小程序端（仓库管理员出库流程中）**

```
出库流程 → 系统拦截 → 跨色号预警弹窗
                    ↓
         [取消出库] [申请主管授权]
                    ↓ 选择后
         发送授权申请消息给主管（微信通知/系统内消息）
         → 主管在小程序内查看并完成授权
         → 授权完成后仓库管理员收到通知，系统自动放行
```

**操作路径 2：Web 端（车间主管工作台）**

- 在"待处理事项"区域增加"跨色号出库授权"待办卡片
- 主管点击进入授权详情页，查看物料、色号、申请人信息
- 选择放行原因后点击"授权放行"

**授权等待超时**：
- 申请提交后，系统等待主管授权最长 **2 小时**
- 超时后申请自动失效，仓库管理员收到通知需重新发起
- 超时时长在租户配置中可调整（`cross_dye_lot_authorize_timeout_minutes`）

---

#### F-NEW-004 跨色号出库推送通知（P2，增强）

**推送时机与内容**：

| 事件 | 接收方 | 通知内容 |
|---|---|---|
| 跨色号出库拦截 | 申请人 | 已拦截，等待主管授权 |
| 主管授权申请到达 | 车间主管 | 待授权：[物料名] 跨色号出库申请 |
| 主管完成授权放行 | 申请人 | 已授权，出库继续执行 |
| 跨色号出库完成 | 老板驾驶舱/质量模块 | 质量预警：今日 N 笔跨色号出库 |

**推送渠道**：
系统内消息 + 微信小程序消息（复用 `proactive.service.ts` 推送基础设施）

---

#### F-NEW-005 跨色号出库报表（P2，增强）

**新增维度**：
在质量溯源报表（TracePage.tsx / web-quality-trace.html）中增加"跨色号出库记录"分组，包含：

- 日期、物料、生产订单、申请人、授权主管、放行原因、色号详情

**用途**：
支持质量审计，客诉发生时快速定位跨色号出货记录及责任人。

---

### 4.2 不纳入本次方案的内容（明确范围边界）

以下内容**不在本次方案范围内**：

1. 不增加老板级别的二次审批（主管授权已足够，增加层级会严重拖慢生产节奏）
2. 不修改"首次领料自由选色"逻辑（US-305 已通过验收，保持不变）
3. 不对样品间或测试环境的出库做色号管控（由 SKU 标记控制，排除测试物料）
4. 不实现自动色差检测算法（属于 Phase 3 AI 能力，当前基于操作人员判断）

---

### 4.3 数据库变更（最小化改动）

**在 `inventory_transactions` 表增加 3 个字段**：

```sql
ALTER TABLE inventory_transactions
  ADD COLUMN cross_dye_lot_authorized_by INT NULL COMMENT '跨色号授权主管ID',
  ADD COLUMN cross_dye_lot_reason VARCHAR(50) NULL COMMENT '跨色号放行原因编码',
  ADD COLUMN cross_dye_lot_authorized_at DATETIME NULL COMMENT '授权时间';
```

**新增 `cross_dye_lot_authorize_requests` 表**（管理待处理的授权申请）：

```sql
CREATE TABLE cross_dye_lot_authorize_requests (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  tenant_id       INT NOT NULL,
  request_no      VARCHAR(50) NOT NULL UNIQUE,
  sku_id          INT NOT NULL,
  production_order_id INT NULL,
  bound_dye_lot_no    VARCHAR(50) NOT NULL,
  requested_dye_lot_no VARCHAR(50) NOT NULL,
  qty_input       DECIMAL(18,4) NOT NULL,
  input_unit      VARCHAR(20) NOT NULL,
  requested_by    INT NOT NULL,
  status          ENUM('pending','approved','rejected','expired') DEFAULT 'pending',
  reason          VARCHAR(50) NULL,
  custom_reason   VARCHAR(500) NULL,
  authorized_by   INT NULL,
  authorized_at   DATETIME NULL,
  expires_at      DATETIME NOT NULL,
  created_at      DATETIME DEFAULT NOW(),
  INDEX idx_tenant_status (tenant_id, status),
  INDEX idx_tenant_prod_order (tenant_id, production_order_id)
);
```

---

## 五、验收标准

### AC-001 拦截行为正确性

- 当 `checkDyeLotConsistency()` 返回 `true` 时，`outbound()` 必须返回 code=4004，出库不得执行
- 当 `checkDyeLotConsistency()` 返回 `false`（同色号）或 `productionOrderId` 为空时，出库正常执行，不触发授权流程
- 直接销售出库（无 productionOrderId）不触发跨色号拦截（仅生产领料需管控）

### AC-002 主管授权流程完整性

- 仅 ROLE = supervisor 或 admin 的用户可完成授权操作，其他角色返回 403
- 授权申请超时后（默认 2 小时），状态自动变为 `expired`，不可再被授权
- 主管授权后，原出库操作必须能在 5 秒内完成（不能要求操作人员重新填写出库信息）

### AC-003 数据可追溯性

- 每笔跨色号出库必须在 `inventory_transactions` 中记录授权人、放行原因、授权时间
- 质量溯源链（TracePage.tsx）中可查询到跨色号出库记录及授权详情

### AC-004 通知可达性

- 主管授权申请提交后，车间主管在 1 分钟内收到系统消息
- 授权完成后，申请人在 30 秒内收到放行通知

### AC-005 性能要求

- 跨色号拦截判断不得增加出库接口响应时间超过 200ms
- 授权申请接口响应时间 < 500ms（P95）

---

## 六、优先级建议

| 功能项 | 优先级 | 理由 |
|---|---|---|
| F-NEW-001 跨色号出库拦截 | **P1** | 当前 4004 错误码已定义但完全未使用，是明确的代码缺陷，质量风险真实存在，上线前应修复 |
| F-NEW-002 主管授权放行接口 | **P1** | 与 F-NEW-001 必须配套实现，单独拦截而无放行通道会完全阻断部分合理业务 |
| F-NEW-003 主管授权入口（前端） | **P1** | 与 F-NEW-001/002 配套，三者为一个完整交付单元 |
| F-NEW-004 跨色号出库推送通知 | **P2** | 基础拦截+授权流程已保障质量安全，推送是体验增强，不影响核心管控 |
| F-NEW-005 跨色号出库报表 | **P2** | 质量审计价值高，但不影响日常操作，Phase 2 补齐 |

**整体建议**：F-NEW-001 至 F-NEW-003 作为一个交付单元，在当前上线阻断项（BLOCK-001~004）修复完成后立即实现，不超过 Phase 2 第一个迭代。

---

## 七、决策依据

### 为什么选择"拦截 + 主管授权"而非其他方案

**方案 A：仅警告，不拦截（现状维持）**
否决原因：色差是肉眼可见的严重质量问题，操作人员在生产压力下极容易忽视警告弹窗，历史数据（is_cross_dye_lot 字段记录）也印证了这一点。不加管控的警告等于没有管控。

**方案 B：强制拦截，禁止跨色号出库**
否决原因：纺织行业存在客户明确接受混色号出货的合理场景（如样品单、内部消耗、客户书面确认），完全禁止会导致生产中断，损害用户体验，且无法覆盖所有业务场景。

**方案 C：拦截 + 老板二次审批**
否决原因：老板审批链路过长（老板经常不在线、审批时效无法保证），会严重拖慢工厂生产节奏；且色号判断属于现场质量决策，车间主管比老板更具判断能力和现场信息。

**方案 D（本决策）：拦截 + 主管授权 + 老板可见**
选择原因：
- 默认拦截保障质量基线，不依赖人工自律
- 主管授权覆盖合理业务场景，不损害生产效率
- 标准化放行原因确保决策留痕，支持事后审计
- 老板在驾驶舱可见跨色号出库统计，信息透明但不增加审批负担
- 实现成本最小（复用现有 `proactive.service.ts` 推送链路、`is_cross_dye_lot` 字段已存在、4004 错误码已定义）

---

## 八、任务指派

本决策文档批准后，请按以下顺序执行：

**@senior-backend-engineer**
- 实现 F-NEW-001：修改 `inventory.service.ts` `outbound()` 函数，在 `isCrossDyeLot=true` 时抛出 AppError(4004) 并暂存出库申请
- 实现 F-NEW-002：新增 `cross_dye_lot_authorize_requests` 表及授权接口
- 执行 `ALTER TABLE` 增加 3 个追溯字段
- 实现授权超时自动过期逻辑（建议使用 Bull Queue 定时任务）

**@senior-frontend-engineer**
- 实现 F-NEW-003：Web 端主管工作台"跨色号出库授权"待办卡片及授权详情页
- 在小程序 HTML 原型（mini-warehouse-inbound.html）补充跨色号拦截弹窗状态设计

**@senior-ui-designer**
- 设计跨色号预警弹窗的 UI 规范（强视觉警示，区别于普通警告弹窗）
- 设计授权申请卡片组件（在主管工作台展示）
- 颜色规范：参考现有设计系统，使用 `--color-error-600` 作为跨色号预警主色

**@senior-qa-engineer**
- 补充测试用例覆盖以下场景：
  - TC-INV-NEW-001：跨色号出库被拦截，code=4004 返回正确
  - TC-INV-NEW-002：主管授权后出库成功执行
  - TC-INV-NEW-003：操作员（非主管）尝试授权返回 403
  - TC-INV-NEW-004：授权申请超时后变为 expired，不可再授权
  - TC-INV-NEW-005：同色号出库不触发拦截（回归测试）
  - TC-INV-NEW-006：跨色号出库记录在质量溯源链中可查

---

**决策签发**：@senior-ai-agent-pm
**决策日期**：2026-03-11
**下次评审节点**：F-NEW-001~003 实现完成后，由 @senior-qa-engineer 执行验收测试，结果回归本文档
