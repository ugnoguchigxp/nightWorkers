import {
	buildStructuredLlmProviderTargetMetadata,
	redactStructuredLlmProbeUrl,
	resolveStructuredLlmProviderBaseUrl,
} from "./endpoint-target";
import {
	buildMuseProviderExecutionReadinessUrl,
	buildMuseProviderHealthUrl,
	checkMuseExecutionReadiness,
	checkMuseModelAvailability,
} from "./muse-provider-health";
import { readBoundedProviderResponseText } from "./provider-failure";
import type { StructuredLlmProviderHealthResult } from "./provider-health-contract";
import type { StructuredLlmProviderEndpoint } from "./settings";

export type {
	StructuredLlmProviderHealthResult,
	StructuredLlmProviderTargetMetadata,
} from "./provider-health-contract";

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_EXECUTION_READINESS_TIMEOUT_MS = 30_000;

export async function checkStructuredLlmProviderHealth(
	endpoint: StructuredLlmProviderEndpoint,
	options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<StructuredLlmProviderHealthResult> {
	const started = Date.now();
	const checkedAt = new Date().toISOString();
	const targetMetadata = buildStructuredLlmProviderTargetMetadata(endpoint);
	const urlResult = buildProviderHealthUrl(endpoint);
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
			probeKind: "connectivity",
			...targetMetadata,
		};
	}

	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	);
	const fetchImpl = options.fetchImpl ?? fetch;
	if (endpoint.kind === "muse") {
		return checkMuseModelAvailability(endpoint, {
			started,
			checkedAt,
			targetMetadata,
			url: urlResult.url,
			controller,
			fetchImpl,
			clear: () => clearTimeout(timeout),
		});
	}
	try {
		const res = await fetchImpl(urlResult.url, {
			method: getHealthMethod(endpoint),
			signal: controller.signal,
			headers: buildHealthHeaders(endpoint),
			body: buildHealthBody(endpoint),
		});
		const durationMs = Date.now() - started;
		return {
			ok: res.ok,
			reachable: true,
			providerEndpointId: endpoint.id,
			providerKind: endpoint.kind,
			url: redactStructuredLlmProbeUrl(urlResult.url),
			status: res.status,
			durationMs,
			checkedAt,
			message: res.ok
				? `HTTP ${res.status}`
				: `HTTP ${res.status}: ${res.statusText}`,
			probeKind: "connectivity",
			...targetMetadata,
		};
	} catch (err) {
		const durationMs = Date.now() - started;
		return {
			ok: false,
			reachable: false,
			providerEndpointId: endpoint.id,
			providerKind: endpoint.kind,
			url: redactStructuredLlmProbeUrl(urlResult.url),
			status: null,
			durationMs,
			checkedAt,
			message: err instanceof Error ? err.message : String(err),
			probeKind: "connectivity",
			...targetMetadata,
		};
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Explicit Settings action only. This calls the same Chat Completions path required by the
 * configured API lane and may incur provider usage.
 */
export async function checkStructuredLlmProviderExecutionReadiness(
	endpoint: StructuredLlmProviderEndpoint,
	options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<StructuredLlmProviderHealthResult> {
	if (endpoint.kind === "muse") {
		return checkMuseExecutionReadiness(
			endpoint,
			options,
			buildStructuredLlmProviderTargetMetadata(endpoint),
		);
	}
	if (endpoint.kind === "bedrock" || endpoint.kind === "codex") {
		const started = Date.now();
		return {
			ok: false,
			reachable: false,
			providerEndpointId: endpoint.id,
			providerKind: endpoint.kind,
			url: null,
			status: null,
			durationMs: Date.now() - started,
			checkedAt: new Date().toISOString(),
			message: `${endpoint.kind} does not support the OpenAI-compatible execution readiness probe.`,
			probeKind: "execution_readiness",
			...buildStructuredLlmProviderTargetMetadata(endpoint),
		};
	}
	const started = Date.now();
	const checkedAt = new Date().toISOString();
	const targetMetadata = buildStructuredLlmProviderTargetMetadata(endpoint);
	const urlResult = buildProviderExecutionReadinessUrl(endpoint);
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
	try {
		const response = await (options.fetchImpl ?? fetch)(urlResult.url, {
			method: "POST",
			signal: controller.signal,
			headers: buildExecutionReadinessHeaders(endpoint),
			body: JSON.stringify(buildExecutionReadinessBody(endpoint)),
		});
		const responseReadiness = response.ok
			? await readExecutionReadinessResponse(response)
			: null;
		return {
			ok: response.ok && responseReadiness?.ok === true,
			reachable: true,
			providerEndpointId: endpoint.id,
			providerKind: endpoint.kind,
			url: redactStructuredLlmProbeUrl(urlResult.url),
			status: response.status,
			durationMs: Date.now() - started,
			checkedAt,
			message: response.ok
				? responseReadiness?.ok
					? `Execution ready (HTTP ${response.status})`
					: (responseReadiness?.message ??
						"Execution probe response could not be validated.")
				: `Execution probe failed (HTTP ${response.status}: ${response.statusText})`,
			probeKind: "execution_readiness",
			...targetMetadata,
		};
	} catch (error) {
		return {
			ok: false,
			reachable: false,
			providerEndpointId: endpoint.id,
			providerKind: endpoint.kind,
			url: redactStructuredLlmProbeUrl(urlResult.url),
			status: null,
			durationMs: Date.now() - started,
			checkedAt,
			message: error instanceof Error ? error.message : String(error),
			probeKind: "execution_readiness",
			...targetMetadata,
		};
	} finally {
		clearTimeout(timeout);
	}
}

export function buildProviderHealthUrl(
	endpoint: Pick<
		StructuredLlmProviderEndpoint,
		"kind" | "baseUrl" | "endpoint" | "region" | "apiVersion" | "models"
	>,
): { ok: true; url: string } | { ok: false; message: string } {
	if (endpoint.kind === "codex") {
		return {
			ok: false,
			message: "Codex SDK does not expose an HTTP /health endpoint.",
		};
	}

	if (endpoint.kind === "bedrock") {
		if (!endpoint.region?.trim()) {
			return {
				ok: false,
				message: "AWS region is required to build a Bedrock health URL.",
			};
		}
		return {
			ok: true,
			url: `https://bedrock-runtime.${endpoint.region.trim()}.amazonaws.com/health`,
		};
	}
	if (endpoint.kind === "muse") {
		return buildMuseProviderHealthUrl(endpoint);
	}

	const rawBase = resolveStructuredLlmProviderBaseUrl(endpoint);
	if (!rawBase) {
		return { ok: false, message: "Endpoint URL or Base URL is required." };
	}

	let url: URL;
	try {
		url = new URL(rawBase);
	} catch {
		return { ok: false, message: "Endpoint URL or Base URL is invalid." };
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return {
			ok: false,
			message: "Only http and https health URLs are supported.",
		};
	}

	if (endpoint.kind === "azure") {
		const deploymentName = endpoint.models?.[0]?.trim();
		if (!deploymentName) {
			return {
				ok: false,
				message: "Azure deployment name is required for health checks.",
			};
		}
		const apiVersion = endpoint.apiVersion?.trim() || "2024-05-01-preview";
		url.pathname =
			`${stripKnownApiSuffix(url.pathname)}/openai/deployments/${encodeURIComponent(
				deploymentName,
			)}/chat/completions`.replace(/\/{2,}/g, "/");
		url.search = `?api-version=${encodeURIComponent(apiVersion)}`;
		url.hash = "";
		return { ok: true, url: url.toString() };
	}

	url.pathname = `${stripKnownApiSuffix(url.pathname)}/health`.replace(
		/\/{2,}/g,
		"/",
	);
	url.search = "";
	url.hash = "";
	return { ok: true, url: url.toString() };
}

export function buildProviderExecutionReadinessUrl(
	endpoint: Pick<
		StructuredLlmProviderEndpoint,
		"kind" | "baseUrl" | "endpoint" | "region" | "apiVersion" | "models"
	>,
): { ok: true; url: string } | { ok: false; message: string } {
	if (endpoint.kind === "azure") return buildProviderHealthUrl(endpoint);
	if (endpoint.kind === "muse") {
		return buildMuseProviderExecutionReadinessUrl(endpoint);
	}
	if (
		endpoint.kind !== "openai" &&
		endpoint.kind !== "openai-compatible" &&
		endpoint.kind !== "local"
	) {
		return {
			ok: false,
			message: `${endpoint.kind} does not expose an OpenAI-compatible execution probe.`,
		};
	}
	if (!endpoint.models?.[0]?.trim()) {
		return {
			ok: false,
			message: "A model is required for the execution readiness probe.",
		};
	}
	const rawBase = resolveStructuredLlmProviderBaseUrl(endpoint);
	if (!rawBase) return { ok: false, message: "Base URL is required." };
	let url: URL;
	try {
		url = new URL(rawBase);
	} catch {
		return { ok: false, message: "Base URL is invalid." };
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return {
			ok: false,
			message: "Only http and https execution URLs are supported.",
		};
	}
	const pathname = url.pathname.replace(/\/+$/, "");
	url.pathname = pathname.endsWith("/chat/completions")
		? pathname
		: `${pathname}/chat/completions`.replace(/\/{2,}/g, "/");
	url.search = "";
	url.hash = "";
	return { ok: true, url: url.toString() };
}

function buildExecutionReadinessHeaders(
	endpoint: StructuredLlmProviderEndpoint,
): Record<string, string> {
	if (endpoint.kind === "azure") {
		return {
			"Content-Type": "application/json",
			...(endpoint.apiKey?.trim() ? { "api-key": endpoint.apiKey.trim() } : {}),
		};
	}
	return {
		"Content-Type": "application/json",
		...(endpoint.apiKey?.trim()
			? { Authorization: `Bearer ${endpoint.apiKey.trim()}` }
			: {}),
	};
}

function buildExecutionReadinessBody(endpoint: StructuredLlmProviderEndpoint) {
	const tools = [
		{
			type: "function",
			function: {
				name: "nightworkers_readiness_probe",
				description: "Capability probe; do not call this tool.",
				parameters: { type: "object", properties: {} },
			},
		},
	];
	const common = {
		messages: [
			{
				role: "user",
				content: "Reply with OK. Do not call a tool.",
			},
		],
		stream: false,
		tools,
		tool_choice: "auto",
	};
	if (endpoint.kind === "azure") {
		return { ...common, max_completion_tokens: 16 };
	}
	return {
		...common,
		model: endpoint.models[0]?.trim() || "",
	};
}

async function readExecutionReadinessResponse(response: Response): Promise<{
	ok: boolean;
	message: string;
}> {
	let body: string;
	try {
		body = await readBoundedProviderResponseText(response);
	} catch {
		return {
			ok: false,
			message: "Execution probe response body could not be read.",
		};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return {
			ok: false,
			message: "Execution probe did not return valid JSON.",
		};
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return {
			ok: false,
			message: "Execution probe did not return a message choice.",
		};
	}
	const choices = (parsed as Record<string, unknown>).choices;
	const firstChoice = Array.isArray(choices) ? choices[0] : null;
	if (!firstChoice || typeof firstChoice !== "object") {
		return {
			ok: false,
			message: "Execution probe did not return a message choice.",
		};
	}
	const message = (firstChoice as Record<string, unknown>).message;
	if (!message || typeof message !== "object" || Array.isArray(message)) {
		return {
			ok: false,
			message: "Execution probe did not return a message choice.",
		};
	}
	const messageRecord = message as Record<string, unknown>;
	const hasContent =
		typeof messageRecord.content === "string" &&
		messageRecord.content.trim().length > 0;
	const hasToolCall =
		Array.isArray(messageRecord.tool_calls) &&
		messageRecord.tool_calls.length > 0;
	return hasContent || hasToolCall
		? { ok: true, message: "Execution probe returned a message choice." }
		: {
				ok: false,
				message: "Execution probe returned an empty message choice.",
			};
}

function buildHealthHeaders(
	endpoint: StructuredLlmProviderEndpoint,
): HeadersInit {
	const headers: Record<string, string> = {
		Accept: "application/json,text/plain,*/*",
	};
	if (endpoint.kind === "azure") {
		headers["Content-Type"] = "application/json";
		if (endpoint.apiKey?.trim()) {
			headers["api-key"] = endpoint.apiKey.trim();
		}
	}
	return headers;
}

function getHealthMethod(endpoint: StructuredLlmProviderEndpoint) {
	return endpoint.kind === "azure" ? "POST" : "GET";
}

function buildHealthBody(endpoint: StructuredLlmProviderEndpoint) {
	if (endpoint.kind !== "azure") return undefined;
	return JSON.stringify({
		messages: [{ role: "user", content: "Reply OK." }],
		max_completion_tokens: 16,
	});
}

function stripKnownApiSuffix(pathname: string) {
	const normalized = pathname.replace(/\/+$/, "");
	if (!normalized || normalized === "/") return "";
	if (normalized === "/v1" || normalized === "/api") return "";
	return normalized;
}

export { buildStructuredLlmProviderTargetMetadata } from "./endpoint-target";
