CREATE UNIQUE INDEX IF NOT EXISTS `implementation_queue_entries_active_task_uidx`
ON `implementation_queue_entries` (`task_id`)
WHERE `status` <> 'execution_archived';
