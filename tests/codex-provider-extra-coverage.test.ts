import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildCodexResumedStructuredPrompt,
	buildCodexStructuredExecutionMode,
	callCodexProvider,
	callCodexProviderToolTurn,
} from "../api/services/structured-llm/codex-provider";

const mocks = vi.hoisted(() => {
	const constructorInputs: unknown[] = [];
	const startOptions: unknown[] = [];
	const resumeCalls: Array<{ id: string; options: unknown }> = [];
	const activityInputs: unknown[] = [];
	const startThreads: Array<Record<string, unknown>> = [];
	const resumeThreads: Array<Record<string, unknown>> = [];
	let endpoint: Record<string, unknown> | null = {
		id: "codex-endpoint",
		enabled: true,
		models: ["codex-model"],
	};
	let accessToken: string | null = null;
	let outputSchemaMode = {
		mode: "structured_output",
		reasons: ["supported"],
	};
	let resumeError: unknown;

	class MockCodex {
		constructor(input: unknown) {
			constructorInputs.push(input);
		}

		startThread(options: unknown) {
			startOptions.push(options);
			const thread = startThreads.shift();
			if (!thread) throw new Error("Missing queued start thread");
			return thread;
		}

		resumeThread(id: string, options: unknown) {
			resumeCalls.push({ id, options });
			if (resumeError !== undefined) throw resumeError;
			const thread = resumeThreads.shift();
			if (!thread) throw new Error("Missing queued resume thread");
			return thread;
		}
	}

	return {
		MockCodex,
		constructorInputs,
		startOptions,
		resumeCalls,
		activityInputs,
		startThreads,
		resumeThreads,
		get endpoint() {
			return endpoint;
		},
		setEndpoint(value: Record<string, unknown> | null) {
			endpoint = value;
		},
		get accessToken() {
			return accessToken;
		},
		setAccessToken(value: string | null) {
			accessToken = value;
		},
		get outputSchemaMode() {
			return outputSchemaMode;
		},
		setOutputSchemaMode(value: { mode: string; reasons: string[] }) {
			outputSchemaMode = value;
		},
		setResumeError(value: unknown) {
			resumeError = value;
		},
		reset() {
			constructorInputs.length = 0;
			startOptions.length = 0;
			resumeCalls.length = 0;
			activityInputs.length = 0;
			startThreads.length = 0;
			resumeThreads.length = 0;
			endpoint = {
				id: "codex-endpoint",
				enabled: true,
				models: ["codex-model"],
			};
			accessToken = null;
			outputSchemaMode = {
				mode: "structured_output",
				reasons: ["supported"],
			};
			resumeError = undefined;
		},
	};
});

vi.mock("@openai/codex-sdk", () => ({ Codex: mocks.MockCodex }));
vi.mock(
	"../api/services/structured-llm/openai-compatible-provider-support",
	() => ({
		getResolvedProviderEndpoint: () => mocks.endpoint,
		toCodexReasoningEffort: (value: string) => `effort:${value}`,
	}),
);
vi.mock("../api/services/structured-llm/codex-auth-scope", () => ({
	resolveCodexEndpointAccessToken: () => mocks.accessToken,
}));
vi.mock("../api/services/structured-llm/codex-output-schema", () => ({
	resolveCodexOutputSchemaMode: () => mocks.outputSchemaMode,
}));
vi.mock("../api/services/structured-llm/events", () => ({
	traceProviderActivity: (input: unknown) => {
		mocks.activityInputs.push(input);
	},
}));

const cleanupDirectories: string[] = [];

beforeEach(() => {
	mocks.reset();
});

