[artifact:TaskBreakdown]
status: READY
owner: tech-lead-architect
scope:
- 基于损耗品与固定资产任务拆解、DDL/API 草案与最新后端提交评估本版本剩余工作量
- 输出可直接用于排期、联调与发布门禁的剩余工作包
inputs:
- `docs/consumable-fixed-asset-backend-task-breakdown.md`
- `docs/consumable-fixed-asset-ddl-api-draft.md`
- `93aaff4 feat: add consumable and fixed asset controls`
handoff_to:
- engineering-manager
- senior-backend-engineer
- senior-frontend-engineer
- senior-qa-engineer
- devops-engineer
deliverables:
- 当前版本已完成范围判断
- 剩余工作包与估时
- 关键路径与发布前门禁清单
risks:
- 本次提交未覆盖 feature 级自动化测试
- 数据迁移与主数据准备尚未验证
exit_criteria:
- 剩余工作已拆解到可排期粒度
- 可据此补齐审批、实现、测试与发布产物

最新进展：
- 已补固定资产退回接口与单测
- 已补 `incomingInspection` 回归：损耗品 `direct_expense` 与固定资产 `asset_capitalization` 分流
- 已补 BOM / MRP 守卫单测
- 已补损耗品 `create / approve / execute` 服务回归
- 已补资产 `acceptance / transfer / scrap / return` 服务回归
- 已新增 `services/api/tests/integration/consumableAsset.api.test.ts`，覆盖资产验收、资产退回、损耗品领用执行
- 已新增发布前数据核查 SQL：`docs/sql-drafts/consumable-fixed-asset-validation-checks.sql`
- 已补发布门禁文档草案：`ReviewReport`、`SecurityReport`、`TestCase`、`TestReport`、`DeploymentPlan`
- 当前明确阻断：本地 Docker/MySQL 环境异常，`consumableAsset` integration spec 未完成实跑
- 已完成前端本地 `vite` 冒烟，确认 `F1/F3/F4/F5` 页面在后端不可用时不会崩溃；并已补显式错态、重试按钮和资产验收页保管人手输兜底

## 一、当前基线判断

结合任务拆解文档、DDL/API 草案和最新提交 `93aaff4`，当前后端核心能力已经基本落地：

1. Phase 1 已基本完成：SKU 新字段、BOM 守卫、BOM 展开和 MRP 过滤均已进入代码。
2. Phase 2 已基本完成：采购单明细控制字段、IQC 收货分流、损耗品领用单、损耗品库存查询均已进入代码。
3. Phase 3 已基本完成：资产验收建卡、资产台账、调拨、退回、报废均已进入代码。

按“后端功能开发完成度”估算，当前约为 `90%~93%`。
按“整版可发布完成度”估算，当前约为 `65%~75%`，主要差在前端联调、自动化回归、数据校验和发布产物。

## 二、已完成范围

1. SKU 主数据与 profile 能力已接入，包含 `business_class`、`control_mode`、`allow_bom_component`、`consumableProfile`、`assetProfile`。
2. BOM 与生产/MRP 守卫已落地，非生产型 SKU 已从展开和采购建议链路中过滤。
3. 采购明细的 `businessClass`、`receiptMode`、`requiresAcceptance` 已支持默认回填与校验。
4. IQC 收货已按 `inventory` / `direct_expense` / `asset_capitalization` 分流，且会写入 `purchase_receipt_items` 控制字段。
5. 损耗品模块已具备创建、审批、执行出库、库存查询接口。
6. 资产模块已具备验收建卡、列表、详情、调拨、报废接口。
7. 两阶段迁移脚本已存在，覆盖 SKU 控制字段、采购控制字段、损耗品领用表、资产台账表与流水表。

## 三、剩余工作包

### 已完成：资产退回链路补齐

已落地：
- 新增 `POST /api/assets/cards/:id/return`
- 新增 `asset:return` 权限点与路由守卫
- 退回时回写 `asset_cards.status = 'idle'`，清空部门与责任人
- 新增 `movement_type = 'return'` 的流水写入
- 已补路由/服务单测并通过

影响：
- 原剩余工作中的 `WP1` 已关闭，不再计入后续版本剩余工作量

### WP2：补齐 feature 级自动化测试与回归包

现状：
- 任务拆解已列出 `TC-CONS-001 ~ 003`、`TC-AST-001 ~ 003`、`TC-GUARD-001 ~ 002`。
- 当前已补一部分关键回归：资产退回单测，以及 `incomingInspection` 中 `direct_expense` / `asset_capitalization` 分流回归。
- 当前已进一步补齐：损耗品领用闭环服务回归、资产验收/调拨/报废/退回服务回归、BOM/MRP 守卫单测。
- 当前已新增高价值 integration spec，但整版 feature 级测试仍未在可用环境中跑通。

范围：
- 为损耗品库存型采购入库、直耗型采购到货、领用审批出库补齐集成/回归测试。
- 为资产采购到货验收建卡、调拨、报废补齐集成/回归测试。
- 为 BOM 守卫与采购建议守卫补齐单元/回归测试。
- 复跑既有采购、库存、BOM、生产、MRP、IQC 相关回归，确认兼容性。

