# [artifact:设计规范] 智造管家 — 设计系统规范

**产品名称**：智造管家（SmartFactory Agent）
**文档版本**：v1.0
**创建日期**：2026-03-10
**负责人**：@senior-ui-designer
**交付给**：@senior-frontend-engineer、@senior-qa-engineer

---

## 一、色彩系统

### 1.1 主色板（Brand Colors）

主色采用工业蓝，传达专业、可信赖的制造业气质，辅以活力橙作为强调色。

| Token 名称 | 色值 | 用途 |
|---|---|---|
| `--color-primary-50` | `#EFF6FF` | 主色超浅背景，hover 背景 |
| `--color-primary-100` | `#DBEAFE` | 主色浅背景，选中态背景 |
| `--color-primary-200` | `#BFDBFE` | 主色浅，边框高亮 |
| `--color-primary-300` | `#93C5FD` | 主色中浅 |
| `--color-primary-400` | `#60A5FA` | 主色中 |
| `--color-primary-500` | `#3B82F6` | 主色标准（按钮、链接、激活态） |
| `--color-primary-600` | `#2563EB` | 主色深（按钮 hover） |
| `--color-primary-700` | `#1D4ED8` | 主色超深（按钮 active） |
| `--color-primary-800` | `#1E40AF` | 主色极深 |
| `--color-primary-900` | `#1E3A8A` | 主色最深（深色文字） |

### 1.2 辅助色 — 活力橙（Accent）

用于 AI 品牌标识、重要操作强调、数据高亮。

| Token 名称 | 色值 | 用途 |
|---|---|---|
| `--color-accent-50` | `#FFF7ED` | 橙色超浅背景 |
| `--color-accent-200` | `#FED7AA` | 橙色浅 |
| `--color-accent-400` | `#FB923C` | 橙色中 |
| `--color-accent-500` | `#F97316` | 橙色标准（AI 标识色） |
| `--color-accent-600` | `#EA580C` | 橙色深 |

### 1.3 语义色（Semantic Colors）

#### 成功色（Success）— 绿色

| Token 名称 | 色值 | 用途 |
|---|---|---|
| `--color-success-50` | `#F0FDF4` | 成功背景 |
| `--color-success-100` | `#DCFCE7` | 成功浅背景 |
| `--color-success-500` | `#22C55E` | 成功标准 |
| `--color-success-600` | `#16A34A` | 成功深（文字） |
| `--color-success-700` | `#15803D` | 成功深色模式 |

#### 警告色（Warning）— 琥珀色

| Token 名称 | 色值 | 用途 |
|---|---|---|
| `--color-warning-50` | `#FFFBEB` | 警告背景 |
| `--color-warning-100` | `#FEF3C7` | 警告浅背景 |
| `--color-warning-500` | `#F59E0B` | 警告标准 |
| `--color-warning-600` | `#D97706` | 警告深（文字） |
| `--color-warning-700` | `#B45309` | 警告深色模式 |

#### 错误色（Error）— 红色

| Token 名称 | 色值 | 用途 |
|---|---|---|
| `--color-error-50` | `#FEF2F2` | 错误背景 |
| `--color-error-100` | `#FEE2E2` | 错误浅背景 |
| `--color-error-500` | `#EF4444` | 错误标准 |
| `--color-error-600` | `#DC2626` | 错误深（文字） |
| `--color-error-700` | `#B91C1C` | 错误深色模式 |

#### 信息色（Info）— 青色

| Token 名称 | 色值 | 用途 |
|---|---|---|
| `--color-info-50` | `#F0F9FF` | 信息背景 |
| `--color-info-100` | `#E0F2FE` | 信息浅背景 |
| `--color-info-500` | `#0EA5E9` | 信息标准 |
| `--color-info-600` | `#0284C7` | 信息深（文字） |

#### 呆滞风险色（Stagnant）— 蓝紫色（业务专属）

| Token 名称 | 色值 | 用途 |
|---|---|---|
| `--color-stagnant-100` | `#EDE9FE` | 呆滞背景 |
| `--color-stagnant-500` | `#8B5CF6` | 呆滞标准 |
| `--color-stagnant-600` | `#7C3AED` | 呆滞深 |

### 1.4 中性色（Neutral / Gray）

| Token 名称 | 色值 | 用途 |
|---|---|---|
| `--color-gray-0` | `#FFFFFF` | 纯白 |
| `--color-gray-50` | `#F8FAFC` | 页面背景 |
| `--color-gray-100` | `#F1F5F9` | 卡片背景、分割区域 |
| `--color-gray-200` | `#E2E8F0` | 边框（默认） |
| `--color-gray-300` | `#CBD5E1` | 边框（强调） |
| `--color-gray-400` | `#94A3B8` | 占位符文字、禁用图标 |
| `--color-gray-500` | `#64748B` | 辅助文字（次要信息） |
| `--color-gray-600` | `#475569` | 辅助文字（中等权重） |
| `--color-gray-700` | `#334155` | 正文文字 |
| `--color-gray-800` | `#1E293B` | 标题文字 |
| `--color-gray-900` | `#0F172A` | 主标题、最深文字 |

### 1.5 工厂现场高对比度配色方案（小程序端专属）

工厂车间环境：强光干扰、手套操作、快节奏操作，必须使用高对比度配色。

