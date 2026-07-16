import { z } from "@hono/zod-openapi";

export const missionPilotCloseoutStatusSchema = z.enum([
	"preparing",
	"ready",
	"committing",
	"committed",
	"pushing",
	"pushed",
	"skipped",
	"needs_human",
	"failed",
]);

export const missionPilotCloseoutSchema = z.object({
	id: z.string().uuid(),
	sessionId: z.string().uuid(),
	attempt: z.number().int().positive(),
	status: missionPilotCloseoutStatusSchema,
	commitSha: z.string().nullable(),
	pushPolicy: z.enum(["never", "allowed", "required"]),
	pushStatus: z.enum([
		"not_requested",
		"pushing",
		"pushed",
		"skipped",
		"blocked",
		"failed",
	]),
});
