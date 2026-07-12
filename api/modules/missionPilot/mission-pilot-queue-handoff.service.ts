import { and, desc, eq } from "drizzle-orm";
import { repositoryMaterializationIntentSchema } from "../../../shared/schemas/git-integration.schema";
import {
	type MissionPilotPreQueueDiagnosticCode,
	missionPilotQueueHandoffSchema,
} from "../../../shared/schemas/mission-pilot.schema";
import { db } from "../../db/client";
import {
	missionPilotContextSnapshots,
	missionPilotPlanReviews,
	missionPilotSessions,
} from "../../db/mission-pilot-schema";
import {
	implementationQueueEntries,
	taskMessages,
	taskRuns,
	tasks,
} from "../../db/schema";
import { verificationDocuments } from "../../db/verification-schema";
import {
	ensureTaskGitWorkspace,
	provisionTaskGitWorkspace,
} from "../gitworktree/task-git-workspace.service";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import * as queueRepo from "../queue/queue.repository";
import { prepareImplementationQueueAdmission } from "../queue/queue-management.service";
import * as missionPilotRepo from "./mission-pilot.repository";
import { publishMissionPilotUpdated } from "./mission-pilot-realtime";

const TERMINAL_TASK_STATUSES = new Set([
	"completed",
	"cancelled",
	"failed",
	"timed_out",
	"archived",
]);

export class MissionPilotPreQueueError extends Error {
	constructor(
		readonly code: MissionPilotPreQueueDiagnosticCode,
		message: string,
	) {
		super(message);
	}
}

