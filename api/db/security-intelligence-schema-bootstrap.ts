import { client } from "./client";
import { ensureColumn } from "./schema-bootstrap-utils";

const statements = [
	`CREATE TABLE IF NOT EXISTS security_scan_bindings (
		id text PRIMARY KEY NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
		version integer DEFAULT 2 NOT NULL, binding_ref text NOT NULL, repository_id text NOT NULL,
		provider text DEFAULT 'vulnworkbench' NOT NULL, identity_mapping_version integer DEFAULT 1 NOT NULL,
		provider_project_ref text NOT NULL, scan_run_ref text NOT NULL, selection_json text NOT NULL,
		requested_target_json text NOT NULL, resolved_target_kind text NOT NULL,
		source_revision_role text NOT NULL, source_revision text, target_digest text NOT NULL,
		binding_digest text NOT NULL,
		FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS security_scan_bindings_ref_uidx ON security_scan_bindings (binding_ref)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS security_scan_bindings_scan_run_ref_uidx ON security_scan_bindings (scan_run_ref)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS security_scan_bindings_digest_uidx ON security_scan_bindings (binding_digest)`,
	`CREATE INDEX IF NOT EXISTS security_scan_bindings_repository_created_idx ON security_scan_bindings (repository_id, created_at)`,
	`CREATE TABLE IF NOT EXISTS security_assessment_receipts (
		id text PRIMARY KEY NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
		version integer DEFAULT 1 NOT NULL, receipt_ref text NOT NULL, repository_id text NOT NULL,
		scan_binding_id text NOT NULL, provider_binding_proof_ref text NOT NULL,
		provider_binding_proof_digest text NOT NULL, provider_project_ref text NOT NULL,
		scan_run_ref text NOT NULL, canonical_project_ref text NOT NULL, canonical_scan_run_ref text NOT NULL,
		normalized_target_json text NOT NULL, producer_contract_version integer NOT NULL,
		bundle_ref text NOT NULL, assessment_refs_json text NOT NULL, payload_digest text NOT NULL,
		payload_json text NOT NULL, received_at integer NOT NULL,
		FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
		FOREIGN KEY (scan_binding_id) REFERENCES security_scan_bindings(id) ON DELETE restrict
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS security_assessment_receipts_ref_uidx ON security_assessment_receipts (receipt_ref)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS security_assessment_receipts_bundle_ref_uidx ON security_assessment_receipts (bundle_ref)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS security_assessment_receipts_payload_digest_uidx ON security_assessment_receipts (payload_digest)`,
	`CREATE INDEX IF NOT EXISTS security_assessment_receipts_scan_binding_idx ON security_assessment_receipts (scan_binding_id, received_at)`,
	`CREATE TABLE IF NOT EXISTS security_assessment_attempts (
		id text PRIMARY KEY NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
		attempt_ref text NOT NULL, request_digest text NOT NULL, phase text NOT NULL,
		repository_id text NOT NULL, task_id text NOT NULL, task_revision_snapshot_id text NOT NULL,
		implementation_run_id text, status text NOT NULL, reason_code text,
		retryable integer DEFAULT false NOT NULL, execution_context_json text, scan_binding_id text, assessment_receipt_id text,
		FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
		FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
		FOREIGN KEY (task_revision_snapshot_id) REFERENCES task_revision_snapshots(id) ON DELETE restrict,
		FOREIGN KEY (implementation_run_id) REFERENCES task_runs(id) ON DELETE cascade,
		FOREIGN KEY (scan_binding_id) REFERENCES security_scan_bindings(id) ON DELETE set null,
		FOREIGN KEY (assessment_receipt_id) REFERENCES security_assessment_receipts(id) ON DELETE set null
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS security_assessment_attempts_ref_uidx ON security_assessment_attempts (attempt_ref)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS security_assessment_attempts_request_digest_uidx ON security_assessment_attempts (request_digest)`,
	`CREATE INDEX IF NOT EXISTS security_assessment_attempts_run_phase_idx ON security_assessment_attempts (implementation_run_id, phase)`,
	`CREATE TABLE IF NOT EXISTS security_assessment_subject_bindings (
		id text PRIMARY KEY NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
		version integer DEFAULT 1 NOT NULL, binding_ref text NOT NULL, binding_digest text NOT NULL,
		phase text NOT NULL, assessment_receipt_id text NOT NULL, task_id text NOT NULL,
		task_revision_snapshot_id text NOT NULL, task_revision integer NOT NULL, task_digest text NOT NULL,
		repository_identity_revision integer, repository_base_worktree_id text, expected_base_head_sha text,
		implementation_run_id text, evidence_subject_snapshot_id text,
		provider_workspace_target_grant_ref text, provider_workspace_target_grant_digest text,
		provider_workspace_state_digest text, workspace_id text, workspace_allocation_version integer,
		admitted_head_sha text, source_state_hash text, diff_digest text,
		FOREIGN KEY (assessment_receipt_id) REFERENCES security_assessment_receipts(id) ON DELETE restrict,
		FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
		FOREIGN KEY (task_revision_snapshot_id) REFERENCES task_revision_snapshots(id) ON DELETE restrict,
		FOREIGN KEY (implementation_run_id) REFERENCES task_runs(id) ON DELETE cascade,
		FOREIGN KEY (evidence_subject_snapshot_id) REFERENCES evidence_subject_snapshots(id) ON DELETE restrict,
		FOREIGN KEY (workspace_id) REFERENCES task_git_workspaces(id) ON DELETE restrict
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS security_assessment_subject_bindings_ref_uidx ON security_assessment_subject_bindings (binding_ref)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS security_assessment_subject_bindings_digest_uidx ON security_assessment_subject_bindings (binding_digest)`,
	`CREATE INDEX IF NOT EXISTS security_assessment_subject_bindings_receipt_phase_idx ON security_assessment_subject_bindings (assessment_receipt_id, phase)`,
	`CREATE INDEX IF NOT EXISTS security_assessment_subject_bindings_run_phase_idx ON security_assessment_subject_bindings (implementation_run_id, phase)`,
	`CREATE TABLE IF NOT EXISTS security_contracts (
		id text PRIMARY KEY NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
		version integer DEFAULT 1 NOT NULL, contract_ref text NOT NULL, contract_revision integer NOT NULL,
		task_id text NOT NULL, task_revision_snapshot_id text NOT NULL, task_revision integer NOT NULL,
		task_digest text NOT NULL, repository_id text NOT NULL, payload_json text NOT NULL,
		supersedes_contract_ref text, contract_digest text NOT NULL, author_principal_ref text NOT NULL,
		FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
		FOREIGN KEY (task_revision_snapshot_id) REFERENCES task_revision_snapshots(id) ON DELETE restrict,
		FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS security_contracts_ref_uidx ON security_contracts (contract_ref)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS security_contracts_digest_uidx ON security_contracts (contract_digest)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS security_contracts_supersedes_uidx ON security_contracts (supersedes_contract_ref) WHERE supersedes_contract_ref IS NOT NULL`,
	`CREATE UNIQUE INDEX IF NOT EXISTS security_contracts_snapshot_revision_uidx ON security_contracts (task_revision_snapshot_id, contract_revision)`,
	`CREATE TABLE IF NOT EXISTS security_contract_heads (
		task_revision_snapshot_id text PRIMARY KEY NOT NULL, current_contract_ref text NOT NULL,
		head_revision integer NOT NULL, updated_at integer NOT NULL,
		FOREIGN KEY (task_revision_snapshot_id) REFERENCES task_revision_snapshots(id) ON DELETE cascade
	)`,
	`CREATE TABLE IF NOT EXISTS task_completion_conditions (
		id text PRIMARY KEY NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
		condition_ref text NOT NULL, task_id text NOT NULL, task_revision_snapshot_id text NOT NULL,
		task_revision integer NOT NULL, task_digest text NOT NULL, condition_revision integer NOT NULL,
		condition_key text NOT NULL, state text NOT NULL, source_json text NOT NULL, subject_ref text NOT NULL,
		supersedes_condition_ref text, condition_digest text NOT NULL, recorded_at integer NOT NULL,
		author_principal_ref text NOT NULL,
		FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
		FOREIGN KEY (task_revision_snapshot_id) REFERENCES task_revision_snapshots(id) ON DELETE restrict
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS task_completion_conditions_ref_uidx ON task_completion_conditions (condition_ref)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS task_completion_conditions_digest_uidx ON task_completion_conditions (condition_digest)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS task_completion_conditions_supersedes_uidx ON task_completion_conditions (supersedes_condition_ref) WHERE supersedes_condition_ref IS NOT NULL`,
	`CREATE UNIQUE INDEX IF NOT EXISTS task_completion_conditions_snapshot_key_revision_uidx ON task_completion_conditions (task_revision_snapshot_id, condition_key, condition_revision)`,
	`CREATE TABLE IF NOT EXISTS task_completion_condition_heads (
		id text PRIMARY KEY NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
		task_revision_snapshot_id text NOT NULL, condition_key text NOT NULL,
		current_condition_ref text NOT NULL, head_revision integer NOT NULL,
		FOREIGN KEY (task_revision_snapshot_id) REFERENCES task_revision_snapshots(id) ON DELETE cascade
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS task_completion_condition_heads_snapshot_key_uidx ON task_completion_condition_heads (task_revision_snapshot_id, condition_key)`,
	`CREATE TABLE IF NOT EXISTS security_final_judgments (
		id text PRIMARY KEY NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
		judgment_ref text NOT NULL, run_id text NOT NULL, task_revision_snapshot_id text NOT NULL,
		security_contract_ref text NOT NULL, security_contract_digest text NOT NULL,
		judgment_digest text NOT NULL, payload_json text NOT NULL,
		FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
		FOREIGN KEY (task_revision_snapshot_id) REFERENCES task_revision_snapshots(id) ON DELETE restrict
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS security_final_judgments_ref_uidx ON security_final_judgments (judgment_ref)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS security_final_judgments_run_uidx ON security_final_judgments (run_id)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS security_final_judgments_digest_uidx ON security_final_judgments (judgment_digest)`,
];

