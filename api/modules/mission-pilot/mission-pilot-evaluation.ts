import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type {
	MissionEvaluation,
	MissionEvidenceRef,
	MissionTask,
} from "../../../shared/schemas/mission-pilot.schema";
import { db } from "../../db/client";
import { reviewFindings } from "../../db/review-mode-schema";
import {
	implementationQueueEntries,
	taskEvents,
	taskRuns,
} from "../../db/schema";
import {
	verificationEvidenceCases,
	verificationEvidenceRuns,
} from "../../db/verification-schema";
import { AppError, NotFoundError } from "../../lib/errors";
import * as missionPlannerRepo from "../mission-planner/mission-planner.repository";
import * as repo from "./mission-pilot.repository";
import { canonicalizeMissionSnapshot } from "./mission-pilot-approval";

type EvidencePack = {
	missionTaskId: string;
	runId: string | null;
	runStatus: string | null;
	evidenceRefs: MissionEvidenceRef[];
	verificationFailed: boolean;
	verificationSucceeded: boolean;
	blockingFinding: boolean;
};

function digest(value: unknown) {
	return createHash("sha256")
		.update(canonicalizeMissionSnapshot(value), "utf8")
		.digest("hex");
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function canonicalEventType(event: typeof taskEvents.$inferSelect) {
	const payload = record(event.payloadJson);
	const nested = record(payload?.event);
	return typeof nested?.type === "string"
		? nested.type
		: typeof payload?.type === "string"
			? payload.type
			: event.eventType;
}

function canonicalEventData(event: typeof taskEvents.$inferSelect) {
	const payload = record(event.payloadJson);
	return record(payload?.event)?.data ?? payload?.data ?? payload;
}

function passedFrom(value: unknown): boolean | null {
	const data = record(value);
	if (typeof data?.passed === "boolean") return data.passed;
	if (typeof data?.ok === "boolean") return data.ok;
	if (typeof data?.exitCode === "number") return data.exitCode === 0;
	return null;
}

async function collectEvidence(task: MissionTask): Promise<EvidencePack> {
	const queueEntry = task.queueEntryId
		? await db.query.implementationQueueEntries.findFirst({
				where: eq(implementationQueueEntries.id, task.queueEntryId),
			})
		: null;
	const runId = task.activeRunId ?? queueEntry?.activeRunId ?? null;
	const run = runId
		? await db.query.taskRuns.findFirst({ where: eq(taskRuns.id, runId) })
		: null;
	const events = runId
		? await db
				.select()
				.from(taskEvents)
				.where(eq(taskEvents.taskRunId, runId))
				.orderBy(asc(taskEvents.seq))
		: [];
	const findings = runId
		? await db
				.select()
				.from(reviewFindings)
				.where(
					and(
						eq(reviewFindings.runId, runId),
						eq(reviewFindings.severity, "blocking"),
						eq(reviewFindings.dispositionStatus, "unresolved"),
					),
				)
		: [];
	const evidenceRuns = task.nightworkersTaskId
		? await db
				.select()
				.from(verificationEvidenceRuns)
				.where(
					runId
						? and(
								eq(verificationEvidenceRuns.taskId, task.nightworkersTaskId),
								eq(verificationEvidenceRuns.runId, runId),
							)
						: eq(verificationEvidenceRuns.taskId, task.nightworkersTaskId),
				)
		: [];
	const cases = evidenceRuns.length
		? await db
				.select()
				.from(verificationEvidenceCases)
				.where(
					inArray(
						verificationEvidenceCases.evidenceRunId,
						evidenceRuns.map((item) => item.id),
					),
				)
		: [];
	const verificationEvents = events.filter(
		(event) => canonicalEventType(event) === "verification.finished",
	);
	const verificationFailed =
		verificationEvents.some(
			(event) => passedFrom(canonicalEventData(event)) === false,
		) ||
		evidenceRuns.some((item) => item.exitCode !== 0) ||
		cases.some((item) => ["failed", "error"].includes(item.status));
	const verificationSucceeded =
		verificationEvents.some(
			(event) => passedFrom(canonicalEventData(event)) === true,
		) ||
		(evidenceRuns.length > 0 &&
			evidenceRuns.every((item) => item.exitCode === 0) &&
			cases.every((item) => ["passed", "skipped"].includes(item.status)));
	const evidenceRefs: MissionEvidenceRef[] = [
		...(task.nightworkersTaskId
			? [{ type: "task" as const, id: task.nightworkersTaskId }]
			: []),
		...(queueEntry
			? [{ type: "queue_entry" as const, id: queueEntry.id }]
			: []),
		...(run ? [{ type: "run" as const, id: run.id }] : []),
		...events.map((event) => ({
			type: "task_event" as const,
			id: event.id,
			label: canonicalEventType(event) ?? undefined,
		})),
		...findings.map((finding) => ({
			type: "review_finding" as const,
			id: finding.id,
			label: finding.title,
		})),
		...evidenceRuns.map((item) => ({
			type: "verification_evidence_run" as const,
			id: item.id,
			label: item.checkKind,
		})),
		...cases.map((item) => ({
			type: "verification_evidence_case" as const,
			id: item.id,
			label: item.name,
		})),
	];
	return {
		missionTaskId: task.id,
		runId,
		runStatus: run?.status ?? null,
		evidenceRefs,
		verificationFailed,
		verificationSucceeded,
		blockingFinding: findings.length > 0,
	};
}

function synchronizedStatus(task: MissionTask, evidence: EvidencePack) {
	if (evidence.verificationFailed) return "failed" as const;
	if (evidence.blockingFinding) return "blocked" as const;
	if (["failed", "timed_out", "cancelled"].includes(evidence.runStatus ?? ""))
		return "failed" as const;
	if (["blocked", "needs_human"].includes(evidence.runStatus ?? ""))
		return "blocked" as const;
	if (evidence.runStatus === "completed") return "awaiting_evaluation" as const;
	if (evidence.runStatus) return "running" as const;
	return task.queueEntryId ? ("queued" as const) : task.status;
}

function assertCommandReplay(
	action: Awaited<ReturnType<typeof repo.getPilotActionByKey>>,
	requestHash: string,
) {
	if (action && action.requestHash !== requestHash)
		throw new AppError(
			409,
			"MISSION_COMMAND_IDEMPOTENCY_CONFLICT",
			"Idempotency key conflict",
		);
}

export async function syncMissionExecution(input: {
	missionId: string;
	idempotencyKey: string;
	missionTaskId?: string;
}) {
	const mission = await missionPlannerRepo.getMission(input.missionId);
	if (!mission) throw new NotFoundError("Mission not found");
	const requestHash = digest(input);
	const replay = await repo.getPilotActionByKey({
		missionId: mission.id,
		type: "sync_mission_execution",
		idempotencyKey: input.idempotencyKey,
	});
	assertCommandReplay(replay, requestHash);
	if (replay)
		return {
			missionTasks: await repo.listMissionTasks(mission.id),
			eventsAdded: 0,
		};
	const beforeEvents = (await repo.listMissionEvents(mission.id)).length;
	const allTasks = await repo.listMissionTasks(mission.id);
	const targets = input.missionTaskId
		? allTasks.filter((task) => task.id === input.missionTaskId)
		: allTasks;
	if (input.missionTaskId && targets.length === 0)
		throw new NotFoundError("MissionTask not found");
	for (const task of targets) {
		const evidence = await collectEvidence(task);
		const status = synchronizedStatus(task, evidence);
		await db.transaction(async (tx) => {
			await repo.updateMissionTask(
				task.id,
				{
					status,
					activeRunId: evidence.runId,
					lastSyncedAt: new Date(),
				},
				tx,
			);
			for (const ref of evidence.evidenceRefs.filter((item) =>
				["queue_entry", "run", "task_event"].includes(item.type),
			)) {
				await repo.appendMissionEvent(
					{
						missionId: mission.id,
						repositoryId: mission.repositoryId,
						missionTaskId: task.id,
						eventType: `execution_${ref.type}`,
						summary: `${task.title}: ${ref.label ?? ref.type}`,
						actor: {
							type: "system",
							id: null,
							displayName: "Mission Pilot Sync",
						},
						evidenceRefs: [ref],
						sourceKind: ref.type,
						sourceId: ref.id,
						sourceVersion: status,
					},
					tx,
				);
			}
		});
	}
	await repo.createCompletedPilotAction({
		missionId: mission.id,
		repositoryId: mission.repositoryId,
		targetType: "mission",
		targetId: mission.id,
		type: "sync_mission_execution",
		idempotencyKey: input.idempotencyKey,
		requestHash,
		reason: "Queue / Run / Review / Verification evidenceを同期する",
		actor: { type: "system", id: null, displayName: "Mission Pilot Sync" },
		resultRef: { type: "mission", id: mission.id },
	});
	const missionTasks = await repo.listMissionTasks(mission.id);
	return {
		missionTasks,
		eventsAdded:
			(await repo.listMissionEvents(mission.id)).length - beforeEvents,
	};
}

function judgment(task: MissionTask, evidence: EvidencePack) {
	if (evidence.verificationFailed)
		return {
			result: "failed" as const,
			objectiveStatus: "failed" as const,
			taskStatus: "failed" as const,
			summary: "Required verification failed.",
			next: "create_replan_suggestion",
		};
	if (evidence.blockingFinding)
		return {
			result: "blocked" as const,
			objectiveStatus: "blocked" as const,
			taskStatus: "blocked" as const,
			summary: "Unresolved blocking review finding exists.",
			next: "resolve_review_finding",
		};
	if (
		["failed", "timed_out", "cancelled", "blocked", "needs_human"].includes(
			evidence.runStatus ?? "",
		)
	)
		return {
			result: "failed" as const,
			objectiveStatus: "failed" as const,
			taskStatus: "failed" as const,
			summary: `Run ended as ${evidence.runStatus}.`,
			next: "create_replan_suggestion",
		};
	if (evidence.runStatus === "completed" && evidence.verificationSucceeded)
		return {
			result: "completed" as const,
			objectiveStatus: "satisfied" as const,
			taskStatus: "satisfied" as const,
			summary: "Run completed with successful verification evidence.",
			next: "continue_mission",
		};
	if (evidence.runStatus === "completed")
		return {
			result: "progressed" as const,
			objectiveStatus: "progressed" as const,
			taskStatus: "awaiting_evaluation" as const,
			summary: task.verificationGate.length
				? "Run completed, but required verification evidence is missing."
				: "Run completed without an explicit verification gate.",
			next: "collect_verification_evidence",
		};
	return {
		result: "no_progress" as const,
		objectiveStatus: "pending" as const,
		taskStatus: task.status,
		summary: "No terminal execution evidence is available.",
		next: "sync_execution",
	};
}

export async function evaluateMission(input: {
	missionId: string;
	idempotencyKey: string;
	missionTaskId?: string;
}) {
	await syncMissionExecution({
		...input,
		idempotencyKey: `${input.idempotencyKey}:sync`,
	});
	const mission = await missionPlannerRepo.getMission(input.missionId);
	if (!mission) throw new NotFoundError("Mission not found");
	const requestHash = digest(input);
	const replay = await repo.getPilotActionByKey({
		missionId: mission.id,
		type: "evaluate_mission",
		idempotencyKey: input.idempotencyKey,
	});
	assertCommandReplay(replay, requestHash);
	if (replay) {
		const latest = await repo.getLatestMissionEvaluation(mission.id);
		return { evaluations: latest ? [latest] : [], mission };
	}
	const allTasks = await repo.listMissionTasks(mission.id);
	const targets = input.missionTaskId
		? allTasks.filter((task) => task.id === input.missionTaskId)
		: allTasks.filter((task) =>
				["awaiting_evaluation", "failed", "blocked"].includes(task.status),
			);
	const evaluations: MissionEvaluation[] = [];
	for (const task of targets) {
		const evidence = await collectEvidence(task);
		const decision = judgment(task, evidence);
		const inputDigest = digest(evidence);
		const existing = await repo.findMissionEvaluationByDigest({
			missionId: mission.id,
			scopeType: "mission_task",
			scopeId: task.id,
			inputDigest,
		});
		if (existing) {
			evaluations.push(existing);
			continue;
		}
		const objectiveUpdates = task.objectiveIds.map((objectiveId) => ({
			objectiveId,
			status: decision.objectiveStatus,
			reason: decision.summary,
		}));
		const evaluation = await db.transaction(async (tx) => {
			const created = await repo.createMissionEvaluation(
				{
					missionId: mission.id,
					repositoryId: mission.repositoryId,
					scopeType: "mission_task",
					scopeId: task.id,
					missionTaskId: task.id,
					runId: evidence.runId,
					result: decision.result,
					summary: decision.summary,
					objectiveUpdatesJson: objectiveUpdates,
					evidenceRefsJson: evidence.evidenceRefs,
					inputDigest,
					nextRecommendedAction: decision.next,
					createdByActorJson: {
						type: "system",
						id: null,
						displayName: "Mission Deterministic Evaluator",
					},
				},
				tx,
			);
			await repo.updateMissionTask(
				task.id,
				{ status: decision.taskStatus },
				tx,
			);
			for (const update of objectiveUpdates) {
				await repo.updateObjectiveStatus(
					{
						...update,
						statusReason: update.reason,
						evidenceRefs: evidence.evidenceRefs,
					},
					tx,
				);
			}
			if (["failed", "blocked"].includes(decision.result)) {
				const existingAttention = await repo.findOpenAttention(
					{
						missionId: mission.id,
						type:
							decision.result === "failed"
								? "verification_failed"
								: "task_blocked",
						targetType: "mission_task",
						targetId: task.id,
					},
					tx,
				);
				if (!existingAttention)
					await repo.createAttention(
						{
							missionId: mission.id,
							repositoryId: mission.repositoryId,
							targetType: "mission_task",
							targetId: task.id,
							type:
								decision.result === "failed"
									? "verification_failed"
									: "task_blocked",
							severity: "blocking",
							title: task.title,
							summary: decision.summary,
							actionSchema: { actions: [decision.next] },
							sourceRef: { type: "mission_evaluation", id: created.id },
						},
						tx,
					);
			}
			await repo.appendMissionEvent(
				{
					missionId: mission.id,
					repositoryId: mission.repositoryId,
					missionTaskId: task.id,
					eventType: "mission_evaluated",
					summary: decision.summary,
					actor: {
						type: "system",
						id: null,
						displayName: "Mission Deterministic Evaluator",
					},
					evidenceRefs: evidence.evidenceRefs,
					sourceKind: "mission_evaluation",
					sourceId: created.id,
				},
				tx,
			);
			return created;
		});
		evaluations.push(evaluation);
	}
	const objectives = await repo.listObjectives(
		mission.id,
		mission.latestPlanningResultId ?? undefined,
	);
	if (
		objectives.length > 0 &&
		objectives.every((objective) =>
			["satisfied", "deferred"].includes(objective.status),
		)
	) {
		await missionPlannerRepo.updateMission(mission.id, {
			status: "completed",
			statusReason: "all_required_objectives_satisfied",
			completedAt: new Date(),
		});
	}
	await repo.createCompletedPilotAction({
		missionId: mission.id,
		repositoryId: mission.repositoryId,
		targetType: "mission",
		targetId: mission.id,
		type: "evaluate_mission",
		idempotencyKey: input.idempotencyKey,
		requestHash,
		reason: "Normalized evidenceでMission progressを評価する",
		actor: {
			type: "system",
			id: null,
			displayName: "Mission Deterministic Evaluator",
		},
		resultRef: { evaluationIds: evaluations.map((item) => item.id) },
	});
	const finalMission = await missionPlannerRepo.getMission(mission.id);
	if (!finalMission) throw new NotFoundError("Mission not found");
	return { evaluations, mission: finalMission };
}
