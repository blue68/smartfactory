# Sprint 4 UI 设计规范 — 智能调度功能

**文档编号**：UI-SPRINT4-V2-001
**版本**：v1.0
**创建日期**：2026-03-14
**负责人**：@senior-ui-designer
**输入来源**：
- docs/v2/sprint4-prd.md（Sprint 4 PRD + Prototype 描述）
- services/web/src/styles/variables.css（现有 Design Token）
- services/web/src/components/（现有组件库）

---

## 目录

1. [artifact:设计规范] — 新增 Design Token 与组件规范
2. [artifact:交互说明] — 完整交互流程与状态变化
3. [artifact:UI代码] — 关键组件 HTML/CSS 参考实现

---

## [artifact:设计规范]

### 1. 设计原则声明

Sprint 4 智能调度功能在现有设计系统基础上扩展，遵循以下原则：

- **规则计算透明化**：所有"智能建议"必须展示计算依据，禁止黑盒结论
- **人工确认底线**：确认操作必须有明确的弹窗确认步骤，不允许单次点击直接执行
- **文案诚实性**：统一使用"基于规则计算"或"智能计算"，禁止"AI 分析"、"人工智能预测"等过度承诺词汇
- **状态始终可见**：用户在任何时刻都知道系统当前状态（计算中/完成/失败/空态/冷启动）

---

### 2. 新增 Design Token（扩展 variables.css）

以下 Token 在现有 `:root` 块中追加，不修改现有变量。

#### 2.1 智能调度专属色彩 Token

```css
/* ═══════════════════════════════════════════
   AI 智能调度语义色
   -- 扩展现有 --color-ai-* 体系
═══════════════════════════════════════════ */

/* 规则引擎标识色（蓝紫，区别于普通 primary 蓝） */
--color-ai-50:   #F5F3FF;
--color-ai-100:  #EDE9FE;
--color-ai-200:  #DDD6FE;
--color-ai-400:  #A78BFA;
--color-ai-500:  #8B5CF6;
--color-ai-600:  #7C3AED;
--color-ai-700:  #6D28D9;

/* 智能计算标签背景/文字（复用 ai-100/ai-700） */
--tag-ai-calc-bg:     var(--color-ai-100);
--tag-ai-calc-text:   var(--color-ai-700);
--tag-ai-calc-border: var(--color-ai-200);

/* 资金占用预警（橙红，区别于普通 warning） */
--color-capital-warning-bg:   #FFF3CD;
--color-capital-warning-text: #92400E;
--color-capital-warning-border: #FCD34D;

/* 过载工人标识（红，复用 error 语义） */
--color-overload-bg:   var(--color-error-100);
--color-overload-text: var(--color-error-700);

/* 空闲工人标识（绿，复用 success 语义） */
--color-idle-bg:   var(--color-success-100);
--color-idle-text: var(--color-success-700);

/* 产能热力图四档色 */
--heatmap-low:      #DCFCE7; /* 利用率 < 50%，绿 */
--heatmap-normal:   #FEF3C7; /* 50%-80%，黄 */
--heatmap-high:     #FED7AA; /* 80%-100%，橙 */
--heatmap-overload: #FEE2E2; /* > 100%，红 */

/* 数据冷启动提示横幅 */
--color-coldstart-bg:     #FFFBEB;
--color-coldstart-border: #F59E0B;
--color-coldstart-text:   #92400E;
--color-coldstart-icon:   #F59E0B;

/* 优先级得分进度条 */
--score-bar-track: var(--color-gray-100);
--score-bar-fill-a: var(--color-error-500);   /* 交期紧迫度，50分段 */
--score-bar-fill-b: var(--color-warning-500); /* 订单优先级，30分段 */
--score-bar-fill-c: var(--color-success-500); /* 物料就绪度，20分段 */
```

#### 2.2 计算步骤卡片 Token

```css
/* ═══════════════════════════════════════════
   计算步骤卡片（StepCalculationCard）
═══════════════════════════════════════════ */

/* 步骤序号圆圈 */
--step-badge-size:   1.5rem;    /* 24px */
--step-badge-radius: 9999px;

/* 步骤状态色 */
--step-done-bg:    var(--color-success-100);
--step-done-text:  var(--color-success-700);
--step-done-icon:  var(--color-success-500);

--step-active-bg:  var(--color-ai-100);
--step-active-text: var(--color-ai-700);
--step-active-icon: var(--color-ai-500);

--step-pending-bg:  var(--color-gray-100);
--step-pending-text: var(--color-gray-500);

/* 步骤间连接线 */
--step-connector-color: var(--color-gray-200);
--step-connector-width: 2px;

/* 步骤卡片边框 */
--step-card-border-active: var(--color-ai-200);
--step-card-border-done:   var(--color-success-100);
--step-card-border-default: var(--color-gray-200);

/* 计算公式代码块 */
--step-formula-bg:      var(--color-gray-50);
--step-formula-border:  var(--color-gray-200);
--step-formula-text:    var(--color-gray-700);
--step-formula-mono:    var(--font-family-mono);
```

#### 2.3 排产建议卡片 Token

```css
/* ═══════════════════════════════════════════
   排产建议工单卡片（ScheduleSuggestionCard）
═══════════════════════════════════════════ */

/* 排名徽章 */
--rank-badge-size:   2rem;     /* 32px */
--rank-badge-1-bg:   #FEF3C7;
--rank-badge-1-text: #92400E;
--rank-badge-2-bg:   var(--color-gray-100);
--rank-badge-2-text: var(--color-gray-600);
--rank-badge-3-bg:   var(--color-gray-100);
--rank-badge-3-text: var(--color-gray-600);
--rank-badge-n-bg:   var(--color-gray-50);
--rank-badge-n-text: var(--color-gray-400);

/* 优先级总分显示 */
--score-total-size:  var(--text-number-m);  /* 1.25rem */
--score-total-color: var(--text-primary);

/* 交期余裕指示器 */
--deadline-tight-color:  var(--color-error-600);   /* 余裕 <= 0 */
--deadline-normal-color: var(--color-warning-600);  /* 余裕 1-7 天 */
--deadline-safe-color:   var(--color-success-600);  /* 余裕 > 7 天 */
```

#### 2.4 新增动画 Keyframe Token

```css
/* ═══════════════════════════════════════════
   智能计算状态动画（扩展现有 Keyframes）
═══════════════════════════════════════════ */

/* 脉冲波浪动画（"思考中"状态，区别于旋转 spinner）
   用于计算中的建议列表状态指示 */
@keyframes pulse-wave {
  0%   { transform: scaleY(1);   opacity: 0.4; }
  25%  { transform: scaleY(1.8); opacity: 1;   }
  50%  { transform: scaleY(1);   opacity: 0.4; }
  75%  { transform: scaleY(0.6); opacity: 0.3; }
  100% { transform: scaleY(1);   opacity: 0.4; }
}

/* 三波形错位：用 animation-delay 实现波浪感 */
/* bar1: delay 0s / bar2: delay 0.15s / bar3: delay 0.30s */

/* 数据刷新成功后的闪入动画（区别于 fade-in，带轻微缩放） */
@keyframes result-appear {
  0%   { opacity: 0; transform: translateY(8px) scale(0.98); }
  60%  { opacity: 1; transform: translateY(-1px) scale(1.002); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

/* 错误态遮罩淡入 */
@keyframes stale-overlay-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* 冷启动提示横幅滑入 */
@keyframes banner-slide-down {
  from { transform: translateY(-100%); opacity: 0; }
  to   { transform: translateY(0);     opacity: 1; }
}
```

#### 2.5 间距与尺寸规范（新增场景）

| Token 名 | 值 | 用途 |
|---|---|---|
| `--layout-schedule-left` | 60% | 调度看板左区（采购建议）宽度 |
| `--layout-schedule-right` | 40% | 调度看板右区（排产建议）宽度 |
| `--layout-drawer-schedule` | 480px | 计算步骤抽屉宽度（复用现有 Drawer） |
| `--step-card-padding` | var(--space-4) | 计算步骤卡片内边距（16px） |
| `--step-gap` | var(--space-3) | 步骤卡片间距（12px） |
| `--heatmap-cell-size` | 2.5rem | 产能热力图单元格尺寸 |
| `--heatmap-cell-radius` | var(--radius-sm) | 热力图单元格圆角 |
| `--score-bar-height` | 6px | 优先级得分分项进度条高度 |
| `--rank-badge-margin` | var(--space-3) | 排名徽章右边距 |

---

### 3. 组件规范

#### 3.1 全局统计卡片（ScheduleStatCard）

**用途**：看板顶部四格统计，复用 KpiCard 结构但增加点击跳转和告警色规则。

**状态变体**：

| 变体 | 触发条件 | 左侧色条 | 数字颜色 |
|---|---|---|---|
| `normal` | 数值为 0 | `--color-gray-300` | `--text-secondary` |
| `info` | 数值 > 0，无告警 | `--color-primary-500` | `--text-primary` |
| `warning` | 库存预警 SKU > 0 | `--color-warning-500` | `--color-warning-600` |
| `danger` | 过载工人 > 0 | `--color-error-500` | `--color-error-600` |
| `loading` | 计算中 | `--color-gray-200`（shimmer） | `--` 占位符 |
| `error` | 计算失败 | `--color-error-200` | `--` 占位符 |

