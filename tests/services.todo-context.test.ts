import { describe, expect, it } from "vitest";
import { buildTodoContextSnapshot } from "../api/services/todo-context";

describe("Todo context snapshots", () => {
	it("captures todo, selected procedure, and runtime prompt context", () => {
		const snapshot = buildTodoContextSnapshot({
			todo: {
				id: "todo-1",
				seq: 1,
				title: "Implement feature",
				description: "Feature details",
				taskType: "code_change",
				procedureId: "code-change",
				procedureSnapshot: {
					source: "builtin",
					id: "code-change",
					title: "Code Change",
					version: 1,
					digest: "sha256:procedure",
					sections: {
						"Use When": "use",
						Workflow: "flow",
						"Completion Gate": "gate",
						"Verification Strategy": "verify",
						"Report Contract": "report",
					},
				},
			},
			runContext: {
				compiledPrompt: "compiled",
				source: "task_prompt",
				degraded: false,
				request: {
					repositoryPath: "/repo",
					taskTitle: "Task",
					taskDescriptionDigest: "digest",
				},
				result: {
					digest: "run-context-digest",
					charCount: 8,
				},
			},
		});

		expect(snapshot).toMatchObject({
			version: 1,
			todo: {
				id: "todo-1",
				seq: 1,
				title: "Implement feature",
				taskType: "code_change",
			},
			selectedProcedure: {
				id: "code-change",
				digest: "sha256:procedure",
			},
			runContext: {
				source: "task_prompt",
				digest: "run-context-digest",
			},
			previousTodoSummaries: [],
		});
	});
});
