import { describe, expect, it } from "vitest";
import { appendTestModeNextStepLink } from "../api/modules/nightworkers/run-orchestration/runtime-execution";

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
});
