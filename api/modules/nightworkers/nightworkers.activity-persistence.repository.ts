import crypto from "node:crypto";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type {
	TraceChannel,
	TraceProvenance,
} from "../../../shared/schemas/trace-provenance.schema";
import type { WorkspaceArtifactRef } from "../../../shared/schemas/workspace-authority.schema";
import { db } from "../../db/client";
import { activityArtifacts, activityEvents } from "../../db/schema";
import { logEvent } from "../../lib/logger";
import { nightWorkersRealtimeBroker } from "../../services/realtime/nightworkers-ws";
import { sanitizePersistenceValue } from "../../services/security/secret-persistence-firewall";
import { validateWorkspaceArtifactRef } from "../../services/workspace/workspace-artifact-provenance";
import { normalizeActivityKind } from "./nightworkers.activity-kind";
import type {
	ActivitySource,
	ActivityStatus,
} from "./nightworkers.activity-types";
import { activityPayloadJson } from "./nightworkers.json-adapters";
import {
	resolveActivityTrace,
	withTraceProvenance,
} from "./nightworkers.trace-provenance";

export async function appendActivityArtifact(data: {
	taskId: string;
	runId?: string | null;
	kind: string;
	path?: string | null;
	contentText?: string | null;
	metadataJson?: unknown;
	workspaceArtifactRef?: WorkspaceArtifactRef;
}) {
	if (
		["workspace_file", "workspace_diff", "verification_projection"].includes(
			data.kind,
		) &&
		(!data.runId || !data.workspaceArtifactRef)
	) {
		throw new Error("WORKSPACE_ARTIFACT_PROVENANCE_REQUIRED");
	}
	const workspaceProvenance =
		data.runId && data.workspaceArtifactRef
			? await validateWorkspaceArtifactRef({
					runId: data.runId,
					ref: data.workspaceArtifactRef,
				})
			: null;
	data = sanitizePersistenceValue(data);
	const [artifact] = await db
		.insert(activityArtifacts)
		.values({
			taskId: data.taskId,
			runId: data.runId ?? null,
			kind: data.kind,
			path: data.path ?? null,
			contentText: data.contentText ?? null,
			metadataJson: workspaceProvenance
				? {
						...(data.metadataJson &&
						typeof data.metadataJson === "object" &&
						!Array.isArray(data.metadataJson)
							? data.metadataJson
							: {}),
						workspaceProvenance,
					}
				: (data.metadataJson ?? null),
		})
		.returning();
	return artifact;
}

export async function appendActivityEvent(data: {
	taskId: string;
	runId?: string | null;
	turnId?: string | null;
	parentEventId?: string | null;
	runSeq?: number | null;
	kind: string;
	source: ActivitySource | string;
	status?: ActivityStatus | string | null;
	text?: string | null;
	payloadJson?: unknown;
	artifactId?: string | null;
	clientTempId?: string | null;
	externalId?: string | null;
	dedupeKey?: string | null;
	ingestError?: string | null;
	visibility?: string;
	trace?: TraceProvenance;
	createdAt?: Date;
}) {
	const [result] = await appendActivityEventBatch([data]);
	return result ?? null;
}

