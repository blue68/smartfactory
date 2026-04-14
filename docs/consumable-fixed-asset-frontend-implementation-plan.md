[artifact:ImplementationPlan]
status: READY
owner: senior-frontend-engineer
scope:
- 损耗品与固定资产前端联调首版实现计划
- 覆盖 F1~F5 的代码拆分顺序
inputs:
- `docs/consumable-fixed-asset-frontend-approval.md`
- `docs/consumable-fixed-asset-frontend-product.md`
- `docs/consumable-fixed-asset-frontend-design.md`
- `docs/consumable-fixed-asset-ddl-api-draft.md`
- `docs/consumable-fixed-asset-backend-task-breakdown.md`
handoff_to:
- code-reviewer
- senior-qa-engineer
- security-engineer

goal:
- 在不破坏现有生产物料前端链路的前提下，补齐损耗品与固定资产的页面入口、字段展示和闭环操作

changed_areas:
- `services/web/src/types/models.ts`
- `services/web/src/api/sku.ts`
- `services/web/src/api/purchase.ts`
- `services/web/src/api/inventory.ts`
- `services/web/src/api/*` 新增 `consumables.ts` / `assets.ts`
- `services/web/src/pages/master-data/SkuPage.tsx`
- `services/web/src/pages/purchase/PurchaseOrderPage.tsx`
- `services/web/src/pages/inventory/InventoryPage.tsx`
- `services/web/src/pages/consumables/*`
- `services/web/src/pages/assets/*`
- `services/web/src/App.tsx`
- `services/web/src/components/Layout/Sidebar.tsx`

steps:
- 第一步：补前端类型与 API 层，打通 `businessClass` / `controlMode` / `receiptMode` / `assetCard` / `consumableIssue` 模型
- 第二步：实现 F1/F2，先在既有 `SkuPage` 与 `PurchaseOrderPage` 接上新增字段和标签
- 第三步：实现 F3，新增损耗品领用页和库存查询入口
- 第四步：实现 F4/F5，新增资产验收页与资产台账页，并接入退回入口
- 第五步：补路由、菜单显隐、空态/错态和定向页面自测

risks:
- `services/web/src/types/models.ts` 当前尚未承载新字段，若类型改动不完整，页面会出现大量隐性 `any` 漏洞
- 资产台账和库存页边界相近，若组件复用不当容易把资产卡片混进库存视图
- 采购页面历史代码量较大，需控制 F2 只做字段透出，不顺手重构整页

validation:
- `npm run typecheck`
- 关键页面本地 smoke：`/master-data/sku`、`/purchase/orders`、`/inventory`
