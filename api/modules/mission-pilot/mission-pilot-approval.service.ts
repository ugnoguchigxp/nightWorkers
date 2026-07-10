import { createHash } from "node:crypto";
import type {
	DecideMissionApproval,
	MissionApproval,
	RequestMissionApproval,
} from "../../../shared/schemas/mission-pilot.schema";
import { db } from "../../db/client";
import { AppError, NotFoundError } from "../../lib/errors";
import * as missionPlannerRepo from "../mission-planner/mission-planner.repository";
import * as repo from "./mission-pilot.repository";
import {
	buildMissionTaskCandidateSnapshot,
	canonicalizeMissionSnapshot,
} from "./mission-pilot-approval";
import { buildReplanApprovalSnapshot } from "./mission-pilot-replan";

function hashRequest(value: unknown) {
	return createHash("sha256")
		.update(canonicalizeMissionSnapshot(value), "utf8")
		.digest("hex");
}

function resultApprovalId(resultRef: unknown) {
	if (!resultRef || typeof resultRef !== "object" || !("id" in resultRef))
		return null;
	return typeof resultRef.id === "string" ? resultRef.id : null;
}

async function replayAction(input: {
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
			"Idempotency key was already used with a different request",
		);
	}
	const approvalId = resultApprovalId(action.resultRef);
	return approvalId ? repo.getApproval(approvalId) : null;
}

