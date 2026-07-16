import { AppError } from "../../lib/errors";
import { isAutoQueueDrainEnabled } from "../../services/runtime-env";
import {
	assertTaskDraftComplete,
	hasImplementationPlanEvidence,
} from "../nightworkers/nightworkers.planning-helpers.service";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import type * as repo from "./queue.repository";
import { triggerConfiguredQueueDrain } from "./queue-scheduler-port";

export type QueueSideEffectOptions = {
	autoDrain?: boolean;
	approveMissionProposal?: boolean;
	missionPilotAgent?: import("../../../shared/schemas/mission-pilot-agent.schema").MissionPilotAgentRunProvenance;
};

export type QueueRecoveryAction =
	| "retry"
	| "mark_needs_human"
	| "cancel"
	| "archive"
	| "complete";
const _DEFAULT_STALE_PROCESSING_MS = 30 * 60 * 1000;
const _DEFAULT_MAX_QUEUE_ATTEMPTS = 3;

type TaskMessageRows = Awaited<
	ReturnType<typeof nightworkersRepo.listTaskMessages>
>;

function toRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function normalizeExecutionType(value: unknown): repo.TaskExecutionType | null {
	return value === "normal" || value === "exclusive" || value === "sequence"
		? value
		: null;
}

function latestMissionProposalMetadata(messages: TaskMessageRows) {
	for (const message of [...messages].reverse()) {
		const metadata = toRecord(message.metadataJson);
		const missionProposal = toRecord(metadata?.missionProposal);
		if (missionProposal?.source === "mission_task_proposal")
			return missionProposal;
	}
	return null;
}

function hasExplicitMissionProposalApproval(
	messages: TaskMessageRows,
	proposalId: unknown,
) {
	if (typeof proposalId !== "string" || !proposalId) return false;
	return messages.some((message) => {
		const metadata = toRecord(message.metadataJson);
		const approval = toRecord(metadata?.missionProposalApproval);
		return (
			metadata?.source === "mission_proposal_approval" &&
			approval?.proposalId === proposalId &&
			approval?.approved === true
		);
	});
}

export function assertMissionProposalQueueApproval(messages: TaskMessageRows) {
	const missionProposal = latestMissionProposalMetadata(messages);
	if (missionProposal?.approvalRequired !== true) return;
	if (hasExplicitMissionProposalApproval(messages, missionProposal.proposalId))
		return;
	throw new AppError(
		409,
		"MISSION_PROPOSAL_APPROVAL_REQUIRED",
		"Mission proposal requires explicit approval before entering the Implementation Queue.",
		{
			proposalId: missionProposal.proposalId,
			missionId: missionProposal.missionId,
			planningResultId: missionProposal.planningResultId,
		},
	);
}

export async function ensureMissionProposalQueueApproval(
	taskId: string,
	messages: TaskMessageRows,
	options: QueueSideEffectOptions,
) {
	const missionProposal = latestMissionProposalMetadata(messages);
	if (
		!options.approveMissionProposal ||
		!missionProposal ||
		missionProposal.approvalRequired !== true ||
		hasExplicitMissionProposalApproval(messages, missionProposal.proposalId)
	) {
		return messages;
	}
	await nightworkersRepo.createTaskMessage({
		taskId,
		role: "system",
		content:
			"Mission proposal explicitly approved for Implementation Queue admission.",
		messageType: "text",
		payloadJson: {
			source: "mission_proposal_approval",
			missionProposalApproval: {
				proposalId: missionProposal.proposalId,
				approved: true,
				approvedAt: new Date().toISOString(),
			},
		},
	});
	return nightworkersRepo.listTaskMessages(taskId);
}

