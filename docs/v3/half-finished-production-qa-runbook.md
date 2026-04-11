[artifact:TestCase]
status: READY
owner: senior-qa-engineer
scope:
- 半成品生产剩余事项的短版 QA 执行手册
- 统一本地与 CI 的后端自动化执行入口
inputs:
- [artifact:Approval]
- [artifact:TaskBreakdown]
- [artifact:TestReport]
- [artifact:DeploymentPlan]
- `package.json`
- `services/api/package.json`
- `scripts/run-api-integration.sh`
- `scripts/prepare-api-test-db.sh`
handoff_to:
- engineering-manager
- senior-backend-engineer
- devops-engineer

deliverables:
- 一页式 QA 分层执行说明
- unit / integration / e2e / 前端 mock 浏览器 / 前端真实后端浏览器 / 手工 smoke 的触发条件与推荐入口
- 本地与 CI 共用托管脚本，以及前端浏览器/冒烟环境依赖说明

current_progress:
- 后端托管测试已统一到 `npm run test:api:integration` / `npm run test:api:e2e`，并已接入 CI。
- 前端 mock 浏览器已形成固定回归层：`settlement`、`sales-order`、`purchase-delivery`、`process-config`。
- 前端真实后端浏览器当前已覆盖十一条业务流：`purchase`、`incoming-inspection`、`sales-order`、`process-config`、`production-schedule`、`production-order`、`production-task`、`production-shortage`、`inventory`、`stocktaking`、`settlement`。
- 上述十一条真实浏览器业务流均已具备 `smoke` 入口，并在 `develop` push 具备对应 `regression` 门禁。
- 采购域浏览器覆盖已从单条履约流扩展到三页：采购履约主链路、`incoming-inspection` 的页内新建/提交写路径，以及 `purchase-suggestions` 的审批/转单写路径。
- 库存域浏览器覆盖已从单页扩展到两页：`inventory` 的快照 / 追溯 / 手动入库，以及 `stocktaking` 的新建盘点 / 盘点确认。
- 生产域浏览器覆盖已从单点扩展到四页：排产、工单详情、任务详情、缺料看板，且四页都已进入 smoke / regression 分层。

layers:
- `unit`：改动纯函数、服务层分支、参数校验、兼容降级逻辑时优先执行。目标是最快锁定行为回归，不依赖外部服务。
- `integration`：改动 API 路由、控制器、鉴权、真实库查询、聚合读模型、库存/结算/工资等跨表读写时执行。默认入口：`npm run test:api:integration`。
- `e2e`：改动跨模块主链路、库存副作用、排产/报工/质检/采购/销售闭环时执行。默认入口：`npm run test:api:e2e`。
- `playwright-ui-mock`：改动销售结算、销售订单、采购到货详情回跳、工序配置等前端浏览器交互，但无需真实后端协同时执行。默认入口：`npm run test:web:ui:mock`。
- `playwright-ui-real`：改动采购、来料质检、采购建议管理、销售订单、工序配置、生产排产、生产工单详情、生产任务详情、生产缺料看板、库存总览、库存盘点或销售结算这类前端真实页面联动、路由跳转、抽屉/弹窗操作、浏览器侧表单交互，且需要真实 API / DB 协同时执行。默认入口：`npm run test:purchase:ui:smoke`、`npm run test:purchase:ui:regression`、`npm run test:incoming-inspection:ui:smoke`、`npm run test:incoming-inspection:ui:regression`、`npm run test:purchase-suggestion:ui:smoke`、`npm run test:purchase-suggestion:ui:regression`、`npm run test:sales-order:ui:smoke`、`npm run test:sales-order:ui:regression`、`npm run test:process-config:ui:smoke`、`npm run test:process-config:ui:regression`、`npm run test:production-schedule:ui:smoke`、`npm run test:production-schedule:ui:regression`、`npm run test:production-order:ui:smoke`、`npm run test:production-order:ui:regression`、`npm run test:production-task:ui:smoke`、`npm run test:production-task:ui:regression`、`npm run test:production-shortage:ui:smoke`、`npm run test:production-shortage:ui:regression`、`npm run test:inventory:ui:smoke`、`npm run test:inventory:ui:regression`、`npm run test:stocktaking:ui:smoke`、`npm run test:stocktaking:ui:regression`、`npm run test:settlement:ui:smoke` 或 `npm run test:settlement:ui:regression`。
- `smoke`：上线后、重部署后、配置变更后、数据库恢复后执行。目标是用最短时间确认真实环境基础链路可用。默认入口：`./scripts/smoke-test.sh`。

