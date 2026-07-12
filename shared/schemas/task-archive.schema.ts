import { z } from "@hono/zod-openapi";

export const taskArchiveReasonSchema = z.enum([
	"mission_pilot_completed",
	"manual",
	"retention",
]);
export const taskArchiveRecordSchema = z.object({
	id: z.string().uuid(),
	taskId: z.string().uuid(),
	missionPilotSessionId: z.string().uuid().nullable(),
	previousStatus: z.literal("completed"),
	reason: taskArchiveReasonSchema,
	evidence: z.record(z.string(), z.unknown()),
	archivedAt: z.union([z.string(), z.date()]),
	restoredAt: z.union([z.string(), z.date()]).nullable(),
	restoredToStatus: z.string().nullable(),
});
