[artifact:DesignSpec]
status: READY
owner: senior-ui-designer
scope:
- 半成品生产只读前端最小切片
- 工资报表页任务报工视图
- 库存页日结库存回查视图
inputs:
- [artifact:PRD]
- [artifact:Prototype]
- [artifact:APIDoc]
- `services/web/src/pages/report/WageReportPage.tsx`
- `services/web/src/pages/inventory/InventoryPage.tsx`
handoff_to:
- engineering-manager
- senior-frontend-engineer

deliverables:
- 只读增量接线设计，不改页面骨架
- 字段映射与布局规则

design_tokens:
- 延续现有页面 token：`--bg-card` `--border-default` `--text-primary` `--text-secondary`
- 不新增全局主题变量，不引入新字体或新视觉体系
- 新增区块继续使用卡片 + 表格/摘要条样式，保持与现有报表页、库存页一致

component_rules:
- 工资页新增“任务报工”子视图，位置在现有“日工资明细”tab 内，不新增站点级路由
- 任务报工视图使用只读表格，列为：报工日期、工单号、任务号、工人、工序、完成数、合格数、不良数、工时、单价、小计
- 库存页新增“日结库存”卡片，放在 Summary Bar 下方、筛选栏上方，展示当前查询日期的快照摘要与最近几条快照
- 日结库存区块只读，不提供修复、回写、对账按钮

responsive_rules:
- 工资页任务报工表格允许横向滚动，不压缩列含义
- 库存页日结库存卡片在窄屏下改为纵向堆叠，摘要项可换行
- 不改现有移动端交互语义

risks:
- 现有工资页使用大量内联样式，新增子视图需避免形成第二套视觉语言
- 库存页当前 Summary Bar 含 mock 汇总文案，新增日结卡片需明确“快照口径”避免与实时库存混淆

handoff_to:
- engineering-manager
- senior-frontend-engineer
exit_criteria:
- 字段、位置、响应式与只读边界明确

[artifact:UICode]
status: READY
owner: senior-ui-designer
scope:
- 工资页与库存页的只读 UI 增量原型说明
inputs:
- [artifact:DesignSpec]
- `services/web/src/pages/report/WageReportPage.tsx`
- `services/web/src/pages/inventory/InventoryPage.tsx`
handoff_to:
- senior-frontend-engineer

deliverables:
- 高保真页面增量草案说明

layout_notes:
- 工资页：
  在“日工资明细”筛选栏右侧保留原有表格/图表切换，新增一组二级切换“工资汇总 / 任务报工”
- 工资页：
  当选择“任务报工”时，图表视图隐藏，只保留表格；表格顶部增加一句浅色说明“任务报工口径来自已确认报工记录”
- 库存页：
  Summary Bar 下新增“日结库存快照”卡片，左侧显示日期与总条数，右侧显示 5 条以内快照行
- 库存页：
  快照行字段为 SKU、在库、预留、可用；超出 5 条时底部显示“更多记录见下方筛选结果”

risks:
- None
handoff_to:
- senior-frontend-engineer
exit_criteria:
- 前端可据此直接实现，无需再猜测区块位置

[artifact:InteractionSpec]
status: READY
owner: senior-ui-designer
scope:
- 只读前端最小切片的状态切换与空态说明
inputs:
- [artifact:DesignSpec]
- [artifact:UICode]
handoff_to:
- senior-frontend-engineer

deliverables:
- 交互状态定义

states:
- 工资页默认进入“日工资明细 > 工资汇总”
- 点击“任务报工”后，仅切换数据源与表头，不刷新页面其他筛选状态
- 任务报工加载中：表格区域显示“加载中…”
- 任务报工空态：显示“暂无任务报工记录”
- 库存页日结卡片加载中：显示“正在加载日结快照…”
- 库存页日结卡片空态：显示“当前日期暂无日结快照”
- 库存页日结卡片错误态：显示“日结快照加载失败”，但不影响实时库存主表

feedback_rules:
- 所有新增区块只读，无提交按钮，无 toast 成功提示
- 若快照日期与实时库存查询日期不同，卡片标题必须显式展示快照日期

risks:
- None
handoff_to:
- senior-frontend-engineer
exit_criteria:
- 加载、空态、错误态和切换语义清晰
