import { z } from "@hono/zod-openapi";
import { planModeRegenerationTargetSchema } from "./plan-mode-artifact.schema";
import { planModeArtifactCorrectionTargetSchema } from "./plan-mode-artifact-correction.schema";

export const MISSION_PILOT_IMPLEMENTATION_ARTIFACT_SCORE_THRESHOLD = 80;
export const MISSION_PILOT_CONCEPT_ARTIFACT_SCORE_THRESHOLD = 70;

const conceptArtifactKinds = new Set([
	"blueprint",
	"user_flow",
	"activity_flow",
	"sequence_flow",
]);

export function missionPilotArtifactScoreThreshold(
	artifactKind: z.infer<typeof planModeRegenerationTargetSchema>,
) {
	return conceptArtifactKinds.has(artifactKind)
		? MISSION_PILOT_CONCEPT_ARTIFACT_SCORE_THRESHOLD
		: MISSION_PILOT_IMPLEMENTATION_ARTIFACT_SCORE_THRESHOLD;
}

export const missionPilotPlanArtifactScoreSchema = z.object({
	artifactKind: planModeRegenerationTargetSchema,
	sourceMessageId: z.string().uuid(),
	score: z.number().int().min(0).max(100),
	rationale: z.string().min(1),
});

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
		artifactScores: z.array(missionPilotPlanArtifactScoreSchema).default([]),
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
		const belowThreshold = review.artifactScores.filter(
			(item) =>
				item.score < missionPilotArtifactScoreThreshold(item.artifactKind),
		);
		if (belowThreshold.length > 0 && review.revisionTargets.length === 0) {
			context.addIssue({
				code: "custom",
				path: ["revisionTargets"],
				message: "below-threshold scores require revision targets",
			});
		}
	});

export type MissionPilotPlanReview = z.infer<
	typeof missionPilotPlanReviewSchema
>;

export type MissionPilotReviewedArtifact = {
	artifactKind: z.infer<typeof planModeRegenerationTargetSchema>;
	sourceMessageId: string;
};

export function normalizeMissionPilotPlanReview(
	input: unknown,
	reviewedArtifacts: MissionPilotReviewedArtifact[] = [],
): MissionPilotPlanReview {
	const review = missionPilotPlanReviewSchema.parse(input);
	if (reviewedArtifacts.length === 0 && review.artifactScores.length === 0) {
		return review;
	}
	const expected = new Set(
		reviewedArtifacts.map(
			(item) => `${item.artifactKind}:${item.sourceMessageId}`,
		),
	);
	const scored = new Set(
		review.artifactScores.map(
			(item) => `${item.artifactKind}:${item.sourceMessageId}`,
		),
	);
	if (
		review.artifactScores.length !== expected.size ||
		expected.size !== scored.size ||
		[...expected].some((key) => !scored.has(key))
	) {
		throw new Error(
			"Plan review must score every current Artifact exactly once",
		);
	}
	const belowThreshold = new Set(
		review.artifactScores
			.filter(
				(item) =>
					item.score < missionPilotArtifactScoreThreshold(item.artifactKind),
			)
			.map((item) => `${item.artifactKind}:${item.sourceMessageId}`),
	);
	const revisionTargets = review.revisionTargets.filter((target) =>
		belowThreshold.has(`${target.target}:${target.sourceMessageId}`),
	);
	if (revisionTargets.length !== belowThreshold.size) {
		throw new Error(
			"Every below-threshold Artifact requires one matching revision target",
		);
	}
	return {
		...review,
		verdict: belowThreshold.size === 0 ? "pass" : "revise",
		revisionTargets,
	};
}
