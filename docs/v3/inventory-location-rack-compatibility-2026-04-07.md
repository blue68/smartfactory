[artifact:APIDoc]
status: READY
owner: senior-backend-engineer
scope:
- 为现有 `locations` 模型补齐“货架型库位”语义，不破坏既有库位编码与引用关系
- 定义前后端统一字段，支持库区/货架/货架层/货架格
inputs:
- [version-summary-2026-04-03.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/version-summary-2026-04-03.md)
- [version-summary-2026-04-07.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/version-summary-2026-04-07.md)
- [inventory-warehouse-release-audit-report-2026-04-07.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/inventory-warehouse-release-audit-report-2026-04-07.md)
- `docs/v3/release-logs/inventory-warehouse/20260407-132646/*`
handoff_to:
- senior-frontend-engineer
- senior-qa-engineer

deliverables:
- 新增数据库迁移脚本：
  - [M20260407_location_rack_compat.sql](/Users/kongwen/claude_wk/ai-software-company/services/api/src/migrations/M20260407_location_rack_compat.sql)
- 后端库位接口扩展：
  - `locationType`：`general | zone | rack | shelf | bin`
  - `aisleCode` / `rackCode` / `shelfCode` / `binCode`（可选）
- 前端库位配置页扩展：
  - 新增“库位类型”
  - 新增“巷道/货架/层/格”坐标字段
  - 列表新增“货架坐标”展示列

risks:
- 历史数据默认落为 `locationType=general`，需要业务逐步补齐精准类型与坐标。

exit_criteria:
- 在不改动现有 `warehouse_id + code` 唯一约束下，能表达货架结构并支持日常 CRUD 与 CSV 导入。

## 字段设计（向后兼容）
- `locations.location_type`（enum）：库位类型
- `locations.aisle_code`（varchar）：巷道编码
- `locations.rack_code`（varchar）：货架编码
- `locations.shelf_code`（varchar）：货架层编码
- `locations.bin_code`（varchar）：货架格编码

## 兼容策略
- 继续保留原有 `level + parent_id`，不破坏现有层级关系。
- 继续保留 `tenant_id + warehouse_id + code` 唯一键，兼容历史业务编码。
- 新字段全部为增量字段：旧数据不需要重建即可继续使用。

## API 契约增量
- `POST /api/inventory/locations` 新增可选入参：
  - `locationType`, `aisleCode`, `rackCode`, `shelfCode`, `binCode`
- `PUT /api/inventory/locations/:id` 新增可选入参：
  - `locationType`, `aisleCode`, `rackCode`, `shelfCode`, `binCode`
- `GET /api/inventory/locations` 返回新增字段：
  - `locationType`, `aisleCode`, `rackCode`, `shelfCode`, `binCode`

## CSV 兼容
- 新模板头：
  - `warehouseCode,code,name,locationType,aisleCode,rackCode,shelfCode,binCode,level,parentCode,status`
- 兼容旧模板：
  - 旧头（不含新字段）仍可导入，默认 `locationType=general`。
