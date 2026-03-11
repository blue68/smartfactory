# 智造管家 AI 模块复盘报告

**评审日期**：2026-03-11
**评审范围**：后端 AI 模块（5 个文件）+ 前端 AI 模块（3 个文件）
**评审角色**：AI 工程师
**评审目标**：评估现有 AI 能力是否满足 MVP 要求，识别改进点，给出优先级迭代建议

---

## 一、各模块现状评估

### 1.1 意图识别器（intent.recognizer.ts）

**定位**：规则引擎 NLU，Phase 1 实现

**现状**：
- 支持 6 类业务意图：`inventory_query`、`purchase_suggest`、`production_query`、`quality_stats`、`cost_analysis`、`order_status`，以及兜底 `general_qa`
- 采用三级评分机制：强关键词（+0.6）、弱关键词（+0.2，叠加上限 0.4）、正则模式（上限 0.85）
- 实体提取覆盖：订单号（ORDER_NO_PATTERN）、日期/时间范围（DATE_PATTERNS）、物料分类关键词（CATEGORY_PATTERNS）、SKU 名称（引号和上下文两种模式）

**优点**：
- 评分体系设计合理，强弱关键词分级权重清晰
- 正则模式覆盖了常见工厂业务口语表达（如 "WO001234工单进度"）
- 意图回退机制完善（score < 0.3 时降级为 general_qa）

**问题与风险**：

| 编号 | 问题 | 严重度 |
|------|------|--------|
| IR-01 | SKU 名称提取仅依赖引号（`"XX"`）和固定后缀词（"材料/物料/产品/成品/配件/面料/皮料/板材"），工厂口语中常出现不带标点的 SKU 名称（如"欧式沙发还剩多少"），无法识别"欧式沙发"为 sku_name | 高 |
| IR-02 | 意图评分仅按最高分单选，多意图并存场景无处理（如"看一下库存和排产情况"） | 中 |
| IR-03 | 规则引擎无法处理拼写变体、同义词扩展（"进货"可命中 purchase_suggest，但"搞货""囤货"无法命中） | 中 |
| IR-04 | 无意图置信度阈值的动态调整机制——随着用户量增长，规则漏覆盖将导致大量落入 general_qa 兜底，体验退化 | 中 |
| IR-05 | 弱关键词打分存在误匹配风险：用户输入"今天客户催单了"可能同时命中 `production_query`（今天）和 `order_status`（客户），导致意图混乱 | 低 |

---

### 1.2 响应生成器（response.generator.ts）

**定位**：模板引擎 + SSE 流式输出，Phase 1 实现

**现状**：
- 支持 6 类意图的结构化响应构建，输出格式为文本 + 数据卡片（table / list / metric / alert / suggestion）
- SSE 流式输出实现：phase 帧（thinking→querying→generating）→ 逐字符分段输出 → 数据卡片帧 → [DONE]
- 每帧格式为 `data: {"content":"..."}\n\n`，与前端 AiChatPage.tsx 的解析逻辑完全兼容

**优点**：
- SSE 帧设计完备，phase 帧提供了阶段状态，content 帧逐字符输出有打字机效果
- 数据卡片类型系统（TableCard / ListCard / MetricCard / AlertCard / SuggestionCard）设计完整
- 响应文本逻辑覆盖了边界场景（空数据、单条数据、多条数据分别处理）

**问题与风险**：

