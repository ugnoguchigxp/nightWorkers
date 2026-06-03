CREATE TABLE `implementation_queue_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `task_id` text NOT NULL,
  `repository_id` text NOT NULL,
  `status` text DEFAULT 'queued' NOT NULL,
  `priority` integer DEFAULT 0 NOT NULL,
  `queue_position` integer,
  `processor_slot` integer,
  `active_run_id` text,
  `claimed_at` integer,
  `last_heartbeat_at` integer,
  `archived_at` integer,
  `status_reason` text,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`active_run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `implementation_queue_entries_task_id_idx` ON `implementation_queue_entries` (`task_id`);
--> statement-breakpoint
CREATE INDEX `implementation_queue_entries_repository_status_idx` ON `implementation_queue_entries` (`repository_id`, `status`);
--> statement-breakpoint
CREATE INDEX `implementation_queue_entries_claim_order_idx` ON `implementation_queue_entries` (`status`, `priority`, `queue_position`, `created_at`);
--> statement-breakpoint
CREATE TABLE `implementation_queue_settings` (
  `id` text PRIMARY KEY NOT NULL,
  `processor_count` integer DEFAULT 1 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todo_workflow_settings` (
  `id` text PRIMARY KEY NOT NULL,
  `require_context_compile` integer DEFAULT true NOT NULL,
  `require_per_todo_review` integer DEFAULT true NOT NULL,
  `require_per_todo_fix` integer DEFAULT true NOT NULL,
  `require_final_verification` integer DEFAULT true NOT NULL,
  `require_compile_eval` integer DEFAULT true NOT NULL,
  `require_register_candidate_prompt` integer DEFAULT true NOT NULL,
  `ask_commit_on_completion` integer DEFAULT true NOT NULL,
  `hook_policy_json` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `implementation_queue_settings` (`id`, `processor_count`, `created_at`, `updated_at`)
VALUES ('global', 1, unixepoch() * 1000, unixepoch() * 1000);
--> statement-breakpoint
INSERT INTO `todo_workflow_settings` (
  `id`,
  `require_context_compile`,
  `require_per_todo_review`,
  `require_per_todo_fix`,
  `require_final_verification`,
  `require_compile_eval`,
  `require_register_candidate_prompt`,
  `ask_commit_on_completion`,
  `created_at`,
  `updated_at`
)
VALUES ('global', true, true, true, true, true, true, true, unixepoch() * 1000, unixepoch() * 1000);
