CREATE TABLE `application_settings` (
  `scope` text PRIMARY KEY NOT NULL,
  `value_json` text NOT NULL,
  `revision` integer DEFAULT 1 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `application_setting_secrets` (
  `scope` text PRIMARY KEY NOT NULL,
  `value_json` text NOT NULL,
  `revision` integer DEFAULT 1 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `application_setting_migrations` (
  `source` text PRIMARY KEY NOT NULL,
  `source_fingerprint` text NOT NULL,
  `imported_at` integer NOT NULL,
  `completed_at` integer NOT NULL,
  `result_json` text NOT NULL
);
