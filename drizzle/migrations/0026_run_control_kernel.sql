CREATE TABLE IF NOT EXISTS task_run_control_states (
  run_id text PRIMARY KEY NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  phase text DEFAULT 'active' NOT NULL,
  progress_revision integer DEFAULT 0 NOT NULL,
  workspace_revision integer DEFAULT 0 NOT NULL,
  workflow_revision integer DEFAULT 0 NOT NULL,
  todo_revision integer DEFAULT 0 NOT NULL,
  evidence_revision integer DEFAULT 0 NOT NULL,
  context_epoch integer DEFAULT 0 NOT NULL,
  last_mutation_sequence integer,
  last_evidence_sequence integer,
  consecutive_no_progress_turns integer DEFAULT 0 NOT NULL,
  terminal_reason text,
  state_version integer DEFAULT 0 NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS task_run_action_records (
  id text PRIMARY KEY NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  run_id text NOT NULL,
  sequence integer NOT NULL,
  tool_name text NOT NULL,
  normalized_args_digest text NOT NULL,
  action_key text NOT NULL,
  progress_revision integer NOT NULL,
  dedupe_revision integer NOT NULL,
  execution_status text DEFAULT 'pending' NOT NULL,
  transport_status text,
  domain_outcome text,
  effect text NOT NULL,
  result_digest text,
  evidence_refs_json text,
  artifact_refs_json text,
  model_view_json text,
  repeat_count integer DEFAULT 0 NOT NULL,
  FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS task_run_action_records_run_sequence_uidx
  ON task_run_action_records (run_id, sequence);
CREATE UNIQUE INDEX IF NOT EXISTS task_run_action_records_run_action_revision_uidx
  ON task_run_action_records (run_id, action_key, dedupe_revision);
CREATE INDEX IF NOT EXISTS task_run_action_records_run_created_idx
  ON task_run_action_records (run_id, created_at);

ALTER TABLE task_run_todos ADD COLUMN evidence_requirements_json text;
ALTER TABLE task_run_todos ADD COLUMN evidence_refs_json text;