afterEach(() => {
	delete process.env.NIGHTWORKERS_CODEX_HOME;
	delete process.env.CODEX_HOME;
	for (const directory of cleanupDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

describe("codex provider extra coverage", () => {
	it("builds execution modes and compact resumed prompts", () => {
		expect(
			buildCodexStructuredExecutionMode({
				model: null,
				schemaName: "schema",
			}),
		).toBe("structured:structured:default-model:schema");
		expect(
			buildCodexStructuredExecutionMode({
				policy: policy({ allowProviderTools: true }),
				model: "model",
				schemaName: "schema",
			}),
		).toBe("structured:provider-tools:model:schema");

		const short = buildCodexResumedStructuredPrompt({
			schemaName: "short",
			systemPrompt: "  stable context  ",
			userPrompt: "next",
		});
		expect(short).toContain("stable context");
		expect(short).not.toContain("truncated");

		const long = buildCodexResumedStructuredPrompt({
			schemaName: "long",
			systemPrompt: ` ${"x".repeat(2_050)} `,
			userPrompt: "next",
		});
		expect(long).toContain("50 chars omitted");
	});

	it("rejects inactive providers and child credentials", async () => {
		mocks.setEndpoint({ id: "disabled", enabled: false, models: [] });
		await expect(
			callCodexProvider(baseInput(), () => false, {}),
		).rejects.toThrow("Codex provider is inactive");

		mocks.setEndpoint({ id: "enabled", enabled: true, models: [] });
		mocks.setAccessToken("secret");
		await expect(
			callCodexProvider(baseInput(), () => false, {}),
		).rejects.toThrow("CODEX_CHILD_PROVIDER_CREDENTIAL_BLOCKED");
		expect(mocks.constructorInputs).toHaveLength(0);
	});

	it("runs a fresh structured call with prompt-validated JSON", async () => {
		mocks.setOutputSchemaMode({
			mode: "prompt_validated_json",
			reasons: ["unsupported-keyword"],
		});
		const thread = makeThread("fresh-thread", [
			{
				finalResponse: "answer",
				items: [
					{ type: "mcp_tool_call", server: "server", tool: "tool" },
					{ type: "web_search_call" },
				],
				usage: undefined,
			},
		]);
		mocks.startThreads.push(thread);
		const setProviderDebug = vi.fn();
		const result = await callCodexProvider(
			baseInput({
				options: {
					label: "artifact",
					jsonSchema: { name: "artifact", schema: { type: "object" } },
					normalizedRequest: {
						callKind: "structured_artifact",
						thinkingDepth: "medium",
					},
					executionPolicy: policy({
						isolatedHome: false,
						enableMcp: true,
						enableMemory: true,
					}),
				},
				setProviderDebug,
			}),
			() => false,
			{},
		);

		expect(result.content).toBe("answer");
		expect(result.model).toBe("codex-model");
		expect((thread.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toEqual(
			{
				signal: expect.any(AbortSignal),
			},
		);
		expect(mocks.activityInputs).toHaveLength(1);
		expect(mocks.activityInputs[0]).toMatchObject({
			toolName: "server.tool",
			preview: "server.tool",
		});
		expect(setProviderDebug).toHaveBeenCalledWith(
			expect.objectContaining({
				providerMode: "prompt_validated_json",
				freshThread: true,
				providerThreadId: "fresh-thread",
				hasUsage: false,
				agenticItemCount: 2,
			}),
		);
		const workingDirectory = (
			mocks.startOptions[0] as { workingDirectory: string }
		).workingDirectory;
		expect(fs.existsSync(workingDirectory)).toBe(false);
	});

	it("copies auth into an isolated home and cleans it afterward", async () => {
		const sourceHome = fs.mkdtempSync(
			path.join(os.tmpdir(), "codex-provider-source-"),
		);
		cleanupDirectories.push(sourceHome);
		fs.writeFileSync(path.join(sourceHome, "auth.json"), "auth");
		process.env.NIGHTWORKERS_CODEX_HOME = `  ${sourceHome}  `;
		const thread = makeThread("isolated", [
			{ finalResponse: "ok", items: [], usage: {} },
		]);
		mocks.startThreads.push(thread);

		await callCodexProvider(
			baseInput({
				options: {
					label: "isolated",
					executionPolicy: policy({
						isolatedHome: true,
						enableMcp: false,
						enableMemory: false,
						developerInstructions: "instructions",
					}),
				},
			}),
			() => false,
			{},
		);

		const constructorInput = mocks.constructorInputs[0] as {
			env: { CODEX_HOME: string };
			config: Record<string, unknown>;
		};
		expect(constructorInput.config).toMatchObject({
			mcp_servers: {},
			project_doc_max_bytes: 0,
			developer_instructions: "instructions",
			features: { memories: false },
		});
		expect(fs.existsSync(constructorInput.env.CODEX_HOME)).toBe(false);
	});

	it("resumes a stored session, persists it, and reduces the prompt", async () => {
		const thread = makeThread("resumed-thread", [
			{
				finalResponse: "resumed",
				items: [{ type: "command_execution", command: "pwd" }],
				usage: { input_tokens: 2, output_tokens: 1 },
			},
		]);
		mocks.resumeThreads.push(thread);
		const store = makeStore({ id: "state-1", providerSessionId: "stored" });
		const result = await callCodexProvider(
			baseInput({
				options: {
					label: "resume",
					taskId: "task-1",
					runId: "run-1",
					role: "plan",
					runtimeSessionStore: store,
					normalizedRequest: { modelOrDeployment: "requested-model" },
					jsonSchema: { name: "resume-schema", schema: {} },
				},
			}),
			() => false,
			{},
		);

		expect(mocks.resumeCalls[0]?.id).toBe("stored");
		expect(thread.run).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					text: expect.stringContaining("Continue the existing"),
				}),
			],
			expect.objectContaining({ outputSchema: {} }),
		);
		expect(result.providerDebug).toMatchObject({
			resumeState: "reused",
			resumedInputReduced: true,
		});
		expect(store.upsertRuntimeSessionState).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				runId: "run-1",
				providerSessionId: "resumed-thread",
				model: "requested-model",
			}),
		);
	});

	it("starts fresh when resume construction throws a non-Error", async () => {
		mocks.setResumeError("resume exploded");
		mocks.startThreads.push(
			makeThread("fallback", [
				{ finalResponse: "fallback", items: null, usage: {} },
			]),
		);
		const store = makeStore({ id: "state-2", providerSessionId: "stored" });
		const result = await callCodexProvider(
			baseInput({
				options: {
					label: "fallback",
					taskId: "task-2",
					runtimeSessionStore: store,
				},
			}),
			() => false,
			{},
		);

		expect(store.markRuntimeSessionStateResumeFailed).toHaveBeenCalledWith({
			id: "state-2",
			error: "resume exploded",
		});
		expect(result.providerDebug).toMatchObject({
			resumeState: "fallback_started_fresh",
			resumedInputReduced: false,
			itemCount: 0,
		});
	});

	it("retries a fresh thread when the resumed run fails", async () => {
		const resumed = makeThread("stored", [new Error("run resume failed")]);
		const fresh = makeThread("fresh-after-run", [
			{ finalResponse: undefined, items: [], usage: {} },
		]);
		mocks.resumeThreads.push(resumed);
		mocks.startThreads.push(fresh);
		const store = makeStore({ id: "state-3", providerSessionId: "stored" });

		const result = await callCodexProvider(
			baseInput({
				options: {
					label: "retry",
					taskId: "task-3",
					runtimeSessionStore: store,
				},
			}),
			() => false,
			{},
		);

		expect(store.markRuntimeSessionStateResumeFailed).toHaveBeenCalledWith({
			id: "state-3",
			error: "run resume failed",
		});
		expect(fresh.run).toHaveBeenCalledWith(
			[
				{ type: "text", text: "system" },
				{ type: "text", text: "user" },
			],
			expect.any(Object),
		);
		expect(result.content).toBe("");
	});

	it("propagates failures from a non-resumed run", async () => {
		mocks.startThreads.push(makeThread("fresh", ["plain failure"]));
		await expect(callCodexProvider(baseInput(), () => false, {})).rejects.toBe(
			"plain failure",
		);
	});

	it("handles missing provider session and missing returned thread id", async () => {
		mocks.startThreads.push(
			makeThread(undefined, [{ finalResponse: "no id", items: [], usage: {} }]),
		);
		const store = makeStore({ id: "state", providerSessionId: null });
		const result = await callCodexProvider(
			baseInput({
				options: {
					label: "missing",
					taskId: "task-missing",
					runtimeSessionStore: store,
				},
			}),
			() => false,
			{},
		);

		expect(mocks.resumeCalls).toHaveLength(0);
		expect(store.upsertRuntimeSessionState).not.toHaveBeenCalled();
		expect(result.providerDebug.providerThreadId).toBeNull();
	});

	it("describes default agentic items without tracing unnormalized calls", async () => {
		mocks.startThreads.push(
			makeThread("agentic", [
				{
					finalResponse: "ok",
					items: [{ type: "computer_call" }, { type: "ignored" }],
					usage: {},
				},
			]),
		);
		const result = await callCodexProvider(baseInput(), () => false, {});
		expect(mocks.activityInputs).toHaveLength(0);
		expect(result.providerDebug.agenticItemCount).toBe(1);
	});

	it("returns an unsupported tool turn when provider tools are disabled", async () => {
		const setProviderDebug = vi.fn();
		const result = await callCodexProviderToolTurn(
			toolInput({ setProviderDebug }),
			() => false,
			{},
		);
		expect(result).toMatchObject({
			type: "unsupported",
			providerDebug: {
				providerEndpointId: "endpoint",
				allowProviderTools: false,
			},
		});
		expect(setProviderDebug).not.toHaveBeenCalled();
	});

	it("rejects malformed and provider-active tool turns", async () => {
		mocks.startThreads.push(
			makeThread("malformed", [
				{ finalResponse: " malformed ", items: [], usage: {} },
			]),
		);
		await expect(
			callCodexProviderToolTurn(
				toolInput({
					options: {
						executionPolicy: policy({ allowProviderTools: true }),
					},
				}),
				() => false,
				{},
			),
		).rejects.toMatchObject({ message: "malformed" });

		mocks.startThreads.push(
			makeThread("agentic-tool", [
				{
					finalResponse: JSON.stringify({ content: "", toolCalls: [] }),
					items: [{ type: "command_execution" }],
					usage: {},
				},
			]),
		);
		await expect(
			callCodexProviderToolTurn(
				toolInput({
					options: {
						executionPolicy: policy({ allowProviderTools: true }),
					},
				}),
				() => false,
				{},
			),
		).rejects.toMatchObject({
			message: JSON.stringify({ content: "", toolCalls: [] }),
			kind: "permission",
			cause: {
				message: "Provider-side activity is disabled by execution policy.",
			},
		});
	});

	it("returns a supported parsed tool turn and augments debug data", async () => {
		mocks.startThreads.push(
			makeThread("tool", [
				{
					finalResponse: JSON.stringify({
						content: "done",
						toolCalls: [{ name: "read", argumentsJson: '{"path":"a"}' }],
					}),
					items: [],
					usage: {},
				},
			]),
		);
		const setProviderDebug = vi.fn();
		const result = await callCodexProviderToolTurn(
			toolInput({
				options: {
					executionPolicy: policy({ allowProviderTools: true }),
				},
				setProviderDebug,
			}),
			() => false,
			{},
		);

		expect(result).toMatchObject({
			type: "supported",
			content: "done",
			toolCalls: [{ name: "read", arguments: { path: "a" } }],
			providerDebug: {
				mode: "codex_structured_tool_turn",
				toolCallCount: 1,
			},
		});
		expect(setProviderDebug).toHaveBeenCalledTimes(2);
	});
});

