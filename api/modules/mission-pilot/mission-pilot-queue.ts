import { createHash } from "node:crypto";
import { db } from "../../db/client";
import { taskMessages, tasks } from "../../db/schema";
import { AppError, NotFoundError } from "../../lib/errors";
import { isAutoQueueDrainEnabled } from "../../services/runtime-env";
import * as missionPlannerRepo from "../mission-planner/mission-planner.repository";
import {
	buildAcceptanceCriteria,
	buildTaskDescription,
	buildTaskObjective,
	metadataForProposal,
	workPackageForProposal,
} from "../mission-planner/mission-planner.service";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import * as queueRepo from "../queue/queue.repository";
import * as queueService from "../queue/queue-management.service";
import { triggerConfiguredQueueDrain } from "../queue/queue-scheduler-port";
import * as repo from "./mission-pilot.repository";
import {
	buildMissionTaskCandidateSnapshot,
	canonicalizeMissionSnapshot,
} from "./mission-pilot-approval";

function hashRequest(value: unknown) {
	return createHash("sha256")
		.update(canonicalizeMissionSnapshot(value), "utf8")
		.digest("hex");
}

function resultId(resultRef: unknown) {
	if (!resultRef || typeof resultRef !== "object" || !("id" in resultRef))
		return null;
	return typeof resultRef.id === "string" ? resultRef.id : null;
}

