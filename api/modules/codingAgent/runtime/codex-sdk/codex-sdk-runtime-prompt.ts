import type { Input } from "@openai/codex-sdk";
import { estimateTokens } from "../../../../services/conversation-context/token-budget";
import {
	bindSystemContextCatalogSnapshot,
	readSystemContextBindingSnapshot,
	type SystemContextPromptAudit,
	systemContextPromptAudit,
} from "../../../../systemContexts/catalog";
import {
	buildCodingAgentSystemContext,
	rebindCodingAgentSystemContext,
} from "../../context/system-context";
import {
	renderCodingAgentRuntimeSystemContext,
	renderCodingAgentTodoPlanSummary,
	renderCodingAgentTodoSystemContext,
} from "../../context/todo-prompt-context";
import { buildCodingAgentImplementationHandoffPrompt } from "../implementation-handoff-prompt";
import { formatSecurityContractContextForPrompt } from "../security-contract-context";
import type { AgentRunContext } from "../types";

export type CodexRuntimePromptParts = {
	prompt: string;
	request: string;
	developerInstructions: string;
	estimates: {
		requestTokens: number;
		fullPromptTokens: number;
		developerInstructionsTokens: number;
	};
	systemContextAudit: readonly SystemContextPromptAudit[];
};

export function buildCodexRuntimePrompt(context: AgentRunContext): string {
	return buildCodexRuntimePromptParts(context).prompt;
}

export function buildCodexRuntimeDeveloperInstructions(
	context: AgentRunContext,
): string {
	return buildCodexRuntimeDeveloperInstructionsInvocation(context).invocation
		.content.text;
}

export function buildCodexRuntimeDeveloperInstructionsInvocation(
	context: AgentRunContext,
) {
	const systemContexts = bindSystemContextCatalogSnapshot(
		readSystemContextBindingSnapshot(context.contextSnapshot) ?? undefined,
	);
	const { p } = systemContexts;
	const request =
		readCodexPromptRequest(context) || context.compiledPrompt.trim();
	const snapshot = asRecord(context.contextSnapshot);
	const handoff = asRecord(snapshot?.implementationHandoff);
	const userRequest = readString(handoff?.userRequest) || request;
	const securityContractContext =
		formatSecurityContractContextForPrompt(context);
	const systemContext = context.codingAgentSystemContext
		? rebindCodingAgentSystemContext(context.codingAgentSystemContext, p)
		: buildCodingAgentSystemContext(
				{
					taskGoal: userRequest,
					registeredRepositoryRoot: context.repoRoot,
				},
				p,
			);
	const invocation = systemContexts.invoke(
		"codingAgent.codex-developer-instructions",
		{
			runtimeSystemContext: renderCodingAgentRuntimeSystemContext(
				systemContext,
				{
					includeTaskGoal: false,
				},
				p,
			).trimEnd(),
			todoPlanSummary:
				renderCodingAgentTodoPlanSummary(context.todoPlan, p)?.trimEnd() ?? "",
			currentTodoSystemContext: context.currentTodo
				? renderCodingAgentTodoSystemContext(context.currentTodo, p).trimEnd()
				: "",
			...(securityContractContext === undefined
				? {}
				: { securityContractContext }),
		},
	);
	return {
		invocation,
		audit: systemContextPromptAudit("developer", systemContexts, invocation),
	};
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
	const latestRequest = readCodexPromptRequest(context);
	const request = latestRequest || context.compiledPrompt.trim();
	if (isMinimalReviewRuntime(context)) {
		const developerInstructions = "";
		return {
			prompt: request,
			request,
			developerInstructions,
			estimates: {
				requestTokens: estimateTokens(request),
				fullPromptTokens: estimateTokens(request),
				developerInstructionsTokens: 0,
			},
			systemContextAudit: [],
		};
	}
	const prompt = buildAuthoritativeImplementationPrompt(context, request);
	const developerInstructions =
		buildCodexRuntimeDeveloperInstructionsInvocation(context);
	return {
		prompt,
		request,
		developerInstructions: developerInstructions.invocation.content.text,
		estimates: {
			requestTokens: estimateTokens(request),
			fullPromptTokens: estimateTokens(prompt),
			developerInstructionsTokens: estimateTokens(
				developerInstructions.invocation.content.text,
			),
		},
		systemContextAudit: [developerInstructions.audit],
	};
}

export function isMinimalReviewRuntime(context: AgentRunContext) {
	const reviewRuntime = asRecord(context.contextSnapshot.reviewRuntime);
	return (
		context.contextSnapshot.executionMode === "review" &&
		reviewRuntime?.contextPolicy === "codex_default"
	);
}

function buildAuthoritativeImplementationPrompt(
	context: AgentRunContext,
	request: string,
) {
	const snapshot = asRecord(context.contextSnapshot);
	const handoff = asRecord(snapshot?.implementationHandoff);
	const adoptedPlan = readString(handoff?.adoptedPlan);
	const userRequest = readString(handoff?.userRequest) || request;
	const prompt = adoptedPlan
		? buildCodingAgentImplementationHandoffPrompt({
				userRequest,
				implementationHandoff: adoptedPlan,
				omitDuplicatedUserRequest: true,
			})
		: request;
	const designArtifacts = Array.isArray(handoff?.designArtifacts)
		? handoff.designArtifacts.flatMap((value) => {
				const artifact = asRecord(value);
				const kind = readString(artifact?.kind);
				const content = readString(artifact?.content);
				if (!kind || !content) return [];
				return [
					[
						`<ADOPTED_DESIGN_ARTIFACT kind="${kind}">`,
						content,
						"</ADOPTED_DESIGN_ARTIFACT>",
					].join("\n"),
				];
			})
		: [];
	const codexPrompt = asRecord(snapshot?.codexPrompt);
	const stateCardText = readString(codexPrompt?.stateCardText);
	const repositoryPreflight = asRecord(snapshot?.repositoryPreflight);
	return [
		prompt,
		...designArtifacts,
		...(stateCardText
			? [
					["<PROJECT_STATE_CARD>", stateCardText, "</PROJECT_STATE_CARD>"].join(
						"\n",
					),
				]
			: []),
		...(repositoryPreflight
			? [
					[
						"<REPOSITORY_PREFLIGHT>",
						JSON.stringify(repositoryPreflight, null, 2),
						"</REPOSITORY_PREFLIGHT>",
					].join("\n"),
				]
			: []),
	]
		.filter(Boolean)
		.join("\n\n");
}

function readCodexPromptRequest(context: AgentRunContext) {
	const snapshot = asRecord(context.contextSnapshot);
	const codexPrompt = asRecord(snapshot?.codexPrompt);
	return readString(codexPrompt?.request) || context.latestUserMessage.trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function readString(value: unknown) {
	return typeof value === "string" ? value.trim() : "";
}
