-- ─────────────────────────────────────────────────────────────────────────────
-- 智造管家 慢查询索引优化补丁
-- BE-P2-015: 慢查询优化
--
-- 执行时机：生产环境人工审核后手动执行，或通过迁移脚本管理
-- 说明：本文件仅补充 init.sql 中缺失的高频查询场景复合索引
--       所有 CREATE INDEX IF NOT EXISTS 支持幂等重执行
--
-- 分析依据：
--   - init.sql 中各表已存在的索引已标注，本文件仅新增缺失部分
--   - 复合索引字段顺序遵循"等值列在前、范围列在后、高基数列优先"原则
--   - 覆盖索引（covering index）尽量将 SELECT 高频列纳入，减少回表
-- ─────────────────────────────────────────────────────────────────────────────

USE `smart_factory`;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. production_orders 生产工单表
--
-- 已有索引：
--   idx_tenant_status  (tenant_id, status)          -- 覆盖基础状态过滤
--   idx_tenant_sales_order (tenant_id, sales_order_id)
--   idx_tenant_sku     (tenant_id, sku_id)
--
-- 缺失场景：
--   [1a] 驾驶舱 KPI / 排产页：按 status + tenant_id 筛选，同时需要按
--        priority DESC, planned_end ASC 排序 → 将 priority 和 planned_end
--        加入覆盖索引，避免 filesort
--   [1b] 驾驶舱工期预警：WHERE tenant_id=? AND planned_end BETWEEN ? AND ?
--        AND status NOT IN (...) → 需要 (tenant_id, planned_end, status)
--        以支持范围扫描后利用 status 过滤
-- ─────────────────────────────────────────────────────────────────────────────

-- [1a] 排产页优先级排序覆盖索引
--      查询形如：WHERE tenant_id=? AND status=? ORDER BY priority DESC, planned_end ASC
CREATE INDEX IF NOT EXISTS `idx_tenant_status_priority_end`
  ON `production_orders` (`tenant_id`, `status`, `priority`, `planned_end`);

-- [1b] 驾驶舱工期预警范围索引
--      查询形如：WHERE tenant_id=? AND planned_end <= ? AND status IN (...)
CREATE INDEX IF NOT EXISTS `idx_tenant_planned_end_status`
  ON `production_orders` (`tenant_id`, `planned_end`, `status`);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. sales_orders 销售订单表
--
-- 已有索引：
--   idx_tenant_customer  (tenant_id, customer_id)
--   idx_tenant_status    (tenant_id, status)
--   idx_tenant_delivery  (tenant_id, expected_delivery)
--
-- 缺失场景：
--   [2a] 逾期订单列表：WHERE tenant_id=? AND status IN (...) AND expected_delivery < NOW()
--        ORDER BY expected_delivery ASC
--        → 当前需要分别用 idx_tenant_status 或 idx_tenant_delivery，
--          无法同时命中两列过滤，MySQL 只能选择其中一个索引，
--          导致另一列做全索引扫描后 filesort
--        → 新增三列复合索引，等值列 status 在前，范围列 expected_delivery 在后
--   [2b] 销售员维度 + 状态过滤（销售看板）：
--        WHERE tenant_id=? AND sales_person_id=? AND status=?
-- ─────────────────────────────────────────────────────────────────────────────

-- [2a] 逾期订单三列复合索引（核心性能优化）
--      覆盖：tenant_id 等值 + status 等值/IN + expected_delivery 范围
CREATE INDEX IF NOT EXISTS `idx_tenant_status_delivery`
  ON `sales_orders` (`tenant_id`, `status`, `expected_delivery`);

-- [2b] 销售员 + 状态维度索引
CREATE INDEX IF NOT EXISTS `idx_tenant_salesperson_status`
  ON `sales_orders` (`tenant_id`, `sales_person_id`, `status`);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. inventory 库存快照表