function record(value: unknown) {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function hasQueueMessage(
	messages: Array<typeof taskMessages.$inferSelect>,
	admissionKey: string,
) {
	return messages.some((message) => {
		const metadata = record(message.metadataJson);
		return (
			metadata?.source === "implementation_queue" &&
			metadata.missionPilotAdmissionKey === admissionKey
		);
	});
}

function hasApprovalMessage(
	messages: Array<typeof taskMessages.$inferSelect>,
	proposalId: string,
) {
	return messages.some((message) => {
		const metadata = record(message.metadataJson);
		const approval = record(metadata?.missionProposalApproval);
		return (
			metadata?.source === "mission_proposal_approval" &&
			approval?.proposalId === proposalId &&
			approval.approved === true
		);
	});
}

export function buildMissionPilotAdmissionKey(input: {
	sessionId: string;
	reviewedContextDigest: string;
	planReviewId: string;
}) {
	return `mission-pilot:${input.sessionId}:${input.reviewedContextDigest}:${input.planReviewId}`;
}

export async function admitMissionPilotQueueHandoff(input: {
	taskId: string;
	sessionId: string;
	planReviewId: string;
	featurePlanMessageId: string;
	verificationDocumentId: string;
	leaseOwner: string;
}) {
	const committedHandoff = await db.transaction(async (tx) => {
		const [session, task, review, verificationDocument, featurePlanMessage] =
			await Promise.all([
				tx.query.missionPilotSessions.findFirst({
					where: eq(missionPilotSessions.id, input.sessionId),
				}),
				tx.query.tasks.findFirst({ where: eq(tasks.id, input.taskId) }),
				tx.query.missionPilotPlanReviews.findFirst({
					where: eq(missionPilotPlanReviews.id, input.planReviewId),
				}),
				tx
					.select()
					.from(verificationDocuments)
					.where(eq(verificationDocuments.id, input.verificationDocumentId))
					.limit(1)
					.then((rows) => rows[0] ?? null),
				tx.query.taskMessages.findFirst({
					where: eq(taskMessages.id, input.featurePlanMessageId),
				}),
			]);
		if (!session || session.taskId !== input.taskId || !task) {
			throw new MissionPilotPreQueueError(
				"MISSION_PILOT_QUEUE_HANDOFF_EVIDENCE_MISSING",
				"Mission Pilot Session or Task is missing",
			);
		}
		if (TERMINAL_TASK_STATUSES.has(task.status)) {
			throw new MissionPilotPreQueueError(
				"MISSION_PILOT_PRE_QUEUE_TASK_TERMINAL",
				`Terminal Task cannot enter the Queue: ${task.status}`,
			);
		}
		const runs = await tx
			.select({ id: taskRuns.id })
			.from(taskRuns)
			.where(eq(taskRuns.taskId, input.taskId));
		if (runs.length > 0) {
			throw new MissionPilotPreQueueError(
				"MISSION_PILOT_PRE_QUEUE_UNEXPECTED_RUN",
				"Pre-Queue Mission Pilot Task already has a TaskRun",
			);
		}
		const [context] = await tx
			.select()
			.from(missionPilotContextSnapshots)
			.where(eq(missionPilotContextSnapshots.sessionId, session.id))
			.orderBy(desc(missionPilotContextSnapshots.revision))
			.limit(1);
		if (
			!context ||
			!review ||
			review.sessionId !== session.id ||
			review.verdict !== "pass" ||
			review.contextRevision !== session.contextRevision ||
			review.contextDigest !== session.contextDigest ||
			context.revision !== session.contextRevision ||
			context.digest !== session.contextDigest
		) {
			throw new MissionPilotPreQueueError(
				"MISSION_PILOT_QUEUE_HANDOFF_STALE_CONTEXT",
				"Latest Context does not match the passing plan review",
			);
		}
		if (
			!featurePlanMessage ||
			featurePlanMessage.taskId !== task.id ||
			review.featurePlanMessageId !== featurePlanMessage.id ||
			!verificationDocument ||
			verificationDocument.taskId !== task.id ||
			verificationDocument.status !== "active" ||
			verificationDocument.specMessageId !== featurePlanMessage.id
		) {
			throw new MissionPilotPreQueueError(
				"MISSION_PILOT_QUEUE_HANDOFF_EVIDENCE_MISSING",
				"Feature Plan or Verification Document evidence is missing",
			);
		}
		if (
			session.desiredState !== "playing" ||
			!missionPilotRepo.hasValidAuthorization(session)
		) {
			throw new MissionPilotPreQueueError(
				"MISSION_PILOT_QUEUE_HANDOFF_EVIDENCE_MISSING",
				"Mission Pilot Queue authorization is invalid",
			);
		}
		const admissionKey = buildMissionPilotAdmissionKey({
			sessionId: session.id,
			reviewedContextDigest: review.contextDigest,
			planReviewId: review.id,
		});
		if (session.phase === "queued" || session.queueHandoffJson) {
			const handoff = missionPilotQueueHandoffSchema.safeParse(
				session.queueHandoffJson,
			);
			if (handoff.success && handoff.data.admissionKey === admissionKey) {
				const persisted =
					await queueRepo.getImplementationQueueEntryByMissionPilotAdmissionKey(
						admissionKey,
						tx,
					);
				if (
					persisted?.id === handoff.data.queueEntryId &&
					persisted.taskId === task.id &&
					persisted.status === "queued" &&
					persisted.claimReady === false &&
					task.status === "queued" &&
					handoff.data.queueClaimReady === false &&
					handoff.data.planReviewId === input.planReviewId &&
					handoff.data.featurePlanMessageId === input.featurePlanMessageId &&
					handoff.data.verificationDocumentId ===
						input.verificationDocumentId &&
					handoff.data.reviewedContextRevision === session.contextRevision &&
					handoff.data.reviewedContextDigest === session.contextDigest &&
					!persisted.activeRunId
				) {
					return handoff.data;
				}
			}
			throw new MissionPilotPreQueueError(
				"MISSION_PILOT_QUEUE_HANDOFF_DUPLICATE",
				"Queued Session has conflicting handoff evidence",
			);
		}
		const activeEntries =
			await queueRepo.listActiveImplementationQueueEntriesForTask(task.id, tx);
		if (
			activeEntries.length > 1 ||
			activeEntries.some(
				(entry) => entry.missionPilotAdmissionKey !== admissionKey,
			)
		) {
			throw new MissionPilotPreQueueError(
				"MISSION_PILOT_QUEUE_HANDOFF_DUPLICATE",
				"Task has conflicting active Implementation Queue entries",
			);
		}
		const messages = await tx
			.select()
			.from(taskMessages)
			.where(eq(taskMessages.taskId, task.id))
			.orderBy(taskMessages.createdAt);
		const policy = prepareImplementationQueueAdmission({
			task,
			messages,
			approveMissionProposal: session.sourceKind === "mission_task_proposal",
		});
		if (policy.approvalMessage) {
			const proposalId = String(
				policy.approvalMessage.payloadJson.missionProposalApproval.proposalId,
			);
			if (!hasApprovalMessage(messages, proposalId)) {
				await nightworkersRepo.createTaskMessage(
					{
						taskId: task.id,
						role: "system",
						content: policy.approvalMessage.content,
						messageType: "text",
						payloadJson: {
							...policy.approvalMessage.payloadJson,
							missionPilotAdmissionKey: admissionKey,
							missionProposalApproval: {
								...policy.approvalMessage.payloadJson.missionProposalApproval,
								approvedAt: new Date().toISOString(),
							},
						},
					},
					tx,
				);
			}
		}
		let entry = activeEntries[0] ?? null;
		if (!entry) {
			entry = await queueRepo.createImplementationQueueEntry(
				{
					taskId: task.id,
					repositoryId: task.repositoryId,
					priority: task.priority,
					executionType: policy.scheduling.executionType,
					executionLockKey: `repository:${task.repositoryId}`,
					sequenceGroupId: policy.scheduling.sequenceGroupId,
					sequenceOrder: policy.scheduling.sequenceOrder,
					schedulingReason: policy.scheduling.schedulingReason,
					missionPilotAdmissionKey: admissionKey,
					claimReady: false,
				},
				tx,
			);
		}
		if (!entry || entry.status !== "queued" || entry.claimReady !== false) {
			throw new MissionPilotPreQueueError(
				"MISSION_PILOT_QUEUE_HANDOFF_DUPLICATE",
				"Mission Pilot Queue entry was claimed before handoff completed",
			);
		}
		await tx
			.update(tasks)
			.set({ status: "queued", updatedAt: new Date() })
			.where(eq(tasks.id, task.id));
		if (!hasQueueMessage(messages, admissionKey)) {
			await nightworkersRepo.createTaskMessage(
				{
					taskId: task.id,
					role: "system",
					content: "Implementation Queue entry created.",
					messageType: "text",
					payloadJson: {
						source: "implementation_queue",
						status: "queued",
						queueEntryId: entry.id,
						missionPilotAdmissionKey: admissionKey,
					},
				},
				tx,
			);
		}
		const queuedAt = new Date().toISOString();
		const handoff = missionPilotQueueHandoffSchema.parse({
			sessionId: session.id,
			taskId: task.id,
			admissionKey,
			queueEntryId: entry.id,
			queueEntryStatus: "queued",
			queueClaimReady: false,
			reviewedContextRevision: review.contextRevision,
			reviewedContextDigest: review.contextDigest,
			featurePlanMessageId: featurePlanMessage.id,
			verificationDocumentId: verificationDocument.id,
			planReviewId: review.id,
			planReviewVerdict: "pass",
			queuedAt,
		});
		const [updated] = await tx
			.update(missionPilotSessions)
			.set({
				phase: "queued",
				queueHandoffJson: handoff,
				preQueueDiagnosticJson: null,
				lastErrorCode: null,
				lastErrorMessage: null,
				version: session.version + 1,
				updatedAt: new Date(queuedAt),
			})
			.where(
				and(
					eq(missionPilotSessions.id, session.id),
					eq(missionPilotSessions.version, session.version),
					eq(missionPilotSessions.phase, session.phase),
					eq(missionPilotSessions.leaseOwner, input.leaseOwner),
				),
			)
			.returning();
		if (!updated) {
			throw new MissionPilotPreQueueError(
				"MISSION_PILOT_QUEUE_HANDOFF_STALE_CONTEXT",
				"Mission Pilot Session changed during Queue admission",
			);
		}
		const [persistedEntry] = await tx
			.select()
			.from(implementationQueueEntries)
			.where(eq(implementationQueueEntries.id, entry.id));
		if (
			!persistedEntry ||
			persistedEntry.status !== "queued" ||
			persistedEntry.claimReady !== false
		) {
			throw new MissionPilotPreQueueError(
				"MISSION_PILOT_QUEUE_HANDOFF_EVIDENCE_MISSING",
				"Persisted Queue entry evidence is missing",
			);
		}
		return handoff;
	});

	const [persistedSession, persistedTask, persistedEntry, persistedRuns] =
		await Promise.all([
			db.query.missionPilotSessions.findFirst({
				where: eq(missionPilotSessions.id, input.sessionId),
			}),
			db.query.tasks.findFirst({ where: eq(tasks.id, input.taskId) }),
			queueRepo.getImplementationQueueEntryByMissionPilotAdmissionKey(
				committedHandoff.admissionKey,
			),
			db
				.select({ id: taskRuns.id })
				.from(taskRuns)
				.where(eq(taskRuns.taskId, input.taskId)),
		]);
	const persistedHandoff = missionPilotQueueHandoffSchema.safeParse(
		persistedSession?.queueHandoffJson,
	);
	if (
		!persistedHandoff.success ||
		persistedSession?.phase !== "queued" ||
		persistedTask?.status !== "queued" ||
		persistedEntry?.id !== committedHandoff.queueEntryId ||
		persistedEntry.status !== "queued" ||
		persistedEntry.claimReady !== false ||
		persistedEntry.activeRunId ||
		persistedRuns.length > 0 ||
		JSON.stringify(persistedHandoff.data) !== JSON.stringify(committedHandoff)
	) {
		throw new MissionPilotPreQueueError(
			"MISSION_PILOT_QUEUE_HANDOFF_EVIDENCE_MISSING",
			"Committed Mission Pilot Queue handoff could not be verified",
		);
	}
	const workspace = await ensureTaskGitWorkspace({
		taskId: input.taskId,
		planReviewId: input.planReviewId,
		admissionKey: committedHandoff.admissionKey,
		materializationIntent: repositoryMaterializationIntentSchema.safeParse(
			record(
				(
					await db
						.select()
						.from(missionPilotContextSnapshots)
						.where(eq(missionPilotContextSnapshots.sessionId, input.sessionId))
						.orderBy(desc(missionPilotContextSnapshots.revision))
						.limit(1)
				)[0]?.contextJson,
			)?.repositoryMaterializationIntent,
		).data,
	});
	const provisionedWorkspace = await provisionTaskGitWorkspace(input.taskId);
	if (
		provisionedWorkspace.status !== "ready" &&
		provisionedWorkspace.status !== "active"
	) {
		throw new MissionPilotPreQueueError(
			"MISSION_PILOT_QUEUE_HANDOFF_EVIDENCE_MISSING",
			"Dedicated Git workspace could not be provisioned",
		);
	}
	await db
		.update(implementationQueueEntries)
		.set({
			workspaceId: workspace.id,
			workspaceRequired: true,
			claimReady: false,
			updatedAt: new Date(),
		})
		.where(eq(implementationQueueEntries.id, committedHandoff.queueEntryId));
	publishMissionPilotUpdated(
		input.taskId,
		missionPilotRepo.toControlSummary(persistedSession),
	);
	return persistedHandoff.data;
}
