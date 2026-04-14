[artifact:TestReport]
status: FAIL
owner: senior-qa-engineer
scope:
- 汇总损耗品与固定资产本轮后端收口的已执行验证结果
- 说明当前阻断发布的测试缺口
inputs:
- `docs/consumable-fixed-asset-test-case.md`
- `docs/consumable-fixed-asset-asset-return-backend-code.md`
- `docs/consumable-fixed-asset-quality-data-backend-code.md`
- `services/api/tests/integration/consumableAsset.api.test.ts`
handoff_to:
- senior-backend-engineer
- devops-engineer
- engineering-manager
deliverables:
- 已执行测试结果
- 阻断发布的测试问题与下一步补测动作
risks:
- 高价值 integration spec 尚未给出通过结论，发布后存在跨模块回归漏检风险
exit_criteria:
- 已明确哪些测试通过、哪些测试阻断、哪些测试待环境恢复后补跑

verdict: FAIL
findings:
- [severity:blocker] `TEST_DEFAULT_TARGET=tests/integration/consumableAsset.api.test.ts bash ../../scripts/run-api-integration.sh` 未通过，阻断原因为本地 Docker/MySQL 环境异常，导致 API 启动阶段连接 `127.0.0.1:3307` 失败，当前无法给出高价值 integration 主链路通过结论
- [severity:medium] 前端 `F1/F3/F4/F5` 已完成本地 `vite` 冒烟与错态验证，但尚未在真实联调环境跑通正向页面主流程，因此当前测试结论仍不覆盖页面级成功链路
must_fix:
- 恢复可用的 MySQL/Redis integration 环境并重跑 `services/api/tests/integration/consumableAsset.api.test.ts`
- 在前端联调环境恢复后补一轮页面主流程回归，至少覆盖损耗品领用、资产验收、资产退回
can_follow_up:
- 托管集成环境稳定后，把本 spec 纳入固定的 managed integration 回归入口

已执行结果：
- PASS：`npx jest tests/unit/incomingInspection.regression.test.ts --runInBand --forceExit`
- PASS：`npx jest tests/unit/bom.guard.test.ts tests/unit/mrp.guard.test.ts --runInBand --forceExit`
- PASS：`npx jest tests/unit/consumables.service.test.ts tests/unit/assets.service.test.ts --runInBand --forceExit`
- PASS：`npx jest tests/unit/assets.routes.test.ts tests/unit/assets.service.test.ts --runInBand --forceExit`
- PASS：`npm run typecheck`
- PASS：`npm run dev -- --host 127.0.0.1 --port 4173` + 本地页面冒烟（2026-04-14，伪造登录态访问 `/master-data/sku`、`/consumables/issues`、`/assets/acceptance`、`/assets/ledger`，确认页面在后端 `ECONNREFUSED` 时不崩溃且展示错态/重试入口）
- FAIL：`TEST_DEFAULT_TARGET=tests/integration/consumableAsset.api.test.ts bash ../../scripts/run-api-integration.sh`

阻断说明：
- 2026-04-13 已确认 `origin/master` 基线无落后
- Redis 宿主机端口恢复后可连通，但 MySQL 容器新实例在 Docker Desktop 重启前后均未稳定恢复，导致 `3307` 不可用
- 2026-04-14 已完成前端本地负向冒烟，当前剩余前端阻断从“页面可用性未知”收敛为“缺少可用后端环境进行正向主流程验证”
- 在该阻断解除前，本报告维持 `FAIL`
