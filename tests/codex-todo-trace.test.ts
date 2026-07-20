import { describe, expect, it } from "vitest";
import { projectLatestCodexTodoTrace } from "../src/modules/nightworkers/codexTodoTrace";

describe("projectLatestCodexTodoTrace", () => {
	it("projects the latest Codex native plan without requiring Todo revisions", () => {
		const result = projectLatestCodexTodoTrace([
			{
				id: "event-1",
				message: "old",
				payloadJson: {
					runEvent: {
						version: 1,
						runId: "run-1",
						timestamp: "2026-07-20T00:00:00.000Z",
						type: "tool.call_progress",
						severity: "info",
						actor: "worker",
						message: "old",
						data: {
							provider: "codex",
							providerItemId: "plan-1",
							providerItemType: "todo_list",
							toolName: "codex.update_plan",
							items: [{ text: "old", completed: false }],
						},
					},
				},
			},
			{
				id: "event-2",
				message: "latest",
				payloadJson: {
					runEvent: {
						version: 1,
						runId: "run-1",
						timestamp: "2026-07-20T00:00:01.000Z",
						type: "tool.call_finished",
						severity: "info",
						actor: "worker",
						message: "latest",
						data: {
							provider: "codex",
							providerItemId: "plan-2",
							providerItemType: "todo_list",
							toolName: "codex.update_plan",
							items: [
								{ text: "調査", completed: true },
								{ text: "実装", completed: false },
							],
						},
					},
				},
			},
		]);
		expect(result).toEqual([
			{ id: "plan-2:0", seq: 1, title: "調査", completed: true },
			{ id: "plan-2:1", seq: 2, title: "実装", completed: false },
		]);
	});
});
