import crypto from "node:crypto";
import type { MissionPilotActionFailure } from "@nightworkers/mission-pilot/contracts";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../../../db/client";
import { readTaskOperatorCommandReceipt } from "../../../commandDelivery";
import { missionPilotActionExecutions } from "../index";

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
	const argumentsDigest = digestArguments({
		arguments: input.arguments,
		expectedTaskRevision: input.expectedTaskRevision,
	});
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

export async function getLatestSucceededMissionPilotImplementationRunId(
	sessionId: string,
) {
	const [row] = await db
		.select({
			sourceResourceId: missionPilotActionExecutions.sourceResourceId,
		})
		.from(missionPilotActionExecutions)
		.where(
			and(
				eq(missionPilotActionExecutions.sessionId, sessionId),
				eq(missionPilotActionExecutions.actionId, "run.implementation.start"),
				eq(missionPilotActionExecutions.status, "succeeded"),
			),
		)
		.orderBy(desc(missionPilotActionExecutions.updatedAt))
		.limit(1);
	return row?.sourceResourceId ?? null;
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

async function resetMissionPilotActionExecutionPending(id: string) {
	const [row] = await db
		.update(missionPilotActionExecutions)
		.set({
			status: "pending",
			resultJson: null,
			failureJson: null,
			startedAt: null,
			finishedAt: null,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotActionExecutions.id, id),
				inArray(missionPilotActionExecutions.status, [
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
		const delivery = await readTaskOperatorCommandReceipt({
			actorKind: "delegated_user",
			actorId: receipt.sessionId,
			idempotencyKey: receipt.idempotencyKey,
		});
		if (
			delivery &&
			delivery.taskId === receipt.taskId &&
			delivery.actionId === receipt.actionId &&
			delivery.status === "succeeded"
		) {
			const result = normalizeTaskOperatorDeliveryResult(delivery);
			await completeMissionPilotActionExecution({
				id: receipt.id,
				result,
				sourceResourceType: resourceTypeForAction(receipt.actionId),
				sourceResourceId: resultResourceId(result),
			});
			continue;
		}
		if (
			delivery &&
			delivery.taskId === receipt.taskId &&
			delivery.actionId === receipt.actionId &&
			delivery.status === "failed"
		) {
			await completeMissionPilotActionExecution({
				id: receipt.id,
				status: "failed",
				failure: failureFromTaskOperatorReceipt(receipt, delivery.failure),
			});
			continue;
		}
		if (!delivery || delivery.status === "pending") {
			await resetMissionPilotActionExecutionPending(receipt.id);
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

function resourceTypeForAction(actionId: string) {
	if (actionId.startsWith("run.")) return "task_run";
	if (actionId.startsWith("task.queue.")) return "implementation_queue_entry";
	if (actionId === "task.message.send") return "task_message";
	if (actionId.startsWith("questionnaire.")) return "questionnaire";
	if (actionId.startsWith("plan.artifact.")) return "artifact";
	if (actionId.startsWith("git.")) return "git_operation";
	if (actionId.startsWith("task.")) return "task";
	return "task_operator_resource";
}

function resultResourceId(value: unknown) {
	const result = readRecord(value);
	const operationRef = readRecord(readRecord(result.receipt).operationRef);
	const operationId = readText(operationRef.id);
	if (operationId) return operationId;
	const data = readRecord(result.data);
	for (const key of ["runId", "id", "taskId"]) {
		const id = readText(data[key]) ?? readText(result[key]);
		if (id) return id;
	}
	return null;
}

function normalizeTaskOperatorDeliveryResult(
	receipt: NonNullable<
		Awaited<ReturnType<typeof readTaskOperatorCommandReceipt>>
	>,
) {
	const stored = readRecord(receipt.result);
	const storedReceipt = readRecord(stored.receipt);
	if (
		typeof storedReceipt.commandId === "string" &&
		typeof storedReceipt.actionId === "string" &&
		"data" in stored
	)
		return {
			...stored,
			receipt: { ...storedReceipt, replayed: true },
		};
	const id = resultResourceId(receipt.result);
	const resourceRef = id
		? {
				kind: resourceKindForAction(receipt.actionId),
				id,
				revision: revisionFromResult(receipt.result),
			}
		: null;
	return {
		receipt: {
			commandId: receipt.id,
			idempotencyKey: receipt.idempotencyKey,
			actionId: receipt.actionId,
			operationRef: resourceRef,
			resourceRefs: resourceRef ? [resourceRef] : [],
			replayed: true,
		},
		data: receipt.result,
	};
}

function resourceKindForAction(actionId: string) {
	if (actionId.startsWith("run.")) return "run";
	if (actionId.startsWith("task.queue.")) return "queue";
	if (actionId === "task.message.send") return "task_message";
	if (actionId.startsWith("questionnaire.")) return "questionnaire";
	if (actionId.startsWith("plan.artifact.")) return "artifact";
	if (actionId.startsWith("git.")) return "git_operation";
	return "task";
}

function revisionFromResult(value: unknown) {
	const revision = readRecord(value).revision;
	return typeof revision === "number" && revision >= 0
		? Math.trunc(revision)
		: 0;
}

function failureFromTaskOperatorReceipt(
	receipt: typeof missionPilotActionExecutions.$inferSelect,
	value: unknown,
): MissionPilotActionFailure {
	const failure = readRecord(value);
	const code = readText(failure.code);
	const taskOperatorKind = readText(failure.kind);
	const kind =
		taskOperatorKind === "revision_conflict"
			? "revision_conflict"
			: taskOperatorKind === "permission_denied"
				? "permission"
				: taskOperatorKind === "schema_validation"
					? "schema_validation"
					: taskOperatorKind === "internal"
						? "outcome_unknown"
						: "domain_precondition";
	return {
		kind,
		retryable: false,
		providerCode: code,
		httpStatus:
			typeof failure.statusCode === "number" ? failure.statusCode : null,
		message:
			readText(failure.message) ?? "Task Operator command delivery failed.",
		retryAfterMs: null,
		attempt: 1,
		actionId: receipt.actionId,
		idempotencyKey: receipt.idempotencyKey,
		currentTaskRevision:
			typeof failure.currentRevision === "number"
				? failure.currentRevision
				: null,
		details:
			failure.details &&
			typeof failure.details === "object" &&
			!Array.isArray(failure.details)
				? readRecord(failure.details)
				: null,
	};
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
