[artifact:ImplementationPlan]
status: READY
owner: codex
scope:
- 数据范围从“可配置元数据”落到“业务查询强制生效”
- 明确租户态首批接入模块、谓词映射、发布门禁与回滚策略
inputs:
- docs/v3/permission-control/prd.md
- docs/v3/permission-control/system-arch.md
- services/api/src/modules/access-control/access-control.service.ts
- services/web/src/pages/system/RoleGrantPage.tsx
handoff_to:
- tech-lead-architect
- senior-backend-engineer
- senior-qa-engineer
goal:
- 让角色授权页配置的数据范围在租户态业务查询中真正生效，而不是仅写入 role_permissions 和 permissionSnapshot
changed_areas:
- 权限快照与数据范围解析
- API Service 层通用数据范围过滤基础设施
- 库存/采购/生产/主数据等首批业务查询
- 测试、审计、发布检查
steps:
- 第 1 阶段：建立统一的数据范围解析器，输出标准化约束对象，例如 `all / self / warehouse_assigned / department`
- 第 2 阶段：把范围约束前置到 Service 层查询构造，禁止仅靠前端过滤
- 第 3 阶段：优先接入已有明确归属字段的模块：库存、采购订单/送货/入库、盘点、缺料看板
- 第 4 阶段：补齐“department”所需主数据与映射关系，再接入部门维度查询
- 第 5 阶段：对所有接入模块补单测、集成测试、越权回归测试，并加发布门禁
risks:
- 当前系统缺少完整部门主数据，`department` 范围暂时无法可靠执法
- 多数业务表没有统一 `owner_user_id` 字段，`self` 范围需要按模块定义真实归属列
- 若直接在 Controller 做过滤，容易被旁路；必须统一落在 Service/Repository 层
- 旧 SQL 多为手写查询，若各模块零散改造，后续易回归
validation:
- 单元测试覆盖范围解析、SQL 谓词拼接、空范围/非法范围处理
- 集成测试覆盖租户管理员/仓管/采购员/主管的可见数据差异
- 越权测试验证“直接调接口”无法绕过数据范围
- 发布前抽样验证至少 4 个首批模块的真实数据集结果

# 数据范围真正生效落地方案

## 1. 当前现状

当前系统已经具备以下能力：

- 角色授权页可配置 `dataScopes`
- 后端可将 `dataScopes` 写入 `role_permissions`
- 登录后权限快照可回填 `permissionSnapshot.dataScopes`

当前缺口：

- 业务 Service 查询没有消费 `permissionSnapshot.dataScopes`
- `department / warehouse_assigned / self` 仅是授权元数据，不是查询约束
- 前端界面上的“数据范围类型 / 数据范围值”配置，目前不能保证真正限制业务数据

## 2. 设计原则

1. 数据范围必须在后端 Service / Repository 层执法，前端只负责配置与展示。
2. 默认拒绝不明确范围。无法判定归属字段的模块，不得伪造“已支持”。
3. 同一用户多角色并集取“最宽可见集合”，但平台态与租户态边界优先。
4. 所有范围过滤必须可追溯到权限快照版本与角色授权快照。

## 3. 范围模型与落地约束

### 3.1 `all`

- 含义：不追加额外数据范围谓词
- 适用：老板、租户管理员、全量运营角色

### 3.2 `warehouse_assigned`

- 含义：仅可见指定仓库集合内的数据
- 输入：仓库 ID 或仓库编码
- 首批可落地模块：
  - 库存列表 / 库存流水 / 可用库存
  - 采购到货 / 入库 / 盘点
- 查询谓词：
  - `warehouse_id IN (...)`
  - 如表无 `warehouse_id`，需通过关联明细表或映射表补齐

### 3.3 `self`

- 含义：仅可见当前用户本人创建、负责或处理的数据
- 输入：无附加值
- 约束：
  - 必须按模块声明归属列，例如 `created_by / purchaser_id / owner_user_id / operator_id`
  - 没有稳定归属列的模块，不得宣称支持 `self`

### 3.4 `department`

- 含义：仅可见指定部门的数据
- 当前状态：阻塞
- 原因：
  - 当前缺少稳定部门主数据、用户部门字段、业务单据部门归属字段
- 处理原则：
  - 在部门模型补齐前，只允许保存配置，不允许对外宣称已生效

## 4. 首批接入模块

优先接入“已有明确归属字段”的模块，避免一次性全域改造。

### 批次 A：仓库与库存链路

- `/api/inventory`
- `/api/inventory/daily-snapshots`
- `/api/inventory/:skuId/transactions`
- `/api/stocktaking/*`

原因：

- 已有 `warehouse_id / location_id`
- 最适合承接 `warehouse_assigned`

### 批次 B：采购执行链路

- 采购订单
- 送货单
- 入库单
- 退货单
- 三单匹配

原因：

- 可基于仓库、创建人、采购员负责人做 `warehouse_assigned / self`

### 批次 C：缺料与调度相关

- 缺料看板
- 采购建议
- 调度建议采购侧明细

原因：

- 采购角色最依赖数据范围；越权看到全租户建议会直接影响业务决策

## 5. 统一实现建议

新增通用层：

- `resolveEffectiveDataScope(snapshot, moduleCode)`
  - 输入：权限快照、模块标识
  - 输出：标准化范围对象

- `buildDataScopeSql(scope, mapping)`
  - 输入：范围对象、字段映射
  - 输出：SQL 片段与参数

- `assertSupportedScope(scopeType, moduleCode)`
  - 若模块未声明支持该范围，直接记录告警并拒绝伪生效

字段映射建议由模块显式声明，例如：

```ts
{
  inventory: { warehouseColumn: 'inv.warehouse_id' },
  purchase_order: { ownerColumn: 'po.created_by', warehouseColumn: 'poi.warehouse_id' },
}
```

## 6. 测试与发布门禁

必须新增：

- 单元测试：范围解析 / SQL 拼接 / 空值处理
- 集成测试：同租户不同角色查询结果差异
- 旁路测试：直接命中 API 时仍被范围限制
- 回归测试：`all` 角色不受误伤

发布门禁：

- 未完成模块声明与测试前，不允许在 UI 或文档上标记“数据范围已生效”
- `department` 未补模型前，不允许承诺部门维度真实限制

## 7. 对当前版本的结论

当前版本结论应明确写成：

- `warehouse_assigned / self / department` 配置项已可保存
- 但仅“保存到授权模型”，尚未在业务查询中全面强制生效
- 若要对外宣称“已生效”，至少需完成批次 A 与批次 B 的后端约束接入
