[artifact:TaskBreakdown]
status: READY
owner: tech-lead-architect
scope:
- 将损耗品与固定资产版本剩余工作拆成按角色与人天的执行清单
- 基于资产退回已完成后的最新状态给出关键路径排期
inputs:
- `docs/consumable-fixed-asset-remaining-plan.md`
- `docs/consumable-fixed-asset-asset-return-approval.md`
- `docs/consumable-fixed-asset-asset-return-implementation-plan.md`
handoff_to:
- engineering-manager
- senior-backend-engineer
- senior-frontend-engineer
- senior-qa-engineer
- devops-engineer
deliverables:
- 角色分工清单
- 人天估算
- 推荐执行顺序与关键路径
risks:
- 前端联调和 QA 若串行执行，周期会明显拉长
- 数据核查若发现历史脏数据，后端与 QA 时间都要回补
exit_criteria:
- 每个工作包都有明确 owner、估时、依赖和完成定义

## 一、执行原则

1. 已完成项不再重复排期：固定资产退回接口与单测已完成。
2. 先关后端与数据门禁，再做前端广泛联调。
3. QA 只在“后端接口定稿 + 基础页面可操作”后进入主回归。
4. 发布产物最后补齐，但不允许拖到回归结束后才开始准备。

当前状态：
- Day 0 已完成：固定资产退回接口与单测
- Day 1 已完成：`incomingInspection` 的 `direct_expense` / `asset_capitalization` 分流回归、发布前核查 SQL、BOM/MRP 守卫单测、损耗品 `create / approve / execute` 服务回归、资产 `acceptance / transfer / scrap / return` 服务单测
- Day 1 新进展：已新增 `services/api/tests/integration/consumableAsset.api.test.ts`，覆盖资产验收、资产退回、损耗品领用执行三条高价值链路
- Day 3 新进展：已恢复本地 MySQL/Redis integration 环境，并在 2026-04-14 跑通 `services/api/tests/integration/consumableAsset.api.test.ts`
- Day 3 新进展：已修正 integration spec 的历史 schema 漂移，并补 `warehouse-location.resolver` 对 MySQL `bigint` 字符串 ID 的兼容与单测
- Day 2 已推进：已先补 `ReviewReport`、`SecurityReport`、`TestCase`、`TestReport`、`DeploymentPlan` 草案，明确当前不是代码 blocker，而是环境 blocker
- Day 2 新进展：已补齐前端 `WP4` 的 `PRD / Prototype / DesignSpec / UICode / InteractionSpec / Approval / ImplementationPlan`
- Day 2 新进展：已完成前端第一段联调落地，`SkuPage` / `PurchaseOrderPage` 已能透出损耗品与固定资产关键字段
- Day 4 新进展：已在最新前端代码的本地 `vite` 环境完成 `F1/F3/F4/F5` 正向页面回归，并补 `VITE_API_PROXY_TARGET` 代理目标可配置能力
- Day 4 新进展：已重建本地 `sf_web` Web 容器，并在真实 80 端口入口复跑 `/master-data/sku`、`/consumables/issues`、`/assets/acceptance`、`/assets/ledger`
- Day 4 新进展：已新增 `npm run test:api:integration:consumable-asset` 专用 managed 回归命令，后续补跑不再依赖手敲 spec 路径
- Day 4 新进展：已在真实登录态下跑通固定资产与损耗品手工采购正向链路，并完成 `PO -> DN -> IQC -> RC -> 资产台账/损耗品领用` 页面与接口双重验证
- Day 4 新进展：已补跑手工采购新入口的第二组真实闭环，固定资产 `PO1776172877547757 -> FA260414-00002`、损耗品 `PO1776174123806393 -> CI260414-00002` 均已回查通过
- Day 4 新进展：已修正“已建卡收货单继续显示在资产验收待办池”的筛选问题，本地 `localhost/assets/acceptance` 复验通过
- Day 4 新进展：已跑通损耗品采购后链路闭环，`RTN260414-00001` 已完成退货、`PST260414-00001` 已完成采购结算付款

