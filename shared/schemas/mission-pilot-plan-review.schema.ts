import { z } from "@hono/zod-openapi";
import { planModeArtifactCorrectionTargetSchema } from "./plan-mode-artifact-correction.schema";

export const missionPilotPlanReviewSchema = z
	.object({
		verdict: z.enum(["pass", "revise", "reject"]),
		summary: z.string().min(1),
		coverage: z.object({
			goal: z.enum(["pass", "fail"]),
			scope: z.enum(["pass", "fail"]),
			acceptanceCriteria: z.enum(["pass", "fail"]),
			implementationSteps: z.enum(["pass", "fail"]),
			verification: z.enum(["pass", "fail"]),
			artifactConsistency: z.enum(["pass", "fail"]),
			riskAndSafety: z.enum(["pass", "fail"]),
		}),
		findings: z.array(
			z.object({
				severity: z.enum(["blocking", "warning"]),
				artifactKind: z.string().min(1),
				sourceId: z.string().min(1),
				issue: z.string().min(1),
				recommendation: z.string().min(1),
			}),
		),
		revisionTargets: z.array(planModeArtifactCorrectionTargetSchema),
	})
	.superRefine((review, context) => {
		const hasBlocking = review.findings.some(
			(finding) => finding.severity === "blocking",
		);
		if (review.verdict === "pass" && hasBlocking) {
			context.addIssue({
				code: "custom",
				path: ["verdict"],
				message: "pass review cannot contain blocking findings",
			});
		}
		if (review.verdict === "revise" && review.revisionTargets.length === 0) {
			context.addIssue({
				code: "custom",
				path: ["revisionTargets"],
				message: "revise review requires at least one revision target",
			});
		}
	});

export type MissionPilotPlanReview = z.infer<
	typeof missionPilotPlanReviewSchema
>;

export function normalizeMissionPilotPlanReview(
	input: unknown,
): MissionPilotPlanReview {
	const review = missionPilotPlanReviewSchema.parse(input);
	const hasBlocking = review.findings.some(
		(finding) => finding.severity === "blocking",
	);
	if (review.verdict === "pass") {
		return { ...review, revisionTargets: [] };
	}
	if (review.verdict !== "revise" || hasBlocking) return review;
	return {
		...review,
		verdict: "pass",
		coverage: {
			goal: "pass",
			scope: "pass",
			acceptanceCriteria: "pass",
			implementationSteps: "pass",
			verification: "pass",
			artifactConsistency: "pass",
			riskAndSafety: "pass",
		},
		revisionTargets: [],
		summary: `${review.summary} blocking findingはないためpassとして扱います。`,
	};
}
