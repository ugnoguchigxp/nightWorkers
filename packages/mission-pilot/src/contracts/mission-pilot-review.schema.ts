import { z } from "@hono/zod-openapi";

export const missionPilotReviewFindingSchema = z.object({
	severity: z.enum(["blocking", "warning", "info"]),
	category: z.string().min(1),
	file: z.string().nullable().default(null),
	line: z.number().int().positive().nullable().default(null),
	evidence: z.string().min(1),
	recommendedAction: z.string().min(1),
	blockingReason: z.string().nullable().default(null),
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

export type MissionPilotReviewDecisionPayload = z.infer<
	typeof missionPilotReviewDecisionPayloadSchema
>;