## 二、角色分工与人天

| 工作包 | 角色 | 估时 | 依赖 | 完成定义 |
| :--- | :--- | :--- | :--- | :--- |
| WP2-A 损耗品链路自动化测试 | senior-backend-engineer | 1.5 人天 | 无 | 补齐库存型采购入库、直耗型到货、领用审批出库测试 |
| WP2-B 资产链路自动化测试 | senior-backend-engineer | 1.0 人天 | 无 | 补齐验收建卡、调拨、报废回归；退回已包含本轮单测 |
| WP2-C 守卫与兼容回归 | senior-backend-engineer | 0.5 人天 | 无 | 补齐 BOM 守卫、采购建议守卫、关键兼容断言 |
| WP3-A 历史数据核查 SQL | senior-backend-engineer | 0.5 人天 | 无 | 输出 SKU 回填、BOM 污染、固定资产错误收货检查 SQL |
| WP3-B 主数据初始化与回滚说明 | senior-backend-engineer | 1.0 人天 | WP3-A | 输出仓库主数据脚本、回滚/修复说明 |
| WP4-A SKU/采购页面联调 | senior-frontend-engineer | 1.5 人天 | 接口已定稿 | 完成 F1、F2 并可在测试环境操作 |
| WP4-B 损耗品页面联调 | senior-frontend-engineer | 1.0 人天 | 接口已定稿 | 完成 F3，打通创建/审批/出库主路径 |
| WP4-C 资产页面联调 | senior-frontend-engineer | 2.0 人天 | 接口已定稿 | 完成 F4、F5，包含退回入口和台账展示 |
| WP2-D 功能回归执行 | senior-qa-engineer | 1.5 人天 | WP2-A/WP2-B/WP2-C、WP4-B/WP4-C | 完成新增测试包与关键主流程回归 |
| WP5-A 代码评审与问题回收 | code-reviewer | 0.5 人天 | 后端/前端代码稳定 | 输出 `[artifact:ReviewReport]` |
| WP5-B 安全审计 | security-engineer | 0.5 人天 | 后端/前端代码稳定 | 输出 `[artifact:SecurityReport]` |
| WP5-C 测试产物沉淀 | senior-qa-engineer | 0.5 人天 | WP2-D | 输出 `[artifact:TestCase]` 与 `[artifact:TestReport]` |
| WP5-D 部署计划 | devops-engineer | 0.5 人天 | Review/Security/Test 无阻断 | 输出 `[artifact:DeploymentPlan]` |

汇总：
- 后端：`4.5` 人天
- 前端：`4.5` 人天
- QA：`2.0` 人天
- Review/Security/DevOps：`1.5` 人天
- 总量：`12.5` 人天

说明：
- 上述总量是角色总和，不是关键路径时长。
- 若后端与前端并行，关键路径预计 `4.5 ~ 6` 个工作日。

## 三、推荐排期

### Day 0

- senior-backend-engineer：已完成固定资产退回接口与单测

### Day 1

- senior-backend-engineer：启动 `WP2-A`，先补损耗品链路测试
  已完成：收货分流中的 `direct_expense` 回归
- senior-backend-engineer：继续推进 `WP2-A`
  已完成：损耗品 `create / approve / execute` 服务单测
- senior-backend-engineer：推进 `WP2-C`
  已完成：BOM 组件准入与 MRP 查询过滤单测
- senior-backend-engineer：并行启动 `WP3-A`，输出历史数据核查 SQL
  已完成：`docs/sql-drafts/consumable-fixed-asset-validation-checks.sql`
- senior-backend-engineer：推进 `WP3-B`，补主数据初始化与回滚说明
  已完成：`scripts/bootstrap-consumable-fixed-asset-master-data.sh`
  已完成：`docs/sql-drafts/consumable-fixed-asset-master-data-rollback.sql`
- senior-backend-engineer：推进 `WP2-B`
  已完成：资产 `acceptance / transfer / scrap / return` 服务单测
- senior-frontend-engineer：启动 `WP4-A`，完成 SKU/采购页面字段联调

