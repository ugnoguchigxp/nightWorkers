ALTER TABLE `tasks` ADD `revision` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `current_revision_snapshot_id` text;
--> statement-breakpoint
CREATE TABLE `task_revision_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`task_id` text NOT NULL,
	`revision` integer NOT NULL,
	`digest` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`objective` text,
	`acceptance_criteria` text,
	`specification_refs_json` text DEFAULT '[]' NOT NULL,
	`source_kind` text DEFAULT 'canonical' NOT NULL,
	`created_by` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_revision_snapshots_task_revision_uidx` ON `task_revision_snapshots` (`task_id`,`revision`);
--> statement-breakpoint
CREATE INDEX `task_revision_snapshots_task_digest_idx` ON `task_revision_snapshots` (`task_id`,`digest`);
--> statement-breakpoint
ALTER TABLE `task_runs` ADD `task_revision_snapshot_id` text REFERENCES task_revision_snapshots(id);
--> statement-breakpoint
ALTER TABLE `task_runs` ADD `task_revision` integer;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD `task_digest` text;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD `admission_subject_id` text;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD `details_purged_at` integer;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD `purged_detail_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD `purged_detail_bytes` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD `purged_manifest_digest` text;
--> statement-breakpoint
CREATE TABLE `evidence_subject_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`binding_status` text DEFAULT 'canonical' NOT NULL,
	`task_id` text NOT NULL,
	`task_revision_snapshot_id` text NOT NULL,
	`task_revision` integer NOT NULL,
	`task_digest` text NOT NULL,
	`implementation_run_id` text NOT NULL,
	`workspace_id` text,
	`workspace_allocation_version` integer,
	`repository_identity_revision` integer,
	`admission_attestation_id` text,
	`admission_attestation_digest` text,
	`admitted_head_sha` text,
	`base_head` text,
	`source_state_hash` text NOT NULL,
	`diff_digest` text NOT NULL,
	`verification_document_id` text,
	`verification_document_digest` text,
	`binding_digest` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade,
	FOREIGN KEY (`task_revision_snapshot_id`) REFERENCES `task_revision_snapshots`(`id`) ON DELETE restrict,
	FOREIGN KEY (`implementation_run_id`) REFERENCES `task_runs`(`id`) ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `task_git_workspaces`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_subject_snapshots_binding_digest_uidx` ON `evidence_subject_snapshots` (`binding_digest`);
--> statement-breakpoint
CREATE INDEX `evidence_subject_snapshots_run_created_idx` ON `evidence_subject_snapshots` (`implementation_run_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `evidence_subject_snapshots_current_lookup_idx` ON `evidence_subject_snapshots` (`task_id`,`task_revision_snapshot_id`,`implementation_run_id`,`source_state_hash`);
--> statement-breakpoint
ALTER TABLE `verification_evidence_runs` ADD `subject_id` text REFERENCES evidence_subject_snapshots(id);
--> statement-breakpoint
CREATE INDEX `verification_evidence_runs_subject_idx` ON `verification_evidence_runs` (`subject_id`);
--> statement-breakpoint
CREATE TABLE `final_response_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`task_id` text NOT NULL,
	`run_id` text NOT NULL,
	`subject_id` text,
	`revision` integer NOT NULL,
	`binding_status` text NOT NULL,
	`content_digest` text NOT NULL,
	`content` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `task_runs`(`id`) ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `evidence_subject_snapshots`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `final_response_evidence_run_revision_uidx` ON `final_response_evidence` (`run_id`,`revision`);
--> statement-breakpoint
CREATE INDEX `final_response_evidence_run_digest_idx` ON `final_response_evidence` (`run_id`,`content_digest`);
--> statement-breakpoint
CREATE INDEX `final_response_evidence_subject_idx` ON `final_response_evidence` (`subject_id`);
--> statement-breakpoint
CREATE TABLE `closeout_admissions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`task_id` text NOT NULL,
	`run_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`task_revision_snapshot_id` text NOT NULL,
	`final_response_evidence_id` text NOT NULL,
	`review_run_id` text NOT NULL,
	`review_manifest_digest` text NOT NULL,
	`verification_evidence_ids_json` text NOT NULL,
	`admission_digest` text NOT NULL,
	`status` text DEFAULT 'admitted' NOT NULL,
	`admitted_at` integer NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `task_runs`(`id`) ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `evidence_subject_snapshots`(`id`) ON DELETE restrict,
	FOREIGN KEY (`task_revision_snapshot_id`) REFERENCES `task_revision_snapshots`(`id`) ON DELETE restrict,
	FOREIGN KEY (`final_response_evidence_id`) REFERENCES `final_response_evidence`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `closeout_admissions_digest_uidx` ON `closeout_admissions` (`admission_digest`);
--> statement-breakpoint
CREATE INDEX `closeout_admissions_run_created_idx` ON `closeout_admissions` (`run_id`,`created_at`);
