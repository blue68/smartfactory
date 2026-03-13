# [artifact:工程审批] Sprint 1 SDD 审批报告

**审批人**: engineering-manager
**审批日期**: 2026-03-12
**审批对象**: SDD-sprint1.md v1.0.0
**输入文档**:
- `docs/v2/SDD-sprint1.md`（1597行，tech-lead-architect 出品）
- `docs/v2/sprint1-user-stories.md`（716行，senior-ai-agent-pm 出品）
- `docs/v2/PRD-v2-iteration-plan.md`（含业务决策 BD-001~BD-004）

---

## 审批结论

```
APPROVED_WITH_CONDITIONS
```

Sprint 1 SDD 整体设计质量良好，架构合理，API 契约清晰，可以进入编码阶段。但存在 **6 个必须在编码过程中同步解决的强制修正项（P0/P1）** 和 **5 个建议改进项**，不得忽略。以下强制修正项须由后端/前端工程师在实现阶段自行落实，不需要重新提交设计审批。

---

## 一、逐项需求审查结论

### R-01 SKU 类目自定义配置

**审查结论**: PASS（附条件）

**覆盖情况**：
- SDD 3.3 覆盖了 GET/POST/PATCH/DELETE 四个接口，与 US-S1-001 和 US-S1-002 的验收条件基本对齐。
- 树形结构查询（`GET /api/sku-categories`）设计合理，`isSystem` 字段由 `tenant_id=0` 语义替代，逻辑自洽。
- 软删除机制（`is_active=0`）符合 US-S1-001 AC-001-01 非功能要求。

**发现问题**:

**[P0-R01-01] 删除逻辑与 US 要求不符（强制修正）**

SDD 3.3.4 的删除业务规则（第 4-5 条）明确：当一级类目有子类目时返回 400 并要求先删子类目。但 US-S1-001 AC-001-05 要求的是**级联删除**（一级 + 所有子二级一并删除，相关 SKU 的 category_id 置空）。SDD 设计选择"阻断删除"而非"级联删除"，与已确认需求矛盾。

后端工程师在实现时**必须**按 User Story 实现级联删除语义：
1. 检查子类目及子类目下的 SKU 总数
2. 返回二次确认信息（子类目数量 + SKU 总数）
3. 用户确认后，一次事务内级联软删除一级类目和所有子二级类目，并将相关 SKU 的 `category1_id` / `category2_id` 置 NULL

**[P1-R01-02] 审计日志接口未设计**

US-S1-001 AC-001-06 明确要求类目增/改/删操作写入审计日志，且支持在管理页面按时间范围查询。SDD 第 3 章未涉及审计日志相关 API（查询接口）及存储方案。

后端工程师实现时须补充：
- 审计日志写入逻辑（写入现有 `audit_logs` 表或新建）
- `GET /api/sku-categories/audit-logs` 查询接口（支持时间范围筛选）

**[P1-R01-03] 类目名称唯一性校验范围存在歧义**

SDD 3.3.2 的唯一索引为 `(tenant_id, level, code)`，而 US 要求的是**名称（name）唯一**，非 code 唯一。当前设计中 name 无唯一约束，可能允许同名不同 code 的情况。

后端工程师须在应用层增加 `name` 唯一性校验（同租户同 level），并根据实际产品决策确认是否需要在数据库层增加 name 的唯一索引（注意 `name` 为可变字段，建议仅应用层校验）。

---

### R-02 供应商导出与绩效对比

**审查结论**: PASS（附条件）

**覆盖情况**：
- 导出接口 `GET /api/suppliers/export` 设计完整，响应格式、Excel 列定义、流式写入均已明确。
- 绩效对比接口 `POST /api/suppliers/compare` 设计合理，Redis 缓存策略合理。
- 前端 CompareDrawer 设计清晰。

**发现问题**:

**[P1-R02-01] 对比供应商数量上限与 US 不一致**

SDD 4.3.2 的 Zod Validation 限制为 `min(2).max(4)`，但 US-S1-004 AC-004-01 明确要求为 **2-5 家**。

