import { z } from "@hono/zod-openapi";

export const pilotThoughtEntryKindSchema = z.enum([
	"thought",
	"action_requested",
	"action_completed",
	"action_failed",
	"state_changed",
	"waiting",
	"finished",
	"llm_usage",
	"runtime_error",
]);

export const pilotThoughtEntryStatusSchema = z.enum([
	"pending",
	"running",
	"succeeded",
	"failed",
	"cancelled",
]);

export const pilotThoughtEntrySchema = z.object({
	id: z.string().min(1),
	sessionId: z.string().min(1),
	sequence: z.number().int().nonnegative(),
	occurredAt: z.union([z.string(), z.date()]),
	kind: pilotThoughtEntryKindSchema,
	status: pilotThoughtEntryStatusSchema.optional(),
	summary: z.string().min(1),
	details: z.record(z.string(), z.unknown()).optional(),
	sourceRef: z.object({
		kind: z.string().min(1),
		id: z.string().min(1),
	}),
});

export const pilotThoughtEntriesSchema = z.array(pilotThoughtEntrySchema);

export type PilotThoughtEntryKind = z.infer<typeof pilotThoughtEntryKindSchema>;
export type PilotThoughtEntryStatus = z.infer<
	typeof pilotThoughtEntryStatusSchema
>;
export type PilotThoughtEntry = z.infer<typeof pilotThoughtEntrySchema>;
