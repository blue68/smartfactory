[artifact:TestReport]
status: PASS
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
- 正式环境发布时需按已验证步骤重建 Web 镜像，并在目标入口复跑同一组页面冒烟
exit_criteria:
- 已明确哪些测试通过、哪些测试可进入发布前重建与验收

verdict: PASS
findings:
- [severity:low] 2026-04-14 已在最新前端代码的本地 `vite` 环境，以及重建后的 `sf_web` 真实 80 端口入口，跑通 `F1/F3/F4/F5` 页面级正向联调与深链接访问
- [severity:low] 2026-04-14 已在真实登录态下完成“固定资产手工采购 -> 送货 -> IQC -> 收货 -> 验收建卡 -> 资产台账”和“损耗品手工采购 -> 送货 -> IQC -> 收货 -> 领用申请 -> 审批 -> 发放”两条正向业务链路回归
- [severity:low] 2026-04-14 已补跑手工采购新入口的第二组真实闭环，并通过本地 API/数据库回查确认资产卡、领用单、收货池和库存副作用均正确
- [severity:low] 2026-04-14 已修正“已建卡固定资产收货单仍留在资产验收待办池”的筛选问题，`/assets/acceptance` 当前仅显示仍有剩余可建卡数量的收货单
- [severity:low] 2026-04-14 已在真实登录态下完成“损耗品采购 -> 三单匹配 -> 退货管理 -> 采购结算”的后链路闭环回归，页面与数据库状态一致
- [severity:low] 2026-04-14 已统一当前仓库内主要 Excel/CSV 导出接口的状态中文化和时间字段格式，导出时间口径收敛为 `YYYY-MM-DD HH:mm:ss`
- [severity:low] 2026-04-14 已完成文件上传双方案验证：本地 Docker 栈默认 `FILE_STORAGE_DRIVER=local`，生产覆盖默认 `FILE_STORAGE_DRIVER=oss`；并已在真实浏览器页面完成“质量问题图片上传”和“工序附件上传”实测
must_fix:
- None
can_follow_up:
- 将 `npm run test:api:integration:consumable-asset` 接入正式发布清单或 CI 定向补跑手册，避免后续回归入口再次分散
- 宿主机直连 `127.0.0.1:3307` 的 `infra/db/migrate.sh` 本地连通性仍需后续单独收口；本次迁移已通过容器内 MySQL 补跑完成

已执行结果：
- PASS：`npx jest tests/unit/incomingInspection.regression.test.ts --runInBand --forceExit`
- PASS：`npx jest tests/unit/bom.guard.test.ts tests/unit/mrp.guard.test.ts --runInBand --forceExit`
- PASS：`npx jest tests/unit/consumables.service.test.ts tests/unit/assets.service.test.ts --runInBand --forceExit`
- PASS：`npx jest tests/unit/assets.routes.test.ts tests/unit/assets.service.test.ts --runInBand --forceExit`
- PASS：`npx jest tests/unit/warehouse-location.resolver.test.ts --runInBand --forceExit`
- PASS：`npm run typecheck`
- PASS：`npm run build`（`services/web`）
- PASS：`npm run dev -- --host 127.0.0.1 --port 4173` + 本地页面负向冒烟（2026-04-14，伪造登录态访问 `/master-data/sku`、`/consumables/issues`、`/assets/acceptance`、`/assets/ledger`，确认页面在后端 `ECONNREFUSED` 时不崩溃且展示错态/重试入口）
- PASS：`VITE_API_PROXY_TARGET=http://127.0.0.1:80 npm run dev -- --host 127.0.0.1 --port 4173` + 浏览器正向联调（2026-04-14，最新前端代码下验证 `F1/F3/F4/F5`，确认可见真实 SKU、领用单、资产验收收货池和资产台账数据）
- PASS：`docker compose build web` + `docker compose up -d --force-recreate web` + 80 端口浏览器复烟（2026-04-14，确认真实部署入口菜单、深链接和页面数据均与最新代码一致）
- PASS：真实登录态 API + 浏览器正向回归（2026-04-14）
  - 固定资产链路：`PO1776167322613838 -> DN1776167322677137 -> IQC260414-00001 -> RC260414-00001 -> FA260414-00001`
  - 损耗品链路：`PO1776167371741479 -> DN1776167371783459 -> IQC260414-00002 -> RC260414-00002 -> CI260414-00001`
  - 页面复验：`/purchase/orders`、`/purchase/receipts`、`/consumables/issues`、`/assets/acceptance`、`/assets/ledger`
