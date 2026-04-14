[artifact:DeploymentPlan]
status: READY
owner: devops-engineer
scope:
- 为损耗品与固定资产版本准备正式发布、回滚和监控方案
- 结合 2026-04-14 最新测试结论收敛发布前剩余动作
inputs:
- `docs/consumable-fixed-asset-review-report.md`
- `docs/consumable-fixed-asset-security-report.md`
- `docs/consumable-fixed-asset-test-report.md`
- `docs/consumable-fixed-asset-final-release-checklist.md`
- `docs/sql-drafts/consumable-fixed-asset-validation-checks.sql`
- `docs/sql-drafts/consumable-fixed-asset-master-data-rollback.sql`
handoff_to:
- engineering-manager
- senior-qa-engineer
- senior-frontend-engineer
deliverables:
- 发布前检查项
- 部署步骤与回滚路径
- 发布后监控项
- 一页式正式环境总清单入口
- 新服务器生产部署脚本与运行手册入口
risks:
- 正式环境发布时若未基于最新代码重建 Web 镜像，部署入口将无法反映本轮页面、权限与手工采购流转修复
exit_criteria:
- 发布前检查项、部署步骤、回滚步骤和监控项均已明确

precheck:
- 确认 `docs/consumable-fixed-asset-review-report.md` 与 `docs/consumable-fixed-asset-security-report.md` 无 blocker / 高危未决问题
- 确认 `docs/consumable-fixed-asset-test-report.md` 由 `FAIL` 转为 `PASS`
- 打开 `docs/consumable-fixed-asset-final-release-checklist.md`，作为正式环境复烟的唯一执行页
- 执行 `docs/sql-drafts/consumable-fixed-asset-validation-checks.sql`，确认历史 SKU/BOM/采购控制字段不存在阻断数据
- 准备损耗品仓、资产待验收仓、资产仓等主数据初始化脚本与回滚说明
- 确认上传配置已按环境准备：本地/测试使用 `FILE_STORAGE_DRIVER=local`，正式环境使用 `FILE_STORAGE_DRIVER=oss`，并补齐 `OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET / OSS_ENDPOINT / OSS_PATH_PREFIX`
- 确认 `uploaded_files` 迁移已执行，且正式环境数据库已具备文件元数据存储表
- 在正式环境基于最新仓库代码重建 `services/web` 发布产物或 Web 镜像；本地环境已于 2026-04-14 完成同步骤验证
- 按本地回归口径准备一条固定资产和一条损耗品的手工采购烟雾用例，发布后用于验证 `PO -> DN -> IQC -> RC -> 三单匹配 -> 退货管理 -> 采购结算 -> 资产验收/损耗品领用` 分流与后链路仍然成立

steps:
- 发布前先备份数据库并导出本轮涉及表结构与主数据快照
- 新服务器首次部署或后续升级优先使用 `bash scripts/deploy-prod.sh <tag-or-branch>`；新生产环境运行手册见 `docs/production-server-deployment-runbook.md`
- 按既有迁移顺序部署 `services/api/src/migrations/*` 与后端服务
- 核对 `uploaded_files` 表、`/api/upload/files/:id/content` 路由与 `FILE_STORAGE_DRIVER` 环境变量在目标环境中的实际生效值
- 构建并发布最新 `services/web` 前端产物，确认包含 `consumables.issue`、`assets.acceptance`、`assets.ledger` 三个页面入口
- 执行 `npm run test:api:integration:consumable-asset`，确认损耗品/固定资产后端高价值主链路在 managed 入口下仍通过
- 先做只读接口烟雾验证，再执行损耗品领用、资产验收、资产退回主路径冒烟
- 在实际部署入口复跑 SKU 页面、采购单页、三单匹配页、退货管理页、采购结算页、损耗品领用页、资产验收页、资产台账页联调验收；本地 80 端口已通过该步骤
- 抽样验证导出接口：至少确认 1 份主数据导出和 1 份采购/销售导出中的状态字段为中文，时间字段格式为 `YYYY-MM-DD HH:mm:ss`
- 抽样验证上传接口：至少确认 1 张问题图片上传和 1 份工序/价格附件上传成功，并能通过文件访问地址回读
- 复验资产验收待办池只显示“仍有剩余可建卡数量”的收货单，确认已建卡收货记录不会继续留在 `/assets/acceptance`
- 复验损耗品采购单的退货与结算闭环：`RTN260414-00001` 类似链路不应误生成 `PURCHASE_RETURN_OUT` 库存事务，且采购结算页应显示退货摘要
- 将 `services/api/tests/integration/consumableAsset.api.test.ts` 纳入发布前固定回归清单

rollback:
- 若迁移后发现收货分流、资产台账或损耗品领用出现 blocker，立即停止发布并回滚到上一版 API 镜像
- 若最新前端产物上线后出现菜单缺失、路由 404 或页面级 blocker，立即回滚到上一版 Web 镜像
- 对本轮新增主数据与错误收货记录，按 `docs/sql-drafts/consumable-fixed-asset-validation-checks.sql` 的检查结果执行定向修复或回退脚本
- 回滚后重新验证原材料/BOM/MRP/采购/IQC 主链路

monitoring:
- 重点监控 IQC 收货失败率、损耗品领用执行失败率、资产验收/退回接口 4xx/5xx，以及退货、采购结算接口 4xx/5xx
- 监控 `purchase_receipt_items` 控制字段写入完整性、`asset_movements(return)` 记录量和异常日志
- 关注库存流水中是否误写入固定资产、是否出现非生产型 SKU 进入 MRP/采购建议，以及“质检来源退货”是否误写 `PURCHASE_RETURN_OUT`
- 关注 `/api/upload`、`/api/upload/files/:id/content` 的 4xx/5xx，以及 OSS 上传/回读失败率；本地测试环境则关注 `/app/uploads` 写入失败和磁盘占用
- 关注导出接口抽样文件中是否再次出现英文状态或秒级时间丢失
- 关注 Web 入口的菜单可见性、`/purchase/match`、`/purchase/returns`、`/purchase/settlements`、`/consumables/issues`、`/assets/acceptance`、`/assets/ledger` 页面加载成功率及前端 404/白屏日志

owner:
- devops-engineer