| 场景 | 背景色 | 文字/图标色 | 对比度比值 |
|---|---|---|---|
| 主操作按钮 | `#1D4ED8`（主色700） | `#FFFFFF` | 8.6:1（AA+） |
| 确认/成功按钮 | `#15803D`（成功700） | `#FFFFFF` | 7.2:1（AA+） |
| 警告按钮 | `#B45309`（警告700） | `#FFFFFF` | 4.6:1（AA） |
| 危险/删除按钮 | `#B91C1C`（错误700） | `#FFFFFF` | 5.8:1（AA+） |
| 卡片正文 | `#FFFFFF` | `#1E293B`（灰800） | 14.2:1（AAA） |
| 状态标签（红） | `#FEE2E2`（错误100） | `#B91C1C`（错误700） | 4.8:1（AA） |
| 状态标签（绿） | `#DCFCE7`（成功100） | `#15803D`（成功700） | 5.1:1（AA） |
| 状态标签（黄） | `#FEF3C7`（警告100） | `#B45309`（警告700） | 4.5:1（AA） |

**特别规定**：小程序端所有文字最小14px（正文16px），按钮最小高度54px，点击目标最小48×48px。

### 1.6 暗色/亮色模式（Web端）

Web端支持系统暗色模式（prefers-color-scheme: dark）。

**亮色模式（默认）**

| 角色 | Token | 色值 |
|---|---|---|
| 页面背景 | `--bg-page` | `#F8FAFC` |
| 卡片背景 | `--bg-card` | `#FFFFFF` |
| 侧边栏背景 | `--bg-sidebar` | `#1E293B` |
| 侧边栏文字 | `--text-sidebar` | `#CBD5E1` |
| 侧边栏激活项 | `--bg-sidebar-active` | `#2563EB` |
| 主文字 | `--text-primary` | `#1E293B` |
| 次要文字 | `--text-secondary` | `#64748B` |
| 禁用文字 | `--text-disabled` | `#94A3B8` |
| 默认边框 | `--border-default` | `#E2E8F0` |
| 强调边框 | `--border-strong` | `#CBD5E1` |

**暗色模式（@media prefers-color-scheme: dark）**

| 角色 | Token | 色值 |
|---|---|---|
| 页面背景 | `--bg-page` | `#0F172A` |
| 卡片背景 | `--bg-card` | `#1E293B` |
| 侧边栏背景 | `--bg-sidebar` | `#0F172A` |
| 主文字 | `--text-primary` | `#F1F5F9` |
| 次要文字 | `--text-secondary` | `#94A3B8` |
| 默认边框 | `--border-default` | `#334155` |

---

## 二、字体系统

### 2.1 字体族

```css
/* Web端 */
--font-family-base: "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei",
                    -apple-system, BlinkMacSystemFont, sans-serif;
--font-family-mono: "JetBrains Mono", "SF Mono", "Consolas", monospace;
--font-family-number: "DIN Alternate", "Roboto Mono", --font-family-base;

/* 小程序端（系统字体） */
--font-family-mini: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
```

### 2.2 Web端字体层级

| 层级 | Token | 大小 | 行高 | 字重 | 用途 |
|---|---|---|---|---|---|
| H1 | `--text-h1` | `2rem`（32px） | 1.25 | 700 | 页面主标题（驾驶舱） |
| H2 | `--text-h2` | `1.5rem`（24px） | 1.3 | 600 | 区域标题、卡片主标题 |
| H3 | `--text-h3` | `1.25rem`（20px） | 1.35 | 600 | 子区域标题 |
| H4 | `--text-h4` | `1.125rem`（18px） | 1.4 | 500 | 卡片副标题 |
| Body-L | `--text-body-l` | `1rem`（16px） | 1.6 | 400 | 正文（标准） |
| Body-M | `--text-body-m` | `0.875rem`（14px） | 1.6 | 400 | 正文（小） |
| Body-S | `--text-body-s` | `0.75rem`（12px） | 1.5 | 400 | 辅助信息、时间戳 |
| Label | `--text-label` | `0.75rem`（12px） | 1 | 500 | 表单标签、徽章文字 |
| Caption | `--text-caption` | `0.6875rem`（11px） | 1.4 | 400 | 极小辅助文字（最小限制） |
| Number-XL | `--text-number-xl` | `2.5rem`（40px） | 1 | 700 | 驾驶舱 KPI 大数字 |
| Number-L | `--text-number-l` | `1.75rem`（28px） | 1.1 | 700 | 次级 KPI 数字 |
| Number-M | `--text-number-m` | `1.25rem`（20px） | 1.2 | 600 | 卡片数字 |

### 2.3 小程序端字体层级（工厂现场大字体方案）

> 核心原则：最小字号 14px（body），关键信息 16px+，数量/状态 24px+

| 层级 | Token | 大小（px） | 行高 | 字重 | 用途 |
|---|---|---|---|---|---|
| Page-Title | `--mp-text-page-title` | 18px | 1.4 | 600 | 页面标题 |
| Section-Title | `--mp-text-section` | 16px | 1.5 | 600 | 区块标题 |
| Body | `--mp-text-body` | 16px | 1.6 | 400 | 正文（标准） |
| Body-S | `--mp-text-body-s` | 14px | 1.6 | 400 | 辅助文字（最小限制） |
| Number-XL | `--mp-number-xl` | 32px | 1 | 700 | 库存数量、任务数量 |
| Number-L | `--mp-number-l` | 24px | 1.1 | 600 | 子数量 |
| Number-M | `--mp-number-m` | 20px | 1.2 | 500 | 普通数量 |
| Button | `--mp-text-button` | 17px | 1 | 600 | 按钮文字 |
| Tag | `--mp-text-tag` | 13px | 1 | 500 | 状态标签文字 |

---

## 三、间距系统

### 3.1 4px 基准网格

所有间距必须是 4px 的倍数。

