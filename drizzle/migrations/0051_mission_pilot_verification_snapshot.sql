PRAGMA foreign_keys = OFF;
--> statement-breakpoint
ALTER TABLE `mission_pilot_sessions` ADD `active_verification_snapshot_id` text;
--> statement-breakpoint
UPDATE `mission_pilot_sessions`
SET `active_verification_snapshot_id` = `active_test_snapshot_id`
WHERE `active_verification_snapshot_id` IS NULL;
--> statement-breakpoint
CREATE TABLE `mission_pilot_verification_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`source_phase_run_id` text NOT NULL,
	`verification_document_id` text NOT NULL,
	`context_revision` integer NOT NULL,
	`context_digest` text NOT NULL,
	`checklist_digest` text NOT NULL,
	`required_total` integer NOT NULL,
	`required_complete` integer NOT NULL,
	`failed_required` integer NOT NULL,
	`unknown_required` integer NOT NULL,
	`evidence_run_ids_json` text NOT NULL,
	`completion_check_event_id` text NOT NULL,
	`changed_paths_json` text NOT NULL,
	`verdict` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `mission_pilot_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_phase_run_id`) REFERENCES `mission_pilot_phase_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `mission_pilot_verification_snapshots` (
	`id`,
	`session_id`,
	`source_phase_run_id`,
	`verification_document_id`,
	`context_revision`,
	`context_digest`,
	`checklist_digest`,
	`required_total`,
	`required_complete`,
	`failed_required`,
	`unknown_required`,
	`evidence_run_ids_json`,
	`completion_check_event_id`,
	`changed_paths_json`,
	`verdict`,
	`snapshot_json`,
	`created_at`
)
SELECT
	`id`,
	`session_id`,
	`phase_run_id`,
	`verification_document_id`,
	`context_revision`,
	`context_digest`,
	`checklist_digest`,
	`required_total`,
	`required_complete`,
	`failed_required`,
	`unknown_required`,
	`evidence_run_ids_json`,
	`completion_check_event_id`,
	`test_changed_paths_json`,
	`verdict`,
	`snapshot_json`,
	`created_at`
FROM `mission_pilot_test_snapshots`;
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_pilot_verification_snapshots_source_phase_run_uidx`
ON `mission_pilot_verification_snapshots` (`source_phase_run_id`);
--> statement-breakpoint
CREATE TABLE `mission_pilot_review_decisions_next` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`review_session_id` text NOT NULL,
	`review_phase_run_id` text NOT NULL,
	`context_revision` integer NOT NULL,
	`context_digest` text NOT NULL,
	`verification_snapshot_id` text NOT NULL,
	`target_manifest_digest` text NOT NULL,
	`verdict` text NOT NULL,
	`blocking_count` integer NOT NULL,
	`warning_count` integer NOT NULL,
	`info_count` integer NOT NULL,
	`finding_ids_json` text NOT NULL,
	`decision_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `mission_pilot_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`review_phase_run_id`) REFERENCES `mission_pilot_phase_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`verification_snapshot_id`) REFERENCES `mission_pilot_verification_snapshots`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `mission_pilot_review_decisions_next` (
	`id`,
	`session_id`,
	`review_session_id`,
	`review_phase_run_id`,
	`context_revision`,
	`context_digest`,
	`verification_snapshot_id`,
	`target_manifest_digest`,
	`verdict`,
	`blocking_count`,
	`warning_count`,
	`info_count`,
	`finding_ids_json`,
	`decision_json`,
	`created_at`
)
SELECT
	`id`,
	`session_id`,
	`review_session_id`,
	`review_phase_run_id`,
	`context_revision`,
	`context_digest`,
	`test_snapshot_id`,
	`target_manifest_digest`,
	`verdict`,
	`blocking_count`,
	`warning_count`,
	`info_count`,
	`finding_ids_json`,
	`decision_json`,
	`created_at`
FROM `mission_pilot_review_decisions`;
--> statement-breakpoint
DROP TABLE `mission_pilot_review_decisions`;
--> statement-breakpoint
ALTER TABLE `mission_pilot_review_decisions_next` RENAME TO `mission_pilot_review_decisions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_pilot_review_decisions_phase_run_uidx`
ON `mission_pilot_review_decisions` (`review_phase_run_id`);
--> statement-breakpoint
DROP TABLE `mission_pilot_test_snapshots`;
--> statement-breakpoint
ALTER TABLE `mission_pilot_sessions` DROP COLUMN `active_test_snapshot_id`;
--> statement-breakpoint
ALTER TABLE `mission_pilot_sessions` DROP COLUMN `test_cycle`;
--> statement-breakpoint
PRAGMA foreign_keys = ON;
