import type {
	AgentRunContext,
	AgentRuntimeResult,
	AgentRuntimeSink,
} from "../types";
import type { NativeApiExecutionMode } from "./native-api-mode";
import { buildNativeApiProviderRequests } from "./native-api-request-adapter";
import type { NativeApiRuntimeTodoSnapshot } from "./native-api-runner-history-cards";
import {
	buildNativeApiRoutePolicy,
	readRuntimeLlmRouteOverride,
	validateNativeApiRouteSnapshot,
} from "./native-api-runner-routing";
import type { NativeApiHistoryItem } from "./native-api-tool-history";
import { readOntologyMcpEnabled } from "./native-api-tool-history";
import { getNativeApiToolDefinitions } from "./native-api-tool-registry";

export async function prepareNativeApiRunRoute(input: {
	context: AgentRunContext;
	sink: AgentRuntimeSink;
	executionMode: NativeApiExecutionMode;
	history: NativeApiHistoryItem[];
	currentTodo: NativeApiRuntimeTodoSnapshot | null;
}): Promise<
	| {
			kind: "prepared";
			providerRequests: ReturnType<typeof buildNativeApiProviderRequests>;
			tools: ReturnType<typeof getNativeApiToolDefinitions>;
			routeOverride: ReturnType<typeof readRuntimeLlmRouteOverride>;
			routePolicy: Awaited<ReturnType<typeof buildNativeApiRoutePolicy>>;
	  }
	| { kind: "failed"; result: AgentRuntimeResult }
> {
	const routeOverride = readRuntimeLlmRouteOverride(input.context);
	const routePolicy = await buildNativeApiRoutePolicy({
		sink: input.sink,
		runId: input.context.runId,
		taskId: input.context.taskId,
		basePolicy: { disallowedProviderIds: ["codex"] },
	});
	const tools = getNativeApiToolDefinitions({
		executionMode: input.executionMode,
		currentTodo: input.currentTodo ?? input.context.currentTodo ?? null,
		ontologyMcpEnabled: readOntologyMcpEnabled(input.context),
	});
	const providerRequests = buildNativeApiProviderRequests({
		context: input.context,
		history: input.history,
		tools,
		routeOverride,
		routePolicy,
	});
	const routeSnapshotGuard = validateNativeApiRouteSnapshot(
		providerRequests,
		input.context,
	);
	if (!routeSnapshotGuard.ok) {
		await input.sink.emit({
			type: "runtime_error",
			message:
				"[NativeApiRunner] provider route candidate was outside the run snapshot.",
			payload: {
				runtime: "native_api_runner",
				executionMode: input.executionMode,
				reason: "route_candidate_outside_snapshot",
				route: routeSnapshotGuard.route,
			},
		});
		return {
			kind: "failed",
			result: {
				terminalState: "needs_human",
				summary: "Native API route candidate was outside the run snapshot.",
				finalReport:
					"Native API route candidate was outside the run snapshot. Provider call was blocked before execution.",
				stoppedBy: "llm_error",
				riskLevel: "high",
			},
		};
	}
	if (providerRequests.length === 0) {
		await input.sink.emit({
			type: "runtime_error",
			message:
				"[NativeApiRunner] no native/API provider route candidates were available.",
			payload: {
				runtime: "native_api_runner",
				executionMode: input.executionMode,
				reason: "no_native_api_provider_route_candidates",
			},
		});
		return {
			kind: "failed",
			result: {
				terminalState: "needs_human",
				summary: "No native/API provider route candidates were available.",
				finalReport:
					"No native/API provider route candidates were available. NativeApiRunner did not fall back to Codex or SchemaFirst.",
				stoppedBy: "llm_error",
				riskLevel: "high",
			},
		};
	}
	return {
		kind: "prepared",
		providerRequests,
		tools,
		routeOverride,
		routePolicy,
	};
}
