[artifact:DesignSpec]
status: READY
owner: senior-ui-designer
scope:
- T6 全量前端收口：工单详情、半成品排产、任务执行页、库存追溯
- 桌面与窄屏浏览器自适应
inputs:
- [artifact:PRD]
- [artifact:UserStory]
- [artifact:Prototype]
- [artifact:APIDoc]
- `services/web/src/pages/production/ProductionOrderPage.tsx`
- `services/web/src/pages/production/SchedulePage.tsx`
- `services/web/src/pages/production/TaskPage.tsx`
- `services/web/src/pages/inventory/InventoryPage.tsx`
handoff_to:
- engineering-manager
- senior-frontend-engineer

deliverables:
- 四块页面的统一视觉方向与组件规则
- 响应式布局与层级规范

design_tokens:
- 延续现有生产模块的冷灰蓝底色与卡片体系，但对半成品链路统一增加 `amber / teal / slate` 三色语义
- 数值与单号继续使用等宽数字字体，避免任务号、工单号、数量在不同分辨率下跳动
- 新增区块统一使用 “标题 + 次级解释 + 关键指标 + 明细列表/时间线” 四段式结构，不再堆纯表格
- 抽屉中的重点卡片使用轻微渐变背景，避免与主表区域混成一片

component_rules:
- 工单详情抽屉增加“结构快照”“工序链路”视图，分别展示 components tree 与 operations lane
- 结构快照按 `fg / wip / rm` 分层着色，通配解析后的半成品必须显式显示“基准 SKU -> 实际 SKU”
- 工序链路按 step_no 水平排序；每个节点展示工序、产出 SKU、计划/完成数量、状态、关联任务数
- 排产页三种视图都补充半成品产出标签；站点视图保留甘特表，订单/工人视图改为信息更强的卡片
- 任务详情抽屉改为“执行概览 + 依赖与阻塞 + 投入产出 + 工资与工时 + 异常/追溯”五段结构
- 投入产出区块优先使用成对卡片，不要求用户横向滚动才能理解任务发生了什么
- 库存页在实时库存与日结快照之外增加“任务/流水追溯”抽屉，支持从主表和快照行进入
- 追溯抽屉内同时展示库存流水时间线与关联任务胶囊，不拆成新路由

responsive_rules:
- `>= 1440px`：工单详情与任务详情可使用 2 列信息网格；`< 1440px` 自动收成 1 列
- `>= 1200px`：排产订单卡片可维持 3 列；`768px-1199px` 改为 2 列；`< 768px` 改为单列纵向卡片
- 抽屉内容不得依赖固定宽度表格表达核心信息；关键指标必须在 768px 以下仍以卡片形式直读
- 库存追溯抽屉的流水时间线在窄屏下改为单列，每条记录顶部先给方向和数量，次级信息折到下一行

risks:
- 若仍沿用旧任务页的状态文案，`started / in_progress` 混用会继续误导前端交互
- 若将投入产出全部塞回表格，移动端会重新退化成“看得到接口字段、看不懂任务行为”

handoff_to:
- engineering-manager
- senior-frontend-engineer
exit_criteria:
- 页面层级、字段映射、响应式行为明确

[artifact:UICode]
status: READY
owner: senior-ui-designer
scope:
- 工单详情、排产页、任务页、库存追溯的高保真增量说明
inputs:
- [artifact:DesignSpec]
- 现有生产/库存页面实现
handoff_to:
- senior-frontend-engineer

deliverables:
- 页面增量布局草案

layout_notes:
- 工单详情：
  抽屉头部保留工单状态与整体进度；Tabs 扩为“基本信息 / 结构快照 / 工序链路 / 物料需求 / 工艺快照”
- 工单详情：
  “结构快照”先给 3 个数字胶囊：成品节点数、半成品节点数、原材料节点数；其下展示分层树
- 工单详情：
  “工序链路”顶部给 release 状态说明与已生成任务数，下方使用 step lane 卡片串起工序
- 排产页：
  订单视图卡片头部增加产出 SKU 与风险标签；卡片主体增加“半成品工序数 / 已分配工人 / 已分配工位 / 总工时”
- 排产页：
  工人视图任务卡中加产出 SKU 胶囊与工位状态，保证半成品排产不再只看到工序名
- 任务页：
  抽屉首屏放执行概览卡，展示计划量、完成量、报废量、实际工时、单位工资、预计/实际工资
- 任务页：
  依赖区展示前序工序状态、需求数量、已完成数量、可开工判断与阻塞原因
- 任务页：
  投入/产出区按 Input/Output 两栏布局；每条记录同时带计划、实际、库存流水号、流水时间
- 库存页：
  主表与快照行增加“追溯”入口；打开后右侧抽屉显示最近流水、关联任务、关联工单、方向与备注

risks:
- None
handoff_to:
- senior-frontend-engineer
exit_criteria:
- 前端可直接据此落地，无需补画稿

[artifact:InteractionSpec]
status: READY
owner: senior-ui-designer
scope:
- T6 全量前端交互语义
inputs:
- [artifact:DesignSpec]
- [artifact:UICode]
handoff_to:
- senior-frontend-engineer

deliverables:
- 加载、空态、错误态、筛选与跳转行为

states:
- 工单详情打开时并行拉取基本信息、components、operations；任一子视图失败只影响当前 tab，不影响其他 tab 阅读
- 工序链路无 release 产物时显示“尚未生成半成品作业链，请先 release 工单”
- 任务详情依赖区若前序不足，显示橙色阻塞条与“仍可查看，不建议开工/复盘需先补足”的说明
- 任务投入产出加载中时显示骨架卡片；空态时区分“未开始，尚无实际记录”和“已开始，但未落账本记录”
- 任务完工弹窗继续要求填写实际工时；若工价未配置，只禁用工资预览，不阻塞完工提交
- 库存追溯抽屉默认展示最近 20 条流水；若由日结快照进入，标题必须显式展示“快照日期”与“当前实时流水”
- 追溯抽屉支持按任务号/工单号关键词筛选，但默认不开新请求前先保持当前结果，避免闪烁

feedback_rules:
- 新增视图全部为“读优先”，除现有开始/完工/异常流程外，不增加额外写操作按钮
- 从排产页/工单页跳转到任务页时，通过 query 或提示文本保留来源语义，避免用户丢失上下文
- 所有新增风险/阻塞提示使用业务语义文案，不直接暴露数据库字段名

risks:
- None
handoff_to:
- senior-frontend-engineer
exit_criteria:
- 关键状态与切换语义可直接编码