export async function materializeMissionTask(input: {
	missionId: string;
	taskCandidateId: string;
	request: {
		approvalId: string;
		mode: "draft" | "ready";
		idempotencyKey: string;
	};
}) {
	const requestHash = hashRequest({
		taskCandidateId: input.taskCandidateId,
		...input.request,
	});
	const replay = await repo.getPilotActionByKey({
		missionId: input.missionId,
		type: "materialize_mission_task",
		idempotencyKey: input.request.idempotencyKey,
	});
	if (replay) {
		if (replay.requestHash !== requestHash)
			throw new AppError(
				409,
				"MISSION_COMMAND_IDEMPOTENCY_CONFLICT",
				"Idempotency key conflict",
			);
		const id = resultId(replay.resultRef);
		const missionTask = id ? await repo.getMissionTask(id) : null;
		const task = missionTask?.nightworkersTaskId
			? await nightworkersRepo.getTask(missionTask.nightworkersTaskId)
			: null;
		if (missionTask && task) return { missionTask, task };
	}
	const mission = await missionPlannerRepo.getMission(input.missionId);
	const proposal = await missionPlannerRepo.getTaskProposal(
		input.taskCandidateId,
	);
	const approval = await repo.getApproval(input.request.approvalId);
	if (!mission || !proposal || !approval)
		throw new NotFoundError("Mission execution source not found");
	if (
		proposal.missionId !== mission.id ||
		proposal.planningResultId !== mission.latestPlanningResultId ||
		proposal.status !== "proposed" ||
		approval.missionId !== mission.id ||
		approval.targetId !== proposal.id ||
		approval.approvalType !== "queue_admission" ||
		approval.status !== "approved"
	) {
		throw new AppError(
			409,
			"MISSION_APPROVAL_REQUIRED",
			"A current approved queue admission is required",
		);
	}
	const snapshot = buildMissionTaskCandidateSnapshot(proposal);
	if (snapshot.hash !== approval.snapshotHash)
		throw new AppError(
			409,
			"MISSION_APPROVAL_STALE",
			"TaskCandidate changed after approval",
		);
	const existing = await repo.findMissionTaskByCandidate(proposal.id);
	if (existing?.nightworkersTaskId) {
		const task = await nightworkersRepo.getTask(existing.nightworkersTaskId);
		if (task) return { missionTask: existing, task };
	}
	const planningResult = await missionPlannerRepo.getPlanningResult(
		proposal.planningResultId,
	);
	if (!planningResult)
		throw new NotFoundError("Mission planning result not found");
	const workPackage = workPackageForProposal(planningResult, proposal);
	const objectives = await repo.listObjectives(mission.id, planningResult.id);
	const related = new Set(workPackage?.relatedObjectiveIds ?? []);
	const objectiveIds = objectives
		.filter((objective) => related.has(objective.externalObjectiveId))
		.map((objective) => objective.id);

	return db.transaction(async (tx) => {
		const missionTask = await repo.createMissionTask(
			{
				missionId: mission.id,
				repositoryId: mission.repositoryId,
				planningResultId: planningResult.id,
				taskCandidateId: proposal.id,
				objectiveIdsJson: objectiveIds,
				approvalId: approval.id,
				approvalSnapshotHash: approval.snapshotHash,
				title: proposal.title,
				purpose: workPackage?.purpose ?? proposal.summary,
				status: "task_created",
				riskLevel: proposal.risk,
				approvalRequired: proposal.approvalRequired,
				dependenciesJson: proposal.dependencies,
				verificationGateJson: proposal.verificationGate,
				schedulingJson: proposal.scheduling,
			},
			tx,
		);
		const [task] = await tx
			.insert(tasks)
			.values({
				repositoryId: proposal.repositoryId,
				title: proposal.title,
				description: buildTaskDescription({
					mission,
					proposal,
					planningResult,
				}),
				objective: buildTaskObjective({ proposal, planningResult }),
				acceptanceCriteria: buildAcceptanceCriteria(proposal),
				status: input.request.mode,
				priority: 1,
				createdBy: "mission-pilot",
			})
			.returning();
		await tx.insert(taskMessages).values({
			taskId: task.id,
			role: "system",
			content: "Mission Pilot metadata attached.",
			messageType: "text",
			metadataJson: {
				source: "mission_pilot",
				missionProposal: metadataForProposal(proposal),
				missionPilot: {
					source: "mission_pilot",
					missionId: mission.id,
					planningResultId: planningResult.id,
					taskCandidateId: proposal.id,
					missionTaskId: missionTask.id,
					approvalId: approval.id,
					approvalSnapshotHash: approval.snapshotHash,
					risk: proposal.risk,
					approvalRequired: proposal.approvalRequired,
					scheduling: proposal.scheduling,
				},
			},
		});
		const updatedMissionTask = await repo.updateMissionTask(
			missionTask.id,
			{ nightworkersTaskId: task.id },
			tx,
		);
		await missionPlannerRepo.updateTaskProposal(
			proposal.id,
			{ status: "task_created", taskId: task.id },
			tx,
		);
		await missionPlannerRepo.updateMission(
			mission.id,
			{ status: "active", statusReason: null },
			tx,
		);
		const action = await repo.createCompletedPilotAction(
			{
				missionId: mission.id,
				repositoryId: mission.repositoryId,
				targetType: "mission_task",
				targetId: missionTask.id,
				type: "materialize_mission_task",
				idempotencyKey: input.request.idempotencyKey,
				requestHash,
				reason: "Approved TaskCandidateをNightWorkers Taskへ変換する",
				actor: { type: "human", id: null, displayName: "User" },
				resultRef: { type: "mission_task", id: missionTask.id },
			},
			tx,
		);
		await repo.appendMissionEvent(
			{
				missionId: mission.id,
				repositoryId: mission.repositoryId,
				missionTaskId: missionTask.id,
				eventType: "mission_task_materialized",
				summary: `TaskCandidate「${proposal.title}」をTask化しました。`,
				actor: { type: "human", id: null, displayName: "User" },
				sourceKind: "mission_command",
				sourceId: action.id,
			},
			tx,
		);
		if (!updatedMissionTask) throw new Error("MissionTask update failed");
		return { missionTask: updatedMissionTask, task };
	});
}

