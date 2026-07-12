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
	});

export type MissionPilotReviewDecisionPayload = z.infer<
	typeof missionPilotReviewDecisionPayloadSchema
>;