when_to_run:
- 只改前端展示文案、样式、纯组件状态：跑前端 `typecheck` + 页面/API 定向测试即可，不默认拉后端 integration。
- 改销售结算、销售订单、采购到货详情回跳、工序配置这类以前端路由和浏览器交互为主、且可用 mock API 覆盖的页面：优先跑 `npm run test:web:ui:mock`，必要时再定向跑单文件脚本。
- 改销售订单真实后端联动、发货/完成状态流、抽屉内操作按钮权限与浏览器侧提交：至少跑 `npm run test:sales-order:ui:smoke`。
- 若影响销售订单补发、发货记录叠加、剩余待发数量计算等更长链路，再跑 `npm run test:sales-order:ui:regression`。
- 改工序配置里的“管理工作站”、工作站类型维护、工作站新增/停用，以及相关真实接口联动：至少跑 `npm run test:process-config:ui:smoke`。
- 若影响工序节点的工作站绑定、具体工作站选择、最大工时、计件工资保存链路，再跑 `npm run test:process-config:ui:regression`。
- 改排产页的风险提示、工单/人员视图切换、重新生成、半成品产出语义或按工单聚焦链路：至少跑 `npm run test:production-schedule:ui:smoke`。
- 若影响排产页的微调弹窗、计划数量保存、重新生成后的人工修正持久化、主管确认下发并生成正式任务、或确认前后的主管干预链路，再跑 `npm run test:production-schedule:ui:regression`。
- 改生产工单页的详情抽屉、冻结结构快照、半成品工序链路、工单内任务列表等只读聚合块：至少跑 `npm run test:production-order:ui:smoke`。
- 若影响生产工单详情里的通配解析、多层冻结结构、工序链内多任务折叠、待排产工单取消、从销售订单手动创建工单、或更长的详情写路径链路，再跑 `npm run test:production-order:ui:regression`。
- 改生产任务页的详情抽屉、依赖与阻塞、投入产出流水、工资与工时、异常时间线等只读聚合块：至少跑 `npm run test:production-task:ui:smoke`。
- 若影响生产任务详情里的历史兼容降级、空投入产出/空工资报工、已处理异常时间线、前置工序解除阻塞后的恢复态、超时工资板块与混合异常时间线并存、主管在异常态抽屉里执行“标记已处理”/“挂起任务”的恢复与挂起写路径、主管从待开始抽屉执行“开始生产”并生成首批投入记录、或主管在进行中抽屉里执行“完工上报”并写入工资/产出结果，再跑 `npm run test:production-task:ui:regression`。
- 改缺料看板页的缺料聚合、风险分层、工单联动详情、工单级采购建议按钮、或缺料页到采购建议的浏览器交互：至少跑 `npm run test:production-shortage:ui:smoke`；若影响“为当前工单生成采购建议”这类真实写路径，再跑 `npm run test:production-shortage:ui:regression`。
- 改库存总览页的日结快照、实时库存追溯、手动入库、以及字符串 `skuId` 到浏览器提交流的兼容处理：至少跑 `npm run test:inventory:ui:smoke`。
- 若影响库存追溯的快照入口来源、追溯筛选/清空、实时流水读模型、或更长的库存浏览器联动链路，再跑 `npm run test:inventory:ui:regression`。
- 若同时改动“缺料看板默认仓位治理入口”与“库存页治理模式（仅看默认仓位/退出治理模式/重置筛选）”，额外跑 `PLAYWRIGHT_APP_BASE_URL=http://127.0.0.1:5173 npm run test:inventory-warehouse:ui:governance`。
- 改库存盘点页的任务列表、查看明细、创建盘点、确认盘点、或库存盘点与库存流水/日结快照的浏览器联动：至少跑 `npm run test:stocktaking:ui:smoke`；若影响在盘任务确认、差异库存调整、或更长的盘点写路径，再跑 `npm run test:stocktaking:ui:regression`。
- 改来料质检页的任务列表、质检单详情抽屉、页内新建质检单、提交质检结论、或来料质检与入库/退货副作用的浏览器联动：至少跑 `npm run test:incoming-inspection:ui:smoke`；若影响部分合格提交、入库与退货双副作用、或更长的质检写路径，再跑 `npm run test:incoming-inspection:ui:regression`。
- 改销售结算页的应收汇总、草稿确认、标记已付、以及角色权限按钮联动：至少跑 `npm run test:settlement:ui:smoke`。
- 若影响销售结算的客户汇总反向过滤、账龄逾期金额、逾期筛选或更长的应收读模型链路，再跑 `npm run test:settlement:ui:regression`。
- 改采购建议管理页的待审批列表、详情抽屉、单条审批、批量审批、转采购订单、或采购建议与采购订单的浏览器联动：至少跑 `npm run test:purchase-suggestion:ui:smoke`；若影响审批通过后转单、执行态回填、或更长的采购建议写路径，再跑 `npm run test:purchase-suggestion:ui:regression`。
- 改采购前端跨页流转、真实浏览器交互、按钮权限、抽屉/弹窗提交、前后端联动展示：至少跑 `npm run test:purchase:ui:smoke`；若影响整条采购履约链路，再跑 `npm run test:purchase:ui:regression`。
- 改后端控制器、服务层查询、状态归一、返回字段：至少跑对应 unit + 定向 integration。
- 改库存口径、任务完工、副作用事务、排产确认、销售发货、采购入库/退货：至少跑对应 unit + 定向 integration + 相关 e2e。
- 改共享基础设施（鉴权、Redis、队列、测试托管脚本、CI workflow）：跑 `npm run test:api:integration` 全量；涉及真实业务闭环时再跑 `npm run test:api:e2e` 全量。
- 发布、重启、恢复数据、切换 `.env` 或网关/反向代理配置后：补跑 `./scripts/smoke-test.sh <base-url>`，不要只看自动化历史结果。

