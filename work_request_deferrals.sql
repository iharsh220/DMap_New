CREATE TABLE IF NOT EXISTS `work_request_deferrals` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `work_request_id` INT NOT NULL,
  `manager_id` INT NOT NULL,
  `reason` ENUM('insufficient_details', 'incorrect_request_type') NOT NULL,
  `message` TEXT NULL,
  `old_request_type_id` INT NULL,
  `new_request_type_id` INT NULL,
  `old_project_type_id` INT NULL,
  `new_project_type_id` INT NULL,
  `deferred_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `client_resubmitted_at` DATETIME NULL,
  `resubmitted_by_user_id` INT NULL,
  `resubmission_count` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_work_request_deferrals_work_request_id` (`work_request_id`),
  KEY `idx_work_request_deferrals_manager_id` (`manager_id`),
  KEY `idx_work_request_deferrals_resubmitted_by_user_id` (`resubmitted_by_user_id`),
  CONSTRAINT `fk_work_request_deferrals_work_request_id`
    FOREIGN KEY (`work_request_id`) REFERENCES `work_requests` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_work_request_deferrals_manager_id`
    FOREIGN KEY (`manager_id`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_work_request_deferrals_resubmitted_by_user_id`
    FOREIGN KEY (`resubmitted_by_user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `work_requests`
  MODIFY `status` ENUM('draft', 'pending', 'accepted', 'assigned', 'in_progress', 'completed', 'rejected', 'deferred')
  NOT NULL DEFAULT 'pending';
