-- Migration: Update leaves table - replace date with from_date/to_date and add Optional Leave day type
-- Run this after backing up the leaves table

-- Step 1: Add new columns
ALTER TABLE `leaves`
    ADD COLUMN `from_date` DATE NULL DEFAULT NULL AFTER `id`,
    ADD COLUMN `to_date` DATE NULL DEFAULT NULL AFTER `from_date`;

-- Step 2: Copy existing date values to from_date and to_date
UPDATE `leaves` SET `from_date` = `date`, `to_date` = `date` WHERE `date` IS NOT NULL;

-- Step 3: Drop the old date column
ALTER TABLE `leaves` DROP COLUMN `date`;

-- Step 4: Set from_date and to_date to NOT NULL (since they are populated)
ALTER TABLE `leaves`
    MODIFY `from_date` DATE NOT NULL,
    MODIFY `to_date` DATE NOT NULL;

-- Step 5: Recreate indexes for the new date columns
ALTER TABLE `leaves` DROP INDEX `idx_leaves_date`;
ALTER TABLE `leaves` ADD INDEX `idx_leaves_from_date` (`from_date`);
ALTER TABLE `leaves` ADD INDEX `idx_leaves_to_date` (`to_date`);

-- Step 6: Add 'Optional Leave' to the leave_day_type ENUM
ALTER TABLE `leaves`
    MODIFY `leave_day_type` ENUM('Full day', 'Half day', 'Short Leave', 'Optional Leave') NOT NULL DEFAULT 'Full day';

-- Step 7: Recreate the table from scratch (optional, for clean schema)
-- If you want a clean recreation instead of ALTER, run:
-- DROP TABLE IF EXISTS `leaves`;
-- Then run the create_leaves_table.sql migration.
