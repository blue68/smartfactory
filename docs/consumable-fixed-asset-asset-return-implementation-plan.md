[artifact:ImplementationPlan]
status: READY
owner: senior-backend-engineer
scope:
- 固定资产退回接口实现
- 资产退回自动化测试
- 剩余计划拆解为执行清单
inputs:
- `docs/consumable-fixed-asset-asset-return-approval.md`
- `docs/consumable-fixed-asset-asset-return-product.md`
- `docs/consumable-fixed-asset-ddl-api-draft.md`
- `docs/consumable-fixed-asset-backend-task-breakdown.md`
handoff_to:
- code-reviewer
- senior-qa-engineer
- devops-engineer

goal:
- 在不回归现有资产验收、调拨、报废能力的前提下，补齐固定资产退回闭环
- 为后续排期输出按角色和人天可执行的收口清单

changed_areas:
- `services/api/src/modules/assets/asset.controller.ts`
- `services/api/src/modules/assets/asset.routes.ts`
- `services/api/src/modules/assets/asset.service.ts`
- `services/api/tests/unit`
- `docs`

steps:
- 新增 `POST /api/assets/cards/:id/return` 路由与请求校验
- 在 `AssetService` 中实现 `returnCard`
- 退回时回写 `asset_cards` 状态、部门、责任人和位置
- 写入 `asset_movements` 的 `return` 流水
- 补路由守卫测试与服务单测
- 跑定向测试与类型检查
- 将剩余计划拆成按角色和人天的执行清单

risks:
- 资产状态语义与文档草案存在轻微漂移，需要同步定稿
- 若测试只覆盖成功路径，后续容易遗漏已报废资产的冲突行为

validation:
- `npm run typecheck`
- `npx jest tests/unit/assets.routes.test.ts tests/unit/assets.service.test.ts --runInBand --forceExit`
