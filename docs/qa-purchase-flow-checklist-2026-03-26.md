# 采购流程 QA 验收清单

日期：2026-03-26

适用范围：
- 采购建议审批
- 采购订单
- 送货单
- 来料质检
- 采购入库
- 三单匹配
- 采购退货

本地环境要求：
- `sf_web` healthy
- `sf_api` healthy
- `sf_mysql` healthy
- `sf_redis` healthy

## 自动化回归

执行命令：

```bash
cd services/api
TEST_API_URL=http://127.0.0.1 \
DB_USER=sf_app \
DB_PASS='TestApp2026!Secure' \
DB_NAME=smart_factory \
DB_PORT=3307 \
DB_HOST=127.0.0.1 \
JWT_SECRET='local-test-jwt-secret-key-2026-smartfactory-at-least-32-chars' \
./node_modules/.bin/jest tests/e2e/purchaseFlow.e2e.test.ts --runInBand --forceExit --detectOpenHandles

TEST_API_URL=http://127.0.0.1 \
DB_USER=sf_app \
DB_PASS='TestApp2026!Secure' \
DB_NAME=smart_factory \
DB_PORT=3307 \
DB_HOST=127.0.0.1 \
JWT_SECRET='local-test-jwt-secret-key-2026-smartfactory-at-least-32-chars' \
./node_modules/.bin/jest tests/e2e/purchasePartialReturnFlow.e2e.test.ts --runInBand --forceExit --detectOpenHandles

TEST_API_URL=http://127.0.0.1 \
DB_USER=sf_app \
DB_PASS='TestApp2026!Secure' \
DB_NAME=smart_factory \
DB_PORT=3307 \
DB_HOST=127.0.0.1 \
JWT_SECRET='local-test-jwt-secret-key-2026-smartfactory-at-least-32-chars' \
./node_modules/.bin/jest tests/e2e/purchaseFullReturnFlow.e2e.test.ts --runInBand --forceExit --detectOpenHandles
```

通过标准：
- `purchaseFlow.e2e.test.ts` 10/10 通过
- `purchasePartialReturnFlow.e2e.test.ts` 9/9 通过
- `purchaseFullReturnFlow.e2e.test.ts` 9/9 通过

## 手工验收路径

### 路径 A：整单合格入库

操作步骤：
- 进入采购建议管理，审批一条待审批建议
- 在采购订单页创建采购订单
- 在送货页录入送货单
- 在来料质检页创建质检单
- 录入全部合格，提交质检
- 在采购匹配页执行三单匹配

预期结果：
- 自动生成采购入库单
- 采购订单状态变为 `received` 或 `partial_received`
- 三单匹配状态为 `matched`
- 库存增加对应入库数量

### 路径 B：部分合格 + 自动退货

操作步骤：
- 创建采购订单，订购数量 20
- 录入送货单，到货数量 20
- 创建来料质检单
- 录入 `qtyPassed = 12`、`qtyFailed = 8`
- `result = conditional_pass`
- `disposition = return`
- 提交质检
- 在退货单页查看自动生成的退货单
- 执行退货发出、退货完成
- 在采购匹配页执行三单匹配并确认差异

预期结果：
- 自动生成采购入库单，入库数量 12
- 自动生成采购退货单，退货数量 8
- 三单匹配状态为 `qty_diff`
- 差异确认后记录变为 `matched`
- 库存只增加 12
- 采购订单保持 `partial_received`

### 路径 C：整单不合格 + 全部退货

操作步骤：
- 创建采购订单，订购数量 20
- 录入送货单，到货数量 20
- 创建来料质检单
- 录入 `qtyPassed = 0`、`qtyFailed = 20`
- `result = fail`
- `disposition = return`
- 提交质检
- 在退货单页查看自动生成的退货单
- 执行退货发出、退货完成

预期结果：
- 不生成采购入库单
- 自动生成采购退货单，退货数量 20
- 库存保持不变
- 采购订单保持 `confirmed`
- 三单匹配不可执行，因为不存在入库单

## 重点核对字段

- 来料质检详情返回的明细字段应为 camelCase：
  - `id`
  - `skuId`
  - `qtyDelivered`
  - `qtySampled`
  - `qtyPassed`
  - `qtyFailed`
- 采购入库应正确关联送货单
- 退货单应正确关联质检单和采购订单
- 库存接口 `/api/inventory/:skuId/available` 应返回最新值，不应命中旧缓存

## 关联自动化文件

- `services/api/tests/e2e/purchaseFlow.e2e.test.ts`
- `services/api/tests/e2e/purchasePartialReturnFlow.e2e.test.ts`
- `services/api/tests/e2e/purchaseFullReturnFlow.e2e.test.ts`
- `services/api/tests/unit/incomingInspection.regression.test.ts`
- `services/api/tests/unit/purchaseReceipt.regression.test.ts`

## 已知说明

- 当前本地库仍存在新旧 schema 并存情况，采购入库、退货、三单匹配相关查询已做兼容。
- Jest 仍可能打印 `--forceExit` / open handles 提示，但本轮采购链路回归已通过。
