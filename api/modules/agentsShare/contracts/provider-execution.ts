import {
	bindSystemContextCatalogSnapshot,
	type SystemContextBindingSnapshot,
	type SystemContextPromptAudit,
	systemContextPromptAudit,
} from "../../../systemContexts/catalog";

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
	bindDeveloperInstructions?: (binding: SystemContextBindingSnapshot) => {
		text: string;
		systemContextAudit: readonly SystemContextPromptAudit[];
	};
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
		bindDeveloperInstructions(binding) {
			const request = bindSystemContextCatalogSnapshot(binding);
			const invocation = request.invoke("providerExecution.artifact-lane", {});
			return {
				text: invocation.content.text,
				systemContextAudit: [
					systemContextPromptAudit("developer", request, invocation),
				],
			};
		},
	};
