import { client } from "./client";

const createTaskArchiveTableSql = (tableName: string) => `CREATE TABLE ${
	tableName
} (
	id text PRIMARY KEY NOT NULL,
	task_id text NOT NULL,
	automation_session_id text,
	source_run_id text,
	previous_status text NOT NULL,
	reason text NOT NULL,
	evidence_json text NOT NULL,
	archived_at integer NOT NULL,
	restored_at integer,
	restored_to_status text,
	restored_by text,
	FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
	FOREIGN KEY (source_run_id) REFERENCES task_runs(id) ON DELETE set null
)`;

export async function ensureTaskArchiveTables() {
	const columns = await client.execute("PRAGMA table_info(task_archive_records)");
	const hasLegacyColumn = columns.rows.some(
		(row) => row.name === "mission_pilot_session_id",
	);
	if (columns.rows.length === 0) {
		await client.execute(createTaskArchiveTableSql("task_archive_records"));
	} else if (hasLegacyColumn) {
		await client.execute("PRAGMA foreign_keys = OFF");
		try {
			await client.execute("DROP TABLE IF EXISTS task_archive_records_next");
			await client.execute(
				createTaskArchiveTableSql("task_archive_records_next"),
			);
			await client.execute(`INSERT INTO task_archive_records_next (
				id, task_id, automation_session_id, source_run_id, previous_status,
				reason, evidence_json, archived_at, restored_at, restored_to_status,
				restored_by
			)
			SELECT
				id, task_id, mission_pilot_session_id, source_run_id, previous_status,
				reason, evidence_json, archived_at, restored_at, restored_to_status,
				restored_by
			FROM task_archive_records`);
			await client.execute("DROP TABLE task_archive_records");
			await client.execute(
				"ALTER TABLE task_archive_records_next RENAME TO task_archive_records",
			);
		} finally {
			await client.execute("PRAGMA foreign_keys = ON");
		}
	}
	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_archive_records_task_idx ON task_archive_records (task_id, archived_at)",
	);
}
