import { describe, expect, it } from "vitest";
import { buildCodexRuntimePromptParts } from "../api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt";
import type { AgentRunContext } from "../api/services/agent-runtime/types";

describe("Codex runtime Test Mode prompt", () => {
	it("keeps Test Mode focused on test implementation and evidence checks", () => {
		const prompt = buildCodexRuntimePromptParts({
			runId: "run-1",
			taskId: "task-1",
			repositoryId: "repo-1",
			repoRoot: "/tmp/repo-worktrees/task-1",
			compiledPrompt: "テストを実装してください",
			latestUserMessage: "テストを実装してください",
			timeoutSeconds: 3600,
			contextSnapshot: {
				compiledPrompt: "テストを実装してください",
				source: "task_prompt",
				executionMode: "test",
				request: {
					registeredRepositoryPath: "/tmp/repo",
					repositoryPath: "/tmp/repo-worktrees/task-1",
				},
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
		expect(prompt).toContain("conditionIds に明示する");
		expect(prompt).toContain(
			"conditionIds のない broad verify / coverage / build 成功は補助的な全体ゲート証跡",
		);
		expect(prompt).toContain("registeredRepoRoot: /tmp/repo");
		expect(prompt).toContain("executionRoot: /tmp/repo-worktrees/task-1");
		expect(prompt).toContain("登録元で実装・検証しない");
		expect(prompt).not.toContain("reviewer_evaluation");
	});
});
