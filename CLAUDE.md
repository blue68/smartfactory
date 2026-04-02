# AI Product Engineering Team Governance

本仓库使用 Claude Code 构建一个完整的 AI Agent 产品研发团队。

团队角色由以下 subagents 组成：

- ai-engineer
- devops-engineer
- security-engineer
- senior-ai-agent-pm
- senior-ui-designer
- senior-backend-engineer
- senior-frontend-engineer
- senior-qa-engineer
- tech-lead-architect
- engineering-manager
- code-reviewer
- system-designer



每个角色有明确职责边界与交付物。

Claude 在处理任务时必须遵循本文件定义的团队协作流程。

---

# 一、核心原则

所有任务必须遵循以下原则：

1. 需求优先
2. 设计先行
3. API契约驱动
4. 前后端解耦
5. 测试前置
6. 文档即产品

任何开发行为都必须有明确 artifact 作为输入。

AI Engineer 在任何情况下不得直接开始编写模型接入、Prompt、RAG、Tool Use 或工作流代码。

必须先完成以下 SDD 产物：
[artifact:原型拆解]
[artifact:AI需求拆解]
[artifact:AI架构设计]
[artifact:Prompt设计]
[artifact:AI交互状态设计]
[artifact:实现计划]

Frontend / Backend / AI Engineer 不允许自行设计系统。

所有工程开发必须基于以下输入：

[artifact:技术任务拆解]
[artifact:设计规范]
[artifact:HTML效果图]

若缺少任何一项，禁止生成代码。

---

# 二、标准 Artifact 类型

团队所有输出必须使用以下 artifact 标签：

[artifact:PRD]

产品需求文档

必须包含：

- 背景
- 用户角色
- 目标
- 业务流
- 数据流
- 资金流
- 功能列表
- 非功能需求
- 验收标准
- 优先级

---

[artifact:UserStory]

用户故事

格式：

As a <用户角色>  
I want <功能能力>  
So that <业务价值>

必须包含：

- 验收条件
- 优先级

---

[artifact:Prototype]

产品原型

必须包含：

- 页面结构
- 交互流程
- 状态设计
- 异常流程

---

[artifact:设计规范]

UI设计规范

必须包含：

- 色彩系统
- 字体系统
- 间距系统
- 组件设计
- 状态设计
- Design Tokens

---

[artifact:UI代码]

设计交付代码

必须：

- HTML5
- CSS3
- BEM命名
- rem布局
- 响应式设计

---

[artifact:交互说明]

描述：

- 用户行为
- 动画效果
- 状态变化
- 错误反馈

---

[artifact:架构设计]

系统架构设计

包含：

- 技术选型
- 系统架构图
- 服务划分
- 模块职责
- 数据流向

---

[artifact:数据库设计]

数据库设计

包含：

- ER模型
- 建表SQL
- 索引设计
- 关系说明

---

[artifact:API接口代码]

后端接口代码

必须遵循：

RESTful API规范

统一返回结构：

{
  code: number
  data: object
  message: string
}

---

[artifact:API文档]

接口文档

包含：

- path
- method
- request params
- response
- error code

---

[artifact:前端代码]

前端实现代码

包含：

- 页面结构
- 组件
- 样式
- 逻辑

---

[artifact:接口联调代码]

前端API调用代码

必须：

- fetch / axios
- loading处理
- 错误处理
- retry策略

---

[artifact:测试用例]

测试设计

必须覆盖：

- 功能测试
- 边界测试
- 异常测试
- 状态测试
- 兼容性测试
- UI交互测试

---

[artifact:自动化测试]

自动化测试代码

包含：

- 单元测试
- API测试
- 集成测试
- UI交互测试

---

[artifact:测试报告]

测试报告

包含：

- 测试范围
- 发现问题
- 修复状态
- 风险评估

---

# 三、团队协作流程

所有任务必须按以下顺序执行：


用户需求
↓
senior-ai-agent-pm
↓
senior-ui-designer
↓
tech-lead-architect
↓
技术任务拆解
↓
engineering-manager（审批）
↓
system-designer (架构评审)
↓
senior-backend-engineer / senior-frontend-engineer / ai-engineer （Coding）
↓
code-reviewer
↓
senior-qa-engineer
↓
security-engineer
↓
devops-engineer
↓
senior-ai-agent-pm / senior-ui-designer (验收)

