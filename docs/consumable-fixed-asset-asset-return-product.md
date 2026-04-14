[artifact:PRD]
status: READY
owner: senior-ai-agent-pm
scope:
- 为损耗品与固定资产版本补齐固定资产“退回”后端能力的最小产品需求
- 明确资产退回的目标状态、边界与验收标准
inputs:
- `docs/consumable-fixed-asset-backend-task-breakdown.md`
- `docs/consumable-fixed-asset-ddl-api-draft.md`
- `docs/consumable-fixed-asset-remaining-plan.md`
handoff_to:
- tech-lead-architect
- engineering-manager
deliverables:
- 固定资产退回增量需求与验收标准
risks:
- 若退回语义不清，前后端会对 `idle` / `in_use` 口径产生歧义
exit_criteria:
- 退回接口范围、状态语义、验收标准明确

背景：
- 当前固定资产版本已完成验收建卡、调拨、报废，但任务拆解中的“退回”尚未实现。
- `asset_movements` 已预留 `return` 类型，但服务层和 API 未暴露对应能力。

目标：
- 提供固定资产退回接口，使资产可从部门占用状态归还到待再次分配状态。
- 保持现有验收、调拨、报废能力不回归。

范围：
- 后端新增固定资产退回接口。
- 资产卡片状态回写与流转流水记录。
- 自动化测试覆盖主要成功/失败场景。

非范围：
- 不新增维修、折旧、财务核销、批量退回。
- 不改动现有 `asset_cards` 表结构。
- 不进入前端页面改造。

业务规则：
1. 已报废资产不可退回。
2. 退回成功后，资产状态改为 `idle`。
3. 退回成功后，`department_id`、`custodian_user_id` 置空。
4. 退回时允许保留或更新 `location_text`，用于描述退回存放位置。
5. 退回必须写入 `asset_movements`，`movement_type = 'return'`。

验收标准：
1. 调用退回接口后，资产卡片状态从使用态回到 `idle`。
2. 资产详情可看到新增的 `return` 流转记录。
3. 已报废资产调用退回接口返回冲突错误。
4. 原有调拨、报废接口与测试不受影响。

[artifact:UserStory]
status: READY
owner: senior-ai-agent-pm
scope:
- 固定资产退回的最小用户故事
inputs:
- [artifact:PRD]
handoff_to:
- tech-lead-architect
- engineering-manager
deliverables:
- 用户角色、场景与验收条件
risks:
- None
exit_criteria:
- 实现和测试可直接引用本故事

- 作为仓库主管，我希望把已归还的设备从部门责任下退回，以便后续重新分配。
- 作为主管，我希望系统自动清空责任部门和保管人，并记录退回流水，避免台账失真。
- 作为审计人员，我希望能在资产详情中看到退回记录，追溯设备何时归还、归还到哪里。

[artifact:Prototype]
status: READY
owner: senior-ai-agent-pm
scope:
- 资产退回接口的交互原型说明
inputs:
- [artifact:PRD]
- [artifact:UserStory]
handoff_to:
- tech-lead-architect
- engineering-manager
deliverables:
- 请求/响应与状态变化说明
risks:
- None
exit_criteria:
- API 与测试样例可直接按该原型实现

接口原型：
- `POST /api/assets/cards/:id/return`

请求体：
```json
{
  "locationText": "资产中转区-A01",
  "notes": "设备已由组装车间归还仓库"
}
```

成功响应：
```json
{
  "code": 0,
  "data": null,
  "message": "固定资产退回完成"
}
```

状态切换：
- 退回前：资产可能为 `in_use` 或 `idle`
- 退回后：资产统一为 `idle`
- 同时清空 `department_id` 与 `custodian_user_id`
- 写入一条 `movement_type = 'return'` 的资产流水
