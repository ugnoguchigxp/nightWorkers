import { z } from "@hono/zod-openapi";
import { planModeRegenerationTargetSchema } from "./plan-mode-artifact.schema";
import { planModeArtifactCorrectionTargetSchema } from "./plan-mode-artifact-correction.schema";
import { missionPilotPlanRoutingToolCallSchema } from "./plan-mode-routing.schema";

export const MISSION_PILOT_IMPLEMENTATION_ARTIFACT_SCORE_THRESHOLD = 80;
export const MISSION_PILOT_CONCEPT_ARTIFACT_SCORE_THRESHOLD = 70;

const conceptArtifactKinds = new Set([
	"blueprint",
	"user_flow",
	"activity_flow",
	"sequence_flow",
]);

export function isMissionPilotConceptArtifactKind(artifactKind: string) {
	return conceptArtifactKinds.has(artifactKind);
}

export function missionPilotArtifactScoreThreshold(
	artifactKind: z.infer<typeof planModeRegenerationTargetSchema>,
) {
	return isMissionPilotConceptArtifactKind(artifactKind)
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
		verdict: z.enum(["pass", "revise", "reroute", "reject"]),
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
		routingToolCall: missionPilotPlanRoutingToolCallSchema
			.nullable()
			.default(null),
	})
	.superRefine((review, context) => {
		if (review.verdict === "reroute" && !review.routingToolCall) {
			context.addIssue({
				code: "custom",
				path: ["routingToolCall"],
				message: "reroute verdict requires edit_plan_artifact_routing",
			});
		}
		if (review.verdict !== "reroute" && review.routingToolCall) {
			context.addIssue({
				code: "custom",
				path: ["routingToolCall"],
				message: "routing tool call requires reroute verdict",
			});
		}
		if (review.verdict === "reroute") {
			if (review.artifactScores.length > 0) {
				context.addIssue({
					code: "custom",
					path: ["artifactScores"],
					message: "reroute verdict must not score stale routing artifacts",
				});
			}
			if (review.revisionTargets.length > 0) {
				context.addIssue({
					code: "custom",
					path: ["revisionTargets"],
					message: "reroute verdict must not mix artifact revisions",
				});
			}
			return;
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
	if (review.verdict === "reroute") {
		return { ...review, revisionTargets: [] };
	}
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
	const blockingArtifactKinds = new Set(
		review.findings
			.filter((finding) => finding.severity === "blocking")
			.map((finding) => finding.artifactKind),
	);
	const seenTargets = new Set<string>();
	const revisionTargets = review.revisionTargets.filter((target) => {
		const key = `${target.target}:${target.sourceMessageId}`;
		if (
			review.verdict !== "revise" ||
			isMissionPilotConceptArtifactKind(target.target) ||
			!expected.has(key) ||
			!blockingArtifactKinds.has(target.target) ||
			seenTargets.has(key)
		)
			return false;
		seenTargets.add(key);
		return true;
	});
	return {
		...review,
		findings: review.findings.map((finding) =>
			isMissionPilotConceptArtifactKind(finding.artifactKind)
				? { ...finding, severity: "warning" as const }
				: finding,
		),
		verdict:
			review.verdict === "reject"
				? "reject"
				: revisionTargets.length > 0
					? "revise"
					: "pass",
		revisionTargets,
	};
}