**可访问性**：卡片整体为 `<button>` 或 `<a>`，aria-label 描述完整语义（"待确认采购建议 12 条，点击跳转"）。

#### 3.2 计算步骤卡片（StepCalculationCard）

**用途**：抽屉内展示四步规则引擎计算过程。

**结构**：
```
StepCalculationCard
  ├── 步骤头部
  │   ├── 步骤序号圆圈（1/2/3/4）
  │   ├── 步骤标题（如"生产缺口计算"）
  │   └── 步骤状态标签（"已完成" / "计算中" / "待计算"）
  ├── 步骤内容
  │   ├── 输入数据区（灰底代码块，等宽字体）
  │   ├── 计算公式行（突出显示 = 结果）
  │   └── 结论区（绿色/橙色背景，视结果语义）
  └── 步骤连接线（最后一步无）
```

**默认展开规则**：步骤一（缺口计算）和步骤四（供应商推荐）默认展开；步骤二三默认折叠，用户点击展开。

**数字可点击规则**：步骤一中工单需求量数字为可点击链接样式（蓝色下划线），点击展开内联工单列表弹出层（popover，不新开页面）。

**骨架屏**：计算中时，四个步骤卡片全部替换为骨架屏占位（使用现有 `Skeleton` 组件 card variant，height: 120px）。

#### 3.3 排产建议工单行（ScheduleWorkOrderRow）

**折叠态**（列表默认）：
```
[排名] [工单号] [紧急标签?] | 产品名称 | 计划完工日 | 优先级 XX/100 | [展开按钮]
```

**展开态**（点击后）：
```
[折叠按钮]
├── 得分明细区
│   ├── [交期紧迫度] XX/50 — 色值条（红色段）
│   ├── [订单优先级] XX/30 — 色值条（橙色段）
│   └── [物料就绪度] XX/20 — 色值条（绿色段）
├── 工期余裕计算行（数字高亮）
├── 工人推荐列表（卡片网格，2 列）
│   ├── 工人卡片（空闲/正常/过载）
│   └── ...
└── [跳转排产] 文字链接按钮
```

**工人推荐卡片**状态：
- 空闲（`< 50%`）：绿色左边框 + "推荐 ✓" 标签
- 正常（`50%-100%`）：蓝色左边框 + 已分配工时显示
- 过载（`> 100%`）：红色左边框 + "过载 ✗" 标签 + 灰色半透明遮罩

#### 3.4 "智能计算"来源标签

复用现有 Tag 组件，新增 variant 映射：

| source 值 | 标签文案 | 视觉 |
|---|---|---|
| `ai_schedule` | 智能计算 | `--tag-ai-calc-*`（蓝紫底） |
| `production_shortage` | 缺料触发 | `--color-warning-*`（黄色底，复用 `warning` variant） |
| `manual` | 手动创建 | `--color-gray-*`（灰色底，复用 `neutral` variant） |

#### 3.5 AI 计算中状态指示器（PulseWaveIndicator）

**区别于现有旋转 spinner**：使用三根纵向波浪柱，模拟"思考"感知。

规格：
- 柱数：3 根
- 柱尺寸：宽 3px，最小高 8px，最大高 20px
- 柱颜色：`--color-ai-500`
- 动画：`pulse-wave` keyframe，三柱 delay 错开 0.15s
- 间距：柱间 4px

**使用场景**：
- 调度看板"重新计算"触发后，顶部统计卡片区右侧
- 采购建议列表中"计算中"状态的建议行前缀

#### 3.6 错误态旧数据叠加（StaleDataOverlay）

**触发条件**：后台计算任务失败，保留上次成功数据。

**视觉规则**：
- 建议列表内容不清空，正常渲染
- 列表容器顶部添加横向错误条（高 40px，`--color-error-50` 背景，`--color-error-600` 文字）
- 错误条内容：`上次计算于 {时间} 失败，当前数据仅供参考。[重试计算]`
- 列表整体添加 `opacity: 0.7` + 无交互遮罩（`pointer-events: none`）
- "重试计算"按钮为 `danger` variant，点击后恢复 `pointer-events: auto`，进入计算中态

#### 3.7 数据冷启动横幅（ColdStartBanner）

**触发条件**：系统经营数据 < 14 天。

**视觉规则**：
- 固定在页面标题行下方，主体内容上方
- 背景：`--color-coldstart-bg`，左侧 4px 色条 `--color-coldstart-border`
- 图标：警告三角（`--color-coldstart-icon`）
- 文案：「当前系统数据积累 {N} 天，建议参考价值有限，建议以规则参数为主、计算结果为辅进行决策」
- 有关闭按钮（X），关闭后当次会话内不再显示（sessionStorage 记录）
- 动画：`banner-slide-down` 0.3s ease

---

### 4. 字体与数字展示规范

| 场景 | 字号 Token | 字体规则 |
|---|---|---|
| 统计卡片数字（待确认 12 条） | `--text-number-m`（1.25rem） | `.font-tabular` |
| 优先级总分（95/100） | `--text-number-m` | `.font-tabular` + 粗体 |
| 计算公式结果数字 | `--text-body-m`（0.875rem） | 等宽字体 `--font-family-mono` |
| 工时数字（40h / 45h） | `--text-body-m` | `.font-tabular` |
| 金额数字（¥4,500） | `--text-body-l`（1rem） | `.font-tabular` + 加粗 |
| 步骤序号 | `--text-body-s`（0.75rem） | 粗体，居中 |

**单位显示规定**：
- 工单数量：始终显示"件"、"张"、"米"等 SKU 单位
- 工时：始终显示"小时"或"h"
- 金额：始终显示"¥"前缀 + 千分位逗号
- 优先级分数：始终显示"XX/100 分"完整格式
- 计算时间：显示"基于近 XX 天数据"

---

### 5. 响应式断点规范

| 断点 | 宽度 | 布局变化 |
|---|---|---|
| `xs` | < 480px | 看板单列，采购区和排产区各占全宽，垂直堆叠 |
| `sm` | 480-768px | 同上，统计卡片 2×2 网格 |
| `md` | 768-1024px | 看板双列（55%/45%），统计卡片 2×2 |
| `lg` | 1024-1280px | 看板双列（60%/40%），统计卡片 4×1 |
| `xl` | >= 1280px | 同 lg，左右区内容可见行数增加，减少滚动 |

**Mobile First 关键决策**：
- 计算步骤抽屉在移动端（< 768px）改为底部 Sheet（height: 85vh，圆角上边框）
- 产能热力图在移动端横向滚动，不压缩单元格尺寸
- 批量操作栏在移动端固定在页面底部（sticky bar）

---

## [artifact:交互说明]

### 1. 智能调度主看板（/schedule-suggestions）

#### 1.1 页面初始化流程

```
用户导航至 /schedule-suggestions
        ↓
前端请求 GET /schedule-suggestions/status
        ↓
    ┌───────────────────────────────────────────┐
    │ 返回字段：                                  │
    │  status: 'idle'|'calculating'|'done'|'failed' │
    │  calculated_at: ISO 时间戳                  │
    │  data_basis_days: number                   │
    └───────────────────────────────────────────┘
        ↓
    ┌── status === 'done' && calculated_at 距今 < 1h
    │       → 直接渲染建议数据（result-appear 动画）
    │
    ├── status === 'done' && calculated_at 距今 >= 1h
    │       → 展示数据，同时顶部提示"数据较旧，建议重新计算"
    │
    ├── status === 'calculating'
    │       → 进入计算中态（骨架屏 + 脉冲波浪）
    │       → 启动轮询（每 3 秒 GET /schedule-suggestions/status）
    │
    ├── status === 'failed'
    │       → 展示错误态（旧数据 + StaleDataOverlay）
    │
    └── status === 'idle'（无任何历史数据）
            → 自动触发后台计算
            → 进入计算中态
```

#### 1.2 重新计算交互

```
用户点击"重新计算"按钮
        ↓
按钮变为 loading 态（spinner，文案"计算中..."）
        ↓
POST /schedule-suggestions/calculate
        ↓
响应 202 Accepted（任务已入队，非同步等待）
        ↓
两个建议区块（采购区 + 排产区）进入骨架屏
顶部统计卡片数字替换为 "--" + shimmer 动画
"重新计算"按钮保持 disabled 直至计算完成
        ↓
前端启动轮询：每 3 秒 GET /schedule-suggestions/status
        ↓
轮询超时处理（30 秒未收到 done 状态）：
  → 停止轮询
  → 展示超时错误："调度计算超时，请稍后重试"
  → "重新计算"按钮恢复可用
        ↓
status === 'done'（轮询到完成）：
  → 请求 GET /schedule-suggestions/latest
  → 数据刷新，result-appear 动画逐区块渲染
  → 顶部统计卡片数字更新
  → 按钮恢复"重新计算"（非 loading）
```

