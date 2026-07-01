-- Add is_deleted column to tasks table for soft delete
ALTER TABLE tasks 
ADD COLUMN is_deleted TINYINT(1) DEFAULT 0 NOT NULL 
COMMENT 'Soft delete flag - 0=active, 1=deleted';

-- Add is_deleted column to issue_assignments table for soft delete
ALTER TABLE issue_assignments 
ADD COLUMN is_deleted TINYINT(1) DEFAULT 0 NOT NULL 
COMMENT 'Soft delete flag - 0=active, 1=deleted';