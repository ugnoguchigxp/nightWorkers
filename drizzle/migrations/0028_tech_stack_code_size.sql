CREATE TABLE `project_code_size_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`repository_id` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`algorithm_version` text NOT NULL,
	`measured_at` integer NOT NULL,
	`scan_duration_ms` integer NOT NULL,
	`git_head` text,
	`git_dirty` integer,
	`total_files` integer NOT NULL,
	`source_files` integer NOT NULL,
	`test_files` integer NOT NULL,
	`total_effective_lines` integer NOT NULL,
	`source_effective_lines` integer NOT NULL,
	`test_effective_lines` integer NOT NULL,
	`result_json` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_code_size_snapshots_repository_uidx` ON `project_code_size_snapshots` (`repository_id`);
