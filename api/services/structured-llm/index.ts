import { randomUUID } from "node:crypto";
import {
	appendLlmTrace,
	appendSupervisorTrace,
	logger,
} from "../../lib/logger";
import { estimateTokens } from "../conversation-context/token-budget";
import type { NormalizedLlmUsage } from "../llm-usage";
import { recordLlmUsage } from "../llm-usage";
import {
	type AgentToolCallEnvelope,
	buildResponseJsonSchema as buildSchemaFirstResponseJsonSchema,
	type JobTypeSelection,
	parseSupervisorOutput,
} from "../supervisor/schema-first";
import {
	emitSupervisorLlmDebugEvent,
	ProviderActivityRejectedError,
} from "./events";
import {
	createStructuredLlmAbortSignal,
	digestLlmText,
	jsonFixWrapper,
} from "./json";
import { callProvider, type RawLlmCallOptions } from "./providers";
import {
	buildNormalizedSupervisorLlmRequestCandidates,
	providerAdapterKey,
} from "./request";
import type {
	CallSupervisorOptions,
	NormalizedSupervisorLlmRequest,
	StructuredJsonLlmOptions,
} from "./types";

export { ProviderActivityRejectedError } from "./events";
export {
	type ResolvedStructuredLlmModelCapability,
	resolveStructuredLlmModelCapability,
} from "./model-capability";
export { callProviderToolTurn } from "./providers";
export {
	buildNormalizedSupervisorLlmRequest,
	buildNormalizedSupervisorLlmRequestCandidates,
	normalizeProviderId,
	providerAdapterKey,
} from "./request";
export {
	normalizeStructuredLlmProviderSetting,
	readStructuredLlmProviderSettings,
} from "./settings";
export type {
	ProviderToolCall,
	ProviderToolDefinition,
	ProviderToolMessage,
	ProviderToolTurnResult,
} from "./tool-calls";
export type {
	NormalizedSupervisorLlmRequest,
	ProviderCapabilityPolicy,
	StructuredLlmRole,
	SupervisorLlmDebugEvent,
	SupervisorProviderClass,
	SupervisorProviderId,
} from "./types";

export async function callSupervisorLLM(
	systemPrompt: string,
	userPrompt: string,
	options: CallSupervisorOptions & { schemaFirst: true; round: 1 | 2 },
): Promise<JobTypeSelection | AgentToolCallEnvelope> {
	const rawContent = await callRawJsonLLM(systemPrompt, userPrompt, {
		...options,
		jsonSchema: buildSchemaFirstResponseJsonSchema(options.round),
		label: "supervisor",
	});
	const parsedJson = await parseJsonContent(
		rawContent,
		options,
		"Supervisor LLM",
	);
	try {
		return parseSupervisorOutput(parsedJson.parsedJson, options.round);
	} catch (err) {
		await emitSupervisorLlmDebugEvent(options, {
			type: "model.response_parse_failed",
			severity: "error",
			message: "Schema-first LLM response failed schema validation.",
			data: {
				round: options.round,
				errorMessage: err instanceof Error ? err.message : String(err),
				rawContentPreview: rawContent.slice(0, 500),
			},
		});
		throw err;
	}
}

export async function callStructuredJsonLLM(
	systemPrompt: string,
	userPrompt: string,
	options: StructuredJsonLlmOptions,
): Promise<string> {
	const rawContent = await callRawJsonLLM(systemPrompt, userPrompt, {
		...options,
		jsonSchema: { name: options.schemaName, schema: options.schema },
		label: options.schemaName,
	});
	let parsedJson: Awaited<ReturnType<typeof parseJsonContent>>;
	try {
		parsedJson = await parseJsonContent(
			rawContent,
			options,
			options.schemaName,
		);
	} catch (error) {
		if (options.allowRawOutputOnJsonParseFailure) return rawContent;
		throw error;
	}
	return parsedJson.sourceText;
}

async function callRawJsonLLM(
	systemPrompt: string,
	userPrompt: string,
	options: RawLlmCallOptions,
): Promise<string> {
	const normalizedRequests = buildNormalizedSupervisorLlmRequestCandidates({
		systemPrompt,
		userPrompt,
		jsonSchema: options.jsonSchema,
		label: options.label,
		round: options.round,
		schemaFirst: options.schemaFirst,
		role: options.role,
		routeOverride: options.routeOverride,
		routePolicy: options.routePolicy,
	});

	for (let index = 0; index < normalizedRequests.length; index += 1) {
		const normalizedRequest = normalizedRequests[index];
		const remainingFallbacks = normalizedRequests.slice(index + 1);
		try {
			return await callRawJsonLLMAttempt(
				systemPrompt,
				userPrompt,
				options,
				normalizedRequest,
			);
		} catch (error) {
			if (
				!shouldTryStructuredLlmRouteFallback(error) ||
				remainingFallbacks.length === 0
			) {
				if (shouldTryStructuredLlmRouteFallback(error)) {
					await emitStructuredLlmRouteFallbackUnavailable(
						options,
						normalizedRequest,
						error,
					);
				}
				throw error;
			}
			await emitStructuredLlmRouteFallbackStarted(
				options,
				normalizedRequest,
				remainingFallbacks[0],
				error,
			);
		}
	}

	throw new Error("No structured LLM route candidates were available.");
}