| 编号 | 问题 | 严重度 |
|------|------|--------|
| RG-01 | SSE 流式输出是**模拟流式**（先生成全文再分段发送），并非真正的 LLM 流式生成。响应生成本质是字符串拼接，文字内容固定、缺乏上下文感知。Phase 1 可接受，但对用户而言文本质量感知差 | 高 |
| RG-02 | 响应文本完全是硬编码模板，无法处理用户的自由问题（如"为什么这个材料这么贵？"）。回退到 general_qa 时仅输出一段引导词，用户会感到 AI"很笨" | 高 |
| RG-03 | 数据卡片在 SSE 帧中格式为 `{card: ...}`，但前端 AiChatPage.tsx 的 SSE 解析代码仅处理 `{content: ...}` 和 `{dataCard: ...}` 字段，**字段名不匹配**（后端输出 `card`，前端期望 `dataCard`），导致数据卡片无法渲染 | 严重 |
| RG-04 | `chunkSize=6, chunkDelayMs=25` 的分块配置在文本较短时（如"未找到订单..."）会产生不必要的延迟，而文本较长时分块粒度粗糙 | 低 |
| RG-05 | 质量响应中使用了 `stats.passRateDelta` 字段（趋势变化量），但 `ai.service.ts` 中的 `queryQualityStats` 未查询此字段，始终为 undefined，导致趋势箭头无法显示 | 中 |

---

### 1.3 上下文管理器（context.manager.ts）

**定位**：多轮对话状态管理，Redis 存储

**现状**：
- Redis key 格式：`ai:ctx:{tenantId}:{userId}`，TTL 30 分钟
- 保留最近 10 轮对话（MAX_TURNS=10），每轮存储 userInput、intent、entities、replySnippet（前100字符）
- 指代词检测：通过 REFERENCE_PATTERNS 正则匹配中文代词（那/这/它/他）和转折词
- 实体合并策略：当前轮实体优先，历史实体按类型去重补充

**优点**：
- Redis 存储 + 30 分钟 TTL 设计合理，避免了跨会话污染
- 实体合并逻辑正确：同类型实体当前轮覆盖历史，不同类型则互补
- 意图继承机制（低置信度时继承上一轮意图）有效提升多轮对话连贯性

**问题与风险**：

| 编号 | 问题 | 严重度 |
|------|------|--------|
| CM-01 | 指代词检测基于行首匹配（`/^(那|这|它)...`），大量指代发生在句子中间（如"帮我看看它的库存"），检测会失效 | 中 |
| CM-02 | 多会话（sessionId）在 Phase 1 中未真正隔离——context.manager.ts 的 Redis key 仅用 tenantId+userId，不含 sessionId，前端传入的 sessionId 被忽略，多个会话共享同一上下文 | 高 |
| CM-03 | `setWaitingEntity` 方法被定义但从未在 ai.service.ts 中调用——状态机中的 `waiting_entity` 状态是死代码，AI 永远不会主动追问用户缺少的实体 | 中 |
| CM-04 | 上下文仅保存 replySnippet（前100字符），无法给 Phase 2 的 LLM 提供完整对话历史作为 prompt context | 中 |

---

### 1.4 AI 对话服务（ai.service.ts）

**定位**：AI Agent 核心处理链路，SSE 入口

**现状**：
- 完整处理链路：意图识别 → 上下文增强 → 业务数据路由查询（带重试）→ 流式响应生成 → 异步保存上下文
- 30 秒全局超时 + setTimeout/clearTimeout 正确实现
- 业务数据查询最多重试 3 次（指数退避：200/400/800ms）
- 支持 6 类业务数据查询：库存/采购建议/排产/质量统计/成本分析/订单状态

**优点**：
- 超时保护机制完善，SSE 不会无限挂起
- 重试机制设计正确（指数退避），符合最佳实践
- 查询路由清晰，按意图类型分发到专用查询函数
- 错误处理完备：所有异常均写入 error 帧后关闭连接

**问题与风险**：

