import { estimateTokens } from "../../conversation-context/token-budget";
import type { recordLlmUsage } from "../../llm-usage";
import type { ProviderToolTurnResult } from "../../structured-llm/tool-calls";
import type { AgentRunContext } from "../types";
import type { NativeApiContextBudget } from "./native-api-context-budget";
import type { readNativeApiExecutionMode } from "./native-api-mode";
import { summarizeNativeApiContextBudget } from "./native-api-runner-context-events";

export type NativeApiUsageRecorder = typeof recordLlmUsage;

export async function recordNativeApiTurnUsage(input: {
	context: AgentRunContext;
	executionMode: ReturnType<typeof readNativeApiExecutionMode>;
	providerResult: Extract<ProviderToolTurnResult, { type: "supported" }>;
	providerDebug: Record<string, unknown>;
	contextBudget: NativeApiContextBudget;
	systemPrompt: string;
	userPrompt: string;
	turnIndex: number;
	provider: string;
	model: string | null;
	durationMs: number;
	usageRecorder: NativeApiUsageRecorder;
}) {
	await input.usageRecorder({
		taskId: input.context.taskId,
		runId: input.context.runId,
		agentModeSessionId: input.context.agentModeSessionId,
		callId: `${input.context.runId}:native-api-turn:${input.turnIndex}`,
		provider: input.provider,
		model: input.model,
		label: "native_api_runner",
		round: null,
		usage: input.providerResult.usage,
		promptPartTokenEstimates: readPromptPartObservabilityEnabled(input.context)
			? {
					latestUserMessageTokens:
						input.context.contextSnapshot.conversationContext?.usage
							?.latestUserMessageTokens,
					stateCardTokens:
						input.context.contextSnapshot.conversationContext?.usage
							?.stateCardTokens,
					userPromptTokens:
						input.context.contextSnapshot.conversationContext?.usage
							?.runtimeUserPromptTokens ?? estimateTokens(input.userPrompt),
					systemPromptTokens: estimateTokens(input.systemPrompt),
				}
			: undefined,
		promptPartObservabilityEnabled: readPromptPartObservabilityEnabled(
			input.context,
		),
		durationMs: input.durationMs,
		metadataJson: {
			mode: "native_api_runner",
			executionMode: input.executionMode,
			toolCallCount: input.providerResult.toolCalls.length,
			providerDebug: input.providerDebug,
			contextBudget: summarizeNativeApiContextBudget(input.contextBudget),
			nonCachedInputTokens:
				input.providerResult.usage.inputTokens !== null &&
				input.providerResult.usage.cachedInputTokens !== null
					? Math.max(
							0,
							input.providerResult.usage.inputTokens -
								input.providerResult.usage.cachedInputTokens,
						)
					: null,
			promptPartSource: readPromptPartObservabilityEnabled(input.context)
				? "nightworkers_estimate"
				: null,
			promptPartObservabilityEnabled: readPromptPartObservabilityEnabled(
				input.context,
			),
		},
		counterScope: "per_turn",
	});
}

function readPromptPartObservabilityEnabled(context: AgentRunContext) {
	const llmUsage =
		context.runtimeOptions?.llmUsage &&
		typeof context.runtimeOptions.llmUsage === "object"
			? (context.runtimeOptions.llmUsage as Record<string, unknown>)
			: null;
	return llmUsage?.promptPartObservabilityEnabled !== false;
}
