import { callMissionPilotHost } from "../../backend/host-bindings";

export type StructuredLlmThinkingDepth =
	| ""
	| "low"
	| "medium"
	| "high"
	| "very_high";

export type StructuredLlmProviderSettings = {
	providerEndpoints?: Array<{ id: string; enabled: boolean }>;
	AZURE_OPENAI_ENABLED?: boolean;
	OPENAI_ENABLED?: boolean;
	AWS_BEDROCK_ENABLED?: boolean;
	CODEX_ENABLED?: boolean;
};

export const readStructuredLlmProviderSettings =
	(): StructuredLlmProviderSettings =>
		callMissionPilotHost("readStructuredLlmProviderSettings");
