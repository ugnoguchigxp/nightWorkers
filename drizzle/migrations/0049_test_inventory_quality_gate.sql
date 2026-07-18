ALTER TABLE `verification_checklist_items` ADD `verification_kind` text;
ALTER TABLE `verification_checklist_items` ADD `expected_evidence_json` text NOT NULL DEFAULT '[]';
ALTER TABLE `verification_evidence_runs` ADD `source_snapshot_json` text;
ALTER TABLE `verification_evidence_runs` ADD `test_execution_observed` integer NOT NULL DEFAULT 0;
ALTER TABLE `verification_evidence_runs` ADD `source_mutated_during_check` integer NOT NULL DEFAULT 0;

CREATE TABLE `coding_agent_test_inventory_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `task_id` text NOT NULL,
  `run_id` text,
  `cwd` text NOT NULL,
  `source_snapshot_json` text NOT NULL,
  `warnings_json` text NOT NULL,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `coding_agent_test_inventory_runs_task_idx` ON `coding_agent_test_inventory_runs` (`task_id`,`created_at`);

CREATE TABLE `coding_agent_test_inventory_cases` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `inventory_id` text NOT NULL,
  `case_key` text NOT NULL,
  `name` text NOT NULL,
  `file_path` text NOT NULL,
  `runner` text NOT NULL,
  `discovery_level` text NOT NULL,
  `declared_condition_ids_json` text NOT NULL,
  FOREIGN KEY (`inventory_id`) REFERENCES `coding_agent_test_inventory_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `coding_agent_test_inventory_case_uidx` ON `coding_agent_test_inventory_cases` (`inventory_id`,`case_key`);

CREATE TABLE `coding_agent_test_condition_mappings` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `task_id` text NOT NULL,
  `verification_document_id` text NOT NULL,
  `inventory_id` text NOT NULL,
  `case_key` text NOT NULL,
  `condition_id` text NOT NULL,
  `source` text NOT NULL,
  `rationale` text,
  `source_digest` text NOT NULL,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`verification_document_id`) REFERENCES `verification_documents`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`inventory_id`) REFERENCES `coding_agent_test_inventory_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `coding_agent_test_condition_mapping_uidx` ON `coding_agent_test_condition_mappings` (`verification_document_id`,`inventory_id`,`case_key`,`condition_id`);