async function callRawJsonLLMAttempt(
	systemPrompt: string,
	userPrompt: string,
	options: RawLlmCallOptions,
	normalizedRequest: NormalizedSupervisorLlmRequest,
): Promise<string> {
	const provider = providerAdapterKey(normalizedRequest.providerId);
	const startedAt = Date.now();
	const callId = randomUUID();
	const requestAbortHandle = createStructuredLlmAbortSignal(options);
	const requestSignal = requestAbortHandle.signal;
	const providerOptions = { ...options, normalizedRequest };
	let rawContent = "";
	let providerDebug: Record<string, unknown> = {};
	let providerModel: string | null | undefined = null;
	let providerUsage: NormalizedLlmUsage | null = null;

	appendLlmTrace("request", {
		callId,
		provider: normalizedRequest.providerId,
		providerEndpointId: normalizedRequest.providerEndpointId ?? null,
		role: normalizedRequest.role ?? null,
		routeSource: normalizedRequest.routeSource ?? null,
		model: normalizedRequest.modelOrDeployment ?? null,
		thinkingDepth: normalizedRequest.thinkingDepth ?? null,
		providerClass: normalizedRequest.providerClass,
		round: options.round ?? null,
		label: options.label,
		callKind: normalizedRequest.callKind,
		systemPrompt,
		userPrompt,
		systemPromptLength: systemPrompt.length,
		userPromptLength: userPrompt.length,
		systemPromptBytes: Buffer.byteLength(systemPrompt, "utf8"),
		userPromptBytes: Buffer.byteLength(userPrompt, "utf8"),
		systemPromptSha256: digestLlmText(systemPrompt),
		userPromptSha256: digestLlmText(userPrompt),
		promptBudgetMetadata: options.promptBudgetMetadata ?? null,
	});
	logger.debug(
		{
			provider: normalizedRequest.providerId,
			providerEndpointId: normalizedRequest.providerEndpointId ?? null,
			role: normalizedRequest.role ?? null,
			routeSource: normalizedRequest.routeSource ?? null,
			model: normalizedRequest.modelOrDeployment ?? null,
			thinkingDepth: normalizedRequest.thinkingDepth ?? null,
			providerClass: normalizedRequest.providerClass,
			label: options.label,
			systemPromptLength: systemPrompt.length,
			userPromptLength: userPrompt.length,
			promptBudgetMetadata: options.promptBudgetMetadata ?? null,
		},
		"Supervisor LLM call start",
	);
	await emitSupervisorLlmDebugEvent(options, {
		type: "model.request_started",
		severity: "info",
		message: `Supervisor LLM request started. provider=${normalizedRequest.providerId} round=${options.round ?? "unknown"}`,
		data: {
			provider: normalizedRequest.providerId,
			providerEndpointId: normalizedRequest.providerEndpointId ?? null,
			role: normalizedRequest.role ?? null,
			routeSource: normalizedRequest.routeSource ?? null,
			model: normalizedRequest.modelOrDeployment ?? null,
			thinkingDepth: normalizedRequest.thinkingDepth ?? null,
			providerClass: normalizedRequest.providerClass,
			callKind: normalizedRequest.callKind,
			round: options.round ?? null,
			label: options.label,
			systemPromptLength: systemPrompt.length,
			userPromptLength: userPrompt.length,
			promptBudgetMetadata: options.promptBudgetMetadata ?? null,
			diagnostics: normalizedRequest.diagnostics,
		},
	});

	try {
		const providerResult = await callProvider({
			provider,
			systemPrompt,
			userPrompt,
			options: providerOptions,
			signal: requestSignal,
			setProviderDebug: (value) => {
				providerDebug = value;
			},
		});
		rawContent = providerResult.content;
		providerDebug = providerResult.providerDebug ?? providerDebug;
		providerModel = providerResult.model;
		providerUsage = providerResult.usage;
		providerDebug = { ...providerDebug, normalizedUsage: providerUsage };
	} catch (error) {
		const rejectedActivity =
			error instanceof ProviderActivityRejectedError
				? {
						activityType: error.activityType,
						toolName: error.toolName,
						preview: error.preview.slice(0, 500),
					}
				: null;
		appendLlmTrace("provider_error", {
			callId,
			provider: normalizedRequest.providerId,
			providerEndpointId: normalizedRequest.providerEndpointId ?? null,
			role: normalizedRequest.role ?? null,
			routeSource: normalizedRequest.routeSource ?? null,
			providerClass: normalizedRequest.providerClass,
			model: normalizedRequest.modelOrDeployment ?? null,
			thinkingDepth: normalizedRequest.thinkingDepth ?? null,
			round: options.round ?? null,
			label: options.label,
			durationMs: Date.now() - startedAt,
			errorName: error instanceof Error ? error.name : null,
			errorMessage: error instanceof Error ? error.message : String(error),
			providerDebug: {
				...providerDebug,
				...(rejectedActivity ? { rejectedActivity } : {}),
			},
		});
		throw error;
	} finally {
		requestAbortHandle.dispose();
	}

	if (!rawContent) {
		appendLlmTrace("empty_response", {
			callId,
			provider: normalizedRequest.providerId,
			providerEndpointId: normalizedRequest.providerEndpointId ?? null,
			role: normalizedRequest.role ?? null,
			routeSource: normalizedRequest.routeSource ?? null,
			providerClass: normalizedRequest.providerClass,
			model: normalizedRequest.modelOrDeployment ?? null,
			thinkingDepth: normalizedRequest.thinkingDepth ?? null,
			round: options.round ?? null,
			label: options.label,
			durationMs: Date.now() - startedAt,
			providerDebug,
		});
		throw new Error("LLM returned an empty message response.");
	}

	if (options.taskId && providerUsage) {
		const promptPartTokenEstimates = {
			...options.promptPartTokenEstimates,
			systemPromptTokens:
				options.promptPartTokenEstimates?.systemPromptTokens ??
				estimateTokens(systemPrompt),
			userPromptTokens:
				options.promptPartTokenEstimates?.userPromptTokens ??
				estimateTokens(userPrompt),
		};
		await recordLlmUsage({
			taskId: options.taskId,
			runId: options.runId ?? null,
			callId,
			provider: normalizedRequest.providerId,
			model: providerModel ?? normalizedRequest.modelOrDeployment ?? null,
			label: options.label,
			round: options.round ?? null,
			usage: providerUsage,
			promptPartTokenEstimates,
			durationMs: Date.now() - startedAt,
			metadataJson: {
				schemaFirst: Boolean(options.schemaFirst),
				providerEndpointId: normalizedRequest.providerEndpointId ?? null,
				role: normalizedRequest.role ?? null,
				routeSource: normalizedRequest.routeSource ?? null,
				providerClass: normalizedRequest.providerClass,
				callKind: normalizedRequest.callKind,
				diagnostics: normalizedRequest.diagnostics,
				jsonSchemaName: normalizedRequest.jsonSchema?.name ?? null,
				systemPromptLength: systemPrompt.length,
				userPromptLength: userPrompt.length,
				systemPromptBytes: Buffer.byteLength(systemPrompt, "utf8"),
				userPromptBytes: Buffer.byteLength(userPrompt, "utf8"),
				systemPromptSha256: digestLlmText(systemPrompt),
				userPromptSha256: digestLlmText(userPrompt),
				promptBudgetMetadata: options.promptBudgetMetadata ?? null,
			},
		});
	}

	appendLlmTrace("response", {
		callId,
		provider: normalizedRequest.providerId,
		providerEndpointId: normalizedRequest.providerEndpointId ?? null,
		role: normalizedRequest.role ?? null,
		routeSource: normalizedRequest.routeSource ?? null,
		providerClass: normalizedRequest.providerClass,
		model: providerModel ?? normalizedRequest.modelOrDeployment ?? null,
		thinkingDepth: normalizedRequest.thinkingDepth ?? null,
		round: options.round ?? null,
		label: options.label,
		durationMs: Date.now() - startedAt,
		rawContent,
		rawContentLength: rawContent.length,
		rawContentBytes: Buffer.byteLength(rawContent, "utf8"),
		rawContentSha256: digestLlmText(rawContent),
		providerDebug,
	});
	await emitSupervisorLlmDebugEvent(options, {
		type: "model.response_finished",
		severity: "info",
		message: `Supervisor LLM response received. provider=${normalizedRequest.providerId} bytes=${Buffer.byteLength(rawContent, "utf8")}`,
		data: {
			provider: normalizedRequest.providerId,
			providerEndpointId: normalizedRequest.providerEndpointId ?? null,
			role: normalizedRequest.role ?? null,
			routeSource: normalizedRequest.routeSource ?? null,
			providerClass: normalizedRequest.providerClass,
			callKind: normalizedRequest.callKind,
			model: providerModel ?? normalizedRequest.modelOrDeployment ?? null,
			thinkingDepth: normalizedRequest.thinkingDepth ?? null,
			round: options.round ?? null,
			label: options.label,
			rawContentLength: rawContent.length,
			rawContent,
			durationMs: Date.now() - startedAt,
			providerDebug,
		},
	});

	return rawContent;
}

