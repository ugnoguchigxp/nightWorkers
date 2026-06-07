import { client } from './client';

export async function ensureBaseNightWorkersTables() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS repositories (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      name text NOT NULL,
      local_path text NOT NULL,
      branch text DEFAULT 'main' NOT NULL,
      allowed integer DEFAULT true NOT NULL,
      queue_enabled integer DEFAULT false NOT NULL,
      max_concurrent_sessions integer DEFAULT 1 NOT NULL,
      safety_policy text
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS tasks (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      repository_id text NOT NULL,
      title text NOT NULL,
      description text,
      objective text,
      acceptance_criteria text,
      status text DEFAULT 'draft' NOT NULL,
      compiled_prompt text,
      timeout_seconds integer DEFAULT 3600 NOT NULL,
      priority integer DEFAULT 0 NOT NULL,
      created_by text,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS tasks_repository_id_idx ON tasks (repository_id)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS task_runs (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      repository_id text,
      status text DEFAULT 'running' NOT NULL,
      worker_kind text DEFAULT 'native-local-worker' NOT NULL,
      base_ref text,
      worktree_path text,
      timeout_seconds integer DEFAULT 3600 NOT NULL,
      context_snapshot text,
      summary text,
      final_report text,
      final_judgment text,
      started_at integer NOT NULL,
      ended_at integer,
      finished_at integer,
      log_content text,
      diff_patch text,
      test_results text,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
  await client.execute('CREATE INDEX IF NOT EXISTS task_runs_task_id_idx ON task_runs (task_id)');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS task_events (
      id text PRIMARY KEY NOT NULL,
      task_run_id text NOT NULL,
      type text NOT NULL,
      message text NOT NULL,
      timestamp integer NOT NULL,
      seq integer DEFAULT 0 NOT NULL,
      actor text DEFAULT 'system' NOT NULL,
      event_type text,
      payload_json text,
      FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS task_events_task_run_id_idx ON task_events (task_run_id)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id text PRIMARY KEY NOT NULL,
      run_id text NOT NULL,
      kind text NOT NULL,
      path text NOT NULL,
      metadata_json text,
      created_at integer NOT NULL,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade
    )
  `);
  await client.execute('CREATE INDEX IF NOT EXISTS artifacts_run_id_idx ON artifacts (run_id)');
}
