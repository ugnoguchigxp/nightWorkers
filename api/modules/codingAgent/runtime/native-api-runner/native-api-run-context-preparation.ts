import type { StructuredLlmModelTarget } from "../../../../services/structured-llm/settings";
import type { ProviderToolDefinition } from "../../../../services/structured-llm/tool-calls";
import type { StructuredLlmRoutePolicy } from "../../../../services/structured-llm/types";
import type {
	AgentRunContext,
	AgentRuntimeResult,
	AgentRuntimeSink,
} from "../types";
import {
	estimateNativeApiContextBudget,
	renderNativeApiContextBudgetHint,
} from "./native-api-context-budget";
import {
	compactNativeApiHistoryToBaseline,
	type NativeApiBaselineCompactionResult,
} from "./native-api-context-compaction";
import { readNativeApiExecutionMode } from "./native-api-mode";
import {
	buildNativeApiProviderRequests,
	type NativeApiProviderRequest,
} from "./native-api-request-adapter";
import {
	contextBudgetFailureResult,
	emitNativeApiContextBudgetEvent,
	MAX_RUNTIME_BASELINE_COMPACTIONS,
} from "./native-api-runner-context-events";
import type { buildTodoSnapshotHistory } from "./native-api-runner-history-cards";
import { buildPostImportHistoryItem } from "./native-api-runner-history-cards";
import type { NativeApiDispatchState } from "./native-api-tool-dispatcher";
import type { NativeApiHistoryItem } from "./native-api-tool-history";

type PreparedContext = {
	kind: "prepared";
	history: NativeApiHistoryItem[];
	providerRequests: NativeApiProviderRequest[];
	contextBudget: ReturnType<typeof estimateNativeApiContextBudget>;
	contextCompaction: NativeApiBaselineCompactionResult | null;
	contextBudgetHintInserted: boolean;
	runtimeBaselineCompactionCount: number;
};

type FailedContext = {
	kind: "failed";
	result: AgentRuntimeResult;
};

