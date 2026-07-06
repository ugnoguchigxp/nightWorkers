import { getCachedStructuredLlmProviderHealth } from "../../structured-llm/provider-health";
import { providerAdapterKey } from "../../structured-llm/request";
import { normalizeStructuredLlmModelTarget } from "../../structured-llm/selection";
import {
	readStructuredLlmProviderSettings,
	type StructuredLlmProviderEndpoint,
} from "../../structured-llm/settings";
import type { ProviderToolTurnResult } from "../../structured-llm/tool-calls";
import type { StructuredLlmRoutePolicy } from "../../structured-llm/types";
import type { AgentRunContext, AgentRuntimeSink } from "../types";
import { readNativeApiExecutionMode } from "./native-api-mode";
import type { NativeApiProviderRequest } from "./native-api-request-adapter";

export function shouldForceNativeApiStartupGates(
	context: AgentRunContext,
): boolean {
	if (context.runtimeOptions?.forceStartupGates === false) return false;
	const executionMode = readNativeApiExecutionMode(context);
	return (
		executionMode === "implementation" ||
		executionMode === "review" ||
		executionMode === "runtime_debug"
	);
}

export function canCompleteNativeApiWithTextOnly(
	executionMode: ReturnType<typeof readNativeApiExecutionMode>,
	content: string,
) {
	if (!content.trim()) return false;
	return executionMode === "planning" || executionMode === "general_answer";
}

export async function emitNativeApiRouteFallback(input: {
	sink: AgentRuntimeSink;
	turnId: string;
	attemptIndex: number;
	from: NativeApiProviderRequest;
	to: NativeApiProviderRequest;
	reason: string;
	message: string;
}) {
	await input.sink.emit({
		type: "tool_call_progress",
		message: `[NativeApiRunner] provider-native route fallback started: ${input.reason}.`,
		payload: {
			runtime: "native_api_runner",
			action: "provider_route_fallback_started",
			turnId: input.turnId,
			attemptIndex: input.attemptIndex,
			reason: input.reason,
			message: input.message,
			from: summarizeNativeApiRoute(input.from),
			to: summarizeNativeApiRoute(input.to),
		},
	});
}

export function summarizeNativeApiRoute(request: NativeApiProviderRequest) {
	return {
		provider: request.provider,
		providerId: request.options.normalizedRequest.providerId,
		providerEndpointId:
			request.options.normalizedRequest.providerEndpointId ?? null,
		routeSource: request.options.normalizedRequest.routeSource ?? null,
		model: request.options.normalizedRequest.modelOrDeployment ?? null,
		thinkingDepth: request.options.normalizedRequest.thinkingDepth ?? null,
	};
}

export function readNativeApiCompletedTurnModel(
	providerResult: Extract<ProviderToolTurnResult, { type: "supported" }>,
	providerRequest: NativeApiProviderRequest,
) {
	return (
		providerResult.model ??
		providerRequest.options.normalizedRequest.modelOrDeployment
	);
}

export function validateNativeApiRouteSnapshot(
	requests: NativeApiProviderRequest[],
	context: AgentRunContext,
):
	| { ok: true }
	| { ok: false; route: ReturnType<typeof summarizeNativeApiRoute> } {
	const allowedRouteKeys = readAllowedRouteKeysFromSnapshot(context);
	if (!allowedRouteKeys || requests.length === 0) return { ok: true };
	for (const request of requests) {
		const routeKey = nativeApiRequestRouteKey(request);
		if (!allowedRouteKeys.has(routeKey)) {
			return { ok: false, route: summarizeNativeApiRoute(request) };
		}
	}
	return { ok: true };
}

function readAllowedRouteKeysFromSnapshot(
	context: AgentRunContext,
): Set<string> | null {
	const snapshot = context.contextSnapshot as
		| Record<string, unknown>
		| undefined;
	const effectiveLlmRouting = snapshot?.effectiveLlmRouting as
		| Record<string, unknown>
		| undefined;
	const roles = effectiveLlmRouting?.roles as
		| Record<string, unknown>
		| undefined;
	if (!roles) return null;
	const routeKeys = new Set<string>();
	for (const rolePlan of Object.values(roles)) {
		if (!rolePlan || typeof rolePlan !== "object") continue;
		const record = rolePlan as Record<string, unknown>;
		collectSnapshotRouteKey(routeKeys, record.primary);
		collectSnapshotRouteKey(routeKeys, record.override);
		const fallbacks = Array.isArray(record.fallbacks) ? record.fallbacks : [];
		for (const fallback of fallbacks)
			collectSnapshotRouteKey(routeKeys, fallback);
		const candidates = Array.isArray(record.candidates)
			? record.candidates
			: [];
		for (const candidate of candidates)
			collectSnapshotRouteKey(routeKeys, candidate);
	}
	return routeKeys.size > 0 ? routeKeys : null;
}

function collectSnapshotRouteKey(routeKeys: Set<string>, value: unknown) {
	if (!value || typeof value !== "object") return;
	const route = value as Record<string, unknown>;
	if (typeof route.routeKey === "string" && route.routeKey.trim()) {
		routeKeys.add(route.routeKey);
		return;
	}
	const providerEndpointId =
		typeof route.providerEndpointId === "string"
			? route.providerEndpointId
			: "";
	const model = typeof route.model === "string" ? route.model : "";
	const providerId =
		typeof route.providerId === "string" ? route.providerId : "";
	if (providerEndpointId && model && providerId) {
		routeKeys.add(`${providerEndpointId}::${model}::${providerId}`);
	}
}