--
-- 已有索引：
--   UNIQUE KEY uk_tenant_sku (tenant_id, sku_id)   -- 唯一约束即高效查询索引
--
-- 结论：
--   AI 模块按 tenant_id + sku_id 查询已被 uk_tenant_sku 完全覆盖，
--   无需新增索引。
--
-- 补充：inventory_balances 同理（也有 uk_tenant_sku），无需额外索引。
--
-- 新增场景：
--   [3a] 库存预警：WHERE tenant_id=? AND qty_on_hand <= (某阈值) 需要扫描全租户
--        库存，当前无法利用索引过滤 qty_on_hand，但该场景数据量有限（每个租户
--        SKU 总数通常 < 10000），可接受全租户扫描。若数据量增大可考虑函数索引。
--        暂不新增，保留注释备用。
-- ─────────────────────────────────────────────────────────────────────────────
-- 暂无需新增（uk_tenant_sku 已覆盖所有高频查询）


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. purchase_suggestions AI 采购建议表
--
-- 已有索引：
--   idx_tenant_sku_status    (tenant_id, sku_id, status)
--   idx_tenant_status_expired (tenant_id, status, expired_at)
--
-- 缺失场景：
--   [4a] 待审批建议列表按置信度排序：
--        WHERE tenant_id=? AND status='pending' ORDER BY confidence DESC, created_at DESC
--        → idx_tenant_status_expired 中最后一列是 expired_at，不能同时利用 confidence 排序
--   [4b] 已过期建议清理任务：WHERE tenant_id=? AND expired_at <= NOW() AND status='pending'
--        → idx_tenant_status_expired (tenant_id, status, expired_at) 已覆盖，
--          注意字段顺序：status 等值在前，expired_at 范围在后，命中效果好
--
-- 结论：[4a] 新增覆盖索引；[4b] 已覆盖无需新增
-- ─────────────────────────────────────────────────────────────────────────────

-- [4a] 待审批采购建议按置信度 + 时间排序
--      查询形如：WHERE tenant_id=? AND status=? ORDER BY confidence DESC, created_at DESC
CREATE INDEX IF NOT EXISTS `idx_tenant_status_confidence_created`
  ON `purchase_suggestions` (`tenant_id`, `status`, `confidence`, `created_at`);


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. bom_items BOM 明细表
--
-- 已有索引：
--   idx_tenant_bom    (tenant_id, bom_header_id)   -- 覆盖 BOM 展开主查询
--   idx_tenant_parent (tenant_id, parent_item_id)   -- 覆盖多层 BOM 递归
--   idx_component_sku (component_sku_id)             -- 物料反查
--
-- 缺失场景：
--   [5a] BOM 展开同时按 level + sort_order 排序，当前 idx_tenant_bom 不含排序列
--        → WHERE tenant_id=? AND bom_header_id=? ORDER BY level, sort_order
--          需要 filesort。扩展索引加入 level 和 sort_order。
--   [5b] AI 成本分析：WHERE tenant_id=? AND bom_header_id=? AND component_sku_id=?
--        → 需要三列复合索引避免回表后再过滤 component_sku_id
-- ─────────────────────────────────────────────────────────────────────────────

-- [5a] BOM 展开排序覆盖索引
--      查询形如：WHERE tenant_id=? AND bom_header_id=? ORDER BY level ASC, sort_order ASC
CREATE INDEX IF NOT EXISTS `idx_tenant_bom_level_sort`
  ON `bom_items` (`tenant_id`, `bom_header_id`, `level`, `sort_order`);

-- [5b] AI 成本分析：BOM 展开 + 物料过滤
--      查询形如：WHERE tenant_id=? AND bom_header_id=? AND component_sku_id=?
CREATE INDEX IF NOT EXISTS `idx_tenant_bom_component`
  ON `bom_items` (`tenant_id`, `bom_header_id`, `component_sku_id`);


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. quality_inspections 质检结果表（AI 统计用）
--
-- 已有索引：
--   idx_tenant_order      (tenant_id, production_order_id)
--   idx_tenant_result     (tenant_id, result)
--   idx_tenant_created_at (tenant_id, created_at)
--
-- 缺失场景：
--   [6a] 质量统计报表：WHERE tenant_id=? AND created_at BETWEEN ? AND ?
--        GROUP BY result → 需要 (tenant_id, created_at, result) 覆盖索引
--        避免回表取 result 字段
--   [6b] 按工单 + 时间范围统计合格率：
--        WHERE tenant_id=? AND production_order_id=? AND created_at >= ?
--        → idx_tenant_order 不含 created_at，需要回表后再过滤时间
-- ─────────────────────────────────────────────────────────────────────────────

