import type {
	LlmProviderEndpoint,
	LlmProviderEndpointKind,
} from "../nightworkers/types";

export function buildProviderEndpointKindPatch(
	endpoint: LlmProviderEndpoint,
	kind: LlmProviderEndpointKind,
): Partial<LlmProviderEndpoint> {
	const previousUsesBaseUrl =
		endpoint.kind === "openai" ||
		endpoint.kind === "openai-compatible" ||
		endpoint.kind === "local" ||
		endpoint.kind === "muse";
	const nextUsesBaseUrl =
		kind === "openai" ||
		kind === "openai-compatible" ||
		kind === "local" ||
		kind === "muse";
	return {
		kind,
		baseUrl:
			nextUsesBaseUrl && previousUsesBaseUrl ? endpoint.baseUrl || "" : "",
		endpoint:
			kind === "azure" && endpoint.kind === "azure"
				? endpoint.endpoint || ""
				: "",
		apiVersion:
			kind === "azure" && endpoint.kind === "azure"
				? endpoint.apiVersion || ""
				: "",
		region:
			kind === "bedrock" && endpoint.kind === "bedrock"
				? endpoint.region || ""
				: "",
	};
}
