import { describe, expect, it } from "vitest";
import {
	appendTestModeNextStepLink,
	appendTestModeReviewFixRequired,
	findUnresolvedTestModeReviewFeedback,
} from "../api/modules/nightworkers/run-orchestration/runtime-execution";

describe("runtime final report links", () => {
	it("appends a Test Mode artifact link to completed implementation reports", () => {
		const report = appendTestModeNextStepLink({
			finalReport: "実装が完了しました。",
			taskId: "task-1",
			executionMode: "implementation",
			status: "completed",
		});

		expect(report).toContain(
			"[テストモードに入り、完了条件テストの構築をする](/sessions/task-1?artifact=test_mode)",
		);
	});

	it("does not append the Test Mode link outside completed implementation reports", () => {
		expect(
			appendTestModeNextStepLink({
				finalReport: "Plan created.",
				taskId: "task-1",
				executionMode: "planning",
				status: "completed",
			}),
		).toBe("Plan created.");
		expect(
			appendTestModeNextStepLink({
				finalReport: "Implementation failed.",
				taskId: "task-1",
				executionMode: "implementation",
				status: "failed",
			}),
		).toBe("Implementation failed.");
	});

	it("does not duplicate an existing Test Mode link", () => {
		const existing =
			"実装が完了しました。\n\n[テストモードに入り、完了条件テストの構築をする](/sessions/task-1?artifact=test_mode)";

		expect(
			appendTestModeNextStepLink({
				finalReport: existing,
				taskId: "task-1",
				executionMode: "implementation",
				status: "completed",
			}),
		).toBe(existing);
	});

	it("appends a review artifact link to completed Test Mode reports", () => {
		const report = appendTestModeNextStepLink({
			finalReport: "テストが完了しました。",
			taskId: "task-1",
			executionMode: "test",
			status: "completed",
		});

		expect(
			report.endsWith(
				"[レビューモードに移行する](/sessions/task-1?artifact=review_status)",
			),
		).toBe(true);
	});

	it("does not append a review artifact link to Test Mode reports that require reviewer follow-up", () => {
		const report = appendTestModeNextStepLink({
			finalReport: "レビュー指摘が残りました。",
			taskId: "task-1",
			executionMode: "test",
			status: "needs_human",
		});

		expect(report).toBe("レビュー指摘が残りました。");
	});

	it("does not duplicate an existing review artifact link", () => {
		const existing =
			"テストが完了しました。\n\n[レビューモードに移行する](/sessions/task-1?artifact=review_status)";

		expect(
			appendTestModeNextStepLink({
				finalReport: existing,
				taskId: "task-1",
				executionMode: "test",
				status: "completed",
			}),
		).toBe(existing);
	});

	it("removes Test Mode follow-up suggestions and keeps only the review artifact link at the end", () => {
		const report = appendTestModeNextStepLink({
			finalReport: [
				"テストが完了しました。",
				"",
				"必要なら次にできます。",
				"",
				"1. 変更差分の要点をファイル単位で整理する",
				"2. Plan Mode で未確定項目だけを設計メモに落とす",
				"[レビューモードに移行する](/sessions/task-1?artifact=review_status)",
			].join("\n"),
			taskId: "task-1",
			executionMode: "test",
			status: "completed",
		});

		expect(report).toBe(
			"テストが完了しました。\n\n[レビューモードに移行する](/sessions/task-1?artifact=review_status)",
		);
		expect(report).not.toContain("必要なら次");
		expect(report).not.toContain("変更差分の要点");
		expect(report).not.toContain("Plan Mode");
	});

	it("detects unresolved Test Mode review findings from the latest review evaluation", () => {
		const feedback = findUnresolvedTestModeReviewFeedback([
			{
				payloadJson: {
					runEvent: {
						type: "review.evaluation_finished",
						data: {
							status: "completed",
							finalReviewerVerdict: "changes_requested",
							blockingFindingCount: 1,
							reviewResult: {
								verdict: "changes_requested",
								findings: [
									{
										severity: "blocking",
										title: "Final report is present",
										body: "Rubric criterion failed: Final report is present",
									},
								],
							},
						},
					},
				},
			},
		]);

		expect(feedback).toMatchObject({
			verdict: "changes_requested",
			blockingFindingCount: 1,
			findings: [
				{
					severity: "blocking",
					title: "Final report is present",
				},
			],
		});
	});

	it("clears unresolved Test Mode review findings after a later approval", () => {
		const feedback = findUnresolvedTestModeReviewFeedback([
			{
				payloadJson: {
					runEvent: {
						type: "review.evaluation_finished",
						data: {
							status: "completed",
							finalReviewerVerdict: "changes_requested",
							blockingFindingCount: 1,
						},
					},
				},
			},
			{
				payloadJson: {
					runEvent: {
						type: "review.evaluation_finished",
						data: {
							status: "completed",
							finalReviewerVerdict: "approved",
							blockingFindingCount: 0,
						},
					},
				},
			},
		]);

		expect(feedback).toBeNull();
	});

	it("does not expose internal SystemContext in user-facing Test Mode review closeout reports", () => {
		const report = appendTestModeReviewFixRequired({
			finalReport: [
				"レビュー指摘が残りました。",
				"SystemContext: コードレビューをしてください。改善するべき点が無くなるまで改善してください",
				"Action: 指摘を即座に修正し、必要な run_check / completion_check の後、reviewer_evaluation を再実行してください。approved になるまで最終報告しないでください。",
			].join("\n"),
			feedback: {
				verdict: "changes_requested",
				status: "completed",
				blockingFindingCount: 1,
				findings: [
					{
						severity: "blocking",
						title: "Verification result is present",
						body: "Rubric criterion failed: Verification result is present",
					},
				],
			},
		});

		expect(report).toContain(
			"Test Mode reviewer_evaluation returned unresolved review findings.",
		);
		expect(report).toContain("blocking: Verification result is present");
		expect(report).toContain("レビュー指摘が残りました。");
		expect(report).not.toContain("SystemContext:");
		expect(report).not.toContain("Action:");
		expect(report).not.toContain(
			"コードレビューをしてください。改善するべき点が無くなるまで改善してください",
		);
	});
});
