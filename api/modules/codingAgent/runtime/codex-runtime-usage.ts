import { readPromptPartObservabilityEnabled } from "./codex-runtime-support";
import type { buildCodexRuntimePromptParts } from "./codex-sdk/codex-sdk-runtime-prompt";
import {
	type RuntimeUsageRecorder,
	recordCodexRuntimeUsageIfPresent,
} from "./codex-sdk/codex-sdk-usage";
import type { AgentRunContext } from "./types";

export async function recordCodexRuntimeUsage(input: {
	context: AgentRunContext;
	payload: unknown;
	durationMs: number;
	promptParts: ReturnType<typeof buildCodexRuntimePromptParts>;
	persistRuntimeUsage: boolean;
	usageRecorder: RuntimeUsageRecorder;
	providerSessionKey: string | null;
	sourceSequence: number;
}) {
	const enabled = readPromptPartObservabilityEnabled(input.context);
	await recordCodexRuntimeUsageIfPresent({
		context: input.context,
		payload: input.payload,
		persistRuntimeUsage: input.persistRuntimeUsage,
		usageRecorder: input.usageRecorder,
		durationMs: input.durationMs,
		promptPartObservabilityEnabled: enabled,
		promptPartTokenEstimates: enabled
			? {
					userPromptTokens: input.promptParts.estimates.fullPromptTokens,
					systemPromptTokens:
						input.promptParts.estimates.developerInstructionsTokens,
				}
			: undefined,
		providerSessionKey: input.providerSessionKey,
		sourceSequence: input.sourceSequence,
	});
}

export const recordCodexLlmUsage: RuntimeUsageRecorder = async (input) => {
	const { recordLlmUsage } = await import(
		"../../../services/llm-usage/repository"
	);
	return recordLlmUsage(input);
};
