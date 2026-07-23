import type { StructuredLlmModelTarget } from "../../../../services/structured-llm/settings";
import type {
	ProviderToolDefinition,
	ProviderToolTurnResult,
} from "../../../../services/structured-llm/tool-calls";
import type { StructuredLlmRoutePolicy } from "../../../../services/structured-llm/types";
import { digestText } from "../../../../services/text-digest";
import type { AgentRunContext, AgentRuntimeSink } from "../types";
import type { NativeApiBaselineCompactionResult } from "./native-api-context-compaction";
import { compactNativeApiHistoryToBaseline } from "./native-api-context-compaction";
import {
	buildNativeApiProviderRequests,
	type NativeApiProviderRequest,
} from "./native-api-request-adapter";
import {
	emitNativeApiContextBudgetEvent,
	MAX_RUNTIME_BASELINE_COMPACTIONS,
	summarizeNativeApiContextCompaction,
} from "./native-api-runner-context-events";
import { buildPostImportHistoryItem } from "./native-api-runner-history-cards";
import {
	classifyNativeApiProviderError,
	emitNativeApiRouteFallback,
	summarizeNativeApiRoute,
	validateNativeApiRouteSnapshot,
} from "./native-api-runner-routing";
import { createNativeApiAttemptTimeoutSignal } from "./native-api-runner-timeout";
import type { NativeApiDispatchState } from "./native-api-tool-dispatcher";
import type { NativeApiHistoryItem } from "./native-api-tool-history";

export type NativeApiToolTurnProvider = (input: {
	provider: string;
	messages: NativeApiProviderRequest["messages"];
	tools: NativeApiProviderRequest["tools"];
	systemPrompt: string;
	userPrompt: string;
	options: NativeApiProviderRequest["options"];
	signal: AbortSignal;
	setProviderDebug: (value: Record<string, unknown>) => void;
}) => Promise<ProviderToolTurnResult>;

export type NativeApiProviderAttemptResult = {
	providerResult: ProviderToolTurnResult | null;
	providerRequest: NativeApiProviderRequest;
	providerRequests: NativeApiProviderRequest[];
	providerDebug: Record<string, unknown>;
	contextBudget: ReturnType<
		typeof import("./native-api-context-budget").estimateNativeApiContextBudget
	>;
	contextCompaction: NativeApiBaselineCompactionResult | null;
	history: NativeApiHistoryItem[];
	runtimeBaselineCompactionCount: number;
	startedAt: number;
	failureMessage: string | null;
};

