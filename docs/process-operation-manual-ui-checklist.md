[artifact:FrontendCode]
status: READY
owner: senior-frontend-engineer
scope:
- 工序作业说明书能力落地后的界面交互清单
- 工序配置页与生产任务页的新增展示项说明
inputs:
- [process-operation-manual-field-mapping.md](/Users/kongwen/claude_wk/ai-software-company/docs/process-operation-manual-field-mapping.md:1)
- [ProcessConfigPage.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/master-data/ProcessConfigPage.tsx:1)
- [TaskPage.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/production/TaskPage.tsx:1)
deliverables:
- 页面入口
- 区块变化
- 字段变化
- 用户可执行动作
risks:
- 当前清单基于已落地代码整理，尚未配套自动截图文档
handoff_to:
- senior-ai-agent-pm
- senior-qa-engineer
exit_criteria:
- 能让业务和测试同事按页面逐项核对这次交互增强

changed_files:
- [ProcessConfigPage.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/master-data/ProcessConfigPage.tsx:1)
- [ProcessConfigPage.module.css](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/master-data/ProcessConfigPage.module.css:1)
- [TaskPage.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/production/TaskPage.tsx:1)
- [processConfig.ts](/Users/kongwen/claude_wk/ai-software-company/services/web/src/api/processConfig.ts:1)
- [models.ts](/Users/kongwen/claude_wk/ai-software-company/services/web/src/types/models.ts:1)
contracts_affected:
- 工序步骤投料接口新增 `specText` / `processParamsJson` / `isKeyMaterial`
- 生产任务输入项接口新增 `specText` / `processParams`
tests_run:
- `services/web` `npm run build`
known_issues:
- 当前没有配套的“作业说明书导入完成态 UI”，数据仍需通过脚本或配置页维护

## 1. 页面入口

### 1.1 工序配置
- 路由：`/master-data/process-config`
- 用途：维护工序模板、步骤顺序、工时、附件、步骤投料和工艺参数

### 1.2 生产任务
- 路由：`/production/tasks`
- 用途：查看任务详情、输入项、输出项、工艺说明和现场执行所需参数

---

## 2. 工序配置页变化

### 2.1 进入方式
1. 打开 `主数据 -> 工序配置`
2. 从左侧选择一个模板
3. 点击右侧流程图中的任一步骤节点
4. 右侧弹出“编辑工序”抽屉

### 2.2 抽屉现有结构
当前抽屉顺序为：
1. `基本信息`
2. `工时设置`
3. `操作说明`
4. `步骤投料与工艺参数`  ← 本次新增
5. `计件单价`

### 2.3 新增区块：步骤投料与工艺参数
每个步骤下，如果已经配置了投料，会显示多张“物料卡片”。

每张卡片展示：
- 物料名称
- SKU 编码
- 若为关键物料，会显示 `关键物料` 标记

每张卡片可编辑字段：
- `单件净用量`
- `损耗率`
- `消耗时点`
  - `开工时锁料`
  - `完工时扣料`
- `物料角色`
  - `普通物料`
  - `关键物料`
- `规格说明`
- `工艺参数(JSON)`

### 2.4 工艺参数(JSON) 用途
用于承载原作业说明书里不适合塞进 SKU 主数据的参数，例如：
- 门幅
- 面积平方毫米
- 裁片宽 / 裁片高
- 材料属性
- 公式或特殊工艺备注

### 2.5 保存行为
- 抽屉里修改字段后，点击底部 `完成`
- 页面整体点击 `保存模板` 时：
  - 步骤信息保存
  - 步骤工时保存
  - 计件单价保存
  - 步骤投料与工艺参数一起保存

### 2.6 校验行为
- `工艺参数(JSON)` 为空：允许保存
- JSON 格式错误：不允许保存，并提示：
  - `步骤 X 的投料参数 JSON 格式无效，请修正后再保存`

### 2.7 这页新增后的价值
- 工序配置不再只是“步骤名字 + 工时 + 附件”
- 现在已经可以承接：
  - 作业说明书里的材料清单
  - 用量
  - 损耗
  - 规格尺寸
  - 工艺参数

---

## 3. 生产任务页变化

### 3.1 进入方式
1. 打开 `生产管理 -> 生产任务`
2. 点击任意任务行
3. 右侧打开任务详情抽屉

### 3.2 现有区块不变
任务详情仍保留原有区块，例如：
- 基本信息
- 工艺说明
- 异常记录
- 任务输入 / 输出清单

本次没有改主流程按钮和任务状态流转。

### 3.3 输入项卡片新增展示
在 `任务输入 / 输出清单 -> 输入项` 中，原本就会显示：
- SKU
- 来源工序
- 需求数量
- 已投 / 已齐套
- 可用数量
- 仓库/库位
- 缺口状态

现在当工序投料里维护了数据时，会额外显示：
- `规格参数 xxx`
- `工艺参数 xxx`

示例表现：
- `规格参数 1930mm x 195mm x 12mm`
- `工艺参数 门幅: 1450 · 面积平方毫米: 234360 · 裁片宽: 930 · 裁片高: 252`

### 3.4 现场执行价值
这意味着工人/主管在任务页里，不需要回 Excel 也能看到：
- 当前步骤要用什么料
- 用多少
- 具体规格是什么
- 有哪些附加工艺参数

---

## 4. 工单 / 排产 / 任务链路中的体现方式

### 4.1 工单
- 工单创建时，会冻结当前模板的：
  - 步骤
  - 作业说明
  - 附件
  - 步骤投料
  - 规格说明
  - 工艺参数

### 4.2 排产
- 排产主逻辑不改
- 仍按：
  - 工序
  - 工作站类型
  - 标准工时
进行排产

### 4.3 生产任务
- 从工单快照里拿到步骤投料和参数
- 在任务详情中展示给执行人

所以这次的总体设计是：
- `工序配置` 负责维护
- `工单` 负责冻结
- `排产` 继续按原逻辑调度
- `任务` 负责把工艺细节展示出来

---

## 5. 当前适合你重点核对的点

建议在本地先重点看这几项：

### 5.1 工序配置页
- 打开任一模板的步骤抽屉
- 确认能看到 `步骤投料与工艺参数`
- 确认每张投料卡片能编辑：
  - 净用量
  - 损耗
  - 关键物料
  - 规格说明
  - JSON 参数

### 5.2 生产任务页
- 打开任一已有输入项的任务详情
- 确认输入项下会显示：
  - `规格参数`
  - `工艺参数`

### 5.3 数据冻结口径
- 修改模板后，再创建新工单
- 新工单应该吃到最新步骤参数
- 已创建的旧工单不应被新模板直接篡改

---

## 6. 当前还没做到的部分

这次还没有落地：
- 从“作业说明书 Excel”一键导入到工序模板的正式 UI 入口
- 任务页中把工艺参数做成更漂亮的结构化表格展示
- 工序配置页中新增/删除步骤投料行的完整交互

当前已具备的是：
- 数据结构
- 维护入口
- 快照冻结
- 任务展示

这足够支撑第一阶段把作业说明书内容真正落进系统。  