recommended_commands:
- 后端 unit 定向：`cd services/api && npx jest tests/unit/<file>.test.ts --runInBand`
- 后端 integration 定向：`npm run test:api:integration -- tests/integration/<file>.test.ts`
- 后端 integration（来料质检链路定向）：`npm run test:api:integration:incoming-inspection`
- 外协链路关键单测（生产+排程+采购+质检）：`npm run test:api:outsource-flow:unit`
- 外协链路托管集成（含 API 启停）：`npm run test:api:outsource-flow:managed`
- 后端 integration 全量：`npm run test:api:integration`
- 后端 e2e 定向：`npm run test:api:e2e -- tests/e2e/<file>.e2e.test.ts`
- 后端 e2e 全量：`npm run test:api:e2e`
- 前端页面/API 定向：`cd services/web && npm test -- <path>`
- 前端 mock 浏览器全量：`npm run test:web:ui:mock`
- 前端 mock 浏览器结算页：`npm run test:web:ui:settlement`
- 前端 mock 浏览器销售订单：`npm run test:web:ui:sales-order`
- 前端 mock 浏览器采购到货：`npm run test:web:ui:purchase-delivery`
- 前端 mock 浏览器工序配置：`npm run test:web:ui:process-config`
- 采购前端 Playwright 冒烟：`npm run test:purchase:ui:smoke`
- 采购前端 Playwright 回归：`npm run test:purchase:ui:regression`
- 采购前端 Playwright 全量：`npm run test:purchase:ui`
- 采购建议管理前端 Playwright 冒烟：`npm run test:purchase-suggestion:ui:smoke`
- 采购建议管理前端 Playwright 回归：`npm run test:purchase-suggestion:ui:regression`
- 采购建议管理前端 Playwright 全量：`npm run test:purchase-suggestion:ui`
- 销售订单前端 Playwright 冒烟：`npm run test:sales-order:ui:smoke`
- 销售订单前端 Playwright 回归：`npm run test:sales-order:ui:regression`
- 销售订单前端 Playwright 全量：`npm run test:sales-order:ui`
- 工序配置前端 Playwright 冒烟：`npm run test:process-config:ui:smoke`
- 工序配置前端 Playwright 回归：`npm run test:process-config:ui:regression`
- 工序配置前端 Playwright 全量：`npm run test:process-config:ui`
- 生产排产前端 Playwright 冒烟：`npm run test:production-schedule:ui:smoke`
- 生产排产前端 Playwright 回归：`npm run test:production-schedule:ui:regression`
- 生产排产前端 Playwright 全量：`npm run test:production-schedule:ui`
- 生产工单前端 Playwright 冒烟：`npm run test:production-order:ui:smoke`
- 生产工单前端 Playwright 回归：`npm run test:production-order:ui:regression`
- 生产工单前端 Playwright 全量：`npm run test:production-order:ui`
- 生产任务前端 Playwright 冒烟：`npm run test:production-task:ui:smoke`
- 生产任务前端 Playwright 回归：`npm run test:production-task:ui:regression`
- 生产任务前端 Playwright 全量：`npm run test:production-task:ui`
- 生产缺料看板前端 Playwright 冒烟：`npm run test:production-shortage:ui:smoke`
- 生产缺料看板前端 Playwright 回归：`npm run test:production-shortage:ui:regression`
- 生产缺料看板前端 Playwright 全量：`npm run test:production-shortage:ui`
- 库存总览前端 Playwright 冒烟：`npm run test:inventory:ui:smoke`
- 库存总览前端 Playwright 回归：`npm run test:inventory:ui:regression`
- 库存总览前端 Playwright 全量：`npm run test:inventory:ui`
- 库存仓位治理前端 Playwright 聚合回归：`PLAYWRIGHT_APP_BASE_URL=http://127.0.0.1:5173 npm run test:inventory-warehouse:ui:governance`
- 库存盘点前端 Playwright 冒烟：`npm run test:stocktaking:ui:smoke`
- 库存盘点前端 Playwright 回归：`npm run test:stocktaking:ui:regression`
- 库存盘点前端 Playwright 全量：`npm run test:stocktaking:ui`
- 来料质检前端 Playwright 冒烟：`npm run test:incoming-inspection:ui:smoke`
- 来料质检前端 Playwright 回归：`npm run test:incoming-inspection:ui:regression`
- 来料质检前端 Playwright 全量：`npm run test:incoming-inspection:ui`
- 销售结算前端 Playwright 冒烟：`npm run test:settlement:ui:smoke`
- 销售结算前端 Playwright 回归：`npm run test:settlement:ui:regression`
- 销售结算前端 Playwright 全量：`npm run test:settlement:ui`
- 部署后手工 smoke：`./scripts/smoke-test.sh`
- 指定环境手工 smoke：`./scripts/smoke-test.sh https://factory.example.com --verbose`

