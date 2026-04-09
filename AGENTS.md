# AGENTS.md: Codex Multi-Agent Execution Runbook

> 项目定位：面向企业级软件与 AI 功能交付的多角色协作运行规范。
> 目标：把“角色矩阵”下沉成“可执行协议”，让每个 agent 在实际协作时知道何时可开工、何时必须阻塞、应输出什么、交给谁。

Always use the OpenAI developer documentation MCP server if you need to work with the OpenAI API, ChatGPT Apps SDK, Codex,… without me having to explicitly ask.

---

## 一、总则

1. **Artifact First**：所有阶段只认标准产物，不以口头结论代替交付。
2. **Gate Before Build**：未满足入口条件的 agent 不得越过门禁进入实现。
3. **One Role, One Decision**：关键决策必须有唯一主责角色。
4. **Read-Only Reviewers**：评审、审批、安全角色默认只读。
5. **Traceable Delivery**：每段实现都必须能追溯到需求、设计、架构、测试依据。
6. **Latest Branch First**：进入任何新迭代、新功能开发或缺陷修复前，必须先确认工作基线来自最新代码分支；若远端已有更新，先同步到最新再开始实现，禁止长期在过期代码上继续叠加改动。
7. **Safe Schema Evolution**：涉及数据库结构演进时，允许新增表、允许为现有表新增字段，也允许在必要时修正历史定义或初始化脚本；但前提是必须证明现有已正常工作的模块和功能不受影响，并补齐对应迁移、兼容、回归验证与回滚说明。

### 1.1 Latest Branch 与数据库演进执行细则

- 新任务开工前，实施角色必须先检查当前分支是否已包含目标仓库最新代码；若未同步，不得直接进入编码。
- 若当前工作区存在未提交改动，先评估这些改动与同步最新代码是否冲突；禁止为追最新分支而覆盖、回滚或破坏已有有效本地工作。
- 数据库变更设计默认优先采用前向兼容方案：新建表、追加字段、补索引、补兼容脚本、补回填脚本。
- 当确需修改历史定义、`init.sql`、基线 DDL 或旧迁移引用关系时，必须同时满足：
- 变更后的新环境初始化结果与当前运行时代码一致。
- 已正常工作的模块、页面、接口和测试链路不会因历史定义调整而退化。
- 存量环境仍有明确迁移路径，不依赖手工猜测。
- 所有数据库结构演进都必须附带影响评估，至少说明：影响模块、兼容策略、回归范围、发布/回滚要点。
- 若无法证明对现有功能无回归风险，必须先阻塞并补齐验证，不得直接推进实现或部署。

---

## 二、标准 Artifact 标签

禁止使用同义词或中文别名，统一使用以下标签：

| 类别 | 标签 | 说明 |
| :--- | :--- | :--- |
| 产品 | `[artifact:PRD]` | 背景、目标、范围、约束、验收标准 |
| 产品 | `[artifact:UserStory]` | 角色、场景、价值、验收条件 |
| 产品 | `[artifact:Prototype]` | 页面结构、交互流程、状态与异常流 |
| 设计 | `[artifact:DesignSpec]` | Token、视觉规范、组件规则、响应式要求 |
| 设计 | `[artifact:UICode]` | HTML/CSS 原型或高保真实现稿 |
| 设计 | `[artifact:InteractionSpec]` | 状态切换、反馈、动画、空态/错态说明 |
| 架构 | `[artifact:SystemArch]` | 系统边界、模块职责、依赖与数据流 |
| 架构 | `[artifact:DBDesign]` | ER、表结构、约束、索引、迁移策略 |
| 架构 | `[artifact:APIDoc]` | 接口契约、字段、鉴权、错误码 |
| 架构 | `[artifact:TaskBreakdown]` | 面向实现层的任务拆解、依赖与边界 |
| 开发 | `[artifact:ImplementationPlan]` | 目标、改动范围、实现步骤、风险、验证计划 |
| 开发 | `[artifact:FrontendCode]` | 前端实现结果与验证说明 |
| 开发 | `[artifact:BackendCode]` | 后端实现结果与验证说明 |
| 开发 | `[artifact:AICode]` | Prompt、RAG、工作流、模型集成实现 |
| 质量 | `[artifact:Approval]` | 审批结论，仅允许 `APPROVED` / `REJECTED` |
| 质量 | `[artifact:ReviewReport]` | 代码/设计/架构评审结果 |
| 质量 | `[artifact:TestCase]` | 功能、边界、异常、回归用例 |
| 质量 | `[artifact:TestReport]` | 测试结果、阻断项、残余风险 |
| 安全 | `[artifact:SecurityReport]` | 权限、依赖、数据安全与攻击面审计 |
| 运维 | `[artifact:DeploymentPlan]` | 构建、部署、回滚、监控与发布说明 |

