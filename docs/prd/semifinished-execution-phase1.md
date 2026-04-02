[artifact:PRD]
status: READY
owner: codex
scope:
- 半成品日排产
- 工序级投入产出
- 实际工时工资
- 通配半成品库存回推
inputs:
- 用户需求说明
- 当前仓库生产、库存、工资、BOM、工序现状
handoff_to:
- tech-lead-architect
- engineering-manager
deliverables:
- 范围、目标、边界、验收标准
risks:
- 现有模型仅能稳定支撑成品工单与原材料缺料
handoff_to:
- tech-lead-architect
exit_criteria:
- 目标、范围、非目标、验收标准明确

## 背景
当前系统已经具备“销售订单 -> 成品 SKU 工单 -> 工序任务 -> 成品入库”的基础链路，但无法稳定表达以下能力：
- 半成品按天按人排产
- 工序级投入与产出记录
- 基于实际工时和工价的工资核算
- 带通配规则的半成品解析与库存回推

## 目标
- G1：保留成品 SKU 工单作为主对象，同时下钻到半成品日作业层
- G2：每个任务可记录计划投入、实际投入、计划产出、实际产出
- G3：任务完工后自动生成工时与工资事实数据
- G4：通配半成品在工单释放时完成唯一解析，并驱动库存统计

## 范围
- 后端数据模型扩展
- 工单释放结构生成
- 工序投入配置
- 任务完工写入工时、工资、库存
- 当前库存与日库存查询口径

## 非目标
- 本阶段不重做销售、采购、结算模块
- 本阶段不做复杂 AI 排产优化
- 本阶段不一次性重构全部前端页面

## 验收标准
- AC1：成品工单可生成半成品/原材料结构树
- AC2：排产结果可表达“某天某人做哪个半成品、哪道工序、多少数量”
- AC3：任务完工后能记录实际工时、投入、产出，并自动生成工资事实
- AC4：通配半成品在工单内有唯一 `resolved_sku_id`
- AC5：系统可按成品、半成品、原材料输出当前最新库存

[artifact:UserStory]
status: READY
owner: codex
scope:
- 核心业务场景与验收条件
inputs:
- 同上
handoff_to:
- tech-lead-architect
- engineering-manager
deliverables:
- 核心角色场景
risks:
- 角色间关注点不同，需统一事实来源
handoff_to:
- tech-lead-architect
exit_criteria:
- 核心场景覆盖生产主管、工人、财务/管理者

## US-01 半成品日排产
As a 生产主管
I want 将成品工单拆解为半成品级作业并排到某天某人
So that 我能知道每天每个人具体要做多少半成品

验收条件：
- 工单释放后可看到半成品作业节点
- 每个作业节点带工序、数量、依赖关系
- 排产结果至少落到日期、工人、半成品、工序四个维度

## US-02 工序级投入产出
As a 工人/班组长
I want 在任务完工时填报本工序实际投入与实际产出
So that 系统能追踪物料消耗与半成品流转

验收条件：
- 任务可查询计划投入与计划产出
- 完工时可提交实际投入、实际产出、损耗
- 系统自动写入库存流水

## US-03 实际工时工资
As a 财务/生产管理者
I want 基于任务完工记录查看工时和工资
So that 工资核算不再依赖手工汇总

验收条件：
- 任务完工时保存实际工时
- 系统自动生成工资事实记录
- 报表可按工人、工序、任务查询工资

## US-04 通配半成品库存回推
As a 生产主管
I want 通配半成品在工单内解析成具体 SKU 并回推库存
So that 排产和库存口径不会漂移

验收条件：
- 工单释放时完成解析并冻结结果
- 排产、报工、库存查询全部只认解析后的具体 SKU
- 解析失败的工单或作业不能开工

[artifact:Prototype]
status: READY
owner: codex
scope:
- 文字化原型与状态流
inputs:
- 同上
handoff_to:
- senior-ui-designer
- tech-lead-architect
deliverables:
- 页面/接口流与状态流
risks:
- 若状态定义不清，会导致任务与库存口径不一致
handoff_to:
- tech-lead-architect
exit_criteria:
- 结构、作业、任务、工资、库存视图清晰

## 信息结构
- 工单详情
- 半成品结构树
- 作业排产视图
- 任务报工视图
- 工资明细视图
- 库存视图

## 核心流程
1. 销售订单生成成品工单
2. 工单释放结构
3. 系统生成半成品结构树、作业节点、通配解析结果
4. 主管按作业节点排产到某天某人
5. 工人执行任务并提交工时、投入、产出
6. 系统更新库存、工资、任务状态
7. 管理者查看工资与库存结果

## 状态流
- 工单：`draft -> ready -> released -> in_progress -> completed`
- 作业：`blocked -> ready -> scheduled -> in_progress -> completed`
- 任务：`blocked -> pending -> started -> completed`
- 通配解析：`pending -> resolved | ambiguous | failed`

## 关键界面要素
- 工单详情显示：
  - 成品信息
  - 半成品结构树
  - 通配解析结果
  - 作业列表
- 排产视图显示：
  - 日期
  - 工人
  - 半成品 SKU
  - 工序
  - 数量
  - 依赖就绪量
- 任务报工视图显示：
  - 计划投入/实际投入
  - 计划产出/实际产出
  - 实际工时
  - 损耗
- 工资视图显示：
  - 工人
  - 工序
  - 完工数量
  - 实际工时
  - 单价/时薪
  - 工资金额
