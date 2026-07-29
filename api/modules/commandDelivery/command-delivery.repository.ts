import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type {
	TaskOperatorCommandContext,
	TaskOperatorCommandReceipt as TaskOperatorCommandReceiptContract,
	TaskOperatorFailure,
	TaskOperatorResourceRef,
} from "../../../shared/modules/taskOperator";
import { db } from "../../db/client";
import { taskOperatorCommandReceipts } from "../../db/schema";
import { AppError } from "../../lib/errors";

type ReceiptFailure = TaskOperatorFailure & {
	statusCode: number;
	details?: unknown;
};

export type TaskOperatorCommandReceipt = {
	id: string;
	actorKind: string;
	actorId: string;
	taskId: string;
	actionId: string;
	idempotencyKey: string;
	status: string;
	result: unknown;
	failure: unknown;
	updatedAt: Date;
};

export type DeliveredTaskOperatorCommand<T> = {
	receipt: TaskOperatorCommandReceiptContract;
	data: T;
};

export async function readTaskOperatorCommandReceipt(input: {
	actorKind: string;
	actorId: string;
	idempotencyKey: string;
}): Promise<TaskOperatorCommandReceipt | null> {
	const [receipt] = await db
		.select()
		.from(taskOperatorCommandReceipts)
		.where(
			and(
				eq(taskOperatorCommandReceipts.actorKind, input.actorKind),
				eq(taskOperatorCommandReceipts.actorId, input.actorId),
				eq(taskOperatorCommandReceipts.idempotencyKey, input.idempotencyKey),
			),
		)
		.orderBy(desc(taskOperatorCommandReceipts.updatedAt))
		.limit(1);
	return receipt
		? {
				id: receipt.id,
				actorKind: receipt.actorKind,
				actorId: receipt.actorId,
				taskId: receipt.taskId,
				actionId: receipt.actionId,
				idempotencyKey: receipt.idempotencyKey,
				status: receipt.status,
				result: receipt.resultJson,
				failure: receipt.failureJson,
				updatedAt: receipt.updatedAt,
			}
		: null;
}

export async function executeIdempotentTaskOperatorCommand<T>(input: {
	taskId: string;
	actionId: string;
	expectedTaskRevision: number;
	arguments: Record<string, unknown>;
	context: TaskOperatorCommandContext;
	execute: () => Promise<T>;
	describeResult?: (result: T) => {
		operationRef: TaskOperatorResourceRef | null;
		resourceRefs: TaskOperatorResourceRef[];
	};
}): Promise<DeliveredTaskOperatorCommand<T>> {
	const argumentsDigest = digest(
		stableJson({
			taskId: input.taskId,
			actionId: input.actionId,
			expectedTaskRevision: input.expectedTaskRevision,
			arguments: input.arguments,
		}),
	);
	const receipt = await getOrCreateReceipt({ ...input, argumentsDigest });
	assertReceiptMatches(receipt, input, argumentsDigest);
	if (receipt.status === "succeeded") {
		const stored = deliveredRecord<T>(receipt.resultJson);
		if (stored)
			return {
				...stored,
				receipt: { ...stored.receipt, replayed: true },
			};
		return deliveredResult(input, receipt, receipt.resultJson as T, true);
	}
	if (receipt.status === "failed") throw replayFailure(receipt.failureJson);
	if (receipt.status === "executing" || receipt.status === "outcome_unknown")
		throw new AppError(
			409,
			"TASK_OPERATOR_COMMAND_OUTCOME_UNKNOWN",
			"A previous delivery may have completed this command. Re-read the Task Operator view before retrying.",
		);
	const [claimed] = await db
		.update(taskOperatorCommandReceipts)
		.set({ status: "executing", updatedAt: new Date() })
		.where(
			and(
				eq(taskOperatorCommandReceipts.id, receipt.id),
				eq(taskOperatorCommandReceipts.status, "pending"),
			),
		)
		.returning();
	if (!claimed)
		throw new AppError(
			409,
			"TASK_OPERATOR_COMMAND_IN_PROGRESS",
			"The same command delivery is already executing.",
		);
	try {
		const result = await input.execute();
		const delivered = deliveredResult(input, receipt, result, false);
		await db
			.update(taskOperatorCommandReceipts)
			.set({
				status: "succeeded",
				resultJson: delivered,
				updatedAt: new Date(),
			})
			.where(eq(taskOperatorCommandReceipts.id, receipt.id));
		return delivered;
	} catch (error) {
		const known = error instanceof AppError && error.statusCode < 500;
		await db
			.update(taskOperatorCommandReceipts)
			.set({
				status: known ? "failed" : "outcome_unknown",
				failureJson: failure(error),
				updatedAt: new Date(),
			})
			.where(eq(taskOperatorCommandReceipts.id, receipt.id));
		throw error;
	}
}