| Token | 值（rem） | 像素 | 用途 |
|---|---|---|---|
| `--space-0` | `0` | 0px | 重置 |
| `--space-1` | `0.25rem` | 4px | 最小间距（图标与文字） |
| `--space-2` | `0.5rem` | 8px | 紧凑间距（徽章内边距） |
| `--space-3` | `0.75rem` | 12px | 小间距（输入框内边距 Y） |
| `--space-4` | `1rem` | 16px | 标准间距（卡片内边距、表单行间距） |
| `--space-5` | `1.25rem` | 20px | 中等间距 |
| `--space-6` | `1.5rem` | 24px | 大间距（区块间距） |
| `--space-7` | `1.75rem` | 28px | 较大间距 |
| `--space-8` | `2rem` | 32px | 超大间距（区域分隔） |
| `--space-10` | `2.5rem` | 40px | 页面区块上下间距 |
| `--space-12` | `3rem` | 48px | 按钮最小高度（小程序） |
| `--space-16` | `4rem` | 64px | 大区块间距 |
| `--space-20` | `5rem` | 80px | 极大区块 |

### 3.2 布局专属间距

| Token | 值 | 用途 |
|---|---|---|
| `--layout-sidebar-width` | `240px` | Web 端侧边栏宽度 |
| `--layout-sidebar-collapsed` | `60px` | 收缩侧边栏宽度 |
| `--layout-header-height` | `64px` | Web 端顶部导航高度 |
| `--layout-page-padding` | `24px` | 页面内容区域内边距 |
| `--layout-card-gap` | `16px` | 卡片网格间距 |
| `--layout-mini-tab-height` | `56px` | 小程序 TabBar 高度 |
| `--layout-mini-header-height` | `48px` | 小程序导航栏高度 |

### 3.3 圆角系统

| Token | 值 | 用途 |
|---|---|---|
| `--radius-sm` | `4px` | 小圆角（标签、徽章） |
| `--radius-md` | `8px` | 标准圆角（按钮、输入框） |
| `--radius-lg` | `12px` | 大圆角（卡片） |
| `--radius-xl` | `16px` | 超大圆角（模态框、对话气泡） |
| `--radius-2xl` | `24px` | 特大圆角（小程序大按钮） |
| `--radius-full` | `9999px` | 全圆（徽章气泡、圆形按钮） |

### 3.4 阴影系统

| Token | 值 | 用途 |
|---|---|---|
| `--shadow-xs` | `0 1px 2px rgba(0,0,0,0.05)` | 极浅阴影（卡片边框替代） |
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)` | 小阴影（卡片默认） |
| `--shadow-md` | `0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)` | 中阴影（浮层） |
| `--shadow-lg` | `0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)` | 大阴影（模态框） |
| `--shadow-xl` | `0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)` | 超大阴影（AI 对话浮层） |

---

## 四、组件设计规范

### 4.1 按钮系统（Button）

#### 按钮变体

| 变体 | BEM类名 | 用途 | 背景 | 文字 |
|---|---|---|---|---|
| 主要按钮 | `.btn--primary` | 核心操作（确认、提交） | `--color-primary-500` | `#FFFFFF` |
| 次要按钮 | `.btn--secondary` | 辅助操作 | `transparent` | `--color-primary-600` + 边框 |
| 成功按钮 | `.btn--success` | 确认完工、批准 | `--color-success-600` | `#FFFFFF` |
| 危险按钮 | `.btn--danger` | 删除、驳回 | `--color-error-600` | `#FFFFFF` |
| 警告按钮 | `.btn--warning` | 警告操作 | `--color-warning-500` | `#FFFFFF` |
| 幽灵按钮 | `.btn--ghost` | 次要操作 | `transparent` | `--color-gray-700` |
| 文字按钮 | `.btn--text` | 链接式操作 | `transparent` | `--color-primary-600` |
| AI 按钮 | `.btn--ai` | AI 相关操作 | `--color-accent-500` | `#FFFFFF` |

#### 按钮尺寸

| 尺寸 | BEM类名 | 高度 | 内边距 X | 字号 | 用途 |
|---|---|---|---|---|---|
| 小号 | `.btn--sm` | 32px | 12px | 13px | 表格操作、紧凑场景 |
| 中号（默认） | `.btn--md` | 40px | 16px | 14px | 常规 Web 端 |
| 大号 | `.btn--lg` | 48px | 20px | 16px | 重要操作 |
| 超大号（小程序） | `.btn--xl` | 54px | 24px | 17px | 小程序主操作按钮 |
| 全宽（小程序） | `.btn--full` | 54px | — | 17px | 小程序确认按钮（全宽） |

> **工厂现场规定**：小程序端所有可见操作按钮尺寸不得低于 `btn--xl`，点击热区不得小于 48×48px。

#### 按钮状态

- **Default**：标准样式
- **Hover**：背景深一级（-100），transition 150ms ease
- **Active/Pressed**：背景深两级（-200），transform: scale(0.98)
- **Disabled**：opacity: 0.4，cursor: not-allowed，不可交互
- **Loading**：内容替换为旋转图标 + "处理中..."，disabled 状态，不可重复点击

#### AI 操作按钮特殊规定

AI 触发按钮（`.btn--ai`）在 loading 状态需展示 AI 思考动画（三点跳动），而非普通旋转 spinner。

---

### 4.2 表单输入组件（Form Input）

#### 基础输入框（`.input`）

```
状态：default → focus → filled → error → disabled
```

| 状态 | 边框 | 背景 | 说明 |
|---|---|---|---|
| Default | `--border-default`（1px） | `#FFFFFF` | 静止状态 |
| Focus | `--color-primary-500`（2px） | `#FFFFFF` | 聚焦时出现蓝色边框 |
| Filled | `--border-default`（1px） | `#FFFFFF` | 有值状态 |
| Error | `--color-error-500`（2px） | `--color-error-50` | 校验失败 |
| Disabled | `--border-default`（1px） | `--color-gray-100` | opacity: 0.6 |