#### 1.3 计算中态视觉描述

- 顶部统计卡片：数字显示 "--"，背景色 `--color-gray-100`，添加 shimmer 动画
- 采购建议区：显示 4 个骨架屏卡片（每个高 120px，间距 12px）
- 排产建议区：显示 5 个骨架屏列表行（每行高 56px）
- 顶部"重新计算"按钮右侧显示脉冲波浪动画 + 文案"正在分析调度方案..."
- aria-live="polite" 区域播报"正在分析调度方案，请稍候"

#### 1.4 错误恢复态视觉描述

- 建议列表内容保留（opacity: 0.7）
- 列表顶部红色错误横条：高 40px，内含错误描述 + [重试计算] 按钮
- 红色错误横条通过 stale-overlay-in 动画淡入（0.2s）
- 列表区域鼠标不可交互（除重试按钮外），防止用户误操作过期数据

#### 1.5 空态视觉描述

- 无采购缺口且无待排产工单时展示
- 采购建议区：EmptyState 组件，图标为货物/仓库语义图，文案"暂无采购建议，当前库存满足所有工单需求"
- 排产建议区：EmptyState 组件，图标为工单/日历语义图，文案"暂无待排产工单，全部工单正在生产中"
- 顶部统计卡片数字均为 0，显示 `normal` 变体（灰色左边框）

#### 1.6 数据冷启动横幅交互

- 横幅在页面内容渲染完成后，以 `banner-slide-down` 动画出现（0.3s ease）
- 用户点击关闭（X）：横幅以 slideUp 反向动画收起（0.2s），sessionStorage 写入 `coldStartBannerClosed=1`
- 同一会话内刷新页面不再显示（读取 sessionStorage）
- 横幅不阻断下方内容交互

---

### 2. 计算步骤抽屉（CalcStepDrawer）

#### 2.1 触发与打开动画

```
用户点击采购建议行的"查看步骤"按钮
        ↓
按钮 active 态（0.1s 按压效果）
        ↓
右侧抽屉从屏幕右侧滑入（slide-in-right 动画，300ms cubic-bezier(0.34, 1.56, 0.64, 1)）
宽度：480px（桌面）/ 100vw（移动端底部 Sheet）
        ↓
抽屉标题："{SKU 名称} — 计算依据"
副标题："基于规则计算 · 计算时间：{时间戳}"
        ↓
若建议处于计算中（status === 'calculating'）：
  → 四个步骤卡片全部显示骨架屏
  → 骨架屏高度：步骤一 160px / 步骤二 120px / 步骤三 140px / 步骤四 130px
        ↓
若建议已完成（status === 'done'）：
  → 步骤一、步骤四默认展开
  → 步骤二、步骤三默认折叠（点击展开）
  → result-appear 动画，步骤卡片依次出现（每步延迟 80ms）
```

#### 2.2 步骤卡片展开/折叠交互

- 点击步骤标题行触发展开/折叠
- 折叠动画：内容区 height 从 auto 到 0（需 CSS max-height 过渡，300ms ease）
- 步骤序号圆圈：折叠态显示步骤编号，展开态显示 ✓（已完成）或 ⟳（计算中）
- 可展开内容区：内边距 `--step-card-padding`，背景与卡片同色（非灰底）

#### 2.3 步骤一工单数字点击（内联 Popover）

```
用户点击"工单需求总量：50 件"中的"50 件"超链接
        ↓
在点击位置上方/下方显示 Popover（非跳转，非新页面）
Popover 内容：
  - 关联工单列表（Table 样式，3 列：工单号 / SKU / 需求量）
  - "共 N 个关联工单" 汇总
  - [关闭] 按钮
        ↓
点击 Popover 外部区域关闭
键盘 Escape 关闭
```

**Popover 样式规范**：
- 宽度：320px
- 背景：`--bg-card`
- 阴影：`--shadow-lg`
- 圆角：`--radius-lg`
- z-index：`--z-tooltip`（600）
- 动画：`fade-in` 150ms ease

#### 2.4 抽屉底部操作栏

三个操作按钮，从左到右：

| 按钮 | variant | 说明 |
|---|---|---|
| 驳回 | `danger` outline | 点击弹出驳回原因弹窗（Modal） |
| 修改数量 | `secondary` | 点击原地转为数量输入框（inline edit） |
| 完整接受 | `primary` | 点击弹出确认弹窗（含金额） |

**已确认状态**（status !== 'pending'）：
- 三个按钮全部 disabled，灰色
- 操作栏顶部显示状态标签："已转 PO ✓" / "已驳回" / "已过期"

**修改数量内联编辑**：
```
点击"修改数量"
        ↓
建议数量文本替换为数字输入框（默认值 = suggested_qty）
按钮变为 [取消] [确认修改]
        ↓
输入框校验：> 0 且 <= suggested_qty × 2
        ↓
提交后弹出修改确认弹窗（含原始建议量 vs 修改量对比）
```

#### 2.5 驳回弹窗交互

复用现有 `Modal` 组件，confirmVariant="danger"：

```
弹窗标题："驳回采购建议"
弹窗内容：
  - 建议摘要（SKU + 原始建议数量）
  - textarea：驳回原因（必填，最少 5 字，实时字数统计）
  - 字数不足时确认按钮 disabled
弹窗操作：[取消] [确认驳回]（danger 变体）
        ↓
确认驳回 → POST /schedule-suggestions/{id}/reject
  → 成功：弹窗关闭，建议行状态更新为"已驳回"，Toast 提示"已驳回"（2秒自动消失）
  → 失败：弹窗保持，Toast 错误提示
```

---

### 3. 排产建议工单行（ScheduleWorkOrderRow）

#### 3.1 展开/折叠交互

```
用户点击工单行任意区域（或"展开"按钮）
        ↓
当前展开的其他工单行：收起动画（height → 0，200ms）
本行：展开动画（height 0 → auto，300ms ease）
        ↓
展开内容区出现：
  1. 三维得分条（带动画：进度条从 0 宽度扩展到目标值，400ms ease-out，延迟 100ms）
  2. 工期余裕计算行（数字高亮）
  3. 工人推荐卡片网格（2 列，移动端 1 列）
  4. [跳转排产] 按钮（text variant，带箭头图标）
        ↓
再次点击收起（toggle 行为）
```

#### 3.2 三维得分进度条动画规范

每个分项条目：
- 标签文字（"交期紧迫度"）+ 分值（"47/50"）左右对齐
- 进度条轨道：高 6px，`--score-bar-track` 背景，`--radius-full` 圆角
- 进度条填充：三段独立颜色（不混合），动画从 0 渐变至实际比例
- 动画时序：展开后 100ms 启动，各段 400ms ease-out
- 交期紧迫度（50分制）：红色 `--score-bar-fill-a`
- 订单优先级（30分制）：橙色 `--score-bar-fill-b`
- 物料就绪度（20分制）：绿色 `--score-bar-fill-c`

#### 3.3 工人推荐卡片交互

- 点击"过载"工人卡片（非禁用，仅提示）：Toast 警告"王师傅本周已过载，分配后可能影响交期"（3秒，warning 级别）
- 点击"推荐"工人卡片：无操作（纯展示，实际分配在 SchedulingPage 完成）
- 卡片 hover：`--shadow-sm` 提升，`--transition-fast`

#### 3.4 应用建议确认弹窗

```
用户点击"应用建议"按钮（排产建议区顶部）
        ↓
弹出 Modal（宽度 520px）
  标题："应用排产建议"
  内容：
    - 提示文案："将调整以下 {N} 个工单的优先级排序，此操作不会自动分配工人或创建任务。"
    - 工单变更列表（3 列：工单号 / 调整后排名 / 当前排名）
    - 支持取消勾选个别工单（Checkbox 列）
  操作：[取消] [确认应用]（primary 变体）
        ↓
确认应用：
  POST /schedule-suggestions/{id}/apply
  → 成功：
    弹窗内出现"应用成功！"成功提示（绿色，1秒后弹窗自动关闭）
    建议区底部显示 [跳转排产看板] 快捷按钮（success variant，3秒后自动消失）
    Toast："已应用排产建议，工单优先级已更新"
  → 失败：弹窗保持，Toast 错误提示
```

---

### 4. 批量确认采购建议

#### 4.1 批量选择交互

```
用户勾选第一条建议的 Checkbox
        ↓
底部固定栏（sticky bar）从屏幕底部滑入（slide-up，200ms ease）
  内容："已选 1 条 · 预估合计 ¥X,XXX  [批量确认接受] [取消选择]"
        ↓
继续勾选更多建议：数字和金额实时更新（transition-fast）
        ↓
"批量确认接受"按钮点击：
  弹出确认 Modal：
    "您确认接受以下 {N} 条采购建议，
    预计创建 {M} 张采购订单，总金额约 {总额} 元？"
    建议清单（可折叠，默认展开前 5 条）
  [取消] [确认接受（{N}条）]
        ↓
取消选择：底部固定栏以反向动画滑出
```

#### 4.2 固定操作栏样式

