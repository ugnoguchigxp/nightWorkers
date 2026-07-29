import { client } from "./client";
import { ensureColumn } from "./schema-bootstrap-utils";

export async function ensureEvidenceLedgerTables() {
	await client.execute(`
		CREATE TABLE IF NOT EXISTS evidence_subject_snapshots (
			id text PRIMARY KEY NOT NULL,
			created_at integer NOT NULL,
			updated_at integer NOT NULL,
			version integer DEFAULT 1 NOT NULL,
			binding_status text DEFAULT 'canonical' NOT NULL,
			task_id text NOT NULL,
			task_revision_snapshot_id text NOT NULL,
			task_revision integer NOT NULL,
			task_digest text NOT NULL,
			implementation_run_id text NOT NULL,
			workspace_id text,
			workspace_allocation_version integer,
			repository_identity_revision integer,
			admission_attestation_id text,
			admission_attestation_digest text,
			admitted_head_sha text,
			base_head text,
			source_state_hash text NOT NULL,
			diff_digest text NOT NULL,
			verification_document_id text,
			verification_document_digest text,
			binding_digest text NOT NULL,
			FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
			FOREIGN KEY (task_revision_snapshot_id) REFERENCES task_revision_snapshots(id) ON DELETE restrict,
			FOREIGN KEY (implementation_run_id) REFERENCES task_runs(id) ON DELETE cascade,
			FOREIGN KEY (workspace_id) REFERENCES task_git_workspaces(id) ON DELETE set null
		)
	`);
	await ensureColumn(
		"evidence_subject_snapshots",
		"repository_identity_revision",
		"repository_identity_revision integer",
	);
	await ensureColumn(
		"evidence_subject_snapshots",
		"admission_attestation_id",
		"admission_attestation_id text",
	);
	await ensureColumn(
		"evidence_subject_snapshots",
		"admission_attestation_digest",
		"admission_attestation_digest text",
	);
	await ensureColumn(
		"evidence_subject_snapshots",
		"admitted_head_sha",
		"admitted_head_sha text",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS evidence_subject_snapshots_binding_digest_uidx ON evidence_subject_snapshots (binding_digest)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS evidence_subject_snapshots_run_created_idx ON evidence_subject_snapshots (implementation_run_id, created_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS evidence_subject_snapshots_current_lookup_idx ON evidence_subject_snapshots (task_id, task_revision_snapshot_id, implementation_run_id, source_state_hash)",
	);
}