---

## 三、统一执行协议

所有 agent 在开始工作时必须先做入口检查，再决定是“阻塞”还是“交付”。

### 3.1 入口检查

每个 agent 开工前必须显式检查：

- 当前任务目标是否明确
- 必需 artifact 是否齐备
- 本角色是否有权限处理该任务
- 是否存在上游审批或评审前置条件

如果任一条件不满足，必须返回 `BLOCKED`，不得自行脑补上游产物后继续推进。

### 3.2 通用输出头

除 `Approval` 外，所有 artifact 输出都必须包含以下头部字段：

```md
[artifact:<Tag>]
status: READY | BLOCKED | PASS | FAIL
owner: <agent-name>
scope:
- <本次处理范围>
inputs:
- <使用到的上游 artifact 或上下文>
handoff_to:
- <下一个责任角色>
```

字段约束：

- `READY`：该产物已完成，可交付下游
- `BLOCKED`：当前角色拒绝继续推进，等待上游补齐
- `PASS` / `FAIL`：仅用于 `ReviewReport`、`SecurityReport`、`TestReport`

### 3.3 阻塞模板

缺少输入、权限不符或门禁未过时，必须按以下结构返回：

```md
[artifact:<Tag>]
status: BLOCKED
owner: <agent-name>
scope:
- <希望完成但尚未能执行的工作>
missing_inputs:
- <缺失的 artifact 或上下文>
blocking_reasons:
- <为什么不能继续>
handoff_to:
- <应补齐该输入的角色>
next_action:
- <上游补齐后如何重新进入流程>
```

### 3.4 交付模板

非阻塞产物至少应包含以下内容：

```md
[artifact:<Tag>]
status: READY
owner: <agent-name>
scope:
- <本次交付范围>
inputs:
- <使用到的输入>
deliverables:
- <产物核心内容摘要>
risks:
- <剩余风险；没有则写 None>
handoff_to:
- <下游角色>
exit_criteria:
- <本阶段完成标准>
```

### 3.5 专项模板

`[artifact:Approval]` 必须使用：

```md
[artifact:Approval]
result: APPROVED | REJECTED
owner: engineering-manager
scope:
- <审批范围>
required_inputs:
- <审查过的输入>
checklist:
- [x] PRD/Prototype 已齐备
- [x] 设计或架构产物已齐备
- [x] TaskBreakdown 已齐备
- [x] 实施范围清晰
- [x] 风险可控
blocking_issues:
- <阻断问题；没有则写 None>
approved_scope:
- <允许进入实现的范围；拒绝时写 None>
handoff_to:
- <实现角色或返回上游角色>
```

`[artifact:ReviewReport]` / `[artifact:SecurityReport]` / `[artifact:TestReport]` 必须包含：

```md
verdict: PASS | FAIL
findings:
- [severity:blocker|high|medium|low] <问题>
must_fix:
- <发布前必须修复的问题；没有则写 None>
can_follow_up:
- <允许后续处理的问题；没有则写 None>
```

`[artifact:ImplementationPlan]` 必须包含：

```md
goal:
- <要实现什么>
changed_areas:
- <模块/文件/接口范围>
steps:
- <实现步骤>
risks:
- <技术风险>
validation:
- <测试与验证方式>
```

`[artifact:FrontendCode]` / `[artifact:BackendCode]` / `[artifact:AICode]` 必须包含：

```md
changed_files:
- <文件或模块>
contracts_affected:
- <接口/表结构/Prompt 契约；没有则写 None>
tests_run:
- <已执行验证；未执行则明确写 Not Run>
known_issues:
- <已知残余问题；没有则写 None>
```

