import { z } from "@hono/zod-openapi";

export const missionPilotPostQueuePhaseSchema = z.enum([
	"queued",
	"repository_bootstrapping",
	"implementation_starting",
	"implementing",
	"implementation_evaluating",
	"test_preparing",
	"testing",
	"test_evaluating",
	"implementation_rework",
	"review_preparing",
	"reviewing",
	"review_evaluating",
	"review_rework",
	"closeout_preparing",
	"committing",
	"pushing",
	"completing",
	"completed",
	"archiving",
	"archived",
	"paused",
	"attention",
	"cancelled",
]);

export const missionPilotPhaseRunSchema = z.object({
	id: z.string().uuid(),
	sessionId: z.string().uuid(),
	taskId: z.string().uuid(),
	phase: z.enum(["repository_bootstrap", "implementation", "test", "review"]),
	cycle: z.number().int().positive(),
	attempt: z.number().int().positive(),
	runId: z.string().uuid(),
	parentPhaseRunId: z.string().uuid().nullable(),
	inputContextRevision: z.number().int().positive(),
	inputContextDigest: z.string().min(1),
	outputContextRevision: z.number().int().positive().nullable(),
	status: z.enum(["starting", "running", "completed", "failed", "invalidated"]),
	verdict: z.enum(["pass", "rework", "attention"]).nullable(),
	evidence: z.record(z.string(), z.unknown()),
});

export type MissionPilotPostQueuePhase = z.infer<
	typeof missionPilotPostQueuePhaseSchema
>;
export type MissionPilotPhaseRun = z.infer<typeof missionPilotPhaseRunSchema>;
