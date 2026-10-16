-- Create master_card table
CREATE TABLE IF NOT EXISTS `master_card` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `task_id` INT NOT NULL,
  `new_work_rate` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'New work rate',
  `changes_rate` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Changes rate',
  `concept_charge` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Concept charge',
  `AI_Image_charge` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'AI Image charge',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_master_card_task_id` (`task_id`),
  CONSTRAINT `fk_master_card_task_id` FOREIGN KEY (`task_id`) REFERENCES `task_type`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