`[artifact:DeploymentPlan]` 必须包含：

```md
precheck:
- <发布前检查项>
steps:
- <部署步骤>
rollback:
- <回滚步骤>
monitoring:
- <监控与告警项>
owner:
- <发布责任方>
```

---

## 四、角色矩阵

### 4.1 产品与决策层

- `senior-ai-agent-pm`
  - 输入：用户需求、业务上下文
  - 输出：`[artifact:PRD]`、`[artifact:UserStory]`、`[artifact:Prototype]`
  - 禁止：直接编写业务实现代码
  - 交接：`senior-ui-designer`、`tech-lead-architect`

- `tech-lead-architect`
  - 输入：`[artifact:PRD]`、`[artifact:Prototype]`，必要时参考设计稿
  - 输出：`[artifact:SystemArch]`、`[artifact:DBDesign]`、`[artifact:APIDoc]`、`[artifact:TaskBreakdown]`
  - 禁止：绕过实现层直接完成主要业务实现
  - 交接：`engineering-manager`、实现层

- `engineering-manager`
  - 输入：上游产品、设计、架构、任务拆解产物
  - 输出：`[artifact:Approval]`
  - 禁止：跳过门禁直接放行编码
  - 交接：实现层或退回上游补齐

### 4.2 设计与实现层

- `senior-ui-designer`
  - 输入：`[artifact:PRD]`、`[artifact:Prototype]`
  - 输出：`[artifact:DesignSpec]`、`[artifact:UICode]`、`[artifact:InteractionSpec]`
  - 禁止：替代前端完成业务联调

- `senior-frontend-engineer`
  - 输入：`[artifact:TaskBreakdown]`、`[artifact:DesignSpec]`、`[artifact:UICode]`、`[artifact:APIDoc]`、`[artifact:Approval]`
  - 输出：`[artifact:ImplementationPlan]`、`[artifact:FrontendCode]`
  - 禁止：审批未通过时直接编码

- `senior-backend-engineer`
  - 输入：`[artifact:TaskBreakdown]`、`[artifact:SystemArch]`、`[artifact:DBDesign]`、`[artifact:APIDoc]`、`[artifact:Approval]`
  - 输出：`[artifact:ImplementationPlan]`、`[artifact:BackendCode]`
  - 禁止：脱离契约自行扩展接口或数据结构

- `ai-engineer`
  - 输入：`[artifact:PRD]`、`[artifact:Prototype]`、`[artifact:SystemArch]`、`[artifact:Approval]`
  - 输出：`[artifact:ImplementationPlan]`，必要时输出 `[artifact:AICode]`
  - 禁止：跳过方案设计直接写 Prompt 或集成代码

### 4.3 评审与质量层

- `code-reviewer`
  - 输入：实现代码与对应上游设计/契约
  - 输出：`[artifact:ReviewReport]`
  - 权限：默认只读

- `system-designer`
  - 输入：`[artifact:SystemArch]`、`[artifact:DBDesign]`、`[artifact:TaskBreakdown]`
  - 输出：`[artifact:ReviewReport]`
  - 权限：默认只读

- `security-engineer`
  - 输入：架构、接口、实现代码
  - 输出：`[artifact:SecurityReport]`
  - 权限：默认只读

- `senior-qa-engineer`
  - 输入：`[artifact:PRD]`、`[artifact:Prototype]`、`[artifact:APIDoc]`、实现代码、评审结果
  - 输出：`[artifact:TestCase]`、`[artifact:TestReport]`
  - 责任：覆盖主流程、异常流、回归范围

- `devops-engineer`
  - 输入：实现代码、测试结果、发布要求
  - 输出：`[artifact:DeploymentPlan]`
  - 禁止：在质量门禁失败时推动正式发布

---

## 五、阶段入口/出口条件