-- [6a] 质量统计时间段 + 结果覆盖索引（消除 GROUP BY filesort）
--      查询形如：WHERE tenant_id=? AND created_at BETWEEN ? AND ? GROUP BY result
CREATE INDEX IF NOT EXISTS `idx_tenant_created_at_result`
  ON `quality_inspections` (`tenant_id`, `created_at`, `result`);

-- [6b] 工单质检时间范围索引
--      查询形如：WHERE tenant_id=? AND production_order_id=? AND created_at >= ?
CREATE INDEX IF NOT EXISTS `idx_tenant_order_created_at`
  ON `quality_inspections` (`tenant_id`, `production_order_id`, `created_at`);


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. ai_messages AI 对话消息表
--
-- 已有索引：
--   idx_tenant_user_session (tenant_id, user_id, session_id) -- 覆盖对话历史主查询
--   idx_tenant_created_at   (tenant_id, created_at)          -- 按时间查询
--
-- 缺失场景：
--   [7a] 对话历史分页（最高频）：
--        WHERE tenant_id=? AND user_id=? AND session_id=? ORDER BY created_at DESC LIMIT N
--        → idx_tenant_user_session 不含 created_at，排序需要 filesort
--          扩展索引将 created_at 纳入，消除排序开销（高频接口关键优化）
--   [7b] 会话列表（用户所有会话）：
--        WHERE tenant_id=? AND user_id=? GROUP BY session_id ORDER BY MAX(created_at) DESC
--        → 当前索引无法利用 GROUP BY 消除临时表
-- ─────────────────────────────────────────────────────────────────────────────

-- [7a] 对话历史分页核心索引（消除 ORDER BY filesort）
--      查询形如：WHERE tenant_id=? AND user_id=? AND session_id=? ORDER BY created_at DESC
--      注意：此索引取代 idx_tenant_user_session，两者前缀相同，
--            MySQL 会优先使用更长的索引，可考虑后续删除旧索引节省存储
CREATE INDEX IF NOT EXISTS `idx_tenant_user_session_created`
  ON `ai_messages` (`tenant_id`, `user_id`, `session_id`, `created_at`);

-- [7b] 用户会话列表索引（消除 GROUP BY 临时表）
--      查询形如：WHERE tenant_id=? AND user_id=? GROUP BY session_id
CREATE INDEX IF NOT EXISTS `idx_tenant_user_created`
  ON `ai_messages` (`tenant_id`, `user_id`, `created_at`);


-- ─────────────────────────────────────────────────────────────────────────────
-- 冗余索引清理建议（人工确认后执行，不在本脚本中自动删除）
--
-- 以下索引因被更长的复合索引覆盖，可在评估后删除以节省存储和写入开销：
--
-- production_orders:
--   -- KEY `idx_tenant_status` 被 idx_tenant_status_priority_end 的前缀覆盖
--   -- 但保留不删，因为 idx_tenant_status 在 status=? 等值查询时索引更小、更快
--
-- ai_messages:
--   -- KEY `idx_tenant_user_session` 被 idx_tenant_user_session_created 前缀覆盖
--   -- 建议执行：ALTER TABLE `ai_messages` DROP INDEX `idx_tenant_user_session`;
--   -- 前提：确认无任何仅用前三列（不含 created_at）的覆盖索引场景
--
-- 执行命令（确认后手动执行）：
--   ALTER TABLE `ai_messages` DROP INDEX `idx_tenant_user_session`;
-- ─────────────────────────────────────────────────────────────────────────────
