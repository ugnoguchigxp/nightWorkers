import { describe, expect, it } from "vitest";
import { buildCodexRuntimePromptParts } from "../api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt";
import type { AgentRunContext } from "../api/services/agent-runtime/types";

describe("Codex runtime Test Mode prompt", () => {
	it("keeps Test Mode focused on test implementation and evidence checks", () => {
		const prompt = buildCodexRuntimePromptParts({
			runId: "run-1",
			taskId: "task-1",
			repositoryId: "repo-1",
			repoRoot: "/tmp/repo",
			compiledPrompt: "テストを実装してください",
			latestUserMessage: "テストを実装してください",
			timeoutSeconds: 3600,
			contextSnapshot: {
				compiledPrompt: "テストを実装してください",
				source: "task_prompt",
				executionMode: "test",
			},
			runtimeOptions: {
				testMode: { action: "plan_and_implement_tests" },
			},
		} satisfies AgentRunContext).runtimeContract;

		expect(prompt).toContain(
			"実装開始 -> ユニットテスト実行 -> 証跡テストチェック",
		);
		expect(prompt).toContain("nightworkers.completion_check");
		expect(prompt).not.toContain("LLM コードレビュー");
		expect(prompt).not.toContain("コードレビューをしてください");
		expect(prompt).toContain("Test Mode では TodoList を使わない");
		expect(prompt).not.toContain("reviewer_evaluation");
	});
});
