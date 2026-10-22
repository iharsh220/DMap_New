-- Create master_card table
CREATE TABLE IF NOT EXISTS `master_card` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `division_id` INT NOT NULL,
  `division_name` VARCHAR(255) NOT NULL,
  `task_type_id` INT NOT NULL,
  `task_type_name` VARCHAR(255) NOT NULL,
  `unit_basis` VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'Unit basis for the rate',
  `new_work_rate` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'New work rate',
  `changes_rate` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Changes rate',
  `concept_charge` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Concept charge',
  `ai_charges` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'AI charges',
  `no_of_resize_pages` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Number of resize pages',
  `last_moment` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Last moment charge',
  `financial_year` VARCHAR(9) NOT NULL DEFAULT 'FY 25-26' COMMENT 'Financial year',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_master_card_division_id` (`division_id`),
  INDEX `idx_master_card_task_type_id` (`task_type_id`),
  INDEX `idx_master_card_financial_year` (`financial_year`),
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

-- Create master_card_history table for tracking upload log
CREATE TABLE IF NOT EXISTS `master_card_history` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `source_file` VARCHAR(255) NOT NULL COMMENT 'Uploaded file name',
  `file_size` INT NOT NULL COMMENT 'File size in bytes',
  `file_type` VARCHAR(10) NOT NULL COMMENT 'File type: xlsx or csv',
  `upload_job_id` VARCHAR(100) NULL COMMENT 'Job ID from SSE process',
  `uploaded_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status` VARCHAR(20) NOT NULL DEFAULT 'success' COMMENT 'Upload status: success or failed',
  `rows_processed` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  INDEX `idx_history_upload_time` (`uploaded_at`),
  INDEX `idx_history_job_id` (`upload_job_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
