import { z } from "@hono/zod-openapi";

export const missionPilotPlanStepProgressSchema = z.object({
	key: z.string().min(1),
	ordinal: z.number().int().positive(),
	kind: z.enum([
		"questionnaire",
		"blueprint",
		"data_model",
		"dedicated_view",
		"feature_plan",
	]),
	view: z.string().nullable(),
	status: z.enum(["pending", "running", "completed", "failed", "skipped"]),
	attempt: z.number().int().nonnegative(),
	artifactMessageId: z.string().uuid().nullable(),
	lastError: z.string().nullable(),
	startedAt: z.string().datetime().nullable(),
	finishedAt: z.string().datetime().nullable(),
});

export const missionPilotPlanProgressSchema = z.object({
	taskId: z.string().uuid(),
	sessionId: z.string().uuid(),
	phase: z.string().min(1),
	desiredState: z.enum(["playing", "stopped"]),
	version: z.number().int().nonnegative(),
	contextRevision: z.number().int().positive(),
	currentStepKey: z.string().nullable(),
	steps: z.array(missionPilotPlanStepProgressSchema),
	lastError: z.string().nullable(),
	updatedAt: z.string().datetime(),
});

export type MissionPilotPlanStepProgress = z.infer<
	typeof missionPilotPlanStepProgressSchema
>;
export type MissionPilotPlanProgress = z.infer<
	typeof missionPilotPlanProgressSchema
>;
