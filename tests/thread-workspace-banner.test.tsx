import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkbenchStateBanner } from "../src/modules/nightworkers/components/ThreadWorkspaceBanner";
import type { WorkbenchSessionView } from "../src/modules/nightworkers/types";
import { buildTask, buildTaskRun } from "./helpers/nightworkers-fixtures";

const baseSessionView: WorkbenchSessionView = {
	task: buildTask({ status: "running" }),
	group: "processing",
	emailState: "running",
	primaryAction: "open_run",
	phase: "Implementing",
	progress: { percent: 65, phase: "Implementing", basis: [], blockers: [] },
	latestRun: buildTaskRun({ status: "running" }),
	artifactCounts: {},
	badges: [],
};

describe("WorkbenchStateBanner review state", () => {
	it("does not render the review-needed banner or its action buttons", () => {
		const markup = renderToStaticMarkup(
			<WorkbenchStateBanner
				sessionView={{
					...baseSessionView,
					emailState: "review_needed",
					codexContractWarnings: {
						totalCount: 3,
						warningCount: 2,
						errorCount: 1,
						items: [
							{
								code: "codex_open_todos_before_completion",
								severity: "error",
								count: 1,
								changedFiles: [],
							},
							{
								code: "codex_file_change_before_todo_replace",
								severity: "warning",
								count: 2,
								changedFiles: ["src/app.ts"],
							},
						],
					},
					codexMcpDiagnostics: {
						configSource: "inline_configured",
						observedNightWorkersTools: ["nightworkers.todo_list"],
						expectedTools: [
							"nightworkers.todo_list",
							"nightworkers.import_project",
						],
						degraded: true,
						tone: "warning",
						label: "MCP degraded",
					},
				}}
				model="test-model"
				onRemoveQueueEntry={vi.fn()}
				onRequeueQueueEntry={vi.fn()}
			/>,
		);

		expect(markup).toBe("");
		expect(markup).not.toContain("実行が完了しました。レビューが必要です。");
		expect(markup).not.toContain("Review");
		expect(markup).not.toContain("満足 / Accept");
		expect(markup).not.toContain("修正を依頼して再投入");
		expect(markup).not.toContain("採用しない / Archive");
		expect(markup).not.toContain("Decision support");
		expect(markup).not.toContain("Contract warnings");
		expect(markup).not.toContain("codex_open_todos_before_completion");
		expect(markup).not.toContain("MCP degraded");
		expect(markup).not.toContain("Codex contract diagnostics");
	});
});
