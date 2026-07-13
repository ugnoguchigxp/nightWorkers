import { z } from "@hono/zod-openapi";

export const traceOwnerSchema = z.enum([
	"user",
	"mission_pilot",
	"coding_agent",
	"system",
]);

export const traceChannelSchema = z.enum([
	"chat",
	"pilot_thought",
	"artifact",
	"internal",
]);

export const traceProvenanceSchema = z.object({
	owner: traceOwnerSchema,
	channel: traceChannelSchema,
	producer: z.object({
		kind: z.enum([
			"user",
			"structured_llm",
			"agent_runtime",
			"runtime",
			"system",
		]),
		role: z.string().optional(),
		runId: z.string().optional(),
		callId: z.string().optional(),
	}),
	orchestrationRef: z
		.object({
			kind: z.literal("mission_pilot"),
			sessionId: z.string(),
			phaseRunId: z.string().optional(),
			phase: z.string().optional(),
			cycle: z.number().int().optional(),
			attempt: z.number().int().optional(),
		})
		.nullable()
		.optional(),
});

export type TraceOwner = z.infer<typeof traceOwnerSchema>;
export type TraceChannel = z.infer<typeof traceChannelSchema>;
export type TraceProvenance = z.infer<typeof traceProvenanceSchema>;
