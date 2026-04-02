-- T-01: process_templates 新增默认模板字段
ALTER TABLE process_templates
  ADD COLUMN is_default TINYINT(1) NOT NULL DEFAULT 0 AFTER status,
  ADD COLUMN template_type ENUM('standard','custom','trial') NOT NULL DEFAULT 'standard' AFTER is_default,
  ADD COLUMN version VARCHAR(20) NOT NULL DEFAULT '1.0' AFTER template_type;

CREATE INDEX idx_tenant_sku_default ON process_templates (tenant_id, sku_id, is_default);

-- T-03: production_orders 新增工艺快照字段
ALTER TABLE production_orders
  ADD COLUMN process_snapshot JSON NULL AFTER process_template_id,
  ADD COLUMN dispatched_at DATETIME(3) NULL AFTER process_snapshot;
