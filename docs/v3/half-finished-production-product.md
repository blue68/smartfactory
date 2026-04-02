[artifact:PRD]
status: READY
owner: senior-ai-agent-pm
scope:
- 半成品日排产
- 工序级投入产出
- 实际工时与工资核算
- 通配半成品库存回推
inputs:
- 用户最新需求说明
- 现有生产/BOM/库存/工资模块代码与设计
handoff_to:
- tech-lead-architect
- engineering-manager

goal:
- 在不改变“销售订单按成品 SKU 生成生产工单”主模型的前提下，补齐半成品执行层与库存回流能力

deliverables:
- 成品工单可下钻为半成品作业单与日任务
- 每个任务可记录工序级投入、产出、工时、工资
- 通配半成品在工单释放时解析并冻结
- 库存可按成品/半成品/原材料输出最新口径

background:
- 现有系统已支持成品工单、排产计划、生产任务、原材料缺料、成品入库。
- 现有缺口在于：BOM 展开后半成品节点丢失；排产对象仍是整张工单每道工序；工资表与报工表口径未闭环；通配半成品没有冻结解析结果。

in_scope:
- 工单释放时冻结成品/半成品/原材料结构
- 工序级投入产出建模
- 基于半成品作业单的日排产与任务下发
- 任务完工时记录实际工时、计件/计时工资、实际损耗
- 通配半成品解析、冻结、库存统计
- 当前库存与日结库存两套口径

out_of_scope:
- 采购建议改造
- 复杂 APS 优化算法
- 视觉重设计
- 跨工厂、多工厂协同排产

constraints:
- 保留 `production_orders` 为成品交付对象
- 保留现有 `inventory` / `inventory_transactions` 为库存权威账
- 新能力须可分阶段上线，不能要求一次性替换全部生产链路

acceptance_criteria:
- AC-01：销售订单转工单后，工单详情可看到完整的成品/半成品/原材料结构快照
- AC-02：同一成品工单可拆出多个半成品作业单，且每个作业单可排到具体日期、工人、工序
- AC-03：任务级可记录计划投入、实际投入、计划产出、实际产出、损耗、实际工时
- AC-04：工资核算可从任务完工自动生成，不再依赖手工对照工价表
- AC-05：通配半成品在工单释放时解析为具体 SKU，并在后续排产/报工/库存中保持不变
- AC-06：系统可输出当前最新库存；若查询按日口径，可输出指定日期的日结库存

non_functional_requirements:
- 生产任务写入与库存写入必须同事务或最终一致可追溯
- 通配解析必须可审计，能看到规则来源与解析结果
- 排产与报工需支持分页与批量处理，不允许依赖单条人工操作完成整日任务

risks:
- 半成品库存若直接混用全局库存，可能与订单内在制品冲突
- 工资规则若同时支持计件和计时，需要明确结算优先级
- 通配解析若不冻结，会导致库存口径漂移

handoff_to:
- tech-lead-architect
- engineering-manager
exit_criteria:
- 范围、边界、验收标准明确

[artifact:UserStory]
status: READY
owner: senior-ai-agent-pm
scope:
- 生产主管、车间班组长、工人、财务/HR、库存管理角色的关键故事
inputs:
- [artifact:PRD]
handoff_to:
- tech-lead-architect
- engineering-manager

deliverables:
- 核心用户故事与验收条件

stories:
- US-01
  角色：生产主管
  场景：我需要把一张成品工单拆成多个半成品作业单并排到具体日期和工人
  价值：这样我才能知道某天某人应做多少个半成品，而不是只看到整单总量
  验收：排产结果必须显示成品工单、半成品 SKU、工序、日期、工人、计划数量
- US-02
  角色：班组长
  场景：我需要知道某个任务依赖哪些上道半成品和原材料，当前是否已满足开工条件
  价值：这样我才能控制开工节奏，避免前序未完成就盲目开工
  验收：任务详情必须展示前置依赖、计划投入、当前可用投入、阻塞原因
- US-03
  角色：工人
  场景：我在完工时需要填报实际产出、实际耗料、损耗和实际工时
  价值：这样系统才能形成真实产量、真实成本和工资依据
  验收：完工提交后，系统自动生成报工与库存流水，并保留追溯记录
- US-04
  角色：财务/HR
  场景：我需要按工人、工序、半成品、日期查询工资构成
  价值：这样我能核对计件/计时工资来源，而不是依赖人工统计
  验收：工资报表能展示任务来源、工时、产量、工价、工资金额
- US-05
  角色：库存管理员
  场景：我需要看到成品、半成品、原材料的当前库存和日结库存
  价值：这样我能判断当天在制与库存是否一致
  验收：库存查询支持当前口径与日结口径，且能回溯到任务/流水
- US-06
  角色：生产主管
  场景：当成品底层半成品是通配关系时，我需要在工单下发前确认系统已解析成具体半成品 SKU
  价值：这样排产、领料、报工、库存都基于同一具体对象
  验收：工单详情能看到通配规则、解析结果、解析时间、解析人/来源规则

risks:
- 若用户故事未约束“冻结解析”，后续库存统计会反复变动

handoff_to:
- tech-lead-architect
- engineering-manager
exit_criteria:
- 关键角色与场景齐备

[artifact:Prototype]
status: READY
owner: senior-ai-agent-pm
scope:
- 文字化页面结构、接口流、状态流
inputs:
- [artifact:PRD]
- [artifact:UserStory]
handoff_to:
- senior-ui-designer
- tech-lead-architect
- engineering-manager

deliverables:
- 信息结构
- 页面流
- 状态流

information_structure:
- 成品工单详情
  内容：成品信息、交期、工艺快照、结构快照、通配解析结果、半成品作业单列表、原材料需求、库存状态
- 半成品作业看板
  内容：日期、工人、工序、半成品 SKU、计划数量、前置依赖状态、阻塞原因
- 任务执行页
  内容：任务基本信息、计划投入、实际投入、计划产出、实际产出、损耗、实际工时、工资预估
- 库存视图
  内容：当前库存、日结库存、成品/半成品/原材料分组、关联任务/流水追溯
- 工资报表
  内容：日期、工人、工序、半成品、任务号、产量、工时、工价、工资金额

page_flow:
- 销售订单确认
  -> 成品工单创建
  -> BOM/通配解析冻结
  -> 生成半成品作业单
  -> 日排产
  -> 任务下发
  -> 任务报工
  -> 库存与工资回写

state_flow:
- 工单状态
  pending -> released -> scheduled -> in_progress -> completed
- 作业单状态
  pending -> ready -> scheduled -> in_progress -> completed -> closed
- 任务状态
  blocked -> pending -> started -> completed -> exception -> resolved
- 通配解析状态
  unresolved -> resolved -> frozen
- 库存口径状态
  realtime_current
  daily_snapshot_closed

blocking_states:
- 通配未唯一解析：禁止工单 released
- 前置半成品不足：任务 blocked
- 工序投入未记录完：任务不可完成
- 工资规则缺失：报工可完成，但工资报表标记待核算

non_goals:
- 不定义视觉规范
- 不定义采购联动界面

risks:
- 若任务状态不引入 blocked，前置依赖只能靠人工解释

handoff_to:
- senior-ui-designer
- tech-lead-architect
- engineering-manager
exit_criteria:
- 页面流、状态流、阻塞点明确