后端和前端工程师均须将上限改为 5，Zod schema 中 `.max(4)` 改为 `.max(5)`，前端按钮的 disabled 条件也须同步修改。

**[P1-R02-02] 绩效对比维度不完整**

US-S1-004 AC-004-03 要求雷达图包含 6 个维度：准时交货率、质量合格率、价格竞争力、响应速度、服务满意度、综合评分。SDD 4.3.2 的响应体仅包含 `onTimeRate`（准时率）、`totalOrders`（订单数）、`avgLeadDays`（平均交货天数），缺少质量合格率、价格竞争力、响应速度、服务满意度四个维度。

后端工程师须扩展 `/compare` 接口响应体，补充缺失的绩效维度字段（若源数据不可计算，返回 null 并前端展示"数据不足"）。

**[建议-R02-01] 导出文件命名与 US 不一致**

US-S1-003 AC-003-03 要求文件命名为 `供应商列表_{YYYY-MM-DD}.xlsx`（中文命名），SDD 4.3.1 使用 `suppliers_{dateStr}.xlsx`（英文命名）。建议后端统一使用中文文件名并做 RFC 5987 编码处理（`filename*=UTF-8''...`）。

---

### R-03 采购价格批量导入

**审查结论**: PASS（附条件）

**覆盖情况**：
- 模板设计、导入流程（校验→写入→返回结果）设计合理。
- 批量预加载校验字典的方案有效防止 N+1 查询（T-03 风险已缓解）。
- 安全风险（魔数检测、multer 内存存储）已考虑。

**发现问题**:

**[P0-R03-01] 导入上限与 US 要求严重不符（强制修正）**

SDD 5.3.2 写明"单次导入最多 500 行，超出返回 400"，但 US-S1-005 AC-005-03 明确要求单次上限为 **5000 条**，非功能需求也要求"5000 条数据的后端解析和写入操作采用异步处理"。

SDD 的 500 行限制与 User Story 相差 10 倍，且未设计异步任务队列（进度查询接口 `GET /purchase-prices/import/{taskId}/status`），这会直接导致大批量导入超时失败。

后端工程师须按 US 要求实现：
- 上限提升为 5000 行
- 采用异步任务队列处理（建议 Bull/Redis Queue 或简单的后台 Promise）
- 补充 `GET /api/prices/import/{taskId}/status` 进度查询接口
- 补充 `POST /api/prices/import/{taskId}/confirm` 确认导入接口

**[P1-R03-02] 重复价格处理策略与 BD-001 快照机制不一致**

SDD 5.3.2 第 6 步写明"每条价格写入前自动将同 supplier+sku 的旧价格标记为 `is_current=false`"，这是覆盖写语义。但 US-S1-005 AC-005-05 要求的是**追加为新版本，不覆盖历史记录**，并与 BD-001 快照机制一致。

后端工程师须修改为追加模式：重复记录（同 SKU + 供应商 + 报价日期）追加为新记录，不修改历史记录状态。

**[P1-R03-03] 导入向导步骤数量与 US 不一致**

US-S1-005 AC-005-01 要求 4 步向导：下载模板→上传文件→**预览校验**→确认导入。SDD 5.4.2 设计为 3 步（上传→进度→结果），缺少"预览校验"步骤（用户在确认导入前查看解析结果并选择处理方式）。

前端工程师须按 US 实现 4 步向导，预览阶段须展示行级错误高亮表格并提供"跳过错误行"或"取消导入"的选择。

---

### R-05 工序极限工时与工价计算

**审查结论**: PASS（附条件）

**覆盖情况**：
- `process_steps.max_hours` 字段增加方案完整，向前兼容（历史数据允许 NULL）。
- `process_wages` 表设计合理，`uk_tenant_step_grade` 唯一约束有效保证数据完整性。
- 工价计算公式（计件优先、计时兜底）逻辑清晰。
- BD-002 要求的 `unit_price_skilled` / `unit_price_apprentice` 语义通过 `process_wages` 表的 `worker_grade` 枚举字段实现，设计上合规。

**发现问题**:

