-- Add notification_alert column to work_requests table
-- This column tracks the notification alert count for each work request

ALTER TABLE work_requests
ADD COLUMN notification_alert INT DEFAULT 0 NOT NULL;

-- Add index for faster queries when filtering/sorting by notification status
CREATE INDEX idx_work_requests_notification_alert
ON work_requests(notification_alert);
