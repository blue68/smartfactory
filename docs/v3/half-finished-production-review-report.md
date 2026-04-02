[artifact:ReviewReport]
status: PASS
owner: code-reviewer
scope:
- 半成品生产 Phase 1/2 后端骨架
- `releaseOrder`、`confirmSchedule`、`WageService` 的关键一致性与回归风险
- 前端只读切片：工资任务报工视图、日结库存快照卡片
inputs:
- [artifact:BackendCode]
- [artifact:FrontendCode]
- [artifact:TestReport]
- `services/api/src/modules/production/production-phase1.service.ts`
- `services/api/src/modules/production/scheduler.service.ts`
- `services/api/src/modules/report/wage.service.ts`
- `services/web/src/pages/report/WageReportPage.tsx`
- `services/web/src/api/inventory.ts`
- `services/api/tests/unit/production-phase1.service.test.ts`
- `services/api/tests/unit/scheduler.phase2.operations.test.ts`
handoff_to:
- senior-qa-engineer
- devops-engineer

deliverables:
- 关键后端链路代码评审结论
- 已修复问题的复核结果
- 前端只读切片分页口径与缓存刷新复核结果
- 前端 lint 门禁恢复与 warning 清零结果

risks:
- 旧排产数据的迁移回填仍主要依赖现有数据形态假设，需在真实历史库再做一次演练
- `services/web` 产物体积仍偏大，`vite build` 持续提示主 chunk 超过 500kB；当前不阻断只读切片上线，但仍建议后续拆包

exit_criteria:
- 关键逻辑未发现 blocker/high 级代码缺陷，可进入后续门禁

verdict: PASS
findings:
- [severity:medium] 本轮已修复 `confirmSchedule` 重复确认时可能重复创建任务的问题，当前通过 `NOT EXISTS (production_tasks.schedule_id)` 约束创建集合，单测已覆盖
- [severity:medium] 本轮已修复 `task_no` 依赖随机数生成导致的撞号风险，当前改为基于 `schedule_id` 的稳定编号，避免 `INSERT IGNORE` 静默丢任务
- [severity:medium] 本轮已修复 `completeTask` 将单工序完工错误累加到整单 `qty_completed` 的问题，当前改为基于 operations 聚合回写
- [severity:medium] 本轮已补写 `work_reports`，并为真实库中的旧版字段名增加兼容，真实本地链路已验证
- [severity:medium] 本轮已修复库存页写操作后的快照陈旧问题：`useInbound` / `useOutbound` 原先只失效实时库存列表缓存，导致“日结库存快照”卡片不会跟随刷新；现已改为统一失效 `inventoryKeys.all`，见 `services/web/src/api/inventory.ts`
- [severity:medium] 本轮已修复工资任务视图分页口径误导：汇总值原先仅按当前页 `taskList` 计算，却显示为“总工时 / 总产量 / 工资合计”；现已明确改为“本页工时 / 本页产量 / 本页工资”，见 `services/web/src/pages/report/WageReportPage.tsx`
- [severity:low] 本轮已补齐 `services/web/.eslintrc.cjs` 并继续收敛 hooks 依赖稳定性问题，前端 `npm run lint` 已达到 `0 error / 0 warnings`
- [severity:low] 全部任务完成后的最终态已在本地验证，成品入库只触发 1 次，未见重复入库
- [severity:low] 历史数据从 `production_schedules` 回填 `operation_id/component_id/output_sku_id` 仍需在真实存量数据上做一次演练验证
must_fix:
- None
can_follow_up:
- 在发布前补一条基于真实迁移数据的回填演练脚本或 SQL 校验清单
- 对 `services/web` 主包做拆包或路由级懒加载，减少首屏 bundle 体积
