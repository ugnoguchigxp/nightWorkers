import { client } from "./client";

export async function ensureVerificationTables() {
	await client.execute(`
    CREATE TABLE IF NOT EXISTS verification_documents (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      run_id text,
      spec_message_id text,
      spec_artifact_id text,
      verification_artifact_id text,
      source_spec_path text NOT NULL,
      schema_version integer DEFAULT 1 NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      document_json text NOT NULL,
      generated_at integer NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE set null,
      FOREIGN KEY (spec_message_id) REFERENCES task_messages(id) ON DELETE set null
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS verification_documents_task_idx ON verification_documents (task_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS verification_documents_spec_message_idx ON verification_documents (spec_message_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS verification_documents_verification_artifact_idx ON verification_documents (verification_artifact_id)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS verification_checklist_items (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      verification_document_id text NOT NULL,
      task_id text NOT NULL,
      condition_id text NOT NULL,
      text text NOT NULL,
      required integer NOT NULL,
      status text DEFAULT 'pending' NOT NULL,
      evidence_ids_json text NOT NULL,
      reason text,
      last_checked_at integer,
      FOREIGN KEY (verification_document_id) REFERENCES verification_documents(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS verification_checklist_document_condition_uidx ON verification_checklist_items (verification_document_id, condition_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS verification_checklist_task_status_idx ON verification_checklist_items (task_id, status)",
	);
	// SQLite does not support ADD COLUMN IF NOT EXISTS.  Bootstrap is also used
	// by existing local installations, so tolerate the duplicate-column error.
	await addColumnIfMissing(
		"verification_checklist_items",
		"verification_kind text",
	);
	await addColumnIfMissing(
		"verification_checklist_items",
		"expected_evidence_json text NOT NULL DEFAULT '[]'",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS verification_evidence_runs (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      run_id text,
      verification_document_id text,
      subject_id text,
      check_kind text NOT NULL,
      command text NOT NULL,
      cwd text NOT NULL,
      exit_code integer NOT NULL,
      runner text DEFAULT 'unknown' NOT NULL,
      raw_stdout_artifact_id text NOT NULL,
      raw_stderr_artifact_id text NOT NULL,
      parsed_artifact_id text,
      summary_json text NOT NULL,
      command_level_condition_ids_json text NOT NULL,
      started_at integer NOT NULL,
      finished_at integer NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE set null,
      FOREIGN KEY (verification_document_id) REFERENCES verification_documents(id) ON DELETE set null,
      FOREIGN KEY (subject_id) REFERENCES evidence_subject_snapshots(id) ON DELETE set null
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS verification_evidence_runs_task_run_idx ON verification_evidence_runs (task_id, run_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS verification_evidence_runs_document_idx ON verification_evidence_runs (verification_document_id)",
	);
	await addColumnIfMissing("verification_evidence_runs", "subject_id text");
	await client.execute(
		"CREATE INDEX IF NOT EXISTS verification_evidence_runs_subject_idx ON verification_evidence_runs (subject_id)",
	);
	await addColumnIfMissing(
		"verification_evidence_runs",
		"source_snapshot_json text",
	);
	await addColumnIfMissing(
		"verification_evidence_runs",
		"test_execution_observed integer NOT NULL DEFAULT 0",
	);
	await addColumnIfMissing(
		"verification_evidence_runs",
		"source_mutated_during_check integer NOT NULL DEFAULT 0",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS verification_evidence_cases (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      evidence_run_id text NOT NULL,
      verification_document_id text,
      condition_ids_json text NOT NULL,
      name text NOT NULL,
      file_path text,
      status text NOT NULL,
      duration_ms integer,
      failure_message text,
      FOREIGN KEY (evidence_run_id) REFERENCES verification_evidence_runs(id) ON DELETE cascade,
      FOREIGN KEY (verification_document_id) REFERENCES verification_documents(id) ON DELETE set null
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS verification_evidence_cases_run_idx ON verification_evidence_cases (evidence_run_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS verification_evidence_cases_document_idx ON verification_evidence_cases (verification_document_id)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS coding_agent_test_inventory_runs (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      run_id text,
      cwd text NOT NULL,
      source_snapshot_json text NOT NULL,
      warnings_json text NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE set null
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS coding_agent_test_inventory_runs_task_idx ON coding_agent_test_inventory_runs (task_id, created_at)",
	);
	await client.execute(`
    CREATE TABLE IF NOT EXISTS coding_agent_test_inventory_cases (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      inventory_id text NOT NULL,
      case_key text NOT NULL,
      name text NOT NULL,
      file_path text NOT NULL,
      runner text NOT NULL,
      discovery_level text NOT NULL,
      declared_condition_ids_json text NOT NULL,
      FOREIGN KEY (inventory_id) REFERENCES coding_agent_test_inventory_runs(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS coding_agent_test_inventory_case_uidx ON coding_agent_test_inventory_cases (inventory_id, case_key)",
	);
	await client.execute(`
    CREATE TABLE IF NOT EXISTS coding_agent_test_condition_mappings (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      verification_document_id text NOT NULL,
      inventory_id text NOT NULL,
      case_key text NOT NULL,
      condition_id text NOT NULL,
      source text NOT NULL,
      rationale text,
      source_digest text NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (verification_document_id) REFERENCES verification_documents(id) ON DELETE cascade,
      FOREIGN KEY (inventory_id) REFERENCES coding_agent_test_inventory_runs(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS coding_agent_test_condition_mapping_uidx ON coding_agent_test_condition_mappings (verification_document_id, inventory_id, case_key, condition_id)",
	);
}

async function addColumnIfMissing(table: string, definition: string) {
	try {
		await client.execute(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!/duplicate column name/i.test(error.message)
		) {
			throw error;
		}
	}
}
