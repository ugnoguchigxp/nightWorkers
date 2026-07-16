import type { Input } from "@openai/codex-sdk";
import { getNightWorkersCodexToolNames } from "../../../mcp/nightworkers-tool-manifest";
import {
	CODING_AGENT_RUNTIME_REMINDERS_JA,
	CODING_AGENT_SYSTEM_CONTEXT_VERSION,
} from "../../coding-agent-context/system-context";
import { estimateTokens } from "../../conversation-context/token-budget";
import { formatRuntimeWorkspaceContextForPrompt } from "../runtime-workspace-context";
import type { AgentRunContext } from "../types";

export type CodexRuntimePromptParts = {
	prompt: string;
	request: string;
	runtimeContract: string;
	estimates: {
		requestTokens: number;
		runtimeContractTokens: number;
		fullPromptTokens: number;
	};
};

export function buildCodexRuntimePrompt(context: AgentRunContext): string {
	return buildCodexRuntimePromptParts(context).prompt;
}

export function buildCodexRuntimeInput(
	context: AgentRunContext,
	prompt: string,
): Input {
	if (!context.imageAttachments?.length) return prompt;
	return [
		{ type: "text", text: prompt },
		...context.imageAttachments.map((image) => ({
			type: "local_image" as const,
			path: image.path,
		})),
	];
}

export function buildCodexRuntimeTurnInput(
	context: AgentRunContext,
	prompt: string,
	imageInputSent: boolean,
): Input {
	return imageInputSent ? prompt : buildCodexRuntimeInput(context, prompt);
}

export function buildCodexRuntimePromptParts(
	context: AgentRunContext,
): CodexRuntimePromptParts {
	const request = (context.latestUserMessage || context.compiledPrompt).trim();
	const nightWorkersToolList = getNightWorkersCodexToolNames({
		ontologyMcpEnabled: readOntologyMcpEnabled(context),
	}).join(", ");
	const runtimeContract = buildCodingAgentContract(
		context,
		nightWorkersToolList,
	);
	const prompt = [request, runtimeContract]
		.filter((part): part is string => Boolean(part?.trim()))
		.join("\n\n");
	return {
		prompt,
		request,
		runtimeContract,
		estimates: {
			requestTokens: estimateTokens(request),
			runtimeContractTokens: estimateTokens(runtimeContract),
			fullPromptTokens: estimateTokens(prompt),
		},
	};
}

function buildCodingAgentContract(
	context: AgentRunContext,
	nightWorkersToolList: string,
) {
	return [
		"[NightWorkers Coding Agent Runtime]",
		`taskId: ${context.taskId}`,
		`runId: ${context.runId}`,
		...formatRuntimeWorkspaceContextForPrompt(context),
		JSON.stringify(
			context.codingAgentSystemContext ?? {
				version: CODING_AGENT_SYSTEM_CONTEXT_VERSION,
				roleInstructionsJa:
					"Taskの意味、Todo、次の行動、検証、完了可否を判断するCoding Agentとして振る舞ってください。",
				taskGoal: context.latestUserMessage || context.compiledPrompt,
				registeredRepositoryRoot: context.repoRoot,
			},
			null,
			2,
		),
		"",
		`利用可能なNightWorkers MCP tools: ${nightWorkersToolList}`,
		"最初にnightworkers.todo_listのreplace_planとstartを使い、current Todoを作成してください。",
		...CODING_AGENT_RUNTIME_REMINDERS_JA,
		"current Todoなしにworkspace toolを呼ばず、Todoのobjective、context、nextAction、acceptanceCriteriaを読んで行動してください。",
		"失敗時はrecord_failureでraw errorと次の方法を保存し、hostにretry方法や次工程を推測させないでください。",
		"Testや自己確認の要否はTaskとTodo Contextから判断し、Test/Review専用modeを前提にしないでください。",
		"最終回答前にpending、running、needs_humanを明示的に解消し、不要なTodoはskippedへ遷移してください。",
		"通常のassistant本文を最終回答候補として返し、finalize専用toolは使用しません。",
	].join("\n");
}

function readOntologyMcpEnabled(context: AgentRunContext) {
	const ontologyMcp = (context.contextSnapshot as Record<string, unknown>)
		.ontologyMcp;
	if (
		!ontologyMcp ||
		typeof ontologyMcp !== "object" ||
		Array.isArray(ontologyMcp)
	) {
		return false;
	}
	return (ontologyMcp as Record<string, unknown>).enabled === true;
}