**[P0-R05-01] users/worker_profiles 表未设计 skill_level 字段（强制修正）**

BD-002 明确要求：`user 表（或 worker_profiles 表）必须包含 skill_level 字段`，且工人等级未配置时系统拒绝完工上报提交。

SDD 第 6 章完全未涉及 `skill_level` 字段的数据库设计，仅在术语表中提到 `worker_grade` 枚举常量，DDL 汇总（第 8 章）中也没有该字段的 ALTER 语句。这是 BD-002 的核心数据库变更，遗漏此项将导致工资核算逻辑无法实现。

后端工程师须补充：
```sql
ALTER TABLE `users` ADD COLUMN `skill_level`
  ENUM('skilled','apprentice') NULL DEFAULT NULL
  COMMENT '工人等级：skilled=熟练工，apprentice=学徒工';
```
（若存在独立 `worker_profiles` 表则加在该表上）

同时须补充：
- `PATCH /api/users/:userId/skill-level` 接口（仅 admin 可调用）
- 完工上报接口在 `skill_level IS NULL` 时返回 400，提示管理员配置工人等级

**[P1-R05-02] 工价接口缺少 admin 权限过滤逻辑**

US-S1-007 AC-007-04 要求 `GET /process-configs` 接口按角色过滤工价字段（非 admin 角色返回数据中工价字段置空）。SDD 6.3 中设计的工价查询接口（`GET /process-configs/steps/:stepId/wages`）未说明权限控制逻辑。

后端工程师须在工价相关接口增加：
- 查询接口：非 admin 角色返回 403 或返回空工价
- 写入接口：仅 admin 可操作，其他角色返回 403

**[P1-R05-03] 工资核算汇总接口（US-S1-008）未在 SDD 中设计**

US-S1-008 要求 `GET /reports/wages` 聚合接口（按工人/工序/时间段汇总）及 `GET /my/wages` 个人工资接口。SDD 第 6 章仅设计了工价配置接口，未包含工资核算报表接口。

后端工程师须补充：
- `GET /api/reports/wages`（支持 dateRange、workerIds、processIds、grade 筛选参数，返回按工人分组的汇总数据）
- `GET /api/reports/wages/export`（工资报表 Excel 导出）
- `GET /api/my/wages`（工人个人工资查询）

---

### R-06 Web 端任务管理

**审查结论**: PASS（附条件）

**覆盖情况**：
- 5 个接口设计覆盖了任务列表、详情、开始、完工、异常上报的完整操作链路。
- `task_exceptions` 表设计合理，DDL 完整。
- 权限控制逻辑（管理员 vs 工人）有明确说明。
- 前端组件拆分（TaskListPage / TaskDetailPage / CompleteReportDrawer / ExceptionReportModal）合理。

**发现问题**:

**[P1-R06-01] 乐观锁机制未设计**

US-S1-010 AC-010-06 明确要求完工上报接口携带 `version` 版本号，后端检测冲突返回 409，这是防止 Web 端和小程序端并发操作导致数据错误的核心机制（PRD 风险 T-V2-005 也明确提出此要求）。

SDD 7.3.4 的完工接口请求体未包含 `version` 字段，也未说明乐观锁实现方案。

后端工程师须：
1. 在 `production_orders`（或等价任务表）增加 `version` INT 字段（默认值 1）
2. 完工上报接口请求体增加 `version` 字段
3. 实现乐观锁校验：提交时 WHERE `id=? AND version=?`，若影响行数为 0 则返回 409

**[建议-R06-01] 车间主管异常处置接口未设计**

US-S1-011 AC-011-06 要求车间主管可对"异常待处理"任务执行「标记已处理」或「挂起任务」操作。SDD 仅设计了异常上报接口，缺少主管处置接口。

建议后端工程师补充：
- `PATCH /api/production/tasks/:taskId/resolve-exception`（主管处置：标记已处理 / 挂起）

---

## 二、数据库变更安全审查

