ALTER TABLE `workspace_attestations` ADD `staged_paths_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `workspace_attestations` ADD `modified_paths_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `workspace_attestations` ADD `untracked_paths_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `workspace_attestations` ADD `conflict_paths_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `workspace_attestations` ADD `upstream_ref` text;
--> statement-breakpoint
ALTER TABLE `workspace_attestations` ADD `upstream_sha` text;
--> statement-breakpoint
ALTER TABLE `workspace_attestations` ADD `upstream_ahead` integer;
--> statement-breakpoint
ALTER TABLE `workspace_attestations` ADD `upstream_behind` integer;
--> statement-breakpoint
ALTER TABLE `workspace_attestations` ADD `upstream_freshness` text DEFAULT 'upstream_missing' NOT NULL;
--> statement-breakpoint
ALTER TABLE `workspace_attestations` ADD `upstream_fetched_at` integer;
