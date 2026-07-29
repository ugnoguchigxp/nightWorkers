import { z } from "@hono/zod-openapi";
import { taskStatusSchema } from "../../schemas/nightworkers/repository-task.schema";

export const TASK_OPERATOR_PROJECTION_VERSION = 1 as const;
export const TASK_OPERATOR_HEAD_TOKEN_BUDGET = 3_000;
export const TASK_OPERATOR_CONTENT_PAGE_TOKEN_BUDGET = 4_000;
export const TASK_OPERATOR_CONTENT_PAGE_SERIALIZED_CONTENT_BYTE_BUDGET = 12_000;
export const TASK_OPERATOR_MAX_LATEST_ARTIFACT_KINDS = 32;

const identifierSchema = z.string().min(1).max(160);
const digestSchema = z.string().min(1).max(160);
const revisionSchema = z.number().int().nonnegative();
const boundedStatusSchema = z.string().min(1).max(80);

export const taskOperatorBoundedTextRefSchema = z
	.object({
		text: z.string().max(1_000),
		truncated: z.boolean(),
		sourceRevision: revisionSchema,
		sourceDigest: digestSchema,
	})
	.strict();

export const taskOperatorSourceRefSchema = z
	.object({
		kind: identifierSchema,
		id: identifierSchema,
	})
	.strict();

export const taskOperatorResourceRefSchema = z
	.object({
		kind: identifierSchema,
		id: identifierSchema,
		revision: revisionSchema,
	})
	.strict();

export const taskOperatorProjectionV1Schema = z
	.object({
		version: z.literal(TASK_OPERATOR_PROJECTION_VERSION),
		sourceRevision: revisionSchema,
		sourceDigest: digestSchema,
		task: z
			.object({
				id: identifierSchema,
				revision: revisionSchema,
				status: taskStatusSchema,
				title: z.string().min(1).max(500),
				objective: taskOperatorBoundedTextRefSchema.nullable(),
				acceptanceCriteria: taskOperatorBoundedTextRefSchema.nullable(),
			})
			.strict(),
		project: z
			.object({
				id: identifierSchema,
				revision: revisionSchema,
				repositoryState: z.enum(["registered", "missing", "unavailable"]),
			})
			.strict(),
		questionnaire: z
			.object({
				id: identifierSchema,
				revision: revisionSchema,
				status: boundedStatusSchema,
				decisionDigest: digestSchema.nullable(),
				blockingQuestionCount: z.number().int().nonnegative(),
			})
			.strict()
			.nullable(),
		artifactIndex: z
			.object({
				revision: revisionSchema,
				totalCount: z.number().int().nonnegative(),
				nextCursor: z.number().int().nonnegative().nullable(),
				latestByKind: z
					.array(
						z
							.object({
								id: identifierSchema,
								kind: identifierSchema,
								revision: revisionSchema,
								digest: digestSchema,
								status: boundedStatusSchema,
							})
							.strict(),
					)
					.max(TASK_OPERATOR_MAX_LATEST_ARTIFACT_KINDS),
			})
			.strict(),
		queue: z
			.object({
				id: identifierSchema,
				revision: revisionSchema,
				status: boundedStatusSchema,
				activeRunId: identifierSchema.nullable(),
			})
			.strict()
			.nullable(),
		activeRun: z
			.object({
				id: identifierSchema,
				revision: revisionSchema,
				status: boundedStatusSchema,
				currentTodoRef: z
					.object({
						id: identifierSchema,
						revision: revisionSchema,
						status: boundedStatusSchema,
						blockerDigest: digestSchema.nullable(),
					})
					.strict()
					.nullable(),
			})
			.strict()
			.nullable(),
		latestTerminalRun: z
			.object({
				id: identifierSchema,
				revision: revisionSchema,
				status: boundedStatusSchema,
				outcomeDigest: digestSchema,
			})
			.strict()
			.nullable(),
		commandCatalog: z
			.object({
				revision: revisionSchema,
				availableIds: z.array(identifierSchema).max(128),
				confirmationRequiredIds: z.array(identifierSchema).max(128),
				unavailableCount: z.number().int().nonnegative(),
			})
			.strict(),
		unreadEvents: z
			.object({
				from: z.number().int().nonnegative().nullable(),
				through: z.number().int().nonnegative().nullable(),
				types: z.array(identifierSchema).max(128),
			})
			.strict(),
	})
	.strict();

export const taskOperatorAvailableCommandSchema = z
	.object({
		id: identifierSchema,
		availability: z.enum(["available", "unavailable", "confirmation_required"]),
		unavailableReasonCode: z.string().min(1).max(160).nullable(),
		expectedRevision: revisionSchema.nullable(),
	})
	.strict();