- 背景：`--bg-card`，顶部 1px border `--border-default`
- 高度：56px（桌面）/ 64px（移动端）
- 阴影：`--shadow-lg`（向上阴影）
- z-index：`--z-sticky`（200）
- 布局：左侧选中信息，中间金额，右侧按钮组

---

### 5. 历史记录 Tab

#### 5.1 Tab 切换交互

- Tab 栏：两个标签"当前建议"（默认）/ "历史记录"
- 复用现有 Tab 样式（`--border-default` 下划线，active 状态 `--color-primary-500` 下划线）
- 切换时内容区 fade-in（150ms），无骨架屏延迟（历史数据已缓存）

#### 5.2 历史记录列表

每条历史记录行：
- 计算时间（主文本）
- 触发方式标签（"手动触发" / "定时触发" / "事件触发"，neutral / info variant Tag）
- 采购 N 条 + 排产 N 条（次要文本）
- 数据基础天数（最右侧，文字颜色 `--text-secondary`）
- [查看详情] 链接（text variant Button）

#### 5.3 历史建议详情

- 点击"查看详情"：在当前页面区域内替换显示（非新页面），顶部面包屑"历史记录 > {时间戳}"
- 历史建议数据来自快照 JSON，不依赖实时库存
- 顶部黄色提示横幅："以下为 {时间} 的历史快照，数据仅供回溯参考，不反映当前实际状况"
- 人工决策记录区块（接受/修改/驳回，带操作人姓名和时间）

---

### 6. Dashboard 调度建议 Widget

#### 6.1 状态切换逻辑

```
Widget 初始化
        ↓
GET /dashboard/schedule-summary
        ↓
返回数据 → 渲染四格统计（result-appear 动画）
        ↓
数据为空（全部为 0）
  → 切换为"全正常"状态（绿色图标 + 文案）
        ↓
has_overload 或 inventory_warning_count > 0
  → 对应格子显示告警色（warning/danger）
  → 文案加粗
        ↓
计算中（calculating === true）
  → 四格显示 "--" + shimmer
  → 底部文案"计算中..."
        ↓
last_failed === true
  → 四格显示 "--"
  → 底部文案"上次计算失败" + [点击重试] 链接
```

#### 6.2 点击跳转逻辑

| 点击区域 | 跳转目标 |
|---|---|
| 采购建议 N 条 | `/schedule-suggestions#purchase` |
| 排产建议 N 个 | `/schedule-suggestions#production` |
| 库存预警 N 个 | `/schedule-suggestions#inventory` |
| 过载工人 N 人 | `/schedule-suggestions#capacity` |
| "前往智能调度看板" | `/schedule-suggestions` |

---

## [artifact:UI代码]

以下为关键组件的 HTML/CSS 参考实现，供 @senior-frontend-engineer 参照实现 React 组件。
所有类名采用 BEM 命名规范，CSS 变量引用现有 design token，新增 token 需先追加到 variables.css。

---

### 组件一：调度统计卡片（ScheduleStatCard）

```html
<!--
  [artifact:UI代码] ScheduleStatCard
  BEM: .schedule-stat-card[--info|--warning|--danger|--loading|--error]
  复用 KpiCard 结构，增加可点击跳转和 AI 计算状态
-->
<button
  class="schedule-stat-card schedule-stat-card--info"
  type="button"
  aria-label="待确认采购建议 12 条，点击跳转"
>
  <!-- 左侧色条 -->
  <span class="schedule-stat-card__bar" aria-hidden="true"></span>

  <div class="schedule-stat-card__body">
    <!-- 标题行 -->
    <div class="schedule-stat-card__header">
      <span class="schedule-stat-card__label">待确认采购建议</span>
      <!-- 计算中指示器（计算中态显示，其他态隐藏） -->
      <span class="schedule-stat-card__pulse" aria-hidden="true" hidden>
        <span class="pulse-wave">
          <span class="pulse-wave__bar"></span>
          <span class="pulse-wave__bar"></span>
          <span class="pulse-wave__bar"></span>
        </span>
      </span>
    </div>

    <!-- 数字区 -->
    <div class="schedule-stat-card__value-row">
      <!-- 计算完成态 -->
      <span class="schedule-stat-card__value font-tabular">12</span>
      <span class="schedule-stat-card__unit">条</span>

      <!-- 计算中态（替换上方数字区，hidden 控制） -->
      <span class="schedule-stat-card__placeholder" hidden>--</span>
    </div>

    <!-- 副文案 -->
    <span class="schedule-stat-card__hint">点击跳转 →</span>
  </div>
</button>
```

```css
/* ScheduleStatCard.module.css */

.schedule-stat-card {
  /* 复用 KpiCard 基础结构 */
  display: flex;
  align-items: stretch;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  padding: 0;
  cursor: pointer;
  text-align: left;
  transition: box-shadow var(--transition-base), transform var(--transition-fast);
  min-width: 0; /* flex 子元素防止溢出 */
  overflow: hidden;
}

.schedule-stat-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.schedule-stat-card:active {
  transform: translateY(0);
  box-shadow: var(--shadow-xs);
}

.schedule-stat-card:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}

/* 左侧色条 */
.schedule-stat-card__bar {
  display: block;
  width: 4px;
  flex-shrink: 0;
  background: var(--kpi-color, var(--color-primary-500));
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.schedule-stat-card__body {
  flex: 1;
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.schedule-stat-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.schedule-stat-card__label {
  font-size: var(--text-body-s);
  color: var(--text-secondary);
  font-weight: 500;
  line-height: 1.4;
}

.schedule-stat-card__value-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
  margin-top: var(--space-1);
}

.schedule-stat-card__value {
  font-size: var(--text-number-m);
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
  font-family: var(--font-family-number);
  font-variant-numeric: tabular-nums;
}

.schedule-stat-card__unit {
  font-size: var(--text-body-s);
  color: var(--text-secondary);
}

.schedule-stat-card__placeholder {
  font-size: var(--text-number-m);
  font-weight: 700;
  color: var(--text-disabled);
  /* shimmer 动画 */
  background: linear-gradient(
    90deg,
    var(--color-gray-200) 25%,
    var(--color-gray-100) 50%,
    var(--color-gray-200) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: var(--radius-sm);
  min-width: 3rem;
  height: 1.5rem;
  display: inline-block;
}

.schedule-stat-card__hint {
  font-size: var(--text-caption);
  color: var(--color-primary-500);
  margin-top: var(--space-1);
}

/* ── 变体：info（蓝色，有建议待处理） */
.schedule-stat-card--info {
  --kpi-color: var(--color-primary-500);
}

/* ── 变体：warning（橙色，库存预警） */
.schedule-stat-card--warning {
  --kpi-color: var(--color-warning-500);
}
.schedule-stat-card--warning .schedule-stat-card__value {
  color: var(--color-warning-600);
}

/* ── 变体：danger（红色，过载工人） */
.schedule-stat-card--danger {
  --kpi-color: var(--color-error-500);
}
.schedule-stat-card--danger .schedule-stat-card__value {
  color: var(--color-error-600);
}

/* ── 变体：normal（灰色，全部为 0） */
.schedule-stat-card--normal {
  --kpi-color: var(--color-gray-300);
}
.schedule-stat-card--normal .schedule-stat-card__value {
  color: var(--text-secondary);
}

/* ── 脉冲波浪指示器 */
.pulse-wave {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
}

.pulse-wave__bar {
  display: block;
  width: 3px;
  height: 8px;
  background: var(--color-ai-500);
  border-radius: 2px;
  animation: pulse-wave 1.2s ease-in-out infinite;
  transform-origin: bottom center;
}

.pulse-wave__bar:nth-child(2) {
  animation-delay: 0.15s;
}

.pulse-wave__bar:nth-child(3) {
  animation-delay: 0.30s;
}

/* ── 响应式 */
@media (max-width: 767px) {
  .schedule-stat-card__body {
    padding: var(--space-3);
  }
  .schedule-stat-card__value {
    font-size: var(--text-h3);
  }
}
```

---

### 组件二：计算步骤卡片（StepCalculationCard）

