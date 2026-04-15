ALTER TABLE `bom_items`
  MODIFY COLUMN `quantity` DECIMAL(16,6) NOT NULL,
  MODIFY COLUMN `qty_per_unit` DECIMAL(16,6) DEFAULT NULL COMMENT 'AI成本分析用字段，同 quantity';
