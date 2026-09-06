import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { WorkspaceArtifactRef } from "../../../shared/schemas/workspace-authority.schema";
import { type DbTransaction, db } from "../../db/client";
import { withSqliteBusyRetry } from "../../db/retry";
import { artifacts, taskEvents, taskRuns } from "../../db/schema";
import { nightWorkersRealtimeBroker } from "../../services/realtime/nightworkers-ws";
import { normalizeRunEventToLegacy } from "../../services/run-events/normalizer";
import type { RunEventBase } from "../../services/run-events/types";
import { sanitizePersistenceValue } from "../../services/security/secret-persistence-firewall";
import { validateWorkspaceArtifactRef } from "../../services/workspace/workspace-artifact-provenance";
import {
	enqueueActivityEvent,
	runEventToActivityKind,
	runEventToActivityStatus,
	runEventToActivityText,
	runEventToActivityTurnId,
	schemaFirstAgentEventType,
	schemaFirstPayload,
	shouldProjectRunEventToActivity,
} from "./nightworkers.activity.repository";
import type { JsonRecord } from "./nightworkers.json-adapters";
import { readRunEventPayload } from "./nightworkers.json-adapters";
import { isSqliteUniqueConstraintError } from "./nightworkers.runs-support";
import { resolveRunCodingAgentTrace } from "./nightworkers.trace-provenance";

export async function createTaskEvent(data: {
	taskRunId: string;
	type: string;
	message: string;
	seq?: number;
	actor?: string;
	eventType?: string | null;
	payloadJson?: unknown;
	timestamp?: Date;
}) {
	data = sanitizePersistenceValue(data);
	const maxAttempts = data.seq === undefined ? 5 : 1;
	let lastError: unknown;
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		try {
			return await withSqliteBusyRetry(() =>
				db.transaction(async (tx) => {
					let seq = data.seq;
					if (seq === undefined) {
						const result = await tx
							.select({
								maxSeq: sql<number>`coalesce(max(${taskEvents.seq}), 0)`,
							})
							.from(taskEvents)
							.where(eq(taskEvents.taskRunId, data.taskRunId));
						seq = (result[0]?.maxSeq || 0) + 1;
					}
					const [event] = await tx
						.insert(taskEvents)
						.values({ ...data, seq })
						.returning();
					return event;
				}),
			);
		} catch (error) {
			lastError = error;
			if (data.seq !== undefined || !isSqliteUniqueConstraintError(error))
				throw error;
		}
	}
	throw lastError;
}

export async function createRunEvent(
	event: RunEventBase,
	options?: { legacyPayload?: unknown; payloadJson?: Record<string, unknown> },
) {
	if (event.type === "model.response_delta") return null;
	event = sanitizePersistenceValue(event);
	options = sanitizePersistenceValue(options);

	const normalized = normalizeRunEventToLegacy({
		event,
		legacyPayload: options?.legacyPayload,
	});
	const payloadJson = {
		...normalized.payloadJson,
		...(options?.payloadJson || {}),
	};
	const created = await createTaskEvent({
		taskRunId: event.runId,
		actor: normalized.actor,
		type: normalized.type,
		eventType: normalized.eventType,
		message: normalized.message,
		payloadJson,
		timestamp: normalized.timestamp,
	});
	if (!created) return created;

	const { payload, runEvent: currentRunEvent } = readRunEventPayload(
		created.payloadJson,
	);
	if (!currentRunEvent) return created;

	const patchedPayload = sanitizePersistenceValue({
		...payload,
		...(options?.payloadJson || {}),
		runEvent: {
			...currentRunEvent,
			id: created.id,
			seq: created.seq,
			runId: currentRunEvent.runId || created.taskRunId,
		},
	});

	const [updated] = await withSqliteBusyRetry(() =>
		db
			.update(taskEvents)
			.set({ payloadJson: patchedPayload })
			.where(eq(taskEvents.id, created.id))
			.returning(),
	);
	const finalEvent = updated ?? { ...created, payloadJson: patchedPayload };
	const patchedRunEvent =
		patchedPayload.runEvent && typeof patchedPayload.runEvent === "object"
			? (patchedPayload.runEvent as JsonRecord)
			: {};
	let taskId =
		event.taskId ||
		(typeof patchedRunEvent.taskId === "string"
			? patchedRunEvent.taskId
			: null);
	if (!taskId) {
		const [run] = await withSqliteBusyRetry(() =>
			db.select().from(taskRuns).where(eq(taskRuns.id, event.runId)),
		);
		taskId = run?.taskId;
	}
	if (taskId) {
		const trace = await resolveRunCodingAgentTrace(event.runId);
		const agentEventType = schemaFirstAgentEventType(patchedPayload);
		const projectToActivity = shouldProjectRunEventToActivity({
			eventType: event.type,
			agentEventType,
		});
		if (!projectToActivity) {
			nightWorkersRealtimeBroker.publish(taskId, {
				type: "task_event_created",
				runId: event.runId,
				event: finalEvent,
			});
			return finalEvent;
		}
		await enqueueActivityEvent({
			taskId,
			runId: event.runId,
			turnId: runEventToActivityTurnId({
				runId: event.runId,
				eventType: event.type,
				agentEventType,
			}),
			runSeq: finalEvent.seq,
			kind: runEventToActivityKind(event.type, finalEvent.type, agentEventType),
			source:
				event.actor === "worker"
					? "worker"
					: event.actor === "tool"
						? "tool"
						: event.actor === "supervisor"
							? "supervisor"
							: event.actor === "runtime"
								? "runtime"
								: event.actor === "human"
									? "user"
									: "system",
			status: runEventToActivityStatus({
				eventType: event.type,
				legacyType: finalEvent.type,
				agentEventType,
			}),
			text: runEventToActivityText({
				eventType: event.type,
				agentEventType,
				message: event.message,
				payload: patchedPayload,
			}),
			payloadJson: {
				runEvent: patchedPayload.runEvent,
				legacyEvent: finalEvent,
				legacyPayload: options?.legacyPayload ?? null,
				agentEventType,
				payload: schemaFirstPayload(patchedPayload),
			},
			externalId: finalEvent.id,
			dedupeKey: `task_event:${finalEvent.id}`,
			createdAt: finalEvent.timestamp,
			trace,
		});
		nightWorkersRealtimeBroker.publish(taskId, {
			type: "task_event_created",
			runId: event.runId,
			event: finalEvent,
		});
	}
	return finalEvent;
}