export async function enqueueMissionTask(input: {
	missionId: string;
	missionTaskId: string;
	request: { idempotencyKey: string; autopilotGrantId?: string };
}) {
	const requestHash = hashRequest(input.request);
	const replay = await repo.getPilotActionByKey({
		missionId: input.missionId,
		type: "enqueue_mission_task",
		idempotencyKey: input.request.idempotencyKey,
	});
	if (replay) {
		if (replay.requestHash !== requestHash)
			throw new AppError(
				409,
				"MISSION_COMMAND_IDEMPOTENCY_CONFLICT",
				"Idempotency key conflict",
			);
		const missionTask = await repo.getMissionTask(input.missionTaskId);
		const queueEntry = missionTask?.queueEntryId
			? await queueRepo.getImplementationQueueEntry(missionTask.queueEntryId)
			: null;
		if (missionTask && queueEntry) return { missionTask, queueEntry };
	}
	const mission = await missionPlannerRepo.getMission(input.missionId);
	const missionTask = await repo.getMissionTask(input.missionTaskId);
	if (
		!mission ||
		!missionTask ||
		missionTask.missionId !== mission.id ||
		!missionTask.nightworkersTaskId
	)
		throw new NotFoundError("MissionTask not found");
	if (
		["paused", "abandoned", "completed", "cancelled"].includes(mission.status)
	)
		throw new AppError(
			409,
			"MISSION_NOT_EXECUTABLE",
			"Mission is not executable",
		);
	if (input.request.autopilotGrantId) {
		const grant = await repo.getAutopilotGrant(input.request.autopilotGrantId);
		if (
			!grant ||
			grant.missionId !== mission.id ||
			grant.status !== "active" ||
			!grant.allowedActions.includes("enqueue_approved_task") ||
			(grant.expiresAt && new Date(grant.expiresAt).getTime() <= Date.now())
		) {
			throw new AppError(
				409,
				"MISSION_AUTOPILOT_GRANT_INVALID",
				"An active Level 1 grant allowing enqueue is required",
			);
		}
	}
	const queueEntry = await queueService.createImplementationQueueEntry(
		missionTask.nightworkersTaskId,
		{ autoDrain: false },
	);
	let updated: Awaited<ReturnType<typeof repo.updateMissionTask>>;
	try {
		updated = await db.transaction(async (tx) => {
			const next = await repo.updateMissionTask(
				missionTask.id,
				{ status: "queued", queueEntryId: queueEntry.id },
				tx,
			);
			const action = await repo.createCompletedPilotAction(
				{
					missionId: mission.id,
					repositoryId: mission.repositoryId,
					targetType: "mission_task",
					targetId: missionTask.id,
					type: "enqueue_mission_task",
					idempotencyKey: input.request.idempotencyKey,
					requestHash,
					reason: "Approved MissionTaskをImplementation Queueへ投入する",
					actor: { type: "human", id: null, displayName: "User" },
					resultRef: { type: "queue_entry", id: queueEntry.id },
				},
				tx,
			);
			await repo.appendMissionEvent(
				{
					missionId: mission.id,
					repositoryId: mission.repositoryId,
					missionTaskId: missionTask.id,
					eventType: "mission_task_queued",
					summary: `MissionTask「${missionTask.title}」をQueueへ投入しました。`,
					actor: { type: "human", id: null, displayName: "User" },
					sourceKind: "mission_command",
					sourceId: action.id,
				},
				tx,
			);
			return next;
		});
	} catch (cause) {
		await queueService.patchImplementationQueueEntry(
			queueEntry.id,
			{ action: "cancel" },
			{ autoDrain: false },
		);
		await queueService.archiveImplementationQueueEntry(queueEntry.id, {
			autoDrain: false,
		});
		throw cause;
	}
	if (!updated) throw new Error("MissionTask queue linkage failed");
	if (isAutoQueueDrainEnabled()) triggerConfiguredQueueDrain();
	return { missionTask: updated, queueEntry };
}