function baseInput(overrides: Record<string, unknown> = {}) {
	return {
		provider: "codex",
		systemPrompt: "system",
		userPrompt: "user",
		options: { label: "schema" },
		signal: new AbortController().signal,
		setProviderDebug: vi.fn(),
		...overrides,
	} as never;
}

function toolInput(overrides: Record<string, unknown> = {}) {
	return {
		provider: "codex",
		messages: [],
		tools: [
			{
				name: "read",
				description: "read",
				inputSchema: { type: "object" },
			},
		],
		systemPrompt: "system",
		userPrompt: "user",
		signal: new AbortController().signal,
		setProviderDebug: vi.fn(),
		...overrides,
		options: {
			label: "tool",
			normalizedRequest: {
				providerEndpointId: "endpoint",
				diagnostics: {},
			},
			...((overrides.options as Record<string, unknown> | undefined) ?? {}),
		},
	} as never;
}

function makeThread(
	id: string | undefined,
	runs: unknown[],
): Record<string, unknown> {
	return {
		id,
		run: vi.fn(async () => {
			const value = runs.shift();
			if (value instanceof Error || typeof value === "string") throw value;
			return value;
		}),
	};
}

function makeStore(state: { id: string; providerSessionId: string | null }) {
	return {
		getLatestRuntimeSessionStateForTask: vi.fn(async () => state),
		markRuntimeSessionStateResumeFailed: vi.fn(async () => null),
		upsertRuntimeSessionState: vi.fn(async () => state),
	} as never;
}

function policy(overrides: Record<string, unknown> = {}) {
	return {
		isolatedHome: false,
		enableMcp: false,
		enableMemory: false,
		allowProviderTools: false,
		...overrides,
	} as never;
}
