import { z } from "@hono/zod-openapi";
import {
	planModeArtifactCorrectionTargetSchema,
	planModeRegenerationTargetSchema,
} from "./plan-artifact-contracts";

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

export const missionPilotPlanReviewSchema = z.object({
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
	artifactScores: z.array(missionPilotPlanArtifactScoreSchema),
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
	routingToolCall: z.null(),
});

export type MissionPilotPlanReview = z.infer<
	typeof missionPilotPlanReviewSchema
>;

export type MissionPilotReviewedArtifact = {
	artifactKind: z.infer<typeof planModeRegenerationTargetSchema>;
	sourceMessageId: string;
};

export type MissionPilotPlanReviewFactIssue = {
	stage: "fact";
	path: Array<string | number>;
	code: string;
	message: string;
};

export function validateMissionPilotPlanReviewFacts(
	review: MissionPilotPlanReview,
	input: {
		reviewedArtifacts: MissionPilotReviewedArtifact[];
		currentRouting?: {
			revision: number;
			entries: Array<{
				view: string;
				decision: "include" | "omit";
				capabilityEnabled: boolean;
			}>;
		};
	},
): MissionPilotPlanReviewFactIssue[] {
	const issues: MissionPilotPlanReviewFactIssue[] = [];
	const expected = new Set(
		input.reviewedArtifacts.map(
			(artifact) => `${artifact.artifactKind}:${artifact.sourceMessageId}`,
		),
	);
	const byKind = new Map<string, Set<string>>();
	for (const artifact of input.reviewedArtifacts) {
		const ids = byKind.get(artifact.artifactKind) ?? new Set<string>();
		ids.add(artifact.sourceMessageId);
		byKind.set(artifact.artifactKind, ids);
	}

	const scored = new Set<string>();
	for (const [index, score] of review.artifactScores.entries()) {
		const key = `${score.artifactKind}:${score.sourceMessageId}`;
		if (!expected.has(key)) {
			issues.push(
				factIssue(
					["artifactScores", index, "sourceMessageId"],
					"unknown_artifact_reference",
					`現在のArtifactを参照していません: ${key}`,
				),
			);
		}
		if (scored.has(key)) {
			issues.push(
				factIssue(
					["artifactScores", index],
					"duplicate_artifact_score",
					`同じArtifactが重複しています: ${key}`,
				),
			);
		}
		scored.add(key);
	}
	for (const key of expected) {
		if (!scored.has(key)) {
			issues.push(
				factIssue(
					["artifactScores"],
					"missing_artifact_score",
					`現在のArtifactの採点がありません: ${key}`,
				),
			);
		}
	}

	for (const [index, finding] of review.findings.entries()) {
		const currentIds = byKind.get(finding.artifactKind);
		if (!currentIds?.has(finding.sourceId)) {
			issues.push(
				factIssue(
					["findings", index, "sourceId"],
					"unknown_artifact_reference",
					`現在のArtifactを参照していません: ${finding.artifactKind}:${finding.sourceId}`,
				),
			);
		}
	}
	const revisionTargetKeys = new Set<string>();
	for (const [index, target] of review.revisionTargets.entries()) {
		const key = `${target.target}:${target.sourceMessageId}`;
		if (!expected.has(key)) {
			issues.push(
				factIssue(
					["revisionTargets", index, "sourceMessageId"],
					"unknown_artifact_reference",
					`現在のArtifactを参照していません: ${key}`,
				),
			);
		}
		if (revisionTargetKeys.has(key)) {
			issues.push(
				factIssue(
					["revisionTargets", index],
					"duplicate_revision_target",
					`同じArtifact修正対象が重複しています: ${key}`,
				),
			);
		}
		revisionTargetKeys.add(key);
	}

	return issues;
}

function factIssue(
	path: Array<string | number>,
	code: string,
	message: string,
): MissionPilotPlanReviewFactIssue {
	return { stage: "fact", path, code, message };
}