function autopilotSnapshot(input: {
	missionId: string;
	autonomyLevel: 1;
	allowedActions: string[];
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

async function requestAutopilotApproval(input: {
	mission: NonNullable<
		Awaited<ReturnType<typeof missionPlannerRepo.getMission>>
	>;
	request: RequestMissionApproval;
}) {
	const config = input.request.autopilotConfig;
	if (!config || input.request.targetId !== input.mission.id) {
		throw new AppError(
			422,
			"MISSION_APPROVAL_TARGET_MISMATCH",
			"Autopilot approval must target its Mission with a Level 1 configuration",
		);
	}
	const snapshot = autopilotSnapshot({
		missionId: input.mission.id,
		...config,
	});
	const snapshotHash = hashRequest(snapshot);
	const requestDigest = hashRequest(input.request);
	const replay = await replayAction({
		missionId: input.mission.id,
		type: "request_autopilot_start_approval",
		idempotencyKey: input.request.idempotencyKey,
		requestHash: requestDigest,
	});
	if (replay) return { approval: replay, created: false };
	const existing = await repo.findOpenApproval({
		missionId: input.mission.id,
		targetType: "mission",
		targetId: input.mission.id,
		approvalType: "autopilot_start",
		snapshotHash,
	});
	if (existing) return { approval: existing, created: false };
	try {
		const approval = await db.transaction(async (tx) => {
			const created = await repo.createApproval(
				{
					missionId: input.mission.id,
					repositoryId: input.mission.repositoryId,
					targetType: "mission",
					targetId: input.mission.id,
					approvalType: "autopilot_start",
					riskLevel: "low",
					approvalRequired: true,
					requestedReason: input.request.reason,
					requestedByActor: {
						type: "human",
						id: null,
						displayName: "User",
					},
					snapshot,
					snapshotHash,
				},
				tx,
			);
			await repo.createAttention(
				{
					missionId: input.mission.id,
					repositoryId: input.mission.repositoryId,
					targetType: "mission",
					targetId: input.mission.id,
					type: "approval_required",
					severity: "blocking",
					title: `${input.mission.title} Autopilot`,
					summary: input.request.reason,
					actionSchema: { actions: ["approve", "reject"] },
					sourceRef: { type: "mission_approval", id: created.id },
				},
				tx,
			);
			const action = await repo.createCompletedPilotAction(
				{
					missionId: input.mission.id,
					repositoryId: input.mission.repositoryId,
					targetType: "mission",
					targetId: input.mission.id,
					type: "request_autopilot_start_approval",
					idempotencyKey: input.request.idempotencyKey,
					requestHash: requestDigest,
					reason: input.request.reason,
					actor: { type: "human", id: null, displayName: "User" },
					resultRef: { type: "mission_approval", id: created.id },
				},
				tx,
			);
			await repo.appendMissionEvent(
				{
					missionId: input.mission.id,
					repositoryId: input.mission.repositoryId,
					eventType: "autopilot_approval_requested",
					summary: "Level 1 Autopilot開始の承認を依頼しました。",
					actor: { type: "human", id: null, displayName: "User" },
					payload: { approvalId: created.id, snapshotHash },
					sourceKind: "mission_command",
					sourceId: action.id,
				},
				tx,
			);
			return created;
		});
		return { approval, created: true };
	} catch (cause) {
		const concurrent = await repo.findOpenApproval({
			missionId: input.mission.id,
			targetType: "mission",
			targetId: input.mission.id,
			approvalType: "autopilot_start",
			snapshotHash,
		});
		if (concurrent) return { approval: concurrent, created: false };
		throw cause;
	}
}

async function requestReplanApproval(input: {
	mission: NonNullable<
		Awaited<ReturnType<typeof missionPlannerRepo.getMission>>
	>;
	request: RequestMissionApproval;
}) {
	const suggestion = await repo.getReplanSuggestion(input.request.targetId);
	if (
		!suggestion ||
		suggestion.missionId !== input.mission.id ||
		suggestion.status !== "awaiting_approval"
	)
		throw new AppError(
			422,
			"MISSION_APPROVAL_TARGET_MISMATCH",
			"Replan suggestion is not awaiting approval for this Mission",
		);
	const approvalSnapshot = buildReplanApprovalSnapshot(suggestion);
	const requestDigest = hashRequest(input.request);
	const replay = await replayAction({
		missionId: input.mission.id,
		type: "request_replan_approval",
		idempotencyKey: input.request.idempotencyKey,
		requestHash: requestDigest,
	});
	if (replay) return { approval: replay, created: false };
	const existing = await repo.findOpenApproval({
		missionId: input.mission.id,
		targetType: "replan_suggestion",
		targetId: suggestion.id,
		approvalType: "replan",
		snapshotHash: approvalSnapshot.hash,
	});
	if (existing) return { approval: existing, created: false };
	try {
		const approval = await db.transaction(async (tx) => {
			const created = await repo.createApproval(
				{
					missionId: input.mission.id,
					repositoryId: input.mission.repositoryId,
					targetType: "replan_suggestion",
					targetId: suggestion.id,
					approvalType: "replan",
					riskLevel: "medium",
					approvalRequired: true,
					requestedReason: input.request.reason,
					requestedByActor: { type: "human", id: null, displayName: "User" },
					snapshot: approvalSnapshot.snapshot,
					snapshotHash: approvalSnapshot.hash,
				},
				tx,
			);
			await repo.updateReplanSuggestion(
				suggestion.id,
				{ approvalId: created.id },
				tx,
			);
			await repo.createAttention(
				{
					missionId: input.mission.id,
					repositoryId: input.mission.repositoryId,
					targetType: "replan_suggestion",
					targetId: suggestion.id,
					type: "approval_required",
					severity: "blocking",
					title: "再計画差分の承認",
					summary: input.request.reason,
					actionSchema: { actions: ["approve", "reject"] },
					sourceRef: { type: "mission_approval", id: created.id },
				},
				tx,
			);
			await repo.createCompletedPilotAction(
				{
					missionId: input.mission.id,
					repositoryId: input.mission.repositoryId,
					targetType: "replan_suggestion",
					targetId: suggestion.id,
					type: "request_replan_approval",
					idempotencyKey: input.request.idempotencyKey,
					requestHash: requestDigest,
					reason: input.request.reason,
					actor: { type: "human", id: null, displayName: "User" },
					resultRef: { type: "mission_approval", id: created.id },
				},
				tx,
			);
			return created;
		});
		return { approval, created: true };
	} catch (cause) {
		const concurrent = await repo.findOpenApproval({
			missionId: input.mission.id,
			targetType: "replan_suggestion",
			targetId: suggestion.id,
			approvalType: "replan",
			snapshotHash: approvalSnapshot.hash,
		});
		if (concurrent) return { approval: concurrent, created: false };
		throw cause;
	}
}

export async function requestMissionApproval(input: {
	missionId: string;
	request: RequestMissionApproval;
}): Promise<{ approval: MissionApproval; created: boolean }> {
	const mission = await missionPlannerRepo.getMission(input.missionId);
	if (!mission) throw new NotFoundError("Mission not found");
	if (
		input.request.targetType === "mission" &&
		input.request.approvalType === "autopilot_start"
	) {
		return requestAutopilotApproval({ mission, request: input.request });
	}
	if (
		input.request.targetType === "replan_suggestion" &&
		input.request.approvalType === "replan"
	) {
		return requestReplanApproval({ mission, request: input.request });
	}
	if (
		input.request.targetType !== "task_candidate" ||
		input.request.approvalType !== "queue_admission"
	) {
		throw new AppError(
			422,
			"MISSION_APPROVAL_TARGET_MISMATCH",
			"This approval target is not available in the current MVP phase",
		);
	}
	const proposal = await missionPlannerRepo.getTaskProposal(
		input.request.targetId,
	);
	if (
		!proposal ||
		proposal.missionId !== mission.id ||
		proposal.planningResultId !== mission.latestPlanningResultId ||
		proposal.status !== "proposed"
	) {
		throw new AppError(
			422,
			"MISSION_APPROVAL_TARGET_MISMATCH",
			"TaskCandidate is not a current proposed candidate for this Mission",
		);
	}
	const requestDigest = hashRequest(input.request);
	const replay = await replayAction({
		missionId: mission.id,
		type: "request_task_candidate_approval",
		idempotencyKey: input.request.idempotencyKey,
		requestHash: requestDigest,
	});
	if (replay) return { approval: replay, created: false };
	const candidateSnapshot = buildMissionTaskCandidateSnapshot(proposal);
	const existing = await repo.findOpenApproval({
		missionId: mission.id,
		targetType: "task_candidate",
		targetId: proposal.id,
		approvalType: "queue_admission",
		snapshotHash: candidateSnapshot.hash,
	});
	if (existing) return { approval: existing, created: false };

	let approval: MissionApproval;
	try {
		approval = await db.transaction(async (tx) => {
			const created = await repo.createApproval(
				{
					missionId: mission.id,
					repositoryId: mission.repositoryId,
					targetType: "task_candidate",
					targetId: proposal.id,
					approvalType: "queue_admission",
					riskLevel: proposal.risk,
					approvalRequired: proposal.approvalRequired,
					requestedReason: input.request.reason,
					requestedByActor: { type: "human", id: null, displayName: "User" },
					snapshot: candidateSnapshot.snapshot,
					snapshotHash: candidateSnapshot.hash,
				},
				tx,
			);
			await repo.createAttention(
				{
					missionId: mission.id,
					repositoryId: mission.repositoryId,
					targetType: "task_candidate",
					targetId: proposal.id,
					type: "approval_required",
					severity: "blocking",
					title: proposal.title,
					summary: input.request.reason,
					actionSchema: { actions: ["approve", "reject"] },
					sourceRef: { type: "mission_approval", id: created.id },
				},
				tx,
			);
			const action = await repo.createCompletedPilotAction(
				{
					missionId: mission.id,
					repositoryId: mission.repositoryId,
					targetType: "task_candidate",
					targetId: proposal.id,
					type: "request_task_candidate_approval",
					idempotencyKey: input.request.idempotencyKey,
					requestHash: requestDigest,
					reason: input.request.reason,
					actor: { type: "human", id: null, displayName: "User" },
					resultRef: { type: "mission_approval", id: created.id },
				},
				tx,
			);
			await repo.appendMissionEvent(
				{
					missionId: mission.id,
					repositoryId: mission.repositoryId,
					eventType: "approval_requested",
					summary: `TaskCandidate「${proposal.title}」の承認を依頼しました。`,
					actor: { type: "human", id: null, displayName: "User" },
					payload: {
						approvalId: created.id,
						snapshotHash: created.snapshotHash,
					},
					sourceKind: "mission_command",
					sourceId: action.id,
				},
				tx,
			);
			return created;
		});
	} catch (cause) {
		const concurrent = await repo.findOpenApproval({
			missionId: mission.id,
			targetType: "task_candidate",
			targetId: proposal.id,
			approvalType: "queue_admission",
			snapshotHash: candidateSnapshot.hash,
		});
		if (concurrent) return { approval: concurrent, created: false };
		throw cause;
	}
	return { approval, created: true };
}

async function decideAutopilotApproval(input: {
	missionId: string;
	decision: "approve" | "reject";
	request: DecideMissionApproval;
	approval: MissionApproval;
}) {
	if (
		input.approval.missionId !== input.missionId ||
		input.approval.targetId !== input.missionId
	) {
		throw new AppError(
			422,
			"MISSION_APPROVAL_TARGET_MISMATCH",
			"Autopilot approval does not belong to this Mission",
		);
	}
	const type = `${input.decision}_autopilot_start_approval`;
	const requestDigest = hashRequest({
		approvalId: input.approval.id,
		decision: input.decision,
		...input.request,
	});
	const replay = await replayAction({
		missionId: input.missionId,
		type,
		idempotencyKey: input.request.idempotencyKey,
		requestHash: requestDigest,
	});
	if (replay) return replay;
	if (input.approval.status !== "requested") {
		throw new AppError(
			409,
			"MISSION_APPROVAL_ALREADY_DECIDED",
			"Approval was already decided",
		);
	}
	const actor = { type: "human" as const, id: null, displayName: "User" };
	return db.transaction(async (tx) => {
		const status = input.decision === "approve" ? "approved" : "rejected";
		const updated = await repo.decideApproval(
			{
				approvalId: input.approval.id,
				status,
				actor,
				reason: input.request.reason,
			},
			tx,
		);
		if (!updated) {
			throw new AppError(
				409,
				"MISSION_APPROVAL_ALREADY_DECIDED",
				"Approval was already decided",
			);
		}
		await repo.resolveAttentionForTarget(
			{
				missionId: input.missionId,
				type: "approval_required",
				targetType: "mission",
				targetId: input.missionId,
				actor,
			},
			tx,
		);
		const action = await repo.createCompletedPilotAction(
			{
				missionId: input.missionId,
				repositoryId: input.approval.repositoryId,
				targetType: "mission",
				targetId: input.missionId,
				type,
				idempotencyKey: input.request.idempotencyKey,
				requestHash: requestDigest,
				reason: input.request.reason,
				actor,
				resultRef: { type: "mission_approval", id: updated.id },
			},
			tx,
		);
		await repo.appendMissionEvent(
			{
				missionId: input.missionId,
				repositoryId: input.approval.repositoryId,
				eventType: `autopilot_approval_${status}`,
				summary: `Level 1 Autopilot開始を${status === "approved" ? "承認" : "却下"}しました。`,
				actor,
				sourceKind: "mission_command",
				sourceId: action.id,
			},
			tx,
		);
		return updated;
	});
}

async function decideReplanApproval(input: {
	missionId: string;
	decision: "approve" | "reject";
	request: DecideMissionApproval;
	approval: MissionApproval;
}) {
	const suggestion = await repo.getReplanSuggestion(input.approval.targetId);
	if (!suggestion || suggestion.missionId !== input.missionId)
		throw new AppError(
			422,
			"MISSION_APPROVAL_TARGET_MISMATCH",
			"Replan approval does not belong to this Mission",
		);
	const currentSnapshot = buildReplanApprovalSnapshot(suggestion);
	if (input.approval.snapshotHash !== currentSnapshot.hash) {
		await repo.updateReplanSuggestion(suggestion.id, { status: "stale" });
		throw new AppError(
			409,
			"MISSION_APPROVAL_STALE",
			"Replan approval snapshot is stale",
		);
	}
	if (input.approval.status !== "requested")
		throw new AppError(
			409,
			"MISSION_APPROVAL_ALREADY_DECIDED",
			"Approval was already decided",
		);
	const type = `${input.decision}_replan_approval`;
	const requestDigest = hashRequest({
		approvalId: input.approval.id,
		decision: input.decision,
		...input.request,
	});
	const replay = await replayAction({
		missionId: input.missionId,
		type,
		idempotencyKey: input.request.idempotencyKey,
		requestHash: requestDigest,
	});
	if (replay) return replay;
	const actor = { type: "human" as const, id: null, displayName: "User" };
	return db.transaction(async (tx) => {
		const status = input.decision === "approve" ? "approved" : "rejected";
		const updated = await repo.decideApproval(
			{
				approvalId: input.approval.id,
				status,
				actor,
				reason: input.request.reason,
			},
			tx,
		);
		if (!updated)
			throw new AppError(
				409,
				"MISSION_APPROVAL_ALREADY_DECIDED",
				"Approval was already decided",
			);
		await repo.updateReplanSuggestion(
			suggestion.id,
			{ status, approvalId: updated.id },
			tx,
		);
		await repo.resolveAttentionForTarget(
			{
				missionId: input.missionId,
				type: "approval_required",
				targetType: "replan_suggestion",
				targetId: suggestion.id,
				actor,
			},
			tx,
		);
		await repo.createCompletedPilotAction(
			{
				missionId: input.missionId,
				repositoryId: suggestion.repositoryId,
				targetType: "replan_suggestion",
				targetId: suggestion.id,
				type,
				idempotencyKey: input.request.idempotencyKey,
				requestHash: requestDigest,
				reason: input.request.reason,
				actor,
				resultRef: { type: "mission_approval", id: updated.id },
			},
			tx,
		);
		return updated;
	});
}

export async function decideMissionApproval(input: {
	missionId: string;
	approvalId: string;
	decision: "approve" | "reject";
	request: DecideMissionApproval;
}) {
	const preliminary = await repo.getApproval(input.approvalId);
	if (!preliminary) throw new NotFoundError("Mission approval not found");
	if (
		preliminary.targetType === "mission" &&
		preliminary.approvalType === "autopilot_start"
	) {
		return decideAutopilotApproval({ ...input, approval: preliminary });
	}
	if (
		preliminary.targetType === "replan_suggestion" &&
		preliminary.approvalType === "replan"
	) {
		return decideReplanApproval({ ...input, approval: preliminary });
	}
	const type = `${input.decision}_task_candidate_approval`;
	const requestDigest = hashRequest({
		approvalId: input.approvalId,
		decision: input.decision,
		...input.request,
	});
	const replay = await replayAction({
		missionId: input.missionId,
		type,
		idempotencyKey: input.request.idempotencyKey,
		requestHash: requestDigest,
	});
	if (replay) return replay;
	const approval = await repo.getApproval(input.approvalId);
	if (!approval) throw new NotFoundError("Mission approval not found");
	if (
		approval.missionId !== input.missionId ||
		approval.targetType !== "task_candidate" ||
		approval.approvalType !== "queue_admission"
	) {
		throw new AppError(
			422,
			"MISSION_APPROVAL_TARGET_MISMATCH",
			"Approval does not belong to this Mission or target type",
		);
	}
	if (approval.status !== "requested") {
		throw new AppError(
			409,
			"MISSION_APPROVAL_ALREADY_DECIDED",
			"Approval was already decided",
		);
	}
	const proposal = await missionPlannerRepo.getTaskProposal(approval.targetId);
	if (!proposal || proposal.missionId !== input.missionId) {
		throw new AppError(
			422,
			"MISSION_APPROVAL_TARGET_MISMATCH",
			"Current TaskCandidate does not match the approval",
		);
	}
	const currentSnapshot = buildMissionTaskCandidateSnapshot(proposal);
	const stale = currentSnapshot.hash !== approval.snapshotHash;
	const actor = { type: "human" as const, id: null, displayName: "User" };
	const decided = await db.transaction(async (tx) => {
		const status = stale
			? "stale"
			: input.decision === "approve"
				? "approved"
				: "rejected";
		const updated = await repo.decideApproval(
			{
				approvalId: approval.id,
				status,
				actor,
				reason: stale
					? "TaskCandidate snapshot changed before decision"
					: input.request.reason,
			},
			tx,
		);
		if (!updated) {
			throw new AppError(
				409,
				"MISSION_APPROVAL_ALREADY_DECIDED",
				"Approval was already decided",
			);
		}
		await repo.resolveAttentionForTarget(
			{
				missionId: input.missionId,
				type: "approval_required",
				targetType: "task_candidate",
				targetId: approval.targetId,
				actor,
			},
			tx,
		);
		const action = await repo.createCompletedPilotAction(
			{
				missionId: input.missionId,
				repositoryId: approval.repositoryId,
				targetType: "task_candidate",
				targetId: approval.targetId,
				type,
				idempotencyKey: input.request.idempotencyKey,
				requestHash: requestDigest,
				reason: input.request.reason,
				actor,
				resultRef: { type: "mission_approval", id: updated.id },
			},
			tx,
		);
		await repo.appendMissionEvent(
			{
				missionId: input.missionId,
				repositoryId: approval.repositoryId,
				eventType: stale ? "approval_stale" : `approval_${status}`,
				summary: stale
					? "TaskCandidateの変更により承認がstaleになりました。"
					: `TaskCandidateの承認を${status === "approved" ? "承認" : "却下"}しました。`,
				actor,
				payload: {
					approvalId: updated.id,
					currentSnapshotHash: currentSnapshot.hash,
				},
				sourceKind: "mission_command",
				sourceId: action.id,
			},
			tx,
		);
		return updated;
	});
	if (stale) {
		throw new AppError(
			409,
			"MISSION_APPROVAL_STALE",
			"TaskCandidate changed after approval was requested",
			{ approvalId: decided.id },
		);
	}
	return decided;
}