```html
<!--
  [artifact:UI代码] StepCalculationCard
  BEM: .step-card[--done|--active|--pending]
  state: done（已完成）/ active（计算中）/ pending（待计算）
-->
<article
  class="step-card step-card--done"
  aria-label="步骤一：生产缺口计算，已完成"
>
  <!-- 步骤头部（可点击触发展开/折叠） -->
  <button
    class="step-card__header"
    aria-expanded="true"
    aria-controls="step-1-body"
    type="button"
  >
    <!-- 左侧连接器 + 序号 -->
    <div class="step-card__connector-wrap">
      <span class="step-card__badge" aria-hidden="true">✓</span>
      <span class="step-card__line" aria-hidden="true"></span>
    </div>

    <!-- 标题区 -->
    <div class="step-card__title-area">
      <span class="step-card__step-label">步骤一</span>
      <h3 class="step-card__title">生产缺口计算</h3>
    </div>

    <!-- 状态标签 -->
    <span class="step-card__status-tag step-card__status-tag--done" aria-hidden="true">
      已完成
    </span>

    <!-- 折叠箭头 -->
    <span class="step-card__chevron" aria-hidden="true">▲</span>
  </button>

  <!-- 步骤内容体 -->
  <div class="step-card__body" id="step-1-body" role="region">

    <!-- 输入数据代码块 -->
    <div class="step-card__input-block" role="group" aria-label="输入数据">
      <div class="step-card__input-row">
        <span class="step-card__input-key">关联工单数</span>
        <span class="step-card__input-val">
          <!-- 可点击数字，弹出工单列表 popover -->
          <button
            class="step-card__link-num font-tabular"
            type="button"
            aria-haspopup="true"
            aria-expanded="false"
            aria-label="关联工单 3 个，点击查看详情"
          >3 个工单</button>
        </span>
      </div>
      <div class="step-card__input-row">
        <span class="step-card__input-key">合计需求量</span>
        <span class="step-card__input-val font-tabular">50 件</span>
      </div>
      <div class="step-card__input-row">
        <span class="step-card__input-key">当前可用库存</span>
        <span class="step-card__input-val font-tabular">20 件</span>
      </div>
      <div class="step-card__input-row">
        <span class="step-card__input-key">当前在途数量</span>
        <span class="step-card__input-val font-tabular">0 件</span>
      </div>
    </div>

    <!-- 计算公式行 -->
    <div class="step-card__formula">
      <code class="step-card__formula-code">
        缺口量 = 50 - 20 - 0 = <strong>30 件</strong>
      </code>
    </div>

    <!-- 步骤结论 -->
    <div class="step-card__conclusion step-card__conclusion--warn" role="note">
      <span class="step-card__conclusion-icon" aria-hidden="true">⚠</span>
      <span>存在生产缺口 <strong>30 件</strong>，需采购补充</span>
    </div>

  </div>
</article>

<!-- 步骤二（折叠态示例） -->
<article
  class="step-card step-card--done"
  aria-label="步骤二：安全库存补充，已完成（折叠）"
>
  <button
    class="step-card__header"
    aria-expanded="false"
    aria-controls="step-2-body"
    type="button"
  >
    <div class="step-card__connector-wrap">
      <span class="step-card__badge" aria-hidden="true">✓</span>
      <span class="step-card__line" aria-hidden="true"></span>
    </div>
    <div class="step-card__title-area">
      <span class="step-card__step-label">步骤二</span>
      <h3 class="step-card__title">安全库存补充</h3>
    </div>
    <span class="step-card__status-tag step-card__status-tag--done" aria-hidden="true">已完成</span>
    <span class="step-card__chevron" aria-hidden="true">▼</span>
  </button>
  <div class="step-card__body step-card__body--collapsed" id="step-2-body" hidden>
    <!-- 折叠时 hidden，展开后移除 hidden -->
  </div>
</article>
```

```css
/* StepCalculationCard.module.css */

.step-card {
  position: relative;
  border: 1px solid var(--step-card-border-default, var(--border-default));
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  overflow: hidden;
  transition: border-color var(--transition-base);
}

/* 状态变体边框 */
.step-card--done   { border-color: var(--step-card-border-done); }
.step-card--active { border-color: var(--step-card-border-active); }

/* 头部按钮（全宽可点击） */
.step-card__header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--step-card-padding, var(--space-4));
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast);
}

.step-card__header:hover {
  background: var(--color-gray-50);
}

.step-card__header:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: -2px;
}

/* 左侧序号 + 连接线 */
.step-card__connector-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
}

.step-card__badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--step-badge-size, 1.5rem);
  height: var(--step-badge-size, 1.5rem);
  border-radius: var(--step-badge-radius, 9999px);
  font-size: var(--text-body-s);
  font-weight: 700;
  flex-shrink: 0;
}

.step-card--done   .step-card__badge { background: var(--step-done-bg);    color: var(--step-done-text); }
.step-card--active .step-card__badge { background: var(--step-active-bg);  color: var(--step-active-text); }
.step-card--pending .step-card__badge { background: var(--step-pending-bg); color: var(--step-pending-text); }

/* 步骤连接线（最后一步由 JS 控制不显示） */
.step-card__line {
  width: var(--step-connector-width, 2px);
  flex: 1;
  min-height: 4px;
  background: var(--step-connector-color, var(--color-gray-200));
  display: none; /* 连接线在步骤列表容器中控制，此处预留 */
}

/* 标题区 */
.step-card__title-area {
  flex: 1;
  min-width: 0;
}

.step-card__step-label {
  font-size: var(--text-caption);
  color: var(--text-secondary);
  font-weight: 500;
  display: block;
}

.step-card__title {
  font-size: var(--text-body-m);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 状态标签 */
.step-card__status-tag {
  font-size: var(--text-caption);
  font-weight: 500;
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  white-space: nowrap;
  flex-shrink: 0;
}

.step-card__status-tag--done {
  background: var(--step-done-bg);
  color: var(--step-done-text);
}

.step-card__status-tag--active {
  background: var(--step-active-bg);
  color: var(--step-active-text);
}

/* 折叠箭头 */
.step-card__chevron {
  font-size: var(--text-caption);
  color: var(--text-secondary);
  flex-shrink: 0;
  transition: transform var(--transition-base);
}

/* 内容体 */
.step-card__body {
  padding: 0 var(--step-card-padding, var(--space-4)) var(--step-card-padding, var(--space-4));
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  /* height 过渡：JS 控制 max-height 实现展开动画 */
  max-height: 600px;
  overflow: hidden;
  transition: max-height 0.3s ease;
}

.step-card__body--collapsed {
  max-height: 0;
  padding-bottom: 0;
}

/* 输入数据块 */
.step-card__input-block {
  background: var(--step-formula-bg, var(--color-gray-50));
  border: 1px solid var(--step-formula-border, var(--color-gray-200));
  border-radius: var(--radius-md);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.step-card__input-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-4);
}

.step-card__input-key {
  font-size: var(--text-body-s);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.step-card__input-val {
  font-size: var(--text-body-s);
  color: var(--text-primary);
  font-weight: 500;
  text-align: right;
}

/* 可点击数字链接 */
.step-card__link-num {
  background: none;
  border: none;
  padding: 0;
  font-size: var(--text-body-s);
  font-weight: 600;
  color: var(--color-primary-600);
  text-decoration: underline;
  text-decoration-style: dashed;
  cursor: pointer;
  font-family: var(--font-family-number);
  font-variant-numeric: tabular-nums;
}

.step-card__link-num:hover {
  color: var(--color-primary-700);
  text-decoration-style: solid;
}

.step-card__link-num:focus-visible {
  outline: 2px solid var(--border-focus);
  border-radius: var(--radius-sm);
  outline-offset: 2px;
}

/* 计算公式行 */
.step-card__formula {
  background: var(--step-formula-bg, var(--color-gray-50));
  border-left: 3px solid var(--color-ai-400);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  padding: var(--space-2) var(--space-3);
}

.step-card__formula-code {
  font-family: var(--step-formula-mono, var(--font-family-mono));
  font-size: var(--text-body-s);
  color: var(--step-formula-text, var(--color-gray-700));
  white-space: pre-wrap;
  word-break: break-all;
}

.step-card__formula-code strong {
  color: var(--color-ai-700);
  font-size: var(--text-body-m);
}

/* 步骤结论 */
.step-card__conclusion {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--text-body-s);
}

.step-card__conclusion--success {
  background: var(--color-success-50);
  color: var(--color-success-700);
}

.step-card__conclusion--warn {
  background: var(--color-warning-50, #FFFBEB);
  color: var(--color-warning-700);
}

.step-card__conclusion--danger {
  background: var(--color-error-50);
  color: var(--color-error-700);
}

.step-card__conclusion--info {
  background: var(--color-info-50);
  color: var(--color-info-700);
}

.step-card__conclusion-icon {
  flex-shrink: 0;
  margin-top: 1px;
}
```

---

### 组件三：排产建议工单行（ScheduleWorkOrderRow）

