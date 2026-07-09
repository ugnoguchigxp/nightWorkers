import { describe, expect, it } from "vitest";
import {
	buildTestModeWorkflowSteps,
	isTestModeWorkflowComplete,
	selectTestModeWorkflowSteps,
} from "../src/modules/nightworkers/testModeWorkflowView";
import { buildTaskEvent, buildTaskRun } from "./helpers/nightworkers-fixtures";

describe("testModeWorkflowView", () => {
	it("uses frozen Test Mode workflow steps after a review run becomes latest", () => {
		const testRun = buildTaskRun({
			status: "completed",
			contextSnapshot: {
				executionMode: "test",
				testMode: { action: "plan_and_implement_tests" },
			},
			events: [
				managedToolEvent("run-check", "run_check", {
					ok: true,
					status: "completed",
					result: { checkKind: "test" },
				}),
				managedToolEvent("completion-check", "completion_check", {
					ok: true,
					status: "completed",
					result: { llmSummary: "OK completion_check" },
				}),
			],
		});
		const frozenSteps = buildTestModeWorkflowSteps({ latestRun: testRun });
		expect(isTestModeWorkflowComplete(frozenSteps)).toBe(true);

		const reviewRun = buildTaskRun({
			status: "running",
			contextSnapshot: {
				executionMode: "review",
			},
			events: [
				managedToolEvent("review-run-check", "run_check", {
					ok: false,
					status: "failed",
					result: { checkKind: "test" },
				}),
			],
		});
		const liveSteps = buildTestModeWorkflowSteps({ latestRun: reviewRun });

		expect(liveSteps.map((step) => step.status)).toEqual([
			"pending",
			"pending",
			"pending",
		]);
		expect(
			selectTestModeWorkflowSteps({
				liveSteps,
				frozenSteps,
				latestRun: reviewRun,
			}).map((step) => step.status),
		).toEqual(["passed", "passed", "passed"]);
	});

	it("prefers live steps while a new Test Mode run is active", () => {
		const frozenSteps = [
			{
				id: "implementation_start" as const,
				todoTitle: "start",
				status: "passed" as const,
			},
			{
				id: "unit_test" as const,
				todoTitle: "test",
				status: "passed" as const,
			},
			{
				id: "evidence_check" as const,
				todoTitle: "evidence",
				status: "passed" as const,
			},
		];
		const newTestRun = buildTaskRun({
			status: "running",
			contextSnapshot: {
				executionMode: "test",
				testMode: { action: "plan_and_implement_tests" },
			},
			events: [
				managedToolEvent("read-spec", "read_current_specification", {
					ok: true,
					status: "completed",
					result: { payload: {} },
				}),
			],
		});
		const liveSteps = buildTestModeWorkflowSteps({ latestRun: newTestRun });

		expect(
			selectTestModeWorkflowSteps({
				liveSteps,
				frozenSteps,
				latestRun: newTestRun,
			}),
		).toBe(liveSteps);
		expect(liveSteps.map((step) => step.status)).toEqual([
			"running",
			"running",
			"pending",
		]);
	});
});

function managedToolEvent(
	id: string,
	toolName: string,
	data: Record<string, unknown>,
) {
	return buildTaskEvent({
		id,
		payloadJson: {
			runEvent: {
				data: {
					toolName,
					...data,
				},
			},
		},
	});
}
