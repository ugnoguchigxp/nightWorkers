import type { FixtureTurn } from "../services/structured-llm/fixture-tool-provider";
import type { ProviderToolCall } from "../services/structured-llm/tool-calls";
import { type LlmFixtureKey, renderLlmFixtureText } from "./llmCatalog/catalog";

export function buildImplementationDirectRunFixtureTurns(): FixtureTurn[] {
	return [
		turn("codingAgent.directRun.inspect-repository", [
			tool("coding-agent-read-file", "read_file", {
				filePath: "src/greeting.txt",
			}),
		]),
		turn("codingAgent.directRun.create-todo", [
			tool("coding-agent-plan", "todo_list", {
				command: {
					op: "plan",
					steps: [
						{
							title: "挨拶ファイルを実装して検証する",
							systemContext:
								"src/greeting.txtをTask Goalどおりに更新し、内容と差分を検証する。",
						},
					],
				},
			}),
		]),
		turn("codingAgent.directRun.edit-file", [
			tool("coding-agent-apply-patch", "apply_patch", {
				patchContent: [
					"*** Begin Patch",
					"*** Update File: src/greeting.txt",
					"@@",
					"-TODO",
					"+Hello from NightWorkers E2E",
					"*** End Patch",
				].join("\n"),
			}),
		]),
		turn("codingAgent.directRun.verify", [
			tool("coding-agent-verify", "run_verification", {
				command: "grep -qx 'Hello from NightWorkers E2E' src/greeting.txt",
				reason: "Task Goalどおりの挨拶が保存されたことを検証する。",
			}),
		]),
		turn("codingAgent.directRun.inspect-diff", [
			tool("coding-agent-git-diff", "git_diff", {}),
		]),
		turn("codingAgent.directRun.complete-todo", [
			tool("coding-agent-complete-todo", "todo_list", {
				command: {
					op: "complete_current",
					note: "ファイル更新、内容検証、差分確認が成功した。",
				},
			}),
		]),
		turn("codingAgent.directRun.complete", []),
	];
}

function turn(
	contentKey: LlmFixtureKey,
	toolCalls: ProviderToolCall[],
): FixtureTurn {
	return {
		content: renderLlmFixtureText(contentKey, {}),
		toolCalls,
	};
}

function tool(
	id: string,
	name: string,
	argumentsValue: Record<string, unknown>,
): ProviderToolCall {
	return { id, name, arguments: argumentsValue };
}