| 编号 | 问题 | 严重度 |
|------|------|--------|
| AS-01 | **业务数据覆盖存在盲区**：库存查询中的"低库存物料"查询使用相关子查询（多层嵌套 SELECT），在数据量较大时性能极差（N+1 查询模式，每个 sku 执行一次子查询）。建议改为 JOIN 或物化视图 | 高 |
| AS-02 | 采购建议查询优先读取 `purchase_suggestions` 表的缓存数据，若无缓存则实时触发 `SuggestionService.generateSuggestions()`。后者会对所有在产工单逐一展开 BOM，在订单量较大时此操作可能耗时 5-15 秒，远超 SSE 体验预期 | 高 |
| AS-03 | 成本分析（`queryCostAnalysis`）在未提供 sku_name 或 category 实体时，直接返回 `buildGeneralAnswer`（没有数据），但未向用户说明原因，用户体验差 | 中 |
| AS-04 | 对话历史接口（`listConversations`、`getConversationMessages`）查询的是 `ai_messages` 表，但 `appendTurn` 方法将数据写入 Redis（context.manager.ts），**两套存储不一致**：Redis 用于实时上下文，`ai_messages` 表似乎是另一套持久化机制，但代码中无任何写入 `ai_messages` 的逻辑 | 严重 |
| AS-05 | `buildGeneralAnswer` 中的问候语检测（`/你好|您好|hi|hello|嗨/`）是对 `entities.map(e => e.raw).join('')` 进行匹配，而不是对原始用户输入匹配，逻辑错误（实体提取不会提取问候词） | 中 |

---

### 1.5 AI 路由层（ai.routes.ts）

**定位**：Express 路由，含限流和权限控制

**现状**：
- 限流策略：`/api/ai/chat` 每 IP 每分钟 20 次（合理），配置 `skipFailedRequests: true`
- 消息长度校验：最多 500 字
- SSE 特殊处理：单独实现错误兜底，不使用 `asyncHandler`（避免 headers 已发送后的冲突）
- 历史接口齐全：GET/DELETE conversations

**优点**：
- SSE 路由的错误处理特殊化处理方式正确
- 限流和参数校验覆盖完整

**问题与风险**：

| 编号 | 问题 | 严重度 |
|------|------|--------|
| RT-01 | 限流按 IP 计，多租户环境下同一 NAT 出口的 IP 会共享限额，对 B2B SaaS 场景不合理，应改为按 userId/tenantId 限流 | 中 |
| RT-02 | `POST /api/ai/scan` 手动触发扫描仅限 boss/supervisor 角色，但缺少频次保护（可能被高频调用触发大量数据库操作） | 低 |

---

### 1.6 BOM AI 建议（bom.service.ts → getAiSuggestion）

**定位**：基于相似产品使用频次的 BOM 物料推荐

**现状**：
- 查询同一一级品类（category1_id）下其他成品的活动 BOM
- 按 `component_sku_id` 分组统计使用频次（usageCount）和平均用量（avgQty）
- 置信度计算：`Math.min(95, usageCount * 15)`，即每使用 1 次加 15 分，最高 95
- 返回 Top 10 物料，附带 "同品类 N 个 BOM 使用该物料" 的原因说明

**优点**：
- 算法思路合理，基于协同过滤原理（同类产品使用相同物料）
- 置信度与实际使用频次挂钩，数据驱动
- 实现简洁，SQL 效率良好

**问题与风险**：

| 编号 | 问题 | 严重度 |
|------|------|--------|
| BOM-01 | 置信度上限 95 由 `usageCount * 15` 线性计算，**7次及以上均会达到上限（7×15=105→cap 95）**，失去区分度。使用频次在 7 次以上的建议全都标记为 95% 置信度，无法区分"20个BOM都用"和"7个BOM用" | 中 |
| BOM-02 | 平均用量（avgQty）直接取算术平均，未按产品规格加权，可能导致建议用量偏差较大（如大号沙发和小号沙发的面料用量差异2倍以上，平均后推荐给特定产品会偏差） | 中 |
| BOM-03 | 建议仅基于同品类（category1_id），不考虑产品尺寸/规格相似度。若品类下产品规格差异大，推荐质量将显著下降 | 低 |
| BOM-04 | 无"新产品冷启动"处理：若品类下无其他 BOM，返回空数组且无任何提示，用户体验差 | 低 |

---

### 1.7 约束引擎（constraintEngine.ts）

**定位**：订单下单时的四维风险检查（库存周转/资金占用/生产成本/产能负荷）

