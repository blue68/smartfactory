[artifact:DeploymentPlan]
status: READY
owner: devops-engineer
scope:
- 半成品生产 Phase 1/2 后端能力发布
- 工资任务报工只读页与日结库存快照只读页发布
inputs:
- [artifact:Approval]
- [artifact:BackendCode]
- [artifact:FrontendCode]
- [artifact:ReviewReport]
- [artifact:SecurityReport]
- [artifact:TestReport]
- `docker-compose.yml`
- `services/api/Dockerfile`
- `services/web/Dockerfile`
- `services/web/nginx.conf`
- `scripts/redeploy-local.sh`
handoff_to:
- 发布执行

deliverables:
- 面向当前 Docker Compose 交付形态的发布前检查、执行步骤、回滚步骤与监控项
- 后端迁移、API 镜像、Web 镜像的一体化发布顺序
- 只读前端切片的浏览器冒烟清单

risks:
- 本次交付同时涉及数据库迁移、API 查询口径和前端只读接线，若跳过冒烟容易出现“接口已发布但前端仍跑旧 bundle”的假阴性
- 当前前端访问域名仍受 `CORS_ORIGINS` 约束；若部署域名变更但未同步环境变量，登录与接口调用会直接失败
- `vite build` 仍提示主包较大；当前不阻断发布，但发布后应继续观察首屏加载与静态资源命中情况

exit_criteria:
- 数据库迁移完成且服务健康检查通过
- `sf_api`、`sf_web` 容器均为 healthy
- 浏览器冒烟通过：`/report/wages`、`/inventory`
- 发布后关键接口、关键页面、关键日志均无 blocker

precheck:
- [x] `[artifact:Approval]` 已存在且为 `APPROVED`
- [x] `[artifact:ReviewReport]` 为 `PASS`
- [x] `[artifact:SecurityReport]` 为 `PASS`
- [x] `[artifact:TestReport]` 为 `PASS`
- [x] `cd services/api && npm run typecheck` 已通过
- [x] `cd services/api && npx jest tests/unit/wage.service.test.ts tests/unit/inventory.daily-snapshots.test.ts tests/unit/inventory.snapshot-rebuild.test.ts --runInBand` 已通过
- [x] `cd services/web && npm run lint` 已可执行并通过（当前 0 error / 0 warnings）
- [x] `cd services/web && npm run typecheck` 已通过
- [x] `cd services/web && npm run build` 已通过
- [x] `cd services/web && npm test` 已通过
- [x] 浏览器联调已通过：`/report/wages` 可切换“工资汇总 / 任务报工”
- [x] 浏览器联调已通过：`/inventory` 可展示“日结库存快照”卡片与空态
- [x] 已确认本地发布必须重建 `web` 容器，否则 `localhost` 可能继续服务旧前端 bundle
- [x] 已确认 API `/health` 与 Web `/health` 均可作为发布后探活入口
- [x] 已确认 API 在 Redis 预热失败场景下可降级启动，不阻断核心接口

steps:
- 1. 创建发布前备份：至少备份 `work_reports`、`inventory_daily_snapshots`、`production_orders`、`production_tasks`、`inventory` 及相关 schema 变更影响表
- 2. 校验目标环境变量：重点确认 `JWT_SECRET`、`JWT_REFRESH_SECRET`、`DB_*`、`REDIS_*`、`CORS_ORIGINS`、`WEB_PORT`
- 3. 在目标环境按顺序执行待发布迁移；本阶段至少包含 `services/api/src/migrations/M20260329_half_finished_phase1.sql` 与 `services/api/src/migrations/M20260329_phase2_scheduler_operations.sql`
- 4. 若目标环境尚未补齐既有依赖迁移，先补齐库存/采购相关前置迁移，再进入本次发布；不要在缺前置结构时直接上线 API
- 5. 重新构建并启动 API/Web 镜像：`docker compose up -d --build api web`
- 6. 等待容器健康：`docker compose ps` 中 `sf_api`、`sf_web` 均为 healthy
- 7. 运行基础健康检查：访问 `http://<host>/health` 与 `http://<host>/api/health`
- 8. 以老板或主管账号登录 Web，先访问 `http://<host>/report/wages`
- 9. 在工资报表页验证“工资汇总 / 任务报工”二级切换可见；切到“任务报工”后应看到任务表头与分页数据
- 10. 继续访问 `http://<host>/inventory`
- 11. 在库存页验证“日结库存快照”卡片可见；切换 `snapshotDate` 后应发起 `/api/inventory/daily-snapshots` 请求并返回结果或空态
- 12. 执行后端只读接口冒烟：`GET /api/reports/wages/tasks`、`GET /api/inventory/daily-snapshots`
- 13. 执行生产主链路最小回归：`release -> schedule -> confirm -> complete-v2`
- 14. 若环境允许，补跑定向自动化：`cd services/api && npx jest tests/e2e/productionFlow.e2e.test.ts --runInBand`
- 15. 发布完成后保留首小时重点观察窗口，不要立即清理旧镜像与备份

rollback:
- 1. 若发布后仅前端异常且数据库结构正常，优先回滚 `web` 到上一稳定镜像并重启 `sf_web`
- 2. 若发布后 API 查询或主链路异常，回滚 `api` 到上一稳定镜像并重启 `sf_api`
- 3. 若问题由本次迁移引起且代码回滚不足以恢复，停止新写入后从备份恢复受影响表，再回退 API/Web 镜像
- 4. 回滚后重新执行 `docker compose ps`、`/health`、`/report/wages`、`/inventory` 最小冒烟
- 5. 保留故障时段的 `sf_api` / `sf_web` / `sf_mysql` 日志与 SQL 变更记录，用于后续复盘

monitoring:
- 关注容器健康：`sf_api`、`sf_web`、`sf_mysql`、`sf_redis`
- 关注接口健康：`/health`、`/api/health`
- 关注关键只读接口错误率：`GET /api/reports/wages/tasks`、`GET /api/inventory/daily-snapshots`
- 关注关键页面可用性：`/report/wages`、`/inventory`
- 关注 API 日志中的 CORS 拒绝、401 激增、SQL 错误、Redis 降级告警
- 关注工资页任务视图与库存快照卡片是否命中最新 bundle；如页面缺失新增入口，优先排查 `web` 是否仍在服务旧镜像
- 关注 `inventory_daily_snapshots` 的写入刷新与只读查询是否同步正常，避免库存页快照陈旧
- 关注 `work_reports`、`production_tasks`、`inventory_transactions` 是否出现异常重复增长

owner:
- devops-engineer