function shouldTryStructuredLlmRouteFallback(error: unknown) {
	if (error instanceof ProviderActivityRejectedError) return false;
	if (!(error instanceof Error)) return false;
	if (error.name === "AbortError") return true;
	const message = error.message.toLowerCase();
	return (
		message.includes("operation was aborted") ||
		message.includes("fetch failed") ||
		message.includes("network") ||
		message.includes("econnreset") ||
		message.includes("etimedout") ||
		message.includes("econnrefused") ||
		message.includes("socket hang up") ||
		/status\s+(429|500|502|503|504)/i.test(error.message)
	);
}

async function emitStructuredLlmRouteFallbackStarted(
	options: CallSupervisorOptions,
	from: NormalizedSupervisorLlmRequest,
	to: NormalizedSupervisorLlmRequest,
	error: unknown,
) {
	const errorMessage = error instanceof Error ? error.message : String(error);
	await emitSupervisorLlmDebugEvent(options, {
		type: "model.route_fallback_scheduled",
		severity: "warning",
		message: `Structured LLM provider failed; retrying with role route fallback ${to.providerEndpointId ?? to.providerId}.`,
		data: {
			round: options.round ?? null,
			reason: "provider_transport_error",
			errorMessage,
			from: summarizeRouteForEvent(from),
			to: summarizeRouteForEvent(to),
		},
	});
	await emitSupervisorLlmDebugEvent(options, {
		type: "model.route_fallback_started",
		severity: "info",
		message: `Structured LLM role route fallback started. provider=${to.providerId} round=${options.round ?? "unknown"}`,
		data: {
			round: options.round ?? null,
			reason: "provider_transport_error",
			from: summarizeRouteForEvent(from),
			to: summarizeRouteForEvent(to),
		},
	});
}

