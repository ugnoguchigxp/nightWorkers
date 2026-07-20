import type { NormalizedLlmUsage } from "../../../../services/llm-usage";
import type { recordLlmUsage } from "../../../../services/llm-usage/repository";
import type { AgentRunContext } from "../types";

export type RuntimeUsageRecorder = typeof recordLlmUsage;

export async function recordCodexRuntimeUsageIfPresent(input: {
	context: AgentRunContext;
	payload: unknown;
	persistRuntimeUsage: boolean;
	usageRecorder: RuntimeUsageRecorder;
	promptPartTokenEstimates?: {
		latestUserMessageTokens?: number | null;
		stateCardTokens?: number | null;
		userPromptTokens?: number | null;
		systemPromptTokens?: number | null;
	};
	promptPartObservabilityEnabled?: boolean;
	durationMs?: number;
	providerSessionKey?: string | null;
	sourceSequence?: number | null;
}): Promise<void> {
	if (!input.persistRuntimeUsage) return;
	const record =
		input.payload && typeof input.payload === "object"
			? (input.payload as Record<string, unknown>)
			: {};
	if (record.provider !== "codex" || !record.usage) return;
	const usage = normalizeRuntimeUsage(record.usage, record.rawUsage);
	if (!usage) return;
	await input.usageRecorder({
		taskId: input.context.taskId,
		runId: input.context.runId,
		callId: `codex-runtime:${input.context.runId}:${input.sourceSequence ?? 0}`,
		provider: "codex",
		model: resolveRuntimeModel(input.context),
		label: "codex-runtime",
		round: null,
		usage,
		promptPartTokenEstimates:
			input.promptPartObservabilityEnabled === false
				? undefined
				: (input.promptPartTokenEstimates ?? {
						latestUserMessageTokens:
							input.context.contextSnapshot.conversationContext?.usage
								?.latestUserMessageTokens,
						stateCardTokens:
							input.context.contextSnapshot.conversationContext?.usage
								?.stateCardTokens,
						userPromptTokens:
							input.context.contextSnapshot.conversationContext?.usage
								?.runtimeUserPromptTokens,
					}),
		promptPartObservabilityEnabled:
			input.promptPartObservabilityEnabled ?? true,
		durationMs: input.durationMs ?? 0,
		metadataJson: {
			source: "codex_sdk_runtime_turn_completed",
			providerEventType: record.providerEventType ?? null,
			providerUsageSource: "codex_sdk_measured",
			promptPartSource:
				input.promptPartObservabilityEnabled === false
					? null
					: "nightworkers_estimate",
			runtimePromptShape: "request_only",
			systemPromptMeaning: "none",
			nonCachedInputTokens:
				usage.inputTokens !== null && usage.cachedInputTokens !== null
					? Math.max(0, usage.inputTokens - usage.cachedInputTokens)
					: null,
			promptPartObservabilityEnabled:
				input.promptPartObservabilityEnabled ?? true,
		},
		agentModeSessionId: input.context.agentModeSessionId,
		providerSessionKey: input.providerSessionKey,
		counterScope: "provider_session_cumulative",
		sourceSequence: input.sourceSequence,
	});
}

function normalizeRuntimeUsage(
	usageValue: unknown,
	rawUsage: unknown,
): NormalizedLlmUsage | null {
	if (!usageValue || typeof usageValue !== "object") return null;
	const usage = usageValue as Record<string, unknown>;
	const inputTokens = normalizeOptionalToken(usage.inputTokens);
	const outputTokens = normalizeOptionalToken(usage.outputTokens);
	const cachedInputTokens = normalizeOptionalToken(usage.cachedInputTokens);
	const reasoningOutputTokens = normalizeOptionalToken(
		usage.reasoningOutputTokens,
	);
	if (inputTokens === null && outputTokens === null) return null;
	return {
		inputTokens,
		outputTokens,
		cachedInputTokens,
		reasoningOutputTokens,
		totalTokens:
			inputTokens !== null || outputTokens !== null
				? (inputTokens ?? 0) + (outputTokens ?? 0)
				: null,
		mode: "measured",
		rawUsage,
	};
}

function normalizeOptionalToken(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, Math.floor(value))
		: null;
}

function resolveRuntimeModel(context: AgentRunContext): string | null {
	const codexOptions =
		context.runtimeOptions?.codex &&
		typeof context.runtimeOptions.codex === "object"
			? (context.runtimeOptions.codex as Record<string, unknown>)
			: null;
	return typeof codexOptions?.model === "string" ? codexOptions.model : null;
}
