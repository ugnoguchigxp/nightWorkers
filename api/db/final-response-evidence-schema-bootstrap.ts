import { client } from "./client";

export async function ensureFinalResponseEvidenceTables() {
	await client.execute(`
		CREATE TABLE IF NOT EXISTS final_response_evidence (
			id text PRIMARY KEY NOT NULL,
			created_at integer NOT NULL,
			updated_at integer NOT NULL,
			task_id text NOT NULL,
			run_id text NOT NULL,
			subject_id text,
			revision integer NOT NULL,
			binding_status text NOT NULL,
			content_digest text NOT NULL,
			content text,
			FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
			FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
			FOREIGN KEY (subject_id) REFERENCES evidence_subject_snapshots(id) ON DELETE set null
		)
	`);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS final_response_evidence_run_revision_uidx ON final_response_evidence (run_id, revision)",
	);
	await client.execute(
		"DROP INDEX IF EXISTS final_response_evidence_run_digest_uidx",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS final_response_evidence_run_digest_idx ON final_response_evidence (run_id, content_digest)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS final_response_evidence_subject_idx ON final_response_evidence (subject_id)",
	);
}