**现状**：
- 四维并发检查（Promise.all），性能优化良好
- 阈值从租户配置（tenant.settings JSON 字段）加载，支持可配置化
- 生产成本检查仅做提示不拦截（passed 始终为 true），设计合理

**AI 化程度评估**：
此模块**本质是纯规则引擎**，不涉及任何 LLM 或机器学习。其"智能"体现在多维度规则的组合判断，而非 AI 推理。这在 Phase 1 是可接受的方案。

**优点**：
- 四维检查覆盖了制造业核心风险维度
- 影响分析（calcImpactAnalysis）中插单延期天数计算考虑了队列系数，有一定的近似合理性
- 配置可热更新，无需重启

**问题与风险**：

| 编号 | 问题 | 严重度 |
|------|------|--------|
| CE-01 | 产能负荷检查（checkCapacityLoad）假设所有天都是工作日（`workDays = ceil(delivery - today)`），未排除周末和法定节假日，导致产能评估虚高 | 高 |
| CE-02 | 库存周转天数（checkInventoryTurnover）中，物料循环查询价格（每个物料一次 SELECT）存在 N+1 查询问题，当 BOM 物料数量多时性能差 | 中 |
| CE-03 | 生产成本检查的历史均值查询（近3个月所有 PO 的均值）与当前 BOM 无直接关联，是全租户所有物料均价的混合，无法有效检测特定产品的成本异常 | 中 |
| CE-04 | 影响分析中 `additionalProductionCost` 固定为物料成本的 15%（硬编码），无任何依据说明此系数的合理性 | 低 |

---

### 1.8 采购建议服务（suggestion.service.ts）

**定位**：规则引擎驱动的 AI 采购建议生成

**现状**：
- 完整的需求缺口计算链路：在产工单 BOM 展开 → 汇总物料需求 → 减去可用库存 → 减去在途库存 → 加安全库存缓冲（×1.5）
- 置信度三级分类：近 30 天出库记录 ≥10 次为高，≥3 次为中，否则为低
- 供应商优先级：A 级 > B 级 > C 级，相同级别按报价升序
- 批量 INSERT 优化（一次性写入全部建议），自动清除旧的 pending 建议

**优点**：
- 需求计算链路完整，覆盖在途库存和安全库存缓冲
- 置信度设计与数据量挂钩，合理
- 面料/皮料的缸号提示（dyeLotRequirement）体现了对制造业业务的深度理解

**问题与风险**：

| 编号 | 问题 | 严重度 |
|------|------|--------|
| SS-01 | `calcTotalMaterialNeeds` 中对每个生产工单逐一调用 `bomSvc.calcMaterialRequirements`（带 Redis 缓存），但若工单量大（如 100+ 个在产工单），仍会产生较多 Redis 查询和 BOM 展开计算 | 中 |
| SS-02 | 置信度仅基于历史出库次数，未考虑数据时效性（3个月前的 10 次记录和近 3 天的 3 次记录，后者可能更有参考价值）| 中 |
| SS-03 | 供应商查询 `JSON_CONTAINS(s.main_skus, CAST(? AS JSON))` 依赖 MySQL JSON 函数，若 main_skus 字段未建 JSON 虚拟列索引，全表扫描性能极差 | 高 |
| SS-04 | `persistSuggestions` 先清除全部 pending 建议再插入，若 INSERT 失败（中途抛异常），旧建议已被清除但新建议未写入，导致建议区短暂为空 | 中 |
| SS-05 | 建议编号生成（`SG${Date.now()}${Math.random()...}`）在极端并发下（毫秒级相同时间戳）有极低概率重复 | 低 |

---

### 1.9 主动建议引擎（proactive.service.ts）

**定位**：后台定时扫描，主动发现业务异常

**现状**：
- 5 类扫描场景：库存预警 / 订单逾期风险 / 成本异常波动 / 产能超负荷 / 质量下滑
- 幂等设计：SHA256 前 16 位作为 dedup_key，当日重复扫描不重复写入
- 并发扫描（Promise.allSettled），单场景失败不影响其他