估时：
- 后端测试补齐：`1.5 ~ 2.0` 人天
- QA 回归执行与结果沉淀：`1.0 ~ 1.5` 人天

小计：
- `3.0 ~ 4.0` 人天

### WP3：数据迁移验证与上线前数据修复准备

现状：
- 任务拆解已明确要求检查历史 SKU 回填、历史 BOM 污染、固定资产错误库存型收货、仓库主数据与回滚 SQL。
- 当前仓库里已有迁移脚本，已新增首版核查 SQL，并已补默认仓库主数据 bootstrap 脚本与回滚 SQL 草案；但尚未在真实环境完成落库验证报告。

范围：
- 验证历史 SKU `business_class` / `control_mode` 回填结果。
- 扫描存量 BOM 中是否混入损耗品/固定资产 SKU。
- 扫描历史采购明细中是否存在固定资产被错误标为 `inventory` 的情况。
- 准备损耗品仓、资产待验收仓、资产仓主数据初始化脚本或操作清单。
- 补齐回滚 SQL 与异常数据修复脚本说明。

最新进展：
- 已新增 `scripts/bootstrap-consumable-fixed-asset-master-data.sh`，可幂等创建 `WH-CONS` / `WH-AST-PEND` / `WH-AST` 及默认库位
- 已新增 `docs/sql-drafts/consumable-fixed-asset-master-data-rollback.sql`，补齐主数据回滚前置检查与删除顺序

估时：
- 数据检查与脚本：`1.0 ~ 1.5` 人天
- 发布前演练与问题修复预留：`0.5` 人天

小计：
- `1.5 ~ 2.0` 人天

### WP4：前端页面与 API 联调收口

现状：
- 任务拆解明确列出 `F1 ~ F5` 五块前端并行工作。
- 当前已完成 `F1` 动态业务表单、`F2` 字段透出，以及 `F3/F4/F5` 的首版页面、路由和 API 联调入口。
- 前端剩余核心收口已收敛为真实环境正向冒烟，以及部门主数据接口到位后的下拉联动升级。

范围：
- `F1` SKU 页面动态表单。
- `F2` 采购单页业务类型展示与收货模式展示。
- `F3` 损耗品领用页。
- `F4` 资产验收页。
- `F5` 资产台账页。

估时：
- 前端实现与联调：`4.0 ~ 5.0` 人天
- 后端配合修正与接口细节收口：`0.5 ~ 1.0` 人天

小计：
- `4.5 ~ 6.0` 人天

### WP5：发布门禁 Artifact 补齐

现状：
- 按 AGENTS 规范，版本发布前至少应补齐 `[artifact:ReviewReport]`、`[artifact:SecurityReport]`、`[artifact:TestCase]`、`[artifact:TestReport]`、`[artifact:DeploymentPlan]`。
- 当前已补首版产物，但 `TestReport = FAIL`、`DeploymentPlan = BLOCKED`，原因是 integration 环境尚未恢复、前端联调尚未完成。

范围：
- 代码评审结论。
- 安全审计结论。
- 测试用例与测试报告。
- 部署/回滚/监控方案。

估时：
- `1.0 ~ 1.5` 人天

## 四、工作量汇总

按不同统计口径，建议给两个版本估算值：

1. 后端收口口径
- 包含 `WP2 + WP3 + WP5`
- 剩余约 `5.5 ~ 7.5` 人天

2. 整版上线口径
- 包含 `WP2 + WP3 + WP4 + WP5`
- 剩余约 `10.0 ~ 13.5` 人天

建议排期按并行角色计算关键路径：

1. `senior-backend-engineer` 先完成 `WP1` 与 `WP3`，并同步支持 `WP4` 联调。
2. `senior-frontend-engineer` 并行推进 `WP4`。
3. `senior-qa-engineer` 在前两项基本稳定后接入 `WP2` 回归。
4. `code-reviewer`、`security-engineer`、`devops-engineer` 在回归通过后补齐 `WP5`。

若资源配置为 `1 后端 + 1 前端 + 1 QA` 并行，预计关键路径约 `4 ~ 6` 个工作日。

## 五、建议优先级

1. P0：新增测试包与核心回归执行。
2. P0：数据迁移核查、仓库主数据准备、回滚说明。
3. P1：前端五块页面联调。
4. P1：发布门禁 artifact 补齐。

## 六、版本结论

本次 `93aaff4` 已经把损耗品与固定资产版本的大部分后端主干搭起来，后续工作不再是“功能从 0 到 1”，而是“缺口补齐 + 联调回归 + 发布收口”。

因此本版本建议不要再按“大功能开发”排期，而应改按“收口版”排期：

1. 第一段完成数据验证脚本、接口枚举定稿与新增测试包。
2. 第二段完成前端联调与自动化测试。
3. 第三段完成 QA、Review、Security、Deployment 门禁后再进入发布。
4. 在 integration 环境修复前，可先继续前端联调、数据主数据脚本和文档收口；但不得据此宣布发布就绪。
