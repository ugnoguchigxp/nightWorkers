import { randomUUID } from "node:crypto";
import { normalizeProviderUsage } from "../llm-usage/normalize";
import {
	buildProviderToolTurnJsonSchema,
	buildProviderToolTurnPrompt,
	PROVIDER_TOOL_TURN_SCHEMA_NAME,
	parseProviderToolTurnResponse,
} from "./codex-tool-turn";
import { traceProviderActivity } from "./events";
import {
	cancelMuseAgentTurn,
	createMuseAgentSession,
	MUSE_DEFAULT_BASE_URL,
	MUSE_DEFAULT_MODEL,
	releaseMuseAgentSession,
	startMuseAgentTurn,
	streamMuseAgentEvents,
} from "./muse-provider-client";
import { getResolvedProviderEndpoint } from "./openai-compatible-provider-support";
import { StructuredProviderError } from "./provider-failure";
import type { RawLlmCallOptions } from "./providers";
import type { readStructuredLlmProviderSettings } from "./settings";
import type {
	ProviderToolDefinition,
	ProviderToolMessage,
	ProviderToolTurnResult,
	RawToolTurnCallOptions,
} from "./tool-calls";
import type { ProviderCallResult } from "./types";

const MUSE_INTERACTION_EVENTS = new Set([
	"approval.required",
	"approval.requested",
	"user_input.required",
	"user_input.requested",
]);
const MUSE_FAILURE_EVENTS = new Set(["error", "session.error", "turn.failed"]);

export type MuseProviderInput = {
	provider: string;
	systemPrompt: string;
	userPrompt: string;
	options: RawLlmCallOptions;
	signal: AbortSignal;
	setProviderDebug: (value: Record<string, unknown>) => void;
	fetchImpl?: typeof fetch;
};