```html
<!--
  [artifact:UI代码] ScheduleWorkOrderRow
  BEM: .schedule-wo-row[--expanded|--urgent]
-->
<article
  class="schedule-wo-row schedule-wo-row--urgent"
  aria-label="工单 WO-2026-001，软包大床 1.8m，优先级 95 分"
>
  <!-- 折叠态头部（始终显示） -->
  <button
    class="schedule-wo-row__header"
    aria-expanded="true"
    aria-controls="wo-001-detail"
    type="button"
  >
    <!-- 排名徽章 -->
    <span class="schedule-wo-row__rank schedule-wo-row__rank--1" aria-label="第 1 优先">1</span>

    <!-- 工单信息 -->
    <div class="schedule-wo-row__info">
      <div class="schedule-wo-row__title-row">
        <span class="schedule-wo-row__order-no">WO-2026-001</span>
        <!-- 紧急标签（urgent 时显示） -->
        <span class="schedule-wo-row__urgent-tag" aria-label="紧急工单">
          ⚡ 紧急
        </span>
      </div>
      <div class="schedule-wo-row__subtitle">
        <span class="schedule-wo-row__product">软包大床 1.8m</span>
        <span class="schedule-wo-row__meta-sep" aria-hidden="true">·</span>
        <span class="schedule-wo-row__deadline">
          计划完工：
          <time
            datetime="2026-03-17"
            class="schedule-wo-row__deadline-date schedule-wo-row__deadline-date--tight"
          >03-17</time>
        </span>
      </div>
    </div>

    <!-- 优先级总分 -->
    <div class="schedule-wo-row__score" aria-label="优先级 95 分，满分 100 分">
      <span class="schedule-wo-row__score-num font-tabular">95</span>
      <span class="schedule-wo-row__score-denom">/100 分</span>
    </div>

    <!-- 展开箭头 -->
    <span class="schedule-wo-row__chevron" aria-hidden="true">▲</span>
  </button>

  <!-- 展开态详情 -->
  <div
    class="schedule-wo-row__detail"
    id="wo-001-detail"
    role="region"
    aria-label="WO-2026-001 排产建议详情"
  >
    <!-- 三维得分分项 -->
    <section class="schedule-wo-row__scores-section" aria-label="优先级得分详情">

      <!-- 交期紧迫度 -->
      <div class="score-item">
        <div class="score-item__header">
          <span class="score-item__label">交期紧迫度</span>
          <span class="score-item__value font-tabular" aria-label="交期紧迫度 47 分，满分 50 分">
            <strong>47</strong><span>/50</span>
          </span>
        </div>
        <div class="score-item__bar-track" role="progressbar" aria-valuenow="47" aria-valuemin="0" aria-valuemax="50">
          <div class="score-item__bar-fill score-item__bar-fill--a" style="width: 94%"></div>
        </div>
        <p class="score-item__desc">
          剩余 <strong>3 天</strong>，剩余工时需求 <strong>16h</strong>，
          工期余裕 <strong class="score-item__tight">-8h</strong>（已超期风险）
        </p>
      </div>

      <!-- 订单优先级 -->
      <div class="score-item">
        <div class="score-item__header">
          <span class="score-item__label">订单优先级</span>
          <span class="score-item__value font-tabular" aria-label="订单优先级 30 分，满分 30 分">
            <strong>30</strong><span>/30</span>
          </span>
        </div>
        <div class="score-item__bar-track" role="progressbar" aria-valuenow="30" aria-valuemin="0" aria-valuemax="30">
          <div class="score-item__bar-fill score-item__bar-fill--b" style="width: 100%"></div>
        </div>
        <p class="score-item__desc">
          关联销售订单：SO-2026-058，优先级：<strong>紧急插单</strong>
        </p>
      </div>

      <!-- 物料就绪度 -->
      <div class="score-item">
        <div class="score-item__header">
          <span class="score-item__label">物料就绪度</span>
          <span class="score-item__value font-tabular" aria-label="物料就绪度 18 分，满分 20 分">
            <strong>18</strong><span>/20</span>
          </span>
        </div>
        <div class="score-item__bar-track" role="progressbar" aria-valuenow="18" aria-valuemin="0" aria-valuemax="20">
          <div class="score-item__bar-fill score-item__bar-fill--c" style="width: 90%"></div>
        </div>
        <p class="score-item__desc">
          物料基本齐套，1 种辅料在途（预计 3/16 到货）
        </p>
      </div>

    </section>

    <!-- 工人推荐 -->
    <section class="schedule-wo-row__workers-section" aria-label="工人产能建议">
      <h4 class="schedule-wo-row__section-title">工人产能建议</h4>
      <div class="worker-grid">

        <!-- 工人卡片：推荐（空闲） -->
        <div class="worker-card worker-card--idle" role="listitem">
          <div class="worker-card__header">
            <span class="worker-card__name">王师傅</span>
            <span class="worker-card__recommend worker-card__recommend--ok" aria-label="推荐分配">
              推荐 ✓
            </span>
          </div>
          <div class="worker-card__load">
            <span class="worker-card__load-num font-tabular">20h</span>
            <span class="worker-card__load-sep">/</span>
            <span class="worker-card__load-total font-tabular">40h</span>
            <span class="worker-card__load-label">（空闲 50%）</span>
          </div>
          <div class="worker-card__bar-track">
            <div class="worker-card__bar-fill worker-card__bar-fill--idle" style="width: 50%"></div>
          </div>
        </div>

        <!-- 工人卡片：不推荐（过载） -->
        <div class="worker-card worker-card--overload" role="listitem">
          <!-- 过载半透明遮罩提示 -->
          <div class="worker-card__overload-mask" aria-hidden="true">过载</div>
          <div class="worker-card__header">
            <span class="worker-card__name">李师傅</span>
            <span class="worker-card__recommend worker-card__recommend--no" aria-label="不推荐，已过载">
              过载 ✗
            </span>
          </div>
          <div class="worker-card__load">
            <span class="worker-card__load-num font-tabular" style="color: var(--color-error-600)">42h</span>
            <span class="worker-card__load-sep">/</span>
            <span class="worker-card__load-total font-tabular">40h</span>
            <span class="worker-card__load-label">（超载 105%）</span>
          </div>
          <div class="worker-card__bar-track">
            <div class="worker-card__bar-fill worker-card__bar-fill--overload" style="width: 100%"></div>
          </div>
        </div>

      </div>
    </section>

    <!-- 跳转排产 -->
    <div class="schedule-wo-row__footer">
      <a
        href="/production/schedule?workOrderId=WO-2026-001"
        class="schedule-wo-row__goto-link"
        aria-label="跳转到排产看板，处理工单 WO-2026-001"
      >
        跳转排产看板，开始正式排产 →
      </a>
    </div>
  </div>
</article>
```

