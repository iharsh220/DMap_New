-- Migration: Update leaves table - rename Short Leave to Short Hours, remove Optional Leave from day type, add new reason values
-- Run this after backing up the leaves table

-- Step 1: Update existing leave_day_type values
UPDATE `leaves` SET `leave_day_type` = 'Short Hours' WHERE `leave_day_type` = 'Short Leave';
UPDATE `leaves` SET `leave_day_type` = 'WFH' WHERE `leave_day_type` = 'Optional Leave' AND `leave_reason` = 'WFH';
UPDATE `leaves` SET `leave_day_type` = 'Full day' WHERE `leave_day_type` = 'Optional Leave';

-- Step 2: Add new leave_reason values to ENUM
ALTER TABLE `leaves`
    MODIFY `leave_reason` ENUM('Emergency', 'Medical', 'Family Emergency', 'Feeling not well', 'Go Early', 'Personal', 'Hospitalized', 'WFH', 'Short Leave', 'Optional', 'Sick Leave', 'Going Early', 'Reached late', 'FWFH', 'RWFH') NOT NULL DEFAULT 'Feeling not well';

-- Step 3: Update leave_day_type ENUM (rename Short Leave -> Short Hours, remove Optional Leave)
ALTER TABLE `leaves`
    MODIFY `leave_day_type` ENUM('Full day', 'Half day', 'Short Hours', 'WFH') NOT NULL DEFAULT 'Full day';

-- Step 4: Update leave_reason for WFH day type records (replace 'WFH' reason with 'FWFH')
UPDATE `leaves` SET `leave_reason` = 'FWFH' WHERE `leave_day_type` = 'WFH` AND `leave_reason` = 'WFH';

-- Step 5: Add checker_remark column
ALTER TABLE `leaves`
    ADD COLUMN `checker_remark` TEXT NULL DEFAULT NULL AFTER `remark`;
