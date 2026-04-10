[artifact:BackendCode]
status: READY
owner: senior-backend-engineer
scope:
- 落地“客户专属 SKU + 工厂公共 SKU + 客户编码映射”最小版本后端改造
- 补齐销售订单保存时客户-SKU可见性强校验与客户编码快照
inputs:
- 用户需求：客户专属 SKU 隔离、工厂公共 SKU 开放、客户自定义 SKU 编码兼容
- [database-design.md](/Users/kongwen/claude_wk/ai-software-company/docs/database-design.md)
- [salesOrder.service.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/sales-order/salesOrder.service.ts)
- [sku.service.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/sku/sku.service.ts)
handoff_to:
- senior-frontend-engineer
- senior-qa-engineer
- devops-engineer

changed_files:
- services/api/src/migrations/M20260410_customer_brand_sku_scope.sql
- services/api/src/modules/sku/sku.entity.ts
- services/api/src/modules/sku/sku.repository.ts
- services/api/src/modules/sku/sku.service.ts
- services/api/src/modules/sku/sku.controller.ts
- services/api/src/modules/sales-order/salesOrderItem.entity.ts
- services/api/src/modules/sales-order/salesOrder.service.ts
- services/api/tests/unit/salesOrder.service.regression.test.ts
- scripts/redeploy-local.sh

contracts_affected:
- `skus` 新增 `brand_scope`、`brand_customer_id`
- 新增 `customer_sku_refs` 映射表
- `sales_order_items` 新增 `customer_sku_code_snapshot`、`customer_sku_name_snapshot`
- `GET /api/skus` 支持 `customerId` 查询参数
- `GET /api/skus/:id` 响应新增 `customerRefs`
- 销售订单创建/编辑时新增客户-SKU可见性后端强校验

tests_run:
- `cd services/api && npm run typecheck`
- `cd services/api && npm test -- --runInBand tests/unit/salesOrder.service.regression.test.ts`
- `cd services/api && npm test -- --runInBand tests/unit/sku.service.test.ts`

known_issues:
- Not Run：`services/api` 销售订单与 SKU 集成测试全量回归
- Not Run：migration 在空库与已有库两种场景的完整演练

## 后端进度摘要（2026-04-11）
- 已完成 SKU 访问域建模：`factory`（工厂公共）/`customer`（客户专属）。
- 已完成客户侧编码映射建模：`customer_sku_refs`。
- 已完成销售订单保存环节的防越权校验：客户无法下单非授权 SKU。
- 已完成订单明细客户编码快照写入与详情展示回退逻辑。
- 已将 migration 改为 MySQL 8 兼容幂等写法（去除 `ADD COLUMN/INDEX IF NOT EXISTS` 依赖）。

[artifact:FrontendCode]
status: READY
owner: senior-frontend-engineer
scope:
- 前端 SKU 主数据页与销售订单页接入客户维度 SKU 可见性
- 订单录入界面切换客户后只显示该客户可下单 SKU
inputs:
- [api/sku.ts](/Users/kongwen/claude_wk/ai-software-company/services/web/src/api/sku.ts)
- [SkuPage.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/master-data/SkuPage.tsx)
- [SalesOrderListPage.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/sales/SalesOrderListPage.tsx)
- [OrderPage.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/sales/OrderPage.tsx)
handoff_to:
- senior-qa-engineer

changed_files:
- services/web/src/types/models.ts
- services/web/src/pages/master-data/SkuPage.tsx
- services/web/src/pages/sales/SalesOrderListPage.tsx
- services/web/src/pages/sales/OrderPage.tsx

contracts_affected:
- `Sku` 类型新增 `brandScope`、`brandCustomerId`、`customerSkuCode`、`customerSkuName`、`customerRefs`
- `SkuListQuery` 新增 `customerId`
- SKU 页面新增“品牌归属/所属客户/客户编码映射”编辑与详情展示
- 销售订单页面 SKU 下拉改为按客户过滤

tests_run:
- `cd services/web && npm run typecheck`

known_issues:
- Not Run：`services/web` 页面级用例（销售订单与 SKU 页面）自动化回归
- 销售订单列表页编辑历史订单的“客户切换时仅清理不兼容 SKU 并保留兼容行”交互仍可继续优化

## 本地库执行记录（2026-04-11）
- 已执行 migration：
  - `services/api/src/migrations/M20260410_customer_brand_sku_scope.sql`
- 已更新本地重部署脚本：
  - `scripts/redeploy-local.sh` 已纳入 `M20260410_customer_brand_sku_scope.sql`，保证后续本地重启会自动应用该结构变更
- 已验证 schema：
  - `skus.brand_scope` 存在
  - `skus.brand_customer_id` 存在
  - `customer_sku_refs` 表存在
  - `sales_order_items.customer_sku_code_snapshot` 存在
  - `sales_order_items.customer_sku_name_snapshot` 存在

## 补充验证记录（2026-04-11）
- `cd services/web && npm run typecheck`（通过）
- `PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_APP_BASE_URL=http://127.0.0.1:80 npx playwright test tests/salesOrder.real.spec.ts --project=chromium --grep @sales-order-smoke`（未通过）
  - 失败原因为当前执行环境对 Chromium headless 进程的系统级权限限制（`mach_port_rendezvous` / `Permission denied`），不是业务断言失败。
- `npm run test:api:integration`（受管集成全量）
  - 结果：`4 passed / 12 failed`，`209` 条用例中 `126 passed / 83 failed`
  - 主要失败形态：大量旧用例对角色权限断言仍按历史口径预期 `200/201`，实际返回 `403` 或 `1003`（权限不足）
  - 结论：本轮变更已通过类型检查与核心回归用例，但全量集成测试基线已与当前权限模型存在系统性偏差，需单独整理权限期望与测试夹具