- PASS：手工采购新入口第二组闭环回归（2026-04-14）
  - 固定资产链路：`PO1776172877547757 -> DN1776172890803592 -> IQC260414-00003 -> RC260414-00003 -> FA260414-00002`
  - 固定资产核验：`FA260414-00002` 已进入资产台账，`assetName=浏览器验收-固定资产-手工采购-01`、`serialNo=SN-MANUAL-20260414-01`、`assetTagNo=TAG-MANUAL-20260414-01`、`locationText=验收区-01`、`originalValue/netValue=5100.00`
  - 损耗品链路：`PO1776174123806393 -> DN1776174142538557 -> IQC260414-00004 -> RC260414-00004 -> CI260414-00002`
  - 损耗品核验：`CI260414-00002` 已完成 `draft -> approved -> issued`，`requestDepartmentId=1`、`budgetCode=MANUAL-CNSM-20260414`，`CNSM-ACC-20260413A` 可用库存已从 `11.0000` 回落到 `10.0000`
  - 说明：浏览器调试通道在部分按钮点击上不稳定，后半段通过 `sf_api` 容器内本地 API 补跑并逐步回查状态与副作用
- PASS：真实登录态浏览器后链路回归（2026-04-14）
  - 退货链路：`RTN260414-00001` 已完成 `draft -> confirmed -> shipped -> completed`
  - 结算链路：`PST260414-00001` 已完成 `draft -> confirmed -> paid`
  - 页面复验：`/purchase/returns?poId=91904359&inspectionId=996918&returnId=12`、`/purchase/settlements?poId=91904359`
  - 数据核验：`RTN260414-00001` 未生成 `PURCHASE_RETURN_OUT` 库存事务；`PST260414-00001` 的 `paid_at` 已正确落库
- PASS：导出中文化与时间格式收口（2026-04-14）
  - 当前主要导出接口已统一状态中文化：SKU、供应商、客户、BOM、采购订单、采购结算、销售订单、销售结算、工资报表
  - 当前主要导出接口已统一时间字段格式：`YYYY-MM-DD HH:mm:ss`
  - 本地前端自生成导出已补齐：`SKU` 页面、`生产工单` 页面
- PASS：上传双方案与浏览器实测（2026-04-14）
  - 迁移：`uploaded_files` 已在本地 MySQL 落表
  - 接口实测：`qa-upload-image.png`、`qa-upload-attachment.pdf` 通过 `/api/upload` 上传成功，并能通过 `/api/upload/files/:id/content` 取回
  - 浏览器实测：`/quality/trace` 成功上传 `qa-browser-image.png`，`/master-data/process-config` 成功上传 `qa-browser-attachment.pdf`
  - 数据回查：`uploaded_files` 已新增 `id=3/4`，`storage_driver=local`，容器内 `/app/uploads/smartfactory/...` 已实际落盘
- PASS：`npm run test:api:integration:consumable-asset`（2026-04-14，专用 managed 回归入口已固定并通过）
- PASS：`TEST_DEFAULT_TARGET=tests/integration/consumableAsset.api.test.ts bash ../../scripts/run-api-integration.sh`（2026-04-14，资产验收、资产退回、损耗品领用执行三条主链路通过）

结论说明：
- 2026-04-14 已重新 `git fetch --all --prune` 并确认 `origin/master` 与本地 `master` 无 ahead/behind 差异
- 2026-04-14 已恢复本地 MySQL/Redis integration 环境，并跑通 `consumableAsset` 高价值集成回归
- 本次补测同时修正了 integration spec 的历史 schema 漂移，以及 `resolveWarehouseLocationBinding` 对 MySQL `bigint` 字符串 ID 的兼容缺陷
- 2026-04-14 已在最新前端代码的本地 `vite` 环境完成 `F1/F3/F4/F5` 正向页面回归，页面级结论已补齐
- 2026-04-14 已在重建后的 `sf_web` 真实 80 端口入口复跑同一组页面冒烟，确认本地发布产物与最新代码一致
- 2026-04-14 已新增 `npm run test:api:integration:consumable-asset` / `npm run test:integration:consumable-asset:managed`，后续可用固定命令补跑本 spec
- 2026-04-14 已补完本地真实业务正向回归与采购后链路闭环回归，当前剩余动作仅收敛为正式环境按同样步骤发布一次，并把 managed 回归命令纳入发布清单或 CI
- 2026-04-14 已补完手工采购新入口的第二组真实样例，当前本地可直接复核固定资产 `PO1776172877547757 / FA260414-00002` 与损耗品 `PO1776174123806393 / CI260414-00002`
- 2026-04-14 已补文件上传双方案：本地 Docker 栈默认本地存储，生产覆盖默认阿里云 OSS；并已补齐 `uploaded_files` 元数据表、文件访问接口和浏览器层实测
- 2026-04-14 已补当前主要导出接口状态中文化与时间格式统一，正式环境复烟时需抽样验证至少 1 份采购导出和 1 份销售/主数据导出
