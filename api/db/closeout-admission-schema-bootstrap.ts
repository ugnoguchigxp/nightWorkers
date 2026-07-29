import { client } from "./client";

export async function ensureCloseoutAdmissionTables() {
	await client.execute(`
		CREATE TABLE IF NOT EXISTS closeout_admissions (
			id text PRIMARY KEY NOT NULL,
			created_at integer NOT NULL,
			updated_at integer NOT NULL,
			task_id text NOT NULL,
			run_id text NOT NULL,
			subject_id text NOT NULL,
			task_revision_snapshot_id text NOT NULL,
			final_response_evidence_id text NOT NULL,
			review_run_id text NOT NULL,
			review_manifest_digest text NOT NULL,
			verification_evidence_ids_json text NOT NULL,
			admission_digest text NOT NULL,
			status text DEFAULT 'admitted' NOT NULL,
			admitted_at integer NOT NULL,
			consumed_at integer,
			FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
			FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
			FOREIGN KEY (subject_id) REFERENCES evidence_subject_snapshots(id) ON DELETE restrict,
			FOREIGN KEY (task_revision_snapshot_id) REFERENCES task_revision_snapshots(id) ON DELETE restrict,
			FOREIGN KEY (final_response_evidence_id) REFERENCES final_response_evidence(id) ON DELETE restrict
		)
	`);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS closeout_admissions_digest_uidx ON closeout_admissions (admission_digest)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS closeout_admissions_run_created_idx ON closeout_admissions (run_id, created_at)",
	);
}