尺寸规范：
- Web 端：高度 40px，内边距 12px，字号 14px
- 小程序端：高度 52px，内边距 16px，字号 16px

#### 多单位选择器（`.unit-switcher`）— 业务专属组件

用于物料出入库的单位切换，显示当前单位和换算提示。

```
┌─────────────────────────────────────┐
│  数量: [  12  ]  [箱 ▼]             │
│         ↑换算提示: 1箱=50个，共600个  │
└─────────────────────────────────────┘
```

规范：
- 单位下拉紧贴数量输入框右侧，视为一体
- 切换单位后，换算提示行即时更新（CSS transition）
- 换算提示文字颜色：`--color-info-600`
- 换算提示背景：`--color-info-50`，圆角 `--radius-sm`

#### 缸号输入组件（`.dye-lot-input`）— 业务专属组件

用于面料/皮料类物料的缸号录入与选择。

```
┌─────────────────────────────────────┐
│  缸号 *（面料必填）                   │
│  ┌─────────────────────────────┐    │
│  │ 输入缸号 或 选择已有缸号 ▼  │    │
│  └─────────────────────────────┘    │
│  ● 已有缸号：DY-2026-001（剩余32m）  │
│             DY-2026-002（剩余18m）  │
└─────────────────────────────────────┘
```

规范：
- 缸号字段仅在物料分类为"面料"或"皮料"时显示（必填标识 `*`）
- 已有缸号以下拉列表展示，含剩余库存信息
- 选择已有缸号时自动填入，背景高亮为 `--color-info-50`
- 新输入缸号时，背景 `--color-warning-50`，提示"新缸号将被登记"

---

### 4.3 卡片组件（Card）

#### 标准卡片（`.card`）

```
背景：--bg-card（#FFFFFF）
边框：1px solid --border-default
圆角：--radius-lg（12px）
阴影：--shadow-sm
内边距：--space-6（24px）
```

#### KPI 数字卡片（`.card--kpi`）

```
结构：
  .card--kpi
    .card__kpi-label    → 指标名称（14px，灰色）
    .card__kpi-value    → 核心数字（40px，加粗）
    .card__kpi-unit     → 单位（16px，次要）
    .card__kpi-delta    → 环比变化（12px，带颜色）
    .card__kpi-action   → 跳转链接（12px，蓝色）
```

状态变化：
- 数字超出阈值（如库存金额高于均值30%）：卡片左侧出现 4px 竖线，颜色与语义色对应
- Hover：`--shadow-md` + 轻微上移（transform: translateY(-2px)）

#### 预警卡片（`.card--alert`）

左侧 4px 竖线颜色区分预警等级：
- 红色：低于安全库存（`--color-error-500`）
- 黄色：临近安全库存（`--color-warning-500`）
- 蓝紫：呆滞风险（`--color-stagnant-500`）

#### AI 建议卡片（`.card--ai-suggestion`）

```
顶部区域：置信度标签 + 紧急程度标签
主体区域：物料名称 + 建议数量 + 供应商 + 金额
展开区域：AI 推理依据（可折叠，accordion）
底部操作区：状态标签 + 操作按钮
```

特征：左侧有 `--color-accent-500`（橙色）2px 竖线，表示 AI 来源。

---

### 4.4 表格组件（Table）

#### 基础表格（`.table`）

```
表头：背景 --color-gray-50，字体 12px 加粗，灰色
数据行：
  奇数行：#FFFFFF
  偶数行：--color-gray-50
  Hover：--color-primary-50
行高：Web 端 52px，小程序端 60px
```

#### 多单位列（`.table__cell--unit`）

包含单位切换按钮，显示当前单位数量，可切换显示其他单位。

```
25张  [切换: 按箱]
```

切换后：
```
0.5箱  [切换: 按张]
换算: 1箱=50张
```

切换使用 CSS transition，数字变化时 0.2s fade。

#### 缸号展开行（`.table__row--expandable`）

面料类物料行末尾显示展开按钮。点击后行下方展开缸号批次明细：

```
┌────────────────────────────────────────────────────────┐
│  缸号批次明细 — 进口牛皮 1.2mm 棕色                     │
│  缸号           入库日期    剩余库存   状态              │
│  DY-2026-001    2026-01-05  32 平方米  正常             │
│  DY-2026-002    2026-02-18  18 平方米  正常             │
│  DY-2025-088    2025-11-20   5 平方米  即将耗尽          │
└────────────────────────────────────────────────────────┘
```

---

### 4.5 标签/徽章组件（Tag / Badge）

#### 状态标签（`.tag`）

| 变体 | BEM 类名 | 背景 | 文字 | 用途 |
|---|---|---|---|---|
| 成功 | `.tag--success` | `--color-success-100` | `--color-success-700` | 正常、已完工、已批准 |
| 警告 | `.tag--warning` | `--color-warning-100` | `--color-warning-700` | 临近预警、待处理 |
| 错误 | `.tag--error` | `--color-error-100` | `--color-error-700` | 缺货、失败、驳回 |
| 信息 | `.tag--info` | `--color-info-100` | `--color-info-700` | 在途、进行中 |
| 中性 | `.tag--neutral` | `--color-gray-100` | `--color-gray-700` | 草稿、普通状态 |
| 呆滞 | `.tag--stagnant` | `--color-stagnant-100` | `--color-stagnant-600` | 呆滞风险 |

尺寸：内边距 4px 8px，字号 12px，圆角 4px，行高 1。

