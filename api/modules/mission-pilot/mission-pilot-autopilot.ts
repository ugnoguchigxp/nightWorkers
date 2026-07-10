import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { MissionAutopilotAllowedAction } from "../../../shared/schemas/mission-pilot.schema";
import { db } from "../../db/client";
import { implementationQueueEntries, taskRuns } from "../../db/schema";
import { AppError, NotFoundError } from "../../lib/errors";
import * as missionPlannerRepo from "../mission-planner/mission-planner.repository";
import * as repo from "./mission-pilot.repository";
import { canonicalizeMissionSnapshot } from "./mission-pilot-approval";
import {
	evaluateMission,
	syncMissionExecution,
} from "./mission-pilot-evaluation";
import { enqueueMissionTask } from "./mission-pilot-queue";
import { createMissionReplanSuggestion } from "./mission-pilot-replan";

function hash(value: unknown) {
	return createHash("sha256")
		.update(canonicalizeMissionSnapshot(value), "utf8")
		.digest("hex");
}

function startSnapshot(input: {
	missionId: string;
	autonomyLevel: 1;
	allowedActions: MissionAutopilotAllowedAction[];
	expiresAt?: string;
}) {
	return {
		schemaVersion: "nightworkers.mission-autopilot-start/v1",
		missionId: input.missionId,
		autonomyLevel: input.autonomyLevel,
		allowedActions: [...new Set(input.allowedActions)].sort(),
		expiresAt: input.expiresAt ?? null,
	};
}

function resultGrantId(value: unknown) {
	if (!value || typeof value !== "object" || !("id" in value)) return null;
	return typeof value.id === "string" ? value.id : null;
}

async function replayGrantAction(input: {
	missionId: string;
	type: string;
	idempotencyKey: string;
	requestHash: string;
}) {
	const action = await repo.getPilotActionByKey(input);
	if (!action) return null;
	if (action.requestHash !== input.requestHash) {
		throw new AppError(
			409,
			"MISSION_COMMAND_IDEMPOTENCY_CONFLICT",
			"Idempotency key conflict",
		);
	}
	const id = resultGrantId(action.resultRef);
	return id ? repo.getAutopilotGrant(id) : null;
}

export async function startMissionAutopilot(input: {
	missionId: string;
	request: {
		autonomyLevel: 1;
		allowedActions: MissionAutopilotAllowedAction[];
		expiresAt?: string;
		approvalId: string;
		idempotencyKey: string;
	};
}) {
	const requestHash = hash(input.request);
	const replay = await replayGrantAction({
		missionId: input.missionId,
		type: "start_autopilot",
		idempotencyKey: input.request.idempotencyKey,
		requestHash,
	});
	if (replay) return replay;
	const mission = await missionPlannerRepo.getMission(input.missionId);
	const approval = await repo.getApproval(input.request.approvalId);
	if (!mission || !approval)
		throw new NotFoundError("Mission or approval not found");
	if (["completed", "cancelled", "abandoned"].includes(mission.status)) {
		throw new AppError(
			409,
			"MISSION_TERMINAL",
			"Terminal Mission cannot start Autopilot",
		);
	}
	const snapshot = startSnapshot({ missionId: mission.id, ...input.request });
	if (
		approval.missionId !== mission.id ||
		approval.targetType !== "mission" ||
		approval.targetId !== mission.id ||
		approval.approvalType !== "autopilot_start" ||
		approval.status !== "approved" ||
		approval.snapshotHash !== hash(snapshot)
	) {
		throw new AppError(
			409,
			"MISSION_APPROVAL_REQUIRED",
			"A matching approved Autopilot configuration is required",
		);
	}
	const existing = await repo.getActiveAutopilotGrant(mission.id);
	if (existing) return existing;
	return db.transaction(async (tx) => {
		const grant = await repo.createAutopilotGrant(
			{
				missionId: mission.id,
				repositoryId: mission.repositoryId,
				autonomyLevel: 1,
				allowedActions: snapshot.allowedActions,
				grantedByActor: { type: "human", id: null, displayName: "User" },
				expiresAt: snapshot.expiresAt ? new Date(snapshot.expiresAt) : null,
			},
			tx,
		);
		const action = await repo.createCompletedPilotAction(
			{
				missionId: mission.id,
				repositoryId: mission.repositoryId,
				targetType: "mission",
				targetId: mission.id,
				type: "start_autopilot",
				idempotencyKey: input.request.idempotencyKey,
				requestHash,
				reason: "Human-approved Level 1 Autopilotを開始する",
				actor: { type: "human", id: null, displayName: "User" },
				resultRef: { type: "autopilot_grant", id: grant.id },
			},
			tx,
		);
		await repo.appendMissionEvent(
			{
				missionId: mission.id,
				repositoryId: mission.repositoryId,
				eventType: "autopilot_started",
				summary: "Level 1 Autopilotを開始しました。",
				actor: { type: "human", id: null, displayName: "User" },
				payload: { grantId: grant.id, allowedActions: grant.allowedActions },
				sourceKind: "mission_command",
				sourceId: action.id,
			},
			tx,
		);
		return grant;
	});
}

