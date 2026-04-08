[artifact:TaskBreakdown]
status: READY
owner: senior-backend-engineer
scope:
- 将 `inventory-warehouse-alignment-plan.md` 拆分为后端/前端/数据迁移三条并行执行清单
- 标记首批已落地项与下一批待办项
inputs:
- [inventory-warehouse-alignment-plan.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/inventory-warehouse-alignment-plan.md)
- 当前仓库实现代码
handoff_to:
- senior-frontend-engineer
- senior-backend-engineer
- senior-qa-engineer

## 后端并行清单
- [x] 库存写接口参数补齐：`warehouseId` + `locationId`（灰度缺参兜底默认仓位）
- [x] 写接口返回兼容告警：`warningCode=INV_FALLBACK_DEFAULT_LOCATION`
- [x] 新增错误码：`INV_WAREHOUSE_REQUIRED` / `INV_LOCATION_REQUIRED` / `INV_LOCATION_INVALID`
- [x] 库存读接口筛选补齐：库存列表、流水追溯支持仓库/库位过滤
- [x] 新增仓库/库位查询接口：`GET /api/inventory/warehouses`、`GET /api/inventory/locations`
- [x] 盘点确认入账链路补齐仓库/库位字段
- [x] 采购退货/生产完工/销售发货链路库存写入收敛到统一仓位校验器
- [x] 来料质检入库（IQC）链路收敛到统一仓位校验器
- [x] 灰度开关化（A/B/C 三阶段）与默认仓位写入策略切换（`INVENTORY_WAREHOUSE_PHASE`）
- [x] 默认仓位新增监控指标上报（请求缺参数、无效仓位请求、默认仓位新增笔数）
- [x] 仓库/库位 CSV 导入工具（重复校验、父子层级校验、失败明细下载）
- [x] 盘点差异一键生成调整单（支持预览/执行，流水附仓库/库位字段）

已落地文件：
- [inventory.service.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/inventory/inventory.service.ts)
- [inventory.controller.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/inventory/inventory.controller.ts)
- [inventory.routes.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/inventory/inventory.routes.ts)
- [stocktaking.service.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/stocktaking/stocktaking.service.ts)
- [ApiResponse.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/shared/ApiResponse.ts)
- [warehouse-location.resolver.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/inventory/warehouse-location.resolver.ts)
- [inventory.controller.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/inventory/inventory.controller.ts)
- [inventory.routes.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/inventory/inventory.routes.ts)
- [sales.service.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/sales/sales.service.ts)
- [sales.controller.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/sales/sales.controller.ts)
- [salesOrder.service.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/sales-order/salesOrder.service.ts)
- [salesOrder.controller.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/sales-order/salesOrder.controller.ts)
- [returnOrder.service.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/return-order/returnOrder.service.ts)
- [returnOrder.controller.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/return-order/returnOrder.controller.ts)
- [incomingInspection.service.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/incoming-inspection/incomingInspection.service.ts)
- [incomingInspection.controller.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/incoming-inspection/incomingInspection.controller.ts)
- [stocktaking.service.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/stocktaking/stocktaking.service.ts)
- [stocktaking.controller.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/stocktaking/stocktaking.controller.ts)
- [stocktaking.routes.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/stocktaking/stocktaking.routes.ts)
- [scheduler.service.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/production/scheduler.service.ts)
- [workflow-engine.service.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/production/workflow-engine.service.ts)
- [redis.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/config/redis.ts)
- [.env.example](/Users/kongwen/claude_wk/ai-software-company/.env.example)

## 前端并行清单
- [x] 入库表单新增“仓库 + 库位”联动选择，未选择禁止提交
- [x] 库存列表增加仓库/库位筛选
- [x] 增加“仅看默认仓位”快速筛选入口
- [x] 列表空仓位文案统一：`未绑定（需修复）`
- [x] 盘点新建弹窗新增仓库/库位选择
- [x] 盘点任务/明细展示仓库与库位
- [x] 盘点页新增“调整单入账”入口（对差异任务一键触发）
- [x] 采购、生产、销售页面的库存写入弹窗统一补齐仓位联动
- [x] 缺料看板增加仓库/库位维度筛选与默认仓位治理入口