**优点**：
- Promise.allSettled 容错设计优秀，单个扫描失败不会中断整体
- 幂等 key 设计（类型+实体+日期的哈希）避免了重复建议堆积
- 5 个场景覆盖了制造业核心风险，与 PRD 对齐

**问题与风险**：

| 编号 | 问题 | 严重度 |
|------|------|--------|
| PS-01 | 低库存扫描（scanLowStock）查询的是 `inventory_balances` 视图/表，而 ai.service.ts 中的库存查询从 `inventory` 主表实时聚合，**两处库存数据源不一致**，可能导致主动建议与实时查询数据出现矛盾 | 高 |
| PS-02 | `runProactiveScan` 静态方法中 `userId` 默认值为 1（硬编码），若 userId=1 不存在于某个租户，`created_by` 字段将引用无效用户 | 中 |
| PS-03 | 扫描任务由 Bull Queue 或 cron 触发（文档说明），但代码中未见实际的 cron 注册逻辑，依赖手动调用 `POST /api/ai/scan`，无法自动化运行 | 高 |
| PS-04 | 产能超负荷扫描（scanCapacityOverload）基于活跃工人数×8小时，未考虑请假/排班，准确性有限 | 低 |

---

### 1.10 前端 AI 对话页面（AiChatPage.tsx）

**定位**：AI 对话中心，React 实现

**现状**：
- 双栏布局（会话历史列表 + 对话区），移动端抽屉模式
- SSE 客户端实现：fetch + ReadableStream + TextDecoder
- 会话持久化：localStorage（key: `sf_ai_conversations`）
- 思考状态：AiThinkingState 组件，三步骤可视化
- DataCard 内联渲染（table / kpi 两种模式）

**优点**：
- SSE 客户端实现完整，支持 AbortController 取消
- 三步骤思考状态与后端 phase 帧对应，用户体验好
- 错误处理：AbortError 单独处理（取消不视为错误），其他错误展示重试按钮

**问题与风险**：

| 编号 | 问题 | 严重度 |
|------|------|--------|
| UI-01 | SSE 解析代码中，后端的 phase 帧（`{phase: 'thinking', label: '...'}`）在前端被**完全忽略**——前端仅处理 `{content}` 和 `{dataCard}` 字段，phase 帧静默丢弃，前端的"思考步骤"状态仅由 `setThinking(true)` 驱动，与后端 phase 帧脱节 | 中 |
| UI-02 | 会话仅存于 localStorage，**未同步到后端**。前端新建会话后，`sessionId` 不传给后端（`/api/ai/chat` 请求 body 中 sessionId 为 body.sessionId，但页面中发起请求时只传 `{message: trimmed}` 未传 sessionId），对话历史无法在多设备间同步，也无法在后端分析 | 高 |
| UI-03 | 快捷回复 Chips（"查看详情"/"生成报告"/"导出数据"/"推荐操作"）是静态的，与当前 AI 回复内容完全无关，用户点击后 AI 无法理解这些抽象指令（意图识别无对应规则），体验很差 | 中 |
| UI-04 | 会话历史保存在内存（React state）和 localStorage，无大小限制控制，对话内容过多时 localStorage 可能写满（已有 `catch` 静默忽略），但内存侧无清理机制 | 低 |

---

### 1.11 AI 浮动按钮（AiFloatButton.tsx）

**现状**：简单的导航按钮，点击跳转 `/ai-chat`，在 `/ai-chat` 页面自动隐藏。

**评估**：实现简洁，功能完整，符合 MVP 要求。无问题。

---

## 二、发现问题汇总

### 严重问题（Blocker，需立即修复）

| 编号 | 模块 | 问题描述 |
|------|------|----------|
| RG-03 | 响应生成器 + 前端 | 后端 SSE 帧字段名 `card` 与前端期望字段名 `dataCard` 不匹配，导致所有数据卡片无法渲染 |
| AS-04 | AI 服务 | 对话历史 API 查询 `ai_messages` 表，但代码中没有任何写入该表的逻辑，历史记录接口始终返回空 |

