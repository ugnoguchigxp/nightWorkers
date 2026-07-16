import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { missionPilotProviderPort } from "../../api/modules/missionPilot/agent/mission-pilot-provider.port";
import {
	buildCodexToolTurnJsonSchema,
	parseCodexToolTurnResponse,
} from "../../api/services/structured-llm/codex-tool-turn";
import { installStructuredLlmEnvHooks } from "./structured-llm-test-env";

const codexMock = vi.hoisted(() => {
	const runInputs: unknown[] = [];
	const runOptions: unknown[] = [];
	const constructorInputs: unknown[] = [];
	const startedThreadOptions: unknown[] = [];
	let finalResponse = "";

	class MockThread {
		id = "mission-pilot-codex-thread";

		async run(input: unknown, options?: unknown) {
			runInputs.push(input);
			runOptions.push(options);
			return {
				finalResponse,
				items: [],
				usage: {
					input_tokens: 10,
					cached_input_tokens: 0,
					output_tokens: 4,
					reasoning_output_tokens: 0,
				},
			};
		}
	}

	class MockCodex {
		constructor(options: unknown) {
			constructorInputs.push(options);
		}

		startThread(options?: unknown) {
			startedThreadOptions.push(options);
			return new MockThread();
		}
	}

	return {
		MockCodex,
		runInputs,
		runOptions,
		constructorInputs,
		startedThreadOptions,
		setFinalResponse(value: string) {
			finalResponse = value;
		},
		reset() {
			runInputs.length = 0;
			runOptions.length = 0;
			constructorInputs.length = 0;
			startedThreadOptions.length = 0;
			finalResponse = "";
		},
	};
});

vi.mock("@openai/codex-sdk", () => ({ Codex: codexMock.MockCodex }));

installStructuredLlmEnvHooks();

describe("Codex Mission Pilot tool turns", () => {
	beforeEach(() => codexMock.reset());

	it("keeps assistant text and malformed tool arguments losslessly available", () => {
		const parsed = parseCodexToolTurnResponse(
			JSON.stringify({
				content: "引数を確認します。",
				toolCalls: [
					{
						name: "read_task_workspace",
						argumentsJson: "{not-json",
					},
				],
			}),
		);
		expect(parsed).toMatchObject({
			ok: true,
			content: "引数を確認します。",
			toolCalls: [
				{
					name: "read_task_workspace",
					arguments: { _raw: "{not-json" },
				},
			],
		});
	});

	it("requires an empty tool call list when no tools are available", () => {
		expect(buildCodexToolTurnJsonSchema([])).toMatchObject({
			properties: {
				toolCalls: { type: "array", maxItems: 0 },
			},
		});
	});

	it("uses the configured Mission Pilot Codex role route without a fallback", async () => {
		const sourceCodexHome = path.join(
			path.dirname(llmSettingsPath()),
			"codex-source-home",
		);
		fs.mkdirSync(sourceCodexHome);
		fs.writeFileSync(path.join(sourceCodexHome, "auth.json"), "test-auth");
		process.env.NIGHTWORKERS_CODEX_HOME = sourceCodexHome;
		fs.writeFileSync(
			llmSettingsPath(),
			JSON.stringify({
				ACTIVE_LLM_PROVIDER: "codex",
				CODEX_ENABLED: true,
				providerEndpoints: [
					{
						id: "codex-mission-pilot",
						name: "Codex SDK",
						kind: "codex",
						enabled: true,
						models: ["gpt-5.6-luna"],
					},
				],
				roleRoutes: [
					{
						role: "mission_pilot",
						primary: {
							providerEndpointId: "codex-mission-pilot",
							model: "gpt-5.6-luna",
							thinkingDepth: "medium",
						},
						fallbacks: [],
					},
				],
			}),
		);
		codexMock.setFinalResponse(
			JSON.stringify({
				content: "Taskを読み、Plan Modeの次操作を判断します。",
				toolCalls: [
					{
						name: "read_task_workspace",
						argumentsJson: "{}",
					},
				],
			}),
		);

		const result = await missionPilotProviderPort.nextTurn({
			sessionId: "mission-session-1",
			taskId: "task-mission-codex",
			systemContext: "Mission Pilot system context",
			messages: [
				{ role: "system", content: "Mission Pilot system context" },
				{
					role: "user",
					content: "このTaskをPlan Modeから開始してください。",
				},
			],
			tools: [
				{
					name: "read_task_workspace",
					description: "現在のTaskを読む。",
					inputSchema: {
						type: "object",
						properties: {},
						additionalProperties: false,
					},
				},
			],
			providerEndpointId: null,
			model: null,
			thinkingDepth: null,
			signal: new AbortController().signal,
		});

		expect(result).toMatchObject({
			type: "supported",
			content: "Taskを読み、Plan Modeの次操作を判断します。",
			model: "gpt-5.6-luna",
			toolCalls: [
				{
					id: expect.stringMatching(/^codex_call_/),
					name: "read_task_workspace",
					arguments: {},
				},
			],
			providerDebug: expect.objectContaining({
				mode: "codex_structured_tool_turn",
				mcpEnabled: false,
				toolCallCount: 1,
			}),
		});
		expect(codexMock.startedThreadOptions).toEqual([
			expect.objectContaining({
				model: "gpt-5.6-luna",
				sandboxMode: "read-only",
			}),
		]);
		const constructorInput = codexMock.constructorInputs[0] as {
			env: Record<string, string>;
			config: Record<string, unknown>;
		};
		const isolatedCodexHome = constructorInput.env.CODEX_HOME;
		expect(isolatedCodexHome).not.toBe(sourceCodexHome);
		expect(isolatedCodexHome).toContain(
			"nightworkers-mission-pilot-codex-home-",
		);
		expect(fs.existsSync(isolatedCodexHome)).toBe(false);
		const codexConfig = constructorInput.config;
		expect(codexConfig).toMatchObject({
			features: { memories: false },
		});
		expect(codexConfig).not.toHaveProperty("mcp_servers");
		expect(codexConfig.developer_instructions).toContain("toolCallsへ出力");
		expect(JSON.stringify(codexMock.runInputs[0])).toContain(
			"このTaskをPlan Modeから開始してください。",
		);
		expect(JSON.stringify(codexMock.runInputs[0])).toContain(
			"read_task_workspace",
		);
		expect(codexMock.runOptions[0]).toMatchObject({
			outputSchema: expect.objectContaining({
				required: ["content", "toolCalls"],
			}),
		});
	});
});

function llmSettingsPath() {
	const settingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
	if (!settingsPath)
		throw new Error("NIGHTWORKERS_LLM_SETTINGS_PATH is required.");
	return settingsPath;
}
