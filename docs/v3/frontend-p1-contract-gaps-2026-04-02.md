[artifact:APIDoc]
status: READY
owner: tech-lead-architect
scope:
- 通知中心 / Dashboard 的最小实时推送契约
- 质量页真实化所缺最小字段与接口补充
inputs:
- `services/web/src/api/notification.ts`
- `services/web/src/pages/notification/NotificationPage.tsx`
- `services/web/src/pages/dashboard/DashboardPage.tsx`
- `services/web/src/api/quality.ts`
- `services/web/src/pages/quality/TracePage.tsx`
- `services/api/src/modules/notification/*`
- `services/api/src/modules/quality/quality.service.ts`
deliverables:
- 明确当前前端已接通能力与仍缺失的后端契约
- 给出最小接口/字段扩展，避免前端继续使用占位或假实时
risks:
- 若实时推送改用 WebSocket 而非 SSE，前端接线方式会不同，但事件字段应保持等价
- 若 AI 根因分析由独立 AI 服务异步生成，可能需要增加“分析中”状态
handoff_to:
- senior-backend-engineer
- engineering-manager
exit_criteria:
- 后端可按本文补齐最小契约，不必再次从前端 TODO 倒推字段
- 前端拿到字段后可去掉实时/质量页中的占位与 warning toast

## Update — 2026-04-02 Later

本文件中定义的大部分 P1 契约缺口已完成，当前状态应拆成“已收口项”和“可选 follow-up”，不再视为统一 blocker：

- 已完成：
  - `GET /api/notifications/stream` 已落地，通知中心与 Dashboard 已接入 SSE。
  - `GET /api/quality/stats` 已补 `traceCompletionRate`，并进一步补充 `tracedIssueCount` / `totalIssueCount`。
  - `GET /api/quality/traceability/:productionOrderId` 已返回 `aiAnalysis`，质量页不再使用静态根因分析文案。
  - `GET /api/quality/issues` 已为列表项补齐 `productionOrderId` 与 `productionOrderNo`，质量页“溯源”按钮已打通。
- 未按本文原样实现，但当前不再构成主 blocker：
  - `purchase_suggestion.pending_changed` 专用事件未单独落地。
  - 当前实现改为在收到 `notification.created` 且 `relatedType` 命中待审批相关业务时，直接失效 Dashboard 依赖的 `analytics` / `purchase` 查询。

命名对齐说明：

- 本文中的 `notification.read_all` 应以当前代码命名 `notification.all_read` 为准。
- 本文中的 `aiRootCauseAnalysis` 已在实现中统一为 `aiAnalysis`。

## 1. 当前现状

### 1.1 通知中心 / Dashboard

当前前端只接了 4 个 REST 接口：

- `GET /api/notifications`：通知列表，见 `services/web/src/api/notification.ts`
- `GET /api/notifications/unread-count`：未读数，见 `services/web/src/api/notification.ts`
- `PUT /api/notifications/:id/read`：单条已读，见 `services/web/src/api/notification.ts`
- `PUT /api/notifications/read-all`：全部已读，见 `services/web/src/api/notification.ts`

当前唯一自动刷新是未读数的 `refetchInterval: 60_000`，通知列表本身没有轮询，更没有实时通道。代码证据：

- `services/web/src/api/notification.ts:100`
- `services/api/src/modules/notification/notification.routes.ts:14`
- `services/api/src/modules/notification/notification.routes.ts:20`
- `services/api/src/modules/notification/notification.routes.ts:28`

结论：现在是“静态列表 + 60 秒未读数轮询”，不是实时通知。

### 1.2 质量页

质量页当前卡 3 个明确的后端缺口：

- `traceCompletionRate` 不存在，前端只能展示 `—`
- AI 根因分析仍是静态文案
- 质量问题列表不返回 `productionOrderId`，所以“溯源”按钮无法跳到对应工单溯源

代码证据：

- `services/web/src/pages/quality/TracePage.tsx:324`
- `services/web/src/pages/quality/TracePage.tsx:355`
- `services/web/src/pages/quality/TracePage.tsx:680`
- `services/web/src/pages/quality/TracePage.tsx:771`
- `services/web/src/api/quality.ts:144`
- `services/api/src/modules/quality/quality.service.ts:443`

## 2. 最小契约补充

### 2.1 通知中心 / Dashboard 实时推送

建议新增一个 SSE 入口：

- `GET /api/notifications/stream`

原因：

- 代码库里已存在 AI SSE 基础设施，SSE 比额外引入 WebSocket 更小
- 当前前端只需要“收到事件后失效查询/轻量更新”，不需要双向通信

建议事件包络：

```json
{
  "event": "notification.created",
  "emittedAt": "2026-04-02T10:00:00.000Z",
  "payload": {}
}
```

最小事件类型：

1. `notification.created`

payload:

```json
{
  "notification": {
    "id": 101,
    "type": "approval_request",
    "title": "新待审批事项",
    "content": "有新的采购建议待审批",
    "isRead": false,
    "relatedType": "purchase_suggestion",
    "relatedId": 33,
    "createdAt": "2026-04-02T10:00:00.000Z"
  },
  "unreadCount": 6
}
```

2. `notification.read`

payload:

