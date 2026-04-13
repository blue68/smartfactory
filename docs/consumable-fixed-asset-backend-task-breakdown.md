# 损耗品与固定资产后端实施任务拆解

[artifact:TaskBreakdown]
status: READY
owner: senior-backend-engineer
scope:
- 损耗品与固定资产扩展的后端任务拆解
- 模块边界、依赖顺序、回归范围、交接条件
inputs:
- [consumable-fixed-asset-ddl-api-draft.md](/Users/kongwen/claude_wk/ai-software-company/docs/consumable-fixed-asset-ddl-api-draft.md)
- 现有 `sku`、`purchase`、`inventory`、`bom`、`mrp` 模块实现
handoff_to:
- engineering-manager
- senior-backend-engineer
- senior-frontend-engineer
- senior-qa-engineer
deliverables:
- 可执行粒度的后端任务包
- 分阶段实施顺序与模块责任边界
risks:
- 若 BOM/MRP 守卫晚于主数据扩展上线，存在新类目误入生产链路的窗口期
- 若采购收货分流与资产建卡拆在两个迭代，资产到货态会出现中间态堆积
exit_criteria:
- 每个任务都能对应到明确模块、输入、输出与验证动作

[artifact:ImplementationPlan]
status: READY
owner: senior-backend-engineer
scope:
- 分阶段实施与上线计划
inputs:
- 当前数据库结构与 API 风格
handoff_to:
- senior-qa-engineer
- devops-engineer
deliverables:
- 后端迭代计划、风险与验证方式
risks:
- 若一次性并行改动采购、库存、资产、BOM，联调面过大
exit_criteria:
- 任务可按阶段串行推进，并在每阶段末进行稳定性验证

goal:
- 在不破坏现有原材料、半成品、成品流程的前提下，扩展损耗品与固定资产的主数据、采购、收货、库存/台账、领用/调拨能力
changed_areas:
- `services/api/src/modules/sku`
- `services/api/src/modules/purchase`
- `services/api/src/modules/inventory`
- `services/api/src/modules/bom`
- `services/api/src/modules/mrp`
- 新增 `services/api/src/modules/consumables`
- 新增 `services/api/src/modules/assets`
- 新增 `services/api/src/migrations/*`
steps:
- 先扩展主数据与数据库结构
- 再补 BOM/MRP/采购建议守卫
- 再实现损耗品领用闭环
- 最后实现固定资产验收建卡与流转
risks:
- 采购收货路径分流是关键变更点
- BOM/MRP 守卫若覆盖不全，会产生脏数据
validation:
- 数据迁移验证、接口联调验证、生产链路回归、损耗品/资产新增链路验证

---

## 一、阶段划分

### Phase 1：主数据与兼容守卫

目标：
- 把“业务大类 + 控制模式”接入 SKU
- 从入口上阻止损耗品、固定资产误入 BOM/MRP

包含任务：
- T1.1：`skus` 新增控制字段与回填逻辑
- T1.2：SKU 查询、创建、更新接口支持新字段
- T1.3：BOM 保存增加 `allow_bom_component` 守卫
- T1.4：工单 BOM 展开、`material_requirements` 写入增加 `business_class` 守卫
- T1.5：采购建议生成增加 `control_mode = 'mrp'` 守卫

完成标准：
- 新增损耗品/固定资产 SKU 后，不会进入现有 BOM、缺料、采购建议链路

### Phase 2：损耗品采购与领用

目标：
- 支持损耗品库存型和直耗型两条路径

包含任务：
- T2.1：`sku_consumable_profiles` 表与服务接入
- T2.2：采购单明细支持 `business_class`、`receipt_mode`
- T2.3：采购收货支持 `inventory` / `direct_expense` 分流
- T2.4：损耗品领用单与出库
- T2.5：损耗品库存与流水查询接口

完成标准：
- 库存型损耗品可采购、入库、领用
- 直耗型损耗品可采购、到货、直接费用化

### Phase 3：固定资产验收建卡与流转

目标：
- 固定资产从采购到建卡闭环打通

