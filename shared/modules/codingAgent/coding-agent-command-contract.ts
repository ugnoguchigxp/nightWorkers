import { z } from "@hono/zod-openapi";
import {
	taskOperatorCommandReceiptSchema,
	taskOperatorFailureSchema,
} from "../taskOperator";

export const CODING_AGENT_COMMAND_PROTOCOL_VERSION = 1 as const;
export const CODING_AGENT_COMMAND_WS_CAPABILITY =
	"coding_agent.command.v1" as const;

const requestIdSchema = z.string().uuid();
const idempotencyKeySchema = z.string().min(1).max(256);
const resourceIdSchema = z.string().uuid();
const revisionSchema = z.number().int().nonnegative();
const boundedInstructionSchema = z.string().trim().min(1).max(20_000);

const commandBase = {
	version: z.literal(CODING_AGENT_COMMAND_PROTOCOL_VERSION),
	type: z.literal("coding_agent.command.execute"),
	requestId: requestIdSchema,
	idempotencyKey: idempotencyKeySchema,
	taskId: resourceIdSchema,
	expectedTaskRevision: revisionSchema,
};

export const codingAgentCommandRequestV1Schema = z.discriminatedUnion(
	"actionId",
	[
		z
			.object({
				...commandBase,
				actionId: z.literal("run.implementation.start"),
				arguments: z
					.object({ request: boundedInstructionSchema.optional() })
					.strict(),
			})
			.strict(),
		z
			.object({
				...commandBase,
				actionId: z.literal("run.stop"),
				arguments: z.object({ runId: resourceIdSchema }).strict(),
			})
			.strict(),
		z
			.object({
				...commandBase,
				actionId: z.literal("run.todo.resume"),
				arguments: z
					.object({
						runId: resourceIdSchema,
						todoId: resourceIdSchema,
						expectedTodoRevision: revisionSchema,
						userContext: boundedInstructionSchema,
					})
					.strict(),
			})
			.strict(),
	],
);

export const codingAgentCommandDataSchema = z
	.object({
		taskId: resourceIdSchema,
		runId: resourceIdSchema,
	})
	.strict();

export const codingAgentCommandResponseV1Schema = z
	.object({
		version: z.literal(CODING_AGENT_COMMAND_PROTOCOL_VERSION),
		type: z.literal("coding_agent.command.result"),
		requestId: requestIdSchema,
		result: z.discriminatedUnion("ok", [
			z
				.object({
					ok: z.literal(true),
					receipt: taskOperatorCommandReceiptSchema,
					data: codingAgentCommandDataSchema,
				})
				.strict(),
			z
				.object({
					ok: z.literal(false),
					error: taskOperatorFailureSchema,
				})
				.strict(),
		]),
	})
	.strict();

export type CodingAgentCommandRequestV1 = z.infer<
	typeof codingAgentCommandRequestV1Schema
>;
export type CodingAgentCommandData = z.infer<
	typeof codingAgentCommandDataSchema
>;
export type CodingAgentCommandResponseV1 = z.infer<
	typeof codingAgentCommandResponseV1Schema
>;
