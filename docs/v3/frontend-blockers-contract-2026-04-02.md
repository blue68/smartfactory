[artifact:APIDoc]
status: READY
owner: tech-lead-architect
scope:
- 通知中心 / 驾驶舱实时推送最小前后端契约
- 质量溯源页真实化所缺字段与响应扩展
inputs:
- `services/web/src/api/notification.ts`
- `services/web/src/pages/notification/NotificationPage.tsx`
- `services/api/src/modules/notification/notification.routes.ts`
- `services/api/src/modules/notification/notification.service.ts`
- `services/web/src/api/quality.ts`
- `services/web/src/pages/quality/TracePage.tsx`
- `services/api/src/modules/quality/quality.service.ts`
handoff_to:
- senior-backend-engineer
- engineering-manager

deliverables:
- 通知实时通道最小接口定义
- 质量页 `traceCompletionRate` / `productionOrderId` / AI 根因分析最小响应定义
- 前端验收口径与非目标范围
risks:
- SSE 鉴权实现若坚持原生 `EventSource`，需额外处理认证头限制；若用 fetch-stream，可继续复用 Bearer Token
- AI 根因分析若后端暂时无法接入真实模型，可先返回结构化规则分析，但字段契约应稳定
exit_criteria:
- 后端可直接据此补接口/字段
- 前端无需继续依赖静态占位或文案提示

## Update — 2026-04-02 Later

当前代码已完成本文件定义的核心 blocker 收口：

- 通知模块已新增 `GET /api/notifications/stream`，并在通知创建、单条已读、全部已读时发出 SSE 事件。
- 通知中心与 Dashboard 已接入实时订阅，不再依赖 `useUnreadCount()` 的 60 秒轮询作为唯一刷新手段。
- `GET /api/quality/stats` 已返回 `traceCompletionRate`、`tracedIssueCount`、`totalIssueCount`。
- `GET /api/quality/issues` 已返回 `productionOrderId`、`productionOrderNo`，质量页“溯源”按钮已可直接加载对应工单链路。
- `GET /api/quality/traceability/:productionOrderId` 已返回 `aiAnalysis`，质量页 AI 根因分析区已切换为真实字段消费；当后端分析为空时，前端展示“暂无根因分析”。

当前结论：

- 本文档描述的前端主 blocker 已不再构成进行中阻塞项。
- 后续若继续增强实时能力，应作为独立 follow-up 处理，而不是继续挂在本 blocker contract 下。

## 1. 通知实时推送

### 1.1 当前现状

- 前端当前只有：
  - `GET /api/notifications`
  - `GET /api/notifications/unread-count`
  - `PUT /api/notifications/:id/read`
  - `PUT /api/notifications/read-all`
- `useUnreadCount()` 仅每 60 秒轮询一次，`useNotifications()` 只走普通 query，无实时通道。
- 后端通知模块当前也只有列表 / 已读 / 未读数接口，没有 SSE / WebSocket / 长轮询入口。

### 1.2 最小新增接口

#### `GET /api/notifications/stream`

- Transport：`text/event-stream`
- Auth：与现有登录态一致
- 用途：让通知中心页和驾驶舱在有新通知、已读变化时立即刷新

#### SSE Event: `notification.created`

```json
{
  "type": "notification.created",
  "data": {
    "notification": {
      "id": 123,
      "type": "approval_request",
      "title": "采购建议待审批",
      "content": "存在新的采购建议等待审批",
      "isRead": false,
      "relatedType": "purchase_suggestion",
      "relatedId": 456,
      "createdAt": "2026-04-02T10:00:00.000Z"
    },
    "unreadCount": 7
  }
}
```

#### SSE Event: `notification.read`

```json
{
  "type": "notification.read",
  "data": {
    "id": 123,
    "unreadCount": 6
  }
}
```

#### SSE Event: `notification.all_read`

```json
{
  "type": "notification.all_read",
  "data": {
    "unreadCount": 0
  }
}
```

#### SSE Event: `heartbeat`

```json
{
  "type": "heartbeat",
  "data": {
    "ts": "2026-04-02T10:00:05.000Z"
  }
}
```

### 1.3 前端消费口径

- 收到 `notification.created`：
  - 立即更新未读数
  - `invalidateQueries(['notifications'])`
  - 若 `relatedType` 命中 `approval_request` / `purchase_suggestion` / `sales_order`，允许驾驶舱额外刷新待审批卡片或建议列表
- 收到 `notification.read` / `notification.all_read`：
  - 立即更新未读数
  - 刷新通知列表缓存
- `heartbeat` 仅用于连接保活，前端不做业务刷新

### 1.4 非目标范围