high_value_targets:
- 任务详情/工单详情/排产只读接口：`tests/integration/production.api.test.ts`、`tests/e2e/productionFlow.e2e.test.ts`
- 库存追溯/修复/日结快照：`tests/integration/inventory.api.test.ts`、`tests/e2e/inventoryRepairFlow.e2e.test.ts`
- 采购完整链路：`tests/integration/purchase.api.test.ts`、`tests/e2e/purchaseFlow.e2e.test.ts`
- 销售发货库存链路：`tests/integration/sales.api.test.ts`、`tests/e2e/salesShipFlow.e2e.test.ts`
- 销售结算前端浏览器回归：`tests/settlement.spec.ts`
- 销售订单前端浏览器回归：`tests/salesOrder.spec.ts`
- 销售订单前端真实浏览器链路：`tests/salesOrder.real.spec.ts`
- 工序配置前端真实浏览器链路：`tests/processConfig.real.spec.ts`
- 生产排产前端真实浏览器链路：`tests/productionSchedule.real.spec.ts`
- 生产工单前端真实浏览器链路：`tests/productionOrder.real.spec.ts`
- 生产任务前端真实浏览器链路：`tests/productionTask.real.spec.ts`
- 生产缺料看板前端真实浏览器链路：`tests/productionShortage.real.spec.ts`
- 库存总览前端真实浏览器链路：`tests/inventory.real.spec.ts`
- 销售结算前端真实浏览器链路：`tests/settlement.real.spec.ts`
- 采购到货详情回跳前端浏览器回归：`tests/purchaseDelivery.spec.ts`
- 工序配置前端浏览器回归：`tests/processConfig.spec.ts`
- 采购前端真实浏览器链路：`tests/purchaseFlow.real.spec.ts`，其中 `@purchase-smoke` 适合快速回归，`@purchase-regression` 适合整轮采购 UI 联调。

