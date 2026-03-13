-- 工作日历表 (从 production.service.ts setHoliday 方法中提取)
CREATE TABLE IF NOT EXISTS work_calendar (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id    INT UNSIGNED    NOT NULL,
  date         DATE            NOT NULL,
  is_workday   TINYINT(1)      NOT NULL DEFAULT 1,
  holiday_name VARCHAR(50)     NULL,
  created_by   INT UNSIGNED    NULL,
  updated_by   INT UNSIGNED    NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tenant_date (tenant_id, date),
  INDEX idx_tenant_month (tenant_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