### Day 2

- senior-backend-engineer：完成 `WP2-B`，补资产验收/调拨/报废回归
- senior-backend-engineer：落地高价值 integration spec 并在可用测试环境执行
  已完成：2026-04-14 跑通 `services/api/tests/integration/consumableAsset.api.test.ts`
- senior-backend-engineer：推进 `WP3-B`，在可用环境验证主数据脚本落库结果并回填验证结论
- senior-frontend-engineer：已完成 `WP4-B`，打通损耗品领用页的列表、创建、审批、执行出库主路径

### Day 3

- senior-backend-engineer：完成 `WP2-C`，补守卫与兼容回归
- senior-frontend-engineer：已推进 `WP4-C`，完成资产验收页和资产台账页的首版可操作入口
- senior-frontend-engineer：当前已具备前端开工门禁，可先从 `F1/F2` 进入实现
- senior-frontend-engineer：已完成 `F1` 动态表单、`F2` 字段透出，以及 `F3/F4/F5` 页面骨架与主动作；已补本地错态/重试/后备输入，下一步只剩真实环境正向冒烟
- engineering-manager：检查测试与数据脚本是否满足 QA 入口条件

### Day 4

- senior-qa-engineer：执行 `WP2-D`，跑新增测试包和核心主流程回归
  当前状态：已沉淀 `TestCase` / `TestReport` 正式版；后端高价值 integration 与前端 `F1/F3/F4/F5` 页面回归均已补齐
- code-reviewer：执行 `WP5-A`
  当前状态：已输出首版 `ReviewReport`
- security-engineer：执行 `WP5-B`
  当前状态：已输出首版 `SecurityReport`

### Day 5

- senior-qa-engineer：完成 `WP5-C`，沉淀测试用例和测试报告
  当前状态：已输出 `PASS` 结论；本地真实手工采购主链路也已补测，剩余工作只剩正式环境同口径复烟
- devops-engineer：完成 `WP5-D`，输出部署计划
  当前状态：已输出 `READY` 版部署计划；本地环境已完成 Web 重建与复烟，正式环境按同步骤执行
- engineering-manager：复核发布清单，决定是否放行

## 四、关键路径

1. 后端测试补齐与数据脚本是 QA 的前置。
2. 资产页面联调完成前，QA 无法完成资产链路主流程验证。
3. Review / Security / Deployment 不应等到 QA 完成后才开始准备，可在 Day 4 并行启动。

## 五、落地检查

1. Day 3 结束前必须具备：
- 自动化测试补齐
- 数据核查 SQL
- 主数据 bootstrap / rollback 说明
- 前端可操作页面
- 后端高价值 integration spec 已完成实跑；剩余阻断应聚焦前端正向回归与数据验证

2. Day 4 结束前必须具备：
- QA 主流程结论
- Review 报告
- Security 报告
- 前端 `F1/F3/F4/F5` 最新代码正向页面回归结论

3. Day 5 结束前必须具备：
- TestCase
- TestReport
- DeploymentPlan

## 六、建议下一步

1. 在正式环境按本地已验证步骤重建 `sf_web` 前端发布产物，并复跑 `采购订单`、`到货管理`、`来料质检`、`入库记录`、`三单匹配`、`退货管理`、`采购结算`、`资产验收`、`资产台账`、`损耗品领用` 页面。
2. 把 `npm run test:api:integration:consumable-asset` 纳入正式发布 checklist 或 CI 定向补跑手册，防止 schema 漂移回归。
3. 正式环境额外抽样核对手工采购新入口样例：
- 固定资产：`PO1776172877547757 -> DN1776172890803592 -> IQC260414-00003 -> RC260414-00003 -> FA260414-00002`
- 损耗品：`PO1776174123806393 -> DN1776174142538557 -> IQC260414-00004 -> RC260414-00004 -> CI260414-00002`
4. 发布后抽样确认资产验收待办池不会再次包含已建卡收货单，且损耗品库存/资产台账副作用与本地验证结果一致。
