import { z } from "@hono/zod-openapi";
import { taskSchema } from "./nightworkers/repository-task.schema";

const dateLikeSchema = z.union([z.string(), z.date()]);

export const missionPilotSourceRefSchema = z.discriminatedUnion("source", [
	z.object({
		source: z.literal("mission_task_candidate"),
		id: z.string().uuid(),
	}),
	z.object({
		source: z.literal("mission_task_proposal"),
		id: z.string().uuid(),
	}),
]);
export const missionPilotPushPolicySchema = z.enum([
	"never",
	"allowed",
	"required",
]);
export const missionPilotAuthorizationV2Schema = z.object({
	version: z.literal(2),
	sessionId: z.string().uuid(),
	taskId: z.string().uuid(),
	sourceRef: missionPilotSourceRefSchema,
	grantedByAction: z.literal("mission_pilot_play"),
	grantedAt: z.string().datetime(),
	scopes: z.object({
		plan: z.literal(true),
		queue: z.literal(true),
		implementation: z.literal(true),
		testMutation: z.literal(true),
		review: z.literal(true),
		localCommit: z.literal(true),
		taskComplete: z.literal(true),
		taskArchive: z.literal(true),
		push: z.boolean(),
	}),
	pushPolicy: missionPilotPushPolicySchema,
});
export const missionPilotDesiredStateSchema = z.enum(["stopped", "playing"]);
export const missionPilotActivityStateSchema = z.enum([
	"idle",
	"starting",
	"running",
	"stopping",
	"attention",
]);
export const missionPilotInitialPromptStateSchema = z.enum([
	"pending",
	"dispatching",
	"sent",
	"failed",
]);
export const missionPilotControlSummarySchema = z.object({
	taskId: z.string().uuid(),
	desiredState: missionPilotDesiredStateSchema,
	activityState: missionPilotActivityStateSchema,
	phase: z.string(),
	authorizationVersion: z.number().int().nullable(),
	initialPromptState: missionPilotInitialPromptStateSchema,
	initialPromptMessageId: z.string().uuid().nullable(),
	activeRunId: z.string().uuid().nullable(),
	nextWakeAt: dateLikeSchema.nullable(),
	version: z.number().int().nonnegative(),
	lastError: z.string().nullable(),
	updatedAt: dateLikeSchema,
});
export const taskWithMissionPilotSchema = taskSchema.extend({
	missionPilot: missionPilotControlSummarySchema.nullable(),
});
export const createMissionPilotTaskRequestSchema = z.object({
	repositoryId: z.string().uuid(),
	sourceRef: missionPilotSourceRefSchema,
});
export const createMissionPilotTaskResponseSchema = z.object({
	task: taskWithMissionPilotSchema,
});
export const missionPilotCommandRequestSchema = z.object({
	expectedVersion: z.number().int().nonnegative(),
});
export const missionPilotCommandResponseSchema = z.object({
	missionPilot: missionPilotControlSummarySchema,
	task: taskSchema.optional(),
	run: z.unknown().nullable().optional(),
	messages: z.array(z.unknown()).optional(),
	stoppedRun: z.unknown().nullable().optional(),
});

export type MissionPilotSourceRef = z.infer<typeof missionPilotSourceRefSchema>;
export type MissionPilotAuthorizationV2 = z.infer<
	typeof missionPilotAuthorizationV2Schema
>;
export type MissionPilotControlSummary = z.infer<
	typeof missionPilotControlSummarySchema
>;