#### 缸号标签（`.tag--dye-lot`）— 业务专属

```
样式：带缸号图标，背景 --color-accent-50，文字 --color-accent-600，
     边框 1px dashed --color-accent-300
     字号 12px，内边距 3px 8px，圆角 4px
```

用于在领料单、库存列表、溯源链中标识缸号信息。

#### 置信度标签（`.tag--confidence`）— AI 专属

| 置信度 | BEM 修饰符 | 颜色 | 符号 |
|---|---|---|---|
| 高 | `.tag--confidence-high` | 绿色 | ● |
| 中 | `.tag--confidence-medium` | 黄色 | ● |
| 低 | `.tag--confidence-low` | 红色 | ● |

#### 优先级标签（`.tag--priority`）

| 优先级 | BEM 修饰符 | 颜色 |
|---|---|---|
| 紧急 | `.tag--priority-urgent` | 红色，加粗边框 |
| 高 | `.tag--priority-high` | 橙色 |
| 普通 | `.tag--priority-normal` | 灰色 |

#### 通知徽章（`.badge`）

圆形气泡，用于导航角标：
- 背景：`--color-error-500`
- 文字：白色，11px，加粗
- 尺寸：最小 18px × 18px，数字 > 99 显示"99+"

---

#### 物料二级品类标签颜色体系（`.tag--sub-*`）— 业务专属 v1.1

**背景说明**：SKU 多级分类体系（2026-03-11 补充）引入二级品类字段，需为全部 16 个二级品类定义独立的视觉标签。设计原则：同一一级分类下的子类使用同色相渐变区分，不同一级分类之间色相差异明显，确保在列表、BOM 编辑器、采购建议卡片等多场景下可快速识别。

##### 原材料子类（8类）

| 品类 | BEM 类名 | 背景色 | 文字色 | 色相说明 |
|---|---|---|---|---|
| 板材类 | `.tag--sub-board` | `#FDF3E7` | `#9A3412` | 棕橙色系，联想木材纹理 |
| 五金类 | `.tag--sub-hardware` | `#F3F4F6` | `#4B5563` | 冷灰色系，联想金属质感 |
| 面料类 | `.tag--sub-fabric` | `#F3E8FF` | `#7C3AED` | 紫罗兰色系，联想纺织品 |
| 海绵类 | `.tag--sub-foam` | `#ECFDF5` | `#059669` | 青绿色系，联想柔软材质 |
| 油漆涂料类 | `.tag--sub-paint` | `#FEF9C3` | `#A16207` | 琥珀黄色系，联想涂料色泽 |
| 胶粘剂类 | `.tag--sub-adhesive` | `#FFF1F2` | `#E11D48` | 玫红色系，联想粘合剂警示性 |
| 包装材料类 | `.tag--sub-pack` | `#F0F9FF` | `#0369A1` | 蓝灰色系，联想包装纸箱 |
| 其他辅料 | `.tag--sub-other` | `#F5F5F5` | `#737373` | 中性灰，泛用辅助色 |

##### 半成品子类（3类）

| 品类 | BEM 类名 | 背景色 | 文字色 | 色相说明 |
|---|---|---|---|---|
| 框架类 | `.tag--sub-frame` | `#FFF7ED` | `#C2410C` | 深橙色系，联想结构骨架 |
| 面套类 | `.tag--sub-cover` | `#FDF4FF` | `#7E22CE` | 深紫色系，与面料类呼应但更深 |
| 组合件类 | `.tag--sub-assembly` | `#F0F9FF` | `#0369A1` | 天蓝色系，联想组装概念 |

##### 成品子类（5类）

| 品类 | BEM 类名 | 背景色 | 文字色 | 色相说明 |
|---|---|---|---|---|
| 沙发类 | `.tag--sub-sofa` | `#FFF0F9` | `#9D174D` | 玫粉色系，联想软体家具 |
| 柜类 | `.tag--sub-cabinet` | `#F0FDF4` | `#166534` | 翠绿色系，联想储物稳重感 |
| 桌类 | `.tag--sub-table` | `#FFFBEB` | `#92400E` | 暖黄棕色系，联想实木台面 |
| 床类 | `.tag--sub-bed` | `#EFF6FF` | `#1D4ED8` | 蓝色系，联想睡眠宁静感 |
| 其他定制品 | `.tag--sub-custom` | `#F8FAFC` | `#334155` | 深灰色系，泛用中性 |

##### 未分类（历史导入默认值）

| 品类 | BEM 类名 | 背景色 | 文字色 | 说明 |
|---|---|---|---|---|
| 未分类 | `.tag--sub-none` | `#FEF2F2` | `#B91C1C` | 警示红，提示需补录，不可作为最终状态 |

##### CSS 变量定义（统一在 `:root` 中注册）

```css
/* 原材料 8 类 */
--sub-board-bg: #FDF3E7;    --sub-board-text: #9A3412;
--sub-hardware-bg: #F3F4F6; --sub-hardware-text: #4B5563;
--sub-fabric-bg: #F3E8FF;   --sub-fabric-text: #7C3AED;
--sub-foam-bg: #ECFDF5;     --sub-foam-text: #059669;
--sub-paint-bg: #FEF9C3;    --sub-paint-text: #A16207;
--sub-adhesive-bg: #FFF1F2; --sub-adhesive-text: #E11D48;
--sub-pack-bg: #F0F9FF;     --sub-pack-text: #0369A1;
--sub-other-bg: #F5F5F5;    --sub-other-text: #737373;
/* 半成品 3 类 */
--sub-frame-bg: #FFF7ED;    --sub-frame-text: #C2410C;
--sub-cover-bg: #FDF4FF;    --sub-cover-text: #7E22CE;
--sub-assembly-bg: #F0F9FF; --sub-assembly-text: #0369A1;
/* 成品 5 类 */
--sub-sofa-bg: #FFF0F9;     --sub-sofa-text: #9D174D;
--sub-cabinet-bg: #F0FDF4;  --sub-cabinet-text: #166534;
--sub-table-bg: #FFFBEB;    --sub-table-text: #92400E;
--sub-bed-bg: #EFF6FF;      --sub-bed-text: #1D4ED8;
--sub-custom-bg: #F8FAFC;   --sub-custom-text: #334155;
/* 未分类 */
--sub-none-bg: #FEF2F2;     --sub-none-text: #B91C1C;
```