/**
 * Writes a Run event as part of a caller-owned transaction.
 *
 * This intentionally does not emit realtime or activity projections. Callers
 * must do that only after their enclosing transaction commits.
 */
export async function createRunEventInTransaction(
	event: RunEventBase,
	options:
		| { legacyPayload?: unknown; payloadJson?: Record<string, unknown> }
		| undefined,
	database: DbTransaction,
) {
	if (event.type === "model.response_delta") return null;
	event = sanitizePersistenceValue(event);
	options = sanitizePersistenceValue(options);

	const normalized = normalizeRunEventToLegacy({
		event,
		legacyPayload: options?.legacyPayload,
	});
	const payloadJson = {
		...normalized.payloadJson,
		...(options?.payloadJson || {}),
	};
	const maxSequence = await database
		.select({
			maxSeq: sql<number>`coalesce(max(${taskEvents.seq}), 0)`,
		})
		.from(taskEvents)
		.where(eq(taskEvents.taskRunId, event.runId));
	const [created] = await database
		.insert(taskEvents)
		.values({
			taskRunId: event.runId,
			seq: (maxSequence[0]?.maxSeq || 0) + 1,
			actor: normalized.actor,
			type: normalized.type,
			eventType: normalized.eventType,
			message: normalized.message,
			payloadJson,
			timestamp: normalized.timestamp,
		})
		.returning();
	if (!created) return null;

	const { payload, runEvent: currentRunEvent } = readRunEventPayload(
		created.payloadJson,
	);
	if (!currentRunEvent) return created;
	const patchedPayload = sanitizePersistenceValue({
		...payload,
		...(options?.payloadJson || {}),
		runEvent: {
			...currentRunEvent,
			id: created.id,
			seq: created.seq,
			runId: currentRunEvent.runId || created.taskRunId,
		},
	});
	const [updated] = await database
		.update(taskEvents)
		.set({ payloadJson: patchedPayload })
		.where(eq(taskEvents.id, created.id))
		.returning();
	return updated ?? { ...created, payloadJson: patchedPayload };
}

export async function listTaskEventsForRun(
	taskRunId: string,
	options?: { afterSeq?: number },
) {
	const predicates = [eq(taskEvents.taskRunId, taskRunId)];
	if (typeof options?.afterSeq === "number") {
		predicates.push(gt(taskEvents.seq, options.afterSeq));
	}
	return db
		.select()
		.from(taskEvents)
		.where(and(...predicates))
		.orderBy(taskEvents.seq, taskEvents.timestamp);
}

// --- Artifacts ---
export async function createArtifact(data: {
	runId: string;
	kind: string;
	path: string;
	metadataJson?: unknown;
	workspaceArtifactRef?: WorkspaceArtifactRef;
}) {
	if (
		["workspace_file", "workspace_diff", "verification_projection"].includes(
			data.kind,
		) &&
		!data.workspaceArtifactRef
	) {
		throw new Error("WORKSPACE_ARTIFACT_PROVENANCE_REQUIRED");
	}
	const workspaceProvenance = data.workspaceArtifactRef
		? await validateWorkspaceArtifactRef({
				runId: data.runId,
				ref: data.workspaceArtifactRef,
			})
		: null;
	const [artifact] = await db
		.insert(artifacts)
		.values(
			sanitizePersistenceValue({
				runId: data.runId,
				kind: data.kind,
				path: data.path,
				metadataJson: workspaceProvenance
					? {
							...(data.metadataJson &&
							typeof data.metadataJson === "object" &&
							!Array.isArray(data.metadataJson)
								? data.metadataJson
								: {}),
							workspaceProvenance,
						}
					: data.metadataJson,
			}),
		)
		.returning();
	return artifact;
}

export async function listArtifactsForRun(runId: string) {
	return db
		.select()
		.from(artifacts)
		.where(eq(artifacts.runId, runId))
		.orderBy(desc(artifacts.createdAt));
}
