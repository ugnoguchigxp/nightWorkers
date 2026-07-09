import { describe, expect, it } from "vitest";
import { buildCodexRuntimePromptParts } from "../api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt";
import type { AgentRunContext } from "../api/services/agent-runtime/types";

describe("Codex runtime Test Mode prompt", () => {
	it("instructs the agent to immediately fix LLM review findings until none remain", () => {
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
			"LLM コードレビュー SystemContext: コードレビューをしてください。改善するべき点が無くなるまで改善してください",
		);
		expect(prompt).toContain(
			"reviewer_evaluation が changes_requested / blocking finding を返した直後は、ユーザーへの完了報告や次ステップ提案を書かず、返された findings を修正する",
		);
	});
});