### 高优先级问题（需在 MVP 上线前修复）

| 编号 | 模块 | 问题描述 |
|------|------|----------|
| IR-01 | 意图识别 | SKU 名称提取覆盖不足，大量不带引号的口语化 SKU 名称无法识别 |
| AS-01 | AI 服务 | 库存查询嵌套子查询，N+1 性能问题，数据量大时响应超时 |
| AS-02 | AI 服务 | 实时触发采购建议生成可能耗时过长，影响 SSE 30 秒超时 |
| CM-02 | 上下文管理 | sessionId 未纳入 Redis key，多会话共享同一上下文 |
| PS-01 | 主动建议 | 主动建议与实时查询使用不同数据源（inventory_balances vs inventory 主表聚合） |
| PS-03 | 主动建议 | 定时扫描没有自动触发机制，完全依赖手动调用 |
| SS-03 | 采购建议 | 供应商查询 JSON_CONTAINS 无索引，全表扫描 |
| UI-02 | 前端 | sessionId 未传入后端，对话历史无法持久化和多端同步 |

### 中优先级问题（迭代优化）

| 编号 | 模块 | 问题描述 |
|------|------|----------|
| RG-01 | 响应生成 | 模拟流式输出，文本质量固定，缺乏真正的 AI 生成能力 |
| RG-02 | 响应生成 | 无法处理自由问答，兜底响应体验差 |
| RG-05 | 响应生成 | 质量趋势字段 passRateDelta 从未被赋值 |
| CM-01 | 上下文管理 | 指代词检测仅匹配句首 |
| CM-03 | 上下文管理 | waiting_entity 状态从未被触发（死代码） |
| AS-03 | AI 服务 | 成本分析无实体时回退 general_qa 但无说明 |
| AS-05 | AI 服务 | 问候语检测逻辑错误（对 entities.raw 做匹配而不是原始输入） |
| CE-01 | 约束引擎 | 产能计算未排除周末和法定节假日 |
| CE-03 | 约束引擎 | 成本历史均值与当前 BOM 无关联 |
| BOM-01 | BOM 建议 | 置信度计算在 7 次以上均达上限，失去区分度 |
| BOM-02 | BOM 建议 | 平均用量未按规格加权 |
| SS-01 | 采购建议 | 多工单 BOM 展开循环查询性能问题 |
| SS-02 | 采购建议 | 置信度未考虑数据时效性 |
| SS-04 | 采购建议 | persistSuggestions 清除后 INSERT 失败导致建议区短暂为空 |
| UI-01 | 前端 | 后端 phase 帧被前端静默丢弃 |
| UI-03 | 前端 | 静态快捷回复 Chips 与上下文无关，意图识别无法匹配 |
| RT-01 | 路由 | 按 IP 限流对多租户 SaaS 不合理 |
| PS-02 | 主动建议 | userId 硬编码为 1 |

---

## 三、优先级排序的迭代建议

### P0 — 当前 Sprint 修复（上线前必须解决）

**1. 修复 SSE 字段名不匹配（RG-03 + UI-01）**
- 后端 `response.generator.ts` 第 140 行：将 `write({ card })` 改为 `write({ dataCard: card })`
- 前端同步确认 phase 帧的处理逻辑
- 预计工时：0.5 天

**2. 修复对话历史存储缺失（AS-04）**
- 在 `ContextManager.appendTurn` 中同步写入 `ai_messages` 表（含 session_id 支持）
- 或将 `listConversations` 改为从 Redis 读取（短期方案）
- 预计工时：1 天

**3. 修复问候语检测逻辑（AS-05）**
- `buildGeneralAnswer` 中对 `recognition.entities.map(e => e.raw).join('')` 的匹配应改为对原始用户输入（`req.message`）匹配
- 需要将 userInput 传入或存入 recognition 结构
- 预计工时：0.5 天

