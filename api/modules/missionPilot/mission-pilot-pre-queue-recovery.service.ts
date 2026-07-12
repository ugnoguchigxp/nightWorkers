import { and, eq, inArray } from "drizzle-orm";
import {
	type MissionPilotPreQueueDiagnosticCode,
	missionPilotPreQueueDiagnosticSchema,
	missionPilotQueueHandoffSchema,
} from "../../../shared/schemas/mission-pilot.schema";
import { db } from "../../db/client";
import {
	missionPilotPlanReviews,
	missionPilotSessions,
} from "../../db/mission-pilot-schema";
import {
	implementationQueueEntries,
	taskEvents,
	taskRunCommitRecords,
	taskRuns,
	tasks,
} from "../../db/schema";
import * as missionPilotRepo from "./mission-pilot.repository";
import { MissionPilotPreQueueError } from "./mission-pilot-queue-handoff.service";

const TERMINAL_TASK_STATUSES = new Set([
	"completed",
	"cancelled",
	"failed",
	"timed_out",
	"archived",
]);

function record(value: unknown) {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function runSource(payload: unknown) {
	const runEvent = record(record(payload)?.runEvent);
	const data = record(runEvent?.data);
	return {
		executionMode:
			typeof data?.executionMode === "string" ? data.executionMode : null,
		executionModeSource:
			typeof data?.executionModeSource === "string"
				? data.executionModeSource
				: null,
	};
}

async function diagnosticEvidence(
	taskId: string,
	code: MissionPilotPreQueueDiagnosticCode,
) {
	const session = await missionPilotRepo.getSessionByTaskId(taskId);
	if (!session) return null;
	const [task, runs, queueEntries, latestReview] = await Promise.all([
		db.query.tasks.findFirst({ where: eq(tasks.id, taskId) }),
		db.select().from(taskRuns).where(eq(taskRuns.taskId, taskId)),
		db
			.select()
			.from(implementationQueueEntries)
			.where(eq(implementationQueueEntries.taskId, taskId)),
		db.query.missionPilotPlanReviews.findFirst({
			where: eq(missionPilotPlanReviews.sessionId, session.id),
			orderBy: (row, { desc }) => [desc(row.createdAt)],
		}),
	]);
	if (!task) return null;
	const runIds = runs.map((run) => run.id);
	const [events, commitRecords] = await Promise.all([
		runIds.length
			? db
					.select()
					.from(taskEvents)
					.where(inArray(taskEvents.taskRunId, runIds))
					.orderBy(taskEvents.timestamp, taskEvents.seq)
			: Promise.resolve([]),
		runIds.length
			? db
					.select()
					.from(taskRunCommitRecords)
					.where(inArray(taskRunCommitRecords.runId, runIds))
			: Promise.resolve([]),
	]);
	const createdByRun = new Map<string, ReturnType<typeof runSource>>();
	for (const event of events) {
		if (event.eventType !== "state_change") continue;
		const source = runSource(event.payloadJson);
		if (source.executionMode || source.executionModeSource) {
			createdByRun.set(event.taskRunId, source);
		}
	}
	return missionPilotPreQueueDiagnosticSchema.parse({
		code,
		detectedAt: new Date(),
		taskStatus: task.status,
		sessionPhase: session.phase,
		queueEntryIds: queueEntries.map((entry) => entry.id),
		runIds,
		runSourceRefs: runs.map((run) => ({
			runId: run.id,
			...(createdByRun.get(run.id) ?? {
				executionMode: null,
				executionModeSource: null,
			}),
		})),
		commitRecordIds: commitRecords.map((record) => record.id),
		diffEventIds: events
			.filter((event) => event.eventType === "git.diff_collected")
			.map((event) => event.id),
		contextRevision: session.contextRevision,
		contextDigest: session.contextDigest,
		reviewedContextRevision: latestReview?.contextRevision ?? null,
		reviewedContextDigest: latestReview?.contextDigest ?? null,
	});
}

export async function assertMissionPilotPreQueueMutable(taskId: string) {
	const [task, runs] = await Promise.all([
		db.query.tasks.findFirst({ where: eq(tasks.id, taskId) }),
		db
			.select({ id: taskRuns.id })
			.from(taskRuns)
			.where(eq(taskRuns.taskId, taskId)),
	]);
	if (!task) {
		throw new MissionPilotPreQueueError(
			"MISSION_PILOT_QUEUE_HANDOFF_EVIDENCE_MISSING",
			"Mission Pilot Task is missing",
		);
	}
	if (TERMINAL_TASK_STATUSES.has(task.status)) {
		throw new MissionPilotPreQueueError(
			"MISSION_PILOT_PRE_QUEUE_TASK_TERMINAL",
			`Terminal Task cannot mutate pre-Queue state: ${task.status}`,
		);
	}
	if (runs.length > 0) {
		throw new MissionPilotPreQueueError(
			"MISSION_PILOT_PRE_QUEUE_UNEXPECTED_RUN",
			"Mission Pilot pre-Queue state contains an unexpected TaskRun",
		);
	}
}

export async function markMissionPilotPreQueueAttention(
	taskId: string,
	error: MissionPilotPreQueueError,
	leaseOwner?: string,
) {
	const diagnostic = await diagnosticEvidence(taskId, error.code);
	const session = await missionPilotRepo.getSessionByTaskId(taskId);
	if (!session || !diagnostic) return null;
	const conditions = [
		eq(missionPilotSessions.id, session.id),
		eq(missionPilotSessions.version, session.version),
	];
	if (leaseOwner) {
		conditions.push(eq(missionPilotSessions.leaseOwner, leaseOwner));
	}
	const [updated] = await db
		.update(missionPilotSessions)
		.set({
			desiredState: "stopped",
			phase: "attention",
			lastErrorCode: error.code,
			lastErrorMessage: error.message,
			preQueueDiagnosticJson: diagnostic,
			version: session.version + 1,
			updatedAt: new Date(),
		})
		.where(and(...conditions))
		.returning();
	return updated ?? null;
}

export async function reconcileMissionPilotPreQueueSessions() {
	const sessions = await db
		.select()
		.from(missionPilotSessions)
		.where(
			inArray(missionPilotSessions.phase, [
				"created",
				"starting",
				"initial_intake",
				"waiting_intervention",
				"generating_artifacts",
				"reviewing_plan",
				"revising_plan",
				"queueing",
				"attention",
			]),
		);
	let classified = 0;
	for (const session of sessions) {
		if (
			session.desiredState === "stopped" &&
			session.phase === "created" &&
			session.authorizationVersion === null
		) {
			continue;
		}
		const [task, runs, queueEntries] = await Promise.all([
			db.query.tasks.findFirst({ where: eq(tasks.id, session.taskId) }),
			db
				.select({ id: taskRuns.id })
				.from(taskRuns)
				.where(eq(taskRuns.taskId, session.taskId)),
			db
				.select()
				.from(implementationQueueEntries)
				.where(eq(implementationQueueEntries.taskId, session.taskId)),
		]);
		let code: MissionPilotPreQueueDiagnosticCode | null = null;
		if (!task) code = "MISSION_PILOT_QUEUE_HANDOFF_EVIDENCE_MISSING";
		else if (TERMINAL_TASK_STATUSES.has(task.status)) {
			code = "MISSION_PILOT_PRE_QUEUE_TASK_TERMINAL";
		} else if (runs.length > 0) {
			code = "MISSION_PILOT_PRE_QUEUE_UNEXPECTED_RUN";
		} else if (queueEntries.length === 1) {
			const handoff = missionPilotQueueHandoffSchema.safeParse(
				session.queueHandoffJson,
			);
			const [entry] = queueEntries;
			if (
				handoff.success &&
				entry?.id === handoff.data.queueEntryId &&
				entry.missionPilotAdmissionKey === handoff.data.admissionKey &&
				entry.status === "queued" &&
				entry.claimReady === false &&
				!entry.activeRunId &&
				task.status === "queued" &&
				session.desiredState === "playing" &&
				session.contextRevision === handoff.data.reviewedContextRevision &&
				session.contextDigest === handoff.data.reviewedContextDigest
			) {
				const [restored] = await db
					.update(missionPilotSessions)
					.set({
						phase: "queued",
						preQueueDiagnosticJson: null,
						lastErrorCode: null,
						lastErrorMessage: null,
						version: session.version + 1,
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(missionPilotSessions.id, session.id),
							eq(missionPilotSessions.version, session.version),
						),
					)
					.returning();
				if (restored) classified++;
				continue;
			}
			code = "MISSION_PILOT_QUEUE_HANDOFF_EVIDENCE_MISSING";
		} else if (queueEntries.length > 1) {
			code = "MISSION_PILOT_QUEUE_HANDOFF_DUPLICATE";
		}
		if (!code) continue;
		if (
			session.phase === "attention" &&
			session.preQueueDiagnosticJson?.code === code
		) {
			continue;
		}
		const updated = await markMissionPilotPreQueueAttention(
			session.taskId,
			new MissionPilotPreQueueError(
				code,
				"Mission Pilot pre-Queue state requires operator attention",
			),
		);
		if (updated) classified++;
	}
	return classified;
}