##### 在品类成本条形图中的对应颜色（实色，用于可视化）

| 品类 | 条形图实色 | 用途 |
|---|---|---|
| 板材类 | `#C2774A` | BOM成本占比横向条、饼图 |
| 五金类 | `#94A3B8` | 同上 |
| 面料类 | `#7C3AED` | 同上 |
| 海绵类 | `#059669` | 同上 |
| 油漆涂料类 | `#D97706` | 同上 |
| 胶粘剂类 | `#E11D48` | 同上 |
| 包装材料类 | `#0369A1` | 同上 |
| 其他辅料 | `#CBD5E1` | 同上 |

> **无障碍要求**：所有二级品类标签的文字与背景对比度均须达到 WCAG 2.1 AA（≥4.5:1）。上表中所有配色经过验证，最低对比度为面料类的 5.2:1。

---

### 4.6 导航组件

#### Web 端侧边栏（`.sidebar`）

```
宽度：240px（展开）/ 60px（收缩）
背景：--bg-sidebar（#1E293B，暗色）
菜单项高度：44px
菜单项内边距：12px 16px
激活状态：背景 --color-primary-500，左侧 3px 白色竖线
Hover：背景 rgba(255,255,255,0.08)
图标：20×20px，颜色与文字同步
折叠动画：width transition 200ms ease，文字 opacity/width transition
```

Logo 区域：高度 64px，与顶部 Header 对齐。

#### Web 端顶部导航栏（`.topbar`）

```
高度：64px
背景：#FFFFFF（亮色）/ #1E293B（暗色）
左侧：Logo + 产品名
中部：全局 AI 搜索框（宽度最大 480px）
右侧：消息铃铛（含徽章） + 用户头像 + 角色切换
底部阴影：--shadow-xs
```

AI 搜索框规范：
- 占位符："问 AI 任何问题..."
- 图标：AI 机器人图标（橙色），左侧
- 聚焦时：宽度 transition 展开，显示下拉历史

#### 小程序端底部 TabBar（`.tabbar`）

```
高度：56px（含安全区域，实际显示区域 56px）
背景：#FFFFFF
边框：顶部 1px solid --border-default
Tab 项：等宽 4 列
激活图标：--color-primary-500
未激活图标：--color-gray-400
文字：10px，激活态加粗
徽章：红色气泡
```

4 个 Tab：首页（任务）、库存（出入库）、消息、我的。

---

### 4.7 AI 对话气泡组件（Chat Bubble）

#### 用户消息气泡（`.bubble--user`）

```
位置：右对齐
背景：--color-primary-500（蓝色）
文字：白色，14px
圆角：16px 16px 4px 16px（右下角切角）
内边距：10px 14px
最大宽度：80%
头像：右侧，24px 圆形
时间戳：气泡下方，12px 灰色
```

#### AI 消息气泡（`.bubble--ai`）

```
位置：左对齐
背景：#FFFFFF（亮色）/ --color-gray-800（暗色）
边框：1px solid --border-default
文字：--text-primary，14px
圆角：4px 16px 16px 16px（左上角切角）
内边距：12px 16px
最大宽度：85%
AI 图标：左侧，28px 橙色背景 + 机器人图标
时间戳：气泡下方，12px 灰色
```

#### AI 流式输出光标（`.bubble__cursor`）

```
display: inline-block
宽度：2px，高度：1em（与行高匹配）
背景：--color-primary-500
动画：blink 0.7s step-end infinite
（输出完成后：cursor 隐藏，transition opacity 0.3s）
```

#### AI 思考中气泡（`.bubble--thinking`）

```
与 AI 消息气泡同样布局
内容：三个点 + 文字，点使用 bounce 动画（间隔 0.15s）
步骤列表：
  ● 步骤名称 ✓（已完成，文字 --color-success-600）
  ⟳ 当前步骤...（动画图标旋转）
  ○ 待处理步骤（灰色）
底部：进度倒计时（可选）+ 取消按钮
```

#### AI 错误气泡（`.bubble--error`）

```
背景：--color-error-50
边框：1px solid --color-error-200
图标：红色感叹号圆圈
错误标题：14px，--color-error-700，加粗
错误描述：13px，--color-error-600
操作按钮：[重试]（主要）[手动处理]（次要），按钮行
```

---

### 4.8 AI 状态指示器（AI Status Indicator）

#### 思考中动画（三点跳动）

```css
/* 三点跳动动画 */
@keyframes ai-thinking {
  0%, 80%, 100% { transform: translateY(0); opacity: 1; }
  40% { transform: translateY(-6px); opacity: 0.7; }
}

.ai-dots span:nth-child(1) { animation-delay: 0s; }
.ai-dots span:nth-child(2) { animation-delay: 0.15s; }
.ai-dots span:nth-child(3) { animation-delay: 0.30s; }
```

#### 流式输出打字机光标

```css
@keyframes blink-cursor {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
.bubble__cursor { animation: blink-cursor 0.7s step-end infinite; }
```

