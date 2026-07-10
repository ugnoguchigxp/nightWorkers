CREATE UNIQUE INDEX `mission_approvals_open_snapshot_uidx`
ON `mission_approvals` (`mission_id`,`target_type`,`target_id`,`approval_type`,`snapshot_hash`)
WHERE `status` = 'requested';
