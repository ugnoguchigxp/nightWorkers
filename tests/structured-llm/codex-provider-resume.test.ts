import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { missionPilotArtifactProviderExecutionPolicy } from "../../api/modules/missionPilot/adapters/mission-pilot-provider.adapter";
import type {
	RuntimeSessionStateLookup,
	RuntimeSessionStateStore,
} from "../../api/services/runtime-session-state";
import {
	callStructuredLlmResult,
	createStructuredOutputContract,
} from "../../api/services/structured-llm";
import { installStructuredLlmEnvHooks } from "./structured-llm-test-env";

const codexMock = vi.hoisted(() => {
	const runInputs: unknown[] = [];
	const constructorInputs: unknown[] = [];
	const startedThreadOptions: unknown[] = [];
	const startedThreadIds: string[] = [];
	const resumedThreadIds: string[] = [];
	let runItems: unknown[] = [];
	let nextThreadSeq = 1;

	class MockThread {
		id: string;

		constructor(id: string) {
			this.id = id;
		}

		async run(input: unknown) {
			runInputs.push(input);
			return {
				finalResponse: JSON.stringify({ ok: true }),
				items: runItems,
				usage: {
					input_tokens: 10,
					cached_input_tokens: 0,
					output_tokens: 2,
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
			const id = `thread-${nextThreadSeq++}`;
			startedThreadIds.push(id);
			return new MockThread(id);
		}

		resumeThread(id: string) {
			resumedThreadIds.push(id);
			return new MockThread(id);
		}
	}

	return {
		MockCodex,
		runInputs,
		constructorInputs,
		startedThreadOptions,
		startedThreadIds,
		resumedThreadIds,
		setRunItems: (items: unknown[]) => {
			runItems = items;
		},
		reset: () => {
			runInputs.length = 0;
			constructorInputs.length = 0;
			startedThreadOptions.length = 0;
			startedThreadIds.length = 0;
			resumedThreadIds.length = 0;
			runItems = [];
			nextThreadSeq = 1;
		},
	};
});

vi.mock("@openai/codex-sdk", () => ({
	Codex: codexMock.MockCodex,
}));

vi.mock("../../api/services/llm-usage", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../api/services/llm-usage")>();
	return {
		...actual,
		recordLlmUsage: vi.fn(async () => undefined),
	};
});

installStructuredLlmEnvHooks();

describe("Codex structured provider isolation", () => {
	beforeEach(() => {
		codexMock.reset();
	});

	it("runs provider authorization before creating a provider client", async () => {
		fs.writeFileSync(
			llmSettingsPath(),
			JSON.stringify({
				ACTIVE_LLM_PROVIDER: "codex",
				CODEX_ENABLED: true,
				CODEX_MODEL: "gpt-5.4-mini",
			}),
		);
		const authorizeProviderCall = vi.fn(async () => {
			throw new Error("provider disabled");
		});

		await expect(
			callStructuredLlmResult("system", "user", {
				contract: createStructuredOutputContract({
					name: "authorization_schema",
					runtimeSchema: z.object({ ok: z.boolean() }).strict(),
				}),
				taskId: "task-1",
				executionPolicy: {
					isolatedHome: true,
					enableMcp: false,
					enableMemory: false,
					allowProviderTools: false,
					authorizeProviderCall,
				},
			}),
		).rejects.toThrow("provider disabled");

		expect(authorizeProviderCall).toHaveBeenCalledWith({
			taskId: "task-1",
			signal: undefined,
		});
		expect(codexMock.constructorInputs).toHaveLength(0);
	});

	it("uses a fresh isolated call for every structured artifact generation", async () => {
		fs.writeFileSync(
			llmSettingsPath(),
			JSON.stringify({
				ACTIVE_LLM_PROVIDER: "codex",
				CODEX_ENABLED: true,
				CODEX_MODEL: "gpt-5.4-mini",
			}),
		);
		const store = createFakeRuntimeSessionStore();
		const longSystemPrompt = `system contract\n${"x".repeat(3000)}`;

		const exampleContract = createStructuredOutputContract({
			name: "example_schema",
			runtimeSchema: z.object({ ok: z.boolean() }).strict(),
		});
		const {
			authorizeProviderCall: _authorizeProviderCall,
			...isolatedArtifactPolicy
		} = missionPilotArtifactProviderExecutionPolicy;
		await callStructuredLlmResult(longSystemPrompt, "first user prompt", {
			contract: exampleContract,
			taskId: "task-1",
			role: "mission_pilot",
			executionPolicy: isolatedArtifactPolicy,
			runtimeSessionStore: store,
		});
		await callStructuredLlmResult(longSystemPrompt, "second user prompt", {
			contract: exampleContract,
			taskId: "task-1",
			role: "mission_pilot",
			executionPolicy: isolatedArtifactPolicy,
			runtimeSessionStore: store,
		});
		await callStructuredLlmResult(longSystemPrompt, "third user prompt", {
			contract: createStructuredOutputContract({
				name: "different_schema",
				runtimeSchema: z.object({ ok: z.boolean() }).strict(),
			}),
			taskId: "task-1",
			role: "mission_pilot",
			executionPolicy: isolatedArtifactPolicy,
			runtimeSessionStore: store,
		});

		expect(codexMock.startedThreadIds).toEqual([
			"thread-1",
			"thread-2",
			"thread-3",
		]);
		expect(codexMock.resumedThreadIds).toEqual([]);
		expect(codexMock.constructorInputs).toHaveLength(3);
		for (const input of codexMock.constructorInputs) {
			const config = (input as { config: Record<string, unknown> }).config;
			expect(config.features).toEqual({ memories: false });
			expect(config.features).not.toHaveProperty("mcp");
			expect(config.memories).toEqual({
				generate_memories: false,
				use_memories: false,
			});
			expect(config.mcp_servers).toEqual({});
			expect(config.developer_instructions).toContain(
				"Mission Pilotの構造化Artifact生成専用レーンです",
			);
			expect(config.project_doc_max_bytes).toBe(0);
		}
		expect(codexMock.startedThreadOptions).toHaveLength(3);
		for (const input of codexMock.startedThreadOptions) {
			const options = input as {
				workingDirectory: string;
				sandboxMode: string;
				approvalPolicy: string;
				networkAccessEnabled: boolean;
				webSearchMode: string;
			};
			expect(options.workingDirectory).not.toBe(process.cwd());
			expect(options.sandboxMode).toBe("read-only");
			expect(options.approvalPolicy).toBe("never");
			expect(options.networkAccessEnabled).toBe(false);
			expect(options.webSearchMode).toBe("disabled");
			expect(fs.existsSync(options.workingDirectory)).toBe(false);
		}
		expect(store.upsertRuntimeSessionState).not.toHaveBeenCalled();
		expect(JSON.stringify(codexMock.runInputs[0])).toContain(
			"first user prompt",
		);
		expect(JSON.stringify(codexMock.runInputs[1])).toContain(
			"second user prompt",
		);
		expect(JSON.stringify(codexMock.runInputs[2])).toContain(
			"third user prompt",
		);
	});

	it("keeps a valid structured response when the isolated turn used agentic items", async () => {
		fs.writeFileSync(
			llmSettingsPath(),
			JSON.stringify({
				ACTIVE_LLM_PROVIDER: "codex",
				CODEX_ENABLED: true,
				CODEX_MODEL: "gpt-5.4-mini",
			}),
		);
		codexMock.setRunItems([
			{
				id: "command-1",
				type: "command_execution",
				command: "rg --files .",
				aggregated_output: "",
				exit_code: 0,
				status: "completed",
			},
		]);
		const events: Array<{ type: string; data?: Record<string, unknown> }> = [];

		const result = await callStructuredLlmResult("system", "user", {
			contract: createStructuredOutputContract({
				name: "agentic_item_with_valid_response",
				runtimeSchema: z.object({ ok: z.boolean() }).strict(),
			}),
			taskId: "task-agentic-item",
			role: "plan",
			runtimeSessionStore: createFakeRuntimeSessionStore(),
			emitEvent: async (event) => {
				events.push(event);
			},
		});

		expect(result).toMatchObject({ ok: true, value: { ok: true } });
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "model.provider_activity_detected",
				data: expect.objectContaining({
					activityType: "agentic_item",
					toolName: "command_execution",
				}),
			}),
		);
		expect(
			events.some((event) => event.type === "model.provider_activity_rejected"),
		).toBe(false);
	});
});