**4. 上线定时扫描机制（PS-03）**
- 在应用启动时注册 cron job（推荐使用 node-cron 或 Bull Queue）
- 建议每 30 分钟触发一次 `runProactiveScan` for all active tenants
- 预计工时：1 天

**5. 前端传入 sessionId（UI-02）**
- `AiChatPage.tsx` 发起 `/api/ai/chat` 请求时将 `activeConvId` 作为 sessionId 传入
- 后端 `ContextManager` 将 sessionId 纳入 Redis key
- 预计工时：1 天

### P1 — 下一个 Sprint 迭代

**6. 修复库存查询 N+1 问题（AS-01）**
- 将嵌套子查询改为 LEFT JOIN + GROUP BY 或创建 `inventory_balances` 物化视图
- 建立对应索引（sku_id, tenant_id）

**7. 采购建议生成改为异步任务（AS-02）**
- 若 purchase_suggestions 表无有效缓存，先返回 "建议生成中，请稍后刷新" 的提示
- 后台触发 `SuggestionService.generateSuggestions()` 异步执行
- 或在 proactive scan 时预先生成采购建议并写表

**8. 修复 passRateDelta 质量趋势缺失（RG-05）**
- `queryQualityStats` 增加对比上一周期的查询
- 计算良品率变化量（delta）并写入 businessData

**9. 修复供应商查询索引问题（SS-03）**
- 在 `suppliers.main_skus` JSON 字段上创建虚拟列或全文索引
- 或将 supplier-sku 关系改为独立关联表（推荐）

**10. 约束引擎产能计算引入工作日历（CE-01）**
- 接入工作日历表，排除周末和法定节假日
- 或暂时采用 0.7 系数折算（7天中约5天工作日）

### P2 — Phase 2 AI 升级（接入真实 LLM）

**11. 引入 LLM 进行意图识别和自由问答（IR-01、RG-01、RG-02）**

架构方案：

```
用户输入
  → IntentClassifier（保留规则引擎作为快速分类）
  → 若高置信度：走现有 SQL 查询路径
  → 若低置信度：调用 LLM（Claude API / OpenAI API）
      - System Prompt：注入业务上下文（租户数据摘要）
      - 支持 Function Calling / Tool Use
      - 流式响应直接 pipe 到 SSE
```

推荐技术：
- **Anthropic Claude API**（claude-3-5-sonnet）：支持 Tool Use，适合结构化业务查询
- **LangChain TS**：工具链编排，便于集成多个 DataSource Tool
- 保留现有 SQL 查询函数作为 Tool 实现

System Prompt 设计要点：
```
你是智造管家 AI 助手，服务于制造业中小企业。
你可以调用以下工具查询业务数据：
- query_inventory(sku_name?, category?)：查询库存
- get_purchase_suggestions()：获取采购建议
- get_production_schedule(date?, order_no?)：排产查询
...
当前租户：{tenantName}，日期：{today}
最近对话：{recentTurns}
```

**12. BOM 建议升级（BOM-01、BOM-02、BOM-03）**
- 引入向量相似度：将 BOM 物料清单编码为向量，基于 cosine similarity 推荐相似产品的 BOM
- 推荐技术：OpenAI text-embedding-3-small + Pinecone 向量库，或使用 MySQL 8.0.32+ 的向量搜索
- 置信度改为 sigmoid 函数，避免线性上限问题

**13. 主动建议 AI 化（PS）**
- 在现有 5 类规则扫描之上，增加 LLM 分析层
- 每日生成租户经营分析摘要（当日异常汇总 → LLM 生成自然语言解读）
- 建议操作从固定文本改为 LLM 根据上下文生成具体操作指引

---

## 四、AI 工程最佳实践评估

### Prompt Engineering

**当前状态**：无 Prompt（Phase 1 无 LLM 调用）

**评估**：`response.generator.ts` 有 `[artifact:Prompt设计]` 标注，但本质是模板字符串拼接，不涉及 Prompt 工程。Phase 2 引入 LLM 前需设计以下内容：
- 系统级 System Prompt（角色定义、工具描述、输出格式约束）
- Few-shot 示例（覆盖制造业典型查询场景）
- 防幻觉指令（"如无相关数据请明确说明，不要编造数据"）
- 输出格式化指令（JSON 结构化输出，便于解析）

