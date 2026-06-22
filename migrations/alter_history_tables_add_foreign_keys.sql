-- Add foreign keys to existing history tables
-- work_request_history
ALTER TABLE `work_request_history`
  ADD CONSTRAINT `fk_work_request_history_work_request_id`
  FOREIGN KEY (`work_request_id`) REFERENCES `work_requests` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_work_request_history_actor_id`
  FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_work_request_history_related_user_id`
  FOREIGN KEY (`related_user_id`) REFERENCES `users` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_work_request_history_related_manager_id`
  FOREIGN KEY (`related_manager_id`) REFERENCES `users` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_work_request_history_related_task_id`
  FOREIGN KEY (`related_task_id`) REFERENCES `tasks` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_work_request_history_related_issue_id`
  FOREIGN KEY (`related_issue_id`) REFERENCES `issue_assignments` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- task_history
ALTER TABLE `task_history`
  ADD CONSTRAINT `fk_task_history_task_id`
  FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_task_history_work_request_id`
  FOREIGN KEY (`work_request_id`) REFERENCES `work_requests` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_task_history_actor_id`
  FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_task_history_related_user_id`
  FOREIGN KEY (`related_user_id`) REFERENCES `users` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_task_history_assigned_to_user_id`
  FOREIGN KEY (`assigned_to_user_id`) REFERENCES `users` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_task_history_related_issue_id`
  FOREIGN KEY (`related_issue_id`) REFERENCES `issue_assignments` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- issue_history
ALTER TABLE `issue_history`
  ADD CONSTRAINT `fk_issue_history_issue_assignment_id`
  FOREIGN KEY (`issue_assignment_id`) REFERENCES `issue_assignments` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_issue_history_task_id`
  FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_issue_history_work_request_id`
  FOREIGN KEY (`work_request_id`) REFERENCES `work_requests` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_issue_history_parent_issue_id`
  FOREIGN KEY (`parent_issue_id`) REFERENCES `issue_assignments` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_issue_history_related_issue_id`
  FOREIGN KEY (`related_issue_id`) REFERENCES `issue_assignments` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_issue_history_actor_id`
  FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_issue_history_related_user_id`
  FOREIGN KEY (`related_user_id`) REFERENCES `users` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_issue_history_assigned_to_user_id`
  FOREIGN KEY (`assigned_to_user_id`) REFERENCES `users` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