| 变更项 | 安全评估 | 意见 |
|--------|---------|------|
| M-01: `sku_categories` 唯一索引 | 中风险 | 执行前必须先检查重复数据（SDD T-01 已提示），建议在迁移脚本头部加 ROLLBACK 保护 |
| M-02: `purchase_orders` 新增索引 | 低风险 | 纯增量操作，不影响存量数据，安全 |
| M-03: `suppliers` 新增索引 | 低风险 | 同上，安全 |
| M-04: `process_steps` 新增 `max_hours` | 低风险 | NULL 默认值，向前兼容，安全 |
| M-05: 新建 `process_wages` | 低风险 | 新表，无历史数据影响，安全 |
| M-06: 新建 `task_exceptions` | 低风险 | 新表，安全 |
| 缺失: `users.skill_level` 字段 | 高风险（缺失） | 必须补充，见 P0-R05-01 |

**总体结论**: DDL 无破坏性变更，所有变更均为增量操作或新建，向前兼容性良好。M-01 需注意重复数据前置清理。

---

## 三、业务决策一致性审查（BD-001 ~ BD-004）

| 业务决策 | SDD 覆盖情况 | 审查结论 |
|---------|-------------|---------|
| BD-001 快照机制 | SDD 在 R-03 中引用了快照语义（追加不覆盖），但实现逻辑（6.3.2 is_current=false）与快照原则矛盾 | 不合规，见 P0-R03-01 |
| BD-002 工价区分工人等级 | `process_wages` 表的 `worker_grade` 枚举实现了双等级工价；但 `users.skill_level` 字段未设计 | 部分合规，见 P0-R05-01 |
| BD-003 紧急插单权限 | BD-003 属于 Sprint 2 范围，Sprint 1 不涉及，无需审查 | 不适用 |
| BD-004 来料质检不合格处理 | BD-004 属于 Sprint 3 范围，Sprint 1 不涉及，无需审查 | 不适用 |

---

## 四、数据/资金闭环原则审查

PRD 总原则：**业务底层数据流向和资金流向必须形成闭环。**

针对 Sprint 1 范围评估：

| 链路 | Sprint 1 设计是否支撑闭环 |
|-----|------------------------|
| SKU 分类 → SKU 录入 → BOM 引用 | R-01 类目 CRUD 已设计，SKU category_id 外键关联，删除类目时 SKU 置空保留数据完整性，闭环支撑完整 |
| 供应商 → 采购价格 → 采购决策 | R-02 绩效对比 + R-03 价格批量导入共同支撑采购决策数据链，闭环设计合理 |
| 工序配置 → 完工上报 → 工资核算 | R-05 工价配置已设计；但工资核算报表接口（US-S1-008）未在 SDD 中体现，数据流向的下游消费端缺失，**部分断链** |
| 生产任务 → 完工上报 → 工资记录 → 工资报表 | 完工上报接口已设计，但工资写入逻辑（`wage_amount` 字段）及工资查询接口未在 SDD 中明确，**部分断链** |

**结论**: 工资核算数据流存在设计断链，工程师需按 P1-R05-03 补全工资报表接口。

---

## 五、强制修正项汇总（编码前必须落实）

| 编号 | 严重级别 | 所属需求 | 问题描述 | 责任方 |
|-----|---------|---------|---------|--------|
| P0-R01-01 | P0 | R-01 | 删除逻辑须改为级联删除（含子类目和 SKU 置空） | 后端工程师 |
| P0-R03-01 | P0 | R-03 | 导入上限从 500 改为 5000，补充异步队列和进度查询接口 | 后端工程师 |
| P0-R05-01 | P0 | R-05 | 补充 `users.skill_level` 字段 DDL 及配置接口，完工上报增加等级校验 | 后端工程师 |
| P1-R01-02 | P1 | R-01 | 补充审计日志写入逻辑和查询接口 | 后端工程师 |
| P1-R01-03 | P1 | R-01 | 补充类目名称（name）应用层唯一性校验 | 后端工程师 |
| P1-R02-01 | P1 | R-02 | 对比供应商上限从 4 改为 5 | 后端 + 前端工程师 |
| P1-R02-02 | P1 | R-02 | 绩效对比接口补充 6 维度完整字段 | 后端工程师 |
| P1-R03-02 | P1 | R-03 | 重复价格处理改为追加语义（不修改历史记录） | 后端工程师 |
| P1-R03-03 | P1 | R-03 | 前端补充预览校验步骤（4步向导，不是3步） | 前端工程师 |
| P1-R05-02 | P1 | R-05 | 工价接口增加 admin 权限过滤 | 后端工程师 |
| P1-R05-03 | P1 | R-05 | 补充工资报表接口（reports/wages）和个人工资接口 | 后端工程师 |
| P1-R06-01 | P1 | R-06 | 完工上报接口增加乐观锁（version 字段 + 409 冲突响应） | 后端 + 前端工程师 |

