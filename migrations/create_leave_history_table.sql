-- Create leave_history table for upload logging
CREATE TABLE IF NOT EXISTS `leave_history` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `source_file` VARCHAR(255) NOT NULL,
  `file_size` INT NULL DEFAULT NULL,
  `file_type` VARCHAR(20) NULL DEFAULT NULL,
  `upload_job_id` VARCHAR(100) NULL DEFAULT NULL,
  `status` ENUM('success', 'failed', 'partial') NOT NULL DEFAULT 'success',
  `rows_processed` INT NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_leave_history_created_at` (`created_at`),
  INDEX `idx_leave_history_upload_job_id` (`upload_job_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
