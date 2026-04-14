[artifact:TestCase]
status: READY
owner: senior-qa-engineer
scope:
- 沉淀损耗品与固定资产本轮后端收口的测试覆盖面
- 为环境恢复后的定向回归提供执行清单
inputs:
- `docs/consumable-fixed-asset-asset-return-backend-code.md`
- `docs/consumable-fixed-asset-quality-data-backend-code.md`
- `services/api/tests/unit/incomingInspection.regression.test.ts`
- `services/api/tests/unit/bom.guard.test.ts`
- `services/api/tests/unit/mrp.guard.test.ts`
- `services/api/tests/unit/consumables.service.test.ts`
- `services/api/tests/unit/assets.routes.test.ts`
- `services/api/tests/unit/assets.service.test.ts`
- `services/api/tests/integration/consumableAsset.api.test.ts`
handoff_to:
- senior-qa-engineer
- devops-engineer
deliverables:
- 本轮后端变更对应的功能、权限、兼容与集成测试清单
- 环境恢复后应优先补跑的用例顺序
risks:
- 集成环境未恢复前，以下 Case 中的 integration 部分只能保持待执行状态
exit_criteria:
- 用例已覆盖固定资产退回、收货分流、守卫兼容和高价值集成主链路

测试范围：
- TC-QD-001：`incomingInspection` 对 `direct_expense` 损耗品收货只写 `purchase_receipt_items` 控制字段，不写库存台账与库存流水
- TC-QD-002：`incomingInspection` 对 `asset_capitalization` 固定资产收货只写资本化收货记录，不写库存台账与库存流水
- TC-QD-003：BOM 准入守卫拒绝非生产型 SKU 进入生产物料链路
- TC-QD-004：MRP/采购建议守卫过滤非 `mrp` 物料
- TC-QD-005：损耗品 `create / approve / execute` 服务闭环保持可用
- TC-AR-001：资产退回路由需具备 `asset:return` 权限或既有资产管理角色
- TC-AR-002：资产退回后卡片状态回写为 `idle`，清空部门/责任人并写入 `asset_movements(return)`
- TC-AR-003：已报废资产不允许退回
- TC-INT-001：固定资产采购收货后可完成验收建卡，并在台账中可查
- TC-INT-002：固定资产卡片可执行退回并形成 `return` 流水
- TC-INT-003：库存型损耗品可完成领用审批与出库扣减

执行优先级：
1. 先跑 unit/regression：`TC-QD-001 ~ 005`、`TC-AR-001 ~ 003`
2. 再跑 integration：`TC-INT-001 ~ 003`
3. 环境恢复后补一次回归串跑，确认数据库控制字段、租户隔离和库存副作用一致
