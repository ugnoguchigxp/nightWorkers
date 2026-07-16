/** Meaningful provider capabilities are structural and role-neutral. */
export type StructuredProviderExecutionPolicy = {
	isolatedHome: boolean;
	enableMcp: boolean;
	enableMemory: boolean;
	allowProviderTools: boolean;
	developerInstructions?: string;
};

export const DEFAULT_STRUCTURED_PROVIDER_EXECUTION_POLICY: StructuredProviderExecutionPolicy =
	{
		isolatedHome: false,
		enableMcp: true,
		enableMemory: true,
		allowProviderTools: false,
	};
