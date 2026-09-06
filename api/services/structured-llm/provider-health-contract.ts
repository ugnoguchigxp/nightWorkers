import type { StructuredLlmProviderEndpoint } from "./settings";

export type StructuredLlmProviderTargetMetadata = {
	model: string | null;
	targetDigest: string;
};

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
	probeKind?: "connectivity" | "execution_readiness";
	model?: string | null;
	targetDigest?: string | null;
};