async function appendActivityEventBatch(batch: AppendActivityEventInput[]) {
	if (batch.length === 0) return [];
	batch = sanitizePersistenceValue(batch);
	const { insertedEvents, resultEvents } = await db.transaction(async (tx) => {
		const resultEvents = new Array(batch.length).fill(null);
		const insertedEvents: Array<typeof activityEvents.$inferSelect> = [];
		const nextSeqByTaskId = new Map<string, number>();
		const dedupeResultIndexByKey = new Map<string, number>();
		const duplicateLinks: Array<{ index: number; targetIndex: number }> = [];

		const taskIds = Array.from(new Set(batch.map((entry) => entry.taskId)));
		for (const taskId of taskIds) {
			const [seqRow] = await tx
				.select({
					maxSeq: sql<number>`coalesce(max(${activityEvents.seq}), 0)`,
				})
				.from(activityEvents)
				.where(eq(activityEvents.taskId, taskId));
			nextSeqByTaskId.set(taskId, seqRow?.maxSeq || 0);
		}

		const dedupeKeys = Array.from(
			new Set(
				batch
					.map((entry) => entry.dedupeKey ?? null)
					.filter(
						(value): value is string =>
							typeof value === "string" && value.length > 0,
					),
			),
		);
		const existingByDedupeKey = new Map<
			string,
			typeof activityEvents.$inferSelect
		>();
		if (dedupeKeys.length > 0) {
			const existing = await tx
				.select()
				.from(activityEvents)
				.where(inArray(activityEvents.dedupeKey, dedupeKeys));
			for (const row of existing) {
				if (row.dedupeKey) existingByDedupeKey.set(row.dedupeKey, row);
			}
		}

		const rowsToInsert: Array<typeof activityEvents.$inferInsert> = [];
		const insertTargetIndexes: number[] = [];
		for (const [index, entry] of batch.entries()) {
			const trace = resolveActivityTrace(entry);
			const normalizedKind = normalizeActivityKind(entry.kind);
			const ingestError =
				normalizedKind === entry.kind
					? entry.ingestError
					: [entry.ingestError, `Unsupported activity kind: ${entry.kind}`]
							.filter(Boolean)
							.join("\n");
			const dedupeKey = entry.dedupeKey ?? null;
			if (dedupeKey && existingByDedupeKey.has(dedupeKey)) {
				resultEvents[index] = existingByDedupeKey.get(dedupeKey) ?? null;
				continue;
			}
			if (dedupeKey && dedupeResultIndexByKey.has(dedupeKey)) {
				const targetIndex = dedupeResultIndexByKey.get(dedupeKey);
				if (targetIndex === undefined) continue;
				duplicateLinks.push({
					index,
					targetIndex,
				});
				continue;
			}
			const nextSeq = (nextSeqByTaskId.get(entry.taskId) ?? 0) + 1;
			nextSeqByTaskId.set(entry.taskId, nextSeq);
			rowsToInsert.push({
				id: crypto.randomUUID(),
				taskId: entry.taskId,
				runId: entry.runId ?? null,
				turnId: entry.turnId ?? null,
				parentEventId: entry.parentEventId ?? null,
				seq: nextSeq,
				runSeq: entry.runSeq ?? null,
				kind: normalizedKind,
				source: entry.source,
				status: entry.status ?? null,
				text: entry.text ?? null,
				artifactId: entry.artifactId ?? null,
				clientTempId: entry.clientTempId ?? null,
				externalId: entry.externalId ?? null,
				dedupeKey,
				ingestError: ingestError || null,
				visibility: entry.visibility ?? "visible",
				traceOwner: trace.owner,
				traceChannel: trace.channel,
				createdAt: entry.createdAt ?? new Date(),
				payloadJson: activityPayloadJson(
					withTraceProvenance(entry.payloadJson, trace),
					normalizedKind,
					entry.kind,
				),
			});
			insertTargetIndexes.push(index);
			if (dedupeKey) dedupeResultIndexByKey.set(dedupeKey, index);
		}

		if (rowsToInsert.length > 0) {
			const inserted = await tx
				.insert(activityEvents)
				.values(rowsToInsert)
				.returning();
			inserted.forEach((row, insertedIndex) => {
				resultEvents[insertTargetIndexes[insertedIndex]] = row;
				insertedEvents.push(row);
			});
		}

		for (const link of duplicateLinks) {
			resultEvents[link.index] = resultEvents[link.targetIndex];
		}

		return { insertedEvents, resultEvents };
	});

	for (const event of insertedEvents) {
		nightWorkersRealtimeBroker.publish(event.taskId, {
			type: "activity_event_created",
			runId: event.runId ?? undefined,
			seq: event.seq,
			payload: { event },
		});
	}
	return resultEvents;
}

type AppendActivityEventInput = Parameters<typeof appendActivityEvent>[0];

const ACTIVITY_EVENT_FLUSH_INTERVAL_MS = 250;
// Each activity row currently binds 19 SQLite parameters. Keep a batch below
// SQLite builds that retain the conservative 999-variable limit.
const ACTIVITY_EVENT_FLUSH_BATCH_SIZE = 32;
const ACTIVITY_EVENT_MAX_RETRY_DELAY_MS = 5_000;

const activityEventQueue: AppendActivityEventInput[] = [];
let activityEventFlushTimer: NodeJS.Timeout | null = null;
let activityEventRetryTimer: NodeJS.Timeout | null = null;
let activityEventDrainPromise: Promise<void> | null = null;
let activityEventRetryDelayMs = ACTIVITY_EVENT_FLUSH_INTERVAL_MS;

export function enqueueActivityEvent(data: AppendActivityEventInput) {
	activityEventQueue.push(cloneAppendActivityEventInput(data));
	if (activityEventQueue.length >= ACTIVITY_EVENT_FLUSH_BATCH_SIZE) {
		void triggerActivityEventDrain().catch((error) => {
			logEvent({
				channel: "activity-ledger",
				level: "error",
				message: "queued activity drain failed",
				meta: {
					errorMessage: error instanceof Error ? error.message : String(error),
				},
			});
		});
		return;
	}
	scheduleActivityEventFlush(ACTIVITY_EVENT_FLUSH_INTERVAL_MS);
}

export async function flushActivityEventQueue() {
	clearActivityEventTimers();
	while (activityEventDrainPromise || activityEventQueue.length > 0) {
		await triggerActivityEventDrain();
	}
}