- 本轮不要求做通用事件总线 SDK
- 本轮不要求把所有业务页面都改成实时流式刷新
- 本轮不要求替换现有通知 REST 接口

## 2. 质量页真实化

### 2.1 当前现状

- `GET /api/quality/stats` 当前返回：
  - `totalInspected`
  - `totalFailed`
  - `failRate`
  - `trendData`
  - `issueTypeBreakdown`
  - `top5Issues`
- 前端质量页仍缺：
  - `traceCompletionRate`
  - 质量问题列表里的 `productionOrderId`
  - AI 根因分析真实结果

### 2.2 扩展 `GET /api/quality/stats`

#### 新增字段

```json
{
  "traceCompletionRate": "82.5%",
  "tracedIssueCount": 33,
  "totalIssueCount": 40
}
```

#### 字段约定

- `traceCompletionRate`
  - 字符串百分比，直接用于前端展示
  - 推荐保留一位小数，如 `82.5%`
- `tracedIssueCount`
  - 已能关联到有效 `productionOrderId` 并可进入溯源链的问题数
- `totalIssueCount`
  - 当前统计周期内的问题总数

### 2.3 扩展 `GET /api/quality/issues`

#### 当前列表项新增字段

```json
{
  "id": 9001,
  "inspectionId": 301,
  "inspectionNo": "QC20260402001",
  "productionOrderId": 8001,
  "productionOrderNo": "WO-2026-001",
  "componentName": "门板组件",
  "issueTypes": ["appearance"],
  "severity": "severe",
  "description": "面料存在明显色差",
  "createdAt": "2026-04-02T09:30:00.000Z"
}
```

#### 前端用途

- 质量问题列表点击“溯源”时，直接 `setSelectedOrderId(productionOrderId)`
- 不再弹“请联系后端补充字段”的 warning

### 2.4 扩展 `GET /api/quality/traceability/:productionOrderId`

#### 新增字段

```json
{
  "aiAnalysis": {
    "summary": "主要风险集中在面料跨缸号使用与工序扫码缺失。",
    "rootCauses": [
      "同一生产单出现多个缸号，存在混用风险",
      "部分工序无扫码记录，导致过程追溯链断裂"
    ],
    "recommendations": [
      "锁定异常缸号批次并复核同批次成品",
      "要求相关工序补齐扫码报工"
    ],
    "generatedAt": "2026-04-02T10:05:00.000Z"
  }
}
```

#### 字段约定

- `aiAnalysis` 可为空；为空时前端展示“暂无根因分析”
- `summary` 用于卡片正文主段落
- `rootCauses` / `recommendations` 为短句数组，前端可直接渲染列表

### 2.5 前端验收口径

- 质量概况卡片中的“已完成溯源”不再显示 `—`
- 问题列表点击“溯源”可直接加载对应工单溯源链
- AI 根因分析区域不再展示静态占位文案

### 2.6 非目标范围

- 本轮不要求重做质量页布局
- 本轮不要求把 AI 根因分析做成可编辑工作流
- 本轮不要求补新的质量页写操作

[artifact:TaskBreakdown]
status: READY
owner: tech-lead-architect
scope:
- 通知实时推送最小后端落地任务
- 质量页真实化最小后端落地任务
inputs:
- 上述 `[artifact:APIDoc]`
- `services/api/src/modules/notification/*`
- `services/api/src/modules/quality/*`
handoff_to:
- senior-backend-engineer
- engineering-manager

goal:
- 补齐前端当前 P0/P1 阻塞的最小后端契约
changed_areas:
- `services/api/src/modules/notification/notification.routes.ts`
- `services/api/src/modules/notification/notification.service.ts`
- `services/api/src/modules/quality/quality.service.ts`
- 如需类型对齐，补充 `services/web/src/api/notification.ts` 与 `services/web/src/api/quality.ts`
steps:
- N1. 新增 `GET /api/notifications/stream` SSE 入口
- N2. 在通知创建、单条已读、全部已读时发出对应 SSE 事件
- N3. 为质量统计补 `traceCompletionRate` / `tracedIssueCount` / `totalIssueCount`
- N4. 为质量问题列表补 `productionOrderId` / `productionOrderNo`
- N5. 为溯源链响应补 `aiAnalysis`
risks:
- SSE 连接生命周期与多实例广播机制需明确，否则会出现单实例可用、多实例失效
- AI 根因分析若依赖模型调用，需设置超时与降级字段，避免拖慢主溯源接口
validation:
- 通知：本地登录后新增一条通知，未读数与列表在 5 秒内更新
- 质量：统计卡片展示真实溯源率，问题列表点击“溯源”能打开对应链路，AI 分析不再显示占位文本
