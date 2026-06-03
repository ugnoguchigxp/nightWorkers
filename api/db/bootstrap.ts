import { client } from './client';

export async function ensureNightWorkersSchema() {
  await client.execute('PRAGMA foreign_keys = ON');
  await client.execute('PRAGMA busy_timeout = 5000');

  const taskRunColumns = await client.execute('PRAGMA table_info(task_runs)');
  const hasFinalJudgmentColumn = taskRunColumns.rows.some((row) => row.name === 'final_judgment');
  if (taskRunColumns.rows.length > 0 && !hasFinalJudgmentColumn) {
    await client.execute('ALTER TABLE task_runs ADD COLUMN final_judgment text');
  }

  const repositoryColumns = await client.execute('PRAGMA table_info(repositories)');
  const hasQueueEnabledColumn = repositoryColumns.rows.some((row) => row.name === 'queue_enabled');
  if (repositoryColumns.rows.length > 0 && !hasQueueEnabledColumn) {
    await client.execute(
      'ALTER TABLE repositories ADD COLUMN queue_enabled integer DEFAULT false NOT NULL'
    );
  }
  const hasMaxConcurrentSessionsColumn = repositoryColumns.rows.some(
    (row) => row.name === 'max_concurrent_sessions'
  );
  if (repositoryColumns.rows.length > 0 && !hasMaxConcurrentSessionsColumn) {
    await client.execute(
      'ALTER TABLE repositories ADD COLUMN max_concurrent_sessions integer DEFAULT 1 NOT NULL'
    );
  }

  await client.execute(`
    CREATE TABLE IF NOT EXISTS task_messages (
      id text PRIMARY KEY NOT NULL,
      task_id text NOT NULL,
      run_id text,
      role text NOT NULL,
      content text NOT NULL,
      message_type text,
      metadata_json text,
      created_at integer NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE set null
    )
  `);

  await client.execute(
    'CREATE INDEX IF NOT EXISTS task_messages_task_id_idx ON task_messages (task_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS task_messages_run_id_idx ON task_messages (run_id)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS task_run_todos (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      run_id text NOT NULL,
      seq integer NOT NULL,
      title text NOT NULL,
      description text,
      task_type text NOT NULL,
      status text DEFAULT 'pending' NOT NULL,
      procedure_id text,
      procedure_snapshot text,
      context_snapshot text,
      completion_gate_result text,
      depends_on text,
      status_reason text,
      started_at integer,
      completed_at integer,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade
    )
  `);

  await client.execute(
    'CREATE INDEX IF NOT EXISTS task_run_todos_run_id_idx ON task_run_todos (run_id)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS task_run_todos_run_seq_uidx ON task_run_todos (run_id, seq)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS implementation_queue_entries (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      repository_id text NOT NULL,
      status text DEFAULT 'queued' NOT NULL,
      priority integer DEFAULT 0 NOT NULL,
      queue_position integer,
      processor_slot integer,
      active_run_id text,
      claimed_at integer,
      last_heartbeat_at integer,
      archived_at integer,
      status_reason text,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (active_run_id) REFERENCES task_runs(id) ON DELETE set null
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS implementation_queue_entries_task_id_idx ON implementation_queue_entries (task_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS implementation_queue_entries_repository_status_idx ON implementation_queue_entries (repository_id, status)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS implementation_queue_entries_claim_order_idx ON implementation_queue_entries (status, priority, queue_position, created_at)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS implementation_queue_settings (
      id text PRIMARY KEY NOT NULL,
      processor_count integer DEFAULT 1 NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )
  `);
  await client.execute(`
    INSERT INTO implementation_queue_settings (id, processor_count, created_at, updated_at)
    SELECT 'global', 1, unixepoch() * 1000, unixepoch() * 1000
    WHERE NOT EXISTS (SELECT 1 FROM implementation_queue_settings WHERE id = 'global')
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS todo_workflow_settings (
      id text PRIMARY KEY NOT NULL,
      require_context_compile integer DEFAULT true NOT NULL,
      require_per_todo_review integer DEFAULT true NOT NULL,
      require_per_todo_fix integer DEFAULT true NOT NULL,
      require_final_verification integer DEFAULT true NOT NULL,
      require_compile_eval integer DEFAULT true NOT NULL,
      require_register_candidate_prompt integer DEFAULT true NOT NULL,
      ask_commit_on_completion integer DEFAULT true NOT NULL,
      hook_policy_json text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )
  `);
  await client.execute(`
    INSERT INTO todo_workflow_settings (
      id,
      require_context_compile,
      require_per_todo_review,
      require_per_todo_fix,
      require_final_verification,
      require_compile_eval,
      require_register_candidate_prompt,
      ask_commit_on_completion,
      created_at,
      updated_at
    )
    SELECT 'global', true, true, true, true, true, true, true, unixepoch() * 1000, unixepoch() * 1000
    WHERE NOT EXISTS (SELECT 1 FROM todo_workflow_settings WHERE id = 'global')
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS blueprint_design_settings (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      settings_json text NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade
    )
  `);

  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS blueprint_design_settings_task_id_uidx ON blueprint_design_settings (task_id)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS blueprint_artifact_adoptions (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      message_id text NOT NULL,
      adopted integer DEFAULT false NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (message_id) REFERENCES task_messages(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS blueprint_artifact_adoptions_task_id_idx ON blueprint_artifact_adoptions (task_id)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS blueprint_artifact_adoptions_message_uidx ON blueprint_artifact_adoptions (task_id, message_id)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS blueprint_db_design_adoptions (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      message_id text NOT NULL,
      adopted integer DEFAULT false NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (message_id) REFERENCES task_messages(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS blueprint_db_design_adoptions_task_id_idx ON blueprint_db_design_adoptions (task_id)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS blueprint_db_design_adoptions_message_uidx ON blueprint_db_design_adoptions (task_id, message_id)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS blueprint_design_token_adoptions (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      message_id text NOT NULL,
      adopted integer DEFAULT false NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (message_id) REFERENCES task_messages(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS blueprint_design_token_adoptions_task_id_idx ON blueprint_design_token_adoptions (task_id)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS blueprint_design_token_adoptions_message_uidx ON blueprint_design_token_adoptions (task_id, message_id)'
  );
}
