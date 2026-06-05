CREATE TABLE IF NOT EXISTS `llm_model_pricing` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `provider` text NOT NULL,
  `model` text NOT NULL,
  `currency_code` text DEFAULT 'USD' NOT NULL,
  `input_per_1m` real,
  `cached_input_per_1m` real,
  `output_per_1m` real,
  `reasoning_output_per_1m` real,
  `source_url` text,
  `source_label` text,
  `effective_from` integer DEFAULT 0 NOT NULL,
  `fetched_at` integer,
  `manual_override` integer DEFAULT false NOT NULL,
  `enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `llm_model_pricing_provider_model_idx` ON `llm_model_pricing` (`provider`, `model`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `llm_model_pricing_enabled_idx` ON `llm_model_pricing` (`enabled`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `llm_model_pricing_provider_model_currency_effective_uidx` ON `llm_model_pricing` (`provider`, `model`, `currency_code`, `effective_from`);
