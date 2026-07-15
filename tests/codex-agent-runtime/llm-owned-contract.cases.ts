import { describe, expect, it, vi } from "vitest";
import { createCodexRuntimeThread } from "../../api/services/agent-runtime/codex-sdk/codex-sdk-client";
import { buildCodexRuntimePromptParts } from "../../api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt";
import type { AgentRunContext } from "../../api/services/agent-runtime/types";
import { buildCodingAgentSystemContext } from "../../api/services/coding-agent-context";

function context(executionMode: string): AgentRunContext {
	const systemContext = buildCodingAgentSystemContext({
		taskGoal: "同じTaskを単一Coding Agentで処理する。",
		registeredRepositoryRoot: "/tmp/codex-llm-owned",
	});
	return {
		runId: "run-codex-contract",
		taskId: "task-codex-contract",
		repositoryId: "repo-codex-contract",
		repoRoot: "/tmp/codex-llm-owned",
		compiledPrompt: systemContext.taskGoal,
		latestUserMessage: systemContext.taskGoal,
		timeoutSeconds: 30,
		contextSnapshot: {
			compiledPrompt: systemContext.taskGoal,
			source: "task_prompt",
			executionMode,
		},
		runtimeOptions: { executionMode },
		codingAgentSystemContext: systemContext,
	};
}

describe("Codex SDK LLM-owned Todo contract", () => {
	it("uses the same runtime contract for every legacy mode value", () => {
		const implementation = buildCodexRuntimePromptParts(
			context("implementation"),
		);
		const test = buildCodexRuntimePromptParts(context("test"));
		const review = buildCodexRuntimePromptParts(context("review"));
		expect(test.runtimeContract).toBe(implementation.runtimeContract);
		expect(review.runtimeContract).toBe(implementation.runtimeContract);
		expect(review.runtimeContract).toContain("Todo");
		expect(review.runtimeContract).not.toContain("executionMode:");
		expect(review.runtimeContract).not.toContain("reviewer_evaluation");
	});

	it("does not start a fresh thread when resume fails", async () => {
		const resumeThread = vi.fn(() => {
			throw new Error("resume rejected");
		});
		const startThread = vi.fn();
		const onResumeEvent = vi.fn();
		await expect(
			createCodexRuntimeThread({
				context: {
					...context("implementation"),
					runtimeOptions: {
						runtimeResume: {
							kind: "codex_thread",
							providerThreadId: "thread-old",
						},
					},
				},
				codexClient: { resumeThread, startThread },
				onResumeEvent,
			}),
		).rejects.toThrow("resume rejected");
		expect(startThread).not.toHaveBeenCalled();
		expect(onResumeEvent).toHaveBeenCalledWith(
			expect.objectContaining({ status: "resume_failed" }),
		);
	});
});
