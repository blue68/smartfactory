ALTER TABLE work_calendar
  ADD COLUMN normal_ranges JSON NULL COMMENT '正常班次时间段数组' AFTER holiday_name,
  ADD COLUMN overtime_ranges JSON NULL COMMENT '加班时间段数组' AFTER normal_ranges;

UPDATE work_calendar
SET normal_ranges = JSON_ARRAY(
      JSON_OBJECT('startTime', '08:00', 'endTime', '12:00'),
      JSON_OBJECT('startTime', '13:30', 'endTime', '17:30')
    ),
    overtime_ranges = JSON_ARRAY()
WHERE normal_ranges IS NULL OR overtime_ranges IS NULL;
