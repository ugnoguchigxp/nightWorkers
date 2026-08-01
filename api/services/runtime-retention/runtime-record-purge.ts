import { client } from "../../db/client";
import { canonicalDigest } from "../../modules/agentsShare";

export async function readRuntimeForeignKeyViolations() {
	const result = await client.execute("PRAGMA foreign_key_check");
	return new Set(result.rows.map((row) => canonicalDigest(row)));
}

export async function purgeRuntimeRecordDetails(input: {
	runId: string;
	estimatedBytes: number;
	cutoff: Date;
	foreignKeyViolationsBefore: Set<string>;
}) {
	const transaction = await client.transaction("write");
	const byTable: Record<string, number> = {};
	let rows = 0;
	const executeStatement = async (table: string, sql: string) => {
		const result = await transaction.execute({ sql, args: [input.runId] });
		const count = Number(result.rowsAffected ?? 0);
		byTable[table] = count;
		rows += count;
	};
	const purgedAt = Math.floor(Date.now() / 1000);
	const cutoffSeconds = Math.floor(input.cutoff.getTime() / 1000);
	try {
		const claimed = await transaction.execute({
			sql: `
				UPDATE task_runs
				SET details_purged_at = ?,
					purged_manifest_digest = ?,
					updated_at = ?
				WHERE id = ?
				  AND details_purged_at IS NULL
				  AND (
					(status IN ('failed', 'timed_out', 'cancelled')
					 AND coalesce(finished_at, ended_at, updated_at) < ?)
					OR EXISTS (
						SELECT 1 FROM task_run_merge_records mr
						WHERE mr.run_id = task_runs.id
						  AND mr.status = 'merged'
						  AND mr.merged_at IS NOT NULL
						  AND mr.merged_at < ?
					)
					OR EXISTS (
						SELECT 1 FROM closeout_admissions ca
						WHERE ca.run_id = task_runs.id
						  AND ca.status = 'consumed'
						  AND ca.consumed_at IS NOT NULL
						  AND ca.consumed_at < ?
					)
				  )
			`,
			args: [
				purgedAt,
				canonicalDigest({ version: 1, runId: input.runId, state: "purging" }),
				purgedAt,
				input.runId,
				cutoffSeconds,
				cutoffSeconds,
				cutoffSeconds,
			],
		});
		if (Number(claimed.rowsAffected ?? 0) === 0) {
			await transaction.rollback();
			return { purged: false, rows: 0, bytes: 0, byTable };
		}
		await executeStatement(
			"coding_agent_evidence_check_confirmations",
			"DELETE FROM coding_agent_evidence_check_confirmations WHERE run_id = ?",
		);
		await executeStatement(
			"coding_agent_evidence_readiness_settlements",
			"DELETE FROM coding_agent_evidence_readiness_settlements WHERE run_id = ?",
		);
		await executeStatement(
			"verification_evidence_cases",
			"DELETE FROM verification_evidence_cases WHERE evidence_run_id IN (SELECT id FROM verification_evidence_runs WHERE run_id = ?)",
		);
		await executeStatement(
			"coding_agent_test_condition_mappings",
			"DELETE FROM coding_agent_test_condition_mappings WHERE inventory_id IN (SELECT id FROM coding_agent_test_inventory_runs WHERE run_id = ?)",
		);
		await executeStatement(
			"coding_agent_test_inventory_cases",
			"DELETE FROM coding_agent_test_inventory_cases WHERE inventory_id IN (SELECT id FROM coding_agent_test_inventory_runs WHERE run_id = ?)",
		);
		await executeStatement(
			"native_api_tool_calls",
			"DELETE FROM native_api_tool_calls WHERE run_id = ?",
		);
		await executeStatement(
			"native_api_turns",
			"DELETE FROM native_api_turns WHERE run_id = ?",
		);
		await executeStatement(
			"activity_events",
			"DELETE FROM activity_events WHERE run_id = ?",
		);
		await executeStatement(
			"activity_artifacts",
			"DELETE FROM activity_artifacts WHERE run_id = ?",
		);
		await executeStatement(
			"conversation_context_snapshots",
			"DELETE FROM conversation_context_snapshots WHERE run_id = ?",
		);
		await executeStatement(
			"task_events",
			"UPDATE task_events SET payload_json = NULL, message = '[details purged]' WHERE task_run_id = ?",
		);
		await executeStatement(
			"task_messages",
			"UPDATE task_messages SET content = '[details purged]', metadata_json = NULL WHERE run_id = ?",
		);
		await transaction.execute({
			sql: `
				UPDATE task_runs
				SET log_content = NULL,
					diff_patch = NULL,
					test_results = NULL,
					context_snapshot = NULL,
					purged_detail_count = ?,
					purged_detail_bytes = ?,
					purged_manifest_digest = ?,
					updated_at = ?
				WHERE id = ? AND details_purged_at = ?
			`,
			args: [
				rows,
				input.estimatedBytes,
				canonicalDigest({
					version: 1,
					runId: input.runId,
					rows,
					bytes: input.estimatedBytes,
					byTable,
				}),
				purgedAt,
				input.runId,
				purgedAt,
			],
		});
		const foreignKeyCheck = await transaction.execute(
			"PRAGMA foreign_key_check",
		);
		const introducedViolations = foreignKeyCheck.rows
			.map((row) => canonicalDigest(row))
			.filter((violation) => !input.foreignKeyViolationsBefore.has(violation));
		if (introducedViolations.length > 0) {
			throw new Error(
				`Retention cleanup introduced foreign key violations: ${JSON.stringify(introducedViolations.slice(0, 10))}`,
			);
		}
		await transaction.commit();
		return {
			purged: true,
			rows,
			bytes: input.estimatedBytes,
			byTable,
		};
	} catch (error) {
		await transaction.rollback().catch(() => undefined);
		throw error;
	}
}