async function changeGrantStatus(input: {
	missionId: string;
	command: "pause" | "resume" | "revoke";
	idempotencyKey: string;
}) {
	const type = `${input.command}_autopilot`;
	const requestHash = hash(input);
	const replay = await replayGrantAction({
		missionId: input.missionId,
		type,
		idempotencyKey: input.idempotencyKey,
		requestHash,
	});
	if (replay) return replay;
	const mission = await missionPlannerRepo.getMission(input.missionId);
	const grant = await repo.getLatestAutopilotGrant(input.missionId);
	if (!mission || !grant) throw new NotFoundError("Autopilot grant not found");
	const expected = input.command === "resume" ? "paused" : "active";
	if (grant.status !== expected) {
		throw new AppError(
			409,
			"MISSION_AUTOPILOT_STATE_CONFLICT",
			`Autopilot must be ${expected} before ${input.command}`,
		);
	}
	return db.transaction(async (tx) => {
		const now = new Date();
		const status =
			input.command === "pause"
				? "paused"
				: input.command === "resume"
					? "active"
					: "revoked";
		const updated = await repo.updateAutopilotGrant(
			grant.id,
			{
				status,
				pausedAt: status === "paused" ? now : null,
				revokedAt: status === "revoked" ? now : null,
			},
			tx,
		);
		if (!updated) throw new NotFoundError("Autopilot grant not found");
		if (input.command === "pause") {
			await missionPlannerRepo.updateMission(
				mission.id,
				{ status: "paused", pausedAt: now },
				tx,
			);
		} else if (input.command === "resume") {
			await missionPlannerRepo.updateMission(
				mission.id,
				{ status: "active", pausedAt: null },
				tx,
			);
		}
		const action = await repo.createCompletedPilotAction(
			{
				missionId: mission.id,
				repositoryId: mission.repositoryId,
				targetType: "autopilot_grant",
				targetId: grant.id,
				type,
				idempotencyKey: input.idempotencyKey,
				requestHash,
				reason: `Autopilotを${input.command}する`,
				actor: { type: "human", id: null, displayName: "User" },
				resultRef: { type: "autopilot_grant", id: grant.id },
			},
			tx,
		);
		await repo.appendMissionEvent(
			{
				missionId: mission.id,
				repositoryId: mission.repositoryId,
				eventType: `autopilot_${status}`,
				summary: `Autopilotを${status}にしました。`,
				actor: { type: "human", id: null, displayName: "User" },
				sourceKind: "mission_command",
				sourceId: action.id,
			},
			tx,
		);
		return updated;
	});
}

export const pauseMissionAutopilot = (
	missionId: string,
	idempotencyKey: string,
) => changeGrantStatus({ missionId, command: "pause", idempotencyKey });
export const resumeMissionAutopilot = (
	missionId: string,
	idempotencyKey: string,
) => changeGrantStatus({ missionId, command: "resume", idempotencyKey });
export const revokeMissionAutopilot = (
	missionId: string,
	idempotencyKey: string,
) => changeGrantStatus({ missionId, command: "revoke", idempotencyKey });

function replayTickResult(value: unknown) {
	if (!value || typeof value !== "object" || !("tickResponse" in value))
		return null;
	return value.tickResponse as {
		action:
			| "enqueue_approved_task"
			| "sync_execution"
			| "evaluate_completed_run"
			| "create_replan_suggestion"
			| "no_op"
			| "stopped";
		reason: string;
		resultRef: unknown;
	};
}

async function needsExecutionSync(
	task: Awaited<ReturnType<typeof repo.listMissionTasks>>[number],
) {
	if (!task.queueEntryId) return false;
	const queueEntry = await db.query.implementationQueueEntries.findFirst({
		where: eq(implementationQueueEntries.id, task.queueEntryId),
	});
	if (!queueEntry) return false;
	const lastSyncedAt = task.lastSyncedAt
		? new Date(task.lastSyncedAt).getTime()
		: 0;
	if (
		queueEntry.updatedAt.getTime() > lastSyncedAt ||
		queueEntry.activeRunId !== task.activeRunId
	)
		return true;
	if (!queueEntry.activeRunId) return false;
	const run = await db.query.taskRuns.findFirst({
		where: eq(taskRuns.id, queueEntry.activeRunId),
	});
	return Boolean(
		run &&
			Math.max(run.endedAt?.getTime() ?? 0, run.finishedAt?.getTime() ?? 0) >
				lastSyncedAt,
	);
}