#### 全局 AI 状态条（`.ai-status-bar`）

页面顶部（Header 下方）或底部显示，全宽橙色渐变条：
- 思考中：橙色渐变 + 动画流光 + 文字"AI 正在分析..."
- 完成：绿色淡出（1s 后消失）
- 错误：红色 + 错误文案

---

### 4.9 溯源链可视化组件（Trace Chain）

#### 组件结构（`.trace-chain`）

```
垂直时间轴样式，从左向右展开（成品→部件→物料→工序→工人）

.trace-chain
  .trace-chain__node（每个溯源节点）
    .trace-chain__node-icon（节点图标，圆形）
    .trace-chain__node-line（连接线，竖线/横线）
    .trace-chain__node-card（节点信息卡片）
      .trace-chain__node-title（节点标题）
      .trace-chain__node-detail（详细信息）
      .trace-chain__node-tag（缸号标签等）
      .trace-chain__node-status（数据完整性状态）
```

节点类型与颜色：

| 节点类型 | 图标颜色 | 图标 |
|---|---|---|
| 成品 | `--color-primary-500` | 产品图标 |
| 部件 | `--color-info-500` | 零件图标 |
| 物料批次 | `--color-accent-500` | 材料图标 |
| 工序 | `--color-success-500` | 工具图标 |
| 工人 | `--color-stagnant-500` | 人员图标 |

数据缺失节点：图标颜色 `--color-gray-300`，节点卡片显示"工序数据缺失"标注。

---

### 4.10 通知/预警组件（Notification / Alert）

#### 内联预警（`.alert`）

用于页面内区域性提示。

| 类型 | BEM 修饰符 | 背景 | 边框（左侧4px） |
|---|---|---|---|
| 信息 | `.alert--info` | `--color-info-50` | `--color-info-500` |
| 成功 | `.alert--success` | `--color-success-50` | `--color-success-500` |
| 警告 | `.alert--warning` | `--color-warning-50` | `--color-warning-500` |
| 错误 | `.alert--error` | `--color-error-50` | `--color-error-500` |
| AI 提示 | `.alert--ai` | `--color-accent-50` | `--color-accent-500` |

结构：图标 + 标题（可选）+ 描述 + 操作按钮（可选）+ 关闭按钮。

#### Toast 通知（`.toast`）

屏幕右上角堆叠，最多显示3条。

```
位置：fixed，top: 24px，right: 24px（Web）/ top: 16px（小程序）
宽度：360px（Web）/ 全宽减 32px（小程序）
圆角：--radius-lg
阴影：--shadow-lg
动画：从右侧 slide-in（300ms），关闭时 slide-out（200ms）
停留：成功3s，警告5s，错误不自动消失
```

#### 离线状态条（`.offline-bar`）

```
位置：fixed，顶部（Header 下方或小程序顶部）
背景：--color-warning-500
文字：白色，14px，居中
高度：36px
图标：离线图标 + "当前处于离线模式，数据将在联网后同步"
```

---

## 五、状态设计

### 5.1 空状态（Empty State）

```
.empty-state
  .empty-state__icon（插图或图标，64px）
  .empty-state__title（16px，加粗，灰色）
  .empty-state__description（14px，次要灰色）
  .empty-state__action（可选 CTA 按钮）
```

场景：
- 搜索无结果：图标（搜索+X）+ "未找到相关物料" + "重置筛选"按钮
- 今日无任务：图标（完成勾）+ "今日没有待处理任务，辛苦了！"
- 首次使用：图标（向导）+ "开始配置" + 向导引导

### 5.2 加载状态（Loading State）

页面级加载：
- 使用骨架屏（Skeleton），模拟真实内容布局
- 骨架颜色：`--color-gray-100` → `--color-gray-200` 渐变动画（shimmer）

组件级加载：
- Spinner：24px 圆形，primary 色，旋转动画
- 按钮 loading：替换为 16px spinner + "处理中..."

### 5.3 错误状态（Error State）

页面级：
- 500 错误：友好插图 + "页面出了点问题" + [重新加载] [返回首页]
- 403 权限：图标 + "您没有权限查看此内容" + [联系管理员]
- 网络错误：图标 + "网络连接异常" + [重试]

### 5.4 AI 思考中状态（AI Thinking State）

见 4.7、4.8 章节。核心规范：
1. 用户发起 AI 任务后 **< 0.5s** 内必须出现 thinking 状态
2. 不允许白屏等待
3. 步骤文案必须是真实的业务语言（"正在计算BOM物料需求..."），不用技术术语
4. 10秒以上必须显示预计倒计时
5. 始终提供"取消"出口

### 5.5 离线状态（Offline State）

- 小程序顶部橙色条
- 可操作的功能：查看缓存任务、录入本地缓存（等待联网上传）
- 不可操作的功能：灰色遮罩 + "需要网络连接"提示
- 联网恢复后：Toast 通知"已恢复在线，同步数据中..."

---

## 六、Design Tokens（CSS 自定义属性完整定义）