export function resolveSchedulingDecisionFromMessages(
	messages: TaskMessageRows,
): {
	executionType: repo.TaskExecutionType;
	sequenceGroupId: string | null;
	sequenceOrder: number | null;
	schedulingReason: string | null;
} {
	for (const message of [...messages].reverse()) {
		const metadata = toRecord(message.metadataJson);
		const missionProposal = toRecord(metadata?.missionProposal);
		const missionScheduling = toRecord(missionProposal?.scheduling);
		const missionExecutionType = normalizeExecutionType(
			missionScheduling?.executionType,
		);
		if (
			missionProposal?.source === "mission_task_proposal" &&
			missionExecutionType
		) {
			const sequenceGroupId =
				missionExecutionType === "sequence" &&
				typeof missionScheduling?.sequenceGroupId === "string"
					? missionScheduling.sequenceGroupId
					: null;
			const sequenceOrder =
				missionExecutionType === "sequence" &&
				typeof missionScheduling?.sequenceOrder === "number"
					? missionScheduling.sequenceOrder
					: null;
			const schedulingReason =
				typeof missionScheduling?.reason === "string"
					? missionScheduling.reason
					: "Mission proposal scheduling";
			if (
				missionExecutionType === "sequence" &&
				(!sequenceGroupId || sequenceOrder === null)
			) {
				return {
					executionType: "exclusive",
					sequenceGroupId: null,
					sequenceOrder: null,
					schedulingReason: `${schedulingReason}; sequence metadata missing, using exclusive scheduling`,
				};
			}
			return {
				executionType: missionExecutionType,
				sequenceGroupId,
				sequenceOrder,
				schedulingReason,
			};
		}

		const selection =
			toRecord(metadata?.intakeJobSelection) ??
			toRecord(metadata?.jobSelection);
		const scheduling = toRecord(selection?.scheduling);
		const executionType = normalizeExecutionType(scheduling?.executionType);
		if (executionType) {
			const sequenceGroupId =
				executionType === "sequence" &&
				typeof scheduling?.sequenceGroupId === "string"
					? scheduling.sequenceGroupId
					: null;
			const sequenceOrder =
				executionType === "sequence" &&
				typeof scheduling?.sequenceOrder === "number"
					? scheduling.sequenceOrder
					: null;
			const schedulingReason =
				typeof scheduling?.reason === "string"
					? scheduling.reason
					: "Supervisor scheduling";
			if (
				executionType === "sequence" &&
				(!sequenceGroupId || sequenceOrder === null)
			) {
				return {
					executionType: "exclusive",
					sequenceGroupId: null,
					sequenceOrder: null,
					schedulingReason: `${schedulingReason}; sequence metadata missing, using exclusive scheduling`,
				};
			}
			return {
				executionType,
				sequenceGroupId,
				sequenceOrder,
				schedulingReason,
			};
		}

		const routing =
			toRecord(metadata?.routingHypothesis) ?? toRecord(metadata?.routing);
		const overlays = Array.isArray(routing?.overlays) ? routing.overlays : [];
		const workKinds = Array.isArray(routing?.workKinds)
			? routing.workKinds
			: [];
		const jobType =
			typeof selection?.jobType === "string" ? selection.jobType : null;
		if (
			jobType === "data_migration" ||
			overlays.includes("destructive_operation") ||
			workKinds.includes("data_migration")
		) {
			return {
				executionType: "exclusive",
				sequenceGroupId: null,
				sequenceOrder: null,
				schedulingReason:
					"Conservative fallback from structured routing metadata",
			};
		}
	}
	return {
		executionType: "normal",
		sequenceGroupId: null,
		sequenceOrder: null,
		schedulingReason: "Default normal scheduling",
	};
}

export function prepareImplementationQueueAdmission(input: {
	task: NonNullable<Awaited<ReturnType<typeof nightworkersRepo.getTask>>>;
	messages: TaskMessageRows;
	approveMissionProposal?: boolean;
}) {
	if (
		["completed", "cancelled", "failed", "timed_out"].includes(
			input.task.status,
		)
	) {
		throw new AppError(
			409,
			"TASK_TERMINAL",
			"Terminal sessions cannot enter the Implementation Queue.",
		);
	}
	assertTaskDraftComplete(input.task, input.messages);
	if (
		!hasImplementationPlanEvidence(input.messages) &&
		!["ready", "queued"].includes(input.task.status)
	) {
		throw new AppError(
			422,
			"IMPLEMENTATION_PLAN_REQUIRED",
			"Create or mark an implementation plan before adding this session to the Queue.",
		);
	}
	const missionProposal = latestMissionProposalMetadata(input.messages);
	const proposalId =
		typeof missionProposal?.proposalId === "string"
			? missionProposal.proposalId.trim()
			: "";
	const needsApproval =
		missionProposal?.approvalRequired === true &&
		!hasExplicitMissionProposalApproval(input.messages, proposalId);
	if (missionProposal?.approvalRequired === true && !proposalId) {
		throw new AppError(
			422,
			"MISSION_PROPOSAL_APPROVAL_REQUIRED",
			"Mission proposal approval requires a valid proposal id.",
		);
	}
	if (needsApproval && !input.approveMissionProposal) {
		assertMissionProposalQueueApproval(input.messages);
	}
	const approvalMessage = needsApproval
		? {
				content:
					"Mission proposal explicitly approved for Implementation Queue admission.",
				payloadJson: {
					source: "mission_proposal_approval",
					missionProposalApproval: {
						proposalId,
						approved: true,
					},
				},
			}
		: null;
	return {
		scheduling: resolveSchedulingDecisionFromMessages(input.messages),
		approvalMessage,
	};
}

export function shouldAutoDrain(options: QueueSideEffectOptions = {}) {
	return options.autoDrain ?? isAutoQueueDrainEnabled();
}

export function runImplementationQueueWhenEnabled(
	options: QueueSideEffectOptions = {},
) {
	if (!shouldAutoDrain(options)) return;
	triggerConfiguredQueueDrain();
}
