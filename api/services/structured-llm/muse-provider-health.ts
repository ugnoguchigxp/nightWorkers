import {
	redactStructuredLlmProbeUrl,
	resolveStructuredLlmProviderBaseUrl,
} from "./endpoint-target";
import {
	buildMuseAgentModelsUrl,
	buildMuseAgentSessionsUrl,
	createMuseAgentSession,
	listMuseAgentModels,
	releaseMuseAgentSession,
} from "./muse-provider-client";
import { StructuredProviderError } from "./provider-failure";
import type {
	StructuredLlmProviderHealthResult,
	StructuredLlmProviderTargetMetadata,
} from "./provider-health-contract";
import type { StructuredLlmProviderEndpoint } from "./settings";

const DEFAULT_EXECUTION_READINESS_TIMEOUT_MS = 30_000;
type MuseProviderTarget = Pick<
	StructuredLlmProviderEndpoint,
	"kind" | "baseUrl" | "endpoint" | "apiVersion" | "region" | "models"
>;

export function buildMuseProviderHealthUrl(
	endpoint: MuseProviderTarget,
): { ok: true; url: string } | { ok: false; message: string } {
	const rawBase = resolveStructuredLlmProviderBaseUrl(endpoint);
	if (!rawBase) return { ok: false, message: "Base URL is required." };
	try {
		return { ok: true, url: buildMuseAgentModelsUrl(rawBase) };
	} catch {
		return { ok: false, message: "Base URL is invalid." };
	}
}

export function buildMuseProviderExecutionReadinessUrl(
	endpoint: MuseProviderTarget,
): { ok: true; url: string } | { ok: false; message: string } {
	if (!endpoint.models?.[0]?.trim()) {
		return {
			ok: false,
			message: "A model is required for the Muse session probe.",
		};
	}
	const rawBase = resolveStructuredLlmProviderBaseUrl(endpoint);
	if (!rawBase) return { ok: false, message: "Base URL is required." };
	try {
		return { ok: true, url: buildMuseAgentSessionsUrl(rawBase) };
	} catch {
		return { ok: false, message: "Base URL is invalid." };
	}
}

export async function checkMuseModelAvailability(
	endpoint: StructuredLlmProviderEndpoint,
	input: {
		started: number;
		checkedAt: string;
		targetMetadata: StructuredLlmProviderTargetMetadata;
		url: string;
		controller: AbortController;
		fetchImpl: typeof fetch;
		clear: () => void;
	},
): Promise<StructuredLlmProviderHealthResult> {
	try {
		const baseUrl = resolveStructuredLlmProviderBaseUrl(endpoint) || "";
		const models = await listMuseAgentModels({
			baseUrl,
			apiKey: endpoint.apiKey,
			signal: input.controller.signal,
			fetchImpl: input.fetchImpl,
		});
		const configuredModel = endpoint.models[0]?.trim() || null;
		const modelAvailable = configuredModel
			? models.some(
					(model) => model.id === configuredModel && model.runtime === "muse",
				)
			: models.length > 0;
		return {
			ok: modelAvailable,
			reachable: true,
			providerEndpointId: endpoint.id,
			providerKind: endpoint.kind,
			url: redactStructuredLlmProbeUrl(input.url),
			status: 200,
			durationMs: Date.now() - input.started,
			checkedAt: input.checkedAt,
			message: modelAvailable
				? `Muse model available (${configuredModel || models[0]?.id}).`
				: `Configured Muse model is unavailable: ${configuredModel}`,
			probeKind: "connectivity",
			...input.targetMetadata,
		};
	} catch (error) {
		const failure =
			error instanceof StructuredProviderError ? error : undefined;
		return {
			ok: false,
			reachable:
				failure !== undefined &&
				failure.kind !== "transport" &&
				failure.kind !== "timeout",
			providerEndpointId: endpoint.id,
			providerKind: endpoint.kind,
			url: redactStructuredLlmProbeUrl(input.url),
			status: failure?.httpStatus ?? null,
			durationMs: Date.now() - input.started,
			checkedAt: input.checkedAt,
			message: error instanceof Error ? error.message : String(error),
			probeKind: "connectivity",
			...input.targetMetadata,
		};
	} finally {
		input.clear();
	}
}

