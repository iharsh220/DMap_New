CREATE TABLE `activity` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `created_user_id` INT DEFAULT NULL,
    `division_id` INT NOT NULL,

    `visible_to` ENUM(
        'MR',
        'AM',
        'RM',
        'ZM',
        'NSM',
        'HO',
        'ALL'
    ) NOT NULL,

    `activity_name` VARCHAR(255) NOT NULL,
    `start_date` DATE DEFAULT NULL,
    `end_date` DATE DEFAULT NULL,
    `activity_link` VARCHAR(500) DEFAULT NULL,
    `data_link` VARCHAR(500) DEFAULT NULL,
    `description` TEXT DEFAULT NULL,
    `comment` TEXT DEFAULT NULL,

    `activity_status` TINYINT NOT NULL DEFAULT 1
        COMMENT '0 = Inactive, 1 = Active',

    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),

    KEY `idx_activity_division` (`division_id`),

    CONSTRAINT `fk_activity_division`
        FOREIGN KEY (`division_id`)
        REFERENCES `division` (`id`)
        ON DELETE RESTRICT
        ON UPDATE CASCADE

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;



CREATE TABLE `activity_access` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `user_type` ENUM('ho', 'sales') NOT NULL,
    `user_identity_id` INT UNSIGNED NOT NULL,
    `access_token` VARCHAR(255) NOT NULL,
    `activity_access_link` TEXT NOT NULL,
    `expired_status` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '0 = Active, 1 = Expired',
    `expired_at` DATETIME DEFAULT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 
    INDEX `idx_user_identity` (`user_type`, `user_identity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;