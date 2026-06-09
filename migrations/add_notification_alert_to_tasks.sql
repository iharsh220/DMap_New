-- Add notification_alert column to tasks table
ALTER TABLE tasks
ADD COLUMN notification_alert INT DEFAULT 0 NOT NULL;

CREATE INDEX idx_tasks_notification_alert ON tasks(notification_alert);
