import { describe, expect, it } from "vitest";
import {
	appendTestModeNextStepLink,
	sanitizeReviewFinalReportLinks,
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

	it("removes review final report links to local files outside the project tree", () => {
		const report = sanitizeReviewFinalReportLinks(
			[
				"確認した主な点:",
				"- 修正対象: [`api/routes/todo.route.ts`]( /Users/y.noguchi/Code/todolist/api/routes/todo.route.ts#L26 )",
				"- Findings 保存先: [`/private/tmp/todolist-review-findings.md`]( /private/tmp/todolist-review-findings.md )",
			].join("\n"),
			"/Users/y.noguchi/Code/todolist",
		);

		expect(report).toContain(
			"[`api/routes/todo.route.ts`]( /Users/y.noguchi/Code/todolist/api/routes/todo.route.ts#L26 )",
		);
		expect(report).toContain(
			"- Findings 保存先: `外部ファイルへのリンクは省略しました`",
		);
		expect(report).not.toContain("](/private/tmp");
		expect(report).not.toContain("todolist-review-findings.md");
	});
});
