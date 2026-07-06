import type { StructuredLlmProviderEndpoint } from "./settings";

export type StructuredLlmProviderHealthResult = {
	ok: boolean;
	reachable: boolean;
	providerEndpointId: string;
	providerKind: StructuredLlmProviderEndpoint["kind"];
	url: string | null;
	status: number | null;
	durationMs: number;
	checkedAt: string;
	message: string;
};

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_CACHE_TTL_MS = 30_000;
const healthCache = new Map<string, StructuredLlmProviderHealthResult>();

export async function checkStructuredLlmProviderHealth(
	endpoint: StructuredLlmProviderEndpoint,
	options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<StructuredLlmProviderHealthResult> {
	const started = Date.now();
	const checkedAt = new Date().toISOString();
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
		};
	}

	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	);
	const fetchImpl = options.fetchImpl ?? fetch;
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
			url: urlResult.url,
			status: res.status,
			durationMs,
			checkedAt,
			message: res.ok
				? `HTTP ${res.status}`
				: `HTTP ${res.status}: ${res.statusText}`,
		};
	} catch (err) {
		const durationMs = Date.now() - started;
		return {
			ok: false,
			reachable: false,
			providerEndpointId: endpoint.id,
			providerKind: endpoint.kind,
			url: urlResult.url,
			status: null,
			durationMs,
			checkedAt,
			message: err instanceof Error ? err.message : String(err),
		};
	} finally {
		clearTimeout(timeout);
	}
}

export async function getCachedStructuredLlmProviderHealth(
	endpoint: StructuredLlmProviderEndpoint,
	options: {
		timeoutMs?: number;
		cacheTtlMs?: number;
		fetchImpl?: typeof fetch;
	} = {},
): Promise<StructuredLlmProviderHealthResult> {
	const cacheKey = buildProviderHealthCacheKey(endpoint);
	const cached = healthCache.get(cacheKey);
	const ttlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
	if (cached && Date.now() - Date.parse(cached.checkedAt) < ttlMs) {
		return cached;
	}
	const result = await checkStructuredLlmProviderHealth(endpoint, options);
	healthCache.set(cacheKey, result);
	return result;
}

export function clearStructuredLlmProviderHealthCache() {
	healthCache.clear();
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

	const rawBase =
		endpoint.kind === "azure"
			? endpoint.endpoint?.trim()
			: endpoint.baseUrl?.trim();
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

function buildProviderHealthCacheKey(endpoint: StructuredLlmProviderEndpoint) {
	return [
		endpoint.id,
		endpoint.kind,
		endpoint.baseUrl ?? "",
		endpoint.endpoint ?? "",
		endpoint.apiVersion ?? "",
		endpoint.models.join(","),
	].join("|");
}