---

## 六、建议改进项（非阻断，推荐执行）

| 编号 | 建议描述 | 责任方 |
|-----|---------|--------|
| 建议-R02-01 | 导出文件命名改为中文（`供应商列表_{date}.xlsx`），用 RFC 5987 编码 Content-Disposition | 后端工程师 |
| 建议-R06-01 | 补充车间主管异常处置接口（resolve-exception） | 后端工程师 |
| 建议-全局-01 | `task_exceptions.images` JSON 字段建议增加数组长度约束（应用层限制最多 5 张，与 US 一致） | 后端工程师 |
| 建议-全局-02 | SDD 对 `console.info` 日志规范的要求是正确的，建议统一使用项目现有 Logger 实例而非原生 console | 后端工程师 |
| 建议-全局-03 | process_wages 表的 `uk_tenant_step_grade` 唯一约束使用 REPLACE 或 ON DUPLICATE KEY UPDATE，需在事务内执行，避免并发竞态 | 后端工程师 |

---

## 七、编码阶段任务清单

### 后端任务清单（按依赖顺序）

**优先级 P0（先行）**

- [ ] BE-01: `users` 表增加 `skill_level` 枚举字段（DDL M-07，补充到迁移脚本）
- [ ] BE-02: `PATCH /api/users/:userId/skill-level` 接口（仅 admin，写审计日志）
- [ ] BE-03: `sku_categories` 完整 CRUD，删除逻辑改为级联删除（事务内：软删子类目 + SKU 置空）
- [ ] BE-04: 类目审计日志写入 + `GET /api/sku-categories/audit-logs` 查询接口

**优先级 P1（主体功能）**

- [ ] BE-05: 执行全部 DDL 迁移脚本（M-01 ~ M-07，含执行前重复数据检查）
- [ ] BE-06: `GET /api/suppliers/export` 供应商导出接口（流式 Excel，中文文件名）
- [ ] BE-07: `POST /api/suppliers/compare` 绩效对比接口（6 维度，上限 5 家，Redis 缓存）
- [ ] BE-08: `GET /api/prices/import-template` 模板下载
- [ ] BE-09: 价格批量导入异步流程（上传接口 → 异步队列 → 进度查询接口 → 确认导入接口），上限 5000 行，追加语义
- [ ] BE-10: `process_steps.max_hours` 字段 CRUD 接口（含 `max_hours >= standard_hours` 校验）
- [ ] BE-11: `process_wages` 工价配置接口（GET/PUT，admin 权限控制，修改写审计日志）
- [ ] BE-12: 完工上报接口增强（工人等级校验 + 工资核算写入 + 乐观锁 version 校验 + 超时预警标记）
- [ ] BE-13: `GET /api/reports/wages` 工资汇总接口（按工人/工序/等级/时间段聚合）
- [ ] BE-14: `GET /api/reports/wages/export` 工资报表导出
- [ ] BE-15: `GET /api/my/wages` 个人工资接口（仅返回本人数据）
- [ ] BE-16: Web 端任务列表/详情接口（`GET /api/production/tasks`，`GET /api/production/tasks/:id`）
- [ ] BE-17: 确认/补充 `POST .../start` 和 `POST .../complete` 路由（complete 接口增加 version 乐观锁）
- [ ] BE-18: `POST /api/production/tasks/:id/exception` 异常上报接口（含多图上传）
- [ ] BE-19: `PATCH /api/production/tasks/:id/resolve-exception` 主管处置接口（建议项）

