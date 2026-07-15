import { describe, expect, it } from "vitest";
import {
	parseStructuredReviewDecision,
	resolveMissionPilotPushPolicy,
} from "../api/modules/missionPilot/mission-pilot-post-queue-review.service";
import { evaluateReviewCompletionGate } from "../api/modules/missionPilot/mission-pilot-post-queue-state";

describe("Mission Pilot Review completion gate", () => {
	it("normalizes omitted nullable fields before routing rework", () => {
		const decision = parseStructuredReviewDecision(
			JSON.stringify({
				verdict: "rework",
				summary: "blocking 1件、warning 1件",
				findings: [
					{
						severity: "blocking",
						category: "verification",
						file: "api/routes/todos.route.test.ts",
						line: 45,
						evidence: "主要API検証が失敗している",
						recommendedAction: "APIテストを再実行する",
						blockingReason: "ACを確認できない",
					},
					{
						severity: "warning",
						category: "ui",
						evidence: "操作通知が不足している",
						recommendedAction: "通知を追加する",
					},
				],
			}),
		);
		expect(decision).toMatchObject({
			verdict: "rework",
			findings: [
				{ severity: "blocking" },
				{
					severity: "warning",
					file: null,
					line: null,
					blockingReason: null,
				},
			],
		});
		expect(
			evaluateReviewCompletionGate({
				decision,
				contextDigestMatches: true,
				testSnapshotMatches: true,
				targetManifestMatches: true,
				reviewerEvaluationMatches: true,
				reviewerEvaluationApproved: false,
			}),
		).toMatchObject({
			pass: false,
			reasons: ["review_rework", "reviewer_evaluation_not_approved"],
			decision: { verdict: "rework" },
		});
	});

	it("does not allow push when the Play authorization did not grant it", () => {
		expect(
			resolveMissionPilotPushPolicy({
				version: 3,
				sessionId: "00000000-0000-4000-8000-000000000001",
				taskId: "00000000-0000-4000-8000-000000000002",
				taskRef: {
					source: "task",
					id: "00000000-0000-4000-8000-000000000002",
				},
				activationContextRevision: 1,
				activationContextDigest: "ctx-1",
				grantedByAction: "mission_pilot_play",
				grantedAt: new Date().toISOString(),
				scopes: {
					plan: true,
					queue: true,
					implementation: true,
					testMutation: true,
					review: true,
					localCommit: true,
					taskComplete: true,
					taskArchive: true,
					push: false,
				},
				pushPolicy: "required",
			}),
		).toBe("never");
	});

	it("accepts a structured pass with no blocking findings", () => {
		const result = evaluateReviewCompletionGate({
			decision: { verdict: "pass", summary: "確認済み", findings: [] },
			contextDigestMatches: true,
			testSnapshotMatches: true,
			targetManifestMatches: true,
			reviewerEvaluationMatches: true,
			reviewerEvaluationApproved: true,
		});
		expect(result.pass).toBe(true);
	});

	it("rejects artifact done semantics without a structured verdict", () => {
		const result = evaluateReviewCompletionGate({
			decision: { status: "done" },
			contextDigestMatches: true,
			testSnapshotMatches: true,
			targetManifestMatches: true,
			reviewerEvaluationMatches: true,
			reviewerEvaluationApproved: true,
		});
		expect(result).toMatchObject({
			pass: false,
			reasons: ["structured_decision_invalid"],
		});
	});

	it("rejects pass with a blocking finding", () => {
		const result = evaluateReviewCompletionGate({
			decision: {
				verdict: "pass",
				summary: "問題あり",
				findings: [
					{
						severity: "blocking",
						category: "correctness",
						file: "src/a.ts",
						line: 1,
						evidence: "壊れる",
						recommendedAction: "修正する",
						blockingReason: "acceptance failure",
					},
				],
			},
			contextDigestMatches: true,
			testSnapshotMatches: true,
			targetManifestMatches: true,
			reviewerEvaluationMatches: true,
			reviewerEvaluationApproved: true,
		});
		expect(result.pass).toBe(false);
	});

	it("does not route warning-only rework back to Implementation", () => {
		const result = evaluateReviewCompletionGate({
			decision: {
				verdict: "rework",
				summary: "warning only",
				findings: [
					{
						severity: "warning",
						category: "maintainability",
						file: "src/a.ts",
						line: 1,
						evidence: "改善余地",
						recommendedAction: "必要なら整理する",
						blockingReason: null,
					},
				],
			},
			contextDigestMatches: true,
			testSnapshotMatches: true,
			targetManifestMatches: true,
			reviewerEvaluationMatches: true,
			reviewerEvaluationApproved: true,
		});
		expect(result).toMatchObject({
			pass: false,
			reasons: ["structured_decision_invalid"],
			decision: null,
		});
	});

	it("rejects pass when the persisted reviewer evaluation is missing", () => {
		const result = evaluateReviewCompletionGate({
			decision: { verdict: "pass", summary: "確認済み", findings: [] },
			contextDigestMatches: true,
			testSnapshotMatches: true,
			targetManifestMatches: true,
			reviewerEvaluationMatches: false,
			reviewerEvaluationApproved: false,
		});
		expect(result).toMatchObject({
			pass: false,
			reasons: [
				"reviewer_evaluation_missing_or_stale",
				"reviewer_evaluation_not_approved",
			],
		});
	});
});
