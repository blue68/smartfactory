[artifact:PRD]
status: READY
owner: senior-ai-agent-pm
scope:
- 为损耗品与固定资产版本补齐前端联调产品定义
- 覆盖 `F1 ~ F5` 的页面范围、目标和验收标准
inputs:
- `docs/consumable-fixed-asset-ddl-api-draft.md`
- `docs/consumable-fixed-asset-backend-task-breakdown.md`
- `docs/consumable-fixed-asset-execution-checklist.md`
- `services/web/src/App.tsx`
handoff_to:
- senior-ui-designer
- tech-lead-architect
- engineering-manager
deliverables:
- 前端联调范围定义
- 页面级验收标准
- 与现有路由的落位建议
risks:
- 若把资产台账混入现有库存页，会模糊“库存账”和“资产账”边界
- 若采购单页不显式展示 `receiptMode` / `requiresAcceptance`，业务人员仍会按旧链路误操作
exit_criteria:
- F1~F5 均有明确场景、边界和验收口径

背景：
- 后端已完成损耗品与固定资产的主干能力，但现有前端仍主要服务生产物料链路。
- 当前缺口集中在 SKU 主数据、采购明细展示、损耗品领用、资产验收和资产台账五块页面联调。

目标：
1. 让业务人员能在现有系统内完成损耗品与固定资产的主数据维护、采购流转和查询。
2. 不破坏原材料、半成品、成品既有页面与操作习惯。
3. 将“库存型损耗品 / 直耗型损耗品 / 固定资产资本化”三条路径在页面上清晰区分。

范围：
- F1：`/master-data/sku` 扩展业务大类、控制模式、默认仓库类型、损耗品/资产档案动态表单
- F2：`/purchase/orders` 与相关详情抽屉扩展采购明细业务属性展示
- F3：新增损耗品领用页，承接 `consumable_issue_orders`
- F4：新增资产验收页，承接固定资产收货后的建卡动作
- F5：新增资产台账页，承接 `asset_cards` 列表、详情与退回入口

不在范围：
- 折旧、维修、盘点、批量导入导出资产
- 新增损耗品预算中心、成本分摊页
- 变更现有 BOM、MRP、采购建议主页面结构

验收标准：
1. SKU 页面可完成损耗品和固定资产 SKU 的创建、查看、编辑，并根据 `businessClass` 动态展示相应 profile。
2. 采购单页和详情能直观看到 `businessClass`、`receiptMode`、`requiresAcceptance`，并用文案区分三条收货路径。
3. 损耗品领用页可完成创建、审批、执行、库存查询的闭环操作。
4. 资产验收页可筛出待验收收货记录，完成建卡并反馈卡片编号。
5. 资产台账页只展示资产卡片，不与库存页混表，并支持查看详情、调拨/报废历史与退回入口。

[artifact:UserStory]
status: READY
owner: senior-ai-agent-pm
scope:
- 提炼 F1~F5 的关键操作者与价值
inputs:
- [artifact:PRD]
handoff_to:
- senior-ui-designer
- engineering-manager
deliverables:
- 可直接用于设计与测试的前端用户故事
risks:
- None
exit_criteria:
- 每条用户故事都对应具体页面和操作结果

1. 作为采购员，我希望在 SKU 页面把辅料标记为“损耗品”并维护领用规则，这样采购单能自动带出正确的收货模式。
2. 作为仓库/主管，我希望在采购单和详情里直接看到“库存入库 / 直耗 / 资产资本化”的区别，这样不会把固定资产当库存物料处理。
3. 作为仓库管理员，我希望在损耗品领用页完成创建、审批、执行出库，这样损耗品不再借道普通库存调整单。
4. 作为资产管理员，我希望在资产验收页根据到货记录快速建卡，这样固定资产能形成可追溯台账。
5. 作为主管，我希望在资产台账页查看卡片状态并执行退回，这样资产流转能在一个入口闭环。

[artifact:Prototype]
status: READY
owner: senior-ai-agent-pm
scope:
- 定义 F1~F5 的页面结构、主路径、状态流和异常流
inputs:
- [artifact:PRD]
- [artifact:UserStory]
- `docs/consumable-fixed-asset-ddl-api-draft.md`
handoff_to:
- senior-ui-designer
- engineering-manager
deliverables:
- 页面级原型说明
- 主流程与异常状态清单
risks:
- None
exit_criteria:
- 设计与前端实现可直接据此开工

F1 `SKU 页面`：
- 列表页保持现有卡片统计和表格布局，新增“业务大类 / 控制模式 / 默认仓库类型”列与筛选项
- 新建/编辑抽屉在基础信息下新增“管控属性”分组
- 当 `businessClass = consumable` 时显示 `consumableProfile`
- 当 `businessClass = fixed_asset` 时显示 `assetProfile`
- 异常流：切换业务大类时若已填写另一类 profile，弹确认提示并清空不适用字段

F2 `采购订单页`：
- 列表页表格增加“业务大类摘要 / 收货模式摘要”列
- 详情抽屉的明细行增加标签：`生产物料`、`损耗品-库存型`、`损耗品-直耗型`、`固定资产-待验收`
- 异常流：若后端返回缺失控制字段，页面展示 `待补配置` 警示标签而不是静默空白

F3 `损耗品领用页`：
- 主列表含状态筛选、部门筛选、申请人筛选
- 抽屉表单支持多明细，明细需选择仓库/库位、数量、预算号、备注
- 详情页展示审批轨迹和执行结果
- 异常流：库存不足时在执行前弹出阻断提示，并高亮具体明细

F4 `资产验收页`：
- 默认展示 `receiptMode = asset_capitalization` 且待验收的收货记录
- 建卡弹窗要求资产名称、编号/序列号、部门、责任人、位置、原值
- 成功后返回卡片编号并支持跳转资产台账
- 异常流：同一收货明细重复验收时显示已建卡信息和阻断提示

F5 `资产台账页`：
- 列表页展示卡片编号、SKU、资产名称、状态、部门、责任人、位置、原值、资本化时间
- 详情抽屉展示资产主数据、流转记录、关联收货信息
- 在 `in_use` / `idle` 状态下可显示“退回”动作；`scrapped` 禁止退回
- 异常流：退回成功后刷新状态为 `idle`，若位置文案仍保留则同时展示“已退回 / 当前记录位置”提示
