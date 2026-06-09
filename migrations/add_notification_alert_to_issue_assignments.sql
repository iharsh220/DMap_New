-- Add notification_alert column to issue_assignments table
ALTER TABLE issue_assignments
ADD COLUMN notification_alert INT DEFAULT 0 NOT NULL;

CREATE INDEX idx_issue_assignments_notification_alert ON issue_assignments(notification_alert);
