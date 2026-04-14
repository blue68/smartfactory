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
- `PurchaseOrderPage` 新增“手工建采购单”入口，支持损耗品 / 固定资产直接下单
- `PurchaseReceiptPage` 新增“收货分流”区块，把库存入库、直接费用化、资产待验收路径在收货页直接透出
- `MatchPage`、`ReturnOrderPage`、`PurchaseSettlementPage` 已补齐采购后链路页面联动，支持三单匹配执行、退货来源深链、结算空态直接建单与退货摘要展示
- `AssetAcceptancePage` 仅保留仍有剩余可建卡数量的收货明细，已完成建卡的入库单不再留在待办池
- `ConsumableIssuePage`、`AssetAcceptancePage`、`AssetLedgerPage` 补齐联调失败时的显式错态、重试入口与抽屉错误反馈
- `AssetAcceptancePage` 在保管人列表接口异常时保留“下拉 + 手输用户 ID”双路径
- `vite.config.ts` 新增 `VITE_API_PROXY_TARGET` 可配置代理目标，支持在本地 `vite` 下对接 Docker 联调 API
risks:
- 资产验收页当前复用采购入库列表筛选待验收记录，后续若后端补专用 pending 接口，可再收敛筛选逻辑
- 采购列表目前以摘要文案透出业务属性，后续若字段过多仍需单独优化列布局
exit_criteria:
- 现有前端页面能够感知后端新增字段，并具备损耗品领用、资产验收、资产台账的基础可操作路径

changed_files:
- `services/web/src/types/models.ts`
- `services/web/src/api/consumables.ts`
- `services/web/src/api/assets.ts`
- `services/web/.env.example`
- `services/web/src/pages/master-data/SkuPage.tsx`
- `services/web/src/pages/master-data/SkuPage.module.css`
- `services/web/src/pages/purchase/PurchaseOrderPage.tsx`
- `services/web/src/pages/purchase/PurchaseOrderPage.module.css`
- `services/web/src/pages/purchase/PurchaseReceiptPage.tsx`
- `services/web/src/pages/purchase/PurchaseReceiptPage.module.css`
- `services/web/src/pages/purchase/MatchPage.tsx`
- `services/web/src/pages/purchase/MatchPage.module.css`
- `services/web/src/pages/purchase/ReturnOrderPage.tsx`
- `services/web/src/pages/purchase/ReturnOrderPage.module.css`
- `services/web/src/pages/purchase/PurchaseSettlementPage.tsx`
- `services/web/src/pages/purchase/PurchaseSettlementPage.module.css`
- `services/web/src/pages/consumables/ConsumableIssuePage.tsx`
- `services/web/src/pages/consumables/ConsumableIssuePage.module.css`
- `services/web/src/pages/assets/AssetAcceptancePage.tsx`
- `services/web/src/pages/assets/AssetAcceptancePage.module.css`
- `services/web/src/pages/assets/AssetLedgerPage.tsx`
- `services/web/src/pages/assets/AssetLedgerPage.module.css`
- `services/web/src/pages/system/DepartmentConfigSection.tsx`
- `services/web/src/pages/system/UserConfigPage.tsx`
- `services/web/src/App.tsx`
- `services/web/src/components/Layout/Sidebar.tsx`
- `services/web/src/constants/accessControl.ts`
- `services/web/src/hooks/usePermission.ts`
- `services/web/src/api/departments.ts`
- `services/web/src/api/purchase.ts`
- `services/web/src/utils/assetDisplay.ts`
- `services/web/src/utils/department.ts`
- `services/web/src/utils/purchaseFlow.ts`
- `services/web/vite.config.ts`
- `docs/consumable-fixed-asset-frontend-code.md`
- `docs/consumable-fixed-asset-execution-checklist.md`

contracts_affected:
- 前端共享类型新增 `businessClass`、`controlMode`、`receiptMode`、`consumableProfile`、`assetProfile`
- 采购订单明细前端模型新增 `requiresAcceptance`、`budgetCode`、`requestDepartmentName`
- 新增前端调用 `/api/consumables/issues*`、`/api/consumables/stock`、`/api/assets/cards*`、`/api/assets/acceptance`

tests_run:
- `npm run typecheck`（`services/web`）
- `npm run build`（`services/web`）
- 本地 `vite` 负向冒烟：以伪造登录态访问 `/master-data/sku`、`/consumables/issues`、`/assets/acceptance`、`/assets/ledger`，确认页面在后端不可用时不崩溃，并补齐错态反馈
- `VITE_API_PROXY_TARGET=http://127.0.0.1:80 npm run dev -- --host 127.0.0.1 --port 4173` + 浏览器正向联调（2026-04-14，基于真实租户权限快照验证 `/master-data/sku`、`/consumables/issues`、`/assets/acceptance`、`/assets/ledger`；确认可见 `ASSET-ACC-20260413A`、`CI260413-00001`、资产验收收货池、`FA260413-00001` 等真实数据）
- `docker compose build web` + `docker compose up -d --force-recreate web` + 80 端口浏览器复烟（2026-04-14，确认真实部署入口已出现新菜单，且深链接 `/master-data/sku`、`/consumables/issues`、`/assets/acceptance`、`/assets/ledger` 均可直接打开并加载真实数据）
- 真实登录态 API + 浏览器正向回归（2026-04-14）
  - 固定资产：`PO1776167322613838 -> RC260414-00001 -> FA260414-00001`
  - 损耗品：`PO1776167371741479 -> RC260414-00002 -> CI260414-00001`
  - 复验 `localhost/assets/acceptance` 待办池已清空，不再展示已建卡收货单
- 真实登录态浏览器采购后链路回归（2026-04-14）
  - 三单匹配：`PO1776167371741479 / DN1776167371783459 / RC260414-00002`
  - 退货：`RTN260414-00001` 已完成 `draft -> confirmed -> shipped -> completed`
  - 结算：`PST260414-00001` 已完成 `draft -> confirmed -> paid`
  - 退货页支持 `poId / inspectionId / returnId` 深链落点，结算页空态支持从已匹配记录直接创建结算单并显示退货摘要

known_issues:
- 正式环境发布时仍需按同样步骤重建 Web 镜像并复跑页面冒烟，避免沿用历史 bundle
- `npm run test:api:integration:consumable-asset` 仍需纳入 CI 或正式发布清单，当前本地已固定、正式流程尚未接入