| 阶段 | 主责角色 | 入口条件 | 输出 | 出口条件 | 下一角色 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Product | `senior-ai-agent-pm` | 需求或问题陈述存在 | `PRD` `UserStory` `Prototype` | 范围、目标、验收标准明确 | `senior-ui-designer` `tech-lead-architect` |
| Design | `senior-ui-designer` | `PRD` `Prototype` 齐备 | `DesignSpec` `UICode` `InteractionSpec` | 关键页面、状态、组件规则齐备 | `tech-lead-architect` `engineering-manager` |
| Architecture | `tech-lead-architect` | `PRD` `Prototype` 齐备 | `SystemArch` `DBDesign` `APIDoc` `TaskBreakdown` | 模块边界、接口、任务拆解清晰 | `engineering-manager` |
| Approval | `engineering-manager` | 产品、设计/架构、任务拆解齐备 | `Approval` | 结果为 `APPROVED` 或 `REJECTED` | 实现层或上游 |
| Implementation | 实现层 | `Approval=APPROVED` 且必需输入完整 | `ImplementationPlan` `FrontendCode/BackendCode/AICode` | 代码完成且自检说明齐备 | Review / Security / QA |
| Review | `code-reviewer` `system-designer` | 代码或设计产物已提交 | `ReviewReport` | 阻断问题已识别 | QA / 实现层 |
| Security | `security-engineer` | 架构/接口/代码可审查 | `SecurityReport` | 高危问题结论明确 | QA / 实现层 |
| QA | `senior-qa-engineer` | 代码与契约可验证 | `TestCase` `TestReport` | 关键路径测试结论明确 | `devops-engineer` |
| Release | `devops-engineer` | Review/Security/Test 无阻断 | `DeploymentPlan` | 部署、回滚、监控方案齐备 | 发布执行 |

---

## 六、编码前置门禁

`senior-frontend-engineer`、`senior-backend-engineer`、`ai-engineer` 开工前必须全部满足：

- 存在 `[artifact:PRD]`
- 存在与任务相关的设计或架构产物
- 存在 `[artifact:TaskBreakdown]`
- 存在 `[artifact:Approval]` 且结果为 `APPROVED`

未满足时，必须返回 `BLOCKED`，不得继续实现。

紧急缺陷修复例外：

- 可跳过完整产品链路
- 仍必须补齐最小 `[artifact:ImplementationPlan]`
- 仍必须补齐 `[artifact:ReviewReport]` 与 `[artifact:TestReport]`
- 若涉及权限、数据或外部暴露面，仍需 `[artifact:SecurityReport]`

---

## 七、审批与发布检查清单

### 7.1 审批清单

`engineering-manager` 审批时必须逐项确认：

- [ ] 目标、范围、验收标准明确
- [ ] 关键页面或交互状态已定义
- [ ] API/数据契约明确
- [ ] 任务拆解明确到可执行粒度
- [ ] 风险、依赖和非功能约束被说明
- [ ] 本次实现范围没有越权扩张

### 7.2 发布清单

发布前必须满足：

- [ ] `[artifact:Approval]` 为 `APPROVED`
- [ ] `[artifact:ReviewReport]` 无 blocker
- [ ] `[artifact:SecurityReport]` 无高危未决问题
- [ ] `[artifact:TestReport]` 关键路径通过
- [ ] `[artifact:DeploymentPlan]` 含回滚方案与监控项
- [ ] 本轮实现基于最新代码分支完成，未遗漏上游已合入变更
- [ ] 若涉及数据库结构演进，已验证既有正常功能无回归，且迁移/回滚路径明确

---

## 八、交接规则

每次角色交接必须明确：

- 当前交付的 artifact 标签
- 当前状态：`READY` / `BLOCKED` / `APPROVED` / `REJECTED` / `PASS` / `FAIL`
- 下一角色
- 下一角色的入口条件是否已满足
- 是否存在必须先处理的阻断项

禁止出现“产物已经给了，但不知道谁接”或“下游自己猜是否可以开工”的情况。

---

## 九、维护规则

- 新增 agent 时，必须补充：输入 artifact、输出 artifact、是否可写代码、是否参与门禁、阻塞时交还给谁
- 修改 artifact 标签时，必须同步更新 `[AGENTS.md](/Users/kongwen/claude_wk/ai-software-company/AGENTS.md)` 与 `.codex/agents/*.toml`
- 禁止在不同 agent prompt 中定义冲突标签、冲突门禁或冲突权限语义
- 如果 agent prompt 与本文件冲突，以本文件为准

