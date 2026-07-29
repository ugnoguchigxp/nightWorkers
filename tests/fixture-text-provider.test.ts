import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callFixtureProvider } from "../api/services/structured-llm/fixture-provider";
import { clearFixtureProviderTask } from "../api/services/structured-llm/fixture-provider-task";
import {
	clearFixtureProviderTextOutputs,
	hasFixtureProviderTextOutputs,
	registerFixtureProviderTextOutputs,
	takeFixtureProviderTextOutput,
} from "../api/services/structured-llm/fixture-text-provider";
import {
	hasFixtureProviderToolTurns,
	registerFixtureProviderToolTurns,
} from "../api/services/structured-llm/fixture-tool-provider";

const taskIds = ["task-a", "task-b"];

describe("Task-scoped structured fixture text", () => {
	beforeEach(() => {
		process.env.NODE_ENV = "test";
		process.env.NIGHTWORKERS_E2E_ISOLATED = "1";
		delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
	});

	afterEach(() => {
		for (const taskId of taskIds) clearFixtureProviderTextOutputs(taskId);
		delete process.env.NIGHTWORKERS_E2E_ISOLATED;
		delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
	});

	it("isolates queues, replaces registration, and fails on exhaustion", () => {
		registerFixtureProviderTextOutputs("task-a", ["a-1", "a-2"]);
		registerFixtureProviderTextOutputs("task-b", ["b-1"]);
		expect(takeFixtureProviderTextOutput("task-b")).toBe("b-1");
		expect(takeFixtureProviderTextOutput("task-a")).toBe("a-1");
		registerFixtureProviderTextOutputs("task-a", ["a-replaced"]);
		expect(takeFixtureProviderTextOutput("task-a")).toBe("a-replaced");
		expect(() => takeFixtureProviderTextOutput("task-a")).toThrow(
			/queue is exhausted/,
		);
	});

	it("takes a registered Task output before the environment fixture", () => {
		process.env.SUPERVISOR_FIXTURE_OUTPUT = "environment";
		registerFixtureProviderTextOutputs("task-a", ["task"]);
		const result = callFixtureProvider({
			provider: "fixture",
			systemPrompt: "system",
			userPrompt: "user",
			options: {
				label: "fixture-test",
				taskId: "task-a",
			},
			setProviderDebug: vi.fn(),
		});
		expect(result.content).toBe("task");
	});

	it("keeps the environment fixture compatible when no Task queue exists", () => {
		process.env.SUPERVISOR_FIXTURE_OUTPUT = "environment";
		const result = callFixtureProvider({
			provider: "fixture",
			systemPrompt: "system",
			userPrompt: "user",
			options: { label: "fixture-test", taskId: "task-a" },
			setProviderDebug: vi.fn(),
		});
		expect(result.content).toBe("environment");
		expect(hasFixtureProviderTextOutputs("task-a")).toBe(false);
	});

	it("rejects registration and consumption outside isolated E2E", () => {
		delete process.env.NIGHTWORKERS_E2E_ISOLATED;
		expect(() =>
			registerFixtureProviderTextOutputs("task-a", ["value"]),
		).toThrow(/only in isolated E2E/);
		expect(() => takeFixtureProviderTextOutput("task-a")).toThrow(
			/only in isolated E2E/,
		);
	});

	it("rejects registration in production", () => {
		process.env.NODE_ENV = "production";
		expect(() =>
			registerFixtureProviderTextOutputs("task-a", ["value"]),
		).toThrow(/only in isolated E2E/);
	});

	it("clears both structured text and tool turns for a Task", () => {
		registerFixtureProviderTextOutputs("task-a", ["text"]);
		registerFixtureProviderToolTurns("task-a", [
			{ content: "turn", toolCalls: [] },
		]);

		clearFixtureProviderTask("task-a");

		expect(hasFixtureProviderTextOutputs("task-a")).toBe(false);
		expect(hasFixtureProviderToolTurns("task-a")).toBe(false);
	});
});