```css
/* ScheduleWorkOrderRow.module.css */

.schedule-wo-row {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  overflow: hidden;
  transition: border-color var(--transition-base), box-shadow var(--transition-base);
}

.schedule-wo-row:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}

/* 紧急工单左边框高亮 */
.schedule-wo-row--urgent {
  border-left: 3px solid var(--color-error-500);
}

/* ── 头部（按钮） */
.schedule-wo-row__header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast);
}

.schedule-wo-row__header:hover {
  background: var(--color-gray-50);
}

.schedule-wo-row__header:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: -2px;
}

/* 排名徽章 */
.schedule-wo-row__rank {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--rank-badge-size, 2rem);
  height: var(--rank-badge-size, 2rem);
  border-radius: var(--radius-full);
  font-size: var(--text-body-s);
  font-weight: 700;
  flex-shrink: 0;
  font-family: var(--font-family-number);
}

.schedule-wo-row__rank--1 {
  background: var(--rank-badge-1-bg);
  color: var(--rank-badge-1-text);
}

.schedule-wo-row__rank--2,
.schedule-wo-row__rank--3 {
  background: var(--rank-badge-2-bg);
  color: var(--rank-badge-2-text);
}

.schedule-wo-row__rank--n {
  background: var(--rank-badge-n-bg);
  color: var(--rank-badge-n-text);
}

/* 工单信息 */
.schedule-wo-row__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.schedule-wo-row__title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.schedule-wo-row__order-no {
  font-size: var(--text-body-m);
  font-weight: 600;
  color: var(--text-primary);
  font-family: var(--font-family-mono);
}

.schedule-wo-row__urgent-tag {
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--color-error-700);
  background: var(--color-error-100);
  border: 1px solid var(--color-error-500);
  padding: 1px var(--space-2);
  border-radius: var(--radius-full);
  white-space: nowrap;
}

.schedule-wo-row__subtitle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.schedule-wo-row__product {
  font-size: var(--text-body-s);
  color: var(--text-primary);
}

.schedule-wo-row__meta-sep {
  color: var(--text-disabled);
}

.schedule-wo-row__deadline {
  font-size: var(--text-body-s);
  color: var(--text-secondary);
}

.schedule-wo-row__deadline-date--tight  { color: var(--deadline-tight-color,  var(--color-error-600)); font-weight: 600; }
.schedule-wo-row__deadline-date--normal { color: var(--deadline-normal-color, var(--color-warning-600)); }
.schedule-wo-row__deadline-date--safe   { color: var(--deadline-safe-color,   var(--color-success-600)); }

/* 优先级总分 */
.schedule-wo-row__score {
  display: flex;
  align-items: baseline;
  gap: 2px;
  flex-shrink: 0;
}

.schedule-wo-row__score-num {
  font-size: var(--score-total-size, var(--text-number-m));
  font-weight: 700;
  color: var(--score-total-color, var(--text-primary));
}

.schedule-wo-row__score-denom {
  font-size: var(--text-caption);
  color: var(--text-secondary);
}

/* 折叠箭头 */
.schedule-wo-row__chevron {
  font-size: var(--text-caption);
  color: var(--text-secondary);
  transition: transform var(--transition-base);
  flex-shrink: 0;
}

/* ── 展开态详情 */
.schedule-wo-row__detail {
  padding: 0 var(--space-4) var(--space-4);
  border-top: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  animation: result-appear 0.3s ease forwards;
}

/* ── 得分分项 */
.score-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.score-item__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.score-item__label {
  font-size: var(--text-body-s);
  color: var(--text-secondary);
  font-weight: 500;
}

.score-item__value {
  font-size: var(--text-body-s);
  color: var(--text-primary);
}

.score-item__value strong {
  font-size: var(--text-body-m);
  font-weight: 700;
}

/* 得分进度条 */
.score-item__bar-track {
  height: var(--score-bar-height, 6px);
  background: var(--score-bar-track, var(--color-gray-100));
  border-radius: var(--radius-full);
  overflow: hidden;
}

.score-item__bar-fill {
  height: 100%;
  border-radius: var(--radius-full);
  transition: width 0.4s ease-out;
  transition-delay: 0.1s;
}

.score-item__bar-fill--a { background: var(--score-bar-fill-a, var(--color-error-500)); }
.score-item__bar-fill--b { background: var(--score-bar-fill-b, var(--color-warning-500)); }
.score-item__bar-fill--c { background: var(--score-bar-fill-c, var(--color-success-500)); }

.score-item__desc {
  font-size: var(--text-body-s);
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

.score-item__tight {
  color: var(--color-error-600);
  font-weight: 700;
}

/* ── 工人卡片网格 */
.schedule-wo-row__section-title {
  font-size: var(--text-body-s);
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0 0 var(--space-2) 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.worker-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-3);
}

@media (max-width: 480px) {
  .worker-grid { grid-template-columns: 1fr; }
}

/* 工人卡片 */
.worker-card {
  position: relative;
  border-radius: var(--radius-md);
  padding: var(--space-3);
  border: 1px solid var(--border-default);
  border-left-width: 3px;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  transition: box-shadow var(--transition-fast);
}

.worker-card:hover {
  box-shadow: var(--shadow-sm);
}

.worker-card--idle    { border-left-color: var(--color-success-500); }
.worker-card--normal  { border-left-color: var(--color-primary-500); }
.worker-card--overload {
  border-left-color: var(--color-error-500);
  opacity: 0.75;
}

/* 过载遮罩（文字提示） */
.worker-card__overload-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-body-s);
  font-weight: 700;
  color: var(--color-error-600);
  background: rgba(254, 226, 226, 0.3);
  border-radius: var(--radius-md);
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.worker-card--overload:hover .worker-card__overload-mask {
  opacity: 1;
}

.worker-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.worker-card__name {
  font-size: var(--text-body-s);
  font-weight: 600;
  color: var(--text-primary);
}

.worker-card__recommend {
  font-size: var(--text-caption);
  font-weight: 600;
  padding: 1px var(--space-2);
  border-radius: var(--radius-full);
}

.worker-card__recommend--ok {
  background: var(--color-idle-bg, var(--color-success-100));
  color: var(--color-idle-text, var(--color-success-700));
}

.worker-card__recommend--no {
  background: var(--color-overload-bg, var(--color-error-100));
  color: var(--color-overload-text, var(--color-error-700));
}

.worker-card__load {
  display: flex;
  align-items: baseline;
  gap: 2px;
  font-size: var(--text-body-s);
  color: var(--text-secondary);
}

.worker-card__load-num   { font-weight: 700; color: var(--text-primary); }
.worker-card__load-label { font-size: var(--text-caption); color: var(--text-secondary); }

/* 工人工时进度条 */
.worker-card__bar-track {
  height: 4px;
  background: var(--color-gray-100);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.worker-card__bar-fill {
  height: 100%;
  border-radius: var(--radius-full);
  transition: width 0.4s ease-out;
}

.worker-card__bar-fill--idle    { background: var(--color-success-500); }
.worker-card__bar-fill--normal  { background: var(--color-primary-500); }
.worker-card__bar-fill--overload { background: var(--color-error-500); }

/* ── 跳转按钮 */
.schedule-wo-row__footer {
  padding-top: var(--space-2);
  border-top: 1px dashed var(--border-default);
}

.schedule-wo-row__goto-link {
  font-size: var(--text-body-s);
  color: var(--color-primary-600);
  text-decoration: none;
  font-weight: 500;
  transition: color var(--transition-fast);
}

.schedule-wo-row__goto-link:hover {
  color: var(--color-primary-700);
  text-decoration: underline;
}

.schedule-wo-row__goto-link:focus-visible {
  outline: 2px solid var(--border-focus);
  border-radius: var(--radius-sm);
  outline-offset: 2px;
}
```

---

### 组件四：数据冷启动横幅（ColdStartBanner）

```html
<!--
  [artifact:UI代码] ColdStartBanner
  BEM: .cold-start-banner
  animation: banner-slide-down on mount
-->
<aside
  class="cold-start-banner"
  role="note"
  aria-label="数据积累不足提示"
>
  <span class="cold-start-banner__icon" aria-hidden="true">⚠</span>
  <div class="cold-start-banner__content">
    <strong class="cold-start-banner__title">数据积累提示</strong>
    <p class="cold-start-banner__desc">
      当前系统数据积累 <strong>7 天</strong>，建议参考价值有限，
      建议以规则参数为主、计算结果为辅进行决策。
    </p>
  </div>
  <button
    class="cold-start-banner__close"
    type="button"
    aria-label="关闭数据积累提示"
  >
    ×
  </button>
</aside>
```

```css
/* ColdStartBanner.module.css */

.cold-start-banner {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--color-coldstart-bg, #FFFBEB);
  border: 1px solid var(--color-coldstart-border, #F59E0B);
  border-left-width: 4px;
  border-radius: var(--radius-md);
  animation: banner-slide-down 0.3s ease forwards;
  margin-bottom: var(--space-4);
}

.cold-start-banner__icon {
  font-size: 1.125rem;
  color: var(--color-coldstart-icon, #F59E0B);
  flex-shrink: 0;
  margin-top: 1px;
}

.cold-start-banner__content {
  flex: 1;
  min-width: 0;
}

.cold-start-banner__title {
  font-size: var(--text-body-s);
  font-weight: 700;
  color: var(--color-coldstart-text, #92400E);
  display: block;
  margin-bottom: var(--space-1);
}

.cold-start-banner__desc {
  font-size: var(--text-body-s);
  color: var(--color-coldstart-text, #92400E);
  margin: 0;
  line-height: 1.5;
}

.cold-start-banner__close {
  background: none;
  border: none;
  padding: var(--space-1);
  cursor: pointer;
  color: var(--color-coldstart-icon, #F59E0B);
  font-size: 1.25rem;
  line-height: 1;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.cold-start-banner__close:hover {
  background: rgba(245, 158, 11, 0.1);
}

.cold-start-banner__close:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}
```

---

### 组件五：错误态旧数据叠加条（StaleDataBar）

```html
<!--
  [artifact:UI代码] StaleDataBar
  计算失败时插入到建议列表顶部
  列表区域整体 opacity: 0.7 + pointer-events: none
-->
<div class="stale-data-bar" role="alert" aria-live="assertive">
  <span class="stale-data-bar__icon" aria-hidden="true">⚠</span>
  <span class="stale-data-bar__text">
    上次计算于 <time datetime="2026-03-14T08:30:00">今日 08:30</time> 失败，
    以下数据为上次成功结果，仅供参考
  </span>
  <button class="stale-data-bar__retry" type="button">
    重试计算
  </button>
</div>
```

```css
/* StaleDataBar.module.css */

.stale-data-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-4);
  height: 44px;
  background: var(--color-error-50);
  border-bottom: 1px solid var(--color-error-200);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  animation: stale-overlay-in 0.2s ease forwards;
  flex-shrink: 0;
}

.stale-data-bar__icon {
  color: var(--color-error-500);
  flex-shrink: 0;
}

.stale-data-bar__text {
  font-size: var(--text-body-s);
  color: var(--color-error-700);
  flex: 1;
  min-width: 0;
}

.stale-data-bar__retry {
  background: none;
  border: 1px solid var(--color-error-500);
  color: var(--color-error-600);
  font-size: var(--text-body-s);
  font-weight: 600;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-sm);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.stale-data-bar__retry:hover {
  background: var(--color-error-600);
  color: var(--text-on-primary);
}

.stale-data-bar__retry:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}
```

---

### 组件六：看板主布局结构（ScheduleSuggestionPage 骨架）

