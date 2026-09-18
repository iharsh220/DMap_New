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
