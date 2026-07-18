import crypto from "node:crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { MissionPilotActionFailure } from "../../../../shared/modules/missionPilot";
import { db } from "../../../db/client";
import {
	designQuestionnaireReviews,
	designQuestionnaireSessions,
} from "../../../db/design-questionnaire-schema";
import {
	missionPilotActionExecutions,
	missionPilotToolCalls,
} from "../../../db/mission-pilot-agent-schema";
import { missionPilotQuestionnaireDrafts } from "../../../db/mission-pilot-schema";
import {
	implementationQueueEntries,
	taskEvents,
	taskMessages,
	taskRunCommitRecords,
	taskRuns,
	tasks,
} from "../../../db/schema";

export class MissionPilotActionExecutionConflictError extends Error {
	readonly code = "MISSION_PILOT_ACTION_IDEMPOTENCY_CONFLICT";

	constructor(
		message = "Mission Pilot action idempotency key was reused with different arguments.",
	) {
		super(message);
		this.name = "MissionPilotActionExecutionConflictError";
	}
}

export async function createMissionPilotActionExecutionIntent(input: {
	sessionId: string;
	taskId: string;
	toolCallId: string;
	actionId: string;
	idempotencyKey: string;
	arguments: unknown;
	expectedTaskRevision: number | null;
}) {
	const argumentsDigest = digestArguments(input.arguments);
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(missionPilotActionExecutions)
			.where(
				and(
					eq(missionPilotActionExecutions.sessionId, input.sessionId),
					eq(missionPilotActionExecutions.idempotencyKey, input.idempotencyKey),
				),
			)
			.limit(1);
		if (existing) {
			if (
				existing.argumentsDigest !== argumentsDigest ||
				existing.actionId !== input.actionId ||
				existing.toolCallId !== input.toolCallId
			)
				throw new MissionPilotActionExecutionConflictError();
			return existing;
		}
		const [equivalent] = await tx
			.select()
			.from(missionPilotActionExecutions)
			.where(
				and(
					eq(missionPilotActionExecutions.sessionId, input.sessionId),
					eq(missionPilotActionExecutions.actionId, input.actionId),
					eq(missionPilotActionExecutions.argumentsDigest, argumentsDigest),
					inArray(missionPilotActionExecutions.status, [
						"executing",
						"outcome_unknown",
						"succeeded",
					]),
				),
			)
			.limit(1);
		if (equivalent) return equivalent;
		const now = new Date();
		const [created] = await tx
			.insert(missionPilotActionExecutions)
			.values({
				id: crypto.randomUUID(),
				sessionId: input.sessionId,
				taskId: input.taskId,
				toolCallId: input.toolCallId,
				actionId: input.actionId,
				idempotencyKey: input.idempotencyKey,
				argumentsDigest,
				expectedTaskRevision: input.expectedTaskRevision,
				status: "pending",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	});
}

export async function getMissionPilotActionExecutionByToolCall(
	sessionId: string,
	toolCallId: string,
) {
	const [row] = await db
		.select()
		.from(missionPilotActionExecutions)
		.where(
			and(
				eq(missionPilotActionExecutions.sessionId, sessionId),
				eq(missionPilotActionExecutions.toolCallId, toolCallId),
			),
		)
		.limit(1);
	return row ?? null;
}

export async function claimMissionPilotActionExecution(id: string) {
	const now = new Date();
	const [row] = await db
		.update(missionPilotActionExecutions)
		.set({ status: "executing", startedAt: now, updatedAt: now })
		.where(
			and(
				eq(missionPilotActionExecutions.id, id),
				eq(missionPilotActionExecutions.status, "pending"),
			),
		)
		.returning();
	return row ?? null;
}

export async function completeMissionPilotActionExecution(input: {
	id: string;
	result?: unknown;
	failure?: MissionPilotActionFailure;
	status?: "succeeded" | "failed" | "outcome_unknown";
	sourceResourceType?: string | null;
	sourceResourceId?: string | null;
}) {
	const status = input.status ?? (input.failure ? "failed" : "succeeded");
	const now = new Date();
	const [row] = await db
		.update(missionPilotActionExecutions)
		.set({
			status,
			resultJson: input.failure ? null : (input.result ?? null),
			failureJson: input.failure ?? null,
			sourceResourceType: input.sourceResourceType ?? null,
			sourceResourceId: input.sourceResourceId ?? null,
			finishedAt: now,
			updatedAt: now,
		})
		.where(
			and(
				eq(missionPilotActionExecutions.id, input.id),
				inArray(missionPilotActionExecutions.status, [
					"pending",
					"executing",
					"outcome_unknown",
				]),
			),
		)
		.returning();
	return row ?? null;
}

export async function listMissionPilotActionExecutionReceipts(
	sessionId: string,
) {
	return db
		.select()
		.from(missionPilotActionExecutions)
		.where(eq(missionPilotActionExecutions.sessionId, sessionId));
}