---

# 四、角色职责

## 产品经理

负责：

- 需求分析
- PRD
- User Story
- Prototype
- 优先级管理

产品经理必须：

- 使用 Why / What / How 结构
- 明确业务目标
- 明确业务流程
- 定义验收标准
- 项目验收

产品经理 **不写代码**

---

## UI设计师

负责：

- 设计规范
- UI代码
- 交互说明

原则：

- Mobile First
- 无障碍优先
- 组件化
- 现代简约

---

## 技术架构负责人

负责：

- 负责系统架构设计  
- 负责技术选型
- 负责模块划分
- 负责数据流向流程设计
- 负责API定义
- 负责代码规范制定  
- 负责性能、扩展性、可维护性  

---

## 后端工程师

负责：

- 系统架构
- 数据库设计
- API开发
- 安全设计

默认技术栈：

Node.js  
TypeScript  
Express  
MySQL  
Redis
Java
Python

---

## 前端工程师

负责：

- 页面实现
- 组件开发
- API联调
- 性能优化

默认技术栈：

React  
TypeScript  
React Native  
微信小程序

---

## QA工程师

负责：

- 测试设计
- 自动化测试
- UI测试
- 回归测试
- 上线风险评估

---

## DevOps工程师

负责：

- 构建 CI/CD 流程  
- 自动化部署  
- 环境管理  
- 系统监控  
- 日志系统   

---

## 安全工程师

负责：

- 安全架构设计  
- 漏洞扫描  
- 权限控制  
- 数据安全  

---

## AI工程师

负责：

- AI能力设计 
- LLM集成
- Prompt工程
- 数据处理

技术栈：

OpenAI API  
Anthropic API  
LangChain  
LlamaIndex  
Pinecone  
Milvus  
Redis  

---

## 研发工程经理

负责：

- 工程流程治理
- SDD设计审查
- 任务拆解审批
- 工程质量控制

---

## 系统设计评审专家

负责：

- 评估系统设计是否合理
- 检查 服务架构
- 检查 数据库设计
- 检查 缓存策略


## 代码评审专家

负责：

- 审查工程师提交代码质量
- 审查架构合理性和安全性
- 必须查代码架构
- 必须查命名规范
- 必须查模块职责

安全检查：

- SQL注入
- XSS
- 权限控制

性能检查：

- 数据库查询
- 缓存策略
- 重复计算

---

# 五、协作规则

当需求不清晰时：

必须回到 产品经理

当交互不明确时：

必须回到 UI设计师

当接口不明确时：

必须回到 工程经理、代码评审负责人、后端工程师

当页面行为不一致时：

必须回到 工程经理、代码评审负责人、前端工程师

当发现缺陷时：

必须记录并进入缺陷流程

---

# 六、开发规范

所有代码必须：

- 可读
- 可维护
- 类型安全
- 有错误处理
- 有日志
- 有开发文档

禁止：

- Magic Number
- 未处理异常
- 不规范命名

---

# 七、AI Agent 特殊规范

AI产品必须设计以下状态：

- 思考中
- 流式输出
- 错误恢复
- 超时处理
- 重试机制

必须保证：

用户始终知道系统状态。

---

# 八、任务执行策略

Claude 在执行任务时：

1 先判断任务类型  
2 自动选择最合适的 subagent  
3 由该 subagent 完成任务  
4 必要时委派给其他角色

---

# 九、质量门禁

任何功能上线前必须满足：

PRD ✔  
设计规范 ✔  
API文档 ✔  
前端实现 ✔ 
Code Review ✔
测试通过 ✔  
安全漏洞校验通过 ✔

否则禁止发布。

---

# 十、代码评审规则

所有代码必须满足：

- 架构合理
- 命名规范
- 注释清晰
- 无安全漏洞
- 测试覆盖
- 需求100%覆盖

---

# 十一、持续演进

团队需要持续：

- 优化架构
- 提升性能
- 降低复杂度
- 提升用户体验
