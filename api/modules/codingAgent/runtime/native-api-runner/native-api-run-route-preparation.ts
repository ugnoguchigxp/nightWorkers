import type { StructuredLlmRoutePolicy } from "../../../../services/structured-llm/types";
import type {
	AgentRunContext,
	AgentRuntimeResult,
	AgentRuntimeSink,
} from "../types";
import type { NativeApiExecutionMode } from "./native-api-mode";
import { buildNativeApiProviderRequests } from "./native-api-request-adapter";
import type { NativeApiRuntimeTodoSnapshot } from "./native-api-runner-history-cards";
import {
	readRuntimeLlmRouteOverride,
	validateNativeApiRouteSnapshot,
} from "./native-api-runner-routing";
import type { NativeApiHistoryItem } from "./native-api-tool-history";
import {
	readOntologyMcpEnabled,
	readProjectExplorationCatalogPin,
} from "./native-api-tool-history";
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
			routePolicy: StructuredLlmRoutePolicy;
	  }
	| { kind: "failed"; result: AgentRuntimeResult }
> {
	const routeOverride = readRuntimeLlmRouteOverride(input.context);
	const routePolicy: StructuredLlmRoutePolicy = {
		disallowedProviderIds: ["codex"],
	};
	const tools = getNativeApiToolDefinitions({
		ontologyMcpEnabled: readOntologyMcpEnabled(input.context),
		projectExplorationCatalogEnabled:
			readProjectExplorationCatalogPin(input.context)?.version === 2 &&
			readProjectExplorationCatalogPin(input.context)?.available === true,
		flatToolArguments: requiresFlatToolArguments(input.context),
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
		const revisionMismatch =
			routeSnapshotGuard.reason === "settings_revision_mismatch";
		await input.sink.emit({
			type: "runtime_error",
			message: revisionMismatch
				? "[NativeApiRunner] LLM settings changed after this run started."
				: "[NativeApiRunner] provider route candidate was outside the run snapshot.",
			payload: {
				runtime: "native_api_runner",
				executionMode: input.executionMode,
				reason: routeSnapshotGuard.reason,
				route: routeSnapshotGuard.route,
				expectedSettingsRevision: routeSnapshotGuard.expectedSettingsRevision,
				actualSettingsRevision: routeSnapshotGuard.actualSettingsRevision,
			},
		});
		return {
			kind: "failed",
			result: {
				terminalState: revisionMismatch ? "needs_human" : "failed",
				summary: revisionMismatch
					? "LLM settings changed after this run started."
					: "Native API route candidate was outside the run snapshot.",
				finalReport: revisionMismatch
					? "LLM settings changed after this run started. The saved route snapshot was preserved and the provider call was blocked before execution."
					: "Native API route candidate was outside the run snapshot. Provider call was blocked before execution.",
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
				terminalState: "failed",
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

function requiresFlatToolArguments(context: AgentRunContext) {
	const snapshot = context.contextSnapshot as Record<string, unknown>;
	const routing = record(snapshot.effectiveLlmRouting);
	const active = record(routing?.active);
	return requiresFlatToolArgumentsForEndpointKind(active?.endpointKind);
}

/** Some OpenAI-compatible endpoints also reject or misapply nested oneOf tool schemas. */
export function requiresFlatToolArgumentsForEndpointKind(endpointKind: unknown) {
	return (
		endpointKind === "local" ||
		endpointKind === "openai-compatible" ||
		endpointKind === "azure"
	);
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
