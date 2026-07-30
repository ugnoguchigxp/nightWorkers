CREATE TABLE `plan_mode_routing_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`revision` integer NOT NULL,
	`entries_json` text NOT NULL,
	`updated_by` text NOT NULL,
	`reason` text NOT NULL,
	`idempotency_key` text,
	`request_hash` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_mode_routing_revisions_task_revision_uidx` ON `plan_mode_routing_revisions` (`task_id`,`revision`);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_mode_routing_revisions_task_idempotency_uidx` ON `plan_mode_routing_revisions` (`task_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `plan_mode_routing_revisions_task_created_idx` ON `plan_mode_routing_revisions` (`task_id`,`created_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `plan_mode_routing_revisions` (
	`id`,
	`task_id`,
	`revision`,
	`entries_json`,
	`updated_by`,
	`reason`,
	`idempotency_key`,
	`request_hash`,
	`created_at`
)
SELECT
	legacy.`id`,
	session.`task_id`,
	legacy.`revision`,
	legacy.`entries_json`,
	CASE
		WHEN legacy.`updated_by` = 'mission_pilot' THEN 'delegated_user'
		ELSE legacy.`updated_by`
	END,
	legacy.`reason`,
	legacy.`idempotency_key`,
	legacy.`request_hash`,
	legacy.`created_at`
FROM `mission_pilot_plan_routing_revisions` legacy
INNER JOIN `mission_pilot_sessions` session
	ON session.`id` = legacy.`session_id`;
--> statement-breakpoint
DROP TABLE `mission_pilot_plan_routing_revisions`;
