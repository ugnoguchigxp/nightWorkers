import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	callFixtureProviderToolTurn,
	clearFixtureProviderToolTurns,
	hasFixtureProviderToolTurns,
	registerFixtureProviderToolTurns,
} from "../api/services/structured-llm/fixture-tool-provider";

const taskIds = ["fixture-a", "fixture-b", "fixture-c"];

function call(taskId: string, overrides: Record<string, unknown> = {}) {
	return callFixtureProviderToolTurn({
		taskId,
		systemPrompt: "system",
		userPrompt: "user",
		messages: [],
		setProviderDebug: vi.fn(),
		...overrides,
	} as never);
}

function toolMessage(value: unknown) {
	return {
		role: "tool",
		toolCallId: "call-1",
		content: typeof value === "string" ? value : JSON.stringify(value),
	} as const;
}

describe("fixture tool provider coverage", () => {
	beforeEach(() => {
		process.env.NODE_ENV = "test";
		process.env.NIGHTWORKERS_E2E_ISOLATED = "1";
	});

	afterEach(() => {
		for (const taskId of taskIds) clearFixtureProviderToolTurns(taskId);
		delete process.env.NIGHTWORKERS_E2E_ISOLATED;
		process.env.NODE_ENV = "test";
	});

	it("guards registration and calls outside isolated E2E", () => {
		process.env.NIGHTWORKERS_E2E_ISOLATED = "0";
		expect(hasFixtureProviderToolTurns("fixture-a")).toBe(false);
		expect(() => registerFixtureProviderToolTurns("fixture-a", [])).toThrow(
			"only in isolated E2E",
		);
		expect(() => call("fixture-a")).toThrow("only in isolated E2E");
		process.env.NIGHTWORKERS_E2E_ISOLATED = "1";
		process.env.NODE_ENV = "production";
		expect(() => registerFixtureProviderToolTurns("fixture-a", [])).toThrow();
		expect(() => call("fixture-a")).toThrow();
	});

	it("keeps scopes separate, clones turns, and clears both scopes", () => {
		const turns = [{ content: "default", toolCalls: [] }];
		registerFixtureProviderToolTurns("fixture-a", turns);
		registerFixtureProviderToolTurns(
			"fixture-a",
			[{ content: "implementation", toolCalls: [] }],
			"implementation",
		);
		turns[0].content = "mutated";
		expect(hasFixtureProviderToolTurns("fixture-a")).toBe(true);
		expect(hasFixtureProviderToolTurns("fixture-a", "implementation")).toBe(
			true,
		);
		expect(call("fixture-a")).toMatchObject({ content: "default" });
		expect(call("fixture-a", { scope: "implementation" })).toMatchObject({
			content: "implementation",
		});
		clearFixtureProviderToolTurns("fixture-a");
		expect(hasFixtureProviderToolTurns("fixture-a")).toBe(false);
		expect(hasFixtureProviderToolTurns("fixture-a", "implementation")).toBe(
			false,
		);
	});

	it("returns a deterministic empty-turn result and provider debug", () => {
		const setProviderDebug = vi.fn();
		const result = call("fixture-a", { setProviderDebug });
		expect(result).toMatchObject({
			type: "supported",
			content: "Fixture provider has no remaining scripted turn.",
			toolCalls: [],
			model: "fixture-native-tools",
			providerDebug: {
				provider: "fixture",
				remainingTurns: 0,
				toolCallCount: 0,
			},
		});
		expect(setProviderDebug).toHaveBeenCalledWith(result.providerDebug);
	});

	it("skips conditional turns unless a previous tool failed", () => {
		registerFixtureProviderToolTurns("fixture-a", [
			{
				content: "conditional",
				toolCalls: [],
				condition: "previous_tool_failed",
			},
			{ content: "next", toolCalls: [] },
		]);
		expect(
			call("fixture-a", {
				messages: [
					{ role: "assistant", content: "not tool" },
					toolMessage(""),
					toolMessage("{"),
					toolMessage({ ok: true }),
				],
			}),
		).toMatchObject({ content: "next" });

		for (const failure of [{ ok: false }, { failure: { message: "bad" } }]) {
			registerFixtureProviderToolTurns("fixture-b", [
				{
					content: "conditional",
					toolCalls: [],
					condition: "previous_tool_failed",
				},
			]);
			expect(
				call("fixture-b", { messages: [toolMessage(failure)] }),
			).toMatchObject({ content: "conditional" });
		}
	});

	it("resolves nested placeholders from current context and primitive values", () => {
		registerFixtureProviderToolTurns("fixture-a", [
			{
				content: "resolved",
				toolCalls: [
					{
						id: "tool-1",
						name: "execute_task_action",
						arguments: {
							revision: { $fixture: "taskRevision" },
							nested: [{ keep: true }, "plain", 3],
						},
					},
				],
			},
		]);
		const result = call("fixture-a", {
			systemPrompt:
				'prefix\n[Mission Pilot 現在のStep文脈]\n{"taskRef":{"revision":12}}',
		});
		expect(result.toolCalls[0]?.arguments).toEqual({
			revision: 12,
			nested: [{ keep: true }, "plain", 3],
		});
	});

	it("falls back to observed task revisions when context is absent or invalid", () => {
		for (const [systemPrompt, fact] of [
			["system", { deep: { task: { revision: 8 } } }],
			["[Mission Pilot 現在のStep文脈]\n{", [{ task: { revision: 9 } }]],
			[
				'[Mission Pilot 現在のStep文脈]\n{"taskRef":{"revision":1.5}}',
				{ task: { revision: 10 } },
			],
		] as const) {
			registerFixtureProviderToolTurns("fixture-a", [
				{
					content: "resolved",
					toolCalls: [
						{
							id: "tool",
							name: "action",
							arguments: { revision: { $fixture: "taskRevision" } },
						},
					],
				},
			]);
			expect(
				call("fixture-a", {
					systemPrompt,
					messages: [toolMessage(fact)],
				}).toolCalls[0]?.arguments.revision,
			).toBe(
				JSON.stringify(fact).includes("10")
					? 10
					: JSON.stringify(fact).includes("9")
						? 9
						: 8,
			);
		}
	});

	it("finds latest run ids in every supported result shape", () => {
		const facts = [
			[{ activeRun: { id: "active" } }, "active"],
			[{ latestTerminalRun: { id: "latest" } }, "latest"],
			[{ terminalRuns: [{ runId: "run-id" }] }, "run-id"],
			[{ terminalRuns: [{ id: "id-only" }] }, "id-only"],
			[{ nested: { id: "generic", status: "needs_review" } }, "generic"],
			[[{ id: "array-run", status: "completed" }], "array-run"],
		] as const;
		for (const [fact, expected] of facts) {
			registerFixtureProviderToolTurns("fixture-c", [
				{
					content: "run",
					toolCalls: [
						{
							id: "tool",
							name: "action",
							arguments: { runId: { $fixture: "latestRunId" } },
						},
					],
				},
			]);
			expect(
				call("fixture-c", { messages: [toolMessage(fact)] }).toolCalls[0]
					?.arguments.runId,
			).toBe(expected);
		}
	});

	it("throws when a placeholder has not been observed", () => {
		for (const fixture of ["taskRevision", "latestRunId"] as const) {
			registerFixtureProviderToolTurns("fixture-a", [
				{
					content: "missing",
					toolCalls: [
						{
							id: "tool",
							name: "action",
							arguments: { value: { $fixture: fixture } },
						},
					],
				},
			]);
			expect(() =>
				call("fixture-a", {
					messages: [
						{ role: "assistant", content: "ignored" },
						toolMessage("{"),
						toolMessage({ terminalRuns: [null], task: { revision: 1.5 } }),
					],
				}),
			).toThrow(`Fixture value ${fixture} was not observed yet.`);
		}
	});
});
