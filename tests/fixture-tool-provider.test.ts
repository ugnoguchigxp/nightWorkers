import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	callFixtureProviderToolTurn,
	clearFixtureProviderToolTurns,
	hasFixtureProviderToolTurns,
	registerFixtureProviderToolTurns,
} from "../api/services/structured-llm/fixture-tool-provider";

describe("Task-scoped tool fixture placeholders", () => {
	beforeEach(() => {
		process.env.NODE_ENV = "test";
		process.env.NIGHTWORKERS_E2E_ISOLATED = "1";
	});

	afterEach(() => {
		clearFixtureProviderToolTurns("task-a");
		clearFixtureProviderToolTurns("task-scoped");
		delete process.env.NIGHTWORKERS_E2E_ISOLATED;
	});

	it("resolves latestRunId from the Task Operator terminal Run, not its queue", () => {
		registerFixtureProviderToolTurns("task-a", [
			{
				content: "complete",
				toolCalls: [
					{
						id: "complete",
						name: "execute_task_action",
						arguments: {
							sourceRunId: { $fixture: "latestRunId" },
						},
					},
				],
			},
		]);

		const result = callFixtureProviderToolTurn({
			taskId: "task-a",
			systemPrompt: "system",
			userPrompt: "user",
			messages: [
				{
					role: "tool",
					toolCallId: "read",
					content: JSON.stringify({
						ok: true,
						data: {
							queue: {
								id: "queue-entry",
								revision: 2,
								status: "completed",
								activeRunId: null,
							},
							activeRun: null,
							latestTerminalRun: {
								id: "task-run",
								revision: 3,
								status: "completed",
								outcomeDigest: "sha256:fixture",
							},
						},
					}),
				},
			],
			setProviderDebug: vi.fn(),
		});

		expect(result.type).toBe("supported");
		if (result.type !== "supported") return;
		expect(result.toolCalls[0]?.arguments.sourceRunId).toBe("task-run");
	});

	it("never falls back from implementation turns to another role scope", () => {
		registerFixtureProviderToolTurns("task-scoped", [
			{ content: "mission pilot only", toolCalls: [] },
		]);
		expect(hasFixtureProviderToolTurns("task-scoped", "default")).toBe(true);
		expect(hasFixtureProviderToolTurns("task-scoped", "implementation")).toBe(
			false,
		);
	});
});
