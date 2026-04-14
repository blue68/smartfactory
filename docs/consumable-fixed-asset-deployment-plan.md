[artifact:DeploymentPlan]
status: BLOCKED
owner: devops-engineer
scope:
- 为损耗品与固定资产后端收口准备发布、回滚和监控方案
- 明确当前不能进入正式发布的门禁原因
missing_inputs:
- `[artifact:TestReport]` 通过结论
- 前端联调环境恢复后的页面正向回归结论
blocking_reasons:
- 当前 `docs/consumable-fixed-asset-test-report.md` 为 `FAIL`，高价值 integration 主链路尚未通过
- 前端已完成本地负向冒烟，但 `F1/F3/F4/F5` 尚未在真实联调环境跑通正向主流程，不满足整版发布入口条件
handoff_to:
- senior-backend-engineer
- senior-frontend-engineer
- senior-qa-engineer
next_action:
- 恢复 integration 环境并完成 `consumableAsset` spec
- 完成前端正向联调回归后补 TestReport，再重新进入发布阶段

precheck:
- 确认 `docs/consumable-fixed-asset-review-report.md` 与 `docs/consumable-fixed-asset-security-report.md` 无 blocker / 高危未决问题
- 确认 `docs/consumable-fixed-asset-test-report.md` 由 `FAIL` 转为 `PASS`
- 执行 `docs/sql-drafts/consumable-fixed-asset-validation-checks.sql`，确认历史 SKU/BOM/采购控制字段不存在阻断数据
- 准备损耗品仓、资产待验收仓、资产仓等主数据初始化脚本与回滚说明

steps:
- 发布前先备份数据库并导出本轮涉及表结构与主数据快照
- 按既有迁移顺序部署 `services/api/src/migrations/*` 与后端服务
- 先做只读接口烟雾验证，再执行损耗品领用、资产验收、资产退回主路径冒烟
- 若前端同版发布，再做 SKU 页面、采购单页、损耗品领用页、资产验收页、资产台账页联调验收

rollback:
- 若迁移后发现收货分流、资产台账或损耗品领用出现 blocker，立即停止发布并回滚到上一版 API 镜像
- 对本轮新增主数据与错误收货记录，按 `docs/sql-drafts/consumable-fixed-asset-validation-checks.sql` 的检查结果执行定向修复或回退脚本
- 回滚后重新验证原材料/BOM/MRP/采购/IQC 主链路

monitoring:
- 重点监控 IQC 收货失败率、损耗品领用执行失败率、资产验收/退回接口 4xx/5xx
- 监控 `purchase_receipt_items` 控制字段写入完整性、`asset_movements(return)` 记录量和异常日志
- 关注库存流水中是否误写入固定资产、是否出现非生产型 SKU 进入 MRP/采购建议

owner:
- devops-engineer
