import { z } from "@hono/zod-openapi";
import { questionnaireStateChangedRealtimePayloadSchema } from "../design-questionnaire.schema";
import { planModeRoutingChangedRealtimePayloadSchema } from "../plan-mode-routing.schema";
import {
	activityEventSchema,
	taskEventSchema,
	taskMessageSchema,
} from "./activity-message.schema";
import { taskSchema } from "./repository-task.schema";
import { taskRunSchema, taskRunTodoSchema } from "./run.schema";

const taskIdSchema = z.string().uuid();
const runIdSchema = z.string().uuid();
const envelope = {
	timestamp: z.string().datetime(),
	seq: z.number().int().nonnegative().optional(),
	replayed: z.boolean().optional(),
};

export const nightWorkersHostRealtimeMessageSchema = z.discriminatedUnion(
	"type",
	[
		z.object({
			...envelope,
			type: z.literal("connected"),
			capabilities: z.array(z.string()).default([]),
		}),
		z.object({
			...envelope,
			type: z.literal("subscribed"),
			taskId: taskIdSchema,
			runId: runIdSchema.optional(),
			afterSeq: z.number().int().nonnegative().optional(),
		}),
		z.object({
			...envelope,
			type: z.literal("error"),
			message: z.string(),
			code: z.string().optional(),
		}),
		z.object({
			...envelope,
			type: z.literal("activity_event_created"),
			taskId: taskIdSchema,
			payload: z.object({ event: activityEventSchema }),
		}),
		z.object({
			...envelope,
			type: z.literal("task_llm_delta"),
			taskId: taskIdSchema,
			payload: z.object({
				text: z.string(),
				event: z.record(z.string(), z.unknown()).optional(),
			}),
		}),
		z.object({
			...envelope,
			type: z.literal("task_event_created"),
			taskId: taskIdSchema,
			runId: runIdSchema,
			event: taskEventSchema,
		}),
		z.object({
			...envelope,
			type: z.literal("task_message_created"),
			taskId: taskIdSchema,
			runId: runIdSchema.optional(),
			payload: z.object({ message: taskMessageSchema }),
		}),
		z.object({
			...envelope,
			type: z.literal("task_run_updated"),
			taskId: taskIdSchema,
			runId: runIdSchema.optional(),
			payload: z.object({
				run: taskRunSchema.optional(),
				todo: taskRunTodoSchema.optional(),
				todos: z.array(taskRunTodoSchema).optional(),
				status: z.string().optional(),
			}),
		}),
		z.object({
			...envelope,
			type: z.literal("task_status_updated"),
			taskId: taskIdSchema,
			payload: z.object({ status: z.string(), task: taskSchema }),
		}),
		z.object({
			...envelope,
			type: z.literal("questionnaire.state_changed"),
			taskId: taskIdSchema,
			payload: questionnaireStateChangedRealtimePayloadSchema,
		}),
		z.object({
			...envelope,
			type: z.literal("plan_mode.routing_changed"),
			taskId: taskIdSchema,
			payload: planModeRoutingChangedRealtimePayloadSchema,
		}),
	],
);

export type NightWorkersHostRealtimeMessage = z.infer<
	typeof nightWorkersHostRealtimeMessageSchema
>;