async function emitStructuredLlmRouteFallbackUnavailable(
	options: CallSupervisorOptions,
	request: NormalizedSupervisorLlmRequest,
	error: unknown,
) {
	if (!request.role) return;
	await emitSupervisorLlmDebugEvent(options, {
		type: "model.route_fallback_unavailable",
		severity: "warning",
		message:
			"Structured LLM provider failed and no role route fallback was available.",
		data: {
			round: options.round ?? null,
			code: "NO_PROVIDER_FALLBACK_CONFIGURED",
			reason: "provider_transport_error",
			errorMessage: error instanceof Error ? error.message : String(error),
			route: summarizeRouteForEvent(request),
		},
	});
}

function summarizeRouteForEvent(request: NormalizedSupervisorLlmRequest) {
	return {
		providerId: request.providerId,
		providerEndpointId: request.providerEndpointId ?? null,
		routeSource: request.routeSource ?? null,
		role: request.role ?? null,
		model: request.modelOrDeployment ?? null,
		thinkingDepth: request.thinkingDepth ?? null,
	};
}

async function parseJsonContent(
	rawContent: string,
	options: CallSupervisorOptions,
	label: string,
) {
	const jsonFix = jsonFixWrapper(rawContent);
	if (!jsonFix) {
		await emitSupervisorLlmDebugEvent(options, {
			type: "model.response_parse_failed",
			severity: "error",
			message: `${label} JSON parse failed and automatic repair did not produce JSON.`,
			data: {
				round: options.round ?? null,
				rawContentPreview: rawContent.slice(0, 500),
			},
		});
		appendSupervisorTrace("json_parse_failed", {
			round: options.round,
			errorMessage:
				"JSON parse failed and automatic repair did not produce JSON",
			rawContentPreview: rawContent.slice(0, 1000),
		});
		const error = new Error(`${label} response JSON parse failed.`);
		(error as Error & { rawContent?: string }).rawContent = rawContent;
		throw error;
	}
	if (jsonFix.repaired) {
		await emitSupervisorLlmDebugEvent(options, {
			type: "model.response_repaired",
			severity: "warning",
			message: `${label} response JSON was repaired before schema validation.`,
			data: {
				round: options.round ?? null,
				repairKind: jsonFix.repairKind,
				rawContentLength: rawContent.length,
				repairedContentLength: jsonFix.sourceText.length,
			},
		});
	}
	return jsonFix;
}