export async function runNativeApiProviderAttempts(input: {
	context: AgentRunContext;
	sink: AgentRuntimeSink;
	turnId: string;
	turnIndex: number;
	executionMode: string;
	signal: AbortSignal;
	history: NativeApiHistoryItem[];
	contextWindowBaselineHistory: NativeApiHistoryItem[];
	todoSnapshot: {
		snapshotItem: Extract<NativeApiHistoryItem, { type: "user" }> | null;
		currentTodoItem: Extract<NativeApiHistoryItem, { type: "user" }> | null;
	} | null;
	state: NativeApiDispatchState;
	providerRequests: NativeApiProviderRequest[];
	initialProviderRequest: NativeApiProviderRequest;
	contextBudget: NativeApiProviderAttemptResult["contextBudget"];
	contextCompaction: NativeApiBaselineCompactionResult | null;
	runtimeBaselineCompactionCount: number;
	tools: readonly ProviderToolDefinition[];
	routeOverride: StructuredLlmModelTarget | null;
	routePolicy: StructuredLlmRoutePolicy;
	providerTurn: NativeApiToolTurnProvider;
	isCancelled: (runId: string, signal?: AbortSignal) => Promise<boolean>;
}): Promise<NativeApiProviderAttemptResult> {
	let { contextBudget, contextCompaction, history, providerRequests } = input;
	let runtimeBaselineCompactionCount = input.runtimeBaselineCompactionCount;
	let contextPreflightDebug = {
		contextBudget,
		...(contextCompaction
			? {
					contextCompaction:
						summarizeNativeApiContextCompaction(contextCompaction),
				}
			: {}),
	};
	let providerDebug: Record<string, unknown> = { ...contextPreflightDebug };
	let providerResult: ProviderToolTurnResult | null = null;
	let providerRequest: NativeApiProviderRequest = input.initialProviderRequest;
	let startedAt = Date.now();
	let lastProviderFailure: {
		message: string;
		providerDebug: Record<string, unknown>;
	} | null = null;
	const routeAttempts: Array<Record<string, unknown>> = [];

	for (
		let attemptIndex = 0;
		attemptIndex < providerRequests.length;
		attemptIndex += 1
	) {
		providerRequest = providerRequests[attemptIndex];
		contextBudget = importEstimateNativeApiContextBudget(providerRequest);
		if (contextBudget.compactLimitExceeded) {
			if (runtimeBaselineCompactionCount >= MAX_RUNTIME_BASELINE_COMPACTIONS) {
				const message =
					"Context compaction loop guard stopped provider-native route attempt before provider call.";
				await emitNativeApiContextBudgetEvent({
					sink: input.sink,
					context: input.context,
					action: "context_compaction_failed",
					turnIndex: input.turnIndex,
					budget: contextBudget,
					message: `[NativeApiRunner] ${message}`,
				});
				lastProviderFailure = { message, providerDebug };
				routeAttempts.push({
					attemptIndex,
					ok: false,
					reason: "context_compaction_loop_guard",
					message,
					durationMs: 0,
					attemptTimeoutMs: providerRequest.options.attemptTimeoutMs ?? null,
					route: summarizeNativeApiRoute(providerRequest),
					providerDebug,
				});
				providerResult = null;
				break;
			}
			await emitNativeApiContextBudgetEvent({
				sink: input.sink,
				context: input.context,
				action: "context_compaction_started",
				turnIndex: input.turnIndex,
				budget: contextBudget,
				message:
					"[NativeApiRunner] context compaction started before provider route attempt.",
			});
			contextCompaction = compactNativeApiHistoryToBaseline({
				baselineHistory: input.contextWindowBaselineHistory,
				previousHistory: history,
				reason: contextBudget.hardLimitExceeded
					? "hard_limit_exceeded_before_provider_call"
					: "auto_compact_limit_exceeded_before_provider_call",
				todoSnapshotItem: input.todoSnapshot?.snapshotItem,
				currentTodoItem: input.todoSnapshot?.currentTodoItem,
				postImportHistoryItem: input.state.postImport
					? buildPostImportHistoryItem(input.state.postImport)
					: null,
			});
			runtimeBaselineCompactionCount += 1;
			history = contextCompaction.history;
			providerRequests = buildNativeApiProviderRequests({
				context: input.context,
				history,
				tools: input.tools,
				routeOverride: input.routeOverride,
				routePolicy: input.routePolicy,
			});
			const rebuiltRouteSnapshotGuard = validateNativeApiRouteSnapshot(
				providerRequests,
				input.context,
			);
			if (!rebuiltRouteSnapshotGuard.ok) {
				const message =
					"Context compaction rebuilt a provider route candidate outside the run snapshot.";
				await input.sink.emit({
					type: "runtime_error",
					message: `[NativeApiRunner] ${message}`,
					payload: {
						runtime: "native_api_runner",
						executionMode: input.executionMode,
						reason: "route_candidate_outside_snapshot",
						route: rebuiltRouteSnapshotGuard.route,
					},
				});
				lastProviderFailure = { message, providerDebug };
				providerResult = null;
				break;
			}
			providerRequest = providerRequests[attemptIndex];
			if (!providerRequest) {
				const message =
					"Context compaction finished but the native/API route attempt disappeared.";
				await emitNativeApiContextBudgetEvent({
					sink: input.sink,
					context: input.context,
					action: "context_compaction_failed",
					turnIndex: input.turnIndex,
					budget: contextBudget,
					message: `[NativeApiRunner] ${message}`,
					compaction: contextCompaction,
				});
				lastProviderFailure = { message, providerDebug };
				providerResult = null;
				break;
			}
			contextBudget = importEstimateNativeApiContextBudget(providerRequest);
			contextPreflightDebug = {
				contextBudget,
				contextCompaction:
					summarizeNativeApiContextCompaction(contextCompaction),
			};
			await emitNativeApiContextBudgetEvent({
				sink: input.sink,
				context: input.context,
				action: "context_compaction_finished",
				turnIndex: input.turnIndex,
				budget: contextBudget,
				message:
					"[NativeApiRunner] context compaction finished before provider route attempt.",
				compaction: contextCompaction,
			});
			if (
				contextBudget.compactLimitExceeded ||
				contextBudget.hardLimitExceeded
			) {
				const message =
					"Context compaction did not reduce the provider route attempt below the compact limit.";
				await emitNativeApiContextBudgetEvent({
					sink: input.sink,
					context: input.context,
					action: "context_compaction_failed",
					turnIndex: input.turnIndex,
					budget: contextBudget,
					message: `[NativeApiRunner] ${message}`,
					compaction: contextCompaction,
				});
				providerDebug = { ...contextPreflightDebug };
				lastProviderFailure = { message, providerDebug };
				routeAttempts.push({
					attemptIndex,
					ok: false,
					reason: "context_budget_exceeded_before_provider_call",
					message,
					durationMs: 0,
					attemptTimeoutMs: providerRequest.options.attemptTimeoutMs ?? null,
					route: summarizeNativeApiRoute(providerRequest),
					providerDebug,
				});
				providerResult = null;
				break;
			}
		} else {
			contextPreflightDebug = {
				contextBudget,
				...(contextCompaction
					? {
							contextCompaction:
								summarizeNativeApiContextCompaction(contextCompaction),
						}
					: {}),
			};
		}
		providerDebug = { ...contextPreflightDebug };
		startedAt = Date.now();
		const attemptTimeoutMs = providerRequest.options.attemptTimeoutMs;
		const attemptSignal = createNativeApiAttemptTimeoutSignal(
			input.signal,
			attemptTimeoutMs,
		);
		await input.sink.emit({
			type: "model_response_started",
			message: "[NativeApiRunner] Provider request started.",
			payload: {
				runtime: "native_api_runner",
				turnId: input.turnId,
				turnIndex: input.turnIndex,
				attemptIndex,
				provider: providerRequest.provider,
				systemContextAudit: providerRequest.systemContextAudit,
				systemPromptSha256: digestText(providerRequest.systemPrompt),
				userPromptSha256: digestText(providerRequest.userPrompt),
			},
		});
		try {
			providerResult = await input.providerTurn({
				provider: providerRequest.provider,
				messages: providerRequest.messages,
				tools: providerRequest.tools,
				systemPrompt: providerRequest.systemPrompt,
				userPrompt: providerRequest.userPrompt,
				options: providerRequest.options,
				signal: attemptSignal.signal,
				setProviderDebug: (value) => {
					providerDebug = value;
				},
			});
		} catch (error) {
			const durationMs = Date.now() - startedAt;
			const classified = classifyNativeApiProviderError(error, {
				attemptTimedOut: attemptSignal.didTimeout(),
				attemptTimeoutMs,
			});
			const message = classified.message;
			lastProviderFailure = { message, providerDebug };
			routeAttempts.push({
				attemptIndex,
				ok: false,
				reason: classified.reason,
				message,
				durationMs,
				attemptTimeoutMs: attemptTimeoutMs ?? null,
				route: summarizeNativeApiRoute(providerRequest),
				providerDebug,
			});
			if (
				input.signal.aborted ||
				(await input.isCancelled(input.context.runId, input.signal))
			) {
				providerResult = null;
				break;
			}
			if (classified.retryable && attemptIndex < providerRequests.length - 1) {
				await emitNativeApiRouteFallback({
					sink: input.sink,
					turnId: input.turnId,
					attemptIndex,
					from: providerRequest,
					to: providerRequests[attemptIndex + 1],
					reason: classified.reason,
					message,
				});
				continue;
			}
			providerResult = null;
		} finally {
			attemptSignal.dispose();
		}

		if (!providerResult) break;
		routeAttempts.push({
			attemptIndex,
			ok: providerResult.type === "supported",
			reason:
				providerResult.type === "unsupported"
					? "unsupported"
					: providerResult.toolCalls.length === 0 &&
							!providerResult.content.trim()
						? "empty_no_tool_calls"
						: "accepted",
			durationMs: Date.now() - startedAt,
			attemptTimeoutMs: attemptTimeoutMs ?? null,
			route: summarizeNativeApiRoute(providerRequest),
			providerDebug,
		});
		if (
			providerResult.type === "supported" &&
			(providerResult.toolCalls.length > 0 || providerResult.content.trim())
		) {
			break;
		}
		if (
			input.signal.aborted ||
			(await input.isCancelled(input.context.runId, input.signal))
		) {
			providerResult = null;
			break;
		}
		if (attemptIndex < providerRequests.length - 1) {
			await emitNativeApiRouteFallback({
				sink: input.sink,
				turnId: input.turnId,
				attemptIndex,
				from: providerRequest,
				to: providerRequests[attemptIndex + 1],
				reason:
					providerResult.type === "unsupported"
						? "unsupported_provider"
						: "empty_no_tool_calls",
				message:
					providerResult.type === "unsupported"
						? providerResult.reason
						: "Provider returned no native tool calls or content.",
			});
			continue;
		}
		break;
	}

	providerDebug = {
		...contextPreflightDebug,
		...(providerResult?.providerDebug ?? providerDebug),
		routeAttempts,
	};
	return {
		providerResult,
		providerRequest,
		providerRequests,
		providerDebug,
		contextBudget,
		contextCompaction,
		history,
		runtimeBaselineCompactionCount,
		startedAt,
		failureMessage: lastProviderFailure?.message ?? null,
	};
}

import { estimateNativeApiContextBudget } from "./native-api-context-budget";

function importEstimateNativeApiContextBudget(
	request: NativeApiProviderRequest,
) {
	return estimateNativeApiContextBudget(request);
}