### 模型调用 Fallback/降级

**当前状态**：无外部 LLM 调用，规则引擎不存在降级问题。

**Phase 2 需要设计**：
- LLM 调用失败时降级到规则引擎
- 超时（>5s）时返回缓存数据并标注"数据可能不是最新"
- Token 限制管理：历史对话超过 32K token 时自动截断，保留最近 N 轮

### 结构化响应解析

**当前状态**：`response.generator.ts` 已设计良好的类型系统（TableCard/MetricCard 等），但 Phase 1 中由代码直接构建，无需解析。

**Phase 2 需要**：使用 LLM Function Calling 的结构化输出，或使用 JSON Schema 校验 LLM 输出结果。

### AI 输出质量监控

**现状**：
- 用户反馈机制（helpful/unhelpful）已实现：`ai_feedbacks` 表 + `POST /api/ai/feedback` 接口
- 前端未暴露反馈按钮（AiChatPage.tsx 中无此入口）

**缺失**：
- 反馈数据无分析/查询接口
- 意图识别的命中率统计（matchedRules 仅用于调试，未汇总统计）
- AI 响应延迟监控
- 低置信度（general_qa fallback）率统计

---

## 五、最终结论

### MVP 能力达标评估

| 能力维度 | 评估结论 | 达标状态 |
|----------|----------|----------|
| SSE 流式输出 | 实现完整，超时/错误处理完善，帧格式基本兼容（一处字段名 bug 需修复） | 基本达标（修复 RG-03 后） |
| 多轮对话上下文 | Redis 存储+指代词检测基本可用，sessionId 隔离缺失 | 部分达标 |
| 业务数据查询覆盖 | 6 类意图全部覆盖：库存/采购/排产/质量/成本/订单，覆盖主要业务场景 | 达标 |
| 错误恢复和超时 | 30 秒超时、重试机制、错误帧均完整实现 | 达标 |
| BOM AI 建议 | 基于频次的协同过滤，算法思路合理，有置信度区分，置信度上限问题需优化 | 基本达标 |
| 订单约束引擎 | 四维规则引擎完整，产能计算精度略低（未考虑工作日历） | 基本达标 |
| 采购建议生成 | 需求缺口计算完整，实时生成性能隐患需解决 | 基本达标（性能需优化） |
| 主动建议推送 | 5 类场景完整，幂等设计良好，**缺少自动定时触发机制** | 不达标（需补充 cron） |
| 前端 AI 体验 | 会话管理/快捷问答/DataCard/思考状态齐全，SessionId 缺失影响历史同步 | 基本达标 |
| AI 质量监控 | 反馈接口存在，前端未暴露，无监控数据分析 | 不达标 |

### 总体结论

**当前 AI 能力在解决 2 个严重 Bug（字段名不匹配 + 对话历史存储缺失）和 1 个功能缺失（定时扫描）后，可以满足 MVP 发布要求**。

现有 AI 能力定位准确：Phase 1 规则引擎 + 结构化 SQL 查询的路线对于 MVP 阶段是合理选择，不引入外部 LLM 依赖，稳定性可控。代码整体工程质量较高，架构分层清晰（Intent → Context → BusinessData → ResponseGenerator），为 Phase 2 接入真实 LLM 预留了良好的扩展点（Phase 2 升级方向在代码注释中均有标注）。

核心改进方向分为两阶段：
- **近期（P0/P1）**：修复 bug、补全 sessionId 隔离、完善定时扫描、解决性能 N+1 问题
- **中期（Phase 2）**：接入 Anthropic Claude API + LangChain Tool Use，将模板引擎升级为真正的 LLM 流式对话，同时保留规则引擎作为高置信度场景的快速路径

---

*本报告由 AI 工程师角色基于代码审查生成，评审日期 2026-03-11*