已落地文件：
- [inventory.ts](/Users/kongwen/claude_wk/ai-software-company/services/web/src/api/inventory.ts)
- [InventoryPage.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/inventory/InventoryPage.tsx)
- [stocktaking.ts](/Users/kongwen/claude_wk/ai-software-company/services/web/src/api/stocktaking.ts)
- [StocktakingPage.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/stocktaking/StocktakingPage.tsx)
- [salesOrder.ts](/Users/kongwen/claude_wk/ai-software-company/services/web/src/api/salesOrder.ts)
- [returnOrder.ts](/Users/kongwen/claude_wk/ai-software-company/services/web/src/api/returnOrder.ts)
- [incomingInspection.ts](/Users/kongwen/claude_wk/ai-software-company/services/web/src/api/incomingInspection.ts)
- [SalesOrderListPage.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/sales/SalesOrderListPage.tsx)
- [ReturnOrderPage.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/purchase/ReturnOrderPage.tsx)
- [IncomingInspectionPage.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/purchase/IncomingInspectionPage.tsx)
- [ShortageBoard.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/production/ShortageBoard.tsx)
- [ShortageBoard.module.css](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/production/ShortageBoard.module.css)
- [mrp.ts](/Users/kongwen/claude_wk/ai-software-company/services/web/src/api/mrp.ts)
- [InventoryPage.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/inventory/InventoryPage.tsx)
- [models.ts](/Users/kongwen/claude_wk/ai-software-company/services/web/src/types/models.ts)
- [api.ts](/Users/kongwen/claude_wk/ai-software-company/services/web/src/types/api.ts)

## 数据迁移并行清单
- [x] 新增仓库主数据表：`warehouses`
- [x] 新增库位主数据表：`locations`
- [x] 新增迁移映射表：`inventory_location_mappings`
- [x] 新增未匹配记录表：`migration_unmapped_records`
- [x] `inventory` / `inventory_transactions` / `stocktaking_tasks` / `stocktaking_items` 补齐仓库库位字段
- [x] 初始化默认仓库：`DEFAULT` 与默认库位：`DEFAULT-UNKNOWN`
- [x] 存量数据默认仓位回填 + 未匹配记录落表
- [x] 接入业务方映射表数据并执行“按映射优先、默认兜底”全量迁移演练
- [x] 迁移后核对脚本：SKU 总量一致性、核心 SKU 抽样、默认仓位占比阈值
- [x] 迁移回滚演练脚本（批次回滚）
- [x] 运维日巡检脚本：无效仓位引用、停用仓位写入、默认仓位新增监控
- [x] 默认仓位批量修复脚本（按映射表修复历史流水并清理未匹配记录）

已落地文件：
- [M20260403_inventory_warehouse_alignment.sql](/Users/kongwen/claude_wk/ai-software-company/services/api/src/migrations/M20260403_inventory_warehouse_alignment.sql)
- [inventory-warehouse-postcheck.sql](/Users/kongwen/claude_wk/ai-software-company/docs/v3/sql/inventory-warehouse-postcheck.sql)
- [inventory-warehouse-rollback-by-batch.sql](/Users/kongwen/claude_wk/ai-software-company/docs/v3/sql/inventory-warehouse-rollback-by-batch.sql)
- [inventory-warehouse-mapping-drill.sql](/Users/kongwen/claude_wk/ai-software-company/docs/v3/sql/inventory-warehouse-mapping-drill.sql)
- [inventory-warehouse-daily-audit.sql](/Users/kongwen/claude_wk/ai-software-company/docs/v3/sql/inventory-warehouse-daily-audit.sql)
- [inventory-default-location-repair-by-mapping.sql](/Users/kongwen/claude_wk/ai-software-company/docs/v3/sql/inventory-default-location-repair-by-mapping.sql)

exit_criteria:
- 三条清单均可并行执行，首批关键链路已具备端到端可运行能力
