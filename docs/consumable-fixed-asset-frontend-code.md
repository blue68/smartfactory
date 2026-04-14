[artifact:FrontendCode]
status: READY
owner: senior-frontend-engineer
scope:
- 前端共享类型补齐损耗品/固定资产字段
- SKU 页面补齐业务大类、控制模式和动态 profile 编辑表单
- SKU 详情和采购订单页先行透出新增业务属性
- 新增损耗品领用页、固定资产验收页、资产台账页及其 API 联调入口
inputs:
- `docs/consumable-fixed-asset-frontend-approval.md`
- `docs/consumable-fixed-asset-frontend-implementation-plan.md`
- `docs/consumable-fixed-asset-ddl-api-draft.md`
handoff_to:
- code-reviewer
- senior-qa-engineer
- security-engineer
deliverables:
- `services/web/src/types/models.ts` 新增业务大类、控制模式、收货模式、档案字段
- `SkuPage` 新建/编辑抽屉新增 `businessClass / controlMode / defaultWarehouseType / approvalPolicyCode / assetTrackingMode` 管控属性编辑
- `SkuPage` 在 `businessClass` 切换时动态展示 `consumableProfile` 或 `assetProfile` 表单，并带入推荐默认值
- `SkuPage` 详情与列表摘要新增损耗品/固定资产管控信息透出
- `PurchaseOrderPage` 列表备注区与详情明细新增业务大类/收货模式/验收标签
- `ConsumableIssuePage` 打通领用单列表、详情、创建、审批、执行出库主路径
- `AssetAcceptancePage` 基于采购入库单筛选固定资产明细并执行验收建卡
- `AssetLedgerPage` 打通资产卡片列表、详情、流水查看与退回入口
- `ConsumableIssuePage`、`AssetAcceptancePage`、`AssetLedgerPage` 补齐联调失败时的显式错态、重试入口与抽屉错误反馈
- `AssetAcceptancePage` 在保管人列表接口异常时保留“下拉 + 手输用户 ID”双路径
risks:
- 资产验收页当前复用采购入库列表筛选待验收记录，后续若后端补专用 pending 接口，可再收敛筛选逻辑
- 采购列表目前以摘要文案透出业务属性，后续若字段过多仍需单独优化列布局
exit_criteria:
- 现有前端页面能够感知后端新增字段，并具备损耗品领用、资产验收、资产台账的基础可操作路径

changed_files:
- `services/web/src/types/models.ts`
- `services/web/src/api/consumables.ts`
- `services/web/src/api/assets.ts`
- `services/web/src/pages/master-data/SkuPage.tsx`
- `services/web/src/pages/master-data/SkuPage.module.css`
- `services/web/src/pages/purchase/PurchaseOrderPage.tsx`
- `services/web/src/pages/consumables/ConsumableIssuePage.tsx`
- `services/web/src/pages/consumables/ConsumableIssuePage.module.css`
- `services/web/src/pages/assets/AssetAcceptancePage.tsx`
- `services/web/src/pages/assets/AssetAcceptancePage.module.css`
- `services/web/src/pages/assets/AssetLedgerPage.tsx`
- `services/web/src/pages/assets/AssetLedgerPage.module.css`
- `services/web/src/App.tsx`
- `services/web/src/components/Layout/Sidebar.tsx`
- `services/web/src/constants/accessControl.ts`
- `services/web/src/hooks/usePermission.ts`
- `docs/consumable-fixed-asset-frontend-code.md`
- `docs/consumable-fixed-asset-execution-checklist.md`

contracts_affected:
- 前端共享类型新增 `businessClass`、`controlMode`、`receiptMode`、`consumableProfile`、`assetProfile`
- 采购订单明细前端模型新增 `requiresAcceptance`、`budgetCode`、`requestDepartmentName`
- 新增前端调用 `/api/consumables/issues*`、`/api/consumables/stock`、`/api/assets/cards*`、`/api/assets/acceptance`

tests_run:
- `npm run typecheck`（`services/web`）
- 本地 `vite` 冒烟：以伪造登录态访问 `/master-data/sku`、`/consumables/issues`、`/assets/acceptance`、`/assets/ledger`，确认页面在后端不可用时不崩溃，并补齐错态反馈

known_issues:
- `AssetAcceptancePage` 已接入保管人真实用户下拉，但部门仍缺独立主数据接口，当前仅提供收货上下文推荐值 + 手工输入
- 页面级交互已可操作，且已验证在后端 500/不可达时具备可见错态；但 `F1/F3/F4/F5` 尚未在真实联调环境跑通正向冒烟