function outboxStatements(kind: "candidate" | "feedback") {
	const table = `security_knowledge_${kind}_outbox`;
	const receipt = `security_knowledge_${kind}_receipts`;
	return [
		`CREATE TABLE IF NOT EXISTS ${table} (
			id text PRIMARY KEY NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
			producer_principal_ref text NOT NULL, endpoint text NOT NULL, contract_version integer NOT NULL,
			idempotency_key text NOT NULL, batch_ref text NOT NULL, batch_payload_digest text NOT NULL,
			payload_json text NOT NULL, status text DEFAULT 'pending' NOT NULL,
			attempt_count integer DEFAULT 0 NOT NULL, next_attempt_at integer,
			last_error_code text, last_error_message text
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_idempotency_uidx ON ${table} (producer_principal_ref, endpoint, contract_version, idempotency_key)`,
		`CREATE INDEX IF NOT EXISTS ${table}_status_attempt_idx ON ${table} (status, next_attempt_at)`,
		`CREATE TABLE IF NOT EXISTS ${receipt} (
			id text PRIMARY KEY NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
			outbox_id text NOT NULL, receipt_ref text NOT NULL, response_json text NOT NULL,
			FOREIGN KEY (outbox_id) REFERENCES ${table}(id) ON DELETE cascade
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ${receipt}_outbox_uidx ON ${receipt} (outbox_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ${receipt}_ref_uidx ON ${receipt} (receipt_ref)`,
	];
}

export async function ensureSecurityIntelligenceTables(): Promise<void> {
	for (const statement of [
		...statements,
		...outboxStatements("candidate"),
		...outboxStatements("feedback"),
	]) {
		await client.execute(statement);
	}
	await ensureColumn(
		"security_assessment_attempts",
		"execution_context_json",
		"execution_context_json text",
	);
}