export async function callMuseProvider(
	input: MuseProviderInput,
	settings: ReturnType<typeof readStructuredLlmProviderSettings>,
): Promise<ProviderCallResult> {
	const endpoint = getResolvedProviderEndpoint(input, settings);
	if (endpoint && !endpoint.enabled) {
		throw new StructuredProviderError({
			kind: "permission",
			retryable: false,
			message: "Muse provider is inactive. Enable the endpoint first.",
		});
	}
	const baseUrl =
		input.options.normalizedRequest?.endpoint ||
		endpoint?.baseUrl ||
		MUSE_DEFAULT_BASE_URL;
	const model =
		input.options.normalizedRequest?.modelOrDeployment ||
		endpoint?.models[0] ||
		MUSE_DEFAULT_MODEL;
	const apiKey = endpoint?.apiKey || "";
	const requestKey = randomUUID();
	let sessionId: string | null = null;
	let turnId: string | null = null;
	let turnCompleted = false;
	let cleanupStatus = "not_started";
	let providerUsage: unknown = null;
	let agenticItemCount = 0;
	const debug: Record<string, unknown> = {
		provider: "muse",
		runtime: "muse",
		mode: "agent_session",
		baseUrl: redactMuseBaseUrl(baseUrl),
		model,
	};

	try {
		const session = await createMuseAgentSession({
			baseUrl,
			apiKey,
			model,
			signal: input.signal,
			fetchImpl: input.fetchImpl,
			idempotencyKey: `${requestKey}:session`,
		});
		sessionId = session.id;
		debug.providerSessionId = session.id;
		const turn = await startMuseAgentTurn({
			baseUrl,
			apiKey,
			sessionId,
			textInputs: [input.systemPrompt, input.userPrompt],
			signal: input.signal,
			fetchImpl: input.fetchImpl,
			idempotencyKey: `${requestKey}:turn`,
		});
		turnId = turn.id;
		debug.providerTurnId = turn.id;
		const messageTextById = new Map<string, string>();
		let finalContent = "";

		for await (const event of streamMuseAgentEvents({
			baseUrl,
			apiKey,
			sessionId,
			after: session.cursor,
			signal: input.signal,
			fetchImpl: input.fetchImpl,
		})) {
			if (event.sessionId !== sessionId) {
				throw new StructuredProviderError({
					kind: "invalid_response",
					code: "MUSE_SESSION_EVENT_MISMATCH",
					retryable: false,
					message: "Muse returned an event for a different session.",
					providerBody: JSON.stringify(event),
				});
			}
			if (event.turnId && event.turnId !== turn.id) continue;
			const providerActivity = readMuseProviderActivity(event);
			if (providerActivity) {
				agenticItemCount += 1;
				debug.agenticItemCount = agenticItemCount;
				if (input.options.normalizedRequest) {
					await traceProviderActivity({
						options: input.options,
						request: input.options.normalizedRequest,
						activityType: providerActivity.activityType,
						toolName: providerActivity.toolName,
						preview: providerActivity.preview,
					});
				}
			}
			if (event.type === "message.delta") {
				const itemId = readString(event.data.item_id);
				const text = readString(event.data.text);
				if (itemId && text) {
					messageTextById.set(
						itemId,
						`${messageTextById.get(itemId) || ""}${text}`,
					);
				}
			}
			if (event.type === "message.completed") {
				const itemId = readString(event.data.item_id);
				const text = readString(event.data.text);
				finalContent =
					text || (itemId ? messageTextById.get(itemId) || "" : "");
			}
			if (
				event.type === "provider.event" &&
				event.data.method === "session/tokenUsage"
			) {
				providerUsage = event.data;
			}
			if (MUSE_INTERACTION_EVENTS.has(event.type)) {
				throw new StructuredProviderError({
					kind: "permission",
					code: "MUSE_INTERACTION_REQUIRED",
					retryable: false,
					message:
						"Muse requested an approval or user input that cannot be completed by a structured LLM call.",
					providerBody: JSON.stringify(event),
				});
			}
			if (MUSE_FAILURE_EVENTS.has(event.type)) {
				throw new StructuredProviderError({
					kind: "unknown",
					code: "MUSE_AGENT_TURN_FAILED",
					retryable: false,
					message: "Muse agent turn failed.",
					providerBody: JSON.stringify(event),
				});
			}
			if (event.type !== "turn.completed") continue;
			turnCompleted = event.data.terminal === "completed";
			if (!turnCompleted) {
				throw new StructuredProviderError({
					kind: "unknown",
					code: "MUSE_AGENT_TURN_NOT_COMPLETED",
					retryable: false,
					message: "Muse agent turn ended without a completed terminal state.",
					providerBody: JSON.stringify(event),
				});
			}
			if (!finalContent.trim()) {
				throw new StructuredProviderError({
					kind: "invalid_response",
					code: "MUSE_FINAL_RESPONSE_MISSING",
					retryable: false,
					message: "Muse agent turn completed without a final response.",
				});
			}
			debug.terminal = "completed";
			return {
				content: finalContent,
				model,
				usage: normalizeProviderUsage({
					provider: "muse",
					rawUsage: providerUsage,
					fallback: {
						systemPrompt: input.systemPrompt,
						userPrompt: input.userPrompt,
						responseText: finalContent,
					},
				}),
				providerDebug: debug,
			};
		}
		throw new StructuredProviderError({
			kind: "invalid_response",
			code: "MUSE_TERMINAL_EVENT_MISSING",
			retryable: false,
			message: "Muse event stream ended without a terminal turn event.",
		});
	} finally {
		const cleanupSignal = AbortSignal.timeout(5_000);
		if (sessionId && turnId && !turnCompleted) {
			await cancelMuseAgentTurn({
				baseUrl,
				apiKey,
				sessionId,
				turnId,
				signal: cleanupSignal,
				fetchImpl: input.fetchImpl,
				idempotencyKey: `${requestKey}:cancel`,
			}).catch(() => undefined);
		}
		if (sessionId) {
			try {
				await releaseMuseAgentSession({
					baseUrl,
					apiKey,
					sessionId,
					signal: cleanupSignal,
					fetchImpl: input.fetchImpl,
					idempotencyKey: `${requestKey}:release`,
				});
				cleanupStatus = "released";
			} catch {
				cleanupStatus = "release_failed";
			}
		}
		debug.cleanupStatus = cleanupStatus;
		input.setProviderDebug(debug);
	}
}

