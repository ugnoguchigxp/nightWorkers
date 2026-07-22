import { p } from "../../../systemContexts/catalog";

/** Meaningful provider capabilities are structural and role-neutral. */
export type StructuredProviderCallAuthorizationContext = {
	taskId: string | null;
	signal?: AbortSignal;
};

export type StructuredProviderExecutionPolicy = {
	isolatedHome: boolean;
	enableMcp: boolean;
	enableMemory: boolean;
	allowProviderTools: boolean;
	developerInstructions?: string;
	authorizeProviderCall?: (
		context: StructuredProviderCallAuthorizationContext,
	) => Promise<void> | void;
};

export const DEFAULT_STRUCTURED_PROVIDER_EXECUTION_POLICY: StructuredProviderExecutionPolicy =
	{
		isolatedHome: true,
		enableMcp: false,
		enableMemory: false,
		allowProviderTools: false,
		get developerInstructions() {
			return p("providerExecution.artifact-lane", {});
		},
	};