function nativeApiRequestRouteKey(request: NativeApiProviderRequest) {
	const normalizedRequest = request.options.normalizedRequest;
	return [
		normalizedRequest.providerEndpointId ?? "",
		normalizedRequest.modelOrDeployment ?? "",
		normalizedRequest.providerId,
	].join("::");
}

export async function buildNativeApiRoutePolicy(input: {
	sink: AgentRuntimeSink;
	runId: string;
	taskId: string;
	basePolicy: StructuredLlmRoutePolicy;
}): Promise<StructuredLlmRoutePolicy> {
	if (
		process.env.NODE_ENV === "test" &&
		process.env.NIGHTWORKERS_NATIVE_API_READINESS_PROBE !== "1"
	) {
		return input.basePolicy;
	}
	const settings = readStructuredLlmProviderSettings();
	const endpoints = settings.providerEndpoints ?? [];
	const endpointReadiness: NonNullable<
		StructuredLlmRoutePolicy["endpointReadiness"]
	> = {};
	await Promise.all(
		endpoints
			.filter(shouldProbeNativeApiEndpointReadiness)
			.map(async (endpoint) => {
				const result = await getCachedStructuredLlmProviderHealth(endpoint, {
					timeoutMs: 1000,
					cacheTtlMs: 30_000,
				});
				endpointReadiness[endpoint.id] = {
					reachable: result.reachable,
					ok: result.ok,
					checkedAt: result.checkedAt,
					message: result.message,
				};
				if (result.reachable === false) {
					await input.sink.emit({
						type: "tool_call_progress",
						message: `[NativeApiRunner] provider endpoint skipped by readiness: ${endpoint.id}.`,
						payload: {
							runtime: "native_api_runner",
							action: "provider_readiness_skip",
							runId: input.runId,
							taskId: input.taskId,
							providerEndpointId: endpoint.id,
							providerKind: endpoint.kind,
							message: result.message,
						},
					});
				}
			}),
	);
	return {
		...input.basePolicy,
		skipUnreachableEndpoints: true,
		endpointReadiness,
	};
}

function shouldProbeNativeApiEndpointReadiness(
	endpoint: StructuredLlmProviderEndpoint,
) {
	return (
		endpoint.enabled &&
		(endpoint.kind === "local" || endpoint.kind === "openai-compatible") &&
		Boolean(endpoint.baseUrl?.trim())
	);
}

export function classifyNativeApiProviderError(
	error: unknown,
	input: { attemptTimedOut: boolean; attemptTimeoutMs?: number },
) {
	if (input.attemptTimedOut) {
		const timeoutMs = input.attemptTimeoutMs ?? 0;
		return {
			reason: "provider_route_attempt_timeout",
			message: `Provider route attempt timed out after ${timeoutMs}ms.`,
		};
	}
	const message = error instanceof Error ? error.message : String(error);
	if (/required_tool_call_missing/i.test(message)) {
		return { reason: "tool_required_missing", message };
	}
	if (
		/ECONNREFUSED|Unable to connect|ENOTFOUND|EHOSTUNREACH|network error|fetch failed/i.test(
			message,
		)
	) {
		return { reason: "endpoint_unreachable", message };
	}
	if (
		/loading model|unavailable_error|temporarily unavailable/i.test(message)
	) {
		return { reason: "transient_model_loading", message };
	}
	if (/abort/i.test(message)) {
		return { reason: "provider_aborted", message };
	}
	return { reason: "provider_error", message };
}

export function readRuntimeLlmRouteOverride(context: AgentRunContext) {
	const routing =
		context.runtimeOptions?.llmRouting &&
		typeof context.runtimeOptions.llmRouting === "object" &&
		!Array.isArray(context.runtimeOptions.llmRouting)
			? (context.runtimeOptions.llmRouting as Record<string, unknown>)
			: {};
	return normalizeStructuredLlmModelTarget(routing.override);
}

export function readNativeApiResumeRouteCompatibility(
	context: AgentRunContext,
	executionMode: ReturnType<typeof readNativeApiExecutionMode>,
) {
	const routing =
		context.runtimeOptions?.llmRouting &&
		typeof context.runtimeOptions.llmRouting === "object" &&
		!Array.isArray(context.runtimeOptions.llmRouting)
			? (context.runtimeOptions.llmRouting as Record<string, unknown>)
			: null;
	const active = toRecord(routing?.active);
	if (!active) return null;
	if (readString(routing?.executionMode) !== executionMode) return null;
	const providerId = readString(active.providerId);
	const model = readString(active.model);
	if (!providerId || !model || providerId === "codex") return null;
	return {
		provider: providerAdapterKey(providerId),
		model,
		executionMode,
	};
}

export function toRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function readString(value: unknown) {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: null;
}

export function firstLine(value: string) {
	return (
		value
			.split(/\r?\n/)
			.find((line) => line.trim())
			?.trim() || value.trim()
	);
}