### 前端任务清单（按依赖顺序）

**优先级 P0（先行）**

- [ ] FE-01: `CategoryConfigPage.tsx` — 类目树展示，系统预置类目禁用操作按钮，支持展开/折叠
- [ ] FE-02: 新增/编辑类目 Drawer（code 仅新增时可编辑，name/sortOrder 可改）
- [ ] FE-03: 删除确认 Modal（展示子类目数 + 受影响 SKU 数，二次确认后发起级联删除）
- [ ] FE-04: 审计日志 Drawer（按时间筛选，展示操作人/时间/变更内容）

**优先级 P1（主体功能）**

- [ ] FE-05: `SupplierPage.tsx` — 供应商独立列表页（V1 遗留补全），含多选框、导出按钮、绩效对比按钮
- [ ] FE-06: `CompareDrawer.tsx` — 6 维度雷达图 + 关键指标对比表（最优值绿色高亮/最差值红色高亮），上限 5 家
- [ ] FE-07: `PriceImportPage.tsx` — 4 步向导（下载模板 → 上传 → 预览校验行级高亮 → 确认导入），进度轮询
- [ ] FE-08: `ProcessConfigPage.tsx` — 工序模板详情页独立完整版（V1 遗留补全），含 max_hours 内联编辑
- [ ] FE-09: `WageConfigSection.tsx` — 熟练工/学徒工双等级单价配置区块（admin 角色可见可编辑，supervisor 可见不可编辑，其他角色隐藏）
- [ ] FE-10: `WageReportPage.tsx` — 工资核算报表（筛选器 + 数据表格 + 柱状图切换 + 导出）
- [ ] FE-11: `MyWagePage.tsx` — 工人个人工资记录页
- [ ] FE-12: `TaskPage.tsx` — 任务列表页（工人视图：仅自己的任务；管理员视图：全部工人），响应式布局（375px）
- [ ] FE-13: `TaskDetailPage.tsx` — 任务详情页，BOM 快照只读展示，操作历史时间线
- [ ] FE-14: `CompleteTaskModal.tsx` — 完工上报弹窗（实时工资预览 + 超时预警提示 + 乐观锁冲突 409 处理）
- [ ] FE-15: `ExceptionReportModal.tsx` — 异常上报弹窗（多文件上传进度条 + 帮助图标提示）
- [ ] FE-16: 用户管理页工人等级字段（admin 可编辑，其他角色不可见）

---

## 八、审批附注

1. 本 SDD 总体设计规范，模块边界清晰，技术选型合理，Redis 缓存策略、流式 Excel 导出、UPSERT 工价更新等方案均属工程优选实践，予以认可。

2. tech-lead-architect 需在本审批结果基础上，将上述 P0/P1 强制修正项同步通知 senior-backend-engineer 和 senior-frontend-engineer，并在编码前确认各责任方已阅知。

3. 强制修正项中涉及新增数据库字段和接口的部分（BE-01/BE-13/BE-14/BE-15/BE-19），工程师实现后须主动通知 senior-qa-engineer 补充对应测试用例，保证验收覆盖。

4. R-03 价格批量导入的异步队列方案在 Sprint 1 时间盒内需合理评估实现复杂度，若 Sprint 内无法完成完整异步方案，允许以同步方式实现 500 行版本作为 MVP 先交付，但上线前必须在 Sprint 2 内补全 5000 行异步版本，且该技术债须明确记录在 Sprint Backlog 中。

5. senior-qa-engineer 在编写测试用例时，须以 sprint1-user-stories.md 中的验收条件（AC-001 至 AC-011 全部）为基准，而非仅以 SDD 为准，因为 SDD 存在上述与 US 不一致的问题。

---

**审批人**: engineering-manager
**审批日期**: 2026-03-12
**有效期**: 本审批适用于 Sprint 1 全部编码工作，Sprint 2 开始前须重新提交 SDD 审批。