```html
<!--
  [artifact:UI代码] ScheduleSuggestionPage 整体布局骨架
  供 @senior-frontend-engineer 参照转写 TSX 结构
-->
<div class="schedule-page">

  <!-- 页面标题行 -->
  <div class="schedule-page__head">
    <div class="schedule-page__head-left">
      <h1 class="schedule-page__title">智能调度</h1>
      <p class="schedule-page__subtitle">
        <span class="schedule-page__engine-tag">基于规则计算</span>
        <span class="schedule-page__sep" aria-hidden="true">·</span>
        最后更新：<time datetime="2026-03-14T10:30:00">2026-03-14 10:30</time>
      </p>
    </div>
    <div class="schedule-page__head-right">
      <!-- 计算中脉冲波浪（计算中态显示） -->
      <span class="schedule-page__calc-indicator" aria-live="polite" hidden>
        <span class="pulse-wave">
          <span class="pulse-wave__bar"></span>
          <span class="pulse-wave__bar"></span>
          <span class="pulse-wave__bar"></span>
        </span>
        <span class="schedule-page__calc-text">正在分析调度方案...</span>
      </span>
      <!-- 重新计算按钮 -->
      <button class="btn btn--secondary btn--md" type="button" aria-label="重新计算调度建议">
        重新计算
      </button>
    </div>
  </div>

  <!-- 冷启动横幅（按需显示） -->
  <!-- <aside class="cold-start-banner">...</aside> -->

  <!-- 顶部统计卡片行 -->
  <div class="schedule-page__stat-grid" role="list" aria-label="调度建议摘要统计">
    <!-- 四个 ScheduleStatCard，通过 role="listitem" -->
  </div>

  <!-- 主体双列区 -->
  <div class="schedule-page__body">

    <!-- 左区：采购建议（admin 可见） -->
    <section class="schedule-page__left" aria-label="智能采购建议">
      <!-- 区块标题 + 批量操作 -->
      <div class="schedule-page__section-head">
        <h2 class="schedule-page__section-title">采购建议</h2>
        <div class="schedule-page__section-actions">
          <button class="btn btn--ghost btn--sm" type="button">批量选择</button>
          <button class="btn btn--primary btn--sm" type="button" disabled>
            批量确认接受
          </button>
        </div>
      </div>

      <!-- 建议列表（或骨架屏、空态、错误态） -->
      <div class="schedule-page__suggestion-list">
        <!-- 错误态 StaleDataBar 插入此处 -->
        <!-- 列表项... -->
      </div>
    </section>

    <!-- 右区：排产建议 -->
    <section class="schedule-page__right" aria-label="智能排产建议">
      <!-- 区块标题 + 应用建议 -->
      <div class="schedule-page__section-head">
        <h2 class="schedule-page__section-title">排产建议</h2>
        <button class="btn btn--primary btn--sm" type="button">
          应用建议
        </button>
      </div>

      <!-- 工单列表（或骨架屏、空态、错误态） -->
      <div class="schedule-page__wo-list">
        <!-- ScheduleWorkOrderRow 列表... -->
      </div>
    </section>

  </div>

  <!-- 历史记录 Tab -->
  <div class="schedule-page__tabs">
    <div class="tab-bar" role="tablist" aria-label="调度建议视图切换">
      <button class="tab-bar__tab tab-bar__tab--active" role="tab" aria-selected="true">当前建议</button>
      <button class="tab-bar__tab" role="tab" aria-selected="false">历史记录</button>
    </div>
    <!-- Tab 内容面板 -->
    <div class="schedule-page__tab-panel">
      <!-- 历史记录列表... -->
    </div>
  </div>

</div>
```

```css
/* ScheduleSuggestionPage.module.css */

.schedule-page {
  padding: var(--layout-page-padding, 24px);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  background: var(--bg-page);
  min-height: 100%;
}

/* 标题行 */
.schedule-page__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.schedule-page__title {
  font-size: var(--text-h2);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.schedule-page__subtitle {
  font-size: var(--text-body-s);
  color: var(--text-secondary);
  margin: var(--space-1) 0 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.schedule-page__engine-tag {
  background: var(--tag-ai-calc-bg, var(--color-ai-100));
  color: var(--tag-ai-calc-text, var(--color-ai-700));
  border: 1px solid var(--tag-ai-calc-border, var(--color-ai-200));
  font-size: var(--text-caption);
  font-weight: 500;
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
}

.schedule-page__sep {
  color: var(--text-disabled);
}

.schedule-page__head-right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.schedule-page__calc-indicator {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.schedule-page__calc-text {
  font-size: var(--text-body-s);
  color: var(--color-ai-600);
  font-weight: 500;
}

/* 统计卡片行 */
.schedule-page__stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--layout-card-gap, 16px);
}

/* 主体双列 */
.schedule-page__body {
  display: grid;
  grid-template-columns: var(--layout-schedule-left, 60%) 1fr;
  gap: var(--layout-card-gap, 16px);
  align-items: start;
}

/* 区块头部 */
.schedule-page__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
}

.schedule-page__section-title {
  font-size: var(--text-h4);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.schedule-page__section-actions {
  display: flex;
  gap: var(--space-2);
}

/* 建议列表容器 */
.schedule-page__suggestion-list,
.schedule-page__wo-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* 历史记录 Tab */
.schedule-page__tabs {
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.tab-bar {
  display: flex;
  border-bottom: 1px solid var(--border-default);
}

.tab-bar__tab {
  padding: var(--space-3) var(--space-5);
  font-size: var(--text-body-m);
  font-weight: 500;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color var(--transition-fast), border-color var(--transition-fast);
  margin-bottom: -1px;
}

.tab-bar__tab:hover {
  color: var(--text-primary);
}

.tab-bar__tab--active {
  color: var(--color-primary-600);
  border-bottom-color: var(--color-primary-500);
  font-weight: 600;
}

.tab-bar__tab:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: -2px;
}

.schedule-page__tab-panel {
  padding: var(--space-4);
  animation: fade-in 0.15s ease;
}

/* ── 响应式 */
@media (max-width: 1023px) {
  .schedule-page__body {
    grid-template-columns: 1fr;
  }
  .schedule-page__stat-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 767px) {
  .schedule-page {
    padding: var(--space-4);
    gap: var(--space-4);
  }
  .schedule-page__stat-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .schedule-page__head {
    flex-direction: column;
    gap: var(--space-3);
  }
  .schedule-page__head-right {
    width: 100%;
    justify-content: flex-end;
  }
}

@media (max-width: 479px) {
  .schedule-page__stat-grid {
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
}
```

---

## 附录 A：无障碍（WCAG 2.1 AA）检查清单

| 检查项 | 实现方式 |
|---|---|
| 色彩对比度 | 所有文字/背景组合对比度 >= 4.5:1（正文），大字号 >= 3:1 |
| 键盘导航 | 所有交互元素可 Tab 聚焦，focus-visible 样式可见 |
| 屏幕阅读器 | 统计卡片、工单行、得分条均有 aria-label |
| 动态内容 | 计算中/完成/失败状态通过 aria-live 区域播报 |
| 进度条 | role="progressbar" + aria-valuenow/min/max |
| 骨架屏 | role="status" + aria-busy="true" + aria-label |
| 弹窗/抽屉 | role="dialog" + aria-modal="true" + 焦点捕获 |
| 表单 | label 显式关联 input，必填项 aria-required="true" |
| 图标 | 纯装饰图标 aria-hidden="true"，功能图标有 aria-label |

---

## 附录 B：组件交付索引（移交 @senior-frontend-engineer）

| 组件名 | 文件路径（建议） | 依赖现有组件 |
|---|---|---|
| ScheduleStatCard | `components/schedule/ScheduleStatCard.tsx` | KpiCard |
| StepCalculationCard | `components/schedule/StepCalculationCard.tsx` | Skeleton |
| ScheduleWorkOrderRow | `components/schedule/ScheduleWorkOrderRow.tsx` | Tag、Button |
| ColdStartBanner | `components/schedule/ColdStartBanner.tsx` | 无 |
| StaleDataBar | `components/schedule/StaleDataBar.tsx` | Button |
| CalcStepDrawer | `components/schedule/CalcStepDrawer.tsx` | Drawer、StepCalculationCard、Modal |
| ScheduleSuggestionPage | `pages/schedule/ScheduleSuggestionPage.tsx` | 以上全部 |
| ScheduleSuggestionWidget | `components/schedule/ScheduleSuggestionWidget.tsx` | ScheduleStatCard |

**CSS 变量追加位置**：`services/web/src/styles/variables.css`，追加到 `:root` 块末尾的"Sprint 4 扩展"注释区域。

---

## 附录 C：移交说明

**移交 @senior-frontend-engineer**：
- 本文档 [artifact:UI代码] 部分为 HTML/CSS 参考实现，需转写为 React + CSS Modules（TypeScript）
- 所有新增 CSS 变量须先追加至 `services/web/src/styles/variables.css`
- 新增动画 Keyframe 追加至 `services/web/src/styles/global.css`
- 组件 props 类型设计参照现有 KpiCard、Drawer 的 interface 风格

**提醒 @senior-qa-engineer 走查**：
- 响应式断点（480px / 768px / 1024px）全部验证
- 四种 AI 状态（计算中/完成/失败/空态）在各断点下的视觉一致性
- 键盘导航全路径验证（Tab 顺序、Escape 关闭弹窗/抽屉）
- 暗色模式下新增色值（--color-ai-*、--heatmap-*）对比度验证

**确认 @senior-backend-engineer**：
- `/schedule-suggestions/status` 接口返回字段（status / calculated_at / data_basis_days）
- `/schedule-suggestions/latest` 返回数据结构（统计数字、建议列表、步骤数据）
- `/dashboard/schedule-summary` 返回字段（各类 count + has_overload + calculating 状态）

---

*文档版本*：v1.0
*创建日期*：2026-03-14
*负责人*：@senior-ui-designer
*状态*：待 @senior-frontend-engineer 领取并转写实现，待 @senior-qa-engineer 走查