export async function prepareNativeApiRunContext(input: {
	context: AgentRunContext;
	sink: AgentRuntimeSink;
	turnIndex: number;
	history: NativeApiHistoryItem[];
	contextWindowBaselineHistory: NativeApiHistoryItem[];
	todoSnapshot: Awaited<ReturnType<typeof buildTodoSnapshotHistory>>;
	state: NativeApiDispatchState;
	tools: readonly ProviderToolDefinition[];
	routeOverride: StructuredLlmModelTarget | null;
	routePolicy: StructuredLlmRoutePolicy;
	providerRequests: NativeApiProviderRequest[];
	contextBudgetHintInserted: boolean;
	runtimeBaselineCompactionCount: number;
}): Promise<PreparedContext | FailedContext> {
	let { history, providerRequests, contextBudgetHintInserted } = input;
	let runtimeBaselineCompactionCount = input.runtimeBaselineCompactionCount;
	let contextBudget = estimateNativeApiContextBudget(providerRequests[0]);
	let contextCompaction: NativeApiBaselineCompactionResult | null = null;

	if (contextBudget.warningThresholdExceeded && !contextBudgetHintInserted) {
		await emitNativeApiContextBudgetEvent({
			sink: input.sink,
			context: input.context,
			action: "context_budget_warning",
			turnIndex: input.turnIndex,
			budget: contextBudget,
			message: "[NativeApiRunner] context budget warning threshold exceeded.",
		});
		history = [
			...history,
			{
				type: "user",
				source: "runtime",
				content: renderNativeApiContextBudgetHint(contextBudget),
			},
		];
		contextBudgetHintInserted = true;
		providerRequests = rebuildProviderRequests(input, history);
		if (providerRequests.length === 0) {
			await emitNoRouteError(input);
			return { kind: "failed", result: noRouteResult() };
		}
		contextBudget = estimateNativeApiContextBudget(providerRequests[0]);
	}

	if (contextBudget.compactLimitExceeded) {
		if (runtimeBaselineCompactionCount >= MAX_RUNTIME_BASELINE_COMPACTIONS) {
			await emitNativeApiContextBudgetEvent({
				sink: input.sink,
				context: input.context,
				action: "context_compaction_failed",
				turnIndex: input.turnIndex,
				budget: contextBudget,
				message:
					"[NativeApiRunner] context compaction loop guard stopped provider-native execution.",
			});
			return {
				kind: "failed",
				result: contextBudgetFailureResult(
					contextBudget,
					"context_compaction_loop_guard",
				),
			};
		}
		await emitNativeApiContextBudgetEvent({
			sink: input.sink,
			context: input.context,
			action: "context_compaction_started",
			turnIndex: input.turnIndex,
			budget: contextBudget,
			message:
				"[NativeApiRunner] context compaction started before provider call.",
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
		providerRequests = rebuildProviderRequests(input, history);
		if (providerRequests.length === 0) {
			await emitNativeApiContextBudgetEvent({
				sink: input.sink,
				context: input.context,
				action: "context_compaction_failed",
				turnIndex: input.turnIndex,
				budget: contextBudget,
				message:
					"[NativeApiRunner] context compaction finished but no native/API provider route candidates remained.",
				compaction: contextCompaction,
			});
			return {
				kind: "failed",
				result: {
					terminalState: "needs_human",
					summary:
						"No native/API provider route candidates were available after compaction.",
					finalReport:
						"Context compaction completed, but no native/API provider route candidates remained. NativeApiRunner did not fall back to Codex or SchemaFirst.",
					stoppedBy: "budget",
					riskLevel: "high",
				},
			};
		}
		contextBudget = estimateNativeApiContextBudget(providerRequests[0]);
		await emitNativeApiContextBudgetEvent({
			sink: input.sink,
			context: input.context,
			action: "context_compaction_finished",
			turnIndex: input.turnIndex,
			budget: contextBudget,
			message:
				"[NativeApiRunner] context compaction finished before provider call.",
			compaction: contextCompaction,
		});
		if (contextBudget.compactLimitExceeded || contextBudget.hardLimitExceeded) {
			await emitNativeApiContextBudgetEvent({
				sink: input.sink,
				context: input.context,
				action: "context_compaction_failed",
				turnIndex: input.turnIndex,
				budget: contextBudget,
				message:
					"[NativeApiRunner] context compaction did not reduce the provider request below the compact limit.",
				compaction: contextCompaction,
			});
			return {
				kind: "failed",
				result: contextBudgetFailureResult(
					contextBudget,
					"context_compaction_insufficient",
				),
			};
		}
	}

	return {
		kind: "prepared",
		history,
		providerRequests,
		contextBudget,
		contextCompaction,
		contextBudgetHintInserted,
		runtimeBaselineCompactionCount,
	};
}

function rebuildProviderRequests(
	input: Parameters<typeof prepareNativeApiRunContext>[0],
	history: NativeApiHistoryItem[],
) {
	return buildNativeApiProviderRequests({
		context: input.context,
		history,
		tools: input.tools,
		routeOverride: input.routeOverride,
		routePolicy: input.routePolicy,
	});
}

async function emitNoRouteError(
	input: Pick<
		Parameters<typeof prepareNativeApiRunContext>[0],
		"sink" | "context"
	>,
) {
	await input.sink.emit({
		type: "runtime_error",
		message:
			"[NativeApiRunner] no native/API provider route candidates were available.",
		payload: {
			runtime: "native_api_runner",
			executionMode: readExecutionMode(input.context),
			reason: "no_native_api_provider_route_candidates",
		},
	});
}

function noRouteResult(): AgentRuntimeResult {
	return {
		terminalState: "needs_human",
		summary: "No native/API provider route candidates were available.",
		finalReport:
			"No native/API provider route candidates were available. NativeApiRunner did not fall back to Codex or SchemaFirst.",
		stoppedBy: "llm_error",
		riskLevel: "high",
	};
}

function readExecutionMode(context: AgentRunContext) {
	return readNativeApiExecutionMode(context);
}
