-- Remove notification_alert column from work_request_managers table
-- Notification alerts are now stored on the work_requests table instead

ALTER TABLE work_request_managers
DROP COLUMN notification_alert;
