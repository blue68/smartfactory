[artifact:TestReport]
status: PASS
owner: senior-qa-engineer
scope:
- T7-QA-03 本地历史数据兼容演练记录
- 验证老任务缺少 `operations/material tx/work report` 扩展字段时的安全读取
inputs:
- [artifact:Approval]
- [artifact:TaskBreakdown]
- [artifact:APIDoc]
- [artifact:BackendCode]
- `services/api/tests/unit/production.task-detail.service.test.ts`
- `services/api/tests/integration/production.api.test.ts`
- `services/api/tests/integration/inventory.api.test.ts`
- `scripts/run-api-integration.sh`
handoff_to:
- engineering-manager
- code-reviewer
- devops-engineer

verdict: PASS
findings:
- [severity:low] `ProductionService.getTaskDetail` 在 `operationId` 缺失时，已安全降级为 `dependencySummary.blocked=false`、`predecessors=[]`、`materialTransactions=[]`、`wageReport=null`，未出现 500 或空指针。
- [severity:low] 本地 integration 运行前提已固化到托管脚本，避免因 `JWT_SECRET`/`REDIS_PASSWORD`/测试服务未启动造成的假失败，兼容演练可重复执行。
must_fix:
- None
can_follow_up:
- 增补一条带真实“历史老任务行”的 integration 或 e2e 种子，进一步证明 DB 层半迁移数据也能稳定读取。

deliverables:
- 服务层兼容演练：验证缺少 `operationId` 的老任务读取不会访问依赖链路扩展表，并返回空降级结构。
- 运行态回归演练：通过托管 integration 脚本复跑 `production` 与 `inventory` 两组真实库接口，确认新读模型与库存追溯链路可稳定执行。

evidence:
- 命令：`cd services/api && npx jest tests/unit/production.task-detail.service.test.ts --runInBand`
- 结果：`1 suite / 2 tests passed`
- 关键断言：老任务场景下 `dependencySummary = { blocked: false, blockingReason: null, predecessors: [] }`
- 关键断言：老任务场景下 `materialTransactions = []`
- 关键断言：老任务场景下 `wageReport = null`
- 命令：`npm run test:api:integration -- tests/integration/production.api.test.ts tests/integration/inventory.api.test.ts`
- 结果：`2 suites / 41 tests passed`
- 运行前提：脚本自动加载根 `.env`，注入 `JWT_SECRET`、`TEST_JWT_SECRET`、`REDIS_PASSWORD`、`DB_*`，自建 `http://localhost:3100` 测试 API 并在结束后自动清理

risks:
- 当前“老任务无扩展字段”的直接证据主要来自服务层单测降级路径，真实库 integration 仍主要验证新读接口主链路与追溯链路。
- 若后续再引入新的聚合字段并绕过空值保护，仍可能重新打开历史数据读取风险。

exit_criteria:
- 已形成可复用的本地兼容演练入口
- 已有自动化证据证明老任务缺扩展字段时安全降级
- 已有真实库 integration 证据证明新读接口主链路可稳定复跑