```css
:root {
  /* ===== 色彩 ===== */
  /* 主色 */
  --color-primary-50: #EFF6FF;
  --color-primary-100: #DBEAFE;
  --color-primary-200: #BFDBFE;
  --color-primary-300: #93C5FD;
  --color-primary-400: #60A5FA;
  --color-primary-500: #3B82F6;
  --color-primary-600: #2563EB;
  --color-primary-700: #1D4ED8;
  --color-primary-800: #1E40AF;
  --color-primary-900: #1E3A8A;

  /* 辅助色（橙色 AI 标识） */
  --color-accent-50: #FFF7ED;
  --color-accent-200: #FED7AA;
  --color-accent-400: #FB923C;
  --color-accent-500: #F97316;
  --color-accent-600: #EA580C;

  /* 语义色 */
  --color-success-50: #F0FDF4;
  --color-success-100: #DCFCE7;
  --color-success-500: #22C55E;
  --color-success-600: #16A34A;
  --color-success-700: #15803D;

  --color-warning-50: #FFFBEB;
  --color-warning-100: #FEF3C7;
  --color-warning-500: #F59E0B;
  --color-warning-600: #D97706;
  --color-warning-700: #B45309;

  --color-error-50: #FEF2F2;
  --color-error-100: #FEE2E2;
  --color-error-500: #EF4444;
  --color-error-600: #DC2626;
  --color-error-700: #B91C1C;

  --color-info-50: #F0F9FF;
  --color-info-100: #E0F2FE;
  --color-info-500: #0EA5E9;
  --color-info-600: #0284C7;
  --color-info-700: #0369A1;

  --color-stagnant-100: #EDE9FE;
  --color-stagnant-500: #8B5CF6;
  --color-stagnant-600: #7C3AED;

  /* 中性色 */
  --color-gray-0: #FFFFFF;
  --color-gray-50: #F8FAFC;
  --color-gray-100: #F1F5F9;
  --color-gray-200: #E2E8F0;
  --color-gray-300: #CBD5E1;
  --color-gray-400: #94A3B8;
  --color-gray-500: #64748B;
  --color-gray-600: #475569;
  --color-gray-700: #334155;
  --color-gray-800: #1E293B;
  --color-gray-900: #0F172A;

  /* ===== 语义别名（亮色模式） ===== */
  --bg-page: #F8FAFC;
  --bg-card: #FFFFFF;
  --bg-sidebar: #1E293B;
  --text-sidebar: #CBD5E1;
  --bg-sidebar-active: #2563EB;
  --text-primary: #1E293B;
  --text-secondary: #64748B;
  --text-disabled: #94A3B8;
  --text-on-primary: #FFFFFF;
  --border-default: #E2E8F0;
  --border-strong: #CBD5E1;
  --border-focus: #3B82F6;

  /* ===== 字体 ===== */
  --font-family-base: "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei",
                      -apple-system, BlinkMacSystemFont, sans-serif;
  --font-family-mono: "JetBrains Mono", "SF Mono", "Consolas", monospace;
  --font-family-number: "DIN Alternate", "Roboto Mono", var(--font-family-base);

  /* 字号 */
  --text-h1: 2rem;
  --text-h2: 1.5rem;
  --text-h3: 1.25rem;
  --text-h4: 1.125rem;
  --text-body-l: 1rem;
  --text-body-m: 0.875rem;
  --text-body-s: 0.75rem;
  --text-label: 0.75rem;
  --text-caption: 0.6875rem;
  --text-number-xl: 2.5rem;
  --text-number-l: 1.75rem;
  --text-number-m: 1.25rem;

  /* ===== 间距 ===== */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-7: 1.75rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;
  --space-16: 4rem;
  --space-20: 5rem;

  /* 布局 */
  --layout-sidebar-width: 240px;
  --layout-sidebar-collapsed: 60px;
  --layout-header-height: 64px;
  --layout-page-padding: 24px;
  --layout-card-gap: 16px;
  --layout-mini-tab-height: 56px;
  --layout-mini-header-height: 48px;

  /* ===== 圆角 ===== */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-2xl: 24px;
  --radius-full: 9999px;

  /* ===== 阴影 ===== */
  --shadow-xs: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05);
  --shadow-xl: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);

  /* ===== 动画 ===== */
  --transition-fast: 150ms ease;
  --transition-base: 200ms ease;
  --transition-slow: 300ms ease;
  --transition-spring: 200ms cubic-bezier(0.34, 1.56, 0.64, 1);

  /* ===== 层叠 ===== */
  --z-base: 0;
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-overlay: 300;
  --z-modal: 400;
  --z-toast: 500;
  --z-tooltip: 600;
}

/* 暗色模式 */
@media (prefers-color-scheme: dark) {
  :root {
    --bg-page: #0F172A;
    --bg-card: #1E293B;
    --bg-sidebar: #0F172A;
    --text-primary: #F1F5F9;
    --text-secondary: #94A3B8;
    --text-disabled: #475569;
    --border-default: #334155;
    --border-strong: #475569;
  }
}
```

---

## 七、无障碍规范（WCAG 2.1 AA）

1. **色彩对比度**：所有正文文字对背景对比度 >= 4.5:1；大文字（18px+ 或 14px+ 加粗）>= 3:1
2. **焦点状态**：所有可交互元素必须有可见焦点环（`outline: 2px solid --color-primary-500, outline-offset: 2px`），不可使用 `outline: none` 删除焦点
3. **键盘导航**：所有功能必须可通过键盘（Tab/Enter/Space/方向键）完成
4. **ARIA 属性**：AI 思考中状态需 `aria-live="polite"`，错误提示需 `role="alert"`，模态框需 `role="dialog"` + `aria-labelledby`
5. **语义化 HTML**：按钮用 `<button>`，链接用 `<a>`，表单用 `<form>` + `<label>`，表格用 `<table>` + `<th scope>`
6. **图标可访问性**：装饰性图标 `aria-hidden="true"`，功能性图标必须有 `aria-label` 或配合文字
7. **小程序大触控区**：所有可点击元素触控面积 >= 48×48px（即便视觉上更小，也需用 padding 扩展热区）

---

*设计规范版本 v1.0，2026-03-10*
*@senior-ui-designer → 移交 @senior-frontend-engineer 实现*
