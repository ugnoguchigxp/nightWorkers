import { describe, expect, it } from "vitest";
import {
	buildCodingAgentImplementationHandoffPrompt,
	CODING_AGENT_IMPLEMENTATION_HANDOFF_INSTRUCTIONS_JA,
} from "../api/modules/codingAgent";
import { buildCodexRuntimePromptParts } from "../api/modules/codingAgent/runtime/codex-sdk/codex-sdk-runtime-prompt";
import type { AgentRunContext } from "../api/modules/codingAgent/runtime/types";
import { findLatestImplementationDesignArtifacts } from "../api/modules/nightworkers/run-orchestration/runtime-routing";

describe("Coding Agent implementation handoff prompt", () => {
	it("leaves a direct implementation request unchanged without a handoff", () => {
		expect(
			buildCodingAgentImplementationHandoffPrompt({
				userRequest: "認証エラーを修正してください。",
			}),
		).toBe("認証エラーを修正してください。");
	});

	it("treats the adopted plan as authoritative without prescribing a workflow", () => {
		const prompt = buildCodingAgentImplementationHandoffPrompt({
			userRequest: "実装を開始してください。",
			implementationHandoff:
				"Hono と React/Vite を使用する。AC-001 を実行可能なテストで検証する。",
		});

		expect(prompt).toContain("<USER_REQUEST>\n実装を開始してください。");
		expect(prompt).toContain(
			CODING_AGENT_IMPLEMENTATION_HANDOFF_INSTRUCTIONS_JA,
		);
		expect(prompt).toContain(
			"<ADOPTED_PLAN>\nHono と React/Vite を使用する。AC-001 を実行可能なテストで検証する。\n</ADOPTED_PLAN>",
		);
		expect(prompt).toContain("補助資料や既定構成より優先");
		expect(prompt).toContain("解決可能な限り調査・実装・検証を続けて");
		expect(prompt).toContain("完了を表明せず");
		expect(prompt).not.toContain("todo_list");
		expect(prompt).not.toContain("必ず次のコマンド");
	});

	it("does not duplicate a fallback request that is the handoff itself", () => {
		const prompt = buildCodingAgentImplementationHandoffPrompt({
			userRequest: "確定済みPlan",
			implementationHandoff: "確定済みPlan",
			omitDuplicatedUserRequest: true,
		});

		expect(prompt).not.toContain("<USER_REQUEST>");
		expect(prompt.match(/確定済みPlan/g)).toHaveLength(1);
	});

	it("passes adopted design artifacts and the fixed repository preflight to Codex", () => {
		const context: AgentRunContext = {
			runId: "run-1",
			taskId: "task-1",
			repositoryId: "repo-1",
			repoRoot: "/workspace",
			compiledPrompt: "fallback",
			latestUserMessage: "host Todo recovery guidance must not be used",
			timeoutSeconds: 60,
			contextSnapshot: {
				compiledPrompt: "fallback",
				source: "task_prompt",
				codexPrompt: {
					request: "実装を開始してください。",
					stateCardText: "modules/bbs が実装境界である。",
				},
				implementationHandoff: {
					version: 1,
					sourceMessageId: "feature-plan-1",
					instructions: CODING_AGENT_IMPLEMENTATION_HANDOFF_INSTRUCTIONS_JA,
					userRequest: "実装を開始してください。",
					adoptedPlan: "Hono + React/Vite で BBS を実装する。",
					designArtifacts: [
						{
							kind: "data_model",
							sourceMessageId: "data-model-1",
							content: "posts テーブルを使用する。",
						},
					],
				},
				repositoryPreflight: {
					ready: true,
					workingDirectory: { resolved: "/workspace" },
					gitHead: "abc123",
				},
			},
		};

		const parts = buildCodexRuntimePromptParts(context);

		expect(parts.prompt).toContain("<ADOPTED_PLAN>");
		expect(parts.prompt).toContain(
			'<ADOPTED_DESIGN_ARTIFACT kind="data_model">',
		);
		expect(parts.prompt).toContain("modules/bbs が実装境界である。");
		expect(parts.prompt).toContain("<REPOSITORY_PREFLIGHT>");
		expect(parts.prompt).not.toContain("host Todo recovery guidance");
	});

	it("passes only design artifacts referenced by the adopted Feature Plan", () => {
		const referenced = {
			id: "data-model-adopted",
			messageType: "markdown_document",
			content: "採用済みdata model",
			metadataJson: {
				artifactKind: "plan_mode_dedicated_view",
				view: "data_model",
			},
		};
		const unrelatedNewer = {
			id: "data-model-unreviewed",
			messageType: "markdown_document",
			content: "未レビューdata model",
			metadataJson: {
				artifactKind: "plan_mode_dedicated_view",
				view: "data_model",
			},
		};
		const handoff = {
			id: "feature-plan-adopted",
			messageType: "markdown_document",
			content: "採用済みFeature Plan",
			metadataJson: {
				intent: "feature_plan",
				generation: {
					context: {
						inputProjection: {
							sourceMessageIds: [referenced.id],
						},
					},
				},
			},
		};

		const artifacts = findLatestImplementationDesignArtifacts(
			[referenced, handoff, unrelatedNewer] as never,
			handoff as never,
		);

		expect(artifacts).toEqual([{ kind: "data_model", message: referenced }]);
	});
});