包含任务：
- T3.1：`sku_asset_profiles`、`asset_cards`、`asset_movements` 接入
- T3.2：采购收货支持 `asset_capitalization`
- T3.3：资产验收接口
- T3.4：资产调拨、退回、报废接口
- T3.5：资产台账列表与详情接口

完成标准：
- 固定资产从采购到建卡、调拨、状态流转全部可追溯

---

## 二、模块级任务拆解

## 2.1 `sku` 模块

责任文件：
- `services/api/src/modules/sku/sku.entity.ts`
- `services/api/src/modules/sku/sku.repository.ts`
- `services/api/src/modules/sku/sku.service.ts`
- `services/api/src/modules/sku/sku.controller.ts`

任务：
- SKU-01：扩展 `SkuEntity`，补齐新增字段映射
- SKU-02：扩展列表与详情查询，返回 `businessClass`、`controlMode`、`allowBomComponent` 等字段
- SKU-03：扩展创建/更新 DTO 校验
- SKU-04：创建 SKU 时按 `businessClass` 保存 `consumableProfile` / `assetProfile`
- SKU-05：更新 SKU 时支持联动更新 profile

输入：
- DDL 草案中的 `skus`、`sku_consumable_profiles`、`sku_asset_profiles`

输出：
- SKU API 可读写新业务属性

验证：
- 新建原材料 SKU，默认值与旧逻辑一致
- 新建损耗品 SKU，返回 `consumableProfile`
- 新建固定资产 SKU，返回 `assetProfile`

风险：
- `sku.controller.ts` 当前对 `skuType` 有旧枚举映射，需要与新字段并行兼容

## 2.2 `bom` 模块

责任文件：
- `services/api/src/modules/bom/bom.service.ts`
- `services/api/src/modules/bom/bom.controller.ts`

任务：
- BOM-01：`createBom` / `updateBom` 增加组件准入校验
- BOM-02：BOM 导入、复制、快速录入等入口统一走相同守卫
- BOM-03：报错信息标准化

输入：
- `skus.allow_bom_component`
- `skus.business_class`

输出：
- 非生产型 SKU 默认无法进入 BOM

验证：
- 固定资产 SKU 加入 BOM 时被拒绝
- 损耗品 SKU 未配置例外时被拒绝
- 原材料、半成品保持可用

## 2.3 `mrp` 与生产展开链路

责任文件：
- `services/api/src/modules/production/bom-expansion.service.ts`
- `services/api/src/modules/production/production-order.service.ts`
- `services/api/src/modules/mrp/mrp.service.ts`
- `services/api/src/modules/purchase/suggestion.service.ts`

任务：
- MRP-01：BOM 展开阶段读取 SKU 业务属性
- MRP-02：只将 `business_class = production_material` 写入 `material_requirements`
- MRP-03：缺料检测时对非 `mrp` SKU 做防御性过滤
- MRP-04：采购建议生成时只处理 `control_mode = 'mrp'`
- MRP-05：补齐日志，标记被跳过的非生产型 SKU

输出：
- 损耗品和固定资产不会污染缺料、采购建议

验证：
- 包材 SKU 设置为 `allowBomComponent = 0` 时不进入缺料
- 包材 SKU 设置为 `allowBomComponent = 1` 且 `controlMode = mrp` 时按生产物料参与计算

## 2.4 `purchase` 模块

责任文件：
- `services/api/src/modules/purchase/purchase.service.ts`
- `services/api/src/modules/purchase/purchase.controller.ts`
- `services/api/src/modules/purchase/purchase.routes.ts`

任务：
- PO-01：采购单明细增加 `businessClass`、`receiptMode`、`requiresAcceptance`
- PO-02：创建采购单时根据 SKU 默认属性回填上述字段
- PO-03：明细校验，固定资产禁止 `receiptMode=inventory`
- PO-04：收货逻辑分流
- PO-05：为后续资产验收保留待验收状态

输出：
- 采购单明细可以区分生产物料、损耗品、固定资产

