import type { Input } from "@openai/codex-sdk";
import { estimateTokens } from "../../../../services/conversation-context/token-budget";
import { buildCodingAgentImplementationHandoffPrompt } from "../implementation-handoff-prompt";
import type { AgentRunContext } from "../types";

export type CodexRuntimePromptParts = {
	prompt: string;
	request: string;
	estimates: {
		requestTokens: number;
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
	const latestRequest = readCodexPromptRequest(context);
	const request = latestRequest || context.compiledPrompt.trim();
	const prompt = buildAuthoritativeImplementationPrompt(context, request);
	return {
		prompt,
		request,
		estimates: {
			requestTokens: estimateTokens(request),
			fullPromptTokens: estimateTokens(prompt),
		},
	};
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
