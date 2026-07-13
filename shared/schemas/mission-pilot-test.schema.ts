import { z } from "@hono/zod-openapi";

export const missionPilotTestDecisionSchema = z.object({
	verdict: z.enum(["pass", "rework", "attention"]),
	defectOwner: z.enum(["test", "implementation", "environment", "unknown"]),
	failedConditionIds: z.array(z.string()),
	evidenceRunIds: z.array(z.string().trim().min(1)),
	affectedPaths: z.array(z.string()),
	summary: z.string().min(1),
	implementationRework: z
		.object({
			objective: z.string().min(1),
			acceptanceCriteria: z.array(z.string().min(1)),
			evidenceRefs: z.array(z.record(z.string(), z.unknown())),
		})
		.nullable(),
});

export type MissionPilotTestDecision = z.infer<
	typeof missionPilotTestDecisionSchema
>;