function deliveredRecord<T>(
	value: unknown,
): DeliveredTaskOperatorCommand<T> | null {
	const entry = record(value);
	const receipt = record(entry.receipt);
	if (
		typeof receipt.commandId !== "string" ||
		typeof receipt.idempotencyKey !== "string" ||
		typeof receipt.actionId !== "string" ||
		typeof receipt.replayed !== "boolean" ||
		!("data" in entry)
	)
		return null;
	return value as DeliveredTaskOperatorCommand<T>;
}

function deliveredResult<T>(
	input: {
		actionId: string;
		context: TaskOperatorCommandContext;
		describeResult?: (result: T) => {
			operationRef: TaskOperatorResourceRef | null;
			resourceRefs: TaskOperatorResourceRef[];
		};
	},
	receipt: typeof taskOperatorCommandReceipts.$inferSelect,
	result: T,
	replayed: boolean,
): DeliveredTaskOperatorCommand<T> {
	const refs = input.describeResult?.(result) ?? {
		operationRef: null,
		resourceRefs: [],
	};
	return {
		receipt: {
			commandId: receipt.id,
			idempotencyKey: input.context.idempotencyKey,
			actionId: input.actionId,
			operationRef: refs.operationRef,
			resourceRefs: refs.resourceRefs,
			replayed,
		},
		data: result,
	};
}

async function getOrCreateReceipt(input: {
	taskId: string;
	actionId: string;
	context: TaskOperatorCommandContext;
	argumentsDigest: string;
}) {
	await db
		.insert(taskOperatorCommandReceipts)
		.values({
			actorKind: input.context.principal.kind,
			actorId: input.context.principal.actorId,
			taskId: input.taskId,
			actionId: input.actionId,
			idempotencyKey: input.context.idempotencyKey,
			argumentsDigest: input.argumentsDigest,
			status: "pending",
		})
		.onConflictDoNothing();
	const [receipt] = await db
		.select()
		.from(taskOperatorCommandReceipts)
		.where(
			and(
				eq(taskOperatorCommandReceipts.actorKind, input.context.principal.kind),
				eq(
					taskOperatorCommandReceipts.actorId,
					input.context.principal.actorId,
				),
				eq(
					taskOperatorCommandReceipts.idempotencyKey,
					input.context.idempotencyKey,
				),
			),
		)
		.limit(1);
	if (!receipt)
		throw new Error("Task Operator command receipt was not created.");
	return receipt;
}

function assertReceiptMatches(
	receipt: typeof taskOperatorCommandReceipts.$inferSelect,
	input: { taskId: string; actionId: string },
	argumentsDigest: string,
) {
	if (
		receipt.taskId === input.taskId &&
		receipt.actionId === input.actionId &&
		receipt.argumentsDigest === argumentsDigest
	)
		return;
	throw new AppError(
		409,
		"TASK_OPERATOR_IDEMPOTENCY_CONFLICT",
		"The idempotency key was already used for a different command.",
	);
}

function replayFailure(value: unknown) {
	const entry = record(value);
	return new AppError(
		typeof entry.statusCode === "number" ? entry.statusCode : 409,
		typeof entry.code === "string"
			? entry.code
			: "TASK_OPERATOR_COMMAND_FAILED",
		typeof entry.message === "string" ? entry.message : "Command failed.",
		optionalRecord(entry.details),
	);
}
function failure(error: unknown): ReceiptFailure {
	if (!(error instanceof AppError))
		return {
			kind: "internal",
			statusCode: 500,
			code: "TASK_OPERATOR_COMMAND_FAILED",
			message: error instanceof Error ? error.message : String(error),
			retryable: false,
			currentRevision: null,
		};
	const currentRevision =
		typeof error.details?.currentTaskRevision === "number"
			? error.details.currentTaskRevision
			: null;
	return {
		kind:
			error.statusCode === 401 || error.statusCode === 403
				? "permission_denied"
				: error.statusCode === 404
					? "not_found"
					: error.statusCode === 409 && currentRevision !== null
						? "revision_conflict"
						: error.statusCode === 422
							? "schema_validation"
							: error.statusCode === 429
								? "resource_limit"
								: error.statusCode >= 500
									? "internal"
									: "domain_precondition",
		statusCode: error.statusCode,
		code: error.code,
		message: error.message,
		retryable: false,
		currentRevision,
		details: error.details,
	};
}
function digest(value: string) {
	return createHash("sha256").update(value).digest("hex");
}
function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
			.join(",")}}`;
	return JSON.stringify(value);
}
function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
