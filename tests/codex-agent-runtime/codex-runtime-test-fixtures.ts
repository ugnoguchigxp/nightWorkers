import type { AgentRunContext } from "../../api/modules/codingAgent/runtime/types";

export function createCodexRuntimeContext(
	executionMode = "implementation",
): AgentRunContext {
	return {
		runId: "run-codex-contract",
		taskId: "task-codex-contract",
		repositoryId: "repo-codex-contract",
		repoRoot: "/tmp/codex-llm-owned",
		compiledPrompt: "fallback request",
		latestUserMessage: "ユーザーの実装依頼",
		timeoutSeconds: 30,
		contextSnapshot: {
			compiledPrompt: "fallback request",
			source: "task_prompt",
			executionMode,
		},
		runtimeOptions: { executionMode },
	};
}

export async function completionAllowed() {
	return {
		allowFinalize: true,
		code: "FINALIZE_ALLOWED" as const,
		message: "ready",
		missingConditions: [],
		snapshot: { planRevision: 0, todos: [] },
		idempotent: false,
	};
}

export function completedTextEvents(text: string): AsyncIterable<unknown> {
	return (async function* () {
		yield {
			type: "item.completed",
			item: { id: "message-1", type: "agent_message", text },
		};
		yield {
			type: "turn.completed",
			usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 10 },
		};
	})();
}

export function failedEvents(message: string): AsyncIterable<unknown> {
	return (async function* () {
		yield { type: "turn.failed", error: { message } };
	})();
}

export function rejectedEvents(error: Error): AsyncIterable<unknown> {
	return {
		[Symbol.asyncIterator]() {
			return {
				async next() {
					throw error;
				},
			};
		},
	};
}
