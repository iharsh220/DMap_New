-- // ADDED Managers SAPCODE SQL QUERY ->
ALTER TABLE `sales` ADD `am_sapcode` INT(11) NOT NULL AFTER `sap_code`, ADD `rm_sapcode` INT(11) NOT NULL AFTER `am_sapcode`, ADD `zm_sapcode` INT(11) NOT NULL AFTER `rm_sapcode`;


-- // Dummy Insert query
INSERT INTO `sales` (`id`, `emp_code`, `emp_name`, `level`, `hq`, `region`, `zone`, `division_id`, `sap_code`, `am_sapcode`, `rm_sapcode`, `zm_sapcode`, `mobile_number`, `email_id`, `user_type`, `email_verified_status`, `password`, `account_status`, `last_login`, `login_attempts`, `lock_until`, `password_changed_at`, `password_expires_at`, `created_at`, `updated_at`) 
            VALUES (NULL, '123456', 'Test User', 'MR', 'Mumbai 2', 'Mumbai', 'Mumbai', '16', '123456', '1234567', '12345678', '123456789', '123124124124', 'testuser@alembic.co.in', 'sales', '1', '123', 'pending', NULL, '0', NULL, NULL, NULL, current_timestamp(), current_timestamp());


-- id dr_name dr_pcode sap_code speciality prescriber_status division_id 

CREATE TABLE doctors (
    id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
    dr_name VARCHAR(255) NOT NULL,
    dr_pcode VARCHAR(255) DEFAULT NULL,
    sap_code VARCHAR(100) DEFAULT NULL,
    speciality VARCHAR(255) DEFAULT NULL,
    prescriber_status VARCHAR(50) DEFAULT NULL,
    division_id INT(11) NOT NULL,

    PRIMARY KEY (id),
    INDEX idx_division_id (division_id),

    CONSTRAINT fk_doctors_division
        FOREIGN KEY (division_id)
        REFERENCES division(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT   
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;