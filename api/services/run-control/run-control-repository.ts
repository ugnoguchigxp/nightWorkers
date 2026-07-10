import crypto from "node:crypto";
import { and, desc, eq, max, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { taskRunActionRecords, taskRunControlStates } from "../../db/schema";
import { buildRunActionIdentity } from "./action-identity";
import {
	createInitialRunControlState,
	type DomainOutcome,
	type PreparedRunAction,
	type PrepareRunActionResult,
	type ReusableRunAction,
	type RunControlState,
	type RunEffect,
	type RunTerminalReason,
	type ToolOutcomeEnvelope,
	type TransportStatus,
} from "./contracts";
import type { TodoEvidenceRequirement } from "./evidence";
import { reduceRunControlState } from "./run-control-reducer";

export class RunControlRepository {
	async getOrCreateState(runId: string): Promise<RunControlState> {
		await db
			.insert(taskRunControlStates)
			.values({ runId })
			.onConflictDoNothing({ target: taskRunControlStates.runId });
		const [row] = await db
			.select()
			.from(taskRunControlStates)
			.where(eq(taskRunControlStates.runId, runId));
		if (!row)
			throw new Error(`Run control state is unavailable for run ${runId}.`);
		return mapState(row);
	}

	async prepareAction(input: {
		runId: string;
		toolName: string;
		arguments: unknown;
		workspaceIdentity?: string | null;
		effect: RunEffect;
	}): Promise<PrepareRunActionResult> {
		return db.transaction(async (tx) => {
			await tx
				.insert(taskRunControlStates)
				.values({ runId: input.runId })
				.onConflictDoNothing({ target: taskRunControlStates.runId });
			const [stateRow] = await tx
				.select()
				.from(taskRunControlStates)
				.where(eq(taskRunControlStates.runId, input.runId));
			if (!stateRow)
				throw new Error(
					`Run control state is unavailable for run ${input.runId}.`,
				);
			const state = mapState(stateRow);
			if (state.phase === "terminal") return { kind: "terminal", state };

			const identity = buildRunActionIdentity({
				toolName: input.toolName,
				arguments: input.arguments,
				workspaceIdentity: input.workspaceIdentity,
			});
			const dedupeRevision = dedupeRevisionFor(state, input.effect);
			const [existing] = await tx
				.select()
				.from(taskRunActionRecords)
				.where(
					and(
						eq(taskRunActionRecords.runId, input.runId),
						eq(taskRunActionRecords.actionKey, identity.actionKey),
						eq(taskRunActionRecords.dedupeRevision, dedupeRevision),
					),
				);
			if (existing) {
				await tx
					.update(taskRunActionRecords)
					.set({
						repeatCount: sql`${taskRunActionRecords.repeatCount} + 1`,
						updatedAt: new Date(),
					})
					.where(eq(taskRunActionRecords.id, existing.id));
				if (
					existing.executionStatus === "completed" &&
					existing.transportStatus !== "failed"
				) {
					const reuseState = reduceRunControlState(state, {
						type: "no_progress_turn",
					});
					await tx
						.update(taskRunControlStates)
						.set(toStateUpdate(reuseState))
						.where(
							and(
								eq(taskRunControlStates.runId, input.runId),
								eq(taskRunControlStates.stateVersion, state.stateVersion),
							),
						);
					return {
						kind: "reuse",
						state: reuseState,
						action: mapReusableAction(existing),
					};
				}
				if (existing.executionStatus === "pending") {
					const reuseState = reduceRunControlState(state, {
						type: "no_progress_turn",
					});
					await tx
						.update(taskRunControlStates)
						.set(toStateUpdate(reuseState))
						.where(
							and(
								eq(taskRunControlStates.runId, input.runId),
								eq(taskRunControlStates.stateVersion, state.stateVersion),
							),
						);
					return {
						kind: "reuse",
						state: reuseState,
						action: {
							...mapReusableAction(existing),
							transportStatus: "completed",
							domainOutcome: "blocked",
							modelView: {
								status: "in_flight",
								message:
									"The same action is already in flight for the current run state.",
							},
						},
					};
				}
				await tx
					.update(taskRunActionRecords)
					.set({
						executionStatus: "pending",
						transportStatus: null,
						domainOutcome: null,
						updatedAt: new Date(),
					})
					.where(eq(taskRunActionRecords.id, existing.id));
				return {
					kind: "execute",
					state,
					action: mapPreparedAction(existing),
				};
			}

			const [sequenceRow] = await tx
				.select({ value: max(taskRunActionRecords.sequence) })
				.from(taskRunActionRecords)
				.where(eq(taskRunActionRecords.runId, input.runId));
			const sequence = (sequenceRow?.value ?? 0) + 1;
			const [record] = await tx
				.insert(taskRunActionRecords)
				.values({
					id: crypto.randomUUID(),
					runId: input.runId,
					sequence,
					toolName: input.toolName,
					normalizedArgsDigest: identity.normalizedArgsDigest,
					actionKey: identity.actionKey,
					progressRevision: state.progressRevision,
					dedupeRevision,
					effect: input.effect,
				})
				.returning();
			return {
				kind: "execute",
				state,
				action: mapPreparedAction(record),
			};
		});
	}

	async completeAction(input: {
		action: PreparedRunAction;
		transportStatus: TransportStatus;
		domainOutcome: DomainOutcome;
		resultDigest: string;
		evidenceRefs: string[];
		artifactRefs: string[];
		modelView: unknown;
	}): Promise<RunControlState> {
		return db.transaction(async (tx) => {
			const [stateRow] = await tx
				.select()
				.from(taskRunControlStates)
				.where(eq(taskRunControlStates.runId, input.action.runId));
			if (!stateRow)
				throw new Error(
					`Run control state is unavailable for run ${input.action.runId}.`,
				);
			const current = mapState(stateRow);
			const next = reduceRunControlState(current, {
				type: "action_completed",
				sequence: input.action.sequence,
				effect: input.action.effect,
				domainOutcome: input.domainOutcome,
				evidenceCount: input.evidenceRefs.length,
				artifactCount: input.artifactRefs.length,
			});
			const updatedRows = await tx
				.update(taskRunControlStates)
				.set(toStateUpdate(next))
				.where(
					and(
						eq(taskRunControlStates.runId, input.action.runId),
						eq(taskRunControlStates.stateVersion, current.stateVersion),
					),
				)
				.returning({ runId: taskRunControlStates.runId });
			if (updatedRows.length === 0)
				throw new Error("Run control state version conflict.");
			await tx
				.update(taskRunActionRecords)
				.set({
					executionStatus: "completed",
					transportStatus: input.transportStatus,
					domainOutcome: input.domainOutcome,
					resultDigest: input.resultDigest,
					evidenceRefsJson: input.evidenceRefs,
					artifactRefsJson: input.artifactRefs,
					modelViewJson: input.modelView,
					updatedAt: new Date(),
				})
				.where(eq(taskRunActionRecords.id, input.action.id));
			return next;
		});
	}

	async transition(input: {
		runId: string;
		type:
			| "no_progress_turn"
			| "enter_closeout"
			| "finalize_rejected"
			| "rotate_context";
	}): Promise<RunControlState> {
		return this.updateState(input.runId, (state) =>
			reduceRunControlState(state, { type: input.type }),
		);
	}

	async observeProgress(input: {
		runId: string;
		effect: RunEffect;
		sequence?: number | null;
	}): Promise<RunControlState> {
		return this.updateState(input.runId, (state) =>
			reduceRunControlState(state, {
				type: "progress_observed",
				effect: input.effect,
				sequence: input.sequence,
			}),
		);
	}

	async terminalize(
		runId: string,
		reason: RunTerminalReason,
	): Promise<RunControlState> {
		return this.updateState(runId, (state) =>
			reduceRunControlState(state, { type: "terminalize", reason }),
		);
	}

	async listRecentActions(runId: string, limit = 8) {
		return db
			.select()
			.from(taskRunActionRecords)
			.where(eq(taskRunActionRecords.runId, runId))
			.orderBy(desc(taskRunActionRecords.sequence))
			.limit(Math.max(1, Math.min(32, limit)));
	}

	async readMetrics(runId: string) {
		const state = await this.getOrCreateState(runId);
		const [metrics] = await db
			.select({
				actionCount: sql<number>`count(*)`,
				reusedActionCount: sql<number>`coalesce(sum(${taskRunActionRecords.repeatCount}), 0)`,
				domainFailureCount: sql<number>`coalesce(sum(case when ${taskRunActionRecords.domainOutcome} = 'failed' then 1 else 0 end), 0)`,
				transportFailureCount: sql<number>`coalesce(sum(case when ${taskRunActionRecords.transportStatus} = 'failed' then 1 else 0 end), 0)`,
				modelVisibleChars: sql<number>`coalesce(sum(length(${taskRunActionRecords.modelViewJson})), 0)`,
			})
			.from(taskRunActionRecords)
			.where(eq(taskRunActionRecords.runId, runId));
		return {
			state,
			actionCount: Number(metrics?.actionCount ?? 0),
			reusedActionCount: Number(metrics?.reusedActionCount ?? 0),
			domainFailureCount: Number(metrics?.domainFailureCount ?? 0),
			transportFailureCount: Number(metrics?.transportFailureCount ?? 0),
			modelVisibleChars: Number(metrics?.modelVisibleChars ?? 0),
		};
	}

	async validateEvidenceRefs(input: {
		runId: string;
		evidenceRefs: string[];
		requirements: TodoEvidenceRequirement[];
		todoStartedAt?: Date | null;
	}) {
		const [state, actions] = await Promise.all([
			this.getOrCreateState(input.runId),
			db
				.select()
				.from(taskRunActionRecords)
				.where(eq(taskRunActionRecords.runId, input.runId)),
		]);
		const requestedRefs = new Set(input.evidenceRefs);
		const acceptedActions = actions.filter((action) =>
			(action.evidenceRefsJson ?? []).some((ref) => requestedRefs.has(ref)),
		);
		const acceptedRefs = new Set(
			acceptedActions.flatMap((action) => action.evidenceRefsJson ?? []),
		);
		const unknownRefs = input.evidenceRefs.filter(
			(ref) => !acceptedRefs.has(ref),
		);
		const missingRequirements = input.requirements.flatMap((requirement) => {
			const minimumCount = requirement.minimumCount ?? 1;
			const count = acceptedActions.filter((action) => {
				if (!effectMatchesEvidenceKind(action.effect, requirement.kind))
					return false;
				if (
					requirement.freshness === "after_todo_start" &&
					input.todoStartedAt &&
					action.createdAt < input.todoStartedAt
				)
					return false;
				if (
					requirement.freshness === "after_last_mutation" &&
					action.dedupeRevision < state.workspaceRevision
				)
					return false;
				return true;
			}).length;
			return count >= minimumCount
				? []
				: [
						{
							...requirement,
							minimumCount,
							foundCount: count,
						},
					];
		});
		return {
			valid: unknownRefs.length === 0 && missingRequirements.length === 0,
			acceptedRefs: [...acceptedRefs],
			unknownRefs,
			missingRequirements,
			workspaceRevision: state.workspaceRevision,
		};
	}

	private async updateState(
		runId: string,
		reduce: (state: RunControlState) => RunControlState,
	) {
		return db.transaction(async (tx) => {
			await tx
				.insert(taskRunControlStates)
				.values({ runId })
				.onConflictDoNothing({ target: taskRunControlStates.runId });
			const [row] = await tx
				.select()
				.from(taskRunControlStates)
				.where(eq(taskRunControlStates.runId, runId));
			if (!row)
				throw new Error(`Run control state is unavailable for run ${runId}.`);
			const current = mapState(row);
			const next = reduce(current);
			if (next === current) return current;
			const updatedRows = await tx
				.update(taskRunControlStates)
				.set(toStateUpdate(next))
				.where(
					and(
						eq(taskRunControlStates.runId, runId),
						eq(taskRunControlStates.stateVersion, current.stateVersion),
					),
				)
				.returning({ runId: taskRunControlStates.runId });
			if (updatedRows.length === 0)
				throw new Error("Run control state version conflict.");
			return next;
		});
	}
}

function effectMatchesEvidenceKind(effect: string, kind: string) {
	if (kind === "decision" || kind === "approval")
		return effect === "workflow_mutation";
	return effect === kind;
}

function dedupeRevisionFor(state: RunControlState, effect: RunEffect) {
	return effect === "verification"
		? state.workspaceRevision
		: state.progressRevision;
}

function mapState(
	row: typeof taskRunControlStates.$inferSelect,
): RunControlState {
	return {
		version: 1,
		runId: row.runId,
		phase: row.phase as RunControlState["phase"],
		progressRevision: row.progressRevision,
		workspaceRevision: row.workspaceRevision,
		workflowRevision: row.workflowRevision,
		todoRevision: row.todoRevision,
		evidenceRevision: row.evidenceRevision,
		contextEpoch: row.contextEpoch,
		lastMutationSequence: row.lastMutationSequence,
		lastEvidenceSequence: row.lastEvidenceSequence,
		consecutiveNoProgressTurns: row.consecutiveNoProgressTurns,
		terminalReason: row.terminalReason as RunTerminalReason | null,
		stateVersion: row.stateVersion,
	};
}

function mapPreparedAction(
	row: typeof taskRunActionRecords.$inferSelect,
): PreparedRunAction {
	return {
		id: row.id,
		runId: row.runId,
		sequence: row.sequence,
		toolName: row.toolName,
		actionKey: row.actionKey,
		normalizedArgsDigest: row.normalizedArgsDigest,
		progressRevision: row.progressRevision,
		dedupeRevision: row.dedupeRevision,
		effect: row.effect as RunEffect,
	};
}

function mapReusableAction(
	row: typeof taskRunActionRecords.$inferSelect,
): ReusableRunAction {
	return {
		id: row.id,
		runId: row.runId,
		toolName: row.toolName,
		actionKey: row.actionKey,
		progressRevision: row.progressRevision,
		dedupeRevision: row.dedupeRevision,
		transportStatus: (row.transportStatus ?? "completed") as TransportStatus,
		domainOutcome: (row.domainOutcome ?? "unknown") as DomainOutcome,
		effect: row.effect as RunEffect,
		resultDigest: row.resultDigest ?? "",
		evidenceRefs: row.evidenceRefsJson ?? [],
		artifactRefs: row.artifactRefsJson ?? [],
		modelView: row.modelViewJson,
		repeatCount: row.repeatCount + 1,
	};
}

function toStateUpdate(state: RunControlState) {
	return {
		phase: state.phase,
		progressRevision: state.progressRevision,
		workspaceRevision: state.workspaceRevision,
		workflowRevision: state.workflowRevision,
		todoRevision: state.todoRevision,
		evidenceRevision: state.evidenceRevision,
		contextEpoch: state.contextEpoch,
		lastMutationSequence: state.lastMutationSequence,
		lastEvidenceSequence: state.lastEvidenceSequence,
		consecutiveNoProgressTurns: state.consecutiveNoProgressTurns,
		terminalReason: state.terminalReason,
		stateVersion: state.stateVersion,
		updatedAt: new Date(),
	};
}

export function createEphemeralPreparedAction(input: {
	runId: string;
	toolName: string;
	arguments: unknown;
	workspaceIdentity?: string | null;
	effect: RunEffect;
}): { state: RunControlState; action: PreparedRunAction } {
	const state = createInitialRunControlState(input.runId);
	const identity = buildRunActionIdentity(input);
	return {
		state,
		action: {
			id: crypto.randomUUID(),
			runId: input.runId,
			sequence: 1,
			toolName: input.toolName,
			actionKey: identity.actionKey,
			normalizedArgsDigest: identity.normalizedArgsDigest,
			progressRevision: 0,
			dedupeRevision: 0,
			effect: input.effect,
		},
	};
}

export type CompletedRunAction = ToolOutcomeEnvelope;
