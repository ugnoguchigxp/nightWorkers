CREATE TABLE `blueprint_design_settings` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `task_id` text NOT NULL,
  `settings_json` text NOT NULL,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blueprint_design_settings_task_id_uidx` ON `blueprint_design_settings` (`task_id`);
--> statement-breakpoint
CREATE TABLE `blueprint_artifact_adoptions` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `task_id` text NOT NULL,
  `message_id` text NOT NULL,
  `adopted` integer DEFAULT false NOT NULL,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`message_id`) REFERENCES `task_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blueprint_artifact_adoptions_task_id_idx` ON `blueprint_artifact_adoptions` (`task_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `blueprint_artifact_adoptions_message_uidx` ON `blueprint_artifact_adoptions` (`task_id`, `message_id`);
--> statement-breakpoint
CREATE TABLE `blueprint_db_design_adoptions` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `task_id` text NOT NULL,
  `message_id` text NOT NULL,
  `adopted` integer DEFAULT false NOT NULL,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`message_id`) REFERENCES `task_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blueprint_db_design_adoptions_task_id_idx` ON `blueprint_db_design_adoptions` (`task_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `blueprint_db_design_adoptions_message_uidx` ON `blueprint_db_design_adoptions` (`task_id`, `message_id`);
--> statement-breakpoint
CREATE TABLE `blueprint_design_token_adoptions` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `task_id` text NOT NULL,
  `message_id` text NOT NULL,
  `adopted` integer DEFAULT false NOT NULL,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`message_id`) REFERENCES `task_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blueprint_design_token_adoptions_task_id_idx` ON `blueprint_design_token_adoptions` (`task_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `blueprint_design_token_adoptions_message_uidx` ON `blueprint_design_token_adoptions` (`task_id`, `message_id`);
