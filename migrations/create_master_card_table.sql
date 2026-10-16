-- Create master_card table
CREATE TABLE IF NOT EXISTS `master_card` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `division_id` INT NOT NULL,
  `task_type_id` INT NOT NULL,
  `new_work_rate` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'New work rate',
  `changes_rate` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Changes rate',
  `concept_charge` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Concept charge',
  `ai_charges` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'AI charges',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_master_card_division_id` (`division_id`),
  INDEX `idx_master_card_task_type_id` (`task_type_id`),
  UNIQUE KEY `uk_master_card_division_task` (`division_id`, `task_type_id`),
  CONSTRAINT `fk_master_card_division`
    FOREIGN KEY (`division_id`)
    REFERENCES `division` (`id`)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT `fk_master_card_task_type`
    FOREIGN KEY (`task_type_id`)
    REFERENCES `task_type` (`id`)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