function llmSettingsPath() {
	const settingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
	if (!settingsPath)
		throw new Error("NIGHTWORKERS_LLM_SETTINGS_PATH is required.");
	return settingsPath;
}

function createFakeRuntimeSessionStore() {
	const statesByLookup = new Map<
		string,
		{
			id: string;
			providerSessionId: string | null;
		}
	>();
	const store = {
		getLatestRuntimeSessionStateForTask: vi.fn(
			async (input: RuntimeSessionStateLookup) => {
				return statesByLookup.get(runtimeSessionLookupKey(input)) ?? null;
			},
		),
		upsertRuntimeSessionState: vi.fn(
			async (
				input: RuntimeSessionStateLookup & {
					providerSessionId?: string | null;
				},
			) => {
				const state = {
					id: `state-${statesByLookup.size + 1}`,
					providerSessionId: input.providerSessionId ?? null,
				};
				statesByLookup.set(runtimeSessionLookupKey(input), state);
				return state;
			},
		),
		markRuntimeSessionStateResumeFailed: vi.fn(async () => null),
	} as unknown as RuntimeSessionStateStore;
	return store;
}

function runtimeSessionLookupKey(input: {
	taskId?: string;
	runtimeLane?: string;
	provider?: string;
	executionMode?: string | null;
}) {
	return [
		input.taskId ?? "",
		input.runtimeLane ?? "",
		input.provider ?? "",
		input.executionMode ?? "",
	].join("|");
}
