import { z } from "@hono/zod-openapi";
import {
	planModeArtifactFocusSchema,
	planModeRegenerationTargetSchema,
} from "./plan-artifact-contracts";

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
	review: z
		.object({
			status: z.enum([
				"pending",
				"running",
				"passed",
				"revision_required",
				"failed",
			]),
			attempt: z.number().int().nonnegative(),
			reviewId: z.string().uuid().nullable(),
			advisories: z
				.array(
					z.object({
						artifactKind: planModeRegenerationTargetSchema,
						score: z.number().int().min(0).max(100),
						threshold: z.number().int().min(0).max(100),
						rationale: z.string().min(1),
					}),
				)
				.default([]),
		})
		.default({ status: "pending", attempt: 0, reviewId: null, advisories: [] }),
	activeCorrection: z
		.object({
			id: z.string().uuid(),
			target: planModeRegenerationTargetSchema,
			focus: planModeArtifactFocusSchema,
			status: z.string().min(1),
			instruction: z.string().min(1),
			sourceMessageId: z.string().uuid(),
		})
		.nullable()
		.default(null),
	queueAdmission: z
		.object({
			status: z.enum(["blocked", "ready", "admitting", "admitted"]),
		})
		.default({ status: "blocked" }),
	lastError: z.string().nullable(),
	updatedAt: z.string().datetime(),
});

export type MissionPilotPlanStepProgress = z.infer<
	typeof missionPilotPlanStepProgressSchema
>;
export type MissionPilotPlanProgress = z.infer<
	typeof missionPilotPlanProgressSchema
>;
