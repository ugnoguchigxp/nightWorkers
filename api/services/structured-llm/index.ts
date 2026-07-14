import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { appendLlmTrace, logger } from "../../lib/logger";
import { estimateTokens } from "../conversation-context/token-budget";
import type { NormalizedLlmUsage } from "../llm-usage";
import { recordLlmUsage } from "../llm-usage";
import {
	type AgentToolCallEnvelope,
	buildResponseJsonSchema as buildSchemaFirstResponseJsonSchema,
	type JobTypeSelection,
} from "../supervisor/schema-first";
import {
	type StructuredLlmResult,
	type StructuredLlmResultOptions,
	zodIssuesToStructuredLlmIssues,
} from "./contract";
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
import {
	emitStructuredLlmRouteFallbackStarted,
	emitStructuredLlmRouteFallbackUnavailable,
	shouldTryStructuredLlmRouteFallback,
} from "./route-fallback";
import { parseSupervisorLlmResponse } from "./supervisor-response";
import type {
	CallSupervisorOptions,
	NormalizedSupervisorLlmRequest,
	StructuredJsonLlmOptions,
} from "./types";

export * from "./public";

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
	return parseSupervisorLlmResponse(rawContent, options);
}

/**
 * @deprecated Compatibility seam for provider-level tests and external callers.
 * Product generation paths must use callStructuredLlmResult.
 */
export async function callStructuredJsonLLM(
	systemPrompt: string,
	userPrompt: string,
	options: StructuredJsonLlmOptions,
): Promise<string> {
	return callRawJsonLLM(systemPrompt, userPrompt, {
		...options,
		jsonSchema: { name: options.schemaName, schema: options.schema },
		label: options.schemaName,
	});
}

/**
 * Calls a provider and preserves its response while returning parse and schema
 * failures as data. Product services decide whether to show, repair, or reject
 * the response without replacing the model's text.
 */
export async function callStructuredLlmResult<T>(
	systemPrompt: string,
	userPrompt: string,
	options: StructuredLlmResultOptions<T>,
): Promise<StructuredLlmResult<T>> {
	const rawText = await callRawJsonLLM(systemPrompt, userPrompt, {
		...options,
		jsonSchema: {
			name: options.contract.name,
			schema: options.contract.providerJsonSchema,
		},
		label: options.contract.name,
	});
	const attemptNumber = options.attempt ?? 1;
	const jsonFix = jsonFixWrapper(rawText);
	const attempt = {
		attempt: attemptNumber,
		rawText,
		extractedText: jsonFix?.candidateText ?? null,
		repairedText:
			jsonFix && jsonFix.sourceText !== jsonFix.candidateText
				? jsonFix.sourceText
				: null,
		repairKind: jsonFix?.repairKind ?? null,
	};

	if (!jsonFix) {
		const issues = [
			{
				stage: "parse" as const,
				path: [],
				code: "invalid_json",
				message: "応答本文から JSON を抽出できませんでした。",
			},
		];
		await emitSupervisorLlmDebugEvent(options, {
			type: "model.response_parse_failed",
			severity: "error",
			message: `${options.contract.name} response did not contain parseable JSON.`,
			data: {
				round: null,
				attempt: attemptNumber,
				rawContentPreview: rawText.slice(0, 500),
			},
		});
		return { ok: false, value: null, attempt, issues };
	}

	if (jsonFix.repaired) {
		await emitSupervisorLlmDebugEvent(options, {
			type: "model.response_repaired",
			severity: "warning",
			message: `${options.contract.name} response JSON was extracted or syntactically repaired before schema validation.`,
			data: {
				round: null,
				attempt: attemptNumber,
				repairKind: jsonFix.repairKind,
				rawContentLength: rawText.length,
				repairedContentLength: jsonFix.sourceText.length,
			},
		});
	}

	const parsed = options.contract.runtimeSchema.safeParse(jsonFix.parsedJson);
	if (!parsed.success) {
		const issues = zodIssuesToStructuredLlmIssues(parsed.error.issues);
		await emitSupervisorLlmDebugEvent(options, {
			type: "model.response_parse_failed",
			severity: "error",
			message: `${options.contract.name} response failed schema validation.`,
			data: {
				round: null,
				attempt: attemptNumber,
				issues,
				rawContentPreview: rawText.slice(0, 500),
			},
		});
		return { ok: false, value: null, attempt, issues };
	}
	if (!isDeepStrictEqual(parsed.data, jsonFix.parsedJson)) {
		const issues = [
			{
				stage: "schema" as const,
				path: [],
				code: "non_lossless_schema_parse",
				message:
					"Schema validation added, removed, or transformed response fields.",
			},
		];
		await emitSupervisorLlmDebugEvent(options, {
			type: "model.response_parse_failed",
			severity: "error",
			message: `${options.contract.name} response required a semantic schema transformation.`,
			data: {
				round: null,
				attempt: attemptNumber,
				issues,
				rawContentPreview: rawText.slice(0, 500),
			},
		});
		return { ok: false, value: null, attempt, issues };
	}

	return { ok: true, value: parsed.data, attempt, issues: [] };
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
		projectionVersion:
			options.promptBudgetMetadata?.artifactProjection?.version ?? null,
		projectionDigest:
			options.promptBudgetMetadata?.artifactProjection?.digest ?? null,
		questionnaireDecisionCount:
			options.promptBudgetMetadata?.artifactProjection
				?.questionnaireDecisionCount ?? null,
		initialPromptOccurrences:
			options.promptBudgetMetadata?.artifactProjection
				?.initialPromptOccurrences ?? null,
		sourceMessageCount:
			options.promptBudgetMetadata?.artifactProjection?.sourceCount ?? null,
		staleSourceRejectedCount:
			options.promptBudgetMetadata?.artifactProjection
				?.staleSourceRejectedCount ?? null,
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
			trace: options.usageTrace,
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
		projectionVersion:
			options.promptBudgetMetadata?.artifactProjection?.version ?? null,
		projectionDigest:
			options.promptBudgetMetadata?.artifactProjection?.digest ?? null,
		questionnaireDecisionCount:
			options.promptBudgetMetadata?.artifactProjection
				?.questionnaireDecisionCount ?? null,
		initialPromptOccurrences:
			options.promptBudgetMetadata?.artifactProjection
				?.initialPromptOccurrences ?? null,
		sourceMessageCount:
			options.promptBudgetMetadata?.artifactProjection?.sourceCount ?? null,
		staleSourceRejectedCount:
			options.promptBudgetMetadata?.artifactProjection
				?.staleSourceRejectedCount ?? null,
		agenticItemCount:
			typeof providerDebug.agenticItemCount === "number"
				? providerDebug.agenticItemCount
				: null,
		providerTurnCount:
			typeof providerDebug.providerTurnCount === "number"
				? providerDebug.providerTurnCount
				: null,
		freshThread:
			typeof providerDebug.freshThread === "boolean"
				? providerDebug.freshThread
				: null,
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
