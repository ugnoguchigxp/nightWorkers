import { z } from "@hono/zod-openapi";

export const missionPilotEventProcessStatusSchema = z.enum([
	"pending",
	"processing",
	"processed",
	"failed",
]);
export const missionPilotEventSchema = z.object({
	id: z.string().uuid(),
	sessionId: z.string().uuid(),
	taskId: z.string().uuid(),
	eventType: z.string().min(1),
	phase: z.string().min(1),
	cycle: z.number().int().positive().nullable(),
	contextRevision: z.number().int().positive(),
	contextDigest: z.string().min(1),
	dedupeKey: z.string().min(1),
	sourceKind: z.enum([
		"queue",
		"task_run",
		"verification",
		"review",
		"git",
		"task_archive",
		"coordinator",
	]),
	sourceId: z.string().nullable(),
	payload: z.record(z.string(), z.unknown()),
	processStatus: missionPilotEventProcessStatusSchema,
});