const taskOperatorDirectPrincipalSchema = z
	.object({
		kind: z.enum(["human", "automation"]),
		actorId: identifierSchema,
		authorizationRef: identifierSchema,
	})
	.strict();

const delegatedTaskOperatorPrincipalSchema = z
	.object({
		kind: z.literal("delegated_user"),
		actorId: identifierSchema,
		authorizationRef: identifierSchema,
		subjectUserId: identifierSchema,
		delegationRef: z
			.object({
				sessionId: identifierSchema,
				taskId: identifierSchema,
				grantedAt: z.string().datetime(),
				capabilityDigest: digestSchema,
			})
			.strict(),
	})
	.strict();

export const taskOperatorPrincipalSchema = z.discriminatedUnion("kind", [
	taskOperatorDirectPrincipalSchema,
	delegatedTaskOperatorPrincipalSchema,
]);

export const taskOperatorQueryContextSchema = z
	.object({
		principal: taskOperatorPrincipalSchema,
	})
	.strict();

export const taskOperatorCommandContextSchema = z
	.object({
		principal: taskOperatorPrincipalSchema,
		requestId: identifierSchema,
		idempotencyKey: z.string().min(1).max(256),
	})
	.strict();

export const taskOperatorFailureSchema = z
	.object({
		kind: z.enum([
			"not_found",
			"permission_denied",
			"confirmation_required",
			"revision_conflict",
			"ownership_mismatch",
			"domain_precondition",
			"schema_validation",
			"idempotency_conflict",
			"resource_limit",
			"internal",
		]),
		code: z.string().min(1).max(160),
		message: z.string().min(1).max(2_000),
		retryable: z.boolean(),
		currentRevision: revisionSchema.nullable(),
	})
	.strict();

export const taskOperatorCommandReceiptSchema = z
	.object({
		commandId: identifierSchema,
		idempotencyKey: z.string().min(1).max(256),
		actionId: identifierSchema,
		operationRef: taskOperatorResourceRefSchema.nullable(),
		resourceRefs: z.array(taskOperatorResourceRefSchema).max(32),
		replayed: z.boolean(),
	})
	.strict();

export function taskOperatorContentPageSchema<ContentSchema extends z.ZodType>(
	contentSchema: ContentSchema,
) {
	return z
		.object({
			sourceRef: taskOperatorSourceRefSchema,
			sourceRevision: revisionSchema,
			sourceDigest: digestSchema,
			cursor: z.number().int().nonnegative(),
			nextCursor: z.number().int().nonnegative().nullable(),
			hasMore: z.boolean(),
			tokenEstimate: z
				.number()
				.int()
				.nonnegative()
				.max(TASK_OPERATOR_CONTENT_PAGE_TOKEN_BUDGET),
			content: contentSchema,
		})
		.strict();
}

export function taskOperatorCommandResultSchema<DataSchema extends z.ZodType>(
	dataSchema: DataSchema,
) {
	return z.discriminatedUnion("ok", [
		z
			.object({
				ok: z.literal(true),
				receipt: taskOperatorCommandReceiptSchema,
				data: dataSchema,
			})
			.strict(),
		z
			.object({ ok: z.literal(false), error: taskOperatorFailureSchema })
			.strict(),
	]);
}

export type TaskOperatorBoundedTextRef = z.infer<
	typeof taskOperatorBoundedTextRefSchema
>;
export type TaskOperatorSourceRef = z.infer<typeof taskOperatorSourceRefSchema>;
export type TaskOperatorResourceRef = z.infer<
	typeof taskOperatorResourceRefSchema
>;
export type TaskOperatorProjectionV1 = z.infer<
	typeof taskOperatorProjectionV1Schema
>;
export type TaskOperatorAvailableCommand = z.infer<
	typeof taskOperatorAvailableCommandSchema
>;
export type TaskOperatorPrincipal = z.infer<typeof taskOperatorPrincipalSchema>;
export type TaskOperatorQueryContext = z.infer<
	typeof taskOperatorQueryContextSchema
>;
export type TaskOperatorCommandContext = z.infer<
	typeof taskOperatorCommandContextSchema
>;
export type TaskOperatorFailure = z.infer<typeof taskOperatorFailureSchema>;
export type TaskOperatorCommandReceipt = z.infer<
	typeof taskOperatorCommandReceiptSchema
>;
export type TaskOperatorContentPage<Content> = {
	sourceRef: TaskOperatorSourceRef;
	sourceRevision: number;
	sourceDigest: string;
	cursor: number;
	nextCursor: number | null;
	hasMore: boolean;
	tokenEstimate: number;
	content: Content;
};
export type TaskOperatorCommandResult<Data> =
	| { ok: true; receipt: TaskOperatorCommandReceipt; data: Data }
	| { ok: false; error: TaskOperatorFailure };
