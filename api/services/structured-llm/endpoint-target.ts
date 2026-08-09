import { digestText } from "../text-digest";

export type StructuredLlmEndpointKind =
	| "azure"
	| "openai"
	| "openai-compatible"
	| "bedrock"
	| "codex"
	| "local";

export type CanonicalizableStructuredLlmEndpoint = {
	kind: StructuredLlmEndpointKind;
	baseUrl?: string;
	endpoint?: string;
	apiVersion?: string;
	region?: string;
};

const OPENAI_COMPATIBLE_KINDS = new Set<StructuredLlmEndpointKind>([
	"openai",
	"openai-compatible",
	"local",
]);

/**
 * Provider kind is the structural authority for connection fields. Legacy
 * fields are read only while canonicalizing persisted settings and are never
 * used as a runtime fallback after this function returns.
 */
export function canonicalizeStructuredLlmEndpoint<
	T extends CanonicalizableStructuredLlmEndpoint,
>(endpoint: T): T {
	const baseUrl = endpoint.baseUrl?.trim() ?? "";
	const legacyEndpoint = endpoint.endpoint?.trim() ?? "";
	const apiVersion = endpoint.apiVersion?.trim() ?? "";
	const region = endpoint.region?.trim() ?? "";

	if (endpoint.kind === "azure") {
		return {
			...endpoint,
			baseUrl: "",
			endpoint: legacyEndpoint || baseUrl,
			apiVersion,
			region: "",
		};
	}
	if (OPENAI_COMPATIBLE_KINDS.has(endpoint.kind)) {
		return {
			...endpoint,
			baseUrl: baseUrl || legacyEndpoint,
			endpoint: "",
			apiVersion: "",
			region: "",
		};
	}
	if (endpoint.kind === "bedrock") {
		return {
			...endpoint,
			baseUrl: "",
			endpoint: "",
			apiVersion: "",
			region,
		};
	}
	return {
		...endpoint,
		baseUrl: "",
		endpoint: "",
		apiVersion: "",
		region: "",
	};
}

export function resolveStructuredLlmProviderBaseUrl(
	endpoint: CanonicalizableStructuredLlmEndpoint,
): string | null {
	const canonical = canonicalizeStructuredLlmEndpoint(endpoint);
	if (canonical.kind === "azure") return canonical.endpoint || null;
	if (OPENAI_COMPATIBLE_KINDS.has(canonical.kind)) {
		return canonical.baseUrl || null;
	}
	return null;
}

export function buildStructuredLlmTargetDigest(input: {
	providerEndpointId?: string | null;
	providerKind: string;
	endpoint?: string | null;
	region?: string | null;
	apiVersion?: string | null;
	model?: string | null;
}) {
	return digestText(
		JSON.stringify({
			providerEndpointId: input.providerEndpointId?.trim() || null,
			providerAdapter: normalizeTargetDigestProviderKind(input.providerKind),
			endpoint: input.endpoint?.trim().replace(/\/+$/, "") || null,
			region: input.region?.trim() || null,
			apiVersion: input.apiVersion?.trim() || null,
			model: input.model?.trim() || null,
		}),
	);
}

function normalizeTargetDigestProviderKind(kind: string) {
	if (kind === "azure") return "azure-openai";
	if (kind === "openai-compatible" || kind === "local" || kind === "openai") {
		return "openai";
	}
	return kind;
}