export async function callMuseProviderToolTurn(
	input: {
		provider: string;
		messages: ProviderToolMessage[];
		tools: ProviderToolDefinition[];
		systemPrompt: string;
		userPrompt: string;
		options: RawToolTurnCallOptions;
		signal: AbortSignal;
		setProviderDebug: (value: Record<string, unknown>) => void;
		fetchImpl?: typeof fetch;
	},
	settings: ReturnType<typeof readStructuredLlmProviderSettings>,
): Promise<ProviderToolTurnResult> {
	if (!input.options.executionPolicy?.allowProviderTools) {
		return {
			type: "unsupported",
			reason:
				"Muse structured tool turns require an explicit provider-tools capability.",
			providerDebug: {
				provider: "muse",
				providerEndpointId:
					input.options.normalizedRequest.providerEndpointId ?? null,
				mode: "muse_structured_tool_turn",
				supported: false,
				allowProviderTools: false,
			},
		};
	}
	const jsonSchema = {
		name: PROVIDER_TOOL_TURN_SCHEMA_NAME,
		schema: buildProviderToolTurnJsonSchema(input.tools),
	};
	const userPrompt = buildProviderToolTurnPrompt({
		providerLabel: "Muse",
		messages: input.messages,
		tools: input.tools,
	});
	let providerDebug: Record<string, unknown> = {};
	const result = await callMuseProvider(
		{
			provider: input.provider,
			systemPrompt: input.systemPrompt,
			userPrompt,
			options: {
				...input.options,
				jsonSchema,
				normalizedRequest: {
					...input.options.normalizedRequest,
					systemPrompt: input.systemPrompt,
					userPrompt,
					jsonSchema,
					diagnostics: {
						...input.options.normalizedRequest.diagnostics,
						artifactSchemaName: PROVIDER_TOOL_TURN_SCHEMA_NAME,
						userPromptLength: userPrompt.length,
					},
				},
			},
			signal: input.signal,
			fetchImpl: input.fetchImpl,
			setProviderDebug: (value) => {
				providerDebug = value;
				input.setProviderDebug(value);
			},
		},
		settings,
	);
	const parsed = parseProviderToolTurnResponse(result.content, input.tools, {
		name: "Muse",
		callIdPrefix: "muse_call_",
	});
	if (!parsed.ok) {
		if (parsed.error) throw parsed.error;
		throw new StructuredProviderError({
			kind: "invalid_response",
			code: "INVALID_TOOL_TURN_RESPONSE",
			retryable: false,
			message:
				result.content.trim() || "Muse returned an empty tool turn response.",
			providerBody: result.content,
			cause: new Error(parsed.reason),
		});
	}
	if (
		typeof providerDebug.agenticItemCount === "number" &&
		providerDebug.agenticItemCount > 0
	) {
		throw new StructuredProviderError({
			kind: "permission",
			retryable: false,
			message:
				result.content.trim() ||
				"Muse tool turn attempted provider-side activity.",
			cause: new Error(
				"Provider-side activity is disabled by execution policy.",
			),
		});
	}
	const completeDebug = {
		...providerDebug,
		mode: "muse_structured_tool_turn",
		toolCallCount: parsed.toolCalls.length,
	};
	input.setProviderDebug(completeDebug);
	return {
		type: "supported",
		content: parsed.content,
		toolCalls: parsed.toolCalls,
		usage: result.usage,
		model: result.model,
		providerDebug: completeDebug,
	};
}

function readString(value: unknown) {
	return typeof value === "string" ? value : "";
}

function readMuseProviderActivity(event: {
	type: string;
	data: Record<string, unknown>;
}) {
	if (
		event.type !== "item.started" &&
		event.type !== "item.completed" &&
		event.type !== "item.updated"
	) {
		return null;
	}
	const kind = readString(event.data.kind);
	if (!kind || kind === "userMessage" || kind === "assistantMessage") {
		return null;
	}
	return {
		activityType: "agentic_item",
		toolName: kind,
		preview: kind,
	};
}

function redactMuseBaseUrl(value: string) {
	try {
		const url = new URL(value);
		url.username = "";
		url.password = "";
		url.search = "";
		url.hash = "";
		return url.toString().replace(/\/$/, "");
	} catch {
		return "[invalid Muse base URL]";
	}
}