export async function checkMuseExecutionReadiness(
	endpoint: StructuredLlmProviderEndpoint,
	options: { timeoutMs?: number; fetchImpl?: typeof fetch },
	targetMetadata: StructuredLlmProviderTargetMetadata,
): Promise<StructuredLlmProviderHealthResult> {
	const started = Date.now();
	const checkedAt = new Date().toISOString();
	const urlResult = buildMuseProviderExecutionReadinessUrl(endpoint);
	if (!urlResult.ok) {
		return {
			ok: false,
			reachable: false,
			providerEndpointId: endpoint.id,
			providerKind: endpoint.kind,
			url: null,
			status: null,
			durationMs: Date.now() - started,
			checkedAt,
			message: urlResult.message,
			probeKind: "execution_readiness",
			...targetMetadata,
		};
	}
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		options.timeoutMs ?? DEFAULT_EXECUTION_READINESS_TIMEOUT_MS,
	);
	const fetchImpl = options.fetchImpl ?? fetch;
	const baseUrl = resolveStructuredLlmProviderBaseUrl(endpoint) || "";
	const model = endpoint.models[0]?.trim() || "";
	let sessionId: string | null = null;
	let released = false;
	try {
		const models = await listMuseAgentModels({
			baseUrl,
			apiKey: endpoint.apiKey,
			signal: controller.signal,
			fetchImpl,
		});
		if (
			!models.some(
				(candidate) => candidate.id === model && candidate.runtime === "muse",
			)
		) {
			return {
				ok: false,
				reachable: true,
				providerEndpointId: endpoint.id,
				providerKind: endpoint.kind,
				url: redactStructuredLlmProbeUrl(urlResult.url),
				status: 200,
				durationMs: Date.now() - started,
				checkedAt,
				message: `Configured Muse model is unavailable: ${model}`,
				probeKind: "execution_readiness",
				...targetMetadata,
			};
		}
		const session = await createMuseAgentSession({
			baseUrl,
			apiKey: endpoint.apiKey,
			model,
			signal: controller.signal,
			fetchImpl,
		});
		sessionId = session.id;
		await releaseMuseAgentSession({
			baseUrl,
			apiKey: endpoint.apiKey,
			sessionId,
			signal: controller.signal,
			fetchImpl,
		});
		released = true;
		return {
			ok: true,
			reachable: true,
			providerEndpointId: endpoint.id,
			providerKind: endpoint.kind,
			url: redactStructuredLlmProbeUrl(urlResult.url),
			status: 201,
			durationMs: Date.now() - started,
			checkedAt,
			message: "Muse model is available and an agent session was created.",
			probeKind: "execution_readiness",
			...targetMetadata,
		};
	} catch (error) {
		const failure =
			error instanceof StructuredProviderError ? error : undefined;
		return {
			ok: false,
			reachable:
				failure !== undefined &&
				failure.kind !== "transport" &&
				failure.kind !== "timeout",
			providerEndpointId: endpoint.id,
			providerKind: endpoint.kind,
			url: redactStructuredLlmProbeUrl(urlResult.url),
			status: failure?.httpStatus ?? null,
			durationMs: Date.now() - started,
			checkedAt,
			message: error instanceof Error ? error.message : String(error),
			probeKind: "execution_readiness",
			...targetMetadata,
		};
	} finally {
		clearTimeout(timeout);
		if (sessionId && !released) {
			await releaseMuseAgentSession({
				baseUrl,
				apiKey: endpoint.apiKey,
				sessionId,
				signal: AbortSignal.timeout(5_000),
				fetchImpl,
			}).catch(() => undefined);
		}
	}
}