export async function reconcileMissionPilotActionExecutionReceipts(
	sessionId: string,
) {
	const receipts = await db
		.select()
		.from(missionPilotActionExecutions)
		.where(
			and(
				eq(missionPilotActionExecutions.sessionId, sessionId),
				inArray(missionPilotActionExecutions.status, [
					"executing",
					"outcome_unknown",
				]),
			),
		);
	for (const receipt of receipts) {
		const resource = await reconcileMissionPilotActionResource(receipt);
		if (resource) {
			await completeMissionPilotActionExecution({
				id: receipt.id,
				result: resource.result,
				sourceResourceType: resource.type,
				sourceResourceId: resource.id,
			});
			continue;
		}
		if (receipt.status === "outcome_unknown") continue;
		await completeMissionPilotActionExecution({
			id: receipt.id,
			status: "outcome_unknown",
			failure: outcomeUnknownFailure(receipt.actionId, receipt.idempotencyKey),
		});
	}
	return listMissionPilotActionExecutionReceipts(sessionId);
}

async function reconcileMissionPilotActionResource(
	receipt: typeof missionPilotActionExecutions.$inferSelect,
) {
	const [toolCall] = await db
		.select({ argumentsJson: missionPilotToolCalls.argumentsJson })
		.from(missionPilotToolCalls)
		.where(eq(missionPilotToolCalls.id, receipt.toolCallId))
		.limit(1);
	const args = readRecord(toolCall?.argumentsJson);
	if (receipt.actionId === "run.implementation.start") {
		const runs = await db
			.select({
				id: taskRuns.id,
				status: taskRuns.status,
				contextSnapshot: taskRuns.contextSnapshot,
			})
			.from(taskRuns)
			.where(eq(taskRuns.taskId, receipt.taskId));
		let run = runs.find((candidate) => {
			const provenance = readRecord(
				candidate.contextSnapshot,
			).missionPilotAgent;
			return (
				readText(readRecord(provenance).sessionId) === receipt.sessionId &&
				readText(readRecord(provenance).idempotencyKey) ===
					receipt.idempotencyKey
			);
		});
		if (!run && runs.length > 0) {
			const events = await db
				.select({
					runId: taskEvents.taskRunId,
					payloadJson: taskEvents.payloadJson,
				})
				.from(taskEvents)
				.where(
					inArray(
						taskEvents.taskRunId,
						runs.map((candidate) => candidate.id),
					),
				);
			const associatedRunId = events.find((event) => {
				const payload = readRecord(event.payloadJson);
				const runEvent = readRecord(payload.runEvent);
				const data = readRecord(runEvent.data);
				const provenance = readRecord(data.requestProvenance);
				const requestedBy = readRecord(provenance.requestedBy);
				const orchestrationRef = readRecord(provenance.orchestrationRef);
				return (
					data.action === "coding_agent.requested" &&
					requestedBy.actorId === receipt.sessionId &&
					orchestrationRef.id === receipt.idempotencyKey
				);
			})?.runId;
			run = runs.find((candidate) => candidate.id === associatedRunId);
		}
		if (run) return resource("task_run", run.id, run);
	}
	if (receipt.actionId === "task.queue.enqueue") {
		const entries = await db
			.select()
			.from(implementationQueueEntries)
			.where(eq(implementationQueueEntries.taskId, receipt.taskId));
		const entry = entries.find(
			(candidate) =>
				readText(readRecord(candidate.missionPilotAgentJson).idempotencyKey) ===
				receipt.idempotencyKey,
		);
		if (entry) return resource("implementation_queue_entry", entry.id, entry);
	}
	if (receipt.actionId === "task.message.send") {
		const messages = await db
			.select()
			.from(taskMessages)
			.where(eq(taskMessages.taskId, receipt.taskId));
		const message = messages.find(
			(candidate) =>
				readText(
					readRecord(readRecord(candidate.metadataJson).missionPilotAction)
						.idempotencyKey,
				) === receipt.idempotencyKey,
		);
		if (message) return resource("task_message", message.id, message);
	}
	if (receipt.actionId === "questionnaire.create") {
		const [questionnaire] = await db
			.select()
			.from(designQuestionnaireSessions)
			.where(
				and(
					eq(designQuestionnaireSessions.taskId, receipt.taskId),
					eq(
						designQuestionnaireSessions.missionPilotActionKey,
						receipt.idempotencyKey,
					),
				),
			)
			.limit(1);
		if (questionnaire)
			return resource("questionnaire_session", questionnaire.id, questionnaire);
	}
	if (
		["questionnaire.draft.update", "questionnaire.draft.save"].includes(
			receipt.actionId,
		)
	) {
		const [draft] = await db
			.select()
			.from(missionPilotQuestionnaireDrafts)
			.where(
				and(
					eq(missionPilotQuestionnaireDrafts.sessionId, receipt.sessionId),
					eq(
						missionPilotQuestionnaireDrafts.lastActionIdempotencyKey,
						receipt.idempotencyKey,
					),
				),
			)
			.limit(1);
		if (draft) return resource("questionnaire_draft", draft.id, draft);
	}
	if (
		[
			"questionnaire.review.accept",
			"questionnaire.review.leave_unadopted",
		].includes(receipt.actionId)
	) {
		const questionnaireSessionId = readText(args.questionnaireSessionId);
		const actionStartedAt = receipt.startedAt ?? receipt.createdAt;
		const [questionnaire] = questionnaireSessionId
			? await db
					.select()
					.from(designQuestionnaireSessions)
					.where(
						and(
							eq(designQuestionnaireSessions.id, questionnaireSessionId),
							eq(designQuestionnaireSessions.taskId, receipt.taskId),
							gte(designQuestionnaireSessions.updatedAt, actionStartedAt),
						),
					)
					.limit(1)
			: [];
		const expectedReviewStatus =
			receipt.actionId === "questionnaire.review.accept"
				? "accepted"
				: "left_unadopted";
		const expectedSessionStatus =
			receipt.actionId === "questionnaire.review.accept"
				? "accepted"
				: "needs_edit";
		const [review] = questionnaire
			? await db
					.select()
					.from(designQuestionnaireReviews)
					.where(
						and(
							eq(designQuestionnaireReviews.sessionId, questionnaire.id),
							eq(designQuestionnaireReviews.status, expectedReviewStatus),
							gte(designQuestionnaireReviews.updatedAt, actionStartedAt),
						),
					)
					.orderBy(desc(designQuestionnaireReviews.updatedAt))
					.limit(1)
			: [];
		const [publishedMessage] =
			receipt.actionId === "questionnaire.review.accept" &&
			review?.publishedMessageId
				? await db
						.select()
						.from(taskMessages)
						.where(
							and(
								eq(taskMessages.id, review.publishedMessageId),
								eq(taskMessages.taskId, receipt.taskId),
							),
						)
						.limit(1)
				: [];
		const publishedAction = readRecord(
			readRecord(publishedMessage?.metadataJson).missionPilotAction,
		);
		const actionMatches =
			receipt.actionId === "questionnaire.review.accept"
				? readText(publishedAction.idempotencyKey) === receipt.idempotencyKey &&
					readText(publishedAction.toolCallId) === receipt.toolCallId
				: Boolean(review);
		if (
			questionnaire?.status === expectedSessionStatus &&
			review &&
			actionMatches
		)
			return resource("questionnaire_session", questionnaire.id, questionnaire);
	}
	if (
		[
			"task.complete",
			"task.archive",
			"task.archive.restore",
			"task.update",
		].includes(receipt.actionId)
	) {
		const [task] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, receipt.taskId))
			.limit(1);
		if (!task) return null;
		if (receipt.actionId === "task.complete" && task.status === "completed")
			return resource("task", task.id, task);
		if (receipt.actionId === "task.archive" && task.status === "archived")
			return resource("task", task.id, task);
		if (
			receipt.actionId === "task.archive.restore" &&
			task.status !== "archived"
		)
			return resource("task", task.id, task);
		if (
			receipt.actionId === "task.update" &&
			recordContains(task, readRecord(args.fields))
		)
			return resource("task", task.id, task);
	}
	if (["git.commit", "git.push"].includes(receipt.actionId)) {
		const runId = readText(args.sourceRunId);
		if (!runId) return null;
		const [record] = await db
			.select()
			.from(taskRunCommitRecords)
			.where(eq(taskRunCommitRecords.runId, runId))
			.limit(1);
		if (
			record &&
			((receipt.actionId === "git.commit" && record.status === "committed") ||
				(receipt.actionId === "git.push" && record.pushStatus === "pushed"))
		)
			return resource("task_run_commit_record", record.id, record);
	}
	if (receipt.actionId === "run.stop") {
		const runId = readText(args.runId);
		const [run] = runId
			? await db.select().from(taskRuns).where(eq(taskRuns.id, runId)).limit(1)
			: [];
		if (
			run &&
			!["running", "context_compiling", "finalizing"].includes(run.status)
		)
			return resource("task_run", run.id, run);
	}
	return null;
}

function resource(type: string, id: string, result: unknown) {
	return { type, id, result };
}

function recordContains(
	actual: Record<string, unknown>,
	expected: Record<string, unknown>,
) {
	return Object.entries(expected).every(
		([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value),
	);
}

export function digestArguments(value: unknown) {
	return crypto
		.createHash("sha256")
		.update(JSON.stringify(canonicalize(value)))
		.digest("hex");
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => [key, canonicalize(child)]),
	);
}

function outcomeUnknownFailure(
	actionId: string,
	idempotencyKey: string,
): MissionPilotActionFailure {
	return {
		kind: "outcome_unknown",
		retryable: false,
		providerCode: null,
		httpStatus: null,
		message:
			"Mutation outcome is unknown; read the current resource before retrying.",
		retryAfterMs: null,
		attempt: 1,
		actionId,
		idempotencyKey,
		currentTaskRevision: null,
		details: null,
	};
}

function readRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function readText(value: unknown) {
	return typeof value === "string" ? value : null;
}
