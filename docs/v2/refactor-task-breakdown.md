# V2 重构任务拆解

状态：APPROVED by Engineering Manager
日期：2026-03-14

---

## Batch 1 — 前端API路径修复（FE，8个任务）

| ID | 文件 | 修改 |
|----|------|------|
| FIX-01 | services/web/src/api/sku.ts | `/api/sku` → `/api/skus` |
| FIX-02 | services/web/src/api/customer.ts | `/api/sales/customers` → `/api/customers` |
| FIX-03 | services/web/src/api/productionTask.ts | `/api/productionTask` → 确认后端production子路由后修复 |
| FIX-04 | services/web/src/api/processConfig.ts | `/api/process-config` → `/api/process-configs` |
| FIX-05 | services/web/src/api/wage.ts 或 wageReport.ts | `/api/wage` → `/api/reports/wages` |
| FIX-06 | services/web/src/api/analytics.ts | `/analytics/*` → `/api/analytics/*` |
| FIX-07 | services/web/src/api/incomingInspection.ts | `/api/incoming-inspection` → `/api/incoming-inspections` |
| FIX-08 | services/web/src/api/returnOrder.ts | `/api/return-order` → `/api/return-orders` |

验证方法：curl 测试每个 API 返回 code=0

---

## Batch 2 — 数据库Schema修复（BE，4个任务）

| ID | 问题 | 修复方案 |
|----|------|---------|
| DB-01 | bom.service.ts `s.code` 列不存在 | 改为 `s.sku_code` |
| DB-02 | sku_categories 缺 `remark` 列 | ALTER TABLE 加列或去掉代码中的 remark 引用 |
| DB-03 | production_orders 缺 `priority_score` 列 | ALTER TABLE 加列 |
| DB-04 | `work_reports` 表不存在 | 编写建表迁移脚本 |

验证方法：重启 API 容器无报错

---

## Batch 3 — Mock数据替换为真实API（FE，4个任务）

| ID | 页面 | 内容 |
|----|------|------|
| MOCK-01 | DashboardPage.tsx | 替换 MOCK_PRODUCTION_ORDERS, MOCK_INVENTORY_WARNINGS |
| MOCK-02 | ScheduleSuggestionPage.tsx | 替换5个mock数据集，对接真实API |
| MOCK-03 | SuggestionPage.tsx | 替换 MOCK_SUGGESTIONS |
| MOCK-04 | OrderPage.tsx | 替换 CUSTOMERS, PRODUCTS 硬编码 |

验证方法：页面加载显示真实数据

---

## Batch 4 — UI样式对齐设计稿（FE，7个任务）

对应 docs/v2/ui/ 下的7个HTML设计稿，逐一比对并修复样式偏差。

验证方法：截图与设计稿比对

---

## 执行顺序说明

Batch 2 必须先于 Batch 3 完成，避免真实 API 调用命中 Schema 报错。
Batch 1 与 Batch 2 可并行执行。
Batch 3 依赖 Batch 1 和 Batch 2 全部通过验证后启动。
Batch 4 与 Batch 3 可并行执行，无数据依赖。
