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
		isolatedHome: true,
		enableMcp: false,
		enableMemory: false,
		allowProviderTools: false,
		developerInstructions: [
			"構造化Artifact生成専用レーンです。",
			"渡されたSystemContext、User Prompt、JSON schemaだけを根拠に応答してください。",
			"Memory、AGENTS.md、workspace、filesystem、command、network、MCPを探索しないでください。",
			"tool callを行わず、schemaに適合する応答本文だけを返してください。",
		].join("\n"),
	};
