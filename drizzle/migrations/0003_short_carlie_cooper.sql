CREATE TABLE `task_run_todos` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`task_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`procedure_id` text,
	`procedure_snapshot` text,
	`context_snapshot` text,
	`completion_gate_result` text,
	`depends_on` text,
	`status_reason` text,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_run_todos_run_id_idx` ON `task_run_todos` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_run_todos_run_seq_uidx` ON `task_run_todos` (`run_id`,`seq`);
