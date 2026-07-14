import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
	RuntimeSessionStateLookup,
	RuntimeSessionStateStore,
} from "../../api/services/agent-runtime/runtime-session-state";
import {
	callStructuredLlmResult,
	createStructuredOutputContract,
} from "../../api/services/structured-llm";
import { installStructuredLlmEnvHooks } from "./structured-llm-test-env";

const codexMock = vi.hoisted(() => {
	const runInputs: unknown[] = [];
	const startedThreadIds: string[] = [];
	const resumedThreadIds: string[] = [];
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
				items: [],
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
		startThread() {
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
		startedThreadIds,
		resumedThreadIds,
		reset: () => {
			runInputs.length = 0;
			startedThreadIds.length = 0;
			resumedThreadIds.length = 0;
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

describe("Codex structured provider thread resume", () => {
	beforeEach(() => {
		codexMock.reset();
	});

	it("reuses the persisted Codex thread and sends a compact resumed prompt", async () => {
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
		await callStructuredLlmResult(longSystemPrompt, "first user prompt", {
			contract: exampleContract,
			taskId: "task-1",
			role: "plan",
			runtimeSessionStore: store,
		});
		await callStructuredLlmResult(longSystemPrompt, "second user prompt", {
			contract: exampleContract,
			taskId: "task-1",
			role: "plan",
			runtimeSessionStore: store,
		});
		await callStructuredLlmResult(longSystemPrompt, "third user prompt", {
			contract: createStructuredOutputContract({
				name: "different_schema",
				runtimeSchema: z.object({ ok: z.boolean() }).strict(),
			}),
			taskId: "task-1",
			role: "plan",
			runtimeSessionStore: store,
		});

		expect(codexMock.startedThreadIds).toEqual(["thread-1", "thread-2"]);
		expect(codexMock.resumedThreadIds).toEqual(["thread-1"]);
		expect(store.upsertRuntimeSessionState).toHaveBeenCalledTimes(3);
		const resumedInput = JSON.stringify(codexMock.runInputs[1]);
		expect(resumedInput).toContain("Continue the existing NightWorkers");
		expect(resumedInput).toContain("second user prompt");
		expect(resumedInput).toContain("System prompt truncated");
		expect(resumedInput).not.toContain("x".repeat(2500));
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
