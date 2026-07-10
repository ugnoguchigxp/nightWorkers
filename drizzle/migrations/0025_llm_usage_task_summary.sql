CREATE TABLE IF NOT EXISTS llm_usage_summary_task_buckets (
  id text PRIMARY KEY NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  bucket_hour_utc integer NOT NULL,
  repository_id text,
  repository_key text NOT NULL,
  task_id text NOT NULL,
  pricing_currency_code text,
  pricing_currency_key text NOT NULL,
  pricing_status text NOT NULL,
  input_tokens integer DEFAULT 0 NOT NULL,
  output_tokens integer DEFAULT 0 NOT NULL,
  cached_input_tokens integer DEFAULT 0 NOT NULL,
  reasoning_output_tokens integer DEFAULT 0 NOT NULL,
  system_prompt_tokens integer DEFAULT 0 NOT NULL,
  user_prompt_tokens integer DEFAULT 0 NOT NULL,
  state_card_tokens integer DEFAULT 0 NOT NULL,
  total_tokens integer DEFAULT 0 NOT NULL,
  total_duration_ms integer DEFAULT 0 NOT NULL,
  output_duration_ms integer DEFAULT 0 NOT NULL,
  measured_duration_call_count integer DEFAULT 0 NOT NULL,
  call_count integer DEFAULT 0 NOT NULL,
  priced_call_count integer DEFAULT 0 NOT NULL,
  estimated_cost real DEFAULT 0 NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS llm_usage_summary_task_buckets_uidx
  ON llm_usage_summary_task_buckets (
    bucket_hour_utc,
    repository_key,
    task_id,
    pricing_currency_key,
    pricing_status
  );--> statement-breakpoint

CREATE INDEX IF NOT EXISTS llm_usage_summary_task_buckets_repository_idx
  ON llm_usage_summary_task_buckets (repository_key, task_id);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS llm_usage_summary_task_buckets_hour_idx
  ON llm_usage_summary_task_buckets (bucket_hour_utc);
