import { and, desc, eq, max, sql } from "drizzle-orm";
import { db } from "../../../db/client";
import { taskRunActionRecords } from "../../../db/schema";
import type { WorkerToolResult } from "../../../services/worker-tools/types";
import { buildRunActionIdentity, digestJson } from "./action-identity";

export type JournalExecutionResult = {
	result: WorkerToolResult<unknown>;
	reused: boolean;
};

const ACTION_IN_FLIGHT_WINDOW_MS = 5 * 60 * 1000;

/**
 * Side-effecting worker actions only: persistence and duplicate suppression.
 * This journal deliberately has no workflow phase, retry, or next-action policy.
 */
export class ActionExecutionJournal {
	async execute(input: {
		runId: string;
		toolName: string;
		arguments: unknown;
		workspaceIdentity?: string | null;
		dedupeRevision: number;
		execute: () => Promise<WorkerToolResult<unknown>>;
	}): Promise<JournalExecutionResult> {
		const identity = buildRunActionIdentity(input);
		const existing = await this.find(
			input.runId,
			identity.actionKey,
			input.dedupeRevision,
		);
		if (existing?.executionStatus === "completed" && existing.modelViewJson) {
			await db
				.update(taskRunActionRecords)
				.set({
					repeatCount: sql`${taskRunActionRecords.repeatCount} + 1`,
					updatedAt: new Date(),
				})
				.where(eq(taskRunActionRecords.id, existing.id));
			return {
				result: existing.modelViewJson as WorkerToolResult<unknown>,
				reused: true,
			};
		}
		if (existing?.executionStatus === "pending") {
			return {
				result: pendingResult(input.toolName, existing.createdAt),
				reused: true,
			};
		}
		if (existing) {
			return {
				result: journalError(
					input.toolName,
					"ACTION_RESULT_UNCERTAIN",
					"同じ操作のjournal recordがありますが結果を再利用できません。外部状態を確認してください。",
				),
				reused: true,
			};
		}

		const pending = await this.insertPending({
			...input,
			actionKey: identity.actionKey,
			normalizedArgsDigest: identity.normalizedArgsDigest,
		});
		if (!pending.owned) {
			const duplicate = await this.find(
				input.runId,
				identity.actionKey,
				input.dedupeRevision,
			);
			if (
				duplicate?.executionStatus === "completed" &&
				duplicate.modelViewJson
			) {
				return {
					result: duplicate.modelViewJson as WorkerToolResult<unknown>,
					reused: true,
				};
			}
			return {
				result:
					duplicate?.executionStatus === "pending"
						? pendingResult(input.toolName, duplicate.createdAt)
						: journalError(
								input.toolName,
								"ACTION_RESULT_UNCERTAIN",
								"同じ操作のjournal recordを確定できませんでした。外部状態を確認してください。",
							),
				reused: true,
			};
		}
		let result: WorkerToolResult<unknown>;
		try {
			result = await input.execute();
		} catch (error) {
			result = journalError(
				input.toolName,
				"WORKER_ACTION_FAILED",
				error instanceof Error ? error.message : String(error),
			);
		}
		await db
			.update(taskRunActionRecords)
			.set({
				executionStatus: "completed",
				transportStatus: "completed",
				domainOutcome: result.ok ? "succeeded" : "failed",
				resultDigest: digestJson(result),
				modelViewJson: result,
				artifactRefsJson: result.artifactIds ?? [],
				updatedAt: new Date(),
			})
			.where(eq(taskRunActionRecords.id, pending.id));
		return { result, reused: false };
	}

	private find(runId: string, actionKey: string, dedupeRevision: number) {
		return db.query.taskRunActionRecords.findFirst({
			where: and(
				eq(taskRunActionRecords.runId, runId),
				eq(taskRunActionRecords.actionKey, actionKey),
				eq(taskRunActionRecords.dedupeRevision, dedupeRevision),
			),
			orderBy: desc(taskRunActionRecords.createdAt),
		});
	}

	private async insertPending(input: {
		runId: string;
		toolName: string;
		actionKey: string;
		normalizedArgsDigest: string;
		dedupeRevision: number;
	}) {
		for (let attempt = 0; attempt < 3; attempt += 1) {
			const [latest] = await db
				.select({ sequence: max(taskRunActionRecords.sequence) })
				.from(taskRunActionRecords)
				.where(eq(taskRunActionRecords.runId, input.runId));
			try {
				const [created] = await db
					.insert(taskRunActionRecords)
					.values({
						runId: input.runId,
						sequence: Number(latest?.sequence ?? 0) + 1,
						toolName: input.toolName,
						normalizedArgsDigest: input.normalizedArgsDigest,
						actionKey: input.actionKey,
						progressRevision: input.dedupeRevision,
						dedupeRevision: input.dedupeRevision,
						executionStatus: "pending",
						effect: "side_effect",
					})
					.returning({ id: taskRunActionRecords.id });
				if (created) return { id: created.id, owned: true } as const;
			} catch (error) {
				const duplicate = await this.find(
					input.runId,
					input.actionKey,
					input.dedupeRevision,
				);
				if (duplicate) return { id: duplicate.id, owned: false } as const;
				if (attempt === 2) throw error;
			}
		}
		throw new Error("Action journal insert failed");
	}
}

function pendingResult(toolName: string, createdAt: Date) {
	const ageMs = Date.now() - createdAt.getTime();
	return ageMs <= ACTION_IN_FLIGHT_WINDOW_MS
		? journalError(toolName, "ACTION_IN_FLIGHT", "同じ操作を実行中です。")
		: journalError(
				toolName,
				"ACTION_RESULT_UNCERTAIN",
				"同じ操作の実行記録がありますが結果が確定していません。外部状態を確認してください。",
			);
}

function journalError(
	toolName: string,
	code: string,
	message: string,
): WorkerToolResult<null> {
	const timestamp = new Date().toISOString();
	return {
		ok: false,
		toolName,
		startedAt: timestamp,
		finishedAt: timestamp,
		payload: null,
		error: { code, message },
	};
}

export const actionExecutionJournal = new ActionExecutionJournal();