function scheduleActivityEventFlush(delayMs: number) {
	if (activityEventFlushTimer || activityEventRetryTimer) return;
	activityEventFlushTimer = setTimeout(() => {
		activityEventFlushTimer = null;
		void triggerActivityEventDrain().catch((error) => {
			logEvent({
				channel: "activity-ledger",
				level: "error",
				message: "scheduled activity drain failed",
				meta: {
					errorMessage: error instanceof Error ? error.message : String(error),
				},
			});
		});
	}, delayMs);
	activityEventFlushTimer.unref?.();
}

function clearActivityEventTimers() {
	if (activityEventFlushTimer) {
		clearTimeout(activityEventFlushTimer);
		activityEventFlushTimer = null;
	}
	if (activityEventRetryTimer) {
		clearTimeout(activityEventRetryTimer);
		activityEventRetryTimer = null;
	}
}

async function triggerActivityEventDrain() {
	clearActivityEventTimers();
	if (activityEventDrainPromise) {
		await activityEventDrainPromise;
		return;
	}
	activityEventDrainPromise = drainQueuedActivityEvents().finally(() => {
		activityEventDrainPromise = null;
	});
	await activityEventDrainPromise;
}

async function drainQueuedActivityEvents() {
	while (activityEventQueue.length > 0) {
		const batch = activityEventQueue.splice(0, ACTIVITY_EVENT_FLUSH_BATCH_SIZE);
		try {
			await appendActivityEventBatch(batch);
			activityEventRetryDelayMs = ACTIVITY_EVENT_FLUSH_INTERVAL_MS;
		} catch (error) {
			activityEventQueue.unshift(...batch);
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			logEvent({
				channel: "activity-ledger",
				level: "error",
				message: "failed to persist queued activity events",
				meta: {
					queuedEvents: batch.length,
					retryDelayMs: activityEventRetryDelayMs,
					errorMessage,
				},
			});
			scheduleActivityEventRetry(activityEventRetryDelayMs);
			activityEventRetryDelayMs = Math.min(
				activityEventRetryDelayMs * 2,
				ACTIVITY_EVENT_MAX_RETRY_DELAY_MS,
			);
			throw error;
		}
	}
}

function scheduleActivityEventRetry(delayMs: number) {
	if (activityEventRetryTimer) return;
	activityEventRetryTimer = setTimeout(() => {
		activityEventRetryTimer = null;
		void triggerActivityEventDrain().catch((error) => {
			logEvent({
				channel: "activity-ledger",
				level: "error",
				message: "queued activity retry failed",
				meta: {
					errorMessage: error instanceof Error ? error.message : String(error),
				},
			});
		});
	}, delayMs);
	activityEventRetryTimer.unref?.();
}

function cloneAppendActivityEventInput(
	data: AppendActivityEventInput,
): AppendActivityEventInput {
	return {
		...data,
		createdAt: data.createdAt ? new Date(data.createdAt) : undefined,
		payloadJson: cloneJsonSnapshot(data.payloadJson),
	};
}

function cloneJsonSnapshot(value: unknown) {
	if (value == null) return value;
	try {
		return structuredClone(value);
	} catch {
		try {
			return JSON.parse(JSON.stringify(value));
		} catch {
			logEvent({
				channel: "activity-ledger",
				level: "warn",
				message: "failed to snapshot queued activity payload",
			});
			return value;
		}
	}
}

export async function listActivityEventsForTask(
	taskId: string,
	options?: { afterSeq?: number; traceChannel?: TraceChannel },
) {
	await flushActivityEventQueue();
	const predicates = [eq(activityEvents.taskId, taskId)];
	if (typeof options?.afterSeq === "number") {
		predicates.push(gt(activityEvents.seq, options.afterSeq));
	}
	if (options?.traceChannel) {
		predicates.push(eq(activityEvents.traceChannel, options.traceChannel));
	}
	return db
		.select()
		.from(activityEvents)
		.where(and(...predicates))
		.orderBy(activityEvents.seq, activityEvents.createdAt);
}

export async function listActivityEventsForRun(
	runId: string,
	options?: { afterSeq?: number },
) {
	await flushActivityEventQueue();
	const predicates = [eq(activityEvents.runId, runId)];
	if (typeof options?.afterSeq === "number") {
		predicates.push(gt(activityEvents.seq, options.afterSeq));
	}
	return db
		.select()
		.from(activityEvents)
		.where(and(...predicates))
		.orderBy(activityEvents.seq, activityEvents.createdAt);
}

export async function listActivityArtifactsForTask(taskId: string) {
	return db
		.select()
		.from(activityArtifacts)
		.where(eq(activityArtifacts.taskId, taskId))
		.orderBy(activityArtifacts.createdAt);
}
