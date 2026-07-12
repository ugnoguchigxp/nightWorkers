import { normalizeProviderUsage } from "../llm-usage";
import { rejectProviderActivity } from "./events";
import type { RawLlmCallOptions } from "./providers";
import {
	emitSchemaRetryEvents,
	getResolvedProviderEndpoint,
	toOpenAIReasoningEffort,
} from "./providers";
import {
	type getStructuredLlmBoolSetting,
	getStructuredLlmSetting,
	type readStructuredLlmProviderSettings,
} from "./settings";
import type { ProviderCallResult } from "./types";
export type AzureProviderInput = {
	provider: string;
	systemPrompt: string;
	userPrompt: string;
	options: RawLlmCallOptions;
	signal: AbortSignal;
	setProviderDebug: (value: Record<string, unknown>) => void;
};

export async function callAzureProvider(
	input: AzureProviderInput,
	isEnabled: (
		key: Parameters<typeof getStructuredLlmBoolSetting>[1],
		fallback: boolean,
	) => boolean,
	settings: ReturnType<typeof readStructuredLlmProviderSettings>,
): Promise<ProviderCallResult> {
	const endpointConfig = getResolvedProviderEndpoint(input, settings);
	if (!endpointConfig?.enabled && !isEnabled("AZURE_OPENAI_ENABLED", false)) {
		throw new Error(
			"Azure provider is inactive. Enable AZURE_OPENAI_ENABLED first.",
		);
	}
	const apiKey =
		endpointConfig?.apiKey ||
		getStructuredLlmSetting(settings, "AZURE_OPENAI_API_KEY");
	const endpoint =
		input.options.normalizedRequest?.endpoint ||
		endpointConfig?.endpoint ||
		getStructuredLlmSetting(settings, "AZURE_OPENAI_ENDPOINT");
	const deploymentName =
		input.options.normalizedRequest?.modelOrDeployment ||
		endpointConfig?.models[0] ||
		getStructuredLlmSetting(
			settings,
			"AZURE_OPENAI_DEPLOYMENT_NAME",
			"gpt-5-mini",
		);
	const apiVersion =
		input.options.normalizedRequest?.apiVersion ||
		endpointConfig?.apiVersion ||
		getStructuredLlmSetting(
			settings,
			"AZURE_OPENAI_API_VERSION",
			"2024-05-01-preview",
		);
	if (!apiKey || !endpoint) {
		throw new Error(
			"Azure OpenAI credentials are not configured in environment variables.",
		);
	}
	const reasoningEffort = toOpenAIReasoningEffort(
		input.options.normalizedRequest?.thinkingDepth,
	);

	const cleanEndpoint = endpoint.endsWith("/")
		? endpoint.slice(0, -1)
		: endpoint;
	const url = `${cleanEndpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
	let response = await fetch(url, {
		method: "POST",
		signal: input.signal,
		headers: { "Content-Type": "application/json", "api-key": apiKey },
		body: JSON.stringify({
			messages: [
				{ role: "system", content: input.systemPrompt },
				{ role: "user", content: input.userPrompt },
			],
			...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
			response_format: {
				type: "json_schema",
				json_schema: input.options.jsonSchema,
			},
		}),
	});

	if (!response.ok && response.status === 400) {
		await emitSchemaRetryEvents(input.options, "Azure OpenAI", response.status);
		response = await fetch(url, {
			method: "POST",
			signal: input.signal,
			headers: { "Content-Type": "application/json", "api-key": apiKey },
			body: JSON.stringify({
				messages: [
					{ role: "system", content: input.systemPrompt },
					{ role: "user", content: input.userPrompt },
				],
				...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
				response_format: { type: "json_object" },
			}),
		});
	}

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Azure OpenAI call failed with status ${response.status}: ${errorText}`,
		);
	}
	const responseData = await response.json();
	const message = responseData?.choices?.[0]?.message;
	if (message?.tool_calls && input.options.normalizedRequest) {
		await rejectProviderActivity({
			options: input.options,
			request: input.options.normalizedRequest,
			activityType: "tool_call",
			toolName: message.tool_calls?.[0]?.function?.name ?? null,
			preview: JSON.stringify(message.tool_calls),
		});
	}
	const providerDebug = {
		provider: "azure-openai",
		providerEndpointId: endpointConfig?.id ?? null,
		status: response.status,
		deploymentName,
		apiVersion,
		reasoningEffort,
		hasChoices: Boolean(responseData?.choices),
	};
	input.setProviderDebug(providerDebug);
	const content = responseData.choices?.[0]?.message?.content || "";
	return {
		content,
		usage: normalizeProviderUsage({
			provider: "azure-openai",
			rawUsage: responseData?.usage,
			fallback: {
				systemPrompt: input.systemPrompt,
				userPrompt: input.userPrompt,
				responseText: content,
			},
		}),
		model: deploymentName,
		providerDebug,
	};
}
