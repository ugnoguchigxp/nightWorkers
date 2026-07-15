import { resolveStructuredLlmModelCapability } from "../../structured-llm/model-capability";
import type {
	ProviderToolDefinition,
	ProviderToolMessage,
} from "../../structured-llm/tool-calls";
import type { NativeApiProviderRequest } from "./native-api-request-adapter";

export type NativeApiContextBudget = {
	estimatedPromptTokens: number;
	modelContextWindowTokens: number;
	safePromptBudgetTokens: number;
	reservedOutputTokens: number;
	autoCompactTokenLimit: number;
	remainingContextHintThreshold: number;
	remainingTokens: number;
	contextUsageRatio: number;
	warningThresholdExceeded: boolean;
	compactLimitExceeded: boolean;
	hardLimitExceeded: boolean;
	messageTokens: number;
	toolTokens: number;
	largestModelVisibleMessageChars: number;
	largestModelVisibleMessageRole: string | null;
	compactedToolResultCount: number;
};

export function estimateNativeApiContextBudget(
	request: NativeApiProviderRequest,
): NativeApiContextBudget {
	const capability = resolveStructuredLlmModelCapability({
		role: request.options.normalizedRequest.role ?? undefined,
		routeOverride: request.options.normalizedRequest.providerEndpointId
			? {
					providerEndpointId:
						request.options.normalizedRequest.providerEndpointId,
					model: request.options.normalizedRequest.modelOrDeployment ?? "",
					thinkingDepth:
						request.options.normalizedRequest.thinkingDepth ?? undefined,
				}
			: undefined,
		routePolicy: request.options.routePolicy,
	});
	const messageTokens = estimateProviderMessageTokens(request.messages);
	const messageShape = summarizeProviderMessageShape(request.messages);
	const toolTokens = estimateProviderToolTokens(request.tools);
	const estimatedPromptTokens = messageTokens + toolTokens;
	const modelContextWindowTokens = capability.contextWindowTokens;
	const safePromptBudgetTokens = capability.safePromptBudgetTokens;
	const autoCompactTokenLimit = Math.min(
		Math.floor(modelContextWindowTokens * 0.9),
		safePromptBudgetTokens,
	);
	const remainingContextHintThreshold = Math.floor(
		modelContextWindowTokens * 0.75,
	);
	const remainingTokens = modelContextWindowTokens - estimatedPromptTokens;
	return {
		estimatedPromptTokens,
		modelContextWindowTokens,
		safePromptBudgetTokens,
		reservedOutputTokens: capability.reservedOutputTokens,
		autoCompactTokenLimit,
		remainingContextHintThreshold,
		remainingTokens,
		contextUsageRatio:
			modelContextWindowTokens > 0
				? estimatedPromptTokens / modelContextWindowTokens
				: 1,
		warningThresholdExceeded:
			estimatedPromptTokens >= remainingContextHintThreshold,
		compactLimitExceeded: estimatedPromptTokens >= autoCompactTokenLimit,
		hardLimitExceeded: estimatedPromptTokens >= modelContextWindowTokens,
		messageTokens,
		toolTokens,
		largestModelVisibleMessageChars: messageShape.largestChars,
		largestModelVisibleMessageRole: messageShape.largestRole,
		compactedToolResultCount: messageShape.compactedToolResultCount,
	};
}

export function renderNativeApiContextBudgetHint(
	budget: NativeApiContextBudget,
) {
	const percent = Math.round(budget.contextUsageRatio * 100);
	return [
		"[Runtime Context Budget]",
		`Estimated context usage is above 75% (${percent}%).`,
		"Prefer finishing the current Todo or compacting conversation history before reading more large files.",
	].join("\n");
}

function estimateProviderMessageTokens(
	messages: readonly ProviderToolMessage[],
) {
	let charCount = 0;
	for (const message of messages) {
		charCount += message.role.length + message.content.length;
		if (message.role === "assistant" && message.toolCalls?.length) {
			charCount += JSON.stringify(message.toolCalls).length;
		}
		if (message.role === "tool") {
			charCount += message.toolCallId.length;
		}
	}
	return estimateConservativeTokens(charCount);
}

function estimateProviderToolTokens(tools: readonly ProviderToolDefinition[]) {
	if (tools.length === 0) return 0;
	return estimateConservativeTokens(JSON.stringify(tools).length);
}

function summarizeProviderMessageShape(
	messages: readonly ProviderToolMessage[],
) {
	let largestChars = 0;
	let largestRole: string | null = null;
	let compactedToolResultCount = 0;
	for (const message of messages) {
		const chars =
			message.content.length +
			(message.role === "assistant" && message.toolCalls?.length
				? JSON.stringify(message.toolCalls).length
				: 0);
		if (chars > largestChars) {
			largestChars = chars;
			largestRole = message.role;
		}
		if (
			message.role === "tool" &&
			(message.content.includes("[model-visible-payload-compressed]") ||
				message.content.includes('"modelVisiblePayload":"compact"') ||
				message.content.includes('"modelVisiblePayload": "compact"'))
		) {
			compactedToolResultCount += 1;
		}
	}
	return { largestChars, largestRole, compactedToolResultCount };
}

function estimateConservativeTokens(charCount: number) {
	return Math.ceil(charCount / 3);
}