export async function tickMissionAutopilot(input: {
	missionId: string;
	idempotencyKey: string;
}) {
	const requestHash = hash(input);
	const replay = await repo.getPilotActionByKey({
		missionId: input.missionId,
		type: "autopilot_tick",
		idempotencyKey: input.idempotencyKey,
	});
	if (replay) {
		if (replay.requestHash !== requestHash)
			throw new AppError(
				409,
				"MISSION_COMMAND_IDEMPOTENCY_CONFLICT",
				"Idempotency key conflict",
			);
		const result = replayTickResult(replay.resultRef);
		if (result) return result;
	}
	const mission = await missionPlannerRepo.getMission(input.missionId);
	const grant = await repo.getLatestAutopilotGrant(input.missionId);
	if (!mission) throw new NotFoundError("Mission not found");
	let response: {
		action:
			| "enqueue_approved_task"
			| "sync_execution"
			| "evaluate_completed_run"
			| "create_replan_suggestion"
			| "no_op"
			| "stopped";
		reason: string;
		resultRef: unknown;
	};
	if (
		["completed", "cancelled", "abandoned", "paused"].includes(mission.status)
	) {
		response = {
			action: "stopped",
			reason: `Mission is ${mission.status}`,
			resultRef: null,
		};
	} else if (!grant || grant.status !== "active") {
		response = {
			action: "stopped",
			reason: "Active Autopilot grant is missing",
			resultRef: null,
		};
	} else if (
		grant.expiresAt &&
		new Date(grant.expiresAt).getTime() <= Date.now()
	) {
		await repo.updateAutopilotGrant(grant.id, { status: "expired" });
		response = {
			action: "stopped",
			reason: "Autopilot grant expired",
			resultRef: { grantId: grant.id },
		};
	} else {
		const openAttention = (await repo.listAttentionItems(mission.id)).filter(
			(item) => item.status === "open",
		);
		if (openAttention.length > 0) {
			response = {
				action: "stopped",
				reason: "Human attention is required",
				resultRef: { attentionItemId: openAttention[0].id },
			};
		} else {
			const missionTasks = await repo.listMissionTasks(mission.id);
			const task = missionTasks.find((item) => item.status === "task_created");
			if (task && grant.allowedActions.includes("enqueue_approved_task")) {
				const result = await enqueueMissionTask({
					missionId: mission.id,
					missionTaskId: task.id,
					request: {
						idempotencyKey: `${input.idempotencyKey}:enqueue`,
						autopilotGrantId: grant.id,
					},
				});
				response = {
					action: "enqueue_approved_task",
					reason: "Queued one approved MissionTask",
					resultRef: {
						missionTaskId: result.missionTask.id,
						queueEntryId: result.queueEntry.id,
					},
				};
			} else {
				const syncTarget = grant.allowedActions.includes("sync_execution")
					? await (async () => {
							for (const item of missionTasks.filter((candidate) =>
								["queued", "running"].includes(candidate.status),
							)) {
								if (await needsExecutionSync(item)) return item;
							}
							return null;
						})()
					: null;
				if (syncTarget) {
					const result = await syncMissionExecution({
						missionId: mission.id,
						missionTaskId: syncTarget.id,
						idempotencyKey: `${input.idempotencyKey}:sync`,
					});
					response = {
						action: "sync_execution",
						reason: "Synchronized one MissionTask from execution evidence",
						resultRef: {
							missionTaskId: syncTarget.id,
							eventsAdded: result.eventsAdded,
						},
					};
				} else {
					const evaluationTarget = missionTasks.find((item) =>
						["awaiting_evaluation", "failed", "blocked"].includes(item.status),
					);
					if (
						evaluationTarget &&
						grant.allowedActions.includes("evaluate_completed_run")
					) {
						const result = await evaluateMission({
							missionId: mission.id,
							missionTaskId: evaluationTarget.id,
							idempotencyKey: `${input.idempotencyKey}:evaluate`,
						});
						response = {
							action: "evaluate_completed_run",
							reason: "Evaluated one MissionTask from normalized evidence",
							resultRef: {
								missionTaskId: evaluationTarget.id,
								evaluationId: result.evaluations[0]?.id ?? null,
							},
						};
					} else {
						const latestEvaluation = await repo.getLatestMissionEvaluation(
							mission.id,
						);
						const existingSuggestion = latestEvaluation
							? (await repo.listReplanSuggestions(mission.id)).find(
									(item) =>
										item.sourceEvaluationId === latestEvaluation.id &&
										item.status !== "cancelled",
								)
							: null;
						if (
							latestEvaluation &&
							["failed", "blocked"].includes(latestEvaluation.result) &&
							!existingSuggestion &&
							grant.allowedActions.includes("create_replan_suggestion")
						) {
							const result = await createMissionReplanSuggestion({
								missionId: mission.id,
								evaluationId: latestEvaluation.id,
								idempotencyKey: `${input.idempotencyKey}:replan`,
							});
							response = {
								action: "create_replan_suggestion",
								reason: "Created one typed replan suggestion",
								resultRef: { suggestionId: result.suggestion.id },
							};
						} else {
							response = {
								action: "no_op",
								reason: "No allowed deterministic action is ready",
								resultRef: null,
							};
						}
					}
				}
			}
		}
	}
	await repo.createCompletedPilotAction({
		missionId: mission.id,
		repositoryId: mission.repositoryId,
		targetType: "mission",
		targetId: mission.id,
		type: "autopilot_tick",
		idempotencyKey: input.idempotencyKey,
		requestHash,
		reason: response.reason,
		actor: {
			type: "autopilot",
			id: grant?.id ?? null,
			displayName: "Mission Pilot Level 1",
		},
		resultRef: { tickResponse: response },
	});
	return response;
}
