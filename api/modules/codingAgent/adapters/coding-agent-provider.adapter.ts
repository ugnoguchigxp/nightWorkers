import type { StructuredProviderExecutionPolicy } from "../../agentsShare";

export const codingAgentProviderExecutionPolicy: StructuredProviderExecutionPolicy =
	{
		isolatedHome: false,
		enableMcp: true,
		enableMemory: true,
		allowProviderTools: false,
	};
