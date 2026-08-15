import { describe, expect, it } from "vitest";
import {
	listIncompleteTodos,
	toAgentRuntimeTodoContext,
} from "../api/modules/nightworkers/run-orchestration/todo-closeout";

describe("Todo closeout critical branches", () => {
	it("keeps every non-terminal Todo state and excludes terminal states", () => {
		const todos = [
			{ id: "pending", status: "pending" },
			{ id: "running", status: "running" },
			{ id: "human", status: "needs_human" },
			{ id: "completed", status: "completed" },
			{ id: "failed", status: "failed" },
		];

		expect(listIncompleteTodos(todos).map((todo) => todo.id)).toEqual([
			"pending",
			"running",
			"human",
		]);
	});

	it("normalizes malformed acceptance evidence without changing Todo fields", () => {
		const base = {
			id: "todo-1",
			seq: 1,
			title: "Verify",
			description: "Run verification",
			objective: "Prove the change",
			context: "system context",
			nextAction: "run tests",
			lastFailure: null,
			attemptCount: 2,
			revision: 3,
			systemContextVersion: 1,
			taskType: "verification",
			status: "running",
			procedureId: null,
		};
		const mixed = toAgentRuntimeTodoContext({
			...base,
			acceptanceCriteriaJson: ["AC-1", 2, null, "AC-2"],
		} as never);
		const malformed = toAgentRuntimeTodoContext({
			...base,
			acceptanceCriteriaJson: { value: "AC-1" },
		} as never);

		expect(mixed).toMatchObject({
			id: "todo-1",
			systemContext: "system context",
			context: "system context",
			acceptanceCriteria: ["AC-1", "AC-2"],
		});
		expect(malformed.acceptanceCriteria).toEqual([]);
	});
});