```json
{
  "id": 101,
  "unreadCount": 5
}
```

3. `notification.read_all`

payload:

```json
{
  "unreadCount": 0
}
```

4. `purchase_suggestion.pending_changed`

payload:

```json
{
  "pendingCount": 3
}
```

前端最小验收口径：

- 通知中心打开时，无需手刷即可看到新通知进入列表顶部
- Header / 侧边栏未读数在 60 秒内之外也能及时变化
- Dashboard 中待审批采购建议区块在建议状态变化后可立即失效重拉

非目标范围：

- 不做历史事件回放
- 不做多主题订阅管理
- 不做站内弹窗 toast 规范统一

### 2.2 质量统计 `GET /api/quality/stats`

当前已有：

- `totalInspected`
- `totalFailed`
- `failRate`
- `trendData`
- `issueTypeBreakdown`
- `top5Issues`

最小新增字段：

```json
{
  "traceCompletionRate": "83.3%"
}
```

建议语义：

- 分子：当前 period 内“已完成溯源”的质量问题数
- 分母：当前 period 内全部质量问题数

原因：

- 前端统计卡现在专门为此保留了一个卡位，但没有可展示字段

### 2.3 质量溯源 `GET /api/quality/traceability/:productionOrderId`

建议在现有 `TraceabilityChain` 上增加：

```json
{
  "aiRootCauseAnalysis": {
    "summary": "检测到跨缸号使用，且部分组件缺少扫码记录。",
    "recommendations": [
      "优先核查该工单的领料记录与缸号替代审批。",
      "补录缺失的工序扫码记录。"
    ],
    "confidence": 78
  }
}
```

原因：

- 前端 AI 根因分析区块已经存在，当前只是静态占位文案
- 把字段挂在 traceability 响应里，前端不需要再发第二次请求

兼容策略：

- 若后端暂时无法生成分析，可返回 `null`
- 前端据此展示“分析暂不可用”，不再使用硬编码建议文案

### 2.4 质量问题列表 `GET /api/quality/issues`

当前返回项最小只有：

- `id`
- `inspectionId`
- `inspectionNo`
- `componentName`
- `issueTypes`
- `severity`
- `description`
- `createdAt`

最小新增字段：

```json
{
  "productionOrderId": 20031
}
```

可选增强字段：

```json
{
  "workOrderNo": "WO-2026-0031",
  "skuName": "北欧橡木餐椅"
}
```

原因：

- 前端“溯源”按钮只缺 `productionOrderId` 即可跳转
- `workOrderNo / skuName` 只是为了减少额外展示拼接，不是阻塞项

[artifact:TaskBreakdown]
status: READY
owner: tech-lead-architect
scope:
- 拆解通知实时推送与质量页真实化的最小实现任务
inputs:
- 上述 `[artifact:APIDoc]`
- `services/web/src/pages/quality/TracePage.tsx`
- `services/web/src/pages/notification/NotificationPage.tsx`
- `services/web/src/pages/dashboard/DashboardPage.tsx`
deliverables:
- 后端实现任务边界
- 前端接线任务边界
- 非目标范围约束
risks:
- 若后端先补字段但未补测试，前端接线后仍可能出现口径回归
handoff_to:
- senior-backend-engineer
- senior-frontend-engineer
exit_criteria:
- 每个阻塞项都有明确 owner、接口和验收口径

## 3. 后端最小任务

1. `BE-RT-01` 已完成：新增 `GET /api/notifications/stream` SSE 入口，并完成鉴权。
2. `BE-RT-02` 已完成：通知创建、单条已读、全部已读后均会发出 SSE 事件。
3. `BE-RT-03` Follow-up：未单独增加 `purchase_suggestion.pending_changed` 事件，当前改由通知事件触发相关查询失效。
4. `BE-Q-01` 已完成：`GET /api/quality/stats` 已增加 `traceCompletionRate`，并补充 `tracedIssueCount` / `totalIssueCount`。
5. `BE-Q-02` 已完成：`GET /api/quality/traceability/:productionOrderId` 已增加 `aiAnalysis`。
6. `BE-Q-03` 已完成：`GET /api/quality/issues` 每条记录已增加 `productionOrderId`，并同步返回 `productionOrderNo`。

## 4. 前端最小任务

1. `FE-RT-01` 已完成：已订阅通知 SSE，收到事件后失效 `notificationKeys.all` 与 `notificationKeys.unreadCount()`。
2. `FE-RT-02` Follow-up：未消费 `purchase_suggestion.pending_changed` 专用事件；当前通过通知事件直接失效 Dashboard 所需查询。
3. `FE-Q-01` 已完成：已用 `traceCompletionRate` 替换质量统计卡中的占位 `—`。
4. `FE-Q-02` 已完成：已用 `aiAnalysis` 替换质量页静态根因分析文案。
5. `FE-Q-03` 已完成：已用 `productionOrderId` 打通质量问题列表“溯源”按钮跳转。

## 5. 非目标范围

- 不在本轮引入通知 toast/桌面通知体系
- 不在本轮重做通知中心交互
- 不在本轮实现 AI 根因分析的 Prompt / 模型编排，只消费后端返回结果
- 不在本轮扩展质量问题列表的更多字段筛选