managed_runner_notes:
- `npm run test:api:integration` 与 `npm run test:api:e2e` 会自动加载根 `.env`、构建 API、启动本地测试服务、等待 `/health` 后执行 Jest，并在结束后自动清理进程。
- 无参数时使用默认目录：integration 对应 `tests/integration/`，e2e 对应 `tests/e2e/`。
- 传入文件参数时只跑显式目标，不再附带默认目录。
- CI 侧数据库初始化统一走 `scripts/prepare-api-test-db.sh`，本地不要再复制 workflow 内的 `mysql < init.sql` 命令块。
- `npm run test:web:ui:*` 这组 mock 浏览器套件使用 Playwright 自带 `webServer` 启动 `services/web` 本地开发服务，并在浏览器侧 mock API；默认不依赖真实后端。
- `npm run test:purchase:ui:*`、`npm run test:incoming-inspection:ui:*`、`npm run test:purchase-suggestion:ui:*` 与 `npm run test:sales-order:ui:*` 都默认带 `PLAYWRIGHT_SKIP_WEBSERVER=1`，要求调用前已存在可访问的前端和 API；默认页面入口取 `PLAYWRIGHT_APP_BASE_URL`，未设置时走 `http://localhost`。
- `tests/purchaseFlow.real.spec.ts`、`tests/incomingInspection.real.spec.ts` 和 `tests/purchaseSuggestion.real.spec.ts` 都会直接访问测试库，默认使用 `DB_HOST=127.0.0.1`、`DB_PORT=3307`、`DB_USER=sf_app`、`DB_NAME=smart_factory`；若本地端口或账号不同，需显式覆盖环境变量。
- `tests/salesOrder.real.spec.ts` 也会直接访问测试库，默认沿用同一组 `DB_*` 环境变量，并使用 tenant `9999` 的测试种子。
- `tests/productionSchedule.real.spec.ts`、`tests/productionOrder.real.spec.ts`、`tests/productionTask.real.spec.ts`、`tests/inventory.real.spec.ts`、`tests/stocktaking.real.spec.ts` 与 `tests/settlement.real.spec.ts` 同样直接访问测试库，默认沿用同一组 `DB_*` 环境变量，并使用 tenant `9999` 的 Playwright 种子数据。
- `./scripts/smoke-test.sh` 是环境级验证，不替代集成或 e2e；它验证 `/health`、登录、核心列表接口、AI SSE 和安全响应头，适合部署后快速判活。

stop_rules:
- 若改动只涉及某个域且已有稳定定向套件，不必默认跑全量 integration/e2e。
- 若 unit 已暴露明确失败，不先拉 integration/e2e 扩散噪音。
- 若托管 runner 启动失败，先看 `/tmp/sf-api-integration.log` 与 `.env` 中 `JWT_SECRET` / `REDIS_PASSWORD` / `DB_*` 是否对齐，再判断是否是代码问题。
- 若 mock 浏览器套件失败，先排查页面选择器、前端状态流、接口 mock 是否仍匹配当前契约，再决定是否继续追到后端。
- 若 Playwright 失败但 API/e2e 正常，先排查 `PLAYWRIGHT_APP_BASE_URL`、前端 dev 服务、测试角色种子和浏览器交互选择器，再决定是否回退到后端排查。
- 若 smoke 失败，优先按 [smoke-test-guide.md](/Users/kongwen/claude_wk/ai-software-company/docs/smoke-test-guide.md) 分离是环境故障、账号问题还是应用回归，不要直接把环境失败当成功能缺陷。

risks:
- 目前前端真实后端浏览器回归已覆盖采购、销售订单、工序配置、生产排产、生产工单详情、生产任务详情、库存总览、销售结算，但除采购 / 销售订单 / 工序配置 / 生产排产 / 生产工单 / 生产任务 / 库存 / 销售结算外，其它业务域仍以 smoke 为主，尚未普遍拆到 regression 层。
- 手工 smoke 仍依赖环境内预置 `smoke_tester` 账号和线上可访问地址；若环境种子不一致，会出现脚本级假失败。
- 若后续新增测试层或改脚本参数，需同步更新本文件中的推荐入口。

exit_criteria:
- 团队成员可以不查历史长文档，直接按本文件选择合适的测试层与命令
- 本地与 CI 的后端自动化入口一致
- 关键业务域都有明确的优先回归文件指引
- 前端 mock 浏览器、前端真实后端浏览器与部署后 smoke 都有统一入口说明
