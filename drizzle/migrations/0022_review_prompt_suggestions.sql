CREATE TABLE IF NOT EXISTS `review_prompt_suggestions` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `review_session_id` text NOT NULL,
  `finding_id` text NOT NULL,
  `run_id` text NOT NULL,
  `task_id` text NOT NULL,
  `repository_id` text NOT NULL,
  `title` text NOT NULL,
  `prompt` text NOT NULL,
  `expected_outcome` text NOT NULL,
  `acceptance_criteria` text NOT NULL,
  `verification_hint` text NOT NULL,
  `evidence_refs_json` text NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `use_count` integer DEFAULT 0 NOT NULL,
  `last_used_at` integer,
  `dismissed_at` integer,
  `created_message_id` text,
  FOREIGN KEY (`review_session_id`) REFERENCES `review_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`finding_id`) REFERENCES `review_findings`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_message_id`) REFERENCES `task_messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `review_prompt_suggestions_session_status_idx` ON `review_prompt_suggestions` (`review_session_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `review_prompt_suggestions_finding_uidx` ON `review_prompt_suggestions` (`finding_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_proposed_goals` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `review_session_id` text NOT NULL,
  `finding_id` text NOT NULL,
  `run_id` text NOT NULL,
  `task_id` text NOT NULL,
  `repository_id` text NOT NULL,
  `title` text NOT NULL,
  `expected_outcome` text NOT NULL,
  `acceptance_criteria` text NOT NULL,
  `verification_gate` text NOT NULL,
  `evidence_refs_json` text NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `decision_note` text,
  `materialized_task_id` text,
  `materialization_target` text,
  `materialization_error` text
);
--> statement-breakpoint
INSERT OR IGNORE INTO `review_prompt_suggestions` (
  `id`,
  `created_at`,
  `updated_at`,
  `review_session_id`,
  `finding_id`,
  `run_id`,
  `task_id`,
  `repository_id`,
  `title`,
  `prompt`,
  `expected_outcome`,
  `acceptance_criteria`,
  `verification_hint`,
  `evidence_refs_json`,
  `status`,
  `use_count`,
  `last_used_at`,
  `dismissed_at`,
  `created_message_id`
)
SELECT
  `id`,
  `created_at`,
  `updated_at`,
  `review_session_id`,
  `finding_id`,
  `run_id`,
  `task_id`,
  `repository_id`,
  `title`,
  '次のレビュー指摘を解消するため、この session の作業を続けてください。' || char(10) || char(10) ||
    '指摘: ' || `title` || char(10) || char(10) ||
    '背景: ' || `expected_outcome` || char(10) || char(10) ||
    'やること:' || char(10) ||
    '- 関連する証跡と差分を確認する' || char(10) ||
    '- 必要な追加実装または追加修正を行う' || char(10) ||
    '- focused verification を実行する' || char(10) ||
    '- 結果をこの session に報告する' || char(10) || char(10) ||
    '完了条件: ' || `acceptance_criteria` || char(10) || char(10) ||
    '検証: ' || `verification_gate`,
  `expected_outcome`,
  `acceptance_criteria`,
  `verification_gate`,
  `evidence_refs_json`,
  CASE
    WHEN `status` = 'rejected' THEN 'dismissed'
    WHEN `status` = 'materialized' THEN 'used'
    ELSE 'draft'
  END,
  CASE WHEN `status` = 'materialized' THEN 1 ELSE 0 END,
  CASE WHEN `status` = 'materialized' THEN `updated_at` ELSE NULL END,
  CASE WHEN `status` = 'rejected' THEN `updated_at` ELSE NULL END,
  NULL
FROM `review_proposed_goals`;
