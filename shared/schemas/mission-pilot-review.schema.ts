import { z } from "@hono/zod-openapi";

export const missionPilotReviewFindingSchema = z.object({
	severity: z.enum(["blocking", "warning", "info"]),
	category: z.string().min(1),
	file: z.string().nullable(),
	line: z.number().int().positive().nullable(),
	evidence: z.string().min(1),
	recommendedAction: z.string().min(1),
	blockingReason: z.string().nullable(),
});

export const missionPilotReviewDecisionPayloadSchema = z
	.object({
		verdict: z.enum(["pass", "rework", "attention"]),
		summary: z.string().min(1),
		findings: z.array(missionPilotReviewFindingSchema),
	})
	.superRefine((value, ctx) => {
		if (
			value.verdict === "pass" &&
			value.findings.some((finding) => finding.severity === "blocking")
		) {
			ctx.addIssue({
				code: "custom",
				message: "blocking findingを含むReview結果はpassにできません",
			});
		}
		if (
			value.verdict === "rework" &&
			!value.findings.some((finding) => finding.severity === "blocking")
		) {
			ctx.addIssue({
				code: "custom",
				message: "blocking findingのないReview結果はreworkにできません",
			});
		}
	});

export const missionPilotReworkPacketSchema = z.object({
	summary: z.string().min(1).max(4000).optional(),
	findings: z.array(missionPilotReviewFindingSchema).max(50).optional(),
	objective: z.string().min(1).max(4000).optional(),
	acceptanceCriteria: z.array(z.string().min(1).max(2000)).max(50).optional(),
	evidenceRefs: z.array(z.string().min(1).max(1000)).max(100).optional(),
	failedConditionIds: z.array(z.string().min(1).max(200)).max(100).optional(),
	affectedPaths: z.array(z.string().min(1).max(1000)).max(200).optional(),
	mutationPaths: z.array(z.string().min(1).max(1000)).max(200).optional(),
	reason: z.string().min(1).max(1000).optional(),
});

export type MissionPilotReviewDecisionPayload = z.infer<
	typeof missionPilotReviewDecisionPayloadSchema
>;
export type MissionPilotReworkPacket = z.infer<
	typeof missionPilotReworkPacketSchema
>;
