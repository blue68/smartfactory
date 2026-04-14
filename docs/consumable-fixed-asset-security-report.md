[artifact:SecurityReport]
status: PASS
owner: security-engineer
scope:
- 审查固定资产退回接口权限边界
- 审查损耗品/固定资产相关新增测试、采购后链路页面与数据脚本的安全影响
inputs:
- `docs/consumable-fixed-asset-asset-return-backend-code.md`
- `docs/consumable-fixed-asset-quality-data-backend-code.md`
- `services/api/src/modules/assets/asset.routes.ts`
- `services/api/src/modules/assets/asset.service.ts`
- `services/api/tests/integration/consumableAsset.api.test.ts`
- `docs/sql-drafts/consumable-fixed-asset-validation-checks.sql`
handoff_to:
- senior-qa-engineer
- devops-engineer
deliverables:
- 本轮后端改动的安全审计结论
- 发布前需继续确认的权限与环境项
risks:
- 当前本地隔离环境已恢复并完成租户态真实登录、权限快照与页面级联调；剩余风险主要收敛为正式环境是否按同口径复跑，以及共享测试库执行时的租户隔离边界确认
- 采购后链路新增了 `sourceInspectionId` 过滤、退货深链与结算空态建单入口，正式环境需继续确认 URL 透传与权限快照不会放大跨单据可见范围
exit_criteria:
- 已明确是否存在高危未决问题
- 已给出发布前必须修复项

verdict: PASS
findings:
- [severity:low] `services/api/src/modules/assets/asset.routes.ts` 为退回接口新增 `asset:return` 权限，并保留 `boss` / `supervisor` / `warehouse` 角色兜底，权限边界与现有资产流转接口保持一致，未见越权放大
- [severity:low] `services/api/src/modules/assets/asset.service.ts` 在退回事务中使用 `FOR UPDATE` 锁定资产卡片并禁止已报废资产退回，避免并发改写和状态回穿，事务边界合理
- [severity:low] `services/api/tests/integration/consumableAsset.api.test.ts` 使用固定测试账号、测试租户和固定 ID 清理/回填数据，适合作为隔离环境用例；在共享测试库执行前仍应确认不会误接入非隔离租户或生产样例数据
- [severity:low] 本地已核验 `RTN260414-00001` 这类带 `source_inspection_id` 的采购退货在发出/完成后不会误生成 `PURCHASE_RETURN_OUT` 库存事务，当前未见账务越权或错误扣库
must_fix:
- None
can_follow_up:
- 若后续把本 spec 接入共享测试库，再单独补一次 `tenant_id` 过滤、测试数据清理与权限边界核对
- 若后续对外开放批量资产操作，再单独补审计日志与批量权限边界评估
- 若后续允许跨页通过 URL 直接创建或确认结算单，再单独补一次 URL 参数、权限快照和 CSRF 相关评估
