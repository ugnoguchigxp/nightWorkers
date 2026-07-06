import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import type { NativeApiToolTurnProvider } from "../../api/services/agent-runtime/native-api-runner/native-api-runner";
import type { NativeApiSessionStore } from "../../api/services/agent-runtime/native-api-runner/native-api-session-store";
import type {
	AgentRunContext,
	AgentRuntimeEvent,
} from "../../api/services/agent-runtime/types";
import type { ProviderToolTurnResult } from "../../api/services/structured-llm/tool-calls";

export function createProvider(
	results: ProviderToolTurnResult[],
): NativeApiToolTurnProvider {
	const providerTurn = vi.fn(async () => {
		const result = results.shift();
		if (!result) throw new Error("No provider result queued.");
		return result;
	});
	return providerTurn as unknown as NativeApiToolTurnProvider;
}

export function createFakeStore() {
	const turns: Array<Record<string, unknown>> = [];
	const finishedTurns: Array<Record<string, unknown>> = [];
	const toolCalls: Array<Record<string, unknown>> = [];
	const runningToolCalls: string[] = [];
	const finishedToolCalls: Array<Record<string, unknown>> = [];
	const instance = {
		createTurn: vi.fn(async (input) => {
			const turn = {
				...input,
				id: `turn-${turns.length + 1}`,
			};
			turns.push(turn);
			return turn;
		}),
		finishTurn: vi.fn(async (input) => {
			finishedTurns.push(input);
			return input;
		}),
		recordToolCallPending: vi.fn(async (input) => {
			const record = {
				...input,
				id: `tool-${toolCalls.length + 1}`,
				toolName: input.toolCall.name,
				status: "pending",
			};
			toolCalls.push(record);
			return record;
		}),
		markToolCallRunning: vi.fn(async ({ id }) => {
			runningToolCalls.push(id);
			return { id, status: "running" };
		}),
		finishToolCall: vi.fn(async (input) => {
			finishedToolCalls.push(input);
			return input;
		}),
	} as unknown as NativeApiSessionStore;
	return {
		instance,
		turns,
		finishedTurns,
		toolCalls,
		runningToolCalls,
		finishedToolCalls,
	};
}

export function createNoopStartup() {
	return {
		runStartup: vi.fn(async (input) => ({
			ok: true as const,
			history: input.history,
			state: input.state,
		})),
	};
}

export function createSink(events: AgentRuntimeEvent[] = []) {
	return {
		emit: vi.fn(async (event: AgentRuntimeEvent) => {
			events.push(event);
		}),
	};
}

export function usage() {
	return {
		inputTokens: 10,
		outputTokens: 5,
		cachedInputTokens: null,
		reasoningOutputTokens: null,
		totalTokens: 15,
		mode: "measured" as const,
	};
}

export function buildContext(
	overrides: Partial<AgentRunContext> = {},
): AgentRunContext {
	return {
		runId: "run-1",
		taskId: "task-1",
		repositoryId: "repo-1",
		repoRoot: "/Users/y.noguchi/Code/nightWorkers",
		compiledPrompt: "implement the requested change",
		latestUserMessage: "implement the requested change",
		timeoutSeconds: 60,
		contextSnapshot: {
			compiledPrompt: "implement the requested change",
			source: "fallback",
		},
		...overrides,
	};
}

export function buildContextWithNativeApiRoute(
	overrides: Partial<AgentRunContext> = {},
): AgentRunContext {
	return buildContext({
		runtimeOptions: {
			executionMode: "implementation",
			llmRouting: {
				executionMode: "implementation",
				active: {
					providerId: "openai",
					providerEndpointId: "test-openai",
					model: "test-model",
				},
			},
		},
		...overrides,
	});
}

export function defaultNativeApiRunnerSettings(): Record<string, unknown> {
	return {
		ACTIVE_LLM_PROVIDER: "openai",
		providerEndpoints: [
			{
				id: "test-openai",
				name: "Test OpenAI",
				kind: "openai",
				enabled: true,
				models: ["test-model"],
			},
		],
		roleRoutes: [
			{
				role: "implementation",
				primary: {
					providerEndpointId: "test-openai",
					model: "test-model",
				},
				fallbacks: [],
			},
			{
				role: "plan",
				primary: {
					providerEndpointId: "test-openai",
					model: "test-model",
				},
				fallbacks: [],
			},
			{
				role: "review",
				primary: {
					providerEndpointId: "test-openai",
					model: "test-model",
				},
				fallbacks: [],
			},
		],
	};
}

export function buildRoleContextSnapshot() {
	return {
		version: 1 as const,
		source: "deterministic" as const,
		handoff: {
			digest: "sha256:handoff",
			eventSeq: 4,
			eventId: "event-handoff",
			omitted: false as const,
		},
		workingContext: {
			digest: "sha256:working",
			eventSeq: 5,
			eventId: "event-working",
			renderedText: [
				'<ROLE_WORKING_CONTEXT version="1" source="deterministic">',
				"executionMode=implementation",
				"role=implementation",
				"currentTodo=#1 Implement role context status=running",
				"designReference path=spec/role-owned-context-compaction-plan.md section=none digest=none reason=Referenced by runtime prompt or user request.",
				"</ROLE_WORKING_CONTEXT>",
			].join("\n"),
			omitted: false as const,
		},
	};
}

export function installRuntimeLlmSettings(settings: Record<string, unknown>) {
	const previousPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
	const dir = fs.mkdtempSync(
		path.join(os.tmpdir(), "nightworkers-llm-settings-"),
	);
	const settingsPath = path.join(dir, "llm-settings.json");
	fs.writeFileSync(settingsPath, JSON.stringify(settings));
	process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = settingsPath;
	return () => {
		if (previousPath === undefined) {
			delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		} else {
			process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = previousPath;
		}
		fs.rmSync(dir, { recursive: true, force: true });
	};
}
