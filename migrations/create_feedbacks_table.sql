-- Create feedbacks table
CREATE TABLE IF NOT EXISTS `feedbacks` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `task_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `rating_functionality` TINYINT NOT NULL COMMENT 'Rating for functionality and ease of use (1-5)',
  `rating_timeliness` TINYINT NOT NULL COMMENT 'Rating for timeliness of delivery (1-5)',
  `rating_communication` TINYINT NOT NULL COMMENT 'Rating for communication and responsiveness (1-5)',
  `recommendation_score` TINYINT NOT NULL COMMENT 'Likelihood to recommend (0-10)',
  `comments` TEXT NULL COMMENT 'Optional feedback comments',
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Soft delete flag - 0=active, 1=deleted',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_feedbacks_task_id` (`task_id`),
  INDEX `idx_feedbacks_user_id` (`user_id`),
  INDEX `idx_feedbacks_is_deleted` (`is_deleted`),
  CONSTRAINT `fk_feedbacks_task_id` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_feedbacks_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