验证：
- 原材料明细默认 `inventory`
- 损耗品支持 `inventory` 与 `direct_expense`
- 固定资产默认 `asset_capitalization`

## 2.5 `inventory` 模块

责任文件：
- `services/api/src/modules/inventory/inventory.service.ts`
- `services/api/src/modules/inventory/inventory.controller.ts`
- `services/api/src/modules/inventory/inventory.routes.ts`

任务：
- INV-01：库存流水增加 `business_class`
- INV-02：新增 `CONSUMABLE_IN`、`CONSUMABLE_OUT`、`CONSUMABLE_ADJUST`
- INV-03：损耗品出库支持按部门和领用单回链
- INV-04：库存查询增加业务大类筛选
- INV-05：默认排除固定资产

输出：
- 损耗品可复用库存账，资产不进入库存主账

验证：
- 损耗品领用后库存扣减与流水可追溯
- 固定资产收货不会出现在库存快照里

## 2.6 新增 `consumables` 模块

建议新增文件：
- `services/api/src/modules/consumables/consumable.controller.ts`
- `services/api/src/modules/consumables/consumable.routes.ts`
- `services/api/src/modules/consumables/consumable.service.ts`

任务：
- CONS-01：创建损耗品领用单
- CONS-02：审批领用单
- CONS-03：执行领用并联动库存出库
- CONS-04：查询领用单列表与详情

输出：
- 损耗品申请、审批、发料闭环

验证：
- 领用执行后生成库存流水
- 未审批单据不可执行

## 2.7 新增 `assets` 模块

建议新增文件：
- `services/api/src/modules/assets/asset.controller.ts`
- `services/api/src/modules/assets/asset.routes.ts`
- `services/api/src/modules/assets/asset.service.ts`

任务：
- AST-01：固定资产验收建卡
- AST-02：资产列表、详情查询
- AST-03：资产调拨
- AST-04：资产报废
- AST-05：资产流转流水查询

输出：
- 固定资产独立台账与状态流转

验证：
- 建卡后自动生成资产流水
- 调拨后更新资产位置与责任部门

---

## 三、接口联调拆分

后端先交付：
- A1：SKU 主数据新字段读写
- A2：BOM 守卫错误码与错误文案
- A3：采购单明细业务属性返回
- A4：损耗品领用接口
- A5：资产验收与资产台账接口

前端可并行：
- F1：SKU 页面动态表单
- F2：采购单页业务类型展示
- F3：损耗品领用页
- F4：资产验收页
- F5：资产台账页

QA 入口条件：
- 主数据 API 已可创建三类 SKU
- BOM/MRP 守卫已上线
- 至少有一条损耗品链路和一条资产链路可走通

---

## 四、回归范围

必须回归：
- 现有原材料采购入库
- 现有 BOM 维护
- 工单创建与 `material_requirements`
- 缺料看板
- AI 采购建议生成与审批
- 生产领料 / 投料
- 库存快照与库存流水

新增测试包：
- `TC-CONS-001` 损耗品库存型采购入库
- `TC-CONS-002` 损耗品直耗型采购到货
- `TC-CONS-003` 损耗品领用审批与出库
- `TC-AST-001` 固定资产采购到货验收建卡
- `TC-AST-002` 固定资产调拨
- `TC-AST-003` 固定资产报废
- `TC-GUARD-001` 固定资产禁止加入 BOM
- `TC-GUARD-002` 损耗品不进入采购建议

---

## 五、交付顺序建议

1. `sku` + migration
2. `bom` + `production` + `mrp` guard
3. `purchase` receipt branching
4. `consumables` module
5. `assets` module
6. QA 回归与数据校验

---

## 六、上线前检查

- 历史 SKU 是否已正确回填 `business_class`
- 是否存在已配置为损耗品但仍在 BOM 中的存量数据
- 是否存在固定资产 SKU 被历史采购单错误标记为库存型收货
- 是否已补全损耗品仓、资产待验收仓、资产仓主数据
- 是否已准备回滚 SQL 与数据修复脚本

